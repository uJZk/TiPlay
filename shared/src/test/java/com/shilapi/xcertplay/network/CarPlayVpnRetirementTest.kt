package com.shilapi.xcertplay.network

import com.shilapi.xcertplay.airplay.*
import com.shilapi.xcertplay.glance.CarPlayGlance
import com.shilapi.xcertplay.orchestration.BrowserDisplayReconnect
import com.shilapi.xcertplay.orchestration.CarPlayController
import com.shilapi.xcertplay.orchestration.CarPlayRuntimeConfig
import com.shilapi.xcertplay.orchestration.CarPlayTransport
import com.shilapi.xcertplay.orchestration.FirstTcpWatchdog
import com.shilapi.xcertplay.orchestration.MfiTarget
import com.shilapi.xcertplay.receiver.readReceiverRequest
import com.shilapi.xcertplay.transport.Iap2IdentificationConfig
import java.io.Closeable
import java.io.IOException
import java.net.InetAddress
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
class CarPlayVpnRetirementTest {
    private val config = AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480), port = 0)
    private val identity = AirPlayIdentity(ByteArray(32), ByteArray(32), "test")
    private val address = InetAddress.getByName("127.0.0.1")

    @Test fun currentControllerCanRequestReconnectWhileItsRetiredSessionCallbackIsWaiting() {
        val callbackEntered = CountDownLatch(1)
        val releaseCallback = CountDownLatch(1)
        val observedLocks = AtomicReference<List<Boolean>>()
        lateinit var fixture: ControllerFixture
        fixture = ControllerFixture {
            observedLocks.set(heldLocks(fixture.service))
            callbackEntered.countDown()
            assertTrue(releaseCallback.await(3, TimeUnit.SECONDS))
        }
        val failure = AtomicReference<Throwable?>()
        val closer = worker("test-current-service-retirement", failure) { fixture.service.detachWireless(fixture.owner) }
        var requester: Thread? = null
        try {
            closer.start()
            assertTrue(callbackEntered.await(2, TimeUnit.SECONDS))
            // Check this before starting the competing Controller call. A regression fails
            // safely, releases the callback, and never creates an unbreakable monitor cycle.
            assertEquals(listOf(false, false, false), observedLocks.get())
            val result = AtomicReference<Boolean?>()
            requester = worker("test-current-controller-reconnect", failure) {
                result.set(fixture.controller.reconnectBrowserDisplay(config.main.copy(widthPixels = 1000)))
            }.also { it.start() }
            requester.join(2_000)
            assertFalse("The retired service must remain callable while its callback is waiting", requester.isAlive)
            assertEquals(false, result.get())
            releaseCallback.countDown()
            closer.join(2_000)
            assertFalse(closer.isAlive)
            failure.get()?.let { throw AssertionError("production retirement failed", it) }
            assertFalse(fixture.controller.isCurrentControlSession(fixture.session))
        } finally {
            releaseCallback.countDown()
            closer.join(2_000)
            requester?.join(2_000)
            fixture.close()
        }
    }

    @Test fun aRetirementCallbackCanInstallASuccessorThatAnOlderReplacementCannotRemove() = withService { service ->
        val first = AirPlayListenerIdentity(1)
        val requested = AirPlayListenerIdentity(2)
        val successor = AirPlayListenerIdentity(3)
        val successorAccepted = LinkedBlockingQueue<AirPlayTcpAccepted>()
        assertEquals(CarPlayVpnService.AttachResult.Started, attach(service, first))
        val nested = AtomicReference<CarPlayVpnService.AttachResult>()
        addSession(service, object : AirPlaySessionListener {
            override fun onSessionEnded(session: AirPlaySession) {
                assertEquals(listOf(false, false, false), heldLocks(service))
                nested.set(attach(service, successor, object : AirPlaySessionListener {
                    override fun onTcpAccepted(event: AirPlayTcpAccepted) { successorAccepted.add(event) }
                }))
            }
        })
        val superseded = attach(service, requested)
        assertTrue(superseded is CarPlayVpnService.AttachResult.Failed)
        assertEquals(CarPlayVpnService.AttachResult.Started, nested.get())
        service.detachWireless(first)
        service.detachWireless(requested)
        assertTrue(service.isAttached())
        Socket(address, service.boundPort()!!).use {
            assertSame(successor, successorAccepted.poll(2, TimeUnit.SECONDS)!!.listener)
        }
    }

    @Test fun onlyThePendingOwnerCanCancelAReplacementBeforeItPublishes() = withService { service ->
        val old = AirPlayListenerIdentity(1)
        val pending = AirPlayListenerIdentity(2)
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        assertEquals(CarPlayVpnService.AttachResult.Started, attach(service, old))
        addSession(service, object : AirPlaySessionListener {
            override fun onSessionEnded(session: AirPlaySession) {
                entered.countDown()
                assertTrue(release.await(3, TimeUnit.SECONDS))
            }
        })
        val result = AtomicReference<CarPlayVpnService.AttachResult>()
        val failure = AtomicReference<Throwable?>()
        val replacing = worker("test-pending-attachment", failure) { result.set(attach(service, pending)) }
        try {
            replacing.start()
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            service.detachWireless(old)
            assertSame(pending, ReflectionHelpers.getField<AirPlayListenerIdentity>(service, "pendingListenerIdentity"))
            service.detachWireless(pending)
            release.countDown()
            replacing.join(2_000)
            assertFalse(replacing.isAlive)
            failure.get()?.let { throw AssertionError("replacement failed", it) }
            assertTrue(result.get() is CarPlayVpnService.AttachResult.Failed)
            assertFalse(service.isAttached())
            assertEquals(CarPlayVpnService.AttachResult.Started, attach(service, AirPlayListenerIdentity(3)))
        } finally {
            release.countDown()
            replacing.join(2_000)
        }
    }

    @Test fun currentTransportErrorMayPublishASuccessorAndAStaleErrorCannotRetireIt() = withService { service ->
        val first = AirPlayListenerIdentity(1)
        val successor = AirPlayListenerIdentity(2)
        val notified = CountDownLatch(1)
        val callbackThread = AtomicReference<Thread>()
        val callbacks = AtomicInteger()
        val accepted = LinkedBlockingQueue<AirPlayTcpAccepted>()
        val nested = AtomicReference<CarPlayVpnService.AttachResult>()
        val listener = object : AirPlaySessionListener {
            override fun onTransportError(message: String) {
                assertEquals(listOf(false, false, false), heldLocks(service))
                callbacks.incrementAndGet()
                callbackThread.set(Thread.currentThread())
                nested.set(attach(service, successor, object : AirPlaySessionListener {
                    override fun onTcpAccepted(event: AirPlayTcpAccepted) { accepted.add(event) }
                }))
                notified.countDown()
            }
        }
        assertEquals(CarPlayVpnService.AttachResult.Started, attach(service, first, listener))
        val oldGeneration: Int = ReflectionHelpers.getField(service, "attachGeneration")
        transportError(service, oldGeneration, listener)
        assertTrue(notified.await(2, TimeUnit.SECONDS))
        callbackThread.get().join(2_000)
        assertFalse(callbackThread.get().isAlive)
        assertEquals(CarPlayVpnService.AttachResult.Started, nested.get())
        assertFalse(shadowOf(service).isStoppedBySelf)

        // Hold the service monitor only to identify the asynchronous stale-error worker before
        // it can finish; then release it and join. No production monitor is replaced by a fake.
        lateinit var stale: Thread
        synchronized(service) {
            val known = Thread.getAllStackTraces().keys.toSet()
            transportError(service, oldGeneration, listener)
            stale = awaitThread { it !in known && it.name == "airplay-teardown" && it.state == Thread.State.BLOCKED }
        }
        stale.join(2_000)
        assertFalse(stale.isAlive)
        assertEquals(1, callbacks.get())
        assertTrue(service.isAttached())
        Socket(address, service.boundPort()!!).use {
            assertSame(successor, accepted.poll(2, TimeUnit.SECONDS)!!.listener)
        }
    }

    @Test fun anAcceptObserverCanReplaceItsListenerAndTheSuccessorStillAnswers() = withService { service ->
        val old = AirPlayListenerIdentity(1)
        val successor = AirPlayListenerIdentity(2)
        val changed = CountDownLatch(1)
        val retired = AtomicReference<AirPlaySession>()
        val nested = AtomicReference<CarPlayVpnService.AttachResult>()
        val accepted = LinkedBlockingQueue<AirPlayTcpAccepted>()
        assertEquals(CarPlayVpnService.AttachResult.Started, attach(service, old, object : AirPlaySessionListener {
            override fun onTcpAccepted(event: AirPlayTcpAccepted) {
                assertEquals(listOf(false, false, false), heldLocks(service))
                val lock: Any = ReflectionHelpers.getField(service, "sessionsLock")
                synchronized(lock) { retired.set(sessions(service).single()) }
                nested.set(attach(service, successor, object : AirPlaySessionListener {
                    override fun onTcpAccepted(event: AirPlayTcpAccepted) { accepted.add(event) }
                }))
                changed.countDown()
            }
        }))
        Socket(address, service.boundPort()!!).use { oldPeer ->
            oldPeer.soTimeout = 2_000
            assertTrue(changed.await(2, TimeUnit.SECONDS))
            assertEquals(CarPlayVpnService.AttachResult.Started, nested.get())
            assertTrue(retired.get().isClosed)
            val ended = runCatching { oldPeer.getInputStream().read() }
            assertTrue(ended.fold({ it == -1 }, { it is SocketException }))
        }
        Socket(address, service.boundPort()!!).use { peer ->
            peer.soTimeout = 2_000
            assertSame(successor, accepted.poll(2, TimeUnit.SECONDS)!!.listener)
            peer.getOutputStream().apply {
                write("GET /info RTSP/1.0\r\nCSeq: 1\r\nContent-Length: 0\r\n\r\n".toByteArray())
                flush()
            }
            assertEquals("200", requireNotNull(readReceiverRequest(peer.getInputStream())).path)
        }
    }

    private inner class ControllerFixture(onMediaClosed: () -> Unit) : Closeable {
        val service = Robolectric.buildService(CarPlayVpnService::class.java).create().get()
        val owner = AirPlayListenerIdentity(1)
        val watchdog = FirstTcpWatchdog(owner, { _, _ -> {} }, {})
        private val priorGlanceListener = CarPlayGlance.listener
        val controller: CarPlayController
        val session: AirPlaySession
        init {
            CarPlayGlance.listener = null
            controller = CarPlayController(RuntimeEnvironment.getApplication(),
                CarPlayRuntimeConfig(mfiTarget = MfiTarget.LOCAL, transport = CarPlayTransport.WIRELESS,
                    headUnitIntegrations = false, identification = Iap2IdentificationConfig(
                        "test", "test", "test", "test", "1", "1", 3)),
                config, identity, PairingStore(), object : AirPlaySessionListener {}, object : AirPlayMediaHandler {}, {})
            val generation: AtomicInteger = ReflectionHelpers.getField(controller, "wirelessGeneration")
            generation.set(1)
            val phase = CarPlayController::class.java.getDeclaredField("phase").apply { isAccessible = true }
            phase.set(controller, requireNotNull(phase.type.enumConstants).single { (it as Enum<*>).name == "WIRELESS" })
            ReflectionHelpers.setField(controller, "vpnService", service)
            ReflectionHelpers.setField(controller, "firstTcpWatchdog", watchdog)
            val method = CarPlayController::class.java.getDeclaredMethod("wirelessSessionListener",
                Int::class.javaPrimitiveType, FirstTcpWatchdog::class.java).apply { isAccessible = true }
            val listener = method.invoke(controller, 1, watchdog) as AirPlaySessionListener
            assertEquals(CarPlayVpnService.AttachResult.Started, attach(service, owner, listener))
            session = AirPlaySession(Socket(), config, identity, PairingStore(), null, listener,
                object : AirPlayMediaHandler {
                    override fun onSessionClosed(session: AirPlaySession) { onMediaClosed() }
                })
            val lock: Any = ReflectionHelpers.getField(service, "sessionsLock")
            synchronized(lock) { sessions(service).add(session) }
            listener.onSessionActive(session)
            val pending: BrowserDisplayReconnect = ReflectionHelpers.getField(controller, "browserDisplayReconnect")
            assertTrue(pending.begin(session, null))
        }

        override fun close() {
            watchdog.terminate()
            ReflectionHelpers.setField(controller, "firstTcpWatchdog", null)
            service.detach()
            session.close()
            ReflectionHelpers.setField(controller, "vpnService", null)
            controller.close()
            assertTrue(controller.awaitClosed(2_000))
            CarPlayGlance.listener = priorGlanceListener
        }
    }

    private fun attach(service: CarPlayVpnService, owner: AirPlayListenerIdentity,
        listener: AirPlaySessionListener = object : AirPlaySessionListener {}): CarPlayVpnService.AttachResult =
        service.attachWireless(address, config, identity, PairingStore(), null, listener,
            object : AirPlayMediaHandler {}, listenerIdentity = owner)

    private fun addSession(service: CarPlayVpnService, listener: AirPlaySessionListener): AirPlaySession {
        val session = AirPlaySession(Socket(), config, identity, PairingStore(), null, listener, object : AirPlayMediaHandler {})
        val lock: Any = ReflectionHelpers.getField(service, "sessionsLock")
        synchronized(lock) { sessions(service).add(session) }
        return session
    }

    private fun sessions(service: CarPlayVpnService): MutableSet<AirPlaySession> = ReflectionHelpers.getField(service, "sessions")

    private fun heldLocks(service: CarPlayVpnService): List<Boolean> = listOf(
        Thread.holdsLock(service),
        Thread.holdsLock(ReflectionHelpers.getField<Any>(service, "sessionsLock")),
        Thread.holdsLock(ReflectionHelpers.getField<Any>(service, "startupLock")),
    )

    private fun transportError(service: CarPlayVpnService, generation: Int, listener: AirPlaySessionListener) {
        val method = CarPlayVpnService::class.java.getDeclaredMethod("onTransportError", Int::class.javaPrimitiveType,
            AirPlaySessionListener::class.java, Throwable::class.java).apply { isAccessible = true }
        method.invoke(service, generation, listener, IOException("synthetic transport failure"))
    }

    private fun worker(name: String, failure: AtomicReference<Throwable?>, action: () -> Unit): Thread =
        Thread({ try { action() } catch (error: Throwable) { failure.compareAndSet(null, error) } }, name).apply { isDaemon = true }

    private fun awaitThread(predicate: (Thread) -> Boolean): Thread {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
        while (System.nanoTime() < deadline) {
            Thread.getAllStackTraces().keys.firstOrNull(predicate)?.let { return it }
            Thread.yield()
        }
        throw AssertionError("Expected service worker did not reach its bounded monitor barrier")
    }

    private fun withService(test: (CarPlayVpnService) -> Unit) {
        val service = Robolectric.buildService(CarPlayVpnService::class.java).create().get()
        try { test(service) } finally { service.detach() }
    }
}
