import csv, json, datetime as dt, requests, zoneinfo
ET = zoneinfo.ZoneInfo("America/New_York")
H = {"User-Agent": "Mozilla/5.0"}
SYM = {"5y": "^FVX", "10y": "^TNX", "30y": "^TYX"}
rows = [r for r in csv.DictReader(open("docs/data/auctions.csv")) if r["term"] in SYM and r["btc"] and r["auction_date"] >= "2026-07-01"]
out = []
for r in rows:
    d = dt.date.fromisoformat(r["auction_date"])
    for itv in ("1m", "2m", "5m"):
        p1 = int(dt.datetime.combine(d, dt.time(11, 0), ET).timestamp()); p2 = int(dt.datetime.combine(d, dt.time(15, 0), ET).timestamp())
        try:
            j = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{SYM[r['term']]}", params={"interval": itv, "period1": p1, "period2": p2}, headers=H, timeout=20).json()
            res = j["chart"]["result"][0]; ts = res.get("timestamp") or []; c = res["indicators"]["quote"][0]["close"]
            bars = {dt.datetime.fromtimestamp(t, ET).strftime("%H:%M"): v for t, v in zip(ts, c)}
            pick = {k: bars.get(k) for k in ("12:30", "12:50", "12:55", "12:58", "12:59", "13:00", "13:05", "13:30", "14:00")}
            out.append({"date": r["auction_date"], "term": r["term"], "reopen": r["reopening"], "hy": r["high_yield"], "itv": itv, "nbars": len(ts), "bars": pick})
        except Exception as e:
            out.append({"date": r["auction_date"], "term": r["term"], "itv": itv, "err": str(e)[:200], "raw": str(j)[:200] if 'j' in dir() else ""})
json.dump(out, open("probe/wi_probe.json", "w"), indent=1)
print(json.dumps(out, indent=1))
