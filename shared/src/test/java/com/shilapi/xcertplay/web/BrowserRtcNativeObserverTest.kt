package com.shilapi.xcertplay.web

import java.nio.ByteBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.webrtc.DataChannel
import org.webrtc.PeerConnection

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class BrowserRtcNativeObserverTest {
    @Test fun gatheringLatchCompletesBeforeADeferredLoggerCanBlock() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val caller = Thread.currentThread()
        val peer = AndroidBrowserRtcFactory(RuntimeEnvironment.getApplication(), WebVideoHub(), null, { message ->
            if (message.contains("stage=ice-gather")) {
                assertNotEquals(caller, Thread.currentThread()); entered.countDown()
                check(release.await(5, TimeUnit.SECONDS))
            }
        }).create("test", { "{}" })
        try {
            observer(peer).onIceGatheringChange(PeerConnection.IceGatheringState.COMPLETE)
            val gathered = peer.javaClass.getDeclaredField("gathering").apply { isAccessible = true }.get(peer) as CountDownLatch
            assertEquals(0L, gathered.count)
            assertTrue(entered.await(1, TimeUnit.SECONDS))
            assertTrue(peer.live)
        } finally { release.countDown(); closePeer(peer) }
    }

    @Test fun failedIceCallbackUpdatesStateImmediatelyButDefersLoggingAndRetirement() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val peer = AndroidBrowserRtcFactory(RuntimeEnvironment.getApplication(), WebVideoHub(), null, { message ->
            if (message.contains("stage=ice ")) { entered.countDown(); check(release.await(5, TimeUnit.SECONDS)) }
        }).create("test", { "{}" })
        try {
            observer(peer).onIceConnectionChange(PeerConnection.IceConnectionState.FAILED)
            assertEquals("failed", peer.snapshot()["state"])
            assertTrue(entered.await(1, TimeUnit.SECONDS))
            assertFalse(peer.live)
            assertFalse(actuallyClosed(peer))
            release.countDown()
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1)
            while (!actuallyClosed(peer) && System.nanoTime() < deadline) Thread.sleep(1)
            assertTrue(actuallyClosed(peer))
        } finally { release.countDown(); closePeer(peer) }
    }

    @Test fun aFailingDiagnosticSinkCannotPreventNativeFailureRetirement() {
        val peer = AndroidBrowserRtcFactory(RuntimeEnvironment.getApplication(), WebVideoHub(), null,
            { throw java.io.IOException("diagnostic storage unavailable") }).create("test", { "{}" })
        try {
            observer(peer).onIceConnectionChange(PeerConnection.IceConnectionState.FAILED)
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
            while (!actuallyClosed(peer) && System.nanoTime() < deadline) Thread.sleep(1)
            assertTrue(actuallyClosed(peer))
        } finally { closePeer(peer) }
    }

    @Test fun terminalIceFencesControlAndQueuedOpenBeforeTheOwnerCanRetire() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val retired = CountDownLatch(1)
        val rpcCalls = AtomicInteger(); val retireCalls = AtomicInteger()
        val peer = AndroidBrowserRtcFactory(RuntimeEnvironment.getApplication(), WebVideoHub(), null, { message ->
            if (message.contains("stage=close ")) { retireCalls.incrementAndGet(); retired.countDown() }
        }).create("test", { rpcCalls.incrementAndGet(); "{}" })
        val owner = peer.javaClass.getDeclaredField("lifecycle").apply { isAccessible = true }
            .get(peer) as java.util.concurrent.ExecutorService
        val receive = peer.javaClass.getDeclaredMethod("receiveNativeControl", String::class.java, DataChannel.Buffer::class.java)
            .apply { isAccessible = true }
        val open = peer.javaClass.getDeclaredMethod("startChannel", String::class.java, Long::class.javaPrimitiveType)
            .apply { isAccessible = true }
        try {
            peer.authenticate()
            owner.execute { entered.countDown(); check(release.await(5, TimeUnit.SECONDS)) }
            assertTrue(entered.await(1, TimeUnit.SECONDS))
            owner.execute { open.invoke(peer, "control", 123L) }
            observer(peer).onIceConnectionChange(PeerConnection.IceConnectionState.FAILED)
            assertFalse(peer.live)
            assertFalse(actuallyClosed(peer))
            val bytes = ByteBuffer.wrap("{\"k\":\"status\",\"q\":1}".toByteArray())
            receive.invoke(peer, "control", DataChannel.Buffer(bytes, false))
            // Rejected at native admission: even the input buffer and bounded inbox stay untouched.
            assertEquals(0, bytes.position())
            val controls = peer.javaClass.getDeclaredField("controls").apply { isAccessible = true }
                .get(peer) as BrowserRtcControlQueue
            assertEquals(0L, controls.snapshot()["receivedMessages"])
            observer(peer).onIceConnectionChange(PeerConnection.IceConnectionState.CONNECTED)
            assertEquals("failed", peer.snapshot()["state"])
            assertEquals(0, rpcCalls.get())
            release.countDown()
            assertTrue(retired.await(2, TimeUnit.SECONDS))
            assertTrue(owner.awaitTermination(2, TimeUnit.SECONDS))
            assertTrue(actuallyClosed(peer))
            assertEquals(1, retireCalls.get())
            val started = peer.javaClass.getDeclaredField("channelStarted").apply { isAccessible = true }.get(peer) as Set<*>
            assertTrue(started.isEmpty())
            assertEquals(0, rpcCalls.get())
        } finally { release.countDown(); closePeer(peer) }
    }

    private fun actuallyClosed(peer: BrowserRtcSession): Boolean =
        (peer.javaClass.getDeclaredField("closed").apply { isAccessible = true }.get(peer) as AtomicBoolean).get()

    private fun closePeer(peer: BrowserRtcSession) {
        peer.close()
        val owner = peer.javaClass.getDeclaredField("lifecycle").apply { isAccessible = true }
            .get(peer) as java.util.concurrent.ExecutorService
        assertTrue(owner.awaitTermination(2, TimeUnit.SECONDS))
    }

    private fun observer(peer: BrowserRtcSession): PeerConnection.Observer =
        peer.javaClass.getDeclaredField("observer").apply { isAccessible = true }.get(peer) as PeerConnection.Observer
}
