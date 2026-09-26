/* Meteogram charts, drawn in the browser.
 *
 * These used to be matplotlib SVGs rendered at build time: 15 files, 2.7 MB,
 * with hover tooltips injected as <title> on each tagged artist. That made
 * hovering a 1 px dotted direction line the only way to read a value, which is
 * exactly the part that was reported as unreliable. Drawing here instead costs
 * 161 KB of JSON for the same 15 charts and lets the pointer be caught anywhere
 * in the plot.
 *
 * Deliberately generic: it knows about rows, series and a time axis, not about
 * meteograms. A future page (Shilshole day sailing) emits the same shape under
 * its own host elements and reuses this file unchanged.
 *
 * Payload contract, per chart:
 *   { name, t0 (ISO UTC), now_min, hindcast_h,
 *     rows: [ { kind, label, unit, source, source_differs, no_obs,
 *               series: [ { key, name, colour, style: line|points,
 *                           dashed?, cycle?, t: [minutes from t0], v: [] } ] } ] }
 *
 * Times are minutes from t0 rather than timestamps because the observations are
 * 6-minutely over 24 h — ISO strings would be roughly ten times the bytes, and
 * payload is the whole point of moving these here.
 */
(function () {
  'use strict';

  /* Every payload on the page, namespaced by KIND. A page may carry several —
     the briefing has per-station meteograms and per-panel observed wind — and
     their keys are drawn from different vocabularies, so a flat map would be one
     careless name away from a collision. A host names both: data-chart is the
     kind, data-key the entry. */
  var DATA = {};
  [].slice.call(document.querySelectorAll('script[type="application/json"][data-charts]'))
    .forEach(function (n) {
      try {
        DATA[n.dataset.charts] = (JSON.parse(n.textContent) || {}).charts || {};
      } catch (e) { /* one malformed payload must not take the others down */ }
    });
  if (!Object.keys(DATA).length) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  /* viewBox width, chosen per host. The row heights are fixed, so a NARROWER
     viewBox is a TALLER chart once scaled to the column: at 760 the three rows
     came to 138 px on a 269 px phone — about 38 px each, unreadable. 380 makes
     the same chart 276 px there, at the cost of fewer hours across the axis. */
  function viewW(host) {
    // Falls back to the WINDOW, not to 760. These charts sit inside collapsed
    // disclosures, so at load every host is display:none and clientWidth is 0 —
    // a 760 fallback silently gave every phone the desktop viewBox.
    var w = host.clientWidth || window.innerWidth || 760;
    return w < 520 ? 380 : 760;
  }
  // b carries TWO lines: the time tick and, where the day turns, its date.
  var M = { l: 54, r: 12, t: 14, b: 38 };
  // Row heights in viewBox units, mirroring the old figure's ratios: direction
  // is a categorical read (southerly or westerly?), not a magnitude, so it does
  // not need a full-height panel.
  var ROW_H = { wind: 108, pres: 108, grad: 100, sst: 104, dir: 62,
                vis: 84, pct: 84, tide: 120, cur: 120, cz: 150,
                arrows: 22, wave: 70, temp: 70, ltg: 78 };
  var ROW_GAP = 30;
  var SNAP_MIN = 60;                          // crosshair snaps to the clock hour
  var NEAR_MIN = 35;                          // how far a sample may be from it
  var SPARSE = 12;                            // at or under this, mark the points too
  // Floor for the shaded "now" hour, in viewBox units. Below it the band reads
  // as a line, which is what a 96 h axis 269 px wide was drawing.
  var NOW_MIN_PX = 9;

  function el(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) {
      e.setAttribute(k, attrs[k]);
    }
    return e;
  }
  function num(x) { return typeof x === 'number' && isFinite(x); }

  /* Local wall-clock formatting. The page is read in Pacific time regardless of
   * where the browser is, so the zone is named rather than inherited — a reader
   * on a boat with the laptop still on UTC should not get a chart labelled in
   * UTC while every other time on the page is PDT. */
  var TZ = 'America/Los_Angeles';
  function at(t0, mins) { return new Date(t0.getTime() + mins * 60000); }
  function hhmm(d) {
    return d.toLocaleTimeString('en-US', {
      timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true
    }).replace(' ', '').toLowerCase();
  }
  function stamp(d) {
    return d.toLocaleDateString('en-US', {
      timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short'
    }) + ', ' + hhmm(d);
  }

  // Compass point, for the direction readout. Degrees are what the data holds;
  // nobody reads a marine forecast in degrees.
  var PTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
             'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(deg) { return PTS[Math.round((deg % 360) / 22.5) % 16]; }

  function fmt(row, v) {
    if (!num(v)) return null;
    var kind = row.kind;
    if (kind === 'dir') return compass(v) + ' (' + Math.round(v) + '°)';
    if (kind === 'wind') return v.toFixed(1) + ' kt';
    // Both scales. The reading is used for two different judgements — how cold
    // the water is to fall into, and how it compares with the air — and readers
    // here do not all think in the same units.
    // Sent in FAHRENHEIT, which is what this page leads with; Celsius follows
    // because the instrument and every reference for it are metric.
    if (kind === 'sst') return v.toFixed(1) + '°F · ' + ((v - 32) * 5 / 9).toFixed(1) + '°C';
    if (kind === 'grad') {
      /* A SIGNED series: the sign is the reading, so it is spoken rather than
         printed. Positive is one direction down the axis and negative the
         other, and nobody should have to remember which. */
      var d = row.signed || {};
      var word = v >= 0 ? d.positive : d.negative;
      return Math.abs(v).toFixed(1) + ' kt' + (word ? ' from ' + word : '');
    }
    // The Shilshole page's rows (src/process/shilshole.py).
    if (kind === 'vis') return (row.cap && v >= row.cap ? row.cap + '+' : v.toFixed(1)) + ' mi';
    if (kind === 'pct') return Math.round(v) + '%';
    if (kind === 'tide' || kind === 'wave') return v.toFixed(1) + ' ft';
    if (kind === 'temp') return Math.round(v) + '°F';
    if (kind === 'ltg') return ['none', 'trace', 'possible', 'likely', 'strong'][Math.round(v)] || '';
    if (kind === 'arrows') return 'from ' + compass(v) + ' (' + ('00' + Math.round(v)).slice(-3) + '°)';
    if (kind === 'cz') {
      // A latitude, said against Shilshole's own.
      var nm = (v - (row.ref || 47.68)) * 60;
      return v.toFixed(2) + '°N · ' + (Math.abs(nm) < 3 ? 'over Shilshole' :
        Math.abs(nm).toFixed(0) + ' nm ' + (nm > 0 ? 'north' : 'south'));
    }
    if (kind === 'cur') {
      // Signed along the station's axis: the sign IS the reading, so it is said.
      if (Math.abs(v) < 0.05) return 'slack';
      return Math.abs(v).toFixed(1) + ' kt ' + (v > 0 ? 'flood' : 'ebb');
    }
    return v.toFixed(1) + (row.unit === 'mb' ? ' mb' : ' hPa');
  }

  /* A "nice" axis: round limits and a step that lands on readable numbers. Data
   * min/max alone put gridlines at 1007.3 hPa. */
  function nice(lo, hi) {
    if (!num(lo) || !num(hi)) return { lo: 0, hi: 1, step: 1 };
    if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
    var span = hi - lo;
    var raw = span / 4;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var step = [1, 2, 2.5, 5, 10].reduce(function (best, m) {
      return Math.abs(m * mag - raw) < Math.abs(best * mag - raw) ? m : best;
    }, 1) * mag;
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step: step };
  }

  function draw(host) {
    var spec = (DATA[host.dataset.chart] || {})[host.dataset.key];
    if (!spec || !spec.rows || !spec.rows.length) return;

    // Local, NOT module-level: wireHover's listeners run long after draw()
    // returns, so a shared W would be whatever the last host happened to set.
    var W = viewW(host);

    var t0 = new Date(spec.t0);
    // One time span for every row, so the rows stack into a single readable
    // timeline and one crosshair can serve all of them.
    var tmin = 0, tmax = 0;
    spec.rows.forEach(function (r) {
      r.series.forEach(function (s) {
        if (!s.t.length) return;
        tmin = Math.min(tmin, s.t[0]);
        tmax = Math.max(tmax, s.t[s.t.length - 1]);
      });
    });
    if (tmax <= tmin) return;

    /* An observations-only chart ends at its LAST READING, which is minutes
       before now — so "now" fell just off the right edge and the band never
       drew on the wind panels, the pressure axes or the water temperature.
       The axis is extended to reach the present when the gap is small, which
       both shows the band and makes the gap itself visible: the distance from
       the last reading to the now line is how stale the data is.
       Beyond STALE_H the page is old enough that stretching the axis to today
       would be a claim about currency it cannot support. */
    var STALE_H = 6;
    var nowRaw = (Date.now() - t0.getTime()) / 60000;
    if (nowRaw > tmax && nowRaw - tmax <= STALE_H * 60) tmax = nowRaw;
    var nowMin = (nowRaw >= tmin && nowRaw <= tmax) ? nowRaw : null;

    var innerW = W - M.l - M.r;
    function X(mins) { return M.l + (mins - tmin) / (tmax - tmin) * innerW; }

    var H = M.t + M.b + spec.rows.reduce(function (a, r) {
      return a + (ROW_H[r.kind] || 100) + ROW_GAP;
    }, 0) - ROW_GAP;

    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      preserveAspectRatio: 'xMidYMid meet',
      'aria-label': spec.name
    });

    var panels = [];
    var y0 = M.t;
    spec.rows.forEach(function (row) {
      var h = ROW_H[row.kind] || 100;
      var top = y0, bottom = y0 + h;

      // ---- vertical scale
      var lo = Infinity, hi = -Infinity;
      row.series.forEach(function (s) {
        s.v.forEach(function (v) {
          if (num(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        });
        // Gusts are by definition the top of the range; leaving them out of the
        // scale clipped them straight through the top of the panel.
        if (s.g) s.g.forEach(function (v) {
          if (num(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
        });
        // Ghost runs are real forecasts and must fit on the axis too.
        if (s.runs) s.runs.forEach(function (gr) {
          gr.v.forEach(function (v) {
            if (num(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
          });
        });
        // An uncertainty band reaches past its own line both ways; ranging on
        // the line alone would clip the band at exactly the hours it is widest.
        if (s.band) [s.band.lo, s.band.hi].forEach(function (arr) {
          arr.forEach(function (v) {
            if (num(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
          });
        });
      });
      var ax;
      if (row.kind === 'dir') {
        ax = { lo: 0, hi: 360, step: 90 };     // fixed: direction is circular
      } else if (row.kind === 'ltg') {
        ax = { lo: 0, hi: 4, step: 1 };          // the four bands and none, named on the axis
      } else if (row.kind === 'arrows') {
        ax = { lo: 0, hi: 1, step: 1 };          // no scale: the arrows are the reading
      } else if (row.kind === 'cz') {
        ax = { lo: 47.4, hi: 48.3, step: 0.1 };  // the transect, Tacoma to Whidbey
      } else if (row.kind === 'pct') {
        ax = { lo: 0, hi: 100, step: 25 };     // a chance is out of 100, always
      } else if (row.kind === 'vis') {
        ax = { lo: 0, hi: row.cap || 10, step: 2 };
      } else if (row.kind === 'cur') {
        // Symmetric about slack, so flood and ebb read at the same scale.
        var m = Math.max(Math.abs(lo), Math.abs(hi), 0.5);
        ax = nice(-m, m);
      } else {
        ax = nice(lo, hi);
      }
      var Y = (function (a) {
        return function (v) {
          return bottom - (v - a.lo) / (a.hi - a.lo) * (bottom - top);
        };
      })(ax);

      // ---- midnight and sunrise/sunset, the day's shape, behind everything
      (spec.rules || []).forEach(function (rl) {
        if (rl.m < tmin || rl.m > tmax) return;
        svg.appendChild(el('line', {
          x1: X(rl.m).toFixed(1), x2: X(rl.m).toFixed(1), y1: top, y2: bottom,
          class: rl.kind === 'midnight' ? 'ch-rule-mid' : 'ch-rule-sun'
        }));
      });

      /* ---- named latitudes instead of numbers (the convergence chart): the
         question is "over Edmonds or over Shilshole", not "47.81". */
      if (row.ticks) {
        row.ticks.forEach(function (tk) {
          if (tk.v < ax.lo || tk.v > ax.hi) return;
          var ty = Y(tk.v);
          svg.appendChild(el('line', { x1: M.l, x2: W - M.r, y1: ty.toFixed(1),
                                       y2: ty.toFixed(1), class: 'ch-grid' }));
          // Inside the plot, just above its line: the 54 px margin holds a
          // number, not "Des Moines".
          var tl = el('text', { x: M.l + 4, y: (ty - 2.5).toFixed(1), 'text-anchor': 'start',
                                class: 'ch-tick' + (tk.strong ? ' ch-tick-strong' : '') });
          tl.textContent = tk.label;
          svg.appendChild(tl);
        });
      }

      // ---- gridlines and value labels
      for (var g = ax.lo; g <= ax.hi + 1e-9 && row.kind !== 'arrows' && !row.ticks; g += ax.step) {
        var gy = Y(g);
        svg.appendChild(el('line', {
          x1: M.l, x2: W - M.r, y1: gy.toFixed(1), y2: gy.toFixed(1),
          class: 'ch-grid'
        }));
        var lab = el('text', {
          x: M.l - 6, y: (gy + 3.2).toFixed(1), 'text-anchor': 'end', class: 'ch-tick'
        });
        lab.textContent = row.kind === 'dir'
          ? ['N', 'E', 'S', 'W', 'N'][Math.round(g / 90)]
          : (ax.step < 1 ? g.toFixed(1) : String(Math.round(g)));
        svg.appendChild(lab);
      }

      // ---- row label, naming the source station when it is not the obvious one
      var t = el('text', { x: M.l, y: top - 5, class: 'ch-rowlab' });
      t.textContent = row.label + (row.unit !== 'deg' ? ' (' + row.unit + ')' : '') +
                      (row.source_differs ? '  ·  ' + row.source : '');
      svg.appendChild(t);

      // ---- "no observations" note, said rather than left implied: without it
      // the model traces read as though they WERE the observation.
      if (row.no_obs) {
        var w = el('text', {
          x: (M.l + W - M.r) / 2, y: (top + bottom) / 2, 'text-anchor': 'middle',
          class: 'ch-noobs'
        });
        w.textContent = 'no ' + (row.kind === 'pres' ? 'pressure' : 'wind') +
                        ' observations from ' + row.source +
                        ' in the last ' + spec.hindcast_h + ' h — model traces only';
        svg.appendChild(w);
      }

      /* ---- uncertainty bands, all of them, BEFORE any line. A band is area:
         drawn in series order, the REFS band (last in the payload) would lie
         over the HRRR and RRFS lines and tint them. Faint, and in the series'
         own colour, so it reads as that trace's spread and not a fourth thing. */
      row.series.forEach(function (s) {
        if (!s.band || !s.t.length) return;
        var top = [], bot = [];
        for (var bi = 0; bi < s.t.length; bi++) {
          if (!num(s.band.lo[bi]) || !num(s.band.hi[bi])) continue;
          top.push(X(s.t[bi]).toFixed(1) + ' ' + Y(s.band.hi[bi]).toFixed(1));
          bot.unshift(X(s.t[bi]).toFixed(1) + ' ' + Y(s.band.lo[bi]).toFixed(1));
        }
        if (top.length > 1) svg.appendChild(el('path', {
          d: 'M' + top.join('L') + 'L' + bot.join('L') + 'Z',
          fill: s.colour, opacity: 0.16, stroke: 'none', class: 'ch-band'
        }));
      });

      /* ---- ghost runs: the last few HRRR runs, faint, oldest faintest. Behind
         every line, like the bands. Thin and undashed — they are context for
         the current HRRR line, and at full weight six of them would be the
         illegibility the two-panel split exists to avoid. */
      row.series.forEach(function (s) {
        if (s.style !== 'ghosts' || !s.runs) return;
        var nr = s.runs.length;
        s.runs.forEach(function (gr, gi) {
          var dd = '', pg = false;
          for (var q = 0; q < gr.t.length; q++) {
            if (!num(gr.v[q])) { pg = false; continue; }
            dd += (pg ? 'L' : 'M') + X(gr.t[q]).toFixed(1) + ' ' + Y(gr.v[q]).toFixed(1);
            pg = true;
          }
          if (dd) svg.appendChild(el('path', {
            d: dd, fill: 'none', stroke: s.colour, 'stroke-width': 0.9,
            opacity: (0.14 + 0.36 * (gi + 1) / nr).toFixed(2), class: 'ch-ghost',
            'stroke-linejoin': 'round', 'stroke-linecap': 'round'
          }));
        });
      });

      // ---- the data
      row.series.forEach(function (s) {
        if (!s.t.length) return;
        if (s.style === 'arrows') {
          /* Arrows fly WITH the wind, north up — a southerly points up the
             page — the Lake Union briefing's convention; the readout and the
             tables name where it comes FROM. Thinned to one every ~22 px so
             they never touch. */
          var ga = el('g', { fill: 'none', stroke: s.colour, 'stroke-width': 1.3,
                             'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
          var lastX = -1e9, cy = (top + bottom) / 2;
          for (var ai = 0; ai < s.t.length; ai++) {
            if (!num(s.v[ai])) continue;
            var ax_ = X(s.t[ai]);
            if (ax_ - lastX < 22) continue;
            lastX = ax_;
            var rot = (s.v[ai] + 180) % 360;
            ga.appendChild(el('path', {
              d: 'M0 6 L0 -6 M-3.5 -2.5 L0 -6 L3.5 -2.5',
              transform: 'translate(' + ax_.toFixed(1) + ' ' + cy.toFixed(1) + ') rotate(' + rot + ')'
            }));
          }
          svg.appendChild(ga);
          return;
        }
        if (s.style === 'bars') {
          // A chance of rain is an amount per hour, drawn as bars from zero.
          var gb = el('g', { fill: s.colour, opacity: 0.45 });
          var bw = Math.max(1.5, (X(60) - X(0)) * 0.7);
          for (var bi = 0; bi < s.t.length; bi++) {
            if (!num(s.v[bi]) || s.v[bi] <= 0) continue;
            var yb = Y(s.v[bi]);
            gb.appendChild(el('rect', { x: (X(s.t[bi]) - bw / 2).toFixed(1), y: yb.toFixed(1),
                                        width: bw.toFixed(1), height: (Y(0) - yb).toFixed(1) }));
          }
          svg.appendChild(gb);
          return;
        }
        if (s.style === 'points') {
          // Markers, never a line. Direction is circular, so a line through a
          // 350 -> 10 degree shift sweeps the axis and invents a southerly that
          // never happened.
          var g2 = el('g', { fill: s.colour, opacity: s.dashed ? 0.55 : 1 });
          for (var i = 0; i < s.t.length; i++) {
            if (!num(s.v[i])) continue;
            g2.appendChild(el('circle', {
              cx: X(s.t[i]).toFixed(1), cy: Y(s.v[i]).toFixed(1),
              r: s.key === 'obs' ? 1.1 : (s.dashed ? 1.3 : 1.9)
            }));
          }
          svg.appendChild(g2);
        } else {
          /* An optional companion trace on the SAME time base — gusts against
             sustained wind. Drawn faint and dotted on purpose: four solid plus
             four dotted lines at equal weight read as eight equal lines, which
             is the illegibility the two-panel split exists to avoid. It shares
             the station's colour and is reported on the station's own readout
             line rather than as a series of its own. */
          if (s.g) {
            var dg = '', peng = false;
            for (var k = 0; k < s.t.length; k++) {
              if (!num(s.g[k])) { peng = false; continue; }
              dg += (peng ? 'L' : 'M') + X(s.t[k]).toFixed(1) + ' ' + Y(s.g[k]).toFixed(1);
              peng = true;
            }
            if (dg) svg.appendChild(el('path', {
              d: dg, fill: 'none', stroke: s.colour, 'stroke-width': 0.8,
              'stroke-dasharray': '1.5 2', opacity: 0.42,
              'stroke-linejoin': 'round', 'stroke-linecap': 'round'
            }));
          }
          var d = '', pen = false;
          for (var j = 0; j < s.t.length; j++) {
            if (!num(s.v[j])) { pen = false; continue; }
            d += (pen ? 'L' : 'M') + X(s.t[j]).toFixed(1) + ' ' + Y(s.v[j]).toFixed(1);
            pen = true;
          }
          /* A handful of points across a day is a line fragment 20 px wide —
             Point Wells came back from a week-long outage with 40 minutes of
             wind on a 25-hour chart and was, correctly but uselessly, drawn.
             Few enough points and they are marked as well as joined. */
          if (s.t.length <= SPARSE) {
            var gs = el('g', { fill: s.colour, opacity: s.dashed ? 0.55 : 1 });
            for (var q = 0; q < s.t.length; q++) {
              if (!num(s.v[q])) continue;
              gs.appendChild(el('circle', { cx: X(s.t[q]).toFixed(1),
                                            cy: Y(s.v[q]).toFixed(1), r: 2.4 }));
            }
            svg.appendChild(gs);
          }
          if (d) svg.appendChild(el('path', {
            d: d, fill: 'none', stroke: s.colour,
            'stroke-width': s.key === 'obs' ? 1.6 : (s.dashed ? 1.1 : 1.9),
            'stroke-dasharray': s.dashed ? '4 2' : null,
            opacity: s.dashed ? 0.55 : 1,
            'stroke-linejoin': 'round', 'stroke-linecap': 'round'
          }));
        }
      });

      // ---- zero, where crossing it means the wind reverses down the axis
      if (row.zero && ax.lo < 0 && ax.hi > 0) {
        svg.appendChild(el('line', {
          x1: M.l, x2: W - M.r, y1: Y(0).toFixed(1), y2: Y(0).toFixed(1),
          class: 'ch-zero'
        }));
      }

      /* ---- now, from the BROWSER's clock.
         spec.now_min is when the page was BUILT, which is not when it is being
         read — these are published twice a day and the runs are queued, so the
         gap is routinely hours. The band covers the reader's current hour, the
         same hour the crosshair snaps to, and is omitted entirely when the
         chart does not reach the present rather than being pinned to an edge
         and implying it does. */
      if (nowMin !== null) {
        var h0 = Math.floor(nowMin / 60) * 60, h1 = h0 + 60;
        var bx = X(Math.max(tmin, h0)), bw = X(Math.min(tmax, h1)) - bx;
        /* An hour is an hour, but a 96-hour axis 269 px wide draws it 2.8 px
           wide — measured on the live page at 375 px, where the band was
           technically present and visually nothing. Widened to a floor and
           re-centred on the hour, so "you are here" reads as a band at every
           axis length instead of only on the short ones. */
        if (bw > 0) {
          if (bw < NOW_MIN_PX) {
            bx = Math.max(M.l, bx + bw / 2 - NOW_MIN_PX / 2);
            bw = Math.min(NOW_MIN_PX, W - M.r - bx);
          }
          svg.appendChild(el('rect', {
            x: bx.toFixed(1), y: top, width: bw.toFixed(1),
            height: bottom - top, class: 'ch-nowband'
          }));
        }
        svg.appendChild(el('line', {
          x1: X(nowMin).toFixed(1), x2: X(nowMin).toFixed(1),
          y1: top, y2: bottom, class: 'ch-now'
        }));
      }

      if (nowMin !== null && !panels.length) {
        // On an observations chart "now" IS the right edge, so the label has to
        // flip inside the plot or it is clipped by the viewBox — it read "n(".
        var nx = X(nowMin), edge = nx > W - M.r - 34;
        var nl = el('text', { x: (edge ? nx - 4 : nx + 4).toFixed(1), y: top + 9,
                              'text-anchor': edge ? 'end' : 'start',
                              class: 'ch-nowlab' });
        nl.textContent = 'now';
        svg.appendChild(nl);
      }
      panels.push({ row: row, top: top, bottom: bottom, Y: Y });
      y0 = bottom + ROW_GAP;
    });

    // ---- time axis along the bottom
    var axisY = y0 - ROW_GAP + 15;
    var hours = (tmax - tmin) / 60;
    var want = Math.max(4, Math.round(innerW / 95));
    /* The ladder has to reach past a day. Topping out at 24 h put THIRTY ticks
       across a 30-day chart — every label drawn over the next, and the date row
       below it an unreadable smear. 48/72/168 (weekly) cover the longer spans. */
    var stepH = [1, 2, 3, 6, 12, 24, 48, 72, 168].reduce(function (best, c) {
      return Math.abs(c - hours / want) < Math.abs(best - hours / want) ? c : best;
    }, 24);
    // Past a day apart, the DATE is the label and the clock time is noise.
    var dateOnly = stepH >= 24;
    // Ticks on the CLOCK, not on multiples of the step from t0. t0 is
    // "now minus 24 h" and never lands on the hour, so an axis stepped from it
    // was labelled 3:17pm, 3:17am, 3:17pm — the same defect the crosshair had.
    var msStep = stepH * 3600000;
    var firstMs = Math.ceil(at(t0, tmin).getTime() / msStep) * msStep;
    var lastMs = at(t0, tmax).getTime();
    var prevDay = null;
    for (var ms = firstMs; ms <= lastMs; ms += msStep) {
      var m = (ms - t0.getTime()) / 60000;
      var d0 = new Date(ms);
      // Anchored away from the edges, or the first and last labels are clipped
      // by the viewBox — the right-hand one read "5:00ar".
      var px = X(m);
      var anch = px < M.l + 22 ? 'start' : (px > W - M.r - 22 ? 'end' : 'middle');
      var day = d0.toLocaleDateString('en-US', {
        timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' });
      var tx = el('text', { x: px.toFixed(1), y: axisY, 'text-anchor': anch,
                            class: 'ch-tick' });
      tx.textContent = dateOnly
        ? d0.toLocaleDateString('en-US', { timeZone: TZ, day: 'numeric', month: 'short' })
        : hhmm(d0);
      svg.appendChild(tx);
      if (dateOnly) { prevDay = day; continue; }   // the tick IS the date
      // The date only where the day turns — compared against the previous tick
      // rather than tested for midnight, which a 3 h or 6 h step can step over.
      if (day !== prevDay) {
        var td = el('text', { x: px.toFixed(1), y: axisY + 11,
                              'text-anchor': anch, class: 'ch-tick ch-date' });
        td.textContent = day;
        svg.appendChild(td);
        prevDay = day;
      }
    }

    host.textContent = '';
    host.appendChild(svg);
    wireHover(host, svg, spec, panels, t0, X, tmin, tmax, W, nowMin);
  }

  /* The scrub. A transparent rect over the whole plot catches the pointer
   * ANYWHERE, which is the point: the old per-artist tooltips required landing
   * on a 1 px dotted line, and in the gaps between points there was nothing to
   * hover at all. Appended last so it sits above the data. */
  function wireHover(host, svg, spec, panels, t0, X, tmin, tmax, W, nowMin) {
    var guide = el('line', { class: 'ch-guide', opacity: 0, 'pointer-events': 'none' });
    svg.appendChild(guide);
    var dots = el('g', { 'pointer-events': 'none' });
    svg.appendChild(dots);

    var box = document.createElement('div');
    box.className = 'hov';
    box.hidden = true;
    host.appendChild(box);

    var top = panels[0].top, bottom = panels[panels.length - 1].bottom;
    var hit = el('rect', {
      x: M.l, y: top, width: W - M.l - M.r, height: bottom - top,
      fill: 'none', 'pointer-events': 'all'
    });
    svg.appendChild(hit);

    function hide() {
      guide.setAttribute('opacity', 0);
      dots.textContent = '';
      box.hidden = true;
    }

    // Nearest sample to a time, or null when the series does not reach here —
    // reported as absent rather than as the value of whatever point is closest,
    // which at the end of an 18 h run would otherwise read as a forecast.
    function near(s, mins) {
      var best = -1, gap = Infinity;
      for (var i = 0; i < s.t.length; i++) {
        var g = Math.abs(s.t[i] - mins);
        if (g < gap) { gap = g; best = i; }
      }
      return (best >= 0 && gap <= NEAR_MIN && num(s.v[best]))
        ? { i: best, v: s.v[best] } : null;
    }

    function show(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var scale = W / r.width;                       // viewBox units per CSS px
      var frac = ((ev.clientX - r.left) * scale - M.l) / (W - M.l - M.r);
      showFrac(Math.max(0, Math.min(1, frac)), r, scale);
    }

    function showFrac(frac, r, scale) {
      r = r || svg.getBoundingClientRect();
      if (!r.width) return;
      scale = scale || W / r.width;
      var mins = tmin + frac * (tmax - tmin);
      // Snap on the ABSOLUTE clock, not on multiples of 60 from t0. t0 is
      // "now minus 24 h" and so is never on the hour, which had the readout
      // announcing 4:17pm, 9:17pm, 6:17am — technically the right instants and
      // useless to read. Rounding the epoch is also zone-independent.
      var snapped = Math.round(at(t0, mins).getTime() / 3600000) * 3600000;
      mins = (snapped - t0.getTime()) / 60000;
      mins = Math.max(tmin, Math.min(tmax, mins));

      var gx = X(mins);
      guide.setAttribute('x1', gx.toFixed(1));
      guide.setAttribute('x2', gx.toFixed(1));
      guide.setAttribute('y1', top);
      guide.setAttribute('y2', bottom);
      guide.setAttribute('opacity', 1);

      dots.textContent = '';
      // Grouped BY ROW. Flat, the same series name appeared once per row with a
      // different meaning each time — "RRFS hourly" three times over, reading
      // as kt, then a compass point, then hPa.
      var html = '<b>' + stamp(at(t0, mins)) + '</b>';
      panels.forEach(function (p) {
        var lines = '';
        p.row.series.forEach(function (s) {
          if (s.style === 'ghosts' && s.runs) {
            // Each run's value at this hour, oldest first: the sequence shows
            // the trend in a way a single spread number cannot.
            var seq = s.runs.map(function (gr) {
              var h = near(gr, mins);
              return h ? Math.round(h.v) : null;
            }).filter(function (x) { return x !== null; });
            if (seq.length >= 2) {
              lines += '<span><i style="background:' + s.colour + ';opacity:.45"></i>' +
                       '<b class="lbl">' + s.name + '</b><em>' + seq.join(' ') +
                       '</em></span>';
            }
            return;
          }
          var hitp = near(s, mins);
          if (!hitp) return;
          var val = fmt(p.row, hitp.v);
          if (s.g && num(s.g[hitp.i])) val += ' g' + s.g[hitp.i].toFixed(0);
          // The spread, as the ± a reader would say out loud. Taken from the
          // UPPER edge: the lower one is clipped at zero because a wind speed
          // cannot go negative, so half the band's width would understate the
          // spread in exactly the light air where it is largest relative to
          // the wind.
          if (s.band && num(s.band.hi[hitp.i])) {
            val += ' \u00b1' + (s.band.hi[hitp.i] - hitp.v).toFixed(1);
          }
          lines += '<span><i style="background:' + s.colour + '"></i>' +
                   '<b class="lbl">' + s.name + '</b><em>' + val + '</em></span>';
          dots.appendChild(el('circle', {
            cx: gx.toFixed(1), cy: p.Y(hitp.v).toFixed(1), r: 3,
            fill: s.colour, stroke: 'var(--bg)', 'stroke-width': 1.4
          }));
        });
        if (lines) html += '<u>' + p.row.label + '</u>' + lines;
      });
      box.innerHTML = html;
      box.hidden = false;

      /* Positioned from bounding rects, NOT svg.offsetLeft: offsetLeft is an
       * HTMLElement property that SVG elements do not implement, so that
       * arithmetic yields NaN and the box silently stays where static layout
       * left it. Offset beside the crosshair and flipped past halfway —
       * centred, it covers the very hour being read. Clamped to the host so a
       * reading at either end stays whole. */
      var hostRect = host.getBoundingClientRect();
      var px = (r.left - hostRect.left) + gx / scale;
      var avail = host.clientWidth, w = box.offsetWidth;
      var left = px > avail / 2 ? px - 14 - w : px + 14;
      box.style.left = Math.max(0, Math.min(avail - w, left)) + 'px';
    }

    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);   // touch: tap to read
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointercancel', hide);

    /* On a touch screen a drag along the plot PANNED THE PAGE instead of
       scrubbing, and a press-and-hold raised the system "Copy image" callout
       over the chart. Both are the browser claiming a gesture this chart needs.
       pan-y rather than none, so the page still scrolls VERTICALLY over a
       chart — which is most of what anyone does with one. */
    hit.style.touchAction = 'pan-y';
    hit.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    /* A slider under the chart, for readers with no pointer to hover.
     *
     * Dragging on the plot works once the gestures above are freed, but it is
     * undiscoverable and it hides the reading under the finger. The slider is a
     * real control in the page's own flow: it says the chart can be scrubbed,
     * it does not obscure the panel, and it is reachable by keyboard, which the
     * crosshair never was. Shown only where hovering does not exist — see the
     * pointer:coarse rule in the stylesheet. */
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'chart-scrub';
    slider.min = '0';
    slider.max = '1000';
    slider.step = '1';
    slider.setAttribute('aria-label', 'Scrub the chart by hour');
    slider.addEventListener('input', function () {
      showFrac(+slider.value / 1000);
    });
    host.appendChild(slider);

    /* On a touch screen the readout opens straight away, parked on the hour the
       reader is actually in — the same "you are here" the shaded band marks.
       A slider sitting at zero beside a chart says nothing about what it does;
       parked on the current hour it does. And the readout is in normal flow
       there rather than floating, so revealing it on first touch would shove
       the chart up the page under the finger that asked for it. */
    if (window.matchMedia &&
        matchMedia('(hover:none) and (pointer:coarse)').matches) {
      var start = (nowMin !== null ? nowMin : tmax);
      var f = (start - tmin) / (tmax - tmin);
      slider.value = String(Math.round(Math.max(0, Math.min(1, f)) * 1000));
      /* Deferred until the chart has WIDTH. Most meteograms are inside panels
         that open on demand, so at draw time their svg measures 0 and showFrac
         cannot place anything — the slider was parked on the right hour and the
         readout beside it stayed blank until the reader moved it. ResizeObserver
         rather than the panel's own control, so this holds for any future way a
         chart might start hidden. */
      if (svg.getBoundingClientRect().width) {
        showFrac(+slider.value / 1000);
      } else if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () {
          if (!svg.getBoundingClientRect().width) return;
          ro.disconnect();                    // first paint only, never again
          showFrac(+slider.value / 1000);
        });
        ro.observe(host);
      }
    }
  }

  var hosts = [].slice.call(document.querySelectorAll('.chart-host[data-key]'));
  hosts.forEach(draw);

  /* Redraw on a theme change. Gridlines and labels are CSS-classed so they
   * follow the theme on their own, but the axis geometry is measured once and
   * the readout dots carry a literal stroke, so a redraw keeps everything in
   * step rather than half-themed. */
  var mo = new MutationObserver(function () { hosts.forEach(draw); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  /* Redraw when the column crosses the narrow/wide breakpoint — rotating a
     phone changes which viewBox is right. Debounced, and only when the chosen
     width actually changes, so a resize drag does not redraw on every frame. */
  /* Opening a disclosure is the first moment a host has a real width, so the
     charts inside it are redrawn then — measured while display:none they took
     the fallback. */
  document.querySelectorAll('.mt-cb').forEach(function (cb) {
    cb.addEventListener('change', function () {
      if (!cb.checked) return;
      var body = cb.parentElement;
      [].slice.call(body.querySelectorAll('.chart-host[data-key]')).forEach(draw);
    });
  });

  var lastW = hosts.map(viewW), t;
  window.addEventListener('resize', function () {
    clearTimeout(t);
    t = setTimeout(function () {
      var now = hosts.map(viewW);
      if (now.some(function (w, i) { return w !== lastW[i]; })) {
        lastW = now;
        hosts.forEach(draw);
      }
    }, 180);
  });
})();
