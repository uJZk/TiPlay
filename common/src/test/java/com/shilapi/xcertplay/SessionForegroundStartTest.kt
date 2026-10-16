package com.shilapi.xcertplay

import android.app.ForegroundServiceStartNotAllowedException
import android.content.pm.ServiceInfo
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SessionForegroundStartTest {
    private val connected = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    private val microphone = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    private val location = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
    private val denial = "Starting FGS with type microphone requires permissions [android.permission.RECORD_AUDIO] " +
        "and the app must be in the eligible state/exemptions to access the foreground only permission"

    @Test fun grantedMicrophoneRejectedInBackgroundFallsBackWithoutMisreportingPermissionDenial() {
        val attempts = mutableListOf<Int>()
        val logs = mutableListOf<String>()
        assertTrue(SessionForegroundStart.start(connected or microphone, { true }, {
            attempts += it
            if (it and microphone != 0) throw SecurityException(denial + " private caller details")
        }, logs::add, { false }))
        assertEquals(listOf(connected or microphone, connected), attempts)
        assertEquals(listOf("session foreground stage=ACCESS rejected reason=MICROPHONE_ELIGIBILITY_UNAVAILABLE retryTypes=0x10"), logs)
        assertFalse(logs.any { it.contains("private") || it.contains("PERMISSION_MISSING") })
    }

    @Test fun legitimateForegroundStartKeepsMicrophoneAndLocation() {
        val attempts = mutableListOf<Int>()
        val logs = mutableListOf<String>()
        val requested = connected or microphone or location
        assertTrue(SessionForegroundStart.start(requested, { true }, { attempts += it }, logs::add, { false }))
        assertEquals(listOf(requested), attempts)
        assertTrue(logs.isEmpty())
    }

    @Test fun permissionRevokedDuringStartIsDistinguishedFromWhileInUseEligibility() {
        val logs = mutableListOf<String>()
        assertTrue(SessionForegroundStart.start(connected or microphone, { false }, {
            if (it and microphone != 0) throw SecurityException(denial)
        }, logs::add, { false }))
        assertTrue(logs.single().contains("reason=MICROPHONE_PERMISSION_MISSING"))
    }

    @Test fun microphoneDenialCanRetainAllowedLocationAndEachRejectedTypeIsRetriedOnlyOnce() {
        val attempts = mutableListOf<Int>()
        val logs = mutableListOf<String>()
        assertTrue(SessionForegroundStart.start(connected or microphone or location, { true }, {
            attempts += it
            if (it and microphone != 0) throw SecurityException(denial)
            if (it and location != 0) throw SecurityException(denial.replace("microphone", "location"))
        }, logs::add, { false }))
        assertEquals(listOf(connected or microphone or location, connected or location, connected), attempts)
        assertTrue(logs.last().contains("LOCATION_ELIGIBILITY_UNAVAILABLE"))
    }

    @Test fun aLaterForegroundRefreshCanAcquireMicrophoneAfterRecoverableFallback() {
        var eligible = false
        val starts = mutableListOf<Int>()
        val start = { types: Int ->
            if (!eligible && types and microphone != 0) throw SecurityException(denial)
            starts += types
        }
        val requested = connected or microphone
        assertTrue(SessionForegroundStart.start(requested, { true }, start, {}, { false }))
        eligible = true
        assertTrue(SessionForegroundStart.start(requested, { true }, start, {}, { false }))
        assertEquals(listOf(connected, requested), starts)
    }

    @Test fun frameworkBackgroundStartRejectionRequestsSafeStop() {
        val logs = mutableListOf<String>()
        assertFalse(SessionForegroundStart.start(connected or microphone, { true }, {
            throw ForegroundServiceStartNotAllowedException("private caller details")
        }, logs::add, { false }))
        assertEquals(listOf("session foreground stage=START unavailable reason=BACKGROUND_START_REJECTED"), logs)
    }

    @Test fun explicitlyRejectedConnectedDeviceBaseRequestsSafeStopWithoutRemovingItsTypeOrRetrying() {
        val attempts = mutableListOf<Int>()
        val logs = mutableListOf<String>()
        val requested = connected or microphone
        assertFalse(SessionForegroundStart.start(requested, { true }, {
            attempts += it
            throw SecurityException("Starting FGS with type connectedDevice requires permissions; private caller details")
        }, logs::add, { false }))
        assertEquals(listOf(requested), attempts)
        assertEquals(listOf("session foreground stage=ACCESS unavailable reason=CONNECTED_DEVICE_ACCESS_REJECTED"), logs)
        assertFalse(logs.any { it.contains("private") })
    }

    @Test fun unrelatedSecurityAndRuntimeFailuresAreNotSwallowed() {
        for (failure in listOf(SecurityException("RECORD_AUDIO mentioned by unrelated operation"),
            SecurityException("Starting FGS with type camera denied"), IllegalStateException("unexpected"))) {
            val actual = assertThrows(RuntimeException::class.java) {
                SessionForegroundStart.start(connected or microphone, { true }, { throw failure }, {}, { false })
            }
            assertSame(failure, actual)
        }
    }

    @Test fun debugStateCanBeEnabledImmediatelyWithoutRestartingTheHelper() {
        val logs = mutableListOf<String>()
        var debug = false
        SessionForegroundStart.start(connected or microphone, { true }, {}, logs::add, { debug })
        assertTrue(logs.isEmpty())
        debug = true
        SessionForegroundStart.start(connected or microphone, { true }, {}, logs::add, { debug })
        assertTrue(logs.any { it.contains("stage=REQUEST") && it.contains("microphoneGranted=true") })
        assertTrue(logs.any { it.contains("stage=START result=started") })
        val count = logs.size
        debug = false
        SessionForegroundStart.start(connected or microphone, { true }, {}, logs::add, { debug })
        assertEquals(count, logs.size)
    }
}
