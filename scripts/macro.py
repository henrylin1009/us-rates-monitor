"""從 FRED 抓通膨、就業、breakeven 和 Fed 預測（SEP），寫成網站讀的 CSV。

- macro.csv：月資料（原始指數或水準），網站自己算 YoY、年化
- claims.csv：初領失業金（週）
- breakeven.csv：10y breakeven、10y 實質利率（日）
- sep.csv：FOMC SEP 中位數，每個預測年度一列

需要環境變數 FRED_API_KEY。每次都整條重抓（資料很小），抓不到的 series 保留舊值。
"""
from __future__ import annotations

import os

FRED_OBS = "https://api.stlouisfed.org/fred/series/observations"

# 欄位名 → FRED series
MONTHLY = {
    "core_pce": "PCEPILFE", "pce": "PCEPI", "cpi": "CPIAUCSL", "core_cpi": "CPILFESL",
    "cpi_goods": "CUSR0000SACL1E", "cpi_shelter": "CUSR0000SAH1", "cpi_supercore": "CUSR0000SASL2RS",
    "cpi_food": "CPIUFDSL", "cpi_energy": "CPIENGSL", "ppi": "PPIFIS", "core_ppi": "PPIFES",
    "payems": "PAYEMS", "unrate": "UNRATE", "civpart": "CIVPART", "ahe": "CES0500000003",
    "jolts": "JTSJOL", "sahm": "SAHMREALTIME",
    # CPI 細項（desk 常看的）：OER、房租、醫療服務、交通服務、機票、二手車
    "cpi_oer": "CUSR0000SEHC", "cpi_rent": "CUSR0000SEHA", "cpi_medsvc": "CUSR0000SAM2",
    "cpi_transvc": "CUSR0000SAS4", "cpi_airfare": "CUSR0000SETG01", "cpi_usedcars": "CUSR0000SETA02",
    # 工資：ECI 私部門工資（季資料，日期落在季初那個月）、Atlanta Fed wage tracker（3 個月平均，已經是 y/y %）
    "eci_wag": "ECIWAG", "atl_wage": "FRBATLWGT3MMAUMHWGO",
}
WEEKLY = {"icsa": "ICSA"}
DAILY = {"be10": "T10YIE", "real10": "DFII10"}
SEP = {"core_pce": "JCXFEMD", "unrate": "UNRATEMD", "fedfunds": "FEDTARMD"}

MONTHLY_FROM, WEEKLY_FROM, DAILY_FROM = "2000-01-01", "2015-01-01", "2015-01-01"


def fred_series(get, key: str, sid: str, start: str) -> dict[str, str]:
    r = get(FRED_OBS, params={"series_id": sid, "api_key": key, "file_type": "json",
                              "observation_start": start}).json()
    return {o["date"]: o["value"] for o in r.get("observations", []) if o["value"] not in (".", "")}


def collect(get, key: str, series: dict[str, str], start: str, old: list[dict], date_col: str = "date") -> list[dict]:
    """抓一組 series 合成寬表；某條抓不到就沿用舊檔裡那一欄。"""
    cols: dict[str, dict[str, str]] = {}
    for col, sid in series.items():
        try:
            cols[col] = fred_series(get, key, sid, start)
            last = max(cols[col]) if cols[col] else "–"
            print(f"  FRED {sid}：{len(cols[col])} 筆，最後 {last}")
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ FRED {sid} 抓不到，保留舊資料：{e}")
            cols[col] = {r[date_col]: r[col] for r in old if r.get(col)}
    dates = sorted({d for c in cols.values() for d in c})
    return [{date_col: d, **{c: v.get(d, "") for c, v in cols.items()}} for d in dates]


def sep_rows(get, key: str, old: list[dict]) -> list[dict]:
    """SEP 在 FRED 是年資料：日期 = 預測年度的 1/1，值 = 最新一次 SEP 對那年年底的中位數。"""
    out: dict[str, dict] = {r["year"]: dict(r) for r in old}
    for col, sid in SEP.items():
        try:
            obs = fred_series(get, key, sid, "2015-01-01")
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ FRED {sid} 抓不到，保留舊資料：{e}")
            continue
        print(f"  FRED {sid}：{len(obs)} 筆")
        for d, v in obs.items():
            out.setdefault(d[:4], {"year": d[:4]})[col] = v
    return [{"year": y, **{c: out[y].get(c, "") for c in SEP}} for y in sorted(out)]


def update_macro(get, read_csv, write_csv) -> None:
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        print("⚠ 沒有設定 FRED_API_KEY，通膨／就業資料維持原樣")
        return
    rows = collect(get, key, MONTHLY, MONTHLY_FROM, read_csv("macro.csv"))
    write_csv("macro.csv", rows, ["date", *MONTHLY])
    rows = collect(get, key, WEEKLY, WEEKLY_FROM, read_csv("claims.csv"))
    write_csv("claims.csv", rows, ["date", *WEEKLY])
    rows = collect(get, key, DAILY, DAILY_FROM, read_csv("breakeven.csv"))
    write_csv("breakeven.csv", rows, ["date", *DAILY])
    write_csv("sep.csv", sep_rows(get, key, read_csv("sep.csv")), ["year", *SEP])
