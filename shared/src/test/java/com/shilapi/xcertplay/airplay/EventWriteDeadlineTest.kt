package com.shilapi.xcertplay.airplay

import java.io.Closeable
import java.io.IOException
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class EventWriteDeadlineTest {
    private class OwnedSocket : Socket() {
        val released = CountDownLatch(1)
        override fun close() { super.close(); released.countDown() }
    }

    @Test fun expiryClosesTheBlockedSocketWithoutNeedingTheWriterLock() {
        val timers = mutableListOf<() -> Unit>()
        val deadline = EventWriteDeadline({ 50 }) { _, task -> timers.add(task); Closeable {} }
        val socket = OwnedSocket(); val entered = CountDownLatch(1)
        val worker = Executors.newSingleThreadExecutor()
        try {
            val result = worker.submit {
                deadline.write(socket) {
                    entered.countDown()
                    check(socket.released.await(2, TimeUnit.SECONDS))
                    throw IOException("socket closed")
                }
            }
            assertTrue(entered.await(1, TimeUnit.SECONDS))
            timers.single().invoke()
            val failure = assertThrows(ExecutionException::class.java) { result.get(1, TimeUnit.SECONDS) }
            assertTrue(failure.cause is SocketTimeoutException)
            assertTrue(socket.isClosed)
        } finally { deadline.close(); socket.close(); worker.shutdownNow() }
    }

    @Test fun aLateCancelledTimerCannotCloseACompletedOrReplacementSocket() {
        val timers = mutableListOf<() -> Unit>()
        val deadline = EventWriteDeadline({ 50 }) { _, task -> timers.add(task); Closeable {} }
        val old = OwnedSocket(); val current = OwnedSocket()
        val entered = CountDownLatch(1); val worker = Executors.newSingleThreadExecutor()
        try {
            repeat(100) { deadline.write(old) { } }
            val result = worker.submit {
                deadline.write(current) { entered.countDown(); check(current.released.await(2, TimeUnit.SECONDS)) }
            }
            assertTrue(entered.await(1, TimeUnit.SECONDS))
            timers.dropLast(1).forEach { it.invoke() }
            assertFalse(old.isClosed); assertFalse(current.isClosed)
            timers.last().invoke()
            assertThrows(ExecutionException::class.java) { result.get(1, TimeUnit.SECONDS) }
            assertTrue(current.isClosed); assertFalse(old.isClosed)
        } finally { deadline.close(); old.close(); current.close(); worker.shutdownNow() }
    }

    @Test fun retirementClosesOnlyItsActiveWriterAndRejectsNewWrites() {
        val deadline = EventWriteDeadline({ 5_000 })
        val socket = OwnedSocket(); val idle = OwnedSocket()
        val entered = CountDownLatch(1); val worker = Executors.newSingleThreadExecutor()
        try {
            val result = worker.submit {
                deadline.write(socket) { entered.countDown(); check(socket.released.await(2, TimeUnit.SECONDS)) }
            }
            assertTrue(entered.await(1, TimeUnit.SECONDS))
            deadline.close()
            val failure = assertThrows(ExecutionException::class.java) { result.get(1, TimeUnit.SECONDS) }
            assertTrue(failure.cause is IOException)
            assertTrue(socket.isClosed); assertFalse(idle.isClosed)
            assertThrows(IOException::class.java) { deadline.write(idle) { } }
        } finally { deadline.close(); socket.close(); idle.close(); worker.shutdownNow() }
    }
}
