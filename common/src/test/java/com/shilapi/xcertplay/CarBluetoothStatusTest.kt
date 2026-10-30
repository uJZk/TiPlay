package com.shilapi.xcertplay

import android.bluetooth.BluetoothClass
import org.junit.Assert.*
import org.junit.Test

class CarBluetoothStatusTest {
    @Test fun selectedDeviceStatusNeverConfusesAnotherConnectedAudioDevice() {
        assertEquals(CarBluetoothStatus.State.NOT_SELECTED, CarBluetoothStatus.evaluateSelected(null, 2, listOf("AA:BB")))
        assertEquals(CarBluetoothStatus.State.UNKNOWN, CarBluetoothStatus.evaluateSelected("AA:BB", 1, listOf("CC:DD")))
        assertEquals(CarBluetoothStatus.State.DISCONNECTED, CarBluetoothStatus.evaluateSelected("AA:BB", 2, listOf("CC:DD")))
        assertEquals(CarBluetoothStatus.State.CONNECTED, CarBluetoothStatus.evaluateSelected("aa:bb", 1, listOf("AA:BB")))
        assertFalse(CarBluetoothStatus.routeMatches("AA:BB", listOf(null, "", "CC:DD")))
        assertTrue(CarBluetoothStatus.routeMatches("aa:bb", listOf("AA:BB")))
    }
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
