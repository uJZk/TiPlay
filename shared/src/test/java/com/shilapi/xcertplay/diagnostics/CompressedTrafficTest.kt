package com.shilapi.xcertplay.diagnostics

import com.github.luben.zstd.ZstdInputStream
import java.nio.file.Files
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.zip.ZipInputStream
import java.util.zip.ZipEntry
import org.junit.Assert.*
import org.junit.Test

class CompressedTrafficTest {
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
