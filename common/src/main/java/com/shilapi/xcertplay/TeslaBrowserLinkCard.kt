package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PersistableBundle
import android.provider.Settings
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.network.HotspotAddressVpn
import com.shilapi.xcertplay.network.HotspotAddresses
import com.shilapi.xcertplay.network.HotspotExtraAddressKeeper
import kotlin.math.roundToInt

/**
 * The browser link rows of the Tesla browser card (phone + browser mode only, integration E4): what the link is doing,
 * the local network permission (Android 17), the pairing code, and the HTTPS page link with its Copy button.
 *
 * Building the search index ([indexing]) adds the row titles only: it starts no server, creates no pairing code and
 * reads no network interface. Otherwise the links probe the hotspot's address, on a thread.
 */
internal class TeslaBrowserLinkCard(
    private val activity: Activity,
    private val indexing: Boolean,
    private val colors: HotspotExtraAddressCard.Colors,
    /** A 14 sp note in the muted colour, not yet added to a parent. */
    private val note: (String) -> TextView,
    /** A "Title · Value" setting row, added to the parent. */
    private val settingRow: (parent: LinearLayout, text: String, click: () -> Unit) -> Unit,
    /** A plain button, added to the parent. */
    private val actionRow: (parent: LinearLayout, text: String, click: () -> Unit) -> Unit,
    private val requestLocalNetwork: () -> Unit,
    private val rerender: () -> Unit,
) {
    private val app = activity.applicationContext
    private var probeToken: LatestSettingsProbe.Token? = null

    fun build(parent: LinearLayout) {
        val status = note("")
        showState(status, TeslaBrowserLink.state)
        // The index needs the title only; a first build of the card creates the code, which needs no network.
        val code = if (indexing) "" else TeslaBrowserLink.pairingCode(app)
        if (indexing) {
            settingRow(parent, activity.getString(R.string.settings_browser_pairing_code)) { }
            return
        }

        parent.addView(note(activity.getString(R.string.settings_browser_link_car)).withTopPadding())
        val pageAddress = TeslaBrowserLink.pageAddress(app).removeSuffix("/")
        fun connectionLink(hotspot: String?): String = TeslaBrowserPageLinks.pageLink(
            TeslaBrowserLink.pageAddress(app), code,
            TeslaBrowserLink.browserAddress(app, hotspot) ?: TeslaBrowserPageLinks.PAGE_DEFAULT_PHONE_ADDRESS,
            BrowserEndpointSettings.port(app), explicitEndpoint = true)
        var copyPageLink = connectionLink(null)
        parent.addView(linkText(pageAddress))
        actionRow(parent, activity.getString(R.string.settings_browser_link_copy)) { copy(copyPageLink) }
        settingRow(parent, "${activity.getString(R.string.settings_browser_pairing_code)} · $code") { showPairingCode() }
        parent.addView(note(activity.getString(R.string.settings_browser_android_address)).withTopPadding())
        // Show the configured endpoint immediately while the hotspot probe is pending.
        val initialAddress = TeslaBrowserLink.browserAddress(app, null)
            ?: TeslaBrowserPageLinks.PAGE_DEFAULT_PHONE_ADDRESS
        val endpoint = linkText("$initialAddress:${BrowserEndpointSettings.port(app)}").also(parent::addView)
        parent.addView(status)
        localNetworkRows(parent)

        var hotspotAddress: String? = null
        val showLinks: (String?) -> Unit = { hotspot ->
            if (status.isAttachedToWindow) {
                hotspotAddress = hotspot
                copyPageLink = connectionLink(hotspot)
                val address = TeslaBrowserLink.browserAddress(app, hotspot)
                    ?: TeslaBrowserPageLinks.PAGE_DEFAULT_PHONE_ADDRESS
                endpoint.text = "$address:${BrowserEndpointSettings.port(app)}"
            }
        }

        val stateListener: (TeslaBrowserLink.State) -> Unit = { state ->
            activity.runOnUiThread {
                if (status.isAttachedToWindow) {
                    showState(status, state)
                    showLinks(hotspotAddress)
                }
            }
        }
        val keeperListener: (HotspotExtraAddressKeeper.State) -> Unit = {
            activity.runOnUiThread { if (status.isAttachedToWindow) probe(showLinks) } // the address list changes with it
        }
        val vpnListener: (HotspotAddressVpn.State) -> Unit = { keeperListener(HotspotExtraAddressKeeper.state) }
        // Only while the rows are on screen; a new render replaces them.
        val attachment = object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) {
                TeslaBrowserLink.addListener(stateListener)
                HotspotExtraAddressKeeper.addListener(keeperListener)
                HotspotAddressVpn.addListener(vpnListener)
                showState(status, TeslaBrowserLink.state) // it may have changed since build()
                showLinks(hotspotAddress)
                probe(showLinks)
            }
            override fun onViewDetachedFromWindow(view: View) {
                probes.cancel(probeToken)
                probeToken = null
                TeslaBrowserLink.removeListener(stateListener)
                HotspotExtraAddressKeeper.removeListener(keeperListener)
                HotspotAddressVpn.removeListener(vpnListener)
            }
        }
        status.addOnAttachStateChangeListener(attachment)
        // A refresh may build these rows inside a parent that is already on screen.
        if (status.isAttachedToWindow) attachment.onViewAttachedToWindow(status)
    }

    private fun showState(line: TextView, state: TeslaBrowserLink.State) {
        val (text, color) = when (state) {
            is TeslaBrowserLink.State.Listening ->
                activity.getString(R.string.settings_browser_link_listening, state.port) to colors.ready
            TeslaBrowserLink.State.PortInUse ->
                activity.getString(R.string.settings_browser_link_port_in_use, BrowserEndpointSettings.port(app)) to colors.warning
            TeslaBrowserLink.State.Failed -> activity.getString(R.string.settings_browser_link_failed) to colors.warning
            TeslaBrowserLink.State.Stopped -> activity.getString(if (TeslaBrowserLink.active)
                R.string.settings_browser_link_starting else R.string.settings_browser_link_stopped) to colors.muted
        }
        line.text = text
        line.setTextColor(color)
        line.visibility = if (state is TeslaBrowserLink.State.Listening) View.GONE else View.VISIBLE
    }

    private fun localNetworkRows(parent: LinearLayout) {
        when (LocalNetworkPermission.state(app)) {
            LocalNetworkPermission.State.NOT_NEEDED -> Unit
            LocalNetworkPermission.State.GRANTED ->
                parent.addView(note(activity.getString(R.string.settings_browser_local_network_granted)))
            LocalNetworkPermission.State.DENIED -> {
                parent.addView(note(activity.getString(R.string.settings_browser_local_network_denied)).apply {
                    setTextColor(colors.warning)
                })
                actionRow(parent, activity.getString(R.string.settings_browser_local_network_allow), ::allowLocalNetwork)
            }
        }
    }

    // After a denial for good Android answers a request at once, without a dialog: the button would do nothing.
    private fun allowLocalNetwork() {
        val action = LocalNetworkPermission.action(LocalNetworkPermission.requestedBefore(app),
            activity.shouldShowRequestPermissionRationale(LocalNetworkPermission.PERMISSION))
        if (action == LocalNetworkPermission.Action.REQUEST) {
            LocalNetworkPermission.markRequested(app)
            requestLocalNetwork()
            return
        }
        try {
            activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", activity.packageName, null)))
        } catch (_: ActivityNotFoundException) {
            Toast.makeText(activity, R.string.open_this_setting_from_your_car_s_settings_app, Toast.LENGTH_LONG).show()
        }
    }

    /**
     * Resolve the Android address from the configured extra address or a hotspot probe off the UI thread.
     */
    private fun probe(show: (String?) -> Unit) {
        val context = app // The worker must not retain this card or its activity.
        val extra = HotspotExtraAddressSettings.liveAddress(context)?.hostAddress
        probeToken = probes.request(
            work = {
                // An added extra address answers both links, so the interfaces need no look.
                val hotspot = if (extra != null) null
                else runCatching { HotspotAddresses.current(context) }.getOrNull()?.ipv4?.firstOrNull()?.hostAddress
                hotspot
            },
            deliver = show,
        )
    }

    private fun linkText(text: String): TextView = note(text).apply {
        setTextIsSelectable(true)
        TiPlayNativeUi(activity).emphasize(this)
        setPadding(0, dp(4), 0, dp(4))
    }

    private fun TextView.withTopPadding(): TextView = apply { setPadding(0, dp(12), 0, 0) }

    private fun copy(link: String) {
        val clipboard = activity.getSystemService(ClipboardManager::class.java) ?: return
        val clip = ClipData.newPlainText(activity.getString(R.string.app_name), link)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            clip.description.extras = PersistableBundle().apply { putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true) }
        }
        clipboard.setPrimaryClip(clip)
        // Android 13 and later confirm a copy themselves.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            Toast.makeText(activity, R.string.settings_browser_link_copied, Toast.LENGTH_SHORT).show()
        }
    }

    private fun showPairingCode() {
        AlertDialog.Builder(activity)
            .setTitle(R.string.settings_browser_pairing_code)
            .setMessage(activity.getString(R.string.settings_browser_pairing_code_description, TeslaBrowserLink.pairingCode(app)))
            .setPositiveButton(R.string.settings_browser_pairing_code_new) { _, _ ->
                TeslaBrowserLink.newPairingCode(app)
                rerender()
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    internal companion object {
        private val probes = LatestSettingsProbe<String?>("tiplay-browser-link-probe")

        internal fun awaitProbesForTest(): Boolean = probes.awaitIdle()
    }

    private fun dp(value: Int): Int = (value * activity.resources.displayMetrics.density).roundToInt()
}
