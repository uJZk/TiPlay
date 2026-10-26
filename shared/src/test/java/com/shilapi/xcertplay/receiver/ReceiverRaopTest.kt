package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test

class ReceiverRaopTest {
    private val alac = "v=0\r\nm=audio 0 RTP/AVP 96\r\na=rtpmap:96 AppleLossless\r\n" +
        "a=fmtp:96 352 0 16 40 10 14 2 255 0 0 44100\r\n"

    @Test fun classicAlacNegotiatesTheCookieActuallyPassedToTheBrowser() {
        val result = ReceiverRaop.announce(alac.toByteArray())
        assertEquals(ReceiverMirrorAudioFormat(2, 44100, 2, 352, 16), result.format)
        assertEquals(96, result.stream(7000)["type"])
        assertEquals(7000, result.stream(7000)["controlPort"])
        assertNull(result.encryptedKey)
        assertNull(result.iv)
        assertEquals(24, result.format.codecConfig().size)
        rejects { ReceiverRaop.announce(alac.replace("40 10 14", "41 10 14").toByteArray()) }
        rejects { ReceiverRaop.announce(alac.replace("AppleLossless", "AppleLossless/48000/2").toByteArray()) }
    }

    @Test fun pcmAndFairPlayTransportKeysRemainIndependent() {
        val pcm = "v=0\nm=audio 0 RTP/AVP 96\na=rtpmap:96 L16/44100/2\n"
        val plain = ReceiverRaop.announce(pcm.toByteArray())
        assertEquals(1, plain.format.codec)
        val key = java.util.Base64.getEncoder().withoutPadding().encodeToString(ByteArray(72) { it.toByte() })
        val iv = java.util.Base64.getEncoder().withoutPadding().encodeToString(ByteArray(16) { (it + 1).toByte() })
        val encrypted = ReceiverRaop.announce((pcm + "a=fpaeskey:$key\na=aesiv:$iv\n").toByteArray())
        assertArrayEquals(ByteArray(72) { it.toByte() }, encrypted.encryptedKey)
        assertArrayEquals(ByteArray(16) { (it + 1).toByte() }, encrypted.iv)
        rejects { ReceiverRaop.announce((pcm + "a=aesiv:$iv\n").toByteArray()) }
        try {
            ReceiverRaop.announce((pcm + "a=rsaaeskey:$key\na=aesiv:$iv\n").toByteArray())
            fail("RSA transport key must not be accepted as FairPlay")
        } catch (_: ReceiverRaop.UnsupportedEncryption) { }
    }

    @Test fun duplicatePayloadsAttributesAndUnsupportedFormatsFailBeforeNegotiation() {
        for (body in listOf(alac + "a=rtpmap:96 AppleLossless\n", alac + "m=video 0 RTP/AVP 97\n",
                alac.replace("96 AppleLossless", "97 AppleLossless"),
                alac.replace("16 40", "32 40"), alac.replace("44100", "192000"),
                alac.replace("352 0", "65536 0"), alac + "\u0000")) {
            rejects { ReceiverRaop.announce(body.toByteArray()) }
        }
    }

    @Test fun udpTransportReturnsOnlyPortsOwnedByTheReceiver() {
        val transport = ReceiverRaop.transport("RTP/AVP/UDP;unicast;mode=\"record\";control_port=6001;timing_port=6002")
        assertEquals(6001, transport.controlPort)
        assertEquals(6002, transport.timingPort)
        assertEquals("RTP/AVP/UDP;unicast;mode=record;control_port=7001;timing_port=7002;server_port=7000",
            transport.response(7000, 7001, 7002))
        for (value in listOf("RTP/AVP/TCP;unicast;mode=record;control_port=6001;timing_port=6002",
                "RTP/AVP/UDP;multicast;mode=record;control_port=6001;timing_port=6002",
                "RTP/AVP/UDP;unicast;mode=record;control_port=0;timing_port=6002",
                "RTP/AVP/UDP;unicast;mode=record;control_port=6001;timing_port=65536",
                "RTP/AVP/UDP;unicast;mode=record;control_port=6001;control_port=6003;timing_port=6002",
                "RTP/AVP/UDP;unicast;mode=record;control_port=6001;timing_port=6002;destination=192.0.2.1")) {
            rejects { ReceiverRaop.transport(value) }
        }
    }

    private fun rejects(action: () -> Unit) {
        try { action(); fail("invalid negotiation accepted") } catch (_: IllegalArgumentException) { }
    }
}
