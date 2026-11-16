// SPDX-License-Identifier: GPL-3.0-only
package com.shilapi.xcertplay.foregroundproof

import android.app.Activity
import android.app.ActivityManager
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.TextView
import androidx.core.content.ContextCompat

/** Only the initial visible launch is external; the application owns every later action. */
@android.annotation.TargetApi(36)
class ForegroundAdmissionProofActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var ready = false
    private var started = false
    private var resumed = false

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        val scenario = intent.getStringExtra("scenario") ?: ""
        val token = intent.getStringExtra("runToken") ?: ""
        setContentView(TextView(this).apply { text = "Foreground admission proof\nNo recording or Bluetooth" })
        Thread({
            ForegroundAdmissionJournal.initialize(applicationContext, scenario, token)
            handler.post { ready = true; if (resumed) ForegroundAdmissionJournal.uiResumed(true); maybeStart() }
        }, "fgs-proof-identity").start()
    }

    override fun onResume() { super.onResume(); resumed = true; if (ready) ForegroundAdmissionJournal.uiResumed(true); maybeStart() }
    override fun onStop() { resumed = false; if (ready) ForegroundAdmissionJournal.uiResumed(false); super.onStop() }
    override fun onWindowFocusChanged(focus: Boolean) { super.onWindowFocusChanged(focus); if (focus) maybeStart() }

    private fun maybeStart() {
        if (!ready || started || !resumed || !hasWindowFocus()) return
        val info = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(info)
        if (info.importance != ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND) {
            handler.postDelayed({ maybeStart() }, 50L); return
        }
        started = true
        val service = if (ForegroundAdmissionJournal.scenario == "background") ForegroundAdmissionGuardService::class.java else ForegroundAdmissionProbeService::class.java
        ContextCompat.startForegroundService(this, Intent(this, service))
        pollForOwnFinish()
    }

    private fun pollForOwnFinish() {
        val phase = ForegroundAdmissionJournal.phase
        val readyPhase = phase in setOf("positive-visible-armed", "negative-guard-visible", "missing-rejected-base-live")
        if (readyPhase && SystemClock.elapsedRealtime() - ForegroundAdmissionJournal.phaseAt >= 10_000L) finish()
        else if (!isFinishing) handler.postDelayed({ pollForOwnFinish() }, 100L)
    }

    override fun onDestroy() { handler.removeCallbacksAndMessages(null); super.onDestroy() }
}
