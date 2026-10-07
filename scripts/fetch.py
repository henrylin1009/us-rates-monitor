"""抓資料、算 Fed 定價，寫進 docs/data/*.csv。

每天：python3 scripts/fetch.py
第一次（補歷史）：python3 scripts/fetch.py --backfill
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

import fomc
from calendars import update_calendars
from fedpricing import implied_month_rate, price_path
from macro import update_macro
from surprise import update_surprise
from fomc import MEETINGS

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "docs" / "data"
DATA.mkdir(parents=True, exist_ok=True)

UA = {"User-Agent": "us-rates-monitor (personal study project)"}
TENORS = {"1 Mo": "1m", "2 Mo": "2m", "3 Mo": "3m", "4 Mo": "4m", "6 Mo": "6m", "1 Yr": "1y", "2 Yr": "2y",
          "3 Yr": "3y", "5 Yr": "5y", "7 Yr": "7y", "10 Yr": "10y", "20 Yr": "20y", "30 Yr": "30y"}
YIELD_COLS = ["date"] + list(TENORS.values())
MONTH_CODES = "FGHJKMNQUVXZ"
BACKFILL_FROM_YEAR = 2015


# ---------- CSV 小工具 ----------

def read_csv(name: str) -> list[dict]:
    p = DATA / name
    if not p.exists():
        return []
    with p.open(newline="") as f:
        return list(csv.DictReader(f))


def write_csv(name: str, rows: list[dict], cols: list[str]) -> None:
    with (DATA / name).open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def merge(old: list[dict], new: list[dict], key) -> list[dict]:
    d = {key(r): r for r in old}
    d.update({key(r): r for r in new})
    return [d[k] for k in sorted(d)]


def get(url: str, **kw) -> requests.Response:
    for i in range(3):
        try:
            r = requests.get(url, headers=UA, timeout=30, **kw)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            if i == 2:
                raise
            print(f"  重試 {url}: {e}")
            time.sleep(3)


# ---------- 1. 美國財政部殖利率曲線 ----------

def fetch_treasury_year(year: int) -> list[dict]:
    url = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
           f"daily-treasury-rates.csv/{year}/all?type=daily_treasury_yield_curve"
           f"&field_tdr_date_value={year}&page&_format=csv")
    rows = []
    for r in csv.DictReader(io.StringIO(get(url).text)):
        d = datetime.strptime(r["Date"], "%m/%d/%Y").date().isoformat()
        row = {"date": d}
        for src, dst in TENORS.items():
            v = (r.get(src) or "").strip()
            row[dst] = v
        rows.append(row)
    return rows


def update_yields(backfill: bool) -> None:
    today = date.today()
    years = range(BACKFILL_FROM_YEAR, today.year + 1) if backfill else sorted({today.year, (today - timedelta(days=10)).year})
    new = []
    for y in years:
        print(f"財政部殖利率 {y} …")
        new += fetch_treasury_year(y)
    rows = merge(read_csv("yields.csv"), new, key=lambda r: r["date"])
    write_csv("yields.csv", rows, YIELD_COLS)
    print(f"  yields.csv：{len(rows)} 天，最新 {rows[-1]['date']}")


# ---------- 2. 紐約 Fed EFFR ----------

def update_effr(backfill: bool) -> None:
    base = "https://markets.newyorkfed.org/api/rates/unsecured/effr"
    if backfill:
        url = f"{base}/search.json?startDate={BACKFILL_FROM_YEAR}-01-01&endDate={date.today().isoformat()}"
    else:
        url = f"{base}/last/15.json"
    print("EFFR …")
    new = [{"date": r["effectiveDate"], "effr": r["percentRate"],
            "target_low": r.get("targetRateFrom", ""), "target_high": r.get("targetRateTo", "")}
           for r in get(url).json()["refRates"]]
    rows = merge(read_csv("effr.csv"), new, key=lambda r: r["date"])
    write_csv("effr.csv", rows, ["date", "effr", "target_low", "target_high"])
    print(f"  effr.csv：最新 {rows[-1]['date']} = {rows[-1]['effr']}%")


# ---------- 3. ZQ 期貨（Yahoo Finance，非官方） ----------

def zq_contracts(n_months: int = 20, back: int = 0) -> list[tuple[str, str]]:
    """從 back 個月前到未來 n_months 個月的合約。已到期的合約 Yahoo 不一定還有。"""
    today = date.today()
    y, m = divmod(today.year * 12 + today.month - 1 - back, 12)
    m += 1
    n_months += back
    out = []
    for _ in range(n_months):
        out.append((f"{y:04d}-{m:02d}", f"ZQ{MONTH_CODES[m - 1]}{y % 100:02d}.CBT"))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def update_zq(backfill: bool) -> None:
    import yfinance as yf
    period = "1y" if backfill else "10d"
    new = []
    for key, ticker in zq_contracts(back=12 if backfill else 0):
        try:
            h = yf.Ticker(ticker).history(period=period, interval="1d", auto_adjust=False)
        except Exception as e:  # noqa: BLE001
            print(f"  {ticker} 失敗：{e}")
            continue
        if h is None or h.empty:
            print(f"  {ticker}：沒有資料")
            continue
        for ts, r in h.iterrows():
            px = float(r["Close"])
            if px > 0:
                new.append({"date": ts.date().isoformat(), "contract": key, "price": f"{px:.4f}"})
        print(f"  {ticker}：{len(h)} 筆，最新 {h['Close'].iloc[-1]:.3f}")
        time.sleep(0.5)
    if not new:
        print("⚠ ZQ 全部抓不到（可能被 Yahoo 擋），這次跳過 Fed 定價")
        return
    rows = merge(read_csv("zq.csv"), new, key=lambda r: (r["date"], r["contract"]))
    write_csv("zq.csv", rows, ["date", "contract", "price"])


# ---------- 4. 算每一天的 Fed 定價 ----------

def add_months(d: date, k: int) -> str:
    y, m = divmod(d.month - 1 + k, 12)
    return f"{d.year + y:04d}-{m + 1:02d}"


def compute_pricing() -> None:
    effr = [(date.fromisoformat(r["date"]), float(r["effr"])) for r in read_csv("effr.csv")]
    if not effr:
        return
    by_day: dict[str, dict[str, float]] = {}
    for r in read_csv("zq.csv"):
        by_day.setdefault(r["date"], {})[r["contract"]] = float(r["price"])

    path_rows, summ_rows = [], []
    for ds in sorted(by_day):
        asof = date.fromisoformat(ds)
        prices = by_day[ds]
        past = [(d, v) for d, v in effr if d <= asof]
        if not past:
            continue
        e_date, e = past[-1]
        # EFFR 隔天才公布：如果 EFFR 日期到 asof 之間開過 FOMC，這個 EFFR 還沒反映決議
        # → 改用會議後第一個 EFFR；還沒公布（當天就是會議日）就先跳過，明天重算會補上
        decided = [m for m in MEETINGS if e_date <= m <= asof]
        if decided:
            after = [v for d, v in effr if d > decided[-1]]
            if not after:
                continue
            e = after[0]
        path = price_path(asof, e, prices, MEETINGS)
        if not path:
            continue
        for p in path:
            path_rows.append({"asof": ds, "meeting": p.meeting.isoformat(), "pre": p.pre, "post": p.post,
                              "move_bp": p.move_bp, "cum_bp": p.cum_bp, "p_hike": p.p_hike, "p_hold": p.p_hold,
                              "p_cut": p.p_cut, "lo_bp": p.lo_bp, "p_lo": p.p_lo, "hi_bp": p.hi_bp, "p_hi": p.p_hi})
        # 到年底：今年最後一次會議；如果今年已經沒有會議，就看明年底
        ye = [p for p in path if p.meeting.year == asof.year] or [p for p in path if p.meeting.year == asof.year + 1]
        r6, r12 = implied_month_rate(prices, add_months(asof, 6)), implied_month_rate(prices, add_months(asof, 12))
        summ_rows.append({
            "asof": ds, "effr": e,
            "next_meeting": path[0].meeting.isoformat(), "next_move_bp": path[0].move_bp,
            "next_p_hike": path[0].p_hike, "next_p_cut": path[0].p_cut,
            "yearend_meeting": ye[-1].meeting.isoformat() if ye else "",
            "cum_yearend_bp": ye[-1].cum_bp if ye else "",
            "implied_6m": "" if r6 is None else round(r6, 4),
            "cum_6m_bp": "" if r6 is None else round((r6 - e) * 100, 1),
            "implied_12m": "" if r12 is None else round(r12, 4),
            "cum_12m_bp": "" if r12 is None else round((r12 - e) * 100, 1),
        })
    write_csv("fed_path.csv", path_rows, ["asof", "meeting", "pre", "post", "move_bp", "cum_bp", "p_hike",
                                          "p_hold", "p_cut", "lo_bp", "p_lo", "hi_bp", "p_hi"])
    write_csv("fed_summary.csv", summ_rows, ["asof", "effr", "next_meeting", "next_move_bp", "next_p_hike",
                                             "next_p_cut", "yearend_meeting", "cum_yearend_bp", "implied_6m",
                                             "cum_6m_bp", "implied_12m", "cum_12m_bp"])
    if summ_rows:
        s = summ_rows[-1]
        print(f"Fed 定價（{s['asof']}）：下次會議 {s['next_meeting']} 隱含 {s['next_move_bp']:+}bp，"
              f"到年底累積 {s['cum_yearend_bp']}bp，12 個月後 {s['cum_12m_bp']}bp")


def write_meta() -> None:
    (DATA / "meta.json").write_text(
        '{"updated": "%s", "meetings": [%s]}\n'
        % (datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), ", ".join(f'"{m.isoformat()}"' for m in MEETINGS)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backfill", action="store_true", help="第一次執行：補齊歷史資料")
    args = ap.parse_args()
    global MEETINGS
    try:
        update_calendars(get)  # 先更新 FOMC 日期，下面算 Fed 定價才會用到最新的
    except Exception as e:  # noqa: BLE001
        print(f"✗ update_calendars 失敗：{e}")
    MEETINGS = fomc.load_meetings()
    errors = 0
    for step in (update_yields, update_effr, update_zq):
        try:
            step(args.backfill)
        except Exception as e:  # noqa: BLE001  一個來源壞掉不要拖垮全部
            errors += 1
            print(f"✗ {step.__name__} 失敗：{e}")
    compute_pricing()
    try:
        update_macro(get, read_csv, write_csv)
    except Exception as e:  # noqa: BLE001
        print(f"✗ update_macro 失敗：{e}")
    try:
        update_surprise(get, read_csv, write_csv)
    except Exception as e:  # noqa: BLE001
        print(f"✗ update_surprise 失敗：{e}")
    write_meta()
    return 1 if errors == 3 else 0


if __name__ == "__main__":
    sys.exit(main())
