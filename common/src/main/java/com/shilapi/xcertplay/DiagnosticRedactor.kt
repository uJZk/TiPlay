package com.shilapi.xcertplay

/** Diagnostics describe state transitions; protocol payloads and credentials are never exported. */
internal object DiagnosticRedactor {
    // Match credential fields, not ordinary words such as "passed" or "bypass".
    private val secret = Regex("(?i)\\b(password|passphrase|passwd|token|private[._ -]?key|certificate|pair[._ -]?record|ssid)\\b|\\bpass\\s*[=:]|\\b(body|payload|hex)\\s*=")
    private val mac = Regex("(?i)(?<![0-9a-f])(?:[0-9a-f]{2}:){5}[0-9a-f]{2}(?![0-9a-f])")
    private val identifier = Regex("(?i)\\b[0-9a-f]{24,}\\b|\\b[0-9a-f]{8}-[0-9a-f-]{27,}\\b")
    private val address = Regex("(?<![0-9])(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?![0-9])")
    private val namedDevice = Regex("(?i)\\b(phone|device|peer|host)?name[=:]")
    private val headers = Regex("(?i)\\b(authorization|proxy-authorization|cookie|set-cookie)\\s*[:=]")
    private val resourceUrl = Regex("(?i)\\b[a-z][a-z0-9+.-]*(?:://|%3a%2f%2f)[^\\s<>\"']+|\\b(?:data|blob):[^\\s<>\"']+")
    private val pairingCode = Regex("(?i)\\b(?:pair(?:ing)?[._ -]?id|api[._-]?key|secret|access[._-]?token|refresh[._-]?token)\\s*[=:]|\\bpair(?:ing)?[._ -]?code\\s*[=:][ \\t]*(?!(?:yes|no)(?:\\s|$))[^\\s]+")
    private val controls = Regex("[\\x00-\\x1f\\x7f-\\x9f\\u2028\\u2029]")
    private val ipv6 = Regex("(?i)(?:[0-9a-f]{1,4}:)*[0-9a-f]{0,4}::[0-9a-f:]*(?:%[a-z0-9_.-]+)?|(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}")
    fun redact(line: String): String? {
        if (line.contains("TRACE ") || line.contains("PHONE ") || controls.containsMatchIn(line)) return null
        if (secret.containsMatchIn(line) || namedDevice.containsMatchIn(line) || headers.containsMatchIn(line) || pairingCode.containsMatchIn(line)) return null
        return line.replace(resourceUrl, "[url]").replace(mac, "[address]").replace(identifier, "[identifier]")
            .replace(address, "[ip]").replace(ipv6, "[ip]").take(700)
    }
}
