#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_ROOT="${HARMONY_DEPLOY_ROOT:-/www/web/v_touchmagic_cn/harmony}"

if [ "${1:-}" = "--root" ]; then
  if [ -z "${2:-}" ]; then
    echo "[ERROR] --root 需要提供路径" >&2
    exit 1
  fi
  DEPLOY_ROOT="$2"
fi

CONFIG_DIR="$DEPLOY_ROOT/config"

ensure_file_from_template() {
  local template="$1"
  local target="$2"

  if [ ! -f "$template" ]; then
    echo "[ERROR] 模板文件不存在: $template" >&2
    exit 1
  fi

  if [ -e "$target" ] && [ ! -f "$target" ]; then
    echo "[ERROR] 挂载源不是普通文件: $target" >&2
    echo "[HINT] 请先处理为普通文件后再重试（例如目录改名后重新复制模板）。" >&2
    exit 1
  fi

  if [ ! -e "$target" ]; then
    cp "$template" "$target"
    echo "[CREATE] $target"
  else
    echo "[KEEP]   $target"
  fi
}

echo "[1/3] 确保配置目录存在: $CONFIG_DIR"
mkdir -p "$CONFIG_DIR"

echo "[2/3] 检查并生成运行时配置文件"
ensure_file_from_template \
  "$REPO_DIR/admin/admin-app-config.prod.js" \
  "$CONFIG_DIR/admin-app-config.js"
ensure_file_from_template \
  "$REPO_DIR/editor/public/config/app-config.example.json" \
  "$CONFIG_DIR/editor-app-config.json"


echo "[3/3] 输出文件类型"
stat -c '%F %n' \
  "$CONFIG_DIR/admin-app-config.js" \
  "$CONFIG_DIR/editor-app-config.json" 
  
echo "\n完成。可继续执行: docker compose -f docker-compose.prod.yml up -d"
