import json, re, requests, collections
UA = {"User-Agent": "us-rates-monitor (personal study project)"}
out = {}
B = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query"
r = requests.get(B, params={"filter": "security_type:in:(Note,Bond),auction_date:gte:2026-08-01", "sort": "-auction_date", "page[size]": 40}, headers=UA, timeout=60).json()
keep = ["cusip","security_type","security_term","original_security_term","reopening","auction_date","issue_date","maturity_date","offering_amt","high_yield","low_yield","avg_med_yield","int_rate","bid_to_cover_ratio","comp_accepted","comp_tendered","total_accepted","total_tendered","indirect_bidder_accepted","direct_bidder_accepted","primary_dealer_accepted","soma_accepted","announcemt_date","floating_rate","inflation_index_security","high_discnt_margin"]
out["coupons"] = [{k: d.get(k) for k in keep} for d in r["data"]]
out["coupons_meta"] = r.get("meta", {}).get("total-count")
r = requests.get(B, params={"filter": "auction_date:gte:2026-10-09", "sort": "auction_date", "page[size]": 60}, headers=UA, timeout=60).json()
out["ahead"] = [{k: d.get(k) for k in ["security_type","security_term","reopening","auction_date","announcemt_date","offering_amt","cash_management_bill_cmb","floating_rate","inflation_index_security"]} for d in r["data"]]
t = requests.get("https://www.federalreserve.gov/json/calendar.json", headers=UA, timeout=60).content.decode("utf-8-sig")
ev = json.loads(t)["events"]
out["fed_n"] = len(ev); out["fed_types"] = collections.Counter(e.get("type") for e in ev).most_common()
out["fed_keys"] = sorted({k for e in ev for k in e})
out["fed_months"] = sorted({e.get("month") for e in ev})
out["fed_sample"] = [e for e in ev if re.search(r"Chair|Beige|Testimony|Jackson|Minutes|Monetary Policy Report", e.get("title","")+e.get("description",""))][:60]
out["fed_other"] = [e for e in ev if e.get("type") not in ("Speeches",)][:30]
j = requests.get("https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_month.json", headers=UA, timeout=60).json()
out["cle_n"] = len(j)
def shrink(x):
    if isinstance(x, list): return [shrink(i) for i in (x[:3] + (["..."] if len(x) > 6 else []) + x[-3:] if len(x) > 6 else x)]
    if isinstance(x, dict): return {k: shrink(v) for k, v in x.items()}
    return x
out["cle_last"] = shrink(j[-1]); out["cle_prev"] = shrink(j[-2])
q = requests.get("https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_quarter.json", headers=UA, timeout=60).json()
out["cleq_last"] = shrink(q[-1])
open("probe/out.json", "w").write(json.dumps(out, indent=1))
