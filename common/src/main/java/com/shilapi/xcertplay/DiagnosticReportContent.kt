package com.shilapi.xcertplay

import android.content.Context
import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.Closeable
import java.io.File
import java.io.OutputStream

/** One prepared export, reused unchanged for every storage fallback and share copy. */
internal class DiagnosticReportContent(
    val fileName: String,
    private val text: String,
    private val archive: File? = null,
) : Closeable {
    val mimeType: String get() = if (archive == null) "text/plain" else "application/zip"

    fun writeTo(output: OutputStream) {
        if (archive == null) output.write(text.toByteArray(Charsets.UTF_8))
        else archive.inputStream().use { it.copyTo(output) }
    }

    override fun close() { archive?.delete() }

    companion object {
        fun prepare(context: Context, fileName: String, text: String, debug: Boolean): DiagnosticReportContent {
            if (!debug) return DiagnosticReportContent(fileName, text)
            val archive = File.createTempFile("diagnostic-export-", ".zip", context.cacheDir)
            try {
                archive.outputStream().buffered().use {
                    RawTraffic.writeArchive(it, fileName.removeSuffix(".zip") + ".txt", text, context.cacheDir)
                }
                return DiagnosticReportContent(fileName, text, archive)
            } catch (error: Exception) {
                archive.delete(); throw error
            }
        }
    }
}
