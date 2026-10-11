import json, re, requests, collections, traceback
UA = {"User-Agent": "us-rates-monitor (personal study project)"}
out = {"errors": []}
def step(f):
    try: f()
    except Exception: out["errors"].append(traceback.format_exc()[-1500:])
B = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query"
def a1():
    r = requests.get(B, params={"filter": "security_type:in:(Note,Bond),auction_date:gte:2026-08-01", "sort": "-auction_date", "page[size]": 40}, headers=UA, timeout=60)
    out["coupons_raw"] = r.text[:1500]
    r = r.json()
    keep = ["cusip","security_type","security_term","original_security_term","reopening","auction_date","issue_date","maturity_date","offering_amt","high_yield","low_yield","avg_med_yield","int_rate","bid_to_cover_ratio","comp_accepted","comp_tendered","total_accepted","total_tendered","indirect_bidder_accepted","direct_bidder_accepted","primary_dealer_accepted","soma_accepted","announcemt_date","floating_rate","inflation_index_security","high_discnt_margin"]
    out["coupons"] = [{k: d.get(k) for k in keep} for d in r["data"]]
def a2():
    r = requests.get(B, params={"filter": "auction_date:gte:2026-10-09", "sort": "auction_date", "page[size]": 60}, headers=UA, timeout=60).json()
    out["ahead"] = [{k: d.get(k) for k in ["security_type","security_term","reopening","auction_date","announcemt_date","offering_amt","cash_management_bill_cmb","floating_rate","inflation_index_security"]} for d in r["data"]]
def f1():
    t = requests.get("https://www.federalreserve.gov/json/calendar.json", headers=UA, timeout=60).content.decode("utf-8-sig")
    ev = json.loads(t)["events"]
    out["fed_n"] = len(ev); out["fed_types"] = collections.Counter(e.get("type") for e in ev).most_common()
    out["fed_keys"] = sorted({k for e in ev for k in e})
    out["fed_months"] = sorted({str(e.get("month")) for e in ev})
    out["fed_sample"] = [e for e in ev if re.search(r"Chair|Beige|Testimony|Jackson|Minutes|Monetary Policy Report", str(e.get("title",""))+str(e.get("description","")))][:60]
    out["fed_other"] = [e for e in ev if e.get("type") not in ("Speeches",)][:30]
def shrink(x):
    if isinstance(x, list): return [shrink(i) for i in (x[:3] + ["..."] + x[-3:] if len(x) > 6 else x)]
    if isinstance(x, dict): return {k: shrink(v) for k, v in x.items()}
    return x
def c1():
    j = requests.get("https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_month.json", headers=UA, timeout=60).json()
    out["cle_n"] = len(j); out["cle_last"] = shrink(j[-1]); out["cle_prev"] = shrink(j[-2])
def c2():
    q = requests.get("https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_quarter.json", headers=UA, timeout=60).json()
    out["cleq_last"] = shrink(q[-1])
for f in (a1, a2, f1, c1, c2): step(f)
open("probe/out.json", "w").write(json.dumps(out, indent=1))
