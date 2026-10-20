package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class AirPlayResourceDiagnosticsTest {
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
