/* Swapping one frame for the next without a blank between them.
 *
 * All three image viewers here — the wind panels and the currents pair on the
 * briefing, and the comparison page — stepped frames by rewriting the slot:
 *
 *     slot.innerHTML = '<img src="' + url + '">';
 *
 * which DESTROYS the <img> and builds a new one every step. A fresh <img>
 * paints nothing until the browser has decoded its source, and that is true
 * even when the bytes are already in cache, so the slot went genuinely empty
 * between frames. Stepping or playing a run flickered.
 *
 * Two changes fix it. The element is reused, so there is never a moment with no
 * image in the slot; and the new source is DECODED before it is assigned, so
 * the swap happens when the next frame is ready to paint rather than starting
 * the wait. A decoded, cached image swaps within a frame.
 *
 * Preloading was already in place and is not enough on its own: it warms the
 * cache, which removes the network wait but not the decode, and does nothing
 * about the teardown.
 */
(function () {
  'use strict';

  /* Show `url` in `slot`, reusing the element already there.
   *
   * Every call takes a sequence number. Playing a run at 700 ms, or dragging a
   * slider, issues paints faster than they decode, and decodes do not
   * necessarily finish in order — without the guard an older frame could resolve
   * last and win, leaving the pane showing a time the control does not. */
  window.paintFrame = function (slot, url, alt) {
    var img = slot.__frameImg;
    if (!img || img.parentNode !== slot) {
      slot.textContent = '';                 // clears any placeholder
      img = new Image();
      img.decoding = 'async';
      slot.appendChild(img);
      slot.__frameImg = img;
    }
    img.alt = alt || '';
    if (img.getAttribute('src') === url) return;   // already this frame

    var seq = (slot.__frameSeq = (slot.__frameSeq || 0) + 1);
    var pre = new Image();
    function apply() {
      if (seq !== slot.__frameSeq) return;   // a newer frame was asked for
      img.src = url;
    }
    pre.src = url;
    if (pre.decode) {
      // decode() rejects on a broken image; apply anyway so the <img> shows the
      // browser's own broken state rather than the previous frame forever.
      pre.decode().then(apply, apply);
    } else if (pre.complete) {
      apply();
    } else {
      pre.onload = apply;
      pre.onerror = apply;
    }
  };

  /* Replace the slot with a placeholder — "this run does not reach here".
   * Bumps the sequence so a decode already in flight cannot put an image back
   * after the placeholder has been shown. */
  window.clearFrame = function (slot, html) {
    slot.__frameSeq = (slot.__frameSeq || 0) + 1;
    slot.__frameImg = null;
    slot.innerHTML = html;
  };
})();
