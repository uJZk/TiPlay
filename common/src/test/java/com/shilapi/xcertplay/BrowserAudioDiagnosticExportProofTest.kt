package com.shilapi.xcertplay

import android.net.Uri
import com.github.luben.zstd.ZstdInputStream
import com.shilapi.xcertplay.diagnostics.RawTraffic
import com.shilapi.xcertplay.web.BrowserLinkServer
import com.shilapi.xcertplay.web.NativeAudioDiagnosticLog
import com.shilapi.xcertplay.web.WebVideoHub
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Real JSON/control admission, Android callback, redactor, persistence and export;
 * synthetic browser observations. This does not exercise getStats(), sockets,
 * SCTP/DTLS authentication or vehicle ICE. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class BrowserAudioDiagnosticExportProofTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val callbacks get() = TeslaBrowserLink::class.java.getDeclaredField("callbacks")
        .apply { isAccessible = true }.get(null) as BrowserLinkServer.Callbacks

    @Before fun setup() {
        TeslaBrowserLink.resetForTest()
        DiagnosticLogs.resetForTest()
        RawTraffic.clear()
        File(app.filesDir, "logs").deleteRecursively()
        app.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
    }

    @After fun cleanup() {
        TeslaBrowserLink.resetForTest()
        DiagnosticLogs.resetForTest()
        RawTraffic.clear()
        app.getSharedPreferences("xcertplay_airplay", 0).edit().clear().commit()
    }

    @Test fun standardFailureCallbackKeepsAllIceFieldsThroughRealTxtExport() = background {
        DiagnosticLogs.initialize(app, DiagnosticLogLevel.STANDARD)
        assertFalse(RawTraffic.enabled)
        deliver(mapOf("k" to "st", "v" to failure().mapKeys { "audio.${it.key}" }))
        val exported = export(DiagnosticLogAction.SAVE)
        assertEquals("text/plain", exported.mime)
        assertIceFields(exported.bytes.toString(Charsets.UTF_8))
        saveProof("standard-failure.txt", exported.bytes)
    }

    @Test fun debugCallbackKeepsIceFieldsInReportAndJournalThroughRealStopZipExport() = background {
        DiagnosticLogs.initialize(app, DiagnosticLogLevel.DEBUG)
        assertTrue(RawTraffic.enabled)
        deliver(mapOf("k" to "audio-diag", "d" to requireNotNull(RawTraffic.activeSessionId()), "v" to failure()))
        val exported = export(DiagnosticLogAction.STOP_EXPORT)
        assertEquals("application/zip", exported.mime)
        val entries = zipEntries(exported.bytes)
        val report = entries.entries.single { it.key.endsWith(".txt.zst") &&
            it.key != "capture.txt.zst" && !it.key.startsWith("native-crash/") }.value
        assertIceFields(decompress(report))
        val journal = entries.filterKeys { it.startsWith("captures/") }.values.joinToString("\n") { decompress(it) }
        val androidLogs = journal.lineSequence().map { it.split('\t') }
            .filter { it.size == 5 && it[2] == "android/log" }
            .joinToString("\n") { Base64.getDecoder().decode(it[4]).toString(Charsets.UTF_8) }
        assertIceFields(androidLogs)
        assertFalse("Stop export disables capture only after taking the journal snapshot", RawTraffic.enabled)
        saveProof("debug-failure.zip", exported.bytes)
    }

    @Test fun missingIceCountersStayUnknownInActualStandardExport() = background {
        DiagnosticLogs.initialize(app, DiagnosticLogLevel.STANDARD)
        val unknown = failure().filterKeys { it !in setOf("nativeAudio.iceRequestsReceived",
            "nativeAudio.iceResponsesReceived", "nativeAudio.iceSelectedPairPresent") }
        deliver(mapOf("k" to "st", "v" to unknown.mapKeys { "audio.${it.key}" }))
        val report = export(DiagnosticLogAction.SAVE).bytes.toString(Charsets.UTF_8)
        assertTrue(report, report.contains("nativeAudio.iceRequestsSent=11"))
        for (field in listOf("iceRequestsReceived", "iceResponsesReceived", "iceSelectedPairPresent"))
            assertFalse("Absent $field is unknown, not zero", report.contains("nativeAudio.$field="))
    }

    @Test fun nativeFailureAllClassificationsSurviveStandardExportAtTheirLongestMappedValues() = background {
        DiagnosticLogs.initialize(app, DiagnosticLogLevel.STANDARD)
        val details = nativeDetails()
        nativeLines(details).forEach(callbacks::log)
        val exported = export(DiagnosticLogAction.SAVE)
        assertNativeFields(exported.bytes.toString(Charsets.UTF_8), details)
        saveProof("native-standard-failure.txt", exported.bytes)
    }

    @Test fun nativeFailureAllClassificationsSurviveDebugReportAndJournal() = background {
        DiagnosticLogs.initialize(app, DiagnosticLogLevel.DEBUG)
        val details = nativeDetails()
        nativeLines(details).forEach(callbacks::log)
        val exported = export(DiagnosticLogAction.STOP_EXPORT)
        val entries = zipEntries(exported.bytes)
        val report = entries.entries.single { it.key.endsWith(".txt.zst") &&
            it.key != "capture.txt.zst" && !it.key.startsWith("native-crash/") }.value
        assertNativeFields(decompress(report), details)
        val journal = entries.filterKeys { it.startsWith("captures/") }.values.joinToString("\n") { decompress(it) }
        val androidLogs = journal.lineSequence().map { it.split('\t') }
            .filter { it.size == 5 && it[2] == "android/log" }
            .joinToString("\n") { Base64.getDecoder().decode(it[4]).toString(Charsets.UTF_8) }
        assertNativeFields(androidLogs, details)
        saveProof("native-debug-failure.zip", exported.bytes)
    }

    @Suppress("UNCHECKED_CAST")
    private fun nativeDetails(): Map<String, Any?> {
        // Invoke the product JNI-to-Kotlin mapper, rather than duplicating its field names.
        // The input is synthetic: no JNI runtime or network is exercised here.
        val raw = IntArray(21) { Int.MAX_VALUE }
        raw[8] = Int.MIN_VALUE + 1; raw[9] = Int.MIN_VALUE + 1
        return Class.forName("com.shilapi.xcertplay.web.NativeRtcAudioPeerKt")
            .getDeclaredMethod("nativeAudioDiagnostics", IntArray::class.java)
            .invoke(null, raw) as Map<String, Any?>
    }

    private fun nativeLines(details: Map<String, Any?>): List<String> =
        NativeAudioDiagnosticLog.lines("Browser RTC: stage=native-audio-transport timeout=true " +
            "epoch=2147483647 peer=2147483647 generation=2147483647", details).also { lines ->
            assertTrue("The fixture must cross the old one-line cap", lines.size > 1)
            lines.forEach { line ->
                assertTrue(line, line.length <= 500)
                assertEquals("Source redaction must preserve each complete part", line, DiagnosticRedactor.redact(line))
            }
        }

    private fun assertNativeFields(text: String, details: Map<String, Any?>) {
        assertEquals(23, details.size)
        for ((field, expected) in details)
            assertTrue("Missing complete native $field=$expected in export",
                Regex("(?:^| )${Regex.escape(field)}=${Regex.escape(expected.toString())}(?: |\\n|$)").containsMatchIn(text))
        val lines = text.lines().filter { "stage=native-audio-transport" in it }
        assertTrue(lines.size > 1)
        for (line in lines) assertTrue("Every part must retain correlation", line.contains("epoch=2147483647 peer=2147483647 generation=2147483647"))
    }

    private fun failure(): Map<String, Any?> = linkedMapOf(
        "nativeAudio.state" to "failed", "nativeAudio.rtcGeneration" to 17,
        "nativeAudio.peerState" to "failed", "nativeAudio.iceState" to "checking",
        "nativeAudio.gatheringState" to "complete", "nativeAudio.failureStage" to "transport",
        "nativeAudio.iceStatsState" to "sampled", "nativeAudio.iceStatsSampleAgeMs" to 1234.5,
        "nativeAudio.icePairScope" to "all", "nativeAudio.icePairCount" to 2,
        "nativeAudio.icePairState" to "in-progress", "nativeAudio.icePairNominated" to 0,
        "nativeAudio.iceSelectedPairPresent" to 0, "nativeAudio.iceRequestsSent" to 11,
        "nativeAudio.iceRequestsReceived" to 0, "nativeAudio.iceResponsesSent" to 0,
        "nativeAudio.iceResponsesReceived" to 0, "nativeAudio.iceConsentRequestsSent" to 7,
        "nativeAudio.iceRole" to "controlled", "nativeAudio.dtlsState" to "new",
        "nativeAudio.privateValue" to "untrusted-private-observation",
    )

    private fun assertIceFields(text: String) {
        for ((field, expected) in failure()) {
            if (field == "nativeAudio.privateValue") continue
            if (field in setOf("nativeAudio.icePairNominated", "nativeAudio.iceSelectedPairPresent")) {
                assertTrue("Missing complete $field in export", Regex("${Regex.escape(field)}=(?:0|false)(?: |\\n|$)").containsMatchIn(text))
            } else if (field == "nativeAudio.iceStatsSampleAgeMs") {
                assertTrue("Missing complete $field in export", text.contains("$field=1234.500"))
            } else assertTrue("Missing complete $field=$expected in export", text.contains("$field=$expected"))
        }
        assertFalse(text.contains("untrusted-private-observation"))
        assertFalse(text.contains("nativeAudio.privateValue"))
    }

    private data class Export(val mime: String, val bytes: ByteArray)

    private fun deliver(event: Map<String, Any?>) {
        val server = BrowserLinkServer(WebVideoHub(), object : BrowserLinkServer.Callbacks by callbacks {
            override fun code() = "1234"
        })
        val body = mapOf("c" to "1234", "s" to "diagnostic_export_fixture", "q" to 1, "e" to listOf(event))
        // Start at the complete parsed application body; no server socket or bypass of
        // code/session/sequence/event/scalar-size validation is needed for this proof.
        val json = Class.forName("com.shilapi.xcertplay.web.WebJson")
        val codec = json.getField("INSTANCE").get(null)
        val encoded = json.getMethod("write", Any::class.java).invoke(codec, body) as String
        val decoded = json.getMethod("parse", String::class.java).invoke(codec, encoded) as Map<*, *>
        val response = BrowserLinkServer::class.java.getDeclaredMethod("controlBody", Map::class.java)
            .apply { isAccessible = true }.invoke(server, decoded)
        val status = response.javaClass.getDeclaredField("status").apply { isAccessible = true }.getInt(response)
        assertEquals("The fixture must enter through product code/session/scalar validation", 200, status)
    }

    private fun export(action: DiagnosticLogAction): Export {
        var exported: Export? = null
        DiagnosticLogActions.execute(app, action) { content, _ ->
            exported = Export(content.mimeType, ByteArrayOutputStream().also(content::writeTo).toByteArray())
            DiagnosticExportStore.SavedReport(Uri.EMPTY, mimeType = content.mimeType)
        }
        return requireNotNull(exported)
    }

    private fun zipEntries(bytes: ByteArray): Map<String, ByteArray> = buildMap {
        ZipInputStream(bytes.inputStream()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                assertEquals("ZIP must keep the already-compressed capture unchanged", ZipEntry.STORED, entry.method)
                put(entry.name, zip.readBytes())
            }
        }
    }
    private fun decompress(bytes: ByteArray) = ZstdInputStream(bytes.inputStream()).use { it.readBytes().toString(Charsets.UTF_8) }

    private fun saveProof(name: String, bytes: ByteArray) {
        System.getenv("TIPLAY_DIAGNOSTIC_PROOF_DIR")?.let { path ->
            File(path).apply { mkdirs() }.resolve(name).writeBytes(bytes)
        }
    }

    private fun background(action: () -> Unit) {
        val executor = Executors.newSingleThreadExecutor()
        try { executor.submit(action).get(30, TimeUnit.SECONDS) }
        finally { executor.shutdownNow() }
    }
}
