#!/usr/bin/env python3
import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


TRANSLATIONS = {
    "feat: complete UI rewrite and fix API parsing": "重寫報表 UI 並修正 API 資料解析",
    "docs: rewrite README with new features and add disclaimer": "重寫 README，補上新功能與免責聲明",
    "feat: default to minimized state and update app name": "預設收合面板並更新擴充功能名稱",
    "feat: add CSV export feature and rename date column": "新增 CSV 匯出並重新命名日期欄位",
    "feat: add lost stake metric to summary and update terminology": "新增輸掉本金統計並調整用語",
    "feat: change summary UI to Total Invested, Gross Profit, and Gross Loss": "調整摘要為總投入、總獲利與總損失",
    "feat: add auto-open toggle based on user preference": "新增依使用者偏好自動開啟的切換",
    "feat: add pending stake to summary": "在摘要新增未派彩本金",
    "style: update summary text layout to clearly show P/L equation": "調整摘要文字版面，清楚顯示損益公式",
    "style: group summary metrics visually to prevent confusion": "視覺分組摘要指標，降低閱讀混淆",
    "style: redesign summary layout to explicitly show math equations": "重新設計摘要版面，明確呈現計算公式",
    "feat: remove CSV icon and Close button, add table sorting by columns": "移除 CSV 圖示與關閉按鈕，新增表格欄位排序",
    "fix: force native appearance for auto-open checkbox to prevent site CSS overriding it": "強制自動開啟 checkbox 使用原生外觀，避免被網站樣式覆蓋",
    "feat: default auto-open to true for new installations": "新安裝預設啟用自動開啟",
    "feat: add sorting capability to the state column": "新增狀態欄排序功能",
    "feat: rename extension, fix empty content text bug, and sync report date with site native date picker": "重新命名擴充功能，修正空投注內容，並同步網站原生日期選擇器",
    "fix: restore localDatabase variable definition": "恢復 localDatabase 變數定義",
    "feat: embed native date picker directly in the modal header and split summary layout": "將原生日期選擇器嵌入面板標頭並拆分摘要版面",
    "style: make bet selection name bold in content text": "投注選項名稱改為粗體",
    "feat: make bet content clickable to expand multiple legs into multiline layout": "投注內容可點擊展開，多關內容改為多行顯示",
    "style: fix summary background overlap and add expandable row for bet IDs": "修正摘要背景重疊並新增可展開的注單 ID 列",
    "feat: enhance date search, fix ID mappings, add github issue link": "強化日期搜尋，修正 ID 對應，新增 GitHub issue 連結",
    "fix: update extension description": "更新擴充功能描述",
    "feat: add extension icon 128x128": "新增 128x128 擴充功能圖示",
    "Add privacy policy": "新增隱私權政策",
    "Add disclaimer confirmation flow": "新增免責聲明確認流程",
    "Remove packaged dist artifact": "移除已打包的 dist 產物",
    "Replace extension icon": "替換擴充功能圖示",
    "Include icon in release package": "將圖示納入 release 套件",
    "Update README feature and install copy": "更新 README 功能與安裝說明文字",
    "Update README usage instructions": "更新 README 使用說明",
    "Add sport filters and refine header controls": "新增球類篩選並微調標頭控制項",
    "Document sport filters and bump version": "補充球類篩選文件並更新版本號",
    "Add theme switch and palette updates": "新增主題切換並更新配色",
    "Release 1.0.3": "發布 1.0.3",
    "Add row copy action to bets table": "在注單表格新增複製整行功能",
    "Bump extension version to 1.0.4": "擴充功能版本更新至 1.0.4",
    "Show per-leg odds for multi-single bets": "多筆一關注單顯示各投注項賠率",
    "Show actual payout and net profit": "顯示實際派彩與淨損益",
    "Bump version to 1.0.5": "版本更新至 1.0.5",
    "Generate release notes from commits": "由 commit 自動產生 release notes",
}


def run_git(*args):
    result = subprocess.run(["git", *args], check=True, text=True, capture_output=True)
    return result.stdout.strip()


def version_key(tag):
    match = re.fullmatch(r"v(\d+)", tag)
    if not match:
        return (sys.maxsize, tag)
    return (int(match.group(1)), tag)


def list_release_tags():
    tags = run_git("tag").splitlines()
    return sorted((tag for tag in tags if re.fullmatch(r"v\d+", tag)), key=version_key)


def commit_lines(previous_tag, tag):
    if previous_tag:
        range_spec = f"{previous_tag}..{tag}"
        output = run_git("log", "--reverse", "--pretty=format:%H%x1f%s", range_spec)
    else:
        output = run_git("log", "--reverse", "--pretty=format:%H%x1f%s", f"{tag}^!")
    return [line for line in output.splitlines() if line.strip()]


def bilingual_subject(subject):
    if " / " in subject:
        return subject
    translated = TRANSLATIONS.get(subject)
    if translated:
        return f"{translated} / {subject}"
    return f"{subject} / {subject}"


def release_body(previous_tag, tag):
    bullets = []
    for line in commit_lines(previous_tag, tag):
        commit, subject = line.split("\x1f", 1)
        bullets.append(f"- {bilingual_subject(subject)} ({commit[:7]})")

    if not bullets:
        bullets.append("- 無程式碼變更 / No code changes")

    return "\n".join([
        "## 這次更動",
        "",
        *bullets,
        "",
        "## 驗證",
        "",
        "- 自動打包 extension zip / packaged extension zip",
    ]) + "\n"


def github_request(method, path, token, repo, payload=None):
    url = f"https://api.github.com/repos/{repo}{path}"
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "sportslottery-release-notes-backfill",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def get_release_by_tag(tag, token, repo):
    encoded_tag = urllib.parse.quote(tag, safe="")
    try:
        return github_request("GET", f"/releases/tags/{encoded_tag}", token, repo)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise


def main():
    parser = argparse.ArgumentParser(description="Backfill GitHub Release notes from git tags.")
    parser.add_argument("--dry-run", action="store_true", help="Print generated notes without updating GitHub.")
    args = parser.parse_args()

    repo = os.environ.get("GITHUB_REPOSITORY")
    token = os.environ.get("GITHUB_TOKEN")
    tags = list_release_tags()
    if not tags:
        raise SystemExit("No v-number release tags found.")

    previous_tag = None
    for tag in tags:
        body = release_body(previous_tag, tag)
        if args.dry_run:
            print(f"===== {tag} =====")
            print(body)
        else:
            if not repo or not token:
                raise SystemExit("GITHUB_REPOSITORY and GITHUB_TOKEN are required unless --dry-run is used.")
            release = get_release_by_tag(tag, token, repo)
            if release is None:
                print(f"Skip {tag}: release not found")
            else:
                github_request("PATCH", f"/releases/{release['id']}", token, repo, {"body": body})
                print(f"Updated {tag}")
        previous_tag = tag


if __name__ == "__main__":
    main()
