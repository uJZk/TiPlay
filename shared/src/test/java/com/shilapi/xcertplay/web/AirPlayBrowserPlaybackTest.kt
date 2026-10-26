package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test

class AirPlayBrowserPlaybackTest {
    private val state = AirPlayBrowserPlayback.State(100.0, 5.0, true, true, false, true)

    @Test fun snapshotKeepsRateSeparateFromPlayingAndRateCommandsStayBoundedToVideo() {
        var current = state.copy(playing = false, rate = 1.5)
        val rates = mutableListOf<Double?>()
        val binding = AirPlayBrowserPlayback.register({ current }) { action, value ->
            assertEquals("rate", action)
            rates.add(value)
        }
        try {
            val snapshot = AirPlayBrowserPlayback.snapshot()!!
            val id = snapshot["id"] as Long
            assertEquals(false, snapshot["playing"])
            assertEquals(1.5, snapshot["rate"])
            for (rate in listOf(null, Double.NaN, Double.POSITIVE_INFINITY, -1.0, 0.24, 4.01)) {
                assertFalse(AirPlayBrowserPlayback.command(id, "rate", rate))
            }
            for (rate in listOf(0.0, 0.25, 1.5, 4.0)) {
                assertTrue(AirPlayBrowserPlayback.command(id, "rate", rate))
            }
            assertEquals(listOf(0.0, 0.25, 1.5, 4.0), rates)
            current = current.copy(kind = "photo")
            assertFalse(AirPlayBrowserPlayback.command(id, "rate", 1.0))
        } finally { binding.close() }
    }

    @Test fun staleCommandsAndStaleCloseCannotAffectANewItem() {
        val first = AirPlayBrowserPlayback.register({ state }) { _, _ -> fail("stale item controlled") }
        val oldId = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        val commands = mutableListOf<String>()
        val second = AirPlayBrowserPlayback.register({ state }) { action, _ -> commands.add(action) }
        try {
            first.close()
            val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
            assertFalse(AirPlayBrowserPlayback.command(oldId, "stop"))
            assertTrue(AirPlayBrowserPlayback.command(id, "pause"))
            assertEquals(listOf("pause"), commands)
        } finally { second.close(); first.close() }
        assertNull(AirPlayBrowserPlayback.snapshot())
    }

    @Test fun seekRejectsInvalidValuesAndNonSeekableMedia() {
        var current = state
        val binding = AirPlayBrowserPlayback.register({ current }) { _, _ -> }
        try {
            val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
            listOf(null, Double.NaN, Double.POSITIVE_INFINITY, -1.0, 101.0).forEach {
                assertFalse(AirPlayBrowserPlayback.command(id, "seek", it))
            }
            assertTrue(AirPlayBrowserPlayback.command(id, "seek", 100.0))
            current = state.copy(seekable = false)
            assertFalse(AirPlayBrowserPlayback.command(id, "seek", 10.0))
            assertFalse(AirPlayBrowserPlayback.command(id, "pause", 1.0))
        } finally { binding.close() }
    }

    @Test fun liveAudioCannotReplaceAVisualAndItsCurrentOwnerReturnsAfterThePictureEnds() {
        val firstAudio = AirPlayAudioPlayback()
        val firstBinding = AirPlayBrowserPlayback.register(firstAudio::state, audio = firstAudio) { _, _ -> fail("retired audio controlled") }
        val firstId = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        val visualCommands = mutableListOf<String>()
        val video = AirPlayVideoPlayback(com.shilapi.xcertplay.receiver.ReceiverPlay(
            "https://example.test/film.mp4", 0.0, false), { _, _ -> null }, event = {})
        val visualBinding = AirPlayBrowserPlayback.register(video::state, video = video) { action, _ -> visualCommands += action }
        val visualId = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        val audioCommands = mutableListOf<String>()
        val currentAudio = AirPlayAudioPlayback().also {
            it.update(com.shilapi.xcertplay.receiver.ReceiverAudioMetadataUpdate(title = "Background music"))
        }
        val currentBinding = AirPlayBrowserPlayback.register(currentAudio::state, audio = currentAudio) { action, _ -> audioCommands += action }
        try {
            assertEquals(visualId, AirPlayBrowserPlayback.snapshot()!!["id"])
            assertSame(video, AirPlayBrowserPlayback.video(visualId))
            assertNull(AirPlayBrowserPlayback.audio(firstId))
            assertFalse(AirPlayBrowserPlayback.command(firstId, "stop"))
            assertTrue(AirPlayBrowserPlayback.command(visualId, "pause"))
            assertEquals(listOf("pause"), visualCommands)
            firstBinding.close()
            assertEquals(visualId, AirPlayBrowserPlayback.snapshot()!!["id"])
            visualBinding.close()
            val revealed = AirPlayBrowserPlayback.snapshot()!!
            val currentId = revealed["id"] as Long
            assertEquals("audio", revealed["kind"])
            assertEquals("Background music", revealed["title"])
            assertNotEquals(firstId, currentId)
            assertSame(currentAudio, AirPlayBrowserPlayback.audio(currentId))
            assertNull(AirPlayBrowserPlayback.video(visualId))
            assertFalse(AirPlayBrowserPlayback.command(visualId, "stop"))
            assertTrue(AirPlayBrowserPlayback.command(currentId, "pause"))
            assertEquals(listOf("pause"), audioCommands)
            visualBinding.close()
            assertEquals(currentId, AirPlayBrowserPlayback.snapshot()!!["id"])
        } finally { visualBinding.close(); firstBinding.close(); currentBinding.close() }
        assertNull(AirPlayBrowserPlayback.snapshot())
    }

    @Test fun replacingBackgroundAudioAndClosingItCannotRetireANewerPhoto() {
        val audio = AirPlayAudioPlayback()
        val audioBinding = AirPlayBrowserPlayback.register(audio::state, audio = audio) { _, _ -> }
        val audioId = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        val photo = AirPlayPhotoPlayback(byteArrayOf(-1, -40, -1, -39))
        val photoBinding = AirPlayBrowserPlayback.register({ state.copy(kind = "photo") }, photo = photo) { _, _ -> }
        val photoId = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
        try {
            assertSame(audio, AirPlayBrowserPlayback.audio(audioId))
            assertSame(photo, AirPlayBrowserPlayback.photo(photoId))
            assertFalse(AirPlayBrowserPlayback.command(audioId, "pause"))
            audioBinding.close()
            assertNull(AirPlayBrowserPlayback.audio(audioId))
            assertEquals(photoId, AirPlayBrowserPlayback.snapshot()!!["id"])
            assertSame(photo, AirPlayBrowserPlayback.photo(photoId))
        } finally { audioBinding.close(); photoBinding.close() }
        assertNull(AirPlayBrowserPlayback.snapshot())
    }

    @Test fun visualReplacementClosesOldResourcesAndNotifiesItsOwnerWithoutRetiringTheNewEntry() {
        val oldPhoto = AirPlayPhotoPlayback(byteArrayOf(-1, -40, -1, -39))
        val nextPhoto = AirPlayPhotoPlayback(byteArrayOf(-1, -40, -1, -39))
        var retired = 0
        var oldResourceClosed = false
        var replacementPresent = false
        val old = AirPlayBrowserPlayback.register({ state.copy(kind = "photo") }, photo = oldPhoto,
            onRetired = {
                retired++
                oldResourceClosed = oldPhoto.open(null) == null
                replacementPresent = AirPlayBrowserPlayback.snapshot()?.get("kind") == "photo"
            }) { _, _ -> }
        val next = AirPlayBrowserPlayback.register({ state.copy(kind = "photo") }, photo = nextPhoto) { _, _ -> }
        try {
            val id = AirPlayBrowserPlayback.snapshot()!!["id"] as Long
            old.close()
            assertEquals(1, retired)
            assertTrue(oldResourceClosed)
            assertTrue(replacementPresent)
            assertSame(nextPhoto, AirPlayBrowserPlayback.photo(id))
            assertNotNull(nextPhoto.open(null)?.also { it.close() })
        } finally { old.close(); next.close() }
        assertEquals(1, retired)
        assertNull(AirPlayBrowserPlayback.snapshot())
    }
}
