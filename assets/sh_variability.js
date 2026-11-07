/* Wind model variability at the Shilshole point — drawn in the browser.
 *
 * One SVG, one time axis, so a single crosshair reads everything at an hour:
 *
 *   the lines   every one of the last six HRRR runs (oldest faintest), the
 *               REFS ensemble mean with a band of ± its spread, and RRFS's
 *               hourly run (solid) against its older extended one (dashed)
 *   the strips  how far apart the HRRR runs are, sustained and gust; which
 *               way the newest run has moved; REFS's own spread; and, if both
 *               runs are there, RRFS's change between its two
 *   the arrows  the HRRR runs' mean direction, faint where they disagree, and
 *               REFS's where its members agree on one
 *
 * Numbers come from src/process/sh_variability.py and are not recomputed here:
 * the spread and trend must stay the map layer's definitions, and a second
 * implementation in JS is one more place for them to drift.
 *
 * Self-contained: reads <script type="application/json"
 * data-sh-variability-data> and draws into [data-sh-variability]. No literal
 * colours except the model hues the payload carries (the meteogram's own), so
 * the structure follows the theme without a redraw.
 */
(function () {
  'use strict';

  var node = document.querySelector('[data-sh-variability]');
  var src = document.querySelector('script[data-sh-variability-data]');
  if (!node || !src) return;
  var D;
  try { D = JSON.parse(src.textContent); } catch (e) { return; }
  if (!D || !D.times || !D.times.length) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var TZ = 'America/Los_Angeles';
  var nT = D.times.length, NR = D.runs.length;
  var C = D.colours || {};

  function el(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    return e;
  }
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var PTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
             'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(d) { return PTS[Math.round((d % 360) / 22.5) % 16]; }
  function signed(v) { return (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1); }
  // The day from the browser in Pacific time; the hour from the payload, which
  // Python already put on the 24-hour Pacific clock the rest of the page uses.
  function dayOf(i) {
    return new Date(D.times[i]).toLocaleDateString('en-US',
      { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
  }
  function niceMax(v) {
    var steps = [5, 10, 15, 20, 25, 30, 40, 50, 60, 80];
    for (var i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i];
    return Math.ceil(v / 20) * 20;
  }
  function trendWord(v) {
    if (!num(v)) return '';
    return Math.abs(v) < (D.trend_hold || 0.5) ? 'holding' : v > 0 ? 'windier' : 'calmer';
  }

  // Oldest faintest, newest at full weight and painted last, so it sits on top.
  function runAlpha(k) { return NR <= 1 ? 1 : 0.22 + 0.78 * k / (NR - 1); }

  /* ---------------------------------------------------------------- strips
   * Each strip is one row of per-hour cells over the same x as the lines.
   * One scale per KIND of number, stated in the row's own label so a shade
   * means a stated number rather than a rank. HRRR's two "apart" rows share a
   * scale, so gust and sustained can be compared by eye; REFS's spread is a
   * standard deviation, a different statistic, and gets its own. The trend
   * rows are diverging: warm is windier, cool is calmer. */
  var H = D.hours;
  var R = D.refs, Q = D.rrfs;
  function maxOf(arr) {
    var m = 0; arr.forEach(function (v) { if (num(v)) m = Math.max(m, Math.abs(v)); }); return m;
  }
  var apartTop = niceMax(Math.max(4, maxOf(H.map(function (h) { return h.spread; })),
                                  maxOf(H.map(function (h) { return h.gust_spread; }))));
  var trendTop = Math.max(3, Math.ceil(Math.max(maxOf(H.map(function (h) { return h.trend; })),
                                                Q ? maxOf(Q.change) : 0)));
  var refsTop = R ? niceMax(Math.max(4, maxOf(R.spread))) : 0;

  var STRIPS = [
    { key: 'apart', label: 'HRRR runs apart, sustained', unit: '0–' + apartTop + ' kt',
      v: function (i) { return H[i].spread; }, top: apartTop, few: true },
    { key: 'gapart', label: 'HRRR runs apart, gust', unit: '0–' + apartTop + ' kt',
      v: function (i) { return H[i].gust_spread; }, top: apartTop, few: true },
    { key: 'trend', label: 'Newest HRRR against the older runs', unit: '±' + trendTop + ' kt',
      v: function (i) { return H[i].trend; }, top: trendTop, diverging: true, few: true },
    { key: 'hdir', label: 'HRRR runs’ direction — faint where they disagree', arrows: true,
      d: function (i) { return H[i].dir; }, op: function (i) { return H[i].r; }, few: true }
  ];
  if (R) {
    STRIPS.push({ key: 'refs', label: 'REFS spread (members’ SD)', unit: '0–' + refsTop + ' kt',
      v: function (i) { return R.spread[i]; }, top: refsTop });
    STRIPS.push({ key: 'rdir', label: 'REFS direction — blank where its members disagree',
      arrows: true, d: function (i) { return R.dir[i]; }, op: function (i) { return R.agree[i]; } });
  }
  if (Q) {
    STRIPS.push({ key: 'rrfs', label: 'RRFS hourly against extended', unit: '±' + trendTop + ' kt',
      v: function (i) { return Q.change[i]; }, top: trendTop, diverging: true });
  }

  function viewW() {
    // The window when the host has no width yet (a hidden panel), never a
    // flat 760: that gave every phone the desktop viewBox.
    var w = node.clientWidth || window.innerWidth || 760;
    return w < 520 ? 380 : 760;
  }

  var host = null, lastW = 0;

  function draw() {
    var W = viewW();
    lastW = W;
    var narrow = W < 500;
    var M = { l: 30, r: 8, t: 10 };
    var LH = narrow ? 150 : 190;                  // the lines panel
    var AX = 26;                                  // hour ticks and the date
    var LAB = 12, CELL = narrow ? 13 : 16, GAP = 5;
    var colW = (W - M.l - M.r) / nT;
    function X(i) { return M.l + (i + 0.5) * colW; }
    var top = M.t, linesBottom = M.t + LH;
    var y0 = linesBottom + AX;
    var stripY = STRIPS.map(function (s, j) { return y0 + j * (LAB + CELL + GAP); });
    var Hh = y0 + STRIPS.length * (LAB + CELL + GAP) + 2;

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + Hh, role: 'img',
      'aria-label': 'The last ' + NR + ' HRRR runs at the Shilshole point, REFS and RRFS, ' +
                    'and how far apart they are, hour by hour' });

    // ---- lines: y scale from everything drawn on it
    var vals = [];
    D.speed.forEach(function (r) { r.forEach(function (v) { if (num(v)) vals.push(v); }); });
    if (R) R.wind.forEach(function (w, i) {
      if (num(w)) vals.push(w + (num(R.spread[i]) ? R.spread[i] : 0)); });
    if (Q) Q.speed.forEach(function (r) { r.forEach(function (v) { if (num(v)) vals.push(v); }); });
    var yMax = niceMax(Math.max(10, Math.max.apply(null, vals.concat([0])) * 1.05));
    function Y(v) { return linesBottom - (v / yMax) * LH; }

    var step = yMax <= 15 ? 5 : yMax <= 30 ? 10 : 20;
    for (var g = 0; g <= yMax; g += step) {
      svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: Y(g), y2: Y(g), class: 'ch-grid' }));
      var tl = el('text', { x: M.l - 4, y: Y(g) + 3, 'text-anchor': 'end', class: 'ch-tick' });
      tl.textContent = g + (g === yMax ? ' kt' : '');
      svg.appendChild(tl);
    }

    // ---- hour ticks: every 3 h wide, 6 h narrow; the date where the day turns
    var every = narrow ? 6 : 3;
    for (var i = 0; i < nT; i++) {
      var hh = +D.local[i].slice(0, 2);
      if (hh === 0) {
        svg.appendChild(el('line', { x1: X(i) - colW / 2, x2: X(i) - colW / 2, y1: top,
          y2: Hh, class: 'ch-grid', 'stroke-dasharray': '3 3' }));
        var dl = el('text', { x: X(i) - colW / 2 + 2, y: linesBottom + 22, class: 'ch-tick ch-date' });
        dl.textContent = dayOf(i);
        svg.appendChild(dl);
      }
      if (hh % every === 0) {
        var t = el('text', { x: X(i), y: linesBottom + 11, 'text-anchor': 'middle', class: 'ch-tick' });
        t.textContent = D.local[i].slice(0, 2);
        svg.appendChild(t);
      }
    }

    function line(series, colour, attrs) {
      var d = '', pen = false;
      series.forEach(function (v, i) {
        // A run that does not reach an hour BREAKS the line — the gap is the
        // information, and bridging it would forecast an hour nobody did.
        if (!num(v)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
        pen = true;
      });
      if (!d) return;
      var a = { d: d, fill: 'none', stroke: colour, 'stroke-linejoin': 'round',
                'stroke-linecap': 'round' };
      for (var k in attrs) a[k] = attrs[k];
      svg.appendChild(el('path', a));
    }

    // REFS band first: area goes behind every line.
    if (R) {
      var up = [], dn = [], seg = [];
      function flush() {
        if (up.length > 1) svg.appendChild(el('path', {
          d: 'M' + up.join('L') + 'L' + dn.reverse().join('L') + 'Z',
          fill: C.refs, opacity: 0.14, stroke: 'none' }));
        up = []; dn = [];
      }
      R.wind.forEach(function (w, i) {
        var s = R.spread[i];
        if (!num(w) || !num(s)) { flush(); return; }
        // Clipped at zero: a speed cannot be negative, and the band's lower
        // edge running below the axis would draw a spread the data lacks.
        up.push(X(i).toFixed(1) + ' ' + Y(w + s).toFixed(1));
        dn.push(X(i).toFixed(1) + ' ' + Y(Math.max(0, w - s)).toFixed(1));
      });
      flush();
    }
    if (Q) {
      line(Q.speed[0], C.rrfs, { 'stroke-width': 1.2, 'stroke-dasharray': '4 3', opacity: 0.8 });
      line(Q.speed[1], C.rrfs, { 'stroke-width': 1.2, opacity: 0.8 });
    }
    D.speed.forEach(function (r, k) {
      line(r, C.hrrr, { 'stroke-width': k === NR - 1 ? 2 : 1.2, opacity: runAlpha(k).toFixed(2) });
    });
    if (R) line(R.wind, C.refs, { 'stroke-width': 1.8 });

    // ---- the strips
    STRIPS.forEach(function (s, j) {
      var y = stripY[j];
      var lab = el('text', { x: M.l, y: y + 9, class: 'ch-rowlab' });
      lab.textContent = s.label + (s.unit ? ' · ' + s.unit : '');
      svg.appendChild(lab);
      var cy = y + LAB;
      for (var i = 0; i < nT; i++) {
        var x0 = M.l + i * colW + 0.5, w = colW - 1;
        if (s.arrows) {
          var dir = s.d(i), op = s.op(i);
          if (num(dir)) svg.appendChild(arrow(X(i), cy + CELL / 2, dir,
                                             Math.max(0.2, Math.min(1, num(op) ? op : 1)),
                                             Math.min(CELL, colW) * 0.9));
          else if (s.few && H[i].few) fewCell(x0, cy, w, CELL);
          continue;
        }
        var v = s.v(i);
        if (!num(v)) {
          // Too few runs is not "no difference": a dashed outline, never a
          // pale fill that would read as the runs agreeing.
          if (s.few && H[i].few) fewCell(x0, cy, w, CELL);
          continue;
        }
        var f = Math.min(1, Math.abs(v) / s.top);
        var fill = s.diverging ? (v >= 0 ? 'var(--accent-2)' : 'var(--accent)') : 'var(--accent-2)';
        svg.appendChild(el('rect', { x: x0, y: cy, width: w, height: CELL, rx: 1.5,
                                     fill: fill, opacity: (0.1 + 0.85 * f).toFixed(2) }));
        // The number too when a column is wide enough to hold it — the shade
        // is for scanning, the number is what gets read. Its ink swaps to the
        // page ground on a strong fill, which is right in both themes.
        if (colW >= 20) {
          var tx = el('text', { x: X(i), y: cy + CELL / 2 + 3.5, 'text-anchor': 'middle',
                                class: 'ch-tick', style: 'fill:' + (f >= 0.55 ? 'var(--bg)' : 'var(--ink)') });
          // Signed only when the whole-knot figure is not zero: "+0" and
          // "−0" claim a direction the rounded number does not have.
          var rv = Math.round(Math.abs(v));
          tx.textContent = s.diverging && rv ? (v > 0 ? '+' : '−') + rv : String(rv);
          svg.appendChild(tx);
        }
      }
    });

    function fewCell(x, y, w, h) {
      svg.appendChild(el('rect', { x: x + 0.5, y: y + 0.5, width: Math.max(0, w - 1), height: h - 1,
        fill: 'none', stroke: 'var(--line)', 'stroke-dasharray': '2 2' }));
    }

    // ---- now, from the READER's clock, not the build's
    var nowF = fracIndex(Date.now());
    if (nowF !== null) {
      var nx = M.l + (nowF + 0.5) * colW;
      svg.appendChild(el('line', { x1: nx, x2: nx, y1: top, y2: linesBottom, class: 'ch-now' }));
    }

    host.textContent = '';
    host.appendChild(svg);
    wireHover(svg, W, M, colW, X, top, Hh);
  }

  /* An arrow that flies WITH the wind, as on every weather map and the rest of
     this page: rotated by the from-bearing plus 180. The readout names where
     it comes FROM; the two are one fact 180 degrees apart. */
  function arrow(cx, cy, from, op, len) {
    var g = el('g', { transform: 'translate(' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ') rotate(' +
                                 (from + 180) + ')', opacity: op.toFixed(2) });
    var h = len / 2;
    g.appendChild(el('path', { d: 'M0 ' + h + ' L0 ' + (-h) + ' M0 ' + (-h) + ' L' + (-h * 0.5) + ' ' +
                               (-h * 0.35) + ' M0 ' + (-h) + ' L' + (h * 0.5) + ' ' + (-h * 0.35),
                               fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 1.3,
                               'stroke-linecap': 'round' }));
    return g;
  }

  // Fractional column of an instant, or null off the axis.
  function fracIndex(ms) {
    var t0 = Date.parse(D.times[0]), t1 = Date.parse(D.times[nT - 1]);
    if (ms < t0 - 1800000 || ms > t1 + 1800000) return null;
    return (ms - t0) / 3600000;
  }

  /* ---------------------------------------------------------------- readout
   * The charts.js pattern: a transparent rect over the whole figure catches
   * the pointer anywhere, and a .chart-scrub slider under it drives the same
   * readout where there is no hover at all. */
  function wireHover(svg, W, M, colW, X, top, bottom) {
    var guide = el('line', { class: 'ch-guide', opacity: 0, 'pointer-events': 'none',
                             y1: top, y2: bottom });
    svg.appendChild(guide);
    var box = document.createElement('div');
    box.className = 'hov';
    box.hidden = true;
    host.appendChild(box);
    var hit = el('rect', { x: M.l, y: top, width: W - M.l - M.r, height: bottom - top,
                           fill: 'none', 'pointer-events': 'all' });
    svg.appendChild(hit);

    function row(swatch, label, value, alpha) {
      return '<span><i style="background:' + swatch + (alpha !== undefined ? ';opacity:' + alpha : '') +
             '"></i><b class="lbl">' + label + '</b><em>' + value + '</em></span>';
    }

    function showIndex(i) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      i = Math.max(0, Math.min(nT - 1, i));
      if (+slider.value !== i) slider.value = String(i);
      var scale = W / r.width, gx = X(i);
      guide.setAttribute('x1', gx.toFixed(1));
      guide.setAttribute('x2', gx.toFixed(1));
      guide.setAttribute('opacity', 1);

      var h = H[i];
      var html = '<b>' + esc(dayOf(i)) + ' ' + D.local[i] + ' ' + esc(D.runs[NR - 1].tz || '') + '</b>';
      /* A row per RUN, always, oldest first — a run that stops short says
         "does not reach" rather than vanishing, so the box does not change
         height under the slider and the falling sample count stays visible. */
      html += '<u>HRRR, oldest run first</u>';
      D.runs.forEach(function (run, k) {
        var v = D.speed[k][i], gu = D.gust[k][i], dir = D.dir[k][i];
        html += row(C.hrrr, run.init_local + ' run',
                    num(v) ? (num(dir) ? compass(dir) + ' ' : '') + Math.round(v) +
                             (num(gu) ? ' g' + Math.round(gu) : '') + ' kt'
                           : 'does not reach', runAlpha(k).toFixed(2));
      });
      html += '<u>Across ' + h.n + ' run' + (h.n === 1 ? '' : 's') + '</u>';
      if (num(h.spread)) {
        html += row('var(--accent-2)', 'apart, sustained',
                    h.spread.toFixed(1) + ' kt (' + Math.round(h.lo) + '–' + Math.round(h.hi) + ')');
        if (num(h.gust_spread)) html += row('var(--accent-2)', 'apart, gust', h.gust_spread.toFixed(1) + ' kt');
        if (num(h.trend)) html += row(h.trend >= 0 ? 'var(--accent-2)' : 'var(--accent)',
                                      'newest vs older', signed(h.trend) + ' kt ' + trendWord(h.trend));
        if (num(h.dir)) html += row('var(--ink-2)', 'direction',
                                    'from ' + compass(h.dir) + ' ±' + h.sd_deg + '°');
      } else {
        // Not zero: none. Fewer runs than make a spread is no evidence.
        html += row('var(--line)', 'too few runs', 'under ' + D.min_runs + ', no spread');
      }
      if (R) {
        html += '<u>REFS ensemble, ' + R.init_local + ' run</u>';
        if (num(R.wind[i])) {
          html += row(C.refs, 'mean ± spread', R.wind[i].toFixed(1) +
                      (num(R.spread[i]) ? ' ±' + R.spread[i].toFixed(1) : '') + ' kt');
          html += row(C.refs, 'direction', num(R.dir[i]) ? 'from ' + compass(R.dir[i])
                                                         : 'members disagree', 0.55);
        } else {
          html += row(C.refs, 'REFS', 'no frame this hour');
        }
      }
      if (Q) {
        var e = Q.speed[0][i], hr = Q.speed[1][i];
        html += '<u>RRFS, two runs</u>';
        html += row(C.rrfs, Q.runs[1].init_local + ' hourly', num(hr) ? hr.toFixed(1) + ' kt' : 'does not reach');
        html += row(C.rrfs, Q.runs[0].init_local + ' extended', num(e) ? e.toFixed(1) + ' kt' : 'does not reach', 0.6);
        if (num(Q.change[i])) html += row(Q.change[i] >= 0 ? 'var(--accent-2)' : 'var(--accent)',
                                          'change', signed(Q.change[i]) + ' kt');
      }
      box.innerHTML = html;
      box.hidden = false;

      // Beside the crosshair, flipped past halfway so it never covers the
      // hour being read; clamped to the host.
      var hr0 = host.getBoundingClientRect();
      var px = (r.left - hr0.left) + gx / scale;
      var avail = host.clientWidth, w = box.offsetWidth;
      var left = px > avail / 2 ? px - 14 - w : px + 14;
      box.style.left = Math.max(0, Math.min(avail - w, left)) + 'px';
    }

    function show(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var x = (ev.clientX - r.left) * (W / r.width);
      showIndex(Math.floor((x - M.l) / colW));
    }
    function hide() { guide.setAttribute('opacity', 0); box.hidden = true; }

    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);     // touch: tap to read
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointercancel', hide);
    // The page still scrolls vertically over the chart; a press-and-hold reads
    // the hour instead of raising the system image callout.
    hit.style.touchAction = 'pan-y';
    hit.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'chart-scrub';
    slider.min = '0';
    slider.max = String(nT - 1);
    slider.step = '1';
    slider.value = '0';
    slider.setAttribute('aria-label', 'Scrub the variability chart by hour');
    slider.addEventListener('input', function () { showIndex(+slider.value); });
    host.appendChild(slider);

    /* No hover here: open the readout parked on the reader's own hour, so the
       slider says what it does. Deferred until the chart has a width, as
       charts.js does, in case the section starts hidden. */
    if (window.matchMedia && matchMedia('(hover:none) and (pointer:coarse)').matches) {
      var f = fracIndex(Date.now());
      var start = f === null ? 0 : Math.round(f);
      if (svg.getBoundingClientRect().width) showIndex(start);
      else if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () {
          if (!svg.getBoundingClientRect().width) return;
          ro.disconnect();
          showIndex(start);
        });
        ro.observe(host);
      }
    }
  }

  // .chart-host, so the page's own rules place the readout (floating on a
  // desktop, in flow under the chart on a touch screen) and show the slider.
  host = document.createElement('div');
  host.className = 'chart-host sh-var-host';
  node.textContent = '';
  node.appendChild(host);
  draw();

  // Redraw only when the column crosses the narrow/wide breakpoint.
  var tm;
  window.addEventListener('resize', function () {
    clearTimeout(tm);
    tm = setTimeout(function () { if (viewW() !== lastW) draw(); }, 180);
  });
})();
