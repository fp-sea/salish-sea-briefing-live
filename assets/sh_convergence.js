/* The Puget Sound Convergence Zone profile, on the Shilshole page.
 *
 * The Lake Union briefing's chart (drawCzProfile in its charts.js), ported to
 * stand on its own here: latitude up, forecast hour across, each cell the
 * across-Sound mean convergence in one 0.1-degree strip. A zone is a BAND, so
 * the chart has to have a spatial axis or it cannot show one. Blue is
 * convergence, the warm colour sinking air, and the thing to look for is a
 * run of blue with warm above and below it.
 *
 * Self-contained on purpose. charts.js draws time-series rows and knows
 * nothing of a field; bolting a heat map into it would make every meteogram
 * on the site carry this chart's assumptions. What IS shared is the reading
 * pattern — a crosshair on a pointer, a slider where there is none, the same
 * .hov readout and .chart-scrub control — so a reader who learned it on the
 * point meteogram finds it working the same way here.
 *
 * Data: <script type="application/json" data-sh-convergence-data>, written by
 * src/process/sh_convergence.py. Values are already in units of 1e-5 per
 * second. Hosts: any [data-sh-convergence] element.
 *
 * Colours are CSS custom properties with a fallback, written into style
 * attributes rather than read once with getComputedStyle, so a theme switch
 * repaints the chart without redrawing it.
 */
(function () {
  'use strict';

  var node = document.querySelector('script[type="application/json"][data-sh-convergence-data]');
  var hosts = [].slice.call(document.querySelectorAll('[data-sh-convergence]'));
  if (!node || !hosts.length) return;
  var CZ;
  try { CZ = JSON.parse(node.textContent); } catch (e) { return; }
  if (!CZ) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var CONV = 'var(--cz-conv, #1d4ed8)';
  var DIV = 'var(--cz-div, #b45309)';
  var COARSE = !!(window.matchMedia && matchMedia('(hover:none) and (pointer:coarse)').matches);
  var PTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
             'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

  function el(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    return e;
  }
  function num(x) { return typeof x === 'number' && isFinite(x); }
  function compass(deg) { return PTS[Math.round((deg % 360) / 22.5) % 16]; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* viewBox width, as charts.js chooses it: a NARROWER viewBox is a TALLER
     chart once scaled to a phone's column. Falls back to the window, not to
     760, because a host measured while hidden reads 0. */
  function viewW(host) {
    var w = host.clientWidth || window.innerWidth || 760;
    return w < 520 ? 380 : 760;
  }

  /* Bare numbers on the scale the hint states once, under the chart. Lake
     Union repeated "x10^-5 s^-1" on every row and the longest of them ran past
     the width of a phone; the unit is the same on all of them. A MAGNITUDE and
     a word, not a signed number: the sign says "sinking" a second time in a
     notation the reader has to decode. */
  function say(v) {
    return Math.abs(v).toFixed(1) + ' ' + (v >= 0 ? 'rising' : 'sinking');
  }

  /* A latitude named by the nearest place the axis is already labelled with —
     the same list, so the readout and the marks on the field cannot drift. */
  function place(la) {
    var best = null;
    (CZ.landmarks || []).forEach(function (m) {
      var d = la - m[0];
      if (!best || Math.abs(d) < Math.abs(best[0])) best = [d, m[1]];
    });
    if (!best) return la.toFixed(1) + '°N';
    // The bare nearest name only when the strip actually holds the place. The
    // strip 7 nm south of the marina came out as plain "Shilshole", printed
    // right under a different reading "over Shilshole" — two numbers for one
    // place, as far as a reader could tell.
    if (Math.abs(best[0]) <= 0.06) return best[1];
    return (best[0] > 0 ? 'N of ' : 'S of ') + best[1];
  }

  /* The strip this water sits in, found from the home latitude in the data
     rather than a row number, so moving the mark moves the row reported. */
  function homeRow(lats) {
    var home = CZ.home && CZ.home.lat, best = -1, bd = 1e9;
    if (!num(home)) return -1;
    lats.forEach(function (la, r) {
      var d = Math.abs(la - home);
      if (d < bd) { bd = d; best = r; }
    });
    return bd <= 0.1 ? best : -1;
  }

  /* The strongest cell of one sign in an hour, with where it is. "none
     anywhere" when the whole column is the other way — itself the answer, not
     a gap. */
  function extreme(h, lats, sign) {
    var best = null;
    (h.profile || []).forEach(function (v, r) {
      if (!num(v) || v * sign <= 0) return;
      if (!best || Math.abs(v) > Math.abs(best[0])) best = [v, lats[r]];
    });
    if (!best) return 'none anywhere';
    // No "rising"/"sinking" here: the row's own label already says which, and
    // the word pushed the value wide enough to ellipsize that label away.
    return Math.abs(best[0]).toFixed(1) + ' · ' + place(best[1]);
  }

  /* The offshore box, as the regime count uses it. "No coherent flow" is a
     reading, not a failure, and says so. */
  function flow(h) {
    if (!num(h.flow_dir) || !num(h.flow_kt)) return null;
    if (h.regime === null || h.regime === undefined) return 'no coherent flow';
    return compass(h.flow_dir) + ' ' + Math.round(h.flow_kt) + ' kt' +
           (h.regime ? ' · W–NW' : '');
  }

  function stampOf(h) {
    return h.day + ', ' + h.hhmm + (CZ.tz ? ' ' + CZ.tz : '');
  }

  /* Which column the reader's own clock is in, or -1. Read at call time: a tab
     left open at the dock is the normal case, and a mark placed at load would
     be wrong an hour later while looking authoritative. */
  function nowIndex(hours) {
    var t = Date.now();
    for (var i = 0; i < hours.length; i++) {
      var a = Date.parse(hours[i].iso);
      if (!isNaN(a) && t >= a && t < a + 3600000) return i;
    }
    return -1;
  }

  function empty(host, msg) {
    host.textContent = '';
    var p = document.createElement('p');
    p.className = 'muted';
    p.textContent = msg;
    host.appendChild(p);
  }

  function draw(host) {
    var d = CZ.hours, lats = CZ.lats || [];
    host.textContent = '';
    if (!CZ.available || !d || !d.length) return empty(host, 'No HRRR run to show.');
    if (!lats.length) return empty(host, 'No profile in this run.');

    var W = viewW(host);
    var n = d.length, rows = lats.length;
    /* The gutter holds the axis, read outward: place, then latitude, then the
       field. Lake Union's was 138 wide for "Seattle / Lake Union"; the names
       here are one word each, and every unit of gutter is taken from the
       columns on a phone. */
    var GUT = 88, RH = 15, TOP = 30, BOT = 26, RIGHT = 8;
    var H = TOP + rows * RH + BOT;
    var plotW = W - GUT - RIGHT, cw = plotW / n;
    var bottom = TOP + rows * RH;
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img',
                          'aria-label': 'Convergence over Puget Sound by latitude and hour, ' +
                            d[0].day + ' ' + d[0].hhmm + ' to ' + d[n - 1].day + ' ' +
                            d[n - 1].hhmm });
    function xOf(i) { return GUT + i * cw; }

    // Symmetric about zero, so rising and sinking air of equal size read as
    // equally strong. Scaled to the run's own extreme, and the hint says so.
    var top = 0;
    d.forEach(function (h) { (h.profile || []).forEach(function (v) {
      if (num(v)) top = Math.max(top, Math.abs(v)); }); });
    if (!(top > 0)) top = 1;

    var lo = lats[0] - (CZ.band_deg || 0.1) / 2;
    var hi = lats[rows - 1] + (CZ.band_deg || 0.1) / 2;
    function yOf(la) { return TOP + (1 - (la - lo) / (hi - lo)) * (rows * RH); }

    // ---- the field ---------------------------------------------------------
    lats.forEach(function (la, r) {
      var y = TOP + (rows - 1 - r) * RH;                // north at the top
      d.forEach(function (h, i) {
        var v = (h.profile || [])[r];
        svg.appendChild(el('rect', {
          x: (xOf(i) + 0.5).toFixed(2), y: y, width: Math.max(1, cw - 1).toFixed(2),
          height: RH - 0.5, rx: 0.5,
          style: 'fill:' + (num(v) ? (v >= 0 ? CONV : DIV) : 'var(--line-2)'),
          opacity: num(v) ? Math.max(0.08, Math.min(1, Math.abs(v) / top)).toFixed(3) : 0.5
        }));
      });
    });

    // The degrees, at every other strip EDGE. A place name alone leaves the
    // axis unmeasurable. Lake Union printed each strip's centre to one decimal,
    // which labels the 47.25 strip "47.3"; the edges are exact.
    var band = CZ.band_deg || 0.1;
    for (var k = 0; k <= rows; k += 2) {
      var edge = lo + k * band;
      var deg = el('text', { x: GUT - 5, y: (yOf(edge) + 3).toFixed(1), 'text-anchor': 'end',
                             'font-size': 8.5, style: 'fill:var(--ink-3)' });
      deg.textContent = edge.toFixed(1) + '°';
      svg.appendChild(deg);
    }

    // ---- days, midnights and clock hours -----------------------------------
    // Every step that leaves a label room for "18:00" at this width; ticks on
    // the clock (00, 06, 12 ...), not on every third column from wherever the
    // run happened to start.
    var step = [1, 2, 3, 6, 12].filter(function (s) { return s * cw >= 30; })[0] || 12;
    var dayStarts = [];
    d.forEach(function (h, i) {
      if (i === 0 || h.day !== d[i - 1].day) dayStarts.push(i);
    });
    dayStarts.forEach(function (i, k) {
      if (d[i].hhmm.slice(0, 2) === '00' && i > 0) {
        svg.appendChild(el('line', { x1: xOf(i), x2: xOf(i), y1: TOP - 6, y2: bottom + 4,
                                     'stroke-dasharray': '2 3', 'stroke-width': 1,
                                     style: 'stroke:var(--ink-3)' }));
      }
      // A day label needs room before the next one starts. A run opening at
      // 22:00 gives the first day two columns, and its name printed over the
      // next day's is two unreadable words instead of one readable one.
      var next = k + 1 < dayStarts.length ? dayStarts[k + 1] : n;
      if ((next - i) * cw < 52) return;
      var t = el('text', { x: xOf(i) + 2, y: TOP - 8, 'text-anchor': 'start',
                           'font-size': 9.5, 'font-weight': 600, style: 'fill:var(--ink-2)' });
      t.textContent = d[i].day;
      svg.appendChild(t);
    });
    d.forEach(function (h, i) {
      var hh = +h.hhmm.slice(0, 2);
      if (hh % step !== 0) return;
      var c = el('text', { x: (xOf(i) + cw / 2).toFixed(1), y: bottom + 15,
                           'text-anchor': 'middle', 'font-size': 9,
                           style: 'fill:var(--ink-3)' });
      c.textContent = h.hhmm;
      svg.appendChild(c);
    });

    // ---- the step back to an older run --------------------------------------
    // Solid, where midnights are dashed: the hours right of it are an older
    // forecast than the hours left of it, and a smooth-looking field across
    // that line would be claiming a continuity the data does not have.
    if (num(CZ.seam) && CZ.seam > 0 && CZ.seam < n) {
      svg.appendChild(el('line', { x1: xOf(CZ.seam), x2: xOf(CZ.seam), y1: TOP - 3,
                                   y2: bottom + 3, 'stroke-width': 1.6,
                                   style: 'stroke:var(--ink)' }));
    }

    // ---- places -------------------------------------------------------------
    // In the gutter, beside the degree they belong to: inside the plot they
    // needed backing panels to stay legible over the colour, and at the right
    // edge they fell off a phone. Shilshole's rule is heavier — it is the one
    // line on the chart this page is about.
    var homeName = CZ.home && CZ.home.name;
    (CZ.landmarks || []).forEach(function (m) {
      var la = m[0], name = m[1];
      if (la < lo || la > hi) return;
      var y = yOf(la), home = name === homeName;
      svg.appendChild(el('line', { x1: GUT, x2: W - RIGHT, y1: y, y2: y,
                                   'stroke-width': home ? 1.3 : 1,
                                   'stroke-dasharray': home ? '5 3' : '2 4',
                                   opacity: home ? 0.95 : 0.8,
                                   style: 'stroke:' + (home ? 'var(--ink)' : 'var(--ink-3)') }));
      // A leader from the name to its rule, so a label between two row
      // centres still reads as belonging to one line.
      svg.appendChild(el('line', { x1: GUT - 34, x2: GUT, y1: y, y2: y, 'stroke-width': 1,
                                   opacity: 0.35, style: 'stroke:var(--ink-3)' }));
      var t = el('text', { x: 0, y: y + 3.5, 'text-anchor': 'start', 'font-size': 8.5,
                           'font-weight': home ? 700 : 600,
                           style: 'fill:' + (home ? 'var(--ink)' : 'var(--ink-2)') });
      t.textContent = name;
      svg.appendChild(t);
    });

    // ---- now ----------------------------------------------------------------
    // An outline, not a wash behind the cells: the field covers the whole plot,
    // so a band drawn underneath it only showed in the gaps.
    var nowBox = el('rect', { y: TOP - 2, height: rows * RH + 4, fill: 'none',
                              'stroke-width': 1.4, rx: 1, visibility: 'hidden',
                              'pointer-events': 'none', style: 'stroke:var(--accent)' });
    svg.appendChild(nowBox);
    function placeNow() {
      var i = nowIndex(d);
      if (i < 0) { nowBox.setAttribute('visibility', 'hidden'); return; }
      nowBox.setAttribute('x', xOf(i).toFixed(2));
      nowBox.setAttribute('width', cw.toFixed(2));
      nowBox.setAttribute('visibility', 'visible');
    }
    placeNow();
    host._czNow = placeNow;

    host.appendChild(svg);
    wire(host, svg, { W: W, GUT: GUT, RIGHT: RIGHT, TOP: TOP, bottom: bottom, RH: RH,
                      n: n, rows: rows, cw: cw, xOf: xOf, lats: lats, d: d });
    key(host, top);
  }

  /* The crosshair and the slider.
   *
   * The question asked of this chart is not "what is cell 7,3" — it is "where
   * is the band, and is it over me". So the hour is scrubbed, and the readout
   * answers that: this water first, then where the strongest rising and
   * sinking air in the Sound is at that hour, and the offshore flow the regime
   * count is made of. With a pointer it also reads the cell under it, which
   * Lake Union's per-cell <title>s promised and its hit area, lying on top of
   * them, never let through.
   */
  function wire(host, svg, g) {
    var d = g.d, lats = g.lats;
    var guide = el('line', { 'class': 'ch-guide', y1: g.TOP, y2: g.bottom, opacity: 0,
                             'pointer-events': 'none' });
    svg.appendChild(guide);
    var cell = el('rect', { fill: 'none', 'stroke-width': 1.2, visibility: 'hidden',
                            'pointer-events': 'none', style: 'stroke:var(--ink)' });
    svg.appendChild(cell);
    var box = document.createElement('div');
    box.className = 'hov';
    box.hidden = true;
    host.appendChild(box);

    // Last, with explicit pointer-events, so it catches the pointer anywhere in
    // the plot and not only over a cell edge.
    var hit = el('rect', { x: g.GUT, y: g.TOP, width: g.W - g.GUT - g.RIGHT,
                           height: g.bottom - g.TOP, fill: 'none', 'pointer-events': 'all' });
    svg.appendChild(hit);

    var here = homeRow(lats);
    var slider = null;

    function line(colour, name, value) {
      return '<span><i style="background:' + colour + '"></i><b class="lbl">' + esc(name) +
             '</b><em>' + esc(value) + '</em></span>';
    }

    function showIndex(i, r) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      i = Math.max(0, Math.min(g.n - 1, i));
      if (slider && +slider.value !== i) slider.value = String(i);
      var h = d[i];
      var gx = g.xOf(i) + g.cw / 2;
      guide.setAttribute('x1', gx.toFixed(1));
      guide.setAttribute('x2', gx.toFixed(1));
      guide.setAttribute('opacity', 1);

      var html = '<b>' + esc(stampOf(h)) + '</b>';
      if (here >= 0) {
        var hv = (h.profile || [])[here];
        // The swatch follows the SIGN. A fixed colour put a blue block beside
        // the word "sinking" — a colour contradicting the value beside it is
        // worse than none.
        html += line(num(hv) && hv < 0 ? DIV : CONV, 'Over ' + (CZ.home.name || 'here'),
                     num(hv) ? say(hv) : 'no value');
      }
      if (r !== undefined && r !== null && r >= 0 && r < g.rows) {
        var v = (h.profile || [])[r];
        html += line(num(v) && v < 0 ? DIV : CONV,
                     'At ' + lats[r].toFixed(2) + '° · ' + place(lats[r]),
                     num(v) ? say(v) : 'no value');
        var y = g.TOP + (g.rows - 1 - r) * g.RH;
        cell.setAttribute('x', g.xOf(i).toFixed(2));
        cell.setAttribute('y', y);
        cell.setAttribute('width', g.cw.toFixed(2));
        cell.setAttribute('height', g.RH - 0.5);
        cell.setAttribute('visibility', 'visible');
      } else {
        cell.setAttribute('visibility', 'hidden');
      }
      html += line(CONV, 'Rising fastest', extreme(h, lats, 1));
      html += line(DIV, 'Sinking fastest', extreme(h, lats, -1));
      var f = flow(h);
      if (f) html += line('var(--ink-3)', 'Coastal flow', f);
      html += '<u>' + esc(h.run) + ' run</u>';
      box.innerHTML = html;
      box.hidden = false;

      /* Positioned from bounding rects, not svg.offsetLeft, which SVG elements
         do not implement. Beside the crosshair and flipped past halfway —
         centred, it covered the very hour being read. On a touch screen the
         stylesheet puts it in normal flow instead, and this is harmless. */
      var scale = g.W / rect.width;
      var hostRect = host.getBoundingClientRect();
      var px = (rect.left - hostRect.left) + gx / scale;
      var avail = host.clientWidth, w = box.offsetWidth;
      var left = px > avail / 2 ? px - 14 - w : px + 14;
      box.style.left = Math.max(0, Math.min(avail - w, left)) + 'px';
    }

    function hide() {
      guide.setAttribute('opacity', 0);
      cell.setAttribute('visibility', 'hidden');
      box.hidden = true;
    }

    function show(ev) {
      var rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      var scale = g.W / rect.width;
      var x = (ev.clientX - rect.left) * scale, y = (ev.clientY - rect.top) * scale;
      var i = Math.floor((x - g.GUT) / g.cw);
      var r = g.rows - 1 - Math.floor((y - g.TOP) / g.RH);
      showIndex(i, r);
    }

    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);   // touch: tap to read
    hit.addEventListener('pointerleave', function () { if (!COARSE) hide(); });
    hit.addEventListener('pointercancel', function () { if (!COARSE) hide(); });
    /* A drag along the plot panned the page and a press-and-hold raised the
       system "Copy image" callout: the browser claiming gestures this chart
       needs. pan-y, not none, so the page still scrolls vertically over it. */
    hit.style.touchAction = 'pan-y';
    hit.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    /* A slider under the chart, for readers with no pointer to hover — a real
       control in the page's flow that says the chart can be scrubbed, does not
       hide the reading under a finger, and is reachable by keyboard. Shown
       only where hovering does not exist (the pointer:coarse rule on
       .chart-scrub in site.css). */
    slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'chart-scrub';
    slider.min = '0';
    slider.max = String(g.n - 1);
    slider.step = '1';
    slider.value = '0';
    slider.setAttribute('aria-label', 'Scrub the chart by hour');
    slider.addEventListener('input', function () { showIndex(+slider.value, null); });
    host.appendChild(slider);

    /* On a touch screen the readout opens straight away, parked on the hour
       the reader is in. A slider at zero beside a chart says nothing about
       what it does; parked on now, it does. Deferred until the chart has a
       width, since a host measured while hidden cannot place anything. */
    if (COARSE) {
      var start = nowIndex(d);
      var go = function () { showIndex(start >= 0 ? start : 0, null); };
      if (svg.getBoundingClientRect().width) {
        go();
      } else if (window.ResizeObserver) {
        var ro = new ResizeObserver(function () {
          if (!svg.getBoundingClientRect().width) return;
          ro.disconnect();
          go();
        });
        ro.observe(host);
      }
    }
  }

  /* The key and the hint, under the chart. */
  function key(host, top) {
    var k = document.createElement('div');
    k.className = 'sh-cz-key';
    function ramp(colour, text) {
      var sp = document.createElement('span');
      var w = document.createElement('span');
      w.className = 'sh-cz-ramp';
      [0.16, 0.37, 0.58, 0.79, 1].forEach(function (op) {
        var i = document.createElement('i');
        i.style.background = colour;
        i.style.opacity = op;
        w.appendChild(i);
      });
      sp.appendChild(w);
      sp.appendChild(document.createTextNode(text));
      k.appendChild(sp);
    }
    function rule(cls, text) {
      var sp = document.createElement('span');
      var i = document.createElement('i');
      i.className = cls;
      sp.appendChild(i);
      sp.appendChild(document.createTextNode(text));
      k.appendChild(sp);
    }
    ramp(CONV, 'convergence, air rising — weak to strong');
    ramp(DIV, 'sinking air — weak to strong');
    rule('sh-cz-k-home', (CZ.home && CZ.home.name || 'Here') + '’s latitude');
    if (num(CZ.seam)) rule('sh-cz-k-seam', 'steps back to the older, longer run');
    rule('sh-cz-k-now', 'the hour you are in');
    host.appendChild(k);

    var hint = document.createElement('p');
    hint.className = 'sh-cz-hint';
    // The scale's own extreme is a number, not "darkest is strongest", which
    // is false over a dark page where the strongest cell is the brightest.
    hint.textContent = 'Full strength is ' + top.toFixed(1) +
      '×10⁻⁵ s⁻¹, this run’s own extreme — the scale is the ' +
      'run’s, not a threshold. ' +
      (COARSE
        ? 'Drag the slider for any hour, or tap a cell — it reports ' +
          (CZ.home && CZ.home.name || 'this water') + ' first, then where the strongest ' +
          'rising and sinking air in the Sound is, on that same ×10⁻⁵ s⁻¹ scale.'
        : 'Point at any cell for its own value, with ' + (CZ.home && CZ.home.name || 'this water') +
          ' and the strongest rising and sinking air in the Sound at that hour, on that same ' +
          '×10⁻⁵ s⁻¹ scale.');
    host.appendChild(hint);
  }

  hosts.forEach(draw);

  // The "now" outline moves with the reader's clock, on the minute.
  setInterval(function () {
    hosts.forEach(function (h) { if (h._czNow) h._czNow(); });
  }, 60000);

  /* Redraw when the column crosses the narrow/wide breakpoint — rotating a
     phone changes which viewBox is right. Debounced, and only when the chosen
     width actually changes. */
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
