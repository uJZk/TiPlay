package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.IOException
import java.io.EOFException
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** Standard errors use a bounded vocabulary; Debug adds resource metadata without URL credentials. */
internal class AirPlayResourceDiagnostics(private val log: (String) -> Unit,
                                          private val debug: () -> Boolean = { RawTraffic.enabled }) {
    fun request(load: Long, route: AirPlayVideoProxy.ResourceRoute, range: String?, redirects: Int) {
        if (debug()) emit("resource stage=LOAD load=$load route=$route range=${range ?: "NONE"} redirects=$redirects detail=DEBUG")
    }

    fun response(load: Long, route: AirPlayVideoProxy.ResourceRoute, status: Int?, bytes: Int?,
                 headers: Map<String, String>, headersMillis: Long? = null, responseMillis: Long? = null) {
        if (!debug()) return
        val deny = headers["Deny-Reason"]?.let(::denyReason).orEmpty()
        val contentRange = headers["Content-Range"]?.takeIf { SAFE_CONTENT_RANGE.matches(it) } ?: "NONE"
        emit("resource stage=LOADED load=$load route=$route status=${status ?: "ABSENT"}" +
            " bodyBytes=${bytes ?: "STREAM"} contentRange=$contentRange" +
            (if (deny.isEmpty()) "" else " denyReason=\"$deny\"") +
            " phase=headers-ready delivery=unproven headersMs=${headersMillis ?: "UNKNOWN"}" +
            " responseMs=${responseMillis ?: "UNKNOWN"} detail=DEBUG")
    }

    enum class TransferOwner { ACTIVE, SERVER_STOPPED, BROWSER_RETIRED, PLAYBACK_RETIRED }
    data class Timing(val requestStartedNanos: Long, val openMillis: Long)
    enum class RefusalReason(val wire: String) {
        BAD_SESSION("bad-session"), BAD_ID("bad-id"), BAD_RESOURCE("bad-resource"),
        RESOURCE_TOKEN("resource-token"), PAIRING("pairing"), THROTTLED("throttled"), REPLACED("replaced"),
        PLAYBACK_NOT_FOUND("playback-not-found"), RESOURCE_NOT_FOUND("resource-not-found"),
    }
    private class Refusals(var total: Long = 0, var suppressed: Long = 0, var lastMillis: Long? = null)
    private val refusals = java.util.EnumMap<RefusalReason, Refusals>(RefusalReason::class.java)

    /** Bounded keys, independent of untrusted IDs, tokens and URLs; repeated denials cannot flood reports. */
    @Synchronized fun refusal(request: Long, id: Long?, status: Int, reason: RefusalReason,
                              nowMillis: Long = System.nanoTime() / 1_000_000) {
        val count = refusals.getOrPut(reason) { Refusals() }
        count.total++
        if (count.lastMillis?.let { nowMillis - it < 5_000 } == true) { count.suppressed++; return }
        emit("resource stage=REFUSED request=$request id=${id?.takeIf { it >= 0 } ?: "UNKNOWN"} " +
            "status=$status reason=${reason.wire} total=${count.total} suppressed=${count.suppressed}")
        count.lastMillis = nowMillis; count.suppressed = 0
    }

    fun opened(request: Long, id: Long, resourceId: Long?, reference: AirPlayVideoProxy.Reference?,
               status: Int, openMillis: Long, requestMillis: Long) {
        if (!debug()) return
        emit("resource stage=OPEN_END request=$request load=${reference?.load ?: 0} " +
            "route=${reference?.route ?: "NONE"} id=$id resource=${resourceId ?: "NONE"} status=$status " +
            "phase=headers-ready delivery=unproven openMs=$openMillis requestMs=$requestMillis " +
            "headersMs=${reference?.headersMillis ?: "UNKNOWN"} responseMs=${reference?.responseMillis ?: "UNKNOWN"}")
    }

    fun openFailure(request: Long, id: Long, resourceId: Long?, error: Exception,
                    openMillis: Long, requestMillis: Long) {
        val typed = error as? AirPlayVideoProxy.Failure
        emit("resource stage=OPEN_END request=$request load=${typed?.load ?: 0} " +
            "route=${typed?.route ?: "NONE"} id=$id resource=${resourceId ?: "NONE"} status=502 " +
            "phase=open reason=${typed?.reason?.wire ?: "resource-io"} failed=true " +
            "upstreamStatus=${typed?.status ?: "UNKNOWN"} openMs=$openMillis requestMs=$requestMillis " +
            "exception=${exceptionType(error)} cause=${error.cause?.let(::exceptionType) ?: "NONE"}")
    }

    /** The output API cannot report how many bytes a failed write accepted. Only completed writes count. */
    fun transfer(resource: AirPlayVideoProxy.Resource, output: OutputStream, headers: ByteArray,
                 request: Long, playbackId: Long, resourceId: Long?, revision: Long?,
                 owner: () -> TransferOwner, timing: Timing? = null, nowNanos: () -> Long = System::nanoTime) {
        val started = nowNanos()
        val reference = resource.reference
        val expected = resource.headers.firstOrNull { it.first.equals("Content-Length", true) }
            ?.second?.toLongOrNull()?.takeIf { it >= 0 }
        var readBytes = 0L
        var writtenBytes = 0L
        var writeUnknownBytes = 0
        var phase = "headers"
        var reason = "unknown"
        var eof = false
        var ownership = TransferOwner.ACTIVE
        var cancellation = "NOT_OBSERVED"
        var failure: Throwable? = null
        var closeFailure: Throwable? = null
        try {
            output.write(headers)
            val buffer = ByteArray(32 * 1024)
            while (true) {
                phase = "owner"
                ownership = owner()
                if (Thread.currentThread().isInterrupted) {
                    cancellation = "THREAD_INTERRUPTED"; reason = "cancelled"; break
                }
                if (ownership != TransferOwner.ACTIVE) { reason = "retired"; break }
                phase = "read"
                val count = resource.body.read(buffer)
                if (count < 0) {
                    eof = true
                    if (expected != null && readBytes < expected) {
                        reason = "short-eof"
                        throw EOFException("AirPlay resource ended before its declared length")
                    }
                    reason = "eof"; break
                }
                readBytes += count
                phase = "owner"
                ownership = owner()
                if (ownership != TransferOwner.ACTIVE) { reason = "retired"; break }
                if (Thread.currentThread().isInterrupted) {
                    cancellation = "THREAD_INTERRUPTED"; reason = "cancelled"; break
                }
                phase = "write"
                writeUnknownBytes = count
                output.write(buffer, 0, count)
                writtenBytes += count
                writeUnknownBytes = 0
            }
        } catch (error: Throwable) {
            failure = error
            runCatching(owner).getOrNull()?.let { ownership = it }
            if (reason != "short-eof") reason = when (phase) {
                "headers" -> "headers-write-error"
                "read" -> "read-error"
                "write" -> "write-error"
                else -> "owner-error"
            }
            // A socket exception cannot establish that the user cancelled playback.
            cancellation = if (Thread.currentThread().isInterrupted) "THREAD_INTERRUPTED" else "UNKNOWN"
        } finally {
            try { resource.close() } catch (error: Throwable) {
                closeFailure = error
                val primary = failure
                if (primary == null) { failure = error; phase = "close"; reason = "close-error" }
                else if (primary !== error) primary.addSuppressed(error)
            }
            // Debug has one terminal per transfer. Standard keeps faults and lifecycle boundaries;
            // successful 256 KiB ranges would otherwise dominate ordinary reports.
            if (reason != "eof" || failure != null || resource.status !in 200..299 || debug()) {
                val finished = nowNanos()
                val context = "request=$request load=${reference?.load ?: 0} id=$playbackId"
                emit("resource stage=TRANSFER_END $context " +
                "route=${reference?.route ?: "NONE"} resource=${resourceId ?: "NONE"} " +
                "revision=${revision ?: "NONE"} phase=$phase reason=$reason status=${resource.status} " +
                "owner=$ownership eof=$eof cancel=$cancellation " +
                "exception=${failure?.let(::exceptionType) ?: "NONE"} " +
                "closeException=${closeFailure?.let(::exceptionType) ?: "NONE"}")
                emit("resource stage=TRANSFER_BYTES $context expectedBytes=${expected ?: "UNKNOWN"} " +
                    "readBytes=$readBytes writtenBytes=$writtenBytes writeUnknownBytes=$writeUnknownBytes " +
                    "writeAccounting=completed-calls remoteDelivery=unproven")
                emit("resource stage=TRANSFER_TIMING $context scope=handler openMs=${timing?.openMillis ?: "UNKNOWN"} " +
                    "headersMs=${reference?.headersMillis ?: "UNKNOWN"} responseMs=${reference?.responseMillis ?: "UNKNOWN"} " +
                    "requestMs=${timing?.let { ((finished - it.requestStartedNanos) / 1_000_000).coerceAtLeast(0) } ?: "UNKNOWN"} " +
                    "transferMs=${((finished - started) / 1_000_000).coerceAtLeast(0)}")
            }
        }
        failure?.let { throw it }
    }

    fun failure(load: Long, error: AirPlayVideoProxy.Failure, cause: IOException? = null) {
        val detail = cause?.let {
            " exception=${exceptionType(it)}" +
                (runCatching { it.cause }.getOrNull()?.let { nested -> " cause=${exceptionType(nested)}" } ?: "") +
                " causes=${DiagnosticErrorText.types(it)}"
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
