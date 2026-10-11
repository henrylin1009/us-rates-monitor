import json, yfinance as yf
out = {}
codes = "HMUZ"
for y in range(26, 32):
    for c in codes:
        t = f"SR3{c}{y}.CME"
        try:
            h = yf.Ticker(t).history(period="1y", interval="1d", auto_adjust=False)
            out[t] = [] if h is None or h.empty else {"n": len(h), "first": str(h.index[0].date()), "tail": [(str(i.date()), round(float(r.Close), 4), int(r.Volume)) for i, r in h.tail(8).iterrows()]}
        except Exception as e:
            out[t] = "ERR " + str(e)[:200]
for t in ["ZQK28.CBT", "ZQM28.CBT", "ZQN28.CBT", "ZQU28.CBT", "ZQV28.CBT", "ZQZ26.CBT"]:
    h = yf.Ticker(t).history(period="1mo", interval="1d", auto_adjust=False)
    out[t] = [] if h is None or h.empty else {"n": len(h), "tail": [(str(i.date()), round(float(r.Close), 4), int(r.Volume)) for i, r in h.tail(3).iterrows()]}
json.dump(out, open("probe/result.json", "w"), indent=1)
