/* US Rates Monitor — 讀 data/*.csv，畫兩張圖 */
(() => {
  "use strict";

  const TENORS = ["1m", "2m", "3m", "4m", "6m", "1y", "2y", "3y", "5y", "7y", "10y", "20y", "30y"];
  const RANGES = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "2Y": 731, "5Y": 1827, "全部": 1e6 };
  const D = { yields: [], effr: [], path: [], summ: [], meta: {}, events: [] };
  const S = {
    yView: "tenor", fView: "path",
    tenors: ["2y", "10y", "30y"], range: "1Y",
    curveCmp: ["1W", "1M"], curveCustom: "",
    changeWin: "1D",
    spreads: ["2s10s", "5s30s"],
    cum: ["cum_yearend_bp", "cum_12m_bp"],
    events: ["fomc", "cpi", "nfp"], reactSort: "recent",
    pathCmp: ["1W", "1M"], spagRange: "6M", spagEvery: 5,
  };

  // ---------- 小工具 ----------
  const $ = (s) => document.querySelector(s);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const num = (x) => (x === "" || x == null ? null : +x);
  const bp = (x, d = 0) => { if (x == null || isNaN(x)) return "–"; const r = +x.toFixed(d); return (r > 0 ? "+" : "") + (r === 0 ? 0 : r).toFixed(d); };
  const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
  const fmtD = (s) => s; // ISO
  const shiftDays = (iso, k) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const cmpDays = { "1D": 1, "1W": 7, "1M": 30, "3M": 91, "1Y": 365 };
  const cmpLabel = { "1D": "前一天", "1W": "一週前", "1M": "一個月前", "3M": "三個月前", "1Y": "一年前" };

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
  function plot(id, traces, layout) { Plotly.react(id, traces, layout, CFG); }
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
  const rangeChips = (key, after) => chips("期間", Object.keys(RANGES).map((r) => [r, r]), S[key], false, (v) => { S[key] = v; after(); });

  // ---------- 重要事件 ----------
  const EVT = {
    fomc: { glyph: "◆", name: "FOMC", symbol: "diamond" },
    cpi: { glyph: "●", name: "CPI", symbol: "circle" },
    nfp: { glyph: "■", name: "非農", symbol: "square" },
    pce: { glyph: "▲", name: "PCE", symbol: "triangle-up" },
    ppi: { glyph: "▼", name: "PPI", symbol: "triangle-down" },
    minutes: { glyph: "★", name: "會議紀要", symbol: "star" },
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
    return d > 0 ? `升息 ${d}bp` : d < 0 ? `降息 ${-d}bp` : "不動";
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
    let h = `<b>${e.label}</b>　${e.date}`;
    if (e.type === "fomc") { const dec = fomcDecision(e.date); if (dec) h += `　${dec}`; }
    const r = reaction(e.date);
    if (r) {
      h += `<br>2y ${bp(r.d2, 1)}bp · 10y ${bp(r.d10, 1)}bp · 2s10s ${bp(r.curve, 1)}bp`;
      if (r.regime) h += `<br>${r.regime}`;
      if (r.fed != null) h += ` · 到年底定價 ${bp(r.fed, 1)}bp`;
    } else if (e.date > lastYieldDate()) h += "<br>即將公布";
    return h;
  }
  const eventsOn = () => !["5Y", "全部"].includes(S.range);
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
        return dec.startsWith("升") ? css("--up") : dec.startsWith("降") ? css("--down") : c;
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
    const w = chips("事件", EVT_ORDER.map((t) => [t, EVT[t].glyph + " " + EVT[t].name]), S.events, true, after);
    if (!eventsOn()) { const n = document.createElement("span"); n.textContent = "（5Y／全部不顯示）"; n.style.alignSelf = "center"; w.appendChild(n); }
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
    let h = `<div class="react-head"><h3>最近事件反應</h3><div class="chips">`
      + `<button data-s="recent" class="${S.reactSort === "recent" ? "on" : ""}">最近</button>`
      + `<button data-s="size" class="${S.reactSort === "size" ? "on" : ""}">2y 反應最大</button></div></div>`;
    if (next.length) h += `<p class="hint">接下來：${next.map((e) => `<span class="badge">${e.date.slice(5).replace("-", "/")} ${e.label}</span>`).join(" ")}</p>`;
    if (!rows.length) { el.innerHTML = h + `<p class="hint">選取的事件在這段資料裡還沒有。</p>`; }
    else {
      h += "<table><thead><tr><th>日期</th><th>事件</th><th>2y</th><th>10y</th><th>30y</th><th>2s10s</th><th>型態</th><th>到年底定價</th></tr></thead><tbody>";
      rows.forEach(({ e, r }) => {
        const lab = e.type === "fomc" ? `${e.label}${fomcDecision(e.date) ? "：" + fomcDecision(e.date) : ""}` : e.label;
        h += `<tr><td class="n">${e.date}</td><td>${lab}</td>`
          + [r.d2, r.d10, r.d30, r.curve].map((x) => `<td class="n ${c(x)}">${bp(x, 1)}</td>`).join("")
          + `<td>${r.regime}</td><td class="n ${c(r.fed)}">${r.fed == null ? "–" : bp(r.fed, 1)}</td></tr>`;
      });
      el.innerHTML = h + "</tbody></table>";
    }
    el.querySelectorAll("button[data-s]").forEach((b) => (b.onclick = () => { S.reactSort = b.dataset.s; renderReactions(el); }));
  }

  // ---------- 摘要 ----------
  function regime(d2, d10) {
    const slope = d10 - d2, level = (d2 + d10) / 2;
    if (Math.abs(slope) < 0.5) return level > 0 ? "平行上移" : level < 0 ? "平行下移" : "持平";
    if (slope > 0) return level >= 0 ? "Bear steepening" : "Bull steepening";
    return level >= 0 ? "Bear flattening" : "Bull flattening";
  }
  function renderTiles() {
    const y = D.yields; if (y.length < 2) { $("#tiles").innerHTML = ""; return; }
    const a = y[y.length - 1], b = y[y.length - 2];
    const ch = (t) => (num(a[t]) - num(b[t])) * 100;
    const cls = (x) => (x > 0.05 ? "up" : x < -0.05 ? "down" : "");
    const tile = (k, v, d, extra = "") => `<div class="tile ${extra}"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
    let h = "";
    for (const t of ["2y", "10y", "30y"]) { const c = ch(t); h += tile(t.toUpperCase(), num(a[t]).toFixed(2) + "%", `<span class="${cls(c)}">${bp(c)}bp</span>`); }
    const s = (num(a["10y"]) - num(a["2y"])) * 100, sp = (num(b["10y"]) - num(b["2y"])) * 100;
    h += tile("2s10s", bp(s) + "bp", `<span class="${cls(s - sp)}">${bp(s - sp)}bp</span>　<span class="badge">${regime(ch("2y"), ch("10y"))}</span>`, "wide");
    const e = D.effr[D.effr.length - 1];
    if (e) h += tile("EFFR", num(e.effr).toFixed(2) + "%", `目標區間 ${num(e.target_low).toFixed(2)}–${num(e.target_high).toFixed(2)}`);
    const f = D.summ[D.summ.length - 1];
    if (f) {
      const ph = num(f.next_p_hike), pc = num(f.next_p_cut);
      const lead = ph >= pc ? `升息 ${pct(ph)}` : `降息 ${pct(pc)}`;
      h += tile(`下次 FOMC ${f.next_meeting.slice(5).replace("-", "/")}`, bp(num(f.next_move_bp), 1) + "bp", lead);
      h += tile("到年底累積", bp(num(f.cum_yearend_bp), 0) + "bp", `12 個月後 ${bp(num(f.cum_12m_bp), 0)}bp`);
    }
    const nx = D.events.filter((e) => ["fomc", "cpi", "nfp", "pce"].includes(e.type) && e.date > a.date).slice(0, 2);
    if (nx.length) {
      const days = (iso) => Math.round((new Date(iso) - new Date(a.date)) / 864e5);
      h += tile("接下來", `${nx[0].date.slice(5).replace("-", "/")} ${EVT[nx[0].type].name}`, nx.map((e, i) => (i ? `${e.date.slice(5).replace("-", "/")} ${EVT[e.type].name}` : `${days(e.date)} 天後`)).join(" · "));
    }
    $("#tiles").innerHTML = h;
  }

  // ---------- 圖一：殖利率 ----------
  const Y_HINT = {
    tenor: "各期限殖利率的時間序列。底部記號是重要事件，滑鼠移上去看當天市場反應；右邊灰色區塊是接下來兩週的事件。",
    curve: "整條曲線的形狀，和過去比較。x 軸照期限排，間距相等。",
    spread: "期限利差。往上 = 變陡，往下 = 變平；低於 0 是倒掛。",
    change: "各期限在這段期間漲跌幾 bp。看是短端還是長端帶動，判斷 bull/bear steepening 或 flattening。",
    heat: "日期 × 期限的熱力圖，看整條曲線長期怎麼演變。",
    vsfed: "2y 殖利率對比 ZQ 隱含的 12 個月後政策利率。2y 大致反映 Fed 預期，兩條線的差距可以想成期限溢酬加雜訊。",
  };
  function renderYields() {
    const id = "c-yields", ctl = $("#y-controls"); ctl.innerHTML = ""; $("#y-hint").textContent = Y_HINT[S.yView]; $("#y-table").innerHTML = "";
    if (!D.yields.length) return empty(id, "還沒有殖利率資料。第一次請在 GitHub Actions 手動執行，勾選「補齊歷史資料」。");
    clearEmpty(id);
    const P = palette(), v = S.yView, rr = () => renderYields();

    if (v === "tenor") {
      ctl.append(chips("期限", TENORS.map((t) => [t, t]), S.tenors, true, rr), rangeChips("range", rr), eventChips(rr));
      const rows = inRange(D.yields, "date", S.range);
      const tr = TENORS.filter((t) => S.tenors.includes(t)).map((t, i) => ({
        x: rows.map((r) => r.date), y: rows.map((r) => num(r[t])), name: t, type: "scatter", mode: "lines",
        line: { width: 1.8, color: P[i % P.length] }, hovertemplate: "%{y:.2f}%",
      }));
      const L = baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "%" } });
      if (rows.length) addEvents(tr, L, rows[0].date);
      plot(id, tr, L);
      renderReactions($("#y-table"));
    }

    if (v === "curve") {
      const last = D.yields[D.yields.length - 1];
      ctl.append(chips("比較", Object.keys(cmpDays).map((k) => [k, cmpLabel[k]]), S.curveCmp, true, rr));
      const lab = document.createElement("label"); lab.textContent = "自選日期 ";
      const inp = document.createElement("input"); inp.type = "date"; inp.value = S.curveCustom; inp.max = last.date; inp.min = D.yields[0].date;
      inp.onchange = () => { S.curveCustom = inp.value; rr(); }; lab.appendChild(inp); ctl.append(lab);
      const snaps = [["今天 " + last.date, last, 2.6, P[0], "solid"]];
      S.curveCmp.forEach((k, i) => { const r = atOrBefore(D.yields, "date", shiftDays(last.date, -cmpDays[k])); if (r) snaps.push([`${cmpLabel[k]} ${r.date}`, r, 1.6, P[(i + 1) % P.length], "dot"]); });
      if (S.curveCustom) { const r = atOrBefore(D.yields, "date", S.curveCustom); if (r) snaps.push([`自選 ${r.date}`, r, 1.6, P[4], "dash"]); }
      const tr = snaps.map(([n, r, w, c, dash]) => ({
        x: TENORS, y: TENORS.map((t) => num(r[t])), name: n, type: "scatter", mode: "lines+markers",
        line: { width: w, color: c, dash }, marker: { size: w > 2 ? 6 : 4 }, hovertemplate: "%{y:.2f}%", connectgaps: true,
      }));
      plot(id, tr, baseLayout({ xaxis: { ...baseLayout().xaxis, type: "category" }, yaxis: { ...baseLayout().yaxis, ticksuffix: "%" } }));
    }

    if (v === "spread") {
      const defs = { "3m10y": ["3m", "10y"], "2s10s": ["2y", "10y"], "2s5s": ["2y", "5y"], "5s30s": ["5y", "30y"], "10s30s": ["10y", "30y"] };
      ctl.append(chips("利差", Object.keys(defs).map((k) => [k, k]), S.spreads, true, rr), rangeChips("range", rr), eventChips(rr));
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

    if (v === "change") {
      ctl.append(chips("期間", ["1D", "1W", "1M", "3M", "1Y"].map((k) => [k, cmpLabel[k]]), S.changeWin, false, (x) => { S.changeWin = x; rr(); }));
      const a = D.yields[D.yields.length - 1];
      const b = S.changeWin === "1D" ? D.yields[D.yields.length - 2] : atOrBefore(D.yields, "date", shiftDays(a.date, -cmpDays[S.changeWin]));
      const ys = TENORS.map((t) => (num(a[t]) == null || num(b[t]) == null ? null : +((num(a[t]) - num(b[t])) * 100).toFixed(1)));
      const up = css("--up"), dn = css("--down");
      const d2 = (num(a["2y"]) - num(b["2y"])) * 100, d10 = (num(a["10y"]) - num(b["10y"])) * 100;
      const note = document.createElement("span"); note.innerHTML = `${b.date} → ${a.date}　<span class="badge">${regime(d2, d10)}</span>　2s10s ${bp(d10 - d2, 1)}bp`;
      ctl.append(note);
      plot(id, [{
        x: TENORS, y: ys, type: "bar", marker: { color: ys.map((x) => (x >= 0 ? up : dn)) },
        text: ys.map((x) => (x == null ? "" : bp(x, 1))), textposition: "outside", cliponaxis: false,
        textfont: { family: "IBM Plex Mono, monospace", size: 11, color: css("--muted") }, hovertemplate: "%{x}: %{y:+.1f}bp<extra></extra>",
      }], baseLayout({ hovermode: "closest", showlegend: false, xaxis: { ...baseLayout().xaxis, type: "category" },
        yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted") } }));
    }

    if (v === "heat") {
      ctl.append(rangeChips("range", rr));
      let rows = inRange(D.yields, "date", S.range);
      const step = Math.max(1, Math.floor(rows.length / 400)); rows = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
      const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
      plot(id, [{
        type: "heatmap", x: rows.map((r) => r.date), y: TENORS, z: TENORS.map((t) => rows.map((r) => num(r[t]))),
        colorscale: dark ? "Viridis" : "YlGnBu", reversescale: !dark, colorbar: { ticksuffix: "%", thickness: 10, outlinewidth: 0, tickfont: { color: css("--muted") } },
        hovertemplate: "%{x}<br>%{y}: %{z:.2f}%<extra></extra>",
      }], baseLayout({ hovermode: "closest", yaxis: { ...baseLayout().yaxis, type: "category" } }));
    }

    if (v === "vsfed") {
      ctl.append(rangeChips("range", rr));
      const rows = inRange(D.yields, "date", S.range), start = rows.length ? rows[0].date : "";
      const ef = D.effr.filter((r) => r.date >= start), fs = D.summ.filter((r) => r.asof >= start && r.implied_12m !== "");
      const tr = [
        { x: rows.map((r) => r.date), y: rows.map((r) => num(r["2y"])), name: "2y 殖利率", line: { color: P[0], width: 2 } },
        { x: fs.map((r) => r.asof), y: fs.map((r) => num(r.implied_12m)), name: "ZQ 隱含 12 個月後", line: { color: P[1], width: 2 } },
        { x: ef.map((r) => r.date), y: ef.map((r) => num(r.effr)), name: "EFFR", line: { color: css("--muted"), width: 1.4, shape: "hv" } },
      ].map((t) => ({ ...t, type: "scatter", mode: "lines", hovertemplate: "%{y:.2f}%" }));
      plot(id, tr, baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "%" } }));
      if (!fs.length) { const n = document.createElement("span"); n.textContent = "（Fed 定價的歷史從開始跑的那天累積起來）"; ctl.append(n); }
    }
  }

  // ---------- 圖二：Fed 定價 ----------
  const F_HINT = {
    path: "每次 FOMC 之後的隱含政策利率。和一週前、一個月前比，看市場這段時間把預期改了多少。",
    probs: "每次會議升息、不動、降息的機率（自算 FedWatch）。",
    cum: "相對現在 EFFR，市場累積 price 了幾 bp。每天一個點，看定價越來越鷹還是越來越鴿。",
    spag: "實線是 EFFR 實際走過的路；每條淡線是某一天市場預期的未來路徑。淡線一直在改方向，就是市場一直在修正預期。",
  };
  const asofs = () => [...new Set(D.path.map((r) => r.asof))].sort();
  const pathOn = (a) => D.path.filter((r) => r.asof === a);
  function nearestAsof(list, iso) { let ans = null; for (const a of list) { if (a <= iso) ans = a; else break; } return ans; }

  function renderFed() {
    const id = "c-fed", ctl = $("#f-controls"); ctl.innerHTML = ""; $("#f-hint").textContent = F_HINT[S.fView]; $("#f-table").innerHTML = "";
    const A = asofs();
    if (!A.length) return empty(id, "還沒有 Fed 定價資料（ZQ 期貨要先抓到才算得出來）。");
    clearEmpty(id);
    const P = palette(), v = S.fView, rr = () => renderFed(), last = A[A.length - 1];
    const effrNow = num(D.summ[D.summ.length - 1].effr);
    const stepXY = (rows, startDate, startRate) => {
      // 階梯：從 asof 起，每次會議後換成新利率
      const x = [startDate], y = [startRate];
      rows.forEach((r) => { x.push(r.meeting); y.push(num(r.post)); });
      if (rows.length) { x.push(shiftDays(rows[rows.length - 1].meeting, 45)); y.push(num(rows[rows.length - 1].post)); }
      return { x, y };
    };

    if (v === "path") {
      ctl.append(chips("比較", ["1W", "1M", "3M"].map((k) => [k, cmpLabel[k]]), S.pathCmp, true, rr));
      const snaps = [[last, P[0], 2.6, "solid"]];
      S.pathCmp.forEach((k, i) => { const a = nearestAsof(A, shiftDays(last, -cmpDays[k])); if (a && a !== last) snaps.push([a, P[(i + 1) % P.length], 1.6, "dot"]); });
      const tr = snaps.map(([a, c, w, dash]) => {
        const rows = pathOn(a), e0 = num((atOrBefore(D.effr, "date", a) || {}).effr);
        return { x: [a, ...rows.map((r) => r.meeting)], y: [e0, ...rows.map((r) => num(r.post))], customdata: [[0, 0], ...rows.map((r) => [num(r.cum_bp), num(r.move_bp)])],
          name: (a === last ? "今天 " : "") + a, type: "scatter", mode: "lines+markers", line: { color: c, width: w, dash, shape: "hv" },
          marker: { size: w > 2 ? 7 : 5 }, hovertemplate: "%{y:.3f}%（累積 %{customdata[0]:+.1f}bp，這次 %{customdata[1]:+.1f}bp）" };
      });
      const L = baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "%" },
        shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: effrNow, y1: effrNow, line: { color: css("--muted"), width: 1, dash: "dash" } }],
        annotations: [{ xref: "paper", x: 1, y: effrNow, text: `EFFR ${effrNow.toFixed(2)}%`, showarrow: false, xanchor: "right", yanchor: "bottom", font: { size: 11, color: css("--muted") } }] });
      plot(id, tr, L);
      renderTable(pathOn(last));
    }

    if (v === "probs") {
      const rows = pathOn(last);
      const mk = (key, name, color) => ({ x: rows.map((r) => r.meeting), y: rows.map((r) => num(r[key]) * 100), name, type: "bar", marker: { color },
        text: rows.map((r) => (num(r[key]) >= 0.05 ? Math.round(num(r[key]) * 100) + "%" : "")), textposition: "inside", insidetextanchor: "middle",
        textfont: { color: "#fff", size: 11 }, hovertemplate: "%{y:.0f}%" });
      plot(id, [mk("p_cut", "降息", css("--down")), mk("p_hold", "不動", css("--muted")), mk("p_hike", "升息", css("--up"))],
        baseLayout({ barmode: "stack", xaxis: { ...baseLayout().xaxis, type: "category" }, yaxis: { ...baseLayout().yaxis, ticksuffix: "%", range: [0, 100] } }));
      renderTable(rows);
    }

    if (v === "cum") {
      const opts = [["next_move_bp", "下次會議"], ["cum_yearend_bp", "到年底"], ["cum_6m_bp", "6 個月後"], ["cum_12m_bp", "12 個月後"]];
      ctl.append(chips("期限", opts, S.cum, true, rr), rangeChips("range", rr), eventChips(rr));
      const rows = inRange(D.summ, "asof", S.range);
      const tr = opts.filter(([k]) => S.cum.includes(k)).map(([k, n], i) => ({
        x: rows.map((r) => r.asof), y: rows.map((r) => num(r[k])), name: n, type: "scatter", mode: "lines",
        line: { color: P[i % P.length], width: 1.8 }, hovertemplate: "%{y:+.1f}bp",
      }));
      const L = baseLayout({ yaxis: { ...baseLayout().yaxis, ticksuffix: "bp", zeroline: true, zerolinecolor: css("--muted") } });
      if (rows.length) addEvents(tr, L, rows[0].asof);
      plot(id, tr, L);
    }

    if (v === "spag") {
      ctl.append(rangeChips("spagRange", rr),
        chips("每隔", [[1, "1 天"], [5, "1 週"], [21, "1 個月"]], S.spagEvery, false, (x) => { S.spagEvery = x; rr(); }));
      const start = shiftDays(last, -RANGES[S.spagRange]);
      const sel = A.filter((a) => a >= start);
      const picked = sel.filter((_, i) => (sel.length - 1 - i) % S.spagEvery === 0);
      const g = css("--ghost"), tr = [];
      picked.forEach((a, i) => {
        if (a === last) return;
        const rows = pathOn(a), e = num((atOrBefore(D.effr, "date", a) || {}).effr);
        const { x, y } = stepXY(rows, a, e);
        const alpha = 0.12 + 0.45 * (i / Math.max(1, picked.length - 1));
        tr.push({ x, y, type: "scatter", mode: "lines", line: { color: `rgba(${g},${alpha.toFixed(2)})`, width: 1, shape: "hv" }, showlegend: false, hovertemplate: `${a} 的預期：%{y:.2f}%<extra></extra>` });
      });
      const ef = D.effr.filter((r) => r.date >= start);
      tr.push({ x: ef.map((r) => r.date), y: ef.map((r) => num(r.effr)), name: "EFFR 實際", type: "scatter", mode: "lines", line: { color: css("--ink"), width: 2.2, shape: "hv" }, hovertemplate: "EFFR %{y:.2f}%<extra></extra>" });
      const lp = stepXY(pathOn(last), last, effrNow);
      tr.push({ x: lp.x, y: lp.y, name: "今天的預期", type: "scatter", mode: "lines", line: { color: css("--up"), width: 2.6, shape: "hv" }, hovertemplate: "今天預期 %{y:.2f}%<extra></extra>" });
      tr.push({ x: [], y: [], name: "過去的預期", type: "scatter", mode: "lines", line: { color: `rgba(${g},0.5)`, width: 1 } });
      plot(id, tr, baseLayout({ hovermode: "closest", yaxis: { ...baseLayout().yaxis, ticksuffix: "%" },
        shapes: [{ type: "line", x0: last, x1: last, yref: "paper", y0: 0, y1: 1, line: { color: css("--muted"), width: 1, dash: "dot" } }],
        annotations: [{ x: last, yref: "paper", y: 1, text: "今天", showarrow: false, yanchor: "bottom", font: { size: 11, color: css("--muted") } }] }));
      if (picked.length < 3) { const n = document.createElement("span"); n.textContent = "（淡線要等資料累積幾週才會變多）"; ctl.append(n); }
    }
  }

  function renderTable(rows) {
    if (!rows.length) return;
    let h = "<table><thead><tr><th>FOMC</th><th>會議前</th><th>會議後隱含</th><th>這次 (bp)</th><th>累積 (bp)</th><th>降息</th><th>不動</th><th>升息</th></tr></thead><tbody>";
    rows.forEach((r) => {
      h += `<tr><td>${r.meeting}</td><td class="n">${num(r.pre).toFixed(3)}</td><td class="n">${num(r.post).toFixed(3)}</td>`
        + `<td class="n">${bp(num(r.move_bp), 1)}</td><td class="n">${bp(num(r.cum_bp), 1)}</td>`
        + `<td class="n">${pct(num(r.p_cut))}</td><td class="n">${pct(num(r.p_hold))}</td><td class="n">${pct(num(r.p_hike))}</td></tr>`;
    });
    $("#f-table").innerHTML = h + "</tbody></table>";
  }

  // ---------- 啟動 ----------
  function bindSeg(sel, key, render) {
    $(sel).addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      S[key] = b.dataset.v; $(sel).querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); render();
    });
  }
  function renderAll() { renderTiles(); renderYields(); renderFed(); }

  async function main() {
    [D.yields, D.effr, D.path, D.summ] = await Promise.all(["yields.csv", "effr.csv", "fed_path.csv", "fed_summary.csv"].map(load));
    try { D.meta = await (await fetch("data/meta.json", { cache: "no-cache" })).json(); } catch { D.meta = {}; }
    try { D.events = ((await (await fetch("data/events.json", { cache: "no-cache" })).json()).events || []).sort((a, b) => (a.date < b.date ? -1 : 1)); } catch { D.events = []; }
    D.yields.forEach((r, i) => (yIdx[r.date] = i));
    const ly = D.yields[D.yields.length - 1];
    $("#asof").textContent = ly ? `資料日期 ${ly.date}` : "尚無資料";
    if (D.meta.updated) $("#updated").textContent = ` 最後更新：${D.meta.updated}。`;
    bindSeg("#y-views", "yView", renderYields);
    bindSeg("#f-views", "fView", renderFed);
    renderAll();
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
  }
  main();
})();
