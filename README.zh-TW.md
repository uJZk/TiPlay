# TiPlay

**用 Android 手機將 CarPlay 顯示在車載瀏覽器。**

TiPlay 只支援 Android 手機＋車載瀏覽器，不支援原生 Android 車機。這是實驗性、未經 Apple 認證的產品，完整 iPhone／實車驗證仍待完成。

需要 Android 9 以上手機、iPhone，以及支援 WebCodecs 的車載瀏覽器。頁面透過 HTTPS 提供；首次載入需要網路，之後可使用離線快取。

## 連線

1. 停車後安裝 TiPlay 並授予所用功能的權限。
2. 無線 CarPlay 需將 iPhone 與 Android 手機配對；也可使用 USB。
3. 在「主設定」選擇 Android 熱點或現有 Wi-Fi，讓手機、iPhone 和汽車能透過相同網路通訊。熱點需在 Android 系統設定中開啟。
4. 在車載瀏覽器開啟 TiPlay 顯示的連結，輸入配對碼並連線。Tesla 的可用位址、Root／Shizuku／VPN 要求見[瀏覽器指南](docs/TESLA_BROWSER.md)與[熱點位址](docs/HOTSPOT_ADDRESS.md)。

## 聲音與設定

音樂送至網頁播放；需要麥克風時，Android 切換到汽車的藍牙 HFP/SCO 通道，採集錄音並播放通話、Siri 和導航，結束後恢復網頁播放。「停用 CarPlay 音訊」可讓所有聲音使用 iPhone 與汽車的直接藍牙連線。

產品只有「主設定」和「進階設定」。有效的變更立即儲存，必要時自動重新連線。新安裝預設 60 fps，已儲存的選擇保持不變。AirPlay 鏡像與非 DRM 影片投放仍為實驗性功能，見 [AirPlay 說明](docs/AIRPLAY.md)。

## 說明與來源

完整操作、限制與診斷方式見 [English](README.md) 或[简体中文](README.zh-CN.md)。報告問題前，使用最新 TiPlay 重現，保存診斷報告並檢查內容，再附到 [TiPlay Issues](https://github.com/uJZk/TiPlay/issues)。報告不會自動上傳。

TiPlay 基於 shihabal3amri 的 [DiPlay](https://github.com/shihabal3amri/DiPlay) 和 [xcertplay](https://github.com/shilapi/xcertplay)（GPL-3.0），介面與網站改編自 DiAuto（AGPL-3.0）。[授權與致謝](docs/THIRD_PARTY_NOTICES.md)保留來源資訊；[原上游繁體中文 README](docs/UPSTREAM-README.zh-TW.md)僅作歷史紀錄，其原生車機說明不代表 TiPlay 支援範圍。
