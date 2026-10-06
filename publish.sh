#!/bin/bash
# 把本機的修改推上 GitHub（會合併機器人每天更新的資料，避免衝突）
set -e
cd "$(dirname "$0")"
git add -A
git diff --cached --quiet || git commit -q -m "${1:-update site}"
git pull --rebase -X theirs -q origin main
git push -q origin main
echo "已推上 GitHub，網站一兩分鐘後更新"
