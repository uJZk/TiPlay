import org.gradle.api.tasks.testing.Test

// Upstream UI fixtures target the former home/settings overlay and native head-unit gestures.
// Retain their source for merges; BrowserMainPageTest/BrowserMainHostTest cover TiPlay's product flow.
tasks.withType<Test>().configureEach {
    filter {
        excludeTestsMatching("com.shilapi.xcertplay.HomeCompactLayoutTest")
        // DiPlay 0.2.20's native Home auto-tethering screen is outside the phone/browser product.
        // Keep its upstream fixture intact; BrowserMainPageTest/HotspotOperationFeedbackTest cover ours.
        excludeTestsMatching("com.shilapi.xcertplay.HomeHotspotAccessTest")
        // The upstream Vehicle screen describes BYD head-unit key services, not phone controls.
        excludeTestsMatching("com.shilapi.xcertplay.SiriLongPressSwitchTest")
        // Upstream's legacy Wi-Fi screen fixture calls the channel-only builder, then expects
        // a switch owned by its enclosing native setup screen. Keep shared channel tests running.
        excludeTestsMatching("com.shilapi.xcertplay.WifiDirectChannelSettingsTest.theScanPauseSwitchIsOnByDefaultAndCanBeTurnedOff")
        // Legacy native-host permission prompts are replaced by TiPlay's phone checklist.
        excludeTestsMatching("com.shilapi.xcertplay.WirelessPermissionRefusalTest")
        // New upstream cases require the native head-unit's finite retry budget/stop UI.
        // TiPlay's phone/browser path deliberately continues recovery; keep its existing cases.
        excludeTestsMatching("com.shilapi.xcertplay.WirelessStartupRecoveryTest.aHeadUnitWithoutABluetoothAdapterSaysSoAndDoesNotRetry")
        excludeTestsMatching("com.shilapi.xcertplay.WirelessStartupRecoveryTest.aHotspotThatIsNotReadyIsNamedAndTheStopIsSaid")
        excludeTestsMatching("com.shilapi.xcertplay.WirelessStartupRecoveryTest.aHotspotThatIsNotReadyIsNamedInChinese")
        excludeTestsMatching("com.shilapi.xcertplay.WirelessStartupRecoveryTest.anIphoneThatDoesNotConnectInTimeIsNamedAndTheStopIsSaid")
        excludeTestsMatching("com.shilapi.xcertplay.WirelessStartupRecoveryTest.aHotspotDiPlayCannotUseSaysTheRetriesStopped")
        excludeTestsMatching("com.shilapi.xcertplay.WirelessStartupRecoveryTest.aLaterFailureOfTheStoppedAttemptKeepsTheLineSayingTheRetriesStopped")
        excludeTestsMatching("com.shilapi.xcertplay.CarPlayHostSettingsTest")
        excludeTestsMatching("com.shilapi.xcertplay.ClusterSettingsConsentTest")
        excludeTestsMatching("com.shilapi.xcertplay.CarPlaySettingsNavigationTest.homeSettingsButtonOpensTheHostMenu")
    }
}
