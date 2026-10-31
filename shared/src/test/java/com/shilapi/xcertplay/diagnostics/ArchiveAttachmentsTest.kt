package com.shilapi.xcertplay.diagnostics

import com.github.luben.zstd.ZstdInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import org.junit.Assert.*
import org.junit.Test

class ArchiveAttachmentsTest {
    @Test fun bothFormatsExportCompressedAttachmentsWithoutARawJournalAndLeaveSourcesOwnedByTheCaller() {
        for (compressed in listOf(false, true)) {
            val root = Files.createTempDirectory("capture-attachments").toFile()
            val raw = root.resolve(if (compressed) "raw-traffic-test.tsv.zst" else "raw.tsv")
            val info = root.resolve("info.txt").apply { writeText("reason=native_crash\nstatus=11\n") }
            val payload = ByteArray(70_001) { (it * 31).toByte() }
            val tombstone = root.resolve("tombstone.pb").apply { writeBytes(payload) }
            try {
                RawTraffic.configure(raw, false, compressed = compressed)
                val output = ByteArrayOutputStream()
                RawTraffic.writeArchive(output, "report.txt", "original report", root,
                    linkedMapOf("native-crash/info.txt" to info, "native-crash/tombstone.pb" to tombstone))
                val entries = entries(output.toByteArray())
                assertArrayEquals(info.readBytes(), decompress(entries.getValue("native-crash/info.txt.zst")))
                assertArrayEquals(payload, decompress(entries.getValue("native-crash/tombstone.pb.zst")))
                val report = if (compressed) decompress(entries.getValue("report.txt.zst")) else entries.getValue("report.txt")
                assertEquals("original report", report.toString(Charsets.UTF_8))
                assertFalse(raw.exists())
                assertTrue(entries.keys.none { it.startsWith("captures/") || it.startsWith("streams/") })
                assertEquals("reason=native_crash\nstatus=11\n", info.readText())
                assertArrayEquals(payload, tombstone.readBytes())
                assertNoTemporaryExports(root)
            } finally { RawTraffic.configure(raw, false, compressed = compressed); root.deleteRecursively() }
        }
    }

    @Test fun unsafeNamesAndExistingEntryCollisionsAreRejectedWithoutDeletingTheAttachment() {
        for (compressed in listOf(false, true)) {
            val root = Files.createTempDirectory("capture-attachment-names").toFile()
            val raw = root.resolve(if (compressed) "raw-traffic-test.tsv.zst" else "raw.tsv")
            val info = root.resolve("info.txt").apply { writeText("retained") }
            try {
                RawTraffic.configure(raw, false, compressed = compressed)
                for (name in listOf("", "/absolute", "../info.txt", "native-crash/../info.txt",
                    "native-crash/./info.txt", "native-crash//info.txt", "native-crash\\info.txt", "C:/info.txt")) {
                    assertThrows(IllegalArgumentException::class.java) {
                        RawTraffic.writeArchive(ByteArrayOutputStream(), "report.txt", "report", root, mapOf(name to info))
                    }
                }
                val logName = if (compressed) "report.txt" else "native-crash/info.txt.zst"
                val name = if (compressed) "report.txt" else "native-crash/info.txt"
                assertThrows(IllegalArgumentException::class.java) {
                    RawTraffic.writeArchive(ByteArrayOutputStream(), logName, "report", root, mapOf(name to info))
                }
                if (compressed) {
                    RawTraffic.configure(raw, true, compressed = true)
                    assertThrows(IllegalArgumentException::class.java) {
                        RawTraffic.writeArchive(ByteArrayOutputStream(), "report.txt", "report", root,
                            mapOf("captures/${raw.name.removeSuffix(".zst")}" to info))
                    }
                }
                assertEquals("retained", info.readText())
                assertNoTemporaryExports(root)
            } finally { RawTraffic.configure(raw, false, compressed = compressed); root.deleteRecursively() }
        }
    }

    @Test fun aFailedArchiveWriteCleansTemporaryCompressionFilesButKeepsTheSourceAttachment() {
        for (compressed in listOf(false, true)) {
            val root = Files.createTempDirectory("capture-attachment-failure").toFile()
            val raw = root.resolve(if (compressed) "raw-traffic-test.tsv.zst" else "raw.tsv")
            val info = root.resolve("info.txt").apply { writeText("keep after failed export") }
            try {
                RawTraffic.configure(raw, false, compressed = compressed)
                val failure = object : OutputStream() {
                    override fun write(value: Int) { throw IOException("destination unavailable") }
                }
                assertThrows(IOException::class.java) {
                    RawTraffic.writeArchive(failure, "report.txt", "report", root, mapOf("native-crash/info.txt" to info))
                }
                assertEquals("keep after failed export", info.readText())
                assertNoTemporaryExports(root)
            } finally { RawTraffic.configure(raw, false, compressed = compressed); root.deleteRecursively() }
        }
    }

    private fun entries(bytes: ByteArray): Map<String, ByteArray> {
        val entries = linkedMapOf<String, ByteArray>()
        ZipInputStream(bytes.inputStream()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                assertEquals(ZipEntry.STORED, entry.method)
                assertEquals(entry.size, entry.compressedSize)
                assertNull(entries.put(entry.name, zip.readBytes()))
            }
        }
        return entries
    }

    private fun decompress(bytes: ByteArray) = ZstdInputStream(bytes.inputStream()).use { it.readBytes() }
    private fun assertNoTemporaryExports(root: File) =
        assertTrue(root.listFiles().orEmpty().none { it.name.startsWith("traffic-export-") })
}
