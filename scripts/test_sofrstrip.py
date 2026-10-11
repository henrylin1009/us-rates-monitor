"""用 2026/10/9 的實際價格驗證 SR3 接法。執行：python3 scripts/test_sofrstrip.py"""
from datetime import date

from sofrstrip import contract_window, splice, sr3_contracts

assert contract_window("2027-12") == (date(2027, 12, 15), date(2028, 3, 15))
assert contract_window("2026-09") == (date(2026, 9, 16), date(2026, 12, 16))
c = sr3_contracts(date(2026, 10, 9))
assert c[0] == ("2026-09", "SR3U26.CME") and c[1] == ("2026-12", "SR3Z26.CME"), c[:2]
assert sr3_contracts(date(2026, 12, 17))[0][0] == "2026-12"

# 2026/10/9 的 ZQ 路徑（fed_path.csv）
STEPS = [(date(2026, 10, 28), 3.925), (date(2026, 12, 9), 4.1293), (date(2027, 1, 27), 4.23),
         (date(2027, 3, 17), 4.3961), (date(2027, 4, 28), 4.5), (date(2027, 6, 9), 4.6), (date(2027, 7, 28), 4.64),
         (date(2027, 9, 15), 4.69), (date(2027, 10, 27), 4.69), (date(2027, 12, 8), 4.69)]
PRICES = {"2026-09": 96.0575, "2026-12": 95.77, "2027-03": 95.495, "2027-06": 95.325, "2027-09": 95.255,
          "2027-12": 95.24, "2028-03": 95.23, "2028-12": 95.235, "2029-12": 95.26}
out = splice(date(2026, 10, 9), 3.88, STEPS, PRICES)
assert [r["contract"] for r in out] == ["2027-12", "2028-03", "2028-12", "2029-12"], out
b = out[0]["basis_bp"]
assert 2 < b < 3.5, b                                   # Z26/H27/M27/U27 都比 ZQ 高 2.5bp 左右
assert abs(out[0]["rate"] - (4.76 - b / 100)) < 1e-3
assert splice(date(2026, 10, 9), 3.88, [], PRICES) == []
for r in out:
    print(r)
print("OK：SR3 接法")
