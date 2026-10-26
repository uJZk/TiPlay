package com.shilapi.xcertplay

import com.shilapi.xcertplay.receiver.ReceiverDeviceTrust
import com.shilapi.xcertplay.web.AirPlayTrustNotifications
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AirPlayDeviceTrustStoreTest {
    private val app get() = RuntimeEnvironment.getApplication()
    @Before fun reset() { AirPlayDeviceTrustStore.forgetAll(app) }

    @Test fun trustSurvivesRecreationWithoutTouchingCarPlayOrBrowserPairing() {
        val key = ReceiverDeviceTrust.fingerprint(ByteArray(32) { it.toByte() })!!
        val pairing = app.getSharedPreferences("xcertplay_airplay", 0)
        pairing.edit().putString("pairing_id", "keep-carplay").putString("browser_pairing_code", "keep-browser").commit()
        AirPlayDeviceTrustStore(app).remember(key)
        assertTrue(AirPlayDeviceTrustStore(app).contains(key))
        AirPlayDeviceTrustStore.forgetAll(app)
        assertFalse(AirPlayDeviceTrustStore(app).contains(key))
        assertEquals("keep-carplay", pairing.getString("pairing_id", null))
        assertEquals("keep-browser", pairing.getString("browser_pairing_code", null))
    }

    @Test fun forgettingFromSettingsInvalidatesDelayedBrowserApproval() {
        val key = ByteArray(32) { it.toByte() }
        val trust = ReceiverDeviceTrust(AirPlayDeviceTrustStore(app)) { 0 }
        AirPlayTrustNotifications.attach(trust).use {
            trust.browserSeen("browser")
            val pending = trust.request(key, "iPhone") as ReceiverDeviceTrust.Decision.Pending
            AirPlayDeviceTrustStore.forgetAll(app)
            assertFalse(trust.respond("browser", pending.id, true))
            assertFalse(AirPlayDeviceTrustStore(app).contains(ReceiverDeviceTrust.fingerprint(key)!!))
        }
    }

    @Test fun resettingRevokesRememberedAndConnectionOnlyGrantsForTheRunningReceiver() {
        val key = ByteArray(32) { it.toByte() }
        val token = "receiver-generated-connection-token"
        val trust = ReceiverDeviceTrust(AirPlayDeviceTrustStore(app)) { 0 }
        AirPlayTrustNotifications.attach(trust).use {
            trust.browserSeen("browser")
            val remembered = trust.request(key, "iPhone") as ReceiverDeviceTrust.Decision.Pending
            assertTrue(trust.respond("browser", remembered.id, true))
            assertSame(ReceiverDeviceTrust.Decision.Allowed, trust.request(key, "iPhone"))
            val connection = trust.requestOnce(token, "Legacy sender") as ReceiverDeviceTrust.Decision.Pending
            assertTrue(trust.respond("browser", connection.id, true))
            assertSame(ReceiverDeviceTrust.Decision.Allowed, trust.requestOnce(token, "Legacy sender"))

            AirPlayDeviceTrustStore.forgetAll(app)

            assertFalse(AirPlayDeviceTrustStore(app).contains(ReceiverDeviceTrust.fingerprint(key)!!))
            assertTrue(trust.request(key, "iPhone") is ReceiverDeviceTrust.Decision.Pending)
            AirPlayDeviceTrustStore.forgetAll(app)
            assertTrue(trust.requestOnce(token, "Legacy sender") is ReceiverDeviceTrust.Decision.Pending)
        }
    }
}
