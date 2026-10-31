package com.shilapi.xcertplay

import android.app.ActivityManager
import android.content.Context
import android.os.Build
import java.io.Closeable
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.UUID

/** Preserves one system-provided trace for an explicitly requested Debug export. */
internal object NativeCrashDiagnostics {
    internal const val MAX_TRACE_BYTES = 8L * 1024 * 1024
    private const val MAX_RECORDS = 3
    private const val NATIVE_CRASH = 5
    private const val MIN_API = 31

    internal data class Record(
        val processName: String?,
        val pid: Int,
        val timestampMillis: Long,
        val reason: Int,
        val status: Int,
        val importance: Int,
        val pssKiB: Long,
        val rssKiB: Long,
        val openTrace: () -> InputStream?,
    )

    internal class Capture internal constructor(
        val attachments: Map<String, File>,
        val summary: String,
        private val directory: File? = null,
    ) : Closeable {
        override fun close() {
            // Cleanup cannot replace the result of the diagnostic export.
            runCatching { directory?.deleteRecursively() }
        }
    }

    fun collect(context: Context): Capture = safely {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            collect(Build.VERSION.SDK_INT, System.currentTimeMillis(), "", context.cacheDir) { emptyList() }
        } else {
            val packageName = context.packageName
            val mainProcessName = context.applicationInfo.processName?.takeIf { it.isNotBlank() } ?: packageName
            collect(Build.VERSION.SDK_INT, System.currentTimeMillis(), mainProcessName, context.cacheDir) {
                val manager = context.getSystemService(ActivityManager::class.java) ?: throw IllegalStateException()
                manager.getHistoricalProcessExitReasons(packageName, 0, MAX_RECORDS).take(MAX_RECORDS).map { exit ->
                    Record(exit.processName, exit.pid, exit.timestamp, exit.reason, exit.status,
                        exit.importance, exit.pss, exit.rss) { exit.traceInputStream }
                }
            }
        }
    }

    internal fun collect(
        sdkInt: Int,
        nowMillis: Long,
        mainProcessName: String,
        cacheRoot: File,
        read: () -> List<Record>,
    ): Capture {
        var directory: File? = null
        return safely(onFailure = { runCatching { directory?.deleteRecursively() } }) {
            val root = File(cacheRoot, "native-crash-export-${UUID.randomUUID()}")
            directory = root
            if (!root.mkdir()) throw IOException()
            val trace = File(root, "trace.bin")
            var selected: Record? = null
            val outcome = if (sdkInt < MIN_API) Outcome("unsupported") else {
                try {
                    selected = read().take(MAX_RECORDS)
                        .filter { it.processName == mainProcessName && it.reason == NATIVE_CRASH }
                        .maxByOrNull { it.timestampMillis }
                    selected?.let { copyTrace(it, trace) } ?: Outcome("no-native-crash")
                } catch (error: Exception) {
                    Outcome("query-failed", error = errorType(error))
                } catch (error: LinkageError) {
                    Outcome("query-failed", error = errorType(error))
                }
            }
            val summary = buildString {
                append("Native crash trace status=${outcome.status}")
                outcome.error?.let { append(" error=$it") }
            }
            val info = File(root, "info.txt")
            info.writeText(buildString {
                appendLine(summary)
                appendLine("format=tiplay-native-crash-v1 sdkInt=$sdkInt requiresApi=$MIN_API")
                appendLine("scope=own-package-main-process historyLimit=$MAX_RECORDS maxBytes=$MAX_TRACE_BYTES")
                selected?.let { exit ->
                    val age = if (exit.timestampMillis > 0 && exit.timestampMillis <= nowMillis)
                        (nowMillis - exit.timestampMillis).toString() else "unknown"
                    appendLine("exitEpochMillis=${exit.timestampMillis} ageMs=$age pid=${exit.pid} " +
                        "reasonCode=${exit.reason} status=${exit.status} importance=${exit.importance} " +
                        "pssKiB=${exit.pssKiB.coerceAtLeast(0)} rssKiB=${exit.rssKiB.coerceAtLeast(0)}")
                }
                appendLine("observedTraceBytes=${outcome.bytes}")
                appendLine("traceFormat=system-provided-bytes expectedFormat=android-tombstone-protobuf validation=not-performed")
                appendLine("A retained ANR trace may be returned instead; decode and match the crash identity before attribution.")
                appendLine("Debug evidence may contain registers, memory and paths; no trace text is added to Standard reports.")
            })
            Capture(buildMap {
                put("native-crash/info.txt", info)
                if (outcome.status == "collected") put("native-crash/trace.bin", trace)
            }, summary, root)
        }
    }

    private data class Outcome(val status: String, val bytes: Long = 0, val error: String? = null)

    private fun copyTrace(record: Record, target: File): Outcome {
        var observed = 0L
        val outcome = try {
            record.openTrace()?.use { input ->
                target.outputStream().buffered().use outputUse@ { output ->
                    val buffer = ByteArray(32 * 1024)
                    while (true) {
                        // Read at most one byte beyond the cap to detect excess, without writing it.
                        val count = input.read(buffer, 0, minOf(buffer.size.toLong(), MAX_TRACE_BYTES + 1 - observed).toInt())
                        if (count < 0) break
                        val size = if (count == 0) {
                            val one = input.read()
                            if (one < 0) break
                            buffer[0] = one.toByte()
                            1
                        } else count
                        observed += size
                        if (observed > MAX_TRACE_BYTES) return@outputUse Outcome("trace-too-large", observed)
                        output.write(buffer, 0, size)
                    }
                    Outcome(if (observed == 0L) "trace-empty" else "collected", observed)
                }
            } ?: Outcome("trace-unavailable")
        } catch (error: Exception) {
            Outcome("trace-read-failed", observed, errorType(error))
        } catch (error: LinkageError) {
            Outcome("trace-read-failed", observed, errorType(error))
        }
        if (outcome.status != "collected" && target.exists() && !target.delete()) throw IOException()
        return outcome
    }

    private inline fun safely(onFailure: () -> Unit = {}, action: () -> Capture): Capture = try {
        action()
    } catch (error: Exception) {
        onFailure()
        Capture(emptyMap(), "Native crash trace status=unavailable error=${errorType(error)}")
    } catch (error: LinkageError) {
        onFailure()
        Capture(emptyMap(), "Native crash trace status=unavailable error=${errorType(error)}")
    }

    private fun errorType(error: Throwable): String = error.javaClass.simpleName.take(80)
        .replace(Regex("[^A-Za-z0-9_$]"), "?").ifEmpty { "Throwable" }
}
