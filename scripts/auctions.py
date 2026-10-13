"""財政部 coupon 標售結果（docs/data/auctions.csv）。

來源：Treasury Fiscal Data API（auctions_query，免金鑰）。只留 nominal notes / bonds 和 TIPS，
不要 bill（太多）和 FRN（沒有殖利率）。已公告但還沒標的也會在裡面（結果欄位是空的），行事曆和「下一次」用。

得標比例的分母是 competitive accepted（不含 SOMA 和 non-competitive），和 sell-side 的寫法一樣：
indirect（外國央行、基金透過 dealer 投標）、direct（自己直接投標）、dealer（primary dealer 被迫吃下的部分）。
dealer 比例高 = 需求弱。

沒有免費的 when-issued（WI）殖利率，所以真正的 tail 算不了。近似 tail（docs/data/auctions_wi.csv）：
用 Yahoo 的 CBOE 殖利率指數（^FVX 5y、^TNX 10y、^TYX 30y，追蹤現行 on-the-run 券）在美東 13:00 結標那一刻的值
當 WI。reopening 時 on-the-run 就是同一支券，很接近；新券會差 1–2bp（到期日較長、新券溢價）。2y/3y/7y/20y/TIPS 沒有。
Yahoo 的 1 分鐘線只留約 30 天、5 分鐘線約 60 天，所以每天把抓到的存下來，之後不再重抓。
"""
from __future__ import annotations

import datetime as dt
import re
from zoneinfo import ZoneInfo

import requests

URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query"
SINCE = "2022-01-01"
COLS = ["auction_date", "issue_date", "term", "reopening", "cusip", "offering_bn", "high_yield",
        "btc", "indirect_pct", "direct_pct", "dealer_pct"]


def term_label(r: dict) -> str | None:
    """'10-Year'（reopening 時看 original_security_term）→ '10y'；TIPS 加 ' TIPS'。FRN、bill 回 None。"""
    if r.get("security_type") not in ("Note", "Bond", "TIPS Note", "TIPS Bond") or r.get("floating_rate") == "Yes":
        return None
    t = r.get("original_security_term") if r.get("reopening") == "Yes" and r.get("original_security_term") not in (None, "null") else r.get("security_term")
    m = re.match(r"(\d+)-Year", t or "")
    if not m:
        return None
    return f"{m.group(1)}y" + (" TIPS" if r.get("inflation_index_security") == "Yes" or r["security_type"].startswith("TIPS") else "")


def to_row(r: dict) -> dict | None:
    term = term_label(r)
    if not term:
        return None
    f = lambda k: None if r.get(k) in (None, "", "null") else float(r[k])  # noqa: E731
    comp, out = f("comp_accepted"), {
        "auction_date": r["auction_date"], "issue_date": r.get("issue_date", ""), "term": term,
        "reopening": "Y" if r.get("reopening") == "Yes" else "", "cusip": r.get("cusip", ""),
        "offering_bn": "" if f("offering_amt") is None else round(f("offering_amt") / 1e9, 1),
        "high_yield": "" if f("high_yield") is None else f("high_yield"),
        "btc": "" if f("bid_to_cover_ratio") is None else f("bid_to_cover_ratio"),
    }
    for k, src in (("indirect_pct", "indirect_bidder_accepted"), ("direct_pct", "direct_bidder_accepted"), ("dealer_pct", "primary_dealer_accepted")):
        out[k] = "" if not comp or f(src) is None else round(f(src) / comp * 100, 1)
    return out


def update_auctions(get, read_csv, write_csv) -> None:
    rows, page = [], 1
    while True:
        r = get(URL, params={"filter": f"security_type:in:(Note,Bond,TIPS Note,TIPS Bond),auction_date:gte:{SINCE}",
                             "sort": "auction_date", "page[size]": 500, "page[number]": page}).json()
        rows += [x for x in (to_row(d) for d in r.get("data", [])) if x]
        if page >= r.get("meta", {}).get("total-pages", 1):
            break
        page += 1
    if not rows:
        print("⚠ 標售資料是空的，保留舊檔")
        return
    rows.sort(key=lambda x: (x["auction_date"], x["term"]))
    write_csv("auctions.csv", rows, COLS)
    done = [x for x in rows if x["btc"] != ""]
    print(f"標售：{len(rows)} 筆 coupon，最後一次有結果 {done[-1]['auction_date']} {done[-1]['term']}" if done else f"標售：{len(rows)} 筆")


# ---------- 近似 tail：結標那一刻（13:00 ET）的 CBOE 殖利率 ----------
WI_SYM = {"5y": "^FVX", "10y": "^TNX", "30y": "^TYX"}
WI_COLS = ["auction_date", "term", "wi_yield", "source"]
ET = ZoneInfo("America/New_York")
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/"


def wi_at_close(bars: dict[str, float | None], interval: str) -> float | None:
    """bars：{'HH:MM'（ET，bar 開始時間）: 收盤}。取收在 13:00 的那根（1m 是 12:59、5m 是 12:55），沒有就往前找到 12:50。"""
    step = {"1m": 1, "5m": 5}[interval]
    for start in range(60 - step, 49, -1):  # 12:59/12:55 起往前
        if (start % step) == 0 and bars.get(f"12:{start:02d}") is not None:
            return bars[f"12:{start:02d}"]
    return None


def fetch_wi(sym: str, day: dt.date) -> tuple[float | None, str]:
    age = (dt.date.today() - day).days
    for interval in (("1m", "5m") if age <= 25 else ("5m",)):
        p1 = int(dt.datetime.combine(day, dt.time(12, 0), ET).timestamp())
        p2 = int(dt.datetime.combine(day, dt.time(13, 30), ET).timestamp())
        try:
            res = requests.get(YAHOO + sym, params={"interval": interval, "period1": p1, "period2": p2},
                               headers={"User-Agent": "Mozilla/5.0"}, timeout=30).json()["chart"]["result"][0]
            ts, close = res.get("timestamp") or [], res["indicators"]["quote"][0]["close"]
        except Exception:  # noqa: BLE001
            continue
        bars = {dt.datetime.fromtimestamp(t, ET).strftime("%H:%M"): c for t, c in zip(ts, close)}
        v = wi_at_close(bars, interval)
        if v is not None:
            return round(v, 3), f"{sym} {interval}"
    return None, ""


def update_wi(read_csv, write_csv) -> None:
    have = {(r["auction_date"], r["term"]): r for r in read_csv("auctions_wi.csv")}
    cutoff = (dt.date.today() - dt.timedelta(days=55)).isoformat()
    todo = [r for r in read_csv("auctions.csv") if r["term"] in WI_SYM and r["btc"] != ""
            and r["auction_date"] >= cutoff and (r["auction_date"], r["term"]) not in have]
    for r in todo:
        v, src = fetch_wi(WI_SYM[r["term"]], dt.date.fromisoformat(r["auction_date"]))
        if v is None:
            print(f"  ⚠ {r['auction_date']} {r['term']} 抓不到 13:00 殖利率")
            continue
        have[(r["auction_date"], r["term"])] = {"auction_date": r["auction_date"], "term": r["term"], "wi_yield": v, "source": src}
        print(f"  近似 tail {r['auction_date']} {r['term']}：high {r['high_yield']} vs {v}（{src}）"
              f" = {(float(r['high_yield']) - v) * 100:+.1f}bp")
    write_csv("auctions_wi.csv", [have[k] for k in sorted(have)], WI_COLS)
