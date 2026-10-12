package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class AirPlayVideoDiagnosticsTest {
    @Test fun recordsStagesAndCodesWithoutExceptionMessagesOrUrls() {
        val messages = mutableListOf<String>()
        val diagnostics = AirPlayVideoDiagnostics(messages::add)
        diagnostics.stage(AirPlayVideoDiagnostics.Stage.ENCODED_FRAME, 120)
        diagnostics.failure(AirPlayVideoDiagnostics.Stage.PREPARE,
            IOException("https://private-host/media?token=secret"), 2001)
        assertEquals(listOf("video stage=ENCODED_FRAME value=120",
            "video stage=FAILURE operation=PREPARE exception=IOException code=2001"), messages)
        assertFalse(messages.joinToString().contains("secret"))
    }

    @Test fun unavailableLoggerCannotInterruptPlayback() {
        val diagnostics = AirPlayVideoDiagnostics { error("logger unavailable") }
        diagnostics.stage(AirPlayVideoDiagnostics.Stage.START)
        diagnostics.failure(AirPlayVideoDiagnostics.Stage.START, IOException())
    }

    @Test fun decoderEvidenceContainsOnlyDimensionsAndBufferCounters() {
        val messages = mutableListOf<String>()
        val diagnostics = AirPlayVideoDiagnostics(messages::add)
        diagnostics.videoSize(960, 540)
        diagnostics.decoded(120, 3, 4)
        assertEquals(listOf("video stage=VIDEO_SIZE width=960 height=540",
            "video stage=VIDEO_DISABLED rendered=120 skipped=3 dropped=4"), messages)
    }
}
