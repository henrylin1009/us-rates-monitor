"""檢查 BEA NIPA 文字檔的解析。

執行：python3 scripts/test_pce.py
"""
from pce import parse_nipa

text = '''%SeriesCode,Period,Value
DHSGRG,2026M07,"132.104"
DHSGRG,2026M08,"132.512"
DHSGRC,2026M08,"3,401.2"
DHSGRG,1999M12,"70.0"
DOTHER,2026M08,"1.0"
DHSGRG,2026Q2,"131.0"
'''
rows = parse_nipa(text)
assert [r["date"] for r in rows] == ["2026-07-01", "2026-08-01"], rows
assert rows[1] == {"date": "2026-08-01", "housing_p": "132.512", "housing_n": "3401.2"}, rows[1]
print("test_pce OK")
