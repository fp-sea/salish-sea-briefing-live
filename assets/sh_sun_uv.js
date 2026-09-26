/* Sun & UV on the Shilshole page: which UV bar is now, and reading one out.
 *
 * The Lake Union briefing marks the current hour on its UV curve client-side,
 * because the curve is fetched at build and "now" is wherever the reader is,
 * not where the build was. It reads the bars with a title tooltip, which a
 * touch screen never shows — so here a hover or tap writes the hour into a
 * line under the chart, and where hovering does not exist a .chart-scrub
 * slider (the page's own touch control, shown by the pointer:coarse rule in
 * site.css) steps through the hours, parked on the one the reader is in.
 */
(function () {
  var fig = document.querySelector('.uvfig');
  if (!fig) return;
  var bars = [].slice.call(fig.querySelectorAll('.uvbar[data-hour]'));
  var out = fig.querySelector('.uvread');
  if (!bars.length) return;

  var data = [];
  try {
    data = JSON.parse(document.querySelector('script[data-sun-uv]').textContent).uv || [];
  } catch (e) { /* the bars' own titles still carry every value */ }

  var BAND = { low: 'low', moderate: 'moderate', high: 'high',
               'very-high': 'very high', extreme: 'extreme' };

  function text(i) {
    var h = data[i];
    if (!h) return bars[i].getAttribute('title') || '';
    return h.day + ' ' + h.hhmm + ' — ' + (h.value === null ? 'not in the EPA feed'
      : 'UV ' + h.value + ', ' + (BAND[h.band] || h.band));
  }

  function show(i) {
    bars.forEach(function (b, k) { b.classList.toggle('sel', k === i); });
    if (out) out.textContent = i === null ? '' : text(i);
  }

  /* The bar whose hour has started most recently; a future hour is never
     "now". -1 before the window opens or after it has closed. */
  function nowIndex() {
    var now = Date.now(), best = -1, gap = Infinity;
    bars.forEach(function (b, i) {
      var g = now - Date.parse(b.getAttribute('data-hour'));
      if (g >= 0 && g < gap && g < 3600000) { gap = g; best = i; }
    });
    return best;
  }

  function mark() {
    var n = nowIndex();
    bars.forEach(function (b, i) { b.classList.toggle('now', i === n); });
  }

  var coarse = window.matchMedia && matchMedia('(hover:none) and (pointer:coarse)').matches;
  var slider = null;

  bars.forEach(function (b, i) {
    b.addEventListener('pointerenter', function () { show(i); });
    b.addEventListener('pointerdown', function () {       // touch: tap to read
      show(i);
      if (slider) slider.value = String(i);
    });
  });
  if (!coarse) {
    fig.querySelector('.uvbars').addEventListener('pointerleave', function () { show(null); });
  }

  if (coarse) {
    slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'chart-scrub';
    slider.min = '0';
    slider.max = String(bars.length - 1);
    slider.step = '1';
    slider.setAttribute('aria-label', 'Step through the UV forecast by hour');
    slider.addEventListener('input', function () { show(+slider.value); });
    fig.querySelector('.uvchart').insertAdjacentElement('afterend', slider);
    /* Parked on the hour the reader is in, or on the peak when the window is
       tomorrow's: a slider at zero beside a chart says nothing about what it
       does, and 04:00 is the least interesting hour in it. */
    var start = nowIndex();
    if (start < 0) {
      start = 0;
      data.forEach(function (h, i) {
        if (h.value !== null && h.value > (data[start].value || 0)) start = i;
      });
    }
    slider.value = String(start);
    show(start);
  }

  mark();
  setInterval(mark, 60000);
})();
