package com.shilapi.xcertplay

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.companion.AssociationRequest
import android.companion.BluetoothDeviceFilter
import android.companion.CompanionDeviceManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.IntentSender
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Bundle
import android.os.SystemClock
import android.widget.Toast
import androidx.core.content.ContextCompat
import com.shilapi.xcertplay.host.R

internal object CarBluetoothPreference {
    private const val PREFS = "tiplay_car_bluetooth"
    fun address(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("address", null)
    fun name(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("name", null)
    fun save(context: Context, address: String?, name: String?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("address", address).putString("name", name).apply()
        CarBluetoothConnection.selectionChanged(context)
    }
}

/** Uses Android's companion chooser and bonding confirmation, without assuming they connect an audio profile. */
@SuppressLint("MissingPermission")
internal class CarBluetoothSelection(
    private val activity: Activity,
    private val launch: (IntentSender) -> Unit,
    private val changed: () -> Unit,
) : AutoCloseable {
    private val handler = Handler(Looper.getMainLooper())
    private var generation = 0
    private var pending: BluetoothDevice? = null
    private var before = emptySet<String>()
    private var listening = false
    private var awaiting = false
    private var chooserLaunched = false
    private var bondDeadline = 0L
    private var bondStarted = false
    private val bondTimeout = Runnable {
        pending?.let { device ->
            if (!permitted()) return@let
            if (runCatching { device.bondState }.getOrDefault(BluetoothDevice.ERROR) == BluetoothDevice.BOND_BONDED) commit(device)
            else fail(device)
        }
    }
    private val manager get() = if (Build.VERSION.SDK_INT >= 26) activity.getSystemService(CompanionDeviceManager::class.java) else null
    private fun permitted() = Build.VERSION.SDK_INT < 31 ||
        activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
    @Suppress("DEPRECATION")
    private fun associations(): Set<String> = if (Build.VERSION.SDK_INT >= 26) runCatching {
        manager?.associations?.map { it.uppercase() }?.toSet().orEmpty()
    }.getOrDefault(emptySet()) else emptySet()
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (!permitted()) return
            @Suppress("DEPRECATION") val device = intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE) ?: return
            val candidate = pending ?: return
            if (runCatching { device.address.equals(candidate.address, true) }.getOrDefault(false) != true) return
            when (intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.ERROR)) {
                BluetoothDevice.BOND_BONDED -> commit(candidate)
                BluetoothDevice.BOND_NONE -> fail(candidate)
            }
        }
    }
    fun select(address: String? = null) {
        if (!permitted()) { message(R.string.settings_car_bluetooth_permission); return }
        if (pending != null) { permissionsChanged(); return }
        if (awaiting || pending != null) return
        if (address != null && Build.VERSION.SDK_INT >= 26 && address.uppercase() in associations()) {
            val device = runCatching { activity.getSystemService(BluetoothManager::class.java)?.adapter?.getRemoteDevice(address) }.getOrNull()
            if (device != null && device.bondState == BluetoothDevice.BOND_BONDED &&
                !device.address.equals(DiPlayPreferences.phoneAddress(activity), true)) {
                pending = device; commit(device); return
            }
        }
        if (Build.VERSION.SDK_INT < 26 && address != null) {
            val device = runCatching { activity.getSystemService(BluetoothManager::class.java)?.adapter?.getRemoteDevice(address) }.getOrNull()
            if (device != null && device.bondState == BluetoothDevice.BOND_BONDED &&
                !device.address.equals(DiPlayPreferences.phoneAddress(activity), true)) {
                pending = device; commit(device)
            } else message(R.string.settings_car_bluetooth_pair_failed)
            return
        }
        if (Build.VERSION.SDK_INT < 26 || manager == null ||
            !activity.packageManager.hasSystemFeature(PackageManager.FEATURE_COMPANION_DEVICE_SETUP)) {
            message(R.string.settings_car_bluetooth_unsupported_pairing); return
        }
        cancelPending()
        val token = ++generation
        awaiting = true
        chooserLaunched = false
        before = associations()
        val filter = BluetoothDeviceFilter.Builder().apply { if (address != null) setAddress(address) }.build()
        val request = AssociationRequest.Builder().addDeviceFilter(filter).setSingleDevice(address != null).build()
        runCatching {
            @Suppress("DEPRECATION") manager?.associate(request, object : CompanionDeviceManager.Callback() {
                override fun onDeviceFound(chooserLauncher: IntentSender) {
                    if (generation == token && awaiting && !chooserLaunched && !activity.isFinishing && !activity.isDestroyed) {
                        chooserLaunched = true
                        runCatching { launch(chooserLauncher) }.onFailure { awaiting = false; chooserLaunched = false; message(R.string.settings_car_bluetooth_pair_failed) }
                    }
                }
                override fun onFailure(error: CharSequence?) {
                    if (generation == token && awaiting && !activity.isDestroyed) { awaiting = false; chooserLaunched = false; message(R.string.settings_car_bluetooth_pair_failed) }
                }
            }, handler)
        }.onFailure { awaiting = false; message(R.string.settings_car_bluetooth_pair_failed) }
    }
    fun onResult(resultCode: Int, data: Intent?) {
        if (!awaiting || !chooserLaunched) return
        awaiting = false
        chooserLaunched = false
        if (resultCode != Activity.RESULT_OK || data == null) return
        @Suppress("DEPRECATION") val device = data.getParcelableExtra<BluetoothDevice>(CompanionDeviceManager.EXTRA_DEVICE) ?: return
        pending = device
        bondStarted = false
        if (!permitted()) { message(R.string.settings_car_bluetooth_permission); return }
        resumePending(device)
    }
    fun permissionsChanged() {
        if (!permitted()) return
        pending?.let(::resumePending)
    }
    private fun resumePending(device: BluetoothDevice) {
        val address = runCatching { device.address }.getOrNull() ?: return
        if (address.equals(DiPlayPreferences.phoneAddress(activity), true)) {
            reject(device, R.string.settings_car_bluetooth_not_iphone); return
        }
        beginBond(device, initiate = !bondStarted)
    }
    private fun beginBond(device: BluetoothDevice, initiate: Boolean) {
        if (!runCatching { listenForBond() }.isSuccess) { fail(device); return }
        // Register first, then reread: a BONDED transition during registration must not be lost.
        when (runCatching { device.bondState }.getOrDefault(BluetoothDevice.ERROR)) {
            BluetoothDevice.BOND_BONDED -> commit(device)
            BluetoothDevice.BOND_BONDING -> { bondStarted = true; armBondTimeout(device) }
            BluetoothDevice.BOND_NONE -> {
                if (!initiate) {
                    if (bondStarted && bondDeadline > SystemClock.elapsedRealtime()) armBondTimeout(device) else fail(device)
                    return
                }
                if (bondDeadline == 0L) bondDeadline = SystemClock.elapsedRealtime() + BOND_TIMEOUT_MILLIS
                bondStarted = true
                val started = runCatching { device.createBond() }.getOrDefault(false)
                when (runCatching { device.bondState }.getOrDefault(BluetoothDevice.ERROR)) {
                    BluetoothDevice.BOND_BONDED -> commit(device)
                    BluetoothDevice.BOND_BONDING -> armBondTimeout(device)
                    BluetoothDevice.BOND_NONE -> if (started) armBondTimeout(device) else fail(device)
                    else -> fail(device)
                }
            }
            else -> fail(device)
        }
    }
    private fun armBondTimeout(device: BluetoothDevice) {
        if (pending !== device) return
        if (bondDeadline == 0L) bondDeadline = SystemClock.elapsedRealtime() + BOND_TIMEOUT_MILLIS
        handler.removeCallbacks(bondTimeout)
        handler.postDelayed(bondTimeout, (bondDeadline - SystemClock.elapsedRealtime()).coerceAtLeast(0L))
    }
    private fun commit(device: BluetoothDevice) {
        if (pending !== device || !permitted()) return
        val name = runCatching { device.name }.getOrNull().orEmpty().ifBlank { activity.getString(R.string.paired_device) }
        val address = runCatching { device.address }.getOrNull() ?: return
        CarBluetoothPreference.save(activity, address, name)
        pending = null; bondDeadline = 0L; bondStarted = false; unregister(); clearRetained(); changed()
    }
    private fun fail(device: BluetoothDevice) {
        reject(device, R.string.settings_car_bluetooth_pair_failed)
    }
    private fun reject(device: BluetoothDevice, reason: Int) {
        if (pending !== device) return
        if (!permitted()) { unregister(); return }
        cleanupAssociation(device); pending = null; bondDeadline = 0L; bondStarted = false; unregister(); clearRetained(); message(reason)
    }
    @Suppress("DEPRECATION")
    private fun cleanupAssociation(device: BluetoothDevice) {
        if (Build.VERSION.SDK_INT >= 26 && permitted() && runCatching { device.address.uppercase() !in before }.getOrDefault(false))
            runCatching { manager?.disassociate(device.address) }
    }
    private fun cancelPending() {
        awaiting = false; chooserLaunched = false
        if (!permitted() && pending != null) {
            retained = Recovery(pending!!, before, bondDeadline, bondStarted)
        } else {
            pending?.let(::cleanupAssociation); clearRetained()
        }
        pending = null; bondDeadline = 0L; bondStarted = false; unregister()
    }
    private fun listenForBond() {
        if (!listening) {
            ContextCompat.registerReceiver(activity, receiver, IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED), ContextCompat.RECEIVER_EXPORTED)
            listening = true
        }
    }
    fun save(out: Bundle) {
        out.putBoolean("car_bluetooth_awaiting", awaiting)
        out.putBoolean("car_bluetooth_chooser_launched", chooserLaunched)
        out.putParcelable("car_bluetooth_pending_device", pending)
        out.putLong("car_bluetooth_bond_deadline", bondDeadline)
        out.putBoolean("car_bluetooth_bond_started", bondStarted)
        out.putStringArrayList("car_bluetooth_associations_before", ArrayList(before))
    }
    fun restore(saved: Bundle?) {
        if (saved != null) {
            chooserLaunched = saved.getBoolean("car_bluetooth_chooser_launched", false)
            awaiting = resumeChooser(saved.getBoolean("car_bluetooth_awaiting", false), chooserLaunched)
            bondDeadline = saved.getLong("car_bluetooth_bond_deadline", 0L)
            bondStarted = saved.getBoolean("car_bluetooth_bond_started", false)
            before = saved.getStringArrayList("car_bluetooth_associations_before")?.toSet().orEmpty()
            @Suppress("DEPRECATION") val candidate = saved.getParcelable<BluetoothDevice>("car_bluetooth_pending_device")
            pending = candidate
        }
        if (retainedChooser) { awaiting = true; chooserLaunched = true; retainedChooser = false }
        if (pending == null) retained?.let { recovery ->
            pending = recovery.device; before = recovery.before; bondDeadline = recovery.deadline; bondStarted = recovery.started
        }
        if (permitted()) permissionsChanged()
    }
    private fun unregister() { handler.removeCallbacks(bondTimeout); if (listening) runCatching { activity.unregisterReceiver(receiver) }; listening = false }
    private fun message(id: Int) { if (!activity.isDestroyed) Toast.makeText(activity, id, Toast.LENGTH_LONG).show() }
    override fun close() {
        generation++
        if (activity.isChangingConfigurations) {
            retainedChooser = awaiting && chooserLaunched
            pending?.let { retained = Recovery(it, before, bondDeadline, bondStarted) }
            unregister()
        } else cancelPending()
    }
    private fun clearRetained() { retained = null }
    private data class Recovery(val device: BluetoothDevice, val before: Set<String>, val deadline: Long, val started: Boolean)
    companion object {
        private const val BOND_TIMEOUT_MILLIS = 120_000L
        private var retained: Recovery? = null
        private var retainedChooser = false
    }
}

internal fun resumeChooser(awaiting: Boolean, launched: Boolean) = awaiting && launched
