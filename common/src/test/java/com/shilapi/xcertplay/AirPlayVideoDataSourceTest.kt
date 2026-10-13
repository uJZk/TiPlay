package com.shilapi.xcertplay

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import com.shilapi.xcertplay.receiver.ReceiverResource
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.IOException

@OptIn(UnstableApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class AirPlayVideoDataSourceTest {
    private class Unreachable : DataSource {
        var opened = 0
        var closed = 0
        override fun addTransferListener(transferListener: TransferListener) = Unit
        override fun open(dataSpec: DataSpec): Long { opened++; throw IOException("offline") }
        override fun read(buffer: ByteArray, offset: Int, length: Int) = -1
        override fun getUri(): Uri? = null
        override fun close() { closed++ }
    }

    @Test fun hlsPlaylistCanBeServedByIphoneWithoutDirectNetworkAccess() {
        val upstream = Unreachable()
        val payload = "#EXTM3U\n".toByteArray()
        val requested = mutableListOf<String>()
        val source = AirPlayVideoDataSource(upstream) { url -> requested.add(url); ReceiverResource(payload, 0, null) }
        assertEquals(payload.size.toLong(), source.open(DataSpec(Uri.parse("http://iphone/master.m3u8"))))
        val output = ByteArray(payload.size)
        assertEquals(payload.size, source.read(output, 0, output.size))
        assertArrayEquals(payload, output)
        assertEquals(listOf("http://iphone/master.m3u8"), requested)
        assertEquals(0, upstream.opened)
        source.close()
    }

    @Test fun opaqueAppPlaylistSelectsHlsWithoutDependingOnTheUrlExtension() {
        val upstream = Unreachable()
        var playlists = 0
        val payload = "#EXTM3U\n#EXT-X-ENDLIST\n".toByteArray()
        val source = AirPlayVideoDataSource(upstream, onPlaylist = { playlists++ }) {
            ReceiverResource(payload, 0, null)
        }
        assertEquals(payload.size.toLong(), source.open(DataSpec(Uri.parse("mlhls://app/opaque-resource"))))
        assertEquals(1, playlists)
        assertEquals(0, upstream.opened)
        source.close()
    }

    @Test fun failedHttpDelegateIsClosedBeforeIphoneFallbackAndRangesAreRespected() {
        val upstream = Unreachable()
        val source = AirPlayVideoDataSource(upstream) { ReceiverResource(byteArrayOf(1, 2, 3, 4), 200, null) }
        val spec = DataSpec.Builder().setUri("https://example.org/segment.ts").setPosition(1).setLength(2).build()
        assertEquals(2L, source.open(spec))
        val output = ByteArray(2)
        assertEquals(2, source.read(output, 0, 2)); assertArrayEquals(byteArrayOf(2, 3), output)
        assertEquals(1, upstream.opened); assertEquals(1, upstream.closed)
        source.close()
    }

    @Test fun customResourcesMayNotRedirectToAndroidFilesOrFairPlayKeys() {
        for (location in listOf("file:///sdcard/movie", "content://provider/private", "skd://key")) {
            val upstream = Unreachable()
            var requested = 0
            val source = AirPlayVideoDataSource(upstream) { requested++; ReceiverResource(null, 302, location) }
            assertThrows(IOException::class.java) { source.open(DataSpec(Uri.parse("mlhls://app/master.m3u8"))) }
            assertEquals(1, requested); assertEquals(0, upstream.opened)
            source.close()
        }
    }

    @Test fun diagnosticsDistinguishHttpFailureFromIphoneRejectionWithoutResourceSecrets() {
        val messages = mutableListOf<String>()
        val source = AirPlayVideoDataSource(Unreachable(), AirPlayVideoDiagnostics(messages::add)) {
            ReceiverResource(null, 403, null)
        }
        assertThrows(IOException::class.java) {
            source.open(DataSpec(Uri.parse("https://private.example/segment.ts?token=private-token")))
        }
        val output = messages.joinToString("\n")
        assertTrue(output.contains("operation=RESOURCE_DIRECT exception=IOException"))
        assertTrue(output.contains("stage=RESOURCE_IPHONE value=403"))
        assertTrue(output.contains("operation=RESOURCE_OPEN exception=IOException"))
        assertFalse(output.contains("private.example")); assertFalse(output.contains("private-token"))
        source.close()
    }
}
