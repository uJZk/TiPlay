package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Standard errors use a bounded vocabulary; Debug adds resource metadata without URL credentials. */
internal class AirPlayResourceDiagnostics(private val log: (String) -> Unit,
                                          private val debug: () -> Boolean = { RawTraffic.enabled }) {
    fun request(load: Long, route: AirPlayVideoProxy.ResourceRoute, range: String?, redirects: Int) {
        if (debug()) emit("resource stage=LOAD load=$load route=$route range=${range ?: "NONE"} redirects=$redirects detail=DEBUG")
    }

    fun response(load: Long, route: AirPlayVideoProxy.ResourceRoute, status: Int?, bytes: Int?,
                 headers: Map<String, String>) {
        if (!debug()) return
        val deny = headers["Deny-Reason"]?.let(::denyReason).orEmpty()
        val contentRange = headers["Content-Range"]?.takeIf { SAFE_CONTENT_RANGE.matches(it) } ?: "NONE"
        emit("resource stage=LOADED load=$load route=$route status=${status ?: "ABSENT"}" +
            " bodyBytes=${bytes ?: "STREAM"} contentRange=$contentRange" +
            (if (deny.isEmpty()) "" else " denyReason=\"$deny\"") + " detail=DEBUG")
    }

    fun failure(load: Long, error: AirPlayVideoProxy.Failure, cause: IOException? = null) {
        val detail = cause?.let {
            " exception=${exceptionType(it)}" + (it.cause?.let { nested -> " cause=${exceptionType(nested)}" } ?: "")
        }.orEmpty()
        emit("resource stage=FAILURE load=$load route=${error.route ?: "NONE"} status=${error.status ?: "ABSENT"} reason=${error.reason.wire}$detail")
    }

    /** Class names only: network exception messages often contain private hosts and signed URLs. */
    private fun exceptionType(error: Throwable): String = error.javaClass.simpleName
        .takeIf { SAFE_EXCEPTION_TYPE.matches(it) } ?: "Other"

    private fun emit(message: String) { runCatching { log(message) } }

    private fun denyReason(value: String): String {
        val recovered = if (value.any { it.code > 127 } && value.all { it.code <= 255 }) runCatching {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(value.toByteArray(Charsets.ISO_8859_1))).toString()
        }.getOrDefault(value) else value
        return DiagnosticErrorText.sanitize(recovered).replace('"', '\'')
    }

    companion object {
        private val SAFE_EXCEPTION_TYPE = Regex("[A-Za-z_][A-Za-z0-9_]{0,63}")
        private val SAFE_CONTENT_RANGE = Regex("bytes (?:[0-9]{1,18}-[0-9]{1,18}/(?:[0-9]{1,18}|\\*)|\\*/[0-9]{1,18})")
    }
}
