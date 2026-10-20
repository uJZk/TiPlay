package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.net.SocketException
import java.net.SocketTimeoutException

class AirPlayResourceDiagnosticsTest {
    private val active = { AirPlayResourceDiagnostics.TransferOwner.ACTIVE }
    private fun transfer(diagnostics: AirPlayResourceDiagnostics, resource: AirPlayVideoProxy.Resource,
                         output: ByteArrayOutputStream,
                         owner: () -> AirPlayResourceDiagnostics.TransferOwner = active) =
        diagnostics.transfer(resource, output, ByteArray(0), 7, 2, 3, 4, owner) { 1_000_000 }

    @Test fun timingSeparatesOpenFromTransferAndWholeHandlerWithoutClaimingFcupHeaderTiming() {
        val messages = mutableListOf<String>(); var now = 10_000_000L
        val input = object : ByteArrayInputStream(byteArrayOf(1, 2, 3)) {
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                now += 2_000_000; return super.read(bytes, offset, length)
            }
            override fun close() { now += 1_000_000 }
        }
        val output = object : ByteArrayOutputStream() {
            override fun write(bytes: ByteArray, offset: Int, length: Int) {
                now += if (length == 1) 1_000_000 else 3_000_000
                super.write(bytes, offset, length)
            }
        }
        val resource = AirPlayVideoProxy.Resource(200, "video/mp4", emptyList(), input).also {
            it.reference = AirPlayVideoProxy.Reference(5, AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP,
                responseMillis = 7)
        }
        AirPlayResourceDiagnostics(messages::add) { true }.transfer(resource, output, byteArrayOf(0),
            1, 2, 3, 4, active, timing = AirPlayResourceDiagnostics.Timing(0, 7), nowNanos = { now })
        val timing = messages.single { it.contains("stage=TRANSFER_TIMING ") }
        assertTrue(timing.contains("scope=handler openMs=7 headersMs=UNKNOWN responseMs=7 requestMs=19 transferMs=9"))
        assertEquals(3, messages.size)
    }

    @Test fun preStreamRefusalsUseBoundedKnownReasonsAndReportSuppressedCounts() {
        val messages = mutableListOf<String>(); val diagnostics = AirPlayResourceDiagnostics(messages::add) { false }
        val reason = AirPlayResourceDiagnostics.RefusalReason.RESOURCE_TOKEN
        repeat(100) { diagnostics.refusal(it.toLong(), null, 401, reason, it.toLong()) }
        assertEquals(1, messages.size)
        assertTrue(messages.single().contains("id=UNKNOWN status=401 reason=resource-token total=1 suppressed=0"))
        diagnostics.refusal(101, 2, 401, reason, 5_000)
        assertEquals(2, messages.size)
        assertTrue(messages.last().contains("total=101 suppressed=99"))
        diagnostics.refusal(102, 3, 404, AirPlayResourceDiagnostics.RefusalReason.PLAYBACK_NOT_FOUND, 5_001)
        assertEquals(3, messages.size)
        assertTrue(messages.last().contains("status=404 reason=playback-not-found"))
    }

    @Test fun anOpenFailureConnectsRequestToLoadWithoutCopyingExceptionMessages() {
        val messages = mutableListOf<String>(); val diagnostics = AirPlayResourceDiagnostics(messages::add) { false }
        val error = AirPlayVideoProxy.Failure(AirPlayVideoProxy.FailureReason.RESOURCE_IO,
            route = AirPlayVideoProxy.ResourceRoute.ANDROID_HTTP, load = 9).apply {
            initCause(SocketTimeoutException("https://private-host/media?token=secret"))
        }
        diagnostics.openFailure(7, 2, 3, error, 5_000, 5_001)
        assertTrue(messages.single().contains("stage=OPEN_END request=7 load=9 route=ANDROID_HTTP id=2 resource=3"))
        assertTrue(messages.single().contains("phase=open reason=resource-io failed=true"))
        assertTrue(messages.single().contains("openMs=5000 requestMs=5001 exception=Failure cause=SocketTimeoutException"))
        assertFalse(messages.single().contains("private")); assertFalse(messages.single().contains("secret"))
        assertTrue(messages.single().length < 600)
    }

    @Test fun aCompletedTransferHasOneTerminalWithItsLoadAndActualBodyCounts() {
        val messages = mutableListOf<String>(); val output = ByteArrayOutputStream(); var closes = 0
        val resource = AirPlayVideoProxy.Resource(206, "video/mp4", listOf("Content-Length" to "3"),
            ByteArrayInputStream(byteArrayOf(1, 2, 3))) { closes++ }.also {
            it.reference = AirPlayVideoProxy.Reference(5, AirPlayVideoProxy.ResourceRoute.ANDROID_HTTP)
        }
        transfer(AirPlayResourceDiagnostics(messages::add) { true }, resource, output)
        resource.close()
        assertEquals(1, closes)
        assertArrayEquals(byteArrayOf(1, 2, 3), output.toByteArray())
        assertEquals(3, messages.size)
        assertTrue(messages.all { it.length < 600 })
        assertEquals(1, messages.count { it.contains("stage=TRANSFER_END ") })
        assertTrue(messages.joinToString(" ").contains("request=7 load=5 id=2 route=ANDROID_HTTP resource=3 revision=4"))
        assertTrue(messages.joinToString(" ").contains("reason=eof status=206 owner=ACTIVE eof=true"))
        assertTrue(messages.joinToString(" ").contains("cancel=NOT_OBSERVED exception=NONE closeException=NONE"))
    }

    @Test fun aHealthyEofIsDebugOnlyAndDoesNotFloodStandardWithEverySmallRange() {
        val messages = mutableListOf<String>(); val output = ByteArrayOutputStream(); var closed = false
        val resource = AirPlayVideoProxy.Resource(206, "video/mp4", listOf("Content-Length" to "3"),
            ByteArrayInputStream(byteArrayOf(1, 2, 3))) { closed = true }
        transfer(AirPlayResourceDiagnostics(messages::add) { false }, resource, output)
        assertTrue(messages.isEmpty()); assertTrue(closed)
        assertArrayEquals(byteArrayOf(1, 2, 3), output.toByteArray())
    }

    @Test fun aMidBodyReadFailureSurvivesBothBodyCloseAndConnectionCleanupFailures() {
        val messages = mutableListOf<String>(); val output = ByteArrayOutputStream()
        val readFailure = SocketTimeoutException("https://private-host/media?token=secret")
        val closeFailure = IOException("private-close")
        val cleanupFailure = IOException("private-cleanup")
        var read = false; var closes = 0; var cleanups = 0
        val body = object : InputStream() {
            override fun read(): Int = throw UnsupportedOperationException()
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                if (read) throw readFailure
                read = true; byteArrayOf(1, 2, 3).copyInto(bytes, offset); return 3
            }
            override fun close() { closes++; throw closeFailure }
        }
        val resource = AirPlayVideoProxy.Resource(200, "video/mp4", emptyList(), body) {
            cleanups++; throw cleanupFailure
        }
        val thrown = runCatching { transfer(AirPlayResourceDiagnostics(messages::add), resource, output) }.exceptionOrNull()
        assertSame(readFailure, thrown)
        assertSame(closeFailure, thrown!!.suppressed.single())
        assertSame(cleanupFailure, closeFailure.suppressed.single())
        assertEquals(1, closes); assertEquals(1, cleanups)
        resource.close()
        assertEquals(1, closes); assertEquals(1, cleanups)
        assertEquals(3, messages.size)
        assertTrue(messages.joinToString(" ").contains("phase=read reason=read-error"))
        assertTrue(messages.joinToString(" ").contains("readBytes=3 writtenBytes=3 writeUnknownBytes=0"))
        assertTrue(messages.joinToString(" ").contains("exception=SocketTimeoutException closeException=IOException"))
        assertFalse(messages.joinToString(" ").contains("private")); assertFalse(messages.joinToString(" ").contains("secret"))
    }

    @Test fun anEarlyEofIsDistinctFromSuccessfullyDeliveringTheDeclaredLength() {
        val messages = mutableListOf<String>(); val output = ByteArrayOutputStream()
        val resource = AirPlayVideoProxy.Resource(200, "video/mp4", listOf("Content-Length" to "5"),
            ByteArrayInputStream(byteArrayOf(1, 2)))
        val thrown = runCatching { transfer(AirPlayResourceDiagnostics(messages::add), resource, output) }.exceptionOrNull()
        assertTrue(thrown is EOFException)
        assertEquals(3, messages.size)
        assertTrue(messages.joinToString(" ").contains("phase=read reason=short-eof"))
        assertTrue(messages.joinToString(" ").contains("expectedBytes=5 readBytes=2 writtenBytes=2"))
    }

    @Test fun aPartiallyAcceptedFailedWriteDoesNotClaimRemoteConsumptionOrUserCancellation() {
        val messages = mutableListOf<String>(); var next = 0
        val writeFailure = SocketException("private-host token=secret")
        val body = object : InputStream() {
            override fun read(): Int = throw UnsupportedOperationException()
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                val size = when (next++) { 0 -> 3; 1 -> 4; else -> return -1 }
                repeat(size) { bytes[offset + it] = 42 }; return size
            }
        }
        val output = object : ByteArrayOutputStream() {
            override fun write(bytes: ByteArray, offset: Int, length: Int) {
                if (length == 4) { super.write(bytes, offset, 2); throw writeFailure }
                super.write(bytes, offset, length)
            }
        }
        val resource = AirPlayVideoProxy.Resource(200, "video/mp4", emptyList(), body)
        assertSame(writeFailure, runCatching {
            transfer(AirPlayResourceDiagnostics(messages::add), resource, output)
        }.exceptionOrNull())
        assertEquals(5, output.size()) // The stream accepted a partial write before throwing.
        assertEquals(3, messages.size)
        assertTrue(messages.joinToString(" ").contains("phase=write reason=write-error"))
        assertTrue(messages.joinToString(" ").contains("readBytes=7 writtenBytes=3 writeUnknownBytes=4 writeAccounting=completed-calls"))
        assertTrue(messages.joinToString(" ").contains("cancel=UNKNOWN exception=SocketException"))
        assertFalse(messages.joinToString(" ").contains("private")); assertFalse(messages.joinToString(" ").contains("secret"))
    }

    @Test fun retiringWhileTheReadWasBlockedClosesTheResourceBeforeWritingStaleBytes() {
        val messages = mutableListOf<String>(); val output = ByteArrayOutputStream(); var retired = false; var closes = 0
        val body = object : ByteArrayInputStream(byteArrayOf(1, 2, 3)) {
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                retired = true; return super.read(bytes, offset, length)
            }
            override fun close() { closes++ }
        }
        transfer(AirPlayResourceDiagnostics(messages::add), AirPlayVideoProxy.Resource(200, "video/mp4", emptyList(), body), output,
            owner = { if (retired) AirPlayResourceDiagnostics.TransferOwner.PLAYBACK_RETIRED else active() })
        assertEquals(0, output.size()); assertEquals(1, closes)
        assertEquals(3, messages.size)
        assertTrue(messages.joinToString(" ").contains("phase=owner reason=retired"))
        assertTrue(messages.joinToString(" ").contains("owner=PLAYBACK_RETIRED eof=false"))
        assertTrue(messages.joinToString(" ").contains("readBytes=3 writtenBytes=0"))
    }

    @Test fun interruptionIsOnlyCalledCancellationWhenItIsObservedAndLoggingCannotBreakCleanup() {
        val messages = mutableListOf<String>(); var closes = 0
        val resource = AirPlayVideoProxy.Resource(200, "video/mp4", emptyList(), ByteArrayInputStream(byteArrayOf(1))) { closes++ }
        Thread.currentThread().interrupt()
        try { transfer(AirPlayResourceDiagnostics(messages::add), resource, ByteArrayOutputStream()) }
        finally { Thread.interrupted() }
        assertEquals(1, closes)
        assertTrue(messages.joinToString(" ").contains("reason=cancelled"))
        assertTrue(messages.joinToString(" ").contains("cancel=THREAD_INTERRUPTED exception=NONE"))
        val output = ByteArrayOutputStream()
        transfer(AirPlayResourceDiagnostics({ error("logger unavailable") }) { true },
            AirPlayVideoProxy.Resource(200, "video/mp4", emptyList(), ByteArrayInputStream(byteArrayOf(2))) { closes++ }, output)
        assertEquals(2, closes); assertArrayEquals(byteArrayOf(2), output.toByteArray())
    }

    @Test fun networkFailuresRecordBoundedCauseClassesWithoutPrivateMessages() {
        val messages = mutableListOf<String>()
        val diagnostics = AirPlayResourceDiagnostics(messages::add) { false }
        val failure = AirPlayVideoProxy.Failure(AirPlayVideoProxy.FailureReason.RESOURCE_IO,
            route = AirPlayVideoProxy.ResourceRoute.ANDROID_HTTP)
        val secret = "https://private-host/media?token=private-secret\r\nforged log entry"
        for (cause in listOf(java.net.UnknownHostException(secret), java.net.SocketTimeoutException(secret),
            javax.net.ssl.SSLHandshakeException(secret))) {
            diagnostics.failure(1, failure, cause)
            assertTrue(messages.last().contains("reason=resource-io exception=${cause.javaClass.simpleName}"))
            assertTrue(messages.last().endsWith("causes=${cause.javaClass.simpleName}"))
        }
        val nested = java.net.UnknownHostException(secret).apply { initCause(IllegalStateException(secret)) }
        diagnostics.failure(2, failure, java.io.IOException(secret, nested))
        assertTrue(messages.last().contains("reason=resource-io exception=IOException cause=UnknownHostException"))
        assertTrue(messages.last().contains("causes=IOException<-UnknownHostException<-IllegalStateException"))
        diagnostics.failure(3, failure, object : java.io.IOException(secret) {})
        assertTrue(messages.last().contains("reason=resource-io exception=Other"))
        assertTrue(messages.last().endsWith("causes=OTHER"))
        assertTrue(messages.all { it.contains("reason=resource-io") && it.length < 256 })
        assertFalse(messages.joinToString().contains("private-host"))
        assertFalse(messages.joinToString().contains("private-secret"))
        assertFalse(messages.joinToString().contains("forged"))
        assertFalse(messages.any { it.contains('\r') || it.contains('\n') })
    }

    @Test fun debugMetadataCanSwitchImmediatelyAndRecoversTheCdnDenialWithoutLeakingCredentials() {
        var debug = false
        val messages = mutableListOf<String>()
        val diagnostics = AirPlayResourceDiagnostics(messages::add) { debug }
        val route = AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP
        val denial = "存在nbs参数 token=private-secret https://private-host/media?upsig=private-secret"
        val headers = mapOf("Deny-Reason" to denial.toByteArray(Charsets.UTF_8).toString(Charsets.ISO_8859_1))
        diagnostics.request(1, route, "bytes=1523-1525", 0)
        diagnostics.response(1, route, 403, 150, headers)
        diagnostics.failure(1, AirPlayVideoProxy.Failure(AirPlayVideoProxy.FailureReason.UPSTREAM_FORBIDDEN, 403, route))
        assertEquals(listOf("resource stage=FAILURE load=1 route=IPHONE_FCUP status=403 reason=upstream-forbidden"), messages)
        debug = true
        diagnostics.request(2, route, "bytes=1523-1525", 1)
        diagnostics.response(2, route, 403, 150, headers)
        assertTrue(messages[1].contains("range=bytes=1523-1525 redirects=1 detail=DEBUG"))
        assertTrue(messages[2].contains("status=403 bodyBytes=150"))
        assertTrue(messages[2].contains("phase=headers-ready delivery=unproven"))
        assertTrue(messages[2].contains("存在nbs参数"))
        assertFalse(messages.joinToString().contains("private-secret"))
        assertFalse(messages.joinToString().contains("private-host"))
        debug = false
        diagnostics.request(3, route, null, 0)
        diagnostics.response(3, route, 200, 3, emptyMap())
        assertEquals(3, messages.size)
    }

    @Test fun hostileHeadersAndUnavailableDiagnosticSinkDoNotChangePlaybackExecution() {
        val messages = mutableListOf<String>()
        val diagnostics = AirPlayResourceDiagnostics(messages::add) { true }
        diagnostics.response(1, AirPlayVideoProxy.ResourceRoute.ANDROID_HTTP, 403, null,
            mapOf("Deny-Reason" to "denied\r\nforged log entry", "Content-Range" to "bytes 1-3/5\r\nCookie: secret"))
        assertFalse(messages.single().contains('\r'))
        assertFalse(messages.single().contains('\n'))
        assertFalse(messages.single().contains("Cookie"))
        assertTrue(messages.single().contains("contentRange=NONE"))
        AirPlayResourceDiagnostics({ error("unavailable") }) { true }
            .request(1, AirPlayVideoProxy.ResourceRoute.IPHONE_FCUP, null, 0)
    }
}
