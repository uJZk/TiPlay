// SPDX-License-Identifier: GPL-3.0-only
package com.shilapi.xcertplay.foregroundproof

import android.Manifest
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.shilapi.xcertplay.SessionForegroundStart

/** Exercises the real common helper against real platform calls; never opens audio input. */
@android.annotation.TargetApi(36)
class ForegroundAdmissionProbeService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var started = false
    private var stopping = false
    private var microphoneRejections = 0
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() { super.onCreate(); current = this; ForegroundAdmissionJournal.serviceCreated("probe") }
    override fun onStartCommand(intent: Intent?, flags: Int, id: Int): Int {
        if (started) return START_NOT_STICKY
        started = true
        handler.postDelayed({ ForegroundAdmissionJournal.fail("probe-watchdog"); stopOwned() }, 180_000L)
        when (ForegroundAdmissionJournal.scenario) {
            "positive" -> {
                if (!attempt(BASE) || !attempt(BASE or MIC) || foregroundServiceType != (BASE or MIC)) return fail("visible-microphone-not-admitted")
                ForegroundAdmissionJournal.setPhase("positive-visible-armed", details())
                ForegroundAdmissionJournal.afterBackground(handler) {
                    if (foregroundServiceType != (BASE or MIC)) { fail("background-microphone-not-retained"); return@afterBackground }
                    ForegroundAdmissionJournal.setPhase("positive-background-retained", details())
                    handler.postDelayed({
                        if (!attempt(BASE) || foregroundServiceType != BASE) { fail("microphone-downgrade-failed"); return@postDelayed }
                        ForegroundAdmissionJournal.setPhase("positive-background-downgraded", details())
                        handler.postDelayed({ finishNormally() }, ForegroundAdmissionJournal.PHASE_HOLD_MS)
                    }, ForegroundAdmissionJournal.PHASE_HOLD_MS)
                }
            }
            "background", "missing" -> {
                if (!attempt(BASE or MIC) || microphoneRejections != 1 || foregroundServiceType != BASE)
                    return fail("optional-microphone-denial-not-observed")
                if (ForegroundAdmissionJournal.scenario == "background" && ForegroundAdmissionGuardService.actualTypes() != BASE)
                    return fail("guard-base-interrupted")
                ForegroundAdmissionJournal.setPhase(if (ForegroundAdmissionJournal.scenario == "background")
                    "negative-mic-rejected-base-live" else "missing-rejected-base-live", details())
                handler.postDelayed({ finishNormally() }, 20_000L)
            }
        }
        return START_NOT_STICKY
    }

    private fun attempt(types: Int): Boolean = SessionForegroundStart.start(types,
        permissionGranted = { type ->
            val permission = if (type == MIC) Manifest.permission.RECORD_AUDIO else Manifest.permission.ACCESS_FINE_LOCATION
            checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        },
        start = { mask ->
            ForegroundAdmissionJournal.event("start-foreground-attempt", ForegroundAdmissionJournal.json("requestedTypes" to mask, "actualBefore" to foregroundServiceType))
            try {
                startForeground(30_002, ForegroundAdmissionJournal.notification(this), mask)
                ForegroundAdmissionJournal.event("start-foreground-accepted", ForegroundAdmissionJournal.json("requestedTypes" to mask, "actualTypes" to foregroundServiceType))
            } catch (error: RuntimeException) {
                val micDenial = error is SecurityException && error.message?.contains("Starting FGS with type microphone", ignoreCase = true) == true
                if (micDenial) microphoneRejections++
                ForegroundAdmissionJournal.event("start-foreground-rejected", ForegroundAdmissionJournal.json(
                    "requestedTypes" to mask, "exceptionClass" to error.javaClass.name, "microphoneTypeDenial" to micDenial,
                    "eligibleStateMentioned" to (error.message?.contains("eligible state", ignoreCase = true) == true)))
                throw error
            }
        }, log = { ForegroundAdmissionJournal.event("actual-common-helper", ForegroundAdmissionJournal.json("message" to it)) },
        debug = { true }, processImportance = { ForegroundAdmissionJournal.sample().getInt("importance") })

    private fun details() = ForegroundAdmissionJournal.json("actualTypes" to foregroundServiceType,
        "microphoneRejections" to microphoneRejections, "guardTypes" to ForegroundAdmissionGuardService.actualTypes())
    private fun fail(code: String): Int { ForegroundAdmissionJournal.fail(code); stopOwned(); return START_NOT_STICKY }
    private fun finishNormally() { ForegroundAdmissionJournal.setPhase("stopping", details()); stopOwned() }
    private fun stopOwned() {
        if (stopping) return
        stopping = true; handler.removeCallbacksAndMessages(null)
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); ForegroundAdmissionGuardService.stopOwned()
    }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null); current = null
        ForegroundAdmissionJournal.serviceDestroyed("probe"); super.onDestroy()
    }
    companion object {
        private const val BASE = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
        private const val MIC = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        private var current: ForegroundAdmissionProbeService? = null
        fun stopOwned() { current?.stopOwned() }
    }
}
