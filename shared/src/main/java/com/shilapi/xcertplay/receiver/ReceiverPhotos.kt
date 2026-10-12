package com.shilapi.xcertplay.receiver

/** A bounded, session-scoped legacy AirPlay photo cache, not a slideshow scheduler. */
internal class ReceiverPhotos {
    private val images = LinkedHashMap<String, ByteArray>(8, 0.75f, true)
    private var bytes = 0

    fun receive(action: String?, key: String?, body: ByteArray): ByteArray? {
        require(action == null || action in listOf("cacheOnly", "displayCached"))
        if (action == "displayCached") return requireNotNull(images[requireNotNull(key)]) { "photo not cached" }
        require(body.size in 4..MAX_IMAGE_BYTES)
        val jpeg = body[0] == 0xff.toByte() && body[1] == 0xd8.toByte()
        val png = body.size >= 8 && body.copyOfRange(0, 8).contentEquals(byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))
        require(jpeg || png) { "unsupported photo format" }
        if (action == "cacheOnly") require(!key.isNullOrEmpty())
        if (key != null) {
            require(key.length in 1..256)
            bytes -= images.remove(key)?.size ?: 0
            while (images.size >= 8 || bytes + body.size > 4 * MAX_IMAGE_BYTES) {
                val oldest = images.entries.iterator()
                val entry = oldest.next(); bytes -= entry.value.size; oldest.remove()
            }
            images[key] = body.copyOf(); bytes += body.size
        }
        return if (action == "cacheOnly") null else body
    }

    companion object { const val MAX_IMAGE_BYTES = 1024 * 1024 }
}
