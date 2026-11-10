# android-adb 插件说明（写给 AI）

用 adb 无线调试把 APK 装到这台手机：`mcp__adb__*`。

## 连接值（固定下来了）

| 项 | 值 | 说明 |
|---|---|---|
| 端口 | `51237` | 已用 `adb tcpip 51237` 固定，不再随机 |
| 手机 IP | 会变 | 记录在 `~/.dsh/mcp-plugins/android-adb/connection.json` 的 `host`，**切 WiFi / 切蜂窝会变** |
| 设备 | Xiaomi 15（`24129PN74C`，`device` 代号 `dada`） | 包名示例 `com.coldrain.orbitedge` |

连接状态文件在插件安装目录（`~/.dsh/mcp-plugins/android-adb/connection.json`），由 `adb_connect` 自动写入，不进仓库。

## 自动重连

工具在需要设备时会先 `adb devices`；没有在线设备就自动用记住的端口去 `adb connect`，候选地址依次是：

1. `connection.json` 里记的 host
2. 本机所有非回环 IPv4（Android 的 WiFi / 蜂窝接口）
3. `127.0.0.1`

所以**别的对话不用知道端口和 IP**，直接 `install_apk` / `logcat` / `screenshot` 就行。

## 什么时候会失败，怎么恢复

- **无线调试开关被关掉**（最常见：WiFi 断过、手机重启）：开关必须重新打开，而且端口会重新随机 → 让用户打开「开发者选项 → 无线调试」，`mcp__phone__screen` 读屏拿到「IP 地址和端口」，再 `adb_connect(port)`（会覆盖 connection.json），最后重新 `adb tcpip 51237` 固定回来
- **切了 WiFi**：端口还是 51237，只是 host 变了，自动重连会自己找到；实在找不到就让用户读一次新 IP
- **配对失效**（卸载/清除已配对设备）：需要重新配对一次，读屏拿配对端口和 6 位码 → `adb_pair(port, code)`

## 没有 WiFi 时

无线调试要求「已连接 WLAN」，移动数据不行。此时 `install_apk` 会自动把包复制到 `/sdcard/Download/DSH-Go/` 并提示手动安装（`stage_apk` 也能单独用），用户点一下系统安装器即可。

## 常用流程

```text
改代码 → 编译出 app-release.apk → install_apk（自动装并启动）→ app_info 确认版本
崩溃排查：logcat(filter='FATAL EXCEPTION') / logcat(filter='com.coldrain.orbitedge')
看界面：screenshot（存到 /root/workspace/generated/）
```
