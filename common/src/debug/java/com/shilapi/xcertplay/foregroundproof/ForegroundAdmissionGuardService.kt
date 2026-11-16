// SPDX-License-Identifier: GPL-3.0-only
package com.shilapi.xcertplay.foregroundproof

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Binder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Process
import androidx.core.content.ContextCompat

/** A distinct base owner supplies BFSL, never microphone type or a binding exemption. */
@android.annotation.TargetApi(36)
class ForegroundAdmissionGuardService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var started = false
    private var stopping = false
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() { super.onCreate(); current = this; ForegroundAdmissionJournal.serviceCreated("guard") }
    override fun onStartCommand(intent: Intent?, flags: Int, id: Int): Int {
        if (started) return START_NOT_STICKY
        started = true
        startForeground(30_001, ForegroundAdmissionJournal.notification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        ForegroundAdmissionJournal.setPhase("negative-guard-visible", ForegroundAdmissionJournal.json("actualTypes" to foregroundServiceType))
        heartbeat()
        ForegroundAdmissionJournal.afterBackground(handler) {
            ForegroundAdmissionJournal.setPhase("negative-before-probe", ForegroundAdmissionJournal.json("guardTypes" to foregroundServiceType))
            handler.postDelayed({
                try {
                    ForegroundAdmissionJournal.event("app-handler-probe-dispatch", ForegroundAdmissionJournal.json(
                        "uid" to Process.myUid(), "binderCallingUid" to Binder.getCallingUid(), "guardTypes" to foregroundServiceType))
                    ContextCompat.startForegroundService(this, Intent(this, ForegroundAdmissionProbeService::class.java))
                } catch (error: RuntimeException) {
                    ForegroundAdmissionJournal.fail(if (error.javaClass.name == "android.app.ForegroundServiceStartNotAllowedException")
                        "background-start-frontgate-denied" else "probe-dispatch-failed")
                    stopOwned()
                }
            }, ForegroundAdmissionJournal.PHASE_HOLD_MS)
        }
        handler.postDelayed({ ForegroundAdmissionJournal.fail("guard-watchdog"); ForegroundAdmissionProbeService.stopOwned(); stopOwned() }, 180_000L)
        return START_NOT_STICKY
    }

    private fun heartbeat() {
        if (stopping) return
        ForegroundAdmissionJournal.event("guard-heartbeat", ForegroundAdmissionJournal.json("actualTypes" to foregroundServiceType))
        handler.postDelayed({ heartbeat() }, 2_000L)
    }

    private fun stopOwned() {
        if (stopping) return
        stopping = true; handler.removeCallbacksAndMessages(null)
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null); current = null
        ForegroundAdmissionJournal.serviceDestroyed("guard"); super.onDestroy()
    }

    companion object {
        private var current: ForegroundAdmissionGuardService? = null
        fun actualTypes(): Int? = current?.foregroundServiceType
        fun stopOwned() { current?.stopOwned() }
    }
}
