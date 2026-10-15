package com.shilapi.xcertplay

import com.shilapi.xcertplay.host.R

/** Short main-page titles describe runtime state, never merely the enabled preference. */
internal object BrowserReceiverPresentation {
    fun airPlayTitle(state: String, disabled: Boolean): Int = when {
        disabled -> R.string.settings_airplay_disabled_status
        state == "listening" -> R.string.settings_airplay_ready_status
        state == "starting" -> R.string.settings_airplay_starting_status
        state == "mirror" -> R.string.settings_airplay_mirroring_status
        state == "video" || state == "loading" -> R.string.settings_airplay_loading_status
        state == "playing" || state == "audio" -> R.string.settings_airplay_playing_status
        state == "paused" -> R.string.settings_airplay_paused_status
        state == "photo" -> R.string.settings_airplay_photo_status
        state == "permission" -> R.string.settings_airplay_permission_status
        state in setOf("failed", "discovery-failed", "audio-failed", "playback-failed") -> R.string.settings_airplay_failed_status
        else -> R.string.settings_airplay_stopped_status
    }
}
