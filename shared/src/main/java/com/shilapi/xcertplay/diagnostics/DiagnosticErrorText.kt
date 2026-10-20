package com.shilapi.xcertplay.diagnostics

/** Keep useful error wording while removing resource locations and authentication values. */
object DiagnosticErrorText {
    private val pem = Regex("""-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----""", RegexOption.IGNORE_CASE)
    private val headers = Regex("""\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\r\n]*""", RegexOption.IGNORE_CASE)
    private val url = Regex("""\b[a-z][a-z0-9+.-]*(?:://|%3a%2f%2f)[^\s<>"']+|\b(?:data|blob):[^\s<>"']+""", RegexOption.IGNORE_CASE)
    private val relativeUrl = Regex("""(?:/[^\s<>"']*|\b(?:[A-Za-z0-9._~%+-]+/)*[A-Za-z0-9._~%+-]+)\?[^\s<>"']+""")
    private val authentication = Regex("""\b(?:bearer|basic)\s+[^\s,;<>"']+""", RegexOption.IGNORE_CASE)
    private val webrtcIdentity = Regex("""\b(?:a=)?(?:ice[-_](?:pwd|ufrag)|fingerprint|candidate|remote-candidates)\s*[:=]\s*[^\r\n]*""", RegexOption.IGNORE_CASE)
    private const val value = """(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;&<>"']+)"""
    private val credentials = Regex("""\b(password|passphrase|passwd|token|(?:access|refresh|auth)[-_]?token|api[-_]?key|secret|private[-_ ]?key|session(?:[-_]?id)?|pair(?:ing)?(?:[-_ ]?(?:id|code|record))?|code|c|s)["']?\s*[:=]\s*$value""", RegexOption.IGNORE_CASE)
    private val pairing = Regex("""\b(pair(?:ing)?[-_ ]+(?:code|id|record))\s+$value""", RegexOption.IGNORE_CASE)
    private val mac = Regex("""\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b""", RegexOption.IGNORE_CASE)
    private val ipv4 = Regex("""\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?\b""")
    private val ipv6 = Regex("""(?:[0-9a-f]{1,4}:)*[0-9a-f]{0,4}::[0-9a-f:]*(?:%[a-z0-9_.-]+)?|(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}""", RegexOption.IGNORE_CASE)
    private val identifier = Regex("""\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|\b[0-9a-f]{24,}\b|[A-Za-z0-9_+/=.-]{32,}""", RegexOption.IGNORE_CASE)
    private val controls = Regex("""[\x00-\x1f\x7f-\x9f\u2028\u2029]""")
    private val spaces = Regex("""\s+""")

    fun sanitize(message: String?): String {
        if (message == null) return ""
        if (message.length > 4_096) return "[message omitted: too long]"
        var result = pem.replace(message, "[credential]")
        result = headers.replace(result, "[credential]")
        result = url.replace(result, "[url]")
        result = relativeUrl.replace(result, "[url]")
        result = authentication.replace(result, "[credential]")
        result = webrtcIdentity.replace(result, "[webrtc-identity]")
        result = credentials.replace(result) { "${it.groupValues[1]}=[redacted]" }
        result = pairing.replace(result) { "${it.groupValues[1]}=[redacted]" }
        result = mac.replace(result, "[address]")
        result = ipv4.replace(result, "[address]")
        result = ipv6.replace(result, "[address]")
        result = identifier.replace(result, "[identifier]")
        return spaces.replace(controls.replace(result, " "), " ").trim().take(240)
    }

    /** Bounded causes, without stack traces, locations, credentials or unsafe Throwable accessors. */
    fun describe(error: Throwable?): String {
        if (error == null) return "none"
        val (causes, remainder) = causes(error)
        val parts = causes.map { cause ->
            val type = type(cause)
            val text = sanitize(runCatching { cause.message }.getOrNull()).take(100)
            if (text.isEmpty()) type else "$type:$text"
        }
        return (parts + listOfNotNull(remainder)).joinToString(" <- ").take(700)
    }

    /** Cause classes are also safe for cipher/parser failures whose messages may contain keys. */
    fun types(error: Throwable?): String {
        if (error == null) return "none"
        return causes(error).first.joinToString("<-") { type(it) }
    }

    private fun type(error: Throwable) = error.javaClass.simpleName
        .filter { it.isLetterOrDigit() || it == '_' }.take(64).ifEmpty { "OTHER" }

    private fun causes(error: Throwable): Pair<List<Throwable>, String?> {
        val seen = java.util.Collections.newSetFromMap(java.util.IdentityHashMap<Throwable, Boolean>())
        val parts = ArrayList<Throwable>(4)
        var current: Throwable? = error
        while (current != null && parts.size < 4 && seen.add(current)) {
            val cause = current
            parts += cause
            current = runCatching { cause.cause }.getOrNull()
        }
        return parts to if (current == null) null else if (current in seen) "[cause-cycle]" else "[more-causes]"
    }
}
