package com.shilapi.xcertplay

import android.app.AlertDialog
import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.network.CarPlayVpnService

/** Check current Android permissions before handing over to the receiver host. */
class FirstUseActivity : ComponentActivity() {
    companion object {
        const val REVIEW = "review_first_use"
        private const val PREFS = "tiplay_first_use"
        private const val COMPLETED = "setup_completed"
    }

    private val reviewing get() = intent.getBooleanExtra(REVIEW, false)
    private var permissions: BrowserPermissionsPage? = null
    private var permissionStatus: TextView? = null
    private var grantButton: Button? = null
    private var finishLater: Button? = null
    private var vpnButton: Button? = null
    private lateinit var error: TextView
    private val runtimePermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        refresh()
    }
    private val vpnConsent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        refresh()
    }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_TiPlayNative)
        super.onCreate(savedInstanceState)
        if (!reviewing && getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(COMPLETED, false)) {
            openMain()
            return
        }
        BrowserSettingsPolicy.activate(this)
        render()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun render() {
        val ui = TiPlayNativeUi(this)
        val spacing = BrowserNativeSettingsUi(this)
        ui.applyWindow(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            spacing.pagePadding(this)
            setBackgroundColor(ui.background)
            ui.protectSystemInsets(this)
        }
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun label(text: String, heading: Boolean = false) = ui.label(text, heading).also {
            if (heading) androidx.core.view.ViewCompat.setAccessibilityHeading(it, true)
            content.addView(it, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = ui.dp(16) })
        }
        label(getString(R.string.onboarding_help), true).also(spacing::field)
        label(getString(R.string.onboarding_permissions_body))
        error = label("").apply { visibility = View.GONE; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        val controls = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        content.addView(controls.also(spacing::field))
        permissionStatus = TextView(this).also(controls::addView)
        permissions = BrowserPermissionsPage(this, controls) { runtimePermissions.launch(it) }
        if (needsVpn()) vpnButton = action(controls, R.string.onboarding_usb_vpn) {
            runCatching { CarPlayVpnService.prepare(this) }.onSuccess { consent ->
                if (consent != null) runCatching { vpnConsent.launch(consent) }.onFailure { showError(R.string.vpn_authorization_unavailable) }
                else refresh()
            }.onFailure { showError(R.string.vpn_authorization_unavailable) }
        }
        spacing.normalizeSpacing(content, recursive = true)
        root.addView(ScrollView(this).apply { addView(content) }, LinearLayout.LayoutParams(-1, 0, 1f))
        val navigation = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, ui.dp(16), 0, 0)
            tag = "onboarding_navigation"
        }
        root.addView(navigation, LinearLayout.LayoutParams(-1, -2))
        grantButton = action(navigation, R.string.onboarding_finish) {
            if (permissions?.missingRuntimePermissions()?.isNotEmpty() == true) permissions?.requestMissingPermissions()
            else finishOrConfirm()
        }
        finishLater = action(navigation, R.string.onboarding_continue) { finishOrConfirm() }
        BrowserNativeSettingsUi(this).normalizeSpacing(navigation)
        setContentView(root)
        refresh()
    }

    private fun action(parent: LinearLayout, title: Int, click: () -> Unit) = Button(this).apply {
        setText(title)
        isAllCaps = false
        minHeight = TiPlayNativeUi(this@FirstUseActivity).dp(48)
        setOnClickListener { click() }
        parent.addView(this, LinearLayout.LayoutParams(-1, -2))
    }

    private fun needsVpn() = BrowserCarPlaySettings.mode(this) != BrowserCarPlaySettings.Mode.WIRELESS
    private fun vpnGranted() = runCatching { CarPlayVpnService.prepare(this) == null }.getOrDefault(false)

    private fun refresh() {
        permissions?.let { page ->
            page.refresh()
            val count = page.missingRuntimePermissions().size
            permissionStatus?.text = if (count == 0) getString(R.string.onboarding_permissions_ready)
                else getString(R.string.onboarding_permissions_missing, count)
            grantButton?.setText(if (count > 0) R.string.onboarding_grant_missing else R.string.onboarding_finish)
            finishLater?.visibility = if (count > 0) View.VISIBLE else View.GONE
            grantButton?.parent?.let { BrowserNativeSettingsUi(this).normalizeSpacing(it as LinearLayout) }
        }
        vpnButton?.text = getString(R.string.onboarding_usb_vpn) + if (vpnGranted()) " ✓" else " ✕"
    }

    private fun showError(id: Int) {
        error.setText(id)
        error.visibility = View.VISIBLE
        BrowserNativeSettingsUi(this).normalizeSpacing(error.parent as LinearLayout, recursive = true)
    }

    private fun finishOrConfirm() {
        if (permissions?.allGranted() != true || (needsVpn() && !vpnGranted())) {
            AlertDialog.Builder(this).setMessage(R.string.onboarding_missing_confirmation)
                .setPositiveButton(R.string.onboarding_continue) { _, _ -> completeSetup() }
                .setNegativeButton(android.R.string.cancel, null).create().also(TiPlayNativeUi(this)::showDialog)
        } else completeSetup()
    }

    private fun completeSetup() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(COMPLETED, true).apply()
        BrowserSettingsChanges.apply(this)
        if (reviewing) finish() else openMain()
    }

    private fun openMain() {
        startActivity(CarPlaySettingsNavigation.mainIntent(this))
        // The singleTask host has a separate affinity. Finishing its launcher root alone
        // leaves an empty, black task card on some Android launchers.
        if (isTaskRoot) finishAndRemoveTask() else finish()
    }
}
