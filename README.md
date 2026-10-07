# US Rates Monitor

每天收盤後自動更新的美國利率市場網站：美債殖利率曲線，以及從 ZQ（30 天聯邦基金期貨）自己算出來的 Fed 定價。

- **殖利率**：走勢、曲線快照、利差、每日變動（bull/bear steepening/flattening）、熱力圖、2y 對比市場預期
- **Fed 定價**：每次會議和累計 price 了幾 bp（desk 的講法，網站以這個為主）、隱含利率路徑、升降息機率（另外假設各次會議獨立，只當參考）、累積定價時間序列、「過去 + 未來」預期路徑圖
- **行事曆**：仿 Fed 官網，按月列出 FOMC、會議紀要、CPI / NFP / PPI / PCE，FOMC 那列標出期貨 price 了幾 bp

## 架構

```
GitHub Actions（週一到週五 23:40 UTC）
  └ scripts/fetch.py
      ├ 美國財政部 Daily Par Yield Curve → docs/data/yields.csv
      ├ 紐約 Fed EFFR                    → docs/data/effr.csv
      ├ ZQ 期貨（Yahoo Finance）          → docs/data/zq.csv
      ├ scripts/fedpricing.py 算定價      → docs/data/fed_path.csv、fed_summary.csv
      ├ scripts/macro.py 抓 FRED 通膨、就業 → docs/data/macro.csv、claims.csv、breakeven.csv、sep.csv
      └ scripts/surprise.py 預期值（FF）＋首次公布值（ALFRED） → docs/data/consensus.csv、releases.csv
GitHub Pages（main 分支 /docs）
  └ docs/index.html + app.js（Plotly）讀上面的 CSV
```

## 第一次設定

1. 在 GitHub 建一個 **Public** repo，名字例如 `us-rates-monitor`，不要勾選建立 README。
2. 在 Mac 的終端機：
   ```bash
   cd 這個資料夾
   git init -b main
   git add .
   git commit -m "init"
   git remote add origin https://github.com/<你的帳號>/us-rates-monitor.git
   git push -u origin main
   ```
3. repo 的 **Settings → Actions → General → Workflow permissions** 選 **Read and write permissions**，存檔。
4. **Settings → Pages**：Source 選 **Deploy from a branch**，Branch 選 `main`、資料夾選 `/docs`，存檔。
5. **Actions** 分頁 → 左邊點「每日更新資料」→ **Run workflow**，勾選「補齊歷史資料」→ 執行。約 2 分鐘。
6. 網站在 `https://<你的帳號>.github.io/us-rates-monitor/`。

之後每個交易日會自動跑，不用管它。

## 在自己電腦上跑

```bash
pip install -r requirements.txt
python3 scripts/test_fedpricing.py   # 用 2026/10/5 的基準數字驗證算法
python3 scripts/fetch.py             # 抓最新資料（第一次加 --backfill）
cd docs && python3 -m http.server    # 打開 http://localhost:8000
```

## 改了東西要更新網站

```bash
./publish.sh "說明這次改了什麼"
```

會先拉下機器人每天 commit 的資料，再推上你的修改。

## 自動更新的日期

- **重要事件日期**：`docs/data/events.json` 每天自動更新。FOMC 和會議紀要抓 [Fed 官網行事曆](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm)；CPI、非農、PPI、PCE 抓 FRED 的公布日期（要在 repo 的 **Settings → Secrets and variables → Actions** 加一個 `FRED_API_KEY`，到 https://fred.stlouisfed.org/docs/api/api_key.html 免費申請）。今天以前的事件保留原本的標籤。
- **FOMC 日期**：同樣從 Fed 官網抓，存在 `docs/data/fomc.json`。`scripts/fomc.py` 裡的清單只是官網抓不到時的備用。
- 任何一個來源抓失敗，那一類日期就維持原樣，不會把網站弄壞。

## Yahoo 被擋

yfinance 是非官方的，從 GitHub 的伺服器抓偶爾會失敗。這時殖利率和 EFFR 照常更新，只有 Fed 定價會停在最後抓到的那天；網站的 Fed 定價區塊會標出資料日期，落後 2 個交易日以上會用橘色提醒。

## 方法

- ZQ 價格 = 100 − 該月 EFFR 平均
- 會議月份：月平均 =（會議前天數 × 舊利率 + 會議後天數 × 新利率）÷ 當月天數，解出會議後利率
- 會議後剩不到 7 天：改用下個月合約
- 多次會議用接力：上一次會議後的利率是下一次的起點
- 機率 = 隱含變動 ÷ 25bp，拆成最接近的兩檔
- 期貨只給平均預期，分佈形狀是假設，價格也含少量風險溢酬。可以和 CME FedWatch 對照。

Fed 定價的歷史從開始跑的那天累積；回補時只抓得到 Yahoo 上還有的合約。
- **手動補預期值**：`docs/data/consensus_manual.csv`，欄位 `date,measure,forecast,previous,source`（例如 `2026-09-11,core_cpi_mm,0.3,,bloomberg`），網站上優先用手動值。measure 的代碼見 `scripts/surprise.py` 的 `MEASURES`。
