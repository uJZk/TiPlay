package com.shilapi.xcertplay

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothA2dp
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import androidx.core.content.ContextCompat

/** Observes Android's audio profiles, never bond state or the iPhone RFCOMM connection. */
internal class CarBluetoothStatus(private val context: Context, private val changed: () -> Unit) : AutoCloseable {
    enum class State { CONNECTED, DISCONNECTED, UNKNOWN, VERIFY_AUDIO_DEVICE, NOT_SELECTED, ROUTE_UNVERIFIED }
    private val profiles = mutableMapOf<Int, BluetoothProfile>()
    private val unavailable = mutableSetOf<Int>()
    private val requested = mutableSetOf<Int>()
    private var closed = false
    private val adapter get() = context.getSystemService(BluetoothManager::class.java)?.adapter
    private fun permitted() = Build.VERSION.SDK_INT < 31 ||
        context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { refresh(); changed() }
    }
    init {
        ContextCompat.registerReceiver(context, receiver, IntentFilter().apply {
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            addAction(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED)
            addAction(BluetoothHeadset.ACTION_CONNECTION_STATE_CHANGED)
        }, ContextCompat.RECEIVER_EXPORTED)
        refresh()
    }
    fun refresh() {
        if (closed || !permitted()) return
        val bluetooth = adapter ?: return
        for (id in listOf(BluetoothProfile.A2DP, BluetoothProfile.HEADSET)) {
            if (!requested.add(id)) continue
            val accepted = runCatching {
                bluetooth.getProfileProxy(context, object : BluetoothProfile.ServiceListener {
                    override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
                        if (closed) { bluetooth.closeProfileProxy(profile, proxy); return }
                        profiles[profile] = proxy; unavailable.remove(profile); changed()
                    }
                    override fun onServiceDisconnected(profile: Int) {
                        unavailable.add(profile); changed()
                    }
                }, id)
            }.getOrDefault(false)
            if (!accepted) requested.remove(id)
        }
    }
    fun state(iphoneAddress: String?): State {
        if (!permitted()) return State.UNKNOWN
        return runCatching {
            val bluetooth = adapter ?: return State.DISCONNECTED
            if (!bluetooth.isEnabled) return State.DISCONNECTED
            val available = profiles.filterKeys { it !in unavailable }
            evaluate(available.size, available.values.flatMap { it.connectedDevices }
                .map { Device(it.address, it.bluetoothClass?.deviceClass) }, iphoneAddress)
        }.getOrDefault(State.UNKNOWN)
    }
    fun selectedState(address: String?): State {
        if (address.isNullOrBlank()) return State.NOT_SELECTED
        if (!permitted()) return State.UNKNOWN
        return runCatching {
            val bluetooth = adapter ?: return State.UNKNOWN
            if (!bluetooth.isEnabled) return State.DISCONNECTED
            val available = profiles.filterKeys { it !in unavailable }
            val state = evaluateSelected(address, available.size, available.values.flatMap { it.connectedDevices }.map { it.address })
            if (state != State.CONNECTED) state else if (Build.VERSION.SDK_INT < 31) State.ROUTE_UNVERIFIED else {
                val routes = context.getSystemService(AudioManager::class.java)?.availableCommunicationDevices.orEmpty()
                    .filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }.map { it.address }
                if (routeMatches(address, routes)) State.CONNECTED else State.ROUTE_UNVERIFIED
            }
        }.getOrDefault(State.UNKNOWN)
    }
    data class Device(val address: String, val deviceClass: Int?)
    companion object {
        fun routeMatches(address: String, routes: List<String?>): Boolean =
            routes.any { !it.isNullOrBlank() && it.equals(address, true) }
        fun evaluateSelected(address: String?, profileCount: Int, connected: List<String>): State = when {
            address.isNullOrBlank() -> State.NOT_SELECTED
            connected.any { it.equals(address, true) } -> State.CONNECTED
            profileCount == 2 -> State.DISCONNECTED
            else -> State.UNKNOWN
        }
        fun evaluate(profileCount: Int, devices: List<Device>, iphoneAddress: String?): State {
            val audio = devices.filter { !it.address.equals(iphoneAddress, ignoreCase = true) }
            return when {
                audio.any { it.deviceClass == BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO } -> State.CONNECTED
                audio.isNotEmpty() -> State.VERIFY_AUDIO_DEVICE
                profileCount == 2 -> State.DISCONNECTED
                else -> State.UNKNOWN
            }
        }
    }
    override fun close() {
        closed = true
        runCatching { context.unregisterReceiver(receiver) }
        profiles.forEach { (id, proxy) -> runCatching { adapter?.closeProfileProxy(id, proxy) } }
        profiles.clear()
    }
}
