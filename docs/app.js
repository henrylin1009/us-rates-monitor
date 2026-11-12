/* US Rates Monitor — 讀 data/*.csv，畫兩張圖 */
(() => {
  "use strict";

  const TENORS = ["1m", "2m", "3m", "4m", "6m", "1y", "2y", "3y", "5y", "7y", "10y", "20y", "30y"];
  const RANGES = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "2Y": 731, "5Y": 1827, "All": 1e6 };
  const D = { yields: [], effr: [], path: [], summ: [], meta: {}, events: [], macro: [], claims: [], be: [], sep: [], rel: [], con: [], conManual: [] };
  const S = {
    page: "overview", yView: "curve", fView: "priced", iView: "yoy", infIdx: "cpi", jView: "nfp", dRange: "1Y", fomcRange: "2Y", fomcView: "past", sIn: "core_cpi_mm", sJob: "nfp",
    tenors: ["2y", "10y", "30y"], range: "1Y",
    curveBack: 7,
    spreads: ["2s10s", "5s30s"], trendFed: [],
    events: ["fomc", "cpi", "nfp"], reactSort: "recent",
    pathBack: 7, pathHz: "2Y", gdpView: "growth", pricedCmp: ["1W"], fundView: "repo", crView: "carry", crHz: "3M", fundRange: "1Y", dView: "be", auctTerm: "10y", histMeeting: null, calAll: false, folds: {},
  };

  // ---------- 小工具 ----------
  const $ = (s) => document.querySelector(s);
  // 標題列的資料日期那行會被截成一行（…），內容一變就把全文放進 title，滑過可看
  const dlineTitles = new MutationObserver((ms) => ms.forEach((m) => { const el = m.target.closest ? m.target.closest(".dline") : m.target.parentElement.closest(".dline"); if (el) el.title = el.textContent.trim(); }));
  document.querySelectorAll(".panel-head .dline").forEach((el) => dlineTitles.observe(el, { childList: true, subtree: true, characterData: true }));
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
  const rgba = (hex, a) => { const h = hex.replace("#", ""); const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h, 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  const num = (x) => (x === "" || x == null ? null : +x);
  const bp = (x, d = 0) => { if (x == null || isNaN(x)) return "–"; const r = +x.toFixed(d); return (r > 0 ? "+" : "") + (r === 0 ? 0 : r).toFixed(d); };
  // 表格預設收起來，點 summary 才展開；開關狀態記在 S.folds，重畫時保留
  const fold = (key, label, html) => `<details class="fold" data-fold="${key}"${S.folds[key] ? " open" : ""}><summary>${label}</summary>${html}</details>`;
  const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
  // bp 換成「幾次一碼」：desk 習慣講 "1.3 hikes priced"
  const moves = (b) => { if (b == null || isNaN(b)) return "–"; const n = b / 25; return Math.abs(n) < 0.005 ? "no change" : `${Math.abs(n).toFixed(2)} ${n > 0 ? "hikes" : "cuts"}`; };
  const fmtD = (s) => s; // ISO
  const shiftDays = (iso, k) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const cmpDays = { "1D": 1, "1W": 7, "1M": 30, "3M": 91, "1Y": 365 };
  const cmpLabel = { "1D": "1 day ago", "1W": "1 week ago", "1M": "1 month ago", "3M": "3 months ago", "1Y": "1 year ago" };

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const cols = lines[0].split(",");
    return lines.slice(1).map((l) => { const v = l.split(","); const o = {}; cols.forEach((c, i) => (o[c] = v[i] ?? "")); return o; });
  }
  async function load(name) {
    try { const r = await fetch("data/" + name, { cache: "no-cache" }); if (!r.ok) return []; return parseCSV(await r.text()); }
    catch { return []; }
  }
  // 找 ≤ 某日的最後一筆
  function atOrBefore(rows, key, iso) {
    let lo = 0, hi = rows.length - 1, ans = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m][key] <= iso) { ans = rows[m]; lo = m + 1; } else hi = m - 1; }
    return ans;
  }
  const inRange = (rows, key, r) => { if (!rows.length) return rows; const end = rows[rows.length - 1][key]; const start = shiftDays(end, -RANGES[r]); return rows.filter((x) => x[key] >= start); };

  function baseLayout(extra = {}) {
    const ink = css("--ink"), muted = css("--muted"), grid = css("--grid");
    return Object.assign({
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      font: { family: 'Inter, "Noto Sans TC", system-ui, sans-serif', size: 12, color: ink },
      margin: { l: 52, r: 16, t: 10, b: 40 },
      hovermode: "x unified",
      hoverlabel: { bgcolor: css("--surface"), bordercolor: css("--line"), font: { color: ink, family: "IBM Plex Mono, monospace", size: 12 } },
      legend: { orientation: "h", y: 1.08, x: 0, font: { color: muted, size: 12 }, bgcolor: "rgba(0,0,0,0)" },
      xaxis: { gridcolor: grid, linecolor: grid, zeroline: false, tickfont: { color: muted } },
      yaxis: { gridcolor: grid, linecolor: grid, zeroline: false, tickfont: { color: muted, family: "IBM Plex Mono, monospace" } },
    }, extra);
  }
  const palette = () => ["--s1", "--s2", "--s3", "--s4", "--s5"].map(css);
  const CFG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d", "toggleSpikelines"] };
  // Plotly 2.35 的 hovertemplate 吃不下 "+.2f" 這種帶正號的格式，會直接印出完整小數 → 一律改成 ".2f"
  // 沒寫 hovertemplate 的線，hover 也預設到小數兩位（日期 / 類別軸不動）
  const fixFmt = (t) => (typeof t === "string" ? t.replace(/%\{([^}:]+):\+([^}]*)\}/g, "%{$1:$2}") : t);
  // Henry：圖一律畫 unrounded，hover 的百分比（% 和 pt）統一到小數三位；機率 / 標售比例這類不是「數據」的，trace 設 keepFmt 不動
  const fmt3 = (t) => (typeof t === "string" ? t.replace(/%\{([^}:]+):\.[0-2]f\}(%|pt)/g, "%{$1:.3f}$2") : t);
  function plot(id, traces, layout) {
    traces.forEach((t) => { if (t) { t.hovertemplate = t.keepFmt ? fixFmt(t.hovertemplate) : fmt3(fixFmt(t.hovertemplate)); t.texttemplate = fixFmt(t.texttemplate); delete t.keepFmt; } });
    // x 軸多半是日期但沒寫 type：設了 hoverformat 會在 hover 標題印出「.2f」→ x 軸只在數字軸（有 ticksuffix）才設
    Object.keys(layout).filter((k) => /^yaxis\d*$/.test(k) || (/^xaxis\d*$/.test(k) && layout[k] && layout[k].ticksuffix)).forEach((k) => { const a = layout[k]; if (a && !a.hoverformat && !["date", "category"].includes(a.type)) a.hoverformat = /%|pt/.test(a.ticksuffix || "") ? ".3f" : ".2f"; });
    Plotly.react(id, traces, layout, CFG);
  }
  function empty(id, msg) { Plotly.purge(id); $("#" + id).innerHTML = `<div class="empty">${msg}</div>`; }
  function clearEmpty(id) { const e = $("#" + id).querySelector(".empty"); if (e) e.remove(); }

  // ---------- 控制項 ----------
  function chips(label, opts, selected, multi, onChange) {
    const wrap = document.createElement("div");
    wrap.className = "chips";
    if (label) { const s = document.createElement("span"); s.textContent = label; s.style.marginRight = "4px"; s.style.alignSelf = "center"; wrap.appendChild(s); }
    opts.forEach(([v, t]) => {
      const b = document.createElement("button");
      b.textContent = t; b.dataset.v = v;
      const on = multi ? selected.includes(v) : selected === v;
      if (on) b.classList.add("on");
      b.onclick = () => {
        if (multi) { const i = selected.indexOf(v); i >= 0 ? selected.splice(i, 1) : selected.push(v); onChange(selected); }
        else onChange(v);
      };
      wrap.appendChild(b);
    });
    return wrap;
  }
  const rangeChips = (key, after) => chips("Range", Object.keys(RANGES).map((r) => [r, r]), S[key], false, (v) => { S[key] = v; after(); });

  // ---------- 重要事件 ----------
  const EVT = {
    fomc: { glyph: "◆", name: "FOMC", symbol: "diamond" },
    cpi: { glyph: "●", name: "CPI", symbol: "circle" },
    nfp: { glyph: "■", name: "NFP", symbol: "square" },
    pce: { glyph: "▲", name: "PCE", symbol: "triangle-up" },
    ppi: { glyph: "▼", name: "PPI", symbol: "triangle-down" },
    minutes: { glyph: "★", name: "Minutes", symbol: "star" },
    // 下面這些只在行事曆和 Next 2 weeks 出現，圖上的事件記號仍然只有上面六種
    retail: { glyph: "◆", name: "Retail sales", tier: 1 }, ism_m: { glyph: "◇", name: "ISM mfg", tier: 1 }, ism_s: { glyph: "◇", name: "ISM services", tier: 1 },
    gdp: { glyph: "◆", name: "GDP", tier: 1 }, jolts: { glyph: "■", name: "JOLTS" }, eci: { glyph: "■", name: "ECI" }, umich: { glyph: "○", name: "UMich" },
    ip: { glyph: "◇", name: "Industrial production" }, chair: { glyph: "✦", name: "Fed Chair", tier: 1 }, beige: { glyph: "☆", name: "Beige Book" },
    auction: { glyph: "▣", name: "Auction" }, blackout: { glyph: "◌", name: "Blackout" },
  };
  const EVT_ORDER = ["fomc", "cpi", "nfp", "pce", "ppi", "minutes"];
  const LOOKAHEAD = 14; // 往後標幾天
  const evtColor = (t) => ({ fomc: css("--ink"), cpi: css("--s4"), nfp: css("--s5"), pce: css("--s3"), ppi: css("--s2"), minutes: css("--muted"),
    retail: css("--s1"), gdp: css("--s1"), ism_m: css("--s1"), ism_s: css("--s1"), ip: css("--s1"), jolts: css("--s5"), eci: css("--s5"), umich: css("--s3"),
    chair: css("--ink"), beige: css("--muted"), auction: css("--s2"), blackout: css("--muted") }[t] || css("--muted"));
  // 一級數據（desk 的 ECO 上標成最重要的）在行事曆粗體
  const TOP = new Set(["fomc", "cpi", "nfp", "pce", "retail", "gdp", "ism_m", "ism_s", "chair"]);
  const lastYieldDate = () => (D.yields.length ? D.yields[D.yields.length - 1].date : "");

  // FOMC 決議：用 EFFR 目標區間上緣的變化判斷
  function fomcDecision(date) {
    const before = atOrBefore(D.effr, "date", date);
    const after = D.effr.find((r) => r.date > date);
    if (!before || !after || before.target_high === "" || after.target_high === "") return null;
    const d = Math.round((num(after.target_high) - num(before.target_high)) * 100);
    return d > 0 ? `hike ${d}bp` : d < 0 ? `cut ${-d}bp` : "hold";
  }
  // 事件當天市場反應：和前一個交易日比
  const yIdx = {};
  function reaction(date) {
    const i = yIdx[date];
    if (i == null || i === 0) return null;
    const a = D.yields[i], b = D.yields[i - 1];
    const d = (t) => (num(a[t]) == null || num(b[t]) == null ? null : (num(a[t]) - num(b[t])) * 100);
    const d2 = d("2y"), d10 = d("10y");
    const r = { d2, d10, d30: d("30y"), curve: d2 == null || d10 == null ? null : d10 - d2, regime: d2 == null || d10 == null ? "" : regime(d2, d10), fed: null };
    const k = D.summ.findIndex((x) => x.asof === date);
    if (k > 0 && D.summ[k].cum_yearend_bp !== "" && D.summ[k - 1].cum_yearend_bp !== "") r.fed = num(D.summ[k].cum_yearend_bp) - num(D.summ[k - 1].cum_yearend_bp);
    return r;
  }
  function evtHover(e) {
    let h = `<b>${e.label}</b>  ${e.date}`;
    if (e.type === "fomc") { const dec = fomcDecision(e.date); if (dec) h += ` · ${dec}`; }
    const r = reaction(e.date);
    if (r) {
      h += `<br>2y ${bp(r.d2, 1)}bp · 10y ${bp(r.d10, 1)}bp · 2s10s ${bp(r.curve, 1)}bp`;
      if (r.regime) h += `<br>${r.regime}`;
      if (r.fed != null) h += ` · year-end pricing ${bp(r.fed, 1)}bp`;
    } else if (e.date > lastYieldDate()) h += "<br>upcoming";
    return h;
  }
  const eventsOn = () => !["5Y", "All"].includes(S.range);
  // 把事件加進時間序列圖：底部一排記號 + 未來事件虛線
  function addEvents(traces, layout, start) {
    if (!eventsOn() || !D.events.length) return;
    const last = lastYieldDate(), horizon = shiftDays(last, LOOKAHEAD);
    const types = EVT_ORDER.filter((t) => S.events.includes(t));
    const shapes = layout.shapes || [], ann = layout.annotations || [];
    let hasFuture = false;
    types.forEach((t, k) => {
      const evs = D.events.filter((e) => e.type === t && e.date >= start && e.date <= horizon);
      if (!evs.length) return;
      const y = 0.03 + k * 0.045, c = evtColor(t);
      const colors = evs.map((e) => {
        if (t !== "fomc") return c;
        const dec = fomcDecision(e.date) || "";
        return dec.startsWith("hike") ? css("--up") : dec.startsWith("cut") ? css("--down") : c;
      });
      traces.push({
        x: evs.map((e) => e.date), y: evs.map(() => y), yaxis: "y2", type: "scatter", mode: "markers", name: EVT[t].name,
        marker: { symbol: evs.map((e) => EVT[t].symbol + (e.date > last ? "-open" : "")), size: 9, color: colors, line: { width: 1.5, color: colors } },
        text: evs.map(evtHover), hovertemplate: "%{text}<extra></extra>", showlegend: false,
      });
      evs.filter((e) => e.date > last).forEach((e) => {
        hasFuture = true;
        shapes.push({ type: "line", x0: e.date, x1: e.date, yref: "paper", y0: 0, y1: 1, line: { color: c, width: 1, dash: "dot" } });
        ann.push({ x: e.date, yref: "paper", y: 1, text: EVT[t].name + " " + e.date.slice(5).replace("-", "/"), showarrow: false, textangle: -90, xanchor: "right", yanchor: "top", font: { size: 10, color: c } });
      });
    });
    layout.yaxis2 = { overlaying: "y", range: [0, 1], visible: false, fixedrange: true };
    layout.shapes = shapes; layout.annotations = ann;
    if (hasFuture) {
      layout.xaxis = { ...layout.xaxis, range: [start, horizon] };
      shapes.push({ type: "rect", x0: last, x1: horizon, yref: "paper", y0: 0, y1: 1, fillcolor: css("--chip"), opacity: 0.5, line: { width: 0 }, layer: "below" });
    }
  }
  function eventChips(after) {
    const w = chips("Events", EVT_ORDER.map((t) => [t, EVT[t].glyph + " " + EVT[t].name]), S.events, true, after);
    if (!eventsOn()) { const n = document.createElement("span"); n.textContent = "(hidden for 5Y / All)"; n.style.alignSelf = "center"; w.appendChild(n); }
    return w;
  }
  // 最近事件反應表
  function renderReactions(el) {
    const last = lastYieldDate();
    let rows = D.events.filter((e) => S.events.includes(e.type) && e.date <= last).map((e) => ({ e, r: reaction(e.date) })).filter((x) => x.r);
    rows = rows.slice(-24);
    if (S.reactSort === "size") rows.sort((a, b) => Math.abs(b.r.d2 || 0) - Math.abs(a.r.d2 || 0));
    else rows.reverse();
    rows = rows.slice(0, 12);
    const next = D.events.filter((e) => S.events.includes(e.type) && e.date > last).slice(0, 3);
    const c = (x) => (x == null ? "" : x > 0.05 ? "up" : x < -0.05 ? "down" : "");
    let h = `<div class="react-head"><h3>Recent event reactions</h3><div class="chips">`
      + `<button data-s="recent" class="${S.reactSort === "recent" ? "on" : ""}">Latest</button>`
      + `<button data-s="size" class="${S.reactSort === "size" ? "on" : ""}">Largest 2y move</button></div></div>`;
    if (next.length) h += `<p class="hint">Next: ${next.map((e) => `<span class="badge">${e.date.slice(5).replace("-", "/")} ${e.label}</span>`).join(" ")}</p>`;
    if (!rows.length) { el.innerHTML = h + `<p class="hint">None of the selected events fall in this period yet.</p>`; }
    else {
      let t = "<table><thead><tr><th>Date</th><th>Event</th><th>2y</th><th>10y</th><th>30y</th><th>2s10s</th><th>Regime</th><th>Year-end pricing</th></tr></thead><tbody>";
      rows.forEach(({ e, r }) => {
        const lab = e.type === "fomc" ? `${e.label}${fomcDecision(e.date) ? ": " + fomcDecision(e.date) : ""}` : e.label;
        t += `<tr><td class="n">${e.date}</td><td>${lab}</td>`
          + [r.d2, r.d10, r.d30, r.curve].map((x) => `<td class="n ${c(x)}">${bp(x, 1)}</td>`).join("")
          + `<td>${r.regime}</td><td class="n ${c(r.fed)}">${r.fed == null ? "–" : bp(r.fed, 1)}</td></tr>`;
      });
      el.innerHTML = h + fold("react", `Show table (${rows.length} events)`, t + "</tbody></table>");
    }
    el.querySelectorAll("button[data-s]").forEach((b) => (b.onclick = () => { S.reactSort = b.dataset.s; renderReactions(el); }));
  }

  // ---------- 摘要 ----------
  function regime(d2, d10) {
    const slope = d10 - d2, level = (d2 + d10) / 2;
    if (Math.abs(slope) < 0.5) return level > 0 ? "Parallel up" : level < 0 ? "Parallel down" : "Unchanged";
    if (slope > 0) return level >= 0 ? "Bear steepening" : "Bull steepening";
    return level >= 0 ? "Bear flattening" : "Bull flattening";
  }
  // ---------- 首頁 Overview ----------
  const md = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const dow = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const cls = (x) => (x == null ? "" : x > 0.05 ? "up" : x < -0.05 ? "down" : "");
  const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);
  // 某天往前 k 天（≤ 那天的最後一筆）
  const ago = (k) => { const y = D.yields; return y.length ? atOrBefore(y, "date", shiftDays(y[y.length - 1].date, -k)) : null; };
  const chg = (a, b, t) => (a && b && num(a[t]) != null && num(b[t]) != null ? (num(a[t]) - num(b[t])) * 100 : null);
  const sprd = (r, x, y) => (r && num(r[x]) != null && num(r[y]) != null ? (num(r[y]) - num(r[x])) * 100 : null);

  // 接下來 2 週：每個事件一格，FOMC 那格放 priced bp
  // ---------- Overview：desk 早上的 morning sheet（昨天發生什麼、市場怎麼動、接下來看什麼）----------
  // 只留重要的事件（desk ECO 上的一級數據 + PPI）；其他的在 Calendar
  const OV_EVT = new Set([...TOP, "ppi"]);
  // 每種公布在 Overview 上看哪幾個數字
  const EVT_M = { cpi: [["core_cpi_mm", "Core m/m"], ["cpi_mm", "headline m/m"]], nfp: [["nfp", "payrolls"], ["unrate", "unemployment"]],
    pce: [["core_pce_mm", "Core m/m"]], ppi: [["core_ppi_mm", "Core m/m"]] };
  const EVT_PAGE = { cpi: "inflation", pce: "inflation", ppi: "inflation", nfp: "jobs", fomc: "rates", chair: "rates", retail: "growth", gdp: "growth", ism_m: "growth", ism_s: "growth" };
  const signed = (m, v) => (m === "nfp" && v > 0 ? "+" : "") + fmtU(m, v);
  function renderNext() {
    const el = $("#next"); if (!el) return;
    // 用瀏覽器的今天（資料是前一個交易日收盤，但「還有幾天」要從真正的今天算）
    const today = localToday(), horizon = shiftDays(today, LOOKAHEAD), all = D.events.filter((e) => e.date >= today && e.date <= horizon);
    let evs = all.filter((e) => OV_EVT.has(e.type));
    if (!evs.length) evs = D.events.filter((e) => e.date >= today && OV_EVT.has(e.type)).slice(0, 3);
    const A = asofs(), priced = new Map(A.length ? pathOn(A[A.length - 1]).map((r) => [r.meeting, r]) : []);
    const rows = evs.map((e) => {
      const n = daysBetween(today, e.date), r = e.type === "fomc" ? priced.get(e.date) : null;
      let x = "";
      if (r) x = `priced <b class="${cls(num(r.move_bp))}">${bp(num(r.move_bp), 1)}bp</b> · ${moves(num(r.move_bp))}`;
      else if (EVT_M[e.type]) x = EVT_M[e.type].map(([m, n]) => { const c = nextCon(m); return c && c.date === e.date ? `${n} <b>${signed(m, c.v)}</b>` : null; }).filter(Boolean).join(" · ");
      return `<div class="ov-it${TOP.has(e.type) ? " top" : ""}"><div class="ov-d">${dow(e.date)} ${md(e.date)}<span class="muted">${n === 0 ? "today" : `in ${n}d`}</span></div>`
        + `<div class="ov-l"><span style="color:${evtColor(e.type)}">${EVT[e.type].glyph}</span> ${e.label}</div><div class="ov-x">${x ? (r ? x : `expected ${x}`) : ""}</div></div>`;
    });
    const more = all.length - evs.length;
    el.innerHTML = (rows.length ? rows.join("") : `<p class="hint">No major events scheduled.</p>`)
      + (more > 0 ? `<p class="ov-more muted">+${more} smaller release${more === 1 ? "" : "s"} and Fed events on the Calendar ›</p>` : "");
  }
  // 最近兩週公布了什麼：數字 vs 預期 + 當天 2y 怎麼動（Henry：Overview 要先回答「昨天發生什麼」）
  function renderRecent() {
    const el = $("#ov-recent"); if (!el) return;
    const today = localToday(), from = shiftDays(today, -14), ly = lastYieldDate();
    const evs = D.events.filter((e) => OV_EVT.has(e.type) && e.date >= from && e.date <= ly).reverse().slice(0, 5);
    el.innerHTML = evs.length ? evs.map((e) => {
      const parts = [];
      if (e.type === "fomc") { const d = fomcDecision(e.date); if (d) parts.push(`<b>${d}</b>`); }
      (EVT_M[e.type] || []).forEach(([m, n]) => {
        const r = surRows(m).find((x) => x.date === e.date); if (!r) return;
        const d = r.forecast == null ? null : +(r.actual - r.forecast).toFixed(SM[m].dec);
        parts.push(`${n} <b>${signed(m, r.actual)}</b>` + (d == null ? "" : ` vs ${signed(m, r.forecast)} <span class="${dirCls(m, d)}">${d === 0 ? "in line" : dirWord(m, d)}</span>`));
      });
      const re = reaction(e.date);
      if (re && re.d2 != null) parts.push(`2y <b class="${cls(re.d2)}">${bp(re.d2, 0)}bp</b>`);
      return `<a class="ov-it" href="#${EVT_PAGE[e.type] || "calendar"}"><div class="ov-d">${dow(e.date)} ${md(e.date)}</div>`
        + `<div class="ov-l"><span style="color:${evtColor(e.type)}">${EVT[e.type].glyph}</span> ${e.label}</div><div class="ov-x">${parts.join(" · ")}</div></a>`;
    }).join("") : `<p class="hint">No major releases in the last two weeks.</p>`;
  }

  // 一句結論：最近一週 2y / 10y 怎麼動、曲線型態、年底前定價變了多少
  function ratesTakeaway() {
    const a = D.yields[D.yields.length - 1], w = ago(7);
    const d2 = chg(a, w, "2y"), d10 = chg(a, w, "10y");
    if (d2 == null || d10 == null) return { text: "", regime: "" };
    const dir = (x) => (Math.abs(x) < 0.5 ? "flat" : x > 0 ? `up ${Math.abs(x).toFixed(0)}bp` : `down ${Math.abs(x).toFixed(0)}bp`);
    const rg = regime(d2, d10);
    let t = `Over the past week the 2y is ${dir(d2)} and the 10y ${dir(d10)}: ${rg.toLowerCase()}.`;
    const f = D.summ[D.summ.length - 1], fA = f ? atOrBefore(D.summ, "asof", shiftDays(f.asof, -7)) : null;
    if (f && fA && fA !== f) {
      const df = num(f.cum_yearend_bp) - num(fA.cum_yearend_bp);
      if (Math.abs(df) >= 1) t += ` Year-end Fed pricing is ${df > 0 ? "more hawkish" : "more dovish"} by ${Math.abs(df).toFixed(0)}bp.`;
    }
    return { text: t, regime: rg };
  }

  // Rates 頁最上面的一句話：一週的曲線動向 + 年底前 Fed 定價
  function renderRatesTake() {
    const el = $("#rates-take"); if (!el || D.yields.length < 2) return;
    const f = D.summ[D.summ.length - 1];
    el.textContent = ratesTakeaway().text + (f && f.cum_yearend_bp !== "" ? ` Futures price ${bp(num(f.cum_yearend_bp), 0)}bp (${moves(num(f.cum_yearend_bp))}) by year-end.` : "");
  }

  // 3 個月小走勢線（SVG，不用 Plotly，四格才不會拖慢首頁）
  function spark(vals) {
    const v = vals.filter((x) => x != null && !isNaN(x)); if (v.length < 2) return "";
    const lo = Math.min(...v), hi = Math.max(...v), k = hi - lo || 1;
    const pts = v.map((x, i) => `${((i / (v.length - 1)) * 100).toFixed(2)},${(26 - ((x - lo) / k) * 24).toFixed(2)}`).join(" ");
    return `<svg class="ov-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" /></svg>`;
  }
  function renderHero() {
    const y = D.yields; if (y.length < 2) return;
    const a = y[y.length - 1], b = y[y.length - 2], w = ago(7), tk = ratesTakeaway();
    $("#hero-take").textContent = tk.text;
    $("#hero-regime").textContent = tk.regime ? `1W: ${tk.regime}` : "";
    $("#hero-regime").hidden = !tk.regime;
    const ef = D.effr.filter((r) => r.effr !== ""), e0 = ef[ef.length - 1];
    $("#hero-asof").innerHTML = `Treasury close ${dow(a.date)} ${md(a.date)}`
      + (e0 ? ` · EFFR ${num(e0.effr).toFixed(2)}%${e0.target_low !== "" ? ` (target ${(+e0.target_low).toFixed(2)}–${(+e0.target_high).toFixed(2)})` : ""}` : "");
    const r3 = inRange(y, "date", "3M");
    const tile = (lab, sub, lv, d1, d7, vals) => `<div class="ov-tile"><div class="ov-lab">${lab} <span class="muted">${sub}</span></div>`
      + `<div class="ov-big num">${lv}</div><div class="ov-chg num"><span>1D <b class="${cls(d1)}">${bp(d1, 0)}</b></span><span>1W <b class="${cls(d7)}">${bp(d7, 0)}</b></span><span class="muted">bp</span></div>${spark(vals)}</div>`;
    let h = ["2y", "10y"].map((t) => tile(t, "Treasury", num(a[t]) == null ? "–" : num(a[t]).toFixed(2) + "%", chg(a, b, t), chg(a, w, t), r3.map((r) => num(r[t])))).join("");
    const s0 = sprd(a, "2y", "10y"), s1 = sprd(b, "2y", "10y"), s7 = sprd(w, "2y", "10y");
    h += tile("2s10s", "curve", s0 == null ? "–" : bp(s0, 0) + "bp", s0 == null || s1 == null ? null : s0 - s1, s0 == null || s7 == null ? null : s0 - s7, r3.map((r) => sprd(r, "2y", "10y")));
    const f = D.summ[D.summ.length - 1];
    if (f && f.cum_yearend_bp !== "") {
      const f1r = D.summ[D.summ.length - 2], fW = atOrBefore(D.summ, "asof", shiftDays(f.asof, -7)), v = num(f.cum_yearend_bp);
      const dd = (x) => (x && x !== f && x.cum_yearend_bp !== "" ? v - num(x.cum_yearend_bp) : null);
      const s3 = D.summ.filter((r) => r.asof >= shiftDays(f.asof, -92) && r.cum_yearend_bp !== "").map((r) => num(r.cum_yearend_bp));
      h += tile("Fed", `priced by ${md(f.yearend_meeting)}`, `${bp(v, 0)}bp`, dd(f1r), dd(fW), s3).replace("</div><div class=\"ov-chg", `<span class="ov-note">${moves(v)}</span></div><div class="ov-chg`);
    }
    $("#ov-tiles").innerHTML = h;
  }

  // FOMC surprise：決議（EFFR 目標上緣變化）減會前一天期貨 price 的 bp
  function fomcSurprises() {
    const last = lastYieldDate();
    return D.events.filter((e) => e.type === "fomc" && e.date <= last).map((e) => {
      const before = atOrBefore(D.effr, "date", shiftDays(e.date, -1)), after = D.effr.find((r) => r.date > e.date);
      const dec = before && after && before.target_high !== "" && after.target_high !== "" ? Math.round((num(after.target_high) - num(before.target_high)) * 100) : null;
      const pre = atOrBefore(D.summ, "asof", shiftDays(e.date, -1));
      const priced = pre && pre.next_meeting === e.date && pre.next_move_bp !== "" ? num(pre.next_move_bp) : null;
      const r = reaction(e.date);
      // 會前一天 price 的會後利率水準（畫圖用）
      const pr = pre ? D.path.find((x) => x.asof === pre.asof && x.meeting === e.date) : null;
      return { date: e.date, dec, priced, pricedRate: pr ? num(pr.post) : null, surprise: dec == null || priced == null ? null : dec - priced, d2: r ? r.d2 : null, fed: r ? r.fed : null };
    });
  }
  // 實際 EFFR（實線）vs 會前一天 price 的利率（菱形）。只看過去；未來路徑在 Fed pricing 的 Priced (bp)（Henry：兩張重複）
  function renderFomcChart() {
    if (!D.effr.length) return empty("c-fomc", "No EFFR data");
    const yrs = { "6M": 0.5, "1Y": 1, "2Y": 2, "5Y": 5 }[S.fomcRange];
    const start = yrs ? shiftDays(D.effr[D.effr.length - 1].date, -Math.round(365.25 * yrs)) : D.effr[0].date;
    const eff = D.effr.filter((r) => r.date >= start && r.effr !== "");
    const ink = css("--ink"), acc = css("--s1"), muted = css("--muted");
    const decTxt = (d) => (d == null ? "–" : d > 0 ? `hike ${d}bp` : d < 0 ? `cut ${-d}bp` : "hold");
    const traces = [{ x: eff.map((r) => r.date), y: eff.map((r) => num(r.effr)), name: "Actual (EFFR)", mode: "lines", line: { color: ink, width: 2, shape: "hv" }, hovertemplate: "%{y:.2f}%<extra>EFFR</extra>", keepFmt: true }];
    const sur = fomcSurprises().filter((x) => x.pricedRate != null && x.date >= start);
    if (sur.length) traces.push({
      x: sur.map((x) => x.date), y: sur.map((x) => x.pricedRate), name: "Priced day before", mode: "markers",
      marker: { symbol: "diamond", size: 11, color: acc, line: { color: css("--surface"), width: 1.5 } },
      customdata: sur.map((x) => [decTxt(x.dec), bp(x.priced, 1), x.surprise == null ? "–" : bp(x.surprise, 1)]),
      hovertemplate: "Priced %{y:.2f}% (%{customdata[1]}bp)<br>Decision: %{customdata[0]}<br>Surprise: %{customdata[2]}bp<extra>FOMC</extra>",
    });
    const asof = D.path.length ? D.path[D.path.length - 1].asof : null;
    const fwd = asof ? D.path.filter((x) => x.asof === asof) : [];
    // 每次 FOMC 會議：底部一排標記 + 淡淡的直線。過去的依決定上色（升息紅、降息綠、不動灰），只多畫下一次（空心）
    const lastFwd = fwd.length ? fwd[0].meeting : null;
    const mtg = [...new Set([...(D.meetings || []), ...D.events.filter((e) => e.type === "fomc").map((e) => e.date), ...fwd.map((x) => x.meeting)])]
      .filter((d) => d >= start && (!lastFwd || d <= lastFwd)).sort();
    const done = (d) => d <= eff[eff.length - 1].date;
    const mc = mtg.map((d) => { const dec = done(d) ? fomcDecision(d) || "" : ""; return dec.startsWith("hike") ? css("--up") : dec.startsWith("cut") ? css("--down") : muted; });
    const mTxt = mtg.map((d) => { const f = fwd.find((x) => x.meeting === d);
      return `FOMC ${md(d)} ${d.slice(0, 4)}: ` + (done(d) ? fomcDecision(d) || "–" : f ? `priced ${bp(num(f.cum_bp), 1)}bp cumulative` : "upcoming"); });
    traces.push({ x: mtg, y: mtg.map(() => 0.03), yaxis: "y2", mode: "markers", name: "FOMC meeting", showlegend: true,
      marker: { symbol: mtg.map((d) => (done(d) ? "diamond" : "diamond-open")), size: 9, color: mc, line: { width: 1.5, color: mc } },
      text: mTxt, hovertemplate: "%{text}<extra></extra>" });
    const lay = baseLayout({ hovermode: "closest", yaxis: { ...baseLayout().yaxis, ticksuffix: "%" }, yaxis2: { overlaying: "y", range: [0, 1], visible: false, fixedrange: true } });
    lay.shapes = mtg.map((d) => ({ type: "line", xref: "x", yref: "paper", x0: d, x1: d, y0: 0, y1: 1, layer: "below", line: { color: rgba(muted, 0.25), width: 1 } }));
    if (asof) lay.shapes.push({ type: "line", xref: "x", yref: "paper", x0: asof, x1: asof, y0: 0, y1: 1, line: { color: muted, width: 1, dash: "dot" } });
    lay.annotations = asof ? [{ x: asof, y: 1, xref: "x", yref: "paper", text: " today", showarrow: false, xanchor: "left", yanchor: "top", font: { color: muted, size: 11 } }] : [];
    clearEmpty("c-fomc");
    plot("c-fomc", traces, lay);
  }
  function renderFomcTable() {
    const el = $("#fomc-table"); if (!el) return;
    const rows = fomcSurprises().slice(-12).reverse();
    if (!rows.length) { el.innerHTML = `<p class="hint">No meetings yet.</p>`; return; }
    const decTxt = (d) => (d == null ? "–" : d > 0 ? `Hike ${d}bp` : d < 0 ? `Cut ${-d}bp` : "Hold");
    // 整欄都沒有值的欄位（定價歷史還不夠）先不顯示，有第一筆就自動出現
    const has = (k) => rows.some((r) => r[k] != null);
    const cols = [["Priced day before (bp)", "priced", (r) => `<td class="n">${bp(r.priced, 1)}</td>`],
      ["Surprise (bp)", "surprise", (r) => `<td class="n ${cls(r.surprise)}"><b>${bp(r.surprise, 1)}</b></td>`],
      ["2y (bp)", "d2", (r) => `<td class="n ${cls(r.d2)}">${bp(r.d2, 1)}</td>`],
      ["Year-end pricing (bp)", "fed", (r) => `<td class="n ${cls(r.fed)}">${bp(r.fed, 1)}</td>`]].filter(([, k]) => has(k));
    let h = "<table><thead><tr><th>Meeting</th><th>Decision</th>" + cols.map(([n]) => `<th>${n}</th>`).join("") + "</tr></thead><tbody>";
    rows.forEach((r) => { h += `<tr><td class="n">${r.date}</td><td>${decTxt(r.dec)}</td>` + cols.map(([, , f]) => f(r)).join("") + "</tr>"; });
    const first = D.summ.length ? D.summ[0].asof : null;
    const note = `<p class="hint note">Pricing history starts on ${first || "–"}, so meetings before that have no diamond and no surprise yet. Both fill in from each new meeting.</p>`;
    el.innerHTML = note + fold("fomc", "Meeting-by-meeting numbers", `<div class="table-wrap">${h}</tbody></table></div>`);
  }

  // 選一次未來的會議，看各個結果的機率每天怎麼變（FedWatch 的 historical）
  function renderOddsHistory() {
    const A = asofs();
    if (!A.length) return empty("c-fomc", "No Fed pricing data yet.");
    clearEmpty("c-fomc");
    const last = A[A.length - 1];
    // Henry：只看下一次會議就好，不用選
    S.histMeeting = (pathOn(last)[0] || {}).meeting;
    if (!S.histMeeting) return empty("c-fomc", "No upcoming meeting priced.");
    const mon = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
    const lbl = document.createElement("div"); lbl.className = "hint";
    lbl.innerHTML = `Next meeting: <b>${mon(S.histMeeting)}</b>`;
    $("#fomc-controls").append(lbl);
    const m = S.histMeeting, today = baseRange(last);
    // 每天：那天的路徑 → 分布 → 取出這次會議那一列，換成絕對的區間下緣
    const series = A.map((a) => {
      const rows = pathOn(a), i = rows.findIndex((r) => r.meeting === m);
      if (i < 0) return null;
      const b = baseRange(a), d = levelDist(rows).dists[i], out = new Map();
      d.forEach((p, k) => out.set(Math.round((b.lo + k * 0.25) * 100), p));
      return { a, out };
    }).filter(Boolean);
    const lows = new Set();
    series.forEach(({ out }) => out.forEach((p, lo) => { if (p >= 0.01) lows.add(lo); }));
    const levels = [...lows].sort((x, y) => x - y), ks = levels.map((lo) => Math.round((lo / 100 - today.lo) / 0.25));
    const lab = (lo) => `${(lo / 100).toFixed(2)}–${(lo / 100 + 0.25).toFixed(2)}`;
    const tr = levels.map((lo, j) => ({
      x: series.map((s) => s.a), y: series.map((s) => (s.out.get(lo) || 0) * 100), name: lab(lo) + (ks[j] === 0 ? " (today)" : ""),
      type: "scatter", mode: "lines", stackgroup: "p", line: { width: 0.5, color: css("--surface") }, fillcolor: levelColor(ks[j], ks),
      hovertemplate: `${lab(lo)}%: %{y:.1f}%<extra></extra>`, keepFmt: true,
    }));
    plot("c-fomc", tr, baseLayout({ legend: { ...baseLayout().legend, traceorder: "reversed" },
      yaxis: { ...baseLayout().yaxis, ticksuffix: "%", range: [0, 100] } }));
    // 表：今天、一週前、一個月前、最早
    const cols = [["Today", series[series.length - 1]]];
    [["1W", "1 week ago"], ["1M", "1 month ago"]].forEach(([k, n]) => { const a = nearestAsof(series.map((s) => s.a), shiftDays(last, -cmpDays[k])); const s = series.find((x) => x.a === a); if (s && s !== cols[0][1]) cols.push([n, s]); });
    if (series[0] !== cols[cols.length - 1][1]) cols.push(["First (" + series[0].a + ")", series[0]]);
    let h = `<table><thead><tr><th>Target range after ${mon(m)}</th>` + cols.map(([n, s]) => `<th>${n}<br><small>${s.a}</small></th>`).join("") + "</tr></thead><tbody>";
    [...levels].reverse().forEach((lo) => {
      h += `<tr><td>${lab(lo)}${lo === Math.round(today.lo * 100) ? " <small>(today)</small>" : ""}</td>` + cols.map(([, s]) => `<td class="n">${((s.out.get(lo) || 0) * 100).toFixed(1)}%</td>`).join("") + "</tr>";
    });
    $("#fomc-table").innerHTML = fold("fomcHist", "Show table", h + "</tbody></table>"
      + `<p class="hint">Each day's probabilities use that day's ZQ prices and the same method as Meeting odds. History starts on ${A[0]} and grows every trading day.</p>`);
  }
  // 過去的會議：會前定價 vs 實際決定；或某次未來會議的機率怎麼一路變
  const FOMC_HINT = {
    past: "Looking back: the solid line is the actual policy rate (EFFR) and each blue diamond is the rate futures priced for that meeting the day before, so the gap between diamond and line is the surprise. Diamonds along the bottom mark each FOMC meeting: red a hike, green a cut, grey a hold, the open one is next. Where the market prices the rate from here on is in Fed pricing, Priced (bp). Pre-meeting pricing exists only from Sep 2026 (Yahoo keeps no expired ZQ contracts), so older meetings show the decision without a diamond.",
    hist: "How the odds of each target range after the next FOMC meeting have shifted day by day (like FedWatch's history). Colours are relative to today's range.",
  };
  function renderFomc() {
    $("#fomc-controls").innerHTML = ""; $("#fomc-table").innerHTML = "";
    $("#fomc-hint").textContent = FOMC_HINT[S.fomcView];
    $("#fomc-range").style.visibility = S.fomcView === "past" ? "" : "hidden";
    if (S.fomcView === "hist") return renderOddsHistory();
    renderFomcChart(); renderFomcTable();
  }

  // ---------- 圖一：殖利率 ----------
  const Y_HINT = {
    tenor: "Yields by tenor over time. Markers along the bottom are key events; hover to see that day's market reaction. The grey band on the right shows events in the next two weeks. Turn on the Fed overlay to compare the 2y with EFFR and the policy rate futures imply 12 months out: the 2y mostly reflects Fed expectations, so the gap is roughly term premium.",
    curve: "Today's curve against an earlier date (top), and how many bp each tenor moved since that date (bars, Bloomberg GC style). Orange bars = yields up, teal = down. Whether the front or the long end moved more tells bull/bear steepening from flattening. Drag the Compare slider or click a tick (1D, 1W, 1M…) to pick the date; the ticks are evenly spaced, not to scale, and you can stop anywhere between them. Right of Today (+3M … +2Y) the slider looks ahead: the dashed line is the forward curve implied by today's curve, i.e. where each tenor would have to be on that date for a long bought today to do no better than rolling the shorter bond. Desks read it as two scenarios side by side: the curve stays unchanged (solid; you earn carry + roll) versus forwards are realized (dashed; carry + roll is wiped out). The bars are forward − today, the move the market already prices; your view is whether yields move more or less than that. Forwards include term premium, so they are not a forecast and tend to overstate rises when the curve slopes up. Computed from Treasury par yields (bootstrapped to zeros); tenors whose end date lies past 30 years are left blank. The bars are close to, but not the same as, the Carry & roll breakeven, which finances at SOFR rather than the curve's own front end.",
    spread: "Term spreads. Up = steepening, down = flattening; below 0 is inverted. 2s5s10s is a butterfly (2 × 5y − 2y − 10y): it rises when the 5y cheapens against the two wings, usually when the market prices more Fed hikes (or fewer cuts) over the next few years, since the belly carries most of that.",
  };
  const BILLS_HINT = "Bill minus OIS: the bill's yield minus what you would expect to earn rolling overnight money (EFFR) over the same weeks, taken from the ZQ path. Both carry the same Fed expectations, so this gap is the bill's own richness or cheapness. Up = bills cheapening (heavy supply, less cash chasing them); down or below 0 = bills rich (scarce, money funds crowding in). Bill yields are converted from Treasury's bond-equivalent basis to money-market (×360/365). Desks usually quote it against SOFR OIS; SOFR runs about a bp below EFFR, so the level differs slightly but the moves are the same. ZQ-based history starts 2026-09-16; the grey line is the 1m bill minus today's EFFR for longer context (it ignores meetings priced inside the month).";
  // ---------- 比較日期拉桿 ----------
  // Henry：不要 Compare 按鈕，只用一條拉桿；刻度 1D / 1W / 1M… 之間等距（不是線性時間），刻度之間也能停在任何一天
  // ticks：[[標籤, 往回幾天]]，由遠到近，最後一個是 ["Today", 0]；back = 現在往回幾天；show(back) 給右邊顯示的字；onChange(back) 重畫圖
  function tickSlider(ticks, back, show, onChange) {
    const n = ticks.length - 1, U = 100, el = document.createElement("div");
    el.className = "tick-slider";
    el.innerHTML = `<div class="ts-row"><span>Compare</span><div class="ts-track"><input type="range" min="0" max="${n * U}" step="1" aria-label="Compare date">`
      + `<div class="ts-ticks">${ticks.map(([t], j) => `<button type="button" style="left:${(j / n) * 100}%">${t}</button>`).join("")}</div></div>`
      + `<span class="ts-date num"></span></div>`;
    const range = el.querySelector("input"), dateEl = el.querySelector(".ts-date"), btns = el.querySelectorAll(".ts-ticks button");
    const toBack = (v) => { const j = Math.min(n - 1, Math.floor(v / U)), f = v / U - j; return Math.round(ticks[j][1] + (ticks[j + 1][1] - ticks[j][1]) * f); };
    const toVal = (d) => {
      if (d >= ticks[0][1]) return 0;
      for (let j = 0; j < n; j++) { const x = ticks[j][1], y = ticks[j + 1][1]; if (d <= x && d >= y) return Math.round((j + (x - d) / (x - y)) * U); }
      return n * U;
    };
    const set = (d) => { range.value = toVal(d); btns.forEach((x, j) => x.classList.toggle("on", ticks[j][1] === d)); dateEl.innerHTML = show(d); onChange(d); };
    // 靠近刻度就吸過去
    range.oninput = () => { const v = +range.value, k = Math.round(v / U); set(Math.abs(v - k * U) <= 6 ? ticks[k][1] : toBack(v)); };
    btns.forEach((x, j) => { x.onclick = () => set(ticks[j][1]); });
    set(back);
    return el;
  }
  // 刻度：只放資料夠得到的（earliest = 最早有資料的日期）；最遠再加一個「最早」
  function backTicks(keys, earliest, last, maxLabel) {
    const span = daysBetween(earliest, last), DAYS = { "1D": 1, "1W": 7, "1M": 30, "3M": 91, "6M": 182, "1Y": 365, "2Y": 730, "5Y": 1826 };
    const t = keys.filter((k) => DAYS[k] <= span).map((k) => [k, DAYS[k]]);
    if (maxLabel && span > (t.length ? t[t.length - 1][1] : 0) * 1.2) t.push([maxLabel, span]);
    return [...t.reverse(), ["Today", 0]];
  }
  function renderYields() {
    const id = "c-yields", ctl = $("#y-controls"); ctl.innerHTML = ""; $("#y-hint").textContent = Y_HINT[S.yView]; $("#y-table").innerHTML = "";
    if (!D.yields.length) return empty(id, "No yield data yet. For the first run, trigger the GitHub Action manually with backfill checked.");
    clearEmpty(id);
    const P = palette(), v = S.yView, rr = () => renderYields();

    if (v === "tenor") {
      ctl.append(chips("Tenors", TENORS.map((t) => [t, t]), S.tenors, true, rr), chips("Overlay", [["fed", "EFFR + ZQ 12m ahead"]], S.trendFed, true, rr), rangeChips("range", rr), eventChips(rr));
      const rows = inRange(D.yields, "date", S.range);
      const tr = TENORS.filter((t) => S.tenors.includes(t)).map((t, i) => ({
        x: rows.map((r) => r.date), y: rows.map((r) => num(r[t])), name: t, type: "scatter", mode: "lines",
        line: { width: 1.8, color: P[i % P.length] }, hovertemplate: "%{y:.2f}%", keepFmt: true,
      }));
      // 疊 Fed：2y 主要反映對 Fed 的預期，和 EFFR、期貨隱含 12 個月後的利率比，差距大約是 term premium
      if (S.trendFed.includes("fed") && rows.length) {
        const start = rows[0].date, ef = D.effr.filter((r) => r.date >= start && r.effr !== ""), fs = D.summ.filter((r) => r.asof >= start && r.implied_12m !== "");
        tr.push({ x: ef.map((r) => r.date), y: ef.map((r) => num(r.effr)), name: "EFFR", type: "scatter", mode: "lines", line: { color: css("--ink"), width: 1.4, shape: "hv" }, hovertemplate: "%{y:.2f}%", keepFmt: true });
        if (fs.length) tr.push({ x: fs.map((r) => r.asof), y: fs.map((r) => num(r.implied_12m)), name: "ZQ-implied 12m ahead", type: "scatter", mode: "lines", line: { color: css("--muted"), width: 1.6, dash: "dash" }, hovertemplate: "%{y:.2f}%" });
      }
      const L = baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "%" } });
      if (rows.length) addEvents(tr, L, rows[0].date);
      plot(id, tr, L);
      renderReactions($("#y-table"));
    }

    if (v === "curve") {
      const Y = D.yields, last = Y[Y.length - 1];
      const curve = (n, r, w, c, dash) => ({
        x: TENORS, y: TENORS.map((t) => num(r[t])), name: n, type: "scatter", mode: "lines+markers",
        line: { width: w, color: c, dash }, marker: { size: w > 2 ? 6 : 4 }, hovertemplate: "%{y:.2f}%", keepFmt: true, connectgaps: true,
      });
      // d > 0：往回比較某一天；d < 0：往未來，畫今天曲線隱含的遠期曲線（Henry：時間軸可以往未來拉）
      const FWD = { 91: "3M", 182: "6M", 365: "1Y", 730: "2Y" };
      const baseAt = (d) => (d > 0 ? atOrBefore(Y, "date", shiftDays(last.date, -d)) : null);
      const fwdAt = (d) => {
        if (!(d < 0)) return null;
        const DF = zeroCurve(last); if (!DF) return null;
        const h = -d / 365, r = { date: shiftDays(last.date, -d) };
        TENORS.forEach((t) => { const f = fwdRate(DF, h, TY[t]); r[t] = f == null ? "" : f.toFixed(4); });
        return r;
      };
      const fwdName = (d) => (FWD[-d] || Math.round(-d / 30.4) + "M") + " forward";
      const draw = (d) => {
        S.curveBack = d;
        const fw = fwdAt(d), base = baseAt(d) || fw;
        const tr = [curve("Today " + last.date + (fw ? " (unchanged)" : ""), last, 2.6, P[0], "solid")];
        if (fw) { const c = curve(fwdName(d) + " (priced)", fw, 2, P[1], "dash"); c.hovertemplate = "%{y:.3f}%"; delete c.keepFmt; tr.push(c); }
        else if (base) tr.push(curve(base.date, base, 1.8, P[1], "dot"));
        const L = baseLayout({ xaxis: { ...baseLayout().xaxis, type: "category" },
          yaxis: { ...baseLayout().yaxis, ticksuffix: "%" } });
        if (base) {
          // 下面一排：每個天期從比較日到今天變了幾 bp（Bloomberg GC 的排法）；往未來時 = 遠期 − 今天，市場已經 price 的變動
          const ys = TENORS.map((t) => (num(last[t]) == null || num(base[t]) == null ? null : +((fw ? num(base[t]) - num(last[t]) : num(last[t]) - num(base[t])) * 100).toFixed(fw ? 3 : 1)));
          const d2 = fw ? chg(fw, last, "2y") : chg(last, base, "2y"), d10 = fw ? chg(fw, last, "10y") : chg(last, base, "10y");
          tr.push({ x: TENORS, y: ys, yaxis: "y2", type: "bar", showlegend: false, marker: { color: ys.map((x) => rgba(css(x >= 0 ? "--up" : "--down"), fw ? 0.45 : 0.7)) },
            text: ys.map((x) => (x == null ? "" : bp(x, 0))), textposition: "outside", cliponaxis: false,
            textfont: { family: "IBM Plex Mono, monospace", size: 10.5, color: css("--muted") },
            hovertemplate: fw ? `%{x}: %{y:+.3f}bp priced over the next ${FWD[-d] || ""}<extra></extra>` : `%{x}: %{y:+.1f}bp since ${base.date}<extra></extra>` });
          const lo = Math.min(0, ...ys.filter((x) => x != null)), hi = Math.max(0, ...ys.filter((x) => x != null)), pad = Math.max(4, (hi - lo) * 0.3);
          L.yaxis = { ...L.yaxis, domain: [0.36, 1] };
          L.yaxis2 = { ...baseLayout().yaxis, domain: [0, 0.24], anchor: "x", ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted"), range: [lo - pad, hi + pad], nticks: 3 };
          L.xaxis = { ...L.xaxis, anchor: "y2" };
          L.annotations = [{ xref: "paper", yref: "paper", x: 0, y: 0.27, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 11.5, color: css("--muted") },
            text: (fw ? `Priced change by ${fw.date}: forward − today (bp)` : `Change since ${base.date} (bp)`)
              + (d2 == null || d10 == null || innerWidth < 600 ? "" : ` · ${regime(d2, d10)} · 2s10s ${bp(d10 - d2, 0)}bp`) }];
          L.hovermode = "closest";
        }
        plot(id, tr, L);
      };
      // 手機上刻度太擠：往回少放幾個
      const ticks = [...backTicks(innerWidth < 600 ? ["1W", "1M", "3M", "1Y", "5Y"] : ["1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "5Y"], Y[0].date, last.date, Y[0].date.slice(0, 4)),
        ...Object.keys(FWD).map((k) => ["+" + FWD[k], -k])];
      if (S.curveBack < -730) S.curveBack = -730;
      ctl.append(tickSlider(ticks, S.curveBack,
        (d) => { if (d < 0) return `<b>${fwdName(d)}</b> · ${shiftDays(last.date, -d)}`; const b = baseAt(d); return b ? `vs <b>${b.date}</b>` : "Today only"; }, draw));
    }

    if (v === "spread") {
      // 三個天期的是 butterfly：2 × 中間 − 兩翼，正 = 中間（5y）相對兩翼便宜
      const defs = { "3m10y": ["3m", "10y"], "2s10s": ["2y", "10y"], "2s5s": ["2y", "5y"], "5s30s": ["5y", "30y"], "10s30s": ["10y", "30y"], "2s5s10s": ["2y", "5y", "10y"] };
      ctl.append(chips("Spreads", Object.keys(defs).map((k) => [k, k]), S.spreads, true, rr), rangeChips("range", rr), eventChips(rr));
      const rows = inRange(D.yields, "date", S.range);
      const tr = Object.keys(defs).filter((k) => S.spreads.includes(k)).map((k, i) => ({
        x: rows.map((r) => r.date), y: rows.map((r) => {
          const v = defs[k].map((t) => num(r[t])); if (v.some((z) => z == null)) return null;
          return (v.length === 3 ? 2 * v[1] - v[0] - v[2] : v[1] - v[0]) * 100;
        }),
        name: k, type: "scatter", mode: "lines", line: { width: 1.8, color: P[i % P.length] }, hovertemplate: "%{y:.0f}bp",
      }));
      const L = baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1 } });
      if (rows.length) addEvents(tr, L, rows[0].date);
      plot(id, tr, L);
      renderReactions($("#y-table"));
    }

  }

  // ---------- Carry & roll、曲線 RV ----------
  // 用財政部 par curve 近似：DV01 = par 債的 modified duration；repo 用 SOFR；roll = 曲線不變下，n 年債變成 n − h 年的殖利率差（線性內插）
  const TY = { "1m": 1 / 12, "2m": 2 / 12, "3m": 0.25, "4m": 1 / 3, "6m": 0.5, "1y": 1, "2y": 2, "3y": 3, "5y": 5, "7y": 7, "10y": 10, "20y": 20, "30y": 30 };
  // 遠期曲線：par curve 拔靴法成 zero curve（半年複利），再算 h 年後每個天期的遠期利率
  // ≤1y 是票券（含 52 週），直接當 zero rate；之後每半年一個節點，par 線性內插；h + 天期 > 30 年算不出來（null）
  function zeroCurve(row) {
    const pts = Object.keys(TY).map((t) => [TY[t], num(row[t])]).filter((p) => p[1] != null);
    if (pts.length < 4 || pts[pts.length - 1][0] < 30) return null;
    const par = (x) => { if (x <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, ya] = pts[i - 1], [b, yb] = pts[i]; return ya + ((yb - ya) * (x - a)) / (b - a); } return null; };
    const Z = [[0, pts[0][1] / 100]];
    pts.filter((p) => p[0] <= 1).forEach((p) => Z.push([p[0], p[1] / 100]));
    const df = {}; let sum = 0; // df[k] = 第 k 個半年的折現因子
    for (let k = 1; k <= 60; k++) {
      const t = k / 2;
      if (t <= 1) { const z = par(t) / 100; df[k] = Math.pow(1 + z / 2, -2 * t); }
      else { const c = par(t) / 100; df[k] = (1 - (c / 2) * sum) / (1 + c / 2); Z.push([t, 2 * (Math.pow(df[k], -1 / (2 * t)) - 1)]); }
      sum += df[k];
    }
    const z = (t) => { for (let i = 1; i < Z.length; i++) if (t <= Z[i][0] + 1e-9) { const [a, ya] = Z[i - 1], [b, yb] = Z[i]; return b === a ? yb : ya + ((yb - ya) * (t - a)) / (b - a); } return null; };
    return (t) => (t <= 0 ? 1 : t > 30 + 1e-9 ? null : Math.pow(1 + z(t) / 2, -2 * t));
  }
  // h 年後的 m 年期：≤1y 用遠期 zero（跟票券同一種報價），>1y 用遠期 par（半年付息）；單位 %
  function fwdRate(DF, h, m) {
    if (!DF) return null;
    const a = DF(h), b = DF(h + m); if (b == null) return null;
    if (m <= 1 + 1e-9) return 200 * (Math.pow(a / b, 1 / (2 * m)) - 1);
    let ann = 0; for (let k = 1; k <= Math.round(2 * m); k++) ann += DF(h + k / 2);
    return (200 * (a - b)) / ann;
  }
  const CR_TENORS = ["2y", "3y", "5y", "7y", "10y", "20y", "30y"];
  const CR_HZ = { "1M": [1 / 12, 21], "3M": [0.25, 63] };
  // 曲線 RV：兩個天期 = 長 − 短；三個 = 蝴蝶 2 × 中間 − 兩翼
  const RV_DEFS = { "2s10s": ["2y", "10y"], "2s5s": ["2y", "5y"], "5s30s": ["5y", "30y"], "10s30s": ["10y", "30y"], "2s5s10s": ["2y", "5y", "10y"], "5s10s30s": ["5y", "10y", "30y"] };
  const CR_HINT = {
    carry: "What a long position in each tenor earns if nothing moves, in bp of yield, over the horizon picked on the right. Carry = coupon income minus the cost of financing the bond in repo (SOFR here), divided by duration so it reads in bp. Roll-down = the curve stays put but the bond gets shorter, so its yield slides to the shorter point on the curve: positive where the curve slopes up, negative where it is inverted. Carry + roll is the breakeven: yields can rise that many bp over the horizon before a long loses money (a short pays it). Desks compare it with how much yields usually move: Vol is the typical move over the same horizon from the last 3 months of daily changes, and Carry ÷ vol says how much of that cushion you get per unit of risk. DV01 is the dollar P&L per 1bp per $1mm face. Approximations: par yields from the Treasury curve, not individual bonds; SOFR stands in for general collateral repo.",
    rv: "Is each curve spread or butterfly rich or cheap against its own past year? Level in bp (spread = long tenor − short tenor; butterfly = 2 × belly − both wings), its change over 1 week and 1 month, and the z-score: how many standard deviations today's level sits from its 1-year average (bars). |z| above about 2 is stretched. The last column is the carry + roll of a DV01-neutral trade that gains when the spread rises (a steepener; for a butterfly, short the belly against the wings): positive means time works for that trade, negative means it pays to wait. It is the same carry + roll as the other view, combined across the legs.",
  };
  function crCalc(row, repo, h) {
    const pts = Object.keys(TY).map((t) => [TY[t], num(row[t])]).filter((p) => p[1] != null);
    const at = (x) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, ya] = pts[i - 1], [b, yb] = pts[i]; return ya + ((yb - ya) * (x - a)) / (b - a); } return null; };
    const out = {};
    CR_TENORS.forEach((t) => {
      const y = num(row[t]); if (y == null) return;
      const n = TY[t], r = y / 100, dur = r ? (1 - Math.pow(1 + r / 2, -2 * n)) / r : n; // par 債：modified duration = 年金因子
      const carry = repo == null ? null : ((y - repo) * 100 * h) / dur, rl = at(n - h), roll = rl == null ? null : (y - rl) * 100;
      out[t] = { y, dur, dv01: dur * 100, carry, roll, total: carry == null || roll == null ? null : carry + roll };
    });
    return out;
  }
  function renderCarry() {
    const id = "c-cr"; if (!$("#" + id)) return;
    $("#cr-hint").textContent = CR_HINT[S.crView]; $("#cr-table").innerHTML = "";
    const Y = D.yields; if (!Y.length) { $("#cr-date").innerHTML = ""; return empty(id, "No yield data yet."); }
    clearEmpty(id);
    const P = palette(), last = Y[Y.length - 1], [h, hd] = CR_HZ[S.crHz];
    const fr = atOrBefore((D.fund || []).filter((r) => r.sofr !== ""), "date", last.date), repo = fr ? num(fr.sofr) : null;
    const C = crCalc(last, repo, h);
    $("#cr-date").innerHTML = `<span class="muted">Treasury curve ${md(last.date)} · repo = SOFR ${repo == null ? "n/a" : repo.toFixed(2) + "%"}${fr ? ` (${md(fr.date)})` : ""} · ${S.crHz} horizon · Treasury par yields, FRED SOFR</span>`;
    // 波動：最近 63 個交易日的日變動標準差 × √(期間交易日)
    const vol = (f) => {
      const v = Y.slice(-64).map(f), d = [];
      for (let i = 1; i < v.length; i++) if (v[i] != null && v[i - 1] != null) d.push((v[i] - v[i - 1]) * 100);
      if (d.length < 20) return null;
      const m = d.reduce((a, x) => a + x, 0) / d.length;
      return Math.sqrt(d.reduce((a, x) => a + (x - m) ** 2, 0) / (d.length - 1)) * Math.sqrt(hd);
    };
    const f1 = (x, s = true) => (x == null ? "–" : s ? bp(x, 1) : x.toFixed(1));
    const tone = (x) => (x == null || Math.abs(x) < 0.05 ? "" : x > 0 ? "down" : "up"); // 正 carry 對多頭有利 = 殖利率往下的方向色

    if (S.crView === "carry") {
      const T = CR_TENORS.filter((t) => C[t]);
      plot(id, [
        { x: T, y: T.map((t) => C[t].carry), name: "Carry", type: "bar", marker: { color: rgba(P[0], 0.8) }, hovertemplate: "Carry %{y:.1f}bp<extra></extra>", keepFmt: true },
        { x: T, y: T.map((t) => C[t].roll), name: "Roll-down", type: "bar", marker: { color: rgba(P[2], 0.8) }, hovertemplate: "Roll %{y:.1f}bp<extra></extra>", keepFmt: true },
        { x: T, y: T.map((t) => C[t].total), name: "Carry + roll", type: "scatter", mode: "markers+text", marker: { symbol: "diamond", size: 9, color: css("--ink") },
          text: T.map((t) => f1(C[t].total)), textposition: "top center", textfont: { family: "IBM Plex Mono, monospace", size: 10.5, color: css("--muted") }, cliponaxis: false,
          hovertemplate: "Carry + roll %{y:.1f}bp<extra></extra>", keepFmt: true },
      ], baseLayout({ barmode: "relative", bargap: 0.35, xaxis: { ...baseLayout().xaxis, type: "category" },
        yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1 } }));
      let t = `<table><thead><tr><th>Tenor</th><th>Yield</th><th title="$ per 1bp per $1mm face">DV01</th><th>Carry</th><th>Roll</th><th title="= breakeven: bp yields can rise before a long loses">Carry + roll</th><th title="Typical yield move over the horizon (last 3 months)">Vol</th><th>Carry ÷ vol</th></tr></thead><tbody>`;
      T.forEach((k) => {
        const c = C[k], v = vol((r) => num(r[k]));
        t += `<tr><td>${k}</td><td class="n">${c.y.toFixed(2)}%</td><td class="n">$${Math.round(c.dv01)}</td><td class="n">${f1(c.carry)}</td><td class="n">${f1(c.roll)}</td>`
          + `<td class="n ${tone(c.total)}"><b>${f1(c.total)}</b></td><td class="n">${f1(v, false)}</td><td class="n">${c.total == null || !v ? "–" : (c.total / v).toFixed(2)}</td></tr>`;
      });
      $("#cr-table").innerHTML = `<div class="table-wrap">${t}</tbody></table></div><p class="hint note">All in bp of yield over ${S.crHz}, for a long position (a short has the same numbers with the sign flipped). Example: 10y DV01 $${C["10y"] ? Math.round(C["10y"].dv01) : "–"} means $10mm of 10s moves about $${C["10y"] ? Math.round(C["10y"].dv01 * 10).toLocaleString() : "–"} per bp.</p>`;
      return;
    }

    // 曲線 RV
    const val = (r, k) => { const v = RV_DEFS[k].map((t) => num(r[t])); if (v.some((z) => z == null)) return null; return (v.length === 3 ? 2 * v[1] - v[0] - v[2] : v[1] - v[0]) * 100; };
    const Y1 = Y.slice(-252), keys = Object.keys(RV_DEFS);
    const rows = keys.map((k) => {
      const lv = val(last, k), hs = Y1.map((r) => val(r, k)).filter((x) => x != null);
      const m = hs.reduce((a, x) => a + x, 0) / hs.length, sd = Math.sqrt(hs.reduce((a, x) => a + (x - m) ** 2, 0) / (hs.length - 1));
      const ago = (d) => { const b = atOrBefore(Y, "date", shiftDays(last.date, -d)), x = b ? val(b, k) : null; return lv == null || x == null ? null : lv - x; };
      const legs = RV_DEFS[k].map((t) => (C[t] ? C[t].total : null));
      const cr = legs.some((x) => x == null) ? null : legs.length === 3 ? legs[0] + legs[2] - 2 * legs[1] : legs[0] - legs[1];
      return { k, lv, w: ago(7), mo: ago(30), z: sd ? (lv - m) / sd : null, lo: Math.min(...hs), hi: Math.max(...hs), cr };
    });
    const zs = rows.map((r) => r.z);
    plot(id, [{ y: keys, x: zs, type: "bar", orientation: "h", marker: { color: zs.map((z) => rgba(P[0], z != null && Math.abs(z) >= 2 ? 0.95 : 0.5)) },
      text: zs.map((z) => (z == null ? "" : bp(z, 2))), textposition: "outside", cliponaxis: false, textfont: { family: "IBM Plex Mono, monospace", size: 10.5, color: css("--muted") },
      hovertemplate: "%{y}: z = %{x:.2f}<extra></extra>", keepFmt: true }],
      baseLayout({ hovermode: "closest", showlegend: false, margin: { l: 70, r: 30, t: 10, b: 40 },
        yaxis: { ...baseLayout().yaxis, type: "category", autorange: "reversed", tickfont: { color: css("--muted") } },
        xaxis: { ...baseLayout().xaxis, title: { text: "z-score vs past year", font: { size: 11.5, color: css("--muted") } }, range: [Math.min(-3, ...zs.filter((z) => z != null)) - 0.4, Math.max(3, ...zs.filter((z) => z != null)) + 0.4],
          zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1,
          tickvals: [-3, -2, -1, 0, 1, 2, 3], ticktext: ["−3", "−2", "−1", "0", "+1", "+2", "+3"] },
        shapes: [-2, 2].map((x) => ({ type: "line", x0: x, x1: x, yref: "paper", y0: 0, y1: 1, layer: "below", line: { color: css("--muted"), width: 1, dash: "dot" } })) }));
    let t = `<table><thead><tr><th></th><th>Level</th><th>1W</th><th>1M</th><th>1Y range</th><th>1Y z</th><th title="Carry + roll of a DV01-neutral trade that gains when the spread rises">C+R long spread (${S.crHz})</th></tr></thead><tbody>`;
    rows.forEach((r) => {
      t += `<tr><td>${r.k}</td><td class="n">${r.lv == null ? "–" : r.lv.toFixed(0)}</td><td class="n">${bp(r.w, 0)}</td><td class="n">${bp(r.mo, 0)}</td><td class="n muted">${r.lo.toFixed(0)} to ${r.hi.toFixed(0)}</td>`
        + `<td class="n">${r.z == null ? "–" : bp(r.z, 2)}</td><td class="n">${f1(r.cr)}</td></tr>`;
    });
    $("#cr-table").innerHTML = `<div class="table-wrap">${t}</tbody></table></div><p class="hint note">Levels and changes in bp; z-score and range over the last 252 trading days. Long the spread = a steepener (long the short tenor, short the long tenor, equal DV01); for a butterfly, short 2 units of belly DV01 against 1 of each wing.</p>`;
  }

  // ---------- 資金面：repo 利率 vs IORB、準備金 / RRP / TGA、bill − OIS ----------
  const FUND_HINT = {
    repo: "Where overnight money trades against the rate the Fed pays banks on reserves (IORB, the ceiling it wants to hold). SOFR is the Treasury repo rate; EFFR is unsecured bank lending. When reserves are plentiful both sit a few bp below IORB. SOFR pushing up to or above IORB means cash is getting scarce (heavy Treasury settlements, month and quarter ends, falling reserves): the signal that ended QT in late 2025 and that desks watch for funding stress. Month-end and tax-date spikes are normal; a rising baseline is what matters.",
    liq: "The plumbing behind those rates, in $ trillions. Reserves are the cash banks hold at the Fed; the overnight reverse repo (RRP) is money funds parking cash at the Fed; the Treasury General Account (TGA) is the government's cash at the Fed. A rising TGA (after debt issuance or tax dates) or a growing Fed balance sheet runoff drains reserves; once the RRP is near zero, every drain comes straight out of reserves, which is when repo rates start to climb. Fed total assets (dotted) shows QT or balance sheet growth.",
    bills: BILLS_HINT,
    curve: "The reserve demand curve: each dot is one day, bank reserves (that week) against SOFR − IORB. With plenty of reserves the rate barely moves (flat part, SOFR well below IORB); below roughly $3tn it turns steep and SOFR starts to trade at or above IORB. The Fed manages its balance sheet to stay on the flat side, so where today sits on this curve tells you how close funding is to stress. The line is the median spread in each $0.1tn bucket. The threshold shifts over time, so read it as a guide, not a fixed number.",
  };
  function renderFunding() {
    const id = "c-fund", ctl = $("#fund-controls"); if (!ctl) return;
    ctl.innerHTML = ""; $("#fund-hint").textContent = FUND_HINT[S.fundView];
    const P = palette(), rr = () => renderFunding(), F = D.fund || [];
    const v = S.fundView;
    if (v !== "bills" && !F.length) { $("#fund-date").innerHTML = ""; return empty(id, "Funding data load after the next daily update."); }
    clearEmpty(id);
    if (v === "repo") {
      ctl.append(rangeChips("fundRange", rr));
      const ef = new Map(D.effr.map((r) => [r.date, num(r.effr)]));
      const rows = inRange(F.filter((r) => r.iorb !== "" && r.sofr !== ""), "date", S.fundRange);
      const tr = [{ x: rows.map((r) => r.date), y: rows.map((r) => (num(r.sofr) - num(r.iorb)) * 100), name: "SOFR − IORB", line: { color: P[0], width: 1.8 }, hovertemplate: "SOFR − IORB %{y:.0f}bp<extra></extra>" },
        { x: rows.map((r) => r.date), y: rows.map((r) => (ef.has(r.date) ? (ef.get(r.date) - num(r.iorb)) * 100 : null)), name: "EFFR − IORB", line: { color: P[2], width: 1.6 }, connectgaps: true, hovertemplate: "EFFR − IORB %{y:.0f}bp<extra></extra>" }];
      plot(id, tr, baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1.5 } }));
      const l = rows[rows.length - 1];
      $("#fund-date").innerHTML = l ? `<span class="muted">${l.date}: SOFR ${num(l.sofr).toFixed(2)}%, IORB ${num(l.iorb).toFixed(2)}%${ef.has(l.date) ? `, EFFR ${ef.get(l.date).toFixed(2)}%` : ""} · FRED SOFR, IORB · NY Fed EFFR</span>` : "";
    }
    if (v === "liq") {
      ctl.append(rangeChips("fundRange", rr));
      // 週資料是週三，RRP 是每天：各自畫，不對齊
      const col = (c, k) => F.filter((r) => r[c] !== "").map((r) => ({ date: r.date, v: num(r[c]) / k }));
      const end = F.length ? F[F.length - 1].date : "", start = shiftDays(end, -RANGES[S.fundRange]), cut = (x) => x.filter((p) => p.date >= start);
      const res = cut(col("reserves", 1e6)), rrp = cut(col("rrp", 1e3)), tga = cut(col("tga", 1e6)), wal = cut(col("walcl", 1e6));
      plot(id, [{ ...xy(res), name: "Bank reserves", line: { color: P[0], width: 2.2 }, hovertemplate: "Reserves $%{y:.2f}tn<extra></extra>" },
        { ...xy(tga), name: "TGA", line: { color: P[2], width: 1.8 }, hovertemplate: "TGA $%{y:.2f}tn<extra></extra>" },
        { ...xy(rrp), name: "ON RRP", line: { color: P[4], width: 1.6 }, hovertemplate: "RRP $%{y:.2f}tn<extra></extra>" },
        { ...xy(wal), name: "Fed total assets (right)", yaxis: "y2", line: { color: css("--muted"), width: 1.4, dash: "dot" }, hovertemplate: "Fed assets $%{y:.2f}tn<extra></extra>" }],
        baseLayout({ margin: { l: 52, r: 52, t: 10, b: 40 }, yaxis: { ...baseLayout().yaxis, tickprefix: "$", ticksuffix: "tn" }, yaxis2: { ...baseLayout().yaxis, tickprefix: "$", ticksuffix: "tn", overlaying: "y", side: "right", showgrid: false } }));
      const lr = lastV(res), lt = lastV(tga), lq = lastV(rrp);
      $("#fund-date").innerHTML = lr ? `<span class="muted">Reserves $${lr.v.toFixed(2)}tn (${md(lr.date)})${lt ? ` · TGA $${lt.v.toFixed(2)}tn` : ""}${lq ? ` · RRP $${(lq.v * 1000).toFixed(lq.v < 0.01 ? 1 : 0)}bn (${md(lq.date)})` : ""} · FRED WRESBAL, WTREGEN, RRPONTSYD, WALCL</span>` : "";
    }
    if (v === "curve") {
      // 每天的 SOFR − IORB 對上「當週」的準備金（週資料是週三，往後帶到下一筆）
      let res = null; const pts = [];
      for (const r of F) {
        if (r.reserves !== "") res = num(r.reserves) / 1e6;
        if (res != null && r.sofr !== "" && r.iorb !== "") pts.push({ date: r.date, x: res, y: (num(r.sofr) - num(r.iorb)) * 100 });
      }
      if (!pts.length) return empty(id, "Funding data load after the next daily update.");
      const last = pts[pts.length - 1], y1 = shiftDays(last.date, -365), m3 = shiftDays(last.date, -91);
      const grp = (f) => pts.filter(f), dot = (g, name, color, size) => ({ x: g.map((p) => p.x), y: g.map((p) => p.y), customdata: g.map((p) => p.date), name, mode: "markers", type: "scatter",
        marker: { color, size }, hovertemplate: "%{customdata}: reserves $%{x:.2f}tn, SOFR − IORB %{y:.0f}bp<extra></extra>" });
      // 每 0.1 兆一格的中位數，畫成需求曲線
      const bins = new Map();
      pts.forEach((p) => { const k = Math.floor(p.x * 10) / 10; (bins.get(k) || bins.set(k, []).get(k)).push(p.y); });
      const med = (a) => { const b = [...a].sort((u, w) => u - w), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
      const curve = [...bins].filter(([, a]) => a.length >= 5).sort((a, b) => a[0] - b[0]).map(([k, a]) => [k + 0.05, med(a)]);
      plot(id, [dot(grp((p) => p.date < y1), "Earlier", rgba(css("--muted"), 0.35), 5),
        dot(grp((p) => p.date >= y1 && p.date < m3), "Past year", rgba(P[1], 0.55), 6),
        dot(grp((p) => p.date >= m3), "Last 3 months", rgba(P[0], 0.8), 7),
        { x: curve.map((c) => c[0]), y: curve.map((c) => c[1]), name: "Median", mode: "lines", line: { color: css("--ink"), width: 2, shape: "spline" }, hovertemplate: "$%{x:.2f}tn: median %{y:.1f}bp<extra></extra>" },
        { x: [last.x], y: [last.y], name: `Latest (${md(last.date)})`, mode: "markers", marker: { color: P[0], size: 13, line: { color: css("--ink"), width: 2 } }, hovertemplate: `${last.date}: reserves $%{x:.2f}tn, SOFR − IORB %{y:.0f}bp<extra></extra>` }],
        baseLayout({ hovermode: "closest", xaxis: { ...baseLayout().xaxis, type: "linear", tickprefix: "$", ticksuffix: "tn", title: { text: "Bank reserves", font: { size: 12 } } },
          yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1.5 } }));
      $("#fund-date").innerHTML = `<span class="muted">Latest: reserves $${last.x.toFixed(2)}tn, SOFR − IORB ${last.y.toFixed(0)}bp (${md(last.date)}) · daily since ${pts[0].date.slice(0, 4)} · FRED WRESBAL, SOFR, IORB</span>`;
    }
    if (v === "bills") {
      ctl.append(rangeChips("fundRange", rr), eventChips(rr));
      $("#fund-date").innerHTML = "";
      const rows = inRange(D.yields, "date", S.fundRange), start = rows.length ? rows[0].date : "";
      const bo = (D.bills || []).filter((r) => r.date >= start), ef = new Map(D.effr.map((r) => [r.date, num(r.effr)]));
      const spot = rows.filter((r) => num(r["1m"]) != null && ef.get(r.date) != null);
      const tr = [{ x: spot.map((r) => r.date), y: spot.map((r) => (num(r["1m"]) * 360 / 365 - ef.get(r.date)) * 100), name: "1m bill − EFFR (spot)",
        type: "scatter", mode: "lines", line: { color: css("--muted"), width: 1.2, dash: "dot" }, hovertemplate: "%{y:.1f}bp" },
        ...["1m", "3m", "6m"].map((t, i) => ({ x: bo.map((r) => r.date), y: bo.map((r) => num(r[`spread_${t}`])), name: `${t} bill − OIS`, type: "scatter", mode: "lines",
          line: { color: P[i], width: 2 }, customdata: bo.map((r) => [num(r[`bill_${t}`]), num(r[`ois_${t}`])]),
          hovertemplate: `%{y:.1f}bp (bill %{customdata[0]:.3f}%, OIS %{customdata[1]:.3f}%)` }))];
      const L = baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1 } });
      if (rows.length && !["5Y", "All"].includes(S.fundRange)) addEvents(tr, L, rows[0].date);
      plot(id, tr, L);
    }

  }

  // ---------- 國債標售：每個天期最近一次 vs 前 6 次平均（sell-side auction recap 的打分法） ----------
  const AUCT_TERMS = ["2y", "3y", "5y", "7y", "10y", "20y", "30y", "5y TIPS", "10y TIPS", "30y TIPS"];
  function renderAuctions() {
    const el = $("#auct-table"); if (!el) return;
    const A = D.auct || [], ctl = $("#auct-controls"); ctl.innerHTML = "";
    const done = A.filter((r) => r.btc !== "");
    if (!done.length) { el.innerHTML = ""; $("#auct-date").innerHTML = ""; return empty("c-auct", "Auction results load after the next daily update."); }
    clearEmpty("c-auct");
    const P = palette(), terms = AUCT_TERMS.filter((t) => done.some((r) => r.term === t));
    if (!terms.includes(S.auctTerm)) S.auctTerm = terms[0];
    // 每一筆：和同天期前 6 次的平均比
    const scored = (r) => {
      const prev = done.filter((x) => x.term === r.term && x.auction_date < r.auction_date).slice(-6);
      const avg = (k) => (prev.length ? prev.reduce((a, x) => a + num(x[k]), 0) / prev.length : null);
      return { ...r, avg: { btc: avg("btc"), indirect_pct: avg("indirect_pct"), direct_pct: avg("direct_pct"), dealer_pct: avg("dealer_pct") } };
    };
    // 顏色：需求弱（dealer 多、cover 低、indirect 少）= 橘（殖利率偏上），強 = 青
    const tone = (k, x, a) => { if (a == null || x == null) return ""; const d = x - a, th = k === "btc" ? 0.05 : 1.5; if (Math.abs(d) < th) return ""; const weak = k === "dealer_pct" ? d > 0 : d < 0; return weak ? "up" : "down"; };
    const cell = (r, k, dec, unit) => { const x = num(r[k]), a = r.avg[k]; return `<td class="n ${tone(k, x, a)}">${x == null ? "–" : x.toFixed(dec) + unit}<small class="muted"> ${a == null ? "" : a.toFixed(dec)}</small></td>`; };
    const tailCell = (r) => r.tail == null ? `<td class="n muted">–</td>`
      : `<td class="n ${r.tail >= 0.5 ? "up" : r.tail <= -0.5 ? "down" : ""}" title="WI ≈ ${r.wi.toFixed(3)}%">${r.tail > 0 ? "+" : r.tail < 0 ? "−" : ""}${Math.abs(r.tail).toFixed(1)}bp</td>`;
    const today = localToday();
    const up = A.filter((r) => r.btc === "" && r.auction_date >= today).sort((a, b) => (a.auction_date < b.auction_date ? -1 : 1));
    const latest = terms.map((t) => done.filter((r) => r.term === t).pop()).filter(Boolean).sort((a, b) => (a.auction_date < b.auction_date ? 1 : -1)).map(scored);
    let h = "<table><thead><tr><th>Date</th><th>Auction</th><th>Size</th><th>High yield</th><th title='High yield minus the CBOE yield index at the 1pm close (stand-in for the when-issued yield). + = tail (weak), − = stop-through (strong). 5y, 10y and 30y only'>Tail ≈</th><th title='Bids ÷ amount sold. Small grey number = average of the previous 6 auctions of this tenor'>Bid-to-cover</th><th>Indirect</th><th>Direct</th><th>Dealers</th></tr></thead><tbody>";
    up.forEach((r) => { h += `<tr class="upcoming"><td class="n">${md(r.auction_date)}</td><td>${r.term}${r.reopening ? " <small class=\"muted\">reopening</small>" : ""}</td><td class="n">$${num(r.offering_bn).toFixed(0)}bn</td><td class="n muted" colspan="6">announced, not yet held</td></tr>`; });
    latest.forEach((r) => { h += `<tr><td class="n">${md(r.auction_date)}</td><td>${r.term}${r.reopening ? " <small class=\"muted\">reopening</small>" : ""}</td><td class="n">$${num(r.offering_bn).toFixed(0)}bn</td><td class="n">${num(r.high_yield) == null ? "–" : num(r.high_yield).toFixed(3) + "%"}</td>`
      + tailCell(r) + cell(r, "btc", 2, "") + cell(r, "indirect_pct", 1, "%") + cell(r, "direct_pct", 1, "%") + cell(r, "dealer_pct", 1, "%") + "</tr>"; });
    el.innerHTML = `<div class="table-wrap">${h}</tbody></table></div><p class="hint note">Latest auction of each tenor; the small grey number is the average of the previous 6 auctions of the same tenor. Shares are of competitive bids accepted (excluding the Fed's own SOMA rollovers). Tail ≈ = high yield minus the CBOE 5y/10y/30y yield index at 1:00pm ET, a free stand-in for the when-issued yield (close for reopenings, can be 1–2bp off for new issues); other tenors have no free intraday yield. Sources: Treasury Fiscal Data, auctions_query; CBOE ^FVX/^TNX/^TYX via Yahoo.</p>`;
    const L = latest[0];
    $("#auct-date").innerHTML = L ? `<span class="muted">Latest: ${L.term} on ${md(L.auction_date)}${up.length ? ` · next announced: ${up[0].term} on ${md(up[0].auction_date)}` : ""}</span>` : "";
    // 圖：選一個天期，最近 24 次的 dealer 比例（柱）和 bid-to-cover（線，右軸）
    ctl.append(chips("Tenor", terms.map((t) => [t, t]), S.auctTerm, false, (v) => { S.auctTerm = v; renderAuctions(); }));
    const rs = done.filter((r) => r.term === S.auctTerm).slice(-24).map(scored);
    plot("c-auct", [{ x: rs.map((r) => r.auction_date), y: rs.map((r) => num(r.dealer_pct)), name: "Dealer share", type: "bar",
        marker: { color: rs.map((r) => (tone("dealer_pct", num(r.dealer_pct), r.avg.dealer_pct) === "up" ? rgba(css("--up"), 0.7) : tone("dealer_pct", num(r.dealer_pct), r.avg.dealer_pct) === "down" ? rgba(css("--down"), 0.7) : rgba(css("--muted"), 0.45))) },
        customdata: rs.map((r) => [num(r.high_yield), num(r.indirect_pct), (r.reopening ? " (reopening)" : "") + (r.tail == null ? "" : ` · tail ≈ ${r.tail >= 0 ? "+" : "−"}${Math.abs(r.tail).toFixed(1)}bp`)]),
        hovertemplate: "Dealers %{y:.1f}% · indirect %{customdata[1]:.1f}% · high yield %{customdata[0]:.3f}%%{customdata[2]}<extra></extra>", keepFmt: true },
      { x: rs.map((r) => r.auction_date), y: rs.map((r) => num(r.btc)), name: "Bid-to-cover (right)", yaxis: "y2", mode: "lines+markers", line: { color: css("--ink"), width: 1.6 }, marker: { size: 5 }, hovertemplate: "Bid-to-cover %{y:.2f}<extra></extra>" }],
      baseLayout({ hovermode: "x unified", margin: { l: 44, r: 44, t: 10, b: 40 }, bargap: 0.3, yaxis: { ...baseLayout().yaxis, ticksuffix: "%" },
        yaxis2: { ...baseLayout().yaxis, overlaying: "y", side: "right", showgrid: false, tickformat: ".1f" } }));
  }

  // ---------- 圖二：Fed 定價 ----------
  const F_HINT = {
    priced: "How many bp of hikes (+) or cuts (−) the futures price in at each FOMC meeting (bars), and cumulatively from today (line); the right axis reads the same line as the implied policy rate. This is the number desks quote (\"1.3 hikes priced by December\") because it is exactly what futures pin down; probabilities need an extra assumption. Fed funds futures (ZQ) cover about 15 months; past the dashed divider the line continues with 3-month SOFR futures (SR3), one step per quarter, shifted down by the SOFR–fed funds gap so the two pieces join up (SR3 history starts 2026-10-09). Diamonds are the Fed's own year-end median (dot plot): line above the diamonds = market more hawkish than the Fed.",
    probs: "Probability of each target range after each FOMC meeting (FedWatch style). Futures only fix the average (the bp in Priced); the split into ranges assumes each meeting is independent of the last, so later meetings look more spread out than the market likely believes. Grey = same as today, deeper orange = higher, deeper green = lower.",
  };
  const asofs = () => [...new Set(D.path.map((r) => r.asof))].sort();
  const pathOn = (a) => D.path.filter((r) => r.asof === a);
  // 比較用的舊日期：fed_path 沒有（下一次會議合約已到期）就用 fed_path_partial（從接得上的會議開始）
  function cmpAsof(A, iso) {
    const a = nearestAsof(A, iso); if (a) return [a, false];
    const b = nearestAsof([...new Set((D.pathPart || []).map((r) => r.asof))].sort(), iso);
    return b ? [b, true] : [null, false];
  }
  const pathAt = (a, part) => (part ? (D.pathPart || []).filter((r) => r.asof === a) : pathOn(a));
  function nearestAsof(list, iso) { let ans = null; for (const a of list) { if (a <= iso) ans = a; else break; } return ans; }

  function renderFed() {
    const id = "c-fed", ctl = $("#f-controls"); ctl.innerHTML = ""; $("#f-hint").textContent = F_HINT[S.fView]; $("#f-table").innerHTML = "";
    const A = asofs();
    if (!A.length) return empty(id, "No Fed pricing data yet (it needs ZQ futures prices first).");
    clearEmpty(id);
    if (S.fView === "path") S.fView = "priced";
    const P = palette(), v = S.fView, rr = () => renderFed(), last = A[A.length - 1];
    // ZQ 報價來自 Yahoo，偶爾抓不到：標出 Fed 定價是哪一天的，落後殖利率 2 個交易日以上就提醒
    const behind = D.yields.filter((r) => r.date > last).length;
    $("#f-asof").textContent = `As of ${last}`;
    $("#f-asof").classList.toggle("warn", behind >= 2);
    $("#f-stale").hidden = behind < 2;
    $("#f-stale").textContent = behind >= 2 ? `⚠ ZQ futures prices haven't updated for ${behind} trading days (Yahoo unavailable); showing pricing as of ${last}.` : "";
    const effrNow = num(D.summ[D.summ.length - 1].effr);

    if (v === "priced") {
      // WIRP 式：每次會議 price 了多少 bp（柱）＋從今天起累計（線），可疊一週 / 一個月前的累計來看 repricing
      ctl.append(chips("Horizon", [["2Y", "To end-" + (+last.slice(0, 4) + 2)], ["5Y", "5 years"]], S.pathHz, false, (h) => { S.pathHz = h; rr(); }));
      ctl.append(chips("Compare", ["1W", "1M", "3M"].map((k) => [k, cmpLabel[k]]), S.pricedCmp, true, rr));
      const rows = pathOn(last), x = rows.map((r) => r.meeting), start = rows.length ? num(rows[0].pre) : effrNow;
      const mon = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) + " '" + iso.slice(2, 4);
      const xl = x.map(mon);
      // 舊日期的累計：用那天的會議後隱含利率減今天的起點，同一把尺才比得起來（中間開過會也不會錯位）
      const then = (a, part) => { const m = new Map(pathAt(a, part).map((r) => [r.meeting, num(r.post)])); return x.map((d) => (m.has(d) ? (m.get(d) - start) * 100 : null)); };
      const cmp = [];
      S.pricedCmp.forEach((k) => { const [a, part] = cmpAsof(A, shiftDays(last, -cmpDays[k])); if (a && a !== last) cmp.push([k, a, then(a, part)]); });
      const mv = rows.map((r) => num(r.move_bp)), cum = rows.map((r) => num(r.cum_bp));
      // SR3 的格子名稱尾巴加不換行空白，免得跟 ZQ 同月份的會議（例如 Dec '27）撞成同一格
      // ZQ 大約只到 15 個月；之後接 SR3（3 個月 SOFR 期貨，已扣 SOFR−EFFR 的 basis），每季一格，拆不到單次會議
      // 預設只看到後年年底，5Y 才把整條 SR3 畫出來
      const hzEnd = `${+last.slice(0, 4) + 2}-12-31`;
      const ext = (D.pathSr3 || []).filter((r) => r.asof === last && (S.pathHz === "5Y" || r.start <= hzEnd));
      const xq = ext.map((r) => mon(r.start) + "\u00a0"), yq = ext.map((r) => (num(r.rate) - start) * 100);
      const xAll = xl.concat(xq);
      const sr3Then = (a) => { const m = new Map((D.pathSr3 || []).filter((r) => r.asof === a).map((r) => [r.contract, (num(r.rate) - start) * 100])); return ext.map((r) => (m.has(r.contract) ? m.get(r.contract) : null)); };
      // Fed 點陣圖（SEP 中位數，年底）：放在那年最後一次會議那格；ZQ 涵蓋不到的年份放在包含 12/31 的 SR3 那季
      const dots = D.sep.filter((r) => r.fedfunds !== "").map((r) => {
        const ye = `${r.year}-12-31`; let k = -1;
        x.forEach((d, i) => { if (d.slice(0, 4) === String(r.year)) k = i; });
        if (k < 0 || x[k] < `${r.year}-12-01`) { const j = ext.findIndex((e) => e.start <= ye && ye < e.end); k = j >= 0 ? xl.length + j : -1; }
        return k >= 0 && ye >= last ? { x: xAll[k], y: (+r.fedfunds - start) * 100, rate: +r.fedfunds, year: r.year } : null;
      }).filter(Boolean);
      const narrow = innerWidth < 600, dense = narrow || xAll.length > 16;
      const tr = [
        { x: xl, y: mv, name: "This meeting", type: "bar", marker: { color: mv.map((b) => rgba(css(b >= 0 ? "--up" : "--down"), 0.45)) },
          text: mv.map((b) => (!dense && Math.abs(b) >= 5 ? bp(b, 1) : "")), textposition: "inside", insidetextanchor: "end", textangle: 0, textfont: { size: 10.5, color: css("--ink") },
          customdata: mv.map((b) => moves(b)), hovertemplate: "This meeting %{y:+.1f}bp (%{customdata})<extra></extra>" },
        ...cmp.map(([k, a, y], j) => ({ x: xAll, y: y.concat(sr3Then(a)), name: `Cumulative ${cmpLabel[k]} (${a})`, type: "scatter", mode: "lines+markers",
          line: { color: [P[3], P[4]][j % 2], width: 1.6, dash: "dot" }, marker: { size: 5 }, hovertemplate: `${cmpLabel[k]}: %{y:+.1f}bp<extra></extra>` })),
        { x: xl, y: cum, name: "Cumulative from today", type: "scatter", mode: "lines+markers+text", line: { color: P[0], width: 2.6 }, marker: { size: 7 },
          text: cum.map((b) => (narrow ? "" : bp(b, 0))), textposition: "top left", cliponaxis: false,
          textfont: { family: "IBM Plex Mono, monospace", size: 11, color: css("--ink") },
          customdata: cum.map((b) => [moves(b), start + b / 100]), hovertemplate: "Cumulative %{y:+.1f}bp (%{customdata[0]}) → %{customdata[1]:.2f}%<extra></extra>" },
      ];
      if (ext.length) tr.push({ x: [xl[xl.length - 1], ...xq], y: [cum[cum.length - 1], ...yq], name: "SR3 extension (quarterly)", type: "scatter", mode: "lines+markers", line: { color: P[0], width: 2, dash: "dash" }, marker: { size: 5 },
        customdata: [[null, "", ""], ...ext.map((r) => [num(r.rate), `${md(r.start)} – ${md(r.end)}`, num(r.sofr).toFixed(3)])],
        hovertemplate: "Cumulative %{y:+.1f}bp → %{customdata[0]:.2f}%<br>SR3 %{customdata[1]}, SOFR %{customdata[2]}%<extra></extra>" });
      if (dots.length) tr.push({ x: dots.map((d) => d.x), y: dots.map((d) => d.y), name: "Fed dots (SEP median, year-end)", mode: "markers", type: "scatter",
        marker: { symbol: "diamond-open", size: 12, color: css("--ink"), line: { width: 2 } }, customdata: dots.map((d) => [d.rate, d.year]),
        hovertemplate: "Fed median for end-%{customdata[1]}: %{customdata[0]:.2f}% (%{y:+.0f}bp)<extra></extra>" });
      // 右軸 = 絕對利率（今天的起點 + bp）：左右兩軸用同一個範圍換算，刻度才對得上
      const ys = [...mv, ...cum, ...yq, ...dots.map((d) => d.y), ...cmp.flatMap(([, a, y]) => y.concat(sr3Then(a)))].filter((z) => z != null && isFinite(z));
      const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), pad = Math.max(5, (hi - lo) * 0.1), yr = [lo - pad, hi + pad];
      tr.push({ x: [xl[0]], y: [null], yaxis: "y2", showlegend: false, hoverinfo: "skip", type: "scatter" });
      const shapes = [], annotations = [];
      if (ext.length) {
        // 資料來源切換的地方：左邊 ZQ（每次會議），右邊 SR3（每季平均）
        shapes.push({ type: "line", x0: xl.length - 0.5, x1: xl.length - 0.5, yref: "paper", y0: 0, y1: 1, line: { color: css("--ink"), width: 1, dash: "dash" } });
        if (!narrow) annotations.push({ x: xl.length - 0.5, yref: "paper", y: 0, text: "ZQ, per meeting ◂ ", showarrow: false, xanchor: "right", yanchor: "bottom", font: { size: 11, color: css("--muted") } },
          { x: xl.length - 0.5, yref: "paper", y: 0, text: " ▸ SR3, quarterly", showarrow: false, xanchor: "left", yanchor: "bottom", font: { size: 11, color: css("--muted") } });
      }
      const lg = narrow ? { legend: { ...baseLayout().legend, y: -0.42, yanchor: "top" } } : {};
      plot(id, tr, baseLayout({ ...lg, hovermode: "x unified", xaxis: { ...baseLayout().xaxis, type: "category", tickangle: dense ? -45 : 0 },
        margin: { ...baseLayout().margin, r: narrow ? 44 : 56, ...(narrow ? { b: 250 } : {}) }, shapes, annotations,
        yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", range: yr, zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1 },
        yaxis2: { ...baseLayout().yaxis, overlaying: "y", side: "right", range: yr.map((z) => start + z / 100), tickformat: ".2f", ticksuffix: "%", showgrid: false, zeroline: false, title: narrow ? undefined : { text: "Implied rate", font: { size: 11, color: css("--muted") } } } }));
      // 表：每次會議 bp / 幾碼 / 累計 / 和一週、一個月前比
      const cols = [["1W", "Δ vs 1 week"], ["1M", "Δ vs 1 month"]].map(([k, n]) => { const [a, part] = cmpAsof(A, shiftDays(last, -cmpDays[k])); return a && a !== last ? [n, then(a, part)] : null; }).filter(Boolean);
      let h = "<table><thead><tr><th>FOMC</th><th>This meeting (bp)</th><th>Moves</th><th>Cumulative (bp)</th><th>Cumulative moves</th><th>Implied rate</th>"
        + cols.map(([n]) => `<th>${n}</th>`).join("") + "</tr></thead><tbody>";
      const c = (z) => (z > 0.05 ? "up" : z < -0.05 ? "down" : "");
      rows.forEach((r, i) => {
        h += `<tr><td>${r.meeting}</td><td class="n">${bp(mv[i], 1)}</td><td class="n">${moves(mv[i])}</td>`
          + `<td class="n"><b>${bp(cum[i], 1)}</b></td><td class="n">${moves(cum[i])}</td><td class="n">${num(r.post).toFixed(3)}%</td>`
          + cols.map(([, y]) => { const d = y[i] == null ? null : cum[i] - y[i]; return `<td class="n ${d == null ? "" : c(d)}">${d == null ? "–" : bp(d, 1)}</td>`; }).join("") + "</tr>";
      });
      $("#f-table").innerHTML = fold("fTable", "Show table", h + "</tbody></table>"
        + `<p class="hint">One move = 25bp. Cumulative is measured from today's EFFR (${start.toFixed(2)}%). Δ columns show how much cumulative pricing has changed: positive = more hawkish than then. These numbers come straight from futures prices; the Meeting odds tab adds an independence assumption on top.</p>`);
    }

    if (v === "probs") {
      const rows = pathOn(last), { levels, dists } = levelDist(rows), base = baseRange(last);
      const tr = levels.map((k) => {
        const c = levelColor(k, levels);
        return { x: rows.map((r) => r.meeting), y: dists.map((d) => (d.get(k) || 0) * 100), name: rangeLabel(base, k) + (k === 0 ? " (today)" : ""),
          type: "bar", marker: { color: c, line: { color: css("--surface"), width: 1 } },
          text: dists.map((d) => ((d.get(k) || 0) >= 0.1 ? rangeLabel(base, k, true) + "<br>" + Math.round(d.get(k) * 100) + "%" : "")),
          textposition: "inside", insidetextanchor: "middle", textangle: 0, textfont: { color: Math.abs(k) >= 2 || k === 0 ? "#fff" : css("--ink"), size: 10.5 },
          hovertemplate: `${rangeLabel(base, k)}%: %{y:.1f}%<extra></extra>`, keepFmt: true };
      });
      plot(id, tr, baseLayout({ barmode: "stack", hovermode: "x unified", legend: { ...baseLayout().legend, traceorder: "reversed" },
        xaxis: { ...baseLayout().xaxis, type: "category" }, yaxis: { ...baseLayout().yaxis, ticksuffix: "%", range: [0, 100] } }));
      renderDistTable(rows, levels, dists, base);
    }

  }

  // 從今天的利率出發，一次一次會議往下接：每次會議把隱含變動拆成最接近的兩檔（lo_bp / hi_bp），
  // 和前面的分佈相乘累加 → 每次會議後「相對今天」各檔的機率。平均值剛好等於會議後隱含利率。
  function levelDist(rows) {
    let cur = new Map([[0, 1]]);
    const dists = rows.map((r) => {
      const next = new Map(), moves = [[Math.round(num(r.lo_bp) / 25), num(r.p_lo)], [Math.round(num(r.hi_bp) / 25), num(r.p_hi)]];
      cur.forEach((p, k) => moves.forEach(([m, q]) => { if (q > 0) next.set(k + m, (next.get(k + m) || 0) + p * q); }));
      cur = next;
      return next;
    });
    const keys = new Set([0]);
    dists.forEach((d) => d.forEach((p, k) => { if (p >= 0.005) keys.add(k); }));
    return { levels: [...keys].sort((a, b) => a - b), dists };
  }
  // 今天的目標區間（asof 當天或之前最後一筆 EFFR）
  function baseRange(asof) {
    // 用那天路徑的起點（算定價用的 EFFR）找所在的一碼區間，和定價算法一致；會議當天 EFFR 還沒反映決議時也不會錯位
    const p0 = pathOn(asof)[0];
    if (p0) { const lo = Math.floor(num(p0.pre) / 0.25 + 1e-9) * 0.25; return { lo, hi: lo + 0.25 }; }
    const e = atOrBefore(D.effr, "date", asof) || D.effr[D.effr.length - 1] || {};
    const lo = num(e.target_low), hi = num(e.target_high);
    return lo == null || hi == null ? { lo: num(e.effr) - 0.125, hi: num(e.effr) + 0.125 } : { lo, hi };
  }
  const rangeLabel = (b, k, short) => { const lo = b.lo + k * 0.25, hi = b.hi + k * 0.25; return short ? lo.toFixed(2) : `${lo.toFixed(2)}–${hi.toFixed(2)}`; };
  function levelColor(k, levels) {
    // 柔和一點：今天那檔用淡灰，越遠的檔顏色越深，但不到全飽和
    if (k === 0) return rgba(css("--muted"), 0.22);
    const n = Math.max(1, ...levels.filter((x) => Math.sign(x) === Math.sign(k)).map(Math.abs));
    return rgba(css(k > 0 ? "--up" : "--down"), (0.18 + 0.32 * Math.abs(k) / n).toFixed(2));
  }
  // 相對今天：比今天低 / 一樣 / 比今天高
  function vsToday(d) { let lo = 0, eq = 0, hi = 0; d.forEach((p, k) => { if (k < 0) lo += p; else if (k > 0) hi += p; else eq += p; }); return { lo, eq, hi }; }

  function renderTable(rows) {
    if (!rows.length) return;
    const { dists } = levelDist(rows);
    let h = "<table><thead><tr><th>FOMC</th><th>Pre-meeting</th><th>Post-meeting implied</th><th>This meeting (bp)</th><th>Cumulative (bp)</th><th>Below today</th><th>Same as today</th><th>Above today</th></tr></thead><tbody>";
    rows.forEach((r, i) => {
      const t = vsToday(dists[i]);
      h += `<tr><td>${r.meeting}</td><td class="n">${num(r.pre).toFixed(3)}</td><td class="n">${num(r.post).toFixed(3)}</td>`
        + `<td class="n">${bp(num(r.move_bp), 1)}</td><td class="n">${bp(num(r.cum_bp), 1)}</td>`
        + `<td class="n">${pct(t.lo)}</td><td class="n">${pct(t.eq)}</td><td class="n">${pct(t.hi)}</td></tr>`;
    });
    $("#f-table").innerHTML = fold("fTable", "Show table", h + "</tbody></table>"
      + `<p class="hint">"Pre-meeting" and "post-meeting implied" are the average expectations from futures, not actual rate levels; the probability columns compare with today's target range.</p>`);
  }
  // FedWatch 式矩陣：列 = 會議，欄 = 目標區間，格子 = 機率
  function renderDistTable(rows, levels, dists, base) {
    if (!rows.length) return;
    const cols = [...levels].reverse();
    let h = "<table class=\"dist\"><thead><tr><th>FOMC</th><th>Implied</th>"
      + cols.map((k) => `<th class="${k === 0 ? "today" : ""}">${rangeLabel(base, k)}${k === 0 ? "<br><small>today</small>" : ""}</th>`).join("") + "</tr></thead><tbody>";
    rows.forEach((r, i) => {
      const d = dists[i];
      let best = 0, bk = 0; d.forEach((p, k) => { if (p > best) { best = p; bk = k; } });
      h += `<tr><td>${r.meeting}</td><td class="n">${num(r.post).toFixed(2)}</td>` + cols.map((k) => {
        const p = d.get(k) || 0;
        if (p < 0.005) return `<td class="n zero">–</td>`;
        const bg = rgba(css(k > 0 ? "--up" : k < 0 ? "--down" : "--muted"), (0.08 + 0.42 * p).toFixed(2));
        return `<td class="n${k === bk ? " top" : ""}" style="background:${bg}">${(p * 100).toFixed(1)}%</td>`;
      }).join("") + "</tr>";
    });
    $("#f-table").innerHTML = fold("fTable", "Show table", h + "</tbody></table>"
      + `<p class="hint">Each cell is the probability that the target range sits at that level after the meeting; each row sums to 100%. Bold is the most likely level. Futures only give the average expectation, so each meeting is assumed to land on the two nearest levels; the further out, the less precise.</p>`);
  }

  // ---------- 行事曆：仿 Fed 官網 FOMC calendar，左邊月份、右邊當月事件，由上往下 ----------
  function renderCalendar() {
    const el = $("#cal"); if (!el) return;
    const today = lastYieldDate() || new Date().toISOString().slice(0, 10), m0 = today.slice(0, 7);
    const horizon = S.calAll ? "9999" : shiftDays(today, 92);
    const evs = D.events.filter((e) => e.date.slice(0, 7) >= m0 && e.date <= horizon);
    // FOMC 會議 → 那次會議 price 了多少 bp（最新一天的路徑）
    const A = asofs(), priced = new Map(A.length ? pathOn(A[A.length - 1]).map((r) => [r.meeting, r]) : []);
    const mon = (ym) => new Date(ym + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    const md = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const dow = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
    const groups = new Map();
    evs.forEach((e) => { const k = e.date.slice(0, 7); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
    let h = "", yr = "";
    groups.forEach((list, ym) => {
      if (ym.slice(0, 4) !== yr) { yr = ym.slice(0, 4); h += `<div class="cal-year">${yr}</div>`; }
      h += `<div class="cal-month"><div class="cal-m">${mon(ym)}</div><div class="cal-evs">` + list.map((e) => {
        const past = e.date < today, isF = e.type === "fomc";
        // FOMC 是兩天的會，日期顯示「前一天–決議日」，和 Fed 官網一樣；3/6/9/12 月有經濟預測（SEP / 點陣圖）
        let d = isF ? `${md(shiftDays(e.date, -1))}–${shiftDays(e.date, -1).slice(5, 7) === e.date.slice(5, 7) ? e.date.slice(8).replace(/^0/, "") : md(e.date)}` : md(e.date);
        let extra = "";
        if (isF) {
          if (["03", "06", "09", "12"].includes(e.date.slice(5, 7))) extra += ` <span class="badge" title="Summary of Economic Projections (dot plot)">SEP</span>`;
          const r = priced.get(e.date);
          if (r && !past) extra += ` <span class="cal-priced ${num(r.move_bp) > 0.05 ? "up" : num(r.move_bp) < -0.05 ? "down" : ""}">priced ${bp(num(r.move_bp), 1)}bp · ${moves(num(r.move_bp))}</span>`;
        }
        return `<div class="cal-ev${isF ? " fomc" : TOP.has(e.type) ? " tier1" : ""}${e.type === "blackout" ? " blk" : ""}${past ? " past" : ""}${e.date === today ? " today" : ""}">`
          + `<span class="cal-d">${d}<small>${isF ? "" : " " + dow(e.date)}</small></span>`
          + `<span class="cal-g" style="color:${evtColor(e.type)}">${EVT[e.type].glyph}</span>`
          + `<span class="cal-l">${e.label}${extra}</span></div>`;
      }).join("") + "</div></div>";
    });
    el.innerHTML = h || `<div class="empty">No upcoming events.</div>`;
    $("#cal-all").textContent = S.calAll ? "Next 3 months" : "Show all";
  }

  // Fed 靜默期：會議第一天之前的第二個週六開始，到會後隔天結束（會議都是兩天，決議日 = 第二天）
  function blackouts(meetings) {
    return (meetings || []).filter((m) => m >= "2025-01-01").map((m) => {
      const start = shiftDays(m, -1), dw = new Date(start + "T00:00:00Z").getUTCDay();
      const sat1 = shiftDays(start, -((dw + 1) % 7 || 7));
      return { date: shiftDays(sat1, -7), type: "blackout", label: `Fed blackout until ${md(shiftDays(m, 1))} (${md(m)} FOMC)` };
    });
  }

  // ---------- 啟動 ----------
  function bindSeg(sel, key, render) {
    $(sel).addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      S[key] = b.dataset.v; $(sel).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); render();
    });
  }
  function syncThemeBtn() {
    const b = $("#theme"), d = isDark();
    b.textContent = d ? "☀" : "☾";
    b.title = d ? "Switch to light mode" : "Switch to dark mode";
    b.setAttribute("aria-label", b.title);
  }
  // ---------- 通膨、就業（FRED 月資料） ----------
  // 月資料一欄 → [{date, v}]，跳過空白
  const ser = (col, rows = D.macro) => rows.filter((r) => r[col] !== "" && r[col] != null).map((r) => ({ date: r.date, v: +r[col] }));
  // 變化率：k 期前比較，ann = 換算成年率（12 個月）
  // 用日期找 k 個月前（不是往前數 k 筆）：2025 年 10 月政府關門，CPI 那個月沒資料
  const mBack = (iso, k) => { const n = +iso.slice(0, 4) * 12 + +iso.slice(5, 7) - 1 - k; return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`; };
  const rate = (s, k, ann) => { const v = new Map(s.map((p) => [p.date, p.v])); return s.filter((p) => v.has(mBack(p.date, k))).map((p) => { const b = v.get(mBack(p.date, k)); return { date: p.date, v: (ann ? Math.pow(p.v / b, 12 / k) - 1 : p.v / b - 1) * 100 }; }); };
  // 失業率 unrounded = 失業人數 ÷ 勞動力（BLS 公布的 UNRATE 只到一位小數）；還沒有勞動力資料的月份用公布值
  const urate = () => { const c = new Map(ser("clf").map((p) => [p.date, p.v])), u = new Map(ser("unemploy").map((p) => [p.date, p.v]));
    return ser("unrate").map((p) => (c.get(p.date) && u.has(p.date) ? { date: p.date, v: (u.get(p.date) / c.get(p.date)) * 100, pub: p.v } : p)); };
  const yoy = (s) => rate(s, 12, false), mom = (s) => rate(s, 1, false), annK = (s, k) => rate(s, k, true);
  const diff = (s) => { const v = new Map(s.map((p) => [p.date, p.v])); return s.filter((p) => v.has(mBack(p.date, 1))).map((p) => ({ date: p.date, v: p.v - v.get(mBack(p.date, 1)) })); };
  const avgK = (s, k) => s.slice(k - 1).map((p, i) => ({ date: p.date, v: s.slice(i, i + k).reduce((a, x) => a + x.v, 0) / k }));
  const lastV = (s) => (s.length ? s[s.length - 1] : null);
  const fromYears = (s, y) => { if (!s.length) return s; const start = shiftDays(s[s.length - 1].date, -Math.round(365.25 * y)); return s.filter((p) => p.date >= start); };
  const monthName = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  const f1 = (x, d = 1) => (x == null || isNaN(x) ? "–" : x.toFixed(d));
  const localToday = () => { const n = new Date(); return new Date(n.getTime() - n.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const xy = (s) => ({ x: s.map((p) => p.date), y: s.map((p) => p.v) });
  const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // events.json 的標籤 "CPI (Sep 2026)" → "2026-09-01"
  const evtMonth = (label) => { const m = /\((\w{3}) (\d{4})\)/.exec(label || ""); return m && MON3.includes(m[1]) ? `${m[2]}-${String(MON3.indexOf(m[1]) + 1).padStart(2, "0")}-01` : null; };

  // 資料月份 + 下次公布；如果已經公布了更新的月份但我們還沒有，就變橘色
  function dataLine(col, type, name, label = "") {
    const s = ser(col), l = lastV(s); if (!l) return `<span class="muted">No data yet</span>`;
    const today = localToday();
    const nxt = D.events.find((e) => e.type === type && e.date >= today);
    const missed = D.events.some((e) => e.type === type && e.date < today && (evtMonth(e.label) || "") > l.date);
    return `<span class="${missed ? "up" : "muted"}">${label}${monthName(l.date)} data${missed ? " · newer release not loaded yet" : ""}`
      + `${nxt ? ` · next ${name} ${md(nxt.date)}` : ""}</span>`;
  }
  // SEP 中位數：每個預測年度畫在那年 12/31
  const sepPts = (col) => D.sep.filter((r) => r[col] !== "" && r[col] != null).map((r) => ({ date: `${r.year}-12-31`, v: +r[col], year: r.year }));
  // 只畫接下來 2 個年底，太遠的預測會把圖拉太長
  const sepTrace = (col, name, color, after) => {
    const p = sepPts(col).filter((x) => !after || (x.date >= after && x.date <= shiftDays(after, 730)));
    return p.length ? { ...xy(p), name, mode: "markers", marker: { symbol: "diamond-open", size: 10, color, line: { width: 2 } },
      customdata: p.map((x) => x.year), hovertemplate: `%{y:.1f}% (Fed median for end-%{customdata})<extra>${name}</extra>`, keepFmt: true } : null;
  };
  const hline = (y, text) => ({ shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y, line: { color: css("--muted"), width: 1, dash: "dash" } }],
    annotations: text ? [{ xref: "paper", x: 0, y, text, showarrow: false, xanchor: "left", yanchor: "bottom", font: { size: 11, color: css("--muted") } }] : [] });
  const pctAxis = (extra = {}) => ({ ...baseLayout().yaxis, ticksuffix: "%", ...extra });

  // Overview 三張卡：每個指標一行（最新一期、vs 預期），長段文字和小圖都拿掉，細節點進去看
  function ovRow(m, label) {
    const rs = surRows(m), r = rs[rs.length - 1]; if (!r) return "";
    const dec = SM[m].dec, d = r.forecast == null ? null : +(r.actual - r.forecast).toFixed(dec);
    const s = d == null ? `<span class="muted">no forecast</span>` : d === 0 ? `<span>as expected</span>`
      : `<span class="${dirCls(m, d)}">${d > 0 ? "+" : ""}${d.toFixed(dec)}${SM[m].unit === "k" ? "k" : ""} ${dirWord(m, d)}</span>`;
    return ovLine(label, refLabel(m, r.ref).replace(/ \d{4}$/, ""), signed(m, r.actual), s);
  }
  const ovLine = (label, per, val, note) => `<div class="ov-r"><span class="ov-rl">${label} <span class="muted">${per}</span></span><b class="num">${val}</b><span class="ov-rs">${note}</span></div>`;
  const nextLine = (types) => { const t = localToday(), e = D.events.find((x) => types.includes(x.type) && x.date >= t); return e ? `Next: ${e.label.replace(/ \(.*\)$/, "")} ${dow(e.date)} ${md(e.date)}` : ""; };
  function renderOvCards() {
    if (D.macro.length) {
      $("#infl-k").innerHTML = ovRow("core_cpi_mm", "Core CPI m/m") + ovRow("cpi_mm", "CPI m/m") + ovRow("core_pce_mm", "Core PCE m/m") + ovRow("core_pce_yy", "Core PCE y/y");
      $("#infl-date").textContent = nextLine(["cpi", "pce"]);
      $("#jobs-k").innerHTML = ovRow("nfp", "Payrolls") + ovRow("unrate", "Unemployment") + ovRow("ahe_mm", "Wages m/m") + ovRow("claims", "Jobless claims");
      $("#jobs-date").textContent = nextLine(["nfp"]);
    }
    const { lg, now } = gdpParts(); let g = "";
    if (lg) g += ovLine("Real GDP", qName(lg.date).replace(/ \d{4}$/, ""), `${f1(lg.pub ?? lg.v)}%`, `<span class="muted">annualized</span>`);
    if (now) g += ovLine("GDPNow", qName(now.date).replace(/ \d{4}$/, ""), `${f1(now.v)}%`, `<span class="muted">Atlanta Fed tracking</span>`);
    const rt = lastV(mom(ser("rs_total"))), rc = lastV(mom(rsControl())), sg = (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
    if (rt) g += ovLine("Retail sales m/m", monthName(rt.date).slice(0, 3), sg(rt.v), `<span class="muted">headline</span>`);
    if (rc) g += ovLine("Control group m/m", monthName(rc.date).slice(0, 3), sg(rc.v), `<span class="muted">feeds into GDP</span>`);
    $("#growth-k").innerHTML = g || `<p class="hint">Growth data load after the next daily update.</p>`;
    $("#growth-date").textContent = nextLine(["gdp", "retail"]);
  }

  // 一年 2% 換成每個月的速度：1.02^(1/12) − 1 ≈ 0.165%
  const PACE2 = (Math.pow(1.02, 1 / 12) - 1) * 100;
  // ---------- 新聞版：最新一期卡片（Inflation / Jobs 共用）----------
  // Henry：網站要跟新聞對得起來。新聞先講 headline、core 的 m/m 和 y/y，再跟預期比 → 一張 2×2 卡片
  // 字眼跟著數字的方向（高 → 第一個字）；顏色跟著對利率的意義（SM.sign：失業率高 = 鴿 = 藍綠）
  const WORDS = { inflation: ["hotter", "cooler"], nfp: ["stronger", "weaker"], unrate: ["higher", "lower"], ahe_mm: ["hotter", "cooler"], claims: ["higher", "lower"] };
  const dirWord = (m, d) => { const w = WORDS[m] || WORDS.inflation; return d === 0 ? "in line" : d > 0 ? w[0] : w[1]; };
  const dirCls = (m, d) => (d === 0 ? "" : (SM[m] ? SM[m].sign : 1) * d > 0 ? "up" : "down");
  // 一格：先找那天的公布紀錄（有預期、前值），沒有就用指數自己算
  function latCell(label, sub, m, col, kind, date, ref, src) {
    const r = m && SM[m] ? surRows(m).find((x) => x.date === date && x.ref === ref) : null;
    const dec = m && SM[m] ? SM[m].dec : 1, unit = m && SM[m] ? SM[m].unit : "%";
    let a = null, u = null, fc = null, prior = null;
    if (r) { a = r.actual; u = hasUnr(r) ? +r.unrounded : null; fc = r.forecast; prior = r.revised !== "" && r.revised != null ? +r.revised : r.prior !== "" ? +r.prior : null; }
    else if (col) {
      const s = src ? src() : ser(col), f = kind === "yy" ? yoy(s) : kind === "lvl" ? s : mom(s), mp = new Map(f.map((p) => [p.date, p.v]));
      if (mp.has(ref)) { u = mp.get(ref); a = +u.toFixed(dec); }
      if (mp.has(mBack(ref, 1))) prior = +mp.get(mBack(ref, 1)).toFixed(dec);
      if (m && SM[m]) { const c = consensus(date, m, ref); if (c) fc = c.v; }
    }
    const fmt = (v, sign) => (v == null ? "–" : (sign && v > 0 ? "+" : "") + (+v).toFixed(dec) + unit);
    let body;
    if (a == null) {
      const why = kind === "yy" && ref === "2026-10-01" && col && /cpi/.test(col) ? "Oct 2025 CPI was never published (shutdown), so there is no y/y for Oct 2026." : "Not available yet.";
      body = `<div class="lat-big num muted">n/a</div><div class="lat-sub">${why}</div>`;
    } else {
      const d = fc == null ? null : +(a - fc).toFixed(dec);
      body = `<div class="lat-big num">${fmt(a, m === "nfp")}${u != null && unit === "%" ? ` <span class="lat-unr">(${u.toFixed(3)})</span>` : ""}</div>`
        + `<div class="lat-sub">${fc != null ? `expected ${fmt(fc, m === "nfp")}` : "no forecast"} · prior ${fmt(prior, m === "nfp")}</div>`
        + (d != null ? `<div class="lat-sur ${dirCls(m, d)}">${d === 0 ? "as expected" : `${d > 0 ? "+" : ""}${d.toFixed(dec)}${unit === "k" ? "k" : ""} ${dirWord(m, d)} than expected`}</div>` : `<div class="lat-sur muted">&nbsp;</div>`);
    }
    return `<div class="lat-cell"><div class="lat-lab">${label} <span class="muted">${sub}</span></div>${body}</div>`;
  }
  // 卡片底下：當天市場反應（連到 Rates）、下一次公布
  function latFoot(date, type, nextMeasures) {
    const r = reaction(date), lines = [];
    if (r && r.d2 != null) lines.push(`<b>Markets that day:</b> 2y <b class="${dirCls("x", r.d2)}">${bp(r.d2, 0)}bp</b> · 10y ${bp(r.d10, 0)}bp`
      + (r.fed != null ? ` · Fed hikes priced by year-end ${bp(r.fed, 0)}bp` : "") + ` <a href="#rates">Rates ›</a>`);
    const nx = D.events.find((e) => e.type === type && e.date > date);
    if (nx) {
      const ex = nextMeasures.map(([m, n]) => { const c = nextCon(m, date); return c && c.src !== "implied" ? `${n} ${fmtU(m, c.v)}` : null; }).filter(Boolean);
      lines.push(`<b>Next:</b> ${md(nx.date)}${evtMonth(nx.label) ? ` (${monthName(evtMonth(nx.label)).slice(0, 3)} data)` : ""}${ex.length ? ` · expected ${ex.join(", ")}` : ""}`);
    }
    return lines;
  }

  // Inflation：CPI / PCE 由頁面最上面的切換決定
  const IDX = {
    cpi: { name: "CPI", head: "cpi", core: "core_cpi", mm: ["cpi_mm", "core_cpi_mm"], yy: ["cpi_yy", "core_cpi_yy"], type: "cpi" },
    pce: { name: "PCE", head: "pce", core: "core_pce", mm: [null, "core_pce_mm"], yy: [null, "core_pce_yy"], type: "pce" },
  };
  function renderLatestInfl() {
    const X = IDX[S.infIdx], rs = surRows(X.mm[1]), r = rs[rs.length - 1], el = $("#lat-card");
    if (!r) { el.innerHTML = `<p class="hint">Release data load after the next daily update.</p>`; return; }
    $("#lat-title").textContent = `${monthName(r.ref)} ${X.name}, released ${md(r.date)}`;
    const cells = [latCell(`Headline ${X.name}`, "m/m", X.mm[0], X.head, "mm", r.date, r.ref), latCell(`Headline ${X.name}`, "y/y", X.yy[0], X.head, "yy", r.date, r.ref),
      latCell(`Core ${X.name}`, "m/m", X.mm[1], X.core, "mm", r.date, r.ref), latCell(`Core ${X.name}`, "y/y", X.yy[1], X.core, "yy", r.date, r.ref)];
    const lines = latFoot(r.date, X.type, [[X.mm[1], "core"]].concat(X.mm[0] ? [[X.mm[0], "headline"]] : []));
    const c = ser(X.core), a3 = lastV(annK(c, 3)), a6 = lastV(annK(c, 6));
    if (a3) lines.splice(1, 0, `<b>Momentum:</b> core ${X.name} is running at ${a3.v.toFixed(1)}% annualized over 3 months${a6 ? ` (${a6.v.toFixed(1)}% over 6)` : ""}, against the 2% target`);
    const nc = (D.nowcast || []).find((x) => x.month > r.ref && x[X.core] !== "");
    if (nc) lines.push(`<b>Cleveland Fed nowcast</b> for ${monthName(nc.month).slice(0, 3)}: headline ${(+nc[X.head]).toFixed(2)}%, core ${(+nc[X.core]).toFixed(2)}% m/m <span class="muted">(model, from oil prices and data already out)</span>`);
    el.innerHTML = `<div class="lat-grid">${cells.join("")}</div><ul class="lat-foot">${lines.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  }

  // 走勢：headline 和 core 一樣清楚，只有 Y/Y、每月、3 個月年化三種
  const I_VIEWS = { yoy: ["Y/Y", (s) => yoy(s)], mm: ["m/m", (s) => mom(s)], a3: ["3-month pace", (s) => annK(s, 3)] };
  function renderInflation() {
    if (!D.macro.length) return empty("c-infl", "No inflation data yet");
    const X = IDX[S.infIdx], P = palette(), v = I_VIEWS[S.iView] ? S.iView : "yoy", f = I_VIEWS[v][1], mm = v === "mm";
    $("#trend-title").textContent = `Headline and core ${X.name}`;
    $("#infl-date2").innerHTML = dataLine(X.core, X.type, X.name);
    const yrs = mm ? 2 : 5, h = fromYears(f(ser(X.head)), yrs), c = fromYears(f(ser(X.core)), yrs);
    const cH = P[1], cC = P[0];
    const narrow = innerWidth < 600, lg = narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 80 } } : {};
    clearEmpty("c-infl");
    if (mm) {
      const bar = (s, n, col) => ({ ...xy(s), name: n, type: "bar", marker: { color: rgba(col, 0.8) }, hovertemplate: `${n} %{y:.2f}%<extra></extra>` });
      const pace = { x: [null], y: [null], name: "2% a year (0.17% a month)", mode: "lines", line: { color: css("--ink"), width: 1.2, dash: "dash" }, hoverinfo: "skip" };
      plot("c-infl", [bar(h, `Headline ${X.name}`, cH), bar(c, `Core ${X.name}`, cC), pace],
        baseLayout({ barmode: "group", bargap: 0.25, xaxis: { ...baseLayout().xaxis, dtick: "M3", tickformat: "%b '%y", hoverformat: "%b %Y" }, yaxis: pctAxis({ zeroline: true, zerolinecolor: css("--muted") }), ...lg,
          shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: PACE2, y1: PACE2, layer: "above", line: { color: css("--ink"), width: 1.2, dash: "dash" } }] }));
    } else {
      plot("c-infl", [{ ...xy(h), name: `Headline ${X.name}`, line: { color: cH, width: 2.2 }, hovertemplate: "%{y:.2f}%" },
        { ...xy(c), name: `Core ${X.name}`, line: { color: cC, width: 2.2 }, hovertemplate: "%{y:.2f}%" }],
        baseLayout({ yaxis: pctAxis(), xaxis: { ...baseLayout().xaxis, hoverformat: "%b %Y" }, ...hline(2, "2% target"), ...lg }));
    }
  }

  // 這個月誰在漲：每一項自己的 m/m（不是貢獻），點 = 上個月；分 non-core / core，細項縮排
  // [欄位, 標籤, 層級 0 總數 / 1 大塊 / 2 細項, 是否 core, 資料來源]
  const MOVED = {
    cpi: [["cpi", "Headline CPI", 0, 0], ["cpi_food", "Food", 1, 0], ["cpi_energy", "Energy", 1, 0], ["core_cpi", "Core CPI", 0, 1],
      ["cpi_goods", "Goods", 1, 1], ["cpi_usedcars", "Used cars", 2, 1], ["cpi_shelter", "Housing (shelter)", 1, 1], ["cpi_rent", "Rent", 2, 1], ["cpi_oer", "Owners' equivalent rent", 2, 1],
      ["cpi_supercore", "Services ex housing", 1, 1], ["cpi_transvc", "Transport (incl. car insurance)", 2, 1], ["cpi_medsvc", "Medical services", 2, 1], ["cpi_airfare", "Airfares", 2, 1]],
    pce: [["total_p", "Headline PCE", 0, 0, 1], ["food_p", "Food", 1, 0, 1], ["energy_p", "Energy", 1, 0, 1], ["core_p", "Core PCE", 0, 1, 1],
      ["core_goods_p", "Goods", 1, 1, 1], ["housing_p", "Housing", 1, 1, 1], ["pce_supercore", "Services ex housing", 1, 1, 0],
      ["health_p", "Health care", 2, 1, 1], ["finsvc_p", "Financial services", 2, 1, 1]],
  };
  function renderMoved() {
    const P = palette(), rows = MOVED[S.infIdx], narrow = innerWidth < 600;
    const sr = (c, pce) => (pce ? pceSer(c) : ser(c));
    const head = mom(sr(rows[0][0], rows[0][4])), l = lastV(head);
    if (!l) return empty("c-moved", "No data yet");
    clearEmpty("c-moved");
    const month = l.date, prev = mBack(month, 1);
    $("#moved-title").textContent = `What moved in ${monthName(month)}`;
    const data = rows.map(([c, n, lv, core, pce]) => { const m = new Map(mom(sr(c, pce)).map((p) => [p.date, p.v])), y = new Map(yoy(sr(c, pce)).map((p) => [p.date, p.v]));
      const short = { "Transport (incl. car insurance)": "Transport svcs", "Owners' equivalent rent": "Owners' eq. rent", "Housing (shelter)": "Shelter", "Financial services": "Financial svcs", "Services ex housing": "Svcs ex housing" };
      if (narrow && short[n]) n = short[n];
      return { n: (lv === 2 ? "   · " : lv === 1 ? " · " : "") + n, lv, core, v: m.get(month), p: m.get(prev), y: y.get(month) }; }).filter((d) => d.v != null);
    // 軸：能源、機票一個月可以 ±5%，會把其他壓扁 → 軸最多 ±1.2，超過的柱子在邊緣標數字
    const vals = data.filter((d) => d.lv < 2 && !/Energy/.test(d.n)).flatMap((d) => [d.v, d.p]).filter((x) => x != null);
    const hi = Math.min(1.2, Math.max(0.6, ...vals) * 1.25), lo = Math.max(-1.2, Math.min(-0.2, ...vals) * 1.25);
    const col = (d) => (d.lv === 0 ? css("--ink") : !d.core ? css("--muted") : d.lv === 1 ? P[0] : rgba(P[0], 0.45));
    const clip = (x) => Math.max(lo, Math.min(hi, x));
    const lab = data.map((d) => d.n);
    const tr = [{ type: "bar", orientation: "h", y: lab, x: data.map((d) => clip(d.v)), marker: { color: data.map(col) }, name: monthName(month),
      text: data.map((d) => (d.v > hi || d.v < lo ? `${d.v > 0 ? "+" : ""}${d.v.toFixed(2)}% ▸` : "")), textposition: "inside", insidetextanchor: "end", textfont: { color: "#fff", size: 11 },
      customdata: data.map((d) => `<b>${d.n.replace(/[ ·]+\s?/g, "")}</b><br>${monthName(month)}: ${d.v > 0 ? "+" : ""}${d.v.toFixed(3)}% m/m<br>${monthName(prev)}: ${d.p == null ? "–" : (d.p > 0 ? "+" : "") + d.p.toFixed(3) + "%"}<br>Y/Y: ${d.y == null ? "n/a" : d.y.toFixed(1) + "%"}`),
      hovertemplate: "%{customdata}<extra></extra>" },
      { type: "scatter", mode: "markers", y: lab, x: data.map((d) => (d.p == null ? null : clip(d.p))), name: monthName(prev), marker: { symbol: "circle-open", size: 9, color: css("--ink"), line: { width: 1.6 } }, hoverinfo: "skip" },
      { x: [null], y: [null], name: "2% a year pace", mode: "lines", line: { color: css("--ink"), width: 1.2, dash: "dash" }, hoverinfo: "skip" }];
    plot("c-moved", tr, baseLayout({ hovermode: "closest", hoverlabel: { ...baseLayout().hoverlabel, align: "left" }, bargap: 0.3, margin: { l: narrow ? 120 : 210, r: 14, t: narrow ? 52 : 30, b: 36 },
      legend: { ...baseLayout().legend, y: 1.0, yanchor: "bottom" },
      xaxis: { ...baseLayout().xaxis, range: [lo, hi], ticksuffix: "%", zeroline: true, zerolinecolor: css("--muted"), tickformat: ".1f" },
      yaxis: { ...baseLayout().yaxis, type: "category", autorange: "reversed", showgrid: false, tickfont: { color: css("--ink"), size: 12.5 } },
      shapes: [{ type: "line", yref: "paper", y0: 0, y1: 1, x0: PACE2, x1: PACE2, line: { color: css("--ink"), width: 1.2, dash: "dash" } }] }));
    $("#moved-date").innerHTML = `<span class="muted">${monthName(month)} vs ${monthName(prev)}, m/m · ${S.infIdx === "pce" ? "BEA" : "BLS"}</span>`;
  }

  // ---------- Jobs 卡片 ----------
  function renderLatestJobs() {
    const rs = surRows("nfp"), r = rs[rs.length - 1], el = $("#jlat-card");
    if (!r) { el.innerHTML = `<p class="hint">Release data load after the next daily update.</p>`; return; }
    $("#jlat-title").textContent = `${monthName(r.ref)} jobs report, released ${md(r.date)}`;
    const cells = [latCell("Payrolls", "jobs added", "nfp", null, "mm", r.date, r.ref), latCell("Unemployment rate", "", "unrate", null, "mm", r.date, r.ref),
      latCell("Wages", "m/m", "ahe_mm", "ahe", "mm", r.date, r.ref), latCell("Wages", "y/y", null, "ahe", "yy", r.date, r.ref)];
    const lines = [];
    if (r.rev2 !== "" && r.rev2 != null) lines.push(`<b>Revisions:</b> the two months before were revised ${bp(+r.rev2, 0)}k in this report`);
    lines.push(...latFoot(r.date, "nfp", [["nfp", "payrolls"], ["unrate", "unemployment"]]));
    el.innerHTML = `<div class="lat-grid">${cells.join("")}</div><ul class="lat-foot">${lines.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  }

  function renderPpi() {
    const P = palette();
    const ppi = fromYears(yoy(ser("ppi")), 5), cppi = fromYears(yoy(ser("core_ppi")), 5);
    plot("c-ppi", [{ ...xy(ppi), name: "PPI final demand YoY", line: { color: P[1], width: 2 } }, { ...xy(cppi), name: "Core PPI YoY", line: { color: P[4], width: 1.6 } }],
      baseLayout({ yaxis: pctAxis() }));
    $("#ppi-date").innerHTML = dataLine("ppi", "ppi", "PPI");
  }

  // PCE 分項（BEA 月資料）：權重 = 上個月名目支出佔整體 PCE 的比例，貢獻 = 權重 × 自己的 m/m
  const pceSer = (k) => ser(k, D.pce);
  const pceShare = (k, base = "total_n") => new Map(D.pce.filter((r) => r[k] && r[base]).map((r) => [r.date, +r[k] / +r[base]]));
  // core YoY 拆成三塊的貢獻（百分點）：權重 × 各自的 YoY，疊起來 ≈ core YoY（菱形）
  // 賣方圖表集最常見的畫法：一眼看出「3% 裡有幾點是服務」，以及是哪一塊在變
  const YOY_HINT = {
    pce: "What core PCE inflation is made of, last 5 years. Each bar is a block's share of core spending a year earlier times its own YoY, in percentage points; stacked, they add up to about core PCE YoY (diamond). Services are about three quarters of core, so they are most of the bar even when their inflation is steady; watch which block is changing.",
    cpi: "What core CPI inflation is made of, last 5 years. Each bar is a block's weight in core CPI (approximate BLS relative importance) times its own YoY, in percentage points; stacked, they add up to about core CPI YoY (diamond). Shelter is about 44% of core CPI, so it is a much bigger block than in PCE.",
  };
  function renderCoreYoy(idx) {
    const P = palette(), narrow = innerWidth < 600, id = "c-coreyoy";
    $("#coreyoy-hint").textContent = YOY_HINT[idx];
    let pieces, core;
    if (idx === "cpi") {
      core = yoy(ser("core_cpi"));
      pieces = [["cpi_goods", "Core goods", 19.3], ["cpi_shelter", "Shelter", 35.4], ["cpi_supercore", "Services ex shelter (supercore)", 25.3]].map(([c, n, w]) => [n, yoy(ser(c)).map((p) => ({ date: p.date, v: (p.v * w) / 80, own: p.v }))]);
    } else {
      core = yoy(pceSer("core_p"));
      const part = (k) => { const w = pceShare(k + "_n", "core_n"); return yoy(pceSer(k + "_p")).filter((p) => w.has(mBack(p.date, 12))).map((p) => ({ date: p.date, v: p.v * w.get(mBack(p.date, 12)), own: p.v })); };
      const svc = new Map(part("core_svc").map((p) => [p.date, p])), hs = part("housing");
      const sup = hs.filter((p) => svc.has(p.date)).map((p) => ({ date: p.date, v: svc.get(p.date).v - p.v, own: null }));
      const so = new Map(yoy(ser("pce_supercore")).map((p) => [p.date, p.v])); sup.forEach((p) => (p.own = so.get(p.date)));
      pieces = [["Core goods", part("core_goods")], ["Housing", hs], ["Services ex housing (supercore)", sup]];
    }
    clearEmpty(id);
    const tr = pieces.map(([n, s], i) => { const f = fromYears(s, 5); return { x: f.map((p) => p.date), y: f.map((p) => p.v), customdata: f.map((p) => p.own), name: n, type: "bar", marker: { color: P[i] },
      hovertemplate: `${n.split(" (")[0]} %{y:.2f}pt (itself %{customdata:.1f}% YoY)<extra></extra>` }; });
    const c = fromYears(core, 5);
    tr.push({ ...xy(c), name: `Core ${idx.toUpperCase()} YoY`, mode: "markers", marker: { symbol: "diamond", size: 6, color: css("--ink") }, hovertemplate: "Core %{y:.2f}%<extra></extra>" });
    const nb = narrow ? { legend: { ...baseLayout().legend, y: -0.1, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 110 } } : {};
    plot(id, tr, baseLayout({ ...nb, barmode: "relative", bargap: 0.15, hovermode: "x unified", yaxis: { ...baseLayout().yaxis, ticksuffix: "pt", zeroline: true, zerolinecolor: css("--muted") }, ...hline(2, "2% target") }));
  }
  // core CPI − core PCE 的差距拆成幾塊（YoY，百分點）：每塊 = CPI 權重 × CPI 漲幅 − PCE 權重 × PCE 漲幅
  // CPI 權重是 BLS relative importance 的近似值（佔 core 的比例）；PCE 權重用一年前的名目支出佔 core 的比例
  // 醫療用 CPI 醫療「服務」：PCE 的 health care 只有服務，藥品算在商品裡（兩邊的 core goods 都含藥品，不重複算）
  const CPI_W = { shelter: 35.4 / 80, medsvc: 6.8 / 80, goods: 19.3 / 80 };
  function gapPieces() {
    const c = new Map(yoy(ser("core_cpi")).map((p) => [p.date, p.v])), pce = yoy(ser("core_pce"));
    const ys = (s) => new Map(yoy(s).map((p) => [p.date, p.v]));
    const sh = ys(ser("cpi_shelter")), md_ = ys(ser("cpi_medsvc")), cg = ys(ser("cpi_goods")), hs = ys(pceSer("housing_p")), hc = ys(pceSer("health_p")), fn = ys(pceSer("finsvc_p")), pg = ys(pceSer("core_goods_p"));
    const wH = pceShare("housing_n", "core_n"), wC = pceShare("health_n", "core_n"), wF = pceShare("finsvc_n", "core_n"), wG = pceShare("core_goods_n", "core_n");
    return pce.filter((p) => c.has(p.date)).map((p) => {
      const d = p.date, d12 = mBack(d, 12), gap = c.get(d) - p.v;
      const ok = [sh, md_, cg, hs, hc, fn, pg].every((m) => m.has(d)) && [wH, wC, wF, wG].every((m) => m.has(d12));
      if (!ok) return { date: d, gap };
      const housing = CPI_W.shelter * sh.get(d) - wH.get(d12) * hs.get(d);
      const health = CPI_W.medsvc * md_.get(d) - wC.get(d12) * hc.get(d);
      const goods = CPI_W.goods * cg.get(d) - wG.get(d12) * pg.get(d);
      const fin = -wF.get(d12) * fn.get(d);
      return { date: d, gap, housing, health, goods, fin, other: gap - housing - health - goods - fin,
        info: { cpiSh: sh.get(d), pceHs: hs.get(d), cpiMed: md_.get(d), pceHc: hc.get(d), cpiG: cg.get(d), pceG: pg.get(d), pceFin: fn.get(d) } };
    });
  }

  // CPI vs PCE：core 的差距（歷史上 CPI 比較高），放在收合的 Deep dive 裡
  function renderWedge() {
    const P = palette(), narrow = innerWidth < 600;
    const lg = narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 90 } } : {};
    clearEmpty("c-wedge");
    {
      const all = gapPieces();
      const base = all.filter((p) => p.date >= "2000-01-01" && p.date < "2020-01-01"), avg = base.reduce((a, p) => a + p.gap, 0) / (base.length || 1);
      const g = fromYears(all, 10).filter((p) => p.housing != null), l = lastV(all);
      $("#wedge-hint").textContent = "Core CPI YoY minus core PCE YoY (diamond), split into what causes it. Each block is the item's weight in core CPI times its CPI inflation, minus its weight in core PCE times its PCE inflation, in percentage points. Housing: shelter is about 44% of core CPI but about 17% of core PCE, so when rents run hot CPI runs above PCE, and when they cool the gap shrinks. Health care: a small CPI item (out-of-pocket only) but about a fifth of core PCE (it counts what employers and Medicare pay). Core goods: about a quarter of both, so this block only shows up when the two measure goods prices differently (PCE goods include drugs paid for by insurers, for example). Financial services: almost only in PCE, and portfolio management fees rise with the stock market, which pushes PCE up. Other services + formula is what is left: transport (including car insurance, much bigger in CPI), recreation, restaurants, education and so on, plus the difference between CPI's fixed basket and PCE's chained formula. CPI averaged " + avg.toFixed(2) + "pt above PCE in 2000-19.";
      const PIECES = [["housing", "Housing (shelter weight)"], ["health", "Health care services"], ["goods", "Core goods"], ["fin", "Financial services (PCE only)"], ["other", "Other services + formula"]];
      const cols = [P[1], P[2], P[3], P[0], css("--muted")];
      const tr = PIECES.map(([k, n], i) => ({ x: g.map((p) => p.date), y: g.map((p) => p[k]), name: n, type: "bar", marker: { color: rgba(cols[i], 0.8) }, hovertemplate: `${n} %{y:+.2f}pt<extra></extra>` }));
      tr.push({ x: g.map((p) => p.date), y: g.map((p) => p.gap), name: "Core CPI − core PCE", mode: "markers", marker: { symbol: "diamond", size: 6, color: css("--ink") }, hovertemplate: "Total gap %{y:+.2f}pt<extra></extra>" });
      const h = hline(avg, ""); h.annotations = [{ xref: "paper", x: 1, y: avg, text: `2000-19 average ${avg >= 0 ? "+" : ""}${avg.toFixed(2)}pt`, showarrow: false, xanchor: "right", yanchor: "bottom", bgcolor: css("--surface"), font: { size: 11, color: css("--muted") } }];
      plot("c-wedge", tr, baseLayout({ barmode: "relative", bargap: 0.15, hovermode: "x unified", yaxis: { ...baseLayout().yaxis, ticksuffix: "pt", zeroline: true, zerolinecolor: css("--muted") }, ...h,
        ...(narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 110 } } : {}) }));
      const lp = lastV(g);
      const sg = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
      $("#wedge-date").innerHTML = lp ? `<span class="muted">${monthName(lp.date)}: gap ${sg(lp.gap)}pt = housing ${sg(lp.housing)} · health care ${sg(lp.health)} · core goods ${sg(lp.goods)} · financial services ${sg(lp.fin)} · other services + formula ${sg(lp.other)}</span>`
        + `<br><span class="muted">Housing YoY: CPI shelter ${lp.info.cpiSh.toFixed(1)}% vs PCE housing ${lp.info.pceHs.toFixed(1)}%. Health care services: CPI ${lp.info.cpiMed.toFixed(1)}% vs PCE ${lp.info.pceHc.toFixed(1)}%. Core goods: CPI ${lp.info.cpiG.toFixed(1)}% vs PCE ${lp.info.pceG.toFixed(1)}%. PCE financial services ${lp.info.pceFin.toFixed(1)}%.</span>`
        : (l ? `<span class="muted">${monthName(l.date)}: ${sg(l.gap)}pt</span>` : "");
    }
  }

  // 兩種 supercore（Breakdown 的 Supercore 鈕）
  function renderSuper() {
    const P = palette(), narrow = innerWidth < 600;
    const lg = narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 90 } } : {};
    clearEmpty("c-super");
    const sc = yoy(ser("cpi_supercore")), sp = yoy(ser("pce_supercore"));
    if (!sp.length) { $("#super-date").innerHTML = ""; return empty("c-super", "PCE supercore loads after the next daily update."); }
    plot("c-super", [{ ...xy(fromYears(sp, 5)), name: "PCE supercore (Fed's)", line: { color: P[0], width: 2.2 }, hovertemplate: "PCE supercore %{y:.2f}%<extra></extra>" },
      { ...xy(fromYears(sc, 5)), name: "CPI supercore (approx.)", line: { color: P[3], width: 1.8 }, hovertemplate: "CPI supercore %{y:.2f}%<extra></extra>" }],
      baseLayout({ yaxis: pctAxis(), ...lg }));
    const l = lastV(sp), lc = lastV(sc);
    $("#super-date").innerHTML = l ? `<span class="muted">PCE supercore ${l.v.toFixed(1)}% (${monthName(l.date)})${lc ? ` · CPI supercore ${lc.v.toFixed(1)}% (${monthName(lc.date)})` : ""}</span>` : "";
  }

  // 通膨預期：5y5y 和 5y breakeven（日），固定看 5 年（Henry 覺得頁面太雜，UMich、10y 和區間鈕拿掉）
  function renderExp() {
    const P = palette(), be = D.be;
    const col = (c) => be.filter((r) => r[c] !== "" && r[c] != null).map((r) => ({ date: r.date, v: +r[c] }));
    const b55 = col("be5y5y"), b5 = col("be5");
    if (!b55.length && !b5.length) return empty("c-exp", "No breakeven data yet");
    clearEmpty("c-exp");
    const end = lastV(b55.length ? b55 : b5).date, start = shiftDays(end, -RANGES["5Y"]), cut = (s) => s.filter((p) => p.date >= start);
    const tr = [];
    if (b55.length) tr.push({ ...xy(cut(b55)), name: "5y5y forward", line: { color: P[0], width: 2.2 }, hovertemplate: "5y5y %{y:.2f}%<extra></extra>", keepFmt: true });
    if (b5.length) tr.push({ ...xy(cut(b5)), name: "5y breakeven", line: { color: P[2], width: 1.6 }, hovertemplate: "5y %{y:.2f}%<extra></extra>", keepFmt: true });
    const narrow = innerWidth < 600;
    plot("c-exp", tr, baseLayout({ yaxis: pctAxis(), ...(narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 100 } } : {}) }));
    const l55 = lastV(b55), l5 = lastV(b5);
    $("#exp-date").innerHTML = `<span class="muted">${l55 ? `5y5y ${l55.v.toFixed(2)}% (${md(l55.date)})` : ""}${l5 ? ` · 5y ${l5.v.toFixed(2)}%` : ""} · FRED T5YIFR, T5YIE</span>`;
  }

  // Jobs 頁：走勢一張圖，切 Payrolls / Unemployment / Wages（新聞報的三個數字）
  const J_HINT = {
    nfp: "Jobs added each month (thousands), last 2 years, with the 3-month average to smooth the noise. Hover a bar for that report's revision to the two months before. With much lower immigration the labor force barely grows, so gains of roughly 0 to 50k a month are enough to keep unemployment steady; judge a print against that, not old norms.",
    u: "The unemployment rate, last 5 years: the Fed's employment target. Open diamonds are the Fed's year-end projection (SEP median). The Sahm rule below has marked the start of every US recession since 1970.",
    wage: "Average hourly earnings, y/y, from the jobs report, last 5 years. The shaded band (3 to 3.5%) is roughly the wage growth consistent with 2% inflation once productivity is counted. More wage measures are under More.",
  };
  function renderJobs() {
    if (!D.macro.length) return empty("c-jobs", "No jobs data yet");
    const P = palette(), v = J_HINT[S.jView] ? S.jView : "nfp", narrow = innerWidth < 600;
    $("#j-hint").textContent = J_HINT[v];
    $("#jobs-date2").innerHTML = dataLine("unrate", "nfp", "jobs report");
    const sh = ser("sahm"), s0 = lastV(sh);
    $("#sahm").hidden = v !== "u";
    $("#sahm").innerHTML = s0 ? `<span class="light ${s0.v >= 0.5 ? "on" : s0.v >= 0.3 ? "warn" : ""}"></span> Sahm rule <b class="num">${s0.v.toFixed(2)}</b> `
      + `<span class="muted">(${monthName(s0.date)}). It triggers at 0.5: the 3-month average unemployment rate rising 0.5pt above its 12-month low.</span>` : "";
    clearEmpty("c-jobs");
    if (v === "nfp") {
      const pay = diff(ser("payems")), p24 = pay.slice(-24), a3 = avgK(pay, 3).slice(-24);
      const rev = new Map(D.rel.filter((r) => r.measure === "nfp" && r.rev2 !== "").map((r) => [r.ref, +r.rev2]));
      const revTxt = p24.map((p) => (rev.has(p.date) ? `<br>Prior 2 months revised ${rev.get(p.date) > 0 ? "+" : ""}${rev.get(p.date)}k in this report` : ""));
      plot("c-jobs", [{ ...xy(p24), name: "Jobs added", type: "bar", marker: { color: rgba(P[0], 0.75) }, customdata: revTxt, hovertemplate: "%{y:+.0f}k%{customdata}" },
        { ...xy(a3), name: "3-month average", line: { color: css("--ink"), width: 2 }, hovertemplate: "%{y:+.0f}k" }],
        baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "k", zeroline: true, zerolinecolor: css("--muted") }, xaxis: { ...baseLayout().xaxis, tickformat: "%b %y" } }));
    } else if (v === "u") {
      const u = fromYears(urate(), 5), tr = [{ ...xy(u), name: "Unemployment rate", line: { color: P[2], width: 2.2 }, hovertemplate: "%{y:.1f}%" }];
      const su = sepTrace("unrate", "Fed projection", P[2], lastV(u) ? lastV(u).date : null); if (su) tr.push(su);
      plot("c-jobs", tr, baseLayout({ yaxis: pctAxis(), ...(narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 70 } } : {}) }));
    } else {
      const w = fromYears(yoy(ser("ahe")), 5);
      plot("c-jobs", [{ ...xy(w), name: "Average hourly earnings, y/y", line: { color: P[4], width: 2.2 }, hovertemplate: "%{y:.2f}%" }],
        baseLayout({ yaxis: pctAxis(), shapes: [{ type: "rect", xref: "paper", x0: 0, x1: 1, y0: 3, y1: 3.5, fillcolor: rgba(P[0], 0.12), line: { width: 0 }, layer: "below" }] }));
    }
    // More 裡的：參與率 / prime-age 就業率
    const narrowLg = narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 90 } } : {};
    plot("c-part", [{ ...xy(fromYears(ser("civpart"), 5)), name: "Participation rate", line: { color: P[0], width: 2 }, hovertemplate: "%{y:.1f}%", keepFmt: true },
      { ...xy(fromYears(ser("epop_prime"), 5)), name: "Prime-age (25-54) employment rate (right)", yaxis: "y2", line: { color: P[2], width: 2 }, hovertemplate: "%{y:.1f}%", keepFmt: true }],
      baseLayout({ margin: { l: 48, r: 52, t: 10, b: narrow ? 90 : 40 }, yaxis: pctAxis(), yaxis2: { ...pctAxis(), overlaying: "y", side: "right", showgrid: false }, ...(narrow ? { legend: narrowLg.legend } : {}) }));

    // 工資 vs 服務通膨：三種工資量法 + supercore CPI，都是 YoY
    const ahe = ser("ahe"), eci = yoy(ser("eci_wag")), atl = ser("atl_wage"), sc = yoy(ser("cpi_supercore"));
    const wt = [{ ...xy(fromYears(yoy(ahe), 5)), name: "Avg hourly earnings", line: { color: P[4], width: 2 }, hovertemplate: "AHE %{y:.1f}%<extra></extra>" }];
    if (eci.length) wt.push({ ...xy(fromYears(eci, 5)), name: "ECI wages (quarterly)", mode: "lines+markers", line: { color: P[0], width: 2 }, marker: { size: 6 }, hovertemplate: "ECI %{y:.1f}%<extra></extra>" });
    if (atl.length) wt.push({ ...xy(fromYears(atl, 5)), name: "Atlanta Fed wage tracker", line: { color: P[2], width: 2 }, hovertemplate: "Atlanta Fed %{y:.1f}%<extra></extra>", keepFmt: true });
    wt.push({ ...xy(fromYears(sc, 5)), name: "Supercore CPI", line: { color: css("--muted"), width: 1.6, dash: "dash" }, hovertemplate: "Supercore %{y:.1f}%<extra></extra>" });
    plot("c-ahe", wt, baseLayout({ yaxis: pctAxis(), ...(narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 40, r: 12, t: 10, b: 110 } } : {}) }));
    $("#wage-date").innerHTML = [["ahe", "AHE"], ["eci_wag", "ECI"], ["atl_wage", "Atlanta Fed"]].map(([c, n]) => { const l = lastV(ser(c)); return l ? `${n} ${c === "eci_wag" ? "Q" + (Math.floor((+l.date.slice(5, 7) - 1) / 3) + 1) + " " + l.date.slice(0, 4) : monthName(l.date)}` : ""; }).filter(Boolean).join(" · ");

    const cl = D.claims.filter((r) => r.icsa !== "").map((r) => ({ date: r.date, v: r.icsa / 1000 })), c2 = fromYears(cl, 2);
    // continuing claims（百萬人，右軸）晚一週
    const cc = fromYears(D.claims.filter((r) => r.ccsa).map((r) => ({ date: r.date, v: r.ccsa / 1e6 })), 2);
    plot("c-claims", [{ ...xy(c2), name: "Initial, weekly", line: { color: rgba(P[1], 0.55), width: 1.2 }, hovertemplate: "Initial %{y:.0f}k<extra></extra>" },
      { ...xy(fromYears(avgK(cl, 4), 2)), name: "Initial, 4-week average", line: { color: P[1], width: 2.2 }, hovertemplate: "4-wk avg %{y:.0f}k<extra></extra>" },
      ...(cc.length ? [{ ...xy(cc), name: "Continuing (right)", yaxis: "y2", line: { color: P[3], width: 1.8, dash: "dot" }, hovertemplate: "Continuing %{y:.2f}m<extra></extra>" }] : [])],
      baseLayout({ margin: { l: 48, r: 52, t: 10, b: 40 }, yaxis: { ...baseLayout().yaxis, ticksuffix: "k" }, yaxis2: { ...baseLayout().yaxis, ticksuffix: "m", tickformat: ".2f", overlaying: "y", side: "right", showgrid: false } }));
    const c0 = lastV(cl), cc0 = lastV(cc);
    $("#claims-date").innerHTML = c0 ? `<span class="muted">Initial ${c0.v.toFixed(0)}k, week ending ${md(c0.date)}${cc0 ? ` · continuing ${cc0.v.toFixed(2)}m, week ending ${md(cc0.date)}` : ""} · released every Thursday</span>` : "";

    // JOLTS：職缺 ÷ 失業人數（V/U，左軸）和離職率（右軸）
    const un = new Map(ser("unemploy").map((p) => [p.date, p.v]));
    const vu = fromYears(ser("jolts").filter((p) => un.get(p.date)).map((p) => ({ date: p.date, v: p.v / un.get(p.date) })), 10);
    const qr = fromYears(ser("quits_rate"), 10);
    if (!vu.length && !qr.length) empty("c-jolts", "No JOLTS data yet");
    else clearEmpty("c-jolts"), plot("c-jolts", [
      { ...xy(vu), name: "Openings per unemployed", line: { color: P[0], width: 2 }, hovertemplate: "V/U %{y:.2f}<extra></extra>" },
      { ...xy(qr), name: "Quits rate (right)", yaxis: "y2", line: { color: P[2], width: 1.8 }, hovertemplate: "Quits %{y:.1f}%<extra></extra>", keepFmt: true }],
      baseLayout({ margin: { l: 44, r: 52, t: 10, b: 40 }, yaxis: { ...baseLayout().yaxis, tickformat: ".1f" },
        yaxis2: { ...pctAxis(), overlaying: "y", side: "right", showgrid: false },
        shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css("--muted"), width: 1, dash: "dot" } }] }));
    const j0 = lastV(vu), q0 = lastV(qr);
    $("#jolts-date").innerHTML = j0 || q0 ? `<span class="muted">${[j0 && `V/U ${j0.v.toFixed(2)}`, q0 && `quits ${q0.v.toFixed(1)}%`].filter(Boolean).join(" · ")} (${monthName((j0 || q0).date)}) · JOLTS runs about two months behind</span>` : "";
  }

  // Rates 頁：10y 拆成 實質利率 + breakeven，或 預期短率路徑 + term premium（Kim-Wright）
  const D_HINT = {
    be: "The 10y yield splits into the real yield (TIPS) and breakeven inflation. When the long end moves, this shows whether it is the market's inflation expectations or the real rate doing the work.",
    tp: "The other way desks split the 10y: the average short rate the market expects over ten years (the Fed path) plus the term premium, the extra yield investors want for locking money up that long (worries about deficits, supply, inflation risk). This uses the Fed Board's Kim-Wright model, published on FRED with about a week's lag; the NY Fed's ACM model is the other common estimate and gives similar moves. A rise in the 10y with the expected path flat is a term premium story, usually supply or fiscal; a rise led by the path is about the Fed.",
  };
  function renderDecomp() {
    $("#decomp-hint").textContent = D_HINT[S.dView];
    const tp = S.dView === "tp";
    const [ka, kb] = tp ? ["kw_tp10", "kw_fit10"] : ["real10", "be10"];
    const be = D.be.filter((r) => r[ka] !== "" && r[kb] !== "" && r[ka] != null && r[kb] != null);
    if (!be.length) { $("#decomp-table").innerHTML = ""; return empty("c-decomp", tp ? "Term premium data load after the next daily update." : "No breakeven data yet"); }
    const P = palette(), rows = inRange(be, "date", S.dRange);
    // tp 視圖：底下 = 預期短率（擬合 − TP），上面 = TP；兩塊相加 = Kim-Wright 擬合的 10y
    const parts = tp ? [["Expected short-rate path", (r) => +r.kw_fit10 - +r.kw_tp10], ["Term premium", (r) => +r.kw_tp10]]
      : [["Real yield (TIPS)", (r) => +r.real10], ["Breakeven inflation", (r) => +r.be10]];
    const nom = rows.map((r) => { const y = D.yields[yIdx[r.date]]; return y ? num(y["10y"]) : null; });
    clearEmpty("c-decomp");
    plot("c-decomp", [
      { x: rows.map((r) => r.date), y: rows.map(parts[0][1]), name: parts[0][0], stackgroup: "a", line: { color: P[0], width: 0.5 }, fillcolor: rgba(P[0], 0.35), hovertemplate: "%{y:.2f}%" },
      { x: rows.map((r) => r.date), y: rows.map(parts[1][1]), name: parts[1][0], stackgroup: "a", line: { color: P[1], width: 0.5 }, fillcolor: rgba(P[1], 0.3), hovertemplate: "%{y:.2f}%" },
      { x: rows.map((r) => r.date), y: nom, name: "10y nominal", line: { color: css("--ink"), width: 1.6 }, hovertemplate: "%{y:.2f}%", keepFmt: true },
    ], baseLayout({ yaxis: pctAxis() }));
    const last = be[be.length - 1], short = tp ? ["Path (bp)", "Term premium (bp)"] : ["Real yield (bp)", "Breakeven (bp)"];
    let h = `<table><thead><tr><th>Change since</th><th>10y ${tp ? "fitted" : "nominal"} (bp)</th><th>${short[0]}</th><th>${short[1]}</th><th>Driven by</th></tr></thead><tbody>`;
    [["1W", 7], ["1M", 30], ["3M", 91], ["1Y", 365]].forEach(([k, d]) => {
      const a = atOrBefore(be, "date", shiftDays(last.date, -d)); if (!a) return;
      const dr = (parts[0][1](last) - parts[0][1](a)) * 100, db = (parts[1][1](last) - parts[1][1](a)) * 100;
      const who = Math.abs(dr) + Math.abs(db) < 3 ? "little change" : Math.abs(dr) > Math.abs(db) ? (tp ? "Fed path" : "real yield") : (tp ? "term premium" : "inflation expectations");
      h += `<tr><td>${cmpLabel[k] || k}</td><td class="n ${cls(dr + db)}">${bp(dr + db, 0)}</td><td class="n ${cls(dr)}">${bp(dr, 0)}</td><td class="n ${cls(db)}">${bp(db, 0)}</td><td>${who}</td></tr>`;
    });
    $("#decomp-table").innerHTML = `<div class="table-wrap">${h}</tbody></table></div>`
      + (tp ? `<p class="hint note">Kim-Wright fitted 10y (path + term premium) sits close to, not exactly on, the Treasury 10y (black line). FRED THREEFY10, THREEFYTP10, last ${last.date}.</p>`
        : `<p class="hint note">Real + breakeven adds up to the 10y TIPS-implied nominal yield, which sits a few bp from the Treasury 10y (black line). Data from FRED (T10YIE, DFII10), ${last.date}.</p>`);
  }

  // ---------- 數據 surprise：預期（FF / 手動）vs 首次公布（ALFRED） ----------
  // sd = 歷史不夠時用的典型 surprise 大小；sign = +1 代表數字高 = 經濟較熱 / 通膨較高（對利率偏鷹）
  const SM = {
    core_cpi_mm: { name: "Core CPI m/m", unit: "%", dec: 1, page: "inflation", type: "cpi", sd: 0.1, sign: 1 },
    cpi_mm: { name: "CPI m/m", unit: "%", dec: 1, page: "inflation", type: "cpi", sd: 0.1, sign: 1 },
    cpi_yy: { name: "CPI y/y", unit: "%", dec: 1, page: "inflation", type: "cpi", sd: 0.1, sign: 1, base: "cpi_mm", col: "cpi" },
    core_cpi_yy: { name: "Core CPI y/y", unit: "%", dec: 1, page: "inflation", type: "cpi", sd: 0.1, sign: 1, base: "core_cpi_mm", col: "core_cpi", derived: true },
    core_pce_mm: { name: "Core PCE m/m", unit: "%", dec: 1, page: "inflation", type: "pce", sd: 0.1, sign: 1 },
    core_pce_yy: { name: "Core PCE y/y", unit: "%", dec: 1, page: "inflation", type: "pce", sd: 0.1, sign: 1, base: "core_pce_mm", col: "core_pce", derived: true },
    core_ppi_mm: { name: "Core PPI m/m", unit: "%", dec: 1, page: "inflation", type: "ppi", sd: 0.2, sign: 1 },
    ppi_mm: { name: "PPI m/m", unit: "%", dec: 1, page: "inflation", type: "ppi", sd: 0.2, sign: 1 },
    nfp: { name: "Nonfarm payrolls", unit: "k", dec: 0, page: "jobs", type: "nfp", sd: 75, sign: 1 },
    unrate: { name: "Unemployment rate", unit: "%", dec: 1, page: "jobs", type: "nfp", sd: 0.1, sign: -1 },
    ahe_mm: { name: "Avg hourly earnings m/m", unit: "%", dec: 1, page: "jobs", type: "nfp", sd: 0.1, sign: 1 },
    claims: { name: "Initial claims", unit: "k", dec: 0, page: "jobs", type: "claims", sd: 12, sign: -1 },
  };
  const fmtU = (m, v) => (v === "" || v == null || isNaN(v) ? "–" : (+v).toFixed(SM[m].dec) + SM[m].unit);
  // 手動 key 的預期值加一個小 m
  const manTag = (r) => (r && /manual/.test(r.src || "") ? `<sup class="man" title="Entered by hand: ${r.src}">m</sup>`
    : r && r.src === "implied" ? `<sup class="man" title="Implied: the m/m survey applied to the index, compared with 12 months earlier">i</sup>` : "");
  // unrounded（從指數算到小數三位）：只有百分比類指標有；柱子畫這個，公布的四捨五入數字放 hover
  const hasUnr = (r) => r && r.unrounded !== "" && r.unrounded != null;
  const unr = (r) => (hasUnr(r) ? (+r.unrounded).toFixed(3) + "%" : "");
  const fmtS = (m, v) => (v == null || isNaN(v) ? "–" : (v > 0 ? "+" : "") + v.toFixed(SM[m].dec) + SM[m].unit);
  // 預期值：手動的優先；y/y 沒有預期時，用 m/m 預期推算（desk 也是這樣算：12 個月裡 11 個月已知，只差最新一個月）
  function consensus(date, m, ref) {
    const f = (rows) => rows.find((r) => r.date === date && r.measure === m && r.forecast !== "");
    const r = f(D.conManual) || f(D.con);
    if (r) return { v: +r.forecast, src: r.source || "manual" };
    const b = SM[m] && SM[m].base && ref ? consensus(date, SM[m].base) : null;
    const v = b ? impliedYoY(SM[m].col, ref, b.v) : null;
    return v == null ? null : { v, src: "implied" };
  }
  // ref 月的 y/y = 上個月指數 ×（1 + m/m 預期）÷ 12 個月前指數（用目前的指數，過去的季調修正會有幾個 bp 的差）
  function impliedYoY(col, ref, mm) {
    const v = new Map(ser(col).map((p) => [p.date, p.v])), a = v.get(mBack(ref, 1)), b = v.get(mBack(ref, 12));
    return a && b ? +((a * (1 + mm / 100) / b - 1) * 100).toFixed(3) : null;
  }
  // 下一次公布的預期：有直接的就用，y/y 沒有就從 m/m 推算（ref = 指數最後一個月的下一個月）
  function nextCon(m, after) {
    const today = localToday(), first = (mm) => [...D.conManual, ...D.con].filter((c) => c.measure === mm && c.forecast !== "" && c.date >= today && (!after || c.date > after)).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    const c = first(m);
    if (c) return { date: c.date, v: +c.forecast, src: c.source || "" };
    const b = SM[m].base && first(SM[m].base); if (!b) return null;
    const l = lastV(ser(SM[m].col)), v = l ? impliedYoY(SM[m].col, mBack(l.date, -1), +b.forecast) : null;
    return v == null ? null : { date: b.date, v, src: "implied", ref: mBack(l.date, -1) };
  }
  // 某個 measure 的每次公布，舊到新；z = 標準化 surprise（正 = 比預期熱 / 鷹）
  const _sur = {};
  function surRows(m) {
    if (_sur[m]) return _sur[m];
    const rows = D.rel.filter((r) => r.measure === m).map((r) => {
      const c = consensus(r.date, m, r.ref), a = +r.actual, s = c ? +(a - c.v).toFixed(4) : null, re = reaction(r.date);
      return { ...r, actual: a, forecast: c ? c.v : null, src: c ? c.src : "", surprise: s, d2: re ? re.d2 : null, fed: re ? re.fed : null };
    });
    const ss = rows.filter((r) => r.surprise != null).map((r) => r.surprise);
    const sd = ss.length >= 12 ? Math.sqrt(ss.reduce((a, x) => a + x * x, 0) / ss.length) || SM[m].sd : SM[m].sd;
    rows.forEach((r) => (r.z = r.surprise == null ? null : (SM[m].sign * r.surprise) / sd));
    return (_sur[m] = rows);
  }
  const refLabel = (m, ref) => (m === "claims" ? `wk ${md(ref)}` : monthName(ref));
  const zTxt = (z) => (z == null ? "–" : `<span class="${z > 0.05 ? "up" : z < -0.05 ? "down" : ""}">${z > 0 ? "+" : ""}${z.toFixed(1)}σ</span>`);

  // ECO 風格表：每個指標最新一次公布 + 下次已有預期值的
  function ecoTable(measures) {
    const today = localToday();
    let h = "<table><thead><tr><th>Date</th><th>Indicator</th><th>Period</th><th>Survey</th><th>Actual</th><th title='Actual to three decimals, computed from the index levels'>Unrounded</th><th>Prior</th><th>Revised</th><th>Surprise</th><th>2y (bp)</th></tr></thead><tbody>";
    const up = [], last = [];
    measures.forEach((m) => {
      const rs = surRows(m), r = rs[rs.length - 1];
      const nx = nextCon(m, r && r.date);
      if (nx) up.push([nx.date, `<tr class="upcoming"><td class="n">${md(nx.date)}</td><td>${SM[m].name}</td><td class="muted">next</td><td class="n"><b>${fmtU(m, nx.v)}</b>${manTag(nx)}</td><td class="n muted">–</td><td></td><td class="n">${fmtU(m, r ? r.actual : "")}</td><td></td><td></td><td></td></tr>`]);
      else {
        // 還沒有預期：先從 events.json 列出下一次公布日，預期出來（公布當週）會自動換成上面那種
        const ev = D.events.find((e) => e.type === SM[m].type && e.date >= today && (!r || e.date > r.date));
        const ref = ev && evtMonth(ev.label);
        if (ev) up.push([ev.date, `<tr class="upcoming"><td class="n">${md(ev.date)}</td><td>${SM[m].name}</td><td>${ref ? monthName(ref) : ""}</td><td class="n muted" title="The forecast shows up in the week of the release">not out yet</td><td class="n muted">–</td><td></td><td class="n">${fmtU(m, r ? r.actual : "")}</td><td></td><td></td><td></td></tr>`]);
      }
      if (r) last.push([r.date, `<tr><td class="n">${md(r.date)}</td><td>${SM[m].name}</td><td>${refLabel(m, r.ref)}</td><td class="n">${fmtU(m, r.forecast)}${manTag(r)}</td><td class="n"><b>${fmtU(m, r.actual)}</b></td><td class="n muted">${unr(r)}</td>`
        + `<td class="n">${fmtU(m, r.prior)}</td><td class="n">${r.revised !== "" && r.prior !== "" && +r.revised !== +r.prior ? fmtU(m, r.revised) : ""}</td>`
        + `<td class="n">${r.surprise == null ? "–" : fmtS(m, r.surprise) + " · " + zTxt(r.z)}</td><td class="n ${cls(r.d2)}">${bp(r.d2, 1)}</td></tr>`]);
    });
    last.sort((a, b) => (a[0] < b[0] ? 1 : -1));
    up.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return `<div class="table-wrap eco">${h}${up.map((x) => x[1]).join("")}${last.map((x) => x[1]).join("")}</tbody></table></div>`;
  }
  function conStart() { const d = [...D.con, ...D.conManual].map((r) => r.date).sort(); return d[0] || null; }
  const conNote = () => { const s = (D.con.map((r) => r.date).sort()[0]) || null; return `Forecasts come from the ForexFactory weekly calendar${s ? `, collected automatically since ${s}` : ""}. It only lists the current week, so later releases show "not out yet" until their week starts. Forecasts marked <sup class="man">m</sup> were entered by hand from Investing.com's release history (Jan–Sep 2026), each checked against our first-print actual and prior before it went in. Core CPI y/y and Core PCE y/y have no published survey here, so <sup class="man">i</sup> marks a y/y implied from the m/m survey (last month's index × (1 + m/m survey) ÷ the index 12 months earlier), the way desks back out a y/y forecast; it can be a few bp off because past months have since been revised and the m/m survey is rounded to 0.1. Actuals are the first print (ALFRED). σ = surprise in standard deviations, signed so + means hotter / more hawkish than expected.`; };

  // 比預期熱還是冷：柱子 = 公布值 − 預期（跟新聞同精度），熱往上（橘）、冷往下（藍綠）
  // Henry：原本柱子 = 實際、小橫線 = 預期，還要用眼睛比高度，hover 也擠成一行看不懂
  const SUR_PICK = { inflation: () => (S.infIdx === "pce" ? [["core_pce_mm", "Core PCE m/m"]] : [["core_cpi_mm", "Core CPI m/m"], ["cpi_mm", "Headline CPI m/m"]]),
    jobs: () => [["nfp", "Payrolls"], ["unrate", "Unemployment rate"], ["ahe_mm", "Wages m/m"]] };
  function renderSurprisePanel(page) {
    const ms = SUR_PICK[page](), key = page === "inflation" ? "sIn" : "sJob", el = $(`#sur-${page}`); if (!el) return;
    if (!ms.some(([m]) => m === S[key])) S[key] = ms[0][0];
    if (!D.rel.length) { el.innerHTML = `<p class="hint">Release data load after the next daily update.</p>`; return; }
    const m = S[key], dec = SM[m].dec, unit = SM[m].unit, rs = surRows(m).filter((r) => r.forecast != null).slice(-18);
    const all = Object.keys(SM).filter((k) => SM[k].page === page);
    el.innerHTML = (ms.length > 1 ? `<div class="sur-ctl"></div>` : "") + `<p class="sur-line" id="surl-${page}"></p><div class="chart short" id="c-sur-${page}"></div>`
      + fold(`eco-${page}`, "Release table: all indicators, latest and next", ecoTable(all) + `<p class="hint note" style="display:block">${conNote()}</p>`);
    if (ms.length > 1) el.querySelector(".sur-ctl").append(chips("", ms, m, false, (v) => { S[key] = v; renderSurprisePanel(page); }));
    if (!rs.length) return empty(`c-sur-${page}`, "No forecasts collected yet");
    const P = palette(), nb = " ";
    const pad = (s, n) => s + nb.repeat(Math.max(1, n - s.length));
    const f = (v, sign) => (sign && v > 0 ? "+" : "") + (+v).toFixed(dec) + unit;
    const d = rs.map((r) => +(r.actual - r.forecast).toFixed(dec));
    const hov = rs.map((r, i) => [`<b>${refLabel(m, r.ref)} ${SM[m].name}</b> · out ${md(r.date)}`,
      pad("Actual", 10) + f(r.actual, m === "nfp") + (hasUnr(r) ? `${nb}${nb}(${(+r.unrounded).toFixed(3)})` : ""),
      pad("Expected", 10) + f(r.forecast, m === "nfp") + (/manual/.test(r.src) ? " (hand-entered)" : ""),
      pad("Surprise", 10) + (d[i] === 0 ? "in line" : `${d[i] > 0 ? "+" : ""}${d[i].toFixed(dec)}${unit === "k" ? "k" : ""}${nb}${nb}${dirWord(m, d[i])}`),
      r.d2 == null ? "" : pad("2y that day", 12) + `${bp(r.d2, 0)}bp`].filter(Boolean).join("<br>"));
    const colr = d.map((x) => (x === 0 ? css("--muted") : SM[m].sign * x > 0 ? css("--up") : css("--down")));
    // 剛好等於預期的畫一條很矮的灰柱，不然看起來像沒資料
    const span = Math.max(...d.map(Math.abs), unit === "k" ? 20 : 0.1);
    plot(`c-sur-${page}`, [{ x: rs.map((r) => r.date), y: d.map((x) => (x === 0 ? span * 0.03 : x)), base: d.map((x) => (x === 0 ? -span * 0.015 : 0)), type: "bar", marker: { color: colr },
      text: hov, hovertemplate: "%{text}<extra></extra>", textposition: "none", name: "Actual − expected" }],
      baseLayout({ hovermode: "closest", bargap: 0.35, showlegend: false, hoverlabel: { ...baseLayout().hoverlabel, align: "left" }, xaxis: { ...baseLayout().xaxis, tickformat: "%b '%y" },
        yaxis: { ...baseLayout().yaxis, ticksuffix: unit === "k" ? "k" : "", tickformat: unit === "k" ? "d" : ".1f", zeroline: true, zerolinecolor: css("--ink"), zerolinewidth: 1.2, range: [-span * 1.3, span * 1.3] } }));
    const l = rs[rs.length - 1], ld = d[d.length - 1], last4 = d.slice(-4), hot = last4.filter((x) => x > 0).length;
    $(`#surl-${page}`).innerHTML = `Latest (${refLabel(m, l.ref)}): ${f(l.actual, m === "nfp")} vs ${f(l.forecast, m === "nfp")} expected → <b class="${dirCls(m, ld)}">${ld === 0 ? "in line" : dirWord(m, ld)}</b>`
      + ` <span class="muted">· ${dirWord(m, 1)} than expected in ${hot} of the last ${last4.length}</span>`;
  }

  // 首頁卡片：這一類最近一次公布
  function lastSurpriseLine(page) {
    const all = Object.keys(SM).filter((m) => SM[m].page === page && m !== "claims" && !SM[m].derived).flatMap((m) => surRows(m).slice(-1).map((r) => ({ ...r, m })));
    if (!all.length) return "";
    all.sort((a, b) => (a.date < b.date ? 1 : -1));
    const d = all[0].date, same = all.filter((r) => r.date === d);
    return `<div class="sur">● Last release (${md(d)}): ` + same.map((r) => `${SM[r.m].name} <b class="num">${fmtU(r.m, r.actual)}</b>`
      + (r.forecast == null ? "" : ` vs ${fmtU(r.m, r.forecast)} exp. ${zTxt(r.z)}`)).join(" · ") + "</div>";
  }

  // Rates：surprise 指數（類似 Citi）和數據對 2y 的影響
  function allSurprises() { return Object.keys(SM).filter((m) => !SM[m].derived).flatMap((m) => surRows(m).filter((r) => r.z != null).map((r) => ({ ...r, m }))); }
  function renderSurIndex() {
    const el = $("#c-surix"); if (!el) return;
    const all = allSurprises().sort((a, b) => (a.date < b.date ? -1 : 1));
    const note = $("#surix-note");
    if (all.length < 3) { empty("c-surix", `Not enough forecasts yet. The index and scatter fill in as forecasts are collected${conStart() ? ` (since ${conStart()})` : ""}.`); note.textContent = ""; return; }
    clearEmpty("c-surix");
    const P = palette();
    {
      // 照 Citi surprise index 的做法：通膨、就業各一條，每天 = 過去 90 天 surprise 的加權平均（σ），越舊權重越小（半衰期 30 天）
      // 一份報告只算一個代表數字，避免 CPI 和 core CPI 重複算；claims 每週都有，權重給 1/4
      const GROUPS = [["Inflation", ["core_cpi_mm", "core_pce_mm", "core_ppi_mm"], P[3]], ["Jobs and activity", ["nfp", "unrate", "claims"], P[0]]];
      const W = { claims: 0.25 };
      const inG = all.filter((r) => GROUPS.some((g) => g[1].includes(r.m)));
      if (!inG.length) return empty("c-surix", "Not enough forecasts yet.");
      const first = inG[0].date, today = localToday();
      const tr = [];
      GROUPS.forEach(([g, ms, col]) => {
        const rs = all.filter((r) => ms.includes(r.m));
        if (!rs.length) return;
        const xs = [], ys = [];
        for (let d = first; d <= today; d = shiftDays(d, 1)) {
          let sw = 0, sz = 0;
          rs.forEach((r) => { const age = daysBetween(r.date, d); if (age >= 0 && age <= 90) { const w = (W[r.m] || 1) * Math.pow(0.5, age / 30); sw += w; sz += w * r.z; } });
          xs.push(d); ys.push(sw ? +(sz / sw).toFixed(2) : null);
        }
        tr.push({ x: xs, y: ys, name: `${g} surprises`, line: { color: col, width: 2.2 }, connectgaps: false, hoverinfo: "skip" });
        // 每次公布畫一個點，hover 看是哪個數據、差多少
        const at = new Map(xs.map((d, i) => [d, ys[i]]));
        const ev = rs.filter((r) => r.m !== "claims");
        tr.push({ x: ev.map((r) => r.date), y: ev.map((r) => at.get(r.date)), mode: "markers", showlegend: false, marker: { size: 7, color: col, line: { color: css("--surface"), width: 1 } },
          customdata: ev.map((r) => `${SM[r.m].name} (${refLabel(r.m, r.ref)}): actual ${fmtU(r.m, r.actual)} vs forecast ${fmtU(r.m, r.forecast)}, ${r.z > 0 ? "+" : ""}${r.z.toFixed(1)}σ`),
          hovertemplate: `%{customdata}<br>${g} index now %{y:+.2f}σ<extra></extra>` });
      });
      const y2 = D.yields.filter((r) => r.date >= first && r["2y"] !== "");
      tr.push({ x: y2.map((r) => r.date), y: y2.map((r) => +r["2y"]), name: "2y yield (right)", yaxis: "y2", line: { color: css("--muted"), width: 1.4, dash: "dot" }, hovertemplate: "2y %{y:.2f}%<extra></extra>", keepFmt: true });
      const narrow = innerWidth < 600;
      plot("c-surix", tr, baseLayout({ hovermode: "closest", margin: { l: 44, r: 48, t: 10, b: narrow ? 90 : 40 }, ...(narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" } } : {}),
        yaxis: { ...baseLayout().yaxis, ticksuffix: "σ", zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1.5 },
        yaxis2: { ...pctAxis(), overlaying: "y", side: "right", showgrid: false } }));
      note.textContent = "Built the way the Citi surprise index is: one line for inflation data (core CPI, core PCE, core PPI) and one for jobs and activity (payrolls, unemployment, claims). Each line is the average surprise of the last 3 months of releases, in standard deviations, with recent releases counting more. Above zero: data beating forecasts (hotter inflation, stronger jobs), which usually pushes the 2y up. Dots are releases; hover one to see what came out.";
    }
  }

  // ---------- 成長：GDP / GDPNow、零售銷售 control group、工業生產和區域 Fed 調查 ----------
  const qName = (iso) => `Q${Math.floor((+iso.slice(5, 7) - 1) / 3) + 1} ${iso.slice(0, 4)}`;
  // control group = 零售（不含餐飲）− 汽車 − 加油站 − 建材，網站自己減
  const rsControl = () => D.macro.filter((r) => r.rs_xfs && r.rs_mv && r.rs_gas && r.rs_bm).map((r) => ({ date: r.date, v: +r.rs_xfs - +r.rs_mv - +r.rs_gas - +r.rs_bm }));
  function gdpParts() {
    // unrounded：用實質 GDP 水準自己算 q/q 年化（BEA 公布的只到一位小數），算不出來就用公布值
    const lv = new Map((D.gq || []).filter((r) => r.gdp_lvl).map((r) => [r.date, +r.gdp_lvl]));
    const g = (D.gq || []).filter((r) => r.gdp !== "").map((r) => { const a = lv.get(r.date), b = lv.get(mBack(r.date, 3));
      return a && b ? { date: r.date, v: (Math.pow(a / b, 4) - 1) * 100, pub: +r.gdp } : { date: r.date, v: +r.gdp }; });
    const lg = lastV(g), now = (D.gq || []).filter((r) => r.gdpnow !== "" && (!lg || r.date > lg.date)).map((r) => ({ date: r.date, v: +r.gdpnow })).pop() || null;
    return { g, lg, now };
  }
  function nextEvt(type) { const t = localToday(); return D.events.find((e) => e.type === type && e.date >= t); }
  function growthTakeaway() {
    const { lg, now } = gdpParts(), c = mom(rsControl()), lc = lastV(c);
    if (!lg) return "";
    let t = `Real GDP grew ${f1(lg.pub ?? lg.v)}% annualized in ${qName(lg.date)}`;
    t += now ? `; the Atlanta Fed's GDPNow tracks ${f1(now.v)}% for ${qName(now.date)}.` : ".";
    if (lc) {
      const a3 = lastV(avgK(c, 3));
      t += ` Retail sales control group ${lc.v >= 0 ? "rose" : "fell"} ${f1(Math.abs(lc.v))}% in ${monthName(lc.date).slice(0, 3)} (3-month average ${a3 ? (a3.v >= 0 ? "+" : "") + a3.v.toFixed(1) : "–"}%).`;
    }
    return t;
  }
  function gdpTraces(years) {
    const P = palette(), { g, now } = gdpParts(), gs = fromYears(g, years);
    // 季資料畫在季初那天：柱寬固定 2 個月，GDPNow 那根才不會因為只有一個點而變成一條線
    const W = 62 * 864e5;
    const tr = [{ ...xy(gs), name: "Real GDP, q/q annualized", type: "bar", width: gs.map(() => W), marker: { color: gs.map((p) => rgba(P[0], p.v < 0 ? 0.45 : 0.75)) },
      customdata: gs.map((p) => qName(p.date)), hovertemplate: "%{customdata}: %{y:.1f}%<extra></extra>" }];
    if (now) tr.push({ x: [now.date], y: [now.v], width: [W], name: `GDPNow ${qName(now.date)}`, type: "bar", marker: { color: "rgba(0,0,0,0)", line: { color: P[0], width: 2 } },
      hovertemplate: `GDPNow ${qName(now.date)}: %{y:.1f}%<extra></extra>`, keepFmt: true });
    return tr;
  }
  // CBO 潛在 GDP：潛在成長 = 潛在 GDP 的 q/q 年化；output gap = 實質 GDP ÷ 潛在 GDP − 1
  const potLevels = () => (D.gq || []).filter((r) => r.potential).map((r) => ({ date: r.date, v: +r.potential }));
  const potGrowth = () => { const p = potLevels(); return p.slice(1).map((x, i) => ({ date: x.date, v: (Math.pow(x.v / p[i].v, 4) - 1) * 100 })); };
  const outputGap = () => { const pm = new Map(potLevels().map((p) => [p.date, p.v])); return (D.gq || []).filter((r) => r.gdp_lvl && pm.has(r.date)).map((r) => ({ date: r.date, v: (+r.gdp_lvl / pm.get(r.date) - 1) * 100 })); };
  function renderGrowth() {
    const { lg } = gdpParts(), P = palette(), narrow = innerWidth < 600;
    if (!lg) return empty("c-gdp", "Growth data load after the next daily update.");
    clearEmpty("c-gdp");
    $("#growth-take2").textContent = growthTakeaway();
    const n = nextEvt("gdp");
    $("#gdp-date").innerHTML = `<span class="muted">${qName(lg.date)} data${n ? ` · next: ${n.label} on ${md(n.date)}` : ""} · FRED A191RL1Q225SBEA, GDPNOW</span>`;
    const pg = potGrowth(), gap = outputGap(), lgp = lastV(gap), pNow = pg.filter((p) => p.date <= (lg.date > localToday() ? lg.date : localToday())).pop();
    if (pNow || lgp) $("#gdp-date").innerHTML += `<br><span class="muted">${pNow ? `CBO potential growth ${f1(pNow.v)}%` : ""}${pNow && lgp ? " · " : ""}${lgp ? `output gap ${lgp.v >= 0 ? "+" : ""}${lgp.v.toFixed(1)}% in ${qName(lgp.date)}` : ""} · FRED GDPPOT, GDPC1</span>`;
    const lgd = narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 90 } } : {};
    if (S.gdpView === "gap") {
      // output gap：實際 GDP 水準比潛在高（+，偏熱）或低（−，有閒置產能），最近 10 年
      const gs = fromYears(gap, 10);
      if (!gs.length) empty("c-gdp", "Potential GDP loads after the next daily update.");
      else
      plot("c-gdp", [{ ...xy(gs), name: "Output gap (real GDP vs CBO potential)", type: "scatter", mode: "lines", fill: "tozeroy", line: { color: P[0], width: 2 }, fillcolor: rgba(P[0], 0.15),
        customdata: gs.map((p) => qName(p.date)), hovertemplate: "%{customdata}: %{y:+.1f}% of potential<extra></extra>" }],
        baseLayout({ ...lgd, showlegend: true, yaxis: pctAxis({ zeroline: true, zerolinecolor: css("--ink"), zerolinewidth: 1.2 }) }));
    } else {
      const tr = gdpTraces(5), sp = sepTrace("gdp", "Fed projection (Q4/Q4)", css("--ink"), lg.date); if (sp) tr.push(sp);
      // 潛在成長畫到 GDPNow 那季為止（CBO 的預測再往後就不畫）
      const end = tr.length > 1 && tr[1].x ? tr[1].x[0] : lg.date, ps = fromYears(pg, 5).filter((p) => p.date <= end);
      if (ps.length) tr.push({ ...xy(ps), name: "Potential growth (CBO)", mode: "lines", line: { color: css("--ink"), width: 1.5, dash: "dash", shape: "hvh" }, hovertemplate: "Potential %{y:.1f}%<extra></extra>" });
      plot("c-gdp", tr, baseLayout({ ...lgd, barmode: "overlay", bargap: 0.25, yaxis: pctAxis({ zeroline: true, zerolinecolor: css("--muted") }) }));
    }

    // 零售銷售：control group m/m（柱）+ headline m/m（點），最近 2 年
    const c = mom(rsControl()).slice(-24), hd = mom(ser("rs_total")).slice(-24);
    plot("c-rs", [{ ...xy(c), name: "Control group m/m", type: "bar", marker: { color: rgba(P[0], 0.75) }, hovertemplate: "Control %{y:+.2f}%<extra></extra>" },
      { ...xy(hd), name: "Headline m/m", mode: "markers", marker: { symbol: "diamond", size: 8, color: css("--ink") }, hovertemplate: "Headline %{y:+.2f}%<extra></extra>" }],
      baseLayout({ bargap: 0.3, yaxis: pctAxis({ zeroline: true, zerolinecolor: css("--muted") }), xaxis: { ...baseLayout().xaxis, tickformat: "%b %y" } }));
    const lc = lastV(c), nr = nextEvt("retail");
    $("#rs-date").innerHTML = lc ? `<span class="muted">${monthName(lc.date)} data${nr ? ` · next ${md(nr.date)}` : ""} · FRED RSAFS, RSXFS less RSMVPD, RSGASS, RSBMGESD</span>` : "";

    // 工業生產 YoY（左）+ Philly / Empire 現況指數（右）
    const ip = fromYears(yoy(ser("indpro")), 5), ph = fromYears(ser("philly"), 5), em = fromYears(ser("empire"), 5);
    plot("c-ip", [{ ...xy(ip), name: "Industrial production YoY", line: { color: P[0], width: 2.2 }, hovertemplate: "IP %{y:.1f}% YoY<extra></extra>" },
      { ...xy(ph), name: "Philly Fed (right)", yaxis: "y2", line: { color: P[2], width: 1.3 }, hovertemplate: "Philly %{y:.1f}<extra></extra>" },
      { ...xy(em), name: "Empire State (right)", yaxis: "y2", line: { color: P[3], width: 1.3 }, hovertemplate: "Empire %{y:.1f}<extra></extra>" }],
      baseLayout({ margin: { l: 44, r: 44, t: 10, b: narrow ? 90 : 40 }, ...(narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" } } : {}),
        yaxis: pctAxis({ zeroline: true, zerolinecolor: css("--muted") }), yaxis2: { ...baseLayout().yaxis, overlaying: "y", side: "right", showgrid: false, zeroline: true, zerolinecolor: rgba(css("--muted"), 0.4) } }));
    const li = lastV(ip), lp = lastV(ph);
    $("#ip-date").innerHTML = li ? `<span class="muted">IP ${monthName(li.date)}${lp ? ` · Philly / Empire ${monthName(lp.date)}` : ""} · FRED INDPRO, GACDFSA066MSFRBPHI, GACDISA066MSFRBNY</span>` : "";
  }

  // Cleveland Fed nowcast：還沒公布 PCE 的月份（通常兩個月），m/m
  // ---------- 分頁：#overview / #rates / #calendar（舊的 #events 也導到 calendar）----------
  const PAGES = ["overview", "rates", "inflation", "jobs", "growth", "calendar"];
  const RENDER = {
    overview: () => { renderHero(); renderRecent(); renderNext(); renderOvCards(); },
    rates: () => { renderRatesTake(); renderYields(); renderFed(); renderCarry(); renderAuctions(); renderFunding(); renderDecomp(); renderFomc(); renderSurIndex(); },
    inflation: () => { renderLatestInfl(); renderInflation(); renderMoved(); renderSurprisePanel("inflation"); renderExp(); if ($("#p-deep").open) { renderCoreYoy(S.infIdx); renderSuper(); renderWedge(); renderPpi(); } },
    jobs: () => { renderLatestJobs(); renderJobs(); renderSurprisePanel("jobs"); },
    growth: () => renderGrowth(),
    calendar: () => renderCalendar(),
  };
  function route() {
    const h = location.hash.slice(1) === "events" ? "calendar" : location.hash.slice(1);
    S.page = PAGES.includes(h) ? h : "overview";
    document.querySelectorAll(".page").forEach((el) => (el.hidden = el.dataset.page !== S.page));
    document.querySelectorAll(".tabs a").forEach((a) => { const on = a.dataset.page === S.page; a.classList.toggle("on", on); on ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"); });
    renderAll();
  }
  // 只畫目前這頁：隱藏的頁面寬度是 0，Plotly 會畫錯
  function renderAll() { RENDER[S.page](); }

  // 刷新資料：靜態網站不能放 GitHub token（誰都看得到），所以按鈕只是開 Actions 頁讓人按 Run workflow。
  // 這頁同時用公開 API（不用 token、每小時 60 次）每 20 秒看那次 run：跑完、Pages 發布新的 meta.json 後自動重新載入。
  let refreshTimer = null;
  function watchRefresh(since) {
    const btn = $("#refresh"), asof = $("#asof"), base = asof.textContent;
    const set = (msg, cls) => { asof.textContent = msg; btn.classList.toggle("busy", cls === "busy"); btn.classList.toggle("fail", cls === "fail"); };
    const stop = (msg, cls) => { clearInterval(refreshTimer); refreshTimer = null; try { sessionStorage.removeItem("refreshSince"); } catch {} set(msg, cls); };
    clearInterval(refreshTimer);
    try { sessionStorage.setItem("refreshSince", since); } catch {}
    async function tick() {
      const age = Date.now() - since;
      try {
        const runs = (await (await fetch("https://api.github.com/repos/henrylin1009/us-rates-monitor/actions/workflows/update.yml/runs?per_page=1", { cache: "no-store" })).json()).workflow_runs || [];
        const run = runs.find((r) => Date.parse(r.created_at) >= since - 120e3);
        if (!run) return age > 10 * 60e3 ? stop(base) : set("Waiting for “Run workflow” on GitHub…", "busy");
        if (run.status !== "completed") return set("Fetching new data…", "busy");
        if (run.conclusion !== "success") return stop("Update failed · see GitHub Actions", "fail");
        const m = await (await fetch("data/meta.json?t=" + Date.now(), { cache: "no-store" })).json();
        // meta.updated 是 fetch.py 寫的 "YYYY-MM-DD HH:MM UTC"：晚於 run 開始 = 這次 run 的資料已上線
        const t = Date.parse((m.updated || "").replace(" UTC", "Z").replace(" ", "T"));
        if (t >= Date.parse(run.created_at) - 60e3) {
          if (m.updated === D.meta.updated) return stop(base);
          stop("New data, reloading…"); return location.reload();
        }
        set("Publishing…", "busy");
      } catch {}
      if (age > 25 * 60e3) stop(base);
    }
    set("Waiting for “Run workflow” on GitHub…", "busy");
    refreshTimer = setInterval(tick, 20e3);
    tick();
  }

  async function main() {
    [D.yields, D.effr, D.path, D.summ, D.macro, D.claims, D.be, D.sep, D.rel, D.con, D.conManual] = await Promise.all(
      ["yields.csv", "effr.csv", "fed_path.csv", "fed_summary.csv", "macro.csv", "claims.csv", "breakeven.csv", "sep.csv", "releases.csv", "consensus.csv", "consensus_manual.csv"].map(load));
    D.pathPart = await load("fed_path_partial.csv").catch(() => []);
    D.pathSr3 = await load("fed_path_sr3.csv").catch(() => []);
    D.bills = await load("bills_ois.csv").catch(() => []);
    D.pce = await load("pce.csv").catch(() => []);
    [D.auct, D.fund, D.gq, D.nowcast] = await Promise.all(["auctions.csv", "funding.csv", "growth_q.csv", "nowcast.csv"].map(load));
    // 近似 tail：high yield − 13:00 的 CBOE 殖利率（bp，正 = tail、負 = stop-through）
    const wi = Object.fromEntries((await load("auctions_wi.csv").catch(() => [])).map((r) => [r.auction_date + r.term, r]));
    D.auct.forEach((r) => { const w = wi[r.auction_date + r.term]; r.tail = w && r.high_yield !== "" ? (num(r.high_yield) - num(w.wi_yield)) * 100 : null; r.wi = w ? num(w.wi_yield) : null; });
    try { D.meta = await (await fetch("data/meta.json", { cache: "no-cache" })).json(); } catch { D.meta = {}; }
    try { D.events = ((await (await fetch("data/events.json", { cache: "no-cache" })).json()).events || []).sort((a, b) => (a.date < b.date ? -1 : 1)); } catch { D.events = []; }
    try { D.meetings = (await (await fetch("data/fomc.json", { cache: "no-cache" })).json()).meetings || []; } catch { D.meetings = []; }
    D.events = [...D.events, ...blackouts(D.meetings)].sort((a, b) => (a.date < b.date ? -1 : 1));
    D.yields.forEach((r, i) => (yIdx[r.date] = i));
    const ly = D.yields[D.yields.length - 1];
    $("#asof").textContent = ly ? `Data as of ${ly.date}` : "No data yet";
    if (D.meta.updated) $("#updated").textContent = ` Last updated: ${D.meta.updated}.`;
    bindSeg("#y-views", "yView", renderYields);
    bindSeg("#f-views", "fView", renderFed);
    bindSeg("#gdp-views", "gdpView", renderGrowth);
    bindSeg("#i-views", "iView", renderInflation);
    bindSeg("#inf-idx", "infIdx", renderAll);
    bindSeg("#d-range", "dRange", renderDecomp);
    bindSeg("#d-views", "dView", renderDecomp);
    bindSeg("#fund-views", "fundView", renderFunding);
    bindSeg("#cr-views", "crView", renderCarry);
    bindSeg("#cr-hz", "crHz", renderCarry);
    bindSeg("#j-views", "jView", renderJobs);
    // Overview 卡片整張可點；在圖上拖曳（縮放）或點到裡面的連結 / 按鈕時不跳頁
    document.querySelectorAll(".panel.go").forEach((el) => {
      let down = null;
      el.addEventListener("pointerdown", (e) => (down = [e.clientX, e.clientY]));
      el.addEventListener("click", (e) => {
        if (e.target.closest("a, button") || (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) || getSelection().toString()) return;
        location.hash = el.dataset.href;
      });
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = el.dataset.href; });
    });
    bindSeg("#fomc-range", "fomcRange", renderFomcChart);
    bindSeg("#fomc-views", "fomcView", renderFomc);
    document.addEventListener("toggle", (e) => {
      const k = e.target.dataset && e.target.dataset.fold; if (k) S.folds[k] = e.target.open;
      // 收起來的次要區塊（PPI、JOLTS）打開時才畫：收著的時候寬度是 0
      if (e.target.classList.contains("more") && e.target.open) renderAll();
    }, true);
    // 說明文字預設收起來：每個區塊標題旁一個「?」，點了才顯示
    document.querySelectorAll(".panel").forEach((panel) => {
      if (!panel.querySelector(":scope > .panel-head .hint:not(.stale), :scope > p.hint")) return;
      const b = document.createElement("button");
      b.type = "button"; b.className = "help-btn"; b.textContent = "?"; b.title = "What am I looking at?";
      b.setAttribute("aria-label", "Show explanation"); b.setAttribute("aria-expanded", "false");
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); b.setAttribute("aria-expanded", panel.classList.toggle("help")); };
      panel.querySelector("h2").appendChild(b);
    });
    $("#cal-all").addEventListener("click", () => { S.calAll = !S.calAll; renderCalendar(); });
    window.addEventListener("hashchange", () => { route(); window.scrollTo(0, 0); });
    route();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!document.documentElement.dataset.theme) { syncThemeBtn(); renderAll(); } });
    $("#theme").addEventListener("click", () => {
      const t = isDark() ? "light" : "dark";
      document.documentElement.dataset.theme = t;
      try { localStorage.setItem("theme", t); } catch {}
      syncThemeBtn(); renderAll();
    });
    syncThemeBtn();
    $("#refresh").addEventListener("click", () => watchRefresh(Date.now()));
    // 重新整理過頁面也接著看同一次 run
    try { const t = +sessionStorage.getItem("refreshSince"); if (t && Date.now() - t < 25 * 60e3) watchRefresh(t); } catch {}
  }
  main();
})();
