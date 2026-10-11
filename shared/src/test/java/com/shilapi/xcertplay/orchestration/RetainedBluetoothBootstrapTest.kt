package com.shilapi.xcertplay.orchestration

import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RetainedBluetoothBootstrapTest {
    @Test fun shutdownReleasesResourcesInReverseOrderOnceAndRejectsLateConnectResources() {
        val bootstrap = RetainedBluetoothBootstrap()
        val closed = mutableListOf<String>()
        listOf("socket", "stream", "channel").forEach { name ->
            bootstrap.own(AutoCloseable { closed += name })
        }
        bootstrap.close()
        bootstrap.close()
        assertTrue(bootstrap.isClosed)
        assertEquals(listOf("channel", "stream", "socket"), closed)
        try {
            bootstrap.own(AutoCloseable { closed += "late socket" })
            fail("A connection finishing after shutdown must not become owned")
        } catch (_: IOException) {
            assertEquals(listOf("channel", "stream", "socket", "late socket"), closed)
        }
    }

    @Test fun failedChannelReleaseStillClosesTheUnderlyingBluetoothResources() {
        val bootstrap = RetainedBluetoothBootstrap()
        var socketClosed = false
        bootstrap.own(AutoCloseable { socketClosed = true })
        bootstrap.own(AutoCloseable { throw IOException("channel failed") })
        bootstrap.close()
        assertTrue(socketClosed)
    }

    @Test fun aConnectionFinishingDuringSlowChannelShutdownCannotPublishNewResources() {
        val bootstrap = RetainedBluetoothBootstrap()
        val closing = CountDownLatch(1)
        val release = CountDownLatch(1)
        val workers = Executors.newFixedThreadPool(2)
        bootstrap.own(AutoCloseable { closing.countDown(); check(release.await(2, TimeUnit.SECONDS)) })
        try {
            val shutdown = workers.submit { bootstrap.close() }
            assertTrue(closing.await(2, TimeUnit.SECONDS))
            val late = workers.submit<Boolean> {
                var resourceClosed = false
                try {
                    bootstrap.own(AutoCloseable { resourceClosed = true })
                    false
                } catch (_: IOException) { resourceClosed }
            }
            assertTrue(late.get(2, TimeUnit.SECONDS))
            release.countDown()
            shutdown.get(2, TimeUnit.SECONDS)
        } finally {
            release.countDown()
            workers.shutdownNow()
            bootstrap.close()
        }
    }
}
