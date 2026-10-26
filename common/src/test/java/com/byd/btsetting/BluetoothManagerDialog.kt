package com.byd.btsetting

import android.app.Activity

/**
 * Stands in for the activity BYD's own Bluetooth app declares, so Robolectric can launch the
 * component the way the head unit does. The package and class name have to match what
 * `openBluetoothSettings` targets; see docs/BYD-settings-entry-points.md.
 */
class BluetoothManagerDialog : Activity()
