package com.shilapi.xcertplay.transport

import android.hardware.usb.UsbDeviceConnection
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

internal fun UsbDeviceConnection.tracedBulkTransfer(endpoint: android.hardware.usb.UsbEndpoint,
    buffer: ByteArray, length: Int, timeout: Int): Int {
    if (!RawTraffic.enabled) return bulkTransfer(endpoint, buffer, length, timeout)
    val channel = "usb/bulk/${System.identityHashCode(this)}/endpoint=${endpoint.address}"
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
