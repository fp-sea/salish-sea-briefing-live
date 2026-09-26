/* Shilshole — the simulated reflectivity loop. Self-contained.
 *
 * Ported from the Lake Union briefing's wireRefc (assets/charts.js there).
 * Reads <script type="application/json" data-sh-refc-data> and draws the
 * player into [data-sh-refc]: the frames, the coastline and home marker over
 * them, a play / step / slider bar, and the dBZ key.
 *
 * Frames are stacked in the DOM and revealed one at a time; stepping is a
 * class swap, so a full pass costs no decoding after the first, and there is
 * never a blank between frames. The slider is the state — play just advances
 * it — which keeps one source of truth instead of a play head and a slider
 * position that can disagree.
 *
 * It does NOT autoplay. Motion that starts on its own is a problem for
 * vestibular sensitivity and for anyone who scrolled past to read the text
 * under it, and the frame it opens on is the useful one anyway: now.
 */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var STEP_MS = 420;      // one frame
  var WRAP_MS = 1100;     // the pause on the last frame before it comes round

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(label, aria, cls) {
    var b = el('button', 'refc-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.title = aria;
    return b;
  }

  function wire(host, data) {
    var frames = data.frames || [];
    if (!frames.length) return;
    host.textContent = '';

    // ---- the frame: images stacked, coastline and home drawn once over them.
    var box = el('div', 'refc');
    box.style.aspectRatio = data.w + ' / ' + data.h;
    box.tabIndex = 0;
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label',
      'HRRR simulated reflectivity loop; left and right arrow keys step the hour');
    var imgs = frames.map(function (f, k) {
      var im = el('img', 'refc-frame' + (k === 0 ? ' on' : ''));
      im.src = f.img;
      im.width = data.w;
      im.height = data.h;
      im.alt = '';
      im.decoding = 'async';
      box.appendChild(im);
      return im;
    });
    /* The coastline is identical for every frame, so it is drawn ONCE over the
     * stack rather than baked into eighteen images. It is in the frames' own
     * pixel space — bent through HRRR's projection to match the raster, rather
     * than the raster being resampled to match it. */
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'refc-over');
    svg.setAttribute('viewBox', '0 0 ' + data.w + ' ' + data.h);
    svg.setAttribute('aria-hidden', 'true');
    var g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', 'refc-coast');
    (data.coast || []).forEach(function (d) {
      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', d);
      g.appendChild(p);
    });
    svg.appendChild(g);
    if (data.home) {
      var c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('class', 'refc-home');
      c.setAttribute('cx', data.home.x);
      c.setAttribute('cy', data.home.y);
      c.setAttribute('r', 6);
      svg.appendChild(c);
    }
    box.appendChild(svg);

    // ---- the bar: step back, play, step on, slider, the frame's clock.
    var bar = el('div', 'refc-bar');
    var prev = button('◀', 'Previous hour');
    var play = button('Play', 'Play the loop', 'refc-play');
    var next = button('▶', 'Next hour');
    var scrub = el('input', 'refc-scrub');
    scrub.type = 'range';
    scrub.min = '0';
    scrub.max = String(frames.length - 1);
    scrub.step = '1';
    scrub.value = '0';
    scrub.setAttribute('aria-label', 'Forecast hour');
    var label = el('span', 'refc-now');
    label.setAttribute('aria-live', 'polite');
    [prev, play, next, scrub, label].forEach(function (n) { bar.appendChild(n); });

    // ---- the key. Drawn from the same table the PNG palette is built from,
    // so a band cannot be in one and missing from the other.
    var key = el('div', 'refc-legend');
    (data.legend || []).forEach(function (b) {
      var s = el('span', 'refc-swatch');
      var i = el('i');
      i.style.background = b.rgb;     // the NWS scale is data, not a theme colour
      s.appendChild(i);
      s.appendChild(document.createTextNode(b.label));
      key.appendChild(s);
    });
    key.appendChild(el('span', 'muted', 'dBZ' + (data.floor != null
      ? ' \u00b7 below ' + data.floor + ' left blank, where the model is drawing cloud and ' +
        'numerical noise rather than rain' : '')));

    host.appendChild(box);
    host.appendChild(bar);
    host.appendChild(key);

    var at = 0, timer = null;

    // Which frame is closest to the reader's own clock. The loop opens here
    // rather than at frame 1: the oldest frame is the least interesting thing
    // on the strip, and a reader who presses nothing should still be looking at
    // now. Recomputed on each label rather than cached, so the "now" tag stays
    // truthful on a page left open at the dock — the frames themselves never move.
    function nowIndex() {
      var t = Date.now(), best = -1, gap = Infinity;
      frames.forEach(function (f, k) {
        var v = Date.parse(f.valid || '');
        if (isNaN(v)) return;
        var d = Math.abs(v - t);
        if (d < gap) { gap = d; best = k; }
      });
      // Half an hour either side of an hourly frame is that frame's hour.
      return { at: best < 0 ? 0 : best, near: gap <= 30 * 60 * 1000 };
    }

    function show(i) {
      at = ((i % frames.length) + frames.length) % frames.length;
      imgs.forEach(function (im, k) { im.classList.toggle('on', k === at); });
      scrub.value = String(at);
      var f = frames[at];
      var n = nowIndex();
      // 24-hour Pacific, like every other time on this page, with the zone
      // named: a reader in another timezone has no other way to tell.
      label.textContent = f.day + ' ' + f.hhmm + (data.tz ? ' ' + data.tz : '') +
        '  (+' + f.fhr + ' h)' + (n.near && at === n.at ? '  · now' : '');
    }

    /* Stopping is separate from what is left on screen, because the two have
     * different right answers. `stop` only halts the timer — the slider and the
     * step buttons use it to take manual control and must stay on the frame the
     * reader chose. Pausing is the other case, and there the still image goes
     * back to now: this is a briefing, and the picture it rests on should be
     * the weather at the reader's own clock rather than wherever the animation
     * happened to be interrupted. */
    function stop() {
      if (timer) { clearTimeout(timer); timer = null; }
      play.textContent = 'Play';
      play.setAttribute('aria-label', 'Play the loop');
      play.title = 'Play the loop';
      play.classList.remove('on');
    }

    function pause() {
      stop();
      show(nowIndex().at);
    }

    /* Runs until it is paused: you watch a radar loop several times round.
     * setTimeout rather than setInterval so the wrap can hold longer than a
     * frame. Without that beat the last frame and the first are
     * indistinguishable in motion, and a loop that restarts invisibly reads as
     * weather jumping backwards. */
    function start() {
      if (timer) return;
      function tick() {
        var last = at === frames.length - 1;
        show(at + 1);
        timer = setTimeout(tick, last ? WRAP_MS : STEP_MS);
      }
      timer = setTimeout(tick, STEP_MS);
      play.textContent = 'Pause';
      play.setAttribute('aria-label', 'Pause the loop');
      play.title = 'Pause the loop';
      play.classList.add('on');
    }

    play.addEventListener('click', function () { if (timer) pause(); else start(); });
    prev.addEventListener('click', function () { stop(); show(at - 1); });
    next.addEventListener('click', function () { stop(); show(at + 1); });
    scrub.addEventListener('input', function () { stop(); show(+scrub.value); });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { stop(); show(at - 1); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { stop(); show(at + 1); e.preventDefault(); }
      else if (e.key === ' ' || e.key === 'Enter') {
        if (timer) pause(); else start();
        e.preventDefault();
      }
    });

    /* A finger dragged sideways across the frame scrubs it, one hour per
     * step's width of the frame. On a phone the slider is a thin strip under a
     * big picture; the picture is where the thumb already is. Vertical drags
     * are left to the page (touch-action:pan-y in the CSS), so the frame never
     * traps a reader scrolling past it. */
    var drag = null;
    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { x: e.clientX, from: at, moved: false, id: e.pointerId };
    });
    box.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 8) return;
      if (!drag.moved) {
        drag.moved = true;
        stop();
        try { box.setPointerCapture(e.pointerId); } catch (_) { /* old engines */ }
      }
      var per = box.clientWidth / Math.max(frames.length, 1);
      var k = drag.from + Math.round(dx / Math.max(per, 1));
      show(Math.max(0, Math.min(frames.length - 1, k)));
    });
    function endDrag() { drag = null; }
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);

    show(nowIndex().at);
    // A page left open: keep the "now" tag on the right frame without moving
    // the frame the reader is looking at.
    setInterval(function () { if (!timer) show(at); }, 60000);
  }

  function init() {
    document.querySelectorAll('[data-sh-refc]').forEach(function (host) {
      var scope = host.parentNode || document;
      var src = scope.querySelector('script[data-sh-refc-data]') ||
                document.querySelector('script[data-sh-refc-data]');
      if (!src) return;
      var data;
      try { data = JSON.parse(src.textContent); } catch (e) { return; }
      wire(host, data);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
