package com.shilapi.xcertplay.receiver

import org.junit.Assert.assertEquals
import org.junit.Test

class ReceiverRequestTargetTest {
    @Test fun absoluteAndOriginFormTargetsResolveToTheSameRouteWithoutDecodingThePath() {
        assertEquals("/scrub", receiverRequestPath("/scrub?position=90"))
        assertEquals("/scrub", receiverRequestPath("http://receiver:7000/scrub?position=90"))
        assertEquals("/info", receiverRequestPath("rtsp://receiver/info"))
        assertEquals("/", receiverRequestPath("https://receiver"))
        assertEquals("/scrub%2Fsecret", receiverRequestPath("http://receiver/scrub%2Fsecret"))
        assertEquals("*", receiverRequestPath("*"))
    }
}
