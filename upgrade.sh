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
ALLOWED_SERVICES=("server" "admin" "editor" "uploader")
BOOTSTRAP_SCRIPT="./bootstrap-prod-config.sh"

usage() {
  cat <<EOF
用法：
  ./upgrade.sh all           # 升级所有服务（server, admin, editor, uploader）
  ./upgrade.sh server        # 仅升级 server
  ./upgrade.sh admin editor  # 升级指定多个服务
  ./upgrade.sh uploader      # 仅升级 uploader
  ./upgrade.sh -h | --help   # 查看帮助
EOF
}

log_error() {
  echo "[ERROR] $1" >&2
}

log_hint() {
  echo "[HINT] $1" >&2
}

log_step() {
  local idx="$1"
  local total="$2"
  local message="$3"
  echo "[$idx/$total] $message"
}

service_allowed() {
  local svc="$1"
  local allowed
  for allowed in "${ALLOWED_SERVICES[@]}"; do
    if [ "$svc" = "$allowed" ]; then
      return 0
    fi
  done
  return 1
}

check_prerequisites() {
  if ! command -v git >/dev/null 2>&1; then
    log_error "git 未安装或不在 PATH"
    exit 1
  fi

  if ! command -v docker >/dev/null 2>&1; then
    log_error "docker 未安装或不在 PATH"
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    log_error "docker compose 插件未安装，或版本过旧"
    exit 1
  fi

  if [ ! -f "$COMPOSE_FILE" ]; then
    log_error "未找到 $COMPOSE_FILE"
    exit 1
  fi

  if [ ! -f "$BOOTSTRAP_SCRIPT" ]; then
    log_error "未找到 $BOOTSTRAP_SCRIPT"
    exit 1
  fi

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log_error "当前目录不是 git 仓库"
    exit 1
  fi
}

parse_target_services() {
  TARGET_SERVICES=("${ALLOWED_SERVICES[@]}")

  if [ "$#" -eq 0 ]; then
    return
  fi

  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    all)
      TARGET_SERVICES=("${ALLOWED_SERVICES[@]}")
      ;;
    *)
      TARGET_SERVICES=("$@")
      ;;
  esac

  local svc
  for svc in "${TARGET_SERVICES[@]}"; do
    if ! service_allowed "$svc"; then
      log_error "非法服务名: $svc"
      log_hint "仅支持: ${ALLOWED_SERVICES[*]} 或 all"
      usage
      exit 1
    fi
  done
}

main() {
  check_prerequisites
  parse_target_services "$@"

  log_step 1 6 "校验工作区状态..."
  if ! git diff --quiet || ! git diff --cached --quiet; then
    log_error "当前仓库有未提交改动，请先提交或暂存后再执行升级"
    exit 1
  fi

  log_step 2 6 "拉取最新代码..."
  git pull --ff-only

  log_step 3 6 "自动准备前端运行时配置文件..."
  bash "$BOOTSTRAP_SCRIPT"

  log_step 4 6 "校验 compose 配置..."
  docker compose -f "$COMPOSE_FILE" config >/dev/null

  log_step 5 6 "构建镜像: ${TARGET_SERVICES[*]}"
  docker compose -f "$COMPOSE_FILE" build "${TARGET_SERVICES[@]}"

  log_step 6 6 "以无中断方式更新容器..."
  docker compose -f "$COMPOSE_FILE" up -d "${TARGET_SERVICES[@]}"

  echo
  echo "当前容器状态："
  docker compose -f "$COMPOSE_FILE" ps

  echo
  echo "完成。可查看日志： docker compose -f $COMPOSE_FILE logs -f <service>"
}

main "$@"
