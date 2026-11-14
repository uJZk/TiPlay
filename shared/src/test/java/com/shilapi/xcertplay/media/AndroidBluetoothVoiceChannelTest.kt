package com.shilapi.xcertplay.media

import android.Manifest
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.os.Looper
import com.shilapi.xcertplay.airplay.MicrophoneConfig
import java.net.InetAddress
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.AudioDeviceInfoBuilder
import org.robolectric.util.ReflectionHelpers
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE,
    shadows = [BluetoothPlaybackTrackShadow::class, BluetoothPlaybackRecordShadow::class])
@LooperMode(LooperMode.Mode.PAUSED)
class AndroidBluetoothVoiceChannelTest {
    @Before fun resetPlaybackShadows() {
        BluetoothPlaybackTrackShadow.reset()
        BluetoothPlaybackRecordShadow.reset()
    }

    private fun closeChannel(channel: AndroidBluetoothVoiceChannel) {
        channel.close()
        awaitBluetoothPlayback {
            !ReflectionHelpers.getField<Boolean>(channel, "acquired") &&
                !ReflectionHelpers.getField<Boolean>(channel, "workerRetiring")
        }
    }

    private fun config() = MicrophoneConfig("telephony", 16000, 1, 97, 20, InetAddress.getLoopbackAddress(), 12345, ByteArray(32))
    private fun sco(address: String, id: Int): AudioDeviceInfo {
        val device = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build()
        val port: Any = ReflectionHelpers.getField(device, "mPort")
        ReflectionHelpers.setField(port, "mAddress", address)
        ReflectionHelpers.setField(port, "mRole", 2) // AudioPort.ROLE_SINK
        val handle: Any = ReflectionHelpers.getField(port, "mHandle")
        ReflectionHelpers.setField(handle, "mId", id)
        return device
    }

    @Test fun transientAndDuckLossWaitForFocusGainWithoutRequestingFocusOrReroutingLiveDevices() {
        for (loss in listOf(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)) {
            val app = RuntimeEnvironment.getApplication()
            shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
            val manager = app.getSystemService(AudioManager::class.java)
            val audio = shadowOf(manager)
            val target = "AA:BB:CC:DD:EE:01"
            val car = sco(target, 102)
            audio.setAvailableCommunicationDevices(listOf(car)); audio.setInputDevices(emptyList())
            audio.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_DELAYED)
            val states = mutableListOf<BluetoothVoiceState>()
            val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }
            val demand = config()
            channel.start(demand); shadowOf(Looper.getMainLooper()).idle()
            val request = requireNotNull(audio.lastAudioFocusRequest)
            // Model the acquired SCO and its retiring owner without opening native
            // AudioRecord in this JVM test. The callback is from the real request.
            ReflectionHelpers.setField(channel, "focusWaiting", false)
            ReflectionHelpers.setField(channel, "focusGranted", true)
            ReflectionHelpers.setField(channel, "acquired", true)
            ReflectionHelpers.setField(channel, "communicationOwned", true)
            ReflectionHelpers.setField(channel, "scoRoute", true)
            ReflectionHelpers.setField(channel, "selected", car)
            ReflectionHelpers.setField(channel, "workerRetiring", true)
            manager.mode = AudioManager.MODE_IN_COMMUNICATION
            assertTrue(manager.setCommunicationDevice(car))
            ReflectionHelpers.setField(channel, "communicationRequested", true)
            val abandoned = audio.lastAbandonedAudioFocusRequest
            val attempts = states.count { it.state == "connecting" }
            request.listener.onAudioFocusChange(loss)
            shadowOf(Looper.getMainLooper()).idleFor(1000, TimeUnit.MILLISECONDS)
            assertSame(car, manager.communicationDevice)
            assertSame(abandoned, audio.lastAbandonedAudioFocusRequest)
            // Only the old worker's completion permits platform route cleanup.
            ReflectionHelpers.setField(channel, "workerRetiring", false)
            ReflectionHelpers.callInstanceMethod<Void>(channel, "tick")
            assertNull(manager.communicationDevice)
            shadowOf(Looper.getMainLooper()).idleFor(11_000, TimeUnit.MILLISECONDS)
            assertSame(request, audio.lastAudioFocusRequest)
            assertEquals(attempts, states.count { it.state == "connecting" })
            request.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
            shadowOf(Looper.getMainLooper()).idle()
            assertSame(request, audio.lastAudioFocusRequest) // Regained request is reused, not re-requested.
            assertTrue(states.count { it.state == "connecting" } >= attempts + 1)
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals("bluetooth-input-unavailable", states.last().error)
            assertSame(demand, ReflectionHelpers.getField<MicrophoneConfig>(channel, "wanted"))
            closeChannel(channel)
        }
    }

    @Test fun delayedFocusWaitsPastTheRouteDeadlineAndLateOldGainCannotStartAReplacementDemand() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager)
        val target = "AA:BB:CC:DD:EE:01"
        audio.setAvailableCommunicationDevices(listOf(sco(target, 102))); audio.setInputDevices(emptyList())
        audio.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_DELAYED)
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        val old = requireNotNull(audio.lastAudioFocusRequest)
        assertTrue(old.audioFocusRequest.acceptsDelayedFocusGain())
        shadowOf(Looper.getMainLooper()).idleFor(11_000, TimeUnit.MILLISECONDS)
        assertSame(old, audio.lastAudioFocusRequest)
        assertNull(manager.communicationDevice)
        assertTrue(states.none { it.state == "failed" })
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        val replacement = requireNotNull(audio.lastAudioFocusRequest)
        assertNotSame(old, replacement)
        assertSame(old.audioFocusRequest, audio.lastAbandonedAudioFocusRequest)
        old.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(ReflectionHelpers.getField(channel, "focusWaiting"))
        assertNull(manager.communicationDevice)
        replacement.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
        shadowOf(Looper.getMainLooper()).idle()
        awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
        assertEquals("bluetooth-input-unavailable", states.last().error)
        closeChannel(channel)
        val count = states.size
        replacement.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(count, states.size)
    }

    @Test fun permanentFocusLossAbandonsTheRequestAndDoesNotRetryOrAcceptItsLateGain() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager)
        val target = "AA:BB:CC:DD:EE:01"
        audio.setAvailableCommunicationDevices(listOf(sco(target, 102)))
        audio.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_DELAYED)
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        val request = requireNotNull(audio.lastAudioFocusRequest)
        request.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS)
        shadowOf(Looper.getMainLooper()).idleFor(11_000, TimeUnit.MILLISECONDS)
        assertEquals("audio-focus-lost", states.last().error)
        assertSame(request.audioFocusRequest, audio.lastAbandonedAudioFocusRequest)
        assertSame(request, audio.lastAudioFocusRequest)
        val count = states.size
        request.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(count, states.size)
        closeChannel(channel)
    }

    @Test fun temporaryFocusDenialRetriesPlaybackWithoutPreemptingAnExistingCall() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager)
        val target = "AA:BB:CC:DD:EE:01"
        audio.setAvailableCommunicationDevices(listOf(sco(target, 102))); audio.setInputDevices(emptyList())
        audio.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_FAILED)
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }
        val demand = config()
        try {
            channel.start(demand); shadowOf(Looper.getMainLooper()).idle()
            val refused = requireNotNull(audio.lastAudioFocusRequest)
            assertEquals("audio-focus-unavailable", states.last().error)
            assertEquals("after SCO focus is refused, the media fallback also requests focus",
                android.media.AudioAttributes.USAGE_MEDIA, requireNotNull(refused.audioFocusRequest).audioAttributes.usage)
            manager.mode = AudioManager.MODE_IN_CALL
            audio.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
            // This fixture denied both SCO focus and its immediate media fallback. The
            // second refusal uses the next bounded backoff instead of the initial two seconds.
            shadowOf(Looper.getMainLooper()).idleFor(4100, TimeUnit.MILLISECONDS)
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertNotSame(refused, audio.lastAudioFocusRequest)
            assertEquals(AudioManager.MODE_IN_CALL, manager.mode)
            assertNull(manager.communicationDevice)
            assertSame(demand, ReflectionHelpers.getField<MicrophoneConfig>(channel, "wanted"))
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
        } finally { closeChannel(channel) }
    }

    @Test fun permanentLossAfterTransientReleaseDoesNotMistakeTheSameTargetForASelectionChange() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager)
        val target = "AA:BB:CC:DD:EE:01"
        audio.setAvailableCommunicationDevices(listOf(sco(target, 102)))
        audio.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_DELAYED)
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        val request = requireNotNull(audio.lastAudioFocusRequest)
        request.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT)
        shadowOf(Looper.getMainLooper()).idle()
        request.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS)
        shadowOf(Looper.getMainLooper()).idleFor(11_000, TimeUnit.MILLISECONDS)
        assertEquals("audio-focus-lost", states.last().error)
        assertSame(request, audio.lastAudioFocusRequest)
        assertEquals(1, states.count { it.state == "connecting" })
        closeChannel(channel)
    }

    @Test fun microphoneSelectionStillRequiresTheExactSelectedCarIdentity() {
        val target = "AA:BB:CC:DD:EE:01"
        val carInput = sco(target, 101)
        val otherInput = sco("AA:BB:CC:DD:EE:02", 201)
        assertSame(carInput, selectBluetoothAudioDevice(listOf(otherInput, carInput), target) { it.address })
        assertNull(selectBluetoothAudioDevice(listOf(otherInput), target) { it.address })
    }

    @Test fun changingOrClearingSelectionPrefersTheNewCarAndKeepsUsablePlaybackWithoutSubstitutingItsMicrophone() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val oldAddress = "AA:BB:CC:DD:EE:01"
        val newAddress = "AA:BB:CC:DD:EE:02"
        val old = sco(oldAddress, 101)
        val target = sco(newAddress, 102)
        shadowOf(manager).setAvailableCommunicationDevices(listOf(old, target))
        shadowOf(manager).setInputDevices(emptyList())
        var selection: String? = oldAddress
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { selection }
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertSame(old, manager.communicationDevice)
            selection = newAddress
            ReflectionHelpers.callInstanceMethod<Void>(channel, "tick")
            awaitBluetoothPlayback { manager.communicationDevice?.id == target.id && states.lastOrNull()?.outputReady == true }
            assertEquals("bluetooth-input-unavailable", states.last().error)
            selection = "AA:BB:CC:DD:EE:03"
            ReflectionHelpers.callInstanceMethod<Void>(channel, "tick")
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true &&
                ReflectionHelpers.getField<String>(channel, "activeCarAddress") == selection }
            assertNotNull(manager.communicationDevice)
            selection = null
            ReflectionHelpers.callInstanceMethod<Void>(channel, "tick")
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true &&
                ReflectionHelpers.getField<String?>(channel, "activeCarAddress") == null }
            assertEquals("bluetooth-input-unavailable", states.last().error)
            assertNotNull(manager.communicationDevice)
        } finally { closeChannel(channel) }
    }

    @Test fun selectedCarAppearingUpgradesWorkingSystemPlaybackWithoutRequiringANewDemand() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager)
        val target = "AA:BB:CC:DD:EE:02"
        audio.setAvailableCommunicationDevices(emptyList()); audio.setInputDevices(emptyList())
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }
        try {
            val demand = config()
            channel.start(demand)
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertNull(manager.communicationDevice)
            val car = sco(target, 102)
            audio.addAvailableCommunicationDevice(car, true)
            awaitBluetoothPlayback { manager.communicationDevice?.id == car.id && states.lastOrNull()?.outputReady == true }
            assertSame(demand, ReflectionHelpers.getField<MicrophoneConfig>(channel, "wanted"))
            assertEquals("bluetooth-input-unavailable", states.last().error)
        } finally { closeChannel(channel) }
    }

    @Test fun selectedScoArrivalUpgradesPlaybackButArrivalsAfterStopCannotRestartIt() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager)
        audio.setAvailableCommunicationDevices(emptyList()); audio.setInputDevices(emptyList())
        val target = "AA:BB:CC:DD:EE:02"
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            val car = sco(target, 102)
            audio.addAvailableCommunicationDevice(car, true)
            awaitBluetoothPlayback { manager.communicationDevice?.id == car.id && states.lastOrNull()?.outputReady == true }
            channel.stop()
            awaitBluetoothPlayback { states.lastOrNull()?.state == "idle" && states.last().released }
            val stopped = states.size
            audio.addAvailableCommunicationDevice(sco(target, 104), true)
            shadowOf(Looper.getMainLooper()).idleFor(31_000, TimeUnit.MILLISECONDS)
            assertEquals(stopped, states.size)
            assertNull(manager.communicationDevice)
        } finally { closeChannel(channel) }
    }

    @Test fun scoArrivalDoesNotOverridePermanentFocusLoss() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager)
        val target = "AA:BB:CC:DD:EE:02"
        audio.setAvailableCommunicationDevices(listOf(sco(target, 102)))
        audio.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_DELAYED)
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        val focus = requireNotNull(audio.lastAudioFocusRequest)
        focus.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS)
        shadowOf(Looper.getMainLooper()).idle()
        val attempts = states.count { it.state == "connecting" }
        audio.addAvailableCommunicationDevice(sco(target, 103), true)
        shadowOf(Looper.getMainLooper()).idleFor(31_000, TimeUnit.MILLISECONDS)
        assertEquals(attempts, states.count { it.state == "connecting" })
        assertSame(focus, audio.lastAudioFocusRequest)
        assertEquals("audio-focus-lost", states.last().error)
        closeChannel(channel)
    }

    @Test fun temporaryAudioIoFailuresRetryButSecurityDenialsDoNot() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        shadowOf(manager).setAvailableCommunicationDevices(emptyList())
        val target = "AA:BB:CC:DD:EE:02"
        for (reason in listOf("bluetooth-duplex-failed", "bluetooth-output-failed", "bluetooth-route-failed")) {
            val states = mutableListOf<BluetoothVoiceState>()
            val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }
            ReflectionHelpers.setField(channel, "wanted", config())
            ReflectionHelpers.setField(channel, "activeCarAddress", target)
            ReflectionHelpers.callInstanceMethod<Void>(channel, "fail", ReflectionHelpers.ClassParameter.from(String::class.java, reason))
            shadowOf(Looper.getMainLooper()).idleFor(1500, TimeUnit.MILLISECONDS)
            assertEquals(0, states.count { it.state == "connecting" })
            shadowOf(Looper.getMainLooper()).idleFor(600, TimeUnit.MILLISECONDS)
            assertTrue(states.count { it.state == "connecting" } >= 1)
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals("bluetooth-input-unavailable", states.last().error)
            closeChannel(channel)
        }

        // A platform SecurityException may indicate a privileged restriction
        // even if runtime permission checks pass; don't hammer the route.
        val denied = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, denied::add) { target }
        ReflectionHelpers.setField(channel, "wanted", config())
        ReflectionHelpers.setField(channel, "activeCarAddress", target)
        ReflectionHelpers.callInstanceMethod<Void>(channel, "fail", ReflectionHelpers.ClassParameter.from(String::class.java, "bluetooth-permission-denied"))
        shadowOf(Looper.getMainLooper()).idleFor(5000, TimeUnit.MILLISECONDS)
        assertEquals(0, denied.count { it.state == "connecting" })
        assertEquals("bluetooth-permission-denied", denied.last().error)
        closeChannel(channel)
    }

    @Test fun busyCallKeepsItsModeWhileSystemPlaybackContinuesWithoutRecording() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        shadowOf(manager).setAvailableCommunicationDevices(emptyList())
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { "AA:BB:CC:DD:EE:02" }
        manager.mode = AudioManager.MODE_IN_CALL
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals(AudioManager.MODE_IN_CALL, manager.mode)
            assertNull(manager.communicationDevice)
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
        } finally { closeChannel(channel) }
    }

    @Test fun microphoneAddressChoosesOnlyTheMatchingUniqueScoInput() {
        val devices = listOf("AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:02")
        assertEquals(devices[1], selectBluetoothAudioDevice(devices, "aa:bb:cc:dd:ee:02") { it })
        assertNull(selectBluetoothAudioDevice(devices, "AA:BB:CC:DD:EE:03") { it })
        assertNull(selectBluetoothAudioDevice(devices, null) { it })
        assertNull(selectBluetoothAudioDevice(listOf(devices[0], devices[0]), devices[0]) { it })
        assertNull(selectBluetoothAudioDevice(listOf(""), devices[0]) { it })
        assertTrue(sameBluetoothSelection(devices[0], devices[0].lowercase()))
        assertFalse(sameBluetoothSelection(devices[0], null))
        assertTrue(sameBluetoothSelection(null, null))
    }

    @Test fun identityDiagnosticsSeparatePlaceholdersFromValidLocallyAdministeredAddresses() {
        assertEquals("missing", bluetoothVoiceAddressIdentity(null))
        assertEquals("missing", bluetoothVoiceAddressIdentity("  "))
        assertEquals("invalid", bluetoothVoiceAddressIdentity("AA-BB-CC-DD-EE-01"))
        for (address in listOf("00:00:00:00:00:00", "02:00:00:00:00:00", "ff:ff:ff:ff:ff:ff")) {
            assertEquals("placeholder", bluetoothVoiceAddressIdentity(address))
        }
        assertEquals("valid", bluetoothVoiceAddressIdentity(" 02:01:02:03:04:05 "))
        assertEquals("valid", bluetoothVoiceAddressIdentity("aa:bb:cc:dd:ee:01"))
    }

    @Test fun profileRelationsDistinguishExactOtherAndUnresolvedIdentitiesWithoutLeakingNamesOrAddresses() {
        val selected = "AA:BB:CC:DD:EE:01"
        val other = "AA:BB:CC:DD:EE:02"
        val unresolved = "AA:BB:CC:DD:EE:03"
        val connected = listOf(selected to "Private car", other to "Private headset")
        val relations = bluetoothVoiceProfileRelations(selected, listOf(
            selected.lowercase() to "Different name", other to " private HEADSET ",
            unresolved to " PRIVATE CAR ", "02:00:00:00:00:00" to "Private car", null to " "), connected)
        assertTrue(relations.contains("scoCandidates=5"))
        assertTrue(relations.contains("missingAddresses=1 invalidAddresses=0 placeholderAddresses=1 usableIdentityAddresses=3"))
        assertTrue(relations.contains("scoAddressSelectedMatches=1 scoAddressOtherMatches=1 scoAddressUnmatched=1"))
        assertTrue(relations.contains("scoNameSelectedMatches=2 scoNameOtherMatches=1"))
        for (privateValue in listOf(selected, other, unresolved, "Private car", "Private headset", "02:00:00:00:00:00")) {
            assertFalse(relations.contains(privateValue, ignoreCase = true))
        }
        assertNull(selectBluetoothAudioDevice(listOf(unresolved), selected) { it })
        val unnamed = bluetoothVoiceProfileRelations(selected, listOf(unresolved to " "), listOf(selected to ""))
        assertTrue(unnamed.contains("scoNameSelectedMatches=0 scoNameOtherMatches=0"))
    }

    @Test fun unmatchedScoAddressStillProvidesPlaybackWithoutClaimingItsMicrophone() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val unrelated = sco("02:00:00:00:00:00", 111)
        shadowOf(manager).setAvailableCommunicationDevices(listOf(unrelated))
        shadowOf(manager).setInputDevices(emptyList())
        val states = mutableListOf<BluetoothVoiceState>()
        val logs = java.util.concurrent.CopyOnWriteArrayList<String>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add, diagnostic = logs::add) { "AA:BB:CC:DD:EE:01" }
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals("bluetooth-input-unavailable", states.last().error)
            assertFalse(states.last().released)
            assertSame(unrelated, manager.communicationDevice)
            assertEquals(AudioManager.MODE_IN_COMMUNICATION, manager.mode)
            assertTrue(logs.any { it.contains("stage=communication-devices") && it.contains("matches=0") && it.contains("selected=true") })
            assertTrue(logs.none { it.contains("AA:BB:CC:DD:EE:01") })
        } finally { closeChannel(channel) }
    }

    @Test fun anotherScoOutputStillDiagnosesSelectedCarProfilesOncePerDemandWithoutClaimingItsMicrophone() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val selectedAddress = "AA:BB:CC:DD:EE:01"
        val otherAddress = "AA:BB:CC:DD:EE:02"
        shadowOf(manager).setAvailableCommunicationDevices(listOf(sco(otherAddress, 123)))
        val adapter = app.getSystemService(BluetoothManager::class.java).adapter
        val bluetooth = shadowOf(adapter)
        bluetooth.setEnabled(true)
        bluetooth.setProfileConnectionState(BluetoothProfile.HEADSET, BluetoothProfile.STATE_CONNECTED)
        bluetooth.setProfileConnectionState(BluetoothProfile.A2DP, BluetoothProfile.STATE_CONNECTED)
        val headset = mock(BluetoothProfile::class.java)
        val a2dp = mock(BluetoothProfile::class.java)
        `when`(headset.connectedDevices).thenReturn(listOf(adapter.getRemoteDevice(otherAddress)))
        `when`(a2dp.connectedDevices).thenReturn(listOf(adapter.getRemoteDevice(selectedAddress)))
        bluetooth.setProfileProxy(BluetoothProfile.HEADSET, headset)
        bluetooth.setProfileProxy(BluetoothProfile.A2DP, a2dp)
        val states = mutableListOf<BluetoothVoiceState>()
        val logs = java.util.concurrent.CopyOnWriteArrayList<String>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add, diagnostic = logs::add) { selectedAddress }
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertTrue(logs.any { it.contains("stage=communication-devices") && it.contains("candidates=1") &&
            it.contains("matches=0") && it.contains("types=${AudioDeviceInfo.TYPE_BLUETOOTH_SCO}") && it.contains("validAddresses=1") })
        assertTrue(logs.any { it.contains("stage=headset-diagnostic profile=headset") && it.contains("connected=1 selectedMatch=false") &&
            it.contains("scoAddressSelectedMatches=0 scoAddressOtherMatches=1 scoAddressUnmatched=0") })
        assertTrue(logs.any { it.contains("stage=headset-diagnostic profile=a2dp") && it.contains("connected=1 selectedMatch=true") &&
            it.contains("scoAddressSelectedMatches=0 scoAddressOtherMatches=0 scoAddressUnmatched=1") })
        shadowOf(Looper.getMainLooper()).idleFor(7500, TimeUnit.MILLISECONDS)
        for (profile in listOf("headset", "a2dp")) {
            assertEquals(1, logs.count { it.contains("stage=headset-diagnostic profile=$profile") && it.contains("result=requested") })
        }
        awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
        assertEquals("bluetooth-input-unavailable", states.last().error)
        assertFalse(states.last().released)
        assertEquals(AudioManager.MODE_IN_COMMUNICATION, manager.mode)
        assertEquals(otherAddress, manager.communicationDevice?.address)
        assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
        assertTrue(logs.none { it.contains(selectedAddress) || it.contains(otherAddress) })
        assertFalse(bluetooth.hasActiveProfileProxy(BluetoothProfile.HEADSET))
        assertFalse(bluetooth.hasActiveProfileProxy(BluetoothProfile.A2DP))
        closeChannel(channel)
    }

    @Test fun queuedProfileDiagnosticsCloseProxiesWithoutReportingAfterStopOrClose() {
        for (close in listOf(false, true)) {
            val app = RuntimeEnvironment.getApplication()
            shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
            val manager = app.getSystemService(AudioManager::class.java)
            shadowOf(manager).setAvailableCommunicationDevices(listOf(sco("AA:BB:CC:DD:EE:02", 123)))
            val adapter = app.getSystemService(BluetoothManager::class.java).adapter
            val bluetooth = shadowOf(adapter)
            bluetooth.setEnabled(true)
            for (profile in listOf(BluetoothProfile.HEADSET, BluetoothProfile.A2DP)) {
                val proxy = mock(BluetoothProfile::class.java)
                `when`(proxy.connectedDevices).thenReturn(listOf(adapter.getRemoteDevice("AA:BB:CC:DD:EE:01")))
                bluetooth.setProfileProxy(profile, proxy)
            }
            val logs = java.util.concurrent.CopyOnWriteArrayList<String>()
            val channel = AndroidBluetoothVoiceChannel(app, {}, diagnostic = logs::add) { "AA:BB:CC:DD:EE:01" }
            channel.start(config())
            if (close) channel.close() else channel.stop()
            shadowOf(Looper.getMainLooper()).idle()
            assertTrue(logs.any { it.contains("stage=headset-diagnostic") && it.contains("result=requested") })
            assertTrue(logs.none { it.contains("stage=headset-diagnostic") && it.contains("connected=") })
            assertFalse(bluetooth.hasActiveProfileProxy(BluetoothProfile.HEADSET))
            assertFalse(bluetooth.hasActiveProfileProxy(BluetoothProfile.A2DP))
            closeChannel(channel)
        }
    }

    @Test fun selectionChangesRejectQueuedProfilesAndPermitFreshDiagnosticsForTheNewCar() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val oldCar = "AA:BB:CC:DD:EE:01"
        val newCar = "AA:BB:CC:DD:EE:02"
        shadowOf(manager).setAvailableCommunicationDevices(listOf(sco("AA:BB:CC:DD:EE:03", 123)))
        val adapter = app.getSystemService(BluetoothManager::class.java).adapter
        val bluetooth = shadowOf(adapter)
        bluetooth.setEnabled(true)
        for (profile in listOf(BluetoothProfile.HEADSET, BluetoothProfile.A2DP)) {
            val proxy = mock(BluetoothProfile::class.java)
            `when`(proxy.connectedDevices).thenReturn(listOf(adapter.getRemoteDevice(newCar)))
            bluetooth.setProfileProxy(profile, proxy)
        }
        var selectedAddress = oldCar
        val logs = java.util.concurrent.CopyOnWriteArrayList<String>()
        val channel = AndroidBluetoothVoiceChannel(app, {}, diagnostic = logs::add) { selectedAddress }
        channel.start(config())
        shadowOf(Looper.getMainLooper()).runOneTask()
        selectedAddress = newCar
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(logs.none { it.contains("stage=headset-diagnostic") && it.contains("connected=") })
        for (profile in listOf(BluetoothProfile.HEADSET, BluetoothProfile.A2DP)) {
            val proxy = mock(BluetoothProfile::class.java)
            `when`(proxy.connectedDevices).thenReturn(listOf(adapter.getRemoteDevice(newCar)))
            bluetooth.setProfileProxy(profile, proxy)
        }
        shadowOf(Looper.getMainLooper()).idleFor(2100, TimeUnit.MILLISECONDS)
        awaitBluetoothPlayback {
            ReflectionHelpers.getField<String?>(channel, "activeCarAddress") == newCar &&
                !ReflectionHelpers.getField<Boolean>(channel, "workerRetiring")
        }
        for (profile in listOf("headset", "a2dp")) {
            assertEquals(1, logs.count { it.contains("stage=headset-diagnostic profile=$profile") && it.contains("connected=1 selectedMatch=true") })
        }
        assertTrue(logs.none { it.contains(oldCar) || it.contains(newCar) })
        assertNotNull(manager.communicationDevice)
        closeChannel(channel)
    }
    @Test fun deniedCaptureAndBluetoothPermissionsStillPermitSystemPlaybackWithoutRecording() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).denyPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add)
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals("bluetooth-permission-denied", states.last().error)
            assertFalse(states.last().released)
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertNull(manager.communicationDevice)
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
        } finally { closeChannel(channel) }
    }

    @Test fun noBluetoothUsesSystemPlaybackButAnExistingCallIsNeverPreempted() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add)
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            channel.stop()
            awaitBluetoothPlayback { states.lastOrNull()?.state == "idle" && states.last().released }
            manager.mode = AudioManager.MODE_IN_CALL
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals(AudioManager.MODE_IN_CALL, manager.mode)
            assertNull(manager.communicationDevice)
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
        } finally { closeChannel(channel) }
    }

    @Test fun selectedScoOutputKeepsPlayingWhenOnlyThePhoneMicrophoneIsAvailable() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val car = sco("AA:BB:CC:DD:EE:01", 101)
        shadowOf(manager).setAvailableCommunicationDevices(listOf(car))
        shadowOf(manager).setInputDevices(listOf(AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_MIC).build()))
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { car.address }
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals("bluetooth-input-unavailable", states.last().error)
            assertFalse(states.last().released)
            assertEquals(AudioManager.MODE_IN_COMMUNICATION, manager.mode)
            assertSame(car, manager.communicationDevice)
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
            assertNull(shadowOf(manager).lastAbandonedAudioFocusRequest)
            channel.stop()
            awaitBluetoothPlayback { states.lastOrNull()?.state == "idle" && states.last().released }
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertNull(manager.communicationDevice)
        } finally { closeChannel(channel) }
    }

    @Test fun multipleOutputsRemainUsableAndRejectedScoSelectionFallsBackWithoutChangingCommunicationMode() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val car = sco("AA:BB:CC:DD:EE:01", 101)
        val other = sco("AA:BB:CC:DD:EE:02", 102)
        shadowOf(manager).setAvailableCommunicationDevices(listOf(car, other))
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add)
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertSame(car, manager.communicationDevice)
            channel.stop()
            awaitBluetoothPlayback { states.lastOrNull()?.state == "idle" && states.last().released }
            shadowOf(manager).setAvailableCommunicationDevices(listOf(car))
            shadowOf(manager).lockCommunicationDevice(true)
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertNull(manager.communicationDevice)
            assertFalse(states.last().released)
        } finally { closeChannel(channel) }
    }

}
