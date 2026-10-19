package com.shilapi.xcertplay.web

/** Native-free boundary so session ownership and authentication can be tested without loading JNI. */
interface BrowserRtcConnection : AutoCloseable {
    val id: Int
    fun answer(offerSdp: String, onAnswer: (String) -> Unit)
    fun authenticate()
    fun sendControl(message: String): Boolean
    fun sendVideo(record: WebVideoRecord): Boolean
    fun sendAudio(record: ByteArray): Boolean
    fun diagnostics(): Map<String, Any?> = emptyMap()
    override fun close()
}

fun interface BrowserRtcFactory {
    fun create(onControl: (String) -> Unit, onFailure: (String) -> Unit): BrowserRtcConnection
}
