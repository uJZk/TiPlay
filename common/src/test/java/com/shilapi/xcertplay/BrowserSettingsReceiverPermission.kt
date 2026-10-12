package com.shilapi.xcertplay

import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

/** Robolectric library manifests omit AndroidX's generated internal receiver permission. */
internal fun grantBrowserSettingsReceiverPermission() {
    val application = RuntimeEnvironment.getApplication()
    shadowOf(application).grantPermissions(application.packageName + ".DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION")
}
