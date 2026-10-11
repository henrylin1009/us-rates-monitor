"""PCE 分項（月資料）：從 BEA 公開的 NIPA 文字檔抓，不需要 API key。

FRED 上 PCE 細項（住房、醫療、金融服務）只有季資料，月資料只有 BEA 自己有。
NipaDataM.txt 是 BEA 全部月資料（約 37MB，每次公布 PCE 後更新），格式：SeriesCode,Period,Value，Period 像 2026M08。

寫成 pce.csv：每個分項一個價格指數（_p，Fisher）和名目支出（_n，十億美元年率），網站拿名目支出算權重。
"""
from __future__ import annotations

import csv
import io

import requests

NIPA_M = "https://apps.bea.gov/national/Release/TXT/NipaDataM.txt"
UA = {"User-Agent": "Mozilla/5.0 (us-rates-monitor personal study project)"}
FROM = "2000-01-01"

# 欄位名 → (價格指數代碼, 名目支出代碼)，來自 BEA 表 2.4.4U / 2.4.5U（SeriesRegister.txt 查得到）
SERIES = {
    "total": ("DPCERG", "DPCERC"),        # PCE
    "core": ("DPCCRG", "DPCCRC"),         # PCE excluding food and energy
    "core_goods": ("IA000062", "LA000062"),  # PCE goods excluding food and energy
    "core_svc": ("IA000063", "LA000063"),    # PCE services excluding energy
    "housing": ("DHSGRG", "DHSGRC"),      # Housing（不含水電）
    "food": ("DFXARG", "DFXARC"),         # Food and beverages purchased for off-premises consumption
    "energy": ("DNRGRG", "DNRGRC"),       # Energy goods and services
    "health": ("DHLCRG", "DHLCRC"),       # Health care（含雇主保險、Medicare 付的）
    "finsvc": ("DFNLRG", "DFNLRC"),       # Financial services（不含保險；CPI 幾乎沒有對應）
    "portfolio": ("DPMIRG", "DPMIRC"),    # Portfolio management and investment advice（跟股市連動）
}
COLS = ["date"] + [f"{k}_{s}" for k in SERIES for s in ("p", "n")]


def parse_nipa(text: str) -> list[dict]:
    want = {code: f"{k}_{s}" for k, (p, n) in SERIES.items() for code, s in ((p, "p"), (n, "n"))}
    rows: dict[str, dict] = {}
    for rec in csv.reader(io.StringIO(text)):
        if len(rec) < 3 or rec[0] not in want or "M" not in rec[1]:
            continue
        y, m = rec[1].split("M")
        d = f"{y}-{int(m):02d}-01"
        if d < FROM:
            continue
        v = rec[2].replace(",", "").strip()
        try:
            float(v)
        except ValueError:
            continue
        rows.setdefault(d, {"date": d})[want[rec[0]]] = v
    return [rows[d] for d in sorted(rows)]


def update_pce(read_csv, write_csv) -> None:
    try:
        r = requests.get(NIPA_M, headers=UA, timeout=180)
        r.raise_for_status()
        rows = parse_nipa(r.text)
    except Exception as e:  # noqa: BLE001
        print(f"⚠ BEA NIPA 月資料抓不到，pce.csv 維持原樣：{e}")
        return
    if len(rows) < 12 or any(c not in rows[-1] for c in COLS[1:]):
        print(f"⚠ BEA NIPA 資料不完整（{len(rows)} 個月），pce.csv 維持原樣")
        return
    write_csv("pce.csv", rows, COLS)
    print(f"BEA PCE 分項：{len(rows)} 個月，最後 {rows[-1]['date']}")
