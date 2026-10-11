# TiPlay 设置逻辑与 UX 调整 — 2026-10-11

状态：实现与验证完成；功能提交 `3c231985a10211b12dc46488b77a540decb3c124` 已推送 main，网站图标已通过现有 GitHub Pages 流程部署。

## 当前菜单

主菜单依次为连接、启动与连接、显示、车辆、高级、诊断。热点地址方式为第一个设置：无特权（不添加地址）、Root、VPN（仍为实验性）、Shizuku。车机浏览器页面地址、配对码与唯一的 HTTPS 复制链接也在主菜单中。

- “与 iPhone 的连接模式”：无线 / USB，修改进入菜单草稿，保存并重新连接或用于下次连接。USB 模式不校验 iPhone 的热点凭据，但保留 Wi-Fi 会话入口供车机浏览器网络使用。迁移旧的独立启动模式，统一自动连接与手动连接的保存模式。
- Wi-Fi 会话中的第一个操作为读取本机热点，仅在本机热点模式显示；切换为同一局域网时隐藏。名称、密码和安全类型仍可编辑；频段使用自动、信道为 0（自动），隐藏手动输入并清除旧的无线参数提示。它们不会改变 Android 系统热点的实际射频设置。
- “启动与连接”只显示“打开 TiPlay 时自动连接”，此开关立即保存，使用已保存的连接模式。开机启动由 BootReceiver 在手机＋浏览器模式下禁用，因此在本模式隐藏；继承车机代码保留。
- 显示分组包含帧率与 HEVC，HEVC 去除实验性标记，浏览器模式没有保存过编码选择时默认开启；明确保存的关闭选择保留。视频更改仍需保存并重新连接。
- MFi 证书与签名目标放在高级分组。AirPlay 图标编辑隐藏，已有内部标识和图标持久化未删除。
- 车机浏览器去除实验性标题。移除本地 HTTP 页面显示与复制按钮；保留 HTTP 页面和接口，供其他浏览器或开发测试使用。

## 实现与生命周期

新增 BrowserSettingsMenu 承载当前产品菜单控件，通过小钩子接入 CarPlayHostActivity。主菜单控件与附加连接页不重复。热点读取采用 LatestSettingsProbe：至多一项运行、一项最新等待，离开视图取消回调；后台工作只持有应用 Context。返回结果不覆盖期间的输入。重复读取仅替换最新等待请求，不会让旧界面的读取按钮永久停用；主菜单返回时恢复地址方式，接续 VPN 授权结果。

## 应用与 CarPlay 图标

采用用户提供的 `assets/branding/logo_centered.svg`，保留原始颜色与米白背景。`scripts/generate_app_icons.py` 使用 Inkscape 与 Pillow 可重复生成资源：Android 各密度的普通、圆形、自适应前景/背景、单色图标与商店图标，以及 192×192 CarPlay PNG；浏览器页面与下载页源码中的站点图标同步使用此标志。Android 主应用清单接入 mipmap 自适应入口，前景留出裁切安全边距。CarPlay 两种模式使用同一打包图标，连接时直接读取 PNG，取消运行时绘制与重新压缩；已保存的自定义图标仍遵循现有覆盖规则。

用户先要求跳过 GitHub Release 草稿，随后重新授权尝试。再次请求仍被环境代理以 403 拒绝，因此尚未创建草稿或上传 APK。当前执行环境未放行 `api.github.com` / `uploads.github.com`；临时中转 `tmpfiles.org` / `file.io` 同样被拒绝。GitHub 连接器可读取工作流状态，但没有可调用的 Release 创建或二进制上传工具；Git 推送路径可用。

## 验证

- JDK 25.0.4.1 执行 AGENTS.md 要求的完整 Android CI 命令：BUILD SUCCESSFUL（5m 46s），247 项任务。shared 1,205、common 997、home 4 项单元测试，共 2,206 项，失败、错误、跳过均为 0；mobile、home、maphost 的 lint 与 Debug APK 构建通过。
- `node --test tests/web/*.test.mjs`：60/60 通过（Node 24.19.0；启用测试所需的本地网络访问）。
- `git diff --check`、公共树凭据检查、图标各密度尺寸与原始 SVG 一致性检查通过。
- 回归覆盖菜单顺序、连接草稿取消、USB 无热点凭据保存、本机热点读取入口随网络后端显示/隐藏、单一链接复制、默认 HEVC、旧模式迁移，以及 CarPlay 实际发送的图标与预览一致。
- 交付 APK：`mobile/build/outputs/apk/debug/mobile-debug.apk`，包名 `com.ujzk.tiplay.hudtest`，版本 `0.2.13-hud-test`，最低 Android 9。SHA-256：`798b167769076af10fd6969fd67a9fff46cc638ef0a286375a0970c934fc1756`。

最终日志位于当前工作环境的 `/tmp/tiplay-settings-icons-android.log` 与 `/tmp/tiplay-settings-icons-browser.log`。

## 继续工作

本轮使用现有 Pages 部署流程更新网站图标，不更改认证身份或站点默认地址；既有 DiPlay/TiPlay 链接规范冲突仍见文档清理报告。完整特斯拉音视频流程仍待实车验收，HEVC 不支持时可关闭并重连切回 H.264。

## 收尾 — 2026-10-11

按 tie-up 技能执行。清理本轮临时预览，无遗留 Gradle 后台进程。复用已完成的 Android 全量验证与 APK；快速复核浏览器 60/60、diff 空白检查与公共树检查通过；站点已在 `/tmp/tiplay-tie-up-site` 完成组装。当前分支为默认 main，无需合并。

功能提交：`3c231985a10211b12dc46488b77a540decb3c124`（Improve browser settings UX and unify TiPlay icons）。正常推送至 `origin/main`，无强制推送。站点组装产物中的 SVG 与 PNG 均核对为本轮图标。

[Pages 工作流 38104480455](https://github.com/uJZk/TiPlay/actions/runs/38104480455) 已成功；部署地址为 https://ujzk.github.io/TiPlay/ 。[GitHub Android 检查 38104480474](https://github.com/uJZk/TiPlay/actions/runs/38104480474) 在记录时仍运行中；本地完整 Android 检查已经通过，详情见上文。

Release 草稿与 APK 临时下载尚未完成，仍需可用上传通道；发布说明保留于 `mobile/build/outputs/apk/debug/release-notes.md`，APK 哈希见上文。用户已授权，不需再次征求发布草稿或临时上传的许可；恢复访问后仅创建草稿，不公开发布。剩余实车验收及既有链接规范冲突保留。
