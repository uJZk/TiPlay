pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // These coordinates name reviewed local binaries, never remote Maven artifacts.
        exclusiveContent {
            forRepository {
                ivy {
                    name = "TiPlayPinnedVendor"
                    url = uri("shared/libs")
                    patternLayout { artifact("[module]/[artifact].[ext]") }
                    metadataSources { artifact() }
                }
            }
            filter {
                includeModule("com.ujzk.vendor", "geocoordinates")
                includeModule("com.ujzk.vendor", "webrtc-source-rate")
            }
        }
    }
}

rootProject.name = "xcertplay"
include(":common")
include(":mobile")
include(":automotive")
include(":shared")
include(":maphost")
project(":maphost").projectDir = file("samples/maphost")
include(":home")
project(":home").projectDir = file("samples/home")
