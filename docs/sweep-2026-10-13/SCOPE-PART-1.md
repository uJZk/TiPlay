# Incremental scope — part 1

[Scope index](SCOPE.md). Baseline, exclusions and ordering follow the index.

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
