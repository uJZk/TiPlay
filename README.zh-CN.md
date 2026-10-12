# TiPlay

**用安卓手机把 CarPlay 送到车载浏览器。**

TiPlay 在安卓手机上运行，把 iPhone 的 CarPlay 画面送到车载浏览器，再把触摸操作传回 iPhone。音乐、导航语音、Siri 和电话计划通过 iPhone 与汽车之间的蓝牙连接处理；完整音频路线仍待实车验证。

TiPlay 只支持安卓手机＋车载浏览器流程，不支持原生安卓车机。

[版本发布](https://github.com/uJZk/DiPlay/releases) · [报告问题](https://github.com/uJZk/DiPlay/issues/new/choose) · [English](README.md)

## 当前状态与要求

TiPlay 是实验性产品，还没有公开发布的版本。可在[版本发布](https://github.com/uJZk/DiPlay/releases)查看可用 APK，安装步骤见[安装指南](docs/INSTALL.md)。

需要 Android 9+ 手机、iPhone 和兼容的车载浏览器。TiPlay 可与 DiPlay 同时安装，但不会沿用其设置或配对记录。请一次只运行一个投屏应用。

在测试的 Model Y 上，探测页能硬解 1080p60 的 H.264 和 HEVC，HTTPS 页面能访问手机热点上的 100.64 地址。这些是浏览器探测结果：完整 CarPlay 流程及车辆蓝牙音频路线仍未在特斯拉上验证。浏览器和安卓系统的行为可能随软件更新变化。

## 安装与连接

1. 停车后在安卓手机上安装 TiPlay，授予所用功能请求的权限。
2. 用蓝牙把 iPhone 与汽车配对，并设为音频和通话的主电话。无线 CarPlay 还需要把 iPhone 与安卓手机配对。
3. 在 TiPlay“主设置”选择 iPhone 和“CarPlay 连接模式 → 无线／USB”。无线连接可选“安卓热点”并填写名称、安全类型和密码，或选“现有 Wi-Fi”并让三台设备连接同一网络。热点需在安卓系统设置中开启，TiPlay 不会代为开启。
4. 让汽车连接同一网络。特斯拉浏览器需要能访问的手机地址，避开其拦截的私有地址范围；已测试的路线使用 100.64.0.0/10。[热点地址](docs/HOTSPOT_ADDRESS.md)说明 root、Shizuku 和实验性 VPN 的要求与限制。
5. 安卓应用会持续尝试连接 CarPlay；设置修改后自动应用，必要时可点击“重新连接 CarPlay”。在车载浏览器打开 TiPlay 页面，使用应用显示的链接／配对码，再点击网页上的“连接”。

页面地址、USB 权限、配对及排错见[安装与连接](docs/INSTALL.md)和[特斯拉浏览器设置](docs/TESLA_BROWSER.md)。页面需要 HTTPS 和支持 WebCodecs 的浏览器；首次加载需要联网，之后可利用缓存离线使用。

## 使用与设置

CarPlay 填满浏览器视频区域。点击 CarPlay 内的 **TiPlay** 图标可打开门户，连接保持运行。窗口变化时画面立即适应；大小稳定后，TiPlay 自动重连以匹配分辨率。门户也提供“应用并重新连接”供手动重试。

应用只有“主设置”和“高级设置”。主设置提供连接及浏览器控制；高级设置提供帧率、HEVC、驾驶侧、诊断报告和权限。新安装默认 60 fps，已保存选择保持不变。未保存编码选择时 HEVC 默认开启，可关闭以使用 H.264。高级视频／控制选项立即保存，下次连接生效；点击“返回并应用”回到主页面，并重新连接运行中的会话。

默认开启实验性的 [AirPlay 屏幕镜像与视频投放](docs/AIRPLAY.md)。投屏时暂停 CarPlay 画面，结束后恢复仍有效的会话。“高级设置 → 禁用 AirPlay”默认关闭，开启立即停止接收器。此预览版仅传送视频，仍需真实 iPhone 和车辆验证。

“开机自启”立即保存，在安卓启动时启动 TiPlay。高级设置中的“禁用 CarPlay”可停止连接和重试。安卓或设备的后台启动限制可能阻止它；热点仍需单独开启。

## 限制与帮助

这是实验性、**未经 Apple 认证**的产品。未来 iOS 版本的兼容性仍不确定，见[身份说明](docs/THIRD_PARTY_NOTICES.md#experimental-authentication-data)。

遇到问题时，用最新 TiPlay 构建复现，再打开“高级设置 → 保存诊断报告”。Android 10+ 通常保存到 **Downloads/TiPlay**，Android 9 使用文件选择器。回退到应用存储时，确认界面会显示位置并提供“查看报告／分享”。只有主动分享才会上传报告；请先检查文本，不要公开热点密码。

将报告附到[现有问题](https://github.com/uJZk/DiPlay/issues)或[新建问题](https://github.com/uJZk/DiPlay/issues/new/choose)，说明安卓设备及版本、汽车／浏览器版本、iPhone／iOS、连接方式、复现步骤和故障时间。TiPlay 问题请报告到这里，不要报告到上游 DiPlay。

- [现有 Wi-Fi 设置](docs/EXISTING_WIFI.md)
- [隐私与诊断报告](docs/PRIVACY.md)
- [更新记录](CHANGELOG.md)

应用及下载网站提供英语、阿拉伯语、俄语、乌克兰语、西班牙语、简体中文和繁体中文（台湾）。香港／澳门及 Hant 选择使用台湾译文。可在主设置选择应用语言；Android 13+ 会与系统的单应用语言设置同步。

## 来源与许可证

TiPlay 基于 shihabal3amri 的 [DiPlay](https://github.com/shihabal3amri/DiPlay) 和 [xcertplay](https://github.com/shilapi/xcertplay)（GPL-3.0）。主页／设置界面和网站改编自 [DiAuto](https://github.com/shihabal3amri/DiAuto)（AGPL-3.0），详见[致谢与许可证](docs/THIRD_PARTY_NOTICES.md)。本项目与 Tesla、Apple 及比亚迪无隶属关系，也未获其认可。Tesla 和 CarPlay 是其各自所有者的商标。
