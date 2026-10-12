package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class AirPlayVideoLayoutTest {
    @Test fun smallerLandscapeSourceUsesTheFullEncoderCanvas() {
        val aspect = requireNotNull(AirPlayVideoLayout.aspect(960, 540, 1f, 0))
        assertEquals(AirPlayVideoLayout.Viewport(0, 0, 1280, 720), AirPlayVideoLayout.fit(1280, 720, aspect))
    }

    @Test fun portraitVideoIsCenteredAndPreservedWithoutCropping() {
        val aspect = requireNotNull(AirPlayVideoLayout.aspect(1080, 1920, 1f, 0))
        assertEquals(AirPlayVideoLayout.Viewport(437, 0, 405, 720), AirPlayVideoLayout.fit(1280, 720, aspect))
    }

    @Test fun nonSquarePixelsAndUnappliedRotationUseTheDisplayAspect() {
        val aspect = requireNotNull(AirPlayVideoLayout.aspect(720, 576, 16f / 15, 0))
        assertEquals(AirPlayVideoLayout.Viewport(160, 0, 960, 720), AirPlayVideoLayout.fit(1280, 720, aspect))
        val rotated = requireNotNull(AirPlayVideoLayout.aspect(1920, 1080, 1f, 90))
        assertEquals(AirPlayVideoLayout.fit(1280, 720, 9f / 16), AirPlayVideoLayout.fit(1280, 720, rotated))
    }

    @Test fun unknownOrInvalidVideoSizeCannotReplaceAValidDisplayAspect() {
        assertNull(AirPlayVideoLayout.aspect(0, 1080, 1f, 0))
        assertNull(AirPlayVideoLayout.aspect(1920, 1080, Float.NaN, 0))
        assertNull(AirPlayVideoLayout.aspect(1920, 1080, Float.POSITIVE_INFINITY, 0))
        assertNull(AirPlayVideoLayout.aspect(1920, 1080, 0f, 0))
    }
}
