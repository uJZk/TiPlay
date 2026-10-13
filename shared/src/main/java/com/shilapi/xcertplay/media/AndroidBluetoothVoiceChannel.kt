package com.shilapi.xcertplay.media

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioFormat as AndroidAudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.shilapi.xcertplay.airplay.AudioStreamId
import com.shilapi.xcertplay.airplay.MicrophoneConfig
import com.shilapi.xcertplay.airplay.MicrophoneCounters
import java.util.concurrent.atomic.AtomicBoolean

/** Android is the HFP audio gateway. Device selection never substitutes the handset microphone. */
@Suppress("DEPRECATION")
@SuppressLint("MissingPermission") // Both runtime permissions are checked before opening the route/devices.
class AndroidBluetoothVoiceChannel(context: Context, private val state: (BluetoothVoiceState) -> Unit) : BluetoothVoiceChannel {
    private val context = context.applicationContext
    private val manager = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private val mixer = BluetoothVoiceMixer()
    // Pausing an existing demand must not restart RTP or reuse a ChaCha nonce under its stream key.
    private val counters = java.util.WeakHashMap<MicrophoneConfig, MicrophoneCounters>()
    private var wanted: MicrophoneConfig? = null
    private var closed = false
    private var selected: AudioDeviceInfo? = null
    private var previousDevice: AudioDeviceInfo? = null
    private var previousMode = AudioManager.MODE_NORMAL
    private var acquired = false
    private var focusHeld = false
    private var connectingAt = 0L
    private var releasingAt = 0L
    private var failure: String? = null
    private var legacySco = false
    private var receiverRegistered = false
    private var profilePending = false
    private var devices: Devices? = null
    private var workerRetiring = false
    private var generation = 0
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(attributes).setOnAudioFocusChangeListener({ value ->
            if (value < 0 && acquired) fail("audio-focus-lost")
        }, main).build()
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            legacySco = intent?.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1) == AudioManager.SCO_AUDIO_STATE_CONNECTED
            tick()
        }
    }
    private val poll = Runnable { tick() }

    override fun start(config: MicrophoneConfig) { main.post {
        if (closed) return@post
        wanted = config; failure = null
        retireDevices()
        mixer.clear()
        state(BluetoothVoiceState("connecting"))
        if (releasingAt != 0L) schedule()
        else if (!acquired) acquire() else { connectingAt = SystemClock.elapsedRealtime(); tick() }
    } }
    override fun stop() { main.post { wanted = null; failure = null; release() } }
    override fun close() { main.post { closed = true; wanted = null; failure = null; release() } }
    override fun play(id: AudioStreamId, sampleRate: Int, channels: Int, pcm: ByteArray) { mixer.offer(id, sampleRate, channels, pcm) }
    override fun clear(id: AudioStreamId) { mixer.clear(id) }

    private fun permitted() = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
        (Build.VERSION.SDK_INT < 31 || context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED)

    private fun acquire() {
        if (!permitted()) { fail("microphone-or-bluetooth-permission"); return }
        if (manager.mode == AudioManager.MODE_IN_CALL || manager.mode == AudioManager.MODE_IN_COMMUNICATION ||
            (Build.VERSION.SDK_INT >= 31 && manager.communicationDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO)) {
            fail("communication-route-busy"); return
        }
        try {
            if (Build.VERSION.SDK_INT >= 31) {
                val candidates = manager.availableCommunicationDevices.filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
                if (candidates.size != 1) { fail(if (candidates.isEmpty()) "car-bluetooth-unavailable" else "multiple-bluetooth-headsets"); return }
                selected = candidates.single(); previousDevice = manager.communicationDevice
                openRoute()
            } else {
                if (!manager.isBluetoothScoAvailableOffCall) { fail("car-bluetooth-unavailable"); return }
                profilePending = true
                connectingAt = SystemClock.elapsedRealtime()
                val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
                val accepted = adapter?.getProfileProxy(context, object : BluetoothProfile.ServiceListener {
                    override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) { main.post {
                        try {
                            if (!profilePending || wanted == null || closed) return@post
                            profilePending = false
                            if ((proxy as BluetoothHeadset).connectedDevices.size != 1) { fail("car-bluetooth-unavailable"); return@post }
                            openRoute()
                        } catch (_: Exception) { fail("bluetooth-route-failed") }
                        finally { adapter.closeProfileProxy(profile, proxy) }
                    } }
                    override fun onServiceDisconnected(profile: Int) { main.post { if (acquired) fail("car-bluetooth-disconnected") } }
                }, BluetoothProfile.HEADSET) == true
                if (!accepted) fail("car-bluetooth-unavailable") else schedule()
            }
        } catch (_: Exception) { fail("bluetooth-route-failed") }
    }

    private fun openRoute() {
        if (wanted == null || closed) return
        if (manager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { fail("audio-focus-unavailable"); return }
        focusHeld = true
        previousMode = manager.mode
        acquired = true; releasingAt = 0; connectingAt = SystemClock.elapsedRealtime()
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= 31) {
            if (!manager.setCommunicationDevice(requireNotNull(selected))) { fail("bluetooth-route-rejected"); return }
        } else {
            context.registerReceiver(receiver, IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED))
            receiverRegistered = true
            legacySco = false
            manager.startBluetoothSco(); manager.isBluetoothScoOn = true
        }
        tick()
    }

    private fun scoReady(): Boolean = if (Build.VERSION.SDK_INT >= 31) {
        val device = manager.communicationDevice
        device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO && device.id == selected?.id
    } else legacySco && manager.isBluetoothScoOn

    private fun tick() {
        main.removeCallbacks(poll)
        try {
            if (releasingAt != 0L) {
                // Never resume browser sound while an owned SCO connection is still up.
                val up = if (Build.VERSION.SDK_INT >= 31) manager.communicationDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO else legacySco
                if (!up && !workerRetiring) finishRelease()
                else {
                    if (SystemClock.elapsedRealtime() - releasingAt >= 4000 && failure != "bluetooth-release-timeout") {
                        failure = "bluetooth-release-timeout"
                        state(BluetoothVoiceState("failed", failure, released = false))
                    }
                    schedule()
                }
                return
            }
            if (wanted == null || closed) return
            if (failure != null && !acquired && !profilePending && !workerRetiring) return
            if (!permitted()) { fail("microphone-or-bluetooth-permission"); return }
            if (acquired && manager.mode != AudioManager.MODE_IN_COMMUNICATION) { fail("communication-route-busy"); return }
            if (SystemClock.elapsedRealtime() - connectingAt >= 8000 && devices == null) { fail("bluetooth-connect-timeout"); return }
            if (acquired && scoReady()) {
                if (devices == null && !workerRetiring) createDevices(requireNotNull(wanted))
            } else if (devices != null) { fail("car-bluetooth-disconnected"); return }
            schedule()
        } catch (_: Exception) { fail("bluetooth-route-failed") }
    }
    private fun schedule() { main.removeCallbacks(poll); main.postDelayed(poll, 100) }

    private fun createDevices(config: MicrophoneConfig) {
        val inputCandidates = manager.getDevices(AudioManager.GET_DEVICES_INPUTS).filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
        val input = inputCandidates.singleOrNull { selected?.address?.isNotEmpty() == true && it.address == selected?.address }
            ?: inputCandidates.singleOrNull() ?: run { fail("bluetooth-input-unavailable"); return }
        val output = if (Build.VERSION.SDK_INT >= 31) selected else manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }.singleOrNull()
        if (output == null) { fail("bluetooth-output-unavailable"); return }
        val next = Devices(config, input, output, ++generation, counters.getOrPut(config) { MicrophoneCounters() })
        devices = next; next.start()
    }

    private fun fail(reason: String) {
        Log.w("TiPlayBluetoothVoice", "Voice route failed reason=$reason")
        failure = reason; profilePending = false
        state(BluetoothVoiceState("failed", reason, released = !acquired && !workerRetiring))
        release()
    }
    private fun retireDevices() {
        generation++
        val retiring = devices ?: return
        devices = null; workerRetiring = true
        retiring.running.set(false)
        // Stop can unblock a blocking read; releasing belongs to the worker after it exits.
        runCatching { retiring.record?.stop() }
        runCatching { retiring.track?.pause(); retiring.track?.flush() }
    }
    private fun release() {
        profilePending = false
        main.removeCallbacks(poll)
        retireDevices(); mixer.clear()
        if (!acquired) {
            if (workerRetiring) { releasingAt = SystemClock.elapsedRealtime(); schedule() } else finishRelease()
            return
        }
        state(BluetoothVoiceState("releasing", failure))
        releasingAt = SystemClock.elapsedRealtime()
        runCatching {
            if (Build.VERSION.SDK_INT >= 31) {
                // Do not clear a different communication device selected by another session/app.
                if (manager.communicationDevice?.id == selected?.id) {
                    if (previousDevice != null) manager.setCommunicationDevice(requireNotNull(previousDevice)) else manager.clearCommunicationDevice()
                }
            } else { manager.isBluetoothScoOn = false; manager.stopBluetoothSco() }
            if (manager.mode == AudioManager.MODE_IN_COMMUNICATION) manager.mode = previousMode
        }.onFailure { failure = "bluetooth-release-failed" }
        if (focusHeld) { runCatching { manager.abandonAudioFocusRequest(focus) }; focusHeld = false }
        tick()
    }
    private fun finishRelease() {
        main.removeCallbacks(poll)
        acquired = false; releasingAt = 0; selected = null
        if (receiverRegistered) { runCatching { context.unregisterReceiver(receiver) }; receiverRegistered = false }
        if (wanted != null && failure == null && !closed) acquire()
        else state(BluetoothVoiceState(if (failure != null && wanted != null) "failed" else "idle", failure, released = true))
    }

    private inner class Devices(val config: MicrophoneConfig, val input: AudioDeviceInfo, val output: AudioDeviceInfo, val token: Int,
        val packetCounters: MicrophoneCounters) {
        val running = AtomicBoolean(true)
        @Volatile var record: AudioRecord? = null
        @Volatile var track: AudioTrack? = null
        private fun matches(device: AudioDeviceInfo?, expected: AudioDeviceInfo) = device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO &&
            (device.id == expected.id || expected.address.isNotEmpty() && device.address == expected.address)
        fun start() { Thread({
            var sender: BrowserMicrophone? = null
            var outputThread: Thread? = null
            try {
                sender = BrowserMicrophone(config, packetCounters)
                val rate = 16_000 // Android's SCO resampler also supports narrowband (8 kHz) headsets.
                val minimum = AudioRecord.getMinBufferSize(rate, AndroidAudioFormat.CHANNEL_IN_MONO, AndroidAudioFormat.ENCODING_PCM_16BIT)
                check(minimum > 0)
                val capture = AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                    .setAudioFormat(AndroidAudioFormat.Builder().setSampleRate(rate).setChannelMask(AndroidAudioFormat.CHANNEL_IN_MONO)
                        .setEncoding(AndroidAudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(maxOf(minimum, rate * 2 / 5)).build().also { record = it }
                check(capture.state == AudioRecord.STATE_INITIALIZED && capture.setPreferredDevice(input))
                val audio = AudioTrack.Builder().setAudioAttributes(attributes)
                    .setAudioFormat(AndroidAudioFormat.Builder().setSampleRate(mixer.rate).setChannelMask(AndroidAudioFormat.CHANNEL_OUT_MONO)
                        .setEncoding(AndroidAudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(maxOf(AudioTrack.getMinBufferSize(mixer.rate, AndroidAudioFormat.CHANNEL_OUT_MONO,
                        AndroidAudioFormat.ENCODING_PCM_16BIT), mixer.rate * 2 / 10))
                    .setTransferMode(AudioTrack.MODE_STREAM).build().also { track = it }
                check(audio.state == AudioTrack.STATE_INITIALIZED && audio.setPreferredDevice(output))
                if (!running.get()) return@Thread
                audio.play(); capture.startRecording()
                val ready = AtomicBoolean(false)
                val begun = SystemClock.elapsedRealtime()
                outputThread = Thread({
                    try {
                        while (running.get()) {
                            val samples = if (ready.get()) mixer.next() else ShortArray(mixer.rate / 50)
                            var offset = 0
                            while (running.get() && offset < samples.size) {
                                val count = audio.write(samples, offset, samples.size - offset, AudioTrack.WRITE_BLOCKING)
                                check(count > 0) { "Bluetooth playback stopped" }; offset += count
                            }
                        }
                    } catch (_: Exception) { if (running.get()) main.post { if (token == generation) fail("bluetooth-output-failed") } }
                }, "tiplay-bluetooth-speaker").apply { isDaemon = true; start() }
                val resampler = VoicePcmResampler(rate, sender.sampleRate)
                val samples = ShortArray(rate / 50)
                while (running.get()) {
                    val count = capture.read(samples, 0, samples.size, AudioRecord.READ_BLOCKING)
                    if (!running.get()) break
                    check(count > 0) { "Bluetooth recording stopped" }
                    val routed = matches(capture.routedDevice, input) && matches(audio.routedDevice, output)
                    if (!routed) {
                        if (ready.get() || SystemClock.elapsedRealtime() - begun >= 2000) error("Bluetooth duplex route unavailable")
                        continue // Discard every sample before BOTH devices actually use SCO.
                    }
                    if (!ready.get()) {
                        ready.set(true)
                        main.post { if (token == generation && wanted === config && running.get()) state(BluetoothVoiceState("active")) }
                    }
                    val converted = resampler.convert(samples.copyOf(count))
                    val pcm = ByteArray(converted.size * 2)
                    converted.forEachIndexed { i, sample -> pcm[2 * i] = sample.toByte(); pcm[2 * i + 1] = (sample.toInt() shr 8).toByte() }
                    sender.accept(pcm)
                }
            } catch (_: Exception) { if (running.get()) main.post { if (token == generation) fail("bluetooth-duplex-failed") } }
            finally {
                running.set(false)
                runCatching { record?.stop() }; runCatching { track?.stop() }
                outputThread?.join(1000)
                record?.release(); track?.release(); sender?.close()
                main.post { workerRetiring = false; tick() }
            }
        }, "tiplay-bluetooth-microphone").apply { isDaemon = true; start() } }
    }
}
