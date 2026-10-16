import org.gradle.api.tasks.testing.Test

// Upstream UI fixtures target the former home/settings overlay and native head-unit gestures.
// Retain their source for merges; BrowserMainPageTest/BrowserMainHostTest cover TiPlay's product flow.
tasks.withType<Test>().configureEach {
    filter {
        excludeTestsMatching("com.shilapi.xcertplay.HomeCompactLayoutTest")
        // DiPlay 0.2.20's native Home auto-tethering screen is outside the phone/browser product.
        // Keep its upstream fixture intact; BrowserMainPageTest/HotspotOperationFeedbackTest cover ours.
        excludeTestsMatching("com.shilapi.xcertplay.HomeHotspotAccessTest")
        excludeTestsMatching("com.shilapi.xcertplay.CarPlayHostSettingsTest")
        excludeTestsMatching("com.shilapi.xcertplay.ClusterSettingsConsentTest")
        excludeTestsMatching("com.shilapi.xcertplay.CarPlaySettingsNavigationTest.homeSettingsButtonOpensTheHostMenu")
    }
}
