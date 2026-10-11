import json, os, re, requests
K = os.environ["FRED_API_KEY"]; out = {}
UA = {"User-Agent": "us-rates-monitor (personal study project)"}
def g(u, **kw):
    try:
        r = requests.get(u, headers=UA, timeout=30, **kw); return r.status_code, r.text
    except Exception as e: return 0, str(e)
for s in "SOFR IORB RRPONTSYD WRESBAL WTREGEN WALCL CCSA LNS12300060 THREEFF10 THREEFYTP10 GDPNOW A191RL1Q225SBEA RSAFS RSXFS RSMVPD RSGASS RSBMGESD INDPRO GACDFSA066MSFRBPHI GACDINA066MSFRBNY".split():
    c, t = g("https://api.stlouisfed.org/fred/series/observations", params={"series_id": s, "api_key": K, "file_type": "json", "observation_start": "2026-01-01"})
    try: o = json.loads(t)["observations"]; out[s] = [len(o), o[-3:]]
    except Exception: out[s] = [c, t[:200]]
for rid in [9, 53, 192, 11, 91, 13, 180, 10, 50, 46, 54]:
    c, t = g("https://api.stlouisfed.org/fred/release", params={"release_id": rid, "api_key": K, "file_type": "json"})
    c2, t2 = g("https://api.stlouisfed.org/fred/release/dates", params={"release_id": rid, "api_key": K, "file_type": "json", "include_release_dates_with_no_data": "true", "realtime_start": "2026-09-01", "limit": 20})
    try: out[f"rel{rid}"] = [json.loads(t)["releases"][0]["name"], [d["date"] for d in json.loads(t2)["release_dates"]][:12]]
    except Exception: out[f"rel{rid}"] = [c, t[:200]]
B = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/"
c, t = g(B + "auctions_query", params={"sort": "-auction_date", "page[size]": 4}); out["auctions"] = [c, t[:6000]]
c, t = g(B + "upcoming_auctions", params={"sort": "auction_date", "page[size]": 30}); out["upcoming"] = [c, t[:6000]]
for u in ["https://www.federalreserve.gov/json/calendar.json", "https://www.federalreserve.gov/newsevents/calendar.htm",
          "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting",
          "https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_month.json",
          "https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_quarter.json"]:
    c, t = g(u)
    jsons = sorted(set(re.findall(r'[\w/\.\-:]+\.json', t)))[:40]
    out[u] = [c, len(t), t[:3000], jsons]
open("probe/out.json", "w").write(json.dumps(out, indent=1))
