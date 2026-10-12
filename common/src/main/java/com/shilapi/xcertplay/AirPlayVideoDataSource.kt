package com.shilapi.xcertplay

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.ByteArrayDataSource
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import com.shilapi.xcertplay.airplay.VideoInCar
import com.shilapi.xcertplay.receiver.ReceiverResource
import java.io.IOException
import java.net.URI

/** UxPlay's FCUP playlist exchange adapted to Media3; local files and DRM key schemes remain blocked. */
@OptIn(UnstableApi::class)
internal class AirPlayVideoDataSource(private val upstream: DataSource,
                                    private val diagnostics: AirPlayVideoDiagnostics = AirPlayVideoDiagnostics {},
                                    private val onIphone: (String) -> ReceiverResource?) : DataSource {
    private var current: DataSource? = null
    private val transfers = mutableListOf<TransferListener>()
    override fun addTransferListener(transferListener: TransferListener) {
        transfers.add(transferListener); upstream.addTransferListener(transferListener)
    }

    override fun open(dataSpec: DataSpec): Long {
        check(current == null)
        diagnostics.stage(AirPlayVideoDiagnostics.Stage.RESOURCE_OPEN)
        try { return open(dataSpec, 0) }
        catch (error: Exception) {
            diagnostics.failure(AirPlayVideoDiagnostics.Stage.RESOURCE_OPEN, error)
            throw error
        }
    }

    private fun open(spec: DataSpec, redirects: Int): Long {
        val url = spec.uri.toString()
        if (!VideoInCar.isPlayableUrl(url, iphoneLoadsAppSchemes = true)) throw IOException("Unsupported video resource")
        val direct = spec.uri.scheme?.lowercase() in listOf("http", "https")
        var response: ReceiverResource? = null
        // iPhone apps often broker master/media playlists even when their URLs look like HTTP.
        if (!direct || spec.uri.path?.endsWith(".m3u8", true) == true) response = onIphone(url)
        if (response == null && direct) {
            try {
                val length = use(upstream, spec)
                diagnostics.stage(AirPlayVideoDiagnostics.Stage.RESOURCE_DIRECT, length)
                return length
            } catch (error: IOException) {
                diagnostics.failure(AirPlayVideoDiagnostics.Stage.RESOURCE_DIRECT, error)
                close(); response = onIphone(url)
            }
        }
        val resolved = response ?: throw IOException("iPhone did not load video resource")
        diagnostics.stage(AirPlayVideoDiagnostics.Stage.RESOURCE_IPHONE, resolved.status?.toLong())
        resolved.location?.let { location ->
            if (redirects >= 5) throw IOException("Too many video resource redirects")
            diagnostics.stage(AirPlayVideoDiagnostics.Stage.RESOURCE_REDIRECT, (redirects + 1).toLong())
            val next = URI(url).resolve(location).toString()
            return open(spec.withUri(Uri.parse(next)), redirects + 1)
        }
        if (resolved.status != null && resolved.status != 0 && resolved.status !in 200..299) throw IOException("iPhone rejected video resource")
        val bytes = resolved.bytes ?: throw IOException("iPhone sent no video resource")
        return use(ByteArrayDataSource(bytes).also { source -> transfers.forEach(source::addTransferListener) }, spec)
    }

    private fun use(source: DataSource, spec: DataSpec): Long {
        current = source
        try { return source.open(spec) }
        catch (error: Exception) { runCatching { close() }; throw error }
    }
    override fun read(buffer: ByteArray, offset: Int, length: Int): Int = current?.read(buffer, offset, length) ?: throw IOException("not open")
    override fun getUri(): Uri? = current?.uri
    override fun getResponseHeaders(): Map<String, List<String>> = current?.responseHeaders ?: emptyMap()
    override fun close() { try { current?.close() } finally { current = null } }
}
