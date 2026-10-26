package com.shilapi.xcertplay.receiver

import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

class ReceiverDacpDiscoveryTest {
    private val peer = InetAddress.getByName("192.0.2.40")
    private val foreign = InetAddress.getByName("192.0.2.41")

    @Test fun advertisedDacpIdAndResolvedPeerMustBothMatchBeforeThePortIsUsable() {
        val directory = ReceiverDacpDirectory()
        val scope = Any()
        directory.attach(scope)
        directory.update(scope, "iTunes_Ctrl_00000000000000aB", listOf(foreign), 3689)
        assertNull(directory.endpoint("AB", peer))
        assertEquals(3689, directory.endpoint("000ab", foreign))
        directory.update(scope, "iTunes_Ctrl_00000000000000aB", listOf(peer, foreign), 3690)
        assertEquals(3690, directory.endpoint("AB", peer))
        assertNull(directory.endpoint("AC", peer))
        for (invalid in listOf("", "iTunes_Ctrl_AB", "AB.local.", "  AB", "AB\r\n", "10000000000000000"))
            assertNull(directory.endpoint(invalid, peer))
        directory.update(scope, "not-a-dacp-service-AC", listOf(peer), 3691)
        assertNull(directory.endpoint("AC", peer))
    }

    @Test fun retiredInterfacesAndInvalidUpdatesCannotKeepOrResurrectAnEndpoint() {
        val directory = ReceiverDacpDirectory()
        val first = Any()
        val next = Any()
        directory.attach(first)
        directory.update(first, "iTunes_Ctrl_1", listOf(peer), 3689)
        directory.attach(next)
        directory.update(next, "iTunes_Ctrl_1", listOf(peer), 3689)
        directory.retire(first)
        assertEquals(3689, directory.endpoint("1", peer))
        directory.update(first, "iTunes_Ctrl_1", listOf(peer), 7777)
        assertEquals(3689, directory.endpoint("1", peer))
        directory.remove(next, "ITUNES_CTRL_1")
        assertNull(directory.endpoint("1", peer))
        directory.update(next, "iTunes_Ctrl_1", listOf(peer), 3689)
        directory.update(next, "iTunes_Ctrl_1", listOf(peer), 0)
        assertNull(directory.endpoint("1", peer))
        directory.update(next, "iTunes_Ctrl_1", listOf(peer), 3689)
        directory.update(next, "iTunes_Ctrl_1", listOf(InetAddress.getByName("0.0.0.0")), 3689)
        assertNull(directory.endpoint("1", peer))
        directory.update(next, "iTunes_Ctrl_1", listOf(peer), 3689)
        directory.update(next, "iTunes_Ctrl_1", listOf(InetAddress.getByName("224.0.0.251")), 3689)
        assertNull(directory.endpoint("1", peer))
    }

    @Test fun conflictingPortsAreUnavailableUntilResolvedAndTheDirectoryIsBounded() {
        val directory = ReceiverDacpDirectory()
        val first = Any()
        val next = Any()
        directory.attach(first)
        directory.attach(next)
        directory.update(first, "iTunes_Ctrl_1", listOf(peer), 3689)
        directory.update(next, "iTunes_Ctrl_1", listOf(peer), 7777)
        assertNull(directory.endpoint("1", peer))
        directory.retire(next)
        assertEquals(3689, directory.endpoint("1", peer))
        for (id in 2..ReceiverDacpDirectory.MAX_ENTRIES)
            directory.update(first, "iTunes_Ctrl_${id.toString(16)}", listOf(peer), 3000 + id)
        val extraId = ReceiverDacpDirectory.MAX_ENTRIES + 1
        directory.update(first, "iTunes_Ctrl_${extraId.toString(16)}", listOf(peer), 9999)
        assertNull(directory.endpoint(extraId.toString(16), peer))
        // Updating an existing record still works when capacity is reached.
        directory.update(first, "iTunes_Ctrl_1", listOf(peer), 4444)
        assertEquals(4444, directory.endpoint("1", peer))
    }

    @Test fun capabilityChangeCallbacksRunAfterReleasingTheDirectoryLock() {
        lateinit var directory: ReceiverDacpDirectory
        var callbacks = 0
        directory = ReceiverDacpDirectory {
            // Another thread must be able to read the directory during notification.
            CompletableFuture.supplyAsync { directory.endpoint("AB", peer) }.get(1, TimeUnit.SECONDS)
            callbacks++
        }
        val scope = Any()
        directory.attach(scope)
        directory.update(scope, "iTunes_Ctrl_AB", listOf(peer), 3689)
        assertEquals(1, callbacks)
        directory.update(scope, "iTunes_Ctrl_AB", listOf(peer), 3689)
        assertEquals(1, callbacks)
        directory.remove(scope, "iTunes_Ctrl_AB")
        assertEquals(2, callbacks)
        directory.update(scope, "iTunes_Ctrl_AB", listOf(peer), 3689)
        directory.retire(scope)
        assertEquals(4, callbacks)
    }
}
