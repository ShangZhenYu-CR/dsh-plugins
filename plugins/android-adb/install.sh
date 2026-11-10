#!/usr/bin/env bash
# 安装后钩子：检查 adb / aapt 是否就绪
set -euo pipefail

if ! command -v adb >/dev/null 2>&1; then
  echo "  缺少 adb：apt-get install -y android-tools-adb"
fi
if ! command -v aapt >/dev/null 2>&1; then
  echo "  缺少 aapt（装 APK 后自动启动用）：apt-get install -y aapt"
fi
if command -v adb >/dev/null 2>&1; then
  echo "  adb 已就绪：$(adb version 2>/dev/null | head -1)"
fi
