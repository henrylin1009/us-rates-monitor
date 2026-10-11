import json, os, urllib.request, urllib.parse
K = os.environ["FRED_API_KEY"]
def get(path, **p):
    p.update(api_key=K, file_type="json")
    return json.load(urllib.request.urlopen(f"https://api.stlouisfed.org/fred/{path}?" + urllib.parse.urlencode(p), timeout=30))
out = []
for pat in ["D*RG3M086SBEA", "D*RC1M027SBEA", "D*RC1", "IA00*M", "CUSR0000SEG*", "CUSR0000SAG*"]:
    out.append(f"## {pat}")
    try:
        r = get("series/search", search_text=pat, search_type="series_id", limit=1000)
        for s in sorted(r["seriess"], key=lambda s: s["id"]):
            out.append(f'{s["id"]} | {s["title"]} | {s["frequency_short"]} | {s["units_short"]} | {s["observation_end"]}')
    except Exception as e:
        out.append(f"ERR {e}")
open("probe/out.txt", "w").write("\n".join(out))
