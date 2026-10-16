package com.shilapi.xcertplay.transport

import android.app.PendingIntent
import android.hardware.usb.UsbConfiguration
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.hardware.usb.UsbRequest
import com.shilapi.xcertplay.diagnostics.RawTraffic

internal fun UsbDeviceConnection.tracedControlTransfer(requestType: Int, request: Int, value: Int,
    index: Int, buffer: ByteArray?, length: Int, timeout: Int): Int {
    if (!RawTraffic.enabled) return controlTransfer(requestType, request, value, index, buffer, length, timeout)
    val channel = "usb/control/${System.identityHashCode(this)}/type=$requestType/request=$request/value=$value/index=$index/length=$length"
    RawTraffic.record("$channel/setup", "timeout=$timeout".toByteArray())
    if (requestType and 0x80 == 0 && buffer != null) RawTraffic.record("$channel/out/attempt", buffer, 0, length)
    try {
        val result = controlTransfer(requestType, request, value, index, buffer, length, timeout)
        if (result > 0 && buffer != null) RawTraffic.record("$channel/${if (requestType and 0x80 != 0) "in" else "out/written"}", buffer, 0, result)
        RawTraffic.record("$channel/result", "transferred=$result".toByteArray())
        return result
    } catch (error: RuntimeException) {
        RawTraffic.record("$channel/failure", error.toString().toByteArray())
        throw error
    }
}

internal fun UsbDeviceConnection.tracedBulkTransfer(endpoint: UsbEndpoint,
    buffer: ByteArray, length: Int, timeout: Int): Int {
    if (!RawTraffic.enabled) return bulkTransfer(endpoint, buffer, length, timeout)
    val channel = "usb/bulk/${System.identityHashCode(this)}/endpoint=${endpoint.address}"
    RawTraffic.record("$channel/setup", "requested=$length timeout=$timeout direction=${endpoint.direction}".toByteArray())
    if (endpoint.direction == 0) RawTraffic.record("$channel/out/attempt", buffer, 0, length)
    try {
        val result = bulkTransfer(endpoint, buffer, length, timeout)
        if (result > 0) RawTraffic.record("$channel/${if (endpoint.direction == 0) "out/written" else "in"}", buffer, 0, result)
        RawTraffic.record("$channel/result", "transferred=$result requested=$length timeout=$timeout".toByteArray())
        return result
    } catch (error: RuntimeException) {
        RawTraffic.record("$channel/failure", error.toString().toByteArray())
        throw error
    }
}

/** One connection ID joins setup, raw transfers and teardown in the Debug archive. */
internal fun <T> traceUsbOperation(owner: Any, operation: String, details: String = "", action: () -> T): T {
    if (!RawTraffic.enabled) return action()
    val channel = "usb/lifecycle/${System.identityHashCode(owner)}/$operation"
    RawTraffic.record("$channel/start", details.ifEmpty { "begin" }.toByteArray())
    try {
        val result = action()
        RawTraffic.record("$channel/result", "result=$result".toByteArray())
        return result
    } catch (error: Exception) {
        RawTraffic.record("$channel/failure", error.toString().toByteArray())
        throw error
    }
}

internal fun UsbManager.tracedOpenDevice(device: UsbDevice): UsbDeviceConnection? =
    traceUsbOperation(this, "open", "device=${device.deviceName} vendor=${device.vendorId} product=${device.productId} configurations=${device.configurationCount}") {
        openDevice(device).also { connection ->
            if (connection != null && RawTraffic.enabled) {
                val channel = "usb/lifecycle/${System.identityHashCode(connection)}"
                RawTraffic.record("$channel/device", "manager=${System.identityHashCode(this)} device=$device".toByteArray())
                runCatching { connection.rawDescriptors }.onSuccess { descriptors ->
                    if (descriptors != null) RawTraffic.record("$channel/descriptors", descriptors)
                    else RawTraffic.record("$channel/descriptors/unavailable", "null".toByteArray())
                }.onFailure { RawTraffic.record("$channel/descriptors/failure", it.toString().toByteArray()) }
            }
        }
    }

internal fun UsbDeviceConnection.tracedClaimInterface(usbInterface: UsbInterface, force: Boolean): Boolean =
    traceUsbOperation(this, "claim", "interface=$usbInterface force=$force") { claimInterface(usbInterface, force) }
internal fun UsbDeviceConnection.tracedReleaseInterface(usbInterface: UsbInterface): Boolean =
    traceUsbOperation(this, "release", "interface=${usbInterface.id}") { releaseInterface(usbInterface) }
internal fun UsbDeviceConnection.tracedSetConfiguration(configuration: UsbConfiguration): Boolean =
    traceUsbOperation(this, "configuration", "configuration=${configuration.id}") { setConfiguration(configuration) }
internal fun UsbDeviceConnection.tracedSetInterface(usbInterface: UsbInterface): Boolean =
    traceUsbOperation(this, "alternate", "interface=${usbInterface.id} alternate=${usbInterface.alternateSetting}") { setInterface(usbInterface) }
internal fun UsbDeviceConnection.tracedClose() = traceUsbOperation(this, "close") { close() }
internal fun UsbRequest.tracedInitialize(connection: UsbDeviceConnection, endpoint: UsbEndpoint): Boolean =
    traceUsbOperation(connection, "initialize", "request=${System.identityHashCode(this)} endpoint=${endpoint.address} type=${endpoint.type} maxPacket=${endpoint.maxPacketSize}") { initialize(connection, endpoint) }
internal fun UsbRequest.tracedCancel(): Boolean = traceUsbOperation(this, "cancel") { cancel() }
internal fun UsbRequest.tracedClose() = traceUsbOperation(this, "request-close") { close() }
internal fun UsbManager.tracedHasPermission(device: UsbDevice): Boolean =
    traceUsbOperation(this, "permission-check", "device=${device.deviceName}") { hasPermission(device) }
internal fun UsbManager.tracedRequestPermission(device: UsbDevice, intent: PendingIntent) =
    traceUsbOperation(this, "permission-request", "device=${device.deviceName}") { requestPermission(device, intent) }

internal fun traceUsbDeviceEvent(intent: android.content.Intent, device: UsbDevice) {
    if (!RawTraffic.enabled) return
    RawTraffic.record("usb/device-event",
        "action=${intent.action} device=$device granted=${intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)}".toByteArray())
}
