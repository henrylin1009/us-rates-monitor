"""檢查標售資料和 Cleveland Fed nowcast 的解析。

執行：python3 scripts/test_auctions.py
"""
from auctions import term_label, to_row, wi_at_close
from nowcast import parse

# 2026-10-08 的 30 年期 reopening（Fiscal Data API 的欄位）
r = {"security_type": "Bond", "security_term": "29-Year 10-Month", "original_security_term": "30-Year", "reopening": "Yes",
     "auction_date": "2026-10-08", "issue_date": "2026-10-15", "cusip": "912810UW6", "offering_amt": "22000000000",
     "high_yield": "5.6180", "bid_to_cover_ratio": "2.540000", "comp_accepted": "21939603600",
     "indirect_bidder_accepted": "15866059500", "direct_bidder_accepted": "4583044100", "primary_dealer_accepted": "1490500000",
     "floating_rate": "No", "inflation_index_security": "No"}
row = to_row(r)
assert row["term"] == "30y" and row["reopening"] == "Y" and row["offering_bn"] == 22.0, row
assert (row["indirect_pct"], row["direct_pct"], row["dealer_pct"]) == (72.3, 20.9, 6.8), row
assert abs(row["indirect_pct"] + row["direct_pct"] + row["dealer_pct"] - 100) < 0.2
# 還沒標的：結果欄位是 "null"
up = to_row({**r, "high_yield": "null", "bid_to_cover_ratio": "null", "comp_accepted": "null", "indirect_bidder_accepted": "null"})
assert up["btc"] == "" and up["indirect_pct"] == "" and up["high_yield"] == "", up
assert term_label({"security_type": "Note", "security_term": "1-Year 10-Month", "original_security_term": "2-Year", "reopening": "Yes", "floating_rate": "Yes"}) is None
assert term_label({"security_type": "TIPS Note", "security_term": "5-Year", "reopening": "No", "floating_rate": "No", "inflation_index_security": "Yes"}) == "5y TIPS"
assert term_label({"security_type": "Bill", "security_term": "6-Week"}) is None

# 近似 tail：取收在 13:00 的那根 bar（2026-10-07 10y：1m 12:59 = 5.313）
assert wi_at_close({"12:58": 5.316, "12:59": 5.313, "13:00": 5.313, "13:05": 5.292}, "1m") == 5.313
assert wi_at_close({"12:50": 5.320, "12:55": 5.313, "13:00": 5.290}, "5m") == 5.313
assert wi_at_close({"12:57": 4.845, "13:00": 4.84}, "1m") == 4.845  # 12:59/12:58 缺 → 往前找
assert wi_at_close({"13:00": 4.84}, "5m") is None

# Cleveland Fed nowcast JSON 的結構（縮小版）
def ds(name, vals):
    return {"seriesname": name, "data": [{"value": v} for v in vals]}
doc = [{"chart": {"subcaption": "2026-9", "_comment": "2026-10-09 00:00"}, "categories": [{"category": [{"label": "09/01"}, {"label": "10/09"}]}],
        "dataset": [ds("CPI Inflation", ["0.25", "0.530663"]), ds("Core CPI Inflation", ["0.19", "0.2016"]), ds("Core PCE Inflation", ["0.2", "0.231"]),
                    ds("Actual Core CPI Inflation", ["", ""])]},
       {"chart": {"subcaption": "2026-10", "_comment": "2026-10-09 00:00"}, "categories": [{"category": [{"label": "10/01"}, {"label": "10/09"}]}],
        "dataset": [ds("Core CPI Inflation", ["0.2", "0.200340"]), ds("Actual Core CPI Inflation", ["", ""])]}]
rows = parse(doc)
assert rows[0] == {"month": "2026-09-01", "asof": "2026-10-09", "cpi": "0.531", "core_cpi": "0.202", "core_pce": "0.231", "actual_core_cpi": ""}, rows[0]
assert rows[1]["month"] == "2026-10-01" and rows[1]["core_cpi"] == "0.200", rows[1]
print("OK：標售和 nowcast 解析正常")
