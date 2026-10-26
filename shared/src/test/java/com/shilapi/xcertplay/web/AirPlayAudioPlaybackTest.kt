package com.shilapi.xcertplay.web

import com.shilapi.xcertplay.receiver.ReceiverAudioArtwork
import com.shilapi.xcertplay.receiver.ReceiverAudioMetadataUpdate
import com.shilapi.xcertplay.receiver.ReceiverAudioProgress
import org.junit.Assert.*
import org.junit.Test

class AirPlayAudioPlaybackTest {
    @Test fun confirmedRemoteProgressMovesThePausedCueButPeriodicProgressDoesNot() {
        val audio = AirPlayAudioPlayback()
        fun progress(seconds: Long, start: Long = 0) = ReceiverAudioMetadataUpdate(
            progress = ReceiverAudioProgress(start, start + seconds * 48000, start + 200 * 48000),
        )
        audio.update(progress(100))
        audio.sample(100 * 48000L, 48000)
        audio.setPaused(true)
        audio.update(progress(101))
        assertEquals(100.0, audio.state().position, 0.0)
        audio.remoteRequested()
        audio.remoteFinished(true)
        audio.timelineReset() // FLUSH may precede the sender's new progress.
        audio.remoteIdle() // Busy may clear before the metadata callback is delivered.
        audio.update(progress(90))
        assertFalse(audio.state().playing)
        assertEquals(90.0, audio.state().position, 0.0)
        audio.update(progress(91))
        assertEquals(90.0, audio.state().position, 0.0)
        audio.remoteRequested("next")
        audio.remoteFinished(true)
        audio.update(ReceiverAudioMetadataUpdate(title = "Next sender track"))
        assertEquals(false, audio.source()["progressKnown"])
        assertEquals(0.0, audio.state().duration, 0.0)
        audio.update(progress(0, 50_000_000))
        assertEquals(true, audio.source()["progressKnown"])
        assertEquals(0.0, audio.state().position, 0.0)
        audio.remoteRequested()
        audio.remoteExpired()
        audio.update(progress(1, 50_000_000))
        assertEquals("An expired remote request cannot move a receiver-paused cue", 0.0, audio.state().position, 0.0)
        audio.remoteRequested()
        audio.remoteFinished(false)
        audio.update(progress(2, 50_000_000))
        assertEquals(0.0, audio.state().position, 0.0)
        audio.close()
    }

    @Test fun senderMetadataAndOriginalArtworkHaveARevisionWithoutClaimingTheCanvas() {
        val audio = AirPlayAudioPlayback()
        val original = byteArrayOf(0xff.toByte(), 0xd8.toByte(), 1, 2, 0xff.toByte(), 0xd9.toByte())
        audio.update(ReceiverAudioMetadataUpdate(title = "夜曲", artist = "Artist", album = "Album",
            artwork = ReceiverAudioArtwork(original, "image/jpeg")))
        original[2] = 99
        val registration = AirPlayBrowserPlayback.register(audio::state, audio = audio) { _, _ -> }
        try {
            val state = requireNotNull(AirPlayBrowserPlayback.snapshot())
            val id = (state["id"] as Number).toLong()
            assertSame(audio, AirPlayBrowserPlayback.audio(id))
            assertNull(AirPlayBrowserPlayback.video(id))
            assertNull(AirPlayBrowserPlayback.photo(id))
            assertEquals("夜曲", state["title"])
            assertEquals("Artist", state["artist"])
            assertEquals("Album", state["album"])
            assertEquals("audio", state["kind"])
            assertFalse("Audio cover art is not a CarPlay display resource", state.containsKey("resource"))
            assertEquals("receiver", state["controlScope"])
            assertEquals(listOf("play", "pause", "stop"), state["controls"])
            val resource = requireNotNull(state["artworkResource"] as? String)
            audio.open(resource, null)!!.use {
                assertEquals("image/jpeg", it.type)
                assertArrayEquals(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 1, 2, 0xff.toByte(), 0xd9.toByte()),
                    it.body.readBytes())
            }
            audio.open(resource, "bytes=2-3")!!.use {
                assertEquals(206, it.status)
                assertArrayEquals(byteArrayOf(1, 2), it.body.readBytes())
            }
            val replacement = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
            audio.update(ReceiverAudioMetadataUpdate(artwork = ReceiverAudioArtwork(replacement, "image/png")))
            val revised = requireNotNull(audio.source()["artworkResource"] as? String)
            assertNotEquals(resource, revised)
            assertNull("A late request cannot receive a replacement cover under the old key", audio.open(resource, null))
            audio.open(revised, null)!!.use { assertArrayEquals(replacement, it.body.readBytes()) }
            audio.update(ReceiverAudioMetadataUpdate(title = "", artwork = ReceiverAudioArtwork(ByteArray(0), null)))
            assertEquals("", audio.source()["title"])
            assertNull(audio.source()["artworkResource"])
            assertNull(audio.open(revised, null))
        } finally { registration.close() }
        assertTrue(audio.source().isEmpty())
    }

    @Test fun wrappedSenderSamplesDriveProgressAndReceiverPauseFreezesTheShownPosition() {
        val audio = AirPlayAudioPlayback()
        val start = 0xffff_f000L
        fun wire(offset: Long) = (start + offset) and 0xffff_ffffL
        audio.update(ReceiverAudioMetadataUpdate(durationMillis = 200_000L))
        assertEquals(200.0, audio.state().duration, 0.0)
        audio.update(ReceiverAudioMetadataUpdate(progress = ReceiverAudioProgress(start, wire(48_000), wire(192_000))))
        audio.sample(start + 24_000, 48_000)
        assertEquals(4.0, audio.state().duration, 0.0)
        assertEquals("An in-flight older packet cannot rewind the progress report", 1.0, audio.state().position, 0.0)
        audio.sample(start + 96_000, 48_000)
        assertEquals(2.0, audio.state().position, 0.0)
        audio.setPaused(true)
        audio.sample(start + 144_000, 48_000)
        assertFalse(audio.state().playing)
        assertEquals(2.0, audio.state().position, 0.0)
        audio.setPaused(false)
        assertTrue(audio.state().playing)
        assertEquals(3.0, audio.state().position, 0.0)
        audio.sample(start + 240_000, 48_000)
        assertEquals("An out-of-track packet cannot move the sender timeline to its end", 3.0, audio.state().position, 0.0)
        assertFalse(audio.state().seekable)
        audio.close()
        audio.sample(start + 96_000, 48_000)
        audio.update(ReceiverAudioMetadataUpdate(title = "late old sender"))
        assertFalse(audio.state().ready)
        assertFalse(audio.state().playing)
        assertTrue(audio.source().isEmpty())
    }

    @Test fun audioCommandsAreReceiverScopedAndLateIdsCannotControlASuccessor() {
        val first = AirPlayAudioPlayback()
        val calls = mutableListOf<String>()
        val firstRegistration = AirPlayBrowserPlayback.register(first::state, audio = first) { action, _ ->
            calls.add(action)
            if (action == "pause") first.setPaused(true)
            if (action == "play") first.setPaused(false)
        }
        val firstId = (AirPlayBrowserPlayback.snapshot()!!["id"] as Number).toLong()
        val successor = AirPlayAudioPlayback()
        var successorRegistration: java.io.Closeable? = null
        try {
            assertTrue(AirPlayBrowserPlayback.command(firstId, "pause"))
            assertFalse(first.state().playing)
            assertTrue(AirPlayBrowserPlayback.command(firstId, "play"))
            assertTrue(first.state().playing)
            assertFalse(AirPlayBrowserPlayback.command(firstId, "seek", 3.0))
            assertFalse(AirPlayBrowserPlayback.command(firstId, "rate", 2.0))
            assertFalse(AirPlayBrowserPlayback.command(firstId, "next"))
            assertEquals(listOf("pause", "play"), calls)
            successorRegistration = AirPlayBrowserPlayback.register(successor::state, audio = successor) { _, _ -> }
            val nextId = (AirPlayBrowserPlayback.snapshot()!!["id"] as Number).toLong()
            assertFalse(AirPlayBrowserPlayback.command(firstId, "stop"))
            assertNull(AirPlayBrowserPlayback.audio(firstId))
            firstRegistration.close()
            assertSame(successor, AirPlayBrowserPlayback.audio(nextId))
            assertTrue(successor.state().ready)
        } finally { firstRegistration.close(); successorRegistration?.close() }
    }

    @Test fun senderCommandsRequireCurrentCapabilitiesAndRejectBrowserSuppliedValues() {
        val audio = AirPlayAudioPlayback()
        val calls = mutableListOf<String>()
        val registration = AirPlayBrowserPlayback.register(audio::state, audio = audio) { action, _ -> calls.add(action) }
        try {
            val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
            val remote = listOf("previous", "next", "skip-back", "skip-forward")
            remote.forEach { assertFalse(AirPlayBrowserPlayback.command(id, it)) }
            audio.remoteControls(listOf("skip-forward", "seek", "next", "previous", "next", "unknown"))
            val supported = listOf("previous", "next", "skip-forward")
            assertEquals(supported, audio.source()["remoteControls"])
            assertEquals(listOf("play", "pause", "stop") + supported, audio.source()["controls"])
            assertEquals("sender", audio.source()["remoteControlScope"])
            supported.forEach { action ->
                for (value in listOf(-10.0, 0.0, 10.0, Double.NaN, Double.POSITIVE_INFINITY))
                    assertFalse(AirPlayBrowserPlayback.command(id, action, value))
                assertTrue(AirPlayBrowserPlayback.command(id, action))
            }
            assertEquals(supported, calls)
            assertFalse(AirPlayBrowserPlayback.command(id, "skip-back"))
            assertFalse(AirPlayBrowserPlayback.command(id, "seek", 10.0))
            assertFalse(AirPlayBrowserPlayback.command(id, "rate", 1.5))

            audio.remoteRequested()
            assertEquals(true, audio.source()["remotePending"])
            supported.forEach {
                assertFalse(audio.canRemote(it))
                assertFalse(AirPlayBrowserPlayback.command(id, it))
            }
            audio.remoteFinished(true)
            assertFalse("HTTP success does not release the executor's pending slot", audio.canRemote("next"))
            audio.remoteIdle()
            assertEquals(false, audio.source()["remotePending"])
            assertTrue(audio.canRemote("next"))
            audio.remoteControls(emptyList())
            supported.forEach { assertFalse(AirPlayBrowserPlayback.command(id, it)) }
            assertEquals(listOf("play", "pause", "stop"), audio.source()["controls"])
        } finally { registration.close() }
        assertFalse(audio.canRemote("next"))
    }

    @Test fun aRemoteBackSeekWaitsForTheSendersProgressAndTimelineBoundary() {
        val audio = AirPlayAudioPlayback()
        val rate = 48_000
        val origin = 1_000_000L
        fun at(seconds: Int) = origin + seconds * rate.toLong()
        audio.remoteControls(listOf("skip-back", "skip-forward"))
        audio.update(ReceiverAudioMetadataUpdate(progress = ReceiverAudioProgress(origin, at(100), at(200))))
        audio.sample(at(100), rate)
        assertEquals(100.0, audio.state().position, 0.0)

        audio.remoteRequested()
        audio.sample(at(105), rate)
        assertEquals("Queued pre-seek audio must not advance a pending sender command", 100.0, audio.state().position, 0.0)
        audio.remoteFinished(true)
        assertEquals("An HTTP acknowledgement cannot invent the new playback position", 100.0, audio.state().position, 0.0)
        audio.update(ReceiverAudioMetadataUpdate(progress = ReceiverAudioProgress(origin, at(30), at(200))))
        assertEquals(30.0, audio.state().position, 0.0)
        audio.sample(at(100), rate)
        assertEquals("Old queued audio must not undo the sender's backward progress update", 30.0, audio.state().position, 0.0)
        audio.remoteIdle()
        assertTrue(audio.canRemote("skip-back"))
        audio.sample(at(101), rate)
        assertEquals("Finishing the command worker is not a source-timeline boundary", 30.0, audio.state().position, 0.0)
        audio.timelineReset()
        audio.sample(at(31), rate)
        assertEquals(31.0, audio.state().position, 0.0)

        val nextOrigin = 40_000_000L
        audio.update(ReceiverAudioMetadataUpdate(progress = ReceiverAudioProgress(nextOrigin, nextOrigin, nextOrigin + rate * 200L)))
        audio.sample(nextOrigin - 1, rate)
        assertEquals("A packet before a new track's origin cannot wrap to its end", 0.0, audio.state().position, 0.0)
        audio.close()
    }

    @Test fun aRejectedSenderCommandResumesSourceProgressAfterItsPendingSlotIsReleased() {
        val audio = AirPlayAudioPlayback()
        audio.remoteControls(listOf("next"))
        audio.update(ReceiverAudioMetadataUpdate(progress = ReceiverAudioProgress(0, 48_000, 480_000)))
        audio.sample(48_000, 48_000)
        audio.remoteRequested()
        audio.remoteFinished(false)
        assertFalse(audio.canRemote("next"))
        audio.sample(96_000, 48_000)
        assertEquals(2.0, audio.state().position, 0.0)
        audio.remoteIdle()
        assertTrue(audio.canRemote("next"))
        audio.close()
    }
}
