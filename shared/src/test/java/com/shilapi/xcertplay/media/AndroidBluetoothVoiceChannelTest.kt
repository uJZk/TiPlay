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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class AndroidBluetoothVoiceChannelTest {
    private fun config() = MicrophoneConfig("telephony", 16000, 1, 97, 20, InetAddress.getLoopbackAddress(), 12345, ByteArray(32))
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
