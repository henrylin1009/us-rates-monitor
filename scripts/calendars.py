"""自動更新重要事件日期（docs/data/events.json）和 FOMC 會議日期（docs/data/fomc.json）。

- FOMC 決議、會議紀要：Fed 官網會議行事曆（會議紀要有公布日就用，還沒有就用會後 21 天）
- CPI、非農、PPI、PCE：FRED 的 release dates API（含未來排定的日期），需要環境變數 FRED_API_KEY

任何一個來源抓失敗，那一類事件就保留原本的，不會把檔案弄壞。
"""
from __future__ import annotations

import html
import json
import os
import re
from datetime import date, timedelta
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "docs" / "data"
FOMC_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"
FRED_URL = "https://api.stlouisfed.org/fred/release/dates"
FRED_RELEASES = {"cpi": (10, "CPI"), "nfp": (50, "NFP"), "ppi": (46, "PPI"), "pce": (54, "PCE")}
MONTHS = {m: i + 1 for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"])}
MONTHS.update({m[:3]: i for m, i in list(MONTHS.items())})
SINCE = date(2025, 1, 1)
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ---------- FOMC ----------

def parse_fomc(page: str) -> tuple[list[date], dict[date, date]]:
    """Fed 會議行事曆網頁 → (決議日清單, {決議日: 會議紀要公布日})。"""
    text = re.sub(r"<[^>]+>", "\n", page)
    lines = [html.unescape(x).strip() for x in text.split("\n")]
    lines = [x for x in lines if x]
    meetings: list[date] = []
    minutes: dict[date, date] = {}
    year = month = None
    last = None
    for ln in lines:
        m = re.fullmatch(r"(\d{4}) FOMC Meetings", ln)
        if m:
            year, month, last = int(m.group(1)), None, None
            continue
        if year is None:
            continue
        # 月份："March"、跨月 "Apr/May"、"October/November" → 決議日在後面那個月
        parts = ln.split("/")
        if all(p in MONTHS for p in parts):
            month = MONTHS[parts[-1]]
            continue
        m = re.fullmatch(r"(\d{1,2})(?:-(\d{1,2}))?\*?", ln)
        if m and month:
            last = date(year, month, int(m.group(2) or m.group(1)))
            meetings.append(last)
            month = None
            continue
        m = re.search(r"Released (\w+) (\d{1,2}), (\d{4})", ln)
        if m and last and m.group(1) in MONTHS:
            minutes[last] = date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    # 檢查：每年應該有 8 次左右，太少就是網頁格式變了
    by_year: dict[int, int] = {}
    for d in meetings:
        by_year[d.year] = by_year.get(d.year, 0) + 1
    if not by_year or any(not 6 <= n <= 10 for n in by_year.values()):
        raise ValueError(f"FOMC 行事曆解析結果怪怪的：{by_year}")
    return sorted(set(meetings)), minutes


# ---------- FRED ----------

def fred_dates(get, key: str, release_id: int) -> list[date]:
    r = get(FRED_URL, params={
        "release_id": release_id, "api_key": key, "file_type": "json",
        "include_release_dates_with_no_data": "true", "realtime_start": SINCE.isoformat(),
        "sort_order": "asc", "limit": 1000,
    }).json()
    return sorted({date.fromisoformat(x["date"]) for x in r.get("release_dates", [])})


def ref_month(d: date) -> str:
    """公布日 → 資料月份（CPI、非農、PPI、PCE 都是公布前一個月的資料）。"""
    y, m = (d.year - 1, 12) if d.month == 1 else (d.year, d.month - 1)
    return f"{MON[m - 1]} {y}"


# ---------- 合併寫檔 ----------

def merge_type(old: list[dict], new: list[dict], today: date) -> list[dict]:
    """過去的事件保留原本的標籤（有些是手動修正過的），今天以後換成新抓到的。"""
    t = today.isoformat()
    keep = {e["date"]: e for e in old if e["date"] < t}
    for e in new:
        if e["date"] >= t or e["date"] not in keep:
            keep[e["date"]] = e
    return list(keep.values())


def update_calendars(get) -> None:
    today = date.today()
    path = DATA / "events.json"
    doc = json.loads(path.read_text()) if path.exists() else {"events": []}
    old = doc.get("events", [])
    fresh: dict[str, list[dict]] = {}

    try:
        meetings, minutes = parse_fomc(get(FOMC_URL).text)
        (DATA / "fomc.json").write_text(json.dumps({"updated": today.isoformat(), "meetings": [d.isoformat() for d in meetings]}) + "\n")
        fresh["fomc"] = [{"date": d.isoformat(), "type": "fomc", "label": "FOMC decision"} for d in meetings if d >= SINCE]
        fresh["minutes"] = [{"date": minutes.get(d, d + timedelta(days=21)).isoformat(), "type": "minutes",
                             "label": f"FOMC minutes ({MON[d.month - 1]} meeting)"} for d in meetings if d >= SINCE]
        print(f"FOMC 行事曆：{len(meetings)} 次會議，最後一次 {meetings[-1]}")
    except Exception as e:  # noqa: BLE001
        print(f"⚠ FOMC 行事曆抓不到，保留原本的日期：{e}")

    key = os.environ.get("FRED_API_KEY", "").strip()
    if not key:
        print("⚠ 沒有設定 FRED_API_KEY，CPI／非農／PPI／PCE 日期維持原樣")
    for t, (rid, name) in FRED_RELEASES.items() if key else []:
        try:
            ds = fred_dates(get, key, rid)
            fresh[t] = [{"date": d.isoformat(), "type": t, "label": f"{name} ({ref_month(d)})"} for d in ds if d >= SINCE]
            print(f"FRED {name}：{len(ds)} 個日期，最後 {ds[-1] if ds else '–'}")
        except Exception as e:  # noqa: BLE001
            print(f"⚠ FRED {name} 抓不到，保留原本的日期：{e}")

    if not fresh:
        return
    events = [e for e in old if e["type"] not in fresh]
    for t, new in fresh.items():
        events += merge_type([e for e in old if e["type"] == t], new, today)
    events.sort(key=lambda e: (e["date"], e["type"]))
    doc = {"_note": "Auto-updated: FOMC and minutes from the Fed's meeting calendar, CPI/NFP/PPI/PCE from FRED. Past events keep their existing labels.",
           "updated": today.isoformat(), "events": events}
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(f"events.json：{len(events)} 個事件，最後 {events[-1]['date']}")
