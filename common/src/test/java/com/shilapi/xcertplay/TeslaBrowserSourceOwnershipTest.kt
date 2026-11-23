package com.shilapi.xcertplay

import android.os.Looper
import com.shilapi.xcertplay.web.BrowserAudioCapabilities
import com.shilapi.xcertplay.web.BrowserLinkServer
import com.shilapi.xcertplay.web.BrowserLinkStatus
import com.shilapi.xcertplay.web.BrowserVideoCapabilities
import com.shilapi.xcertplay.web.BrowserViewport
import java.net.BindException
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TeslaBrowserSourceOwnershipTest {
    private val context get() = RuntimeEnvironment.getApplication()
    private val servers = CopyOnWriteArrayList<ControlledServer>()
    private val report = BrowserViewport(1280, 720, 1280.0, 720.0, 1.0,
        BrowserVideoCapabilities(true, true, 1920, 1080), BrowserAudioCapabilities(1L shl 25))
    private val currentReport = report.copy(videoCapabilities = BrowserVideoCapabilities(true, false, 1920, 1080))

    private class ControlledServer(val callbacks: BrowserLinkServer.Callbacks, val port: Int) : TeslaBrowserLink.Server {
        var startAction: (() -> Result<Int>)? = null
        var stopAction: (() -> Unit)? = null
        override fun start(): Result<Int> = startAction?.invoke() ?: Result.success(port)
        override fun stop() { stopAction?.invoke() }
    }

    private class Host : TeslaBrowserLink.Host {
        val events = CopyOnWriteArrayList<String>()
        override fun log(message: String) = Unit
        override fun onBrowserFit() { events += "fit" }
        override fun onBrowserViewport(viewport: BrowserViewport) { events += "viewport:${viewport.videoCapabilities?.hevc}" }
        override fun onBrowserTheme(night: Boolean) { events += "theme:$night" }
        override fun onBrowserGone() { events += "gone" }
    }

    @Before fun setUp() {
        TeslaBrowserLink.resetForTest()
        BrowserAppearance.update(mapOf("themeDark" to false))
        context.getSharedPreferences("tiplay_browser_link", 0).edit().clear().commit()
        TeslaBrowserLink.serverFactory = TeslaBrowserLink.ServerFactory { _, callbacks -> newServer(callbacks) }
        TeslaBrowserLink.backoffMillis = { 60_000L }
    }

    @After fun tearDown() {
        servers.forEach { it.stopAction = null }
        TeslaBrowserLink.resetForTest()
        TeslaBrowserLink.serverFactory = TiPlayTestApplication.noSocketServers
        TeslaBrowserLink.backoffMillis = { failures -> minOf(30_000L, 1_000L shl minOf(failures, 5)) }
        BrowserAppearance.update(mapOf("themeDark" to false))
        context.getSharedPreferences("tiplay_browser_link", 0).edit().clear().commit()
    }

    private fun newServer(callbacks: BrowserLinkServer.Callbacks) =
        ControlledServer(callbacks, 8080 + servers.size).also { servers += it }

    private fun started(): ControlledServer {
        TeslaBrowserLink.start(context)
        assertTrue(TeslaBrowserLink.awaitIdle())
        return servers.last()
    }

    @Test fun retiredServerCannotRestoreReadinessOrReplaceTheCurrentPageProfile() {
        val old = started()
        old.callbacks.onBrowserSeen("old-page")
        old.callbacks.onViewport(report)
        assertEquals(report, TeslaBrowserLink.readyViewport())
        val observed = CopyOnWriteArrayList<BrowserViewport?>()
        TeslaBrowserLink.listenViewport(context, observed::add).use {
            old.stopAction = {
                old.callbacks.onBrowserSeen("old-page")
                old.callbacks.onViewport(report)
            }
            TeslaBrowserLink.onPortChanged()
            assertTrue(TeslaBrowserLink.awaitIdle())
            val current = servers.last()
            assertNotSame(old.callbacks, current.callbacks)
            assertNull(TeslaBrowserLink.readyViewport())
            assertNull(TeslaBrowserLink.receiverViewportSnapshot(context)?.videoCapabilities)
            assertNull(TeslaBrowserLink.receiverViewportSnapshot(context)?.audioCapabilities)
            assertEquals(report.size, TeslaBrowserLink.receiverViewportSnapshot(context)?.size)
            assertNull(old.callbacks.code())
            assertFalse(old.callbacks.onTouch(emptyList()))
            assertEquals(BrowserLinkStatus.State.IDLE, old.callbacks.status().state)
            current.callbacks.onBrowserSeen("new-page")
            current.callbacks.onViewport(currentReport)
            val notifications = observed.size
            old.callbacks.onBrowserSeen("old-page")
            old.callbacks.onViewport(report)
            old.callbacks.onBrowserGone("new-page")
            old.callbacks.onBrowserStats(mapOf("themeDark" to true))
            old.callbacks.onFit()
            old.callbacks.onKey("siri")
            shadowOf(Looper.getMainLooper()).idle()
            assertEquals(currentReport, TeslaBrowserLink.readyViewport())
            assertEquals(currentReport, TeslaBrowserLink.receiverViewportSnapshot(context))
            assertEquals(notifications, observed.size)
            assertFalse(BrowserAppearance.night)
        }
    }

    @Test fun callbacksDuringCreateAreRefusedAndFailedStartCannotRetainProbes() {
        TeslaBrowserLink.serverFactory = TeslaBrowserLink.ServerFactory { _, callbacks ->
            assertNull(callbacks.code())
            callbacks.onBrowserSeen("not-started")
            callbacks.onViewport(report)
            newServer(callbacks).also { server ->
                if (servers.size == 1) server.startAction = {
                    assertNotNull(callbacks.code())
                    callbacks.onBrowserSeen("failed-start")
                    callbacks.onViewport(report)
                    Result.failure(BindException("synthetic bind refusal"))
                }
            }
        }
        val failed = started()
        assertEquals(TeslaBrowserLink.State.PortInUse, TeslaBrowserLink.state)
        assertNull(TeslaBrowserLink.readyViewport())
        assertNull(TeslaBrowserLink.receiverViewportSnapshot(context)?.videoCapabilities)
        failed.callbacks.onBrowserSeen("failed-start")
        failed.callbacks.onViewport(report)
        assertNull(TeslaBrowserLink.readyViewport())
        TeslaBrowserLink.onPortChanged()
        assertTrue(TeslaBrowserLink.awaitIdle())
        val current = servers.last()
        assertEquals(TeslaBrowserLink.State.Listening(current.port), TeslaBrowserLink.state)
        assertNull(TeslaBrowserLink.readyViewport())
        current.callbacks.onBrowserSeen("ready-page")
        current.callbacks.onViewport(currentReport)
        assertEquals(currentReport, TeslaBrowserLink.readyViewport())
    }

    @Test fun queuedEffectsFromRetiredServerCannotReachTheCurrentHost() {
        val host = Host()
        TeslaBrowserLink.attachHost(host)
        shadowOf(Looper.getMainLooper()).idle()
        host.events.clear()
        val old = started()
        old.callbacks.onBrowserSeen("old-page")
        old.callbacks.onViewport(report)
        old.callbacks.onFit()
        old.callbacks.onBrowserStats(mapOf("themeDark" to true))
        TeslaBrowserLink.onPortChanged()
        assertTrue(TeslaBrowserLink.awaitIdle())
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(host.events.toString(), host.events.isEmpty())
        assertFalse(BrowserAppearance.night)
        val current = servers.last()
        current.callbacks.onBrowserSeen("new-page")
        current.callbacks.onViewport(currentReport)
        current.callbacks.onFit()
        current.callbacks.onBrowserStats(mapOf("themeDark" to true))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf("viewport:false", "fit", "theme:true"), host.events)
    }

    @Test fun queuedEffectsCannotCrossPageReplacementOrAReusedPageId() {
        val host = Host()
        TeslaBrowserLink.attachHost(host)
        shadowOf(Looper.getMainLooper()).idle()
        host.events.clear()
        val server = started()
        server.callbacks.onBrowserSeen("page")
        server.callbacks.onViewport(report)
        server.callbacks.onFit()
        server.callbacks.onBrowserStats(mapOf("themeDark" to true))
        server.callbacks.onBrowserGone("page")
        server.callbacks.onBrowserSeen("page")
        server.callbacks.onViewport(currentReport)
        server.callbacks.onBrowserGone("unrelated-old-page")
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf("viewport:false"), host.events)
        assertFalse(BrowserAppearance.night)
        assertEquals(currentReport, TeslaBrowserLink.readyViewport())
    }

    @Test fun queuedEffectsCaptureTheTargetHostInsteadOfUsingItsReplacement() {
        val oldHost = Host()
        TeslaBrowserLink.attachHost(oldHost)
        shadowOf(Looper.getMainLooper()).idle()
        oldHost.events.clear()
        val server = started()
        server.callbacks.onBrowserSeen("page")
        server.callbacks.onViewport(report)
        server.callbacks.onFit()
        server.callbacks.onBrowserStats(mapOf("themeDark" to true))
        val currentHost = Host()
        TeslaBrowserLink.attachHost(currentHost)
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(oldHost.events.toString(), oldHost.events.isEmpty())
        assertEquals(listOf("theme:false"), currentHost.events)
        assertFalse(BrowserAppearance.night)
    }

    @Test fun queuedEffectsCannotCrossDetachAndReattachOfTheSameHost() {
        val host = Host()
        TeslaBrowserLink.attachHost(host)
        shadowOf(Looper.getMainLooper()).idle()
        host.events.clear()
        val server = started()
        server.callbacks.onBrowserSeen("page")
        server.callbacks.onViewport(report)
        server.callbacks.onFit()
        server.callbacks.onBrowserStats(mapOf("themeDark" to true))
        TeslaBrowserLink.detachHost(host)
        TeslaBrowserLink.attachHost(host)
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf("theme:false"), host.events)
        assertFalse(BrowserAppearance.night)
        server.callbacks.onBrowserStats(mapOf("themeDark" to true))
        shadowOf(Looper.getMainLooper()).idle()
        assertEquals(listOf("theme:false", "theme:true"), host.events)
    }

    @Test fun viewportObserverCanQueueReplacementWithoutRepopulatingTheRetiredSource() {
        val server = started()
        server.callbacks.onBrowserSeen("old-page")
        val replaced = AtomicBoolean()
        TeslaBrowserLink.listenViewport(context) { value ->
            if (value?.videoCapabilities != null && replaced.compareAndSet(false, true))
                TeslaBrowserLink.onPortChanged()
        }.use {
            server.callbacks.onViewport(report)
            assertTrue(TeslaBrowserLink.awaitIdle())
            assertTrue(replaced.get())
            assertEquals(2, servers.size)
            assertNull(TeslaBrowserLink.readyViewport())
            server.callbacks.onViewport(report)
            assertNull(TeslaBrowserLink.receiverViewportSnapshot(context)?.videoCapabilities)
        }
    }

    @Test fun retirementLinearizesAfterAnAdmittedApplyAndPermanentlyRejectsItsToken() {
        val sources = BrowserCallbackSources()
        val source = BrowserCallbackSources.Source()
        val value = AtomicReference("initial")
        sources.activate(source) { value.set("empty") }
        val admitted = CountDownLatch(1)
        val apply = CountDownLatch(1)
        val retired = CountDownLatch(1)
        val failures = ConcurrentLinkedQueue<Throwable>()
        val callback = Thread({
            try { sources.run(source) {
                admitted.countDown()
                assertTrue(apply.await(5, TimeUnit.SECONDS))
                value.set("applied")
            } } catch (error: Throwable) { failures += error }
        }, "browser-source-admitted").apply { isDaemon = true; start() }
        assertTrue(admitted.await(5, TimeUnit.SECONDS))
        val retirement = Thread({
            try { sources.retire(source) { value.set("cleared") }; retired.countDown() }
            catch (error: Throwable) { failures += error }
        }, "browser-source-retire").apply { isDaemon = true; start() }
        try {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (source.accepting && System.nanoTime() < deadline) Thread.yield()
            assertFalse(source.accepting)
            assertEquals("retirement waits until the admitted effect completes", 1L, retired.count)
            assertEquals("empty", value.get())
        } finally {
            apply.countDown()
            callback.join(5_000)
            retirement.join(5_000)
        }
        assertFalse(callback.isAlive)
        assertFalse(retirement.isAlive)
        assertTrue(failures.toString(), failures.isEmpty())
        assertEquals(0L, retired.count)
        assertEquals("cleared", value.get())
        sources.run(source) { value.set("stale") }
        assertEquals("cleared", value.get())
        assertThrows(IllegalStateException::class.java) { sources.activate(source) {} }
        val current = BrowserCallbackSources.Source()
        sources.activate(current) {}
        sources.run(source) { value.set("old") }
        sources.run(current) { value.set("current") }
        assertEquals("current", value.get())
        sources.retire(current) {}
    }
}
