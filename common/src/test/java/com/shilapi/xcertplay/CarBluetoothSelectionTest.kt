package com.shilapi.xcertplay

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.companion.CompanionDeviceManager
import com.shilapi.xcertplay.host.R
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class CarBluetoothSelectionTest {
    private lateinit var controller: org.robolectric.android.controller.ActivityController<Activity>
    private lateinit var activity: Activity
    private lateinit var car: BluetoothDevice
    private var changes = 0
    private lateinit var selection: CarBluetoothSelection
    private val address = "AA:BB:CC:DD:EE:FF"
    private val adapter get() = activity.getSystemService(BluetoothManager::class.java).adapter

    @Before fun setup() {
        controller = Robolectric.buildActivity(Activity::class.java).setup()
        activity = controller.get()
        activity.getSharedPreferences("tiplay_car_bluetooth", 0).edit().clear().commit()
        activity.getSharedPreferences("diplay", 0).edit().clear().commit()
        shadowOf(activity).grantPermissions(Manifest.permission.BLUETOOTH_CONNECT)
        shadowOf(adapter).setEnabled(true)
        car = mock(BluetoothDevice::class.java)
        `when`(car.address).thenReturn(address)
        `when`(car.name).thenReturn("Car")
        `when`(car.bondState).thenReturn(BluetoothDevice.BOND_BONDED)
        shadowOf(adapter).setBondedDevices(setOf(car))
        selection = CarBluetoothSelection(activity) { changes++ }
    }

    @After fun cleanup() {
        controller.pause().stop().destroy()
    }

    @Suppress("DEPRECATION")
    @Test @Config(sdk = [29, 33]) fun alreadyPairedCarSavesWithoutACompanionAssociationOrScan() {
        val manager = activity.getSystemService(CompanionDeviceManager::class.java)
        assertTrue(manager.associations.isEmpty())
        selection.select(address.lowercase())
        assertEquals(address, CarBluetoothPreference.address(activity))
        assertEquals("Car", CarBluetoothPreference.name(activity))
        assertEquals(1, changes)
        assertTrue(manager.associations.isEmpty())
        assertFalse(adapter.isDiscovering)
        verify(car, never()).createBond()
    }

    @Test fun revokedPermissionDoesNotReadTheDeviceOrSaveIt() {
        shadowOf(activity).denyPermissions(Manifest.permission.BLUETOOTH_CONNECT)
        clearInvocations(car)
        selection.select(address)
        verifyNoInteractions(car)
        assertNull(CarBluetoothPreference.address(activity))
        assertEquals(0, changes)
        assertEquals(activity.getString(R.string.settings_car_bluetooth_permission), ShadowToast.getTextOfLatestToast())
    }

    @Test fun aCarUnpairedAfterTheListWasShownIsRejectedWithoutStartingPairing() {
        activity.getSharedPreferences("tiplay_car_bluetooth", 0).edit().putString("address", "saved-car").commit()
        `when`(car.bondState).thenReturn(BluetoothDevice.BOND_NONE)
        selection.select(address)
        assertEquals("saved-car", CarBluetoothPreference.address(activity))
        assertEquals(0, changes)
        verify(car, never()).createBond()
        assertEquals(activity.getString(R.string.settings_car_bluetooth_pair_first), ShadowToast.getTextOfLatestToast())
    }

    @Test fun aDeviceMissingFromThePairedSetCannotBeSelectedByItsAddress() {
        shadowOf(adapter).setBondedDevices(emptySet())
        selection.select(address)
        assertNull(CarBluetoothPreference.address(activity))
        assertEquals(0, changes)
        verify(car, never()).createBond()
        assertEquals(activity.getString(R.string.settings_car_bluetooth_pair_first), ShadowToast.getTextOfLatestToast())
    }

    @Test fun theSelectedIphoneCannotBeSavedAsTheCar() {
        DiPlayPreferences.savePhone(activity, address.lowercase(), "iPhone")
        selection.select(address)
        assertNull(CarBluetoothPreference.address(activity))
        assertEquals(0, changes)
        verify(car, never()).createBond()
        assertEquals(activity.getString(R.string.settings_car_bluetooth_not_iphone), ShadowToast.getTextOfLatestToast())
    }

    @Test fun bluetoothMustBeEnabledBeforeSavingTheSelection() {
        shadowOf(adapter).setEnabled(false)
        selection.select(address)
        assertNull(CarBluetoothPreference.address(activity))
        assertEquals(0, changes)
        verify(car, never()).createBond()
        assertEquals(activity.getString(R.string.settings_car_bluetooth_enable), ShadowToast.getTextOfLatestToast())
    }
}
