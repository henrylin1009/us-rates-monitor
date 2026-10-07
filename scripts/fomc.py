"""FOMC 會議日期（第二天，也就是公布決議那天）。

每天由 calendars.py 從 Fed 官網抓下來存在 docs/data/fomc.json；
下面這份清單只是備用：官網抓不到、或 fomc.json 沒涵蓋的年份才會用到。
來源：https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
"""
import json
from datetime import date
from pathlib import Path

FALLBACK = [
    # 2025
    date(2025, 1, 29), date(2025, 3, 19), date(2025, 5, 7), date(2025, 6, 18),
    date(2025, 7, 30), date(2025, 9, 17), date(2025, 10, 29), date(2025, 12, 10),
    # 2026
    date(2026, 1, 28), date(2026, 3, 18), date(2026, 4, 29), date(2026, 6, 17),
    date(2026, 7, 29), date(2026, 9, 16), date(2026, 10, 28), date(2026, 12, 9),
    # 2027
    date(2027, 1, 27), date(2027, 3, 17), date(2027, 4, 28), date(2027, 6, 9),
    date(2027, 7, 28), date(2027, 9, 15), date(2027, 10, 27), date(2027, 12, 8),
]
SAVED = Path(__file__).resolve().parent.parent / "docs" / "data" / "fomc.json"


def load_meetings() -> list[date]:
    """官網抓到的年份用官網的，其他年份用備用清單。"""
    try:
        fetched = [date.fromisoformat(x) for x in json.loads(SAVED.read_text())["meetings"]]
    except (OSError, ValueError, KeyError):
        fetched = []
    years = {d.year for d in fetched}
    return sorted(set(fetched) | {d for d in FALLBACK if d.year not in years})


MEETINGS = load_meetings()
