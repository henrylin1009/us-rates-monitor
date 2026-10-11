"""財政部 coupon 標售結果（docs/data/auctions.csv）。

來源：Treasury Fiscal Data API（auctions_query，免金鑰）。只留 nominal notes / bonds 和 TIPS，
不要 bill（太多）和 FRN（沒有殖利率）。已公告但還沒標的也會在裡面（結果欄位是空的），行事曆和「下一次」用。

得標比例的分母是 competitive accepted（不含 SOMA 和 non-competitive），和 sell-side 的寫法一樣：
indirect（外國央行、基金透過 dealer 投標）、direct（自己直接投標）、dealer（primary dealer 被迫吃下的部分）。
dealer 比例高 = 需求弱。

沒有 when-issued（WI）殖利率，所以算不了真正的 tail，只比和同天期過去 6 次的平均。
"""
from __future__ import annotations

import re

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
