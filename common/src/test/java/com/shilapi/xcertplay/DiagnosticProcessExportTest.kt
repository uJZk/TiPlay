package com.shilapi.xcertplay

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.content.ContextWrapper
import android.net.Uri
import com.github.luben.zstd.ZstdInputStream
import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class DiagnosticProcessExportTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val crashFile get() = File(app.filesDir, "logs/last-crash.txt")
    private lateinit var manager: ActivityManager
    private lateinit var exit: ApplicationExitInfo
    private lateinit var context: Context

    @Before fun setup() {
        DiagnosticLogs.resetForTest()
        app.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
        crashFile.parentFile?.mkdirs()
        crashFile.writeText(CrashRecord.format("main", IllegalStateException("disconnected at 192.168.7.10"), 42))
        exit = mock(ApplicationExitInfo::class.java)
        `when`(exit.timestamp).thenReturn(System.currentTimeMillis() - 1_000)
        `when`(exit.reason).thenReturn(ApplicationExitInfo.REASON_CRASH_NATIVE)
        `when`(exit.status).thenReturn(11)
        `when`(exit.importance).thenReturn(ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND)
        `when`(exit.pss).thenReturn(2048)
        `when`(exit.rss).thenReturn(4096)
        manager = mock(ActivityManager::class.java)
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
        AirPlayPersistence.saveDiagnosticLogLevel(app, DiagnosticLogLevel.STANDARD)
        RawTraffic.clear()
        DiagnosticLogs.resetForTest()
        crashFile.delete()
    }

    @Test fun saveAndStopExportIncludeRetainedExitAndRedactedCrashEvidence() = background {
        for (action in listOf(DiagnosticLogAction.SAVE, DiagnosticLogAction.STOP_EXPORT)) {
            AirPlayPersistence.saveDiagnosticLogLevel(context,
                if (action.stops) DiagnosticLogLevel.DEBUG else DiagnosticLogLevel.STANDARD)
            DiagnosticLogActions.execute(context, action) { content, _ ->
                val bytes = ByteArrayOutputStream().also(content::writeTo).toByteArray()
                val report = if (action.stops) archiveReport(bytes) else String(bytes, Charsets.UTF_8)
                assertEvidence(report)
                DiagnosticExportStore.SavedReport(Uri.EMPTY, mimeType = content.mimeType)
            }
        }
        verifyNumericReads(2)
    }

    @Test fun retainedSettingsReportIncludesTheSameEvidence() {
        val activity = Robolectric.buildActivity(DiPlayActivity::class.java).get()
        val method = DiPlayActivity::class.java.getDeclaredMethod(
            "diagnosticReportText", Context::class.java, Boolean::class.javaPrimitiveType).apply { isAccessible = true }
        background {
            for (debug in listOf(false, true)) {
                assertEvidence(method.invoke(activity, context, debug) as String)
            }
            verifyNumericReads(2)
        }
    }

    private fun assertEvidence(report: String) {
        assertTrue(report, report.contains("java.lang.IllegalStateException: disconnected at [ip]"))
        assertTrue(report.contains("crash atEpochMs=42 thread=main"))
        assertTrue(report.contains("Process exits available=true count=1"))
        assertTrue(report.contains("reason=native_crash reasonCode=5 status=11 importance=100 pssKiB=2048 rssKiB=4096"))
        assertFalse(report.contains("192.168.7.10"))
    }

    private fun verifyNumericReads(count: Int) {
        verify(manager, times(count)).getHistoricalProcessExitReasons(app.packageName, 0, 3)
        verifyNoMoreInteractions(manager)
        verify(exit, times(count)).timestamp
        verify(exit, times(count)).reason
        verify(exit, times(count)).status
        verify(exit, times(count)).importance
        verify(exit, times(count)).pss
        verify(exit, times(count)).rss
        verifyNoMoreInteractions(exit)
    }

    private fun archiveReport(bytes: ByteArray): String = ZipInputStream(bytes.inputStream()).use { zip ->
        while (true) {
            val entry = zip.nextEntry ?: error("Missing report text")
            if (entry.name.endsWith(".txt.zst") && entry.name != "capture.txt.zst") {
                return@use ZstdInputStream(zip.readBytes().inputStream()).use { it.readBytes().toString(Charsets.UTF_8) }
            }
        }
        error("Missing report text")
    }

    private fun background(action: () -> Unit) {
        val executor = Executors.newSingleThreadExecutor()
        try { executor.submit(action).get(20, TimeUnit.SECONDS) }
        finally { executor.shutdownNow() }
    }
}
