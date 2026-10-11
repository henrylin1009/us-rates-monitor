import json, requests
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
out = {}
for t in ["SR3Z27.CME", "SR3Z28.CME", "ZQZ26.CBT"]:
    for q in ["range=max&interval=1d", "range=max&interval=1wk", "range=max&interval=1mo"]:
        d = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{t}?{q}", headers=UA, timeout=30).json()["chart"]["result"][0]
        ts, c = d.get("timestamp") or [], d["indicators"]["quote"][0].get("close", [])
        nn = [(ts[i], c[i]) for i in range(len(ts)) if c[i] is not None]
        out[f"{t} {q}"] = [len(ts), len(nn), nn[-6:]]
json.dump(out, open("probe/result.json", "w"), indent=1)
