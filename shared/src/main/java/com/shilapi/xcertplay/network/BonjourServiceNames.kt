package com.shilapi.xcertplay.network

/** Deduplication is bounded independently of the pending work queue and expires failed candidates. */
internal class BonjourServiceNames(
    private val capacity: Int = 128,
    private val lifetimeNanos: Long = 60_000_000_000L,
    private val nanoTime: () -> Long = System::nanoTime,
) {
    private val names = LinkedHashMap<String, Long>()
    init { require(capacity > 0 && lifetimeNanos > 0) }
    @Synchronized fun add(name: String): Boolean {
        val now = nanoTime()
        names.entries.removeAll { now - it.value >= lifetimeNanos }
        if (name in names) return false
        if (names.size == capacity) names.remove(names.keys.first())
        names[name] = now
        return true
    }
    @Synchronized fun remove(name: String) { names.remove(name) }
    @Synchronized fun clear() = names.clear()
    @Synchronized internal fun size() = names.size
}
