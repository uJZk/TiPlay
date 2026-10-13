# 浏览器媒体调整收尾

本轮用户通过 [tie-up](skill://user/6ac97d91ed5c81919d90d7181baa6397/tie-up/SKILL.md) 授权清理、提交、合并主分支、推送和现有部署流程。实现和使用限制见 [媒体调整](BROWSER-MEDIA-2026-10-13.md)。

## 已验证的本轮实现

完整 Android CI 命令成功：shared 1,351、common 1,069、home 4，合计 2,424 项，零失败／错误／跳过；三个应用的 debug lint 和源码构建成功。Node 22 的 114 项网页测试、完整桌面 Chromium E2E 和实际 Video.js MP4 解码／蓝牙静音检查成功。公共源码及 9 项发布工具测试通过。

删除网页录音申请、上传接口、浏览器／WASM／安卓软件 AEC 兜底和权限横幅；蓝牙通道的导航固定 0.25 增益，不因通话或 Siri 是否有声音而变化。闲时网页播放，录音需求时只通过已确认的车机 HFP/SCO 双向通道，结束后实际释放再恢复新声音。

清理临时 AEC 研究、废弃 WASM 工具链、旧日志、下载压缩包和重复站点／基线副本；保留构建工具缓存与最终验证证据。未操作真实手机。

## 主分支整合与发布

远程 main 的 37e810ee 增加了普通 AirPlay 控制、资源复用和显示恢复修复。整合时保留适用协议行为，旧安卓 URL 解码器专用辅助逻辑退出当前产品链路。删除已经失效的 AirPlayCastInitialSeek／AirPlayCastPlayback 及对应测试，保留并适配 FCUP 在途资源复用、传统 HTTP 控制兼容性、缓冲状态反馈和停止后恢复保护。独立 seek 版本避免 pause／play 回滚进度，浏览器连续缓冲终点用于播放反馈，缓冲时保留 rate 和已准备状态。

整合后完整 Android CI 成功：shared 1,360、common 1,071、home 4，共 2,435 项，零失败／错误／跳过；三应用 lint 和源码 debug 构建通过。Node 22 114/114；完整浏览器 E2E 和 Video.js 实际解码／进度保持／新 seek／蓝牙静音检查通过。

已发布版本为 0.2.14-beta.1；本轮改为 0.2.14-beta.2／versionCode 34。签名 APK、精确源码 ZIP 和 SHA256 按现有 android-release.yml 工作流生成到 Release 草稿，不覆盖已发布附件。网页通过 pages.yml 部署，地址为 https://ujzk.github.io/TiPlay/。

本轮实现提交为 1fc43f58，主分支合并提交为 e6bb1a497347df00ebdad4e9b416bef25e79246f；work 本地分支已删除，本轮 Gradle 构建守护进程已停止。

[签名与草稿工作流 38390036655](https://github.com/uJZk/TiPlay/actions/runs/38390036655) 的 release 和 draft 两个 job 均成功。签名输入、源码、上游身份、release lint／构建、APK／源码校验和附件上传检查均通过。[beta.2 Release 草稿](https://github.com/uJZk/TiPlay/releases/tag/untagged-ed9874c4a2861f3d95eb) 保持 prerelease draft，精确指向 e6bb1a49，附 APK、源码 ZIP 和 SHA256SUMS.txt 三项，不修改已发布 beta.1。

APK SHA256：`b9b7034fe4e44897cc15bdfbb9a2a7b06ae00dd1f92ffa350dcffb38cdec1a5f`。源码 ZIP SHA256：`f8044e6a71aded5085f3bda41457860c3428ec8319ed430ef214e876edddbce0`。

随后只修改网页资源打开失败的反馈版本，确保加载期间的新 pause／play 命令不使失败被视为旧状态。Node 22 114/114 和真实 Video.js E2E 均再次通过，包括该失败竞态。安卓源码和签名 APK 不受这项网页修改影响；APK 未打包网页。网页部署将使用包含该修复的后续提交。

main 推送、Pages 部署和临时交付分支清理待补充。

## 下一步

实车确认安卓与车辆 HFP 配对／接通、手机后台和熄屏录音、Siri／通话优先级、导航固定衰减、旧音乐丢弃、SCO 释放、车机回声处理及失败诊断。实际 iPhone HLS／FCUP 与 iPhone 资源直连的 CORS／可达性也需要验证。桌面测试不能代替这些条件。
