package com.shilapi.xcertplay

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.ContextWrapper
import android.net.Uri
import com.github.luben.zstd.ZstdInputStream
import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31])
class DiagnosticNativeCrashExportTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var context: Context
    private lateinit var exit: ApplicationExitInfo
    private val traceBytes = byteArrayOf(8, 1, 18, 3, 65, 66, 67)
    private var traceClosed = false

    @Before fun setup() {
        DiagnosticLogs.resetForTest()
        app.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
        exit = mock(ApplicationExitInfo::class.java)
        `when`(exit.timestamp).thenReturn(1234L)
        `when`(exit.processName).thenReturn(app.applicationInfo.processName ?: app.packageName)
        `when`(exit.pid).thenReturn(321)
        `when`(exit.reason).thenReturn(ApplicationExitInfo.REASON_CRASH_NATIVE)
        `when`(exit.status).thenReturn(11)
        `when`(exit.traceInputStream).thenAnswer {
            assertNotEquals(android.os.Looper.getMainLooper().thread, Thread.currentThread())
            object : ByteArrayInputStream(traceBytes) {
                override fun close() { traceClosed = true; super.close() }
            }
        }
        val manager = mock(ActivityManager::class.java)
        `when`(manager.getHistoricalProcessExitReasons(app.packageName, 0, 3)).thenAnswer {
            assertNotEquals(android.os.Looper.getMainLooper().thread, Thread.currentThread())
            listOf(exit)
        }
        context = object : ContextWrapper(app) {
            override fun getSystemService(name: String): Any? =
                if (name == Context.ACTIVITY_SERVICE) manager else super.getSystemService(name)
        }
    }

    @After fun cleanup() {
        AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.STANDARD)
        RawTraffic.clear()
        DiagnosticLogs.resetForTest()
    }

    @Test fun standardExportNeverReadsTheNativeTrace() = background {
        DiagnosticLogActions.execute(context, DiagnosticLogAction.SAVE) { content, _ ->
            assertEquals("text/plain", content.mimeType)
            val bytes = ByteArrayOutputStream().also(content::writeTo).toByteArray()
            assertFalse(String(bytes, Charsets.UTF_8).contains("Native crash trace"))
            DiagnosticExportStore.SavedReport(Uri.EMPTY)
        }
        verify(exit, never()).traceInputStream
        verify(exit, never()).processName
    }

    @Test fun endAndExportIncludesOneCompleteTraceAndCanReuseThePreparedArchive() = background {
        AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.DEBUG)
        DiagnosticLogActions.execute(context, DiagnosticLogAction.STOP_EXPORT) { content, _ ->
            assertTrue("System trace must be closed before storage fallbacks run", traceClosed)
            assertEquals("application/zip", content.mimeType)
            val first = ByteArrayOutputStream().also(content::writeTo).toByteArray()
            val second = ByteArrayOutputStream().also(content::writeTo).toByteArray()
            assertArrayEquals(first, second)
            val entries = readArchive(first)
            assertArrayEquals(traceBytes, entries["native-crash/trace.bin.zst"])
            val info = String(entries.getValue("native-crash/info.txt.zst"), Charsets.UTF_8)
            assertTrue(info, info.contains("status=collected"))
            assertTrue(info, info.contains("exitEpochMillis=1234"))
            assertTrue(info, info.contains("pid=321"))
            val report = String(entries.entries.single {
                it.key.startsWith("TiPlay-") && it.key.endsWith(".txt.zst")
            }.value, Charsets.UTF_8)
            assertTrue(report, report.contains("Native crash trace status=collected"))
            DiagnosticExportStore.SavedReport(Uri.EMPTY, mimeType = content.mimeType)
        }
        verify(exit, times(1)).traceInputStream
    }

    private fun readArchive(bytes: ByteArray): Map<String, ByteArray> = ZipInputStream(bytes.inputStream()).use { zip ->
        val result = linkedMapOf<String, ByteArray>()
        while (true) {
            val entry = zip.nextEntry ?: break
            assertEquals(entry.name, ZipEntry.STORED, entry.method)
            result[entry.name] = ZstdInputStream(zip.readBytes().inputStream()).use { it.readBytes() }
        }
        result
    }

    private fun background(action: () -> Unit) {
        val executor = Executors.newSingleThreadExecutor()
        try { executor.submit(action).get(30, TimeUnit.SECONDS) }
        finally { executor.shutdownNow() }
    }
}
