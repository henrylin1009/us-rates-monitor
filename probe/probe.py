import json, os, urllib.request, urllib.parse
K = os.environ["FRED_API_KEY"]
def get(path, **p):
    p.update(api_key=K, file_type="json")
    return json.load(urllib.request.urlopen(f"https://api.stlouisfed.org/fred/{path}?" + urllib.parse.urlencode(p), timeout=30))
codes = ["DHLC", "DHUT", "DHSG", "DIFS", "DFSA", "DFSI", "DTRS", "DRCA", "DOTS", "DFDS", "DHCE", "DGOE", "DMOT", "DFUR", "DREC", "DCLO", "DGAS", "DOTH", "DNPI", "DPCC", "DPCE", "DTRN", "DFNS", "DMDC"]
out = []
ids = [c + s for c in codes for s in ["RG3M086SBEA", "RC1M027SBEA", "RG3Q086SBEA"]] + ["PCE", "PCES", "PCEDG", "PCEND", "DSERRC1", "DHLCRC1", "DHUTRC1", "DHSGRC1", "DIFSRC1", "PCEPILFE", "IA001176M"]
for i in ids:
    try:
        s = get("series", series_id=i)["seriess"][0]
        out.append(f'OK {i} | {s["title"]} | {s["frequency_short"]} | {s["units_short"]} | {s["observation_end"]}')
    except Exception as e:
        out.append(f"-- {i}")
# BEA release 54 tables: list children so we can see what monthly tables FRED carries
try:
    r = get("release/tables", release_id=54)
    for k, v in r.get("elements", {}).items():
        out.append(f'T {v["element_id"]} | {v["name"]} | children {v.get("children") and len(v["children"])}')
except Exception as e:
    out.append(f"ERR tables {e}")
open("probe/out.txt", "w").write("\n".join(out))
