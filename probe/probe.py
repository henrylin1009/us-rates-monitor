import json, requests, yfinance as yf
out = {}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}
tick = ["SR3=F", "SR3Z26.CME", "SR3H27.CME", "SR3Z27.CME", "SR3H28.CME", "SR3Z28.CME", "SR3Z29.CME", "SR3U31.CME",
        "SR3Z26.CMX", "SR3Z26", "SR1X26.CME", "ZQZ28.CBT", "ZQF29.CBT"]
for t in tick:
    try:
        h = yf.Ticker(t).history(period="1mo", interval="1d", auto_adjust=False)
        out[t] = [] if h is None or h.empty else [(str(i.date()), float(c)) for i, c in h["Close"].tail(6).items()]
    except Exception as e:
        out[t] = "ERR " + str(e)[:200]
for name, url in {
    "cme_sr3": "https://www.cmegroup.com/CmeWS/mvc/Quotes/Future/8462/G",
    "cme_settle": "https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/8462/FUT?tradeDate=10/09/2026",
    "sofr": "https://markets.newyorkfed.org/api/rates/secured/sofr/last/10.json",
    "tgcr": "https://markets.newyorkfed.org/api/rates/secured/tgcr/last/5.json",
}.items():
    try:
        r = requests.get(url, headers=UA, timeout=30)
        out[name] = [r.status_code, r.text[:3000]]
    except Exception as e:
        out[name] = "ERR " + str(e)[:200]
json.dump(out, open("probe/result.json", "w"), indent=1)
