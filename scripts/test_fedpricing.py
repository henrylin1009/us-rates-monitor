"""用 2026/10/5 的基準數字驗證算法（計劃檔裡的數字）。

執行：python3 scripts/test_fedpricing.py
"""
from datetime import date

from fedpricing import price_path
from fomc import MEETINGS

PRICES = {"2026-10": 96.118, "2026-11": 96.065, "2026-12": 95.915, "2027-01": 95.840, "2027-06": 95.470}
EFFR = 3.88

path = price_path(date(2026, 10, 5), EFFR, PRICES, MEETINGS)
oct_, dec_ = path[0], path[1]

assert oct_.meeting == date(2026, 10, 28)
assert abs(oct_.p_hike - 0.22) < 0.01, oct_            # 10/28 升息約 22%
assert abs(dec_.p_hike - 0.85) < 0.02, dec_            # 12/9 升息約 85%
assert abs(dec_.cum_bp - 27) < 1, dec_                 # 年底前累積約 +27bp
assert abs((100 - PRICES["2027-06"] - EFFR) * 100 - 65) < 1  # 到 2027 年中約 +65bp

for p in path:
    print(p.meeting, f"post={p.post:.3f}", f"move={p.move_bp:+.1f}bp", f"cum={p.cum_bp:+.1f}bp",
          f"hike={p.p_hike:.0%} hold={p.p_hold:.0%} cut={p.p_cut:.0%}")
print("OK：和 10/5 基準一致")
