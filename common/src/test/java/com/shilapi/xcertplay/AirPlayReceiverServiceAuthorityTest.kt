package com.shilapi.xcertplay

import java.io.Closeable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test

class AirPlayReceiverServiceAuthorityTest {
    @Test fun successorOwnsBothDiscoveryAndStateAndRetiredCallbacksCannotReplaceThem() {
        val authority = AirPlayReceiverServiceAuthority()
        val broker = AtomicReference<String?>()
        var state = "stopped"
        val old = authority.acquire { state = "starting-old" }
        val oldLease = old.publishDiscovery {
            broker.set("old")
            Closeable { broker.compareAndSet("old", null) }
        }
        assertTrue(old.commit { state = "listening-old" })
        val current = authority.acquire { state = "starting-new" }
        assertFalse(old.isCurrent())
        assertNull(broker.get())
        current.publishDiscovery {
            broker.set("new")
            Closeable { broker.compareAndSet("new", null) }
        }
        assertTrue(current.commit { state = "listening-new" })
        assertNull(old.publishDiscovery { error("retired registration must not execute") })
        assertFalse(old.commit { error("retired state must not execute") })
        assertFalse(old.retire { error("retired cleanup cannot commit over successor") })
        oldLease?.close()
        assertEquals("new", broker.get())
        assertEquals("listening-new", state)
        assertTrue(current.retire { state = "stopped-new" })
        assertNull(broker.get())
        assertFalse(current.isCurrent())
        assertEquals("stopped-new", state)
    }

    @Test fun registrationAndRetirementShareOneBoundaryWithoutAnUntrackedLateLease() {
        val authority = AirPlayReceiverServiceAuthority()
        val owner = authority.acquire()
        val broker = AtomicReference<String?>()
        val insideRegistration = CountDownLatch(1)
        val completeRegistration = CountDownLatch(1)
        val retirementAttempted = CountDownLatch(1)
        val retired = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>()
        val writer = Thread {
            runCatching {
                owner.publishDiscovery {
                    // A controlled pause inside the atomic broker operation, not a network cleanup.
                    insideRegistration.countDown()
                    check(completeRegistration.await(10, TimeUnit.SECONDS))
                    broker.set("old")
                    Closeable { broker.compareAndSet("old", null) }
                }
            }.onFailure { failure.set(it) }
        }.apply { start() }
        assertTrue(insideRegistration.await(5, TimeUnit.SECONDS))
        val closer = Thread {
            retirementAttempted.countDown()
            owner.retire()
            retired.countDown()
        }.apply { start() }
        try {
            assertTrue(retirementAttempted.await(5, TimeUnit.SECONDS))
            val monitor = AirPlayReceiverServiceAuthority::class.java.getDeclaredField("monitor")
                .apply { isAccessible = true }.get(authority)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            var contending = false
            while (!contending && System.nanoTime() < deadline) {
                contending = blockedOnMonitor(closer, writer, monitor)
                if (!contending) Thread.yield()
            }
            assertTrue("retirement must be blocked on the registration owner's monitor", contending)
            assertEquals("retirement cannot finish while atomic registration is admitted", 1L, retired.count)
            completeRegistration.countDown()
            assertTrue(retired.await(5, TimeUnit.SECONDS))
            assertFalse(owner.isCurrent())
            assertNull(broker.get())
            val next = authority.acquire()
            next.publishDiscovery {
                broker.set("next")
                Closeable { broker.compareAndSet("next", null) }
            }
            assertFalse(owner.retire())
            assertEquals("next", broker.get())
            next.retire()
        } finally {
            completeRegistration.countDown()
            writer.join(5_000)
            closer.join(5_000)
        }
        assertFalse(writer.isAlive)
        assertFalse(closer.isAlive)
        assertNull(failure.get())
    }

    private fun blockedOnMonitor(waiter: Thread, owner: Thread, monitor: Any): Boolean {
        // Host-JVM management is accessed reflectively; Android's source boot classpath omits it.
        val bean = Class.forName("java.lang.management.ManagementFactory").getMethod("getThreadMXBean").invoke(null)
        val info = Class.forName("java.lang.management.ThreadMXBean")
            .getMethod("getThreadInfo", Long::class.javaPrimitiveType).invoke(bean, waiter.id) ?: return false
        val infoType = Class.forName("java.lang.management.ThreadInfo")
        val lock = infoType.getMethod("getLockInfo").invoke(info) ?: return false
        return infoType.getMethod("getThreadState").invoke(info) == Thread.State.BLOCKED &&
            infoType.getMethod("getLockOwnerId").invoke(info) == owner.id &&
            Class.forName("java.lang.management.LockInfo").getMethod("getIdentityHashCode").invoke(lock) ==
                System.identityHashCode(monitor)
    }
}
