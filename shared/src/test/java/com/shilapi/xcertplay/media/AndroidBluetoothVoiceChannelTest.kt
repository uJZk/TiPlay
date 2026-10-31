package com.shilapi.xcertplay.media

import android.Manifest
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.os.Looper
import com.shilapi.xcertplay.airplay.MicrophoneConfig
import java.net.InetAddress
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadows.AudioDeviceInfoBuilder
import org.robolectric.util.ReflectionHelpers
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class AndroidBluetoothVoiceChannelTest {
    private fun config() = MicrophoneConfig("telephony", 16000, 1, 97, 20, InetAddress.getLoopbackAddress(), 12345, ByteArray(32))
    private fun sco(address: String, id: Int): AudioDeviceInfo {
        val device = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build()
        val port: Any = ReflectionHelpers.getField(device, "mPort")
        ReflectionHelpers.setField(port, "mAddress", address)
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
            ReflectionHelpers.setField(channel, "selected", car)
            ReflectionHelpers.setField(channel, "previousMode", AudioManager.MODE_NORMAL)
            ReflectionHelpers.setField(channel, "workerRetiring", true)
            manager.mode = AudioManager.MODE_IN_COMMUNICATION
            assertTrue(manager.setCommunicationDevice(car))
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
            assertEquals(attempts + 1, states.count { it.state == "connecting" })
            assertEquals("bluetooth-input-unavailable", states.last().error)
            assertSame(demand, ReflectionHelpers.getField<MicrophoneConfig>(channel, "wanted"))
            channel.close(); shadowOf(Looper.getMainLooper()).idle()
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
        assertEquals("bluetooth-input-unavailable", states.last().error)
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
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
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
    }

    @Test fun temporaryFocusDenialRetriesTheSameDemandButNeverRequestsFocusDuringAnotherCall() {
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
        channel.start(demand); shadowOf(Looper.getMainLooper()).idle()
        val refused = requireNotNull(audio.lastAudioFocusRequest)
        assertEquals("audio-focus-unavailable", states.last().error)
        manager.mode = AudioManager.MODE_IN_CALL
        audio.setNextFocusRequestResponse(AudioManager.AUDIOFOCUS_REQUEST_GRANTED)
        shadowOf(Looper.getMainLooper()).idleFor(2100, TimeUnit.MILLISECONDS)
        assertSame(refused, audio.lastAudioFocusRequest)
        assertEquals(AudioManager.MODE_IN_CALL, manager.mode)
        assertEquals("communication-route-busy", states.last().error)
        manager.mode = AudioManager.MODE_NORMAL
        shadowOf(Looper.getMainLooper()).idleFor(4100, TimeUnit.MILLISECONDS)
        assertNotSame(refused, audio.lastAudioFocusRequest)
        assertEquals("bluetooth-input-unavailable", states.last().error)
        assertSame(demand, ReflectionHelpers.getField<MicrophoneConfig>(channel, "wanted"))
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
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
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
    }

    @Test fun selectedCarMatchesBothScoInputAndOutputWithoutUsingOtherHeadsets() {
        val target = "AA:BB:CC:DD:EE:01"
        val carInput = sco(target, 101)
        val carOutput = sco(target, 102)
        val otherInput = sco("AA:BB:CC:DD:EE:02", 201)
        val otherOutput = sco("AA:BB:CC:DD:EE:02", 202)
        assertSame(carInput, selectBluetoothAudioDevice(listOf(otherInput, carInput), target) { it.address })
        assertSame(carOutput, selectBluetoothAudioDevice(listOf(otherOutput, carOutput), target) { it.address })
        assertNull(selectBluetoothAudioDevice(listOf(otherInput), target) { it.address })
        assertNull(selectBluetoothAudioDevice(listOf(otherOutput), target) { it.address })
    }

    @Test fun changingOrClearingSelectionReleasesOldRouteAndRetriesOnlyAnExplicitTarget() {
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
        // Model an already acquired route without starting Android's native
        // AudioRecord worker in this JVM-only test.
        ReflectionHelpers.setField(channel, "wanted", config())
        ReflectionHelpers.setField(channel, "activeCarAddress", oldAddress)
        ReflectionHelpers.setField(channel, "selected", old)
        ReflectionHelpers.setField(channel, "acquired", true)
        ReflectionHelpers.setField(channel, "previousMode", AudioManager.MODE_NORMAL)
        manager.mode = AudioManager.MODE_IN_COMMUNICATION
        selection = newAddress
        ReflectionHelpers.callInstanceMethod<Void>(channel, "tick")
        // The new SCO route is acquired; the deliberate missing input then
        // fails closed rather than selecting the old or phone microphone.
        assertEquals("bluetooth-input-unavailable", states.last().error)
        assertTrue(states.last().released)
        assertEquals(AudioManager.MODE_NORMAL, manager.mode)

        // A failure must not pin a continuing voice demand to the previous
        // target: selecting a different unavailable address is attempted.
        selection = "AA:BB:CC:DD:EE:03"
        shadowOf(Looper.getMainLooper()).idleFor(1100, TimeUnit.MILLISECONDS)
        assertEquals("car-bluetooth-unavailable", states.last().error)

        // An explicitly cleared selection remains waiting, even with a single
        // other headset; restoring a selection triggers a fresh acquisition.
        selection = null
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("car-bluetooth-not-selected", states.last().error)
        assertNull(manager.communicationDevice)
        selection = newAddress
        shadowOf(Looper.getMainLooper()).idleFor(1100, TimeUnit.MILLISECONDS)
        assertEquals("bluetooth-input-unavailable", states.last().error)
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
    }

    @Test fun selectedCarAppearingAfterAnUnavailableFailureRetriesWithBackoff() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val target = "AA:BB:CC:DD:EE:02"
        shadowOf(manager).setAvailableCommunicationDevices(emptyList())
        shadowOf(manager).setInputDevices(emptyList())
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("car-bluetooth-unavailable", states.last().error)
        val attempts = states.count { it.state == "connecting" }

        shadowOf(manager).setAvailableCommunicationDevices(listOf(sco(target, 102)))
        shadowOf(Looper.getMainLooper()).idleFor(1500, TimeUnit.MILLISECONDS)
        assertEquals(attempts, states.count { it.state == "connecting" })
        shadowOf(Looper.getMainLooper()).idleFor(600, TimeUnit.MILLISECONDS)
        assertEquals(attempts + 1, states.count { it.state == "connecting" })
        // The test supplies no input device; reaching this failure proves the
        // same target was reacquired without pretending duplex audio started.
        assertEquals("bluetooth-input-unavailable", states.last().error)
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
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
            assertEquals(1, states.count { it.state == "connecting" })
            assertEquals("car-bluetooth-unavailable", states.last().error)
            channel.close(); shadowOf(Looper.getMainLooper()).idle()
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
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
    }

    @Test fun busyCallIsNeverPreemptedAndRouteIsRetriedAfterItEnds() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        shadowOf(manager).setAvailableCommunicationDevices(emptyList())
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { "AA:BB:CC:DD:EE:02" }
        manager.mode = AudioManager.MODE_IN_CALL
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("communication-route-busy", states.last().error)
        shadowOf(Looper.getMainLooper()).idleFor(2100, TimeUnit.MILLISECONDS)
        assertEquals(AudioManager.MODE_IN_CALL, manager.mode)
        assertEquals("communication-route-busy", states.last().error)
        manager.mode = AudioManager.MODE_NORMAL
        shadowOf(Looper.getMainLooper()).idleFor(4100, TimeUnit.MILLISECONDS)
        assertEquals("car-bluetooth-unavailable", states.last().error)
        assertEquals(AudioManager.MODE_NORMAL, manager.mode)
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
    }
    @Test fun selectedAddressChoosesOnlyTheMatchingUniqueScoDevice() {
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

    @Test fun selectedDeviceWithNoMatchingScoAddressDoesNotUseAnotherDevice() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val unrelated = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build()
        shadowOf(manager).setAvailableCommunicationDevices(listOf(unrelated))
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { "AA:BB:CC:DD:EE:01" }
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("car-bluetooth-unavailable", states.last().error)
        assertTrue(states.last().released)
        assertEquals(AudioManager.MODE_NORMAL, manager.mode)
        assertNull(manager.communicationDevice)
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
    }
    @Test fun deniedMicrophoneOrBluetoothPermissionDoesNotSelectThePhoneOrChangeMode() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).denyPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add)
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("microphone-or-bluetooth-permission", states.last().error)
        assertTrue(states.last().released)
        assertEquals(AudioManager.MODE_NORMAL, manager.mode)
        assertNull(manager.communicationDevice)
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
    }
    @Test fun noCarHeadsetDoesNotFallBackAndExistingCallIsNeverPreempted() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add)
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("car-bluetooth-unavailable", states.last().error)
        assertEquals(AudioManager.MODE_NORMAL, manager.mode)
        manager.mode = AudioManager.MODE_IN_CALL
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("communication-route-busy", states.last().error)
        assertEquals(AudioManager.MODE_IN_CALL, manager.mode)
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
    }

    @Test fun scoSelectionAloneIsNotReadyAndMissingBluetoothInputRestoresModeAndFocus() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val car = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build()
        shadowOf(manager).setAvailableCommunicationDevices(listOf(car))
        shadowOf(manager).setInputDevices(listOf(AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_MIC).build()))
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add)
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertTrue(states.none { it.state == "active" })
        assertEquals("bluetooth-input-unavailable", states.last().error)
        assertTrue(states.last().released)
        assertEquals(AudioManager.MODE_NORMAL, manager.mode)
        assertNull(manager.communicationDevice)
        assertNotNull(shadowOf(manager).lastAbandonedAudioFocusRequest)
        channel.stop(); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("idle", states.last().state)
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
    }

    @Test fun multipleHeadsetsAreNotGuessedAndRejectedSelectionDoesNotLeaveCommunicationMode() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val car = AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BLUETOOTH_SCO).build()
        shadowOf(manager).setAvailableCommunicationDevices(listOf(car, car))
        val states = mutableListOf<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add)
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("multiple-bluetooth-headsets", states.last().error)
        shadowOf(manager).setAvailableCommunicationDevices(listOf(car))
        shadowOf(manager).lockCommunicationDevice(true)
        channel.start(config()); shadowOf(Looper.getMainLooper()).idle()
        assertEquals("bluetooth-route-rejected", states.last().error)
        assertEquals(AudioManager.MODE_NORMAL, manager.mode)
        assertTrue(states.last().released)
        channel.close(); shadowOf(Looper.getMainLooper()).idle()
    }
}
