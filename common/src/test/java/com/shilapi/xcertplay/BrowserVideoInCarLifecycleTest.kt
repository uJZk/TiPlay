package com.shilapi.xcertplay

import android.os.Looper
import com.shilapi.xcertplay.airplay.VideoInCar
import com.shilapi.xcertplay.receiver.ReceiverPlay
import com.shilapi.xcertplay.receiver.ReceiverPlayback
import com.shilapi.xcertplay.receiver.ReceiverResource
import com.shilapi.xcertplay.web.AirPlayBrowserPlayback
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
@LooperMode(LooperMode.Mode.PAUSED)
class BrowserVideoInCarLifecycleTest {
    private class FakePlayer(
        val resource: (String, String?) -> ReceiverResource?,
        val event: (String) -> Unit,
    ) : BrowserVideoInCar.Player {
        override var state = ReceiverPlayback(buffering = true)
        var closed = false
        var shown = true
        var output = false
        var rate = 0.0
        var initialRate = -1.0
        var initialPosition = -1.0
        var initialMuted = false
        var muted = false
        var seek = 0.0
        var closes = 0
        var throwOnClose = false
        override fun play(item: ReceiverPlay, initialRate: Double, initialMuted: Boolean): Boolean {
            this.initialRate = initialRate
            initialPosition = item.start
            this.initialMuted = initialMuted
            muted = initialMuted
            return true
        }
        override fun rate(value: Double): Boolean { rate = value; return true }
        override fun seek(seconds: Double) { seek = seconds }
        override fun property(name: String, value: Any?): Boolean {
            if (name != "muted" || value !is Boolean) return false
            muted = value
            return true
        }
        override fun setOutputAllowed(allowed: Boolean) { output = allowed }
        override fun setVideoShown(shown: Boolean) { this.shown = shown }
        override fun close() { closed = true; closes++; if (throwOnClose) error("close failed") }
    }

    private data class Loan(val owner: Any, val available: (Boolean) -> Unit)
    private val players = CopyOnWriteArrayList<FakePlayer>()
    private val loans = CopyOnWriteArrayList<Loan>()
    private val releases = CopyOnWriteArrayList<Any>()
    private val replies = LinkedBlockingQueue<Pair<Long, Map<String, Any?>>>()
    private val statuses = CopyOnWriteArrayList<String>()
    private lateinit var video: BrowserVideoInCar
    private var acceptSend = true

    private fun create(dispatch: ((Runnable) -> Unit)? = { it.run() },
                       borrow: ((Any, (Boolean) -> Unit) -> Unit)? = null) {
        video = BrowserVideoInCar({ stream, message ->
            if (acceptSend) replies.offer(stream to message)
            acceptSend
        }, BrowserVideoInCar.Dependencies(
            player = { resource, event -> FakePlayer(resource, event).also(players::add) },
            borrow = borrow ?: { owner, available -> loans += Loan(owner, available) },
            release = { owner -> releases += owner }, dispatchReply = dispatch)) { _, status ->
            statuses += status
            true
        }
    }

    @Before fun setup() { VideoInCar.allowed = true; create() }
    @After fun cleanup() { video.onVideoSessionEnded(); idle(); VideoInCar.allowed = false }
    private fun idle() { shadowOf(Looper.getMainLooper()).idle() }
    private fun message(type: String, fields: Map<String, Any?> = emptyMap(), stream: Long = 7) {
        video.onVideoMessage(stream, mapOf("type" to type) + fields)
        idle()
    }
    private fun insert(uuid: String = "one", stream: Long = 7) = message("insertPlayQueueItem",
        mapOf("item" to mapOf("uuid" to uuid, "Content-Location" to "https://example.test/$uuid.mp4",
            "Start-Position-Seconds" to 12.0)), stream)
    private fun start(uuid: String = "one", stream: Long = 7): FakePlayer {
        insert(uuid, stream)
        message("setRate", mapOf("rate" to 1.0), stream)
        return players.last()
    }
    private fun grant(loan: Loan = loans.last()) { loan.available(true); idle() }
    private fun nextReply() = requireNotNull(replies.poll(2, TimeUnit.SECONDS)).second
    private fun resourceId(message: Map<String, Any?>) =
        ((message["request"] as Map<*, *>)["FCUP_Response_RequestID"] as Number).toLong()
    private fun resourceReply(id: Long, stream: Long = 7, uuid: String = "one") = message("unhandledURL", mapOf(
        "kind" to "response", "item" to mapOf("uuid" to uuid), "response" to mapOf(
            "FCUP_Response_RequestID" to id, "FCUP_Response_StatusCode" to 200,
            "FCUP_Response_Data" to byteArrayOf(1, 2, 3))), stream)

    @Test fun aPendingLoanCannotShowThePictureAndOldCallbacksCannotRetireItsReplacement() {
        val old = start()
        val oldLoan = loans.single()
        assertFalse(old.output)
        assertFalse(old.shown)
        val replacement = start("two")
        val replacementLoan = loans.last()
        assertTrue(old.closed)
        assertEquals(listOf(oldLoan.owner), releases.toList())
        oldLoan.available(true)
        old.event("stopped")
        idle()
        assertFalse(replacement.output)
        assertFalse(replacement.closed)
        grant(replacementLoan)
        assertTrue(replacement.output)
        assertTrue(replacement.shown)
        assertEquals(1, releases.size)
    }

    @Test fun sessionEndFencesCommandsThatWereQueuedBeforeItAndAllowsTheNextSession() {
        video.onVideoMessage(7, mapOf("type" to "insertPlayQueueItem", "item" to mapOf(
            "uuid" to "one", "Content-Location" to "https://example.test/one.mp4")))
        video.onVideoMessage(7, mapOf("type" to "setRate", "rate" to 1.0))
        video.onVideoSessionEnded()
        idle()
        assertTrue(players.isEmpty())
        val next = start("new-session")
        grant()
        assertTrue(next.output)
        video.onVideoSessionEnded()
        idle()
        assertTrue(next.closed)
        assertEquals(1, next.closes)
        assertEquals(1, releases.size)
    }

    @Test fun anOldSessionEndAndOldPacketsCannotClearANewerSessionOrCompleteItsResource() {
        fun owned(type: String, fields: Map<String, Any?> = emptyMap(), generation: Long) {
            video.onVideoMessage(generation, 7, mapOf("type" to type) + fields)
            idle()
        }
        val item = { uuid: String -> mapOf("item" to mapOf("uuid" to uuid,
            "Content-Location" to "https://example.test/$uuid.mp4")) }
        video.onVideoSessionStarted(1)
        owned("insertPlayQueueItem", item("old"), 1)
        owned("setRate", mapOf("rate" to 1.0), 1)
        video.onVideoSessionStarted(2)
        owned("insertPlayQueueItem", item("new"), 2)
        owned("setRate", mapOf("rate" to 1.0), 2)
        val replacement = players.last()
        val worker = Executors.newSingleThreadExecutor()
        try {
            val pending = CompletableFuture.supplyAsync({ replacement.resource("https://example.test/new", null) }, worker)
            val id = resourceId(nextReply())
            video.onVideoSessionEnded(1)
            video.onVideoStreamEnded(1, 7)
            video.onVideoSessionStarted(1)
            video.onVideoUiRequested(1)
            owned("stop", generation = 1)
            val response = mapOf("kind" to "response", "item" to mapOf("uuid" to "new"),
                "response" to mapOf("FCUP_Response_RequestID" to id,
                    "FCUP_Response_StatusCode" to 200, "FCUP_Response_Data" to byteArrayOf(4)))
            owned("unhandledURL", response, 1)
            assertFalse(replacement.closed)
            assertFalse(pending.isDone)
            owned("unhandledURL", response, 2)
            assertArrayEquals(byteArrayOf(4), pending.get(2, TimeUnit.SECONDS)!!.bytes)
            assertEquals(2, loans.size)
        } finally { worker.shutdownNow() }
    }

    @Test fun aRetiredPlaybackStreamCannotReopenOrStopAnotherStream() {
        val old = start()
        video.onVideoStreamEnded(7)
        idle()
        assertTrue(old.closed)
        message("insertPlayQueueItem", mapOf("item" to mapOf("uuid" to "old",
            "Content-Location" to "https://example.test/stale.mp4")))
        message("setRate", mapOf("rate" to 1.0))
        assertEquals(1, players.size)
        val replacement = start("two", stream = 9)
        message("stop", stream = 7)
        assertFalse(replacement.closed)
        message("removePlayQueueItem", mapOf("uuid" to "old"), stream = 9)
        assertFalse(replacement.closed)
        message("stop", stream = 9)
        assertTrue(replacement.closed)
    }

    @Test fun audioOnlyReturnsThePictureButKeepsAudioAndNeedsANewGrantToShowAgain() {
        val player = start()
        val firstLoan = loans.single()
        grant(firstLoan)
        message("changeVideoPlaybackToAudioOnly")
        assertFalse(player.shown)
        assertTrue(player.output)
        assertFalse(player.closed)
        assertEquals(1.0, player.rate, 0.0)
        assertEquals(listOf(firstLoan.owner), releases.toList())
        assertEquals("audioOnly", statuses.last())
        player.event("playing")
        idle()
        assertEquals("audioOnly", statuses.last())
        firstLoan.available(false)
        idle()
        assertTrue(player.output)
        video.onVideoUiRequested()
        idle()
        assertEquals(2, loans.size)
        assertFalse(player.shown)
        assertTrue(player.output)
        grant()
        assertTrue(player.shown)
        assertEquals("video", statuses.last())
        firstLoan.available(false)
        idle()
        assertTrue(player.shown)
        message("stop")
        message("stop")
        assertEquals(2, releases.size)
        assertEquals(1, player.closes)
        assertEquals("idle", statuses.last())
    }

    @Test fun permissionChangesHideThePictureWithoutFakingAStoppedAudioClock() {
        val player = start()
        grant()
        video.onVideoAllowedChanged(false)
        idle()
        assertFalse(player.shown)
        assertTrue(player.output)
        assertFalse(player.closed)
        video.onVideoAllowedChanged(true)
        idle()
        assertFalse(player.shown)
        grant()
        assertTrue(player.shown)
    }

    @Test fun asynchronousFailureStillReturnsItsLoanIfPlayerCleanupThrows() {
        val player = start()
        player.throwOnClose = true
        player.event("failed")
        idle()
        assertEquals("error", nextReply()["type"])
        assertEquals(1, releases.size)
        assertEquals(1, player.closes)
        player.event("failed")
        video.onVideoSessionEnded()
        idle()
        assertTrue(replies.isEmpty())
        assertEquals(1, releases.size)
    }

    @Test fun aLoanFailureCleansThePartiallyAcquiredOwnerAndReportsIt() {
        create(borrow = { owner, available -> loans += Loan(owner, available); error("loan failed") })
        val player = start()
        assertTrue(player.closed)
        assertEquals(loans.single().owner, releases.single())
        assertEquals("error", nextReply()["type"])
    }

    @Test fun ordinaryUrlReplacementRetiresTheRealVideoPlayerBeforeAnAlreadyQueuedUiRequest() {
        TeslaBrowserLink.resetForTest()
        val actualLoans = CopyOnWriteArrayList<Loan>()
        val actualReleases = CopyOnWriteArrayList<Any>()
        video = BrowserVideoInCar({ _, message -> replies.offer(7L to message); true },
            BrowserVideoInCar.Dependencies(
                borrow = { owner, available -> actualLoans += Loan(owner, available) },
                release = { owner -> actualReleases += owner }, dispatchReply = { it.run() }))
        val ordinary = AirPlayCastPlayer({ _, _ -> null }) { _, _ -> }
        try {
            insert()
            message("setRate", mapOf("rate" to 1.0))
            val oldId = AirPlayBrowserPlayback.snapshot()!!["id"]
            actualLoans.single().available(true)
            idle()
            ordinary.play(ReceiverPlay("https://example.test/ordinary.mp4", 0.0, fraction = false))
            // O's registration retires V, but this UI task was queued before V's stopped callback.
            video.onVideoUiRequested()
            idle()
            val ordinaryId = AirPlayBrowserPlayback.snapshot()!!["id"]
            assertNotEquals(oldId, ordinaryId)
            assertEquals(1, actualLoans.size)
            assertEquals(1, actualReleases.size)
            ordinary.close()
            video.onVideoUiRequested()
            idle()
            assertNull(AirPlayBrowserPlayback.snapshot())
            assertEquals(1, actualLoans.size)
            insert("fresh")
            message("setRate", mapOf("rate" to 1.0))
            assertNotEquals(oldId, AirPlayBrowserPlayback.snapshot()!!["id"])
            assertEquals(2, actualLoans.size)
        } finally {
            ordinary.close()
            video.onVideoSessionEnded()
            idle()
            TeslaBrowserLink.resetForTest()
        }
    }

    @Test fun playbackInfoUsesMeasuredRatePositionAndDurationAndPreservesUnknownDuration() {
        val player = start()
        player.state = ReceiverPlayback(180.5, 45.2, 1.5, true, true, 46.7, true)
        message("playbackInfo", mapOf("kind" to "request", "messageID" to 10L))
        val info = nextReply()["info"] as Map<*, *>
        assertEquals(1.5, info["rate"])
        assertEquals(45_200L, (info["position"] as Map<*, *>)["value"])
        assertEquals(180_500L, (info["duration"] as Map<*, *>)["value"])
        assertEquals(false, info["playbackLikelyToKeepUp"])
        val loaded = (info["loadedTimeRanges"] as List<*>).single() as Map<*, *>
        assertEquals(45_200L, (loaded["start"] as Map<*, *>)["value"])
        assertEquals(1_500L, (loaded["duration"] as Map<*, *>)["value"])
        player.state = ReceiverPlayback(position = 70.0, rate = 1.0, ready = true, bufferedPosition = 72.0)
        message("playbackInfo", mapOf("kind" to "request", "messageID" to 11L))
        val live = nextReply()["info"] as Map<*, *>
        assertFalse(live.containsKey("duration"))
        assertEquals(emptyList<Any>(), live["seekableTimeRanges"])
    }

    @Test fun queuedPauseSeekAndMuteReachTheCreatedPlayerWithoutAnInitialAutoplay() {
        insert()
        message("setProperty", mapOf("property" to "muted", "value" to true))
        message("seek", mapOf("time" to VideoInCar.cmTime(45.0)))
        message("setRate", mapOf("rate" to 0.0))
        video.onVideoUiRequested()
        idle()
        val player = players.single()
        assertEquals(0.0, player.initialRate, 0.0)
        assertEquals(45.0, player.initialPosition, 0.0)
        assertTrue(player.initialMuted)
        assertEquals(0.0, player.rate, 0.0)
        assertTrue(player.muted)
        message("property", mapOf("property" to "muted", "kind" to "request", "messageID" to 12L))
        assertEquals(true, nextReply()["value"])
    }

    @Test fun wrongStreamAndOldItemResourceRepliesCannotCompleteTheCurrentLoad() {
        val player = start()
        val workers = Executors.newFixedThreadPool(2)
        try {
            val first = CompletableFuture.supplyAsync({ player.resource("https://example.test/a", null) }, workers)
            val firstId = resourceId(nextReply())
            resourceReply(firstId, stream = 9)
            assertFalse(first.isDone)
            val replacement = start("two")
            assertNull(first.get(2, TimeUnit.SECONDS))
            val second = CompletableFuture.supplyAsync({ replacement.resource("https://example.test/b", null) }, workers)
            val secondId = resourceId(nextReply())
            assertNotEquals(firstId, secondId)
            resourceReply(firstId)
            resourceReply(secondId, uuid = "one")
            assertFalse(second.isDone)
            resourceReply(secondId, uuid = "two")
            assertArrayEquals(byteArrayOf(1, 2, 3), second.get(2, TimeUnit.SECONDS)!!.bytes)
        } finally { workers.shutdownNow() }
    }

    @Test fun cancelledQueuedResourceRequestsAreNeverWrittenToTheNextSession() {
        val queued = LinkedBlockingQueue<Runnable>()
        create(dispatch = { queued.offer(it) })
        val player = start()
        while (true) (queued.poll() ?: break).run()
        val worker = Executors.newSingleThreadExecutor()
        try {
            val pending = CompletableFuture.supplyAsync({ player.resource("https://example.test/a", null) }, worker)
            val task = requireNotNull(queued.poll(2, TimeUnit.SECONDS))
            video.onVideoSessionEnded()
            idle()
            assertNull(pending.get(2, TimeUnit.SECONDS))
            start("new")
            task.run()
            assertTrue(replies.isEmpty())
        } finally { worker.shutdownNow() }
    }

    @Test fun sendFailureCancelsAResourceImmediatelyRatherThanWaitingForTheNetworkTimeout() {
        val player = start()
        acceptSend = false
        val worker = Executors.newSingleThreadExecutor()
        try {
            val pending = CompletableFuture.supplyAsync({ player.resource("https://example.test/a", null) }, worker)
            assertNull(pending.get(2, TimeUnit.SECONDS))
        } finally { worker.shutdownNow() }
    }

    @Test fun concurrentResourceLoadsAreBoundedAndEndingTheStreamCancelsEveryWaiter() {
        val player = start()
        val workers = Executors.newFixedThreadPool(33)
        val pending = mutableListOf<CompletableFuture<ReceiverResource?>>()
        try {
            repeat(32) { index ->
                pending += CompletableFuture.supplyAsync({ player.resource("https://example.test/$index", null) }, workers)
            }
            repeat(32) { assertEquals("unhandledURL", nextReply()["type"]) }
            val overflow = CompletableFuture.supplyAsync({ player.resource("https://example.test/overflow", null) }, workers)
            assertNull(overflow.get(2, TimeUnit.SECONDS))
            assertTrue(replies.isEmpty())
            video.onVideoStreamEnded(7)
            idle()
            pending.forEach { assertNull(it.get(2, TimeUnit.SECONDS)) }
            assertTrue(player.closed)
        } finally { workers.shutdownNow() }
    }
}
