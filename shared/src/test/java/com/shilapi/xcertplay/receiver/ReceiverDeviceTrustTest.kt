package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class ReceiverDeviceTrustTest {
    private class Memory : ReceiverDeviceTrust.Store {
        val keys = mutableSetOf<String>()
        override fun contains(fingerprint: String) = fingerprint in keys
        override fun remember(fingerprint: String) { keys += fingerprint }
        override fun forgetAll() { keys.clear() }
    }
    private val key = ByteArray(32) { it.toByte() }

    @Test fun allowOnceCoversOnlyLiveConnectionsInTheSameVerifiedSession() {
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { 0 }
        trust.browserSeen("browser")
        val first = "0123456789abcdef-first"
        val second = "0123456789abcdef-second"
        val session = "11223344556677889900aabbccddeeff"
        val pending = trust.requestSession(first, key, "iPhone", "video", verifiedSessionId = session) as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", pending.id, true, remember = false))
        assertSame(ReceiverDeviceTrust.Decision.Allowed,
            trust.requestSession(second, key, "iPhone", "mirror", verifiedSessionId = session))
        assertTrue(store.keys.isEmpty())
        trust.endSession(first)
        assertSame(ReceiverDeviceTrust.Decision.Allowed,
            trust.requestSession(second, key, "iPhone", "audio", verifiedSessionId = session))
        trust.endSession(second)
        assertTrue(trust.requestSession("0123456789abcdef-third", key, "iPhone", "video", verifiedSessionId = session) is ReceiverDeviceTrust.Decision.Pending)
    }

    @Test fun allowOnceDoesNotAuthorizeAnotherKeyOrSession() {
        val trust = ReceiverDeviceTrust(Memory()) { 0 }
        trust.browserSeen("browser")
        val first = "0123456789abcdef-first"
        val session = "11223344556677889900aabbccddeeff"
        val pending = trust.requestSession(first, key, "iPhone", "video", verifiedSessionId = session) as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", pending.id, true, remember = false))
        assertTrue(trust.requestSession("0123456789abcdef-other", ByteArray(32) { 99 }, "iPhone", "video", verifiedSessionId = session) is ReceiverDeviceTrust.Decision.Pending)
        trust.forgetAll()
        val again = trust.requestSession(first, key, "iPhone", "video", verifiedSessionId = session) as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", again.id, true, remember = false))
        assertTrue(trust.requestSession("0123456789abcdef-next", key, "iPhone", "video", verifiedSessionId = "11223344556677889900aabbccddeefa") is ReceiverDeviceTrust.Decision.Pending)
    }

    @Test fun concurrentSameSessionAllowOnceDoesNotOpenASecondPrompt() {
        val trust = ReceiverDeviceTrust(Memory())
        trust.browserSeen("browser")
        val session = "11223344556677889900aabbccddeeff"
        val first = "0123456789abcdef-first"
        val second = "0123456789abcdef-second"
        val pending = trust.requestSession(first, key, "iPhone", "video", verifiedSessionId = session) as ReceiverDeviceTrust.Decision.Pending
        val done = CountDownLatch(1)
        val accepted = AtomicBoolean(false)
        val waiter = Thread {
            accepted.set(trust.authorizeSession(second, key, "iPhone", "mirror", verifiedSessionId = session))
            done.countDown()
        }
        waiter.start()
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(1)
        while (waiter.state != Thread.State.TIMED_WAITING && System.nanoTime() < deadline) Thread.yield()
        assertEquals(Thread.State.TIMED_WAITING, waiter.state)
        assertTrue(trust.respond("browser", pending.id, true, remember = false))
        trust.endSession(first)
        assertTrue(done.await(1, TimeUnit.SECONDS))
        assertTrue(accepted.get())
        assertNull(trust.prompt("browser"))
        trust.endSession(second)
        assertTrue(trust.requestSession("0123456789abcdef-third", key, "iPhone", "video", verifiedSessionId = session) is ReceiverDeviceTrust.Decision.Pending)
    }

    @Test fun rememberedClientIdDoesNotAutomaticallyTrustANewPublicKey() {
        val store = Memory()
        val client = ByteArray(32) { (it + 42).toByte() }
        store.remember(ReceiverDeviceTrust.fingerprint(client)!!)
        val trust = ReceiverDeviceTrust(store) { 0 }
        assertSame(ReceiverDeviceTrust.Decision.Allowed,
            trust.requestSession("0123456789abcdef-first", client, "iPhone", "video"))
        assertSame(ReceiverDeviceTrust.Decision.Denied,
            trust.requestSession("0123456789abcdef-second", key, "iPhone", "video"))
        assertFalse(store.contains(ReceiverDeviceTrust.fingerprint(key)!!))
        trust.browserSeen("browser")
        val request = trust.requestSession("0123456789abcdef-second", key, "iPhone", "video") as ReceiverDeviceTrust.Decision.Pending
        assertFalse(store.contains(ReceiverDeviceTrust.fingerprint(key)!!))
        assertTrue(trust.respond("browser", request.id, true, remember = true))
        assertSame(ReceiverDeviceTrust.Decision.Allowed,
            trust.requestSession("0123456789abcdef-third", key, "iPhone", "mirror"))
        assertTrue(store.contains(ReceiverDeviceTrust.fingerprint(key)!!))
    }

    @Test fun oneTimeClientIdApprovalDoesNotAuthorizeANewKeyOnTheSameConnection() {
        val trust = ReceiverDeviceTrust(Memory()) { 0 }
        val client = ByteArray(32) { (it + 42).toByte() }
        val token = "0123456789abcdef-first"
        trust.browserSeen("browser")
        val first = trust.requestSession(token, client, "iPhone", "video") as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", first.id, true, remember = false))
        assertSame(ReceiverDeviceTrust.Decision.Allowed, trust.requestSession(token, client, "iPhone", "video"))
        assertTrue(trust.requestSession(token, key, "iPhone", "video") is ReceiverDeviceTrust.Decision.Pending)
    }

    @Test fun concurrentSameKeyRequestsShareRememberedDecision() {
        val trust = ReceiverDeviceTrust(Memory())
        trust.browserSeen("browser")
        val first = trust.requestSession("0123456789abcdef-first", key, "iPhone", "video") as ReceiverDeviceTrust.Decision.Pending
        val result = AtomicBoolean(false)
        val done = CountDownLatch(1)
        Thread { result.set(trust.authorizeSession("0123456789abcdef-second", key, "iPhone", "video")); done.countDown() }.start()
        assertTrue(trust.respond("browser", first.id, true))
        assertTrue(done.await(1, TimeUnit.SECONDS))
        assertTrue(result.get())
        assertNull(trust.prompt("browser"))
    }

    @Test fun rememberedIdentityAuthorizesAllMediaTypesAcrossConnections() {
        for (identity in listOf(key, ByteArray(32) { (it + 84).toByte() })) {
            val trust = ReceiverDeviceTrust(Memory()) { 0 }
            trust.browserSeen("browser")
            val pending = trust.requestSession("0123456789abcdef-first", identity, "iPhone", "video") as ReceiverDeviceTrust.Decision.Pending
            assertTrue(trust.respond("browser", pending.id, true))
            trust.endSession("0123456789abcdef-first")
            for (type in listOf("video", "mirror", "audio")) {
                assertSame(ReceiverDeviceTrust.Decision.Allowed,
                    trust.requestSession("0123456789abcdef-$type", identity.copyOf(), "iPhone", type))
            }
        }
    }

    @Test fun noUnverifiedOrAbsentBrowserCanRequestTrust() {
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { 0 }
        assertSame(ReceiverDeviceTrust.Decision.Denied, trust.request(key, "iPhone"))
        trust.browserSeen("browser")
        assertSame(ReceiverDeviceTrust.Decision.Denied, trust.request(null, "iPhone"))
        assertSame(ReceiverDeviceTrust.Decision.Denied, trust.request(ByteArray(31), "iPhone"))
        assertNull(trust.prompt("browser"))
        assertTrue(store.keys.isEmpty())
    }

    @Test fun onlyPromptBrowserAndCurrentIdCanApproveAndTrustIsKeyBased() {
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { 0 }
        trust.browserSeen("browser")
        val first = trust.request(key, "My iPhone") as ReceiverDeviceTrust.Decision.Pending
        assertNull(trust.prompt("another browser"))
        assertFalse(trust.respond("another browser", first.id, true))
        assertFalse(trust.respond("browser", "stale-id", true))
        assertTrue(trust.respond("browser", first.id, true))
        assertFalse(trust.respond("browser", first.id, true))
        trust.browserGone("browser")
        assertSame(ReceiverDeviceTrust.Decision.Allowed, trust.request(key.copyOf(), "Renamed iPhone"))
        assertSame(ReceiverDeviceTrust.Decision.Denied, trust.request(ByteArray(32) { 99 }, "My iPhone"))
        assertEquals(setOf(ReceiverDeviceTrust.fingerprint(key)), store.keys)
    }

    @Test fun exactExpiryRejectsAllowAndRetransmitsCannotExtendOrReopenPrompt() {
        var now = 0L
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { now }
        trust.browserSeen("browser")
        val first = trust.request(key, "iPhone") as ReceiverDeviceTrust.Decision.Pending
        now = 4_999
        trust.browserSeen("browser")
        assertSame(first, trust.request(key, "iPhone"))
        assertEquals(1L, trust.prompt("browser")!!["remainingMillis"])
        now = 5_000
        assertFalse(trust.respond("browser", first.id, true))
        assertNull(trust.prompt("browser"))
        assertSame(ReceiverDeviceTrust.Decision.Denied, trust.request(key, "iPhone"))
        assertFalse(first.allowed)
        assertTrue(store.keys.isEmpty())
        now = 35_000
        trust.browserSeen("browser")
        val second = trust.request(key, "iPhone") as ReceiverDeviceTrust.Decision.Pending
        assertNotEquals(first.id, second.id)
        assertFalse(trust.respond("browser", first.id, true))
    }

    @Test fun rejectionSuppressesStormsAndDifferentPeerCannotHijackPendingRequest() {
        val trust = ReceiverDeviceTrust(Memory()) { 0 }
        trust.browserSeen("browser")
        val request = trust.request(key, "First") as ReceiverDeviceTrust.Decision.Pending
        assertSame(ReceiverDeviceTrust.Decision.Denied, trust.request(ByteArray(32) { 99 }, "First"))
        assertEquals(request.id, trust.prompt("browser")!!["id"])
        assertTrue(trust.respond("browser", request.id, false))
        repeat(20) { assertSame(ReceiverDeviceTrust.Decision.Denied, trust.request(key, "First")) }
    }

    @Test fun replacedOrDisconnectedBrowserCancelsAndDelayedApprovalCannotTrust() {
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { 0 }
        trust.browserSeen("old")
        val request = trust.request(key, "iPhone") as ReceiverDeviceTrust.Decision.Pending
        trust.browserSeen("new")
        assertFalse(trust.respond("old", request.id, true))
        assertFalse(trust.respond("new", request.id, true))
        assertNull(trust.prompt("new"))
        assertTrue(store.keys.isEmpty())
        trust.forgetAll()
        val next = trust.request(key, "iPhone") as ReceiverDeviceTrust.Decision.Pending
        trust.browserGone("new")
        assertFalse(trust.respond("new", next.id, true))
    }

    @Test fun staleBrowserCannotShowConsentOrLeaveAnApproachablePrompt() {
        var now = 0L
        val trust = ReceiverDeviceTrust(Memory()) { now }
        trust.browserSeen("browser")
        val request = trust.request(key, "iPhone") as ReceiverDeviceTrust.Decision.Pending
        now = ReceiverDeviceTrust.BROWSER_LIVE_MILLIS + 1
        assertNull(trust.prompt("browser"))
        assertFalse(trust.respond("browser", request.id, true))
        assertSame(ReceiverDeviceTrust.Decision.Denied, trust.request(ByteArray(32) { 99 }, "Another"))
    }

    @Test fun forgetAllClearsStoredTrustAndInvalidatesPendingApproval() {
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { 0 }
        trust.browserSeen("browser")
        val approved = trust.request(key, "iPhone") as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", approved.id, true))
        val waiting = trust.request(ByteArray(32) { 99 }, "Second") as ReceiverDeviceTrust.Decision.Pending
        trust.forgetAll()
        assertTrue(store.keys.isEmpty())
        assertFalse(trust.respond("browser", waiting.id, true))
        assertTrue(trust.request(key, "iPhone") is ReceiverDeviceTrust.Decision.Pending)
    }

    @Test fun blockedSenderIsReleasedOnApproveAndCloseWithoutWaitingForTimeout() {
        val trust = ReceiverDeviceTrust(Memory())
        trust.browserSeen("browser")
        val approved = AtomicBoolean(false)
        val finished = CountDownLatch(1)
        val thread = Thread { approved.set(trust.authorize(key, "iPhone")); finished.countDown() }
        val pending = trust.request(key, "iPhone") as ReceiverDeviceTrust.Decision.Pending
        thread.start()
        assertTrue(trust.respond("browser", pending.id, true))
        assertTrue(finished.await(1, TimeUnit.SECONDS))
        assertTrue(approved.get())

        val next = ByteArray(32) { 99 }
        val stopped = CountDownLatch(1)
        val denied = AtomicBoolean(false)
        val pendingNext = trust.request(next, "Other") as ReceiverDeviceTrust.Decision.Pending
        val stoppedThread = Thread { denied.set(!trust.authorize(next, "Other")); stopped.countDown() }
        stoppedThread.start()
        trust.close()
        assertTrue(stopped.await(1, TimeUnit.SECONDS))
        assertTrue(denied.get())
        assertFalse(trust.respond("browser", pendingNext.id, true))
    }

    @Test fun unverifiedLegacyConsentIsConnectionScopedAndNeverPersistsOrAliasesByName() {
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { 0 }
        val firstConnection = "0123456789abcdef-connection-one"
        val secondConnection = "0123456789abcdef-connection-two"
        trust.browserSeen("browser")
        val request = trust.requestOnce(firstConnection, "iPhone") as ReceiverDeviceTrust.Decision.Pending
        assertEquals(false, trust.prompt("browser")!!["verified"])
        assertTrue(trust.respond("browser", request.id, true))
        assertSame(ReceiverDeviceTrust.Decision.Allowed, trust.requestOnce(firstConnection, "Renamed"))
        assertTrue(store.keys.isEmpty())
        assertTrue(trust.requestOnce(secondConnection, "iPhone") is ReceiverDeviceTrust.Decision.Pending)
        trust.endSession(secondConnection)
        trust.endSession(firstConnection)
        trust.forgetAll() // clear the denial cooldown; the former grant must still be absent
        assertTrue(trust.requestOnce(firstConnection, "iPhone") is ReceiverDeviceTrust.Decision.Pending)
        assertTrue(store.keys.isEmpty())
    }

    @Test fun legacyTimeoutSuppressesRetryStormsAcrossNewConnectionsWithoutIpTrust() {
        var now = 0L
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { now }
        trust.browserSeen("browser")
        val first = trust.requestOnce("0123456789abcdef-first", "iPhone") as ReceiverDeviceTrust.Decision.Pending
        now = 5000
        trust.browserSeen("browser")
        assertFalse(trust.respond("browser", first.id, true))
        repeat(10) { assertSame(ReceiverDeviceTrust.Decision.Denied,
            trust.requestOnce("0123456789abcdef-retry-$it", "iPhone")) }
        assertTrue(store.keys.isEmpty())
        assertSame(ReceiverDeviceTrust.Decision.Denied, trust.requestOnce("169.254.0.1", "iPhone"))
    }
    @Test fun verifiedAllowOnceCannotBecomePermanentOrAuthorizeAnotherConnection() {
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { 0 }
        trust.browserSeen("browser")
        val token = "0123456789abcdef-first"
        val next = "0123456789abcdef-second"
        val pending = trust.requestSession(token, key, "iPhone", "audio") as ReceiverDeviceTrust.Decision.Pending
        assertEquals("audio", trust.prompt("browser")!!["mediaType"])
        assertEquals(true, trust.prompt("browser")!!["verified"])
        assertTrue(trust.respond("browser", pending.id, true, remember = false))
        assertTrue(store.keys.isEmpty())
        assertSame(ReceiverDeviceTrust.Decision.Allowed, trust.requestSession(token, key, "Renamed", "audio"))
        assertTrue(trust.requestSession(next, key, "iPhone", "audio") is ReceiverDeviceTrust.Decision.Pending)
        trust.endSession(next)
        trust.endSession(token)
        trust.forgetAll() // Cancellation suppresses retry prompts for the same stable identity.
        assertTrue(trust.requestSession(token, key, "iPhone", "audio") is ReceiverDeviceTrust.Decision.Pending)
    }

    @Test fun alwaysAllowUsesVerifiedKeyAndNeverPersistsConnectionTokens() {
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { 0 }
        trust.browserSeen("browser")
        val pending = trust.requestSession("0123456789abcdef-first", key, "iPhone", "mirror") as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", pending.id, true, remember = true))
        assertEquals(setOf(ReceiverDeviceTrust.fingerprint(key)), store.keys)
        trust.browserGone("browser")
        assertSame(ReceiverDeviceTrust.Decision.Allowed,
            trust.requestSession("0123456789abcdef-second", key, "Renamed", "mirror"))
    }

    @Test fun forgedAlwaysAllowForUnverifiedSenderIsOnlyConnectionScoped() {
        val store = Memory()
        val trust = ReceiverDeviceTrust(store) { 0 }
        trust.browserSeen("browser")
        val token = "0123456789abcdef-first"
        val pending = trust.requestSession(token, null, "iPhone", "audio") as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", pending.id, true, remember = true))
        assertTrue(store.keys.isEmpty())
        assertSame(ReceiverDeviceTrust.Decision.Allowed, trust.requestSession(token, null, "iPhone"))
        trust.endSession(token)
        trust.forgetAll()
        assertTrue(trust.requestSession(token, null, "iPhone") is ReceiverDeviceTrust.Decision.Pending)
    }

    @Test fun rejectedStableIdentityCannotReopenPromptsByChangingControlConnections() {
        val trust = ReceiverDeviceTrust(Memory()) { 0 }
        trust.browserSeen("browser")
        val pending = trust.requestSession("0123456789abcdef-first", key, "iPhone", "audio") as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", pending.id, false))
        assertSame(ReceiverDeviceTrust.Decision.Denied,
            trust.requestSession("0123456789abcdef-second", key, "Renamed", "audio"))
        trust.forgetAll()
        assertTrue(trust.requestSession("0123456789abcdef-third", key, "iPhone", "audio") is ReceiverDeviceTrust.Decision.Pending)
    }

    @Test fun verifiedOneTimeGrantEndsWithItsControlConnection() {
        val trust = ReceiverDeviceTrust(Memory()) { 0 }
        trust.browserSeen("browser")
        val token = "0123456789abcdef-first"
        val pending = trust.requestSession(token, key, "iPhone", "audio") as ReceiverDeviceTrust.Decision.Pending
        assertTrue(trust.respond("browser", pending.id, true, remember = false))
        trust.endSession(token)
        assertTrue(trust.requestSession(token, key, "iPhone", "audio") is ReceiverDeviceTrust.Decision.Pending)
    }

}
