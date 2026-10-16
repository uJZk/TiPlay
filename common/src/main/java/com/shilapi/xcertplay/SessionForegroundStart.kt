package com.shilapi.xcertplay

import android.content.pm.ServiceInfo

/** A rejected while-in-use type must not take down the connected-device session. */
internal object SessionForegroundStart {
    enum class Reason {
        CONNECTED_DEVICE_ACCESS_REJECTED,
        MICROPHONE_PERMISSION_MISSING, MICROPHONE_ELIGIBILITY_UNAVAILABLE, MICROPHONE_ACCESS_REJECTED,
        LOCATION_PERMISSION_MISSING, LOCATION_ELIGIBILITY_UNAVAILABLE, LOCATION_ACCESS_REJECTED,
    }

    fun start(requestedTypes: Int, permissionGranted: (Int) -> Boolean, start: (Int) -> Unit,
              log: (String) -> Unit, debug: () -> Boolean, processImportance: () -> Int? = { null }): Boolean {
        var types = requestedTypes
        while (true) {
            if (debug()) log("session foreground stage=REQUEST types=0x${types.toString(16)} " +
                "microphoneGranted=${permissionGranted(ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)} " +
                "locationGranted=${permissionGranted(ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)} " +
                "processImportance=${processImportance()}")
            try {
                start(types)
                if (debug()) log("session foreground stage=START result=started types=0x${types.toString(16)} " +
                    "degraded=${types != requestedTypes}")
                return true
            } catch (error: RuntimeException) {
                if (backgroundStartRejected(error)) {
                    log("session foreground stage=START unavailable reason=BACKGROUND_START_REJECTED")
                    return false
                }
                if (error !is SecurityException) throw error
                val rejectedType = rejectedType(error, types) ?: throw error
                if (rejectedType == ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE) {
                    log("session foreground stage=ACCESS unavailable reason=${Reason.CONNECTED_DEVICE_ACCESS_REJECTED}")
                    return false
                }
                val granted = permissionGranted(rejectedType)
                val eligibility = error.message?.contains("eligible state", ignoreCase = true) == true
                val reason = when (rejectedType) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE -> when {
                        !granted -> Reason.MICROPHONE_PERMISSION_MISSING
                        eligibility -> Reason.MICROPHONE_ELIGIBILITY_UNAVAILABLE
                        else -> Reason.MICROPHONE_ACCESS_REJECTED
                    }
                    else -> when {
                        !granted -> Reason.LOCATION_PERMISSION_MISSING
                        eligibility -> Reason.LOCATION_ELIGIBILITY_UNAVAILABLE
                        else -> Reason.LOCATION_ACCESS_REJECTED
                    }
                }
                // Each retry removes one explicitly rejected type. Other permissions/errors
                // still propagate; a microphone failure cannot conceal a broken base service.
                types = types and rejectedType.inv()
                log("session foreground stage=ACCESS rejected reason=$reason retryTypes=0x${types.toString(16)}")
            }
        }
    }

    fun backgroundStartRejected(error: RuntimeException): Boolean =
        error.javaClass.name == "android.app.ForegroundServiceStartNotAllowedException"

    private fun rejectedType(error: SecurityException, requested: Int): Int? {
        val message = error.message ?: return null
        // Framework FGS denials identify the type before the permission list. Do not
        // classify an unrelated exception just because it mentions RECORD_AUDIO.
        val type = when {
            message.contains("Starting FGS with type connectedDevice", ignoreCase = true) -> ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            message.contains("Starting FGS with type microphone", ignoreCase = true) -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            message.contains("Starting FGS with type location", ignoreCase = true) -> ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            else -> return null
        }
        return type.takeIf { requested and it != 0 }
    }
}
