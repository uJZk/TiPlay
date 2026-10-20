package com.shilapi.xcertplay.diagnostics

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Base64

class RawTrafficTest {
    @Test fun archiveReopensEvictedChannelsWithoutLosingOrReorderingTheirBytes() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-many-channels").toFile()
        val file = File(directory, "capture.tsv")
        try {
            RawTraffic.configure(file, true)
            repeat(3) { round -> repeat(35) { channel ->
                RawTraffic.record("test/channel-$channel", byteArrayOf(round.toByte(), channel.toByte()))
            } }
            val output = ByteArrayOutputStream()
            RawTraffic.writeArchive(output, "report.txt", "summary", directory)
            val entries = linkedMapOf<String, ByteArray>()
            java.util.zip.ZipInputStream(output.toByteArray().inputStream()).use { zip ->
                while (true) { val entry = zip.nextEntry ?: break; entries[entry.name] = zip.readBytes() }
            }
            entries.getValue("streams.tsv").toString(Charsets.UTF_8).lines().drop(1).filter { it.isNotEmpty() }.forEach { line ->
                val fields = line.split('\t')
                val name = String(Base64.getDecoder().decode(fields[1]))
                if (name.startsWith("test/channel-")) {
                    val channel = name.substringAfterLast('-').toInt().toByte()
                    assertArrayEquals(byteArrayOf(0, channel, 1, channel, 2, channel), entries.getValue(fields[0]))
                }
            }
            assertTrue(directory.listFiles()!!.none { it.name.startsWith("traffic-export-") })
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

    @Test fun writeFailureHasAnExplicitBoundaryAndRecoveryRetainsTheActiveSessionMetadata() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-failure").toFile()
        val blocker = File(directory, "blocked-parent").apply { writeText("blocked") }
        val file = File(blocker, "capture.tsv")
        try {
            RawTraffic.configure(file, true, "version=failure-recovery")
            RawTraffic.record("iphone/private-host/in", byteArrayOf(1, 2, 3))
            assertTrue(blocker.delete())
            assertTrue(blocker.mkdir())
            RawTraffic.record("iphone/in", byteArrayOf(9, 8))
            val output = ByteArrayOutputStream()
            RawTraffic.writeArchive(output, "report.txt", "summary", directory)
            val entries = linkedMapOf<String, ByteArray>()
            java.util.zip.ZipInputStream(output.toByteArray().inputStream()).use { zip ->
                while (true) { val entry = zip.nextEntry ?: break; entries[entry.name] = zip.readBytes() }
            }
            val status = entries.getValue("capture.txt").toString(Charsets.UTF_8)
            assertTrue(status, status.contains("coverage=partial"))
            assertTrue(status, status.contains("lastFailureSource=iphone"))
            assertTrue(status, status.contains("durability=application-flush"))
            assertFalse(status, status.contains("firstFailureEpochMillis=0"))
            assertFalse(status, status.contains("private-host"))
            val sessionLines = entries.getValue("sessions.tsv").toString(Charsets.UTF_8).trim().lines()
            assertEquals(2, sessionLines.size)
            assertTrue(String(Base64.getDecoder().decode(sessionLines[1].split('\t')[2])).contains("version=failure-recovery"))
            assertTrue(entries.values.any { it.contentEquals(byteArrayOf(9, 8)) })
            RawTraffic.clear()
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

    @Test fun changingActiveDestinationStartsANewSessionAndFlushesTheOldFile() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-destination").toFile()
        val first = File(directory, "first.tsv")
        val second = File(directory, "second.tsv")
        try {
            RawTraffic.configure(first, true, "version=first")
            val firstSession = RawTraffic.activeSessionId()
            RawTraffic.record("iphone/in", byteArrayOf(1))
            RawTraffic.configure(second, true, "version=second")
            assertNotEquals(firstSession, RawTraffic.activeSessionId())
            RawTraffic.record("iphone/in", byteArrayOf(2))
            assertTrue(first.readLines().any { it.split('\t')[2] == "iphone/in" })
            assertEquals("capture/start", second.readLines().first().split('\t')[2])
            assertTrue(String(Base64.getDecoder().decode(second.readLines().first().split('\t')[4])).contains("version=second"))
        } finally { RawTraffic.configure(second, false); directory.deleteRecursively() }
    }

    @Test fun fullPayloadSurvivesChunkingDisableAndExportWithoutRedaction() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-test").toFile()
        val file = File(directory, "capture.tsv")
        try {
            RawTraffic.configure(file, true)
            val bytes = ByteArray(131_073) { (it % 256).toByte() }
            RawTraffic.record("iphone/in", bytes)
            RawTraffic.record("browser/in", "password=secret code=1234 http://192.168.1.2".toByteArray())
            RawTraffic.record("iphone/in", byteArrayOf(7, 8))
            RawTraffic.configure(file, false)
            RawTraffic.record("ignored", bytes)
            val output = ByteArrayOutputStream()
            RawTraffic.writeArchive(output, "TiPlay-test.txt", "summary", directory)
            val entries = linkedMapOf<String, ByteArray>()
            java.util.zip.ZipInputStream(output.toByteArray().inputStream()).use { zip ->
                while (true) { val entry = zip.nextEntry ?: break; entries[entry.name] = zip.readBytes() }
            }
            val streams = entries.getValue("streams.tsv").toString(Charsets.UTF_8).lines().drop(1)
                .filter { it.isNotEmpty() }.associate { line ->
                    val fields = line.split('\t')
                    String(Base64.getDecoder().decode(fields[1])) to fields[0]
                }
            assertArrayEquals(bytes + byteArrayOf(7, 8), entries.getValue(streams.getValue("iphone/in")))
            assertEquals("password=secret code=1234 http://192.168.1.2",
                entries.getValue(streams.getValue("browser/in")).toString(Charsets.UTF_8))
            assertFalse(streams.containsKey("ignored"))
            assertTrue(entries.getValue("capture.txt").toString(Charsets.UTF_8).contains("failures=0"))
            assertEquals("summary", entries.getValue("TiPlay-test.txt").toString(Charsets.UTF_8))
            val events = entries.getValue("events.tsv").toString(Charsets.UTF_8).lines().drop(1).filter { it.isNotEmpty() }
            val offsets = mutableMapOf<String, Long>()
            events.forEach { line ->
                val fields = line.split('\t')
                assertTrue(fields[0].toLong() > 0)
                assertTrue(fields[1].toLong() > 0)
                assertEquals(offsets.getOrDefault(fields[2], 0L), fields[3].toLong())
                offsets[fields[2]] = fields[3].toLong() + fields[4].toInt()
            }
            assertTrue(directory.listFiles()!!.none { it.name.startsWith("traffic-export-") })
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

    @Test fun eachEnableStartsASessionAndClearKeepsSavedArchiveWhileRestartingActiveCapture() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-session").toFile()
        val file = File(directory, "capture.tsv")
        try {
            RawTraffic.configure(file, true, "version=test config=all")
            RawTraffic.record("iphone/in", byteArrayOf(42))
            RawTraffic.configure(file, true, "ignored") // Reopening settings must not create another session.
            RawTraffic.configure(file, false)
            RawTraffic.configure(file, true, "version=test config=all")
            RawTraffic.record("iphone/in", byteArrayOf(43))
            val saved = ByteArrayOutputStream()
            RawTraffic.writeArchive(saved, "report.txt", "summary", directory)
            val entries = linkedMapOf<String, ByteArray>()
            java.util.zip.ZipInputStream(saved.toByteArray().inputStream()).use { zip ->
                while (true) { val entry = zip.nextEntry ?: break; entries[entry.name] = zip.readBytes() }
            }
            assertEquals(3, entries.getValue("sessions.tsv").toString(Charsets.UTF_8).trim().lines().size)
            val channels = entries.getValue("streams.tsv").toString(Charsets.UTF_8).trim().lines().drop(1)
                .map { it.split('\t') }.filter { String(Base64.getDecoder().decode(it[1])) == "iphone/in" }
            assertEquals(2, channels.size)
            assertArrayEquals(byteArrayOf(42), entries.getValue(channels[0][0]))
            assertArrayEquals(byteArrayOf(43), entries.getValue(channels[1][0]))
            val snapshotBytes = saved.toByteArray()
            RawTraffic.clear()
            assertTrue(RawTraffic.enabled)
            assertArrayEquals(snapshotBytes, saved.toByteArray())
            val remaining = file.readLines().map { it.split('\t') }
            assertEquals(listOf("capture/start"), remaining.map { it[2] })
            assertTrue(String(Base64.getDecoder().decode(remaining.single()[4])).contains("version=test config=all"))
            RawTraffic.configure(file, false)
            RawTraffic.clear()
            assertFalse(file.exists())
            assertFalse(RawTraffic.enabled)
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

    @Test fun interruptedCaptureIsPreservedAndDoesNotPreventLaterSessionExports() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-corrupt").toFile()
        val file = File(directory, "capture.tsv")
        try {
            RawTraffic.configure(file, true)
            RawTraffic.record("iphone/in", byteArrayOf(1, 2, 3))
            RawTraffic.configure(file, false)
            file.appendText("incomplete-record")
            RawTraffic.configure(file, true)
            RawTraffic.record("browser/in", byteArrayOf(9, 8))
            val output = ByteArrayOutputStream()
            RawTraffic.writeArchive(output, "report.txt", "summary", directory)
            val entries = linkedMapOf<String, ByteArray>()
            java.util.zip.ZipInputStream(output.toByteArray().inputStream()).use { zip ->
                while (true) { val entry = zip.nextEntry ?: break; entries[entry.name] = zip.readBytes() }
            }
            assertEquals("incomplete-record\n", entries.getValue("unparsed.tsv").toString(Charsets.UTF_8))
            assertTrue(entries.getValue("capture.txt").toString(Charsets.UTF_8).contains("unparsedRecords=1"))
            assertTrue(entries.values.any { it.contentEquals(byteArrayOf(1, 2, 3)) })
            assertTrue(entries.values.any { it.contentEquals(byteArrayOf(9, 8)) })
            assertTrue(directory.listFiles()!!.none { it.isDirectory })
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

    @Test fun wrappingStreamsRetainsOnlyReadRangeAndSuccessfulOutputBytes() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-stream").toFile()
        val file = File(directory, "capture.tsv")
        try {
            RawTraffic.configure(file, true)
            val input = RawTraffic.input("browser/in", ByteArrayInputStream(byteArrayOf(1, 2, 3)))
            val bytes = ByteArray(10) { 99 }
            assertEquals(3, input.read(bytes, 4, 5))
            assertEquals(-1, input.read())
            val sink = ByteArrayOutputStream()
            RawTraffic.output("car/out", sink).write(bytes, 4, 3)
            RawTraffic.configure(file, false)
            val records = file.readLines().map { it.split('\t') }
            assertArrayEquals(byteArrayOf(1, 2, 3), Base64.getDecoder().decode(records.single { it[2] == "browser/in" }[4]))
            assertArrayEquals(sink.toByteArray(), Base64.getDecoder().decode(records.single { it[2] == "car/out/written" }[4]))
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }
}
