#!/usr/bin/env bash
# Harmony 一键升级脚本
# 用法：
#   ./upgrade.sh all           # 升级所有服务（server, admin, editor, uploader）
#   ./upgrade.sh server        # 仅升级 server
#   ./upgrade.sh admin editor  # 升级指定多个服务
#   ./upgrade.sh uploader      # 仅升级 uploader

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="docker-compose.prod.yml"

if ! command -v docker >/dev/null 2>&1; then
  echo "[ERROR] docker 未安装或不在 PATH" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "[ERROR] docker compose 插件未安装，或版本过旧" >&2
  exit 1
fi

# 保护本地改动，避免被 pull 覆盖
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[ERROR] 当前仓库有未提交改动，请先提交或暂存后再执行升级" >&2
  exit 1
fi

echo "[1/4] 拉取最新代码..."
# 使用 --ff-only 防止意外合并
git pull --ff-only

echo "[2/4] 选择升级的服务..."
TARGET_SERVICES=("server" "admin" "editor" "uploader")
if [ "$#" -gt 0 ]; then
  if [ "$1" != "all" ]; then
    TARGET_SERVICES=("$@")
  fi
fi

echo "[3/4] 构建镜像: ${TARGET_SERVICES[*]}"
docker compose -f "$COMPOSE_FILE" build ${TARGET_SERVICES[*]}

echo "[4/4] 以无中断方式更新容器..."
docker compose -f "$COMPOSE_FILE" up -d ${TARGET_SERVICES[*]}

echo "\n当前容器状态："
docker compose -f "$COMPOSE_FILE" ps

echo "\n完成。可查看日志： docker compose -f $COMPOSE_FILE logs -f <service>"
