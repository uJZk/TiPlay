package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.airplay.VideoInCar
import com.shilapi.xcertplay.receiver.ReceiverResource
import com.shilapi.xcertplay.receiver.ReceiverResourceHeaders
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.ByteArrayInputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Session-scoped streaming proxy. The browser never supplies an upstream URL or sees app URLs. */
class AirPlayVideoProxy(private val root: String, private val iphone: (String, String?) -> ReceiverResource?,
                       private val iphoneHost: String? = null, log: (String) -> Unit = {}) : Closeable {
    enum class ResourceRoute { ANDROID_HTTP, IPHONE_FCUP }
    enum class FailureReason(val wire: String) {
        UPSTREAM_FORBIDDEN("upstream-forbidden"), UPSTREAM_UNAUTHORIZED("upstream-unauthorized"),
        UPSTREAM_HTTP_ERROR("upstream-http-error"), INVALID_RANGE_RESPONSE("invalid-range-response"),
        RESOURCE_UNAVAILABLE("resource-unavailable"), RESOURCE_IO("resource-io"),
        RESOURCE_TOO_LARGE("resource-too-large"), REDIRECT_LIMIT("redirect-limit"),
        UNSUPPORTED_RESOURCE("unsupported-resource"),
    }
    class Failure(val reason: FailureReason, val status: Int? = null, val route: ResourceRoute? = null) :
        IOException("AirPlay resource ${reason.wire}") {
        val error: String get() = "media-${reason.wire}"
    }
    class Resource(val status: Int, val type: String, val headers: List<Pair<String, String>>,
                   val body: InputStream, private val cleanup: () -> Unit = {}) : Closeable {
        override fun close() { try { body.close() } finally { cleanup() } }
    }
    private val closed = AtomicBoolean(false)
    private val loads = AtomicLong()
    private val diagnostics = AirPlayResourceDiagnostics(log)
    private val connections = ConcurrentHashMap.newKeySet<HttpURLConnection>()
    private val bodies = ConcurrentHashMap.newKeySet<Resource>()
    private val urls = object : LinkedHashMap<String, String>(128, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 4096
    }
    private var next = 0L
    val rootId = "0"

    init { requirePlayable(root) }

    /** Only literal addresses belonging to this AirPlay peer qualify, never a DNS name or app scheme. */
    fun directUrl(url: String): String? {
        if (RawTraffic.enabled) return null
        val uri = URI(url)
        return url.takeIf { uri.scheme.lowercase() in listOf("http", "https") &&
            iphoneHost != null && uri.host == iphoneHost && uri.userInfo == null }
    }
    fun directResource(id: String): String? = synchronized(this) {
        if (closed.get()) null else (if (id == rootId) root else urls[id])?.let(::directUrl)
    }

    @Synchronized private fun remember(url: String): String {
        requirePlayable(url)
        check(!closed.get())
        if (url == root) return rootId
        urls.entries.firstOrNull { it.value == url }?.let { return it.key }
        return (++next).toString().also { urls[it] = url }
    }

    fun open(id: String, range: String?, forceProxy: Boolean = false, route: (String) -> String): Resource? {
        if (range != null && !ReceiverResource.byteRange.matches(range))
            return Resource(416, "application/octet-stream", emptyList(), ByteArrayInputStream(ByteArray(0)))
        val url = synchronized(this) { if (closed.get()) null else if (id == rootId) root else urls[id] } ?: return null
        val resource = loadResource(url, range, route, 0, forceProxy, loads.incrementAndGet())
        bodies += resource
        if (closed.get()) { bodies -= resource; resource.close(); return null }
        return Resource(resource.status, resource.type, resource.headers, resource.body) {
            bodies -= resource; resource.close()
        }
    }

    private fun loadResource(url: String, range: String?, route: (String) -> String, redirects: Int,
                     forceProxy: Boolean, load: Long): Resource {
        try { requirePlayable(url) } catch (_: IOException) { fail(load, FailureReason.UNSUPPORTED_RESOURCE) }
        if (closed.get()) throw IOException("Playback ended")
        directUrl(url)?.takeIf { !forceProxy }?.let { direct ->
            return Resource(307, "application/octet-stream", listOf("Location" to direct), ByteArrayInputStream(ByteArray(0)))
        }
        val uri = URI(url)
        val direct = uri.scheme.lowercase() in listOf("http", "https")
        fun iphoneResource(): ReceiverResource? {
            diagnostics.request(load, ResourceRoute.IPHONE_FCUP, range, redirects)
            return iphone(url, range).also { response ->
                diagnostics.response(load, ResourceRoute.IPHONE_FCUP, response?.status, response?.bytes?.size,
                    ReceiverResource.headers(response?.headers))
            }
        }
        var broker = if (!direct || uri.host == iphoneHost || uri.path.orEmpty().endsWith(".m3u8", true)) iphoneResource() else null
        if (broker == null && direct) {
            diagnostics.request(load, ResourceRoute.ANDROID_HTTP, range, redirects)
            val connection = uri.toURL().openConnection() as HttpURLConnection
            connection.connectTimeout = 5000; connection.readTimeout = 10000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept-Encoding", "identity")
            connection.setRequestProperty("Cache-Control", "no-cache")
            ReceiverResourceHeaders.forUrl(url).forEach { (name, value) -> connection.setRequestProperty(name, value) }
            if (range != null) connection.setRequestProperty("Range", range)
            connections += connection
            if (closed.get()) { connections -= connection; connection.disconnect(); throw IOException("Playback ended") }
            var followingRedirect = false
            try {
                val status = connection.responseCode
                val responseHeaders = ReceiverResource.headers(connection.headerFields.entries.mapNotNull { entry ->
                    entry.key?.let { name -> name to entry.value.singleOrNull() }
                }.toMap())
                diagnostics.response(load, ResourceRoute.ANDROID_HTTP, status, null, responseHeaders)
                if (RawTraffic.enabled) RawTraffic.record("iphone/resource/$url/response-headers",
                    "status=$status headers=${connection.headerFields}".toByteArray())
                if (status !in 200..399 && RawTraffic.enabled) connection.errorStream?.use { body ->
                    val buffer = ByteArray(8192)
                    var remaining = MAX_ERROR_CAPTURE
                    while (remaining > 0) {
                        val count = body.read(buffer, 0, minOf(buffer.size, remaining))
                        if (count < 0) break
                        RawTraffic.record("iphone/resource/$url/error-body", buffer, 0, count)
                        remaining -= count
                    }
                }
                if (status in listOf(301, 302, 303, 307, 308)) {
                    val location = connection.getHeaderField("Location") ?: fail(load, FailureReason.UPSTREAM_HTTP_ERROR, status, ResourceRoute.ANDROID_HTTP)
                    if (redirects >= 5) fail(load, FailureReason.REDIRECT_LIMIT, status, ResourceRoute.ANDROID_HTTP)
                    connection.disconnect(); connections -= connection
                    followingRedirect = true
                    return loadResource(uri.resolve(location).toString(), range, route, redirects + 1, forceProxy, load)
                }
                if (status in listOf(200, 206)) {
                    if (status == 206 && !validPartial(range, responseHeaders, null))
                        fail(load, FailureReason.INVALID_RANGE_RESPONSE, status, ResourceRoute.ANDROID_HTTP)
                    val input = BufferedInputStream(RawTraffic.input("iphone/resource/$url/in", connection.inputStream))
                    // A bounded probe/range can contain a complete playlist or only its prefix.
                    // Rewriting a prefix would publish a corrupt manifest; fetch it whole first.
                    if (isPlaylist(input)) {
                        try {
                            if (status == 206 && !completeRepresentation(responseHeaders)) {
                                input.close(); connection.disconnect(); connections -= connection
                                return loadResource(url, null, route, redirects, forceProxy, load)
                            }
                            val bytes = readPlaylist(input)
                            val rewritten = rewritePlaylist(url, bytes, forceProxy, route)
                            return Resource(200, "application/vnd.apple.mpegurl", emptyList(), ByteArrayInputStream(rewritten))
                        } finally { input.close(); connection.disconnect(); connections -= connection }
                    }
                    val headers = listOf("Content-Length", "Content-Range", "Accept-Ranges").mapNotNull { name ->
                        connection.getHeaderField(name)?.takeIf { it.all { c -> c in ' '..'~' } }?.let { name to it }
                    }
                    return Resource(status, contentType(url, connection.contentType), headers, input) {
                        connection.disconnect(); connections -= connection
                    }
                }
                if (status == 416) {
                    val headers = connection.getHeaderField("Content-Range")?.takeIf { UNSATISFIED_RANGE.matches(it) }
                        ?.let { listOf("Content-Range" to it) } ?: emptyList()
                    connection.disconnect(); connections -= connection
                    return Resource(416, "application/octet-stream", headers, ByteArrayInputStream(ByteArray(0)))
                }
                fail(load, statusReason(status), status, ResourceRoute.ANDROID_HTTP)
            } catch (error: IOException) {
                connection.disconnect(); connections -= connection
                // A destination's failure belongs to that destination; do not retry the old origin.
                if (followingRedirect) throw error
                if (error !is Failure) diagnostics.failure(load, Failure(FailureReason.RESOURCE_IO, route = ResourceRoute.ANDROID_HTTP), error)
                broker = iphoneResource() ?: throw (error as? Failure
                    ?: Failure(FailureReason.RESOURCE_IO, route = ResourceRoute.ANDROID_HTTP))
            }
        }
        val response = broker ?: fail(load, FailureReason.RESOURCE_UNAVAILABLE, route = ResourceRoute.IPHONE_FCUP)
        val headers = ReceiverResource.headers(response.headers)
        if (response.status in listOf(301, 302, 303, 307, 308)) {
            val location = response.location ?: fail(load, FailureReason.UPSTREAM_HTTP_ERROR, response.status, ResourceRoute.IPHONE_FCUP)
            if (redirects >= 5) fail(load, FailureReason.REDIRECT_LIMIT, response.status, ResourceRoute.IPHONE_FCUP)
            return loadResource(uri.resolve(location).toString(), range, route, redirects + 1, forceProxy, load)
        }
        if (response.status == 416) {
            val unsatisfied = headers["Content-Range"]?.takeIf { UNSATISFIED_RANGE.matches(it) }
            return Resource(416, "application/octet-stream", unsatisfied?.let { listOf("Content-Range" to it) }.orEmpty(), ByteArrayInputStream(ByteArray(0)))
        }
        if (response.status != null && response.status != 0 && response.status !in 200..299)
            fail(load, statusReason(response.status), response.status, ResourceRoute.IPHONE_FCUP)
        val bytes = response.bytes ?: fail(load, FailureReason.RESOURCE_UNAVAILABLE, response.status, ResourceRoute.IPHONE_FCUP)
        if (bytes.size > MAX_BROKER_BYTES) fail(load, FailureReason.RESOURCE_TOO_LARGE, response.status, ResourceRoute.IPHONE_FCUP)
        if (response.status == 206) {
            // FCUP has already applied the absolute range. Slicing these bytes again corrupts MAP/media loads.
            if (!validPartial(range, headers, bytes.size))
                fail(load, FailureReason.INVALID_RANGE_RESPONSE, response.status, ResourceRoute.IPHONE_FCUP)
            if (isPlaylist(BufferedInputStream(ByteArrayInputStream(bytes)))) {
                if (!completeRepresentation(headers)) return loadResource(url, null, route, redirects, forceProxy, load)
                return Resource(200, "application/vnd.apple.mpegurl", emptyList(),
                    ByteArrayInputStream(rewritePlaylist(url, bytes, forceProxy, route)))
            }
            return Resource(206, contentType(url, headers["Content-Type"]), listOf(
                "Content-Range" to headers.getValue("Content-Range"), "Content-Length" to bytes.size.toString(),
                "Accept-Ranges" to "bytes"), ByteArrayInputStream(bytes))
        }
        // Return rewritten whole playlists as 200 even when the browser requested a range.
        if (isPlaylist(BufferedInputStream(ByteArrayInputStream(bytes))))
            return Resource(200, "application/vnd.apple.mpegurl", emptyList(), ByteArrayInputStream(rewritePlaylist(url, bytes, forceProxy, route)))
        // App loaders may ignore Range and return the full 200/0 representation; range it locally once.
        return byteResource(url, bytes, range, headers["Content-Type"])
    }

    private fun fail(load: Long, reason: FailureReason, status: Int? = null, route: ResourceRoute? = null): Nothing {
        val error = Failure(reason, status, route)
        diagnostics.failure(load, error)
        throw error
    }

    internal fun rewritePlaylist(base: String, bytes: ByteArray, forceProxy: Boolean = false, route: (String) -> String): ByteArray {
        if (bytes.size > MAX_PLAYLIST) throw IOException("Playlist too large")
        val uri = URI(base)
        fun replace(value: String): String {
            val resolved = uri.resolve(value).toString()
            requirePlayable(resolved)
            return directUrl(resolved)?.takeIf { !forceProxy } ?: route(remember(resolved))
        }
        // Includes variants, segments, EXT-X-MAP, EXT-X-MEDIA and ordinary AES-128 keys.
        // DRM key schemes are refused by requirePlayable; no decryption is performed here.
        return bytes.toString(Charsets.UTF_8).removePrefix("\uFEFF").lineSequence().joinToString("\n") { line ->
            when {
                line.isBlank() -> line
                !line.startsWith("#") -> replace(line.trim())
                else -> URI_ATTRIBUTE.replace(line) { match -> "URI=\"${replace(match.groupValues[1])}\"" }
            }
        }.toByteArray(Charsets.UTF_8)
    }

    override fun close() {
        if (!closed.compareAndSet(false, true)) return
        synchronized(this) { urls.clear() }
        // Disconnecting a blocked HTTP read may wait on a socket lock. Never do that on Android's UI thread.
        Thread({
            connections.forEach { it.disconnect() }; connections.clear()
            bodies.forEach { runCatching { it.close() } }; bodies.clear()
        }, "airplay-proxy-close").apply { isDaemon = true; start() }
    }

    companion object {
        private const val MAX_PLAYLIST = 2 * 1024 * 1024
        private const val MAX_BROKER_BYTES = 32 * 1024 * 1024
        private const val MAX_ERROR_CAPTURE = 64 * 1024
        private val URI_ATTRIBUTE = Regex("URI=\"([^\"]*)\"")
        private val UNSATISFIED_RANGE = Regex("bytes \\*/[0-9]{1,18}")
        private val CONTENT_RANGE = Regex("bytes ([0-9]{1,18})-([0-9]{1,18})/([0-9]{1,18}|\\*)")
        private val CONTENT_TYPE = Regex("[a-z0-9.+-]+/[a-z0-9.+-]+")
        fun query(value: String): String = URLEncoder.encode(value, "UTF-8")
        private fun statusReason(status: Int) = when (status) {
            403 -> FailureReason.UPSTREAM_FORBIDDEN
            401 -> FailureReason.UPSTREAM_UNAUTHORIZED
            else -> FailureReason.UPSTREAM_HTTP_ERROR
        }
        private fun validPartial(range: String?, headers: Map<String, String>, bytes: Int?): Boolean {
            if (range == null) return false
            val values = CONTENT_RANGE.matchEntire(headers["Content-Range"].orEmpty())?.groupValues ?: return false
            val start = values[1].toLong(); val end = values[2].toLong(); val total = values[3].toLongOrNull()
            if (start > end || total != null && end >= total) return false
            val requested = range.removePrefix("bytes=").split('-')
            val length = end - start + 1
            val matchesRange = if (requested[0].isEmpty()) {
                val suffix = requested[1].toLong()
                if (total == null) length <= suffix else start == (total - suffix).coerceAtLeast(0) && end == total - 1
            } else {
                val last = if (requested[1].isEmpty()) total?.minus(1)
                    else requested[1].toLong().let { if (total == null) it else minOf(it, total - 1) }
                start == requested[0].toLong() && (last == null || end == last)
            }
            return matchesRange && (bytes == null || length == bytes.toLong()) &&
                (headers["Content-Length"]?.let { it.toLongOrNull() == length } ?: true)
        }
        private fun completeRepresentation(headers: Map<String, String>): Boolean {
            val values = CONTENT_RANGE.matchEntire(headers["Content-Range"].orEmpty())?.groupValues ?: return false
            return values[1].toLong() == 0L && values[3].toLongOrNull()?.let { it == values[2].toLong() + 1 } == true
        }
        private fun requirePlayable(url: String) {
            if (!VideoInCar.isPlayableUrl(url, iphoneLoadsAppSchemes = true) || URI(url).userInfo != null)
                throw IOException("Unsupported media resource")
        }
        private fun isPlaylist(input: BufferedInputStream): Boolean {
            input.mark(10)
            val bytes = ByteArray(10); var length = 0
            while (length < bytes.size) { val n = input.read(bytes, length, bytes.size - length); if (n < 0) break; length += n }
            input.reset()
            return String(bytes, 0, length, Charsets.UTF_8).removePrefix("\uFEFF").startsWith("#EXTM3U")
        }
        private fun readPlaylist(input: InputStream): ByteArray {
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (output.size() + count > MAX_PLAYLIST) throw IOException("Playlist too large")
                output.write(buffer, 0, count)
            }
            return output.toByteArray()
        }
        private fun contentType(url: String, supplied: String?): String {
            val type = supplied?.substringBefore(';')?.lowercase()
            if (type != null && CONTENT_TYPE.matches(type) && type != "application/octet-stream") return type
            return when (URI(url).path.orEmpty().substringAfterLast('.').lowercase()) {
                "mp4", "m4v", "m4s" -> "video/mp4"; "ts" -> "video/mp2t"; "aac" -> "audio/aac"
                "m3u8" -> "application/vnd.apple.mpegurl"; else -> "application/octet-stream"
            }
        }
        private fun byteResource(url: String, bytes: ByteArray, range: String?, suppliedType: String? = null): Resource {
            val headers = listOf("Accept-Ranges" to "bytes")
            if (range == null) return Resource(200, contentType(url, suppliedType), headers + ("Content-Length" to bytes.size.toString()), ByteArrayInputStream(bytes))
            val parts = range.removePrefix("bytes=").split('-')
            val start = if (parts[0].isEmpty()) (bytes.size.toLong() - parts[1].toLong()).coerceAtLeast(0) else parts[0].toLong()
            val end = if (parts[0].isEmpty() || parts[1].isEmpty()) bytes.size.toLong() - 1 else parts[1].toLong().coerceAtMost(bytes.size.toLong() - 1)
            if (start > end || start >= bytes.size) return Resource(416, "application/octet-stream", listOf("Content-Range" to "bytes */${bytes.size}"), ByteArrayInputStream(ByteArray(0)))
            val length = (end - start + 1).toInt()
            return Resource(206, contentType(url, suppliedType), headers + listOf("Content-Length" to length.toString(), "Content-Range" to "bytes $start-$end/${bytes.size}"), ByteArrayInputStream(bytes, start.toInt(), length))
        }
    }
}
