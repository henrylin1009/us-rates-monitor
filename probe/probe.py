import urllib.request, re
def fetch(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 rates-monitor"}), timeout=120).read().decode("utf-8", "replace")
out = []
reg = fetch("https://apps.bea.gov/national/Release/TXT/SeriesRegister.txt").splitlines()
pat = re.compile(r"excluding|Portfolio|Personal consumption expenditures|^D(SER|NRG|PCE|PCC|HLC|HSG|IFS|FXA|GOE|GDS|FNL)R[CG],|Medical|Hospital|Physician|insurance|Rental of tenant|Imputed rental|Airline|Motor vehicle insurance", re.I)
out += [l for l in reg if ("U20404" in l or "U20405" in l) and pat.search(l)]
data = fetch("https://apps.bea.gov/national/Release/TXT/NipaDataM.txt").splitlines()
want = {"DPCERG", "DPCCRG", "DHSGRG", "DHLCRG", "DSERRG"}
rows = [l for l in data if l.split(",")[0] in want]
out.append(f"datarows {len(rows)}"); out += rows[-12:]
open("probe/out.txt", "w").write("\n".join(out))
