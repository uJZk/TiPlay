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

    @Test fun aReentrantStopDuringBorrowWriteStillReturnsTheScreen() {
        val transfers = mutableListOf<Int>()
        lateinit var borrow: CarPlayScreenBorrow
        borrow = CarPlayScreenBorrow { command ->
            val params = command["params"] as Map<*, *>
            val resource = (params["resources"] as List<*>).single() as Map<*, *>
            transfers += resource["transferType"] as Int
            if (transfers.size == 1) borrow.setDesired(false)
            true
        }
        borrow.setEventReady(true)
        val returned = borrow.setDesired(true)
        assertEquals(listOf(3, 4), transfers)
        assertFalse(returned.desired)
        assertEquals(false, returned.sent)
        assertTrue(returned.pending)
        assertFalse(returned.carPlayHasScreen)
        assertTrue(borrow.onModesChanged(modes(1)).carPlayHasScreen)
    }

    @Test fun repeatingTheBorrowFromItsWriteCallbackDoesNotSendItTwice() {
        var writes = 0
        lateinit var borrow: CarPlayScreenBorrow
        borrow = CarPlayScreenBorrow {
            if (++writes == 1) borrow.setDesired(true)
            true
        }
        borrow.setEventReady(true)
        val requested = borrow.setDesired(true)
        assertEquals(1, writes)
        assertTrue(requested.pending)
        assertFalse(requested.confirmedBorrow)
        assertTrue(borrow.onModesChanged(modes(2)).confirmedBorrow)
    }

    @Test fun repeatingTheReturnFromItsWriteCallbackDoesNotSendItTwice() {
        val transfers = mutableListOf<Int>()
        lateinit var borrow: CarPlayScreenBorrow
        borrow = CarPlayScreenBorrow { command ->
            val resource = ((command["params"] as Map<*, *>)["resources"] as List<*>).single() as Map<*, *>
            transfers += resource["transferType"] as Int
            if (transfers == listOf(3, 4)) borrow.setDesired(false)
            true
        }
        borrow.setEventReady(true)
        borrow.setDesired(true)
        borrow.onModesChanged(modes(2))
        val returned = borrow.setDesired(false)
        assertEquals(listOf(3, 4), transfers)
        assertTrue(returned.pending)
        assertFalse(returned.carPlayHasScreen)
        assertTrue(borrow.onModesChanged(modes(1)).carPlayHasScreen)
    }

    @Test fun aChannelReplacedFromTheWriteCallbackPumpsTheNewGeneration() {
        var writes = 0
        lateinit var borrow: CarPlayScreenBorrow
        borrow = CarPlayScreenBorrow {
            if (++writes == 1) {
                borrow.onModesChanged(modes(2))
                borrow.setEventReady(false)
                borrow.setEventReady(true)
            }
            true
        }
        borrow.setEventReady(true)
        val requested = borrow.setDesired(true)
        assertEquals(2, writes)
        assertTrue(requested.pending)
        assertFalse("The retired channel's notification cannot authorize its replacement", requested.confirmedBorrow)
        assertTrue(borrow.onModesChanged(modes(2)).confirmedBorrow)
    }

    @Test fun cancellingDuringChannelReplacementStillReturnsTheDeliveredBorrow() {
        val transfers = mutableListOf<Int>()
        lateinit var borrow: CarPlayScreenBorrow
        borrow = CarPlayScreenBorrow { command ->
            val resource = ((command["params"] as Map<*, *>)["resources"] as List<*>).single() as Map<*, *>
            transfers += resource["transferType"] as Int
            if (transfers.size == 1) {
                borrow.setEventReady(false)
                borrow.setDesired(false)
                borrow.setEventReady(true)
            }
            true
        }
        borrow.setEventReady(true)
        val returned = borrow.setDesired(true)
        assertEquals(listOf(3, 4), transfers)
        assertFalse(returned.desired)
        assertEquals(false, returned.sent)
        assertTrue(returned.pending)
        assertFalse(returned.carPlayHasScreen)
        assertTrue(borrow.onModesChanged(modes(1)).carPlayHasScreen)
    }

    @Test fun aThrowingWriteDoesNotStrandTheDeliveryPump() {
        var writes = 0
        val borrow = CarPlayScreenBorrow {
            if (++writes == 1) throw IllegalStateException("transport failed")
            true
        }
        borrow.setEventReady(true)
        assertTrue(runCatching { borrow.setDesired(true) }.exceptionOrNull() is IllegalStateException)
        val retried = borrow.setDesired(true)
        assertEquals(2, writes)
        assertTrue(retried.pending)
        assertFalse(retried.confirmedBorrow)
        assertTrue(borrow.onModesChanged(modes(2)).confirmedBorrow)
    }

    @Test fun aReentrantNewLoanDuringReturnWriteCannotBeStranded() {
        val transfers = mutableListOf<Int>()
        lateinit var borrow: CarPlayScreenBorrow
        borrow = CarPlayScreenBorrow { command ->
            val params = command["params"] as Map<*, *>
            val resource = (params["resources"] as List<*>).single() as Map<*, *>
            val transfer = resource["transferType"] as Int
            transfers += transfer
            if (transfer == 4) borrow.setDesired(true)
            true
        }
        borrow.setEventReady(true)
        borrow.setDesired(true)
        assertTrue(borrow.onModesChanged(modes(2)).confirmedBorrow)
        val requestedAgain = borrow.setDesired(false)
        assertEquals(listOf(3, 4, 3), transfers)
        assertTrue(requestedAgain.desired)
        assertEquals(true, requestedAgain.sent)
        assertTrue(requestedAgain.pending)
        assertFalse(requestedAgain.confirmedBorrow)
        assertTrue(borrow.onModesChanged(modes(2)).confirmedBorrow)
    }

    @Test fun ownershipDeliveredDuringTheWriteConfirmsWithoutAnExtraNotification() {
        val transfers = mutableListOf<Int>()
        lateinit var borrow: CarPlayScreenBorrow
        borrow = CarPlayScreenBorrow { command ->
            val params = command["params"] as Map<*, *>
            val resource = (params["resources"] as List<*>).single() as Map<*, *>
            val transfer = resource["transferType"] as Int
            transfers += transfer
            borrow.onModesChanged(modes(if (transfer == 3) 2 else 1))
            true
        }
        borrow.setEventReady(true)
        assertTrue(borrow.setDesired(true).confirmedBorrow)
        assertTrue(borrow.setDesired(false).carPlayHasScreen)
        assertEquals(listOf(3, 4), transfers)
    }

    @Test fun aNewLoanBeforeReturnedScreenRetirementKeepsTheSessionAlive() {
        val borrow = CarPlayScreenBorrow { true }
        borrow.onModesChanged(modes(1))
        borrow.setDesired(true)
        var claimed = false
        assertFalse(borrow.claimReturnedScreen { claimed = true; true })
        assertFalse(claimed)
        assertTrue(borrow.snapshot().desired)
    }

    @Test fun returnedScreenRetirementAndANewLoanHaveOneAtomicOwner() {
        val commands = mutableListOf<Map<String, Any?>>()
        val borrow = CarPlayScreenBorrow { commands += it; true }
        borrow.setEventReady(true)
        val returned = borrow.onModesChanged(modes(1))
        val claiming = CountDownLatch(1)
        val finish = CountDownLatch(1)
        val startedLoan = CountDownLatch(1)
        val claim = Thread {
            assertTrue(borrow.claimReturnedScreen {
                claiming.countDown()
                assertTrue(finish.await(2, TimeUnit.SECONDS))
                true
            })
        }.apply { start() }
        assertTrue(claiming.await(2, TimeUnit.SECONDS))
        val loan = Thread { startedLoan.countDown(); borrow.setDesired(true) }.apply { start() }
        try {
            assertTrue(startedLoan.await(2, TimeUnit.SECONDS))
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
            while (loan.state != Thread.State.BLOCKED && loan.isAlive && System.nanoTime() < deadline) Thread.yield()
            assertEquals(Thread.State.BLOCKED, loan.state)
        } finally {
            finish.countDown()
            claim.join(2_000)
            loan.join(2_000)
        }
        assertFalse(claim.isAlive)
        assertFalse(loan.isAlive)
        assertTrue(commands.isEmpty())
        assertEquals("Keep the last owner for the close diagnostic", returned, borrow.snapshot())
        assertEquals(CarPlayScreenBorrowState(), borrow.close())
    }

    private fun modes(entity: Any) = mapOf("resources" to listOf(
        mapOf("resourceID" to 1L, "entity" to entity)))
}
