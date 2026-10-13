package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test

class AirPlaySeekCoalescerTest {
    @Test fun sliderBurstPerformsOnlyTheFinalSeekEvenIfRetiredCallbacksRun() {
        val tasks = mutableListOf<Runnable>()
        val applied = mutableListOf<Double>()
        val coalescer = AirPlaySeekCoalescer(schedule = { task, _ -> tasks += task },
            cancelScheduled = {}, seek = applied::add)
        repeat(28) { coalescer.request(it.toDouble()) }
        tasks.forEach(Runnable::run)
        assertEquals(listOf(27.0), applied)
    }

    @Test fun stoppingOrBrowserSeekingInvalidatesThePendingIphoneSeek() {
        val tasks = mutableListOf<Runnable>()
        val cancelled = mutableListOf<Runnable>()
        val applied = mutableListOf<Double>()
        val coalescer = AirPlaySeekCoalescer(schedule = { task, _ -> tasks += task },
            cancelScheduled = cancelled::add, seek = applied::add)
        coalescer.request(40.0)
        coalescer.cancel()
        tasks.first().run()
        assertTrue(applied.isEmpty())
        assertEquals(listOf(tasks.first()), cancelled)
        coalescer.request(80.0)
        tasks.last().run()
        assertEquals(listOf(80.0), applied)
    }
}
