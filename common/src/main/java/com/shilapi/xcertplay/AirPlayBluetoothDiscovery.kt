package com.shilapi.xcertplay

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.shilapi.xcertplay.receiver.ReceiverBluetoothBeacon
import java.io.Closeable
import java.net.Inet4Address

/** Optional nearby discovery. Failure never takes down Bonjour, CarPlay or the receiver. */
internal class AirPlayBluetoothDiscovery(
    private val log: (String) -> Unit,
    private val radio: Radio,
    private val address: () -> Inet4Address? = ReceiverBluetoothBeacon::localAddress,
) : Closeable {
    constructor(context: Context, log: (String) -> Unit) : this(log, AndroidRadio(context.applicationContext))

    internal interface Radio {
        fun unavailableReason(): String?
        fun start(payload: ByteArray, completion: (Int?) -> Unit)
        fun stop()
    }

    private var closed = false
    private var generation = 0L
    private var seed = 0
    private var configuration: String? = null
    private var active: ByteArray? = null
    private var state: String? = null

    /** Called by the receiver's existing discovery timer, including after Bluetooth or grant changes. */
    @Synchronized fun refresh(currentConfiguration: String) {
        if (closed) return
        try {
            val unavailable = radio.unavailableReason()
            val selected = if (unavailable == null) address() else null
            if (unavailable != null || selected == null) {
                stopAttempt()
                report(unavailable ?: "no-network")
                return
            }
            val fingerprint = "$currentConfiguration|${selected.hostAddress}"
            if (configuration != fingerprint) {
                configuration = fingerprint
                seed = (seed + 1) and 255
            }
            val payload = ReceiverBluetoothBeacon.payload(selected, seed)
            if (active?.contentEquals(payload) == true) return
            stopAttempt()
            active = payload
            val attempt = generation
            report("starting")
            radio.start(payload) { error ->
                synchronized(this) {
                    if (!closed && attempt == generation) {
                        if (error == null) report("advertising")
                        else {
                            stopAttempt()
                            report("failed code=$error")
                        }
                    }
                }
            }
        } catch (_: SecurityException) {
            stopAttempt()
            report("permission")
        } catch (error: Exception) {
            stopAttempt()
            report("failed exception=${error.javaClass.simpleName}")
        }
    }

    private fun report(value: String) {
        if (state == value) return
        state = value
        log("receiver bluetoothDiscovery=$value")
    }

    private fun stopAttempt() {
        generation++ // Ignore Android callbacks delivered after stop/replacement/destruction.
        if (active != null) {
            active = null
            runCatching { radio.stop() }
        }
    }

    @Synchronized override fun close() {
        if (closed) return
        closed = true
        stopAttempt()
    }

    @SuppressLint("MissingPermission") // Checked before start; revocation is caught by refresh/stop.
    private class AndroidRadio(private val context: Context) : Radio {
        private var advertiser: BluetoothLeAdvertiser? = null
        private var callback: AdvertiseCallback? = null

        override fun unavailableReason(): String? {
            if (Build.VERSION.SDK_INT >= 31 &&
                listOf(Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_ADVERTISE).any {
                    context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
                }) return "permission"
            val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter ?: return "unsupported"
            if (!adapter.isEnabled) return "disabled"
            return if (adapter.bluetoothLeAdvertiser == null) "unsupported" else null
        }

        override fun start(payload: ByteArray, completion: (Int?) -> Unit) {
            val selected = context.getSystemService(BluetoothManager::class.java)?.adapter?.bluetoothLeAdvertiser
                ?: throw IllegalStateException("Bluetooth advertiser unavailable")
            val listener = object : AdvertiseCallback() {
                override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) = completion(null)
                override fun onStartFailure(errorCode: Int) = completion(errorCode)
            }
            advertiser = selected
            callback = listener
            selected.startAdvertising(AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
                .setConnectable(false).setTimeout(0).build(),
                AdvertiseData.Builder().setIncludeDeviceName(false).setIncludeTxPowerLevel(false)
                    .addManufacturerData(ReceiverBluetoothBeacon.MANUFACTURER_ID, payload).build(), listener)
        }

        override fun stop() {
            val selected = advertiser
            val listener = callback
            advertiser = null
            callback = null
            if (listener != null) selected?.stopAdvertising(listener)
        }
    }
}
