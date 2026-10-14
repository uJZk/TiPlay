package com.shilapi.xcertplay.airplay

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CarPlayScreenBorrowTest {
    @Test fun aWrittenRequestDoesNotAuthorizeScreenOutput() {
        val commands = mutableListOf<Map<String, Any?>>()
        val borrow = CarPlayScreenBorrow { commands += it; true }
        assertEquals(CarPlayScreenOwner.Unknown, borrow.snapshot().owner)
        assertTrue(borrow.setDesired(true).pending)
        assertTrue(commands.isEmpty())
        val sent = borrow.setEventReady(true)
        assertEquals(true, sent.sent)
        assertFalse(sent.confirmedBorrow)
        assertTrue(sent.pending)
        val params = commands.single()["params"] as Map<*, *>
        assertEquals(listOf(mapOf("resourceID" to 1, "transferType" to 3,
            "transferPriority" to 500, "unborrowConstraint" to 100)), params["resources"])
        assertTrue(borrow.onModesChanged(modes(2L)).confirmedBorrow)
    }

    @Test fun returningWaitsForTheActualControllerOwner() {
        val commands = mutableListOf<Map<String, Any?>>()
        val borrow = CarPlayScreenBorrow { commands += it; true }
        borrow.setEventReady(true)
        borrow.setDesired(true)
        borrow.onModesChanged(modes(2))
        val returning = borrow.setDesired(false)
        assertTrue(returning.pending)
        assertFalse(returning.carPlayHasScreen)
        val params = commands.last()["params"] as Map<*, *>
        assertEquals(listOf(mapOf("resourceID" to 1, "transferType" to 4)), params["resources"])
        assertFalse(borrow.onModesChanged(modes(2)).carPlayHasScreen)
        assertTrue(borrow.onModesChanged(modes(1)).carPlayHasScreen)
        assertFalse(borrow.snapshot().pending)
    }

    @Test fun incrementalAudioAndAppUpdatesCannotChangeTheScreen() {
        val borrow = CarPlayScreenBorrow { true }
        borrow.setEventReady(true)
        borrow.setDesired(true)
        val granted = borrow.onModesChanged(mapOf("resources" to listOf(
            mapOf("resourceID" to "mainScreen", "entity" to "accessory"))))
        assertTrue(granted.confirmedBorrow)
        assertEquals(granted, borrow.onModesChanged(modes(99)))
        assertEquals(granted, borrow.onModesChanged(modes("unknown")))
        assertEquals(granted, borrow.onModesChanged(mapOf("resources" to listOf(
            mapOf("resourceID" to 2, "entity" to 1)), "appStates" to listOf(
            mapOf("appStateID" to 2, "entity" to 1)))))
        assertFalse(borrow.onModesChanged(modes("controller")).confirmedBorrow)
        assertFalse(borrow.onModesChanged(modes(99)).confirmedBorrow)
    }

    @Test fun cancellingAnUnsentLoanDoesNotSendBorrowOrUnborrow() {
        val commands = mutableListOf<Map<String, Any?>>()
        val borrow = CarPlayScreenBorrow { commands += it; true }
        borrow.setDesired(true)
        assertFalse(borrow.setDesired(false).pending)
        borrow.setEventReady(true)
        assertTrue(commands.isEmpty())
    }

    @Test fun anAccessoryReturnAndAControllerRefusalFinishTheRequestWithoutGrantingOutput() {
        val borrow = CarPlayScreenBorrow { true }
        borrow.setEventReady(true)
        borrow.setDesired(true)
        val refused = borrow.onModesChanged(modes(1))
        assertFalse(refused.pending)
        assertFalse(refused.confirmedBorrow)
        borrow.setDesired(false)
        val returnedToAccessory = borrow.onModesChanged(modes(2))
        assertFalse(returnedToAccessory.pending)
        assertFalse(returnedToAccessory.carPlayHasScreen)
        assertEquals(CarPlayScreenOwner.Accessory, returnedToAccessory.owner)
    }

    @Test fun queuedReturnsSurviveAnEventChannelInterruption() {
        val commands = mutableListOf<Map<String, Any?>>()
        val borrow = CarPlayScreenBorrow { commands += it; true }
        borrow.setEventReady(true)
        borrow.setDesired(true)
        borrow.onModesChanged(modes(2))
        borrow.setEventReady(false)
        borrow.setDesired(false)
        assertEquals(1, commands.size)
        assertTrue(borrow.setEventReady(true).pending)
        assertEquals(2, commands.size)
        assertTrue(borrow.onModesChanged(modes(1)).carPlayHasScreen)
    }

    @Test fun aFailedWriteAndAnOldOwnerDoNotConfirmTheLoan() {
        var writable = false
        val borrow = CarPlayScreenBorrow { writable }
        borrow.setEventReady(true)
        borrow.onModesChanged(modes(2))
        assertNull(borrow.setDesired(true).sent)
        writable = true
        assertFalse(borrow.setDesired(true).confirmedBorrow)
        assertTrue(borrow.onModesChanged(modes(2)).confirmedBorrow)
        borrow.setEventReady(false)
        assertFalse(borrow.setEventReady(true).confirmedBorrow)
        assertTrue(borrow.onModesChanged(modes(2)).confirmedBorrow)
    }

    @Test fun endingWhileBorrowIsBeingWrittenStillReturnsTheLoan() {
        val writing = CountDownLatch(1)
        val finishWrite = CountDownLatch(1)
        val commands = mutableListOf<Map<String, Any?>>()
        val borrow = CarPlayScreenBorrow { command ->
            commands += command
            if (commands.size == 1) {
                writing.countDown()
                assertTrue(finishWrite.await(2, TimeUnit.SECONDS))
            }
            true
        }
        borrow.setEventReady(true)
        val start = Thread { borrow.setDesired(true) }.apply { start() }
        assertTrue(writing.await(2, TimeUnit.SECONDS))
        val stop = Thread { borrow.setDesired(false) }.apply { start() }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
        while (borrow.snapshot().desired && System.nanoTime() < deadline) Thread.yield()
        assertFalse(borrow.snapshot().desired)
        finishWrite.countDown()
        start.join(2_000)
        stop.join(2_000)
        assertFalse(start.isAlive)
        assertFalse(stop.isAlive)
        assertEquals(2, commands.size)
        assertEquals(false, borrow.snapshot().sent)
        assertTrue(borrow.snapshot().pending)
        assertTrue(borrow.onModesChanged(modes(1)).carPlayHasScreen)
    }

    @Test fun synchronousCloseDuringAWriteCannotReviveOwnership() {
        lateinit var borrow: CarPlayScreenBorrow
        borrow = CarPlayScreenBorrow { borrow.close(); true }
        borrow.setEventReady(true)
        borrow.setDesired(true)
        assertEquals(CarPlayScreenBorrowState(), borrow.snapshot())
        assertEquals(CarPlayScreenBorrowState(), borrow.onModesChanged(modes(2)))
        assertEquals(CarPlayScreenBorrowState(), borrow.setDesired(true))
    }

    private fun modes(entity: Any) = mapOf("resources" to listOf(
        mapOf("resourceID" to 1L, "entity" to entity)))
}
