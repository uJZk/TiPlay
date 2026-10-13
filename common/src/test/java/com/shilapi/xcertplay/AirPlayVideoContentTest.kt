package com.shilapi.xcertplay

import org.junit.Assert.assertEquals
import org.junit.Test

class AirPlayVideoContentTest {
    @Test fun hlsSignatureRecognizesAppPlaylistsWithOptionalUtf8Bom() {
        val playlist = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nstream\n".toByteArray()
        assertEquals(AirPlayVideoContent.Kind.HLS, AirPlayVideoContent.kind(playlist))
        assertEquals(AirPlayVideoContent.Kind.HLS,
            AirPlayVideoContent.kind(byteArrayOf(0xef.toByte(), 0xbb.toByte(), 0xbf.toByte()) + playlist))
    }

    @Test fun nonPlaylistResponsesDoNotChangeTheMediaSource() {
        for (payload in listOf(ByteArray(0), "#EXT".toByteArray(), "<html>Error</html>".toByteArray(),
            byteArrayOf(0, 0, 0, 24) + "ftypisom".toByteArray())) {
            assertEquals(AirPlayVideoContent.Kind.OTHER, AirPlayVideoContent.kind(payload))
        }
    }
}
