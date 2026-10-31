package com.shilapi.xcertplay.orchestration

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.ServiceConnection
import android.os.Looper
import com.shilapi.xcertplay.airplay.*
import com.shilapi.xcertplay.iap2.session.Iap2Session
import com.shilapi.xcertplay.mfi.MfiAuthenticator
import com.shilapi.xcertplay.network.*
import com.shilapi.xcertplay.transport.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.Mockito.*
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.util.ReflectionHelpers
import javax.jmdns.JmDNS

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class CarPlayWirelessOwnershipTest {
    private val statuses = mutableListOf<CarPlayStatus>()
    private fun controller(
        media: AirPlayMediaHandler = object : AirPlayMediaHandler {},
        binding: ((ServiceConnection) -> Boolean)? = null,
        unbinding: ((ServiceConnection) -> Unit)? = null,
    ): CarPlayController {
        val app = RuntimeEnvironment.getApplication()
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun bindService(service: Intent, conn: ServiceConnection, flags: Int) = binding?.invoke(conn) ?: false
            override fun unbindService(conn: ServiceConnection) {
                if (unbinding != null) unbinding(conn) else super.unbindService(conn)
            }
        }
        return CarPlayController(context,
            CarPlayRuntimeConfig(mfiTarget = MfiTarget.LOCAL, transport = CarPlayTransport.WIRELESS,
                headUnitIntegrations = false, identification = Iap2IdentificationConfig(
                    name = "test", modelIdentifier = "test", manufacturer = "test", serialNumber = "test",
                    firmwareVersion = "1", hardwareVersion = "1", carPlayUsbInterfaceNumber = 3)),
            AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480)),
            AirPlayIdentity(ByteArray(32), ByteArray(32), "test"), PairingStore(),
            object : AirPlaySessionListener {}, media, statuses::add).also { makeCurrent(it, 1) }
    }
    private fun makeCurrent(controller: CarPlayController, generation: Int) {
        ReflectionHelpers.getField<AtomicInteger>(controller, "wirelessGeneration").set(generation)
        val phase = controller.javaClass.getDeclaredField("phase").type.enumConstants.single { (it as Enum<*>).name == "WIRELESS" }
        ReflectionHelpers.setField(controller, "phase", phase)
    }
    private fun install(controller: CarPlayController, generation: Int) {
        val method = controller.javaClass.getDeclaredMethod("installWirelessTunnelHandler", Int::class.javaPrimitiveType,
            Iap2IdentificationConfig::class.java, Iap2WirelessCarPlayEndpoint::class.java, MfiAuthenticator::class.java)
        method.isAccessible = true
        assertEquals(true, method.invoke(controller, generation, mock(Iap2IdentificationConfig::class.java),
            mock(Iap2WirelessCarPlayEndpoint::class.java), mock(MfiAuthenticator::class.java)))
    }

    @Test fun aBindReturningAfterCloseUnbindsItsOwnConnectionAgain() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val connections = java.util.Collections.synchronizedList(mutableListOf<ServiceConnection>())
        var owner: ServiceConnection? = null
        val controller = controller(binding = { connection ->
            owner = connection; entered.countDown(); release.await(); true
        }, unbinding = { connections.add(it) })
        val bind = controller.javaClass.getDeclaredMethod("bindVpn").apply { isAccessible = true }
        val task = FutureTask<Any?> { bind.invoke(controller) }; val thread = Thread(task); thread.start()
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            controller.close(); assertTrue(controller.awaitClosed(3_000))
            release.countDown(); task.get(2, TimeUnit.SECONDS)
            assertTrue("The accepted late bind needs its own post-return unbind", connections.size >= 2)
            assertTrue(connections.all { it === owner })
            assertFalse(ReflectionHelpers.getField(controller, "vpnBound"))
            owner!!.onServiceConnected(android.content.ComponentName("test", "test"), mock(android.os.IBinder::class.java))
            assertNull(ReflectionHelpers.getField(controller, "vpnService"))
            assertSame(owner, connections.last())
        } finally { release.countDown(); thread.join(2_000); controller.close(); controller.awaitClosed(3_000) }
    }

    @Test fun capturedOldTunnelHandlerCannotEnterANewRun() {
        var handler: ((BlockingDuplexByteStream) -> Boolean)? = null
        val controller = controller(object : AirPlayMediaHandler {
            override fun setIapTunnelHandler(next: ((BlockingDuplexByteStream) -> Boolean)?) { handler = next }
        })
        try {
            install(controller, 1); val old = requireNotNull(handler)
            makeCurrent(controller, 2); install(controller, 2)
            val source = mock(BlockingDuplexByteStream::class.java)
            assertFalse(old(source)); verifyNoInteractions(source)
            assertNotSame(old, handler)
        } finally { controller.close(); assertTrue(controller.awaitClosed(3_000)) }
    }

    @Test fun lateOpenResultClosesItselfWithoutReplacingTheNewChannel() {
        val controller = controller()
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val oldChannel = mock(Iap2Session::class.java)
        val replacement = mock(Iap2Session::class.java)
        val owner = Any(); ReflectionHelpers.setField(controller, "wirelessTunnelHandlerOwner", owner)
        val open: () -> Iap2Session = { entered.countDown(); release.await(); oldChannel }
        val method = controller.javaClass.getDeclaredMethod("openCurrentWirelessTunnel", Int::class.javaPrimitiveType,
            Any::class.java, Class.forName("kotlin.jvm.functions.Function0")).apply { isAccessible = true }
        val task = FutureTask<Any?> { method.invoke(controller, 1, owner, open) }
        val thread = Thread(task); thread.start()
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            makeCurrent(controller, 2)
            ReflectionHelpers.setField(controller, "wirelessTunnelHandlerOwner", Any())
            ReflectionHelpers.setField(controller, "wirelessTunnelChannel", replacement)
            release.countDown()
            assertNull(task.get(2, TimeUnit.SECONDS))
            verify(oldChannel).close()
            verifyNoInteractions(replacement)
            assertSame(replacement, ReflectionHelpers.getField(controller, "wirelessTunnelChannel"))
        } finally {
            release.countDown(); thread.join(2_000)
            controller.close(); assertTrue(controller.awaitClosed(3_000))
        }
    }

    @Test fun aQueuedTunnelFailureCannotCrossGenerationOrOwnerReplacement() {
        val controller = controller()
        val method = controller.javaClass.getDeclaredMethod("postStatus", CarPlayStatus::class.java,
            Int::class.javaObjectType, Class.forName("kotlin.jvm.functions.Function0")).apply { isAccessible = true }
        var currentOwner = true
        val valid: () -> Boolean = { currentOwner }
        try {
            method.invoke(controller, CarPlayStatus.Failed("old generation"), 1, valid)
            makeCurrent(controller, 2); shadowOf(Looper.getMainLooper()).idle(); assertTrue(statuses.isEmpty())
            method.invoke(controller, CarPlayStatus.Failed("old channel"), 2, valid)
            currentOwner = false; shadowOf(Looper.getMainLooper()).idle(); assertTrue(statuses.isEmpty())
            currentOwner = true
            method.invoke(controller, CarPlayStatus.Failed("current"), 2, valid)
            shadowOf(Looper.getMainLooper()).idle(); assertEquals("current", (statuses.single() as CarPlayStatus.Failed).message)
        } finally { controller.close(); assertTrue(controller.awaitClosed(3_000)) }
    }

    @Test fun timedOutOldControllerKeepsItsRadioUntilLateRegistryCleanupCompletes() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val dns = mock(JmDNS::class.java)
        val app = RuntimeEnvironment.getApplication()
        val discovery = CarPlayBonjour(app,
            AirPlayConfig("test", "test", "", "1", AirPlayDisplayConfig(800, 480)),
            AirPlayIdentity(ByteArray(32), ByteArray(32), "test"), "192.0.2.10", true,
            createRegistry = { _, _ -> entered.countDown(); release.await(); dns })
        val old = controller(); val next = controller()
        val radio = requireNotNull(WirelessRadioOwnership.acquire())
        val hotspotClosed = CountDownLatch(1)
        ReflectionHelpers.setField(old, "wirelessRadioLease", radio)
        ReflectionHelpers.setField(old, "lastWirelessRadioLease", radio)
        ReflectionHelpers.setField(old, "bonjour", discovery)
        ReflectionHelpers.setField(old, "hotspot", object : WirelessHotspotManager {
            override fun start(timeoutMillis: Long): WirelessHotspotInfo = error("Not used")
            override fun close() { hotspotClosed.countDown() }
        })
        val startup = Thread { try { discovery.start() } catch (_: Exception) {} finally { radio.runFinished() } }
        startup.start()
        try {
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            old.close(); assertFalse(old.awaitClosed(30)); assertEquals(1L, hotspotClosed.count)
            assertNull(WirelessRadioOwnership.acquire())
            val run = next.javaClass.getDeclaredMethod("runWireless", Int::class.javaPrimitiveType).apply { isAccessible = true }
            run.invoke(next, 1); shadowOf(Looper.getMainLooper()).idle()
            assertTrue(statuses.filterIsInstance<CarPlayStatus.Failed>().any { it.message.contains("owner has not finished") })
            next.close(); assertTrue(next.awaitClosed(3_000)); assertNull(WirelessRadioOwnership.acquire())
            release.countDown(); startup.join(2_000)
            assertTrue(old.awaitClosed(4_000)); assertTrue(discovery.awaitClosed(2_000)); assertEquals(0L, hotspotClosed.count)
            verify(dns).close()
            verify(dns, never()).registerService(any())
            val replacement = requireNotNull(WirelessRadioOwnership.acquire())
            replacement.runFinished(); replacement.cleanupFinished()
        } finally {
            release.countDown(); startup.join(2_000); discovery.close()
            old.close(); next.close(); old.awaitClosed(4_000); next.awaitClosed(3_000)
        }
    }
}
