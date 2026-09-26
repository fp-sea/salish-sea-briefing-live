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
      '. Each source is shown as it is — nothing is averaged between them.';

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

  defaults();
  [daySel, fromSel, toSel].forEach(function (s) { s.addEventListener('change', render); });
  host.querySelector('[data-plan-reset]').addEventListener('click', function () {
    defaults(); render();
  });
  render();
  window.__planner = {render: render, defaults: defaults, inWindow: inWindow};
})();
