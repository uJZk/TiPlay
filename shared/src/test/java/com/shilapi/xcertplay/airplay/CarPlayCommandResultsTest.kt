package com.shilapi.xcertplay.airplay

import org.junit.Assert.*
import org.junit.Test

class CarPlayCommandResultsTest {
    @Test fun writtenTransportAndCommandResultsAreDifferentFacts() {
        var now = 100L
        val results = CarPlayCommandResults(nowNanos = { now })
        val channel = results.open().first
        assertEquals(CarPlayCommandResults.Boundary.REQUEST, results.request(channel, 7, true).single().boundary)
        now = 200L
        assertEquals(CarPlayCommandResults.Boundary.WRITTEN, results.written(channel, 7).single().boundary)
        now = 300L
        val rejected = results.response(channel, response(7, 200, mapOf("status" to -7))).single()
        assertEquals(200, rejected.rtspStatus)
        assertEquals(-7L, rejected.commandStatus)
        assertEquals(CarPlayCommandResults.Result.REJECTED, rejected.result)
        assertEquals(200L, rejected.elapsedNanos)
        assertTrue(results.response(channel, response(7, 200, mapOf("status" to 0))).isEmpty())
    }

    @Test fun responseMayArriveBeforeTheWritingThreadReturns() {
        val results = CarPlayCommandResults()
        val channel = results.open().first
        results.request(channel, 1, true)
        val accepted = results.response(channel, response(1, 200, mapOf("status" to 0))).single()
        assertEquals(CarPlayCommandResults.Result.ACCEPTED, accepted.result)
        assertTrue(results.written(channel, 1).isEmpty())
        assertTrue(results.expire(channel).isEmpty())
    }

    @Test fun emptyMalformedAndMissingCommandStatusRemainUnknown() {
        val results = CarPlayCommandResults()
        val channel = results.open().first
        val payloads = listOf(ByteArray(0), byteArrayOf(1, 2, 3),
            BplistCodec.encode(mapOf("params" to mapOf("status" to 0))),
            BplistCodec.encode(mapOf("status" to "0")),
            BplistCodec.encode(mapOf("status" to 0.5)))
        for ((index, payload) in payloads.withIndex()) {
            results.request(channel, index, true)
            val event = results.response(channel, response(index, 200).copy(body = payload)).single()
            assertNull(event.commandStatus)
            assertEquals(CarPlayCommandResults.Result.UNKNOWN, event.result)
        }
        results.request(channel, 9, false)
        assertEquals(CarPlayCommandResults.Result.REJECTED,
            results.response(channel, response(9, 503, mapOf("status" to 0))).single().result)
    }

    @Test fun informationalAndUnrelatedResponsesCannotCompleteTheRequest() {
        val results = CarPlayCommandResults()
        val channel = results.open().first
        results.request(channel, 3, true)
        assertTrue(results.response(channel, response(3, 100)).isEmpty())
        assertTrue(results.response(channel, response(4, 200)).isEmpty())
        assertTrue(results.response(channel, response(3, 200).copy(headers = emptyMap())).isEmpty())
        assertTrue(results.response(channel, response(3, 200).copy(path = "not-status")).isEmpty())
        assertTrue(results.response(channel, response(3, 200).copy(method = "POST")).isEmpty())
        assertEquals(CarPlayCommandResults.Boundary.RESPONSE,
            results.response(channel, response(3, 200)).single().boundary)
    }

    @Test fun deadlineUsesTheOriginalMonotonicStartAndLateRepliesCannotCompleteSuccessors() {
        var now = 10L
        val results = CarPlayCommandResults(nowNanos = { now }, timeoutNanos = 50)
        val channel = results.open().first
        results.request(channel, 1, true)
        now = 59L
        results.written(channel, 1)
        assertTrue(results.expire(channel).isEmpty())
        now = 60L
        val timeout = results.response(channel, response(1, 200, mapOf("status" to 0))).single()
        assertEquals(CarPlayCommandResults.Boundary.TIMEOUT, timeout.boundary)
        results.request(channel, 2, false)
        assertTrue(results.response(channel, response(1, 200, mapOf("status" to 0))).isEmpty())
        assertFalse(results.response(channel, response(2, 200, mapOf("status" to 0))).single().borrowed)
    }

    @Test fun replacementAndClosedChannelsRejectOldCseqEvenWhenNumbersAreReused() {
        val results = CarPlayCommandResults()
        val old = results.open().first
        results.request(old, 1, true)
        val (current, cancelled) = results.open()
        assertEquals(CarPlayCommandResults.Boundary.CANCELLED, cancelled.single().boundary)
        results.request(current, 1, false)
        assertTrue(results.response(old, response(1, 200, mapOf("status" to 0))).isEmpty())
        assertTrue(results.close(old).isEmpty())
        assertEquals(CarPlayCommandResults.Boundary.RESPONSE,
            results.response(current, response(1, 200, mapOf("status" to 0))).single().boundary)
        results.request(current, 2, true)
        assertEquals(CarPlayCommandResults.Boundary.CANCELLED, results.close(current).single().boundary)
        assertTrue(results.request(current, 3, true).isEmpty())
        assertTrue(results.response(current, response(2, 200)).isEmpty())
        assertTrue(results.close(current).isEmpty())
    }

    @Test fun boundedCapacityAndFailedWritesRetireOnlyTheirOwnRecords() {
        val results = CarPlayCommandResults(capacity = 2)
        val channel = results.open().first
        results.request(channel, 1, true)
        results.request(channel, 2, false)
        val events = results.request(channel, 3, true)
        assertEquals(listOf(CarPlayCommandResults.Boundary.CAPACITY, CarPlayCommandResults.Boundary.REQUEST),
            events.map { it.boundary })
        assertEquals(listOf(1, 3), events.map { it.cseq })
        assertTrue(results.response(channel, response(1, 200)).isEmpty())
        assertEquals(CarPlayCommandResults.Boundary.WRITE_FAILED, results.failed(channel, 3).single().boundary)
        assertTrue(results.failed(channel, 3).isEmpty())
        assertEquals(listOf(2), results.close(channel).map { it.cseq })
    }

    @Test fun terminalRetirementRejectsRequestsFromAnActivationAlreadyInFlight() {
        val results = CarPlayCommandResults()
        val channel = results.open().first
        results.request(channel, 1, true)
        assertEquals(CarPlayCommandResults.Boundary.CANCELLED, results.retire().single().boundary)
        assertTrue(results.request(channel, 2, true).isEmpty())
        val late = results.open().first
        assertTrue(results.request(late, 3, false).isEmpty())
        assertTrue(results.response(late, response(3, 200)).isEmpty())
        assertTrue(results.retire().isEmpty())
    }

    private fun response(cseq: Int, status: Int, body: Map<String, Any?>? = null) = RtspMessage.Request(
        "RTSP/1.0", status.toString(), "OK", mapOf("cseq" to cseq.toString()),
        body?.let(BplistCodec::encode) ?: ByteArray(0),
    )
}
