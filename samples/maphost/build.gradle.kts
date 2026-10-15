// Sample: how a launcher embeds DiPlay's live dashboard map. See https://github.com/uJZk/TiPlay/blob/4d03261f9dc915d0acb2cd6f69f7028640da6f04/docs/LAUNCHER_INTEGRATION.md.
plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.diplay.maphost"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "com.diplay.maphost"
        minSdk = 30 // SurfaceView.getHostToken and setChildSurfacePackage
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}
