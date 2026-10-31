package com.shilapi.xcertplay.diagnostics

import com.github.luben.zstd.ZstdOutputStreamNoFinalizer
import java.io.File
import java.io.FilterOutputStream
import java.io.OutputStream
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/** Zstandard compresses during capture. ZIP is only a STORED packaging container. */
internal object CompressedTrafficArchive {
    fun write(output: OutputStream, logName: String, report: String, snapshots: List<RawTraffic.Snapshot>, root: File,
              attachments: Map<String, File> = emptyMap()) {
        val extraEntries = archiveAttachmentEntries(attachments,
            listOf("$logName.zst", "capture.txt.zst") + snapshots.map { "captures/${it.name}" })
        val directory = java.nio.file.Files.createTempDirectory(root.toPath(), "traffic-export-").toFile()
        try {
            val entries = mutableListOf<Pair<String, File>>()
            fun text(name: String, value: String) {
                val target = File(directory, "text-${entries.size}.zst")
                ZstdOutputStreamNoFinalizer(target.outputStream(), RawTraffic.COMPRESSION_LEVEL).use { it.write(value.toByteArray(Charsets.UTF_8)) }
                entries.add("$name.zst" to target)
            }
            text(logName, report)
            text("capture.txt", snapshots.firstOrNull()?.status.orEmpty() + "\n" +
                "format=zstd-frames-tsv-base64-v1 compression=zstd-level-${RawTraffic.COMPRESSION_LEVEL}\n" +
                "All ZIP entries are STORED. Decompress .zst files with zstd -dc.\n" +
                "TSV: epochMillis, process-local sequence, channel, byte count, Base64 payload.\n" +
                "capture/start identifies a session. Each process has a separate file; read in file order.\n" +
                "A crash may interrupt the last frame of a process file; earlier completed frames remain recoverable.\n" +
                "Current-process integrity does not establish previous-process completeness. No redaction.\n")
            snapshots.forEachIndexed { index, snapshot ->
                val copy = File(directory, "capture-$index.zst")
                copy.outputStream().buffered().use { destination -> snapshot.open().use { it.copyTo(destination) } }
                entries.add("captures/${snapshot.name}" to copy)
            }
            extraEntries.forEachIndexed { index, (name, source) ->
                val copy = File(directory, "attachment-$index.zst")
                ZstdOutputStreamNoFinalizer(copy.outputStream(), RawTraffic.COMPRESSION_LEVEL).use { compressed ->
                    source.inputStream().use { it.copyTo(compressed) }
                }
                entries.add(name to copy)
            }
            ZipOutputStream(object : FilterOutputStream(output) {
                override fun close() = flush()
                override fun write(bytes: ByteArray, offset: Int, length: Int) = out.write(bytes, offset, length)
            }).use { zip ->
                entries.forEach { (name, file) ->
                    val crc = CRC32()
                    file.inputStream().buffered().use { input ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            crc.update(buffer, 0, count)
                        }
                    }
                    zip.putNextEntry(ZipEntry(name).apply {
                        method = ZipEntry.STORED; size = file.length(); compressedSize = size; this.crc = crc.value
                    })
                    file.inputStream().use { it.copyTo(zip) }; zip.closeEntry()
                }
            }
        } finally { directory.deleteRecursively() }
    }
}
