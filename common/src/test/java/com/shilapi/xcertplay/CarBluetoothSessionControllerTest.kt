package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class CarBluetoothSessionControllerTest {
    @Test fun explicitlyReselectingThePendingCarRetriesWithoutAutomaticProfileReconnects() {
        val calls = mutableListOf<Pair<String?, Boolean>>()
        val sessions = CarBluetoothSessionController { address, connect ->
            calls += address to connect
            CarBluetoothConnection.Attempt.REQUESTED
        }
        val session = Any()
        sessions.active(session, "AA")
        sessions.select("AA")
        sessions.profileDisconnected("AA")
        assertEquals(listOf("AA" to true), calls)
        sessions.select("aa", forceRetry = true)
        sessions.select("AA")
        assertEquals(listOf("AA" to true, "aa" to true), calls)
    }

    @Test fun anUnconfirmedRequestExpiresWithoutReconnectingAndExplicitRetryGetsANewDeadline() {
        var time = 0L
        var requests = 0
        val sessions = CarBluetoothSessionController(now = { time }) { _, _ ->
            requests++
            CarBluetoothConnection.Attempt.REQUESTED
        }
        sessions.active(Any(), "AA")
        time = 29_999
        assertEquals(CarBluetoothConnection.Attempt.REQUESTED, sessions.currentAttempt())
        time++
        assertEquals(CarBluetoothConnection.Attempt.FAILED, sessions.currentAttempt())
        assertEquals(1, requests)
        sessions.select("AA", forceRetry = true)
        time = 59_999
        assertEquals(CarBluetoothConnection.Attempt.REQUESTED, sessions.currentAttempt())
        time++
        assertEquals(CarBluetoothConnection.Attempt.FAILED, sessions.currentAttempt())
        assertEquals(2, requests)
    }

    @Test fun timeoutAndFailedRetryRetainTheOlderAcceptedRequestsLateDisconnectCompensation() {
        var time = 0L
        var connects = 0
        val calls = mutableListOf<Pair<String?, Boolean>>()
        val sessions = CarBluetoothSessionController(now = { time }) { address, connect ->
            calls += address to connect
            if (connect && ++connects > 1) CarBluetoothConnection.Attempt.FAILED else CarBluetoothConnection.Attempt.REQUESTED
        }
        val session = Any()
        sessions.active(session, "AA")
        time = 30_000
        assertEquals(CarBluetoothConnection.Attempt.FAILED, sessions.currentAttempt())
        sessions.select("AA", forceRetry = true)
        sessions.ended(session)
        val stopped = calls.size
        sessions.profileConnected("AA")
        assertEquals(stopped + 1, calls.size)
        assertEquals("AA" to false, calls.last())
        sessions.profileConnected("AA")
        assertEquals(stopped + 1, calls.size)
    }

    @Test fun matchingProfileConfirmationClosesTheRequestDeadlineWithoutAffectingOtherTargets() {
        var time = 0L
        val sessions = CarBluetoothSessionController(now = { time }) { _, _ -> CarBluetoothConnection.Attempt.REQUESTED }
        sessions.active(Any(), "AA")
        sessions.profileConnected("BB")
        time = 30_000
        assertEquals(CarBluetoothConnection.Attempt.FAILED, sessions.currentAttempt())
        sessions.profileConnected("aa")
        time += 90_000
        assertEquals(CarBluetoothConnection.Attempt.REQUESTED, sessions.currentAttempt())
    }

    @Test fun staleSessionEndCannotDisconnectReplacementAndSelectionIsSpecific() {
        val calls = mutableListOf<Pair<String?, Boolean>>()
        val sessions = CarBluetoothSessionController { address, connect ->
            calls += address to connect
            CarBluetoothConnection.Attempt.REQUESTED
        }
        val first = Any(); val second = Any()
        sessions.active(first, "AA")
        sessions.active(second, "AA")
        sessions.ended(first)
        assertEquals(listOf("AA" to true), calls)
        sessions.select("BB")
        assertEquals(listOf("AA" to true, "AA" to false, "BB" to true), calls)
        sessions.ended(second)
        assertEquals("BB" to false, calls.last())
        assertEquals(CarBluetoothConnection.Attempt.NONE, sessions.select("CC"))
    }

    @Test fun lateConnectionAfterEndIsRetriedButNeverDisconnectsAReplacement() {
        val calls = mutableListOf<Pair<String?, Boolean>>()
        val sessions = CarBluetoothSessionController { address, connect ->
            calls += address to connect
            CarBluetoothConnection.Attempt.REQUESTED
        }
        val first = Any(); val replacement = Any()
        sessions.active(first, "AA")
        sessions.ended(first)
        sessions.profileConnected("aa")
        assertEquals(listOf("AA" to true, "AA" to false, "AA" to false), calls)
        sessions.active(replacement, "AA")
        val count = calls.size
        sessions.profileConnected("aa")
        sessions.ended(first)
        assertEquals(count, calls.size)
        sessions.ended(replacement)
        val beforeLate = calls.size
        sessions.profileConnected("aa")
        assertEquals(beforeLate + 1, calls.size) // Another profile may connect after the first was observed.
    }

    @Test fun observerFailurePreventsConnect() {
        var invocations = 0
        val connect = { invocations++; CarBluetoothConnection.Attempt.REQUESTED }
        assertEquals(CarBluetoothConnection.Attempt.FAILED, requestWithObserver(false, connect))
        assertEquals(0, invocations)
        assertEquals(CarBluetoothConnection.Attempt.REQUESTED, requestWithObserver(true, connect))
        assertEquals(1, invocations)
    }

    @Test fun pendingCompensationIsOnceAndExpiresOrYieldsToUserAndNewSessions() {
        var time = 0L
        val calls = mutableListOf<Pair<String?, Boolean>>()
        val sessions = CarBluetoothSessionController(now = { time }) { address, connect ->
            calls += address to connect; CarBluetoothConnection.Attempt.REQUESTED
        }
        fun stopNew(): Any = Any().also { sessions.active(it, "AA"); sessions.ended(it) }
        stopNew()
        sessions.profileConnected("AA")
        val afterCompensation = calls.size
        sessions.profileConnected("AA")
        assertEquals(afterCompensation, calls.size)
        stopNew(); time += 5_000L
        val afterExpiry = calls.size
        sessions.profileConnected("AA")
        assertEquals(afterExpiry, calls.size)
        stopNew(); sessions.userAction()
        val afterUser = calls.size
        sessions.profileConnected("AA")
        assertEquals(afterUser, calls.size)
        stopNew(); sessions.profileDisconnected("AA")
        val afterDisconnect = calls.size
        sessions.profileConnected("AA")
        assertEquals(afterDisconnect + 1, calls.size)
        stopNew(); val newSession = Any(); sessions.active(newSession, "AA")
        val afterReplacement = calls.size
        sessions.profileConnected("AA")
        assertEquals(afterReplacement, calls.size)
    }

    @Test fun disconnectIsAttemptedEvenIfConnectFailedOrWasUnsupported() {
        val calls = mutableListOf<Pair<String?, Boolean>>()
        val sessions = CarBluetoothSessionController { address, connect ->
            calls += address to connect
            if (connect) CarBluetoothConnection.Attempt.FAILED else CarBluetoothConnection.Attempt.REQUESTED
        }
        val session = Any()
        sessions.active(session, "AA")
        sessions.ended(session)
        assertEquals(listOf("AA" to true, "AA" to false), calls)
        sessions.profileConnected("AA")
        assertEquals(2, calls.size) // Only an accepted connect gets a compensation token.
    }

    @Test fun sameSelectionRetriesAfterObserverOrPermissionRecovers() {
        var ready = false
        var requests = 0
        val sessions = CarBluetoothSessionController { _, connect ->
            if (!connect) CarBluetoothConnection.Attempt.NONE
            else { requests++; if (ready) CarBluetoothConnection.Attempt.REQUESTED else CarBluetoothConnection.Attempt.FAILED }
        }
        val session = Any()
        assertEquals(CarBluetoothConnection.Attempt.FAILED, sessions.active(session, "AA"))
        ready = true
        assertEquals(CarBluetoothConnection.Attempt.REQUESTED, sessions.select("AA"))
        assertEquals(2, requests)
        sessions.select("AA")
        assertEquals(2, requests)
    }

    @Test fun permissionRecoveryIsOnlySignaledOnTransitionToReady() {
        val recovery = CarBluetoothPermissionRecovery()
        assertFalse(recovery.update(false))
        assertTrue(recovery.update(true))
        assertFalse(recovery.update(true))
        assertFalse(recovery.update(false))
        assertTrue(recovery.update(true))
        assertFalse(recovery.update(true))
    }

    @Test fun bluetoothTurningOnRetriesTheFailedTargetOnlyOnce() {
        val recovery = CarBluetoothPermissionRecovery()
        var connects = 0
        val sessions = CarBluetoothSessionController { _, connect ->
            if (connect) connects++
            CarBluetoothConnection.Attempt.REQUESTED
        }
        val session = Any()
        recovery.update(autoConnectionReady(true, true, false))
        // The first platform attempt fails while the adapter is off.
        var adapterOn = false
        val failingSessions = CarBluetoothSessionController { _, connect ->
            if (connect) connects++
            if (adapterOn) CarBluetoothConnection.Attempt.REQUESTED else CarBluetoothConnection.Attempt.FAILED
        }
        assertEquals(CarBluetoothConnection.Attempt.FAILED, failingSessions.active(session, "AA"))
        adapterOn = true
        if (recovery.update(autoConnectionReady(true, true, adapterOn))) failingSessions.select("AA")
        if (recovery.update(autoConnectionReady(true, true, adapterOn))) failingSessions.select("AA")
        assertEquals(2, connects)
        assertEquals(CarBluetoothConnection.Attempt.REQUESTED, failingSessions.select("AA"))
        assertEquals(2, connects)
        // A previously successful target is also eligible after the adapter switches off.
        sessions.active(Any(), "BB")
        assertEquals(CarBluetoothConnection.Attempt.FAILED, sessions.unavailable())
        assertEquals(CarBluetoothConnection.Attempt.REQUESTED, sessions.select("BB"))
    }
}
