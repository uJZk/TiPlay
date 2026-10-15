package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.airplay.VideoInCar
import com.shilapi.xcertplay.receiver.ReceiverResource
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

/** Session-scoped streaming proxy. The browser never supplies an upstream URL or sees app URLs. */
class AirPlayVideoProxy(private val root: String, private val iphone: (String) -> ReceiverResource?, private val iphoneHost: String? = null) : Closeable {
    class Resource(val status: Int, val type: String, val headers: List<Pair<String, String>>,
                   val body: InputStream, private val cleanup: () -> Unit = {}) : Closeable {
        override fun close() { try { body.close() } finally { cleanup() } }
    }
    private val closed = AtomicBoolean(false)
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
        if (range != null && !BYTE_RANGE.matches(range))
            return Resource(416, "application/octet-stream", emptyList(), ByteArrayInputStream(ByteArray(0)))
        val url = synchronized(this) { if (closed.get()) null else if (id == rootId) root else urls[id] } ?: return null
        val resource = load(url, range, route, 0, forceProxy)
        bodies += resource
        if (closed.get()) { bodies -= resource; resource.close(); return null }
        return Resource(resource.status, resource.type, resource.headers, resource.body) {
            bodies -= resource; resource.close()
        }
    }

    private fun load(url: String, range: String?, route: (String) -> String, redirects: Int, forceProxy: Boolean): Resource {
        requirePlayable(url)
        if (closed.get()) throw IOException("Playback ended")
        directUrl(url)?.takeIf { !forceProxy }?.let { direct ->
            return Resource(307, "application/octet-stream", listOf("Location" to direct), ByteArrayInputStream(ByteArray(0)))
        }
        val uri = URI(url)
        val direct = uri.scheme.lowercase() in listOf("http", "https")
        var broker = if (!direct || uri.path.orEmpty().endsWith(".m3u8", true)) iphone(url) else null
        if (broker == null && direct) {
            val connection = uri.toURL().openConnection() as HttpURLConnection
            connection.connectTimeout = 5000; connection.readTimeout = 10000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept-Encoding", "identity")
            connection.setRequestProperty("Cache-Control", "no-cache")
            if (range != null) connection.setRequestProperty("Range", range)
            connections += connection
            if (closed.get()) { connections -= connection; connection.disconnect(); throw IOException("Playback ended") }
            try {
                val status = connection.responseCode
                if (status in listOf(301, 302, 303, 307, 308)) {
                    val location = connection.getHeaderField("Location") ?: throw IOException("Missing redirect")
                    if (redirects >= 5) throw IOException("Too many redirects")
                    connection.disconnect(); connections -= connection
                    return load(uri.resolve(location).toString(), range, route, redirects + 1, forceProxy)
                }
                if (status in listOf(200, 206)) {
                    val input = BufferedInputStream(connection.inputStream)
                    if (isPlaylist(input)) {
                        try {
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
                throw IOException("Upstream refused media")
            } catch (error: IOException) {
                connection.disconnect(); connections -= connection
                broker = iphone(url) ?: throw error
            }
        }
        val response = broker ?: throw IOException("iPhone did not load resource")
        response.location?.let { location ->
            if (redirects >= 5) throw IOException("Too many redirects")
            return load(uri.resolve(location).toString(), range, route, redirects + 1, forceProxy)
        }
        if (response.status != null && response.status != 0 && response.status !in 200..299)
            throw IOException("iPhone refused media")
        val bytes = response.bytes ?: throw IOException("Empty resource")
        if (isPlaylist(BufferedInputStream(ByteArrayInputStream(bytes))))
            return Resource(200, "application/vnd.apple.mpegurl", emptyList(), ByteArrayInputStream(rewritePlaylist(url, bytes, forceProxy, route)))
        return byteResource(url, bytes, range)
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
        private val URI_ATTRIBUTE = Regex("URI=\"([^\"]*)\"")
        private val BYTE_RANGE = Regex("bytes=(?:[0-9]{1,18}-[0-9]{0,18}|-[0-9]{1,18})")
        private val UNSATISFIED_RANGE = Regex("bytes \\*/[0-9]+")
        private val CONTENT_TYPE = Regex("[a-z0-9.+-]+/[a-z0-9.+-]+")
        fun query(value: String): String = URLEncoder.encode(value, "UTF-8")
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
        private fun byteResource(url: String, bytes: ByteArray, range: String?): Resource {
            val headers = listOf("Accept-Ranges" to "bytes")
            if (range == null) return Resource(200, contentType(url, null), headers + ("Content-Length" to bytes.size.toString()), ByteArrayInputStream(bytes))
            val parts = range.removePrefix("bytes=").split('-')
            val start = if (parts[0].isEmpty()) (bytes.size.toLong() - parts[1].toLong()).coerceAtLeast(0) else parts[0].toLong()
            val end = if (parts[0].isEmpty() || parts[1].isEmpty()) bytes.size.toLong() - 1 else parts[1].toLong().coerceAtMost(bytes.size.toLong() - 1)
            if (start > end || start >= bytes.size) return Resource(416, "application/octet-stream", listOf("Content-Range" to "bytes */${bytes.size}"), ByteArrayInputStream(ByteArray(0)))
            val length = (end - start + 1).toInt()
            return Resource(206, contentType(url, null), headers + listOf("Content-Length" to length.toString(), "Content-Range" to "bytes $start-$end/${bytes.size}"), ByteArrayInputStream(bytes, start.toInt(), length))
        }
    }
}
