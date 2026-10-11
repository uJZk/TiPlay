import org.gradle.api.tasks.testing.Test

// Upstream UI fixtures target the former home/settings overlay and native head-unit gestures.
// Retain their source for merges; BrowserMainPageTest/BrowserMainHostTest cover TiPlay's product flow.
tasks.withType<Test>().configureEach {
    filter {
        excludeTestsMatching("com.shilapi.xcertplay.HomeCompactLayoutTest")
        excludeTestsMatching("com.shilapi.xcertplay.CarPlayHostSettingsTest")
        excludeTestsMatching("com.shilapi.xcertplay.ClusterSettingsConsentTest")
        excludeTestsMatching("com.shilapi.xcertplay.CarPlaySettingsNavigationTest.homeSettingsButtonOpensTheHostMenu")
    }
}
