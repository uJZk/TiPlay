package com.shilapi.xcertplay

import android.content.Context
import android.os.Bundle
import com.shilapi.xcertplay.orchestration.ManualHotspotSecurity
import com.shilapi.xcertplay.orchestration.ManualHotspotValidation
import com.shilapi.xcertplay.orchestration.WirelessHotspotMode

/** Product network choices map onto upstream transports; invalid edits stay local until valid. */
internal data class BrowserConnectionDraft(
    var wireless: Boolean,
    var source: Source,
    var localSsid: String,
    var localPassword: String,
    var localSecurity: ManualHotspotSecurity,
    var externalSsid: String,
    var externalPassword: String,
    var externalSecurity: ManualHotspotSecurity = if (externalPassword.isEmpty()) ManualHotspotSecurity.OPEN else ManualHotspotSecurity.WPA2,
    var phoneAddress: String? = null,
    var phoneName: String = "iPhone",
    var allTransports: Boolean = false,
) {
    override fun toString() = "Browser connection draft (redacted)"

    enum class Source { LOCAL, LAN }
    var externalSecured: Boolean
        get() = externalSecurity != ManualHotspotSecurity.OPEN
        set(value) { externalSecurity = if (value) ManualHotspotSecurity.WPA2 else ManualHotspotSecurity.OPEN }
    val mode get() = if (source == Source.LOCAL) WirelessHotspotMode.MANUAL else WirelessHotspotMode.EXISTING_WIFI
    private val localConnectionPassword get() = if (localSecurity == ManualHotspotSecurity.OPEN) "" else localPassword
    private val externalConnectionPassword get() = if (externalSecured) externalPassword else ""
    fun error(): ManualHotspotValidation.Error? = if (!wireless) null else
        ManualHotspotValidation.error(if (source == Source.LOCAL) localSsid else externalSsid,
            if (source == Source.LOCAL) localConnectionPassword else externalConnectionPassword)
    fun validationError(): Int? {
        error()?.let { return it.messageResource() }
        if (!wireless) return null
        val open = if (source == Source.LOCAL) localSecurity == ManualHotspotSecurity.OPEN else !externalSecured
        val password = if (source == Source.LOCAL) localConnectionPassword else externalConnectionPassword
        return when {
            !open && password.length !in 8..63 -> com.shilapi.xcertplay.host.R.string.wpa2_wpa3_password_must_be_8_63_characters
            else -> null
        }
    }
    fun save(context: Context) {
        phoneAddress?.let { DiPlayPreferences.savePhone(context, it, phoneName) }
        BrowserCarPlaySettings.saveMode(context, if (allTransports) BrowserCarPlaySettings.Mode.ALL
            else if (wireless) BrowserCarPlaySettings.Mode.WIRELESS else BrowserCarPlaySettings.Mode.USB)
        AirPlayPersistence.saveWirelessHotspotMode(context, mode)
        AirPlayPersistence.saveManualHotspotSsid(context, localSsid)
        AirPlayPersistence.saveManualHotspotPassphrase(context, localConnectionPassword)
        AirPlayPersistence.saveManualHotspotSecurity(context, localSecurity)
        AirPlayPersistence.saveExistingWifiCredentials(context, externalSsid, externalConnectionPassword)
        BrowserExistingWifiSettings.saveSecurity(context, externalSecurity)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("source", source.name).apply()
    }
    fun retain(state: Bundle) {
        state.putBundle("browser_main_draft", Bundle().apply {
            putBoolean("allTransports", allTransports); putBoolean("wireless", wireless); putString("source", source.name)
            putString("localSsid", localSsid); putString("localPassword", localPassword)
            putString("security", localSecurity.name); putString("externalSsid", externalSsid)
            putString("externalPassword", externalPassword); putString("externalSecurity", externalSecurity.name); putString("phoneAddress", phoneAddress); putString("phoneName", phoneName)
        })
    }
    companion object {
        private const val PREFS = "tiplay_browser_network"
        fun load(context: Context, state: Bundle? = null): BrowserConnectionDraft {
            val savedMode = AirPlayPersistence.loadWirelessHotspotMode(context)
            val source = if (savedMode != WirelessHotspotMode.EXISTING_WIFI) Source.LOCAL else
                runCatching { Source.valueOf(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getString("source", Source.LAN.name)!!) }.getOrDefault(Source.LAN).let {
                    if (it == Source.LOCAL) Source.LAN else it
                }
            val draft = BrowserConnectionDraft(AirPlayPersistence.loadWirelessEnabled(context), source,
                AirPlayPersistence.loadManualHotspotSsid(context), AirPlayPersistence.loadManualHotspotPassphrase(context),
                AirPlayPersistence.loadManualHotspotSecurity(context), AirPlayPersistence.loadExistingWifiSsid(context),
                AirPlayPersistence.loadExistingWifiPassphrase(context), BrowserExistingWifiSettings.loadSecurity(context))
            draft.allTransports = BrowserCarPlaySettings.mode(context) == BrowserCarPlaySettings.Mode.ALL
            if (draft.allTransports) draft.wireless = true
            draft.phoneAddress = DiPlayPreferences.phoneAddress(context)
            draft.phoneName = DiPlayPreferences.phoneName(context)
            state?.getBundle("browser_main_draft")?.let {
                draft.allTransports = it.getBoolean("allTransports", draft.allTransports)
                draft.wireless = it.getBoolean("wireless", draft.wireless)
                // Older drafts used EXTERNAL_AP for the same existing-Wi-Fi transport.
                draft.source = if (it.getString("source") == "EXTERNAL_AP") Source.LAN else
                    runCatching { Source.valueOf(it.getString("source")!!) }.getOrDefault(draft.source)
                draft.localSsid = it.getString("localSsid", draft.localSsid)
                draft.localPassword = it.getString("localPassword", draft.localPassword)
                draft.localSecurity = runCatching { ManualHotspotSecurity.valueOf(it.getString("security")!!) }.getOrDefault(draft.localSecurity)
                draft.externalSsid = it.getString("externalSsid", draft.externalSsid)
                draft.externalPassword = it.getString("externalPassword", draft.externalPassword)
                draft.externalSecurity = ManualHotspotSecurity.entries.firstOrNull { security -> security.name == it.getString("externalSecurity") }
                    ?: if (it.getBoolean("externalSecured", draft.externalPassword.isNotEmpty())) ManualHotspotSecurity.WPA2 else ManualHotspotSecurity.OPEN
                draft.phoneAddress = it.getString("phoneAddress", draft.phoneAddress)
                draft.phoneName = it.getString("phoneName", draft.phoneName)
            }
            return draft
        }
    }
}
