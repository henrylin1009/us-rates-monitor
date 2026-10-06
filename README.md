# US Rates Monitor

每天收盤後自動更新的美國利率市場網站：美債殖利率曲線，以及從 ZQ（30 天聯邦基金期貨）自己算出來的 Fed 定價。

- **殖利率**：走勢、曲線快照、利差、每日變動（bull/bear steepening/flattening）、熱力圖、2y 對比市場預期
- **Fed 定價**：每次 FOMC 的隱含利率路徑、升降息機率、累積定價時間序列、「過去 + 未來」預期路徑圖

## 架構

```
GitHub Actions（週一到週五 23:40 UTC）
  └ scripts/fetch.py
      ├ 美國財政部 Daily Par Yield Curve → docs/data/yields.csv
      ├ 紐約 Fed EFFR                    → docs/data/effr.csv
      ├ ZQ 期貨（Yahoo Finance）          → docs/data/zq.csv
      └ scripts/fedpricing.py 算定價      → docs/data/fed_path.csv、fed_summary.csv
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

## 要定期維護的地方

- **FOMC 日期**：`scripts/fomc.py`。Fed 每年夏天公布下一年的日期（2028 年的大約 2027 年 8 月），補上就好。
- **Yahoo 被擋**：yfinance 是非官方的，從 GitHub 的伺服器抓偶爾會失敗。這時殖利率和 EFFR 照常更新，只有 Fed 定價那天會缺。持續失敗的話，可以改成在自己電腦上跑 `fetch.py` 再 push。

## 方法

- ZQ 價格 = 100 − 該月 EFFR 平均
- 會議月份：月平均 =（會議前天數 × 舊利率 + 會議後天數 × 新利率）÷ 當月天數，解出會議後利率
- 會議後剩不到 7 天：改用下個月合約
- 多次會議用接力：上一次會議後的利率是下一次的起點
- 機率 = 隱含變動 ÷ 25bp，拆成最接近的兩檔
- 期貨只給平均預期，分佈形狀是假設，價格也含少量風險溢酬。可以和 CME FedWatch 對照。

Fed 定價的歷史從開始跑的那天累積；回補時只抓得到 Yahoo 上還有的合約。
