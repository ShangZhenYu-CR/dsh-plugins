# Android adb 插件（`mcp__adb__*`）

把工作区里编好的 APK 直接装到这台手机上，不用手动找文件、点安装。走的是 **adb 无线调试**（手机和 Ubuntu 环境在同一台设备上，连 `127.0.0.1` 就行）。

## 环境要求

- 手机：设置 → 关于手机 → 连点版本号开「开发者选项」→ 开发者选项 → **无线调试** 打开
- 本机：`adb` 和 `aapt`（装 APK 后自动识别包名并启动）

```bash
apt-get install -y android-tools-adb aapt
```

## 必须连着 WiFi

这台小米 15（HyperOS）的「无线调试」要求手机连着 WLAN：WiFi 一关，开关就打不开，已连的设备立刻变 `offline`。

- 装包/抓日志时先连 WiFi（家里、公司、热点都行，不需要能上外网）
- 没有 WiFi 时用 `stage_apk`：把 APK 复制到 `/sdcard/Download/DSH-Go/`，在文件管理器点一下走系统安装器
- 或者用电脑 USB：`adb install -r app-release.apk`

## 一次性配对

1. 手机「无线调试」页里点「使用配对码配对设备」，会显示一个**配对端口**和 6 位**配对码**
2. 让 AI 执行：`adb_pair(port=配对端口, code=配对码)`
3. 再执行：`adb_connect(port=无线调试页显示的主端口)`

配对一次即可；手机重启或关掉无线调试后要重新配对。端口每次都会变，看手机屏幕上的数字。

## 工具

| 工具 | 说明 |
|---|---|
| `adb_devices` | 看当前连上的设备 |
| `adb_pair` / `adb_connect` | 配对 / 连接无线调试 |
| `install_apk` | 安装 APK（覆盖安装），装完自动启动；`path` 省略时用 `OrbitEdge/app/build/outputs/apk/release/app-release.apk` |
| `stage_apk` | 不依赖设备：把 APK 复制到 `/sdcard/Download/DSH-Go/`，供手动安装 |
| `app_info` | 查手机上已装版本（确认是不是最新那个） |
| `launch_app` | 启动 / 强制停止 App |
| `uninstall_app` | 卸载 |
| `logcat` | 抓日志，可按包名或 `FATAL EXCEPTION` 过滤 |
| `screenshot` | 截图存到工作区，返回路径 |
| `adb_shell` | 直接跑 adb shell（调试用） |

## 例子

- 「把刚编好的 APK 装到手机并打开」→ `install_apk`
- 「看看手机上装的是不是最新的」→ `app_info`
- 「App 一开就闪退，抓下日志」→ `logcat(filter='FATAL EXCEPTION')`
- 「截个图给我看」→ `screenshot`

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ADB_BIN` | `adb` | adb 可执行文件 |
| `ADB_WORKSPACE` | `/root/workspace` | 相对 `path` 的根目录 |

## 注意

- 无线调试端口每次重启/开关都会变，`adb_connect` 失败先看手机屏幕上的端口
- 配对端口只在「使用配对码」弹窗打开期间有效，弹窗一关就失效；拿到码要马上 `adb_pair`
- 安装失败常见原因：包名不同签名冲突（先 `uninstall_app`）、版本号更低要 `downgrade: true`
