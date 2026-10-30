package com.shilapi.xcertplay

import android.Manifest
import android.app.Activity
import android.bluetooth.BluetoothDevice
import android.companion.CompanionDeviceManager
import android.content.Intent
import android.os.Bundle
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class CarBluetoothPermissionRecoveryTest {
    private fun markLaunched(selection: CarBluetoothSelection) {
        for (name in listOf("awaiting", "chooserLaunched")) {
            val field = CarBluetoothSelection::class.java.getDeclaredField(name)
            field.isAccessible = true
            field.setBoolean(selection, true)
        }
    }

    @Test fun successfulChooserResultSurvivesRevocationAndRecreationWithoutReadingAddress() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        activity.getSharedPreferences("tiplay_car_bluetooth", 0).edit().clear().commit()
        activity.getSharedPreferences("diplay", 0).edit().clear().commit()
        shadowOf(activity).denyPermissions(Manifest.permission.BLUETOOTH_CONNECT)
        val candidate = mock(BluetoothDevice::class.java)
        `when`(candidate.address).thenReturn("AA:BB:CC:DD:EE:FF")
        `when`(candidate.name).thenReturn("Car")
        `when`(candidate.bondState).thenReturn(BluetoothDevice.BOND_BONDED)
        val result = Intent().putExtra(CompanionDeviceManager.EXTRA_DEVICE, candidate)
        val first = CarBluetoothSelection(activity, {}, {})
        markLaunched(first)
        first.onResult(Activity.RESULT_OK, result)
        verify(candidate, never()).address
        val saved = Bundle()
        first.save(saved)
        first.close()
        val replacement = CarBluetoothSelection(activity, {}, {})
        replacement.restore(saved)
        verify(candidate, never()).address
        shadowOf(activity).grantPermissions(Manifest.permission.BLUETOOTH_CONNECT)
        replacement.permissionsChanged()
        assertEquals("AA:BB:CC:DD:EE:FF", CarBluetoothPreference.address(activity))
        replacement.close()
        controller.pause().stop().destroy()
    }

    @Test fun repeatedResumeDoesNotRestartOrDiscardBondWhileSystemIsStartingIt() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        activity.getSharedPreferences("diplay", 0).edit().clear().commit()
        shadowOf(activity).grantPermissions(Manifest.permission.BLUETOOTH_CONNECT)
        val candidate = mock(BluetoothDevice::class.java)
        `when`(candidate.address).thenReturn("AA:BB:CC:DD:EE:FF")
        `when`(candidate.bondState).thenReturn(BluetoothDevice.BOND_NONE)
        `when`(candidate.createBond()).thenReturn(true)
        val selection = CarBluetoothSelection(activity, {}, {})
        markLaunched(selection)
        selection.onResult(Activity.RESULT_OK, Intent().putExtra(CompanionDeviceManager.EXTRA_DEVICE, candidate))
        selection.permissionsChanged()
        selection.permissionsChanged()
        verify(candidate, times(1)).createBond()
        val saved = Bundle()
        selection.save(saved)
        @Suppress("DEPRECATION")
        assertSame(candidate, saved.getParcelable<BluetoothDevice>("car_bluetooth_pending_device"))
        selection.close()
        controller.pause().stop().destroy()
    }

    @Test fun rejectingIphoneClearsRetainedRecoveryAcrossRecreation() {
        val controller = Robolectric.buildActivity(Activity::class.java).setup()
        val activity = controller.get()
        activity.getSharedPreferences("tiplay_car_bluetooth", 0).edit().clear().commit()
        DiPlayPreferences.savePhone(activity, "AA:BB:CC:DD:EE:FF", "iPhone")
        shadowOf(activity).denyPermissions(Manifest.permission.BLUETOOTH_CONNECT)
        val candidate = mock(BluetoothDevice::class.java)
        `when`(candidate.address).thenReturn("AA:BB:CC:DD:EE:FF")
        val first = CarBluetoothSelection(activity, {}, {})
        markLaunched(first)
        first.onResult(Activity.RESULT_OK, Intent().putExtra(CompanionDeviceManager.EXTRA_DEVICE, candidate))
        val saved = Bundle(); first.save(saved); first.close()
        val second = CarBluetoothSelection(activity, {}, {})
        second.restore(saved)
        shadowOf(activity).grantPermissions(Manifest.permission.BLUETOOTH_CONNECT)
        second.permissionsChanged()
        assertNull(CarBluetoothPreference.address(activity))
        val afterReject = Bundle(); second.save(afterReject)
        @Suppress("DEPRECATION")
        assertNull(afterReject.getParcelable<BluetoothDevice>("car_bluetooth_pending_device"))
        assertFalse(afterReject.getBoolean("car_bluetooth_bond_started"))
        assertEquals(0L, afterReject.getLong("car_bluetooth_bond_deadline"))
        second.close()
        clearInvocations(candidate)
        val third = CarBluetoothSelection(activity, {}, {})
        third.restore(null)
        third.permissionsChanged()
        verify(candidate, never()).address
        third.close()
        controller.pause().stop().destroy()
    }
}
