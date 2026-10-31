package com.shilapi.xcertplay.transport

import java.io.ByteArrayInputStream
import java.io.IOException
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class LockdownServiceOwnershipTest {
    private fun plist(body: String): ByteArray {
        val data = "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict>$body</dict></plist>".toByteArray()
        return byteArrayOf((data.size ushr 24).toByte(), (data.size ushr 16).toByte(),
            (data.size ushr 8).toByte(), data.size.toByte()) + data
    }
    private class Stream(bytes: ByteArray = byteArrayOf(), val owner: Stream? = null) : BlockingDuplexByteStream {
        val input = ByteArrayInputStream(bytes)
        var closes = 0
        override fun send(data: ByteArray) = Unit
        override fun recv(maxBytes: Int, timeoutMillis: Long): ByteArray {
            val bytes = ByteArray(minOf(maxBytes, input.available()))
            if (bytes.isNotEmpty()) input.read(bytes)
            return bytes
        }
        override fun close() { closes++; owner?.close() }
    }
    private fun record() = LockdownPairRecord.restore("host", "buid", "02:00:00:00:00:01",
        byteArrayOf(1), byteArrayOf(1), byteArrayOf(1), byteArrayOf(1), byteArrayOf(1), byteArrayOf(1))

    @Test fun serviceResponseFailuresReleaseTheAlreadyEstablishedLockdownSession() {
        for (body in listOf("<key>Error</key><string>ServiceUnavailable</string>",
            "<key>Port</key><integer>-1</integer>", "")) {
            val raw = Stream(plist("<key>EnableSessionSSL</key><true/>"))
            val secure = Stream(plist(body), raw)
            val client = LockdownCarKitClient({ _, _ -> raw }, { _, _, _ -> secure })
            assertThrows(IphoneUsbException::class.java) { client.openService(record(), "test", "service") }
            assertEquals(1, secure.closes)
            assertEquals(1, raw.closes)
        }
    }

    @Test fun failedServiceConnectPreservesItsExceptionAndClosesLockdown() {
        val raw = Stream(plist("<key>EnableSessionSSL</key><true/>"))
        val secure = Stream(plist("<key>Port</key><integer>1234</integer>"), raw)
        val failure = IOException("connection failed")
        val client = LockdownCarKitClient({ port, _ ->
            if (port == Iap2UsbMuxHost.LOCKDOWN_PORT) raw else throw failure
        }, { _, _, _ -> secure })
        assertSame(failure, assertThrows(IOException::class.java) { client.openService(record(), "test", "service") })
        assertEquals(1, secure.closes)
        assertEquals(1, raw.closes)
    }

    @Test fun successTransfersBothOwnersAndClosesEachExactlyOnce() {
        val raw = Stream(plist("<key>EnableSessionSSL</key><true/>"))
        val secure = Stream(plist("<key>Port</key><integer>1234</integer>"), raw)
        val service = Stream()
        val client = LockdownCarKitClient({ port, _ ->
            if (port == Iap2UsbMuxHost.LOCKDOWN_PORT) raw else service
        }, { _, _, _ -> secure })
        val stream = client.openService(record(), "test", "service")
        assertEquals(0, secure.closes)
        assertEquals(0, service.closes)
        stream.close(); stream.close()
        assertEquals(1, service.closes)
        assertEquals(1, secure.closes)
        assertEquals(1, raw.closes)
    }
}
