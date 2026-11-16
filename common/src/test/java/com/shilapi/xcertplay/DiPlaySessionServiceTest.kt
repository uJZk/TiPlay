package com.shilapi.xcertplay

import android.Manifest
import android.content.Intent
import android.content.pm.ServiceInfo
import android.view.Surface
import com.shilapi.xcertplay.media.AndroidMediaSink
import com.shilapi.xcertplay.orchestration.CarPlayController
import com.shilapi.xcertplay.orchestration.CarPlayRunMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.mock
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DiPlaySessionServiceTest {
    @Test fun phoneBrowserArmsBackgroundMicrophoneRegardlessOfOldIphoneBluetoothChoice() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
        AirPlayPersistence.saveRunMode(app, CarPlayRunMode.PHONE_BROWSER)
        for ((mode, microphone) in listOf(
            CarBluetoothAudio.OFF to true,
            CarBluetoothAudio.ON to true,
            CarBluetoothAudio.ALTERNATIVE to true,
        )) {
            CarBluetoothAudio.save(app, mode)
            assertEquals(mode.name, microphone, startedWithMicrophone())
        }
    }

    @Test fun disabledCarPlayAudioOrDeniedPermissionDoesNotArmBackgroundRecording() {
        val app = RuntimeEnvironment.getApplication()
        AirPlayPersistence.saveRunMode(app, CarPlayRunMode.PHONE_BROWSER)
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
        BrowserCarPlayAudioSettings.saveDisabled(app, true)
        assertEquals(false, startedWithMicrophone())
        BrowserCarPlayAudioSettings.saveDisabled(app, false)
        shadowOf(app).denyPermissions(Manifest.permission.RECORD_AUDIO)
        assertEquals(false, startedWithMicrophone())
    }

    // Car Bluetooth sound applies only in phone + browser mode: a head unit keeps its microphone, whatever was saved.
    @Test fun headUnitModeKeepsTheMicrophoneWhateverCarBluetoothSoundWasSaved() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
        useHeadUnitMode(app)
        for (mode in CarBluetoothAudio.entries) {
            CarBluetoothAudio.save(app, mode)
            assertTrue(mode.name, startedWithMicrophone())
        }
    }

    // A running head-unit session keeps its microphone after phone + browser mode is saved for the next connection.
    @Test fun aRunningHeadUnitSessionKeepsTheMicrophone() {
        val app = RuntimeEnvironment.getApplication()
        shadowOf(app).grantPermissions(Manifest.permission.RECORD_AUDIO)
        AirPlayPersistence.saveRunMode(app, CarPlayRunMode.PHONE_BROWSER)
        CarBluetoothAudio.save(app, CarBluetoothAudio.ON)
        CarPlayBackgroundSession.store(mock(CarPlayController::class.java), mock(AndroidMediaSink::class.java), 800, 480,
            Any(), CarPlaySessionDisplay(800, 480, Surface.ROTATION_0, false, false, 800, 480)) { it() }
        try {
            assertTrue(startedWithMicrophone())
        } finally {
            CarPlayBackgroundSession.clear()
        }
    }

    private fun startedWithMicrophone(): Boolean {
        val controller = Robolectric.buildService(DiPlaySessionService::class.java, Intent()).create().startCommand(0, 1)
        try {
            val types = controller.get().foregroundServiceType
            assertTrue(types and ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE != 0)
            return types and ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE != 0
        } finally {
            controller.destroy()
        }
    }
}
