package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class AirPlayVideoDiagnosticsTest {
    @Test fun recordsStagesWithoutExceptionMessagesOrUrls() {
        val messages = mutableListOf<String>()
        val diagnostics = AirPlayVideoDiagnostics(messages::add)
        diagnostics.stage(AirPlayVideoDiagnostics.Stage.ENCODED_FRAME, 120)
        diagnostics.failure(AirPlayVideoDiagnostics.Stage.PREPARE,
            IOException("https://private-host/media?token=secret"))
        assertEquals(listOf("video stage=ENCODED_FRAME value=120",
            "video stage=FAILURE operation=PREPARE exception=IOException"), messages)
        assertFalse(messages.joinToString().contains("secret"))
    }

    @Test fun unavailableLoggerCannotInterruptPlayback() {
        val diagnostics = AirPlayVideoDiagnostics { error("logger unavailable") }
        diagnostics.stage(AirPlayVideoDiagnostics.Stage.PREPARE)
        diagnostics.failure(AirPlayVideoDiagnostics.Stage.PREPARE, IOException())
    }
}
