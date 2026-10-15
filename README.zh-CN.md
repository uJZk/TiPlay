# TiPlay

用安卓手机，在车载浏览器里使用 CarPlay。

TiPlay 安装在安卓手机上，通过 USB 或无线 CarPlay 连接 iPhone，再将画面送到车载浏览器。直接触摸网页即可操作 CarPlay。

[下载 APK](https://github.com/uJZk/TiPlay/releases) · [打开浏览器播放器](https://ujzk.github.io/TiPlay/) · [English](README.md)

## 需要准备

- Android 9 及以上手机，以及已开启 CarPlay 的 iPhone。
- 支持 WebCodecs、能访问安卓手机的车载浏览器。
- 安卓热点或三台设备共用的 Wi-Fi。特斯拉浏览器可能需要配置[额外热点地址](docs/Hotspot-address.md)。

TiPlay 仍处于实验阶段，未经 Apple 认证，完整 iPhone／实车兼容性仍待验证。目前只支持“安卓手机＋车载浏览器”，不支持原生安卓车机。

## 开始连接

1. 停车后，将 APK 安装到**安卓手机**，打开 TiPlay 并授予所需权限。
2. 无线 CarPlay：将 iPhone 与安卓手机通过蓝牙配对；USB：使用支持数据传输的线缆连接。
3. 在“主设置”中选择 iPhone 和连接模式，再配置“安卓热点”或“现有 Wi-Fi”。使用热点时，需自行在安卓系统设置中开启。
4. 让汽车接入同一网络。在车载浏览器打开 TiPlay 显示的链接，输入配对码并点击“连接”。

音频配置、权限和排错见[安装与连接](docs/Install.md)。手机地址或端口改变后，使用新链接重连，或在网页修改“安卓地址”。

## 日常使用

设置会自动保存，需要时自动重连 CarPlay。点击 CarPlay 内的 **TiPlay** 图标可打开浏览器门户；视频选项、音频路由和诊断报告在“高级设置”中。

音乐通常由浏览器播放。通话和 Siri 需要将安卓手机与汽车的蓝牙电话通道配对，并授予麦克风权限。也可以开启“禁用 CarPlay 音频”，改用 iPhone 直连汽车蓝牙。两条音频路线仍待实车验收。

实验性的 [AirPlay](docs/AirPlay.md) 支持镜像、照片和兼容的非 DRM 媒体，默认开启，可在高级设置中关闭。

## 帮助与开发

遇到问题，在“高级设置 → 保存诊断报告”导出报告，检查隐私信息后附到 [TiPlay Issues](https://github.com/uJZk/TiPlay/issues)，并说明手机、iOS、汽车／浏览器版本及复现步骤。报告不会自动上传。

[文档目录](docs/README.md) · [源码构建](docs/Build.md) · [隐私](docs/Privacy.md) · [更新记录](CHANGELOG.md)

TiPlay 基于 [DiPlay](https://github.com/shihabal3amri/DiPlay) 和 [xcertplay](https://github.com/shilapi/xcertplay)（GPL-3.0），界面和网站改编自 [DiAuto](https://github.com/shihabal3amri/DiAuto)（AGPL-3.0）。详见[致谢与许可证](docs/Third-party-notices.md)。本项目与 Apple、Tesla、比亚迪无隶属关系。
