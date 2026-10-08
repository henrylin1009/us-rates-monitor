/* US Rates Monitor — 讀 data/*.csv，畫兩張圖 */
(() => {
  "use strict";

  const TENORS = ["1m", "2m", "3m", "4m", "6m", "1y", "2y", "3y", "5y", "7y", "10y", "20y", "30y"];
  const RANGES = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "2Y": 731, "5Y": 1827, "All": 1e6 };
  const D = { yields: [], effr: [], path: [], summ: [], meta: {}, events: [], macro: [], claims: [], be: [], sep: [], rel: [], con: [], conManual: [] };
  const S = {
    page: "overview", yView: "curve", fView: "priced", iView: "yoy", cpiView: "time", iYears: "5", dRange: "1Y", fomcRange: "2Y", fomcView: "past", sIn: "core_cpi_mm", sJob: "nfp",
    tenors: ["2y", "10y", "30y"], range: "1Y",
    curveCmp: ["1W", "1M"], curveCustom: "", curveScrub: null,
    spreads: ["2s10s", "5s30s"], trendFed: [],
    events: ["fomc", "cpi", "nfp"], reactSort: "recent",
    pathCmp: ["1W", "1M"], pricedCmp: ["1W"], pathScrub: null, histMeeting: null, calAll: false, folds: {},
  };

  // ---------- 小工具 ----------
  const $ = (s) => document.querySelector(s);
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
  function plot(id, traces, layout) {
    traces.forEach((t) => { if (t) { t.hovertemplate = fixFmt(t.hovertemplate); t.texttemplate = fixFmt(t.texttemplate); } });
    Object.keys(layout).filter((k) => /^yaxis\d*$/.test(k)).forEach((k) => { const a = layout[k]; if (a && !a.hoverformat && !["date", "category"].includes(a.type)) a.hoverformat = ".2f"; });
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
  };
  const EVT_ORDER = ["fomc", "cpi", "nfp", "pce", "ppi", "minutes"];
  const LOOKAHEAD = 14; // 往後標幾天
  const evtColor = (t) => ({ fomc: css("--ink"), cpi: css("--s4"), nfp: css("--s5"), pce: css("--s3"), ppi: css("--s2"), minutes: css("--muted") }[t]);
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
  function renderNext() {
    const el = $("#next"); if (!el) return;
    // 用瀏覽器的今天（資料是前一個交易日收盤，但「還有幾天」要從真正的今天算）
    const now = new Date(), today = new Date(now.getTime() - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 10), horizon = shiftDays(today, LOOKAHEAD);
    let evs = D.events.filter((e) => e.date >= today && e.date <= horizon);
    if (!evs.length) evs = D.events.filter((e) => e.date >= today).slice(0, 3);
    const A = asofs(), priced = new Map(A.length ? pathOn(A[A.length - 1]).map((r) => [r.meeting, r]) : []);
    el.innerHTML = evs.length ? evs.map((e) => {
      const n = daysBetween(today, e.date), r = e.type === "fomc" ? priced.get(e.date) : null;
      const extra = r ? `<div class="nx-x ${cls(num(r.move_bp))}">priced ${bp(num(r.move_bp), 1)}bp · ${moves(num(r.move_bp))}</div>` : "";
      return `<div class="nx ${e.type}"><div class="nx-d">${dow(e.date)} ${md(e.date)} <span class="muted">· ${n === 0 ? "today" : `in ${n} day${n === 1 ? "" : "s"}`}</span></div>`
        + `<div class="nx-l"><span style="color:${evtColor(e.type)}">${EVT[e.type].glyph}</span> ${e.label}</div>${extra}</div>`;
    }).join("") : `<p class="hint">No scheduled events.</p>`;
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

  function renderHero() {
    const y = D.yields; if (y.length < 2) return;
    const a = y[y.length - 1], b = y[y.length - 2], w = ago(7), P = palette();
    const tk = ratesTakeaway();
    $("#hero-take").textContent = tk.text;
    $("#hero-regime").textContent = tk.regime ? `1W: ${tk.regime}` : "";
    $("#hero-regime").hidden = !tk.regime;

    // 2y、10y 三個月
    const rows = inRange(y, "date", "3M");
    plot("c-mini", ["2y", "10y"].map((t, i) => ({ x: rows.map((r) => r.date), y: rows.map((r) => num(r[t])), name: t, type: "scatter", mode: "lines",
      line: { width: 2, color: P[i] }, hovertemplate: "%{y:.2f}%" })),
      baseLayout({ margin: { l: 40, r: 8, t: 6, b: 28 }, legend: { ...baseLayout().legend, y: 1.12 }, yaxis: { ...baseLayout().yaxis, ticksuffix: "%" } }));

    // 關鍵數字
    const row = (k, lv, d1, d7, unit) => `<tr><td>${k}</td><td class="n">${lv}</td><td class="n ${cls(d1)}">${bp(d1, 1)}</td><td class="n ${cls(d7)}">${bp(d7, 1)}</td></tr>`;
    let h = `<table class="ktab"><thead><tr><th></th><th>Level</th><th>1D bp</th><th>1W bp</th></tr></thead><tbody>`;
    ["2y", "5y", "10y", "30y"].forEach((t) => { h += row(t, num(a[t]) == null ? "–" : num(a[t]).toFixed(2) + "%", chg(a, b, t), chg(a, w, t)); });
    [["2s10s", "2y", "10y"], ["5s30s", "5y", "30y"]].forEach(([k, x, z]) => {
      const s0 = sprd(a, x, z), s1 = sprd(b, x, z), s7 = sprd(w, x, z);
      h += row(k, s0 == null ? "–" : bp(s0, 0) + "bp", s0 == null || s1 == null ? null : s0 - s1, s0 == null || s7 == null ? null : s0 - s7);
    });
    $("#k-table").innerHTML = h + "</tbody></table>";

    // Fed：下 4 次會議累計 bp
    const A = asofs(); if (!A.length) { $("#hero-fed").innerHTML = `<p class="hint">No Fed pricing yet.</p>`; return; }
    const last = A[A.length - 1], pr = pathOn(last).slice(0, 4), cum = pr.map((r) => num(r.cum_bp));
    plot("c-fedbars", [{ x: pr.map((r) => md(r.meeting)), y: cum, type: "bar", marker: { color: cum.map((v) => rgba(css(v >= 0 ? "--up" : "--down"), 0.55)) },
      text: cum.map((v) => bp(v, 0)), textposition: "outside", cliponaxis: false, textfont: { family: "IBM Plex Mono, monospace", size: 11, color: css("--ink") },
      hovertemplate: "%{x}: %{y:+.1f}bp<extra></extra>" }],
      baseLayout({ margin: { l: 40, r: 8, t: 18, b: 28 }, showlegend: false, hovermode: "closest", xaxis: { ...baseLayout().xaxis, type: "category" },
        yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted") } }));
    const f = D.summ[D.summ.length - 1], fA = atOrBefore(D.summ, "asof", shiftDays(f.asof, -7));
    const dYe = fA && fA !== f ? num(f.cum_yearend_bp) - num(fA.cum_yearend_bp) : null;
    let fh = `<div>By year-end: <b class="num">${bp(num(f.cum_yearend_bp), 0)}bp</b> · ${moves(num(f.cum_yearend_bp))}`
      + (dYe == null ? "" : ` · <span class="${cls(dYe)}">${bp(dYe, 0)}bp vs 1W</span>`) + "</div>";
    const s = fomcSurprises().filter((x) => x.surprise != null).pop();
    fh += s ? `<div class="sur">● Last FOMC surprise (${md(s.date)}): <b class="num ${cls(s.surprise)}">${bp(s.surprise, 1)}bp</b> · 2y ${bp(s.d2, 1)}bp</div>`
      : `<div class="sur muted">● Last FOMC surprise: not enough pricing history yet</div>`;
    $("#hero-fed").innerHTML = fh;
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
  // 實際 EFFR（實線）vs 會前一天 price 的利率（菱形）+ 今天 price 的未來路徑（虛線）
  function renderFomcChart() {
    if (!D.effr.length) return empty("c-fomc", "No EFFR data");
    const yrs = { "6M": 0.5, "1Y": 1, "2Y": 2, "5Y": 5 }[S.fomcRange];
    const start = yrs ? shiftDays(D.effr[D.effr.length - 1].date, -Math.round(365.25 * yrs)) : D.effr[0].date;
    const eff = D.effr.filter((r) => r.date >= start && r.effr !== "");
    const ink = css("--ink"), acc = css("--s1"), muted = css("--muted");
    const decTxt = (d) => (d == null ? "–" : d > 0 ? `hike ${d}bp` : d < 0 ? `cut ${-d}bp` : "hold");
    const traces = [{ x: eff.map((r) => r.date), y: eff.map((r) => num(r.effr)), name: "Actual (EFFR)", mode: "lines", line: { color: ink, width: 2, shape: "hv" }, hovertemplate: "%{y:.2f}%<extra>EFFR</extra>" }];
    const sur = fomcSurprises().filter((x) => x.pricedRate != null && x.date >= start);
    if (sur.length) traces.push({
      x: sur.map((x) => x.date), y: sur.map((x) => x.pricedRate), name: "Priced day before", mode: "markers",
      marker: { symbol: "diamond", size: 11, color: acc, line: { color: css("--surface"), width: 1.5 } },
      customdata: sur.map((x) => [decTxt(x.dec), bp(x.priced, 1), x.surprise == null ? "–" : bp(x.surprise, 1)]),
      hovertemplate: "Priced %{y:.2f}% (%{customdata[1]}bp)<br>Decision: %{customdata[0]}<br>Surprise: %{customdata[2]}bp<extra>FOMC</extra>",
    });
    const asof = D.path.length ? D.path[D.path.length - 1].asof : null;
    const fwd = asof ? D.path.filter((x) => x.asof === asof) : [];
    if (fwd.length) {
      const e0 = eff[eff.length - 1];
      traces.push({
        x: [e0.date, ...fwd.map((x) => x.meeting)], y: [num(fwd[0].pre), ...fwd.map((x) => num(x.post))],
        name: `Priced now (${asof})`, mode: "lines+markers", line: { color: acc, width: 2, dash: "dash", shape: "hv" }, marker: { size: 5, color: acc },
        customdata: ["", ...fwd.map((x) => bp(num(x.cum_bp), 1))], hovertemplate: "%{y:.2f}% · %{customdata}bp cum<extra>Priced now</extra>",
      });
    }
    // 每次 FOMC 會議：底部一排標記 + 淡淡的直線。過去的依決定上色（升息紅、降息綠、不動灰），未來的空心
    const lastFwd = fwd.length ? fwd[fwd.length - 1].meeting : null;
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
    let h = "<table><thead><tr><th>Meeting</th><th>Decision</th><th>Priced day before (bp)</th><th>Surprise (bp)</th><th>2y (bp)</th><th>Year-end pricing (bp)</th></tr></thead><tbody>";
    rows.forEach((r) => {
      h += `<tr><td class="n">${r.date}</td><td>${decTxt(r.dec)}</td><td class="n">${r.priced == null ? "–" : bp(r.priced, 1)}</td>`
        + `<td class="n ${cls(r.surprise)}"><b>${r.surprise == null ? "–" : bp(r.surprise, 1)}</b></td>`
        + `<td class="n ${cls(r.d2)}">${bp(r.d2, 1)}</td><td class="n ${cls(r.fed)}">${r.fed == null ? "–" : bp(r.fed, 1)}</td></tr>`;
    });
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
    const upcoming = pathOn(last).map((r) => r.meeting);
    if (!upcoming.includes(S.histMeeting)) S.histMeeting = upcoming[0];
    const mon = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" });
    $("#fomc-controls").append(chips("Meeting", upcoming.map((m) => [m, mon(m)]), S.histMeeting, false, (x) => { S.histMeeting = x; renderFomc(); }));
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
      hovertemplate: `${lab(lo)}%: %{y:.1f}%<extra></extra>`,
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
    past: "The solid line is the actual policy rate (EFFR). Each diamond is the rate futures priced for that meeting the day before; the gap between diamond and line is the surprise. The dashed line is where the market prices the rate today, meeting by meeting. Diamonds along the bottom mark each FOMC meeting: red a hike, green a cut, grey a hold, open ones still ahead. Hover for the decision or what is priced.",
    hist: "Pick an FOMC meeting to see how the odds of each target range after it have shifted day by day (like FedWatch's history). Colours are relative to today's range. For meetings after the next one, read the direction of the shift rather than exact percentages: the split assumes meetings are independent.",
  };
  function renderFomc() {
    $("#fomc-controls").innerHTML = ""; $("#fomc-table").innerHTML = "";
    $("#fomc-hint").textContent = FOMC_HINT[S.fomcView];
    $("#fomc-range").style.display = S.fomcView === "past" ? "" : "none";
    if (S.fomcView === "hist") return renderOddsHistory();
    renderFomcChart(); renderFomcTable();
  }

  // ---------- 圖一：殖利率 ----------
  const Y_HINT = {
    tenor: "Yields by tenor over time. Markers along the bottom are key events; hover to see that day's market reaction. The grey band on the right shows events in the next two weeks. Turn on the Fed overlay to compare the 2y with EFFR and the policy rate futures imply 12 months out: the 2y mostly reflects Fed expectations, so the gap is roughly term premium.",
    curve: "Today's curve against earlier dates (top), and how many bp each tenor moved since the first date picked (bars, Bloomberg GC style). Orange bars = yields up, teal = down. Whether the front or the long end moved more tells bull/bear steepening from flattening. Drag the slider to watch the curve change over time.",
    spread: "Term spreads. Up = steepening, down = flattening; below 0 is inverted.",
  };
  // ---------- 拖的日期拉桿 + 播放鍵 ----------
  // dates：可以拉的日期（最後一個是今天）；i = null 代表今天；onChange(i) 負責重畫圖
  const timers = {};
  function scrubber(el, key, dates, i, onChange, note) {
    clearInterval(timers[key]); timers[key] = null;
    const n = dates.length;
    el.innerHTML = `<div class="scrub"><button type="button" class="play" aria-label="Play">▶</button>`
      + `<input type="range" min="0" max="${n - 1}" step="1" aria-label="Drag date">`
      + `<span class="scrub-date num"></span><button type="button" class="reset">Back to today</button></div>`
      + `<p class="hint">${note || "Drag the slider to see how things changed, or press ▶ to play."}</p>`;
    const range = el.querySelector("input"), dateEl = el.querySelector(".scrub-date"), play = el.querySelector(".play"), reset = el.querySelector(".reset");
    let cur = null;
    const set = (j) => {
      cur = j == null || j >= n - 1 ? null : j;
      range.value = cur == null ? n - 1 : cur;
      dateEl.textContent = cur == null ? dates[n - 1] + " (today)" : dates[cur];
      reset.hidden = cur == null;
      onChange(cur);
    };
    const stop = () => { clearInterval(timers[key]); timers[key] = null; play.textContent = "▶"; play.setAttribute("aria-label", "Play"); };
    range.oninput = () => { stop(); set(+range.value); };
    reset.onclick = () => { stop(); set(null); };
    play.onclick = () => {
      if (timers[key]) return stop();
      let j = cur == null ? 0 : cur;
      const step = Math.max(1, Math.round(n / 500)), ms = Math.min(400, Math.max(40, 20000 / (n / step)));  // 整段大約 20 秒播完
      play.textContent = "❚❚"; play.setAttribute("aria-label", "Pause");
      set(j);
      timers[key] = setInterval(() => { j = Math.min(n - 1, j + step); set(j); if (j >= n - 1) stop(); }, ms);
    };
    set(i);
  }

  function renderYields() {
    clearInterval(timers.y); $("#y-scrub").innerHTML = "";
    const id = "c-yields", ctl = $("#y-controls"); ctl.innerHTML = ""; $("#y-hint").textContent = Y_HINT[S.yView]; $("#y-table").innerHTML = "";
    if (!D.yields.length) return empty(id, "No yield data yet. For the first run, trigger the GitHub Action manually with backfill checked.");
    clearEmpty(id);
    const P = palette(), v = S.yView, rr = () => renderYields();

    if (v === "tenor") {
      ctl.append(chips("Tenors", TENORS.map((t) => [t, t]), S.tenors, true, rr), chips("Overlay", [["fed", "EFFR + ZQ 12m ahead"]], S.trendFed, true, rr), rangeChips("range", rr), eventChips(rr));
      const rows = inRange(D.yields, "date", S.range);
      const tr = TENORS.filter((t) => S.tenors.includes(t)).map((t, i) => ({
        x: rows.map((r) => r.date), y: rows.map((r) => num(r[t])), name: t, type: "scatter", mode: "lines",
        line: { width: 1.8, color: P[i % P.length] }, hovertemplate: "%{y:.2f}%",
      }));
      // 疊 Fed：2y 主要反映對 Fed 的預期，和 EFFR、期貨隱含 12 個月後的利率比，差距大約是 term premium
      if (S.trendFed.includes("fed") && rows.length) {
        const start = rows[0].date, ef = D.effr.filter((r) => r.date >= start && r.effr !== ""), fs = D.summ.filter((r) => r.asof >= start && r.implied_12m !== "");
        tr.push({ x: ef.map((r) => r.date), y: ef.map((r) => num(r.effr)), name: "EFFR", type: "scatter", mode: "lines", line: { color: css("--ink"), width: 1.4, shape: "hv" }, hovertemplate: "%{y:.2f}%" });
        if (fs.length) tr.push({ x: fs.map((r) => r.asof), y: fs.map((r) => num(r.implied_12m)), name: "ZQ-implied 12m ahead", type: "scatter", mode: "lines", line: { color: css("--muted"), width: 1.6, dash: "dash" }, hovertemplate: "%{y:.2f}%" });
      }
      const L = baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "%" } });
      if (rows.length) addEvents(tr, L, rows[0].date);
      plot(id, tr, L);
      renderReactions($("#y-table"));
    }

    if (v === "curve") {
      const Y = D.yields, last = Y[Y.length - 1];
      ctl.append(chips("Compare", Object.keys(cmpDays).map((k) => [k, cmpLabel[k]]), S.curveCmp, true, rr));
      const lab = document.createElement("label"); lab.textContent = "Custom date ";
      const inp = document.createElement("input"); inp.type = "date"; inp.value = S.curveCustom; inp.max = last.date; inp.min = Y[0].date;
      inp.onchange = () => { S.curveCustom = inp.value; rr(); }; lab.appendChild(inp); ctl.append(lab);

      // 拉桿：拖著看曲線一路怎麼變；拖動時今天的曲線變淡當參考
      let lo = Infinity, hi = -Infinity;
      Y.forEach((r) => TENORS.forEach((t) => { const x = num(r[t]); if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } }));
      const yr = [Math.floor(lo * 2) / 2 - 0.25, Math.ceil(hi * 2) / 2 + 0.25];
      const curve = (n, r, w, c, dash, op = 1) => ({
        x: TENORS, y: TENORS.map((t) => num(r[t])), name: n, type: "scatter", mode: "lines+markers", opacity: op,
        line: { width: w, color: c, dash }, marker: { size: w > 2 ? 6 : 4 }, hovertemplate: "%{y:.2f}%", connectgaps: true,
      });
      const draw = (i) => {
        S.curveScrub = i;
        let tr, base = null;
        if (i != null) { tr = [curve("Today " + last.date, last, 1.6, css("--muted"), "solid", 0.45), curve(Y[i].date, Y[i], 2.8, P[0], "solid")]; base = Y[i]; }
        else {
          const snaps = [["Today " + last.date, last, 2.6, P[0], "solid"]];
          // 比較日期照時間由近到遠排；變動 bar 用最近的那一個（沒選就用自訂日期）
          Object.keys(cmpDays).filter((k) => S.curveCmp.includes(k)).forEach((k, j) => {
            const r = k === "1D" ? Y[Y.length - 2] : atOrBefore(Y, "date", shiftDays(last.date, -cmpDays[k]));
            if (r) { snaps.push([`${cmpLabel[k]} ${r.date}`, r, 1.6, P[(j + 1) % P.length], "dot"]); if (!base) base = r; }
          });
          if (S.curveCustom) { const r = atOrBefore(Y, "date", S.curveCustom); if (r) { snaps.push([`Custom ${r.date}`, r, 1.6, P[4], "dash"]); if (!base) base = r; } }
          tr = snaps.map((x) => curve(...x));
        }
        const L = baseLayout({ xaxis: { ...baseLayout().xaxis, type: "category" },
          yaxis: { ...baseLayout().yaxis, ticksuffix: "%", ...(i != null ? { range: yr } : {}) } });
        if (base) {
          // 下面一排：每個天期從比較日到今天變了幾 bp（Bloomberg GC 的排法）
          const ys = TENORS.map((t) => (num(last[t]) == null || num(base[t]) == null ? null : +((num(last[t]) - num(base[t])) * 100).toFixed(1)));
          const d2 = chg(last, base, "2y"), d10 = chg(last, base, "10y");
          tr.push({ x: TENORS, y: ys, yaxis: "y2", type: "bar", showlegend: false, marker: { color: ys.map((x) => rgba(css(x >= 0 ? "--up" : "--down"), 0.7)) },
            text: ys.map((x) => (x == null ? "" : bp(x, 0))), textposition: "outside", cliponaxis: false,
            textfont: { family: "IBM Plex Mono, monospace", size: 10.5, color: css("--muted") }, hovertemplate: `%{x}: %{y:+.1f}bp since ${base.date}<extra></extra>` });
          const lo = Math.min(0, ...ys.filter((x) => x != null)), hi = Math.max(0, ...ys.filter((x) => x != null)), pad = Math.max(4, (hi - lo) * 0.3);
          L.yaxis = { ...L.yaxis, domain: [0.36, 1] };
          L.yaxis2 = { ...baseLayout().yaxis, domain: [0, 0.24], anchor: "x", ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted"), range: [lo - pad, hi + pad], nticks: 3 };
          L.xaxis = { ...L.xaxis, anchor: "y2" };
          L.annotations = [{ xref: "paper", yref: "paper", x: 0, y: 0.27, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 11.5, color: css("--muted") },
            text: `Change since ${base.date} (bp)${d2 == null || d10 == null || innerWidth < 600 ? "" : ` · ${regime(d2, d10)} · 2s10s ${bp(d10 - d2, 0)}bp`}` }];
          L.hovermode = "closest";
        }
        plot(id, tr, L);
      };
      scrubber($("#y-scrub"), "y", Y.map((r) => r.date), S.curveScrub, draw, "Drag the slider to watch the curve change over time, or press ▶ to play. Today's curve stays faint as a reference.");
    }

    if (v === "spread") {
      const defs = { "3m10y": ["3m", "10y"], "2s10s": ["2y", "10y"], "2s5s": ["2y", "5y"], "5s30s": ["5y", "30y"], "10s30s": ["10y", "30y"] };
      ctl.append(chips("Spreads", Object.keys(defs).map((k) => [k, k]), S.spreads, true, rr), rangeChips("range", rr), eventChips(rr));
      const rows = inRange(D.yields, "date", S.range);
      const tr = Object.keys(defs).filter((k) => S.spreads.includes(k)).map((k, i) => ({
        x: rows.map((r) => r.date), y: rows.map((r) => { const a = num(r[defs[k][0]]), b = num(r[defs[k][1]]); return a == null || b == null ? null : (b - a) * 100; }),
        name: k, type: "scatter", mode: "lines", line: { width: 1.8, color: P[i % P.length] }, hovertemplate: "%{y:.0f}bp",
      }));
      const L = baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1 } });
      if (rows.length) addEvents(tr, L, rows[0].date);
      plot(id, tr, L);
      renderReactions($("#y-table"));
    }

  }

  // ---------- 圖二：Fed 定價 ----------
  const F_HINT = {
    priced: "How many bp of hikes (+) or cuts (−) the futures price in at each FOMC meeting, and cumulatively from today. This is the number desks quote (\"1.3 hikes priced by December\") because it is exactly what futures pin down; probabilities need an extra assumption.",
    path: "The implied policy rate after each FOMC meeting. Compare with a week or a month ago to see how much the market has repriced.",
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
    clearInterval(timers.f); $("#f-scrub").innerHTML = "";
    const id = "c-fed", ctl = $("#f-controls"); ctl.innerHTML = ""; $("#f-hint").textContent = F_HINT[S.fView]; $("#f-table").innerHTML = "";
    const A = asofs();
    if (!A.length) return empty(id, "No Fed pricing data yet (it needs ZQ futures prices first).");
    clearEmpty(id);
    const P = palette(), v = S.fView, rr = () => renderFed(), last = A[A.length - 1];
    // ZQ 報價來自 Yahoo，偶爾抓不到：標出 Fed 定價是哪一天的，落後殖利率 2 個交易日以上就提醒
    const behind = D.yields.filter((r) => r.date > last).length;
    $("#f-asof").textContent = `As of ${last}`;
    $("#f-asof").classList.toggle("warn", behind >= 2);
    $("#f-stale").hidden = behind < 2;
    $("#f-stale").textContent = behind >= 2 ? `⚠ ZQ futures prices haven't updated for ${behind} trading days (Yahoo unavailable); showing pricing as of ${last}.` : "";
    const effrNow = num(D.summ[D.summ.length - 1].effr);
    // 拉桿用：y 軸固定在所有日期的範圍，拖的時候才不會跳
    const fedRange = () => {
      let lo = Infinity, hi = -Infinity;
      D.path.forEach((r) => { const x = num(r.post); lo = Math.min(lo, x); hi = Math.max(hi, x); });
      D.effr.filter((r) => r.date >= A[0]).forEach((r) => { const x = num(r.effr); lo = Math.min(lo, x); hi = Math.max(hi, x); });
      return [lo - 0.1, hi + 0.1];
    };
    const fedNote = `Drag the slider to see the expected path as of that day, or press ▶ to play; today's path stays faint as a reference. Fed pricing history starts on ${A[0]}, so the slider only reaches back that far for now and will grow over time.`;

    if (v === "priced") {
      // WIRP 式：每次會議 price 了多少 bp（柱）＋從今天起累計（線），可疊一週 / 一個月前的累計來看 repricing
      ctl.append(chips("Compare", ["1W", "1M"].map((k) => [k, cmpLabel[k]]), S.pricedCmp, true, rr));
      const rows = pathOn(last), x = rows.map((r) => r.meeting), start = rows.length ? num(rows[0].pre) : effrNow;
      const mon = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) + " '" + iso.slice(2, 4);
      const xl = x.map(mon);
      // 舊日期的累計：用那天的會議後隱含利率減今天的起點，同一把尺才比得起來（中間開過會也不會錯位）
      const then = (a, part) => { const m = new Map(pathAt(a, part).map((r) => [r.meeting, num(r.post)])); return x.map((d) => (m.has(d) ? (m.get(d) - start) * 100 : null)); };
      const cmp = [];
      S.pricedCmp.forEach((k) => { const [a, part] = cmpAsof(A, shiftDays(last, -cmpDays[k])); if (a && a !== last) cmp.push([k, a, then(a, part)]); });
      const mv = rows.map((r) => num(r.move_bp)), cum = rows.map((r) => num(r.cum_bp));
      const tr = [
        { x: xl, y: mv, name: "This meeting", type: "bar", marker: { color: mv.map((b) => rgba(css(b >= 0 ? "--up" : "--down"), 0.45)) },
          text: mv.map((b) => (Math.abs(b) >= 5 ? bp(b, 1) : "")), textposition: "inside", insidetextanchor: "end", textfont: { size: 10.5, color: css("--ink") },
          customdata: mv.map((b) => moves(b)), hovertemplate: "This meeting %{y:+.1f}bp (%{customdata})<extra></extra>" },
        ...cmp.map(([k, a, y], j) => ({ x: xl, y, name: `Cumulative ${cmpLabel[k]} (${a})`, type: "scatter", mode: "lines+markers",
          line: { color: [P[3], P[4]][j % 2], width: 1.6, dash: "dot" }, marker: { size: 5 }, hovertemplate: `${cmpLabel[k]}: %{y:+.1f}bp<extra></extra>` })),
        { x: xl, y: cum, name: "Cumulative from today", type: "scatter", mode: "lines+markers+text", line: { color: P[0], width: 2.6 }, marker: { size: 7 },
          text: cum.map((b) => bp(b, 0)), textposition: "top left", cliponaxis: false,
          textfont: { family: "IBM Plex Mono, monospace", size: 11, color: css("--ink") },
          customdata: cum.map((b) => moves(b)), hovertemplate: "Cumulative %{y:+.1f}bp (%{customdata})<extra></extra>" },
      ];
      plot(id, tr, baseLayout({ hovermode: "x unified", xaxis: { ...baseLayout().xaxis, type: "category" },
        yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1 } }));
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

    if (v === "path") {
      ctl.append(chips("Compare", ["1W", "1M", "3M"].map((k) => [k, cmpLabel[k]]), S.pathCmp, true, rr));
      const pathTrace = (a, c, w, dash, op = 1, part = false) => {
        const rows = pathAt(a, part), e0 = num((atOrBefore(D.effr, "date", a) || {}).effr);
        // 部分路徑不畫起點那段（前面幾次會議的合約已到期）
        const x = part ? rows.map((r) => r.meeting) : [a, ...rows.map((r) => r.meeting)], y = part ? rows.map((r) => num(r.post)) : [e0, ...rows.map((r) => num(r.post))];
        return { x, y, customdata: (part ? [] : [[0, 0]]).concat(rows.map((r) => [num(r.cum_bp), num(r.move_bp)])),
          name: (a === last ? "Today " : "") + a + (part && rows.length ? ` (from ${md(rows[0].meeting)} on)` : ""), type: "scatter", mode: "lines+markers", opacity: op, line: { color: c, width: w, dash, shape: "hv" },
          marker: { size: w > 2 ? 7 : 5 }, hovertemplate: "%{y:.3f}% (cumulative %{customdata[0]:+.1f}bp, this meeting %{customdata[1]:+.1f}bp)" };
      };
      const yr = fedRange();
      const draw = (i) => {
        S.pathScrub = i;
        let tr;
        if (i != null) tr = [pathTrace(last, css("--muted"), 1.6, "solid", 0.45), pathTrace(A[i], P[0], 2.6, "solid")];
        else {
          const snaps = [[last, P[0], 2.6, "solid"]];
          S.pathCmp.forEach((k, j) => { const [a, part] = cmpAsof(A, shiftDays(last, -cmpDays[k])); if (a && a !== last) snaps.push([a, P[(j + 1) % P.length], 1.6, "dot", 1, part]); });
          tr = snaps.map((x) => pathTrace(...x));
        }
        // Fed 自己的預測（SEP 點陣圖中位數，目標區間中點），畫在每年年底
        const lastM = pathOn(last).slice(-1)[0], dots = D.sep.filter((r) => r.fedfunds !== "" && `${r.year}-12-31` >= last && (!lastM || `${r.year}-12-31` <= shiftDays(lastM.meeting, 45)));
        if (dots.length) tr.push({ x: dots.map((r) => `${r.year}-12-31`), y: dots.map((r) => +r.fedfunds), name: "Fed dots (SEP median)", mode: "markers",
          marker: { symbol: "diamond-open", size: 11, color: css("--ink"), line: { width: 2 } }, customdata: dots.map((r) => r.year),
          hovertemplate: "%{y:.2f}%: Fed median for end-%{customdata} (midpoint of the target range)<extra></extra>" });
        const L = baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "%", ...(i != null ? { range: yr } : {}) },
          shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: effrNow, y1: effrNow, line: { color: css("--muted"), width: 1, dash: "dash" } }],
          annotations: [{ xref: "paper", x: 1, y: effrNow, text: `EFFR ${effrNow.toFixed(2)}%`, showarrow: false, xanchor: "right", yanchor: "bottom", font: { size: 11, color: css("--muted") } }] });
        plot(id, tr, L);
      };
      scrubber($("#f-scrub"), "f", A, S.pathScrub, draw, fedNote);
      renderTable(pathOn(last));
    }

    if (v === "probs") {
      const rows = pathOn(last), { levels, dists } = levelDist(rows), base = baseRange(last);
      const tr = levels.map((k) => {
        const c = levelColor(k, levels);
        return { x: rows.map((r) => r.meeting), y: dists.map((d) => (d.get(k) || 0) * 100), name: rangeLabel(base, k) + (k === 0 ? " (today)" : ""),
          type: "bar", marker: { color: c, line: { color: css("--surface"), width: 1 } },
          text: dists.map((d) => ((d.get(k) || 0) >= 0.1 ? rangeLabel(base, k, true) + "<br>" + Math.round(d.get(k) * 100) + "%" : "")),
          textposition: "inside", insidetextanchor: "middle", textangle: 0, textfont: { color: Math.abs(k) >= 2 || k === 0 ? "#fff" : css("--ink"), size: 10.5 },
          hovertemplate: `${rangeLabel(base, k)}%: %{y:.1f}%<extra></extra>` };
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
        return `<div class="cal-ev${isF ? " fomc" : ""}${past ? " past" : ""}${e.date === today ? " today" : ""}">`
          + `<span class="cal-d">${d}<small>${isF ? "" : " " + dow(e.date)}</small></span>`
          + `<span class="cal-g" style="color:${evtColor(e.type)}">${EVT[e.type].glyph}</span>`
          + `<span class="cal-l">${e.label}${extra}</span></div>`;
      }).join("") + "</div></div>";
    });
    el.innerHTML = h || `<div class="empty">No upcoming events.</div>`;
    $("#cal-all").textContent = S.calAll ? "Next 3 months" : "Show all";
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
  const sepPts = (col) => D.sep.filter((r) => r[col] !== "").map((r) => ({ date: `${r.year}-12-31`, v: +r[col], year: r.year }));
  // 只畫接下來 2 個年底，太遠的預測會把圖拉太長
  const sepTrace = (col, name, color, after) => {
    const p = sepPts(col).filter((x) => !after || (x.date >= after && x.date <= shiftDays(after, 730)));
    return p.length ? { ...xy(p), name, mode: "markers", marker: { symbol: "diamond-open", size: 10, color, line: { width: 2 } },
      customdata: p.map((x) => x.year), hovertemplate: `%{y:.1f}% (Fed median for end-%{customdata})<extra>${name}</extra>` } : null;
  };
  const hline = (y, text) => ({ shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y, line: { color: css("--muted"), width: 1, dash: "dash" } }],
    annotations: text ? [{ xref: "paper", x: 0, y, text, showarrow: false, xanchor: "left", yanchor: "bottom", font: { size: 11, color: css("--muted") } }] : [] });
  const pctAxis = (extra = {}) => ({ ...baseLayout().yaxis, ticksuffix: "%", ...extra });

  // 一句結論
  function inflTakeaway() {
    const pce = ser("core_pce"); if (pce.length < 13) return "";
    const y = lastV(yoy(pce)).v, a3 = lastV(annK(pce, 3)).v;
    let streak = 0; const ys = yoy(pce); for (let i = ys.length - 1; i >= 0 && ys[i].v >= 2.05; i--) streak++;
    const mom3 = a3 > y + 0.2 ? "running hotter than the yearly rate, so momentum is building" : a3 < y - 0.2 ? "running cooler than the yearly rate, so momentum is easing" : "in line with the yearly rate";
    return `Core PCE is ${f1(y)}% YoY; the 3-month annualized rate is ${f1(a3)}%, ${mom3}.`
      + (streak >= 3 ? ` YoY has been above the 2% target for ${streak} months in a row.` : "");
  }
  function jobsTakeaway() {
    const u = ser("unrate"), p = diff(ser("payems")); if (u.length < 4 || p.length < 3) return "";
    const du = u[u.length - 1].v - u[u.length - 4].v, p3 = lastV(avgK(p, 3)).v;
    const sahm = lastV(ser("sahm"));
    return `Unemployment is ${f1(lastV(u).v)}%, ${Math.abs(du) < 0.05 ? "unchanged" : (du > 0 ? "up " : "down ") + f1(Math.abs(du)) + "pt"} over 3 months; payrolls are adding ${p3.toFixed(0)}k a month on a 3-month average.`
      + (sahm ? ` The Sahm rule reads ${sahm.v.toFixed(2)}${sahm.v >= 0.5 ? ", above the 0.5 recession trigger." : " (trigger is 0.5)."}` : "");
  }

  // 首頁兩張卡
  function renderMacroCards() {
    if (!D.macro.length) { ["#infl-take", "#jobs-take"].forEach((s) => ($(s).textContent = "Inflation and jobs data load after the next daily update.")); return; }
    const P = palette(), pce = yoy(ser("core_pce")), cpi = yoy(ser("core_cpi")), start = shiftDays(lastV(pce).date, -365 * 5);
    $("#infl-take").textContent = inflTakeaway();
    $("#infl-date").innerHTML = dataLine("core_pce", "pce", "PCE");
    const be = D.be.filter((r) => r.be10 !== "").pop();
    $("#infl-k").innerHTML = `<span>Core PCE <b class="num">${f1(lastV(pce).v)}%</b></span><span>Core CPI <b class="num">${f1(lastV(cpi).v)}%</b></span>`
      + (be ? `<span>10y breakeven <b class="num">${(+be.be10).toFixed(2)}%</b></span>` : "") + lastSurpriseLine("inflation");
    const ti = [{ ...xy(pce.filter((p) => p.date >= start)), name: "Core PCE YoY", line: { color: P[0], width: 2 } },
      { ...xy(cpi.filter((p) => p.date >= start)), name: "Core CPI YoY", line: { color: P[3], width: 1.6 } }];
    const sp = sepTrace("core_pce", "Fed projection", P[0], lastV(pce).date); if (sp) ti.push(sp);
    plot("c-infl-mini", ti, baseLayout({ margin: { l: 40, r: 8, t: 34, b: 28 }, yaxis: pctAxis(), ...hline(2, "2% target") }));

    const u = ser("unrate"), uS = u.filter((p) => p.date >= start), pay = diff(ser("payems")), sahm = lastV(ser("sahm"));
    $("#jobs-take").textContent = jobsTakeaway();
    $("#jobs-date").innerHTML = dataLine("unrate", "nfp", "NFP");
    $("#jobs-k").innerHTML = `<span>Unemployment <b class="num">${f1(lastV(u).v)}%</b></span><span>Payrolls <b class="num">${bp(lastV(pay).v, 0)}k</b></span>`
      + (sahm ? `<span>Sahm <b class="num ${sahm.v >= 0.5 ? "up" : ""}">${sahm.v.toFixed(2)}</b></span>` : "") + lastSurpriseLine("jobs");
    const tj = [{ ...xy(uS), name: "Unemployment rate", line: { color: P[2], width: 2 } }];
    const su = sepTrace("unrate", "Fed projection", P[2], lastV(u).date); if (su) tj.push(su);
    plot("c-jobs-mini", tj, baseLayout({ margin: { l: 40, r: 8, t: 34, b: 28 }, yaxis: pctAxis() }));
  }

  // 一年 2% 換成每個月的速度：1.02^(1/12) − 1 ≈ 0.165%
  const PACE2 = (Math.pow(1.02, 1 / 12) - 1) * 100;
  // CPI 拆項兩種看法：時間序列的貢獻疊圖、各項（含 desk 常看的細項）× 月份的熱力圖
  function renderCpiParts(comps) {
    const P = palette(), v = S.cpiView, narrow = innerWidth < 600;
    const hint = { time: "What drove each month's CPI, last 12 months. Each bar is a component's m/m change times its weight in the basket, in percentage points of headline CPI; stacked, they add up to roughly the headline (diamond). Hover a bar for the component's own m/m.",
      heat: "Each component's m/m change over the last 24 months, with the items desks watch indented under the block they belong to: OER and rent make up most of shelter; medical and transport services (which includes car insurance) drive supercore; airfares are small but jumpy; used cars swing core goods. Colour is how unusual the move is for that row (its 2015-19 average and spread), so energy's big swings don't drown out shelter; the number is the m/m change itself." }[v];
    $("#cpi-hint").textContent = hint;
    if (v === "time") {
      const tb = comps.map(([c, n, w], i) => {
        const m = mom(ser(c)).slice(-12);
        return { x: m.map((p) => p.date), y: m.map((p) => (p.v * w) / 100), customdata: m.map((p) => p.v), name: n, type: "bar", marker: { color: P[i % P.length] },
          hovertemplate: `%{y:+.2f}pt (${n.split(" (")[0]} itself %{customdata:+.2f}% m/m)<extra></extra>` };
      });
      const head = mom(ser("cpi")).slice(-12);
      tb.push({ ...xy(head), name: "Headline CPI m/m", mode: "markers", marker: { symbol: "diamond", size: 10, color: css("--ink"), line: { color: css("--surface"), width: 1.5 } }, hovertemplate: "Headline %{y:+.2f}%<extra></extra>" });
      const nb = narrow ? { legend: { ...baseLayout().legend, y: -0.1, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 140 } } : {};
      return plot("c-cpi-parts", tb, baseLayout({ ...nb, barmode: "relative", bargap: 0.3, yaxis: { ...baseLayout().yaxis, ticksuffix: "pt", zeroline: true, zerolinecolor: css("--muted") }, xaxis: { ...baseLayout().xaxis, tickformat: "%b %y" } }));
    }
    // 細項接在它所屬的那一塊下面
    const kids = { cpi_goods: ["cpi_usedcars"], cpi_shelter: ["cpi_oer", "cpi_rent"], cpi_supercore: ["cpi_medsvc", "cpi_transvc", "cpi_airfare"] };
    const rows = [["cpi", "Headline CPI"], ["core_cpi", "Core CPI"]];
    comps.forEach(([c, n]) => {
      rows.push([c, narrow && c === "cpi_supercore" ? "Supercore" : n.split(" (")[0]]);
      (kids[c] || []).filter((k) => ser(k).length).forEach((k) => rows.push([k, "· " + CPI_ITEMS[k]]));
    });
    heatRows("c-cpi-parts", rows);
  }

  // 熱力圖：每列 × 月份，顏色 = 和自己 2015-19 平均差幾個標準差
  function heatRows(id, rows) {
    const narrow = innerWidth < 600;
    const months = mom(ser("cpi")).slice(narrow ? -12 : -24).map((p) => p.date);
    const z = [], txt = [];
    rows.forEach(([c]) => {
      const m = mom(ser(c)), base = m.filter((p) => p.date >= "2015-01-01" && p.date < "2020-01-01").map((p) => p.v);
      const mu = base.reduce((a, x) => a + x, 0) / base.length, sd = Math.sqrt(base.reduce((a, x) => a + (x - mu) ** 2, 0) / base.length) || 1;
      const mp = new Map(m.map((p) => [p.date, p.v]));
      z.push(months.map((d) => (mp.has(d) ? (mp.get(d) - mu) / sd : null)));
      txt.push(months.map((d) => (mp.has(d) ? mp.get(d).toFixed(1).replace(/^-0\.0$/, "0.0") : "")));
    });
    const lo = css("--down"), hi = css("--up"), mid = css("--surface");
    // 月份當類別軸：2025 年 10 月沒有資料，用日期軸會變成一格很寬的空白
    plot(id, [{ type: "heatmap", x: months.map((d) => monthName(d).replace(/ (\d{2})(\d{2})$/, " $2")), y: rows.map((r) => r[1]), z, text: txt, texttemplate: narrow ? "" : "%{text}", textfont: { size: 10 },
      colorscale: [[0, lo], [0.5, mid], [1, hi]], zmin: -3, zmax: 3, xgap: 2, ygap: 2, showscale: false,
      hovertemplate: "%{y} %{x}: %{text}% m/m (%{z:+.1f}σ vs 2015-19)<extra></extra>" }],
      baseLayout({ hovermode: "closest", margin: { l: narrow ? 92 : 120, r: 10, t: 10, b: 40 }, xaxis: { ...baseLayout().xaxis, type: "category", showgrid: false, nticks: 12 }, yaxis: { ...baseLayout().yaxis, automargin: true, autorange: "reversed", showgrid: false, tickfont: { color: css("--ink"), size: 12 } } }));
  }

  // CPI 細項：desk 常看的幾個，熱力圖裡接在所屬的那一塊下面
  const CPI_ITEMS = { cpi_oer: "OER", cpi_rent: "Rent", cpi_medsvc: "Medical services", cpi_transvc: "Transport services", cpi_airfare: "Airfares", cpi_usedcars: "Used cars" };

  // Inflation 頁
  const I_VIEWS = { mm: ["m/m", (s) => mom(s)], yoy: ["YoY", (s) => yoy(s)], a3: ["3m annualized", (s) => annK(s, 3)], a6: ["6m annualized", (s) => annK(s, 6)] };
  function renderInflation() {
    if (!D.macro.length) return empty("c-infl", "No inflation data yet");
    const P = palette(), f = I_VIEWS[S.iView][1];
    $("#infl-take2").textContent = inflTakeaway();
    $("#infl-date2").innerHTML = dataLine("core_pce", "pce", "PCE", "Core PCE: ") + `<span class="muted"> &nbsp;|&nbsp; </span>` + dataLine("core_cpi", "cpi", "CPI", "Core CPI: ");
    const pce = fromYears(f(ser("core_pce")), S.iYears), cpi = fromYears(f(ser("core_cpi")), S.iYears);
    const mm = S.iView === "mm";
    const narrow = innerWidth < 600, lg = narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 44, r: 12, t: 10, b: 90 } } : {};
    clearEmpty("c-infl");
    if (mm) {
      // 月增率用柱子；虛線是一年 2% 換成每月的速度（0.17%）
      const bar = (s, n, c) => ({ ...xy(s), name: `${n} m/m`, type: "bar", marker: { color: rgba(c, 0.75) },
        customdata: s.map((p) => (Math.pow(1 + p.v / 100, 12) - 1) * 100), hovertemplate: `${n} %{y:.2f}% m/m (%{customdata:.1f}% annualized)<extra></extra>` });
      // 速度線的說明放在圖例（放圖上會蓋到最近的柱子）
      const pace = { x: [null], y: [null], name: "2% a year pace (0.17%/month)", mode: "lines", line: { color: css("--ink"), width: 1.2, dash: "dash" }, hoverinfo: "skip" };
      plot("c-infl", [bar(pce, "Core PCE", P[0]), bar(cpi, "Core CPI", P[3]), pace],
        baseLayout({ barmode: "group", bargap: 0.25, yaxis: pctAxis({ zeroline: true, zerolinecolor: css("--muted") }), ...lg,
          shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: PACE2, y1: PACE2, layer: "above", line: { color: css("--ink"), width: 1.2, dash: "dash" } }],
 }));
    } else {
      const tr = [{ ...xy(pce), name: `Core PCE ${I_VIEWS[S.iView][0]}`, line: { color: P[0], width: 2.2 }, hovertemplate: "%{y:.2f}%" },
        { ...xy(cpi), name: `Core CPI ${I_VIEWS[S.iView][0]}`, line: { color: P[3], width: 1.6 }, hovertemplate: "%{y:.2f}%" }];
      const sp = sepTrace("core_pce", "Fed projection (Core PCE)", P[0], lastV(pce) ? lastV(pce).date : null); if (sp) tr.push(sp);
      plot("c-infl", tr, baseLayout({ yaxis: pctAxis(), ...hline(2, "2% target"), ...lg }));
    }

    // CPI 拆項：最近 12 個月，每塊的 m/m × 在 CPI 的權重 = 對整體 CPI 的貢獻（百分點），疊起來 ≈ 整體 m/m
    // 權重是 BLS relative importance 的近似值（%），每年 12 月更新一次，差一點不影響看誰在推
    const comps = [["cpi_goods", "Core goods", 19.3], ["cpi_shelter", "Shelter", 35.4], ["cpi_supercore", "Services ex shelter (supercore, approx.)", 25.3], ["cpi_food", "Food", 13.6], ["cpi_energy", "Energy", 6.4]];
    renderCpiParts(comps);
    let h = "<table><thead><tr><th>Component</th><th>Weight</th><th>Latest m/m</th><th>3m annualized</th><th>YoY</th></tr></thead><tbody>";
    comps.forEach(([c, n, w]) => { const s = ser(c); h += `<tr><td>${n}</td><td class="n">${w}%</td><td class="n">${f1(lastV(mom(s))?.v, 2)}%</td><td class="n">${f1(lastV(annK(s, 3))?.v)}%</td><td class="n">${f1(lastV(yoy(s))?.v)}%</td></tr>`; });
    $("#cpi-table").innerHTML = fold("cpiParts", "Show table", `<div class="table-wrap">${h}</tbody></table></div>`)
      + `<p class="hint note">Weights are approximate BLS relative importance, so the bars add up close to, not exactly, the headline. Supercore here is CPI services less rent of shelter, which still includes energy services, so it is a close approximation of the usual definition.</p>`;

    // PPI
    const ppi = fromYears(yoy(ser("ppi")), 5), cppi = fromYears(yoy(ser("core_ppi")), 5);
    plot("c-ppi", [{ ...xy(ppi), name: "PPI final demand YoY", line: { color: P[1], width: 2 } }, { ...xy(cppi), name: "Core PPI YoY", line: { color: P[4], width: 1.6 } }],
      baseLayout({ yaxis: pctAxis() }));
    $("#ppi-date").innerHTML = dataLine("ppi", "ppi", "PPI");
  }

  // Jobs 頁
  function renderJobs() {
    if (!D.macro.length) return empty("c-jobs", "No jobs data yet");
    const P = palette();
    $("#jobs-take2").textContent = jobsTakeaway();
    $("#jobs-date2").innerHTML = dataLine("unrate", "nfp", "NFP");
    const u = fromYears(ser("unrate"), 5), part = fromYears(ser("civpart"), 5);
    const tr = [{ ...xy(u), name: "Unemployment rate", line: { color: P[2], width: 2.2 }, hovertemplate: "%{y:.1f}%" },
      { ...xy(part), name: "Participation rate (right)", yaxis: "y2", line: { color: css("--muted"), width: 1.4, dash: "dot" }, hovertemplate: "%{y:.1f}%" }];
    const su = sepTrace("unrate", "Fed projection", P[2], lastV(u) ? lastV(u).date : null); if (su) tr.push(su);
    clearEmpty("c-jobs");
    const narrow = innerWidth < 600;
    plot("c-jobs", tr, baseLayout({ margin: { l: narrow ? 40 : 52, r: narrow ? 44 : 52, t: 10, b: narrow ? 90 : 40 }, yaxis: pctAxis(),
      ...(narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" } } : {}),
      yaxis2: { ...pctAxis(), overlaying: "y", side: "right", showgrid: false } }));
    const sh = ser("sahm"), s0 = lastV(sh);
    $("#sahm").innerHTML = s0 ? `<span class="light ${s0.v >= 0.5 ? "on" : s0.v >= 0.3 ? "warn" : ""}"></span> Sahm rule <b class="num">${s0.v.toFixed(2)}</b> `
      + `<span class="muted">(${monthName(s0.date)}). It triggers at 0.5: the 3-month average unemployment rate rising 0.5pt above its 12-month low has marked the start of every US recession since 1970.</span>` : "";

    const pay = diff(ser("payems")), p24 = pay.slice(-24), a3 = avgK(pay, 3).slice(-24);
    // 那個月公布時，對前兩個月的合計修正（ALFRED）
    const rev = new Map(D.rel.filter((r) => r.measure === "nfp" && r.rev2 !== "").map((r) => [r.ref, +r.rev2]));
    const revTxt = p24.map((p) => (rev.has(p.date) ? `<br>Prior 2 months revised ${rev.get(p.date) > 0 ? "+" : ""}${rev.get(p.date)}k in this report` : ""));
    plot("c-nfp", [{ ...xy(p24), name: "Monthly change", type: "bar", marker: { color: rgba(P[0], 0.75) }, customdata: revTxt, hovertemplate: "%{y:+.0f}k%{customdata}" },
      { ...xy(a3), name: "3-month average", line: { color: css("--ink"), width: 2 }, hovertemplate: "%{y:+.0f}k" }],
      baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "k", zeroline: true, zerolinecolor: css("--muted") }, xaxis: { ...baseLayout().xaxis, tickformat: "%b %y" } }));

    // 工資 vs 服務通膨：三種工資量法 + supercore CPI，都是 YoY
    const ahe = ser("ahe"), eci = yoy(ser("eci_wag")), atl = ser("atl_wage"), sc = yoy(ser("cpi_supercore"));
    const wt = [{ ...xy(fromYears(yoy(ahe), 5)), name: "Avg hourly earnings", line: { color: P[4], width: 2 }, hovertemplate: "AHE %{y:.1f}%<extra></extra>" }];
    if (eci.length) wt.push({ ...xy(fromYears(eci, 5)), name: "ECI wages (quarterly)", mode: "lines+markers", line: { color: P[0], width: 2 }, marker: { size: 6 }, hovertemplate: "ECI %{y:.1f}%<extra></extra>" });
    if (atl.length) wt.push({ ...xy(fromYears(atl, 5)), name: "Atlanta Fed wage tracker", line: { color: P[2], width: 2 }, hovertemplate: "Atlanta Fed %{y:.1f}%<extra></extra>" });
    wt.push({ ...xy(fromYears(sc, 5)), name: "Supercore CPI", line: { color: css("--muted"), width: 1.6, dash: "dash" }, hovertemplate: "Supercore %{y:.1f}%<extra></extra>" });
    plot("c-ahe", wt, baseLayout({ yaxis: pctAxis(), ...(narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" }, margin: { l: 40, r: 12, t: 10, b: 110 } } : {}) }));
    $("#wage-date").innerHTML = [["ahe", "AHE"], ["eci_wag", "ECI"], ["atl_wage", "Atlanta Fed"]].map(([c, n]) => { const l = lastV(ser(c)); return l ? `${n} ${c === "eci_wag" ? "Q" + (Math.floor((+l.date.slice(5, 7) - 1) / 3) + 1) + " " + l.date.slice(0, 4) : monthName(l.date)}` : ""; }).filter(Boolean).join(" · ");

    const cl = D.claims.filter((r) => r.icsa !== "").map((r) => ({ date: r.date, v: r.icsa / 1000 })), c2 = fromYears(cl, 2);
    plot("c-claims", [{ ...xy(c2), name: "Weekly", line: { color: rgba(P[1], 0.55), width: 1.2 }, hovertemplate: "%{y:.0f}k" },
      { ...xy(fromYears(avgK(cl, 4), 2)), name: "4-week average", line: { color: P[1], width: 2.2 }, hovertemplate: "%{y:.0f}k" }],
      baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "k" } }));
    const c0 = lastV(cl); $("#claims-date").innerHTML = c0 ? `<span class="muted">Week ending ${md(c0.date)} · released every Thursday</span>` : "";

    const jo = fromYears(ser("jolts"), 5).map((p) => ({ date: p.date, v: p.v / 1000 }));
    plot("c-jolts", [{ ...xy(jo), name: "Job openings", line: { color: P[0], width: 2 }, hovertemplate: "%{y:.2f}m" }], baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "m" } }));
    const j0 = lastV(ser("jolts")); $("#jolts-date").innerHTML = j0 ? `<span class="muted">${monthName(j0.date)} data · JOLTS runs about two months behind</span>` : "";
  }

  // Rates 頁：10y = 實質利率 + breakeven
  function renderDecomp() {
    const be = D.be.filter((r) => r.be10 !== "" && r.real10 !== "");
    if (!be.length) return empty("c-decomp", "No breakeven data yet");
    const P = palette(), rows = inRange(be, "date", S.dRange);
    const nom = rows.map((r) => { const y = D.yields[yIdx[r.date]]; return y ? num(y["10y"]) : null; });
    clearEmpty("c-decomp");
    plot("c-decomp", [
      { x: rows.map((r) => r.date), y: rows.map((r) => +r.real10), name: "Real yield (TIPS)", stackgroup: "a", line: { color: P[0], width: 0.5 }, fillcolor: rgba(P[0], 0.35), hovertemplate: "%{y:.2f}%" },
      { x: rows.map((r) => r.date), y: rows.map((r) => +r.be10), name: "Breakeven inflation", stackgroup: "a", line: { color: P[1], width: 0.5 }, fillcolor: rgba(P[1], 0.3), hovertemplate: "%{y:.2f}%" },
      { x: rows.map((r) => r.date), y: nom, name: "10y nominal", line: { color: css("--ink"), width: 1.6 }, hovertemplate: "%{y:.2f}%" },
    ], baseLayout({ yaxis: pctAxis() }));
    const last = be[be.length - 1];
    let h = "<table><thead><tr><th>Change since</th><th>10y nominal (bp)</th><th>Real yield (bp)</th><th>Breakeven (bp)</th><th>Driven by</th></tr></thead><tbody>";
    [["1W", 7], ["1M", 30], ["3M", 91], ["1Y", 365]].forEach(([k, d]) => {
      const a = atOrBefore(be, "date", shiftDays(last.date, -d)); if (!a) return;
      const dr = (last.real10 - a.real10) * 100, db = (last.be10 - a.be10) * 100;
      const who = Math.abs(dr) + Math.abs(db) < 3 ? "little change" : Math.abs(dr) > Math.abs(db) ? "real yield" : "inflation expectations";
      h += `<tr><td>${cmpLabel[k] || k}</td><td class="n ${cls(dr + db)}">${bp(dr + db, 0)}</td><td class="n ${cls(dr)}">${bp(dr, 0)}</td><td class="n ${cls(db)}">${bp(db, 0)}</td><td>${who}</td></tr>`;
    });
    $("#decomp-table").innerHTML = `<div class="table-wrap">${h}</tbody></table></div>`
      + `<p class="hint note">Real + breakeven adds up to the 10y TIPS-implied nominal yield, which sits a few bp from the Treasury 10y (black line). Data from FRED (T10YIE, DFII10), ${last.date}.</p>`;
  }

  // ---------- 數據 surprise：預期（FF / 手動）vs 首次公布（ALFRED） ----------
  // sd = 歷史不夠時用的典型 surprise 大小；sign = +1 代表數字高 = 經濟較熱 / 通膨較高（對利率偏鷹）
  const SM = {
    core_cpi_mm: { name: "Core CPI m/m", unit: "%", dec: 1, page: "inflation", type: "cpi", sd: 0.1, sign: 1 },
    cpi_mm: { name: "CPI m/m", unit: "%", dec: 1, page: "inflation", type: "cpi", sd: 0.1, sign: 1 },
    cpi_yy: { name: "CPI y/y", unit: "%", dec: 1, page: "inflation", type: "cpi", sd: 0.1, sign: 1 },
    core_pce_mm: { name: "Core PCE m/m", unit: "%", dec: 1, page: "inflation", type: "pce", sd: 0.1, sign: 1 },
    core_ppi_mm: { name: "Core PPI m/m", unit: "%", dec: 1, page: "inflation", type: "ppi", sd: 0.2, sign: 1 },
    ppi_mm: { name: "PPI m/m", unit: "%", dec: 1, page: "inflation", type: "ppi", sd: 0.2, sign: 1 },
    nfp: { name: "Nonfarm payrolls", unit: "k", dec: 0, page: "jobs", type: "nfp", sd: 75, sign: 1 },
    unrate: { name: "Unemployment rate", unit: "%", dec: 1, page: "jobs", type: "nfp", sd: 0.1, sign: -1 },
    ahe_mm: { name: "Avg hourly earnings m/m", unit: "%", dec: 1, page: "jobs", type: "nfp", sd: 0.1, sign: 1 },
    claims: { name: "Initial claims", unit: "k", dec: 0, page: "jobs", type: "claims", sd: 12, sign: -1 },
  };
  const fmtU = (m, v) => (v === "" || v == null || isNaN(v) ? "–" : (+v).toFixed(SM[m].dec) + SM[m].unit);
  // 手動 key 的預期值加一個小 m
  const manTag = (r) => (r && /manual/.test(r.src || "") ? `<sup class="man" title="Entered by hand: ${r.src}">m</sup>` : "");
  const fmtS = (m, v) => (v == null || isNaN(v) ? "–" : (v > 0 ? "+" : "") + v.toFixed(SM[m].dec) + SM[m].unit);
  // 預期值：手動的優先
  function consensus(date, m) {
    const f = (rows) => rows.find((r) => r.date === date && r.measure === m && r.forecast !== "");
    const r = f(D.conManual) || f(D.con);
    return r ? { v: +r.forecast, src: r.source || "manual" } : null;
  }
  // 某個 measure 的每次公布，舊到新；z = 標準化 surprise（正 = 比預期熱 / 鷹）
  const _sur = {};
  function surRows(m) {
    if (_sur[m]) return _sur[m];
    const rows = D.rel.filter((r) => r.measure === m).map((r) => {
      const c = consensus(r.date, m), a = +r.actual, s = c ? +(a - c.v).toFixed(4) : null, re = reaction(r.date);
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
    let h = "<table><thead><tr><th>Date</th><th>Indicator</th><th>Period</th><th>Survey</th><th>Actual</th><th>Prior</th><th>Revised</th><th>Surprise</th><th>2y (bp)</th></tr></thead><tbody>";
    const up = [], last = [];
    measures.forEach((m) => {
      const rs = surRows(m), r = rs[rs.length - 1];
      const nx = [...D.conManual, ...D.con].filter((c) => c.measure === m && c.date >= today && (!r || c.date > r.date)).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
      if (nx) up.push([nx.date, `<tr class="upcoming"><td class="n">${md(nx.date)}</td><td>${SM[m].name}</td><td class="muted">next</td><td class="n"><b>${fmtU(m, +nx.forecast)}</b></td><td class="n muted">–</td><td class="n">${fmtU(m, r ? r.actual : "")}</td><td></td><td></td><td></td></tr>`]);
      else {
        // 還沒有預期：先從 events.json 列出下一次公布日，預期出來（公布當週）會自動換成上面那種
        const ev = D.events.find((e) => e.type === SM[m].type && e.date >= today && (!r || e.date > r.date));
        const ref = ev && evtMonth(ev.label);
        if (ev) up.push([ev.date, `<tr class="upcoming"><td class="n">${md(ev.date)}</td><td>${SM[m].name}</td><td>${ref ? monthName(ref) : ""}</td><td class="n muted" title="The forecast shows up in the week of the release">not out yet</td><td class="n muted">–</td><td class="n">${fmtU(m, r ? r.actual : "")}</td><td></td><td></td><td></td></tr>`]);
      }
      if (r) last.push([r.date, `<tr><td class="n">${md(r.date)}</td><td>${SM[m].name}</td><td>${refLabel(m, r.ref)}</td><td class="n">${fmtU(m, r.forecast)}${manTag(r)}</td><td class="n"><b>${fmtU(m, r.actual)}</b></td>`
        + `<td class="n">${fmtU(m, r.prior)}</td><td class="n">${r.revised !== "" && r.prior !== "" && +r.revised !== +r.prior ? fmtU(m, r.revised) : ""}</td>`
        + `<td class="n">${r.surprise == null ? "–" : fmtS(m, r.surprise) + " · " + zTxt(r.z)}</td><td class="n ${cls(r.d2)}">${bp(r.d2, 1)}</td></tr>`]);
    });
    last.sort((a, b) => (a[0] < b[0] ? 1 : -1));
    up.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return `<div class="table-wrap eco">${h}${up.map((x) => x[1]).join("")}${last.map((x) => x[1]).join("")}</tbody></table></div>`;
  }
  function conStart() { const d = [...D.con, ...D.conManual].map((r) => r.date).sort(); return d[0] || null; }
  const conNote = () => { const s = (D.con.map((r) => r.date).sort()[0]) || null; return `Forecasts come from the ForexFactory weekly calendar${s ? `, collected automatically since ${s}` : ""}. It only lists the current week, so later releases show "not out yet" until their week starts. Forecasts marked <sup class="man">m</sup> were entered by hand from Investing.com's release history (Jan–Sep 2026), each checked against our first-print actual and prior before it went in. Actuals are the first print (ALFRED). σ = surprise in standard deviations, signed so + means hotter / more hawkish than expected.`; };

  // 一個指標的歷史：柱子 = 實際、點 = 預期
  function renderSurprisePanel(page) {
    const ms = Object.keys(SM).filter((m) => SM[m].page === page), key = page === "inflation" ? "sIn" : "sJob";
    if (!ms.includes(S[key])) S[key] = ms[0];
    const el = $(`#sur-${page}`); if (!el) return;
    if (!D.rel.length) { el.innerHTML = `<p class="hint">Release data load after the next daily update.</p>`; return; }
    // 公布表格預設收起來，點開才看（Henry 覺得一打開就一大張表太雜）
    el.innerHTML = fold(`eco-${page}`, "Release table: latest prints and what's next", ecoTable(ms)) + `<div class="sur-ctl"></div><div class="chart short" id="c-sur-${page}"></div><div class="sur-hist"></div><p class="hint note">${conNote()}</p>`;
    el.querySelector(".sur-ctl").append(chips("Indicator", ms.map((m) => [m, SM[m].name]), S[key], false, (v) => { S[key] = v; renderSurprisePanel(page); }));
    const m = S[key], rs = surRows(m).slice(m === "claims" ? -52 : -24), P = palette();
    const hov = rs.map((r) => `${refLabel(m, r.ref)}<br>Actual ${fmtU(m, r.actual)} · survey ${fmtU(m, r.forecast)}${/manual/.test(r.src) ? " (manual)" : ""}${r.surprise == null ? "" : ` · surprise ${fmtS(m, r.surprise)} (${r.z > 0 ? "+" : ""}${r.z.toFixed(1)}σ)`}<br>2y that day ${bp(r.d2, 1)}bp`);
    const tr = [{ x: rs.map((r) => r.date), y: rs.map((r) => r.actual), name: "Actual (first print)", type: "bar", marker: { color: rgba(P[0], 0.7) }, text: hov, hovertemplate: "%{text}<extra></extra>", textposition: "none" }];
    const fc = rs.filter((r) => r.forecast != null);
    if (fc.length) tr.push({ x: fc.map((r) => r.date), y: fc.map((r) => r.forecast), name: "Forecast", mode: "markers", marker: { symbol: "line-ew", size: 18, color: css("--ink"), line: { width: 3, color: css("--ink") } }, hoverinfo: "skip" });
    plot(`c-sur-${page}`, tr, baseLayout({ hovermode: "closest", bargap: 0.35, yaxis: { ...baseLayout().yaxis, ticksuffix: SM[m].unit, zeroline: true, zerolinecolor: css("--muted") } }));
    let h = "<table><thead><tr><th>Release</th><th>Period</th><th>Survey</th><th>Actual</th><th>Surprise</th><th>2y (bp)</th></tr></thead><tbody>";
    rs.slice().reverse().forEach((r) => { h += `<tr><td class="n">${r.date}</td><td>${refLabel(m, r.ref)}</td><td class="n">${fmtU(m, r.forecast)}${manTag(r)}</td><td class="n">${fmtU(m, r.actual)}</td><td class="n">${r.surprise == null ? "–" : fmtS(m, r.surprise) + " · " + zTxt(r.z)}</td><td class="n ${cls(r.d2)}">${bp(r.d2, 1)}</td></tr>`; });
    el.querySelector(".sur-hist").innerHTML = fold(`surH-${page}`, `${SM[m].name}: all releases`, `<div class="table-wrap">${h}</tbody></table></div>`);
  }

  // 首頁卡片：這一類最近一次公布
  function lastSurpriseLine(page) {
    const all = Object.keys(SM).filter((m) => SM[m].page === page && m !== "claims").flatMap((m) => surRows(m).slice(-1).map((r) => ({ ...r, m })));
    if (!all.length) return "";
    all.sort((a, b) => (a.date < b.date ? 1 : -1));
    const d = all[0].date, same = all.filter((r) => r.date === d);
    return `<div class="sur">● Last release (${md(d)}): ` + same.map((r) => `${SM[r.m].name} <b class="num">${fmtU(r.m, r.actual)}</b>`
      + (r.forecast == null ? "" : ` vs ${fmtU(r.m, r.forecast)} exp. ${zTxt(r.z)}`)).join(" · ") + "</div>";
  }

  // Rates：surprise 指數（類似 Citi）和數據對 2y 的影響
  function allSurprises() { return Object.keys(SM).flatMap((m) => surRows(m).filter((r) => r.z != null).map((r) => ({ ...r, m }))); }
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
      tr.push({ x: y2.map((r) => r.date), y: y2.map((r) => +r["2y"]), name: "2y yield (right)", yaxis: "y2", line: { color: css("--muted"), width: 1.4, dash: "dot" }, hovertemplate: "2y %{y:.2f}%<extra></extra>" });
      const narrow = innerWidth < 600;
      plot("c-surix", tr, baseLayout({ hovermode: "closest", margin: { l: 44, r: 48, t: 10, b: narrow ? 90 : 40 }, ...(narrow ? { legend: { ...baseLayout().legend, y: -0.12, yanchor: "top" } } : {}),
        yaxis: { ...baseLayout().yaxis, ticksuffix: "σ", zeroline: true, zerolinecolor: css("--muted"), zerolinewidth: 1.5 },
        yaxis2: { ...pctAxis(), overlaying: "y", side: "right", showgrid: false } }));
      note.textContent = "Built the way the Citi surprise index is: one line for inflation data (core CPI, core PCE, core PPI) and one for jobs and activity (payrolls, unemployment, claims). Each line is the average surprise of the last 3 months of releases, in standard deviations, with recent releases counting more. Above zero: data beating forecasts (hotter inflation, stronger jobs), which usually pushes the 2y up. Dots are releases; hover one to see what came out.";
    }
  }

  // ---------- 分頁：#overview / #rates / #calendar（舊的 #events 也導到 calendar）----------
  const PAGES = ["overview", "rates", "inflation", "jobs", "calendar"];
  const RENDER = {
    overview: () => { renderNext(); renderHero(); renderMacroCards(); },
    rates: () => { renderRatesTake(); renderYields(); renderFed(); renderDecomp(); renderFomc(); renderSurIndex(); },
    inflation: () => { renderInflation(); renderSurprisePanel("inflation"); },
    jobs: () => { renderJobs(); renderSurprisePanel("jobs"); },
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

  async function main() {
    [D.yields, D.effr, D.path, D.summ, D.macro, D.claims, D.be, D.sep, D.rel, D.con, D.conManual] = await Promise.all(
      ["yields.csv", "effr.csv", "fed_path.csv", "fed_summary.csv", "macro.csv", "claims.csv", "breakeven.csv", "sep.csv", "releases.csv", "consensus.csv", "consensus_manual.csv"].map(load));
    D.pathPart = await load("fed_path_partial.csv").catch(() => []);
    try { D.meta = await (await fetch("data/meta.json", { cache: "no-cache" })).json(); } catch { D.meta = {}; }
    try { D.events = ((await (await fetch("data/events.json", { cache: "no-cache" })).json()).events || []).sort((a, b) => (a.date < b.date ? -1 : 1)); } catch { D.events = []; }
    try { D.meetings = (await (await fetch("data/fomc.json", { cache: "no-cache" })).json()).meetings || []; } catch { D.meetings = []; }
    D.yields.forEach((r, i) => (yIdx[r.date] = i));
    const ly = D.yields[D.yields.length - 1];
    $("#asof").textContent = ly ? `Data as of ${ly.date}` : "No data yet";
    if (D.meta.updated) $("#updated").textContent = ` Last updated: ${D.meta.updated}.`;
    bindSeg("#y-views", "yView", renderYields);
    bindSeg("#f-views", "fView", renderFed);
    bindSeg("#i-views", "iView", renderInflation);
    bindSeg("#i-years", "iYears", renderInflation);
    bindSeg("#cpi-views", "cpiView", () => renderInflation());
    bindSeg("#d-range", "dRange", renderDecomp);
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
  }
  main();
})();
