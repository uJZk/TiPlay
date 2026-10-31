package com.shilapi.xcertplay

import android.content.Context
import java.io.File

/** Only app-private cache roots and names owned by diagnostic preparation. */
internal object DiagnosticTemporaryFiles {
    private val prefixes = listOf("diagnostic-export-", "traffic-export-", "native-crash-export-")

    fun roots(context: Context): List<File> = (
        listOfNotNull(runCatching { context.cacheDir }.getOrNull()) +
            runCatching { context.externalCacheDirs.filterNotNull() }.getOrDefault(emptyList())
        ).distinctBy { it.absolutePath }

    fun cleanAbandoned(context: Context) {
        roots(context).forEach { root ->
            runCatching {
                root.listFiles()?.filter { child -> prefixes.any { child.name.startsWith(it) } }
                    ?.forEach { it.deleteRecursively() }
            }
        }
    }
}
