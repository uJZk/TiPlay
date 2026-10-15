package com.shilapi.xcertplay

import android.media.MediaMetadata
import android.media.session.MediaSession
import android.os.Looper
import com.shilapi.xcertplay.media.CarPlayNowPlaying
import com.shilapi.xcertplay.orchestration.CarPlayController
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowMediaSession
import org.robolectric.shadow.api.Shadow
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE, shadows = [CarPlayArtworkDisabledTest.MetadataSessionShadow::class])
@LooperMode(LooperMode.Mode.PAUSED)
class CarPlayArtworkDisabledTest {
    /** Record the actual app-to-platform payload: Robolectric controllers do not mirror it. */
    @Implements(MediaSession::class)
    class MetadataSessionShadow : ShadowMediaSession() {
        var submittedMetadata: MediaMetadata? = null
            private set
        @Implementation protected fun setMetadata(value: MediaMetadata?) { submittedMetadata = value }
    }

    @Test fun browserDoesNotInstallArtworkCallbacksStartDecodeOrPublishMusicCovers() {
        val app = RuntimeEnvironment.getApplication()
        val controller = mock(CarPlayController::class.java)
        `when`(controller.receivesArtwork()).thenReturn(false)
        `when`(controller.receivesTextMetadata()).thenReturn(false)
        `when`(controller.phoneBrowserMode()).thenReturn(true)
        `when`(controller.nowPlayingSnapshot()).thenReturn(CarPlayNowPlaying(
            title = "Song", artist = "Artist", durationMillis = 30_000, elapsedMillis = 2_000, artworkTransferId = 12))
        AirPlayPersistence.saveDisableMediaKeyAudioFocus(app, true)
        try {
            CarPlayMediaKeys.attach(app, controller)
            CarPlayMediaKeys.onMediaAudioChanged(true)
            shadowOf(Looper.getMainLooper()).idle()
            assertNull(controller.artworkListener)
            assertNull(ReflectionHelpers.getField<Any?>(CarPlayMediaKeys, "artworkOwner"))
            assertNull(ReflectionHelpers.getField<Any?>(CarPlayMediaKeys, "initialAlbumRetry"))
            val queue = ReflectionHelpers.getField<Any>(CarPlayMediaKeys, "artworkQueue")
            assertFalse(ReflectionHelpers.getField<Boolean>(queue, "workerScheduled"))
            val session = ReflectionHelpers.getField<MediaSession>(CarPlayMediaKeys, "session")
            val metadata = requireNotNull(Shadow.extract<MetadataSessionShadow>(session).submittedMetadata)
            assertNull(metadata.getString(MediaMetadata.METADATA_KEY_TITLE))
            assertNull(metadata.getString(MediaMetadata.METADATA_KEY_ARTIST))
            assertEquals(30_000L, metadata.getLong(MediaMetadata.METADATA_KEY_DURATION))
            assertNull(metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART))
            assertNull(metadata.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON))
        } finally {
            CarPlayMediaKeys.detach(controller)
            AirPlayPersistence.saveDisableMediaKeyAudioFocus(app, false)
            shadowOf(Looper.getMainLooper()).idle()
        }
    }
}
