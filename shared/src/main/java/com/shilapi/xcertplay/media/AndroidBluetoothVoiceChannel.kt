package com.shilapi.xcertplay.media

import com.shilapi.xcertplay.diagnostics.RawTraffic
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
import android.media.AudioDeviceCallback
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

internal fun sameBluetoothSelection(first: String?, second: String?): Boolean =
    if (first == null || second == null) first == null && second == null
    else first.trim().equals(second.trim(), ignoreCase = true)

internal fun <T> selectBluetoothAudioDevice(devices: List<T>, target: String?, address: (T) -> String?): T? =
    if (target == null) devices.singleOrNull()
    else devices.filter { candidate -> address(candidate)?.takeIf { it.isNotBlank() }
        ?.let { sameBluetoothSelection(target, it) } == true }.singleOrNull()

/** Playback preference is deliberately broader than microphone identity admission. */
internal fun <T> selectBluetoothPlaybackDevice(devices: List<T>, target: String?, current: T? = null,
    address: (T) -> String?): T? =
    devices.firstOrNull { target != null && sameBluetoothSelection(target, address(it)) }
        ?: current?.takeIf { it in devices } ?: devices.firstOrNull()

private fun audioAddress(device: AudioDeviceInfo): String? =
    if (Build.VERSION.SDK_INT >= 28) device.address.takeIf { it.isNotBlank() } else null

/** Diagnostic classification only; never substitutes an identity for route selection. */
internal fun bluetoothVoiceAddressIdentity(address: String?): String {
    val normalized = address?.trim()?.uppercase(java.util.Locale.ROOT).orEmpty()
    return when {
        normalized.isEmpty() -> "missing"
        !android.bluetooth.BluetoothAdapter.checkBluetoothAddress(normalized) -> "invalid"
        normalized in setOf("00:00:00:00:00:00", "02:00:00:00:00:00", "FF:FF:FF:FF:FF:FF") -> "placeholder"
        else -> "valid"
    }
}

private fun bluetoothVoiceAddressCounts(addresses: List<String?>): String {
    val identities = addresses.map(::bluetoothVoiceAddressIdentity)
    return "missingAddresses=${identities.count { it == "missing" }} invalidAddresses=${identities.count { it == "invalid" }}" +
        " placeholderAddresses=${identities.count { it == "placeholder" }} usableIdentityAddresses=${identities.count { it == "valid" }}"
}

/** Names provide correlation evidence, never identity or permission to use a device. */
internal fun bluetoothVoiceProfileRelations(selected: String?, sco: List<Pair<String?, String?>>, connected: List<Pair<String?, String?>>): String {
    val selectedDevices = connected.filter { selected != null && sameBluetoothSelection(selected, it.first) }
    val otherDevices = connected.filter { selected == null || !sameBluetoothSelection(selected, it.first) }
    fun addressMatches(candidate: Pair<String?, String?>, devices: List<Pair<String?, String?>>) =
        bluetoothVoiceAddressIdentity(candidate.first) == "valid" && devices.any {
            bluetoothVoiceAddressIdentity(it.first) == "valid" && sameBluetoothSelection(candidate.first, it.first)
        }
    fun nameMatches(candidate: Pair<String?, String?>, devices: List<Pair<String?, String?>>): Boolean {
        val name = candidate.second?.trim()?.takeIf { it.isNotEmpty() } ?: return false
        return devices.any { it.second?.trim()?.equals(name, ignoreCase = true) == true }
    }
    return "scoCandidates=${sco.size} ${bluetoothVoiceAddressCounts(sco.map { it.first })}" +
        " scoAddressSelectedMatches=${sco.count { addressMatches(it, selectedDevices) }}" +
        " scoAddressOtherMatches=${sco.count { addressMatches(it, otherDevices) }}" +
        " scoAddressUnmatched=${sco.count { bluetoothVoiceAddressIdentity(it.first) == "valid" && !addressMatches(it, connected) }}" +
        " scoNameSelectedMatches=${sco.count { nameMatches(it, selectedDevices) }}" +
        " scoNameOtherMatches=${sco.count { nameMatches(it, otherDevices) }}"
}

private val retryableFailures = setOf("car-bluetooth-unavailable", "car-bluetooth-disconnected",
    "bluetooth-input-unavailable", "bluetooth-output-unavailable", "bluetooth-connect-timeout", "bluetooth-route-rejected",
    "bluetooth-route-failed", "bluetooth-duplex-failed", "bluetooth-output-failed", "communication-route-busy",
    "audio-focus-unavailable")
private val nextVoiceDiagnosticId = java.util.concurrent.atomic.AtomicLong()
private val deviceUnavailableFailures = setOf("car-bluetooth-unavailable", "car-bluetooth-disconnected",
    "bluetooth-input-unavailable", "bluetooth-output-unavailable")
private val playbackFallbackFailures = setOf("car-bluetooth-disconnected", "bluetooth-output-unavailable",
    "bluetooth-connect-timeout", "bluetooth-route-rejected", "bluetooth-route-failed", "bluetooth-output-failed",
    "bluetooth-permission-denied", "microphone-or-bluetooth-permission", "audio-focus-unavailable", "communication-route-busy")

/** Android is the HFP audio gateway. Playback is best effort; capture never substitutes the handset microphone. */
@Suppress("DEPRECATION")
@SuppressLint("MissingPermission") // Bluetooth routing and microphone permissions are checked independently.
class AndroidBluetoothVoiceChannel(
    context: Context,
    private val state: (BluetoothVoiceState) -> Unit,
    private val diagnostic: (String) -> Unit = {},
    private val selectedCarAddress: (() -> String?)? = null,
) : BluetoothVoiceChannel {
    private val diagnosticId = nextVoiceDiagnosticId.incrementAndGet()
    private fun report(message: String) { runCatching { diagnostic("Browser audio: bluetooth route=$diagnosticId $message") } }
    private val context = context.applicationContext
    private val manager = context.getSystemService(AudioManager::class.java)
    private val main = Handler(Looper.getMainLooper())
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private val playbackAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()
    private val mixer = BluetoothVoiceMixer()
    // Pausing an existing demand must not restart RTP or reuse a ChaCha nonce under its stream key.
    private val counters = java.util.WeakHashMap<MicrophoneConfig, MicrophoneCounters>()
    @Volatile private var wanted: MicrophoneConfig? = null
    @Volatile private var closed = false
    private var selected: AudioDeviceInfo? = null
    private var acquired = false
    private var scoRoute = false
    @Volatile private var communicationOwned = false
    @Volatile private var communicationRequested = false
    @Volatile private var communicationDevice: AudioDeviceInfo? = null
    private var legacyScoRequested = false
    private var focusHeld = false
    @Volatile private var focusGranted = false
    @Volatile private var focusWaiting = false
    private var focusEpoch = 0L
    private var focus: AudioFocusRequest? = null
    private var focusSco: Boolean? = null
    private var defaultAfterRelease = false
    private var defaultPlayback = true
    private var playbackFallbackStage = 0
    private var playbackFallbackReason: String? = null
    private var routeReleaseRequested = false
    private var routeReleaseAttempts = 0
    private var routeReleaseRetryAt = 0L
    private var routeReleaseError: String? = null
    private var connectingAt = 0L
    private var releasingAt = 0L
    private var failure: String? = null
    private var legacySco = false
    private var receiverRegistered = false
    private var deviceObserverRegistered = false
    private var profilePending = false
    private var profileAttempt = 0L
    private var profileDiagnosticRequested = false
    private var profileDiagnosticEpoch = 0L
    private var activeCarAddress: String? = null
    private var failedCarAddress: String? = null
    private var unavailableAttempts = 0
    private var retryAt = Long.MAX_VALUE
    private var devices: Devices? = null
    private var workerRetiring = false
    @Volatile private var generation = 0
    internal var microphoneResampler: (Int, Int) -> PcmResampler = ::NativePcmResampler
    private var probeAttempted = false
    private var unownedScoWaitUntil = 0L
    @Volatile private var microphoneProbe: MicrophoneProbe? = null
    private var retiringProbe: MicrophoneProbe? = null
    private class MicrophoneProbe(val demand: MicrophoneConfig, val address: String,
        @Volatile var sink: AudioDeviceInfo, @Volatile var deadline: Long) {
        @Volatile var headset: BluetoothHeadset? = null
        @Volatile var cleaning = false
        @Volatile var active = false
        @Volatile var capture: CaptureInput? = null
        var reason = "bluetooth-input-unavailable"
    }
    /** A masked address is usable only with this particular live profile/route association. */
    private class CaptureInput(val device: AudioDeviceInfo, val probe: MicrophoneProbe? = null,
        val sinkPort: Int = 0, val headset: BluetoothHeadset? = null,
        val address: String? = audioAddress(device), val car: android.bluetooth.BluetoothDevice? = null) {
        var warmupUsed = false // Capture-worker confined; never inherited by a different route binding.
    }
    private data class RecordingRoute(val port: Int, val address: String?)
    private fun requestFocus(): Int {
        if (focusHeld && focusSco != scoRoute) abandonFocus()
        if (focusGranted) return AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (focusWaiting) return AudioManager.AUDIOFOCUS_REQUEST_DELAYED
        val epoch = ++focusEpoch
        val request = AudioFocusRequest.Builder(if (scoRoute) AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE else AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(if (scoRoute) attributes else playbackAttributes).setAcceptsDelayedFocusGain(true)
            .setOnAudioFocusChangeListener({ value ->
                if (epoch == focusEpoch) focusChanged(value)
            }, main).build()
        focus = request
        focusSco = scoRoute
        val result = manager.requestAudioFocus(request)
        focusGranted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        focusWaiting = result == AudioManager.AUDIOFOCUS_REQUEST_DELAYED
        focusHeld = focusGranted || focusWaiting
        return result
    }

    private fun focusChanged(value: Int) {
        if (!focusHeld || wanted == null || closed) return
        when (value) {
            AudioManager.AUDIOFOCUS_GAIN -> {
                if (!focusWaiting) return
                focusWaiting = false; focusGranted = true
                if (failure == "audio-focus-transient") failure = null
                state(BluetoothVoiceState("connecting"))
                // The retained request has regained focus; do not request it again
                // or bypass a worker/route that is still being retired.
                val epoch = focusEpoch
                val demand = wanted
                main.post { if (epoch == focusEpoch && wanted === demand && focusHeld && focusGranted &&
                    wanted != null && failure == null && !closed && !acquired && !profilePending &&
                    !workerRetiring && releasingAt == 0L) acquire() }
                schedule()
            }
            AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                focusGranted = false; focusWaiting = true
                failure = "audio-focus-transient"; failedCarAddress = activeCarAddress ?: failedCarAddress
                retryAt = Long.MAX_VALUE
                state(BluetoothVoiceState("failed", failure, released = !acquired && !workerRetiring))
                release(keepFocus = true)
            }
            AudioManager.AUDIOFOCUS_LOSS -> fail("audio-focus-lost")
        }
    }

    private fun abandonFocus() {
        val previous = focus
        focus = null; focusEpoch++
        if (focusHeld && previous != null) runCatching { manager.abandonAudioFocusRequest(previous) }
        focusHeld = false; focusGranted = false; focusWaiting = false
        focusSco = null
    }
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            legacySco = intent?.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1) == AudioManager.SCO_AUDIO_STATE_CONNECTED
            tick()
        }
    }
    private val poll = Runnable { tick() }
    private val deviceObserver = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
            if (closed || wanted == null || workerRetiring || profilePending || releasingAt != 0L || !permitted()) return
            val address = runCatching { selectedCarAddress?.invoke() }.getOrNull()
            val bluetooth = addedDevices.filter { it.isSink && bluetoothPlayback(it) }
            if (bluetooth.isEmpty()) return
            if (unownedScoWaitUntil != 0L) { tick(); return }
            if (microphoneProbe != null && bluetooth.any { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }) {
                tick(); return // The probe owns this transition; do not retire working A2DP.
            }
            if (acquired) {
                val carArrived = address != null && bluetooth.any { sameBluetoothSelection(address, audioAddress(it)) }
                val selectedCar = address != null && selected?.let { sameBluetoothSelection(address, audioAddress(it)) } == true
                val betterSco = carArrived && selected?.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO && bluetooth.any {
                    it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO && sameBluetoothSelection(address, audioAddress(it)) }
                if ((carArrived && (!selectedCar || betterSco)) || selected == null) {
                    report("stage=output-upgrade reason=bluetooth-arrived selectedCarMatch=$carArrived")
                    restartForSelectionChange()
                }
                return
            }
            if (failure !in deviceUnavailableFailures) return
            retryAt = SystemClock.elapsedRealtime()
            tick()
        }
    }

    private fun observeDevices() {
        if (deviceObserverRegistered) return
        runCatching { manager.registerAudioDeviceCallback(deviceObserver, main) }
            .onSuccess { deviceObserverRegistered = true }
            .onFailure { report("stage=device-observer result=unavailable exception=${it.javaClass.simpleName}") }
    }

    private fun stopObservingDevices() {
        if (!deviceObserverRegistered) return
        runCatching { manager.unregisterAudioDeviceCallback(deviceObserver) }
        deviceObserverRegistered = false
    }

    override fun start(config: MicrophoneConfig) { main.post {
        if (closed) return@post
        report("stage=demand codec=${config.codec} sampleRate=${config.sampleRate}")
        profileDiagnosticRequested = false
        profileDiagnosticEpoch++
        val replacing = wanted != null && wanted !== config
        if (wanted !== config) { probeAttempted = false; unownedScoWaitUntil = 0 }
        wanted = config; failure = null; unavailableAttempts = 0; retryAt = Long.MAX_VALUE
        playbackFallbackStage = 0; playbackFallbackReason = null
        observeDevices()
        if (replacing) { state(BluetoothVoiceState("connecting")); release(); return@post }
        retireDevices()
        mixer.clear()
        state(BluetoothVoiceState("connecting"))
        if (releasingAt != 0L) schedule()
        else if (!acquired && !focusWaiting) acquire() else { connectingAt = SystemClock.elapsedRealtime(); tick() }
    } }
    override fun stop() { main.post { wanted = null; failure = null; unownedScoWaitUntil = 0; stopObservingDevices(); release() } }
    override fun close() { main.post { closed = true; wanted = null; failure = null; unownedScoWaitUntil = 0; stopObservingDevices(); release() } }
    override fun play(id: AudioStreamId, sampleRate: Int, channels: Int, pcm: ByteArray, discontinuity: Boolean, deadlineNanos: Long) {
        mixer.offer(id, sampleRate, channels, pcm, discontinuity, deadlineNanos)
    }
    override fun clear(id: AudioStreamId) { mixer.clear(id) }

    private fun permitted() = Build.VERSION.SDK_INT < 31 ||
        context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    private fun microphonePermitted() = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun bluetoothPlayback(device: AudioDeviceInfo): Boolean = device.type in setOf(
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        AudioDeviceInfo.TYPE_HEARING_AID, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER)

    private fun mediaPlaybackDevice(): AudioDeviceInfo? = if (!permitted()) null else selectBluetoothPlaybackDevice(
        manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).filter { bluetoothPlayback(it) && it.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO },
        activeCarAddress, address = ::audioAddress)

    private fun openSystemPlayback(reason: String) {
        selected = mediaPlaybackDevice(); scoRoute = false
        defaultPlayback = selected == null
        report("stage=output-fallback reason=$reason target=${if (selected == null) "system-default" else "bluetooth"} selectedCarMatch=${activeCarAddress != null && sameBluetoothSelection(activeCarAddress, selected?.let(::audioAddress))}")
        openRoute()
    }

    private fun openDefaultPlayback(reason: String) {
        selected = null; scoRoute = false; defaultPlayback = true
        report("stage=output-fallback reason=$reason target=system-default")
        openRoute()
    }

    private fun acquire() {
        try {
            val address = selectedCarAddress?.invoke()?.trim()?.uppercase(java.util.Locale.ROOT)
            activeCarAddress = address
            failedCarAddress = address
            val permitted = permitted()
            report("stage=acquire selected=${!address.isNullOrBlank()} permission=$permitted")
            if (!permitted) { openDefaultPlayback("bluetooth-permission-denied"); return }
            report("stage=audio-mode mode=${manager.mode}")
            if (manager.mode == AudioManager.MODE_IN_CALL || manager.mode == AudioManager.MODE_IN_COMMUNICATION ||
                (Build.VERSION.SDK_INT >= 31 && manager.communicationDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO)) {
                if (Build.VERSION.SDK_INT >= 31 && manager.mode == AudioManager.MODE_NORMAL &&
                    !probeAttempted && unownedScoWaitUntil == 0L &&
                    bluetoothVoiceAddressIdentity(address) == "valid" && microphonePermitted()) {
                    // A previous app request can be withdrawn before its global SCO route disappears.
                    // Wait for the system to finish; never clear an unowned communication client.
                    unownedScoWaitUntil = SystemClock.elapsedRealtime() + 8000
                }
                openDefaultPlayback("communication-route-busy"); return
            }
            if (playbackFallbackStage != 0) {
                if (playbackFallbackStage == 1) openSystemPlayback(playbackFallbackReason ?: "sco-failed")
                else openDefaultPlayback(playbackFallbackReason ?: "bluetooth-output-failed")
                return
            }
            defaultPlayback = false
            if (Build.VERSION.SDK_INT >= 31) {
                val available = manager.availableCommunicationDevices
                val candidates = (available.filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO } +
                    manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).filter { bluetoothPlayback(it) && it.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO })
                    .distinctBy { it.id }
                val target = selectBluetoothPlaybackDevice(candidates, address, manager.communicationDevice) { audioAddress(it) }
                report("stage=communication-devices candidates=${candidates.size} addressAvailable=${candidates.count { audioAddress(it) != null }} matches=${candidates.count { sameBluetoothSelection(address, audioAddress(it)) && address != null }} selected=${target != null}" +
                    " types=${available.map { it.type }.distinct().sorted().joinToString(",")} namedCandidates=${candidates.count { !it.productName.isNullOrBlank() }}" +
                    " validAddresses=${candidates.count { audioAddress(it)?.let(android.bluetooth.BluetoothAdapter::checkBluetoothAddress) == true }}" +
                    " selectedIdentity=${bluetoothVoiceAddressIdentity(address)} ${bluetoothVoiceAddressCounts(candidates.map(::audioAddress))}")
                if (target == null || !sameBluetoothSelection(address, audioAddress(target))) diagnoseHeadsetProfile(address)
                selected = target
                defaultPlayback = target == null
                scoRoute = target?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                report("stage=output-selection target=${if (target == null) "system-default" else "bluetooth"} type=${target?.type ?: 0} selectedCarMatch=${address != null && target != null && sameBluetoothSelection(address, audioAddress(target))} fallback=${address == null || target == null || !sameBluetoothSelection(address, audioAddress(target))}")
                openRoute()
            } else {
                if (!manager.isBluetoothScoAvailableOffCall) { openSystemPlayback("sco-unavailable"); return }
                profilePending = true
                val attempt = ++profileAttempt
                connectingAt = SystemClock.elapsedRealtime()
                val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
                val accepted = adapter?.getProfileProxy(context, object : BluetoothProfile.ServiceListener {
                    override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) { main.post {
                        try {
                            if (attempt != profileAttempt || !profilePending || wanted == null || closed) return@post
                            profilePending = false
                            val connected = (proxy as BluetoothHeadset).connectedDevices
                            report("stage=headset-profile connected=${connected.size} selectedMatch=${address != null && connected.any { sameBluetoothSelection(address, it.address) }}")
                            // startBluetoothSco cannot select an HFP device. The target must
                            // be the sole connected headset and audio addresses must be visible.
                            if (connected.size != 1 || (address != null && (Build.VERSION.SDK_INT < 28 ||
                                    !connected.single().address.equals(address, ignoreCase = true)))) {
                                openSystemPlayback("headset-identity-unavailable"); return@post
                            }
                            if (!sameBluetoothSelection(address, selectedCarAddress?.invoke())) {
                                restartForSelectionChange(); return@post
                            }
                            scoRoute = true
                            openRoute()
                        } catch (_: SecurityException) { fail("bluetooth-permission-denied") }
                        catch (_: Exception) { fail("bluetooth-route-failed") }
                        finally { runCatching { adapter.closeProfileProxy(profile, proxy) } }
                    } }
                    override fun onServiceDisconnected(profile: Int) { main.post {
                        if (attempt == profileAttempt && acquired) fail("car-bluetooth-disconnected")
                    } }
                }, BluetoothProfile.HEADSET) == true
                if (!accepted) { profilePending = false; openSystemPlayback("headset-proxy-unavailable") } else schedule()
            }
        } catch (_: SecurityException) { fail("bluetooth-permission-denied") }
        catch (_: Exception) { fail("bluetooth-route-failed") }
    }

    /** A different SCO device says nothing about the selected car's HFP/A2DP profiles. */
    private fun diagnoseHeadsetProfile(address: String?) {
        if (profileDiagnosticRequested) return
        profileDiagnosticRequested = true
        val epoch = profileDiagnosticEpoch
        val demand = wanted
        val requestedAt = SystemClock.elapsedRealtime()
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
        if (adapter == null) { report("stage=headset-diagnostic result=no-adapter"); return }
        for ((id, label) in listOf(BluetoothProfile.HEADSET to "headset", BluetoothProfile.A2DP to "a2dp")) {
            try {
                val enabled = adapter.isEnabled
                val profileState = adapter.getProfileConnectionState(id)
                val accepted = adapter.getProfileProxy(context, object : BluetoothProfile.ServiceListener {
                    override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) { main.post {
                        try {
                            if (closed || wanted == null || wanted !== demand || epoch != profileDiagnosticEpoch ||
                                !sameBluetoothSelection(address, selectedCarAddress?.invoke())) return@post
                            val connected = proxy.connectedDevices
                            val sco = if (Build.VERSION.SDK_INT >= 31) manager.availableCommunicationDevices
                                .filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO } else emptyList()
                            val relations = bluetoothVoiceProfileRelations(address,
                                sco.map { audioAddress(it) to it.productName?.toString() },
                                connected.map { it.address to runCatching { it.name }.getOrNull() })
                            report("stage=headset-diagnostic profile=$label adapterEnabled=${adapter.isEnabled} profileState=${adapter.getProfileConnectionState(id)} connected=${connected.size} selectedMatch=${address != null && connected.any { sameBluetoothSelection(address, it.address) }}" +
                                " requestedAgeMs=${SystemClock.elapsedRealtime() - requestedAt} selectedIdentity=${bluetoothVoiceAddressIdentity(address)} $relations")
                        } catch (error: Exception) {
                            report("stage=headset-diagnostic profile=$label result=error exception=${error.javaClass.simpleName}")
                        } finally { runCatching { adapter.closeProfileProxy(profile, proxy) } }
                    } }
                    override fun onServiceDisconnected(profile: Int) = Unit
                }, id)
                report("stage=headset-diagnostic profile=$label adapterEnabled=$enabled profileState=$profileState result=${if (accepted) "requested" else "proxy-unavailable"}")
            } catch (error: Exception) {
                report("stage=headset-diagnostic profile=$label result=error exception=${error.javaClass.simpleName}")
            }
        }
    }

    private fun openRoute() {
        if (wanted == null || closed) return
        val focusResult = requestFocus()
        report("stage=audio-focus result=$focusResult")
        when (focusResult) {
            AudioManager.AUDIOFOCUS_REQUEST_DELAYED -> { scheduleFailure(); return }
            AudioManager.AUDIOFOCUS_REQUEST_GRANTED -> Unit
            else -> { fail("audio-focus-unavailable"); return }
        }
        acquired = true; releasingAt = 0; routeReleaseRequested = false; connectingAt = SystemClock.elapsedRealtime()
        if (!scoRoute) { tick(); return }
        communicationOwned = true
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= 31) {
            communicationDevice = selected
            communicationRequested = true // An IPC may throw after accepting our request.
            val accepted = manager.setCommunicationDevice(requireNotNull(selected))
            communicationRequested = accepted
            report("stage=communication-route accepted=$accepted")
            if (!accepted) {
                manager.mode = AudioManager.MODE_NORMAL
                communicationOwned = false; scoRoute = false; selected = mediaPlaybackDevice()
                defaultPlayback = selected == null
                playbackFallbackStage = 1; playbackFallbackReason = "bluetooth-route-rejected"
                report("stage=output-fallback reason=bluetooth-route-rejected target=${if (selected == null) "system-default" else "bluetooth"} type=${selected?.type ?: 0}")
                val fallbackFocus = requestFocus()
                report("stage=audio-focus result=$fallbackFocus usage=media")
                if (fallbackFocus == AudioManager.AUDIOFOCUS_REQUEST_DELAYED) { scheduleFailure(); return }
                if (fallbackFocus != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { fail("audio-focus-unavailable"); return }
            }
        } else {
            context.registerReceiver(receiver, IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED))
            receiverRegistered = true
            legacySco = false
            manager.startBluetoothSco(); legacyScoRequested = true; manager.isBluetoothScoOn = true
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
                // Device stop/release runs on its existing capture worker. Do not
                // reroute a still-playing AudioTrack to the handset during retirement.
                if (!workerRetiring && acquired && !routeReleaseRequested &&
                    SystemClock.elapsedRealtime() >= routeReleaseRetryAt) releaseRoute()
                // Never resume browser sound while an owned SCO connection is still up.
                // Device and mode clients are withdrawn by separate platform calls.
                // A successful device cancellation cannot prove that our mode client was removed.
                val up = communicationOwned || communicationRequested || legacyScoRequested ||
                    (Build.VERSION.SDK_INT < 31 && scoRoute && legacySco)
                if (!up && !workerRetiring) finishRelease()
                else {
                    if (SystemClock.elapsedRealtime() - releasingAt >= 4000 && routeReleaseError != "bluetooth-release-timeout") {
                        routeReleaseError = "bluetooth-release-timeout"
                        state(BluetoothVoiceState("failed", routeReleaseError, released = false))
                    }
                    schedule()
                }
                return
            }
            if (wanted == null || closed) return
            if (focusWaiting) {
                if (!permitted() && scoRoute) {
                    defaultAfterRelease = true
                    fail("microphone-or-bluetooth-permission"); return
                }
                if (!sameBluetoothSelection(activeCarAddress ?: failedCarAddress, selectedCarAddress?.invoke())) {
                    restartForSelectionChange(); return
                }
                scheduleFailure()
                return
            }
            if (failure != null && !acquired && !profilePending && !workerRetiring) {
                val changed = selectedCarAddress != null && !sameBluetoothSelection(failedCarAddress, selectedCarAddress.invoke())
                val permissionRestored = failure == "microphone-or-bluetooth-permission" && permitted()
                val retryDue = failure in retryableFailures && SystemClock.elapsedRealtime() >= retryAt
                if (changed || retryDue || permissionRestored) {
                    if (changed) {
                        unavailableAttempts = 0
                        profileDiagnosticRequested = false; profileDiagnosticEpoch++
                    }
                    failure = null
                    state(BluetoothVoiceState("connecting"))
                    acquire()
                } else scheduleFailure()
                return
            }
            if (!permitted() && scoRoute) {
                defaultAfterRelease = true
                fail("microphone-or-bluetooth-permission"); return
            }
            if (!sameBluetoothSelection(activeCarAddress, selectedCarAddress?.invoke())) {
                restartForSelectionChange(); return
            }
            if (acquired && scoRoute && communicationOwned && manager.mode != AudioManager.MODE_IN_COMMUNICATION) {
                fail("communication-route-busy"); return
            }
            if (SystemClock.elapsedRealtime() - connectingAt >= 8000 && devices == null) { fail("bluetooth-connect-timeout"); return }
            if (acquired && (!scoRoute || scoReady())) {
                if (devices == null && !workerRetiring) createDevices(requireNotNull(wanted))
            } else if (devices != null) { fail("car-bluetooth-disconnected"); return }
            try { tickMicrophoneProbe() } catch (_: Exception) {
                probeAttempted = true
                cancelMicrophoneProbe("bluetooth-route-failed")
            }
            schedule()
        } catch (_: SecurityException) { fail("bluetooth-permission-denied") }
        catch (_: Exception) { fail("bluetooth-route-failed") }
    }
    private fun schedule() { main.removeCallbacks(poll); main.postDelayed(poll, 100) }
    private fun scheduleFailure() { main.removeCallbacks(poll); main.postDelayed(poll, 1000) }

    private fun restartForSelectionChange() {
        // Releasing the previous route and its worker precedes acquiring the
        // newly selected device. Pending callbacks are invalidated by release().
        failure = null; unavailableAttempts = 0; retryAt = Long.MAX_VALUE
        playbackFallbackStage = 0; playbackFallbackReason = null
        profileDiagnosticRequested = false; profileDiagnosticEpoch++
        probeAttempted = false
        state(BluetoothVoiceState("connecting"))
        release()
    }

    private fun closeProbeProxy(probe: MicrophoneProbe? = microphoneProbe) {
        val proxy = probe?.headset ?: return
        probe.headset = null
        runCatching { context.getSystemService(BluetoothManager::class.java)?.adapter
            ?.closeProfileProxy(BluetoothProfile.HEADSET, proxy) }
    }

    private fun cancelMicrophoneProbe(reason: String) {
        val probe = microphoneProbe ?: return
        if (probe.cleaning) return
        probe.cleaning = true; probe.reason = reason
        devices?.revokeCapture()
        routeReleaseAttempts = 0; routeReleaseRetryAt = 0; routeReleaseRequested = false
        report("stage=microphone-bootstrap action=rollback reason=$reason")
    }

    private fun probeDemandCurrent(probe: MicrophoneProbe): Boolean = microphoneProbe === probe &&
        !closed && wanted === probe.demand && releasingAt == 0L && acquired && devices != null &&
        !workerRetiring && focusGranted && !focusWaiting && permitted() && microphonePermitted() &&
        sameBluetoothSelection(probe.address, selectedCarAddress?.invoke())

    private fun soleSelectedHeadset(probe: MicrophoneProbe): android.bluetooth.BluetoothDevice? {
        val headset = probe.headset ?: return null
        val device = headset.connectedDevices.singleOrNull() ?: return null
        return device.takeIf { sameBluetoothSelection(probe.address, it.address) &&
            headset.getConnectionState(it) == BluetoothProfile.STATE_CONNECTED }
    }

    private fun acceptableScoAddress(address: String?, selected: String): Boolean = when (bluetoothVoiceAddressIdentity(address)) {
        "missing", "placeholder" -> true
        "valid" -> sameBluetoothSelection(address, selected)
        else -> false
    }

    /** Android pairs the chosen communication sink with its source; do not equate their port IDs. */
    private fun probeInput(probe: MicrophoneProbe): CaptureInput? = runCatching {
        val headset = probe.headset ?: return@runCatching null
        if (microphoneProbe !== probe || probe.cleaning || wanted !== probe.demand || closed ||
            !communicationOwned || !communicationRequested || !focusGranted || focusWaiting ||
            !permitted() || !microphonePermitted() || manager.mode != AudioManager.MODE_IN_COMMUNICATION ||
            !sameBluetoothSelection(probe.address, selectedCarAddress?.invoke()))
            return@runCatching null
        val car = soleSelectedHeadset(probe) ?: return@runCatching null
        val sink = manager.availableCommunicationDevices.filter { it.isSink && it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            .singleOrNull() ?: return@runCatching null
        val actual = manager.communicationDevice ?: return@runCatching null
        val input = manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .filter { it.isSource && it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }.singleOrNull() ?: return@runCatching null
        if (sink.id <= 0 || actual.id != sink.id || !actual.isSink || actual.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO || input.id <= 0 ||
            !acceptableScoAddress(audioAddress(sink), probe.address) || !acceptableScoAddress(audioAddress(actual), probe.address) ||
            !acceptableScoAddress(audioAddress(input), probe.address)) return@runCatching null
        if (microphoneProbe !== probe || probe.headset !== headset || probe.cleaning || wanted !== probe.demand ||
            !sameBluetoothSelection(probe.address, selectedCarAddress?.invoke())) return@runCatching null
        CaptureInput(input, probe, actual.id, headset, car = car)
    }.getOrNull()

    private fun sameProbeInput(first: CaptureInput?, second: CaptureInput): Boolean = first != null &&
        first.probe === second.probe && first.headset === second.headset && first.device.id == second.device.id &&
        first.sinkPort == second.sinkPort && sameBluetoothSelection(first.address, second.address)

    private fun retireProbeCapture(probe: MicrophoneProbe) {
        if (microphoneProbe !== probe) return
        devices?.revokeCapture()
        probe.capture = null
        // Only a genuinely running duplex can begin a new bounded recovery window.
        // Initial warmup and port handoffs never extend the original startup budget.
        if (probe.active) {
            probe.active = false
            probe.deadline = SystemClock.elapsedRealtime() + 8000
        }
    }

    private fun tickMicrophoneProbe() {
        if (Build.VERSION.SDK_INT < 31) return
        var probe = microphoneProbe
        if (probe == null) {
            if (unownedScoWaitUntil != 0L && SystemClock.elapsedRealtime() >= unownedScoWaitUntil) {
                unownedScoWaitUntil = 0; probeAttempted = true
            }
            if (probeAttempted || scoRoute || !acquired || devices?.outputReady?.get() != true ||
                !focusGranted || focusWaiting || !permitted() || !microphonePermitted() ||
                communicationOwned || communicationRequested || workerRetiring) return
            val address = activeCarAddress ?: return
            val output = selected ?: devices?.track?.routedDevice
            if (bluetoothVoiceAddressIdentity(address) != "valid" || output?.type != AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
                !sameBluetoothSelection(address, audioAddress(output))) return
            if (manager.mode != AudioManager.MODE_NORMAL) { probeAttempted = true; return }
            if (manager.communicationDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                if (unownedScoWaitUntil == 0L) unownedScoWaitUntil = SystemClock.elapsedRealtime() + 8000
                return
            }
            val candidates = manager.availableCommunicationDevices.filter { it.isSink && it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            val sink = candidates.singleOrNull()?.takeIf {
                it.id > 0 && bluetoothVoiceAddressIdentity(audioAddress(it)) in setOf("missing", "placeholder") } ?: return
            probeAttempted = true
            unownedScoWaitUntil = 0
            val next = MicrophoneProbe(requireNotNull(wanted), address, sink, SystemClock.elapsedRealtime() + 8000)
            microphoneProbe = next
            report("stage=microphone-bootstrap action=qualify")
            val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
            try {
                val accepted = adapter?.getProfileProxy(context, object : BluetoothProfile.ServiceListener {
                    override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) { main.post {
                        var retained = false
                        try {
                            if (microphoneProbe !== next || next.cleaning || !probeDemandCurrent(next)) return@post
                            if (next.headset != null && next.headset !== proxy) {
                                cancelMicrophoneProbe("headset-identity-unavailable"); return@post
                            }
                            next.headset = proxy as? BluetoothHeadset
                            retained = next.headset != null
                            if (!retained) cancelMicrophoneProbe("headset-identity-unavailable")
                            tick()
                        } catch (_: Exception) {
                            if (microphoneProbe === next) cancelMicrophoneProbe("headset-identity-unavailable")
                        } finally {
                            if (!retained && retiringProbe?.headset !== proxy && microphoneProbe?.headset !== proxy)
                                runCatching { adapter.closeProfileProxy(profile, proxy) }
                        }
                    } }
                    override fun onServiceDisconnected(profile: Int) { main.post {
                        if (microphoneProbe === next) { cancelMicrophoneProbe("car-bluetooth-disconnected"); tick() }
                    } }
                }, BluetoothProfile.HEADSET) == true
                if (!accepted) cancelMicrophoneProbe("headset-proxy-unavailable")
            } catch (_: Exception) { cancelMicrophoneProbe("headset-proxy-unavailable") }
            return
        }
        if (probe.cleaning) {
            devices?.revokeCapture()
            if (devices?.captureRetiring() == true) return
            if ((communicationOwned || communicationRequested) && !routeReleaseRequested &&
                SystemClock.elapsedRealtime() >= routeReleaseRetryAt) releaseRoute()
            if (!communicationOwned && !communicationRequested) {
                closeProbeProxy(); microphoneProbe = null; communicationDevice = null
                routeReleaseError = null
                devices?.microphoneFailed(probe.reason)
            }
            return
        }
        try {
            if (!probeDemandCurrent(probe)) { cancelMicrophoneProbe("microphone-or-bluetooth-permission"); return }
            if (!probe.active && SystemClock.elapsedRealtime() >= probe.deadline) {
                cancelMicrophoneProbe("bluetooth-connect-timeout"); return
            }
            val headset = probe.headset ?: return
            val car = soleSelectedHeadset(probe) ?: run { cancelMicrophoneProbe("headset-identity-unavailable"); return }
            val candidates = manager.availableCommunicationDevices.filter { it.isSink && it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            val candidate = candidates.singleOrNull() ?: run { cancelMicrophoneProbe("headset-identity-unavailable"); return }
            if (candidate.id <= 0 || !acceptableScoAddress(audioAddress(candidate), probe.address)) {
                cancelMicrophoneProbe("headset-identity-unavailable"); return
            }
            if (!communicationOwned && !communicationRequested) {
                if (!probeDemandCurrent(probe) || manager.mode != AudioManager.MODE_NORMAL ||
                    manager.communicationDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || headset.isAudioConnected(car)) {
                    cancelMicrophoneProbe("communication-route-busy"); return
                }
                probe.sink = candidate
                communicationDevice = candidate
                communicationOwned = true
                manager.mode = AudioManager.MODE_IN_COMMUNICATION
                if (!probeDemandCurrent(probe) || soleSelectedHeadset(probe) == null ||
                    manager.availableCommunicationDevices.filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
                        .singleOrNull()?.id != candidate.id || manager.mode != AudioManager.MODE_IN_COMMUNICATION) {
                    cancelMicrophoneProbe("communication-route-busy"); return
                }
                communicationRequested = true
                if (!manager.setCommunicationDevice(candidate)) {
                    communicationRequested = false
                    cancelMicrophoneProbe("bluetooth-route-rejected"); return
                }
                report("stage=microphone-bootstrap action=request accepted=true")
            }
            if (manager.mode != AudioManager.MODE_IN_COMMUNICATION) {
                cancelMicrophoneProbe("communication-route-busy"); return
            }
            val input = probeInput(probe)
            if (input == null) {
                if (probe.capture != null) retireProbeCapture(probe)
                return
            }
            // AOSP can substitute the real active SCO port for a requested placeholder.
            // Bind to the current unique sink/source pair, never to a stale request ID.
            if (!sameProbeInput(probe.capture, input)) {
                retireProbeCapture(probe)
                probe.capture = input
                devices?.grantCapture(input)
                report("stage=microphone-bootstrap action=input-associated")
            }
        } catch (_: Exception) { cancelMicrophoneProbe("bluetooth-route-failed") }
    }

    private fun createDevices(config: MicrophoneConfig) {
        val output = if (Build.VERSION.SDK_INT >= 31 || !scoRoute) selected else manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            .let { selectBluetoothAudioDevice(it, activeCarAddress, ::audioAddress) }
        if (scoRoute && output == null) { fail("bluetooth-output-unavailable"); return }
        val inputCandidates = if (permitted() && scoRoute) manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .filter { it.isSource && it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO } else emptyList()
        report("stage=input-devices candidates=${inputCandidates.size} addressAvailable=${inputCandidates.count { audioAddress(it) != null }} matches=${inputCandidates.count { activeCarAddress != null && sameBluetoothSelection(activeCarAddress, audioAddress(it)) }}")
        // Playback may use another Bluetooth/system output. That is never proof
        // that its microphone belongs to the selected car.
        val legacyUnselectedRoute = permitted() && scoRoute && selectedCarAddress == null && (Build.VERSION.SDK_INT < 31 ||
            manager.availableCommunicationDevices.count { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO } == 1)
        val captureAllowed = permitted() && microphonePermitted() && scoRoute &&
            (if (selectedCarAddress == null) legacyUnselectedRoute else activeCarAddress != null &&
                android.bluetooth.BluetoothAdapter.checkBluetoothAddress(requireNotNull(activeCarAddress)) &&
                output != null && sameBluetoothSelection(activeCarAddress, audioAddress(output)))
        val input = if (!captureAllowed) null else if (activeCarAddress != null)
            selectBluetoothAudioDevice(inputCandidates, activeCarAddress, ::audioAddress)
        else selectBluetoothAudioDevice(inputCandidates, output?.let(::audioAddress), ::audioAddress) ?: inputCandidates.singleOrNull()
        val microphoneError = if (!permitted()) "bluetooth-permission-denied" else if (!microphonePermitted()) "microphone-permission-denied" else if (input == null) "bluetooth-input-unavailable" else null
        report("stage=devices-selected input=${input != null} output=${output != null} systemDefault=${output == null} microphoneError=${microphoneError ?: "none"}")
        val next = Devices(config, input, output, scoRoute, microphoneError, ++generation, counters.getOrPut(config) { MicrophoneCounters() })
        devices = next; next.start()
    }

    private fun fail(reason: String) {
        report("stage=failure reason=$reason acquired=$acquired focusGranted=$focusGranted focusWaiting=$focusWaiting workerRetiring=$workerRetiring")
        Log.w("TiPlayBluetoothVoice", "Voice route failed reason=$reason")
        if (!defaultPlayback && reason in playbackFallbackFailures) {
            playbackFallbackStage = if (scoRoute) 1 else 2
            playbackFallbackReason = reason
            defaultAfterRelease = true
        }
        failure = reason; failedCarAddress = activeCarAddress ?: failedCarAddress; profilePending = false
        retryAt = if (reason in retryableFailures && wanted != null) {
            val delay = (2_000L shl unavailableAttempts.coerceAtMost(4)).coerceAtMost(30_000L)
            unavailableAttempts++
            SystemClock.elapsedRealtime() + delay
        } else Long.MAX_VALUE
        state(BluetoothVoiceState("failed", reason, released = !acquired && !workerRetiring))
        release()
    }
    private fun retireDevices() {
        generation++
        val retiring = devices ?: return
        devices = null; workerRetiring = true
        retiring.running.set(false)
        // Capture uses READ_NON_BLOCKING. Its owner observes running=false and
        // stops/releases both devices in finally; main/focus callbacks never wait on it.
    }
    private fun release(keepFocus: Boolean = false) {
        microphoneProbe?.let { it.cleaning = true; retiringProbe = it }
        microphoneProbe = null
        profilePending = false; profileAttempt++
        main.removeCallbacks(poll)
        if (!keepFocus) abandonFocus()
        retireDevices(); mixer.clear()
        if (!acquired) {
            if (workerRetiring) { releasingAt = SystemClock.elapsedRealtime().coerceAtLeast(1); schedule() } else finishRelease()
            return
        }
        state(BluetoothVoiceState("releasing", failure))
        routeReleaseAttempts = 0; routeReleaseRetryAt = 0; routeReleaseRequested = false; routeReleaseError = null
        releasingAt = SystemClock.elapsedRealtime().coerceAtLeast(1)
        tick()
    }
    private fun releaseRoute() {
        routeReleaseRequested = true
        routeReleaseAttempts++
        val deviceCancelled = runCatching {
            if (Build.VERSION.SDK_INT >= 31) {
                if (communicationRequested) {
                    // The getter waits for an admitted request to reach the broker.
                    // clearCommunicationDevice removes only our binder client, even
                    // when another application's route is globally current.
                    val wasCurrent = manager.communicationDevice?.id == (communicationDevice ?: selected)?.id
                    manager.clearCommunicationDevice()
                    manager.communicationDevice // Wait for the queued cancellation too.
                    communicationRequested = false
                    report("stage=communication-release ownedRequest=true wasCurrent=$wasCurrent")
                }
            } else if (legacyScoRequested) {
                manager.isBluetoothScoOn = false; manager.stopBluetoothSco(); legacyScoRequested = false
            }
        }.isSuccess
        // These are independent app clients. A device cancellation failure must
        // not retain our otherwise cancellable mode client, and a later device
        // retry must not cancel an already withdrawn mode client again.
        val modeCancelled = runCatching {
            if (communicationOwned) {
                // MODE_NORMAL removes our mode client; the platform retains other callers.
                manager.mode = AudioManager.MODE_NORMAL
                communicationOwned = false
            }
        }.isSuccess
        if (!deviceCancelled || !modeCancelled) {
            routeReleaseError = "bluetooth-release-failed"
            // Retain the flags for each unfinished client. A later attempt must not
            // cancel a communication-device request that was already withdrawn.
            routeReleaseRequested = routeReleaseAttempts >= MAX_ROUTE_RELEASE_ATTEMPTS
            routeReleaseRetryAt = SystemClock.elapsedRealtime() + 1000
            report("stage=communication-release-failed attempt=$routeReleaseAttempts modeOwned=$communicationOwned deviceRequested=$communicationRequested legacyRequested=$legacyScoRequested")
            state(BluetoothVoiceState("failed", routeReleaseError, released = false,
                outputReady = devices?.outputReady?.get() == true))
        }
    }
    private fun finishRelease() {
        // No capture or output worker remains; its profile can now be closed too.
        closeProbeProxy(retiringProbe)
        retiringProbe = null
        main.removeCallbacks(poll)
        acquired = false; scoRoute = false; communicationOwned = false
        communicationRequested = false; legacyScoRequested = false
        communicationDevice = null
        releasingAt = 0; routeReleaseRequested = false; routeReleaseAttempts = 0; routeReleaseRetryAt = 0
        routeReleaseError = null
        selected = null; activeCarAddress = null
        if (receiverRegistered) { runCatching { context.unregisterReceiver(receiver) }; receiverRegistered = false }
        if (defaultAfterRelease && wanted != null && !closed && !focusWaiting) {
            defaultAfterRelease = false; failure = null
            acquire(); return
        }
        defaultAfterRelease = false
        if (wanted != null && failure == null && !closed && !focusWaiting) acquire()
        else {
            val next = if (wanted == null || closed) "idle" else if (failure != null) "failed" else if (focusWaiting) "connecting" else "idle"
            state(BluetoothVoiceState(next, failure, released = true))
            if (wanted != null && (failure != null || focusWaiting) && !closed) scheduleFailure()
        }
    }

    private inner class Devices(val config: MicrophoneConfig, val input: AudioDeviceInfo?, val output: AudioDeviceInfo?,
        val useSco: Boolean, microphoneError: String?, val token: Int, val packetCounters: MicrophoneCounters) {
        val running = AtomicBoolean(true)
        val outputReady = AtomicBoolean(false)
        private val captureLease = MicrophoneCaptureLease<CaptureInput>()
        fun grantCapture(input: AudioDeviceInfo) {
            grantCapture(CaptureInput(input))
        }
        fun grantCapture(input: CaptureInput) {
            if (running.get() && token == generation && wanted === config) captureLease.offer(input)
        }
        fun revokeCapture() = captureLease.revoke()
        fun captureRetiring() = captureLease.retiring()
        private val microphoneReady = AtomicBoolean(false)
        private val microphoneFailure = java.util.concurrent.atomic.AtomicReference(microphoneError)
        private val carAddress = activeCarAddress
        private var microphoneRetryDelay = 2000L
        @Volatile var record: AudioRecord? = null
        private val pendingRecordReleases = mutableListOf<AudioRecord>()
        @Volatile var track: AudioTrack? = null
        private fun matches(device: AudioDeviceInfo?, expected: AudioDeviceInfo) = device?.type == expected.type &&
            (device.id == expected.id || audioAddress(expected)?.let { sameBluetoothSelection(it, audioAddress(device)) } == true)
        private fun publishState() { main.post {
            if (token == generation && wanted === config && running.get()) {
                if (outputReady.get()) { unavailableAttempts = 0; retryAt = Long.MAX_VALUE }
                state(BluetoothVoiceState(if (outputReady.get()) "active" else "connecting", microphoneFailure.get(),
                    outputReady = outputReady.get()))
                if (outputReady.get() && !probeAttempted) tick()
            }
        } }
        fun microphoneFailed(reason: String, error: Throwable? = null) {
            microphoneReady.set(false)
            microphoneFailure.set(reason)
            report("stage=microphone-unavailable reason=$reason exception=${error?.javaClass?.simpleName ?: "none"} outputReady=${outputReady.get()}")
            publishState()
        }
        fun start() { Thread({
            runCatching { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO) }
            var outputThread: Thread? = null
            try {
                val audio = AudioTrack.Builder().setAudioAttributes(if (useSco) attributes else playbackAttributes)
                    .setAudioFormat(AndroidAudioFormat.Builder().setSampleRate(mixer.rate).setChannelMask(AndroidAudioFormat.CHANNEL_OUT_MONO)
                        .setEncoding(AndroidAudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(maxOf(AudioTrack.getMinBufferSize(mixer.rate, AndroidAudioFormat.CHANNEL_OUT_MONO,
                        AndroidAudioFormat.ENCODING_PCM_16BIT), mixer.rate * 2 / 10))
                    .setTransferMode(AudioTrack.MODE_STREAM).build().also { track = it }
                check(audio.state == AudioTrack.STATE_INITIALIZED)
                val preferred = output == null || audio.setPreferredDevice(output)
                report("stage=output-preference requested=${output != null} accepted=$preferred type=${output?.type ?: 0}")
                if (!running.get()) return@Thread
                audio.play()
                outputThread = Thread({ play(audio) }, "tiplay-bluetooth-speaker").apply { isDaemon = true; start() }
                // The capture worker is optional. Neither initialization nor a later
                // microphone failure may stop a working playback track.
                if (input != null) grantCapture(input) else microphoneFailed(microphoneFailure.get() ?: "bluetooth-input-unavailable")
                var nextCaptureAt = 0L
                var nextInputEnumerationAt = 0L
                while (running.get()) {
                    if (SystemClock.elapsedRealtime() < nextCaptureAt) { Thread.sleep(20); continue }
                    // Ordinary verified SCO routes may retry capture independently of output.
                    // Keep their original admission. Only the separately qualified probe
                    // may grant input while playback remains on an unrelated media route.
                    val retryInput = if (useSco && SystemClock.elapsedRealtime() >= nextInputEnumerationAt) runCatching {
                        nextInputEnumerationAt = SystemClock.elapsedRealtime() + microphoneRetryDelay
                        if (selectedCarAddress != null && bluetoothVoiceAddressIdentity(carAddress) == "valid" &&
                            permitted() && microphonePermitted() && sameBluetoothSelection(carAddress, selectedCarAddress.invoke()) &&
                            output != null && sameBluetoothSelection(carAddress, audioAddress(output)) &&
                            outputReady.get() && matches(track?.routedDevice, output))
                            selectBluetoothAudioDevice(manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                                .filter { it.isSource && it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }, carAddress, ::audioAddress)
                        else null
                    }.getOrNull() else null
                    if (retryInput != null) grantCapture(retryInput)
                    val grant = captureLease.claim()
                    if (grant == null) { Thread.sleep(20); continue }
                    try { capture(grant) }
                    finally {
                        // Every claimed grant ACKs, including an early return before recorder creation.
                        captureLease.finish(grant)
                        main.post { tick() }
                    }
                    nextCaptureAt = SystemClock.elapsedRealtime() + microphoneRetryDelay
                    report("stage=microphone-retry delayMs=$microphoneRetryDelay")
                    microphoneRetryDelay = (microphoneRetryDelay * 2).coerceAtMost(30_000)
                }
            } catch (error: Exception) { if (running.get()) {
                report("stage=worker-failure operation=output-create exception=${error.javaClass.simpleName}")
                main.post { if (token == generation) fail(if (error is SecurityException) "bluetooth-permission-denied" else "bluetooth-output-failed") }
            } }
            finally {
                running.set(false)
                captureLease.revoke()
                runCatching { record?.stop() }; runCatching { track?.stop() }
                outputThread?.join(1000)
                runCatching { track?.release() }
                main.post { workerRetiring = false; tick() }
            }
        }, "tiplay-bluetooth-voice").apply { isDaemon = true; start() } }

        private fun play(audio: AudioTrack) {
            runCatching { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO) }
            try {
                val silence = ShortArray(mixer.rate / 50)
                var writtenFrames = 0L; var playedFrames = 0L; var previousHead = 0L
                var lastRouteId: Int? = null
                var routeMissingSince = 0L
                var rollbackRequested = false
                while (running.get()) {
                    val actual = audio.routedDevice
                    if (actual != null) {
                        routeMissingSince = 0L; rollbackRequested = false
                        if (lastRouteId != actual.id) {
                            val selectedCarMatch = permitted() && carAddress != null && sameBluetoothSelection(carAddress, audioAddress(actual))
                            report("stage=output-route type=${actual.type} requestedMatched=${output?.let { if (permitted()) matches(actual, it) else actual.id == it.id } ?: false} selectedCarMatch=$selectedCarMatch fallback=${!selectedCarMatch}")
                            lastRouteId = actual.id
                        }
                        if (outputReady.compareAndSet(false, true)) {
                            report("stage=output-ready type=${actual.type} microphoneReady=${microphoneReady.get()}")
                            publishState()
                        }
                    } else {
                        val now = SystemClock.elapsedRealtime()
                        if (routeMissingSince == 0L) routeMissingSince = now.coerceAtLeast(1)
                        if (now - routeMissingSince >= 2000) {
                            if (microphoneProbe != null && !rollbackRequested) {
                                rollbackRequested = true
                                main.post { if (token == generation) { cancelMicrophoneProbe("bluetooth-output-unavailable"); tick() } }
                            }
                            // A failed probe gets a bounded rollback window, never an endless grace.
                            if (!rollbackRequested || now - routeMissingSince >= 6000) error("Playback route unavailable")
                        }
                    }
                    val head = audio.playbackHeadPosition.toLong() and 0xffff_ffffL
                    playedFrames += (head - previousHead) and 0xffff_ffffL; previousHead = head
                    val queuedNanos = (writtenFrames - playedFrames).coerceAtLeast(0) * 1_000_000_000L / mixer.rate
                    val samples = if (outputReady.get()) mixer.next(outputLeadNanos = queuedNanos) else silence
                    var offset = 0
                    while (running.get() && offset < samples.size) {
                        val count = audio.write(samples, offset, samples.size - offset, AudioTrack.WRITE_BLOCKING)
                        check(count > 0) { "Bluetooth playback stopped" }
                        if (RawTraffic.enabled) {
                            val bytes = java.nio.ByteBuffer.allocate(count * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                            repeat(count) { bytes.putShort(samples[offset + it]) }
                            RawTraffic.record("android-voice/pcm16le/rate=${mixer.rate}/out", bytes.array())
                        }
                        offset += count
                        writtenFrames += count
                    }
                }
            } catch (error: Exception) { if (running.get()) {
                report("stage=worker-failure operation=output-write exception=${error.javaClass.simpleName}")
                main.post { if (token == generation) fail(if (error is SecurityException) "bluetooth-permission-denied" else "bluetooth-output-failed") }
            } }
        }

        private fun captureEpochCurrent(grant: MicrophoneCaptureLease.Grant<CaptureInput>): Boolean =
            running.get() && captureLease.current(grant) && token == generation && wanted === config && !closed &&
                focusGranted && !focusWaiting && communicationOwned &&
                (selectedCarAddress == null || bluetoothVoiceAddressIdentity(carAddress) == "valid" &&
                    sameBluetoothSelection(carAddress, selectedCarAddress.invoke())) &&
                (grant.input.probe?.let { !it.cleaning && microphoneProbe === it && it.capture === grant.input &&
                    it.headset === grant.input.headset && wanted === it.demand &&
                    (it.active || SystemClock.elapsedRealtime() < it.deadline) } ?: true)

        private fun captureDemandCurrent(grant: MicrophoneCaptureLease.Grant<CaptureInput>): Boolean =
            captureEpochCurrent(grant) && permitted() && microphonePermitted() &&
                manager.mode == AudioManager.MODE_IN_COMMUNICATION && captureEpochCurrent(grant)

        private fun probeBindingCurrent(input: CaptureInput): Boolean {
            val probe = input.probe ?: return false
            if (probe.capture !== input || probe.cleaning ||
                !probe.active && SystemClock.elapsedRealtime() >= probe.deadline) return false
            val current = probeInput(probe) ?: return false
            return sameProbeInput(input, current) && probe.capture === input && !probe.cleaning &&
                microphoneProbe === probe && probe.headset === input.headset
        }

        private fun captureLive(grant: MicrophoneCaptureLease.Grant<CaptureInput>): Boolean {
            if (!captureDemandCurrent(grant)) return false
            val input = grant.input
            val route = if (input.probe != null) probeBindingCurrent(input) else
                if (Build.VERSION.SDK_INT >= 31) communicationRequested && manager.communicationDevice?.let {
                    it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO && it.id == (communicationDevice ?: selected)?.id
                } == true else manager.isBluetoothScoOn
            return route && captureDemandCurrent(grant)
        }

        private fun needsHeadsetAudio(input: CaptureInput, route: RecordingRoute): Boolean = input.probe != null &&
            (bluetoothVoiceAddressIdentity(input.address) != "valid" || bluetoothVoiceAddressIdentity(route.address) != "valid")

        private fun headsetAudioConnected(input: CaptureInput): Boolean = runCatching {
            val probe = input.probe ?: return@runCatching false
            val headset = input.headset ?: return@runCatching false
            val car = input.car ?: return@runCatching false
            if (probe.headset !== headset || probe.capture !== input || probe.cleaning || microphoneProbe !== probe)
                return@runCatching false
            val connected = headset.isAudioConnected(car)
            connected && probe.headset === headset && probe.capture === input && !probe.cleaning &&
                microphoneProbe === probe && wanted === probe.demand
        }.getOrDefault(false)

        /** Source port and source role must be right immediately after start; never read to discover routing. */
        private fun recordingRoute(grant: MicrophoneCaptureLease.Grant<CaptureInput>, recorder: AudioRecord,
                                   requireHeadsetAudio: Boolean): RecordingRoute? = runCatching {
            if (!captureLive(grant)) return@runCatching null
            val input = grant.input
            val expected = input.device
            val actual = recorder.routedDevice ?: return@runCatching null
            val identity = if (selectedCarAddress == null) carAddress ?: audioAddress(expected) else selectedCarAddress.invoke()
            if (!expected.isSource || !actual.isSource || expected.id <= 0 || actual.id != expected.id ||
                actual.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return@runCatching null
            val address = audioAddress(actual)
            if (input.probe == null) {
                if (!verifiedMicrophoneRoute(expected.id, actual.id, actual.type, address, identity)) return@runCatching null
            } else if (!acceptableScoAddress(address, input.probe.address)) return@runCatching null
            val route = RecordingRoute(actual.id, address?.trim()?.uppercase(java.util.Locale.ROOT))
            if (requireHeadsetAudio && needsHeadsetAudio(input, route) && !headsetAudioConnected(input)) return@runCatching null
            if (!captureDemandCurrent(grant) || input.probe?.let {
                    it.capture !== input || it.cleaning || microphoneProbe !== it || it.headset !== input.headset
                } == true) return@runCatching null
            route
        }.getOrNull()

        private fun inputVerified(grant: MicrophoneCaptureLease.Grant<CaptureInput>, recorder: AudioRecord): RecordingRoute {
            val route = recordingRoute(grant, recorder, requireHeadsetAudio = false)
                ?: error("Bluetooth duplex route unavailable")
            if (needsHeadsetAudio(grant.input, route) && !headsetAudioConnected(grant.input))
                error("Bluetooth microphone audio disconnected")
            // Physical-audio proof is an IPC. Re-read the inexpensive actual recording
            // route afterwards so a route change during it cannot authorize this block.
            val actual = recorder.routedDevice
            if (actual?.isSource != true || actual.type != AudioDeviceInfo.TYPE_BLUETOOTH_SCO || actual.id != route.port ||
                audioAddress(actual)?.trim()?.uppercase(java.util.Locale.ROOT) != route.address)
                error("Bluetooth duplex route unavailable")
            check(captureDemandCurrent(grant)) { "Bluetooth duplex route unavailable" }
            return route
        }

        private fun openCaptureRecord(grant: MicrophoneCaptureLease.Grant<CaptureInput>, rate: Int): AudioRecord {
            check(captureLive(grant)) { "Bluetooth duplex route unavailable" }
            check(record == null) { "Bluetooth microphone stop unavailable" }
            val minimum = AudioRecord.getMinBufferSize(rate, AndroidAudioFormat.CHANNEL_IN_MONO, AndroidAudioFormat.ENCODING_PCM_16BIT)
            check(minimum > 0)
            val capture = AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                .setAudioFormat(AndroidAudioFormat.Builder().setSampleRate(rate).setChannelMask(AndroidAudioFormat.CHANNEL_IN_MONO)
                    .setEncoding(AndroidAudioFormat.ENCODING_PCM_16BIT).build())
                .setBufferSizeInBytes(maxOf(minimum, rate * 2 / 5)).build()
            record = capture
            check(capture.state == AudioRecord.STATE_INITIALIZED && capture.setPreferredDevice(grant.input.device))
            synchronized(this) {
                check(captureLive(grant)) { "Bluetooth duplex route unavailable" }
                capture.startRecording()
            }
            // A null/handset/other initial route is unsafe even if it later changes to SCO:
            // that Record might already contain buffered microphone audio from the old route.
            check(recordingRoute(grant, capture, requireHeadsetAudio = false) != null) { "Bluetooth duplex route unavailable" }
            return capture
        }

        private fun closeCaptureRecord(): Boolean {
            val capture = synchronized(this) { record } ?: return true
            val stopped = runCatching { capture.stop() }.isSuccess
            val released = runCatching { capture.release() }.isSuccess
            if (stopped || released) {
                synchronized(this) { if (record === capture) record = null }
                if (!released) pendingRecordReleases += capture
            }
            return stopped || released
        }

        private fun capture(grant: MicrophoneCaptureLease.Grant<CaptureInput>) {
            val expectedInput = grant.input.device
            var sender: BrowserMicrophone? = null
            var resampler: PcmResampler? = null
            var stage = "record-create"
            var capturedSamples = 0L
            var nonzeroSamples = 0L
            try {
                if (!captureLive(grant)) return
                check(permitted() && microphonePermitted()) { "Microphone permission unavailable" }
                val rate = 16_000
                // Remember readiness before startRecording: that first Record may itself
                // make HFP audio live and must still be treated as an unread warmup.
                val audioReadyBeforeStart = grant.input.probe == null || headsetAudioConnected(grant.input)
                var capture = openCaptureRecord(grant, rate)
                val initialRoute = requireNotNull(recordingRoute(grant, capture, requireHeadsetAudio = false)) {
                    "Bluetooth duplex route unavailable"
                }
                if (needsHeadsetAudio(grant.input, initialRoute) && !audioReadyBeforeStart) {
                    check(!grant.input.warmupUsed) { "Bluetooth microphone audio disconnected" }
                    grant.input.warmupUsed = true
                    stage = "sco-warmup"
                    // A SCO-valid warmup may activate the platform route. It never reads or sends.
                    // On connection, replace it so none of its buffered audio can enter the sender.
                    while (captureLive(grant)) {
                        check(recordingRoute(grant, capture, requireHeadsetAudio = false) == initialRoute) {
                            "Bluetooth duplex route unavailable"
                        }
                        if (Build.VERSION.SDK_INT >= 29 && capture.activeRecordingConfiguration?.isClientSilenced == true)
                            error("Bluetooth microphone silenced")
                        if (headsetAudioConnected(grant.input)) break
                        Thread.sleep(5)
                    }
                    if (!captureLive(grant)) return
                    check(closeCaptureRecord()) { "Bluetooth microphone stop unavailable" }
                    stage = "record-recreate"
                    capture = openCaptureRecord(grant, rate)
                }
                inputVerified(grant, capture)
                stage = "sender-create"
                sender = BrowserMicrophone(config, packetCounters) { report(it) }
                val captureResampler = microphoneResampler(rate, sender.sampleRate).also { resampler = it }
                val samples = ShortArray(rate / 50)
                val recovery = BluetoothMicrophoneRecovery()
                stage = "read"
                var ready = false
                while (captureLive(grant)) {
                    check(permitted() && microphonePermitted()) { "Microphone permission unavailable" }
                    if (Build.VERSION.SDK_INT >= 29 && capture.activeRecordingConfiguration?.isClientSilenced == true)
                        error("Bluetooth microphone silenced")
                    val before = inputVerified(grant, capture)
                    val count = capture.read(samples, 0, samples.size, AudioRecord.READ_NON_BLOCKING)
                    if (!captureLive(grant)) break
                    when (recovery.read(count)) {
                        BluetoothMicrophoneRecovery.Action.WAIT -> { Thread.sleep(5); continue }
                        BluetoothMicrophoneRecovery.Action.RESTART -> {
                            // Restart cannot reuse a buffer which may have crossed an unknown route.
                            check(closeCaptureRecord()) { "Bluetooth microphone stop unavailable" }
                            capture = openCaptureRecord(grant, rate)
                            inputVerified(grant, capture)
                            Log.i("TiPlayBluetoothVoice", "Microphone restarted attempt=${recovery.restarts} reason=${if (count == 0) "no-audio" else "read-error"} code=$count")
                            Thread.sleep(5)
                            continue
                        }
                        BluetoothMicrophoneRecovery.Action.FAIL -> error("Bluetooth microphone recovery exhausted")
                        BluetoothMicrophoneRecovery.Action.CONTINUE -> Unit
                    }
                    check(inputVerified(grant, capture) == before) { "Bluetooth duplex route unavailable" }
                    val converted = captureResampler.convert(if (count == samples.size) samples else samples.copyOf(count))
                    capturedSamples += count
                    for (i in 0 until count) if (samples[i].toInt() != 0) nonzeroSamples++
                    val pcm = ByteArray(converted.size * 2)
                    converted.forEachIndexed { i, sample -> pcm[2 * i] = sample.toByte(); pcm[2 * i + 1] = (sample.toInt() shr 8).toByte() }
                    if (Build.VERSION.SDK_INT >= 29 && capture.activeRecordingConfiguration?.isClientSilenced == true)
                        error("Bluetooth microphone silenced")
                    if (inputVerified(grant, capture) != before) error("Bluetooth duplex route unavailable")
                    if (!captureEpochCurrent(grant)) break
                    sender.accept(pcm)
                    if (!ready && captureEpochCurrent(grant)) {
                        ready = true; microphoneReady.set(true); microphoneFailure.set(null); microphoneRetryDelay = 2000
                        grant.input.probe?.let { if (it.capture === grant.input) it.active = true }
                        report("stage=duplex-ready inputMatched=true outputMatched=${output?.let { matches(track?.routedDevice, it) } == true}")
                        publishState()
                    }
                }
            } catch (error: Throwable) {
                if (error !is Exception && error !is LinkageError) throw error
                if (running.get() && captureLease.current(grant)) {
                    val recoverRoute = error.message == "Bluetooth duplex route unavailable"
                    val reason = when {
                        !permitted() -> "bluetooth-permission-denied"
                        error is SecurityException || !microphonePermitted() -> "microphone-permission-denied"
                        error.message == "Bluetooth microphone recovery exhausted" -> "bluetooth-microphone-recovery-exhausted"
                        recoverRoute || error.message == "Bluetooth microphone audio disconnected" -> "bluetooth-input-route-unavailable"
                        error.message == "Bluetooth microphone silenced" -> "bluetooth-microphone-silenced"
                        else -> "bluetooth-microphone-failed"
                    }
                    val actual = runCatching { record?.routedDevice }.getOrNull()
                    val inputMatched = permitted() && actual?.isSource == true && verifiedMicrophoneRoute(expectedInput.id,
                        actual.id, actual.type, audioAddress(actual), carAddress ?: if (selectedCarAddress == null) audioAddress(expectedInput) else null)
                    report("stage=worker-failure operation=$stage reason=$reason exception=${error.javaClass.simpleName} inputMatched=$inputMatched")
                    microphoneFailed(reason, error)
                    main.post {
                        val probe = grant.input.probe
                        if (token == generation && probe != null && microphoneProbe === probe && probe.capture === grant.input) {
                            if (recoverRoute) { retireProbeCapture(probe); tick() }
                            else cancelMicrophoneProbe(reason)
                        }
                    }
                }
            } finally {
                microphoneReady.set(false)
                report("stage=capture-end samples=$capturedSamples nonzeroSamples=$nonzeroSamples")
                closeCaptureRecord()
                pendingRecordReleases.forEach { capture ->
                    runCatching { capture.stop() }; runCatching { capture.release() }
                }
                pendingRecordReleases.clear()
                runCatching { sender?.close() }; runCatching { resampler?.close() }
            }
        }

    }

    private companion object {
        const val MAX_ROUTE_RELEASE_ATTEMPTS = 3
    }
}
