#!/bin/bash
# 一鍵把這個資料夾放上 GitHub，並開好 Actions 權限和 Pages
set -e
cd "$(dirname "$0")"
REPO=us-rates-monitor

command -v gh >/dev/null || { echo "安裝 GitHub CLI…"; brew install gh; }
gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https
USER=$(gh api user -q .login)
echo "GitHub 帳號：$USER"

if [ ! -d .git ]; then
  git init -q -b main
  git config user.name "Henry Lin"
  git config user.email "$USER@users.noreply.github.com"   # 不公開你的 email
  git add .
  git commit -q -m "US Rates Monitor: data pipeline + site"
fi

gh repo create "$REPO" --public --source=. --remote=origin --push \
  --description "Daily US rates monitor: Treasury curve + Fed pricing computed from ZQ futures"

echo "開 Actions 寫入權限…"
gh api -X PUT "repos/$USER/$REPO/actions/permissions/workflow" -f default_workflow_permissions=write >/dev/null
echo "開 GitHub Pages（main /docs）…"
gh api -X POST "repos/$USER/$REPO/pages" -f "source[branch]=main" -f "source[path]=/docs" >/dev/null || true

echo
echo "完成！一兩分鐘後網站會在：https://$USER.github.io/$REPO/"
echo "repo：https://github.com/$USER/$REPO"
