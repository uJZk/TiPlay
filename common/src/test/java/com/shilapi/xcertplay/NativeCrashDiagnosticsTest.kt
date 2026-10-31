package com.shilapi.xcertplay

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.ContextWrapper
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

class NativeCrashDiagnosticsTest {
    private lateinit var cache: File

    @Before fun setup() { cache = Files.createTempDirectory("native-crash-test-").toFile() }
    @After fun cleanup() { cache.deleteRecursively() }

    private fun record(
        time: Long = 900,
        process: String = "private.main",
        reason: Int = 5,
        pid: Int = 42,
        trace: () -> InputStream? = { error("Unexpected trace read") },
    ) = NativeCrashDiagnostics.Record(process, pid, time, reason, 11, 125, 100, 200, trace)

    private fun collect(sdk: Int = 31, read: () -> List<NativeCrashDiagnostics.Record>) =
        NativeCrashDiagnostics.collect(sdk, 1_000, "private.main", cache, read)

    private fun NativeCrashDiagnostics.Capture.info() = requireNotNull(attachments["native-crash/info.txt"]).readText()

    @Test fun olderAndroidProducesAnExplicitManifestWithoutQueryingTheSystem() {
        collect(sdk = 30) { error("Must not query exit history") }.use { capture ->
            assertEquals(setOf("native-crash/info.txt"), capture.attachments.keys)
            assertTrue(capture.info().contains("status=unsupported"))
            assertTrue(capture.info().contains("requiresApi=31"))
        }
        assertTrue(cache.listFiles().orEmpty().isEmpty())
    }

    @Test fun onlyTheNewestMainProcessNativeExitWithinTheThreeRecordWindowIsRead() {
        var oldReads = 0
        var latestReads = 0
        val payload = byteArrayOf(0, 1, 2, 127, -1, 0)
        val stream = object : ByteArrayInputStream(payload) {
            var closed = false
            override fun close() { closed = true; super.close() }
        }
        val capture = collect {
            listOf(
                record(time = 700) { oldReads++; ByteArrayInputStream(byteArrayOf(9)) },
                record(time = 999, process = "private.main:service"),
                record(time = 900, pid = 77) { latestReads++; stream },
                record(time = 1_000),
            )
        }
        val files = capture.attachments.values.toList()
        try {
            assertEquals("Native crash trace status=collected", capture.summary)
            assertEquals(0, oldReads)
            assertEquals(1, latestReads)
            assertTrue(stream.closed)
            assertArrayEquals(payload, capture.attachments.getValue("native-crash/trace.bin").readBytes())
            val info = capture.info()
            assertTrue(info.contains("exitEpochMillis=900 ageMs=100 pid=77 reasonCode=5 status=11 importance=125"))
            assertTrue(info.contains("observedTraceBytes=6"))
            assertTrue(info.contains("validation=not-performed"))
            assertFalse(info.contains("private.main"))
        } finally { capture.close(); capture.close() }
        assertTrue(files.none(File::exists))
        assertTrue(cache.listFiles().orEmpty().isEmpty())
    }

    @Test fun javaAndSecondaryProcessCrashesDoNotOpenATrace() {
        collect {
            listOf(record(reason = 4), record(process = "private.main:service"), record(reason = 6), record())
        }.use { capture ->
            assertTrue(capture.summary.contains("status=no-native-crash"))
            assertEquals(setOf("native-crash/info.txt"), capture.attachments.keys)
        }
    }

    @Test fun nullAndEmptyTracesHaveDifferentStatesAndNoBinaryAttachment() {
        collect { listOf(record { null }) }.use { capture ->
            assertTrue(capture.summary.contains("status=trace-unavailable"))
            assertEquals(setOf("native-crash/info.txt"), capture.attachments.keys)
        }
        val empty = CountingStream(0)
        collect { listOf(record { empty }) }.use { capture ->
            assertTrue(capture.summary.contains("status=trace-empty"))
            assertEquals(setOf("native-crash/info.txt"), capture.attachments.keys)
            assertTrue(empty.closed)
            assertEquals(listOf("info.txt"), capture.attachments.values.first().parentFile.list().orEmpty().toList())
        }
    }

    @Test fun exactlyEightMiBIsKeptAndAnOversizedTraceIsOmittedInFull() {
        val exact = CountingStream(8L * 1024 * 1024)
        collect { listOf(record { exact }) }.use { capture ->
            assertTrue(capture.summary.contains("status=collected"))
            assertEquals(8L * 1024 * 1024, capture.attachments.getValue("native-crash/trace.bin").length())
            assertTrue(exact.closed)
        }
        val oversized = CountingStream(8L * 1024 * 1024 + 100_000)
        collect { listOf(record { oversized }) }.use { capture ->
            assertTrue(capture.summary.contains("status=trace-too-large"))
            assertTrue(capture.info().contains("observedTraceBytes=8388609"))
            assertEquals(8L * 1024 * 1024 + 1, oversized.emitted)
            assertTrue(oversized.closed)
            assertEquals(setOf("native-crash/info.txt"), capture.attachments.keys)
            assertEquals(listOf("info.txt"), capture.attachments.values.first().parentFile.list().orEmpty().toList())
        }
    }

    @Test fun failedReadsAndClosesRemoveThePartialFileAndNeverExposeExceptionMessages() {
        for (failClose in listOf(false, true)) {
            val stream = CountingStream(100, failAfter = if (failClose) null else 50, failClose = failClose)
            collect { listOf(record { stream }) }.use { capture ->
                assertTrue(stream.closed)
                assertEquals("Native crash trace status=trace-read-failed error=IOException", capture.summary)
                assertEquals(setOf("native-crash/info.txt"), capture.attachments.keys)
                assertFalse(capture.info().contains("secret"))
                assertEquals(listOf("info.txt"), capture.attachments.values.first().parentFile.list().orEmpty().toList())
            }
        }
    }

    @Test fun streamOpenAndFirmwareFailuresAreRecordedAsSafeClassesOnly() {
        for (failure in listOf(SecurityException("secret private path"), NoSuchMethodError("secret private path"))) {
            collect { throw failure }.use { capture ->
                assertEquals("Native crash trace status=query-failed error=${failure.javaClass.simpleName}", capture.summary)
                assertFalse(capture.info().contains("secret"))
            }
            collect { listOf(record { throw failure }) }.use { capture ->
                assertTrue(capture.summary.contains("status=trace-read-failed"))
                assertTrue(capture.info().contains("error=${failure.javaClass.simpleName}"))
                assertFalse(capture.info().contains("secret"))
            }
        }
    }

    @Test fun aCacheFailureCannotPreventTheRestOfTheExport() {
        val file = File(cache, "private-secret").apply { writeText("not a directory") }
        NativeCrashDiagnostics.collect(31, 1_000, "private.main", file) { error("Must fail before querying") }.use { capture ->
            assertTrue(capture.attachments.isEmpty())
            assertEquals("Native crash trace status=unavailable error=IOException", capture.summary)
            assertFalse(capture.summary.contains("secret"))
        }
        assertEquals(listOf(file), cache.listFiles().orEmpty().toList())
    }

    @Test fun aManifestWriteFailureRemovesTheTraceAndReturnsOnlyASafeSummary() {
        val stream = CountingStream(3)
        collect {
            listOf(record {
                // Simulate an unwritable manifest without depending on the test user's permissions.
                assertTrue(File(cache.listFiles().orEmpty().single(), "info.txt").mkdir())
                stream
            })
        }.use { capture ->
            assertTrue(capture.attachments.isEmpty())
            assertTrue(capture.summary.contains("status=unavailable error="))
            assertFalse(capture.summary.contains(cache.absolutePath))
            assertTrue(stream.closed)
            assertTrue(cache.listFiles().orEmpty().isEmpty())
        }
    }

    @Test fun futureAndMissingExitTimesDoNotProduceNegativeAges() {
        for (time in listOf(0L, 2_000L)) {
            collect { listOf(record(time = time) { null }) }.use { capture ->
                assertTrue(capture.info().contains("exitEpochMillis=$time ageMs=unknown"))
            }
        }
    }

    private class CountingStream(
        private val size: Long,
        private val failAfter: Long? = null,
        private val failClose: Boolean = false,
    ) : InputStream() {
        var emitted = 0L
            private set
        var closed = false
            private set
        override fun read(): Int {
            if (failAfter != null && emitted >= failAfter) throw IOException("secret read failure")
            if (emitted == size) return -1
            emitted++
            return 42
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (failAfter != null && emitted >= failAfter) throw IOException("secret read failure")
            if (emitted == size) return -1
            val count = minOf(length.toLong(), size - emitted, (failAfter ?: size) - emitted).toInt()
            buffer.fill(42, offset, offset + count)
            emitted += count
            return count
        }
        override fun close() {
            closed = true
            if (failClose) throw IOException("secret close failure")
        }
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31])
class NativeCrashDiagnosticsAndroidTest {
    @Test @Config(sdk = [30]) fun androidElevenDoesNotRequestNativeTombstones() {
        val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun getSystemService(name: String): Any? {
                if (name == Context.ACTIVITY_SERVICE) error("API 30 must not query native traces")
                return super.getSystemService(name)
            }
        }
        NativeCrashDiagnostics.collect(context).use { capture ->
            assertEquals("Native crash trace status=unsupported", capture.summary)
            assertEquals(setOf("native-crash/info.txt"), capture.attachments.keys)
        }
    }

    @Test fun systemQueryIsScopedToOwnPackageAndOnlyTheMainProcessTraceIsOpened() {
        val app = RuntimeEnvironment.getApplication()
        val mainProcess = app.applicationInfo.processName?.takeIf { it.isNotBlank() } ?: app.packageName
        val main = mock(ApplicationExitInfo::class.java)
        `when`(main.processName).thenReturn(mainProcess)
        `when`(main.reason).thenReturn(ApplicationExitInfo.REASON_CRASH_NATIVE)
        `when`(main.traceInputStream).thenReturn(ByteArrayInputStream(byteArrayOf(1, 2, 3)))
        val secondary = mock(ApplicationExitInfo::class.java)
        `when`(secondary.processName).thenReturn("$mainProcess:service")
        `when`(secondary.reason).thenReturn(ApplicationExitInfo.REASON_CRASH_NATIVE)
        val manager = mock(ActivityManager::class.java)
        `when`(manager.getHistoricalProcessExitReasons(app.packageName, 0, 3)).thenReturn(listOf(secondary, main))
        val context = object : ContextWrapper(app) {
            override fun getSystemService(name: String): Any? =
                if (name == Context.ACTIVITY_SERVICE) manager else super.getSystemService(name)
        }
        val files: List<File>
        NativeCrashDiagnostics.collect(context).use { capture ->
            assertEquals("Native crash trace status=collected", capture.summary)
            files = capture.attachments.values.toList()
            assertArrayEquals(byteArrayOf(1, 2, 3), capture.attachments.getValue("native-crash/trace.bin").readBytes())
        }
        verify(manager).getHistoricalProcessExitReasons(app.packageName, 0, 3)
        verifyNoMoreInteractions(manager)
        verify(main).traceInputStream
        verify(secondary, never()).traceInputStream
        assertTrue(files.none(File::exists))
    }
}
