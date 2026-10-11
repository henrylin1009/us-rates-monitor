"""SR3（三個月 SOFR 期貨）延伸 Fed 路徑。

- SR3 合約 = 從 IMM 日（該月第三個星期三）到三個月後 IMM 日這段期間的 SOFR 複利平均；利率 = 100 − 價格
- ZQ 只看得到約 15 個月：ZQ 路徑結束之後的部分用 SR3 接上
- SOFR 和 EFFR 不一樣（還有一點 convexity）：同一天、期間完全在 ZQ 路徑裡的 SR3 合約，
  和 ZQ 路徑在同一段期間的複利平均比，平均差多少 bp 就是 basis；接上去的 SR3 都減掉這個 basis
"""
from __future__ import annotations

from datetime import date, timedelta

IMM = {3: "H", 6: "M", 9: "U", 12: "Z"}


def imm_date(y: int, m: int) -> date:
    d = date(y, m, 15)
    return d + timedelta(days=(2 - d.weekday()) % 7)   # 第三個星期三 = 15 號以後第一個星期三


def contract_window(key: str) -> tuple[date, date]:
    """'2027-12' → (2027-12-15, 2028-03-15)"""
    y, m = int(key[:4]), int(key[5:])
    y2, m2 = (y + 1, m - 9) if m > 9 else (y, m + 3)
    return imm_date(y, m), imm_date(y2, m2)


def sr3_contracts(today: date, n: int = 21) -> list[tuple[str, str]]:
    """今天還在交易的季月合約起算 n 個（約五年）：[('2026-09', 'SR3U26.CME'), ...]"""
    y, m = today.year, (today.month - 1) // 3 * 3
    if m == 0:
        y, m = y - 1, 12
    while contract_window(f"{y:04d}-{m:02d}")[1] <= today:  # 已經到期的跳過
        y, m = (y + 1, 3) if m == 12 else (y, m + 3)
    out = []
    for _ in range(n):
        out.append((f"{y:04d}-{m:02d}", f"SR3{IMM[m]}{y % 100:02d}.CME"))
        y, m = (y + 1, 3) if m == 12 else (y, m + 3)
    return out


def zq_avg(asof: date, effr: float, steps: list[tuple[date, float]], start: date, end: date) -> float:
    """ZQ 路徑（會議隔天換成會後利率）在 [start, end) 的日複利平均（%，act/360）"""
    c, d = 1.0, start
    while d < end:
        r = effr
        for m, post in steps:
            if d > m:
                r = post
        c *= 1 + r / 36000
        d += timedelta(days=1)
    return (c - 1) * 36000 / (end - start).days


def splice(asof: date, effr: float, steps: list[tuple[date, float]], prices: dict[str, float]) -> list[dict]:
    """steps = [(會議日, 會後利率), ...]（ZQ 路徑）；prices = {'2027-12': 95.24, ...}
    回傳 ZQ 路徑結束後的 SR3 段（含 basis 調整），沒有可以重疊比對的合約就回傳 []。"""
    if not steps:
        return []
    last = steps[-1][0]
    diffs = []
    for k, p in prices.items():
        s, e = contract_window(k)
        if s > asof and e <= last + timedelta(days=10):  # 整段都在 ZQ 路徑裡（最後一次會議後幾天內也算）
            diffs.append(100 - p - zq_avg(asof, effr, steps, s, e))
    if not diffs:
        return []
    basis = sum(diffs) / len(diffs)
    out = []
    for k in sorted(prices):
        s, e = contract_window(k)
        if s >= last:
            sofr = 100 - prices[k]
            out.append({"contract": k, "start": s.isoformat(), "end": e.isoformat(), "sofr": round(sofr, 4),
                        "basis_bp": round(basis * 100, 1), "rate": round(sofr - basis, 4)})
    return out
