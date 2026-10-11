package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothManager
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.orchestration.ManualHotspotSecurity

/** One main page, one draft, and the host's existing session; native head-unit menus stay upstream. */
internal class BrowserMainSettingsMenu(
    private val activity: Activity,
    val draft: BrowserConnectionDraft,
    private val requestPermissions: (Array<String>) -> Unit,
    private val connect: () -> Unit,
    private val disconnect: () -> Unit,
    advanced: () -> Unit,
    about: () -> Unit,
) {
    private val ui = TiPlayExpressiveUi(activity)
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Float = 14f) = TextView(activity).apply {
        text = value; textSize = size; setTextColor(ui.muted)
    }
    private val content = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(12), dp(16), dp(16))
    }
    val view: View = ScrollView(activity).apply {
        isFillViewport = true; setBackgroundColor(ui.background); addView(content)
    }
    val status = text(activity.getString(R.string.ready_when_you_are), 18f)
    val hotspotStatus = text("")
    private val error = text("").apply { visibility = View.GONE }
    private val action: Button
    private val stop: Button
    private val network = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var baseline = BrowserConnectionDraft.load(activity)
    private var active = false
    private var stopping = false
    private var failed = false
    private var phone: Button
    private lateinit var connectionMode: Button
    private var networkStatus: TextView? = null
    private var wifiSettings: Button? = null
    private lateinit var refreshAddress: () -> Unit
    private lateinit var refreshBrowser: () -> Unit
    private fun button(parent: LinearLayout, label: String, click: () -> Unit) = Button(activity).apply {
        text = label; isAllCaps = false; minHeight = dp(48)
        ui.button(this)
        setOnClickListener { click() }; parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) })
    }
    private fun heading(id: Int, parent: LinearLayout = content) {
        parent.addView(text(activity.getString(id), 18f).apply {
            setTextColor(ui.text); typeface = android.graphics.Typeface.create("sans-serif-medium", 0)
            setPadding(0, 0, 0, dp(8))
        })
    }
    private fun <T> choice(parent: LinearLayout, label: Int, options: List<Pair<T, String>>, current: T, changed: (T) -> Unit) {
        var selected = current
        lateinit var row: Button
        fun title() = activity.getString(label) + " · " + options.first { it.first == selected }.second
        row = button(parent, title()) {
            AlertDialog.Builder(activity).setTitle(label)
                .setSingleChoiceItems(options.map { it.second }.toTypedArray(), options.indexOfFirst { it.first == selected }) { dialog, index ->
                    selected = options[index].first; changed(selected); row.text = title(); dialog.dismiss()
                }.setNegativeButton(android.R.string.cancel, null).create().also(ui::showDialog)
        }
    }
    init {
        ui.applyWindow(activity)
        content.addView(LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(activity).apply { setImageResource(R.drawable.ic_carplay); contentDescription = "TiPlay" },
                LinearLayout.LayoutParams(dp(32), dp(32)))
            addView(text("TiPlay", 24f).apply {
                setTextColor(ui.text); setPadding(dp(12), 0, 0, 0)
                typeface = android.graphics.Typeface.create("sans-serif-medium", 0)
            })
        })
        val session = ui.card(content, hero = true)
        status.setTextColor(ui.onContainer)
        session.addView(status)
        phone = button(session, phoneLabel(), ::choosePhone)
        action = button(session, activity.getString(R.string.connect_phone), ::submit).apply { ui.button(this, prominent = true) }
        stop = button(session, activity.getString(R.string.disconnect)) {
            stopping = true; status.setText(R.string.settings_main_stopping); updateActions(); disconnect()
        }.apply { visibility = View.GONE }
        error.setTextColor(ui.error)
        session.addView(error)
        val connection = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; background = ui.shape(ui.surface); setPadding(dp(12), dp(12), dp(12), dp(12)) }
        val browser = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; background = ui.shape(ui.surface); setPadding(dp(12), dp(12), dp(12), dp(12)) }
        network.background = ui.shape(ui.surface)
        network.setPadding(dp(12), dp(12), dp(12), dp(12))
        val details = LinearLayout(activity).apply {
            orientation = if (activity.resources.configuration.screenWidthDp >= 1000) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        }
        content.addView(details)
        for (column in listOf(connection, browser, network)) details.addView(column,
            if (details.orientation == LinearLayout.HORIZONTAL) LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(12) }
            else LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
        heading(R.string.connection, connection)
        connectionMode = BrowserSettingsPresentation.connectionMode(activity, { draft.wireless }) {
            draft.wireless = it; renderNetwork(); updateActions()
        }
        ui.button(connectionMode)
        connection.addView(connectionMode)
        connection.addView(text(activity.getString(R.string.settings_connection_mode_hint)))
        refreshAddress = BrowserSettingsMenu.addHotspotAddress(connection, activity)
        refreshBrowser = BrowserSettingsMenu.addBrowserLink(browser, activity) {
            requestPermissions(arrayOf(LocalNetworkPermission.PERMISSION))
        }
        renderNetwork()
        connection.addView(hotspotStatus)
        heading(R.string.settings_startup_and_connection, connection)
        BrowserSettingsMenu.addConnectOnOpen(connection)
        val more = ui.card(content)
        button(more, activity.getString(R.string.settings_advanced), advanced)
        more.addView(text(activity.getString(R.string.settings_browser_advanced_summary)))
        val tools = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
        more.addView(tools)
        button(tools, activity.getString(R.string.language_app_language)) { AppLocale.showPicker(activity) }
        button(tools, activity.getString(R.string.about), about)
        for (i in 0 until tools.childCount) tools.getChildAt(i).layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(4) }
        val version = activity.packageManager.getPackageInfo(activity.packageName, 0).versionName.orEmpty()
        content.addView(text(activity.getString(R.string.home_public_preview) + version))
    }
    private fun phoneLabel() = activity.getString(R.string.choose_iphone_prefix) + draft.phoneName
    private fun choosePhone() {
        if (Build.VERSION.SDK_INT >= 31 && activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT)); return
        }
        val adapter = activity.getSystemService(BluetoothManager::class.java)?.adapter
        val devices = runCatching { adapter?.takeIf { it.isEnabled }?.bondedDevices?.sortedBy { it.name ?: "" } }.getOrNull().orEmpty()
        if (devices.isEmpty()) {
            activity.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); return
        }
        AlertDialog.Builder(activity).setTitle(R.string.choose_your_iphone)
            .setItems(devices.map { "${it.name ?: activity.getString(R.string.paired_device)} · ${it.address.takeLast(5)}" }.toTypedArray()) { _, index ->
                val device = devices[index]
                draft.phoneAddress = device.address; draft.phoneName = device.name ?: "iPhone"
                phone.text = phoneLabel(); updateActions()
            }.setNeutralButton(R.string.pair_another) { _, _ -> activity.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
            .setNegativeButton(android.R.string.cancel, null).create().also(ui::showDialog)
    }
    private fun input(parent: LinearLayout, label: Int, value: String, secret: Boolean = false, changed: (String) -> Unit): EditText {
        parent.addView(text(activity.getString(label)))
        return EditText(activity).apply {
            setText(value); setSingleLine(); ui.input(this)
            inputType = InputType.TYPE_CLASS_TEXT or if (secret) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_VARIATION_NORMAL
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: Editable?) { changed(s.toString()); this@BrowserMainSettingsMenu.error.visibility = View.GONE; updateActions() }
            })
            parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4); bottomMargin = dp(8) })
        }
    }
    private fun renderNetwork() {
        network.removeAllViews(); networkStatus = null; wifiSettings = null
        if (!draft.wireless) return
        if (draft.source == BrowserConnectionDraft.Source.LAN) draft.externalSecured = draft.externalPassword.isNotEmpty()
        val group = RadioGroup(activity).apply { orientation = RadioGroup.HORIZONTAL }
        val labels = listOf(R.string.built_in_car_hotspot, R.string.existing_wifi_title, R.string.settings_external_ap_title)
        BrowserConnectionDraft.Source.entries.forEachIndexed { index, source ->
            group.addView(RadioButton(activity).apply {
                id = View.generateViewId(); setText(labels[index])
                textSize = 14f; minHeight = dp(48)
                tag = source
                isChecked = draft.source == source
                ui.radio(this)
                setOnClickListener { draft.source = source; renderNetwork(); updateActions() }
            }, RadioGroup.LayoutParams(0, -2, 1f).apply { marginEnd = dp(4) })
        }
        network.addView(group)
        val local = draft.source == BrowserConnectionDraft.Source.LOCAL
        if (!local) network.addView(text(activity.getString(
            if (draft.source == BrowserConnectionDraft.Source.EXTERNAL_AP) R.string.settings_external_ap_setup else R.string.existing_wifi_instructions)))
        val fields = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }; network.addView(fields)
        val ssid = input(fields, if (local) R.string.hotspot_ssid else R.string.existing_wifi_ssid,
            if (local) draft.localSsid else draft.externalSsid) { if (local) draft.localSsid = it else { draft.externalSsid = it; refreshNetwork() } }
        val password = input(fields, R.string.hotspot_password, if (local) draft.localPassword else draft.externalPassword, true) {
            if (local) draft.localPassword = it else {
                draft.externalPassword = it
                if (draft.source == BrowserConnectionDraft.Source.LAN) draft.externalSecured = it.isNotEmpty()
            }
        }
        if (local) {
            LocalHotspotAutofill.attach(fields, ssid, password)
            val options = listOf(ManualHotspotSecurity.OPEN to activity.getString(R.string.open),
                ManualHotspotSecurity.WPA2 to activity.getString(R.string.wpa2),
                ManualHotspotSecurity.WPA3_TRANSITION to activity.getString(R.string.wpa3_transition),
                ManualHotspotSecurity.WPA3 to activity.getString(R.string.wpa3))
            choice(fields, R.string.security, options, draft.localSecurity) { draft.localSecurity = it; updateActions() }
            wifiSettings = button(fields, activity.getString(R.string.open_car_hotspot_settings)) {
                activity.startActivity(Intent("android.settings.TETHER_SETTINGS"))
            }
            refreshNetwork()
        } else {
            if (draft.source == BrowserConnectionDraft.Source.EXTERNAL_AP) {
                choice(fields, R.string.security,
                    listOf(false to activity.getString(R.string.open), true to activity.getString(R.string.wpa2)),
                    draft.externalSecured) { secured ->
                    draft.externalSecured = secured
                    if (!secured) password.setText("") else if (password.text.isEmpty()) password.requestFocus()
                    updateActions()
                }
            }
            networkStatus = text("").also(fields::addView)
            wifiSettings = button(fields, activity.getString(R.string.settings_external_ap_wifi)) {
                activity.startActivity(Intent(Settings.ACTION_WIFI_SETTINGS))
            }
            refreshNetwork()
        }
        // Autofill and shared cards retain their existing actions, with the same product styling.
        ui.styleTree(network)
    }
    fun transportSelected(wireless: Boolean) {
        draft.wireless = wireless
        baseline.wireless = wireless
        connectionMode.text = activity.getString(R.string.settings_iphone_connection_mode) + " · " +
            activity.getString(if (wireless) R.string.default_connection_wireless else R.string.default_connection_usb)
        renderNetwork(); updateActions()
    }
    fun refresh() {
        refreshAddress(); refreshBrowser(); refreshNetwork(); phone.text = phoneLabel()
    }
    fun refreshNetwork() {
        if (draft.source == BrowserConnectionDraft.Source.LOCAL) {
            wifiSettings?.visibility = if (com.shilapi.xcertplay.network.CarHotspotStatus.isEnabled(activity) == true) View.GONE else View.VISIBLE
            return
        }
        val connectivity = activity.getSystemService(ConnectivityManager::class.java)
        val wifi = connectivity?.allNetworks?.any { connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true } == true
        @Suppress("DEPRECATION")
        val ssid = runCatching { activity.applicationContext.getSystemService(WifiManager::class.java)?.connectionInfo?.ssid?.trim('"') }
            .getOrNull()?.takeUnless { it == "<unknown ssid>" }
        val matches = wifi && ssid == draft.externalSsid
        wifiSettings?.visibility = if (matches) View.GONE else View.VISIBLE
        networkStatus?.setText(if (matches) R.string.settings_external_ap_ready else R.string.settings_external_ap_check)
    }
    fun update(stage: String, hasSession: Boolean) {
        active = hasSession
        status.text = if (stopping) activity.getString(R.string.settings_main_stopping) else stage
        updateActions(); refreshNetwork()
    }
    fun showConnectionError(message: String?) {
        failed = message != null
        error.text = message.orEmpty()
        error.visibility = if (failed) View.VISIBLE else View.GONE
        updateActions()
    }
    fun committed() { baseline = draft.copy(); failed = false; error.visibility = View.GONE; updateActions() }
    private fun updateActions() {
        val dirty = draft != baseline
        action.setText(if (dirty || active) R.string.save_and_reconnect else R.string.connect_phone)
        action.visibility = if (!active || dirty || failed) View.VISIBLE else View.GONE
        action.isEnabled = !stopping
        stop.visibility = if (active) View.VISIBLE else View.GONE; stop.isEnabled = !stopping
    }
    private fun submit() {
        val invalid = draft.validationError()
        if (invalid != null) {
            error.text = activity.getString(invalid)
            error.visibility = View.VISIBLE; return
        }
        connect()
    }
}
