package com.shilapi.xcertplay.network

import android.content.Context
import android.util.Log
import android.provider.Settings
import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayDisplayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.AirPlayListenerIdentity
import com.shilapi.xcertplay.airplay.AirPlayMediaHandler
import com.shilapi.xcertplay.airplay.AirPlaySession
import com.shilapi.xcertplay.airplay.AirPlaySessionListener
import com.shilapi.xcertplay.airplay.PairingStore
import com.shilapi.xcertplay.mfi.MfiAuthenticator
import com.shilapi.xcertplay.receiver.UnifiedAirPlayTrial
import java.io.Closeable

/** A controller may release its lease without releasing the service-owned ordinary entry. */
internal class UnifiedAirPlayWirelessLease(
    config: AirPlayConfig, identity: AirPlayIdentity, pairings: PairingStore,
    mfi: MfiAuthenticator?, listener: AirPlaySessionListener, media: AirPlayMediaHandler,
    listenerIdentity: AirPlayListenerIdentity?, appContext: Context,
) : Closeable {
    private val entry = UnifiedAirPlayEndpoint.acquireCarPlay(config, identity, appContext) {
        Log.i("tiplay-airplay", it)
    }
    private val token = Any()
    val port = try { entry.attach(token, config, identity, pairings, mfi, listener, media, listenerIdentity) }
        catch (error: Exception) { entry.closeIfUnowned(); throw error }
        finally { entry.releaseAttachReservation() }

    fun prepareDisplayReconnect(display: AirPlayDisplayConfig, expected: AirPlaySession): (() -> Unit)? =
        entry.prepareDisplayReconnect(token, display, expected)

    fun updatePendingDisplay(display: AirPlayDisplayConfig, retiring: AirPlaySession): Boolean =
        entry.updatePendingDisplay(token, display, retiring)

    override fun close() { entry.detach(token) }

    companion object {
        fun enabled(context: Context): Boolean {
            // A live lease fixes the mode until its entry shuts down; changing the flag cannot steal its port.
            val enabled = UnifiedAirPlayEndpoint.current != null ||
                Settings.Global.getInt(context.contentResolver, UnifiedAirPlayTrial.SETTINGS_KEY, 0) == 1
            UnifiedAirPlayTrial.configure(enabled)
            return enabled
        }
    }
}
