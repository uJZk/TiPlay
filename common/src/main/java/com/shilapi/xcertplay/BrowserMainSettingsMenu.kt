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
    private val ui = TiPlayNativeUi(activity)
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Float = 14f) = TextView(activity).apply {
        text = value
        if (size >= 18f) setTextAppearance(android.R.style.TextAppearance_Material_Large)
    }
    private val content = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(12), dp(16), dp(16))
    }
    val view: View = ScrollView(activity).apply {
        isFillViewport = true; setBackgroundColor(ui.background); addView(content)
        ui.protectSystemInsets(this)
    }
    val status = text("", 18f).also(ui::emphasize)
    val hotspotStatus = text("").also(ui::emphasize)
    private val error = text("").apply { visibility = View.GONE }.also(ui::emphasize)
    private val action: Button
    private val stop: Button
    private val network = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var baseline = BrowserConnectionDraft.load(activity)
    private var active = false
    private var idle = true
    private var stopping = false
    private var failed = false
    private var phone: Button
    private lateinit var connectionMode: Button
    private var networkStatus: TextView? = null
    private var networkReadiness: Int? = null
    private var wifiSettings: Button? = null
    private var refreshAddress: () -> Unit = {}
    private lateinit var refreshBrowser: () -> Unit
    private fun button(parent: LinearLayout, label: String, click: () -> Unit) = Button(activity).apply {
        text = label; minHeight = dp(48)
        setOnClickListener { click() }; parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
    }
    private fun heading(id: Int, parent: LinearLayout = content) {
        parent.addView(text(activity.getString(id), 18f).apply {
            setPadding(0, 0, 0, dp(8))
        })
    }
    private fun group(parent: LinearLayout): LinearLayout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(16) })
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
            setPadding(0, 0, 0, dp(12))
            addView(ImageView(activity).apply { setImageResource(R.drawable.ic_carplay); contentDescription = "TiPlay" },
                LinearLayout.LayoutParams(dp(32), dp(32)))
            addView(text("TiPlay", 24f).apply {
                setPadding(dp(12), 0, 0, 0)
                ui.emphasize(this)
            })
        })
        val session = group(content)
        session.addView(status)
        val wide = activity.resources.configuration.screenWidthDp >= 1000
        val transport = if (wide) LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            session.addView(this, LinearLayout.LayoutParams(-1, -2))
        } else session
        phone = button(transport, phoneLabel(), ::choosePhone).apply { isAllCaps = false }
        connectionMode = BrowserSettingsPresentation.connectionMode(activity, { draft.wireless }) {
            draft.wireless = it; renderNetwork(); updateActions()
        }
        connectionMode.minHeight = dp(48)
        transport.addView(connectionMode, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        if (wide) {
            for (i in 0 until transport.childCount) {
                transport.getChildAt(i).layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply {
                    topMargin = dp(8)
                    if (i == 0) marginEnd = dp(8)
                }
            }
        }
        action = button(session, activity.getString(R.string.connect_phone), ::submit)
        stop = button(session, activity.getString(R.string.disconnect)) {
            stopping = true; updateActions(); disconnect()
        }.apply { visibility = View.GONE }
        session.addView(error)
        session.addView(BrowserBootConnectionSettings.create(activity))
        val browser = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        val details = LinearLayout(activity).apply {
            orientation = if (activity.resources.configuration.screenWidthDp >= 1000) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        }
        content.addView(details)
        for (column in listOf(browser, network)) details.addView(column,
            if (details.orientation == LinearLayout.HORIZONTAL) LinearLayout.LayoutParams(0, -2, if (column === network) 2f else 1f).apply { marginEnd = dp(12) }
            else LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(16) })
        refreshBrowser = BrowserSettingsMenu.addBrowserLink(browser, activity) {
            requestPermissions(arrayOf(LocalNetworkPermission.PERMISSION))
        }
        renderNetwork()
        val more = group(content)
        heading(R.string.settings_browser_more, more)
        button(more, activity.getString(R.string.settings_advanced), advanced)
        val stackTools = activity.resources.configuration.screenWidthDp < 400 || activity.resources.configuration.fontScale > 1.2f
        val tools = LinearLayout(activity).apply { orientation = if (stackTools) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL }
        more.addView(tools)
        button(tools, activity.getString(R.string.language_app_language)) { AppLocale.showPicker(activity) }
        button(tools, activity.getString(R.string.about), about)
        for (i in 0 until tools.childCount) tools.getChildAt(i).layoutParams =
            if (stackTools) LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) }
            else LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(8) }
        val version = activity.packageManager.getPackageInfo(activity.packageName, 0).versionName.orEmpty()
        content.addView(text(version).also(ui::emphasize))
        updateActions()
    }
    private fun phoneLabel() = if (draft.phoneAddress.isNullOrBlank()) activity.getString(R.string.choose_iphone)
        else activity.getString(R.string.settings_selected_iphone, draft.phoneName)
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
            setText(value); setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT or if (secret) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_VARIATION_NORMAL
            ui.emphasize(this)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: Editable?) { changed(s.toString()); this@BrowserMainSettingsMenu.error.visibility = View.GONE; updateActions() }
            })
            parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4); bottomMargin = dp(8) })
        }
    }
    private fun renderNetwork() {
        network.removeAllViews(); networkStatus = null; wifiSettings = null; networkReadiness = null
        refreshAddress = {}
        heading(R.string.settings_browser_network_configuration, network)
        val group = RadioGroup(activity).apply { orientation = RadioGroup.HORIZONTAL }
        val labels = listOf(R.string.built_in_car_hotspot, R.string.existing_wifi_title)
        BrowserConnectionDraft.Source.entries.forEachIndexed { index, source ->
            group.addView(RadioButton(activity).apply {
                id = View.generateViewId(); setText(labels[index])
                minHeight = dp(48)
                tag = source
                isChecked = draft.source == source
                setOnClickListener { draft.source = source; renderNetwork(); updateActions() }
            }, RadioGroup.LayoutParams(0, -2, 1f).apply { marginEnd = dp(4) })
        }
        network.addView(group, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
        val local = draft.source == BrowserConnectionDraft.Source.LOCAL
        if (local) network.addView(hotspotStatus.apply { (parent as? android.view.ViewGroup)?.removeView(this) })
        val addressDetails = if (local) LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            refreshAddress = BrowserSettingsMenu.addHotspotAddress(this, activity, onMethodChanged = ::renderNetwork)
        } else null
        addressDetails?.let(network::addView)
        val actions = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        network.addView(actions)
        val fields = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }; network.addView(fields)
        val ssid = input(fields, if (local) R.string.hotspot_ssid else R.string.existing_wifi_ssid,
            if (local) draft.localSsid else draft.externalSsid) { if (local) draft.localSsid = it else { draft.externalSsid = it; refreshNetwork() } }
        val options = listOf(ManualHotspotSecurity.OPEN to activity.getString(R.string.open),
                ManualHotspotSecurity.WPA2 to activity.getString(R.string.wpa2),
                ManualHotspotSecurity.WPA3_TRANSITION to activity.getString(R.string.wpa3_transition),
                ManualHotspotSecurity.WPA3 to activity.getString(R.string.wpa3))
        choice(fields, R.string.security, options, if (local) draft.localSecurity else draft.externalSecurity) {
            if (local) draft.localSecurity = it else draft.externalSecurity = it
            renderNetwork(); updateActions()
        }
        val secured = if (local) draft.localSecurity != ManualHotspotSecurity.OPEN else draft.externalSecured
        val passwordFields = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            visibility = if (secured) View.VISIBLE else View.GONE
        }
        fields.addView(passwordFields)
        val password = input(passwordFields, R.string.hotspot_password, if (local) draft.localPassword else draft.externalPassword, true) {
            if (local) draft.localPassword = it else draft.externalPassword = it
        }
        if (local) {
            val privileged = HotspotExtraAddressSettings.method(activity) in setOf(HotspotAddressMethod.ROOT, HotspotAddressMethod.SHIZUKU)
            if (privileged) LocalHotspotAutofill.attach(fields, ssid, password, controlsParent = actions, showHint = false)
            else wifiSettings = button(actions, activity.getString(R.string.open_car_hotspot_settings)) {
                activity.startActivity(Intent("android.settings.TETHER_SETTINGS"))
            }
            refreshNetwork()
        } else {
            networkStatus = text("").also(fields::addView)
            wifiSettings = button(fields, activity.getString(R.string.settings_external_ap_wifi)) {
                activity.startActivity(Intent(Settings.ACTION_WIFI_SETTINGS))
            }
            refreshNetwork()
        }
    }
    fun transportSelected(wireless: Boolean) {
        draft.wireless = wireless
        baseline.wireless = wireless
        connectionMode.text = activity.getString(R.string.settings_browser_carplay_connection_mode) + " · " +
            activity.getString(if (wireless) R.string.default_connection_wireless else R.string.default_connection_usb)
        renderNetwork(); updateActions()
    }
    fun refresh() {
        refreshAddress(); refreshBrowser(); refreshNetwork(); phone.text = phoneLabel(); updateActions()
    }
    fun refreshNetwork() {
        if (draft.source == BrowserConnectionDraft.Source.LOCAL) {
            val enabled = com.shilapi.xcertplay.network.CarHotspotStatus.isEnabled(activity)
            hotspotStatus.setText(when (enabled) {
                true -> R.string.settings_browser_hotspot_on
                false -> R.string.settings_browser_hotspot_off
                null -> R.string.settings_browser_hotspot_unknown
            })
            networkReadiness = if (enabled == false) R.string.hotspot_details_off else null
            updateIdleStatus()
            return
        }
        val connectivity = activity.getSystemService(ConnectivityManager::class.java)
        val wifi = connectivity?.allNetworks?.any { connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true } == true
        @Suppress("DEPRECATION")
        val ssid = runCatching { activity.applicationContext.getSystemService(WifiManager::class.java)?.connectionInfo?.ssid?.trim('"') }
            .getOrNull()?.takeUnless { it == "<unknown ssid>" }
        val matches = wifi && ssid == draft.externalSsid
        networkStatus?.setText(if (matches) R.string.settings_external_ap_ready else R.string.settings_external_ap_check)
        networkReadiness = if (matches) null else R.string.settings_external_ap_check
        updateIdleStatus()
    }
    fun update(stage: String, hasSession: Boolean, idle: Boolean = false) {
        active = hasSession
        this.idle = idle && !hasSession
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
    private fun updateIdleStatus() {
        if (!idle || stopping) return
        val invalid = draft.validationError()
        val requirement = when {
            !draft.wireless -> null
            draft.phoneAddress.isNullOrBlank() -> R.string.choose_your_iphone
            invalid != null -> invalid
            Build.VERSION.SDK_INT >= 31 &&
                activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED ->
                R.string.allow_the_connection_permission_to_continue
            runCatching { activity.getSystemService(BluetoothManager::class.java)?.adapter?.isEnabled }.getOrNull() != true ->
                R.string.turn_on_bluetooth
            else -> networkReadiness
        }
        status.setText(requirement ?: R.string.ready_when_you_are)
    }
    private fun updateActions() {
        if (stopping) status.setText(R.string.settings_main_stopping) else updateIdleStatus()
        val dirty = draft != baseline
        action.setText(if (dirty || active) R.string.save_and_reconnect else R.string.connect_phone)
        action.visibility = if (!active || dirty || failed) View.VISIBLE else View.GONE
        action.isEnabled = !stopping
        stop.visibility = if (active) View.VISIBLE else View.GONE; stop.isEnabled = !stopping
        stop.setText(if (stopping) R.string.settings_main_stopping else R.string.disconnect)
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
