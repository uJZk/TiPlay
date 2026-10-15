package com.shilapi.xcertplay.diagnostics

import java.io.File
import java.io.OutputStream
import java.util.Base64
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Splits an immutable raw snapshot on disk; neither payloads nor the event index accumulate in RAM. */
internal object RawTrafficArchive {
    fun write(output: OutputStream, logName: String, report: String, snapshot: RawTraffic.Snapshot, temporaryRoot: File) {
        val directory = java.nio.file.Files.createTempDirectory(temporaryRoot.toPath(), "traffic-export-").toFile()
        data class Stream(val channel: String, val name: String, val file: File, var length: Long = 0)
        val streams = linkedMapOf<String, Stream>()
        val sessions = linkedMapOf<String, Pair<String, String>>()
        var session = "legacy"
        var unparsedRecords = 0L
        try {
            val index = File(directory, "events.tsv")
            val unparsed = File(directory, "unparsed.tsv")
            unparsed.bufferedWriter().use { rejected ->
                index.bufferedWriter().use { writer ->
                    writer.append("epochMillis\tsequence\tstream\toffset\tlength\n")
                    snapshot.open().bufferedReader().useLines { lines ->
                        lines.forEach { line ->
                            // Interrupted writes remain available verbatim for analysis; never silently omit them.
                            val decoded = runCatching {
                                val fields = line.split('\t', limit = 5)
                                check(fields.size == 5)
                                check(fields[0].toLong() >= 0 && fields[1].toLong() > 0)
                                val bytes = Base64.getDecoder().decode(fields[4])
                                check(bytes.size == fields[3].toInt())
                                fields to bytes
                            }.getOrNull()
                            if (decoded == null) {
                                unparsedRecords++
                                rejected.append(line).append('\n')
                                return@forEach
                            }
                            val (fields, bytes) = decoded
                            val (time, sequence, channel, _, encoded) = fields
                            if (channel == "capture/start") {
                                session = Regex("(?:^| )session=([A-Za-z0-9-]+)").find(bytes.toString(Charsets.UTF_8))
                                    ?.groupValues?.get(1) ?: "legacy-${sessions.size + 1}"
                                sessions[session] = time to encoded
                            }
                            sessions.putIfAbsent(session, time to "")
                            val stream = streams.getOrPut("$session\u0000$channel") {
                                val extension = if (channel.contains("/pcm16le/")) "pcm" else "bin"
                                val label = channel.replace(Regex("[^A-Za-z0-9._-]+"), "-").take(80)
                                val name = "streams/$session/${streams.size + 1}-$label.$extension"
                                Stream(channel, name, File(directory, "stream-${streams.size + 1}"))
                            }
                            stream.file.appendBytes(bytes)
                            writer.append("$time\t$sequence\t${stream.name}\t${stream.length}\t${bytes.size}\n")
                            stream.length += bytes.size
                        }
                    }
                }
            }
            // Free the compressor without closing the caller's destination stream.
            ZipOutputStream(object : java.io.FilterOutputStream(output) {
                override fun close() = flush()
                override fun write(bytes: ByteArray, offset: Int, length: Int) = out.write(bytes, offset, length)
            }).use { zip ->
                fun entry(name: String, write: () -> Unit) {
                    zip.putNextEntry(ZipEntry(name)); write(); zip.closeEntry()
                }
                entry(logName) { zip.write(report.toByteArray(Charsets.UTF_8)) }
                entry("capture.txt") {
                    zip.write((snapshot.status + "unparsedRecords=$unparsedRecords\n" + """
                        |format=raw-streams-v1
                        |events.tsv: epochMillis (UTC Unix milliseconds), process-local sequence, stream path, byte offset, byte length.
                        |streams.tsv: stream path, original channel (Base64 UTF-8), bytes. Channels identify direction and protocol/configuration.
                        |sessions.tsv: session ID, start time, Base64 UTF-8 capture/start metadata (app version/configuration and process UUID).
                        |Read events in file order; each enable creates a new session. Sequence numbers are process-local.
                        |Each stream concatenates captured bytes in order. /attempt and /written are separate streams, not duplicate delivery.
                        |.bin is application-visible protocol/opaque data, not a playable media file or a bus packet capture.
                        |.pcm is headerless PCM16 little endian; use the rate/configuration in the decoded channel label.
                        |Snapshots include retained sessions. Debug defaults off in each new process. Saving retains data; Clear removes raw history and starts a new session if active.
                        |unparsed.tsv (when present) retains malformed/interrupted source lines, normalized with LF delimiters. They are excluded from streams/indexes; unparsedRecords > 0 means incomplete reconstruction.
                        |No redaction. A successful ZIP does not establish capture or radio/bus completeness; check failures and unparsedRecords above.
                        |""".trimMargin()).toByteArray(Charsets.UTF_8))
                }
                entry("sessions.tsv") {
                    zip.write("session\tstartEpochMillis\tconfigurationBase64\n".toByteArray())
                    sessions.forEach { (id, metadata) ->
                        zip.write("$id\t${metadata.first}\t${metadata.second}\n".toByteArray())
                    }
                }
                if (unparsedRecords > 0) entry("unparsed.tsv") { unparsed.inputStream().use { it.copyTo(zip) } }
                entry("events.tsv") { index.inputStream().use { it.copyTo(zip) } }
                entry("streams.tsv") {
                    zip.write("stream\tchannelBase64\tbytes\n".toByteArray())
                    streams.values.forEach { stream ->
                        val encoded = Base64.getEncoder().encodeToString(stream.channel.toByteArray(Charsets.UTF_8))
                        zip.write("${stream.name}\t$encoded\t${stream.length}\n".toByteArray())
                    }
                }
                streams.values.forEach { stream -> entry(stream.name) { stream.file.inputStream().use { it.copyTo(zip) } } }
            }
        } finally { directory.deleteRecursively() }
    }
}
