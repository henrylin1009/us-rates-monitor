"""檢查 surprise 的解析和首次公布值的算法。

執行：python3 scripts/test_surprise.py
"""
from surprise import parse_ff, parse_ff_number, vintage_rows

assert parse_ff_number("0.3%") == "0.3"
assert parse_ff_number("-0.1%") == "-0.1"
assert parse_ff_number("150K") == "150"
assert parse_ff_number("") == ""

ev = [
    {"title": "CPI m/m", "country": "USD", "date": "2026-10-14T08:30:00-04:00", "forecast": "0.3%", "previous": "0.4%"},
    {"title": "CPI m/m", "country": "EUR", "date": "2026-10-14T05:00:00-04:00", "forecast": "0.2%", "previous": "0.1%"},
    {"title": "Non-Farm Employment Change", "country": "USD", "date": "2026-11-06T08:30:00-05:00", "forecast": "120K", "previous": "29K"},
    {"title": "Unemployment Claims", "country": "USD", "date": "2026-10-15T08:30:00-04:00", "forecast": "", "previous": "201K"},
]
rows = parse_ff(ev)
assert rows == [
    {"date": "2026-10-14", "measure": "cpi_mm", "forecast": "0.3", "previous": "0.4", "source": "ff"},
    {"date": "2026-11-06", "measure": "nfp", "forecast": "120", "previous": "29", "source": "ff"},
], rows

# 非農：三次公布，第二次把前兩個月各上修
v = [
    ("2026-08-07", [("2026-04-01", 1000), ("2026-05-01", 1100), ("2026-06-01", 1150), ("2026-07-01", 1200)]),
    ("2026-08-20", [("2026-04-01", 1000), ("2026-05-01", 1100), ("2026-06-01", 1150), ("2026-07-01", 1200)]),  # 沒新月份 → 不算
    ("2026-09-04", [("2026-04-01", 1000), ("2026-05-01", 1100), ("2026-06-01", 1170), ("2026-07-01", 1230), ("2026-08-01", 1260)]),
]
r = vintage_rows("nfp", "diff", v)
assert [x["date"] for x in r] == ["2026-08-07", "2026-09-04"], r
a, b = r
assert (a["actual"], a["revised"], a["prior"]) == (50, 50, ""), a
# 9/4：8 月 +30；7 月修正成 +60（原本 +50）；6 月 +70 vs 原本 +50 → 合計上修 30
assert (b["actual"], b["prior"], b["revised"], b["rev2"]) == (30, 50, 60, 30), b

# CPI m/m
v = [("2026-09-11", [("2026-07-01", 100.0), ("2026-08-01", 100.3)]),
     ("2026-10-14", [("2026-07-01", 100.0), ("2026-08-01", 100.2), ("2026-09-01", 100.6)])]
r = vintage_rows("cpi_mm", "pct1", v)
assert (r[1]["actual"], r[1]["prior"], r[1]["revised"]) == (0.4, 0.3, 0.2), r
# 缺一個月（2025 年 10 月 CPI 沒公布）：y/y 要用日期找 12 個月前，不能用位置
from surprise import compute
obs = [(f"2024-{m:02d}-01", 100.0 + m) for m in range(9, 13)] + [(f"2025-{m:02d}-01", 110.0 + m) for m in range(1, 13) if m != 10]
i = len(obs) - 1  # 2025-12
assert compute("pct12", obs, i) == round((122 / 112 - 1) * 100, 1), compute("pct12", obs, i)
assert compute("pct1", obs, i) == round((122 / 121 - 1) * 100, 1)
assert compute("pct1", obs, obs.index(("2025-11-01", 121.0))) is None  # 前一個月沒資料
print("test_surprise OK")
