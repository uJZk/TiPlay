package com.shilapi.xcertplay

import android.content.Context
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.diagnostics.ArchiveStagingException
import com.shilapi.xcertplay.diagnostics.archiveStagingOutput
import java.io.Closeable
import java.io.File
import java.io.OutputStream
import java.io.IOException

internal class DiagnosticArchiveUnavailable(cause: IOException? = null) :
    IOException("No private staging location has sufficient writable space", cause)

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
        fun prepare(context: Context, fileName: String, text: String, debug: Boolean,
                    openArchive: (File) -> OutputStream = { it.outputStream() }): DiagnosticReportContent {
            if (!debug) return DiagnosticReportContent(fileName, text)
            RawTraffic.archiveSnapshot().use { snapshot ->
                var failure: IOException? = null
                // Each root is attempted once. Original capture descriptors survive every retry.
                for (root in DiagnosticTemporaryFiles.roots(context).sortedByDescending { runCatching { it.usableSpace }.getOrDefault(0L) }) {
                    try { return prepareArchive(context, fileName, text, root, snapshot, openArchive) }
                    catch (error: DiagnosticArchiveUnavailable) { failure = error }
                    catch (error: ArchiveStagingException) { failure = error }
                }
                throw DiagnosticArchiveUnavailable(failure)
            }
        }

        private fun prepareArchive(context: Context, fileName: String, text: String, root: File,
                                   snapshot: RawTraffic.ArchiveSnapshot,
                                   openArchive: (File) -> OutputStream): DiagnosticReportContent {
            val archive = try {
                if (!root.isDirectory && !root.mkdirs()) throw IOException("Diagnostic cache is unavailable")
                File.createTempFile("diagnostic-export-", ".zip", root)
            } catch (error: IOException) { throw DiagnosticArchiveUnavailable(error) }
            var nativeCrash: NativeCrashDiagnostics.Capture? = null
            try {
                val capture = NativeCrashDiagnostics.collect(context, root)
                nativeCrash = capture
                val report = text + "\n--- Native crash trace ---\n" + capture.summary + "\n"
                val required = snapshot.payloadBytes + 2L * capture.attachments.values.sumOf { it.length() } +
                    2L * report.toByteArray(Charsets.UTF_8).size + 128 * 1024L
                val available = runCatching { root.usableSpace }.getOrDefault(-1)
                if (available >= 0 && available < required) throw DiagnosticArchiveUnavailable()
                val output = try { archiveStagingOutput(openArchive(archive)) }
                    catch (error: IOException) { throw ArchiveStagingException(error) }
                output.buffered().use {
                    snapshot.write(it, fileName.removeSuffix(".zip") + ".txt", report, root, capture.attachments)
                }
                return DiagnosticReportContent(fileName, text, archive)
            } catch (error: Exception) {
                archive.delete(); throw error
            } finally {
                nativeCrash?.close()
            }
        }
    }
}
