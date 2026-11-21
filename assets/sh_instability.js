/* Instability round Shilshole: HRRR CAPE and CIN, hour by hour, as two rows.
 *
 * The Lake Union briefing's drawing (drawInstability in its charts.js), ported
 * as a file of its own so this page's generic charts.js does not have to learn
 * a chart that is not a time series of lines.
 *
 * Not one line each on a shared scale: they are different quantities with
 * opposite meanings, and the only comparison worth making between them is "is
 * there energy AND is the cap off", which two aligned rows answer at a glance
 * and two overlaid curves do not.
 *
 * Payload (src/process/sh_instability.py view()):
 *   { hours: [ { iso, hhmm, day, cape, cin, cape_at, text } ], tz, cin_best }
 *
 * Colours are CSS variables written into style, never resolved to literals, so
 * a theme change repaints the chart without a redraw.
 */
(function () {
  'use strict';

  var src = document.querySelector('script[type="application/json"][data-sh-instability-data]');
  var host = document.querySelector('[data-sh-instability]');
  if (!src || !host) return;
  var DATA;
  try { DATA = JSON.parse(src.textContent); } catch (e) { return; }
  if (!DATA || !DATA.hours || !DATA.hours.length) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var COARSE = !!(window.matchMedia && matchMedia('(hover:none) and (pointer:coarse)').matches);

  /* Stull's most favourable cap band (Practical Meteorology, Table 14-4),
   * mirroring CIN_BEST in src/process/sh_instability.py — a cap in this range
   * holds long enough for real energy to build and still breaks when
   * something lifts the air. Below it energy releases as it arrives; above it,
   * nothing gets through. A test asserts these against the Python. */
  var CIN_BEST_LO = 20, CIN_BEST_HI = 60;

  /* A magnitude ramp, drawn the way the cells are drawn.
   *
   * Magnitude is carried as OPACITY over a token colour, which means the
   * direction of LIGHTNESS flips between themes: over a light page a strong
   * cell is darker than a weak one, over a dark page it is brighter. The
   * invariant is PROMINENCE, so the key shows the ramp instead of naming a
   * direction — a picture cannot be wrong about this the way "darker is more"
   * was in one of the two themes on Lake Union. */
  var RAMP_STEPS = [0.16, 0.37, 0.58, 0.79, 1];

  function el(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    return e;
  }
  function num(x) { return typeof x === 'number' && isFinite(x); }

  // The iso strings are Pacific wall clock with their offset, written by the
  // harvester, so the hour and day are read straight off them — no browser
  // zone is consulted, and a laptop left on UTC still reads PDT.
  function stamp(h) { return h.day + ', ' + h.hhmm + (DATA.tz ? ' ' + DATA.tz : ''); }

  // Same breakpoint as charts.js: a narrower viewBox is a taller chart once
  // scaled to a phone's column, and the numbers in the cells stay legible.
  function narrow() {
    var w = host.clientWidth || window.innerWidth || 760;
    return w < 520;
  }

  // Four digits do not fit a 17-unit cell; the readout carries the exact value.
  function short(v, tight) {
    return (tight && v >= 1000) ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
  }

  function nowIndex(d) {
    var now = Date.now();
    for (var i = 0; i < d.length; i++) {
      var t0 = Date.parse(d[i].iso), t1 = t0 + 3600000;
      if (now >= t0 && now < t1) return i;
    }
    return null;
  }

  function draw() {
    var d = DATA.hours, n = d.length, tight = narrow();
    host.textContent = '';

    var W = tight ? 380 : 760, GUT = tight ? 56 : 74, RH = 26, GAP = 8, TOP = 30, BOT = 26;
    var H = TOP + 2 * (RH + GAP) + BOT;
    var cw = (W - GUT - 4) / n;
    var FS = tight ? 7.5 : 10;             // three digits in an 18-unit cell
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%',
                          role: 'img', 'aria-label': 'CAPE and CIN by hour' });

    var capes = d.map(function (h) { return h.cape; }).filter(num);
    var caps = d.map(function (h) { return num(h.cin) ? Math.abs(h.cin) : null; }).filter(num);
    // Each row states its own range rather than being scaled to a threshold,
    // floored so a quiet night does not paint 40 J/kg at full strength.
    var capeTop = Math.max(300, capes.length ? Math.max.apply(null, capes) : 0);
    var cinTop = Math.max(25, caps.length ? Math.max.apply(null, caps) : 0);

    // The shaded hour you are reading in. First, so it sits behind the cells.
    var band = el('rect', { class: 'ch-nowband', y: TOP - 4, height: H - BOT + 2 - (TOP - 4),
                            width: cw, visibility: 'hidden' });
    svg.appendChild(band);
    function placeNow() {
      var i = nowIndex(d);
      if (i === null) { band.setAttribute('visibility', 'hidden'); return; }
      band.setAttribute('x', GUT + i * cw);
      band.setAttribute('visibility', 'visible');
    }
    placeNow();

    // Day labels and midnight rules, then 24-hour ticks.
    var last = null, every = tight ? 6 : 3;
    d.forEach(function (h, i) {
      var hh = String(h.iso).slice(11, 13);
      if (hh === '00' && i > 0) {
        svg.appendChild(el('line', { class: 'ch-rule-mid', x1: GUT + i * cw, x2: GUT + i * cw,
                                     y1: TOP - 6, y2: H - BOT + 4 }));
      }
      if (h.day !== last) {
        last = h.day;
        var t = el('text', { class: 'ch-tick ch-tick-strong', x: GUT + i * cw + 2, y: TOP - 9 });
        t.textContent = h.day;
        svg.appendChild(t);
      }
      if (+hh % every === 0) {
        var c = el('text', { class: 'ch-tick', x: GUT + i * cw + cw / 2, y: H - BOT + 16,
                             'text-anchor': 'middle' });
        c.textContent = hh;
        svg.appendChild(c);
      }
    });

    [['CAPE', 'cape', capeTop, '--cape-ink', false],
     // "Cap (CIN)" runs into the first cell of a phone's gutter; the key
     // under the chart says what the cap is.
     [tight ? 'Cap' : 'Cap (CIN)', 'cin', cinTop, '--cin-ink', true]].forEach(function (row, r) {
      var y = TOP + r * (RH + GAP);
      var lab = el('text', { class: 'ch-rowlab', x: 0, y: y + RH / 2 + 1 });
      lab.textContent = row[0];
      svg.appendChild(lab);
      // Styled, not attributed: the class's own font-size would beat an
      // attribute, and at 9.5 the range runs into the first cell on a phone.
      var sub = el('text', { class: 'ch-tick', x: 0, y: y + RH / 2 + 12,
                             style: 'font-size:' + (tight ? 7.5 : 8.5) + 'px' });
      sub.textContent = '0–' + Math.round(row[2]) + ' J/kg';
      svg.appendChild(sub);

      d.forEach(function (h, i) {
        var raw = h[row[1]];
        var x = GUT + i * cw;
        if (!num(raw)) return;                    // absent, never drawn as zero
        var mag = row[4] ? Math.abs(raw) : raw;
        // Opacity carries the magnitude, floored so a real-but-small value is
        // still visibly not nothing.
        var op = mag <= 0 ? 0.07 : Math.max(0.16, Math.min(1, mag / row[2]));
        svg.appendChild(el('rect', {
          x: x + 0.5, y: y, width: Math.max(1, cw - 1), height: RH, rx: 1,
          style: 'fill:var(' + row[3] + ')', opacity: op }));

        // The favourable cap band, outlined. Opacity is a MONOTONIC encoding
        // and the cap is not a monotonic quantity: 20-60 J/kg is the most
        // favourable band, not the palest and not the darkest, so no amount of
        // shading can say where it is.
        if (row[4] && mag >= CIN_BEST_LO && mag < CIN_BEST_HI) {
          svg.appendChild(el('rect', {
            x: x + 0.5, y: y + 0.5, width: Math.max(1, cw - 1), height: RH - 1, rx: 1,
            style: 'fill:none;stroke:var(--accent-2)',
            'stroke-width': 1.5, 'stroke-dasharray': '3 2' }));
        }

        /* The number, in the cell. Opacity alone cannot be read back to a
         * value, and there is no hover on a phone. Ink flips on the strong
         * cells: the fill is the token at full strength there, and dark text
         * on it fails at exactly the hours worth reading. */
        var val = el('text', {
          x: x + cw / 2, y: y + RH / 2 + 3.4, 'text-anchor': 'middle',
          'font-size': FS, 'font-weight': 600, 'pointer-events': 'none',
          style: 'fill:var(' + (op >= 0.55 ? '--bg' : '--ink-2') + ')' });
        val.textContent = short(mag, tight);
        svg.appendChild(val);
      });
    });

    host.appendChild(svg);
    wire(svg, d, { W: W, GUT: GUT, cw: cw, top: TOP - 4, bottom: TOP + 2 * RH + GAP + 4 });
    key();

    // The band follows the clock, not the page load: a tab left open at the
    // dock is the normal case, and a band marking the hour the page LOADED
    // would be a confident lie an hour later.
    clearInterval(draw.tick);
    draw.tick = setInterval(placeNow, 60000);
  }

  /* The reading, for any hour — by pointer, by tap, or by the slider.
   *
   * Each hour carries sh_instability.summarise(): "490 J/kg — marginal
   * instability, under a moderate cap of 41 J/kg: the most favourable cap".
   * That sentence is the interpretation this section exists to give; the
   * numbers in the cells say WHAT, this says what it means. */
  function wire(svg, d, g) {
    var n = d.length;
    var guide = el('rect', { class: 'ch-guide', y: g.top, height: g.bottom - g.top,
                             width: g.cw, fill: 'none', opacity: 0, 'pointer-events': 'none' });
    svg.appendChild(guide);
    var box = document.createElement('div');
    box.className = 'hov';
    box.hidden = true;
    host.appendChild(box);

    var hit = el('rect', { x: g.GUT, y: g.top, width: g.W - g.GUT - 4, height: g.bottom - g.top,
                           fill: 'none', 'pointer-events': 'all' });
    svg.appendChild(hit);

    function line(colourVar, label, value) {
      return '<span><i style="background:var(' + colourVar + ')"></i><b class="lbl">' + label +
             '</b><em>' + value + '</em></span>';
    }

    function show(i) {
      i = Math.max(0, Math.min(n - 1, i));
      var h = d[i];
      guide.setAttribute('x', g.GUT + i * g.cw);
      guide.setAttribute('opacity', 1);
      var html = '<b>' + stamp(h) + '</b>';
      html += line('--cape-ink', 'CAPE', num(h.cape) ? h.cape + ' J/kg' : '—');
      html += line('--cin-ink', 'Cap (CIN)', num(h.cin) ? Math.abs(h.cin) + ' J/kg' : '—');
      var where = (h.cape_at && num(h.cape) && h.cape > 0)
        ? ' Strongest ' + (h.cape_at.nm < 3 ? 'at the point' :
            Math.round(h.cape_at.nm) + ' nm ' + h.cape_at.toward) + '.'
        : '';
      html += '<p class="shi-read">' + (h.text || '') + '.' + where + '</p>';
      box.innerHTML = html;
      box.hidden = false;

      // Beside the hour, flipped past halfway, clamped to the host: centred,
      // it covers the very hour being read. On a coarse pointer the stylesheet
      // puts it in normal flow instead and this has no effect.
      var r = svg.getBoundingClientRect(), hr = host.getBoundingClientRect();
      if (!r.width) return;
      var px = (r.left - hr.left) + (g.GUT + (i + 0.5) * g.cw) * r.width / g.W;
      var avail = host.clientWidth, w = box.offsetWidth;
      var left = px > avail / 2 ? px - 14 - w : px + 14;
      box.style.left = Math.max(0, Math.min(avail - w, left)) + 'px';
    }
    function hide() { guide.setAttribute('opacity', 0); box.hidden = true; }
    function at(ev) {
      var r = svg.getBoundingClientRect();
      if (!r.width) return;
      var x = (ev.clientX - r.left) * g.W / r.width;
      show(Math.floor((x - g.GUT) / g.cw));
    }

    hit.addEventListener('pointermove', at);
    hit.addEventListener('pointerdown', at);        // touch: tap to read
    hit.addEventListener('pointerleave', function () { if (!COARSE) hide(); });
    // pan-y: a drag along the rows reads them, the page still scrolls
    // vertically, and a long press reads the hour instead of offering to copy.
    hit.style.touchAction = 'pan-y';
    hit.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // The slider, for readers with no pointer to hover — shown only there by
    // the stylesheet's pointer:coarse rule, and reachable by keyboard anyway.
    var slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'chart-scrub';
    slider.min = '0';
    slider.max = String(n - 1);
    slider.step = '1';
    slider.setAttribute('aria-label', 'Scrub the chart by hour');
    slider.addEventListener('input', function () { show(+slider.value); });
    host.appendChild(slider);

    // Parked on the hour the reader is in, with its reading open: a slider at
    // zero beside a chart says nothing about what it does.
    if (COARSE) {
      var i0 = nowIndex(d);
      slider.value = String(i0 === null ? 0 : i0);
      show(+slider.value);
    }
  }

  function rampSwatch(colourVar) {
    var wrap = document.createElement('span');
    wrap.className = 'shi-ramp';
    RAMP_STEPS.forEach(function (op) {
      var i = document.createElement('i');
      i.style.background = 'var(' + colourVar + ')';
      i.style.opacity = op;
      wrap.appendChild(i);
    });
    return wrap;
  }

  /* A visual key, not only a sentence. On a run where no hour lands in the
   * favourable band — most of them — nothing is outlined anywhere in the
   * figure, and a caption pointing at "the outlined band" would name
   * something the reader cannot find. The key shows the mark regardless. */
  function key() {
    var k = document.createElement('div');
    k.className = 'ltg-key shi-key';
    [['--cape-ink', 'CAPE — the energy available, none to most'],
     ['--cin-ink', 'cap (CIN) — the lid over it, none to most']].forEach(function (p) {
      var sp = document.createElement('span');
      sp.appendChild(rampSwatch(p[0]));
      sp.appendChild(document.createTextNode(p[1]));
      k.appendChild(sp);
    });
    var best = document.createElement('span');
    var bi = document.createElement('i');
    bi.className = 'shi-best';
    best.appendChild(bi);
    best.appendChild(document.createTextNode('cap of ' + CIN_BEST_LO + '–' + CIN_BEST_HI +
                                             ' J/kg — the favourable band'));
    k.appendChild(best);
    host.appendChild(k);

    /* Written in quantities rather than in how the cells look, and never "a
     * dark CAPE cell under a pale one" — that is a MONOTONIC reading of the
     * cap, less cap more danger, and the cap does not work that way. */
    var hint = document.createElement('p');
    hint.className = 'shi-hint muted';
    hint.textContent = 'Both rows are in J/kg, and stronger colour is more. High CAPE under a ' +
      'heavy cap is energy that cannot be reached; under no cap at all it leaks away as fast ' +
      'as it builds. The combination worth noticing is high CAPE over a cap in the outlined ' +
      'band. ' + (COARSE ? 'Drag the slider for what any hour adds up to.'
                         : 'Point at any hour for what it adds up to.');
    host.appendChild(hint);
  }

  draw();

  // Redraw only when the column crosses the narrow/wide breakpoint — rotating
  // a phone changes which viewBox is right; a resize drag should not redraw
  // every frame.
  var wasNarrow = narrow(), t;
  window.addEventListener('resize', function () {
    clearTimeout(t);
    t = setTimeout(function () {
      if (narrow() !== wasNarrow) { wasNarrow = narrow(); draw(); }
    }, 150);
  });
})();
