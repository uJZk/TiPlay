package com.shilapi.xcertplay

import android.net.Uri
import com.github.luben.zstd.ZstdInputStream
import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.File
import java.util.Base64
import java.util.zip.ZipInputStream
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class DiagnosticLogActionsTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val folder get() = File(context.filesDir, "logs")
    private fun captures() = folder.listFiles().orEmpty().filter { it.name.endsWith(".zst") }
    @Before fun setup() {
        DiagnosticLogs.resetForTest()
        context.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
        AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.DEBUG)
        RawTraffic.record("browser/test/in", "private-stream".toByteArray())
    }
    @After fun cleanup() {
        AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.STANDARD)
        RawTraffic.clear()
        DiagnosticLogs.resetForTest()
    }

    @Test fun stopExportsAndSharesPreserveThePreparedArchiveBeforeClearingCapture() {
        for (action in listOf(DiagnosticLogAction.STOP_EXPORT, DiagnosticLogAction.STOP_SHARE)) {
            AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.DEBUG)
            RawTraffic.record("browser/test/in", "private-stream".toByteArray())
            val bytes = ByteArrayOutputStream()
            DiagnosticLogActions.execute(context, action) { content, share ->
                assertFalse(RawTraffic.enabled)
                assertTrue(captures().isNotEmpty())
                assertEquals(action == DiagnosticLogAction.STOP_SHARE, share)
                assertEquals("application/zip", content.mimeType)
                content.writeTo(bytes)
                DiagnosticExportStore.SavedReport(Uri.EMPTY, mimeType = content.mimeType)
            }
            assertFalse(RawTraffic.enabled)
            assertTrue(captures().isEmpty())
            assertEquals(DiagnosticLogLevel.STANDARD, AirPlayPersistence.loadDiagnosticLogLevel(context))
            var recovered = false
            ZipInputStream(bytes.toByteArray().inputStream()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (!entry.name.startsWith("captures/")) continue
                    val journal = ZstdInputStream(zip.readBytes().inputStream()).use { it.readBytes().toString(Charsets.UTF_8) }
                    recovered = journal.lineSequence().filter { "\tbrowser/test/in\t" in it }.any {
                        String(Base64.getDecoder().decode(it.split('\t')[4])) == "private-stream"
                    } || recovered
                }
            }
            assertTrue(recovered)
        }
    }

    @Test fun stopOnlyClearsWithoutCreatingAnExport() {
        assertNull(DiagnosticLogActions.execute(context, DiagnosticLogAction.STOP) { _, _ ->
            throw AssertionError("Stop must not export")
        })
        assertFalse(RawTraffic.enabled)
        assertTrue(captures().isEmpty())
    }

    @Test fun stopExportDrainsAdmittedMetadataBeforeDisablingCapture() {
        assertTrue(RawTraffic.recordMetadataAsync("usb/device-event", "just-before-export".toByteArray(), observedAtMillis = 123))
        DiagnosticLogActions.execute(context, DiagnosticLogAction.STOP_EXPORT) { content, _ ->
            val bytes = ByteArrayOutputStream().also(content::writeTo).toByteArray()
            val journals = StringBuilder()
            ZipInputStream(bytes.inputStream()).use { zip ->
                while (true) { val entry = zip.nextEntry ?: break
                    if (entry.name.startsWith("captures/")) journals.append(
                        ZstdInputStream(zip.readBytes().inputStream()).use { String(it.readBytes()) })
                }
            }
            assertTrue(journals.lineSequence().any { it.startsWith("123\t") && it.contains("\tusb/device-event\t") })
            val stopMessages = journals.lineSequence().filter { it.contains("\tcapture/stop\t") }.map {
                String(Base64.getDecoder().decode(it.split('\t', limit = 5)[4]))
            }.toList()
            assertTrue(stopMessages.any { it.contains("metadataFailures=0") })
            DiagnosticExportStore.SavedReport(Uri.EMPTY, mimeType = content.mimeType)
        }
    }

    @Test fun ordinaryShareIsRedactedTextAndDoesNotIncludeRetainedRawData() {
        DiagnosticLogs.append("token=private-token")
        AirPlayPersistence.saveDiagnosticLogLevel(context, DiagnosticLogLevel.STANDARD)
        DiagnosticLogActions.execute(context, DiagnosticLogAction.SHARE) { content, share ->
            assertTrue(share)
            assertEquals("text/plain", content.mimeType)
            val bytes = ByteArrayOutputStream(); content.writeTo(bytes)
            assertFalse(bytes.toString("UTF-8").contains("private-token"))
            assertFalse(bytes.toString("UTF-8").contains("private-stream"))
            DiagnosticExportStore.SavedReport(Uri.EMPTY)
        }
    }

    @Test fun failedExportStopsCaptureButRetainsEvidenceForRetry() {
        try {
            DiagnosticLogActions.execute(context, DiagnosticLogAction.STOP_EXPORT) { _, _ -> throw IOException("full") }
            fail("Expected save failure")
        } catch (_: IOException) { }
        assertFalse(RawTraffic.enabled)
        assertTrue(captures().isNotEmpty())
    }
}
