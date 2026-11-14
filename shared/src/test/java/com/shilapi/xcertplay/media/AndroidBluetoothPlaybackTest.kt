package com.shilapi.xcertplay.media

import android.Manifest
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.os.Looper
import com.shilapi.xcertplay.airplay.AudioStreamId
import com.shilapi.xcertplay.airplay.MicrophoneConfig
import java.net.InetAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.LooperMode
import org.robolectric.annotation.RealObject
import org.robolectric.shadows.AudioDeviceInfoBuilder
import org.robolectric.shadows.ShadowAudioManager
import org.robolectric.shadows.ShadowAudioTrack
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE,
    shadows = [BluetoothPlaybackTrackShadow::class, BluetoothPlaybackRecordShadow::class])
@LooperMode(LooperMode.Mode.PAUSED)
class AndroidBluetoothPlaybackTest {
    @Before fun resetAudioIo() {
        BluetoothPlaybackTrackShadow.reset()
        BluetoothPlaybackRecordShadow.reset()
    }

    @Test fun playbackPrefersExactCarThenCurrentBluetoothAndStillAllowsAnUnidentifiedOutput() {
        val target = "AA:BB:CC:DD:EE:01"
        val other = "AA:BB:CC:DD:EE:02"
        val placeholder = "02:00:00:00:00:00"
        assertEquals(target, selectBluetoothPlaybackDevice(listOf(other, target), target, other) { it })
        assertEquals(other, selectBluetoothPlaybackDevice(listOf(placeholder, other), target, other) { it })
        assertEquals(placeholder, selectBluetoothPlaybackDevice(listOf(placeholder), target) { it })
        assertEquals(other, selectBluetoothPlaybackDevice(listOf(other), null) { it })
        assertNull(selectBluetoothPlaybackDevice(emptyList<String>(), target) { it })
        // Broader playback preference does not authorize a different microphone.
        assertNull(selectBluetoothAudioDevice(listOf(other, placeholder), target) { it })
        assertNull(selectBluetoothAudioDevice(listOf(target, target), target) { it })
    }

    @Test fun placeholderOrOtherScoCanPlayWithoutOpeningEitherItsMicrophoneOrThePhoneMicrophone() {
        for (address in listOf("02:00:00:00:00:00", "AA:BB:CC:DD:EE:02")) {
            val app = RuntimeEnvironment.getApplication()
            shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
            val manager = app.getSystemService(AudioManager::class.java)
            val output = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, address, 102)
            val target = "AA:BB:CC:DD:EE:01"
            shadowOf(manager).setAvailableCommunicationDevices(listOf(output))
            shadowOf(manager).setInputDevices(listOf(
                device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 101, input = true),
                device(AudioDeviceInfo.TYPE_BUILTIN_MIC, "", 201, input = true)))
            val states = CopyOnWriteArrayList<BluetoothVoiceState>()
            val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }.also(::useJvmMixer)
            try {
                channel.start(config())
                awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
                assertSame(output, manager.communicationDevice)
                assertEquals("bluetooth-input-unavailable", states.last().error)
                assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
                proveNonzeroPlayback(channel)
            } finally { close(channel, states) }
        }
    }

    @Test fun exactCarMediaOutputIsPreferredOverAnotherScoWithoutBorrowingAMicrophone() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val target = "AA:BB:CC:DD:EE:01"
        val media = device(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, target, 302)
        shadowOf(manager).setAvailableCommunicationDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "AA:BB:CC:DD:EE:02", 202)))
        shadowOf(manager).setOutputDevices(listOf(media))
        shadowOf(manager).setInputDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 301, input = true)))
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            val track = BluetoothPlaybackTrackShadow.tracks.last()
            assertSame(media, (shadowOf(track) as BluetoothPlaybackTrackShadow).preferred)
            assertEquals(AudioAttributes.USAGE_MEDIA, track.audioAttributes.usage)
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertNull(manager.communicationDevice)
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
            proveNonzeroPlayback(channel)
        } finally { close(channel, states) }
    }

    @Test fun noBluetoothAndDeniedMicrophonePermissionStillAllowSystemPlayback() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.BLUETOOTH_CONNECT)
        shadowOf(app).denyPermissions(Manifest.permission.RECORD_AUDIO)
        val manager = app.getSystemService(AudioManager::class.java)
        shadowOf(manager).setAvailableCommunicationDevices(emptyList())
        shadowOf(manager).setOutputDevices(emptyList())
        shadowOf(manager).setInputDevices(listOf(device(AudioDeviceInfo.TYPE_BUILTIN_MIC, "", 401, input = true)))
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { "AA:BB:CC:DD:EE:01" }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals("microphone-permission-denied", states.last().error)
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertNull(manager.communicationDevice)
            assertEquals(AudioAttributes.USAGE_MEDIA, BluetoothPlaybackTrackShadow.tracks.last().audioAttributes.usage)
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
            proveNonzeroPlayback(channel)
        } finally { close(channel, states) }
    }

    @Test fun rejectedCommunicationRouteUsesSystemPlaybackWithoutStealingThePhoneMicrophone() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val target = "AA:BB:CC:DD:EE:01"
        shadowOf(manager).setAvailableCommunicationDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 502)))
        shadowOf(manager).setOutputDevices(emptyList())
        shadowOf(manager).setInputDevices(listOf(device(AudioDeviceInfo.TYPE_BUILTIN_MIC, "", 501, input = true)))
        shadowOf(manager).lockCommunicationDevice(true)
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertNull(manager.communicationDevice)
            assertEquals(AudioAttributes.USAGE_MEDIA, BluetoothPlaybackTrackShadow.tracks.last().audioAttributes.usage)
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
            proveNonzeroPlayback(channel)
        } finally { close(channel, states); shadowOf(manager).lockCommunicationDevice(false) }
    }

    @Test fun deniedBluetoothPermissionStillAllowsDefaultPlaybackWithoutOpeningCapture() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
        shadowOf(app).denyPermissions(Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        shadowOf(manager).setAvailableCommunicationDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "AA:BB:CC:DD:EE:01", 702)))
        shadowOf(manager).setInputDevices(listOf(device(AudioDeviceInfo.TYPE_BUILTIN_MIC, "", 701, input = true)))
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val logs = CopyOnWriteArrayList<String>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add, diagnostic = logs::add) { "AA:BB:CC:DD:EE:01" }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertNull(manager.communicationDevice)
            val focus = requireNotNull(shadowOf(manager).lastAudioFocusRequest?.audioFocusRequest)
            assertEquals(AudioAttributes.USAGE_MEDIA, focus.audioAttributes.usage)
            assertEquals(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT, focus.focusGain)
            assertTrue(logs.none { "stage=headset-diagnostic" in it || "stage=communication-devices" in it })
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
            proveNonzeroPlayback(channel)
        } finally { close(channel, states) }
    }

    @Test fun anotherCallKeepsItsCommunicationDeviceWhileDefaultPlaybackUsesMediaFocus() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        for (mode in listOf(AudioManager.MODE_IN_CALL, AudioManager.MODE_IN_COMMUNICATION)) {
            val external = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "AA:BB:CC:DD:EE:02", 802)
            shadowOf(manager).setAvailableCommunicationDevices(listOf(external))
            assertTrue(manager.setCommunicationDevice(external))
            manager.mode = mode
            val states = CopyOnWriteArrayList<BluetoothVoiceState>()
            val channel = AndroidBluetoothVoiceChannel(app, states::add) { "AA:BB:CC:DD:EE:01" }.also(::useJvmMixer)
            try {
                channel.start(config())
                awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
                assertEquals(mode, manager.mode)
                assertSame(external, manager.communicationDevice)
                val focus = requireNotNull(shadowOf(manager).lastAudioFocusRequest?.audioFocusRequest)
                assertEquals(AudioAttributes.USAGE_MEDIA, focus.audioAttributes.usage)
                assertEquals(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT, focus.focusGain)
                assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
                proveNonzeroPlayback(channel)
            } finally {
                close(channel, states)
                assertEquals("retiring default playback must not clear another call's route", mode, manager.mode)
                assertSame(external, manager.communicationDevice)
                manager.clearCommunicationDevice()
                manager.mode = AudioManager.MODE_NORMAL
            }
        }
    }

    @Test fun matchingCarMicrophoneInitializationFailureDoesNotStopItsWorkingPlayback() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val target = "AA:BB:CC:DD:EE:01"
        val output = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 602)
        shadowOf(manager).setAvailableCommunicationDevices(listOf(output))
        shadowOf(manager).setInputDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 601, input = true)))
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback { BluetoothPlaybackRecordShadow.builds.get() == 1 && states.lastOrNull()?.outputReady == true && states.last().error != null }
            assertSame(output, manager.communicationDevice)
            proveNonzeroPlayback(channel)
            assertEquals("a capture failure does not retire the playback track", AudioTrack.PLAYSTATE_PLAYING,
                BluetoothPlaybackTrackShadow.tracks.last().playState)
        } finally { close(channel, states) }
    }

    @Test fun failedScoPlaybackRetiresItsRouteBeforeContinuingOnSystemMediaOutput() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val target = "AA:BB:CC:DD:EE:01"
        shadowOf(manager).setAvailableCommunicationDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 902)))
        shadowOf(manager).setInputDevices(listOf(device(AudioDeviceInfo.TYPE_BUILTIN_MIC, "", 901, input = true)))
        shadowOf(manager).setOutputDevices(emptyList())
        BluetoothPlaybackTrackShadow.failNextScoWrite.set(true)
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback {
                BluetoothPlaybackTrackShadow.tracks.size >= 2 &&
                    BluetoothPlaybackTrackShadow.tracks.last().audioAttributes.usage == AudioAttributes.USAGE_MEDIA &&
                    states.lastOrNull()?.outputReady == true
            }
            assertFalse("the injected SCO write failure must actually occur", BluetoothPlaybackTrackShadow.failNextScoWrite.get())
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertNull(manager.communicationDevice)
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
            proveNonzeroPlayback(channel)
        } finally { close(channel, states) }
    }

    @Test
    @Config(shadows = [PendingCommunicationAudioManagerShadow::class,
        BluetoothPlaybackTrackShadow::class, BluetoothPlaybackRecordShadow::class])
    fun acceptedScoRequestThatNeverBecomesCurrentIsCancelledWithoutClearingAnotherClientsRoute() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager) as PendingCommunicationAudioManagerShadow
        val target = "AA:BB:CC:DD:EE:01"
        val requested = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 1002)
        val external = device(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, "", 1003)
        audio.externalDevice = external
        audio.setAvailableCommunicationDevices(listOf(requested))
        audio.setInputDevices(emptyList())
        audio.setOutputDevices(emptyList())
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }.also(::useJvmMixer)
        try {
            channel.start(config())
            shadowOf(Looper.getMainLooper()).idle()
            assertSame(requested, audio.pendingClientRequest)
            assertSame("acceptance does not mean the request became globally current", external, manager.communicationDevice)
            shadowOf(Looper.getMainLooper()).idleFor(8100, TimeUnit.MILLISECONDS)
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            assertEquals(1, audio.clearClientCalls.get())
            assertNull("the accepted app-client request must be cancelled even though it was never current", audio.pendingClientRequest)
            assertSame("cancelling our client must leave another client's current route intact", external, manager.communicationDevice)
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertEquals(AudioAttributes.USAGE_MEDIA, BluetoothPlaybackTrackShadow.tracks.last().audioAttributes.usage)
            assertEquals(0, BluetoothPlaybackRecordShadow.builds.get())
            proveNonzeroPlayback(channel)
        } finally {
            close(channel, states)
            assertSame(external, manager.communicationDevice)
            assertNull(audio.pendingClientRequest)
        }
    }

    @Test fun microphoneInitializationRetriesAfterBackoffWithoutRestartingPlaybackAndStopsWithItsDemand() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val target = "AA:BB:CC:DD:EE:01"
        val output = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 1102)
        shadowOf(manager).setAvailableCommunicationDevices(listOf(output))
        shadowOf(manager).setInputDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 1101, input = true)))
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val logs = CopyOnWriteArrayList<String>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add, diagnostic = logs::add) { target }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback { BluetoothPlaybackRecordShadow.builds.get() == 1 && states.lastOrNull()?.outputReady == true }
            // The capture constructor deliberately rejects. Wait until its owner has entered
            // the retry sleep before advancing fake time, so initialization cannot race the clock.
            awaitBluetoothPlayback {
                Thread.getAllStackTraces().any { (thread, stack) ->
                    thread.name == "tiplay-bluetooth-voice" && thread.state == Thread.State.TIMED_WAITING &&
                        stack.any { it.className.contains("AndroidBluetoothVoiceChannel") }
                }
            }
            val track = BluetoothPlaybackTrackShadow.tracks.single()
            proveNonzeroPlayback(channel)
            shadowOf(Looper.getMainLooper()).idleFor(2100, TimeUnit.MILLISECONDS)
            awaitBluetoothPlayback { BluetoothPlaybackRecordShadow.builds.get() == 2 }
            assertTrue(logs.any { "stage=microphone-retry delayMs=2000" in it })
            assertSame("retrying capture must preserve the already-playing track", track, BluetoothPlaybackTrackShadow.tracks.single())
            assertSame(output, manager.communicationDevice)
            assertEquals(AudioTrack.PLAYSTATE_PLAYING, track.playState)
            proveNonzeroPlayback(channel)
            channel.stop()
            awaitBluetoothPlayback { states.lastOrNull()?.released == true }
            val stoppedAttempts = BluetoothPlaybackRecordShadow.builds.get()
            shadowOf(Looper.getMainLooper()).idleFor(31_000, TimeUnit.MILLISECONDS)
            assertEquals("stopped demands must never reopen capture", stoppedAttempts, BluetoothPlaybackRecordShadow.builds.get())
        } finally { close(channel, states) }
    }

    @Test
    @Config(shadows = [ModeResetFailureAudioManagerShadow::class,
        BluetoothPlaybackTrackShadow::class, BluetoothPlaybackRecordShadow::class])
    fun failedOwnedModeCleanupDoesNotPublishReleasedOrForgetItsPlatformClient() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager) as ModeResetFailureAudioManagerShadow
        val target = "AA:BB:CC:DD:EE:01"
        audio.setAvailableCommunicationDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 1202)))
        audio.setInputDevices(emptyList())
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            audio.modeResetFailures.set(1)
            channel.stop()
            awaitBluetoothPlayback { audio.modeResetFailures.get() == 0 }
            assertEquals("communication device cancellation and mode cancellation are separate", 1, audio.clearClientCalls.get())
            assertNull(manager.communicationDevice)
            assertEquals(AudioManager.MODE_IN_COMMUNICATION, manager.mode)
            assertTrue("a failed mode cancellation must retain this app's platform ownership",
                ReflectionHelpers.getField(channel, "communicationOwned"))
            assertFalse("route cleanup has not completed", states.last().released)
            shadowOf(Looper.getMainLooper()).idleFor(1100, TimeUnit.MILLISECONDS)
            awaitBluetoothPlayback { states.lastOrNull()?.released == true }
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertFalse(ReflectionHelpers.getField(channel, "communicationOwned"))
            assertEquals("retry only the unfinished mode client", 1, audio.clearClientCalls.get())
            assertEquals(2, audio.modeResetCalls.get())
        } finally {
            audio.modeResetFailures.set(0)
            channel.close()
            shadowOf(Looper.getMainLooper()).idleFor(1100, TimeUnit.MILLISECONDS)
        }
    }

    @Test
    @Config(shadows = [ModeResetFailureAudioManagerShadow::class,
        BluetoothPlaybackTrackShadow::class, BluetoothPlaybackRecordShadow::class])
    fun persistentOwnedModeCleanupFailureKeepsFallbackQuarantinedAndExplicitCloseCanRetry() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager) as ModeResetFailureAudioManagerShadow
        val target = "AA:BB:CC:DD:EE:01"
        audio.setAvailableCommunicationDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 1302)))
        audio.setInputDevices(emptyList())
        audio.setOutputDevices(emptyList())
        audio.modeResetFailures.set(100)
        BluetoothPlaybackTrackShadow.failNextScoWrite.set(true)
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback { audio.modeResetCalls.get() == 1 }
            shadowOf(Looper.getMainLooper()).idleFor(4100, TimeUnit.MILLISECONDS)
            assertEquals("cleanup attempts are bounded", 3, audio.modeResetCalls.get())
            assertEquals(1, audio.clearClientCalls.get())
            assertEquals(AudioManager.MODE_IN_COMMUNICATION, manager.mode)
            assertTrue(ReflectionHelpers.getField(channel, "communicationOwned"))
            assertFalse(states.last().released)
            assertEquals("do not open fallback while our old platform client remains", 1,
                BluetoothPlaybackTrackShadow.tracks.size)
            shadowOf(Looper.getMainLooper()).idleFor(31_000, TimeUnit.MILLISECONDS)
            assertEquals(3, audio.modeResetCalls.get())
            assertFalse(states.last().released)
            // Explicit stop/close starts another finite cleanup attempt; another
            // application's global mode/device is never used as an ownership test.
            audio.modeResetFailures.set(0)
            channel.close()
            awaitBluetoothPlayback { states.lastOrNull()?.released == true }
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertEquals(4, audio.modeResetCalls.get())
            assertEquals("the successful device cancellation is never repeated", 1, audio.clearClientCalls.get())
        } finally {
            audio.modeResetFailures.set(0)
            channel.close()
            shadowOf(Looper.getMainLooper()).idleFor(1100, TimeUnit.MILLISECONDS)
        }
    }

    @Test
    @Config(shadows = [ModeResetFailureAudioManagerShadow::class,
        BluetoothPlaybackTrackShadow::class, BluetoothPlaybackRecordShadow::class])
    fun failedDeviceCleanupStillWithdrawsOwnModeAndRetryPreservesAnExternalCall() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager) as ModeResetFailureAudioManagerShadow
        val target = "AA:BB:CC:DD:EE:01"
        audio.setAvailableCommunicationDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 1402)))
        audio.setInputDevices(emptyList())
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            audio.clearClientFailures.set(1)
            channel.stop()
            awaitBluetoothPlayback { audio.clearClientCalls.get() == 1 }
            assertEquals("a device cancellation failure must not skip our independent mode cancellation", 1,
                audio.modeResetCalls.get())
            assertEquals(AudioManager.MODE_NORMAL, manager.mode)
            assertFalse(ReflectionHelpers.getField(channel, "communicationOwned"))
            assertTrue(ReflectionHelpers.getField(channel, "communicationRequested"))
            assertFalse(states.last().released)
            val external = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "AA:BB:CC:DD:EE:02", 1403)
            audio.externalDevice = external
            manager.mode = AudioManager.MODE_IN_CALL
            shadowOf(Looper.getMainLooper()).idleFor(1100, TimeUnit.MILLISECONDS)
            awaitBluetoothPlayback { states.lastOrNull()?.released == true }
            assertEquals(2, audio.clearClientCalls.get())
            assertEquals("already withdrawn mode client must not be cancelled again", 1, audio.modeResetCalls.get())
            assertEquals(AudioManager.MODE_IN_CALL, manager.mode)
            assertSame("cancel only our pending device client", external, manager.communicationDevice)
        } finally {
            audio.clearClientFailures.set(0)
            channel.close()
            shadowOf(Looper.getMainLooper()).idleFor(1100, TimeUnit.MILLISECONDS)
            audio.externalDevice = null
            manager.mode = AudioManager.MODE_NORMAL
        }
    }

    @Test
    @Config(shadows = [ModeResetFailureAudioManagerShadow::class,
        BluetoothPlaybackTrackShadow::class, BluetoothPlaybackRecordShadow::class])
    fun persistentDeviceCleanupFailureBoundsRetriesWithoutReacquiringAnAlreadyReleasedMode() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager) as ModeResetFailureAudioManagerShadow
        val target = "AA:BB:CC:DD:EE:01"
        audio.setAvailableCommunicationDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, target, 1502)))
        audio.setInputDevices(emptyList())
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val channel = AndroidBluetoothVoiceChannel(app, states::add) { target }.also(::useJvmMixer)
        try {
            channel.start(config())
            awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true }
            audio.clearClientFailures.set(100)
            channel.stop()
            awaitBluetoothPlayback { audio.clearClientCalls.get() == 1 }
            assertEquals("withdraw our mode even when our device cancellation keeps failing", 1, audio.modeResetCalls.get())
            assertFalse(ReflectionHelpers.getField(channel, "communicationOwned"))
            val external = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "AA:BB:CC:DD:EE:02", 1503)
            audio.externalDevice = external
            manager.mode = AudioManager.MODE_IN_CALL
            shadowOf(Looper.getMainLooper()).idleFor(35_100, TimeUnit.MILLISECONDS)
            assertEquals(3, audio.clearClientCalls.get())
            assertEquals(1, audio.modeResetCalls.get())
            assertFalse(states.last().released)
            assertTrue(ReflectionHelpers.getField(channel, "communicationRequested"))
            audio.clearClientFailures.set(0)
            channel.close()
            awaitBluetoothPlayback { states.lastOrNull()?.released == true }
            assertEquals(4, audio.clearClientCalls.get())
            assertEquals(1, audio.modeResetCalls.get())
            assertEquals(AudioManager.MODE_IN_CALL, manager.mode)
            assertSame(external, manager.communicationDevice)
        } finally {
            audio.clearClientFailures.set(0)
            channel.close()
            shadowOf(Looper.getMainLooper()).idleFor(1100, TimeUnit.MILLISECONDS)
            audio.externalDevice = null
            manager.mode = AudioManager.MODE_NORMAL
        }
    }

    private fun config() = MicrophoneConfig("telephony", 16000, 1, 97, 20,
        InetAddress.getLoopbackAddress(), 12345, ByteArray(32))

    private fun device(type: Int, address: String, id: Int, input: Boolean = false): AudioDeviceInfo {
        val device = AudioDeviceInfoBuilder.newBuilder().setType(type).build()
        val port: Any = ReflectionHelpers.getField(device, "mPort")
        ReflectionHelpers.setField(port, "mAddress", address)
        ReflectionHelpers.setField(port, "mRole", if (input) 1 else 2)
        val handle: Any = ReflectionHelpers.getField(port, "mHandle")
        ReflectionHelpers.setField(handle, "mId", id)
        return device
    }

    private fun useJvmMixer(channel: AndroidBluetoothVoiceChannel) {
        // Routing tests do not load Android's independently verified native resampler.
        ReflectionHelpers.setField(channel, "mixer", BluetoothVoiceMixer(createResampler = { _, _ -> object : PcmResampler {
            override fun convert(input: ShortArray) = input.copyOf()
            override fun close() = Unit
        } }))
    }

    private fun proveNonzeroPlayback(channel: AndroidBluetoothVoiceChannel) {
        val before = BluetoothPlaybackTrackShadow.nonzeroSamples.get()
        val pcm = ByteArray(1920) { if (it % 2 == 0) 1 else 0 }
        channel.play(AudioStreamId(100, "telephony"), 48000, 1, pcm)
        awaitBluetoothPlayback { BluetoothPlaybackTrackShadow.nonzeroSamples.get() > before }
    }

    private fun close(channel: AndroidBluetoothVoiceChannel, states: List<BluetoothVoiceState>) {
        channel.close()
        awaitBluetoothPlayback { states.lastOrNull()?.released == true }
    }
}

/** Normal route selection and real channel worker; only platform audio I/O is simulated. */
@Implements(AudioTrack::class)
class BluetoothPlaybackTrackShadow : ShadowAudioTrack() {
    @RealObject private lateinit var realTrack: AudioTrack
    var preferred: AudioDeviceInfo? = null
        private set
    private var playing = false
    private var written = 0
    @Implementation fun setPreferredDevice(device: AudioDeviceInfo?): Boolean { preferred = device; return true }
    @Implementation override fun getRoutedDevice(): AudioDeviceInfo = preferred ?:
        AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER).build()
    @Implementation override fun play() { playing = true; tracks.add(realTrack) }
    @Implementation fun stop() { playing = false }
    @Implementation fun getPlayState() = if (playing) AudioTrack.PLAYSTATE_PLAYING else AudioTrack.PLAYSTATE_STOPPED
    @Implementation override fun getPlaybackHeadPosition() = written
    @Implementation fun write(samples: ShortArray, offset: Int, size: Int, mode: Int): Int {
        Thread.sleep(5) // Model the blocking hardware writer instead of spinning in a JVM test.
        if (!playing) return AudioTrack.ERROR_INVALID_OPERATION
        if (preferred?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO && failNextScoWrite.compareAndSet(true, false))
            throw IllegalStateException("Injected SCO playback failure")
        nonzeroSamples.addAndGet((offset until offset + size).count { samples[it].toInt() != 0 }.toLong())
        written += size
        return size
    }
    companion object {
        val tracks = CopyOnWriteArrayList<AudioTrack>()
        val nonzeroSamples = AtomicLong()
        val failNextScoWrite = AtomicBoolean()
        fun reset() { tracks.clear(); nonzeroSamples.set(0); failNextScoWrite.set(false) }
    }
}

/** Deliberately rejects capture initialization, so playback cannot accidentally depend on it. */
@Implements(AudioRecord.Builder::class)
class BluetoothPlaybackRecordShadow {
    @Implementation fun build(): AudioRecord {
        builds.incrementAndGet()
        throw SecurityException("Injected microphone initialization denial")
    }
    companion object {
        val builds = AtomicInteger()
        fun reset() { builds.set(0) }
    }
}

/** AOSP cancels this app's binder client, not another application's globally current route. */
@Implements(AudioManager::class)
class PendingCommunicationAudioManagerShadow : ShadowAudioManager() {
    @Volatile var externalDevice: AudioDeviceInfo? = null
    @Volatile var pendingClientRequest: AudioDeviceInfo? = null
        private set
    val clearClientCalls = AtomicInteger()
    @Implementation override fun setCommunicationDevice(device: AudioDeviceInfo): Boolean {
        pendingClientRequest = device
        return true
    }
    @Implementation override fun getCommunicationDevice(): AudioDeviceInfo? = externalDevice
    @Implementation override fun clearCommunicationDevice() {
        pendingClientRequest = null
        clearClientCalls.incrementAndGet()
    }
}

/** A successful device cancellation does not imply the separate mode-client cancellation succeeded. */
@Implements(AudioManager::class)
class ModeResetFailureAudioManagerShadow : ShadowAudioManager() {
    val modeResetFailures = AtomicInteger()
    val modeResetCalls = AtomicInteger()
    val clearClientCalls = AtomicInteger()
    val clearClientFailures = AtomicInteger()
    @Volatile var externalDevice: AudioDeviceInfo? = null
    @Implementation override fun setMode(mode: Int) {
        if (mode == AudioManager.MODE_NORMAL) {
            modeResetCalls.incrementAndGet()
            if (modeResetFailures.getAndUpdate { (it - 1).coerceAtLeast(0) } > 0)
                throw IllegalStateException("Injected mode-client cancellation failure")
        }
        super.setMode(mode)
    }
    @Implementation override fun clearCommunicationDevice() {
        clearClientCalls.incrementAndGet()
        if (clearClientFailures.getAndUpdate { (it - 1).coerceAtLeast(0) } > 0)
            throw IllegalStateException("Injected device-client cancellation failure")
        super.clearCommunicationDevice()
    }
    @Implementation override fun getCommunicationDevice(): AudioDeviceInfo? = externalDevice ?: super.getCommunicationDevice()
}

internal fun awaitBluetoothPlayback(condition: () -> Boolean) {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
    while (System.nanoTime() < deadline) {
        shadowOf(Looper.getMainLooper()).idle()
        if (condition()) return
        Thread.sleep(5)
    }
    assertTrue("Bluetooth playback state did not settle", condition())
}
