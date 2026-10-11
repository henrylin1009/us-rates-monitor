"""Cleveland Fed inflation nowcast（docs/data/nowcast.csv）。

Cleveland Fed 每天用油價、汽油價格和已公布的 CPI / PPI 推算當月和上個月的 CPI、PCE（含 core）m/m。
來源是它網頁圖表用的 JSON：一個陣列，每個元素是一個月份（subcaption "2026-9"），
dataset 裡 "CPI Inflation" 這類是每天的 nowcast，"Actual ..." 是公布後的實際值。
每個月只留最新一天的 nowcast 和實際值（有的話）。
"""
from __future__ import annotations

URL = "https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_month.json"
SERIES = {"CPI Inflation": "cpi", "Core CPI Inflation": "core_cpi", "PCE Inflation": "pce", "Core PCE Inflation": "core_pce"}
COLS = ["month", "asof", *SERIES.values(), *[f"actual_{v}" for v in SERIES.values()]]
KEEP = 6  # 最近幾個月


def last_value(data: list[dict]) -> str:
    vals = [d.get("value", "") for d in data if d.get("value", "") not in ("", None)]
    return f"{float(vals[-1]):.3f}" if vals else ""


def parse(doc: list[dict]) -> list[dict]:
    out = []
    for m in doc[-KEEP:]:
        y, mo = m["chart"]["subcaption"].split("-")
        labels = [c["label"] for c in m["categories"][0]["category"]]
        row = {"month": f"{int(y):04d}-{int(mo):02d}-01", "asof": labels[-1] if labels else ""}
        for ds in m["dataset"]:
            name = ds.get("seriesname", "").strip()
            if name in SERIES:
                row[SERIES[name]] = last_value(ds["data"])
            elif name.startswith("Actual ") and name[7:] in SERIES:
                row["actual_" + SERIES[name[7:]]] = last_value(ds["data"])
        out.append(row)
    # 圖表日期只有 "10/09"：補上年份（_comment 是 "2026-10-09 00:00"）
    asof = doc[-1]["chart"].get("_comment", "")[:10]
    for r in out:
        r["asof"] = asof
    return out


def update_nowcast(get, write_csv) -> None:
    rows = parse(get(URL).json())
    write_csv("nowcast.csv", rows, COLS)
    print(f"Cleveland Fed nowcast：{rows[-1]['month']} core CPI {rows[-1].get('core_cpi')} core PCE {rows[-1].get('core_pce')}（{rows[-1]['asof']}）")
