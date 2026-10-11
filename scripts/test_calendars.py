"""檢查 Fed 會議行事曆的解析（用和官網一樣結構的小片段）。

執行：python3 scripts/test_calendars.py
"""
from datetime import date

from calendars import auction_events, fred_label, ism_events, merge_type, nth_business_day, parse_fed_calendar, parse_fomc, ref_month

PAGE = """
<div class="panel-heading"><h4><a id="1">2026 FOMC Meetings</a></h4></div>
""" + "".join(
    f'<div class="row fomc-meeting"><div class="fomc-meeting__month"><strong>{m}</strong></div>'
    f'<div class="fomc-meeting__date">{d}</div>{extra}</div>'
    for m, d, extra in [
        ("January", "27-28", '<div class="fomc-meeting__minutes">Minutes: <a>HTML</a> (Released February 18, 2026)</div>'),
        ("March", "17-18*", ""), ("Apr/May", "28-1", ""), ("June", "16-17*", ""), ("July", "28-29", ""),
        ("August", "22 (notation vote)", ""), ("September", "15-16*", ""), ("October", "27-28", ""), ("December", "8-9*", ""),
    ]) + "<p>Last Update: September 17, 2025</p>"

meetings, minutes = parse_fomc(PAGE)
assert meetings[0] == date(2026, 1, 28), meetings
assert date(2026, 5, 1) in meetings, meetings              # 跨月：決議日在後面那個月
assert date(2026, 8, 22) not in meetings, meetings         # notation vote 不算會議
assert len(meetings) == 8, meetings
assert minutes == {date(2026, 1, 28): date(2026, 2, 18)}, minutes

try:
    parse_fomc("<h4>2026 FOMC Meetings</h4><strong>March</strong><div>17-18</div>")
    raise AssertionError("只解析到 1 次會議應該要報錯")
except ValueError:
    pass

assert ref_month(date(2026, 1, 9)) == "Dec 2025"
old = [{"date": "2026-01-01", "type": "cpi", "label": "手動標籤"}, {"date": "2026-12-01", "type": "cpi", "label": "舊的未來"}]
new = [{"date": "2026-01-01", "type": "cpi", "label": "新"}, {"date": "2026-12-10", "type": "cpi", "label": "新的未來"}]
got = {e["date"]: e["label"] for e in merge_type(old, new, date(2026, 6, 1))}
assert got == {"2026-01-01": "手動標籤", "2026-12-10": "新的未來"}, got
# 其他數據的標籤
assert fred_label("gdp", "GDP", date(2026, 10, 29)) == "GDP Q3 2026, advance"
assert fred_label("gdp", "GDP", date(2026, 9, 30)) == "GDP Q2 2026, third"
assert fred_label("gdp", "GDP", date(2027, 2, 26)) == "GDP Q4 2026, second"
assert fred_label("eci", "ECI", date(2027, 1, 30)) == "ECI Q4 2026"
assert fred_label("jolts", "JOLTS", date(2026, 11, 3)) == "JOLTS (Sep 2026)"
assert fred_label("retail", "Retail sales", date(2026, 1, 15)) == "Retail sales (Dec 2025)"
assert fred_label("umich", "UMich sentiment", date(2026, 10, 23)) == "UMich sentiment (Oct 2026)"

# ISM：已知的公布日（2025-09 勞動節順延、2025-01 跳過 1/2、2025-07 服務業在 7/3）
assert nth_business_day(2025, 9, 1) == date(2025, 9, 2)
assert nth_business_day(2025, 9, 3) == date(2025, 9, 4)
assert nth_business_day(2025, 1, 1) == date(2025, 1, 3)
assert nth_business_day(2025, 1, 3) == date(2025, 1, 7)
assert nth_business_day(2025, 7, 3) == date(2025, 7, 3)
assert nth_business_day(2025, 10, 1) == date(2025, 10, 1) and nth_business_day(2025, 10, 3) == date(2025, 10, 3)
ism = ism_events(date(2026, 10, 1), 2)
assert ism["ism_m"][0] == {"date": "2026-10-01", "type": "ism_m", "label": "ISM manufacturing (Sep 2026)"}, ism
assert ism["ism_s"][1]["date"] == "2026-11-04", ism

# Fed 官網行事曆：只要主席（不要副主席）和 Beige Book
fed = parse_fed_calendar({"events": [
    {"title": "Discussion - Chairman Kevin Warsh", "month": "2026-10", "days": "15", "type": "Speeches", "location": "Bangkok"},
    {"title": "Speech - Vice Chair Philip N. Jefferson", "month": "2026-10", "days": "1", "type": "Speeches"},
    {"title": "Testimony - Chairman Kevin Warsh", "month": "2026-07", "days": "15", "type": "Testimony", "location": "Before the U.S. Senate Committee on Banking"},
    {"title": "Beige Book", "month": "2026-10", "days": "14", "type": "Beige"},
    {"title": "FOMC Minutes", "month": "2026-11", "days": "18", "type": "FOMC"},
    {"title": "Speech - Chair Jerome H. Powell", "month": "", "days": "", "type": "Speeches"},
]})
assert fed["chair"] == [{"date": "2026-10-15", "type": "chair", "label": "Fed Chair Warsh speaks"},
                        {"date": "2026-07-15", "type": "chair", "label": "Fed Chair Warsh testimony (Senate)"}], fed
assert fed["beige"] == [{"date": "2026-10-14", "type": "beige", "label": "Beige Book"}], fed

assert auction_events([{"auction_date": "2026-10-08", "term": "30y", "offering_bn": "22.0", "reopening": "Y"}]) == \
    [{"date": "2026-10-08", "type": "auction", "label": "30y auction ($22bn, reopening)"}]
print("OK：行事曆解析正常")
