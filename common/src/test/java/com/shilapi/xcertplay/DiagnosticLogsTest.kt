package com.shilapi.xcertplay

import java.io.File
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class DiagnosticLogsTest {
    private val context get() = RuntimeEnvironment.getApplication()

    @Before fun prepare() { DiagnosticLogs.resetForTest() }
    @After fun cleanup() { DiagnosticLogs.resetForTest() }

    @Test fun multipleOwnersKeepOneProcessLogAndChangingDetailPreservesEarlierEvidence() {
        val first = DiagnosticLogs.initialize(context, DiagnosticLogLevel.STANDARD)
        DiagnosticLogs.append("CarPlay connected")
        val second = DiagnosticLogs.initialize(context, DiagnosticLogLevel.DEBUG)
        DiagnosticLogs.append("AirPlay receiver connected without a host Activity")
        assertSame(first, second)
        assertTrue(AsyncDiagnosticLog.awaitIdle(2_000))
        val evidence = first.file.readText()
        assertEquals(1, evidence.lineSequence().count { it.startsWith("TiPlay log started") })
        assertTrue(evidence.contains("CarPlay connected"))
        assertTrue(evidence.contains("AirPlay receiver connected without a host Activity"))
        assertEquals(DiagnosticLogLevel.DEBUG, DiagnosticLogPolicy.level)
    }

    @Test fun debugIsProcessLocalAndOldPersistedPreferenceCannotEnableItOnRestart() {
        context.getSharedPreferences("xcertplay_airplay", 0).edit().putString("diagnostic_log_level", "debug").commit()
        assertEquals(DiagnosticLogLevel.STANDARD, AirPlayPersistence.loadDiagnosticLogLevel(context))
        AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.DEBUG)
        assertEquals(DiagnosticLogLevel.DEBUG, AirPlayPersistence.loadDiagnosticLogLevel(context))
        val raw = File(context.filesDir, "logs/raw-traffic.tsv")
        val before = raw.readText()
        assertTrue(before.contains("capture/start"))
        val metadata = java.util.Base64.getDecoder().decode(raw.readLines().first { it.split('\t')[2] == "capture/start" }.split('\t')[4]).toString(Charsets.UTF_8)
        assertTrue(metadata.contains("session="))
        assertTrue(metadata.contains("version="))
        assertTrue(metadata.contains("sources=iphone,browser,usb,android-audio"))
        DiagnosticLogs.resetForTest() // A fresh process resets all static state to its Standard default.
        assertEquals(DiagnosticLogLevel.STANDARD, AirPlayPersistence.loadDiagnosticLogLevel(context))
        DiagnosticLogs.initialize(context, AirPlayPersistence.loadDiagnosticLogLevel(context))
        assertFalse(com.shilapi.xcertplay.diagnostics.RawTraffic.enabled)
        assertTrue(raw.length() >= before.length)
    }

    @Test fun exportDrainsAcceptedMetadataAndReportsCollectionIntegrity() {
        DiagnosticLogs.initialize(context, DiagnosticLogLevel.STANDARD)
        DiagnosticLogs.append("Shutdown complete clean=true")
        val report = StringBuilder()
        DiagnosticLogSnapshot.appendTo(report, File(context.filesDir, "logs"))
        assertTrue(report.contains("Shutdown complete clean=true"))
        assertTrue(report.contains("queueDrained=true"))
        assertTrue(report.contains("coverage=complete"))
        assertTrue(report.contains("scope=acceptedMetadata"))
    }
}
