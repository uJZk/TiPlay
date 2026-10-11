package com.shilapi.xcertplay.web

import java.util.concurrent.atomic.AtomicLong

/** Monotonic notification shared by the CarPlay callback and browser status responses. */
object BrowserPortalSignal {
    private val requests = AtomicLong()
    val revision: Long get() = requests.get()
    fun request() { requests.incrementAndGet() }
}
