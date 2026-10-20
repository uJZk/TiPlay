package com.shilapi.xcertplay.web

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

class BrowserRtcControlQueueTest {
    @Test fun ordinaryAckBurstDrainsWhileAnApplicationRpcIsBlockedAndKeepsCanonicalFifo() {
        val entered = CountDownLatch(1)
        val release = CountDownLatch(1)
        val consumed = CountDownLatch(300)
        val captured = CopyOnWriteArrayList<String>()
        val failures = LinkedBlockingQueue<String>()
        val credit = BrowserRtcCredit(300 * 24).apply { repeat(300) { sent(it, 24, 1) } }
        BrowserRtcControlQueue({ true }, { captured.add(String(it)) }, { fields ->
            assertTrue(credit.acknowledge(BrowserRtcProtocol.unsignedInt(fields["q"])!!, (fields["bytes"] as Number).toInt()))
            consumed.countDown()
        }, { entered.countDown(); release.await(); "response" }, { _, _ -> }, { reason, _ -> failures.add(reason) }).use { queue ->
            queue.offer(rpc(1)); assertTrue(entered.await(2, TimeUnit.SECONDS))
            repeat(300) { queue.offer(ack(it)) }
            assertTrue("Credit must not wait behind the application RPC", consumed.await(3, TimeUnit.SECONDS))
            assertEquals(0, credit.bytes)
            assertTrue(failures.isEmpty())
            assertEquals(listOf(String(rpc(1))) + (0 until 300).map { String(ack(it)) }, captured.toList())
            assertEquals("rpc", queue.snapshot()["rpcActiveKind"])
            release.countDown()
        }
    }

    @Test fun authenticationIsABarrierAndLaterCreditCannotOvertakeItsResponse() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1); val done = CountDownLatch(1)
        val authenticated = AtomicBoolean(false)
        val order = CopyOnWriteArrayList<String>(); val failures = LinkedBlockingQueue<String>()
        BrowserRtcControlQueue(authenticated::get, {}, {
            assertTrue(authenticated.get()); order.add("ack"); done.countDown()
        }, {
            order.add("auth-start"); entered.countDown(); release.await(); "hello"
        }, { _, _ -> order.add("auth-response"); authenticated.set(true) }, { reason, _ -> failures.add(reason) }).use { queue ->
            queue.offer(WebJson.write(mapOf("k" to "auth", "q" to 1)).toByteArray())
            assertTrue(entered.await(2, TimeUnit.SECONDS))
            queue.offer(ack(0))
            release.countDown()
            assertTrue(done.await(2, TimeUnit.SECONDS))
            assertEquals(listOf("auth-start", "auth-response", "ack"), order.toList())
            assertTrue(failures.isEmpty())
        }
    }

    @Test fun failedAuthenticationUnblocksTheIngressBarrierWithoutApplyingQueuedCredit() {
        val failure = LinkedBlockingQueue<String>(); val credits = AtomicLong()
        BrowserRtcControlQueue({ false }, {}, { credits.incrementAndGet() }, { error("authentication-rejected") },
            { _, _ -> fail("Rejected authentication must not respond") }, { reason, _ -> failure.add(reason) }).use { queue ->
            queue.offer(WebJson.write(mapOf("k" to "auth", "q" to 1)).toByteArray()); queue.offer(ack(0))
            assertEquals("control-protocol", failure.poll(2, TimeUnit.SECONDS)); assertEquals(0L, credits.get())
            assertEquals(true, queue.summary()["queueClosed"]); assertEquals(true, queue.summary()["failed"])
        }
    }

    @Test fun unauthenticatedOrForgedAcknowledgementsNeverReleaseRealCredit() {
        for (authenticated in listOf(false, true)) {
            val failures = LinkedBlockingQueue<String>()
            val credit = BrowserRtcCredit(24).apply { sent(Int.MIN_VALUE, 24, 1) }
            BrowserRtcControlQueue({ authenticated }, {}, { fields ->
                check(credit.acknowledge(BrowserRtcProtocol.unsignedInt(fields["q"])!!, (fields["bytes"] as Number).toInt())) { "ack-order" }
            }, { null }, { _, _ -> }, { reason, _ -> failures.add(reason) }).use { queue ->
                queue.offer(ack(if (authenticated) 0 else Int.MIN_VALUE))
                assertEquals("control-protocol", failures.poll(2, TimeUnit.SECONDS))
                assertEquals(24, credit.bytes)
            }
        }
        val done = CountDownLatch(1)
        val credit = BrowserRtcCredit(24).apply { sent(Int.MIN_VALUE, 24, 1) }
        BrowserRtcControlQueue({ true }, {}, { fields ->
            assertTrue(credit.acknowledge(BrowserRtcProtocol.unsignedInt(fields["q"])!!, 24)); done.countDown()
        }, { null }, { _, _ -> }, { reason, _ -> fail(reason) }).use { queue ->
            queue.offer(ack(Int.MIN_VALUE)); assertTrue(done.await(2, TimeUnit.SECONDS)); assertEquals(0, credit.bytes)
        }
    }

    @Test fun audioLeaseChangesStayBehindPriorApplicationWorkWhileCreditProgresses() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1)
        val acked = CountDownLatch(1); val leases = CountDownLatch(2)
        val order = CopyOnWriteArrayList<Boolean>(); val state = BrowserRtcAudioLease()
        state.request(true, 1); val old = state.current()!!
        BrowserRtcControlQueue({ true }, {}, { acked.countDown() }, { fields ->
            if (fields["k"] == "audio-ready") {
                val enabled = fields["enabled"] as Boolean
                state.request(enabled, BrowserRtcProtocol.unsignedInt(fields["generation"])!!)
                order.add(enabled); leases.countDown()
            } else { entered.countDown(); release.await() }
            null
        }, { _, _ -> }, { reason, _ -> fail(reason) }).use { queue ->
            queue.offer(rpc(1)); assertTrue(entered.await(2, TimeUnit.SECONDS))
            queue.offer(WebJson.write(mapOf("k" to "audio-ready", "enabled" to false, "generation" to 1)).toByteArray())
            queue.offer(WebJson.write(mapOf("k" to "audio-ready", "enabled" to true, "generation" to 2)).toByteArray())
            queue.offer(ack(0)); assertTrue(acked.await(2, TimeUnit.SECONDS))
            assertTrue(state.owns(old))
            release.countDown(); assertTrue(leases.await(2, TimeUnit.SECONDS))
            assertEquals(listOf(false, true), order.toList()); assertFalse(state.owns(old)); assertEquals(2, state.current()!!.generation)
        }
    }

    @Test fun closeDiscardsQueuedWorkAndACompletedOldRpcCannotPublishIntoAnotherOwner() {
        val entered = CountDownLatch(1); val release = CountDownLatch(1); val finished = CountDownLatch(1)
        val replies = CopyOnWriteArrayList<String>(); val invoked = CopyOnWriteArrayList<Long>()
        val queue = BrowserRtcControlQueue({ true }, {}, {}, { fields ->
            invoked.add((fields["q"] as Number).toLong()); entered.countDown()
            awaitIgnoringInterrupt(release); finished.countDown(); "old-owner"
        }, { _, response -> replies.add(response) }, { reason, _ -> fail(reason) })
        try {
            queue.offer(rpc(1)); assertTrue(entered.await(2, TimeUnit.SECONDS)); queue.offer(rpc(2))
            awaitCondition { (queue.snapshot()["rpcQueuedMessages"] as Number).toInt() == 1 }
            queue.close(); queue.offer(ack(0)); release.countDown(); assertTrue(finished.await(2, TimeUnit.SECONDS))
            awaitCondition { queue.snapshot()["rpcActiveKind"] == "none" }
            assertTrue(replies.isEmpty()); assertEquals(listOf(1L), invoked.toList())
            assertEquals(1, queue.snapshot()["abandonedRpcMessages"])
            val newReply = CountDownLatch(1)
            BrowserRtcControlQueue({ true }, {}, {}, { "new-owner" }, { _, response -> replies.add(response); newReply.countDown() }, { reason, _ -> fail(reason) }).use { next ->
                next.offer(rpc(1)); assertTrue(newReply.await(2, TimeUnit.SECONDS)); assertEquals(listOf("new-owner"), replies.toList())
            }
        } finally { release.countDown(); queue.close() }
    }

    @Test fun inboxBoundsAndRpcBoundsRemainExplicitAndPreserveAbandonedCaptureEvidence() {
        val capturing = CountDownLatch(1); val failure = LinkedBlockingQueue<String>()
        BrowserRtcControlQueue({ true }, { capturing.countDown(); CountDownLatch(1).await() }, {}, { null }, { _, _ -> },
            { reason, _ -> failure.add(reason) }, maxInboxBytes = 200, maxInboxMessages = 2).use { queue ->
            queue.offer(ack(0)); assertTrue(capturing.await(2, TimeUnit.SECONDS))
            queue.offer(ack(1)); queue.offer(ack(2)); queue.offer(ack(3))
            assertEquals("control-ingress-overload", failure.poll(2, TimeUnit.SECONDS))
            val evidence = queue.snapshot()
            assertEquals(2, evidence["terminalMessages"]); assertEquals(2L, evidence["abandonedMessages"])
            assertEquals(1L, evidence["rejectedMessages"]); assertEquals(0, evidence["queuedMessages"])
            assertTrue((evidence["abandonedBytes"] as Number).toLong() > 0)
        }
        val entered = CountDownLatch(1); val release = CountDownLatch(1); val rejected = LinkedBlockingQueue<String>()
        BrowserRtcControlQueue({ true }, {}, {}, { entered.countDown(); awaitIgnoringInterrupt(release); null }, { _, _ -> },
            { reason, _ -> rejected.add(reason) }, rpcCapacity = 1).use { queue ->
            queue.offer(rpc(1)); assertTrue(entered.await(2, TimeUnit.SECONDS)); queue.offer(rpc(2)); queue.offer(rpc(3))
            assertEquals("control-overload", rejected.poll(2, TimeUnit.SECONDS))
            assertEquals(1, queue.snapshot()["abandonedRpcMessages"]); release.countDown()
        }
    }

    @Test fun boundedDiagnosticsSeparateCaptureWaitParsingAndApplicationWorkWithoutPerAckText() {
        val now = AtomicLong(1); val acked = CountDownLatch(1); val replied = CountDownLatch(1)
        BrowserRtcControlQueue({ true }, { now.addAndGet(40_000_000) }, { now.addAndGet(2_000_000); acked.countDown() },
            { now.addAndGet(90_000_000); "ok" }, { _, _ -> replied.countDown() }, { reason, _ -> fail(reason) }, now::get).use { queue ->
            queue.offer(ack(0)); assertTrue(acked.await(2, TimeUnit.SECONDS)); queue.offer(rpc(1)); assertTrue(replied.await(2, TimeUnit.SECONDS))
            awaitCondition { queue.snapshot()["rpcActiveKind"] == "none" }
            val summary = queue.summary()
            assertFalse(summary.containsKey("kinds")); assertTrue(summary.size <= 8)
            assertTrue(WebJson.write(summary).toByteArray().size < 512)
            val lines = queue.diagnosticLines(7, "control-overload")
            val ack = lines.filter { it.contains("kind=ack ") }.joinToString(" ")
            val rpc = lines.filter { it.contains("kind=rpc ") }.joinToString(" ")
            assertTrue(ack, ack.contains("captureTotalMs=40.000") && ack.contains("workTotalMs=2.000"))
            assertTrue(rpc, rpc.contains("captureTotalMs=40.000") && rpc.contains("workTotalMs=90.000"))
            assertTrue(lines.all { it.length <= 600 && !it.contains('\n') })
            assertTrue(lines.all { it.contains("epoch=7") && it.contains("reason=control-overload") })
        }
    }

    @Test fun nativeControlMessageLimitRejectsBeforeCaptureAndLateOffersAfterCloseAreHarmless() {
        val captured = CopyOnWriteArrayList<ByteArray>(); val failure = LinkedBlockingQueue<String>()
        BrowserRtcControlQueue({ true }, captured::add, {}, { null }, { _, _ -> }, { reason, _ -> failure.add(reason) }).use { queue ->
            queue.offer(ByteArray(BrowserRtcControlQueue.MAX_MESSAGE_BYTES + 1))
            assertEquals("invalid-control", failure.poll(2, TimeUnit.SECONDS)); assertTrue(captured.isEmpty())
            queue.offer(ack(0)); assertTrue(captured.isEmpty())
        }
    }

    private fun ack(sequence: Int) = WebJson.write(mapOf("k" to "ack", "channel" to "video", "q" to (sequence.toLong() and 0xffff_ffffL), "bytes" to 24)).toByteArray()
    private fun rpc(sequence: Int) = WebJson.write(mapOf("q" to sequence, "e" to emptyList<Any>())).toByteArray()
    private fun awaitIgnoringInterrupt(latch: CountDownLatch) { while (true) try { latch.await(); return } catch (_: InterruptedException) {} }
    private fun awaitCondition(condition: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3)
        while (!condition() && System.nanoTime() < deadline) Thread.sleep(1)
        assertTrue("Condition did not complete before its bounded wait", condition())
    }
}
