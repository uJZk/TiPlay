package com.shilapi.xcertplay

import android.content.Intent
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AirPlayReceiverServiceTaskTest {
    @Test fun removingTheLaunchersEmptyTaskKeepsTheReceiverUntilTheHostTaskIsRemoved() {
        val service = Robolectric.buildService(AirPlayReceiverService::class.java).get()
        val context = RuntimeEnvironment.getApplication()
        service.onTaskRemoved(Intent(context, FirstUseActivity::class.java))
        assertFalse(shadowOf(service).isStoppedBySelf)
        service.onTaskRemoved(Intent(context, CarPlayHostActivity::class.java))
        assertTrue(shadowOf(service).isStoppedBySelf)
    }

    @Test fun removingAnUnspecifiedTaskRetainsTheExistingStopBehavior() {
        for (intent in listOf(null, Intent())) {
            val service = Robolectric.buildService(AirPlayReceiverService::class.java).get()
            service.onTaskRemoved(intent)
            assertTrue(shadowOf(service).isStoppedBySelf)
        }
    }
}
