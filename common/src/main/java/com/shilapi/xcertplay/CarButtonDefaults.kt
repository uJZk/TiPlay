package com.shilapi.xcertplay

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.shilapi.xcertplay.host.R

/**
 * The default "back to car" button that CarPlay shows in its app list (/info oemIconLabel and oemIcons).
 *
 * Both modes use the packaged TiPlay logo (res/raw/ic_car_home.png). In phone + browser mode, while the driver
 * keeps the default label, CarPlay gets the label "TiPlay". A custom icon or label always
 * wins. Like the other /info fields, the button changes at the next CarPlay connection.
 */
internal object CarButtonDefaults {
    /** The label phone + browser mode sends instead of the head-unit default [AirPlayPersistence.DEFAULT_OEM_LABEL]. */
    const val PHONE_BROWSER_LABEL = "TiPlay"

    /** The size of the packaged head-unit icon, so the iPhone gets the same icon size in both modes. */
    const val ICON_SIZE_PX = 192

    /** The label CarPlay shows under the button: [saved], or "TiPlay" in phone + browser mode for the BYD default. */
    fun label(saved: String, phoneBrowser: Boolean): String =
        if (phoneBrowser && saved == AirPlayPersistence.DEFAULT_OEM_LABEL) PHONE_BROWSER_LABEL else saved

    /**
     * PNG bytes of the phone + browser icon, [ICON_SIZE_PX] square; null only if it cannot be read, so the
     * caller can keep its packaged icon instead of failing the connection.
     */
    fun phoneBrowserIconPng(context: Context): ByteArray? = runCatching {
        context.resources.openRawResource(R.raw.ic_car_home).use { it.readBytes() }
    }.getOrNull()

    /** The phone + browser icon, [ICON_SIZE_PX] square; null only if it cannot be decoded. */
    fun phoneBrowserIcon(context: Context): Bitmap? = runCatching {
        BitmapFactory.decodeResource(context.resources, R.raw.ic_car_home)
    }.getOrNull()
}
