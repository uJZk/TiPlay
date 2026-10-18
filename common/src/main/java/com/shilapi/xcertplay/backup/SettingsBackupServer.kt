package com.shilapi.xcertplay.backup

import com.shilapi.xcertplay.airplay.RtspMessage
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

data class SettingsBackupEndpoint(val port: Int, val token: String, val code: String = "") {
    fun url(address: String) = "http://$address:$port/b/$token/"

    /** What someone without a camera types; a browser adds the scheme. The page it opens asks for [code]. */
    fun typedAddress(address: String) = "$address:$port"
}

/**
 * One-request-per-connection HTTP transport that serves the settings backup page.
 *
 * Each connection is read on its own thread. A browser opens spare connections before it needs
 * them and may never use them; read in turn, one of those would hold up every request behind it
 * until it timed out. The requests themselves are still answered one at a time.
 */
class SettingsBackupServer(
    private val page: ByteArray,
    private val export: () -> ByteArray,
    private val import: (ByteArray) -> SettingsImportOutcome,
    /** The diagnostic report as text, or null when the page has none to offer. */
    private val report: (() -> ByteArray)? = null,
    /** The page that asks for the typed code, or null when the address cannot be typed. */
    private val codePage: ByteArray? = null,
) {
    private class Run(val server: ServerSocket, val endpoint: SettingsBackupEndpoint, val connections: ExecutorService) {
        val open: MutableSet<Socket> = Collections.newSetFromMap(ConcurrentHashMap())
        lateinit var thread: Thread
        @Volatile var closed = false
        @Volatile var wrongCodes = 0

        @Synchronized fun close() {
            if (closed) return
            closed = true
            runCatching { server.close() }
            connections.shutdown()
            // Registration precedes dispatch; accept racing with close checks closed and retires itself.
            for (socket in open) runCatching { socket.close() }
        }
    }
    private val lifecycle = Any()
    @Volatile private var current: Run? = null
    private val answering = Any()
    /** Where the typed code leads on the page, for example "#report". */
    @Volatile var landing = ""
    /** False once too many wrong codes were typed. The link in the QR code keeps working. */
    val codeEntryOpen: Boolean get() = codePage != null && (current?.wrongCodes ?: 0) < MAX_WRONG_CODES
    /** Called on a connection thread when the last allowed wrong code was typed. */
    var onCodeEntryClosed: (() -> Unit)? = null
    var onImported: ((SettingsImportOutcome) -> Unit)? = null
    /** Called on the server thread when nobody used the page for [idleTimeoutMillis]. */
    var onIdle: (() -> Unit)? = null
    var idleTimeoutMillis = IDLE_TIMEOUT_MILLIS
    /** The port asked for when the address may be typed; any free one is taken when it is busy. */
    var typedPort = TYPED_PORT

    private fun listen(port: Int): ServerSocket? {
        val socket = ServerSocket()
        return try {
            socket.apply {
                reuseAddress = true
                // accept() wakes up regularly: closing a socket that another thread waits in accept() on
                // waits for that accept() on some JVMs (a test hung for its whole idle timeout on macOS).
                soTimeout = minOf(idleTimeoutMillis, ACCEPT_POLL_MILLIS)
                bind(InetSocketAddress(port), BACKLOG)
            }
        } catch (_: Exception) {
            runCatching { socket.close() }
            null
        }
    }

    fun start(): SettingsBackupEndpoint? {
        while (true) {
            val previous = current
            if (previous != null) {
                if (!previous.closed) return previous.endpoint
                retire(previous)
            }
            synchronized(lifecycle) {
                if (current === previous) return startLocked()
            }
        }
    }

    private fun startLocked(): SettingsBackupEndpoint? {
        // A typed address is worth keeping the same: the browser remembers it, and next time only the
        // code has to be typed. The link in the QR code does not care which port it carries.
        val bound = (if (codePage != null) listen(typedPort) else null) ?: listen(0) ?: return null
        val random = ByteArray(8)
        SecureRandom().nextBytes(random)
        val token = random.joinToString("") { "%02x".format(it) }
        // Not String.format: in some locales it writes other digits than the ones a keyboard types.
        val code = SecureRandom().nextInt(CODE_SPACE).toString().padStart(CODE_DIGITS, '0')
        val connections = ThreadPoolExecutor(0, MAX_CONNECTIONS, 30L, TimeUnit.SECONDS, SynchronousQueue()) { task ->
            Thread(task, "settings-backup-connection").apply { isDaemon = true }
        }
        val endpoint = SettingsBackupEndpoint(bound.localPort, token, if (codePage != null) code else "")
        val run = Run(bound, endpoint, connections)
        run.thread = Thread({ loop(run) }, "settings-backup").apply { isDaemon = true }
        current = run
        run.thread.start()
        return endpoint
    }

    fun stop() {
        // Publication and thread startup finish together before stop can retire the run.
        val run = synchronized(lifecycle) { current }
        run?.let(::retire)
    }

    private fun retire(run: Run) {
        run.close()
        // Some JVMs defer the listener descriptor's final close until accept unwinds.
        // Wait outside lifecycle/answering locks so restarting can immediately rebind its port.
        val accepting = run.thread
        if (accepting === Thread.currentThread()) return
        var interrupted = false
        while (true) {
            try {
                accepting.join()
                break
            } catch (_: InterruptedException) {
                interrupted = true
            }
        }
        if (interrupted) Thread.currentThread().interrupt()
    }

    private fun loop(run: Run) {
        var lastConnection = System.nanoTime()
        while (!run.closed) {
            val socket = try {
                run.server.accept()
            } catch (_: SocketTimeoutException) {
                // Anyone on the car's network can reach it, so it does not wait for them forever.
                if (run.closed) break
                if (System.nanoTime() - lastConnection < TimeUnit.MILLISECONDS.toNanos(idleTimeoutMillis.toLong())) continue
                run.close()
                if (current === run) onIdle?.invoke()
                null
            } catch (_: Exception) {
                null
            } ?: break
            lastConnection = System.nanoTime()
            run.open.add(socket)
            if (run.closed || current !== run) {
                run.open.remove(socket)
                runCatching { socket.close() }
                break
            }
            try {
                run.connections.execute { handle(run, socket) }
            } catch (_: RejectedExecutionException) {
                // Every thread is busy: refuse this one, and the browser asks again.
                runCatching { socket.close() }
                run.open.remove(socket)
            }
        }
    }

    private fun handle(run: Run, socket: Socket) {
        try {
            if (!run.closed && current === run) serve(run, socket)
        } finally {
            runCatching { socket.close() }
            run.open.remove(socket)
        }
    }

    private fun serve(run: Run, socket: Socket) {
        socket.use {
            runCatching {
                it.soTimeout = 10_000
                it.tcpNoDelay = true
                val request = readRequest(it.getInputStream()) ?: return
                // A failure while preparing the answer is told to the browser; without an answer it
                // would show a connection that opened and then gave nothing.
                val (status, headers, body) = synchronized(answering) {
                    if (run.closed || current !== run) return
                    runCatching { respond(run, request) }.getOrElse { failed() }
                }
                it.getOutputStream().apply {
                    write(
                        RtspMessage.buildResponse(
                            request,
                            RtspMessage.Response(
                                protocol = "HTTP/1.1",
                                status = status,
                                headers = headers + ("Connection" to "close"),
                                body = body,
                            ),
                        ),
                    )
                    flush()
                }
            }
        }
    }

    private fun readRequest(input: InputStream): RtspMessage.Request? {
        val buffer = ByteArrayOutputStream()
        val chunk = ByteArray(8192)
        while (buffer.size() <= MAX_REQUEST) {
            val read = try { input.read(chunk) } catch (_: SocketTimeoutException) { break } ?: break
            if (read <= 0) break
            // A browser that tries HTTPS first on a typed address sends a TLS hello. Closing at once
            // lets it fall back to HTTP now, not after the read timeout.
            if (buffer.size() == 0 && chunk[0] == TLS_HANDSHAKE) return null
            buffer.write(chunk, 0, read)
            val parsed = RtspMessage.parseMessages(buffer.toByteArray())
            if (parsed.messages.isNotEmpty()) return parsed.messages.first()
        }
        return null
    }

    private fun respond(run: Run, request: RtspMessage.Request): Triple<Int, Map<String, String>, ByteArray> {
        val path = request.path.substringBefore('?')
        if (codePage != null && path == "/" && request.method == "GET") {
            return Triple(200, mapOf("Content-Type" to "text/html; charset=utf-8", "Cache-Control" to "no-store"), codePage)
        }
        if (codePage != null && path == "/code" && request.method == "POST") return checkCode(run, request.body)
        val prefix = "/b/${run.endpoint.token}"
        val authorized = path == prefix || path.startsWith("$prefix/")
        if (!authorized) return notFound()
        val route = path.removePrefix("$prefix/").trimEnd('/')
        return when {
            route.isEmpty() && request.method == "GET" ->
                Triple(200, mapOf("Content-Type" to "text/html; charset=utf-8", "Cache-Control" to "no-store"), page)
            route == "export" && request.method == "GET" -> Triple(
                200,
                mapOf(
                    "Content-Type" to "application/json",
                    "Content-Disposition" to "attachment; filename=\"$EXPORT_FILE\"",
                    "Cache-Control" to "no-store",
                ),
                export(),
            )
            route == "report" && request.method == "GET" && report != null -> Triple(
                200,
                mapOf(
                    "Content-Type" to "text/plain; charset=utf-8",
                    "Content-Disposition" to "attachment; filename=\"$REPORT_FILE\"",
                    "Cache-Control" to "no-store",
                ),
                report(),
            )
            route == "import" && request.method == "POST" -> {
                val outcome = import(request.body)
                if (!run.closed && current === run) onImported?.invoke(outcome)
                Triple(
                    200,
                    mapOf("Content-Type" to "application/json", "Cache-Control" to "no-store"),
                    "{\"applied\":${outcome.applied},\"skipped\":${outcome.skipped},\"invalid\":${outcome.invalid}}"
                        .toByteArray(Charsets.UTF_8),
                )
            }
            else -> notFound()
        }
    }

    /**
     * A typed code is short enough to guess, so only a few wrong ones are allowed. After that no code
     * is accepted, not even the right one, until the page is opened again on the head unit.
     */
    private fun checkCode(run: Run, body: ByteArray): Triple<Int, Map<String, String>, ByteArray> {
        val headers = mapOf("Content-Type" to "application/json", "Cache-Control" to "no-store")
        fun answer(status: Int, json: String) = Triple(status, headers, json.toByteArray(Charsets.UTF_8))
        if (run.wrongCodes >= MAX_WRONG_CODES) return answer(403, "{\"locked\":true}")
        val typed = String(body, 0, minOf(body.size, MAX_TYPED_BYTES), Charsets.UTF_8).filter { it in '0'..'9' }
        if (typed.length == CODE_DIGITS && tokenMatches(run.endpoint.code, typed)) return answer(200, "{\"path\":\"/b/${run.endpoint.token}/$landing\"}")
        run.wrongCodes++
        if (run.wrongCodes < MAX_WRONG_CODES) return answer(403, "{\"left\":${MAX_WRONG_CODES - run.wrongCodes}}")
        if (!run.closed && current === run) onCodeEntryClosed?.invoke()
        return answer(403, "{\"locked\":true}")
    }

    private fun failed() = Triple(500, mapOf("Content-Type" to "text/plain", "Cache-Control" to "no-store"),
        "The head unit could not prepare this. Try again.".toByteArray(Charsets.UTF_8))

    private fun notFound() = Triple(404, mapOf("Content-Type" to "text/plain", "Cache-Control" to "no-store"), "Not found".toByteArray(Charsets.UTF_8))

    companion object {
        private const val BACKLOG = 4
        /** More than a browser opens to one host; the rest are refused rather than queued. */
        private const val MAX_CONNECTIONS = 16
        const val IDLE_TIMEOUT_MILLIS = 10 * 60_000
        private const val ACCEPT_POLL_MILLIS = 250
        private const val MAX_REQUEST = 2 shl 20
        const val EXPORT_FILE = "diplay-settings.json"
        const val REPORT_FILE = "diplay-report.txt"
        const val CODE_DIGITS = 6
        private const val CODE_SPACE = 1_000_000
        /** Five tries in a million codes: one page opening is guessed about once in 200,000. */
        const val MAX_WRONG_CODES = 5
        private const val MAX_TYPED_BYTES = 64
        private const val TLS_HANDSHAKE: Byte = 0x16
        /** Short, the same four keys, and no browser refuses it. Unprivileged apps cannot use 80. */
        const val TYPED_PORT = 8888

        fun addressCandidates(preferredPrefix: String? = null): List<String> = runCatching {
            NetworkInterface.getNetworkInterfaces().toList().asSequence()
                .filter { it.isUp && !it.isLoopback && !it.isVirtual }
                .flatMap { iface -> iface.inetAddresses.toList().asSequence().map { iface to it } }
                .filter { (_, address) ->
                    address is Inet4Address && !address.isLoopbackAddress && !address.isLinkLocalAddress
                }
                .map { (iface, address) -> rank(iface.name, preferredPrefix) to (address as Inet4Address).hostAddress }
                .filter { it.second != null }
                .sortedBy { it.first }
                .map { it.second!! }
                .distinct()
                .toList()
        }.getOrDefault(emptyList())

        internal fun rank(name: String, preferredPrefix: String?): Int = when {
            preferredPrefix != null && name.startsWith(preferredPrefix) -> 0
            name.startsWith("ap") || name.startsWith("swlan") -> 1
            name.startsWith("p2p") -> 2
            name.startsWith("wlan") -> 3
            else -> 4
        }

        fun tokenMatches(expected: String, provided: String): Boolean =
            MessageDigest.isEqual(expected.toByteArray(Charsets.UTF_8), provided.toByteArray(Charsets.UTF_8))
    }
}
