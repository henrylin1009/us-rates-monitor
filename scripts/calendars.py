"""自動更新重要事件日期（docs/data/events.json）和 FOMC 會議日期（docs/data/fomc.json）。

- FOMC 決議、會議紀要：Fed 官網會議行事曆（會議紀要有公布日就用，還沒有就用會後 21 天）
- CPI、非農、PPI、PCE、零售銷售、GDP、JOLTS、ECI、UMich、工業生產：FRED 的 release dates API（含未來排定的日期），需要環境變數 FRED_API_KEY
- ISM 製造業 / 服務業：自己算（每月第 1 / 第 3 個營業日，ISM 的固定規則）
- Fed 主席演講 / 國會證詞、Beige Book：Fed 官網行事曆的 JSON
- 國債 coupon 標售：auctions.csv（scripts/auctions.py 先跑），只有財政部已公告的

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
FED_CAL_URL = "https://www.federalreserve.gov/json/calendar.json"
FRED_RELEASES = {"cpi": (10, "CPI"), "nfp": (50, "NFP"), "ppi": (46, "PPI"), "pce": (54, "PCE"),
                 "retail": (9, "Retail sales"), "gdp": (53, "GDP"), "jolts": (192, "JOLTS"), "eci": (11, "ECI"),
                 "umich": (91, "UMich sentiment"), "ip": (13, "Industrial production")}
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


def ref_month(d: date, back: int = 1) -> str:
    """公布日 → 資料月份（CPI、非農、PPI、PCE、零售、工業生產是前一個月；JOLTS 是前兩個月）。"""
    n = d.year * 12 + d.month - 1 - back
    return f"{MON[n % 12]} {n // 12}"


def ref_quarter(d: date) -> str:
    """公布日 → 最近一個已結束的季度（GDP、ECI）：1-3 月公布的是去年 Q4，4-6 月是 Q1……"""
    q = (d.month - 1) // 3
    return f"Q4 {d.year - 1}" if q == 0 else f"Q{q} {d.year}"


GDP_ROUND = {1: "advance", 2: "second", 0: "third"}  # 季後第 1 / 2 / 3 個月


def fred_label(t: str, name: str, d: date) -> str:
    if t == "gdp":
        return f"GDP {ref_quarter(d)}, {GDP_ROUND[d.month % 3]}"
    if t == "eci":
        return f"ECI {ref_quarter(d)}"
    if t == "umich":
        return f"{name} ({MON[d.month - 1]} {d.year})"
    return f"{name} ({ref_month(d, 2 if t == 'jolts' else 1)})"


# ---------- ISM：每月第 1（製造業）/ 第 3（服務業）個營業日 ----------

def us_holidays(y: int) -> set[date]:
    """只放月初幾天可能碰到的：元旦、7/4（遇週末順延）、勞動節（9 月第一個週一）。
    ISM 一月不在 1/2 公布（2024、2025 都是），所以 1/2 也當假日。"""
    def observed(d: date) -> date:
        return d + timedelta(days=1) if d.weekday() == 6 else d - timedelta(days=1) if d.weekday() == 5 else d
    labor = date(y, 9, 1) + timedelta(days=(7 - date(y, 9, 1).weekday()) % 7)
    return {observed(date(y, 1, 1)), date(y, 1, 1), date(y, 1, 2), observed(date(y, 7, 4)), labor}


def nth_business_day(y: int, m: int, n: int) -> date:
    d, k, hol = date(y, m, 1), 0, us_holidays(y)
    while True:
        if d.weekday() < 5 and d not in hol:
            k += 1
            if k == n:
                return d
        d += timedelta(days=1)


def ism_events(start: date, months: int) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {"ism_m": [], "ism_s": []}
    for i in range(months):
        n = start.year * 12 + start.month - 1 + i
        y, m = n // 12, n % 12 + 1
        for t, k, name in (("ism_m", 1, "ISM manufacturing"), ("ism_s", 3, "ISM services")):
            d = nth_business_day(y, m, k)
            out[t].append({"date": d.isoformat(), "type": t, "label": f"{name} ({ref_month(d)})"})
    return out


# ---------- Fed 官網行事曆：主席演講 / 證詞、Beige Book ----------

def parse_fed_calendar(doc: dict) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {"chair": [], "beige": []}
    for e in doc.get("events", []):
        title = html.unescape(str(e.get("title", ""))).strip()
        month = str(e.get("month", ""))
        days = re.findall(r"\d{1,2}", str(e.get("days", "")))
        if not re.fullmatch(r"\d{4}-\d{2}", month) or not days:
            continue
        d = date(int(month[:4]), int(month[5:]), int(days[0]))
        if d < SINCE:
            continue
        m = re.match(r"(Speech|Testimony|Discussion) - Chair(?:man|woman)? (.+)$", title)
        if m:
            kind = {"Speech": "speech", "Discussion": "speaks", "Testimony": "testimony"}[m.group(1)]
            where = html.unescape(str(e.get("location", "")))
            house = " (Senate)" if "Senate" in where else " (House)" if "House" in where else ""
            out["chair"].append({"date": d.isoformat(), "type": "chair", "label": f"Fed Chair {m.group(2).split()[-1]} {kind}{house if kind == 'testimony' else ''}"})
        elif title.startswith("Beige Book"):
            out["beige"].append({"date": d.isoformat(), "type": "beige", "label": "Beige Book"})
    # 同一天同一類只留一個（主席同一天兩場）
    return {t: list({e["date"]: e for e in v}.values()) for t, v in out.items()}


# ---------- 國債標售（auctions.csv） ----------

def auction_events(rows: list[dict]) -> list[dict]:
    out = []
    for r in rows:
        if r["auction_date"] < SINCE.isoformat():
            continue
        size = f"${float(r['offering_bn']):.0f}bn" if r.get("offering_bn") else ""
        extra = ", ".join(x for x in (size, "reopening" if r.get("reopening") else "") if x)
        out.append({"date": r["auction_date"], "type": "auction", "label": f"{r['term']} auction" + (f" ({extra})" if extra else "")})
    return out


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
            # 同一個月有兩個日期（例如零售銷售的年度修正）只留第一個
            first = {}
            for d in ds:
                first.setdefault((d.year, d.month), d)
            fresh[t] = [{"date": d.isoformat(), "type": t, "label": fred_label(t, name, d)} for d in sorted(first.values()) if d >= SINCE]
            print(f"FRED {name}：{len(ds)} 個日期，最後 {ds[-1] if ds else '–'}")
        except Exception as e:  # noqa: BLE001
            print(f"⚠ FRED {name} 抓不到，保留原本的日期：{e}")

    # ISM 是自己算的，不要比其他數據排得更遠（行事曆最後會只剩 ISM）：排到 FRED 上最後一個 CPI 日期為止
    cap = max((e["date"] for e in fresh.get("cpi", [])), default=(today + timedelta(days=92)).isoformat())
    ism = ism_events(SINCE, (today.year - SINCE.year) * 12 + today.month - SINCE.month + 13)
    fresh.update({t: [e for e in v if e["date"] <= cap] for t, v in ism.items()})
    try:
        fed = parse_fed_calendar(json.loads(get(FED_CAL_URL).content.decode("utf-8-sig")))
        fresh.update(fed)
        print(f"Fed 行事曆：主席 {len(fed['chair'])} 場，Beige Book {len(fed['beige'])} 次")
    except Exception as e:  # noqa: BLE001
        print(f"⚠ Fed 行事曆 JSON 抓不到，保留原本的：{e}")
    ap = DATA / "auctions.csv"
    if ap.exists():
        import csv
        with ap.open(newline="") as f:
            fresh["auction"] = auction_events(list(csv.DictReader(f)))

    events = [e for e in old if e["type"] not in fresh]
    for t, new in fresh.items():
        events += merge_type([e for e in old if e["type"] == t], new, today)
    events.sort(key=lambda e: (e["date"], e["type"]))
    doc = {"_note": "Auto-updated: FOMC and minutes from the Fed's meeting calendar; data releases from FRED; ISM computed (1st / 3rd business day); Chair speeches, testimony and Beige Book from the Fed's calendar; coupon auctions from Treasury once announced. Past events keep their existing labels.",
           "updated": today.isoformat(), "events": events}
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n")
    print(f"events.json：{len(events)} 個事件，最後 {events[-1]['date']}")
