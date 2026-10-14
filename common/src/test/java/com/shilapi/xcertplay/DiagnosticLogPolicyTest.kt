package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class DiagnosticLogPolicyTest {
    @Test fun standardKeepsLifecycleNegotiationFailuresAndFinalSummaries() {
        val messages = listOf(
            "CONNECTION_DIAGNOSTIC attempt=2 phase=CONTROL teardown end elapsedMs=117",
            "Video: decoder configured codec=H264 width=1920 height=1080",
            "airplay audio SETUP type=100 audioType=media formatBits=0x8000 result=accepted",
            "browser video stage=EVENT event=error errorCode=2 errorType=OTHER",
            "receiver protocol c=2 stage=RESPONSE status=502 bodyBytes=0",
            "receiver mirror stage=BODY exception=IOException",
            "receiver mirror stage=BODY exception=OTHER",
            "browser video stage=REPORT playing=false ready=false failed=true errorCode=0 errorType=OTHER",
            "Microphone: stats captureBytes=1920 readErrors=1 sendErrors=0 ended=false",
            "Browser: decoded=100 dropped=+1",
            "Audio: decoder stats inputQueuedTotal=20 inputDroppedTotal=0 ended=true",
            "receiver mirror stage=END reason=CLOSED frames=100",
            "Media clock final: tx=5 rxResponse=5 sendFailures=0 synced=true",
        )
        messages.forEach { assertTrue(it, DiagnosticLogPolicy.shouldRecord(it, DiagnosticLogLevel.STANDARD)) }
    }

    @Test fun standardOmitsHealthyPeriodicSamplesWhileDebugKeepsTheirBoundedMetadata() {
        val messages = listOf(
            "Browser: decoded=100 dropped=0 decoderErrors=0 queue=0",
            "Media clock: tx=5 rxResponse=5 sendFailures=0 synced=true",
            "Microphone: stats captureBytes=1920 readErrors=0 sendErrors=0 ended=false",
            "Video: video stats rx=60fps shown=60fps recoveries=0",
            "browser video stage=REPORT active=true position=1.0 errorCode=0 errorType=OTHER",
            "browser video stage=REPORT playing=true ready=true failed=false errorCode=0 errorType=OTHER",
            "receiver protocol stage=RESPONSE status=200 exception=none failureClass=null",
            "Buffered audio: queued 1 s, received 40 packets",
            "receiver protocol c=2 stage=REQUEST method=GET path=/playback-info bodyBytes=0",
            "receiver protocol c=2 stage=RESPONSE status=200 bodyBytes=0",
            "receiver protocol c=2 stage=REVERSE_REPLY kind=EVENT status=200 bodyBytes=0",
            "receiver mirror stage=TIMING frames=120 driftMs=0",
            "THEME_DIAGNOSTIC sample source=poll reported=light applied=light",
            "wireless startup elapsedMs=10000 tcpAccepted=0 waitingFor=WiFi_discovery_or_AirPlay_TCP",
            "receiveCounters windowMs=10000 udp4InErrorsDelta=0 udp4RcvbufErrorsDelta=0",
        )
        messages.forEach {
            assertFalse(it, DiagnosticLogPolicy.shouldRecord(it, DiagnosticLogLevel.STANDARD))
            assertTrue(it, DiagnosticLogPolicy.shouldRecord(it, DiagnosticLogLevel.DEBUG))
        }
    }

    @Test fun absentOrUnknownSavedLevelsChooseStandard() {
        assertEquals(DiagnosticLogLevel.STANDARD, DiagnosticLogLevel.fromKey(null))
        assertEquals(DiagnosticLogLevel.STANDARD, DiagnosticLogLevel.fromKey("verbose"))
        assertEquals(DiagnosticLogLevel.DEBUG, DiagnosticLogLevel.fromKey("debug"))
    }
}
