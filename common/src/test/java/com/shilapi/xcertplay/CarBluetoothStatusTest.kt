package com.shilapi.xcertplay

import android.bluetooth.BluetoothClass
import org.junit.Assert.*
import org.junit.Test

class CarBluetoothStatusTest {
    @Test fun onlyCompletedEmptyAudioProfileQueriesEstablishDisconnection() {
        assertEquals(CarBluetoothStatus.State.UNKNOWN, CarBluetoothStatus.evaluate(0, emptyList(), null))
        assertEquals(CarBluetoothStatus.State.UNKNOWN, CarBluetoothStatus.evaluate(1, emptyList(), null))
        assertEquals(CarBluetoothStatus.State.DISCONNECTED, CarBluetoothStatus.evaluate(2, emptyList(), null))
    }
    @Test fun iphoneAndUnidentifiedHeadphonesNeverProveCarConnection() {
        val car = CarBluetoothStatus.Device("aa:bb", BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO)
        assertEquals(CarBluetoothStatus.State.DISCONNECTED, CarBluetoothStatus.evaluate(2, listOf(car), "AA:BB"))
        assertEquals(CarBluetoothStatus.State.CONNECTED, CarBluetoothStatus.evaluate(2, listOf(car), "cc:dd"))
        assertEquals(CarBluetoothStatus.State.VERIFY_AUDIO_DEVICE,
            CarBluetoothStatus.evaluate(2, listOf(CarBluetoothStatus.Device("aa:bb", null)), null))
        assertEquals(CarBluetoothStatus.State.VERIFY_AUDIO_DEVICE,
            CarBluetoothStatus.evaluate(2, listOf(CarBluetoothStatus.Device("aa:bb", BluetoothClass.Device.AUDIO_VIDEO_HEADPHONES)), null))
    }
}
