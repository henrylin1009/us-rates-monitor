import json, time, requests, yfinance as yf
out = {}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
p1, p2 = int(time.time()) - 400 * 86400, int(time.time())
for t in ["SR3Z27.CME", "SR3H28.CME", "SR3Z28.CME"]:
    for host in ["query1", "query2"]:
        for q in [f"period1={p1}&period2={p2}&interval=1d", "range=1y&interval=1d", "range=3mo&interval=1wk", "range=max&interval=1d"]:
            try:
                r = requests.get(f"https://{host}.finance.yahoo.com/v8/finance/chart/{t}?{q}", headers=UA, timeout=30)
                d = r.json()["chart"]["result"][0]
                ts = d.get("timestamp") or []
                out[f"{t} {host} {q}"] = [len(ts), d["indicators"]["quote"][0].get("close", [])[-5:], d["meta"].get("firstTradeDate"), d["meta"].get("dataGranularity")]
            except Exception as e:
                out[f"{t} {host} {q}"] = "ERR " + str(e)[:150]
    try:
        h = yf.download(t, start="2026-08-01", end="2026-10-11", progress=False, auto_adjust=False)
        out[t + " download"] = len(h)
    except Exception as e:
        out[t + " download"] = "ERR " + str(e)[:150]
json.dump(out, open("probe/result.json", "w"), indent=1)
