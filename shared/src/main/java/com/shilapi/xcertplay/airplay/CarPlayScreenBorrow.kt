package com.shilapi.xcertplay.airplay

enum class CarPlayScreenOwner { Unknown, Controller, Accessory }

/** A command write requests ownership; only the iPhone's resource state confirms it. */
data class CarPlayScreenBorrowState(
    val desired: Boolean = false,
    val sent: Boolean? = null,
    val owner: CarPlayScreenOwner = CarPlayScreenOwner.Unknown,
    val pending: Boolean = false,
) {
    val confirmedBorrow: Boolean
        get() = desired && sent == true && owner == CarPlayScreenOwner.Accessory && !pending

    val carPlayHasScreen: Boolean
        get() = !desired && owner == CarPlayScreenOwner.Controller && !pending
}
/**
 * One main-screen loan in one CarPlay session. AirPlay retains CarPlay audio for mixed output.
 * modesChanged resource lists are incremental, so unrelated updates keep the screen owner.
 */
internal class CarPlayScreenBorrow(private val send: (Map<String, Any?>) -> Boolean) {
    private val stateLock = Any()
    private val deliveryLock = Any()
    private var desired = false
    private var sent: Boolean? = null
    private var owner = CarPlayScreenOwner.Unknown
    private var awaitingOwner = false
    private var returnNeeded = false
    private var eventReady = false
    private var closed = false
    private var generation = 0L
    private var ownershipRevision = 0L

    fun snapshot(): CarPlayScreenBorrowState = synchronized(stateLock) { snapshotLocked() }

    fun setDesired(borrowed: Boolean): CarPlayScreenBorrowState {
        synchronized(stateLock) {
            if (closed) return snapshotLocked()
            if (desired != borrowed) {
                desired = borrowed
                awaitingOwner = borrowed || returnNeeded
            }
        }
        flush()
        return snapshot()
    }

    fun setEventReady(ready: Boolean): CarPlayScreenBorrowState {
        synchronized(stateLock) {
            if (closed) return snapshotLocked()
            if (eventReady != ready) {
                eventReady = ready
                generation++
                if (!ready) {
                    sent = null
                    awaitingOwner = desired || returnNeeded
                }
            }
        }
        if (ready) flush()
        return snapshot()
    }

    fun onModesChanged(params: Map<String, Any?>): CarPlayScreenBorrowState {
        synchronized(stateLock) {
            if (closed) return snapshotLocked()
            val resource = (params["resources"] as? List<*>)?.lastOrNull { entry ->
                val id = (entry as? Map<*, *>)?.get("resourceID")
                id == "mainScreen" || (id is Number && id.toDouble() == 1.0)
            } as? Map<*, *> ?: return snapshotLocked()
            owner = when (val entity = resource["entity"]) {
                "controller" -> CarPlayScreenOwner.Controller
                "accessory" -> CarPlayScreenOwner.Accessory
                "n/a" -> CarPlayScreenOwner.Unknown
                is Number -> when (entity.toDouble()) {
                    0.0 -> CarPlayScreenOwner.Unknown
                    1.0 -> CarPlayScreenOwner.Controller
                    2.0 -> CarPlayScreenOwner.Accessory
                    else -> return snapshotLocked()
                }
                else -> return snapshotLocked()
            }
            ownershipRevision++
            if (sent == desired && owner != CarPlayScreenOwner.Unknown) {
                awaitingOwner = false
                if (!desired) returnNeeded = false
            }
            return snapshotLocked()
        }
    }

    fun close(): CarPlayScreenBorrowState = synchronized(stateLock) {
        closed = true
        generation++
        eventReady = false
        desired = false
        sent = null
        owner = CarPlayScreenOwner.Unknown
        awaitingOwner = false
        returnNeeded = false
        snapshotLocked()
    }

    private data class Delivery(val borrowed: Boolean, val generation: Long, val ownerRevision: Long)

    private fun flush() {
        synchronized(deliveryLock) {
            val delivery = synchronized(stateLock) {
                if (closed || !eventReady || sent == desired || (!desired && !returnNeeded)) return
                awaitingOwner = true
                Delivery(desired, generation, ownershipRevision)
            }
            // Socket writes may close the session synchronously. Never hold the state monitor here.
            val delivered = send(command(delivery.borrowed))
            synchronized(stateLock) {
                if (!delivered || closed || generation != delivery.generation) return
                sent = delivery.borrowed
                if (delivery.borrowed) returnNeeded = true
                val confirmedDuringWrite = ownershipRevision > delivery.ownerRevision &&
                    owner != CarPlayScreenOwner.Unknown
                awaitingOwner = desired != delivery.borrowed || !confirmedDuringWrite
                if (!delivery.borrowed && confirmedDuringWrite) returnNeeded = false
            }
        }
    }

    private fun snapshotLocked() = CarPlayScreenBorrowState(
        desired, sent, owner,
        awaitingOwner || (desired && sent != true) || (!desired && returnNeeded),
    )

    private fun command(borrowed: Boolean): Map<String, Any?> {
        val resource = linkedMapOf<String, Any?>(
            "resourceID" to 1,
            "transferType" to if (borrowed) 3 else 4,
        )
        if (borrowed) {
            resource["transferPriority"] = 500 // The driver selected AirPlay.
            resource["unborrowConstraint"] = 100 // Permit iOS resource preemption.
        }
        return linkedMapOf("type" to "changeModes", "params" to mapOf("resources" to listOf(resource)))
    }
}
