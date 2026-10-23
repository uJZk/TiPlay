package com.shilapi.xcertplay.diagnostics

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class RawTrafficTest {
    @Test fun timingIsSessionScopedCoversSessionWritesAndSurvivesExportWithoutPayloads() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-timing").toFile()
        val file = File(directory, "capture.tsv")
        fun timing() = RawTraffic.integrity().getValue("timing") as Map<*, *>
        try {
            RawTraffic.configure(file, true)
            val capture = requireNotNull(RawTraffic.activeSessionId())
            assertEquals(1L, timing()["completedCalls"])
            RawTraffic.record("iphone/private-peer/in", byteArrayOf(1, 2))
            assertTrue(RawTraffic.recordForSession(capture, "browser/private-peer/out", byteArrayOf(3)))
            assertFalse(RawTraffic.recordForSession("stale", "browser/out", byteArrayOf(4)))
            RawTraffic.record("empty", byteArrayOf())
            assertEquals(3L, timing()["completedCalls"])
            assertTrue((timing()["appendTotalMs"] as Double) > 0)
            RawTraffic.configure(file, false)
            assertEquals(4L, timing()["completedCalls"])
            RawTraffic.record("ignored", byteArrayOf(5))
            assertEquals(4L, timing()["completedCalls"])
            val archive = ByteArrayOutputStream()
            RawTraffic.writeArchive(archive, "report.txt", "summary", directory)
            java.util.zip.ZipInputStream(archive.toByteArray().inputStream()).use { zip ->
                var status: String? = null
                while (true) {
                    val entry = zip.nextEntry ?: break
                    val bytes = zip.readBytes()
                    if (entry.name == "capture.txt") status = bytes.toString(Charsets.UTF_8)
                }
                assertTrue(requireNotNull(status).contains("RAW_CAPTURE_TIMING scope=current-or-last-capture-session completedCalls=4"))
                assertFalse(requireNotNull(status).contains("private-peer"))
            }
            RawTraffic.configure(file, true)
            assertEquals(1L, timing()["completedCalls"])
            RawTraffic.record("iphone/in", byteArrayOf(6))
            RawTraffic.clear()
            assertEquals(1L, timing()["completedCalls"])
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

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
            val initialTiming = RawTraffic.integrity()["timing"] as Map<*, *>
            assertEquals("The failed initial append is still a completed capture call", 1L, initialTiming["completedCalls"])
            RawTraffic.record("iphone/private-host/in", byteArrayOf(1, 2, 3))
            val failedTiming = RawTraffic.integrity()["timing"] as Map<*, *>
            assertTrue((failedTiming["completedCalls"] as Long) > (initialTiming["completedCalls"] as Long))
            assertTrue((failedTiming["appendTotalMs"] as Double) > 0)
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

    @Test fun delayedSessionWriteCannotCrossClearOrDisableEvenAfterItHasStartedWaitingForTheDiskMonitor() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-session-gate").toFile()
        val file = File(directory, "capture.tsv")
        val workers = Executors.newSingleThreadExecutor()
        try {
            RawTraffic.configure(file, true)
            val original = requireNotNull(RawTraffic.activeSessionId())
            val field = RawTraffic::class.java.getDeclaredField("lock").apply { isAccessible = true }
            val diskMonitor = field.get(RawTraffic)
            fun delayedAcross(expectedSession: String, boundary: () -> Unit): Boolean {
                val waiting = CountDownLatch(1)
                val writerThread = java.util.concurrent.atomic.AtomicReference<Thread>()
                val delayed = synchronized(diskMonitor) {
                    val write = workers.submit<Boolean> {
                        writerThread.set(Thread.currentThread())
                        waiting.countDown()
                        RawTraffic.recordForSession(expectedSession, "browser/video-diagnostics", "old-report".toByteArray())
                    }
                    assertTrue(waiting.await(1, TimeUnit.SECONDS))
                    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1)
                    while (writerThread.get()?.state != Thread.State.BLOCKED && System.nanoTime() < deadline) Thread.yield()
                    assertEquals("The stale writer must already be waiting for the capture monitor", Thread.State.BLOCKED, writerThread.get()?.state)
                    boundary()
                    write
                }
                return delayed.get(1, TimeUnit.SECONDS)
            }
            assertFalse(delayedAcross(original) { RawTraffic.clear() })
            val current = requireNotNull(RawTraffic.activeSessionId())
            assertNotEquals(original, current)
            assertTrue(RawTraffic.recordForSession(current, "browser/video-diagnostics", "new-report".toByteArray()))
            assertFalse(delayedAcross(current) { RawTraffic.configure(file, false) })
            RawTraffic.configure(file, true)
            assertFalse(RawTraffic.recordForSession(current, "browser/video-diagnostics", "stale-enabled-report".toByteArray()))
            val records = file.readLines().map { it.split('\t') }.filter { it[2] == "browser/video-diagnostics" }
            assertEquals(listOf("new-report"), records.map { String(Base64.getDecoder().decode(it[4]), Charsets.UTF_8) })
        } finally {
            workers.shutdownNow(); workers.awaitTermination(1, TimeUnit.SECONDS)
            RawTraffic.configure(file, false); directory.deleteRecursively()
        }
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
    @Test fun referencedScreenInputKeepsOneCopyAndBindsExactJournalByteRanges() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-reference").toFile()
        val file = File(directory, "capture.tsv")
        try {
            RawTraffic.configure(file, true)
            val original = ByteArray(100_000) { it.toByte() }
            val input = RawTraffic.referencedInput("iphone/screen/in", original.inputStream())
            input.beginRange()
            val received = ByteArray(original.size)
            assertEquals(128, input.read(received, 0, 128))
            assertEquals(original.size - 128, input.read(received, 128, original.size - 128))
            val reference = requireNotNull(input.endRange())
            assertEquals(0L, reference.offset)
            assertEquals(original.size, reference.length)
            assertTrue(reference.lastSequence > reference.firstSequence)
            val annexB = byteArrayOf(0, 0, 0, 1, 5)
            RawTraffic.bindVideoReference(annexB, reference)
            assertSame(reference, RawTraffic.videoReference(annexB))
            val records = file.readLines().map { it.split('\t') }.filter { it[2] == "iphone/screen/in" }
            assertEquals(reference.firstSequence, records.first()[1].toLong())
            assertEquals(reference.lastSequence, records.last()[1].toLong())
            assertArrayEquals(original, records.flatMap { Base64.getDecoder().decode(it[4]).toList() }.toByteArray())
            assertEquals(true, RawTraffic.integrity()["complete"])
            assertEquals("decrypt-then-length-prefix-to-annexb", reference.fields()["captureTransform"])
            RawTraffic.clear()
            assertNull(RawTraffic.videoReference(annexB))
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

    @Test fun failedCaptureNeverReturnsAReferenceToUnstoredPayload() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-failed-reference").toFile()
        val file = File(directory, "capture.tsv")
        try {
            RawTraffic.configure(file, true)
            RawTraffic.clear()
            assertTrue(file.delete())
            assertTrue(file.mkdir()) // Opening a directory as the journal must fail.
            val input = RawTraffic.referencedInput("iphone/screen/in", byteArrayOf(1, 2, 3).inputStream())
            input.beginRange()
            assertArrayEquals(byteArrayOf(1, 2, 3), input.readBytes())
            assertNull(input.endRange())
            assertEquals(false, RawTraffic.integrity()["complete"])
            assertTrue((RawTraffic.integrity()["failures"] as Long) > 0L)
            assertTrue(file.delete())
            val recoveredInput = RawTraffic.referencedInput("iphone/screen/in", byteArrayOf(4).inputStream())
            recoveredInput.beginRange()
            assertEquals(4, recoveredInput.read())
            // Earlier partial appends may have changed exported offsets, so new successful bytes
            // still cannot claim exact references until the next capture session.
            assertNull(recoveredInput.endRange())
            RawTraffic.clear()
            val nextSession = RawTraffic.referencedInput("iphone/screen/in", byteArrayOf(5).inputStream())
            nextSession.beginRange()
            assertEquals(5, nextSession.read())
            assertNotNull(nextSession.endRange())
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

    @Test fun controlStatusReadsCompleteWhileTheCaptureDiskMonitorIsHeld() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-status-lock").toFile()
        val file = File(directory, "capture.tsv")
        val workers = Executors.newFixedThreadPool(2)
        val acquired = CountDownLatch(1)
        val release = CountDownLatch(1)
        try {
            RawTraffic.configure(file, true)
            RawTraffic.clear()
            val expectedSession = requireNotNull(RawTraffic.activeSessionId())
            val field = RawTraffic::class.java.getDeclaredField("lock").apply { isAccessible = true }
            val diskMonitor = field.get(RawTraffic)
            val holder = workers.submit {
                synchronized(diskMonitor) {
                    acquired.countDown()
                    release.await()
                }
            }
            assertTrue("Capture disk monitor must be held before reading status", acquired.await(1, TimeUnit.SECONDS))
            val status = workers.submit<Pair<String?, Map<String, Any?>>> {
                RawTraffic.activeSessionId() to RawTraffic.integrity()
            }.get(1, TimeUnit.SECONDS)
            assertEquals(expectedSession, status.first)
            assertEquals(true, status.second["enabled"])
            assertEquals(true, status.second["complete"])
            assertFalse("Status must finish before the capture monitor is released", holder.isDone)
        } finally {
            release.countDown()
            workers.shutdownNow()
            workers.awaitTermination(1, TimeUnit.SECONDS)
            RawTraffic.configure(file, false)
            directory.deleteRecursively()
        }
    }

    @Test fun aSessionWriteIncludesTheOuterJournalMonitorWaitInItsTiming() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-timing-wait").toFile()
        val file = File(directory, "capture.tsv")
        val worker = Executors.newSingleThreadExecutor()
        val started = CountDownLatch(1)
        val writerThread = java.util.concurrent.atomic.AtomicReference<Thread>()
        try {
            RawTraffic.configure(file, true)
            val capture = requireNotNull(RawTraffic.activeSessionId())
            val before = RawTraffic.integrity()["timing"] as Map<*, *>
            val monitor = requireNotNull(RawTraffic::class.java.getDeclaredField("lock").apply { isAccessible = true }.get(RawTraffic))
            var blockedAt = 0L
            var releaseAt = 0L
            val write = synchronized(monitor) {
                val pending = worker.submit<Boolean> {
                    writerThread.set(Thread.currentThread())
                    started.countDown()
                    RawTraffic.recordForSession(capture, "browser/peer/out", byteArrayOf(1))
                }
                assertTrue(started.await(1, TimeUnit.SECONDS))
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1)
                while (writerThread.get()?.state != Thread.State.BLOCKED && System.nanoTime() < deadline) Thread.yield()
                assertEquals(Thread.State.BLOCKED, writerThread.get()?.state)
                blockedAt = System.nanoTime()
                // This status read must not wait for the writer or publish an unfinished append.
                assertEquals(before["completedCalls"], (RawTraffic.integrity()["timing"] as Map<*, *>)["completedCalls"])
                releaseAt = System.nanoTime()
                pending
            }
            assertTrue(write.get(1, TimeUnit.SECONDS))
            val after = RawTraffic.integrity()["timing"] as Map<*, *>
            val measuredWait = ((after["lockWaitTotalMs"] as Double) - (before["lockWaitTotalMs"] as Double)) * 1e6
            assertTrue("The completed call must include the observed blocked interval", measuredWait + 1 >= releaseAt - blockedAt)
            assertEquals((before["completedCalls"] as Long) + 1, after["completedCalls"])
        } finally {
            worker.shutdownNow(); worker.awaitTermination(1, TimeUnit.SECONDS)
            RawTraffic.configure(file, false); directory.deleteRecursively()
        }
    }

}
