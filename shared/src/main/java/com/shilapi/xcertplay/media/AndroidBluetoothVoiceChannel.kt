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
    private var wanted: MicrophoneConfig? = null
    private var closed = false
    private var selected: AudioDeviceInfo? = null
    private var acquired = false
    private var scoRoute = false
    private var communicationOwned = false
    private var communicationRequested = false
    private var legacyScoRequested = false
    private var focusHeld = false
    private var focusGranted = false
    private var focusWaiting = false
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
    private var generation = 0
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
    override fun stop() { main.post { wanted = null; failure = null; stopObservingDevices(); release() } }
    override fun close() { main.post { closed = true; wanted = null; failure = null; stopObservingDevices(); release() } }
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
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        communicationOwned = true
        if (Build.VERSION.SDK_INT >= 31) {
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
            if (acquired && communicationOwned && manager.mode != AudioManager.MODE_IN_COMMUNICATION) {
                fail("communication-route-busy"); return
            }
            if (SystemClock.elapsedRealtime() - connectingAt >= 8000 && devices == null) { fail("bluetooth-connect-timeout"); return }
            if (acquired && (!scoRoute || scoReady())) {
                if (devices == null && !workerRetiring) createDevices(requireNotNull(wanted))
            } else if (devices != null) { fail("car-bluetooth-disconnected"); return }
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
        state(BluetoothVoiceState("connecting"))
        release()
    }

    private fun createDevices(config: MicrophoneConfig) {
        val output = if (Build.VERSION.SDK_INT >= 31 || !scoRoute) selected else manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            .let { selectBluetoothAudioDevice(it, activeCarAddress, ::audioAddress) }
        if (scoRoute && output == null) { fail("bluetooth-output-unavailable"); return }
        val inputCandidates = if (permitted() && scoRoute) manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
            .filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO } else emptyList()
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
        runCatching {
            if (!communicationOwned) return@runCatching
            if (Build.VERSION.SDK_INT >= 31) {
                if (communicationRequested) {
                    // The getter waits for an admitted request to reach the broker.
                    // clearCommunicationDevice removes only our binder client, even
                    // when another application's route is globally current.
                    val wasCurrent = manager.communicationDevice?.id == selected?.id
                    manager.clearCommunicationDevice()
                    manager.communicationDevice // Wait for the queued cancellation too.
                    communicationRequested = false
                    report("stage=communication-release ownedRequest=true wasCurrent=$wasCurrent")
                }
            } else if (legacyScoRequested) {
                manager.isBluetoothScoOn = false; manager.stopBluetoothSco(); legacyScoRequested = false
            }
            // MODE_NORMAL removes our mode client; the platform retains other callers.
            manager.mode = AudioManager.MODE_NORMAL
            communicationOwned = false
        }.onFailure {
            routeReleaseError = "bluetooth-release-failed"
            // Retain the flags for each unfinished client. A later attempt must not
            // cancel a communication-device request that was already withdrawn.
            routeReleaseRequested = routeReleaseAttempts >= MAX_ROUTE_RELEASE_ATTEMPTS
            routeReleaseRetryAt = SystemClock.elapsedRealtime() + 1000
            report("stage=communication-release-failed attempt=$routeReleaseAttempts modeOwned=$communicationOwned deviceRequested=$communicationRequested legacyRequested=$legacyScoRequested")
            state(BluetoothVoiceState("failed", routeReleaseError, released = false))
        }
    }
    private fun finishRelease() {
        main.removeCallbacks(poll)
        acquired = false; scoRoute = false; communicationOwned = false
        communicationRequested = false; legacyScoRequested = false
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
        private val outputReady = AtomicBoolean(false)
        private val microphoneReady = AtomicBoolean(false)
        private val microphoneFailure = java.util.concurrent.atomic.AtomicReference(microphoneError)
        private val carAddress = activeCarAddress
        private var microphoneRetryDelay = 2000L
        @Volatile var record: AudioRecord? = null
        @Volatile var track: AudioTrack? = null
        private fun matches(device: AudioDeviceInfo?, expected: AudioDeviceInfo) = device?.type == expected.type &&
            (device.id == expected.id || audioAddress(expected)?.let { sameBluetoothSelection(it, audioAddress(device)) } == true)
        private fun publishState() { main.post {
            if (token == generation && wanted === config && running.get()) {
                if (outputReady.get()) { unavailableAttempts = 0; retryAt = Long.MAX_VALUE }
                state(BluetoothVoiceState(if (outputReady.get()) "active" else "connecting", microphoneFailure.get(),
                    outputReady = outputReady.get()))
            }
        } }
        private fun microphoneFailed(reason: String, error: Exception? = null) {
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
                if (input != null) capture(input) else microphoneFailed(microphoneFailure.get() ?: "bluetooth-input-unavailable")
                while (running.get()) {
                    val retryAt = SystemClock.elapsedRealtime() + microphoneRetryDelay
                    while (running.get() && SystemClock.elapsedRealtime() < retryAt) Thread.sleep(20)
                    if (!running.get()) break
                    // Only retry a known selected-car SCO identity. Playback
                    // fallback never authorizes another microphone.
                    val retryInput = runCatching {
                        if (!useSco || selectedCarAddress == null || carAddress == null ||
                            token != generation || wanted !== config || !android.bluetooth.BluetoothAdapter.checkBluetoothAddress(carAddress) ||
                            !sameBluetoothSelection(carAddress, selectedCarAddress.invoke()) || !permitted() || !microphonePermitted() ||
                            output == null || !sameBluetoothSelection(carAddress, audioAddress(output)) ||
                            !outputReady.get() || !matches(track?.routedDevice, output)) null
                        else selectBluetoothAudioDevice(manager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                            .filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }, carAddress, ::audioAddress)
                    }.getOrNull()
                    if (retryInput != null && running.get()) {
                        report("stage=microphone-retry delayMs=$microphoneRetryDelay")
                        capture(retryInput)
                        microphoneRetryDelay = (microphoneRetryDelay * 2).coerceAtMost(30_000)
                    }
                }
            } catch (error: Exception) { if (running.get()) {
                report("stage=worker-failure operation=output-create exception=${error.javaClass.simpleName}")
                main.post { if (token == generation) fail(if (error is SecurityException) "bluetooth-permission-denied" else "bluetooth-output-failed") }
            } }
            finally {
                running.set(false)
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
                val begun = SystemClock.elapsedRealtime()
                while (running.get()) {
                    val actual = audio.routedDevice
                    if (actual != null) {
                        if (lastRouteId != actual.id) {
                            val selectedCarMatch = permitted() && carAddress != null && sameBluetoothSelection(carAddress, audioAddress(actual))
                            report("stage=output-route type=${actual.type} requestedMatched=${output?.let { if (permitted()) matches(actual, it) else actual.id == it.id } ?: false} selectedCarMatch=$selectedCarMatch fallback=${!selectedCarMatch}")
                            lastRouteId = actual.id
                        }
                        if (outputReady.compareAndSet(false, true)) {
                            report("stage=output-ready type=${actual.type} microphoneReady=${microphoneReady.get()}")
                            publishState()
                        }
                    } else if (SystemClock.elapsedRealtime() - begun >= 2000) error("Playback route unavailable")
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

        private fun capture(expectedInput: AudioDeviceInfo) {
            if (!running.get() || token != generation || wanted !== config) return
            var sender: BrowserMicrophone? = null
            var resampler: NativePcmResampler? = null
            var stage = "sender-create"
            var capturedSamples = 0L
            var nonzeroSamples = 0L
            try {
                check(permitted() && microphonePermitted()) { "Microphone permission unavailable" }
                sender = BrowserMicrophone(config, packetCounters) { report(it) }
                stage = "record-create"
                val rate = 16_000
                val minimum = AudioRecord.getMinBufferSize(rate, AndroidAudioFormat.CHANNEL_IN_MONO, AndroidAudioFormat.ENCODING_PCM_16BIT)
                check(minimum > 0)
                val capture = AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                    .setAudioFormat(AndroidAudioFormat.Builder().setSampleRate(rate).setChannelMask(AndroidAudioFormat.CHANNEL_IN_MONO)
                        .setEncoding(AndroidAudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(maxOf(minimum, rate * 2 / 5)).build().also { record = it }
                check(capture.state == AudioRecord.STATE_INITIALIZED && capture.setPreferredDevice(expectedInput))
                if (!running.get()) return
                stage = "start-recording"
                capture.startRecording()
                val begun = SystemClock.elapsedRealtime()
                var ready = false
                val captureResampler = NativePcmResampler(rate, sender.sampleRate).also { resampler = it }
                val samples = ShortArray(rate / 50)
                val recovery = BluetoothMicrophoneRecovery()
                stage = "read"
                while (running.get()) {
                    check(permitted() && microphonePermitted()) { "Microphone permission unavailable" }
                    val count = capture.read(samples, 0, samples.size, AudioRecord.READ_NON_BLOCKING)
                    if (!running.get()) break
                    when (recovery.read(count)) {
                        BluetoothMicrophoneRecovery.Action.WAIT -> { Thread.sleep(5); continue }
                        BluetoothMicrophoneRecovery.Action.RESTART -> {
                            synchronized(this) {
                                if (!running.get()) return
                                capture.stop()
                                check(capture.setPreferredDevice(expectedInput))
                                capture.startRecording()
                            }
                            Log.i("TiPlayBluetoothVoice", "Microphone restarted attempt=${recovery.restarts} reason=${if (count == 0) "no-audio" else "read-error"} code=$count")
                            Thread.sleep(5)
                            continue
                        }
                        BluetoothMicrophoneRecovery.Action.FAIL -> error("Bluetooth microphone recovery exhausted")
                        BluetoothMicrophoneRecovery.Action.CONTINUE -> Unit
                    }
                    val routed = matches(capture.routedDevice, expectedInput) && output?.let { matches(track?.routedDevice, it) } == true
                    if (!routed) {
                        if (ready || SystemClock.elapsedRealtime() - begun >= 2000) error("Bluetooth duplex route unavailable")
                        continue
                    }
                    if (!ready) {
                        ready = true; microphoneReady.set(true); microphoneFailure.set(null); microphoneRetryDelay = 2000
                        report("stage=duplex-ready inputMatched=true outputMatched=true")
                        publishState()
                    }
                    val converted = captureResampler.convert(if (count == samples.size) samples else samples.copyOf(count))
                    capturedSamples += count
                    for (i in 0 until count) if (samples[i].toInt() != 0) nonzeroSamples++
                    val pcm = ByteArray(converted.size * 2)
                    converted.forEachIndexed { i, sample -> pcm[2 * i] = sample.toByte(); pcm[2 * i + 1] = (sample.toInt() shr 8).toByte() }
                    sender.accept(pcm)
                }
            } catch (error: Exception) { if (running.get()) {
                val reason = when {
                    !permitted() -> "bluetooth-permission-denied"
                    error is SecurityException || !microphonePermitted() -> "microphone-permission-denied"
                    error.message == "Bluetooth microphone recovery exhausted" -> "bluetooth-microphone-recovery-exhausted"
                    error.message == "Bluetooth duplex route unavailable" -> "bluetooth-input-route-unavailable"
                    else -> "bluetooth-microphone-failed"
                }
                report("stage=worker-failure operation=$stage reason=$reason exception=${error.javaClass.simpleName} inputMatched=${if (permitted()) record?.routedDevice?.let { matches(it, expectedInput) } else false}")
                microphoneFailed(reason, error)
            } }
            finally {
                report("stage=capture-end samples=$capturedSamples nonzeroSamples=$nonzeroSamples")
                runCatching { record?.stop() }; runCatching { record?.release() }; record = null
                runCatching { sender?.close() }; runCatching { resampler?.close() }
            }
        }
    }

    private companion object {
        const val MAX_ROUTE_RELEASE_ATTEMPTS = 3
    }
}
