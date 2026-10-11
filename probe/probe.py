import urllib.request, io
out = []
def fetch(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 rates-monitor"})
    return urllib.request.urlopen(req, timeout=120).read()
for u in ["https://apps.bea.gov/national/Release/TXT/SeriesRegister.txt", "https://apps.bea.gov/national/Release/TXT/NipaDataM.txt", "https://apps.bea.gov/national/Release/TXT/TablesRegister.txt"]:
    try:
        b = fetch(u); out.append(f"OK {u} {len(b)} bytes"); t = b.decode("utf-8", "replace")
        if "SeriesRegister" in u:
            lines = t.splitlines(); out.append(lines[0])
            out += [l for l in lines if "U20404" in l or "U20405" in l][:400]
        elif "TablesRegister" in u:
            out += [l for l in t.splitlines() if "U2040" in l]
        else:
            lines = t.splitlines(); out.append(lines[0]); out += lines[1:4]
    except Exception as e:
        out.append(f"ERR {u} {e}")
open("probe/out.txt", "w").write("\n".join(out))
