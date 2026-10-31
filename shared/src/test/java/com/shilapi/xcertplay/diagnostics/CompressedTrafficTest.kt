package com.shilapi.xcertplay.diagnostics

import com.github.luben.zstd.ZstdInputStream
import java.nio.file.Files
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.ZipInputStream
import java.util.zip.ZipEntry
import java.io.FileInputStream
import java.io.OutputStream
import java.io.InputStream
import java.io.IOException
import org.junit.Assert.*
import org.junit.Test

class CompressedTrafficTest {
    @Test fun sourceReadFailureIsNotMisclassifiedAsStagingFailure() {
        val root = Files.createTempDirectory("capture-source-failure-").toFile()
        val failure = IOException("source descriptor unavailable")
        val input = object : InputStream() {
            override fun read(): Int = throw failure
            override fun read(bytes: ByteArray, offset: Int, length: Int): Int = throw failure
        }
        val snapshot = RawTraffic.Snapshot(input, 10, "test", true, "raw-traffic-source.tsv.zst")
        try {
            val thrown = assertThrows(IOException::class.java) {
                CompressedTrafficArchive.write(ByteArrayOutputStream(), "report.txt", "report", listOf(snapshot), root)
            }
            assertSame(failure, thrown)
            assertFalse(thrown is ArchiveStagingException)
            assertTrue(root.listFiles().orEmpty().isEmpty())
        } finally { snapshot.close(); root.deleteRecursively() }
    }

    @Test fun archiveReplaysTheOwnedDescriptorAfterUnlinkWithoutCopyingTheJournal() {
        val root = Files.createTempDirectory("capture-descriptor-").toFile()
        val raw = root.resolve("raw-traffic-owned.tsv.zst")
        val payload = ByteArray(256 * 1024) { (it * 17).toByte() }
        raw.writeBytes(payload)
        val snapshot = RawTraffic.Snapshot(FileInputStream(raw), payload.size.toLong(), "test", true, raw.name)
        val bytes = ByteArrayOutputStream()
        var replaced = false
        val output = object : OutputStream() {
            override fun write(value: Int) { write(byteArrayOf(value.toByte()), 0, 1) }
            override fun write(buffer: ByteArray, offset: Int, length: Int) {
                if (!replaced) {
                    replaced = true
                    assertTrue(raw.delete())
                    raw.writeText("replacement pathname must not be reopened")
                }
                assertFalse(root.walkTopDown().any { it.name.startsWith("capture-") && it.name.endsWith(".zst") })
                bytes.write(buffer, offset, length)
            }
        }
        try {
            CompressedTrafficArchive.write(output, "report.txt", "report", listOf(snapshot), root)
            var recovered: ByteArray? = null
            ZipInputStream(bytes.toByteArray().inputStream()).use { zip ->
                while (true) { val entry = zip.nextEntry ?: break
                    if (entry.name.startsWith("captures/")) recovered = zip.readBytes()
                }
            }
            assertArrayEquals(payload, recovered)
            assertEquals("replacement pathname must not be reopened", raw.readText())
        } finally { snapshot.close(); root.deleteRecursively() }
    }
    @Test fun liveFramesRemainReadableBeforeStopAndExportCopiesThemWithoutRecompression() {
        val root = Files.createTempDirectory("capture-zstd").toFile()
        val raw = root.resolve("raw-traffic-test.tsv.zst")
        try {
            RawTraffic.configure(raw, true, ingressOnly = true, compressed = true)
            val payload = ByteArray(100_000) { (it % 31).toByte() }
            RawTraffic.record("iphone/test/in", payload)
            RawTraffic.record("android-audio/track/out", payload)
            RawTraffic.record("iphone/test/out/attempt", payload)
            val live = ZstdInputStream(raw.inputStream()).use { it.readBytes().toString(Charsets.UTF_8) }
            val captured = live.lines().filter { "\tiphone/test/in\t" in it }
                .flatMap { Base64.getDecoder().decode(it.split('\t')[4]).toList() }.toByteArray()
            assertArrayEquals(payload, captured)
            assertFalse(live.contains("android-audio"))
            val before = raw.readBytes()
            val attachmentBytes = byteArrayOf(0, 1, 2, -1, 0, 99)
            val attachment = root.resolve("tombstone.pb").apply { writeBytes(attachmentBytes) }
            val archive = ByteArrayOutputStream()
            RawTraffic.writeArchive(archive, "report.txt", "Android and webpage logs", root,
                mapOf("native-crash/tombstone.pb" to attachment))
            ZipInputStream(archive.toByteArray().inputStream()).use { zip ->
                var count = 0
                while (true) {
                    val entry = zip.nextEntry ?: break
                    assertEquals(ZipEntry.STORED, entry.method)
                    val bytes = zip.readBytes()
                    if (entry.name.startsWith("captures/")) assertArrayEquals(before, bytes)
                    else if (entry.name == "native-crash/tombstone.pb.zst") {
                        assertArrayEquals(attachmentBytes, ZstdInputStream(bytes.inputStream()).use { it.readBytes() })
                    }
                    else assertTrue(ZstdInputStream(bytes.inputStream()).use { it.readBytes() }.isNotEmpty())
                    count++
                }
                assertEquals(4, count)
            }
            assertArrayEquals(attachmentBytes, attachment.readBytes())
            assertTrue(RawTraffic.enabled)
        } finally { RawTraffic.configure(raw, false); root.deleteRecursively() }
    }

    @Test fun retainedProcessesExportTogetherAndClearRemovesAllCaptures() {
        val root = Files.createTempDirectory("capture-restart").toFile()
        val first = root.resolve("raw-traffic-first.tsv.zst")
        val second = root.resolve("raw-traffic-second.tsv.zst")
        try {
            RawTraffic.configure(first, true, compressed = true)
            RawTraffic.record("browser/control/in", byteArrayOf(1, 2, 3))
            RawTraffic.configure(first, false, compressed = true)
            RawTraffic.configure(second, true, compressed = true)
            val archive = ByteArrayOutputStream()
            RawTraffic.writeArchive(archive, "report.txt", "logs", root)
            val names = mutableListOf<String>()
            ZipInputStream(archive.toByteArray().inputStream()).use { zip ->
                while (true) { val entry = zip.nextEntry ?: break; names.add(entry.name) }
            }
            assertTrue(names.contains("captures/${first.name}"))
            assertTrue(names.contains("captures/${second.name}"))
            RawTraffic.clear()
            assertFalse(first.exists())
            assertTrue(second.exists())
        } finally { RawTraffic.configure(second, false); root.deleteRecursively() }
    }
}
