# 网页定位与 iPhone 定位转发

## 坐标转换边界

网页发送原始定位及来源时间，Android 在 CarPlay 请求定位后接收并转发。
坐标系未知时，先转发新鲜的 Android 高精度 GPS 定位；没有可用安卓定位时不伪造位置。
确认网页为 GCJ-02 后，使用
[geocoordinates-rs Android AAR](https://github.com/uJZk/geocoordinates-rs/releases/tag/android-v0.14.2)
的 `gcj02ToWgs84Refined()` 还原为 WGS84，再进入 NMEA / iAP2 编码路径。
确认或缓存为 WGS84 时，直接转发，不再转换。

```text
网页原始定位 → Android：坐标系缓存 / 自动判别
  ├─ 未确认或网页定位过期：Android 高精度 GPS 定位（WGS84）
  ├─ WGS84：直接转发
  └─ GCJ-02：gcj02ToWgs84Refined → WGS84
      → GPGGA / GPRMC → iAP2 LocationInformation → iPhone
```

AAR 固定为 `android-v0.14.2`，四种 ABI 与 SHA-256 校验值、依赖和许可证见
[库说明](../shared/libs/geocoordinates/README.md)。库在本机计算，不需要网络或密钥。
转换只处理经纬度，保持双精度，不修改原始传感器精度、海拔、速度或航向。
逆解误差界不是传感器精度；NMEA 最终格式化仍会舍入。

### 判别、漂移与地理围栏

`BrowserCarPlayLocationProvider` 直接订阅系统 `gps`，每秒请求高精度定位，
安卓端以精确位置权限作为可用条件。
系统来源自身精度较差时，定位只能临时转发，不能用于可靠判别。
对照定位必须非模拟、新鲜且经纬度有效；用于判别时，网页和安卓精度均须优于
100 米，时间差不超过 2 秒。同一个安卓定位不能重复累积证据。

以 `max(30 米, 网页 accuracy + 安卓 accuracy)` 作为接近阈值；原始点与转换点
的误差差还须超过两倍该阈值，避免两个假设无法区分。原始网页点远、refined
转换后点近时，立即确认 GCJ-02，不要求额外等待或位移。

WGS84 先忽略前 15 秒，再要求至少 8 个独立对照、持续至少 20 秒，且两端
位移均达到 `max(300 米, 4 × 接近阈值)`。停在原地不会确认 WGS84。
不一致、过大的位移跳变或过长的采样间隔重置候选证据；网页重试、相同源时间
和旧序号不能延长定位寿命。已缓存设备每次新 watch 仍经过至少 5 秒、3 个连续
样本的稳定检查。明确 GCJ-02 的首个有效配对立即生效。

使用库的 `outOfChina()` 围栏：围栏外转换为恒等操作，直接转发，但不因此永久
缓存设备为 WGS84。该围栏是经纬度矩形，**并非精确国界**，不能仅凭围栏内外
推断浏览器坐标系，港澳和边界地区仍需实际验证。

新确认结果只保存在该网页浏览器的 `localStorage`，记录版本、浏览器 UA 和
`WGS84` / `GCJ02`，不保存经纬度。后续浏览器发送缓存，跳过安卓坐标系比对；
WGS84 还跳过 refined 转换。UA 变化或清除网站数据后重新判别。
网页设备仍需允许浏览器定位，坐标系缓存不授予定位权限。

网页点超过 5 秒未更新时，尝试恢复安卓 GPS 定位，最多转发 10 秒以内的安卓点。
停止 CarPlay 定位请求、禁用网页定位或浏览器接管时释放相应状态；旧浏览器的
延迟事件不能写入新会话。安卓不记录或持久化原始坐标。

### 权限与设置

仅安卓高级设置提供“定位权限”按钮和用途说明。网页没有自定义权限按钮；
CarPlay 请求定位后网页自动启动 watch，由浏览器自身处理定位授权提示。
浏览器拒绝权限后停止 watch，不因状态心跳反复申请；授权状态改变后可恢复。
网页复用 AirPlay 玻璃通知卡片，提示在浏览器设置允许定位，或者在安卓高级设置
打开“禁用网页端定位”改用 iPhone。通知没有自动消失的计时器，仅通过“关闭”按钮
关闭；同类提醒在本页只出现一次，不因心跳或重新连接反复弹出。
安卓按钮只以精确位置授权作为目标及已授权条件，不接受近似授权作为就绪。
Android 12+ 要求精确申请同时携带 `COARSE`，否则系统忽略精确请求；这个兼容
参数不会改变产品的权限目标。授权后直接读取高精度 GPS，不再选择普通网络或被动定位来源。

高级设置的“禁用网页端定位”默认关闭。开启后隐藏安卓端的定位权限入口、停止
网页采集和安卓转换/对照，并重新协商 CarPlay，不再提供外部定位，让 iPhone
使用自身定位。系统是否以及何时切换定位源由 iOS 决定，TiPlay 不保证瞬时切换。
拒绝安卓权限时，已有浏览器坐标系缓存仍可使用；未知坐标系只能等待可靠对照。

## 实车证据与算法选择

用户确认采集端为特斯拉车内浏览器。HTTPS 页面能够持续收到 Geolocation
回调；这证明该测试条件下网页定位可用，不能证明底层来源就是车辆 GPS。
浏览器用户代理、`enableHighAccuracy` 和 `accuracy` 均不能确定传感器来源。

对同批数据按手机接收单调时钟配对，实车算法对比仅以 Android `gps` 提供者的新鲜、非模拟
定位作参考，不混入 `fused` 或 `network`。397 个去重网页样本实际匹配到 40 个不同
GPS 定位，接收时间差中位数约 250 ms；另以全部 330 个 GPS 定位验证同库往返。
下面是固定采集样本的观测结果，距离使用 WGS84 椭球反解：

| 原生最高精度模式 | 转换后距手机 GPS 的中位数 | P95 |
| --- | ---: | ---: |
| gcoord 迭代逆解 | 2.476 m | 4.594 m |
| eviltransform JavaScript `gcj2wgs_exact` | 2.480 m | 4.591 m |
| geocoordinates-rs `to_wgs84_refined` | 2.476 m | 4.593 m |
| coord-convert `gcj2wgs` | 2.476 m | 4.593 m |

未转换时的距离中位数约 463 m；GCJ-02 → WGS84 后的大幅缩小，支持本次网页
输出具有 GCJ-02 偏移特征。该结论不能扩展成 Geolocation API 一律返回 GCJ-02。

此外，对另外三个库使用同库正变换、另加 `1e-12°` 残差迭代封装；这是测试封装，
不是上游原生精度选项。加严后 gcoord 与 coord-convert 在本批样本上输出一致，
Rust 原生 refined 与它们几乎一致；eviltransform 相差约 7.9 mm，涉及模型常数差异。
这些差异远小于手机 GPS 的米级波动，没有证据表明切换库能够改善剩余米级距离。

手机 GPS 未经过测量基准校准，多个网页样本共享同一个参考定位，接收时间配对也
包含未知的浏览器上传与定位回调延迟。因此表格不是绝对定位精度排名。
快速近似模式甚至可能偶然更接近手机 GPS，却有更大的正反转换残差。
同模型往返闭合仅验证数值自洽，不能证明 GCJ 模型或实际位置达到该精度。

## 上游 DiPlay 与 Apple 边界

以[上游 DiPlay 的 Android 定位提供者](https://github.com/shihabal3amri/DiPlay/blob/969f871433b76f6c59f3c93619f7cb5872fdd15d/shared/src/main/java/com/shilapi/xcertplay/location/AndroidCarPlayLocationProvider.kt)
和[上游 iAP2 定位客户端](https://github.com/shihabal3amri/DiPlay/blob/969f871433b76f6c59f3c93619f7cb5872fdd15d/shared/src/main/java/com/shilapi/xcertplay/transport/Iap2LocationClient.kt)
为依据：原始 Android 经纬度进入 `$GPGGA` / `$GPRMC`，再通过
`LocationInformation`（`0xFFFB`）转发。此路径没有 GCJ-02 转换。
网页坐标还原应放在此编码边界之前，不应把本地 TiPlay 的已有实现当作协议真值。

Apple 的公开
[CLLocationCoordinate2D 文档](https://developer.apple.com/documentation/corelocation/cllocationcoordinate2d)
明确使用 WGS84；这是 Core Location 的公开约定。上游代码和该文档共同支持以
WGS84 为内部转发基准，但不能代替尚未直接核验的 Apple MFi/iAP2 协议坐标条款。

## 权限、时钟与日志

浏览器定位要求安全上下文，HTTPS 页面定位与向手机 HTTP 热点端点上传是两个
独立步骤。定位权限、局域网权限、CORS 和上传失败必须分别记录；HTTP 页面上的
定位失败不能证明同一浏览器在 HTTPS 下不支持定位。Android 前台服务也不能越过
系统定位总开关或保证卫星信号，近似权限应与精确权限区分。

本次浏览器定位的原始 `timestamp` 具有未知起点和近似微秒的变化尺度，不能直接
作为 Unix 毫秒或 NMEA UTC 时间使用。源定位时间、浏览器单调时间、手机接收单调
时间与 UTC 墙钟必须分开保存；不同设备的单调时钟不能直接相减。配对统一使用
手机接收时钟仅便于比较，不能消除传输延迟。坐标修正与时钟校准是两个独立问题。

重试上传要通过事件 ID 去重，同时保留定位源时间，以区分重复回调、缓存位置和
新定位。手机日志序号连续只证明已持久化部分连续，不能证明浏览器没有尚未上传
的数据。原始坐标、令牌及完整设备日志只保留在本地忽略目录，不提交到公开仓库。

复核算法时应固定源码与输入，分别比较传感器距离、同模型往返残差和库间输出
差异。测试使用各库实际源码；算法比较依据可从
[gcoord](https://github.com/hujiulong/gcoord/tree/fa43556eaa0a55a25895d4e7b0aca4d2c2f4320e)、
[eviltransform](https://github.com/googollee/eviltransform/tree/03ba58d92dfda57f8a1635f3805483c8fc10bd77)、
[geocoordinates-rs](https://github.com/justin13888/geocoordinates-rs/tree/a1cafc7dd99d0b0ac48c0a6ce502c19eabfea2a6)、
[coord-convert](https://github.com/sshuair/coord-convert/tree/ee2a78040fb67f970f65a92e6aab381180a75f75)
的固定源码核对。
