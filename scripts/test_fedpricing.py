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

# partial_path：前面的合約不見時從第一個接得上的會議開始。有完整資料時，結果要和 price_path 一樣
from fedpricing import partial_path

part = partial_path(date(2026, 10, 5), EFFR, PRICES, MEETINGS)
assert [p.meeting for p in part] == [p.meeting for p in path], part
for a, b in zip(part, path):
    assert abs(a.post - b.post) < 1e-6 and abs(a.cum_bp - b.cum_bp) < 0.11, (a, b)
# 10 月合約到期了（拿掉）：10/28 接不上，從 12/9 開始，cum 還是相對當天 EFFR
P2 = {k: v for k, v in PRICES.items() if k != "2026-10"}   # 11 月沒有會議 → 12/9 的會前利率 = 100 − 11 月
part2 = partial_path(date(2026, 10, 5), EFFR, P2, MEETINGS)
assert part2[0].meeting == date(2026, 12, 9), part2
assert abs(part2[0].cum_bp - dec_.cum_bp) < 0.5, (part2[0], dec_)
print("OK：partial_path 和完整路徑一致")
