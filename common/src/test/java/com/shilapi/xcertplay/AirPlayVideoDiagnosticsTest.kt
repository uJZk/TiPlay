package com.shilapi.xcertplay

import com.shilapi.xcertplay.diagnostics.DiagnosticErrorText
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class AirPlayVideoDiagnosticsTest {
    @Test fun recordsStagesAndPreservesSanitizedFailureText() {
        val messages = mutableListOf<String>()
        val diagnostics = AirPlayVideoDiagnostics(messages::add)
        diagnostics.stage(AirPlayVideoDiagnostics.Stage.ENCODED_FRAME, 120)
        val failureText = "Failed to load https://private-host/media?token=secret"
        diagnostics.failure(AirPlayVideoDiagnostics.Stage.PREPARE, IOException(failureText))
        assertEquals(listOf("video stage=ENCODED_FRAME value=120",
            "video stage=FAILURE operation=PREPARE exception=IOException errorText=${DiagnosticErrorText.sanitize(failureText)}"), messages)
        assertTrue(messages.last().contains("Failed to load"))
        assertFalse(messages.joinToString().contains("secret"))
        assertFalse(messages.joinToString().contains("private-host"))
    }

    @Test fun unavailableLoggerCannotInterruptPlayback() {
        val diagnostics = AirPlayVideoDiagnostics { error("logger unavailable") }
        diagnostics.stage(AirPlayVideoDiagnostics.Stage.PREPARE)
        diagnostics.failure(AirPlayVideoDiagnostics.Stage.PREPARE, IOException())
        diagnostics.control(AirPlayVideoDiagnostics.ControlSource.IPHONE, "seek", 20.0, 3)
        diagnostics.stopped(AirPlayVideoDiagnostics.StopReason.RECEIVER_STOP, 3)
        diagnostics.callback("failed", 4)
    }

    @Test fun playbackLifecycleRejectsUntrustedActionsStatesAndNumbers() {
        val messages = mutableListOf<String>()
        val diagnostics = AirPlayVideoDiagnostics(messages::add)
        diagnostics.control(AirPlayVideoDiagnostics.ControlSource.IPHONE, "seek", 12.5, 3)
        diagnostics.control(AirPlayVideoDiagnostics.ControlSource.BROWSER, "secret-action", Double.NaN, 3)
        diagnostics.stopped(AirPlayVideoDiagnostics.StopReason.BROWSER_ENDED, 3)
        diagnostics.callback("paused", 3)
        diagnostics.callback("secret-state", 3)
        assertEquals(listOf(
            "video stage=CONTROL source=iphone action=seek generation=3 value=12.5",
            "video stage=CONTROL source=browser action=OTHER generation=3 value=INVALID",
            "video stage=STOP reason=browser-ended generation=3",
            "video stage=CALLBACK state=paused generation=3",
            "video stage=CALLBACK state=OTHER generation=3",
        ), messages)
        assertFalse(messages.joinToString().contains("secret"))
        assertFalse(messages.joinToString().contains("NaN"))
    }
}
