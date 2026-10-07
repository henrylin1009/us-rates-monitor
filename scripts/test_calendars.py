"""檢查 Fed 會議行事曆的解析（用和官網一樣結構的小片段）。

執行：python3 scripts/test_calendars.py
"""
from datetime import date

from calendars import merge_type, parse_fomc, ref_month

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
print("OK：行事曆解析正常")
