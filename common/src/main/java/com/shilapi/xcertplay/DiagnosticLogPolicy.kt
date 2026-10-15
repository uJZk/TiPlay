package com.shilapi.xcertplay

internal enum class DiagnosticLogLevel(val key: String) {
    STANDARD("standard"), DEBUG("debug");

    companion object {
        fun fromKey(value: String?): DiagnosticLogLevel = entries.firstOrNull { it.key == value } ?: STANDARD
    }
}

/** Standard filters metadata; Debug preserves messages and enables the separate raw capture. */
internal object DiagnosticLogPolicy {
    @Volatile var level = DiagnosticLogLevel.STANDARD

    private val failureWord = Regex("(?i)\\b(failed|failure|rejected|denied|timeout|timed out|exception|crash|anr|invalid|unavailable)\\b(?!\\s*[=:])")
    private val errorValue = Regex("(?i)\\b(?:error|errorCode|exception|failureClass)=([^\\s]+)")
    private val lossValue = Regex("(?i)\\b[A-Za-z]*(?:dropped|drop|underruns|overruns|failures|readErrors|sendErrors|inErrors|rcvbufErrors|inCsumErrors|missedErrors)(?:Delta|Total)?=([+]?[0-9]+)")
    private val badStatus = Regex("(?i)\\bstatus=([45][0-9]{2}|INVALID)\\b")
    private val errorEvent = Regex("(?i)\\b(event|state|reason|result)=(?:error|failed|browser-failed|decoder-error|timed_out|invalid|rejected|denied)\\b|\\b(?:failed|failure|denied|rejected|timeout|invalid|unavailable)=true\\b|\\bcommandWritten=false\\b|\\berror\\b(?!\\s*[=:])")
    private val finalSummary = Regex("(?i)\\b(ended=true|stage=(?:END|FINISH|STOP)|summary|io final)\\b|^Media clock (?:final|snapshot):")
    private val protocolDetail = Regex("(?i)\\bstage=(?:REQUEST|RESPONSE|REVERSE_REPLY|PARAMETERS|PLAYBACK_INFO|PACKET|FORWARDED|TIMING|ENCODED_FRAME|READ|DISPATCH|WRITE)\\b")

    fun shouldRecord(message: String, selectedLevel: DiagnosticLogLevel = level): Boolean {
        if (selectedLevel == DiagnosticLogLevel.DEBUG) return true
        // Check faults before routine categories: a failed protocol request remains in Standard.
        if (isFailure(message) || finalSummary.containsMatchIn(message)) return true
        val text = withoutTimestamp(message)
        return when {
            text.startsWith("Browser:", true) -> false
            text.startsWith("Media clock:", true) -> false
            text.startsWith("Buffered audio: queued ", true) -> false
            text.startsWith("browser video stage=REPORT", true) -> false
            text.startsWith("airplay control request", true) || text.startsWith("airplay control response", true) -> false
            text.startsWith("receiveCounters", true) -> false
            text.startsWith("control probe", true) -> false
            text.startsWith("wireless startup elapsedMs=", true) -> false
            text.startsWith("THEME_DIAGNOSTIC sample source=poll", true) -> false
            text.contains(" stats ", true) || text.contains(" decoder stats ", true) -> false
            text.contains("CONNECTION_DIAGNOSTIC", true) &&
                (text.contains(" io snapshot ", true) || text.contains("Bluetooth snapshot", true)) -> false
            text.contains("wired io operation=", true) -> false
            protocolDetail.containsMatchIn(text) -> false
            text.startsWith("receiver protocol resource stage=", true) -> false
            else -> true
        }
    }

    internal fun isFailure(message: String): Boolean = failureWord.containsMatchIn(message) ||
        badStatus.containsMatchIn(message) || errorEvent.containsMatchIn(message) ||
        errorValue.findAll(message).any { it.groupValues[1].lowercase() !in setOf("0", "none", "null", "-", "false") } ||
        lossValue.findAll(message).any { it.groupValues[1].removePrefix("+").toLongOrNull()?.let { value -> value > 0 } == true }

    fun reportLine(): String = "Log detail: ${level.key}; debug captures unredacted payloads in appended RAW_CAPTURE; standard metadata is filtered"

    private fun withoutTimestamp(message: String): String = message.substringAfter("  ", message)
}
