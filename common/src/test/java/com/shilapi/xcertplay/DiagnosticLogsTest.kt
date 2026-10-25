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

    @Before fun prepare() {
        context.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
        DiagnosticLogs.resetForTest()
    }
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

    @Test fun debugPersistsUntilStoppedAndCreatesANewSessionAfterRestart() {
        AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.DEBUG)
        assertEquals(DiagnosticLogLevel.DEBUG, AirPlayPersistence.loadDiagnosticLogLevel(context))
        val session = com.shilapi.xcertplay.diagnostics.RawTraffic.activeSessionId()
        DiagnosticLogs.resetForTest()
        assertEquals(DiagnosticLogLevel.DEBUG, AirPlayPersistence.loadDiagnosticLogLevel(context))
        DiagnosticLogs.initialize(context)
        assertTrue(com.shilapi.xcertplay.diagnostics.RawTraffic.enabled)
        assertNotEquals(session, com.shilapi.xcertplay.diagnostics.RawTraffic.activeSessionId())
        AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.STANDARD)
        DiagnosticLogs.resetForTest()
        DiagnosticLogs.initialize(context)
        assertFalse(com.shilapi.xcertplay.diagnostics.RawTraffic.enabled)
    }

    @Test fun fullDebugMessagesCompressImmediatelyWhileRollingMetadataRemainsRedacted() {
        AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.DEBUG)
        DiagnosticLogs.append("phoneName=private-phone")
        assertTrue(AsyncDiagnosticLog.awaitIdle(2_000))
        val folder = File(context.filesDir, "logs")
        val capture = folder.listFiles()!!.single { it.name.endsWith(".zst") }
        val journal = com.github.luben.zstd.ZstdInputStream(capture.inputStream()).use {
            it.readBytes().toString(Charsets.UTF_8)
        }
        val messages = journal.lineSequence().filter { "\tandroid/log\t" in it }.map {
            java.util.Base64.getDecoder().decode(it.split('\t')[4]).toString(Charsets.UTF_8)
        }.toList()
        assertTrue(messages.contains("phoneName=private-phone"))
        assertFalse(File(folder, "diplay.log").readText().contains("private-phone"))
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
