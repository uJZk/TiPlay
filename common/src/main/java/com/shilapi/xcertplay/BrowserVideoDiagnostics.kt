package com.shilapi.xcertplay

import com.shilapi.xcertplay.web.BrowserVideoDiagnosticsSchema
import java.util.Locale

/** Complete schema-v1 scalar evidence, split before the metadata redactor's 700-character boundary. */
internal object BrowserVideoDiagnostics {
    private const val LINE_BUDGET = 600

    fun lines(stats: Map<String, Any?>): List<String> {
        val safe = BrowserVideoDiagnosticsSchema.parse(stats) ?: return emptyList()
        val identity = "schema=1 pageVersion=${safe["pageVersion"]} epoch=${safe["epoch"]?.let(::value) ?: "unknown"} sample=${value(safe["sample"])} generation=${safe["streamGeneration"]?.let(::value) ?: "unknown"}"
        return buildList {
            for ((group, fields) in BrowserVideoDiagnosticsSchema.groups) {
                if (group == "SOURCE" && fields.none { safe[it] != null }) continue
                val header = "Browser video: stage=$group $identity"
                var line = StringBuilder(header)
                for (field in fields) {
                    val entry = "$field=${value(safe[field])}"
                    if (line.length > header.length && line.length + 1 + entry.length > LINE_BUDGET) {
                        add(line.toString()); line = StringBuilder(header)
                    }
                    line.append(' ').append(entry)
                }
                if (line.length > header.length) add(line.toString())
            }
        }
    }

    private fun value(value: Any?): String = when (value) {
        null -> "missing"
        is Number -> value.toDouble().let {
            if (it % 1.0 == 0.0) it.toLong().toString() else String.format(Locale.ROOT, "%.3f", it)
        }
        else -> value.toString()
    }
}
