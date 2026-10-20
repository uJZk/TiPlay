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
    private val safeCredentialPlaceholder = Regex("(?i)\\b(?:password|passphrase|passwd|token|(?:access|refresh|auth)[-_]?token|api[-_]?key|secret|private[-_ ]?key|session(?:[-_]?id)?|pair(?:ing)?(?:[-_ ]?(?:id|code|record))?|code|c|s)\\s*[:=]\\s*\\[redacted\\]")
    private val codec = Regex("(?i)(?<![a-z0-9_.-])codec=((?:avc|h264|hevc|h265|vp8|vp9|av1|avc1|avc3|hvc1|hev1|vp09|av01|mp4v)(?:\\.[a-z0-9]{1,16}){0,9})(?=\\s|$)")
    fun redact(line: String): String? {
        if (line.contains("TRACE ") || line.contains("PHONE ") || controls.containsMatchIn(line)) return null
        // ErrorText already removed the value. Do not discard the surrounding failure merely
        // because its harmless placeholder still contains a credential field's name.
        val safe = safeCredentialPlaceholder.replace(line, "[credential]")
        if (secret.containsMatchIn(safe) || namedDevice.containsMatchIn(safe) || headers.containsMatchIn(safe) || pairingCode.containsMatchIn(safe)) return null
        val public = safe.replace(resourceUrl, "[url]").replace(mac, "[address]").replace(identifier, "[identifier]")
        // VP9 profile tokens resemble IPv4. Preserve only validated codec= spans after the
        // original credential/URL filters; use ranges, never attacker-collidable placeholders.
        var cursor = 0
        val output = StringBuilder()
        codec.findAll(public).filter { isCodecProfile(it.groupValues[1]) }.forEach { match ->
            output.append(redactAddresses(public.substring(cursor, match.range.first)))
            output.append(match.value)
            cursor = match.range.last + 1
        }
        return output.append(redactAddresses(public.substring(cursor))).toString().take(700)
    }

    private fun redactAddresses(text: String) = text.replace(address, "[ip]").replace(ipv6, "[ip]")

    /** Only known complete codec grammars can exempt dotted numbers from address redaction. */
    private fun isCodecProfile(value: String): Boolean {
        if (value.length > 48) return false
        val fields = value.lowercase(java.util.Locale.ROOT).split('.')
        return when (fields[0]) {
            "avc1", "avc3" -> fields.size == 2 && Regex("[0-9a-f]{6}").matches(fields[1])
            "av01" -> {
                if (fields.size != 4 && fields.size != 10) return false
                val profile = fields[1].takeIf { it in setOf("0", "1", "2") } ?: return false
                val level = fields[2].takeIf { Regex("(?:0[0-9]|1[0-9]|2[0-3])[mh]").matches(it) } ?: return false
                if (level.endsWith('h') && level.take(2).toInt() < 8) return false
                val depth = fields[3].takeIf { it in setOf("08", "10", "12") } ?: return false
                if (profile != "2" && depth == "12") return false
                if (fields.size == 4) return true
                if (fields[4] !in setOf("0", "1") || !Regex("(?:000|100|11[0-2])").matches(fields[5])) return false
                if (fields[4] == "1" && (profile == "1" || fields[5] != "110")) return false
                if (profile == "0" && !fields[5].startsWith("11")) return false
                if (profile == "1" && fields[5] != "000") return false
                if (profile == "2" && depth != "12" && fields[4] == "0" && fields[5] != "100") return false
                colour(fields[6], fields[7], fields[8]) && fields[9] in setOf("0", "1")
            }
            "vp09" -> {
                if (fields.size != 4 && fields.size != 9) return false
                val profile = fields[1].takeIf { it in setOf("00", "01", "02", "03") } ?: return false
                if (fields[2] !in setOf("10", "11", "20", "21", "30", "31", "40", "41", "50", "51", "52", "60", "61", "62")) return false
                val depth = fields[3].takeIf { it in setOf("08", "10", "12") } ?: return false
                if ((profile in setOf("00", "01")) != (depth == "08")) return false
                if (fields.size == 4) return true
                val chroma = if (profile in setOf("00", "02")) setOf("00", "01") else setOf("02", "03")
                fields[4] in chroma && colour(fields[5], fields[6], fields[7]) && fields[8] in setOf("00", "01")
            }
            // Other families still undergo address redaction rather than receiving a broad exemption.
            else -> false
        }
    }

    private fun colour(primaries: String, transfer: String, matrix: String) =
        primaries in setOf("01", "02", "04", "05", "06", "07", "08", "09", "10", "11", "12", "22") &&
            transfer in setOf("01", "02", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18") &&
            matrix in setOf("00", "01", "02", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14")
}
