# Incremental scope

Baseline: `477801f5e2fde2b48d064bcd06dc2df71f312514`; HEAD: `37e810ee339da79ed53dc106138c7a80ee6c0680`; initial working tree clean. History includes merged branches. Generated locale HTML, binary assets, vendored JNI libraries/tables, and historical docs are excluded from cleanup. AGENTS.md and docs are read-only context (except this sweep).

## `.github/workflows/android-release.yml`

Touches: 2

- 4a8f86701a81217c31c544d17bb87372eed6c451 Deliver signed release workflow outputs to a beta draft
- beb3777271492348f2e97bb883e88edc7b75a358 Add signed release APK build workflow

## `.github/workflows/android.yml`

Touches: 2

- 4a8f86701a81217c31c544d17bb87372eed6c451 Deliver signed release workflow outputs to a beta draft
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `AGENTS.md`

Touches: 15

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery
- 2556509c42c4bc6602806f320c106f01d89a8a44 Document browser permission recovery compatibility
- 15a80d069de18c7a4979d797a8f2a8e4948ae5f8 Document deferred browser audio timing and CarPlay continuity work
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 07667edceee926e2520580b8ccbc12a97862a738 Keep AirPlay control session alive after mirror video EOF
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e7d9f0056ae7d67daafebab9a1095f9dc7ce5f26 docs: document portable builds and WSLC deployment constraints
- 283d4582be56ae39e8874de739119fd6884c645e Release TiPlay 0.2.14-beta.1
- b7e6956933ff8fcf1c58c587c8aca149ef03a748 Document lightweight AirPlay device trust TODO [skip ci]
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- ddad78ba930cc2f11d601419bd965a05515f1b80 Reconcile documentation and keep READMEs focused on users
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `CHANGELOG.md`

Touches: 2

- 283d4582be56ae39e8874de739119fd6884c645e Release TiPlay 0.2.14-beta.1
- ddad78ba930cc2f11d601419bd965a05515f1b80 Reconcile documentation and keep READMEs focused on users

## `README.md`

Touches: 4

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- ddad78ba930cc2f11d601419bd965a05515f1b80 Reconcile documentation and keep READMEs focused on users

## `README.zh-CN.md`

Touches: 4

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- ddad78ba930cc2f11d601419bd965a05515f1b80 Reconcile documentation and keep READMEs focused on users

## `common/build.gradle.kts`

Touches: 1

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `common/src/main/AndroidManifest.xml`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `common/src/main/java/com/shilapi/xcertplay/AirPlayBrowserAudioSink.kt`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/main/java/com/shilapi/xcertplay/AirPlayCastFrameTimes.kt`

Touches: 2

- f8fdfe6977a526d320591778b103b9b0667ee32f Keep AirPlay video visible when source timing is unavailable
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `common/src/main/java/com/shilapi/xcertplay/AirPlayCastInitialSeek.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `common/src/main/java/com/shilapi/xcertplay/AirPlayCastPlayback.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `common/src/main/java/com/shilapi/xcertplay/AirPlayCastPlayer.kt`

Touches: 8

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery
- f8fdfe6977a526d320591778b103b9b0667ee32f Keep AirPlay video visible when source timing is unavailable
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `common/src/main/java/com/shilapi/xcertplay/AirPlayCastSubmissions.kt`

Touches: 1

- f8fdfe6977a526d320591778b103b9b0667ee32f Keep AirPlay video visible when source timing is unavailable

## `common/src/main/java/com/shilapi/xcertplay/AirPlayMirrorAudio.kt`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/main/java/com/shilapi/xcertplay/AirPlayPhotoFrames.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/main/java/com/shilapi/xcertplay/AirPlayReceiverActivity.kt`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `common/src/main/java/com/shilapi/xcertplay/AirPlayReceiverService.kt`

Touches: 8

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `common/src/main/java/com/shilapi/xcertplay/AirPlayReceiverSettings.kt`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `common/src/main/java/com/shilapi/xcertplay/AirPlaySeekCoalescer.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `common/src/main/java/com/shilapi/xcertplay/AirPlayVideoContent.kt`

Touches: 1

- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback

## `common/src/main/java/com/shilapi/xcertplay/AirPlayVideoDataSource.kt`

Touches: 3

- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `common/src/main/java/com/shilapi/xcertplay/AirPlayVideoDiagnostics.kt`

Touches: 4

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery
- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `common/src/main/java/com/shilapi/xcertplay/AirPlayVideoLayout.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `common/src/main/java/com/shilapi/xcertplay/AirPlayVideoSurfaceBridge.kt`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BootReceiver.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserAboutPage.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserAdvancedPage.kt`

Touches: 5

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserAdvancedSettings.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/main/java/com/shilapi/xcertplay/BrowserBootConnectionSettings.kt`

Touches: 2

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserCarPlayAudioSettings.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/main/java/com/shilapi/xcertplay/BrowserCarPlayRetry.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/java/com/shilapi/xcertplay/BrowserCarPlaySettings.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/java/com/shilapi/xcertplay/BrowserCarPlayStatus.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/java/com/shilapi/xcertplay/BrowserCarPlayWatch.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/java/com/shilapi/xcertplay/BrowserConnectionDraft.kt`

Touches: 3

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserDiagnosticResultUi.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserEndpointChanges.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `common/src/main/java/com/shilapi/xcertplay/BrowserEndpointSettings.kt`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserExistingWifiSettings.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserMainSettingsMenu.kt`

Touches: 5

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserNativeSettingsUi.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserPermissionsPage.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserSettingsChanges.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `common/src/main/java/com/shilapi/xcertplay/BrowserSettingsMenu.kt`

Touches: 2

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/BrowserSettingsPolicy.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/main/java/com/shilapi/xcertplay/BrowserSettingsPresentation.kt`

Touches: 2

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/CarPlayHostActivity.kt`

Touches: 5

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/CarPlaySettingsNavigation.kt`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/DiPlayActivity.kt`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/DiPlaySessionService.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/main/java/com/shilapi/xcertplay/DiagnosticExportStore.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/HotspotExtraAddressCard.kt`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/HotspotExtraAddressSettings.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `common/src/main/java/com/shilapi/xcertplay/LocalHotspotAutofill.kt`

Touches: 3

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/LocalHotspotSettings.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `common/src/main/java/com/shilapi/xcertplay/PrivilegedUsbAutoConfirm.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/java/com/shilapi/xcertplay/TeslaBrowserLink.kt`

Touches: 6

- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `common/src/main/java/com/shilapi/xcertplay/TeslaBrowserLinkCard.kt`

Touches: 3

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 5449de24d399f9e4e1ce1124e7066d906df98813 Show Android browser endpoint before hotspot probe completes
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/TeslaBrowserPageLinks.kt`

Touches: 2

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/TiPlayNativeUi.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/java/com/shilapi/xcertplay/UnifiedAirPlayTrialSettings.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `common/src/main/res/values-ar/strings.xml`

Touches: 6

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ar/strings_browser_menus.xml`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ar/strings_browser_revision.xml`

Touches: 3

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ar/strings_carplay_connection.xml`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/res/values-ar/strings_carplay_settings.xml`

Touches: 2

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ar/strings_hotspot_address.xml`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ar/strings_tesla_link.xml`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-es/strings.xml`

Touches: 6

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-es/strings_browser_menus.xml`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-es/strings_browser_revision.xml`

Touches: 3

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-es/strings_carplay_connection.xml`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/res/values-es/strings_carplay_settings.xml`

Touches: 2

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-es/strings_hotspot_address.xml`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-es/strings_tesla_link.xml`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ru/strings.xml`

Touches: 6

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ru/strings_browser_menus.xml`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ru/strings_browser_revision.xml`

Touches: 3

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ru/strings_carplay_connection.xml`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/res/values-ru/strings_carplay_settings.xml`

Touches: 2

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ru/strings_hotspot_address.xml`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-ru/strings_tesla_link.xml`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-uk/strings.xml`

Touches: 6

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-uk/strings_browser_menus.xml`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-uk/strings_browser_revision.xml`

Touches: 3

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-uk/strings_carplay_connection.xml`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/res/values-uk/strings_carplay_settings.xml`

Touches: 2

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-uk/strings_hotspot_address.xml`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-uk/strings_tesla_link.xml`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rCN/strings.xml`

Touches: 6

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rCN/strings_browser_menus.xml`

Touches: 3

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rCN/strings_browser_revision.xml`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rCN/strings_carplay_connection.xml`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/res/values-zh-rCN/strings_carplay_settings.xml`

Touches: 3

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rCN/strings_hotspot_address.xml`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rCN/strings_tesla.xml`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `common/src/main/res/values-zh-rCN/strings_tesla_link.xml`

Touches: 2

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rTW/strings.xml`

Touches: 6

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rTW/strings_browser_menus.xml`

Touches: 3

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rTW/strings_browser_revision.xml`

Touches: 3

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rTW/strings_carplay_connection.xml`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/res/values-zh-rTW/strings_carplay_settings.xml`

Touches: 3

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rTW/strings_hotspot_address.xml`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values-zh-rTW/strings_tesla.xml`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `common/src/main/res/values-zh-rTW/strings_tesla_link.xml`

Touches: 2

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values/strings.xml`

Touches: 6

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values/strings_browser_menus.xml`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values/strings_browser_revision.xml`

Touches: 3

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values/strings_carplay_connection.xml`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/main/res/values/strings_carplay_settings.xml`

Touches: 2

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values/strings_hotspot_address.xml`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/main/res/values/strings_tesla_link.xml`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/AdaptiveSettingsUiTest.kt`

Touches: 2

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/AirPlayBrowserAudioSinkTest.kt`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/test/java/com/shilapi/xcertplay/AirPlayCastFrameTimesTest.kt`

Touches: 2

- f8fdfe6977a526d320591778b103b9b0667ee32f Keep AirPlay video visible when source timing is unavailable
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `common/src/test/java/com/shilapi/xcertplay/AirPlayCastInitialSeekTest.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `common/src/test/java/com/shilapi/xcertplay/AirPlayCastPlaybackTest.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `common/src/test/java/com/shilapi/xcertplay/AirPlayCastSubmissionsTest.kt`

Touches: 1

- f8fdfe6977a526d320591778b103b9b0667ee32f Keep AirPlay video visible when source timing is unavailable

## `common/src/test/java/com/shilapi/xcertplay/AirPlayReceiverSettingsTest.kt`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `common/src/test/java/com/shilapi/xcertplay/AirPlaySeekCoalescerTest.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `common/src/test/java/com/shilapi/xcertplay/AirPlayVideoContentTest.kt`

Touches: 1

- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback

## `common/src/test/java/com/shilapi/xcertplay/AirPlayVideoDataSourceTest.kt`

Touches: 3

- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `common/src/test/java/com/shilapi/xcertplay/AirPlayVideoDiagnosticsTest.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `common/src/test/java/com/shilapi/xcertplay/AirPlayVideoLayoutTest.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `common/src/test/java/com/shilapi/xcertplay/BrowserAdvancedPageTest.kt`

Touches: 3

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/BrowserCarPlayRetryTest.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/test/java/com/shilapi/xcertplay/BrowserCarPlaySettingsTest.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `common/src/test/java/com/shilapi/xcertplay/BrowserEndpointSettingsTest.kt`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/BrowserMainEntryTest.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/BrowserMainHostTest.kt`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/BrowserMainPageTest.kt`

Touches: 5

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/BrowserSettingsLifecycleTest.kt`

Touches: 2

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `common/src/test/java/com/shilapi/xcertplay/BrowserSettingsPolicyTest.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/test/java/com/shilapi/xcertplay/BrowserSettingsReceiverPermission.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `common/src/test/java/com/shilapi/xcertplay/CarButtonImagePickerTest.kt`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/CarPlayHostBrowserLinkTest.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/test/java/com/shilapi/xcertplay/CarPlayHostResolutionTest.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/test/java/com/shilapi/xcertplay/CarPlayNightModeControllerTest.kt`

Touches: 1

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `common/src/test/java/com/shilapi/xcertplay/CarPlaySettingsNavigationTest.kt`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/DiPlaySessionServiceTest.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `common/src/test/java/com/shilapi/xcertplay/DiagnosticExportFallbackTest.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/DiagnosticExportUiTest.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/ExistingWifiManagerTest.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/HostConnectionSettingsRefreshTest.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `common/src/test/java/com/shilapi/xcertplay/HotspotExtraAddressSettingsTest.kt`

Touches: 4

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/LocalHotspotSettingsTest.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `common/src/test/java/com/shilapi/xcertplay/SmoothVideoHostLifecycleTest.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `common/src/test/java/com/shilapi/xcertplay/StartupDiagnosticSnapshotTest.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/TeslaBrowserLinkSettingsTest.kt`

Touches: 4

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 5449de24d399f9e4e1ce1124e7066d906df98813 Show Android browser endpoint before hotspot probe completes
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/TeslaBrowserLinkTest.kt`

Touches: 5

- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `common/src/test/java/com/shilapi/xcertplay/TeslaBrowserPageLinksTest.kt`

Touches: 3

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/TiPlayNativeUiTest.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `common/src/test/java/com/shilapi/xcertplay/TiPlayTestApplication.kt`

Touches: 1

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `common/src/test/java/com/shilapi/xcertplay/UnifiedAirPlayTrialSettingsTest.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `common/src/test/java/com/shilapi/xcertplay/WirelessStartupRecoveryTest.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `gradle/tiplay-product-tests.gradle.kts`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `mobile/build.gradle.kts`

Touches: 1

- 283d4582be56ae39e8874de739119fd6884c645e Release TiPlay 0.2.14-beta.1

## `mobile/src/main/AndroidManifest.xml`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `scripts/publish_release_draft.py`

Touches: 2

- 4dbc00fba3541e476b1cf92c577e8328c41ffdbf Find unpublished release drafts through the releases list
- 4a8f86701a81217c31c544d17bb87372eed6c451 Deliver signed release workflow outputs to a beta draft

## `scripts/test_airplay_native.py`

Touches: 1

- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/main/java/com/shilapi/xcertplay/airplay/AirPlayInfoPlist.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `shared/src/main/java/com/shilapi/xcertplay/airplay/AirPlaySession.kt`

Touches: 5

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `shared/src/main/java/com/shilapi/xcertplay/airplay/BrowserBufferedAudioPolicy.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/main/java/com/shilapi/xcertplay/airplay/BufferedAudioStream.kt`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/main/java/com/shilapi/xcertplay/airplay/CarPlayMediaEngine.kt`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/main/java/com/shilapi/xcertplay/airplay/MediaClockDiagnostics.kt`

Touches: 2

- 07667edceee926e2520580b8ccbc12a97862a738 Keep AirPlay control session alive after mirror video EOF
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/airplay/NtpClock.kt`

Touches: 5

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 07667edceee926e2520580b8ccbc12a97862a738 Keep AirPlay control session alive after mirror video EOF
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `shared/src/main/java/com/shilapi/xcertplay/airplay/NtpWireTimeline.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/airplay/RtpAudioTimeline.kt`

Touches: 1

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `shared/src/main/java/com/shilapi/xcertplay/airplay/ScreenStream.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/airplay/VideoInCar.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `shared/src/main/java/com/shilapi/xcertplay/airplay/VideoMediaClockMapping.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/media/BrowserAudioMediaSink.kt`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/main/java/com/shilapi/xcertplay/media/BrowserMicrophone.kt`

Touches: 1

- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback

## `shared/src/main/java/com/shilapi/xcertplay/media/BrowserOnlyMediaSink.kt`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/main/java/com/shilapi/xcertplay/media/OpusEncoder.kt`

Touches: 1

- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback

## `shared/src/main/java/com/shilapi/xcertplay/media/VideoTeeMediaSink.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/network/CarPlayBonjour.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/network/CarPlayVpnService.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/network/ExistingWifiManager.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/network/ExistingWifiSecurity.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/network/HotspotAddressVpn.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `shared/src/main/java/com/shilapi/xcertplay/network/HotspotAddressVpnService.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `shared/src/main/java/com/shilapi/xcertplay/network/HotspotConfigurationReader.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/network/HotspotConfigurationReaderMain.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/network/HotspotExtraAddress.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `shared/src/main/java/com/shilapi/xcertplay/network/RootShell.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `shared/src/main/java/com/shilapi/xcertplay/network/UnifiedAirPlayEndpoint.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/network/UnifiedAirPlayWirelessLease.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/orchestration/CarPlayController.kt`

Touches: 3

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/orchestration/CarPlayRuntimeConfig.kt`

Touches: 1

- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverAudioCapabilities.kt`

Touches: 2

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverAudioDrain.kt`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverAvc.kt`

Touches: 1

- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverBonjour.kt`

Touches: 3

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverCapabilities.kt`

Touches: 2

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverDiscoveryInterfaces.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverHandshake.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverInfoProtocol.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverMetadata.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverMirrorAudioOrder.kt`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverMirrorAudioPacket.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverMirrorAudioTiming.kt`

Touches: 1

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverMirrorCodec.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverMirrorDiagnostics.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverMirrorParameters.kt`

Touches: 3

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverMirrorStream.kt`

Touches: 3

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverPairing.kt`

Touches: 2

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverPhotos.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverProtocol.kt`

Touches: 5

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverProtocolDiagnostics.kt`

Touches: 4

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 07667edceee926e2520580b8ccbc12a97862a738 Keep AirPlay control session alive after mirror video EOF
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverRequestConnection.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverRequestTarget.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverResourceRequests.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverServer.kt`

Touches: 7

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 07667edceee926e2520580b8ccbc12a97862a738 Keep AirPlay control session alive after mirror video EOF
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverStreamTeardown.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverVideoControlDiagnostics.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `shared/src/main/java/com/shilapi/xcertplay/receiver/ReceiverVideoProperties.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `shared/src/main/java/com/shilapi/xcertplay/receiver/UnifiedAirPlayTrial.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/main/java/com/shilapi/xcertplay/transport/IphoneUsbHost.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `shared/src/main/java/com/shilapi/xcertplay/transport/PrivilegedUsbPermission.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `shared/src/main/java/com/shilapi/xcertplay/web/AirPlayBrowserPlayback.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/main/java/com/shilapi/xcertplay/web/BrowserDisplayOwner.kt`

Touches: 1

- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes

## `shared/src/main/java/com/shilapi/xcertplay/web/BrowserLinkServer.kt`

Touches: 5

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/web/BrowserLinkStatus.kt`

Touches: 2

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/web/BrowserPairingGate.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/web/BrowserPlaybackMode.kt`

Touches: 1

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `shared/src/main/java/com/shilapi/xcertplay/web/BrowserTouchSlots.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/web/VideoPerformance.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/web/WebAudioHub.kt`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/main/java/com/shilapi/xcertplay/web/WebDebugTiming.kt`

Touches: 2

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/main/java/com/shilapi/xcertplay/web/WebFrameQueue.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/web/WebJson.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/web/WebMediaSink.kt`

Touches: 4

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/web/WebVideoCodecs.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/web/WebVideoHub.kt`

Touches: 4

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/java/com/shilapi/xcertplay/web/WebVideoRecords.kt`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/airplay/BufferedAudioStreamTest.kt`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/test/java/com/shilapi/xcertplay/airplay/CarPlayAudioStreamIsolationTest.kt`

Touches: 1

- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback

## `shared/src/test/java/com/shilapi/xcertplay/airplay/MediaClockDiagnosticsTest.kt`

Touches: 2

- 07667edceee926e2520580b8ccbc12a97862a738 Keep AirPlay control session alive after mirror video EOF
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/test/java/com/shilapi/xcertplay/airplay/MediaClockMappingTest.kt`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/test/java/com/shilapi/xcertplay/airplay/OrdinaryAirPlayTimingTest.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/test/java/com/shilapi/xcertplay/airplay/PeerInitiatedTimingTest.kt`

Touches: 2

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `shared/src/test/java/com/shilapi/xcertplay/airplay/RtpAudioTimelineTest.kt`

Touches: 1

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `shared/src/test/java/com/shilapi/xcertplay/airplay/ScreenCodecTest.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/airplay/UnifiedAirPlaySessionTest.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/test/java/com/shilapi/xcertplay/airplay/VideoInCarTest.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `shared/src/test/java/com/shilapi/xcertplay/airplay/VideoMediaClockMappingTest.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/test/java/com/shilapi/xcertplay/media/BrowserAudioMediaSinkTest.kt`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/test/java/com/shilapi/xcertplay/media/BrowserMicrophoneTest.kt`

Touches: 1

- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback

## `shared/src/test/java/com/shilapi/xcertplay/media/BrowserOnlyMediaSinkTest.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/test/java/com/shilapi/xcertplay/media/VideoTeeMediaSinkTest.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/network/HotspotAddressVpnTest.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `shared/src/test/java/com/shilapi/xcertplay/network/HotspotConfigurationReaderTest.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/test/java/com/shilapi/xcertplay/network/HotspotExtraAddressTest.kt`

Touches: 1

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `shared/src/test/java/com/shilapi/xcertplay/network/RootShellTest.kt`

Touches: 1

- 3d5d03c63ae004c5b2376db19e41feb51f44679b Add continuous CarPlay recovery and USB-first connection mode

## `shared/src/test/java/com/shilapi/xcertplay/network/UnifiedAirPlayEndpointTest.kt`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/test/java/com/shilapi/xcertplay/orchestration/CarPlayControllerHeadUnitIntegrationsTest.kt`

Touches: 1

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverAudioDrainTest.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverDiscoveryInterfacesTest.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverHandshakeTest.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverInfoProtocolTest.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverMetadataTest.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverMirrorAudioOrderTest.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverMirrorAudioPacketTest.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverMirrorAudioTimingTest.kt`

Touches: 1

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverMirrorCodecTest.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverMirrorDiagnosticsTest.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverMirrorParametersTest.kt`

Touches: 2

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverPairingTest.kt`

Touches: 2

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverPhotosTest.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverProtocolDiagnosticsTest.kt`

Touches: 3

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery
- 07667edceee926e2520580b8ccbc12a97862a738 Keep AirPlay control session alive after mirror video EOF
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverProtocolTest.kt`

Touches: 4

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverRequestTargetTest.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverResourceRequestsTest.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverServerTest.kt`

Touches: 6

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial
- 07667edceee926e2520580b8ccbc12a97862a738 Keep AirPlay control session alive after mirror video EOF
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/test/java/com/shilapi/xcertplay/receiver/ReceiverVideoPropertiesTest.kt`

Touches: 1

- 37e810ee339da79ed53dc106138c7a80ee6c0680 Fix ordinary AirPlay video seek and playback recovery

## `shared/src/test/java/com/shilapi/xcertplay/receiver/UnifiedAirPlayTrialTest.kt`

Touches: 1

- d6fe2457662ccfd22989f94f80a0071c555fc242 Stabilize AirPlay mirroring and add unified CarPlay entry trial

## `shared/src/test/java/com/shilapi/xcertplay/web/AirPlayBrowserPlaybackTest.kt`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/test/java/com/shilapi/xcertplay/web/BrowserDisplayOwnershipTest.kt`

Touches: 1

- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes

## `shared/src/test/java/com/shilapi/xcertplay/web/BrowserLinkPageTest.kt`

Touches: 1

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `shared/src/test/java/com/shilapi/xcertplay/web/BrowserLinkServerTest.kt`

Touches: 4

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/web/BrowserLinkStatusTest.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/web/BrowserPairingGateTest.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/web/BrowserTouchSlotsTest.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/web/VideoPerformanceTest.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/web/WebAudioHubTest.kt`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `shared/src/test/java/com/shilapi/xcertplay/web/WebDebugTimingTest.kt`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `shared/src/test/java/com/shilapi/xcertplay/web/WebFrameQueueTest.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/web/WebJsonTest.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/web/WebMediaSinkPauseTest.kt`

Touches: 1

- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/test/java/com/shilapi/xcertplay/web/WebMediaSinkTest.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/web/WebVideoCodecsTest.kt`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/web/WebVideoHubTest.kt`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/java/com/shilapi/xcertplay/web/WebVideoRecordsTest.kt`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/resources/web/records-v1.bin`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/test/resources/web/records-v1.json`

Touches: 2

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `site/play/airplay-controls.css`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `site/play/airplay-controls.js`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `site/play/app.js`

Touches: 9

- 4f210a7a9086447a54ded58f7fa637d715875b4b Clarify waiting states and refresh retry countdown every second
- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `site/play/audio-protocol.js`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `site/play/audio-worklet.js`

Touches: 3

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `site/play/audio.js`

Touches: 5

- ae4c5707e6faef0844f82902eccb67331c1990ed Clear recovered browser audio permissions and match warning styling
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `site/play/clock-sync.js`

Touches: 1

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle

## `site/play/decoder-worker.js`

Touches: 4

- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `site/play/delay-plan.js`

Touches: 2

- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `site/play/fmp4.js`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `site/play/fps-window.js`

Touches: 2

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `site/play/icon.svg`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `site/play/index.html`

Touches: 7

- ae4c5707e6faef0844f82902eccb67331c1990ed Clear recovered browser audio permissions and match warning styling
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `site/play/link.js`

Touches: 4

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `site/play/media-timing.js`

Touches: 2

- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `site/play/mse.js`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `site/play/pcm-timeline.js`

Touches: 1

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `site/play/playback-window.js`

Touches: 2

- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `site/play/presentation-debug.js`

Touches: 1

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `site/play/style.css`

Touches: 6

- ae4c5707e6faef0844f82902eccb67331c1990ed Clear recovered browser audio permissions and match warning styling
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `site/play/sw.js`

Touches: 12

- 4f210a7a9086447a54ded58f7fa637d715875b4b Clarify waiting states and refresh retry countdown every second
- ae4c5707e6faef0844f82902eccb67331c1990ed Clear recovered browser audio permissions and match warning styling
- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `site/play/video.js`

Touches: 5

- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `tests/test_release_draft.py`

Touches: 2

- 4dbc00fba3541e476b1cf92c577e8328c41ffdbf Find unpublished release drafts through the releases list
- 4a8f86701a81217c31c544d17bb87372eed6c451 Deliver signed release workflow outputs to a beta draft

## `tests/web-e2e/README.md`

Touches: 5

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- ddad78ba930cc2f11d601419bd965a05515f1b80 Reconcile documentation and keep READMEs focused on users
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `tests/web-e2e/RealPhone.java`

Touches: 2

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `tests/web-e2e/fake-phone.mjs`

Touches: 2

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `tests/web-e2e/phone-run.mjs`

Touches: 1

- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `tests/web-e2e/run.mjs`

Touches: 4

- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `tests/web/airplay-controls.test.mjs`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `tests/web/audio.test.mjs`

Touches: 5

- ae4c5707e6faef0844f82902eccb67331c1990ed Clear recovered browser audio permissions and match warning styling
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7fcb4759d0454e26e1faf9c86ef306c52e6a10b6 Keep AirPlay display through CarPlay lifecycle and accept HLS audio probes
- 3bac79e2bbd18f11ce4783160738364ec3da4111 Fix browser microphone upload and AirPlay HLS playback
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `tests/web/debug-window.test.mjs`

Touches: 2

- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page

## `tests/web/delta-wiring.test.mjs`

Touches: 1

- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing

## `tests/web/endpoint.test.mjs`

Touches: 2

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default

## `tests/web/fmp4.test.mjs`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `tests/web/link.test.mjs`

Touches: 3

- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `tests/web/media-timing.test.mjs`

Touches: 2

- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `tests/web/page.test.mjs`

Touches: 7

- 4f210a7a9086447a54ded58f7fa637d715875b4b Clarify waiting states and refresh retry countdown every second
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- 5ea2cb92ee72e068cd86249126d8d4990de0c704 Apply browser settings immediately and enable AirPlay by default
- 4884b89c01ebb255cb88a0e8b86d588ae069d070 Refine browser settings, native UI and launcher lifecycle
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `tests/web/portal.test.mjs`

Touches: 1

- 7983e133cb91c99444d4e0191f427ac9f384b690 Relay CarPlay browser audio and add AirPlay playback controls

## `tests/web/presentation-debug.test.mjs`

Touches: 2

- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration

## `tests/web/records-v1.test.mjs`

Touches: 1

- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `tests/web/video.test.mjs`

Touches: 5

- 069dba62e64bcb518e5298c8b75321295894e223 Enforce raw Delta playback limits with bounded smoothing
- e6a583bce3069d88d5389c1e9d343739b573d190 Preserve media clocks and add unbuffered recording calibration
- 6dbede087af10c062538428275d4d97ea0977aef Fix phone hotspot import, browser timing and AirPlay playback lifecycle
- e08907eee9480638b59af8540e710a4a28933a5b Fix CarPlay browser state and remove the bundled page
- 68dfb7ea73a34cfec2d9b449d455ca376adb7d81 WIP snapshot: browser link core and page (reviewed, CI running)

## `shared/src/main/jni/Android.mk`

Touches: 1

- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `shared/src/main/jni/airplay/fairplay_jni.c`

Touches: 1

- 54237412aeeca8235d9206bbbccd2525ce41a072 Add experimental AirPlay receiver with retained CarPlay display and disable setting

## `docs/AIRPLAY.md` (retirement consistency)

Previously read-only; included for narrow removal of current single-Bonjour trial operating instructions, per user-authorized RETIREMENT-SCOPE.md. Commit history is retained in HISTORY.txt; no historical audit rewrites.
