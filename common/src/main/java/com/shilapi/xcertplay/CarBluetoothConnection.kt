package com.shilapi.xcertplay

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.BluetoothA2dp
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothProfile
import android.companion.CompanionDeviceManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import androidx.annotation.ChecksSdkIntAtLeast
import androidx.core.content.ContextCompat

/** Retains ownership across Activity recreation; never acts on a retired CarPlay session. */
internal object CarBluetoothConnection {
    enum class Attempt { NONE, REQUESTED, UNSUPPORTED, FAILED }
    @Volatile var attempt = Attempt.NONE
        private set
    private var application: Context? = null
    private var receiverRegistered = false
    private val permissionRecovery = CarBluetoothPermissionRecovery()
    private val sessions = CarBluetoothSessionController(
        request = { address, connect -> application?.let { request(it, address, connect) } ?: Attempt.NONE },
    )
    private val receiver = object : BroadcastReceiver() {
        @SuppressLint("MissingPermission")
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == BluetoothAdapter.ACTION_STATE_CHANGED) { permissionsChanged(context); return }
            @Suppress("DEPRECATION") val device = intent.getParcelableExtra<BluetoothDevice>(BluetoothDevice.EXTRA_DEVICE) ?: return
            runCatching {
                if (intent.action == BluetoothDevice.ACTION_ACL_DISCONNECTED) profileDisconnected(device.address)
                else if (intent.getIntExtra(BluetoothProfile.EXTRA_STATE, BluetoothProfile.STATE_DISCONNECTED) == BluetoothProfile.STATE_CONNECTED)
                    profileConnected(device.address)
            }
        }
    }
    private fun observeProfiles(context: Context) {
        if (receiverRegistered || Build.VERSION.SDK_INT < 37) return
        runCatching {
            ContextCompat.registerReceiver(context.applicationContext, receiver, IntentFilter().apply {
                addAction(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED)
                addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED)
                addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
                addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            }, ContextCompat.RECEIVER_EXPORTED)
            receiverRegistered = true
        }
    }
    @Synchronized private fun profileConnected(address: String) { sessions.profileConnected(address) }
    @Synchronized private fun profileDisconnected(address: String) { sessions.profileDisconnected(address) }
    @Synchronized fun userAction() { sessions.userAction() }

    @Synchronized fun sessionActive(context: Context, session: Any) {
        application = context.applicationContext
        observeProfiles(context)
        permissionRecovery.update(permissionReady(context))
        val address = if (!BrowserCarPlayAudioSettings.disabled(context)) CarBluetoothPreference.address(context) else null
        attempt = sessions.active(session, address)
    }

    @Synchronized fun sessionEnded(context: Context, session: Any) {
        attempt = sessions.ended(session)
    }

    @Synchronized fun selectionChanged(context: Context) {
        application = context.applicationContext
        observeProfiles(context)
        permissionRecovery.update(permissionReady(context))
        sessions.userAction()
        val next = if (!BrowserCarPlayAudioSettings.disabled(context)) CarBluetoothPreference.address(context) else null
        attempt = sessions.select(next)
        // Changing selection itself is explicit user action, including the stop of the old target.
        sessions.userAction()
    }

    /** Resume and permission callbacks may repeat; only a newly usable observer retries. */
    @Synchronized fun permissionsChanged(context: Context) {
        application = context.applicationContext
        observeProfiles(context)
        val ready = permissionReady(context)
        val recovered = permissionRecovery.update(ready)
        if (!ready) { attempt = sessions.unavailable(); return }
        if (!recovered) return
        val next = if (!BrowserCarPlayAudioSettings.disabled(context)) CarBluetoothPreference.address(context) else null
        attempt = sessions.select(next)
    }

    @SuppressLint("MissingPermission")
    private fun permissionReady(context: Context): Boolean = autoConnectionReady(
        permitted = Build.VERSION.SDK_INT < 31 || context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED,
        observerReady = Build.VERSION.SDK_INT < 37 || receiverRegistered,
        adapterEnabled = runCatching { context.getSystemService(BluetoothManager::class.java)?.adapter?.isEnabled == true }.getOrDefault(false),
    )

    /** Selection never requires this authorization; it only enables platform auto-connect. */
    @ChecksSdkIntAtLeast(api = 37)
    @SuppressLint("MissingPermission")
    @Suppress("DEPRECATION")
    fun supportsAutomaticConnection(context: Context, address: String?): Boolean {
        if (address.isNullOrBlank()) return false
        if (Build.VERSION.SDK_INT < 37 || context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED)
            return false
        return runCatching {
            context.getSystemService(CompanionDeviceManager::class.java)?.associations?.any { it.equals(address, true) } == true
        }.getOrDefault(false)
    }

    @SuppressLint("MissingPermission")
    private fun request(context: Context, address: String?, connect: Boolean): Attempt {
        if (address.isNullOrBlank()) return Attempt.NONE
        if (!supportsAutomaticConnection(context, address)) return Attempt.UNSUPPORTED
        val perform: () -> Attempt = { runCatching {
            val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
            if (adapter == null || !adapter.isEnabled || !BluetoothDeviceCheck.valid(address)) Attempt.FAILED
            else {
                val device = adapter.getRemoteDevice(address)
                // A saved device may have been unpaired since selection. Never
                // let a profile request become a new phone-initiated pairing.
                if (device.bondState != BluetoothDevice.BOND_BONDED) Attempt.FAILED
                else {
                    val result = if (connect) device.connect() else device.disconnect()
                    if (result == BluetoothStatusCodes.SUCCESS) Attempt.REQUESTED else Attempt.FAILED
                }
            }
        }.getOrDefault(Attempt.FAILED) }
        // A failed registration leaves no way to undo an asynchronously completed connection.
        return if (connect) requestWithObserver(receiverRegistered, perform) else perform()
    }
}

internal fun requestWithObserver(receiverRegistered: Boolean, perform: () -> CarBluetoothConnection.Attempt): CarBluetoothConnection.Attempt =
    if (receiverRegistered) perform() else CarBluetoothConnection.Attempt.FAILED

internal fun autoConnectionReady(permitted: Boolean, observerReady: Boolean, adapterEnabled: Boolean): Boolean =
    permitted && observerReady && adapterEnabled

internal class CarBluetoothPermissionRecovery {
    private var ready = false
    fun update(next: Boolean): Boolean {
        val recovered = next && !ready
        ready = next
        return recovered
    }
}

/** Session identity guards a replacement from a late end callback. */
internal class CarBluetoothSessionController(
    private val now: () -> Long = { System.nanoTime() / 1_000_000L },
    private val request: (String?, Boolean) -> CarBluetoothConnection.Attempt,
) {
    private var owner: Any? = null
    private var selected: String? = null
    private var last = CarBluetoothConnection.Attempt.NONE
    private data class Compensation(val address: String, val deadline: Long)
    private var compensation: Compensation? = null
    private val compensationMillis = 5_000L
    private fun key(address: String) = address.uppercase(java.util.Locale.ROOT)
    private fun stop(address: String?) {
        if (address != null) {
            // A profile already connected does not prove another profile cannot finish later.
            compensation = if (last == CarBluetoothConnection.Attempt.REQUESTED)
                Compensation(key(address), now() + compensationMillis) else null
            request(address, false)
        }
    }
    fun active(session: Any, address: String?): CarBluetoothConnection.Attempt {
        if (owner === session) return select(address)
        val replacing = owner != null
        owner = session
        if (address != null && compensation?.address == key(address)) compensation = null
        if (replacing && address.equals(selected, true)) return last
        if (replacing && selected != null) stop(selected)
        selected = address
        last = request(address, true)
        return last
    }
    fun ended(session: Any): CarBluetoothConnection.Attempt {
        if (owner !== session) return last
        owner = null
        stop(selected)
        selected = null
        last = CarBluetoothConnection.Attempt.NONE
        return last
    }
    fun select(address: String?): CarBluetoothConnection.Attempt {
        if (owner == null) return last
        if (address.equals(selected, true)) {
            if (address != null && last != CarBluetoothConnection.Attempt.REQUESTED)
                last = request(address, true)
            return last
        }
        stop(selected)
        selected = address
        if (address != null && compensation?.address == key(address)) compensation = null
        last = request(address, true)
        return last
    }
    fun unavailable(): CarBluetoothConnection.Attempt {
        if (owner != null && selected != null && last == CarBluetoothConnection.Attempt.REQUESTED)
            last = CarBluetoothConnection.Attempt.FAILED
        return last
    }
    fun profileConnected(address: String) {
        val normalized = key(address)
        if (owner != null && selected.equals(address, true)) {
            if (compensation?.address == normalized) compensation = null
            return
        }
        val current = compensation ?: return
        if (now() >= current.deadline) { compensation = null; return }
        if (current.address == normalized) { compensation = null; request(normalized, false) }
    }
    // A disconnect of one profile or ACL can precede another profile's late connection.
    fun profileDisconnected(address: String) = Unit
    fun userAction() { compensation = null }
}

internal object BluetoothDeviceCheck {
    fun valid(address: String) = android.bluetooth.BluetoothAdapter.checkBluetoothAddress(address)
}
