package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.airplay.AudioStreamId
import com.shilapi.xcertplay.airplay.MicrophoneConfig
import java.io.Closeable

/** No browser capture or software AEC. Only a verified duplex car Bluetooth route is accepted. */
interface BluetoothVoiceChannel : Closeable {
    fun start(config: MicrophoneConfig)
    fun stop()
    fun play(id: AudioStreamId, sampleRate: Int, channels: Int, pcm: ByteArray, discontinuity: Boolean = false, deadlineNanos: Long = Long.MAX_VALUE)
    fun clear(id: AudioStreamId)
}

data class BluetoothVoiceState(val state: String, val error: String? = null, val released: Boolean = false)

fun interface BluetoothVoiceFactory {
    fun create(state: (BluetoothVoiceState) -> Unit): BluetoothVoiceChannel
}

/** CarPlay guidance uses default/compatibility on the low-rate stream, not the media stream. */
object BluetoothVoicePolicy {
    private val mediaTypes = setOf(102, 103)
    private val navigationPurposes = setOf("navigation", "default", "compatibility")
    private val voicePurposes = setOf("telephony", "speechrecognition")
    fun navigation(id: AudioStreamId): Boolean = id.type !in mediaTypes &&
        id.audioType.lowercase() in navigationPurposes
    fun allowed(id: AudioStreamId): Boolean = navigation(id) || id.audioType.lowercase() in voicePurposes
}
