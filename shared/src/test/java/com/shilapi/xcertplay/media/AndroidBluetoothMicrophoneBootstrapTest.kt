package com.shilapi.xcertplay.media

import android.Manifest
import android.bluetooth.BluetoothHeadset
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.AudioRecordingConfiguration
import android.os.Looper
import com.shilapi.xcertplay.airplay.AudioStreamId
import com.shilapi.xcertplay.airplay.MicrophoneConfig
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.SocketTimeoutException
import java.time.Duration
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.ArgumentMatchers.*
import org.mockito.Mockito.*
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
import org.robolectric.shadows.ShadowSystemClock
import org.robolectric.util.ReflectionHelpers

/** Real channel workers/packetizer, with explicitly simulated platform Bluetooth and audio I/O. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE, shadows = [BootstrapAudioManagerShadow::class,
    BootstrapTrackShadow::class, BootstrapRecordBuilderShadow::class])
@LooperMode(LooperMode.Mode.PAUSED)
class AndroidBluetoothMicrophoneBootstrapTest {
    @Before fun reset() {
        BluetoothPlaybackTrackShadow.reset()
        BootstrapTrackShadow.missing.set(false); BootstrapTrackShadow.missingReads.set(0)
        BootstrapTrackShadow.defaultRoute = null
        BootstrapRecordBuilderShadow.factory = { error("fixture not installed") }
    }

    private fun device(type: Int, address: String, id: Int, input: Boolean = false): AudioDeviceInfo {
        val value = AudioDeviceInfoBuilder.newBuilder().setType(type).build()
        val port: Any = ReflectionHelpers.getField(value, "mPort")
        ReflectionHelpers.setField(port, "mAddress", address)
        ReflectionHelpers.setField(port, "mRole", if (input) 1 else 2)
        val handle: Any = ReflectionHelpers.getField(port, "mHandle")
        ReflectionHelpers.setField(handle, "mId", id)
        return value
    }

    private class Recording {
        val reads = AtomicInteger()
        val starts = AtomicInteger()
        val stops = AtomicInteger()
        val releases = AtomicInteger()
        val active = AtomicBoolean()
    }

    private inner class Fixture(connected: Int = 1, scoAddress: String = "02:00:00:00:00:00",
        inputAddress: String? = "AA:BB:CC:DD:EE:01") : AutoCloseable {
        val app = RuntimeEnvironment.getApplication()
        private val trackStart = BluetoothPlaybackTrackShadow.tracks.size
        private var observedTrack: AudioTrack? = null
        val address = "AA:BB:CC:DD:EE:01"
        @Volatile var selection: String? = address
        @Volatile var connectedCount = connected
        val manager = app.getSystemService(AudioManager::class.java)
        val audio = shadowOf(manager) as BootstrapAudioManagerShadow
        val media = device(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, address, 302)
        val sco = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, scoAddress, 202)
        val input = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, inputAddress ?: "", 301, true)
        val headset = mock(BluetoothHeadset::class.java)
        val states = CopyOnWriteArrayList<BluetoothVoiceState>()
        val logs = CopyOnWriteArrayList<String>()
        val reads = AtomicInteger()
        val starts = AtomicInteger()
        val releases = AtomicInteger()
        val records = CopyOnWriteArrayList<Recording>()
        val stopFailures = AtomicInteger()
        val releaseFailures = AtomicInteger()
        val maxActiveRecords = AtomicInteger()
        val received = DatagramSocket(0, InetAddress.getLoopbackAddress()).also { it.soTimeout = 300 }
        @Volatile var routed: AudioDeviceInfo? = input
        @Volatile var silenced = false
        @Volatile var zeroSamples = false
        var afterRead: (() -> Unit)? = null
        var afterConvert: (() -> Unit)? = null
        var onStartRecord: ((Int) -> Unit)? = null
        var onRoutedDevice: ((Int) -> Unit)? = null
        var recordRoute: ((Int) -> AudioDeviceInfo?)? = null
        @Volatile var audioConnected: Boolean? = null
        var onAudioQuery: (() -> Unit)? = null
        val config = MicrophoneConfig("speechrecognition", 16000, 1, 97, 20,
            InetAddress.getLoopbackAddress(), received.localPort, ByteArray(32))
        val channel: AndroidBluetoothVoiceChannel
        init {
            shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.BLUETOOTH_CONNECT)
            val adapter = app.getSystemService(BluetoothManager::class.java).adapter
            val bluetooth = shadowOf(adapter)
            bluetooth.setEnabled(true)
            val car = adapter.getRemoteDevice(address)
            val other = adapter.getRemoteDevice("AA:BB:CC:DD:EE:02")
            `when`(headset.connectedDevices).thenAnswer { when (connectedCount) { 0 -> emptyList(); 1 -> listOf(car); else -> listOf(car, other) } }
            `when`(headset.getConnectionState(car)).thenReturn(BluetoothProfile.STATE_CONNECTED)
            `when`(headset.isAudioConnected(car)).thenAnswer {
                val value = audioConnected ?: (manager.communicationDevice?.id == sco.id)
                onAudioQuery?.invoke(); value
            }
            bluetooth.setProfileProxy(BluetoothProfile.HEADSET, headset)
            audio.setAvailableCommunicationDevices(listOf(sco))
            audio.setOutputDevices(listOf(media))
            audio.setInputDevices(emptyList())
            audio.onRequest = { if (inputAddress != null) audio.setInputDevices(listOf(input)) }
            BootstrapRecordBuilderShadow.factory = {
                val record = mock(AudioRecord::class.java)
                val observation = Recording()
                val index = records.size
                records += observation
                val configuration = mock(AudioRecordingConfiguration::class.java)
                `when`(configuration.isClientSilenced).thenAnswer { silenced }
                `when`(record.activeRecordingConfiguration).thenReturn(configuration)
                `when`(record.state).thenReturn(AudioRecord.STATE_INITIALIZED)
                `when`(record.setPreferredDevice(any(AudioDeviceInfo::class.java))).thenAnswer {
                    val preferred = it.getArgument<AudioDeviceInfo>(0)
                    assertTrue(preferred.isSource); assertTrue(preferred.id > 0)
                    preferred.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                }
                `when`(record.routedDevice).thenAnswer {
                    val value = recordRoute?.let { it(index) } ?: if (recordRoute == null) routed else null
                    onRoutedDevice?.invoke(index)
                    value
                }
                doAnswer {
                    starts.incrementAndGet(); observation.starts.incrementAndGet(); observation.active.set(true)
                    maxActiveRecords.getAndUpdate { maxOf(it, records.count { r -> r.active.get() }) }
                    onStartRecord?.invoke(index); null
                }.`when`(record).startRecording()
                `when`(record.read(any(ShortArray::class.java), anyInt(), anyInt(), eq(AudioRecord.READ_NON_BLOCKING))).thenAnswer {
                    val samples = it.getArgument<ShortArray>(0)
                    val offset = it.getArgument<Int>(1); val count = it.getArgument<Int>(2)
                    Thread.sleep(5)
                    java.util.Arrays.fill(samples, offset, offset + count, if (zeroSamples) 0.toShort() else 321.toShort())
                    reads.incrementAndGet(); observation.reads.incrementAndGet(); afterRead?.invoke(); count
                }
                doAnswer {
                    observation.stops.incrementAndGet()
                    if (stopFailures.getAndUpdate { (it - 1).coerceAtLeast(0) } > 0) error("controlled record stop failure")
                    observation.active.set(false); null
                }.`when`(record).stop()
                doAnswer {
                    if (releaseFailures.getAndUpdate { (it - 1).coerceAtLeast(0) } > 0) error("controlled record release failure")
                    releases.incrementAndGet(); observation.releases.incrementAndGet(); observation.active.set(false); null
                }.`when`(record).release()
                record
            }
            channel = AndroidBluetoothVoiceChannel(app, states::add, diagnostic = logs::add) { selection }
            channel.microphoneResampler = { _, _ -> object : PcmResampler {
                override fun convert(input: ShortArray): ShortArray { afterConvert?.invoke(); return input.copyOf() }
                override fun close() = Unit
            } }
            ReflectionHelpers.setField(channel, "mixer", BluetoothVoiceMixer(createResampler = { _, _ -> object : PcmResampler {
                override fun convert(input: ShortArray) = input.copyOf()
                override fun close() = Unit
            } }))
        }
        fun start() { channel.start(config); awaitBluetoothPlayback { states.lastOrNull()?.outputReady == true && audio.requests.get() > 0 } }
        fun awaitPacket(): ByteArray {
            awaitBluetoothPlayback { reads.get() > 0 || logs.any { "action=rollback" in it } }
            val packet = DatagramPacket(ByteArray(2048), 2048); received.receive(packet)
            return packet.data.copyOf(packet.length)
        }
        fun noPacket() {
            try { received.receive(DatagramPacket(ByteArray(2048), 2048)); fail("Unverified microphone block was forwarded") }
            catch (_: SocketTimeoutException) { }
        }
        fun advanceCaptureRetry() {
            // The worker sets nextCaptureAt before publishing this existing retry event.
            // Java Thread.sleep in awaitBluetoothPlayback does not advance Robolectric's clock.
            awaitBluetoothPlayback { logs.any { "stage=microphone-retry delayMs=2000" in it } }
            shadowOf(Looper.getMainLooper()).idleFor(2100, TimeUnit.MILLISECONDS)
        }
        fun proveOutput() {
            val before = BluetoothPlaybackTrackShadow.nonzeroSamples.get()
            channel.play(AudioStreamId(100, "telephony"), 48000, 1, ByteArray(1920) { if (it % 2 == 0) 1 else 0 })
            awaitBluetoothPlayback { BluetoothPlaybackTrackShadow.nonzeroSamples.get() > before }
            val track = BluetoothPlaybackTrackShadow.tracks.drop(trackStart).single()
            if (observedTrack == null) observedTrack = track else assertSame(observedTrack, track)
        }
        override fun close() {
            audio.clearFailures.set(0); audio.modeFailures.set(0)
            channel.close(); awaitBluetoothPlayback { states.lastOrNull()?.released == true }
            received.close()
        }
    }

    @Test fun soleSelectedHeadsetBootstrapsExactInputAndSendsUplinkWithoutReplacingOutput() {
        Fixture().use { f ->
            f.start()
            val packet = f.awaitPacket()
            assertTrue(packet.size > 640); assertTrue(f.starts.get() > 0)
            assertTrue(f.logs.any { "action=input-associated" in it })
            assertEquals(f.sco.id, f.manager.communicationDevice?.id)
            f.proveOutput()
            f.channel.stop(); awaitBluetoothPlayback { f.states.lastOrNull()?.released == true }
            assertEquals(f.starts.get(), f.releases.get())
            assertEquals(1, f.audio.requests.get()); assertEquals(1, f.audio.clears.get())
            assertEquals(AudioManager.MODE_NORMAL, f.manager.mode)
        }
    }

    @Test fun acceptedRequestDoesNotOpenCaptureUntilTheCurrentScoInputIsAssociated() {
        Fixture().use { f ->
            f.audio.onRequest = {}
            `when`(f.headset.isAudioConnected(any())).thenReturn(false)
            f.start(); assertEquals(0, f.starts.get()); f.noPacket(); f.proveOutput()
            f.audio.setInputDevices(listOf(f.input))
            `when`(f.headset.isAudioConnected(any())).thenReturn(true)
            shadowOf(Looper.getMainLooper()).idleFor(110, TimeUnit.MILLISECONDS)
            assertTrue(f.awaitPacket().isNotEmpty()); f.proveOutput()
        }
    }

    @Test fun maskedOrMissingInputUsesTheSoleCarProfileAndActualScoPortWithoutReplacingOutput() {
        for (address in listOf("02:00:00:00:00:00", "")) Fixture(inputAddress = address).use { f ->
            f.start(); assertTrue(f.awaitPacket().isNotEmpty()); f.proveOutput()
            assertEquals(1, f.records.size)
            assertTrue(f.records.single().reads.get() > 0)
            assertEquals(1, f.maxActiveRecords.get())
        }
    }

    @Test fun absentOrAmbiguousHeadsetNeverRequestsOrBorrowsItsMicrophone() {
        for (count in listOf(0, 2)) Fixture(connected = count).use { f ->
            f.channel.start(f.config)
            awaitBluetoothPlayback { f.logs.any { "action=rollback" in it } }
            assertEquals(0, f.audio.requests.get()); assertEquals(0, f.starts.get()); f.proveOutput()
        }
    }

    @Test fun validDifferentScoAddressIsNotTreatedAsAMaskedAlias() {
        Fixture(scoAddress = "AA:BB:CC:DD:EE:02").use { f ->
            f.channel.start(f.config); awaitBluetoothPlayback { f.states.lastOrNull()?.outputReady == true }
            shadowOf(Looper.getMainLooper()).idleFor(9000, TimeUnit.MILLISECONDS)
            assertEquals(0, f.audio.requests.get()); assertEquals(0, f.starts.get()); f.proveOutput()
        }
    }

    @Test fun samePortBecomingMaskedDuringReadDropsTheWholeBlock() {
        Fixture().use { f ->
            f.afterRead = { f.routed = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "02:00:00:00:00:00", f.input.id, true) }
            f.start(); awaitBluetoothPlayback { f.reads.get() > 0 }
            f.noPacket(); f.proveOutput()
        }
    }

    @Test fun missingOrInvalidProductSelectionNeverBorrowsTheOnlyScoMicrophone() {
        for (selection in listOf(null, "", "not-a-device", "02:00:00:00:00:00")) Fixture().use { f ->
            f.selection = selection
            f.channel.start(f.config)
            awaitBluetoothPlayback { f.states.lastOrNull()?.outputReady == true }
            shadowOf(Looper.getMainLooper()).idleFor(31000, TimeUnit.MILLISECONDS)
            assertEquals(0, f.starts.get()); f.noPacket(); f.proveOutput()
        }
    }

    @Test fun changingSelectionDuringAReadDropsThePendingBlock() {
        for (selection in listOf(null, "AA:BB:CC:DD:EE:02")) Fixture().use { f ->
            f.afterRead = { f.selection = selection }
            f.start(); awaitBluetoothPlayback { f.reads.get() > 0 }
            f.noPacket()
        }
    }

    @Test fun demandRevocationDuringConversionWaitsForCaptureAckBeforeWithdrawingRoute() {
        Fixture().use { f ->
            val entered = CountDownLatch(1); val leave = CountDownLatch(1)
            f.afterConvert = { entered.countDown(); check(leave.await(2, TimeUnit.SECONDS)) }
            f.start(); awaitBluetoothPlayback { entered.count == 0L }
            val probe = ReflectionHelpers.getField<Any>(f.channel, "microphoneProbe")
            f.channel.stop(); shadowOf(Looper.getMainLooper()).idle()
            assertEquals(0, f.audio.clears.get()); assertEquals(0, f.releases.get())
            assertSame(f.headset, ReflectionHelpers.getField<Any>(probe, "headset"))
            leave.countDown()
            awaitBluetoothPlayback { f.states.lastOrNull()?.released == true }
            assertTrue(f.releases.get() > 0); assertEquals(1, f.audio.clears.get()); f.noPacket()
            assertNull(ReflectionHelpers.getField<Any?>(probe, "headset"))
        }
    }

    @Test fun explicitSilencingFailsMicButKeepsOutputAndSilenceSamplesAreStillValid() {
        Fixture().use { f ->
            f.silenced = true; f.start()
            awaitBluetoothPlayback { f.logs.any { "bluetooth-microphone-silenced" in it } }
            f.noPacket(); f.proveOutput()
        }
        Fixture().use { f -> f.zeroSamples = true; f.start(); assertTrue(f.awaitPacket().isNotEmpty()); f.proveOutput() }
    }

    @Test fun nativeResamplerLinkageFailureIsOnlyAMicrophoneFailure() {
        Fixture().use { f ->
            f.channel.microphoneResampler = { _, _ -> throw UnsatisfiedLinkError("synthetic controlled linkage error") }
            f.start(); awaitBluetoothPlayback { f.logs.any { "exception=UnsatisfiedLinkError" in it } }
            f.noPacket(); f.proveOutput()
        }
    }

    @Test fun foregroundRecorderDenialDoesNotRetireWorkingOutput() {
        Fixture().use { f ->
            BootstrapRecordBuilderShadow.factory = { throw SecurityException("controlled foreground recorder denial") }
            f.start(); awaitBluetoothPlayback { f.logs.any { "microphone-permission-denied" in it } }
            f.noPacket(); f.proveOutput()
        }
    }

    @Test fun platformReplacingMaskedSinkWithExactCarPortDoesNotReplaceTheTrack() {
        Fixture().use { f ->
            val exactSink = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, f.address, 402)
            `when`(f.headset.isAudioConnected(any())).thenAnswer { f.manager.communicationDevice?.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO }
            f.audio.onRequest = {
                f.audio.setAvailableCommunicationDevices(listOf(exactSink))
                f.audio.currentOverride = exactSink
                f.audio.addOutputDevice(exactSink, true)
                f.audio.setInputDevices(listOf(f.input))
            }
            f.start()
            shadowOf(Looper.getMainLooper()).idleFor(110, TimeUnit.MILLISECONDS)
            assertTrue(f.awaitPacket().isNotEmpty())
            assertEquals(exactSink.id, f.manager.communicationDevice?.id)
            assertEquals(1, f.audio.requests.get()) // The broker supplies the active port; no extra app request.
            assertFalse(f.logs.any { "stage=output-upgrade" in it })
            f.proveOutput()
        }
    }

    @Test fun shortMissingRouteAfterLongPlaybackDoesNotFailTheOutputWorker() {
        Fixture(inputAddress = null).use { f ->
            f.start(); shadowOf(Looper.getMainLooper()).idleFor(3000, TimeUnit.MILLISECONDS)
            val track = BluetoothPlaybackTrackShadow.tracks.single()
            BootstrapTrackShadow.missing.set(true)
            awaitBluetoothPlayback { BootstrapTrackShadow.missingReads.get() > 0 }
            shadowOf(Looper.getMainLooper()).idleFor(100, TimeUnit.MILLISECONDS)
            BootstrapTrackShadow.missing.set(false)
            f.proveOutput()
            assertSame(track, BluetoothPlaybackTrackShadow.tracks.single())
            assertFalse(f.logs.any { "operation=output-write" in it })
        }
    }

    @Test fun failedProbeCleanupKeepsOwnershipAndBlocksASecondRequest() {
        Fixture(inputAddress = null).use { f ->
            f.start(); f.audio.clearFailures.set(100)
            shadowOf(Looper.getMainLooper()).idleFor(8100, TimeUnit.MILLISECONDS)
            awaitBluetoothPlayback { f.audio.clears.get() >= 1 }
            shadowOf(Looper.getMainLooper()).idleFor(3100, TimeUnit.MILLISECONDS)
            assertEquals(3, f.audio.clears.get()); assertEquals(1, f.audio.modeResets.get())
            assertEquals(1, f.audio.requests.get()); assertFalse(f.states.last().released)
            f.proveOutput()
        }
    }

    @Test fun failedProbeModeCleanupDoesNotRepeatTheAlreadyWithdrawnDeviceRequest() {
        Fixture(inputAddress = null).use { f ->
            f.start(); f.audio.modeFailures.set(100)
            shadowOf(Looper.getMainLooper()).idleFor(8100, TimeUnit.MILLISECONDS)
            awaitBluetoothPlayback { f.audio.modeResets.get() >= 1 }
            shadowOf(Looper.getMainLooper()).idleFor(3100, TimeUnit.MILLISECONDS)
            assertEquals(3, f.audio.modeResets.get()); assertEquals(1, f.audio.clears.get())
            assertEquals(1, f.audio.requests.get()); assertFalse(f.states.last().released); f.proveOutput()
        }
    }

    @Test fun captureRouteRequiresPositivePortAndFreshExactIdentity() {
        assertTrue(verifiedMicrophoneRoute(301, 301, 7, "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:01"))
        for (port in listOf(0, -1)) assertFalse(verifiedMicrophoneRoute(port, port, 7, "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:01"))
        assertFalse(verifiedMicrophoneRoute(301, 302, 7, "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:01"))
        assertFalse(verifiedMicrophoneRoute(301, 301, 15, "AA:BB:CC:DD:EE:01", "AA:BB:CC:DD:EE:01"))
        assertFalse(verifiedMicrophoneRoute(301, 301, 7, "02:00:00:00:00:00", "AA:BB:CC:DD:EE:01"))
    }

    @Test fun aRecordThatActivatesHfpIsUnreadAndReplacedBeforeAnyUplink() {
        Fixture(inputAddress = "02:00:00:00:00:00").use { f ->
            f.audioConnected = false
            f.onStartRecord = { if (it == 0) f.audioConnected = true }
            f.start(); assertTrue(f.awaitPacket().isNotEmpty())
            assertEquals(2, f.records.size)
            assertEquals(0, f.records[0].reads.get()); assertEquals(1, f.records[0].releases.get())
            assertTrue(f.records[1].reads.get() > 0); assertEquals(1, f.maxActiveRecords.get())
            f.proveOutput()
        }
    }

    @Test fun aNeverConnectedGenericWarmupTimesOutWithoutReadingOrReplacingOutput() {
        Fixture(inputAddress = "").use { f ->
            f.audioConnected = false; f.start()
            awaitBluetoothPlayback { f.starts.get() == 1 }
            assertEquals(0, f.reads.get()); f.noPacket()
            shadowOf(Looper.getMainLooper()).idleFor(8100, TimeUnit.MILLISECONDS)
            awaitBluetoothPlayback { f.audio.clears.get() == 1 && f.releases.get() == 1 }
            assertEquals(1, f.records.size); assertEquals(0, f.reads.get())
            assertFalse(f.logs.any { "stage=duplex-ready" in it }); f.proveOutput()
        }
    }

    @Test fun losingHfpWhenTheFreshRecordStartsNeverReentersWarmupOrReads() {
        Fixture(inputAddress = "02:00:00:00:00:00").use { f ->
            f.audioConnected = false
            f.onStartRecord = { f.audioConnected = it == 0 }
            f.start(); awaitBluetoothPlayback { f.records.size == 2 && f.audio.clears.get() == 1 }
            assertEquals(0, f.reads.get()); f.noPacket(); f.proveOutput()
            assertEquals(2, f.records.size); assertEquals(1, f.maxActiveRecords.get())
        }
    }

    @Test fun failedWarmupStopAndReleaseNeverCreateASecondActiveRecorder() {
        Fixture(inputAddress = "").use { f ->
            f.audioConnected = false; f.onStartRecord = { f.audioConnected = true }
            f.stopFailures.set(1); f.releaseFailures.set(1)
            f.start(); awaitBluetoothPlayback { f.logs.any { "stage=worker-failure" in it } && f.releases.get() == 1 }
            assertEquals(1, f.records.size); assertEquals(0, f.reads.get())
            assertTrue(f.records.single().stops.get() >= 2)
            assertEquals(1, f.maxActiveRecords.get()); f.noPacket(); f.proveOutput()
        }
    }

    @Test fun exactSourceAndRecordingAddressesDoNotRequireAnExtraHfpAudioFlag() {
        Fixture().use { f ->
            f.audioConnected = false; f.start(); assertTrue(f.awaitPacket().isNotEmpty())
            assertEquals(1, f.records.size); f.proveOutput()
        }
    }

    @Test fun initiallyUnknownOrHandsetRecordingRoutesAreClosedWithoutReadingTheirBuffers() {
        for (first in listOf<AudioDeviceInfo?>(null, device(AudioDeviceInfo.TYPE_BUILTIN_MIC, "", 901, true))) {
            Fixture(inputAddress = "").use { f ->
                f.recordRoute = { if (it == 0) first else f.input }
                f.start(); awaitBluetoothPlayback { f.records.firstOrNull()?.releases?.get() == 1 }
                assertEquals(0, f.records[0].reads.get()); f.noPacket()
                f.advanceCaptureRetry()
                assertTrue(f.awaitPacket().isNotEmpty())
                assertTrue(f.records.size >= 2); assertTrue(f.records[1].reads.get() > 0)
                assertEquals(1, f.maxActiveRecords.get()); f.proveOutput()
            }
        }
    }

    @Test fun invalidOtherOrNonpositiveSourceIdentityNeverOpensARecorder() {
        for (address in listOf("AA:BB:CC:DD:EE:02", "invalid-address")) Fixture(inputAddress = address).use { f ->
            f.start(); shadowOf(Looper.getMainLooper()).idleFor(8100, TimeUnit.MILLISECONDS)
            assertEquals(0, f.starts.get()); f.noPacket(); f.proveOutput()
        }
        Fixture().use { f ->
            f.audio.onRequest = { f.audio.setInputDevices(listOf(device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "", 0, true))) }
            f.start(); shadowOf(Looper.getMainLooper()).idleFor(8100, TimeUnit.MILLISECONDS)
            assertEquals(0, f.starts.get()); f.noPacket(); f.proveOutput()
        }
    }

    @Test fun multipleScoSourcesCannotUseTheMaskedAssociation() {
        Fixture(inputAddress = "").use { f ->
            f.audio.onRequest = { f.audio.setInputDevices(listOf(f.input,
                device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "", 305, true))) }
            f.start(); shadowOf(Looper.getMainLooper()).idleFor(8100, TimeUnit.MILLISECONDS)
            assertEquals(0, f.starts.get()); f.noPacket(); f.proveOutput()
        }
    }

    @Test fun brokerMayReplaceBothMaskedPortsWithCurrentMaskedPortsWithoutAnotherRequest() {
        Fixture(inputAddress = "").use { f ->
            val nextSink = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "", 402)
            val nextInput = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "02:00:00:00:00:00", 401, true)
            f.audio.onRequest = {
                f.audioConnected = true
                f.audio.setAvailableCommunicationDevices(listOf(nextSink)); f.audio.currentOverride = nextSink
                f.audio.setInputDevices(listOf(nextInput)); f.routed = nextInput
            }
            f.start(); assertTrue(f.awaitPacket().isNotEmpty())
            assertNotEquals(nextSink.id, nextInput.id); assertEquals(1, f.audio.requests.get()); f.proveOutput()
        }
    }

    @Test fun anActivePortHandoffRetiresTheOldRecorderBeforeFreshCapture() {
        Fixture(inputAddress = "").use { f ->
            f.start(); f.awaitPacket(); awaitBluetoothPlayback { f.logs.any { "stage=duplex-ready" in it } }
            val changed = AtomicBoolean()
            f.audioConnected = true
            f.afterRead = {
                if (changed.compareAndSet(false, true)) {
                    val sink = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "", 402)
                    val source = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "", 401, true)
                    f.audio.setAvailableCommunicationDevices(listOf(sink)); f.audio.currentOverride = sink
                    f.audio.setInputDevices(listOf(source)); f.routed = source
                }
            }
            awaitBluetoothPlayback { f.records[0].releases.get() == 1 }
            f.advanceCaptureRetry()
            awaitBluetoothPlayback { f.records.size >= 2 && f.records[1].reads.get() > 0 }
            assertEquals(1, f.records[0].releases.get()); assertEquals(1, f.maxActiveRecords.get())
            assertEquals(1, f.audio.requests.get()); f.proveOutput()
        }
    }

    @Test fun genericAudioLossDuringAReadDropsTheBlockAndDoesNotWarmUpAgain() {
        Fixture(inputAddress = "").use { f ->
            f.afterRead = { f.audioConnected = false }
            f.start(); awaitBluetoothPlayback { f.reads.get() > 0 && f.audio.clears.get() == 1 }
            f.noPacket(); assertEquals(1, f.records.size); f.proveOutput()
        }
    }

    @Test fun profileLossDuringConversionDropsTheBlock() {
        Fixture(inputAddress = "").use { f ->
            f.afterConvert = { f.connectedCount = 0 }
            f.start(); awaitBluetoothPlayback { f.reads.get() > 0 }
            f.noPacket(); f.proveOutput()
        }
    }

    @Test fun revocationInsideTheRecordingRouteGetterPreventsEvenTheFirstRead() {
        for (permission in listOf(false, true)) Fixture().use { f ->
            f.onRoutedDevice = {
                if (permission) shadowOf(f.app).denyPermissions(Manifest.permission.RECORD_AUDIO)
                else ReflectionHelpers.setField(f.channel, "focusGranted", false)
            }
            f.start(); awaitBluetoothPlayback { f.starts.get() > 0 }
            assertEquals(0, f.reads.get()); f.noPacket()
        }
    }

    @Test fun rapidDemandWaitsForUnownedScoToDisappearWithoutClearingItOrReplacingPlayback() {
        Fixture(inputAddress = "").use { f ->
            f.audio.currentOverride = f.sco; BootstrapTrackShadow.defaultRoute = f.media
            f.channel.start(f.config); awaitBluetoothPlayback { f.states.lastOrNull()?.outputReady == true }
            assertEquals(0, f.audio.requests.get()); assertEquals(0, f.audio.clears.get())
            f.proveOutput(); f.audio.currentOverride = null
            shadowOf(Looper.getMainLooper()).idleFor(110, TimeUnit.MILLISECONDS)
            assertTrue(f.awaitPacket().isNotEmpty()); assertEquals(1, f.audio.requests.get())
            f.proveOutput()
        }
    }

    @Test fun permanentUnownedScoWaitExpiresWithoutCancellingAnotherClient() {
        Fixture(inputAddress = "").use { f ->
            f.audio.currentOverride = f.sco; BootstrapTrackShadow.defaultRoute = f.media
            f.channel.start(f.config); awaitBluetoothPlayback { f.states.lastOrNull()?.outputReady == true }
            shadowOf(Looper.getMainLooper()).idleFor(9000, TimeUnit.MILLISECONDS)
            assertEquals(0, f.audio.requests.get()); assertEquals(0, f.audio.clears.get())
            assertEquals(0, f.starts.get()); f.noPacket(); f.proveOutput()
        }
    }

    @Test fun startupPortChurnCannotRenewTheWarmupDeadline() {
        Fixture(inputAddress = "").use { f ->
            f.audioConnected = false; f.start(); awaitBluetoothPlayback { f.starts.get() > 0 }
            repeat(7) { index ->
                val sink = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "", 500 + index)
                val source = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "", 600 + index, true)
                f.audio.setAvailableCommunicationDevices(listOf(sink)); f.audio.currentOverride = sink
                f.audio.setInputDevices(listOf(source)); f.routed = source
                shadowOf(Looper.getMainLooper()).idleFor(1000, TimeUnit.MILLISECONDS)
            }
            shadowOf(Looper.getMainLooper()).idleFor(1200, TimeUnit.MILLISECONDS)
            awaitBluetoothPlayback { f.audio.clears.get() == 1 }
            assertEquals(0, f.reads.get()); f.noPacket(); f.proveOutput()
        }
    }

    @Test fun genericProofRejectsAnActualRecorderWithAnotherValidBluetoothAddressBeforeReading() {
        Fixture(inputAddress = "").use { f ->
            f.routed = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "AA:BB:CC:DD:EE:02", f.input.id, true)
            f.start(); awaitBluetoothPlayback { f.releases.get() == 1 }
            assertEquals(1, f.starts.get()); assertEquals(0, f.reads.get())
            f.noPacket(); f.proveOutput()
        }
    }

    @Test fun genericProofRejectsAnActualRecorderOnAnotherPositiveScoPortBeforeReading() {
        Fixture(inputAddress = "").use { f ->
            f.routed = device(AudioDeviceInfo.TYPE_BLUETOOTH_SCO, "", 999, true)
            f.start(); awaitBluetoothPlayback { f.releases.get() == 1 }
            assertEquals(1, f.starts.get()); assertEquals(0, f.reads.get())
            f.noPacket(); f.proveOutput()
        }
    }

    @Test fun anAudioStateIpcCrossingTheStartupDeadlineCannotBeginTheFirstRead() {
        Fixture(inputAddress = "").use { f ->
            val senderPrepared = AtomicBoolean()
            val entered = CountDownLatch(1); val leave = CountDownLatch(1)
            f.channel.microphoneResampler = { _, _ ->
                senderPrepared.set(true)
                object : PcmResampler {
                    override fun convert(input: ShortArray) = input.copyOf()
                    override fun close() = Unit
                }
            }
            f.onAudioQuery = {
                if (senderPrepared.get() && entered.count != 0L) {
                    entered.countDown(); check(leave.await(2, TimeUnit.SECONDS))
                    ShadowSystemClock.advanceBy(Duration.ofMillis(8100))
                }
            }
            f.start(); assertTrue(entered.await(2, TimeUnit.SECONDS)); leave.countDown()
            // Do not run the main timeout callback: the capture worker must reject
            // the late IPC result itself, before its first AudioRecord.read.
            val limit = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
            while (f.releases.get() == 0 && System.nanoTime() < limit) Thread.sleep(5)
            assertEquals(1, f.releases.get()); assertEquals(0, f.reads.get())
            assertFalse(f.logs.any { "stage=duplex-ready" in it }); f.noPacket()
        }
    }
}

@Implements(AudioRecord.Builder::class)
class BootstrapRecordBuilderShadow {
    @Implementation fun build(): AudioRecord = factory()
    companion object { var factory: () -> AudioRecord = { error("fixture not installed") } }
}

@Implements(AudioTrack::class)
class BootstrapTrackShadow : ShadowAudioTrack() {
    @RealObject private lateinit var realTrack: AudioTrack
    private var preferred: AudioDeviceInfo? = null
    @Volatile private var playing = false
    private var written = 0
    @Implementation fun setPreferredDevice(device: AudioDeviceInfo?): Boolean { preferred = device; return true }
    @Implementation override fun getRoutedDevice(): AudioDeviceInfo? {
        if (missing.get()) { missingReads.incrementAndGet(); return null }
        return preferred ?: defaultRoute ?: AudioDeviceInfoBuilder.newBuilder().setType(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER).build()
    }
    @Implementation override fun play() { playing = true; BluetoothPlaybackTrackShadow.tracks.add(realTrack) }
    @Implementation fun stop() { playing = false }
    @Implementation fun getPlayState() = if (playing) AudioTrack.PLAYSTATE_PLAYING else AudioTrack.PLAYSTATE_STOPPED
    @Implementation override fun getPlaybackHeadPosition() = written
    @Implementation fun write(samples: ShortArray, offset: Int, size: Int, mode: Int): Int {
        Thread.sleep(5)
        if (!playing) return AudioTrack.ERROR_INVALID_OPERATION
        BluetoothPlaybackTrackShadow.nonzeroSamples.addAndGet((offset until offset + size).count { samples[it].toInt() != 0 }.toLong())
        written += size; return size
    }
    companion object {
        val missing = AtomicBoolean(); val missingReads = AtomicInteger()
        @Volatile var defaultRoute: AudioDeviceInfo? = null
    }
}

@Implements(AudioManager::class)
class BootstrapAudioManagerShadow : ShadowAudioManager() {
    val requests = AtomicInteger(); val clears = AtomicInteger(); val modeResets = AtomicInteger()
    val clearFailures = AtomicInteger(); val modeFailures = AtomicInteger()
    var onRequest: () -> Unit = {}
    @Volatile var currentOverride: AudioDeviceInfo? = null
    @Implementation override fun getCommunicationDevice(): AudioDeviceInfo? = currentOverride ?: super.getCommunicationDevice()
    @Implementation override fun setCommunicationDevice(device: AudioDeviceInfo): Boolean {
        requests.incrementAndGet(); val result = super.setCommunicationDevice(device); onRequest(); return result
    }
    @Implementation override fun clearCommunicationDevice() {
        clears.incrementAndGet()
        if (clearFailures.getAndUpdate { (it - 1).coerceAtLeast(0) } > 0) error("synthetic device cleanup failure")
        super.clearCommunicationDevice()
    }
    @Implementation override fun setMode(mode: Int) {
        if (mode == AudioManager.MODE_NORMAL) {
            modeResets.incrementAndGet()
            if (modeFailures.getAndUpdate { (it - 1).coerceAtLeast(0) } > 0) error("synthetic mode cleanup failure")
        }
        super.setMode(mode)
    }
}
