# 网页定位与 iPhone 定位转发

## 坐标转换边界

后续采用的方案是：网页发送带来源信息的原始定位，Android 使用
[geocoordinates-rs](https://github.com/justin13888/geocoordinates-rs) 将已确认的
GCJ-02 坐标转换为 WGS84，再交给 CarPlay 定位编码与 iPhone 转发路径。
转换在 Android 完成，网页不提前转换。此方案是后续接入的约定，不代表已实现。

```text
特斯拉网页原始定位（本次实测符合 GCJ-02）
  → Android：Gcj02::new(latitude, longitude)?.to_wgs84_refined()
  → WGS84 十进制度
  → GPGGA / GPRMC
  → iAP2 LocationInformation
  → iPhone
```

保留原始坐标、来源和转换状态，避免重复转换。Android 原始 GPS 的 WGS84
坐标直接进入编码路径。不能仅凭坐标落在中国境内，就把任意来源判定为 GCJ-02；
本次证据不覆盖其他浏览器、地区或特斯拉固件。无效输入或转换失败不能冒充成功的
WGS84 定位。经纬度顺序必须通过命名字段明确，内部使用双精度。

优先使用库的原生 `to_wgs84_refined()`，不用 `to_wgs84_fast()`。
[所核对实现](https://github.com/justin13888/geocoordinates-rs/blob/a1cafc7dd99d0b0ac48c0a6ce502c19eabfea2a6/src/china/mod.rs)
以同模型正变换残差迭代，停止阈值为 `1e-9°`，最多 100 次。
返回的 `Approx` 保守误差界不是传感器精度，不能用它替换或缩小网页上报的
`accuracy`。该库采用 MIT OR Apache-2.0；接入时保留所选许可证与出处。

坐标转换只处理经纬度，不校正时间、海拔、速度或航向，也不凭空补齐缺失字段。
最后的 NMEA 格式化仍会舍入坐标；逆解残差小不等于完整传输链路具有同样精度。

## 实车证据与算法选择

用户确认采集端为特斯拉车内浏览器。HTTPS 页面能够持续收到 Geolocation
回调；这证明该测试条件下网页定位可用，不能证明底层来源就是车辆 GPS。
浏览器用户代理、`enableHighAccuracy` 和 `accuracy` 均不能确定传感器来源。

对同批数据按手机接收单调时钟配对，仅以 Android `gps` 提供者的新鲜、非模拟
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
