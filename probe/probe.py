import json, os, urllib.request, urllib.parse
K = os.environ["FRED_API_KEY"]
def get(path, **p):
    p.update(api_key=K, file_type="json")
    return json.load(urllib.request.urlopen(f"https://api.stlouisfed.org/fred/{path}?" + urllib.parse.urlencode(p), timeout=30))
out = []
Q = ["personal consumption expenditures goods excluding food and energy", "personal consumption expenditures housing",
     "personal consumption expenditures health care", "personal consumption expenditures financial services and insurance",
     "personal consumption expenditures food and beverages purchased for off-premises consumption",
     "personal consumption expenditures energy goods and services", "personal consumption expenditures services excluding energy and housing",
     "personal consumption expenditures excluding food and energy", "personal consumption expenditures goods", "personal consumption expenditures services",
     "consumer price index medical care", "consumer price index financial services"]
for q in Q:
    out.append(f"## {q}")
    try:
        for s in get("series/search", search_text=q, limit=40)["seriess"]:
            if s["frequency_short"] == "M" and s["seasonal_adjustment_short"] == "SA":
                out.append(f'{s["id"]} | {s["title"]} | {s["units_short"]} | {s["observation_end"]}')
    except Exception as e:
        out.append(f"ERR {e}")
open("probe/out.txt", "w").write("\n".join(out))
