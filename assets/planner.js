/* The Shilshole page's sail planner — and its at-a-glance strip.
 *
 * Pick a day and a window; every source is summarised over exactly those
 * hours. The Lake Union briefing's planner, for a sailboat: no score and no
 * go/no-go, because the reader weighs a 15 kt afternoon differently in a J/24
 * than in a 40-footer. What it does insist on is saying which source says
 * what, and when a source does not reach the window at all — silence is not
 * a forecast of calm.
 *
 * Data: the JSON in [data-plan], written by src/process/shilshole.py:
 *   hours[]  one per hour at the point: wind/gust per source, REFS spread,
 *            dir, vis, fog/lightning chances, NWS thunder and waves, the
 *            lightning ring's state, tide and current at the hour, and the
 *            convergence line if HRRR has one
 *   sun[]    dawn/sunrise/sunset/dusk per local day
 *   tide_events, current_events
 *
 * Opens on today's daylight — or tomorrow's once today's is over — computed
 * against the READER's clock, not the build's.
 */
(function () {
  'use strict';
  var host = document.querySelector('[data-planner]');
  var src = document.querySelector('script[data-plan]');
  if (!host || !src) return;
  var D;
  try { D = JSON.parse(src.textContent); } catch (e) { return; }
  if (!D || !D.hours || !D.hours.length) return;

  var TZ = 'America/Los_Angeles';
  var POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  var NAMES = {hrrr: 'HRRR', rrfs: 'RRFS', refs: 'REFS', nws: 'NWS',
               gridpoint: 'NWS forecast', zone: 'NWS zone forecast'};
  var LTG = ['none', 'trace', 'possible', 'likely', 'strong'];

  function clock(t) {
    return new Date(t).toLocaleTimeString('en-US', {hour: '2-digit', minute: '2-digit',
                                                    hour12: false, timeZone: TZ});
  }
  function localDate(t) {   // "2026-09-25" in Pacific
    return new Date(t).toLocaleDateString('en-CA', {timeZone: TZ});
  }
  function localHour(t) {
    return +new Date(t).toLocaleString('en-US', {hour: '2-digit', hour12: false,
                                                 timeZone: TZ}) % 24;
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function compass(d) { return POINTS[Math.round((d % 360) / 22.5) % 16]; }

  // ---- controls -----------------------------------------------------------
  var days = D.sun.map(function (s) { return s.date; });
  var daySel = host.querySelector('[data-plan-day]');
  var fromSel = host.querySelector('[data-plan-from]');
  var toSel = host.querySelector('[data-plan-to]');
  D.sun.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s.date; o.textContent = s.day; daySel.appendChild(o);
  });
  for (var h = 0; h < 24; h++) {
    [fromSel, toSel].forEach(function (sel) {
      var o = document.createElement('option');
      o.value = h; o.textContent = ('0' + h).slice(-2) + ':00'; sel.appendChild(o);
    });
  }
  var o24 = document.createElement('option');
  o24.value = 24; o24.textContent = '24:00'; toSel.appendChild(o24);

  function defaults() {
    // Today's daylight from now, or tomorrow's once today's has gone.
    var now = Date.now();
    var s = D.sun[0];
    var pick = D.sun.find(function (x) { return Date.parse(x.sunset) > now + 3600000; }) || s;
    // To the NEAREST hour: 07:01 is a 07:00 start and 18:59 a 19:00 finish —
    // rounding down made the default window flag itself as before sunrise.
    function nearest(t) { return localHour(Date.parse(t) + 30 * 60000); }
    var rise = nearest(pick.sunrise), set = nearest(pick.sunset);
    var from = pick === D.sun[0] ? Math.max(rise, localHour(now)) : rise;
    daySel.value = pick.date;
    fromSel.value = Math.min(from, set - 1);
    toSel.value = set;
  }

  // ---- the window ---------------------------------------------------------
  function inWindow() {
    var day = daySel.value, a = +fromSel.value, b = +toSel.value;
    if (b <= a) b = a + 1;
    return D.hours.filter(function (r) {
      return localDate(r.t) === day && localHour(r.t) >= a && localHour(r.t) < b;
    });
  }
  function windowBounds() {
    var day = daySel.value, a = +fromSel.value, b = +toSel.value;
    var inw = D.hours.filter(function (r) { return localDate(r.t) === day; });
    return {day: day, from: a, to: Math.max(b, a + 1), any: inw.length > 0};
  }

  function tile(box, lab, val, unit, sub, note, key) {
    var d = document.createElement('div');
    d.className = 'gt' + (key ? ' gt-' + key : '');
    function add(cls, text) {
      if (!text) return;
      var e = document.createElement('div'); e.className = cls; e.textContent = text;
      d.appendChild(e);
    }
    add('gt-lab', lab);
    var v = document.createElement('div'); v.className = 'gt-val';
    v.appendChild(document.createTextNode(val));
    if (unit) { var u = document.createElement('span'); u.className = 'gt-unit';
      u.textContent = unit; v.appendChild(u); }
    d.appendChild(v);
    add('gt-sub', sub); add('gt-note', note);
    box.appendChild(d);
  }

  function level(kt) { return kt >= 48 ? 'storm' : kt >= 34 ? 'gale' : kt >= 21 ? 'sca' : null; }

  /* ---- do the sources agree? --------------------------------------------
   * Over a set of hours: each source's PEAK sustained wind (its median over
   * the water), and how far apart those peaks are. Within 4 kt they agree,
   * within 8 roughly; past that they differ — and it is said which runs
   * higher, and which of the 10, 15 and 20 kt lines a sailor reefs by lies
   * between them, because "differ by 6 kt" matters at 12-18 and not at 3-9.
   * Also: how far HRRR's last runs differ over the same hours, and whether the
   * models run above the zone forecast's top. No verdict on the day — the
   * reader's boat decides that. */
  var MARKS = [10, 15, 20];
  function agreement(rows) {
    var peaks = {};
    ['nws', 'hrrr', 'rrfs', 'refs'].forEach(function (k) {
      var v = rows.map(function (r) { return r.wind[k]; }).filter(num);
      if (v.length) peaks[k] = Math.max.apply(null, v);
    });
    var ks = Object.keys(peaks);
    if (ks.length < 2) return null;
    ks.sort(function (a, b) { return peaks[b] - peaks[a]; });
    var hiK = ks[0], loK = ks[ks.length - 1];
    var spread = peaks[hiK] - peaks[loK];
    var state = spread <= 4 ? 'agree' : spread <= 8 ? 'roughly' : 'differ';
    var across = MARKS.filter(function (m) { return peaks[hiK] >= m && peaks[loK] < m; });
    var text;
    if (state === 'agree') {
      text = 'Models and NWS agree: peaks ' + Math.round(peaks[loK]) + '–' +
             Math.round(peaks[hiK]) + ' kt.';
    } else {
      text = NAMES[hiK] + ' peaks at ' + Math.round(peaks[hiK]) + ' kt, ' + NAMES[loK] + ' at ' +
             Math.round(peaks[loK]) + (across.length ? ' — either side of ' +
             across[across.length - 1] + ' kt' : '') + '.';
    }
    // HRRR's run-to-run spread, the worst hour.
    var rs = rows.map(function (r) { return r.runs; }).filter(Boolean);
    var runs = null;
    if (rs.length) {
      var w = rs.reduce(function (a, r) { return (r.hi - r.lo) > (a.hi - a.lo) ? r : a; });
      runs = {n: w.n, by: Math.round(w.hi - w.lo)};
    }
    // The zone forecast's top over the same hours, and who runs above it.
    var zh = rows.map(function (r) { return r.zone && r.zone.hi; }).filter(num);
    var zone = null;
    if (zh.length) {
      var ztop = Math.max.apply(null, zh);
      var above = ks.filter(function (k) { return k !== 'nws' && peaks[k] >= ztop + 5; });
      zone = {top: ztop, above: above};
    }
    return {state: state, text: text, spread: spread, peaks: peaks, runs: runs, zone: zone};
  }
  function agreeNote(a) {
    var bits = [];
    if (a.runs) bits.push('HRRR\u2019s last ' + a.runs.n + ' runs differ by up to ' + a.runs.by + ' kt');
    if (a.zone) bits.push('zone forecast to ' + a.zone.top + ' kt' + (a.zone.above.length ?
      ', ' + a.zone.above.map(function (k) { return NAMES[k]; }).join(' and ') + ' above it' : ''));
    var t = bits.join(' · ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function render() {
    var box = host.querySelector('.plan-tiles');
    box.textContent = '';
    var rows = inWindow(), W = windowBounds();
    var sun = D.sun.find(function (s) { return s.date === W.day; });
    var said = host.querySelector('.plan-said');
    if (!rows.length) {
      said.textContent = 'No forecast reaches that window — the models and the NWS stop ' +
                         'about 60 hours out.';
      return;
    }
    said.textContent = rows.length + ' hour' + (rows.length > 1 ? 's' : '') + ', ' +
      clock(rows[0].t) + '–' + clock(Date.parse(rows[rows.length - 1].t) + 3600000) +
      '. Each source is its own median over the water, Kingston to West Point — ' +
      'nothing is averaged between sources.';

    // Wind: each source's range over the window, and the overall spread.
    var per = {}, all = [];
    ['nws', 'hrrr', 'rrfs', 'refs'].forEach(function (k) {
      var v = rows.map(function (r) { return r.wind[k]; }).filter(num);
      if (v.length) {
        per[k] = [Math.min.apply(null, v), Math.max.apply(null, v)];
        all = all.concat(v);
      }
    });
    if (all.length) {
      var lo = Math.round(Math.min.apply(null, all)), hi = Math.round(Math.max.apply(null, all));
      var dirs = rows.map(function (r) { return r.dir.nws; }).filter(num);
      var dsub = dirs.length ? 'NWS: from ' + compass(dirs[Math.floor(dirs.length / 2)]) : '';
      tile(box, 'Wind', lo === hi ? String(lo) : lo + '–' + hi, 'kt', dsub,
           Object.keys(per).map(function (k) {
             return NAMES[k] + ' ' + Math.round(per[k][0]) + '–' + Math.round(per[k][1]);
           }).join(' · '), level(hi));
    } else {
      tile(box, 'Wind', 'no forecast', '', 'no model or NWS reaches these hours', '', null);
    }

    // Do they agree? Each source's peak, and how far apart.
    var ag = agreement(rows);
    if (ag) tile(box, 'Agreement', ag.state === 'agree' ? 'agree' :
                 ag.state === 'roughly' ? 'roughly' : 'differ', '', ag.text, agreeNote(ag),
                 ag.state === 'differ' ? 'sca' : null);

    // Gust: the highest, and whose.
    var gbest = null;
    rows.forEach(function (r) {
      ['nws', 'hrrr', 'rrfs'].forEach(function (k) {
        if (num(r.gust[k]) && (!gbest || r.gust[k] > gbest.v)) gbest = {v: r.gust[k], k: k, t: r.t};
      });
    });
    if (gbest) tile(box, 'Gusts', String(Math.round(gbest.v)), 'kt',
                    'highest, ' + NAMES[gbest.k] + ' at ' + clock(gbest.t), '', level(gbest.v));

    // Fog: REFS's chance under 1 mi, and the lowest visibility either forecast gives.
    var pf = rows.map(function (r) { return r.pfog1; }).filter(num);
    var pf5 = rows.map(function (r) { return r.pfog05; }).filter(num);
    var vmin = rows.map(function (r) {
      return Math.min(num(r.vis.hrrr) ? r.vis.hrrr : 99, num(r.vis.nws) ? r.vis.nws : 99);
    }).filter(function (v) { return v < 99; });
    if (pf.length || vmin.length) {
      var pmax = pf.length ? Math.max.apply(null, pf) : null;
      var vm = vmin.length ? Math.min.apply(null, vmin) : null;
      tile(box, 'Fog', pmax !== null ? pmax + '%' : (vm !== null ? vm.toFixed(1) : '—'),
           pmax !== null ? '' : 'mi',
           pmax !== null ? 'REFS chance of vis under 1 mi' + (pf5.length ? ' (under ½ mi ' +
             Math.max.apply(null, pf5) + '%)' : '') : 'lowest visibility',
           vm !== null ? 'lowest forecast visibility ' + (vm >= 10 ? '10+' : vm.toFixed(1)) + ' mi' : '',
           pmax >= 40 ? 'gale' : pmax >= 15 ? 'sca' : null);
    }

    // Lightning: the ring's worst state in the window, and which source.
    var lw = -1, lsrc = null, lt = null;
    rows.forEach(function (r) {
      if (r.ltg > lw) { lw = r.ltg; lsrc = r.ltg_src; }
      if (r.ltg >= 2 && !lt) lt = r.t;
    });
    var pl = rows.map(function (r) { return r.pltng; }).filter(num);
    var pt = rows.map(function (r) { return r.pthunder; }).filter(num);
    if (lw < 0) tile(box, 'Lightning', 'not checked', '', 'no source reaches these hours', '', null);
    else tile(box, 'Lightning', LTG[lw] || 'none', '',
              lt ? 'from ' + clock(lt) + ' · first in ' + (NAMES[lsrc] || lsrc) :
                   'within 25 nm, every source',
              (pl.length ? 'REFS ' + Math.max.apply(null, pl) + '%' : '') +
              (pt.length ? (pl.length ? ' · ' : '') + 'NWS thunder ' + Math.max.apply(null, pt) + '%' : ''),
              lw >= 4 ? 'storm' : lw >= 3 ? 'gale' : lw >= 2 ? 'sca' : null);

    // Waves: the NWS gridpoint's.
    var wv = rows.map(function (r) { return r.wave; }).filter(num);
    if (wv.length) tile(box, 'Waves', String(Math.max.apply(null, wv)), 'ft', 'highest, NWS',
                        '', null);

    // Tide and current: the events inside the window, in order.
    var t0 = Date.parse(rows[0].t), t1 = Date.parse(rows[rows.length - 1].t) + 3600000;
    function events(list, fmt) {
      return (list || []).filter(function (e) {
        var t = Date.parse(e.t); return t >= t0 && t < t1;
      }).map(fmt);
    }
    var te = events(D.tide_events, function (e) { return e.type + ' ' + e.ft + ' ft ' + clock(e.t); });
    var tf = rows.map(function (r) { return r.tide; }).filter(num);
    if (tf.length) {
      var rising = tf[tf.length - 1] > tf[0];
      tile(box, 'Tide, ' + (D.tide_label || ''), rising ? 'rising' : 'falling', '',
           tf[0].toFixed(1) + ' → ' + tf[tf.length - 1].toFixed(1) + ' ft',
           te.length ? te.join(' · ') : 'no high or low in the window', null);
    }
    var ce = events(D.current_events, function (e) {
      return e.type + (e.type === 'slack' ? '' : ' ' + Math.abs(e.kt).toFixed(1) + ' kt') + ' ' + clock(e.t);
    });
    var cv = rows.map(function (r) { return r.cur; }).filter(num);
    if (cv.length) {
      var cmax = cv.reduce(function (a, b) { return Math.abs(b) > Math.abs(a) ? b : a; }, 0);
      tile(box, 'Current, ' + (D.current_label || ''), Math.abs(cmax).toFixed(1), 'kt',
           'strongest in the window, ' + (cmax >= 0 ? 'flood' : 'ebb'),
           ce.length ? ce.join(' · ') : '', null);
    }

    // Daylight, and whether the window runs outside it.
    if (sun) {
      // Fifteen minutes' grace: a window rounded to the hour is not "before
      // sunrise" for starting at 07:00 against a 07:01 sunrise.
      var grace = 15 * 60000;
      var early = t0 < Date.parse(sun.sunrise) - grace, late = t1 > Date.parse(sun.sunset) + grace;
      tile(box, 'Daylight', clock(sun.sunrise) + '–' + clock(sun.sunset), '',
           'civil twilight ' + clock(sun.dawn) + '–' + clock(sun.dusk),
           late ? 'the window runs past sunset' : early ? 'the window starts before sunrise' : '',
           late || early ? 'sca' : null);
    }

    // Convergence zone, from the ported Lake Union profile: how many of these
    // hours have the coastal flow in the west-to-northwest regime the zone
    // forms in, and where the strongest converging strip sits. No likelihood
    // score, deliberately — see the Convergence section.
    var czh = rows.filter(function (r) { return r.cz; });
    if (czh.length) {
      var reg = czh.filter(function (r) { return r.cz.regime; }).length;
      var top = czh.reduce(function (a, r) {
        return (num(r.cz.peak) && (!a || r.cz.peak > a.cz.peak)) ? r : a; }, null);
      var where = top ? (Math.abs(top.cz.nm) < 3 ? 'over Shilshole' :
        Math.abs(top.cz.nm) + ' nm ' + (top.cz.nm > 0 ? 'north' : 'south') +
        (top.cz.near ? ', near ' + top.cz.near : '')) : '';
      tile(box, 'Convergence zone', reg + ' of ' + czh.length, 'h',
           'coastal flow in the W–NW regime',
           top ? 'strongest converging strip ' + where + ' at ' + clock(top.t) : '',
           reg ? 'sca' : null);
    }
  }

  /* ---- the Now strip's wind card: the next 12 hours from the READER's
   * clock, as a sparkline — the NWS line solid, the models' median dashed
   * with their spread shaded — ruled at 10, 15 and 20 kt, the marks a
   * sailor reefs by, and the agreement said in words under it. */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function median(a) {
    var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length;
    return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : null;
  }
  function windNow() {
    var card = document.querySelector('[data-wind-now]');
    if (!card) return;
    var now = Date.now(), h0 = Math.floor(now / 3600000) * 3600000;
    var rows = D.hours.filter(function (r) {
      var t = Date.parse(r.t); return t >= h0 && t < h0 + 12 * 3600000;
    });
    if (rows.length < 3) { card.hidden = true; return; }
    var pts = rows.map(function (r) {
      var m = ['hrrr', 'rrfs', 'refs'].map(function (k) { return r.wind[k]; }).filter(num);
      var g = ['nws', 'hrrr', 'rrfs'].map(function (k) { return r.gust[k]; }).filter(num);
      return {t: Date.parse(r.t), nws: r.wind.nws, mod: median(m),
              lo: m.length > 1 ? Math.min.apply(null, m) : null,
              hi: m.length > 1 ? Math.max.apply(null, m) : null,
              gust: g.length ? Math.max.apply(null, g) : null};
    });
    var top = 0;
    pts.forEach(function (p) {
      [p.nws, p.mod, p.hi].forEach(function (v) { if (num(v)) top = Math.max(top, v); });
    });
    // The scale reaches the 20 kt mark at least, so a 6 kt day LOOKS light.
    var ymax = Math.max(22, Math.ceil((top + 2) / 5) * 5);
    var W = 200, H = 64, L = 2, R = 30, T = 4, B = 12;
    var t0 = h0, t1 = h0 + 12 * 3600000;
    function X(t) { return L + (t - t0) / (t1 - t0) * (W - L - R); }
    function Y(v) { return T + (1 - v / ymax) * (H - T - B); }
    var svg = svgEl('svg', {viewBox: '0 0 ' + W + ' ' + H, class: 'sh-spark', role: 'img',
                            'aria-label': 'Wind for the next 12 hours'});
    MARKS.forEach(function (m) {
      svg.appendChild(svgEl('line', {x1: L, x2: W - R, y1: Y(m).toFixed(1), y2: Y(m).toFixed(1),
                                     class: 'sh-spark-mark sh-spark-m' + m}));
      var tx = svgEl('text', {x: W - R + 3, y: (Y(m) + 3).toFixed(1), class: 'sh-spark-lab'});
      tx.textContent = m + (m === 20 ? ' kt' : '');
      svg.appendChild(tx);
    });
    // The models' spread, then their median, then the NWS line on top.
    var up = [], dn = [];
    pts.forEach(function (p) {
      if (num(p.lo) && num(p.hi)) {
        up.push(X(p.t).toFixed(1) + ' ' + Y(p.hi).toFixed(1));
        dn.unshift(X(p.t).toFixed(1) + ' ' + Y(p.lo).toFixed(1));
      }
    });
    if (up.length > 1) svg.appendChild(svgEl('path', {d: 'M' + up.join('L') + 'L' + dn.join('L') + 'Z',
                                                       class: 'sh-spark-band'}));
    function line(key, cls) {
      var d = '', pen = false;
      pts.forEach(function (p) {
        if (!num(p[key])) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(p.t).toFixed(1) + ' ' + Y(p[key]).toFixed(1); pen = true;
      });
      if (d) svg.appendChild(svgEl('path', {d: d, class: cls}));
    }
    line('mod', 'sh-spark-mod');
    line('nws', 'sh-spark-nws');
    var tl = svgEl('text', {x: L, y: H - 1, class: 'sh-spark-lab'});
    tl.textContent = clock(t0);
    svg.appendChild(tl);
    var tr = svgEl('text', {x: W - R, y: H - 1, class: 'sh-spark-lab', 'text-anchor': 'end'});
    tr.textContent = clock(t1);
    svg.appendChild(tr);

    function span(key) {
      var v = pts.map(function (p) { return p[key]; }).filter(num);
      if (!v.length) return null;
      var a = Math.round(Math.min.apply(null, v)), b = Math.round(Math.max.apply(null, v));
      return a === b ? String(a) : a + '–' + b;
    }
    var ns = span('nws'), ms = span('mod');
    var gs = pts.map(function (p) { return p.gust; }).filter(num);
    var ag = agreement(rows);
    card.querySelector('.sh-spark-host').textContent = '';
    card.querySelector('.sh-spark-host').appendChild(svg);
    card.querySelector('[data-wn-val]').textContent = ns || ms || '—';
    card.querySelector('[data-wn-sub]').textContent =
      (ns ? 'NWS ' + ns : '') + (ms ? (ns ? ' · ' : '') + 'models ' + ms : '') +
      (gs.length ? ' · gusts to ' + Math.round(Math.max.apply(null, gs)) : '') + ' kt';
    var an = card.querySelector('[data-wn-agree]');
    an.textContent = ag ? ag.text + (agreeNote(ag) ? ' ' + agreeNote(ag) + '.' : '') : '';
    card.dataset.state = ag ? ag.state : '';
    card.hidden = false;
  }

  defaults();
  windNow();
  // The window moves with the clock; the page is read for hours after a build.
  setInterval(windNow, 10 * 60000);
  [daySel, fromSel, toSel].forEach(function (s) { s.addEventListener('change', render); });
  host.querySelector('[data-plan-reset]').addEventListener('click', function () {
    defaults(); render();
  });
  render();
  window.__planner = {render: render, defaults: defaults, inWindow: inWindow,
                      agreement: agreement, windNow: windNow};
})();
