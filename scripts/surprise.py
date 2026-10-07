"""數據 surprise：預期值（ForexFactory 週曆）+ 首次公布值（ALFRED）。

- consensus.csv：每次公布前抓到的預期值（FF 只給這一週，所以從開始收集那天才有歷史）
- consensus_manual.csv：手動補的預期值，網站上優先用這個（自己建，欄位一樣）
- releases.csv：每次公布當天的數字，用 ALFRED 當天的版本算，跟新聞標題一樣
  actual = 這次公布的值、prior = 上次公布時的值、revised = 這次公布對上個月的修正後值
  非農另外有 rev2 = 前兩個月合計修正（千人）

需要 FRED_API_KEY。ALFRED 每個公布日要打一次 API，第一次會補 RELEASE_FROM 之後的歷史，之後只抓新的。
"""
from __future__ import annotations

import os
import time
from datetime import date, timedelta

FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
FRED = "https://api.stlouisfed.org/fred/series"
RELEASE_FROM = "2023-06-01"

# measure → (FRED series, 算法, FF 的項目名稱)
#   pct1 = m/m %、pct12 = y/y %、diff = 跟上期差（千人）、level = 水準、level_k = 水準 / 1000
MEASURES = {
    "cpi_mm": ("CPIAUCSL", "pct1", "CPI m/m"),
    "core_cpi_mm": ("CPILFESL", "pct1", "Core CPI m/m"),
    "cpi_yy": ("CPIAUCNS", "pct12", "CPI y/y"),            # 官方 y/y 用未季調
    "core_pce_mm": ("PCEPILFE", "pct1", "Core PCE Price Index m/m"),
    "ppi_mm": ("PPIFIS", "pct1", "PPI m/m"),
    "core_ppi_mm": ("PPIFES", "pct1", "Core PPI m/m"),
    "nfp": ("PAYEMS", "diff", "Non-Farm Employment Change"),
    "unrate": ("UNRATE", "level", "Unemployment Rate"),
    "ahe_mm": ("CES0500000003", "pct1", "Average Hourly Earnings m/m"),
    "claims": ("ICSA", "level_k", "Unemployment Claims"),
}
FF_TITLES = {v[2]: k for k, v in MEASURES.items()}
REL_COLS = ["date", "measure", "ref", "actual", "prior", "revised", "rev2"]
CON_COLS = ["date", "measure", "forecast", "previous", "source"]


def parse_ff_number(s: str) -> str:
    """'0.3%' → '0.3'、'150K' → '150'、'-0.1%' → '-0.1'；看不懂就回空字串。"""
    s = (s or "").strip().replace("%", "").replace(",", "")
    mult = 1.0
    if s[-1:] in ("K", "k"):
        s = s[:-1]
    elif s[-1:] in ("M", "m"):
        s, mult = s[:-1], 1000.0
    try:
        v = float(s) * mult
    except ValueError:
        return ""
    return f"{v:g}"


def parse_ff(events: list[dict]) -> list[dict]:
    out = []
    for e in events:
        m = FF_TITLES.get(e.get("title", ""))
        if not m or e.get("country") != "USD":
            continue
        f = parse_ff_number(e.get("forecast", ""))
        if f == "":
            continue
        out.append({"date": str(e.get("date", ""))[:10], "measure": m, "forecast": f,
                    "previous": parse_ff_number(e.get("previous", "")), "source": "ff"})
    return out


def compute(kind: str, obs: list[tuple[str, float]], i: int) -> float | None:
    """obs 是同一個 vintage 的 (日期, 值)，算第 i 期的數字。"""
    if kind in ("level", "level_k"):
        return round(obs[i][1] / (1000 if kind == "level_k" else 1), 3)
    k = 12 if kind == "pct12" else 1
    if i - k < 0:
        return None
    a, b = obs[i][1], obs[i - k][1]
    return round(a - b) if kind == "diff" else round((a / b - 1) * 100, 1) + 0.0  # + 0.0 去掉 -0.0


def vintage_rows(measure: str, kind: str, vintages: list[tuple[str, list[tuple[str, float]]]]) -> list[dict]:
    """每個 vintage（公布日）一列。只有參考期往前推進的 vintage 才算一次公布（排除年度季調修正那種）。"""
    rows, prev = [], None
    for vd, obs in vintages:
        if len(obs) < 2:
            continue
        ref = obs[-1][0]
        if prev and ref <= prev["ref"]:
            continue
        actual, revised = compute(kind, obs, len(obs) - 1), compute(kind, obs, len(obs) - 2)
        if actual is None:
            continue
        r = {"date": vd, "measure": measure, "ref": ref, "actual": actual, "revised": "" if revised is None else revised,
             "prior": prev["actual"] if prev and prev["ref"] == obs[-2][0] else "", "rev2": ""}
        if kind == "diff" and prev and prev["ref"] == obs[-2][0] and len(obs) >= 4:
            before = compute(kind, obs, len(obs) - 3)
            if before is not None and prev.get("_prior_raw") is not None:
                r["rev2"] = round((revised + before) - (prev["actual"] + prev["_prior_raw"]))
        r["_prior_raw"] = revised
        rows.append(r)
        prev = r
    return rows


def fetch_vintage(get, key: str, sid: str, vd: str, lookback_days: int) -> list[tuple[str, float]]:
    start = (date.fromisoformat(vd) - timedelta(days=lookback_days)).isoformat()
    r = get(f"{FRED}/observations", params={"series_id": sid, "api_key": key, "file_type": "json",
                                            "realtime_start": vd, "realtime_end": vd, "observation_start": start}).json()
    return [(o["date"], float(o["value"])) for o in r.get("observations", []) if o["value"] not in (".", "")]


def update_releases(get, key: str, old: list[dict]) -> list[dict]:
    have = {(r["date"], r["measure"]) for r in old}
    out = {(r["date"], r["measure"]): r for r in old}
    for m, (sid, kind, _) in MEASURES.items():
        try:
            vds = get(f"{FRED}/vintagedates", params={"series_id": sid, "api_key": key, "file_type": "json",
                                                       "realtime_start": RELEASE_FROM}).json().get("vintage_dates", [])
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠ ALFRED {sid} vintage 日期抓不到：{e}")
            continue
        # 為了算 prior 和非農修正，最後一個已存的 vintage 也要重抓
        known = sorted(d for d, mm in have if mm == m)
        start = known[-1] if known else RELEASE_FROM
        todo = [v for v in vds if v >= start]
        if known and len(todo) <= 1:
            continue
        lookback = 500 if kind == "pct12" else (40 if kind == "level_k" else 150)
        vint = []
        for vd in todo:
            try:
                vint.append((vd, fetch_vintage(get, key, sid, vd, lookback)))
            except Exception as e:  # noqa: BLE001
                print(f"  ⚠ ALFRED {sid} {vd}：{e}")
            time.sleep(0.6)  # FRED 每分鐘 120 次
        rows = vintage_rows(m, kind, vint)
        # 第一列的 prior / rev2 需要更早一個 vintage，接回已存的那一列
        if known and rows and rows[0]["date"] == known[-1]:
            rows = rows[1:]
        n = 0
        for r in rows:
            r.pop("_prior_raw", None)
            k = (r["date"], m)
            if k not in out:
                n += 1
            out[k] = r
        print(f"  ALFRED {sid}：新增 {n} 次公布")
    return [out[k] for k in sorted(out)]


def update_surprise(get, read_csv, write_csv) -> None:
    try:
        ev = get(FF_URL).json()
        new = parse_ff(ev)
        rows = {(r["date"], r["measure"]): r for r in read_csv("consensus.csv")}
        rows.update({(r["date"], r["measure"]): r for r in new})
        write_csv("consensus.csv", [rows[k] for k in sorted(rows)], CON_COLS)
        print(f"FF 預期值：本週 {len(new)} 筆")
    except Exception as e:  # noqa: BLE001
        print(f"⚠ FF 預期值抓不到，這次跳過：{e}")
    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        print("⚠ 沒有設定 FRED_API_KEY，首次公布值維持原樣")
        return
    rows = update_releases(get, key, read_csv("releases.csv"))
    write_csv("releases.csv", rows, REL_COLS)
