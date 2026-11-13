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

/** Android is the HFP audio gateway. Device selection never substitutes the handset microphone. */
@Suppress("DEPRECATION")
@SuppressLint("MissingPermission") // Both runtime permissions are checked before opening the route/devices.
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
    private var focusGranted = false
    private var focusWaiting = false
    private var focusEpoch = 0L
    private var focus: AudioFocusRequest? = null
    private var routeReleaseRequested = false
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
        if (focusGranted) return AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (focusWaiting) return AudioManager.AUDIOFOCUS_REQUEST_DELAYED
        val epoch = ++focusEpoch
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(attributes).setAcceptsDelayedFocusGain(true)
            .setOnAudioFocusChangeListener({ value ->
                if (epoch == focusEpoch) focusChanged(value)
            }, main).build()
        focus = request
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
            // HFP can connect while a continuing voice demand is in backoff. A
            // matching arrival permits a fresh attempt without waiting 30s;
            // acquisition still validates the live route and focus ownership.
            if (closed || wanted == null || acquired || workerRetiring || profilePending ||
                releasingAt != 0L || failure !in deviceUnavailableFailures) return
            val address = runCatching { selectedCarAddress?.invoke() }.getOrNull() ?: return
            if (addedDevices.none { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO &&
                    sameBluetoothSelection(address, audioAddress(it)) }) return
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

    private fun permitted() = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
        (Build.VERSION.SDK_INT < 31 || context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED)

    private fun acquire() {
        try {
            val address = selectedCarAddress?.invoke()?.trim()?.uppercase(java.util.Locale.ROOT)
            activeCarAddress = address
            failedCarAddress = address
            val permitted = permitted()
            report("stage=acquire selected=${!address.isNullOrBlank()} permission=$permitted")
            if (!permitted) { fail("microphone-or-bluetooth-permission"); return }
            report("stage=audio-mode mode=${manager.mode}")
            if (manager.mode == AudioManager.MODE_IN_CALL || manager.mode == AudioManager.MODE_IN_COMMUNICATION ||
                (Build.VERSION.SDK_INT >= 31 && manager.communicationDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO)) {
                fail("communication-route-busy"); return
            }
            // An explicit provider means the user controls the target. Clearing it
            // must not switch an ongoing call to an unrelated connected headset.
            if (selectedCarAddress != null && address == null) {
                fail("car-bluetooth-not-selected"); return
            }
            if (address != null && !android.bluetooth.BluetoothAdapter.checkBluetoothAddress(address)) {
                fail("car-bluetooth-unavailable"); return
            }
            if (Build.VERSION.SDK_INT >= 31) {
                val available = manager.availableCommunicationDevices
                val candidates = available.filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
                val target = selectBluetoothAudioDevice(candidates, address) { audioAddress(it) }
                report("stage=communication-devices candidates=${candidates.size} addressAvailable=${candidates.count { audioAddress(it) != null }} matches=${candidates.count { sameBluetoothSelection(address, audioAddress(it)) && address != null }} selected=${target != null}" +
                    " types=${available.map { it.type }.distinct().sorted().joinToString(",")} namedCandidates=${candidates.count { !it.productName.isNullOrBlank() }}" +
                    " validAddresses=${candidates.count { audioAddress(it)?.let(android.bluetooth.BluetoothAdapter::checkBluetoothAddress) == true }}" +
                    " selectedIdentity=${bluetoothVoiceAddressIdentity(address)} ${bluetoothVoiceAddressCounts(candidates.map(::audioAddress))}")
                if (target == null) {
                    diagnoseHeadsetProfile(address)
                    fail(if (address != null || candidates.isEmpty()) "car-bluetooth-unavailable" else "multiple-bluetooth-headsets"); return
                }
                selected = target; previousDevice = manager.communicationDevice
                openRoute()
            } else {
                if (!manager.isBluetoothScoAvailableOffCall) { fail("car-bluetooth-unavailable"); return }
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
                                fail("car-bluetooth-unavailable"); return@post
                            }
                            if (!sameBluetoothSelection(address, selectedCarAddress?.invoke())) {
                                restartForSelectionChange(); return@post
                            }
                            openRoute()
                        } catch (_: SecurityException) { fail("bluetooth-permission-denied") }
                        catch (_: Exception) { fail("bluetooth-route-failed") }
                        finally { runCatching { adapter.closeProfileProxy(profile, proxy) } }
                    } }
                    override fun onServiceDisconnected(profile: Int) { main.post {
                        if (attempt == profileAttempt && acquired) fail("car-bluetooth-disconnected")
                    } }
                }, BluetoothProfile.HEADSET) == true
                if (!accepted) fail("car-bluetooth-unavailable") else schedule()
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
        previousMode = manager.mode
        acquired = true; releasingAt = 0; routeReleaseRequested = false; connectingAt = SystemClock.elapsedRealtime()
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= 31) {
            val accepted = manager.setCommunicationDevice(requireNotNull(selected))
            report("stage=communication-route accepted=$accepted")
            if (!accepted) { fail("bluetooth-route-rejected"); return }
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
                // Device stop/release runs on its existing capture worker. Do not
                // reroute a still-playing AudioTrack to the handset during retirement.
                if (!workerRetiring && acquired && !routeReleaseRequested) releaseRoute()
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
            if (focusWaiting) {
                if (!permitted()) { fail("microphone-or-bluetooth-permission"); return }
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
                if (((changed || retryDue) && permitted()) || permissionRestored) {
                    if (changed) {
                        unavailableAttempts = 0
                        profileDiagnosticRequested = false; profileDiagnosticEpoch++
                    }
                    failure = null
                    state(BluetoothVoiceState("connecting"))
                    acquire()
                } else if (selectedCarAddress != null) scheduleFailure()
                return
            }
            if (!permitted()) { fail("microphone-or-bluetooth-permission"); return }
            if (!sameBluetoothSelection(activeCarAddress, selectedCarAddress?.invoke())) {
                restartForSelectionChange(); return
            }
            if (acquired && manager.mode != AudioManager.MODE_IN_COMMUNICATION) { fail("communication-route-busy"); return }
            if (SystemClock.elapsedRealtime() - connectingAt >= 8000 && devices == null) { fail("bluetooth-connect-timeout"); return }
            if (acquired && scoReady()) {
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
        profileDiagnosticRequested = false; profileDiagnosticEpoch++
        state(BluetoothVoiceState("connecting"))
        release()
    }

    private fun createDevices(config: MicrophoneConfig) {
        val inputCandidates = manager.getDevices(AudioManager.GET_DEVICES_INPUTS).filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
        report("stage=input-devices candidates=${inputCandidates.size} addressAvailable=${inputCandidates.count { audioAddress(it) != null }} matches=${inputCandidates.count { activeCarAddress != null && sameBluetoothSelection(activeCarAddress, audioAddress(it)) }}")
        val input = (if (activeCarAddress != null) selectBluetoothAudioDevice(inputCandidates, activeCarAddress, ::audioAddress)
            else selectBluetoothAudioDevice(inputCandidates, selected?.let(::audioAddress), ::audioAddress) ?: inputCandidates.singleOrNull())
            ?: run { fail("bluetooth-input-unavailable"); return }
        val output = if (Build.VERSION.SDK_INT >= 31) selected else manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
            .filter { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            .let { selectBluetoothAudioDevice(it, activeCarAddress, ::audioAddress) }
        if (output == null) { fail("bluetooth-output-unavailable"); return }
        report("stage=devices-selected input=true output=true")
        val next = Devices(config, input, output, ++generation, counters.getOrPut(config) { MicrophoneCounters() })
        devices = next; next.start()
    }

    private fun fail(reason: String) {
        report("stage=failure reason=$reason acquired=$acquired focusGranted=$focusGranted focusWaiting=$focusWaiting workerRetiring=$workerRetiring")
        Log.w("TiPlayBluetoothVoice", "Voice route failed reason=$reason")
        failure = reason; failedCarAddress = activeCarAddress ?: failedCarAddress; profilePending = false
        retryAt = if (reason in retryableFailures && selectedCarAddress != null && activeCarAddress != null) {
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
        releasingAt = SystemClock.elapsedRealtime().coerceAtLeast(1)
        tick()
    }
    private fun releaseRoute() {
        routeReleaseRequested = true
        runCatching {
            if (Build.VERSION.SDK_INT >= 31) {
                // Do not clear a different communication device selected by another session/app.
                if (manager.communicationDevice?.id == selected?.id) {
                    if (previousDevice != null) manager.setCommunicationDevice(requireNotNull(previousDevice)) else manager.clearCommunicationDevice()
                }
            } else { manager.isBluetoothScoOn = false; manager.stopBluetoothSco() }
            if (manager.mode == AudioManager.MODE_IN_COMMUNICATION) manager.mode = previousMode
        }.onFailure { failure = "bluetooth-release-failed" }
    }
    private fun finishRelease() {
        main.removeCallbacks(poll)
        acquired = false; releasingAt = 0; routeReleaseRequested = false; selected = null; activeCarAddress = null
        if (receiverRegistered) { runCatching { context.unregisterReceiver(receiver) }; receiverRegistered = false }
        if (wanted != null && failure == null && !closed && !focusWaiting) acquire()
        else {
            val next = if (wanted == null || closed) "idle" else if (failure != null) "failed" else if (focusWaiting) "connecting" else "idle"
            state(BluetoothVoiceState(next, failure, released = true))
            if (wanted != null && (failure != null || focusWaiting) && selectedCarAddress != null && !closed) scheduleFailure()
        }
    }

    private inner class Devices(val config: MicrophoneConfig, val input: AudioDeviceInfo, val output: AudioDeviceInfo, val token: Int,
        val packetCounters: MicrophoneCounters) {
        val running = AtomicBoolean(true)
        @Volatile var record: AudioRecord? = null
        @Volatile var track: AudioTrack? = null
        private fun matches(device: AudioDeviceInfo?, expected: AudioDeviceInfo) = device?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO &&
            (device.id == expected.id || audioAddress(expected)?.let { sameBluetoothSelection(it, audioAddress(device)) } == true)
        fun start() { Thread({
            runCatching { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO) }
            var sender: BrowserMicrophone? = null
            var outputThread: Thread? = null
            var resampler: NativePcmResampler? = null
            var stage = "sender-create"
            var capturedSamples = 0L
            var nonzeroSamples = 0L
            try {
                sender = BrowserMicrophone(config, packetCounters) { report(it) }
                stage = "record-create"
                val rate = 16_000 // Android's SCO resampler also supports narrowband (8 kHz) headsets.
                val minimum = AudioRecord.getMinBufferSize(rate, AndroidAudioFormat.CHANNEL_IN_MONO, AndroidAudioFormat.ENCODING_PCM_16BIT)
                check(minimum > 0)
                val capture = AudioRecord.Builder().setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
                    .setAudioFormat(AndroidAudioFormat.Builder().setSampleRate(rate).setChannelMask(AndroidAudioFormat.CHANNEL_IN_MONO)
                        .setEncoding(AndroidAudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(maxOf(minimum, rate * 2 / 5)).build().also { record = it }
                check(capture.state == AudioRecord.STATE_INITIALIZED && capture.setPreferredDevice(input))
                stage = "track-create"
                val audio = AudioTrack.Builder().setAudioAttributes(attributes)
                    .setAudioFormat(AndroidAudioFormat.Builder().setSampleRate(mixer.rate).setChannelMask(AndroidAudioFormat.CHANNEL_OUT_MONO)
                        .setEncoding(AndroidAudioFormat.ENCODING_PCM_16BIT).build())
                    .setBufferSizeInBytes(maxOf(AudioTrack.getMinBufferSize(mixer.rate, AndroidAudioFormat.CHANNEL_OUT_MONO,
                        AndroidAudioFormat.ENCODING_PCM_16BIT), mixer.rate * 2 / 10))
                    .setTransferMode(AudioTrack.MODE_STREAM).build().also { track = it }
                check(audio.state == AudioTrack.STATE_INITIALIZED && audio.setPreferredDevice(output))
                if (!running.get()) return@Thread
                stage = "start-recording"
                audio.play(); capture.startRecording()
                val ready = AtomicBoolean(false)
                val begun = SystemClock.elapsedRealtime()
                outputThread = Thread({
                    runCatching { android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO) }
                    try {
                        val silence = ShortArray(mixer.rate / 50)
                        var writtenFrames = 0L; var playedFrames = 0L; var previousHead = 0L
                        while (running.get()) {
                            val head = audio.playbackHeadPosition.toLong() and 0xffff_ffffL
                            playedFrames += (head - previousHead) and 0xffff_ffffL; previousHead = head
                            val queuedNanos = (writtenFrames - playedFrames).coerceAtLeast(0) * 1_000_000_000L / mixer.rate
                            val samples = if (ready.get()) mixer.next(outputLeadNanos = queuedNanos) else silence
                            var offset = 0
                            while (running.get() && offset < samples.size) {
                                val count = audio.write(samples, offset, samples.size - offset, AudioTrack.WRITE_BLOCKING)
                                check(count > 0) { "Bluetooth playback stopped" }
                                if (RawTraffic.enabled) {
                                    val bytes = java.nio.ByteBuffer.allocate(count * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
                                    repeat(count) { bytes.putShort(samples[offset + it]) }
                                    RawTraffic.record("car-bluetooth/sco/pcm16le/rate=${mixer.rate}/out", bytes.array())
                                }
                                offset += count
                                writtenFrames += count
                            }
                        }
                    } catch (error: Exception) { if (running.get()) {
                        report("stage=worker-failure operation=output-write exception=${error.javaClass.simpleName}")
                        main.post { if (token == generation) fail(if (error is SecurityException) "bluetooth-permission-denied" else "bluetooth-output-failed") }
                    } }
                }, "tiplay-bluetooth-speaker").apply { isDaemon = true; start() }
                val captureResampler = NativePcmResampler(rate, sender.sampleRate).also { resampler = it }
                val samples = ShortArray(rate / 50)
                val recovery = BluetoothMicrophoneRecovery()
                stage = "read"
                while (running.get()) {
                    // A stalled SCO input must not hold shutdown or recovery in a blocking read.
                    val count = capture.read(samples, 0, samples.size, AudioRecord.READ_NON_BLOCKING)
                    if (!running.get()) break
                    when (recovery.read(count)) {
                        BluetoothMicrophoneRecovery.Action.WAIT -> { Thread.sleep(5); continue }
                        BluetoothMicrophoneRecovery.Action.RESTART -> {
                            synchronized(this) {
                                if (!running.get()) return@Thread
                                capture.stop()
                                check(capture.setPreferredDevice(input))
                                capture.startRecording()
                            }
                            Log.i("TiPlayBluetoothVoice", "Microphone restarted attempt=${recovery.restarts} reason=${if (count == 0) "no-audio" else "read-error"} code=$count")
                            Thread.sleep(5)
                            continue
                        }
                        BluetoothMicrophoneRecovery.Action.FAIL -> error("Bluetooth microphone recovery exhausted")
                        BluetoothMicrophoneRecovery.Action.CONTINUE -> Unit
                    }
                    val routed = matches(capture.routedDevice, input) && matches(audio.routedDevice, output)
                    if (!routed) {
                        if (ready.get() || SystemClock.elapsedRealtime() - begun >= 2000) error("Bluetooth duplex route unavailable")
                        continue // Discard every sample before BOTH devices actually use SCO.
                    }
                    if (!ready.get()) {
                        ready.set(true)
                        report("stage=duplex-ready inputMatched=true outputMatched=true")
                        main.post { if (token == generation && wanted === config && running.get()) {
                            unavailableAttempts = 0; retryAt = Long.MAX_VALUE
                            state(BluetoothVoiceState("active"))
                        } }
                    }
                    val converted = captureResampler.convert(if (count == samples.size) samples else samples.copyOf(count))
                    capturedSamples += count
                    for (i in 0 until count) if (samples[i].toInt() != 0) nonzeroSamples++
                    val pcm = ByteArray(converted.size * 2)
                    converted.forEachIndexed { i, sample -> pcm[2 * i] = sample.toByte(); pcm[2 * i + 1] = (sample.toInt() shr 8).toByte() }
                    sender.accept(pcm)
                }
            } catch (error: Exception) { if (running.get()) {
                val routedInput = runCatching { record?.routedDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }.getOrNull()
                val routedOutput = runCatching { track?.routedDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }.getOrNull()
                val inputMatched = runCatching { matches(record?.routedDevice, input) }.getOrNull()
                val outputMatched = runCatching { matches(track?.routedDevice, output) }.getOrNull()
                val reason = when (error.message) {
                    "Bluetooth microphone recovery exhausted" -> "read-recovery-exhausted"
                    "Bluetooth duplex route unavailable" -> "duplex-route-unavailable"
                    else -> "other"
                }
                report("stage=worker-failure operation=$stage reason=$reason exception=${error.javaClass.simpleName} routedInput=$routedInput routedOutput=$routedOutput inputMatched=$inputMatched outputMatched=$outputMatched")
                main.post { if (token == generation) fail(if (error is SecurityException) "bluetooth-permission-denied" else "bluetooth-duplex-failed") }
            } }
            finally {
                running.set(false)
                report("stage=capture-end samples=$capturedSamples nonzeroSamples=$nonzeroSamples")
                runCatching { record?.stop() }; runCatching { track?.stop() }
                outputThread?.join(1000)
                record?.release(); track?.release(); sender?.close(); resampler?.close()
                main.post { workerRetiring = false; tick() }
            }
        }, "tiplay-bluetooth-microphone").apply { isDaemon = true; start() } }
    }
}
