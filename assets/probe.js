/* The numbers under a point on a rendered model map.
 *
 * Every rendered frame ships a uint8 sidecar (.bin) holding the VALUES on a
 * regular grid over its domain, several channels per cell, row 0 = north. The
 * readout reads that, never the picture: the fill is banded and has streamlines,
 * isobars and the coastline drawn over it, so sampling pixels would give a band
 * at best and a line colour at worst.
 *
 * Hover on a desktop reads as the pointer moves. A TAP (or click) pins the
 * point, and a pinned point is re-read whenever the pane changes — step through
 * time with a finger on one spot and the numbers follow the forecast there.
 * That works the same with a mouse or a thumb, which the SSCOFS readout this
 * generalises did not: it listened for mousemove only, so on a phone it never
 * said anything at all.
 *
 *   MapProbe.attach(slotEl, readEl, getState)  -> { refresh() }
 *
 * getState() returns { url, spec, product } for whatever the pane shows now, or
 * null when it shows something with no values behind it (a UW WRF image).
 *
 * No dependencies.
 */
(function () {
  'use strict';

  var cache = {}, order = [], MAX = 80;

  /* Fetch once, keep the last MAX. A grid is 30-60 KB; stepping a run with four
     panes touches four per step, so this is a few MB at most. */
  function load(url, done) {
    var hit = cache[url];
    if (hit && hit.bytes) { done(hit.bytes); return; }
    if (hit && hit.failed) { done(null); return; }
    if (hit) { hit.wait.push(done); return; }
    hit = cache[url] = { wait: [done] };
    order.push(url);
    if (order.length > MAX) delete cache[order.shift()];
    fetch(url)
      .then(function (r) { return r.ok ? r.arrayBuffer() : null; })
      .then(function (b) {
        if (b) hit.bytes = new Uint8Array(b); else hit.failed = true;
        hit.wait.forEach(function (f) { f(hit.bytes || null); }); hit.wait = [];
      })
      .catch(function () {
        hit.failed = true;
        hit.wait.forEach(function (f) { f(null); }); hit.wait = [];
      });
  }

  /* Pointer fraction over the IMAGE -> values at that cell, or a reason. The
     PNG carries a title strip and margins, so a position over the image is not a
     position over the map; spec.rect says where the map sits inside it. */
  function sample(bytes, spec, fx, fy) {
    var r = spec.rect;
    var mx = (fx - r.left) / (r.right - r.left);
    var my = (fy - r.top) / (r.bottom - r.top);
    if (mx < 0 || mx > 1 || my < 0 || my > 1) return { outside: true };
    var ny = spec.shape[0], nx = spec.shape[1], nc = spec.channels.length;
    if (bytes.length !== ny * nx * nc) return { broken: true };
    var col = Math.min(nx - 1, Math.floor(mx * nx));
    var row = Math.min(ny - 1, Math.floor(my * ny));
    var base = (row * nx + col) * nc, out = { none: true };
    spec.channels.forEach(function (c, k) {
      var b = bytes[base + k];
      if (b === spec.none) { out[c[0]] = null; return; }
      // An optional third element is an offset, for signed channels.
      out[c[0]] = (b - (c[2] || 0)) / c[1];
      out.none = false;
    });
    var box = spec.box;
    out.lat = box.north - my * (box.north - box.south);
    out.lon = box.west + mx * (box.east - box.west);
    return out;
  }

  var POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function from(d) {
    if (d === null || d === undefined) return '';
    var deg = Math.round(d / 2) * 2 % 360;       // stored to 2 degrees
    return ' from ' + POINTS[Math.round(deg / 22.5) % 16] + ' ' +
           ('00' + deg).slice(-3) + '°';
  }
  function kt(v) { return v === null || v === undefined ? '—' : Math.round(v) + ' kt'; }
  function pct(v) { return v === null || v === undefined ? '—' : Math.round(v) + '%'; }

  // Visibility is stored to a tenth of a mile; past 10 mi the number says
  // nothing a skipper uses.
  function vis(m) {
    if (m === null || m === undefined) return '';
    return m >= 10 ? 'vis 10+ mi' : 'vis ' + m.toFixed(1) + ' mi';
  }
  // HRRR's lightning threat as its category, in words: the index is not a
  // probability and a decimal would invite reading it as one.
  var LTNG_WORDS = ['none', 'trace', 'possible', 'likely', 'strong'];
  function ltng(c) {
    return (c === null || c === undefined) ? '' : 'lightning ' + LTNG_WORDS[Math.round(c)];
  }

  /* What the pane is showing comes FIRST, then its context. A gust pane and a
     wind pane read the same sidecar; only the emphasis differs. */
  function describe(p, v, spec) {
    // HRRR's fog and lightning ride along on its wind and gust panes only when
    // they say something: visibility under 5 mi, any lightning at all.
    function hazards() {
      var out = [];
      if (v.vis !== null && v.vis !== undefined && v.vis < 5) out.push(vis(v.vis));
      if (v.ltng !== null && v.ltng !== undefined && v.ltng >= 1) out.push(ltng(v.ltng));
      return out.length ? ' · ' + out.join(' · ') : '';
    }
    var windText = kt(v.wind) + from(v.dir) +
                   (v.gust !== null && v.gust !== undefined ? ' · gust ' + kt(v.gust) : '');
    if (p === 'wind') return windText + hazards();
    if (p === 'gust') {
      return 'gust ' + kt(v.gust) + ' · wind ' + kt(v.wind) + from(v.dir) + hazards();
    }
    // The pane's own quantity first, stated even when it is benign.
    if (p === 'vis') {
      return (vis(v.vis) || 'no visibility here') + ' · ' + windText +
             (v.ltng >= 1 ? ' · ' + ltng(v.ltng) : '');
    }

    if (p === 'runspread' || p === 'runtrend') {
      // HRRR run to run: the sequence itself, oldest first, because "they
      // differ by 4 kt" and "each run is windier than the last" are different
      // stories with the same spread.
      var seq = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5']
        .map(function (k) { return v[k]; })
        .filter(function (x) { return x !== null && x !== undefined; })
        .map(function (x) { return Math.round(x); });
      var runs = seq.length ? ' · runs ' + seq.join(' ') + ' kt, oldest first' : '';
      var t = v.runtrend, sp = v.runspread;
      var trend = (t === null || t === undefined) ? '' :
        'newest ' + (t >= 0 ? '+' : '−') + Math.abs(t).toFixed(1) +
        ' kt vs the ' + Math.max(0, seq.length - 1) + ' before';
      var spread = (sp === null || sp === undefined) ? '' :
        'last ' + seq.length + ' runs differ by ' + sp.toFixed(1) + ' kt';
      var first = p === 'runtrend' ? [trend, spread] : [spread, trend];
      // The direction is the NEWEST run's, and says so: tacked straight onto
      // the list it read as "runs … oldest first from WNW", as if the runs came
      // from somewhere.
      var dir = (v.dir === null || v.dir === undefined) ? '' : ' · newest' + from(v.dir);
      return first.filter(Boolean).join(' · ') + runs + dir;
    }
    if (p === 'current') {
      // A current is stated by where it SETS — toward, the opposite of wind —
      // and to a tenth of a knot, because 0.4 and 0.6 kt are different tides.
      if (v.speed === null || v.speed === undefined) return 'no model water here';
      var s = v.speed.toFixed(1) + ' kt current';
      if (v.set === null || v.set === undefined) return s;
      var deg = Math.round(v.set / 2) * 2 % 360;
      return s + ' setting ' + POINTS[Math.round(deg / 22.5) % 16] + ' ' +
             ('00' + deg).slice(-3) + '°';
    }
    // REFS: every product of the ensemble at this point, the pane's own first.
    // No bearing where the members do not agree on one: the mean VECTOR there
    // is the residue of members cancelling, and its direction is noise.
    // Measured: a 0.5 kt mean vector under a 10.9 kt mean speed, which this
    // once reported as "from NE 046°".
    // Both sides are FRACTIONS: sample() has already divided the stored byte by
    // its channel scale. Comparing against 100 x the threshold — as this first
    // did — withheld the direction at every point, including a 26 kt westerly
    // in the Strait with the members at 0.95 agreement.
    var agreed = v.agree === null || v.agree === undefined ||
                 v.agree >= (spec && spec.dirAgreeMin || 0);
    var mean = 'mean ' + kt(v.mean) + (agreed ? from(v.dir) : ', no agreed direction');
    var spread = v.spread !== null ? 'spread ±' + v.spread.toFixed(1) : '';
    // Keyed, not positional: a frame missing one threshold must not shift the
    // pane's own chance onto its neighbour's number.
    var ch = {
      p20: v.p20 != null ? '≥20 kt ' + pct(v.p20) : '',
      p30: v.p30 != null ? '≥30 kt ' + pct(v.p30) : '',
      p35: v.p35 != null ? '≥35 kt ' + pct(v.p35) : '',
      p40: v.p40 != null ? '≥40 kt ' + pct(v.p40) : '',
      p50: v.p50 != null ? '≥50 kt ' + pct(v.p50) : ''
    };
    // 30 and 40 kt are readout-only (no map pane of their own), listed in
    // order between the others. != null, not !== null: a sidecar written
    // before they were harvested has no such channel, and undefined must read
    // as absent, not print "≥30 kt NaN%".
    var chances = ['p20', 'p30', 'p35', 'p40', 'p50'];
    // Fog and lightning chances: the pane's own always, the rest when REFS
    // gives them any chance at all, as with the wind chances.
    var hz = {
      pfog1: v.pfog1 != null ? 'vis <1 mi ' + pct(v.pfog1) : '',
      pfog05: v.pfog05 != null ? 'vis <½ mi ' + pct(v.pfog05) : '',
      pltng: v.pltng != null ? 'lightning ' + pct(v.pltng) : ''
    };
    function hazardChances(skip) {
      return ['pfog1', 'pfog05', 'pltng'].filter(function (k) {
        return k !== skip && v[k] != null && v[k] >= 1;
      }).map(function (k) { return hz[k]; });
    }
    /* The pane's OWN chance is always stated, 0% included — that is the
       reading. The others only when REFS gives them any chance at all: a line
       of "≥35 kt 0% · ≥50 kt 0%" wrapped the readout onto a second line on a
       laptop-width pane to say nothing. */
    function others(skip) {
      return chances.filter(function (k) {
        return k !== skip && v[k] !== null && v[k] >= 1;
      }).map(function (k) { return ch[k]; });
    }
    var parts;
    if (p === 'spread') parts = [spread, mean].concat(others(null));
    else if (p === 'p20' || p === 'p35') parts = [ch[p]].concat(others(p), [mean, spread]);
    else if (p === 'pfog1' || p === 'pfog05') {
      parts = [hz[p]].concat(hazardChances(p), [mean, spread], others(null));
    }
    else parts = [mean, spread].concat(others(null)).concat(hazardChances(null));
    return parts.filter(Boolean).join(' · ');
  }

  function place(v) {
    return v.lat.toFixed(2) + 'N ' + Math.abs(v.lon).toFixed(2) + 'W';
  }

  /* The key for a pane that is NOT on the wind scale — REFS spread or chance —
     drawn from the same bands and colours the map was rendered with. HTML,
     not an image: a key PNG made for the 946 px shared legend, shrunk into a
     pane, was 62 px tall with 5 px numbers. */
  function paneKey(k) {
    if (!k || !k.bands) return '';
    function cell(c) { return '<i style="background:' + c + '"></i>'; }
    // A signed scale (the HRRR trend) has a cell BELOW its lowest band too.
    var cells = (k.under ? cell(k.under) : '') + k.colors.map(cell).join('') +
                (k.over ? cell(k.over) : '');
    // Each number sits ON the edge where its colour starts: edge i of n cells
    // is at i/n of the bar. Spacing them as equal flex items put every one of
    // them off its edge, because there is one more edge than there are colours.
    var lead = k.under ? 1 : 0;
    var n = lead + k.colors.length + (k.over ? 1 : 0);
    var ticks = k.bands.map(function (b, i) {
      return '<b style="left:' + (100 * (i + lead) / n).toFixed(2) + '%">' +
             (b > 0 && k.under ? '+' + b : b) + '</b>';
    }).join('');
    return '<div class="pk"><div class="pk-cap">' + k.unit + ' · ' + k.label +
           '</div><div class="pk-bar">' + cells + '</div><div class="pk-tick">' +
           ticks + '</div></div>';
  }

  function attach(slot, readEl, getState) {
    var host = slot.parentNode;
    var dot = document.createElement('span');
    dot.className = 'probe-dot';
    dot.hidden = true;
    host.appendChild(dot);
    var pinned = null;                        // [fx, fy] over the image, or null

    function clear(msg) {
      readEl.textContent = msg || '';
      readEl.classList.toggle('probe-idle', !msg);
      dot.hidden = true;
    }

    function readAt(fx, fy) {
      var st = getState();
      if (!st) { clear(''); return; }
      if (!st.url) {
        // A pane may say what to read instead (a cropped UW frame has lost
        // its own colour bar).
        clear(st.message || 'No values behind this image — read the colours against its own key.');
        return;
      }
      load(st.url, function (bytes) {
        if (!bytes) { clear('Readout unavailable for this frame.'); return; }
        var v = sample(bytes, st.spec, fx, fy);
        if (v.outside) { clear(''); return; }
        if (v.broken) { clear('Readout unavailable for this frame.'); return; }
        readEl.classList.remove('probe-idle');
        readEl.textContent = v.none ? 'Land, or outside the model · ' + place(v)
                                    : describe(st.product, v, st.spec) + ' · ' + place(v);
        var img = slot.querySelector('img');
        if (!img) return;
        var ir = img.getBoundingClientRect(), hr = host.getBoundingClientRect();
        dot.style.left = (ir.left - hr.left + fx * ir.width) + 'px';
        dot.style.top = (ir.top - hr.top + fy * ir.height) + 'px';
        dot.hidden = false;
      });
    }

    function frac(ev) {
      var img = slot.querySelector('img');
      if (!img) return null;
      var r = img.getBoundingClientRect();
      if (!r.width) return null;
      return [(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height];
    }

    slot.addEventListener('pointermove', function (ev) {
      if (ev.pointerType !== 'mouse') return;   // a finger drag is a scroll
      var f = frac(ev);
      if (f) readAt(f[0], f[1]);
    });
    // CLICK, not pointerdown: a finger that lands on the map to start scrolling
    // the page fires pointerdown too, and pinning there would drop a marker
    // every time someone scrolled past. A click is only ever a real tap.
    slot.addEventListener('click', function (ev) {
      var f = frac(ev);
      if (!f) return;
      pinned = f;
      readAt(f[0], f[1]);
    });
    slot.addEventListener('pointerleave', function (ev) {
      if (ev.pointerType !== 'mouse') return;
      if (pinned) readAt(pinned[0], pinned[1]); else clear('');
    });
    clear('');

    return {
      /* Called by the viewer after every repaint: a pinned point follows the
         time step and the product, which is the whole use of pinning. */
      refresh: function () { if (pinned) readAt(pinned[0], pinned[1]); },
      unpin: function () { pinned = null; clear(''); }
    };
  }

  // Exposed for the viewers, and for tests that drive the decoding directly.
  window.MapProbe = { attach: attach, sample: sample, describe: describe, load: load,
                      paneKey: paneKey };
})();
