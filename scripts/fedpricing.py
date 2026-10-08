"""用 ZQ（30 天聯邦基金期貨）自己算 FedWatch。

規則（和計劃檔一致）：
- ZQ 價格 = 100 − 該月平均聯邦基金利率
- 會議月份：月平均 =（會議前天數 × 舊利率 + 會議後天數 × 新利率）÷ 當月天數，解出新利率
- 會議後剩不到 7 天：改用下個月合約（整個月都是會議後利率）
- 多次會議用接力：上一次會議後的利率是下一次的起點
- 累積定價 = 會議後利率 − 現在 EFFR
"""
from __future__ import annotations

import calendar
import math
from dataclasses import dataclass
from datetime import date, timedelta

STEP = 0.25  # 一碼


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def next_month_key(d: date) -> str:
    y, m = (d.year + 1, 1) if d.month == 12 else (d.year, d.month + 1)
    return f"{y:04d}-{m:02d}"


@dataclass
class MeetingPricing:
    meeting: date
    pre: float        # 會議前利率（%）
    post: float       # 會議後隱含利率（%）
    move_bp: float    # 這次會議隱含變動（bp）
    cum_bp: float     # 相對現在 EFFR 的累積變動（bp）
    p_hike: float
    p_hold: float
    p_cut: float
    lo_bp: int        # 兩點分佈：較小那一檔（bp）
    p_lo: float
    hi_bp: int        # 較大那一檔（bp）
    p_hi: float


def two_point(move: float):
    """把隱含變動拆成最接近的兩檔 25bp 結果（FedWatch 的標準做法）。"""
    steps = move / STEP
    lo = math.floor(steps + 1e-9)
    frac = steps - lo
    if frac < 1e-9:
        frac = 0.0
    lo_bp, hi_bp = int(lo * 25), int((lo + 1) * 25)
    p_lo, p_hi = 1 - frac, frac
    p_hike = p_cut = p_hold = 0.0
    for bp, p in ((lo_bp, p_lo), (hi_bp, p_hi)):
        if bp > 0:
            p_hike += p
        elif bp < 0:
            p_cut += p
        else:
            p_hold += p
    return lo_bp, p_lo, hi_bp, p_hi, p_hike, p_hold, p_cut


def price_path(asof: date, effr: float, prices: dict[str, float], meetings: list[date]) -> list[MeetingPricing]:
    """asof 當天的價格 → 之後每次 FOMC 的隱含利率與機率。

    prices: {"2026-10": 96.118, ...}
    """
    meeting_months = {month_key(m) for m in meetings}
    out: list[MeetingPricing] = []
    pre = effr
    for m in sorted(x for x in meetings if x > asof):
        mk, nk = month_key(m), next_month_key(m)
        n = calendar.monthrange(m.year, m.month)[1]
        d = m.day                 # 決議隔天生效 → 會議前 d 天、會議後 n − d 天
        after = n - d
        if after < 7 and nk in prices and nk not in meeting_months:
            post = 100 - prices[nk]
        elif mk in prices:
            avg = 100 - prices[mk]
            post = (avg * n - pre * d) / after
        else:
            break                 # 沒有合約價格，後面就不算了
        move = post - pre
        lo_bp, p_lo, hi_bp, p_hi, p_hike, p_hold, p_cut = two_point(move)
        out.append(MeetingPricing(
            meeting=m, pre=round(pre, 4), post=round(post, 4),
            move_bp=round(move * 100, 1), cum_bp=round((post - effr) * 100, 1),
            p_hike=round(p_hike, 4), p_hold=round(p_hold, 4), p_cut=round(p_cut, 4),
            lo_bp=lo_bp, p_lo=round(p_lo, 4), hi_bp=hi_bp, p_hi=round(p_hi, 4),
        ))
        pre = post
    return out


def partial_path(asof: date, effr: float, prices: dict[str, float], meetings: list[date]) -> list[MeetingPricing]:
    """前面幾次會議的合約已到期（Yahoo 沒有）時，從第一個算得出來的會議開始接。

    會前利率：上個月沒有會議就直接用上個月合約；不然用「下個月沒有會議 → 會後利率 = 100 − 下個月」
    配 m 的月平均倒推 pre = (avg·n − post·(n − d)) / d。之後照 price_path 往下接。
    cum_bp 還是相對 asof 當天的 EFFR，所以和完整的路徑可以直接比。
    """
    meeting_months = {month_key(m) for m in meetings}
    for m in sorted(x for x in meetings if x > asof):
        mk, nk = month_key(m), next_month_key(m)
        pk = f"{m.year - (m.month == 1):04d}-{(m.month - 2) % 12 + 1:02d}"
        if pk in prices and pk not in meeting_months:
            pre = 100 - prices[pk]          # 上個月沒有會議 → 整個月都是會前利率
        elif mk in prices and nk in prices and nk not in meeting_months:
            n, d = calendar.monthrange(m.year, m.month)[1], m.day
            post = 100 - prices[nk]
            pre = ((100 - prices[mk]) * n - post * (n - d)) / d
        else:
            continue
        path = price_path(m - timedelta(days=1), pre, prices, [x for x in meetings if x >= m])
        if not path:
            continue
        for p in path:
            p.cum_bp = round((p.post - effr) * 100, 1)
        return path
    return []


def implied_month_rate(prices: dict[str, float], key: str):
    return None if key not in prices else 100 - prices[key]
