package com.shilapi.xcertplay

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.SharedPreferences
import android.os.Looper
import com.shilapi.xcertplay.airplay.RtspMessage
import com.shilapi.xcertplay.receiver.ReceiverServer
import java.io.Closeable
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Actual old/new Service lifecycles preserve the live successor across delayed old startup/cleanup. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AirPlayReceiverServiceStartupTest {
    @Test fun retiringDuringIdentityCannotPublishOverOrStopItsSuccessor() = overlap(retireDuringIdentity = true)

    @Test fun retiringAnAlreadyPublishedReceiverCannotClearItsSuccessorsLeaseOrState() = overlap(retireDuringIdentity = false)

    private fun overlap(retireDuringIdentity: Boolean) {
        val context = RuntimeEnvironment.getApplication()
        TeslaBrowserLink.resetForTest()
        listOf("tiplay_airplay_receiver", "tiplay_browser_link", "tiplay_hotspot_address", "xcertplay_airplay").forEach {
            context.getSharedPreferences(it, 0).edit().clear().commit()
        }
        TeslaBrowserLink.serverFactory = TiPlayTestApplication.noSocketServers
        HotspotExtraAddressSettings.saveMethod(context, HotspotAddressMethod.NORMAL)
        val oldController = Robolectric.buildService(AirPlayReceiverService::class.java).create()
        val old = oldController.get()
        val base = ContextWrapper::class.java.getDeclaredField("mBase").apply { isAccessible = true }
        val gate = IdentityGate(base.get(old) as Context)
        if (retireDuringIdentity) base.set(old, gate)
        val newController = Robolectric.buildService(AirPlayReceiverService::class.java)
        val newer = newController.get()
        val successorRelease = CountDownLatch(1)
        var oldDestroyed = false
        var newCreated = false
        var oldWorker: ScheduledExecutorService? = null
        var newWorker: ScheduledExecutorService? = null
        try {
            val retiredExecutor = field(old, "worker") as ScheduledExecutorService
            oldWorker = retiredExecutor
            old.onStartCommand(Intent(), 0, 1)
            if (retireDuringIdentity) {
                assertTrue("old start entered identity after its generation check", gate.entered.await(10, TimeUnit.SECONDS))
                assertNull("old start has not yet published a server", field(old, "server"))
            } else {
                await("old receiver publication", 30) {
                    val receiver = field(old, "server") as? ReceiverServer
                    receiver != null && receiver.port > 0 && isCurrent(lease(receiver)) &&
                        AirPlayReceiverService.state == "listening"
                }
                retiredExecutor.execute {
                    gate.entered.countDown()
                    check(gate.release.await(35, TimeUnit.SECONDS))
                }
                assertTrue(gate.entered.await(10, TimeUnit.SECONDS))
            }
            oldController.destroy()
            oldDestroyed = true
            assertEquals(true, field(old, "destroyed"))
            assertFalse("old cleanup is queued behind blocked identity", retiredExecutor.isTerminated)

            newController.create()
            newCreated = true
            val currentExecutor = field(newer, "worker") as ScheduledExecutorService
            newWorker = currentExecutor
            newer.onStartCommand(Intent(), 0, 1)
            await("successor listener and discovery lease", 30) {
                val receiver = field(newer, "server") as? ReceiverServer
                receiver != null && receiver.port > 0 && isCurrent(lease(receiver)) &&
                    AirPlayReceiverService.state == "listening"
            }
            val running = field(newer, "server") as ReceiverServer
            val runningLease = requireNotNull(lease(running))
            assertTrue(isCurrent(runningLease))
            assertEquals("200", brokerResponse().path)
            assertEquals("200", directOptions(running.port).path)
            assertEquals(false, field(newer, "destroyed"))
            val successorWaiting = CountDownLatch(1)
            currentExecutor.execute {
                // Keep periodic network refresh from changing legitimate successor status while
                // asserting that old cleanup cannot overwrite the last successor publication.
                successorWaiting.countDown()
                check(successorRelease.await(35, TimeUnit.SECONDS))
            }
            assertTrue(successorWaiting.await(10, TimeUnit.SECONDS))
            assertEquals("listening", AirPlayReceiverService.state)

            gate.release.countDown()
            await("retired start and its queued cleanup complete", 20) { retiredExecutor.isTerminated }
            assertNull("retired cleanup closed its late receiver", field(old, "server"))
            assertSame("successor receiver object still lives", running, field(newer, "server"))
            assertEquals(false, field(newer, "destroyed"))
            assertEquals("200", directOptions(running.port).path)

            assertTrue("retired startup cannot displace the live successor lease", isCurrent(runningLease))
            assertEquals("successor broker remains available", "200", brokerResponse().path)
            assertEquals("retired cleanup cannot overwrite successor state", "listening", AirPlayReceiverService.state)
            shadowOf(Looper.getMainLooper()).idle()
            assertFalse("late retired startup failure cannot request a stop", shadowOf(old).isStoppedBySelf)
            assertFalse("successor is still running", shadowOf(newer).isStoppedBySelf)
        } finally {
            gate.release.countDown()
            successorRelease.countDown()
            if (!oldDestroyed) runCatching { oldController.destroy() }
            if (newCreated) runCatching { newController.destroy() }
            oldWorker?.awaitTermination(20, TimeUnit.SECONDS)
            newWorker?.awaitTermination(20, TimeUnit.SECONDS)
            TeslaBrowserLink.resetForTest()
            TeslaBrowserLink.serverFactory = TiPlayTestApplication.noSocketServers
            listOf("tiplay_airplay_receiver", "tiplay_browser_link", "tiplay_hotspot_address", "xcertplay_airplay").forEach {
                context.getSharedPreferences(it, 0).edit().clear().commit()
            }
        }
    }

    private class IdentityGate(base: Context) : ContextWrapper(base) {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
            if (name == "tiplay_airplay_receiver" && Thread.currentThread().name == "tiplay-airplay-service" &&
                Thread.currentThread().stackTrace.any {
                    it.className == AirPlayReceiverService::class.java.name && it.methodName == "identity"
                }) {
                entered.countDown()
                check(release.await(35, TimeUnit.SECONDS)) { "identity interleaving gate timed out" }
            }
            return super.getSharedPreferences(name, mode)
        }
    }

    companion object {
        private fun field(target: Any, name: String): Any? = target.javaClass.getDeclaredField(name)
            .apply { isAccessible = true }.get(target)
        private fun lease(receiver: ReceiverServer): Closeable? = field(receiver, "discoveryInfoLease") as? Closeable
        private val brokerClass get() = Class.forName("com.shilapi.xcertplay.receiver.ReceiverDiscoveryInfo")
        private val broker get() = brokerClass.getField("INSTANCE").get(null)
        private fun isCurrent(lease: Closeable?): Boolean = brokerClass.getMethod("isCurrent", Closeable::class.java)
            .invoke(broker, lease) as Boolean
        private fun brokerResponse(): RtspMessage.Request {
            val request = RtspMessage.Request("GET", "/info?txtAirPlay&txtRAOP", "RTSP/1.0",
                mapOf("x-apple-qr" to "BT"), byteArrayOf())
            val response = brokerClass.getMethod("response", RtspMessage.Request::class.java)
                .invoke(broker, request) as RtspMessage.Response
            // Response.status=null is the production default success (200), not an error.
            // Compare the actual encoded RTSP status, as the direct socket helper does.
            return RtspMessage.parseMessages(RtspMessage.buildResponse(request, response)).messages.single()
        }
        private fun directOptions(port: Int): RtspMessage.Request = Socket().use { socket ->
            socket.connect(InetSocketAddress("127.0.0.1", port), 2_000)
            socket.soTimeout = 3_000
            socket.getOutputStream().apply {
                write("OPTIONS * RTSP/1.0\r\nCSeq: 1\r\nContent-Length: 0\r\n\r\n".toByteArray(Charsets.US_ASCII)); flush()
            }
            var input = byteArrayOf()
            while (true) {
                RtspMessage.parseMessages(input).messages.firstOrNull()?.let { return@use it }
                val bytes = ByteArray(8_192)
                val count = socket.getInputStream().read(bytes)
                check(count > 0) { "successor direct listener closed before OPTIONS reply" }
                input += bytes.copyOf(count)
            }
            @Suppress("UNREACHABLE_CODE") error("unreachable")
        }
        private fun await(label: String, timeoutSeconds: Long, condition: () -> Boolean) {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds)
            while (!condition() && System.nanoTime() < deadline) Thread.sleep(5)
            assertTrue("did not reach $label", condition())
        }
    }
}
