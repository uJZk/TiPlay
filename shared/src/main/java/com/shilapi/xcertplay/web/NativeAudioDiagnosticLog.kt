package com.shilapi.xcertplay.web

/** Keep native transport evidence complete through the shared metadata redactor and timestamped export. */
object NativeAudioDiagnosticLog {
    const val MAX_LINE_CHARS = 500
    private val field = Regex("[A-Za-z][A-Za-z0-9]{0,47}")
    private val token = Regex("[A-Za-z0-9_.-]{1,64}")

    /** Prefixes contain fixed stage/session identifiers; values are fixed native classifications and scalars. */
    fun lines(prefix: String, details: Map<String, Any?>): List<String> {
        require(prefix.length in 1..180 && prefix.all { it.code in 32..126 })
        val values = details.mapNotNull { (key, value) ->
            if (!field.matches(key)) return@mapNotNull null
            val text = when (value) {
                null -> "null"
                is String, is Number, is Boolean -> value.toString()
                else -> "invalid"
            }.takeIf(token::matches) ?: "invalid"
            "$key=$text"
        }.ifEmpty { listOf("available=false") }
        // Reserve more part digits than the fixed native field set can use.
        val capacity = MAX_LINE_CHARS - prefix.length - " part=999/999 ".length
        val groups = mutableListOf<String>()
        var group = ""
        for (value in values) {
            if (group.isNotEmpty() && group.length + 1 + value.length > capacity) {
                groups += group
                group = ""
            }
            group = if (group.isEmpty()) value else "$group $value"
        }
        if (group.isNotEmpty()) groups += group
        return groups.mapIndexed { index, values -> "$prefix part=${index + 1}/${groups.size} $values" }
    }
}
