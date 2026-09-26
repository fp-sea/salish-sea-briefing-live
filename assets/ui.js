/* Page behaviour that is not about drawing anything.
 *
 * Kept apart from charts.js, which renders, and times.js, which answers "how
 * old is that". This file is for the small mechanics of the page itself.
 *
 * No dependencies.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------- prefs
   *
   * ONE stored object, read and written here and nowhere else. The
   * alternative — a key per preference — drifts: each gets written from a
   * different place, cleared independently, and migrated by whoever remembers.
   * The pre-paint script in <head> reads the same object, because a preference
   * that only applies after the body has loaded is a visible repaint.
   *
   * The legacy `theme` key is read once, so a reader who already chose dark
   * does not silently lose it.
   */
  var DEFAULTS = { theme: null, compact: false };
  var root = document.documentElement;

  function readPrefs() {
    var p = {};
    try { p = JSON.parse(localStorage.getItem('prefs') || '{}') || {}; }
    catch (e) { /* private mode, or something else wrote here */ }
    if (p.theme == null) {
      try { p.theme = localStorage.getItem('theme'); } catch (e) { /* ditto */ }
    }
    return Object.assign({}, DEFAULTS, p);
  }
  function writePrefs(p) {
    try { localStorage.setItem('prefs', JSON.stringify(p)); }
    catch (e) { /* private mode: the choice applies, it just is not remembered */ }
  }
  var prefs = readPrefs();

  /* Light and dark.
   *
   * `current()` asks the PAGE, not the stored value: with no choice made the
   * page follows prefers-color-scheme, and the button has to offer the opposite
   * of what is actually on screen rather than the opposite of nothing.
   */
  function wireTheme() {
    var btn = document.getElementById('themetoggle');
    if (!btn) return;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    function current() {
      return root.getAttribute('data-theme') || (mq.matches ? 'dark' : 'light');
    }
    function label() {
      var dark = current() === 'dark';
      btn.textContent = dark ? 'Light' : 'Dark';
      btn.setAttribute('aria-pressed', String(dark));
    }
    btn.addEventListener('click', function () {
      prefs.theme = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', prefs.theme);
      writePrefs(prefs);
      label();
    });
    // Follow the system only while the reader has NOT chosen — once they have,
    // their choice outranks the OS switching at sunset.
    mq.addEventListener('change', function () {
      if (!root.getAttribute('data-theme')) label();
    });
    label();
  }

  /* Compact: fold away the prose that explains how to read the page.
   *
   * What it hides is .explain and nothing else — blocks tagged in the template
   * as "how to read this", never a caveat about what the data is or is not.
   * Those are the honesty layer and a reader who has folded the explanations
   * has not asked to be told less about the limits of what they are looking at.
   *
   * Off by default at every width, phones included. It folds material a reader
   * may well want; that is a thing to ask for deliberately, not a thing a
   * narrow viewport should decide on their behalf.
   */
  function wireCompact() {
    var btn = document.getElementById('compacttoggle');
    if (!btn) return;
    function label() {
      // What it will DO, not what it currently is: a lone word on a button is
      // read as the action, and "Compact" while already compact reads as a
      // state nobody can act on.
      btn.textContent = prefs.compact ? 'Full' : 'Compact';
      btn.setAttribute('aria-pressed', String(!!prefs.compact));
      btn.setAttribute('aria-label', prefs.compact
        ? 'Show the notes explaining how to read each section'
        : 'Hide the notes explaining how to read each section');
    }
    btn.addEventListener('click', function () {
      prefs.compact = !prefs.compact;
      root.classList.toggle('compact', prefs.compact);
      writePrefs(prefs);
      label();
    });
    root.classList.toggle('compact', !!prefs.compact);
    label();
  }

  /* Safari restores the open state of <details> across a reload.
   *
   * It treats it as form state, the way it restores a text field or a checkbox,
   * so a panel opened once comes back open on every refresh even though the
   * HTML says nothing of the kind and nothing here is stored. It survives a
   * normal reload and a back/forward restore, which is why it presents as "that
   * panel keeps reopening" rather than as anything to do with caching.
   *
   * The markup is the authority: whatever the server wrote is what the reader
   * gets. Applied to every panel rather than to the one that has the problem
   * today, because the next one added would inherit it silently.
   */
  function wireDisclosures() {
    // Restoration can land after this script runs, so the reset is applied more
    // than once — but never after the reader has touched a panel. Closing one
    // that someone deliberately opened is a worse bug than the one being fixed,
    // and this page loads satellite loops and hundreds of model frames, so
    // `load` can fire seconds late.
    var userActed = false;
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('summary')) userActed = true;
    }, true);

    function resetToMarkup() {
      if (userActed) return;
      document.querySelectorAll('details').forEach(function (d) {
        // NOT `d.open = d.hasAttribute('open')`. `open` is a REFLECTED
        // attribute: setting the property sets the attribute, so by the time
        // this runs the restored state and the authored state are the same
        // thing and the check is a no-op. The intent has to be declared
        // somewhere the restoration cannot reach — an attribute of our own.
        d.open = d.getAttribute('data-start') === 'open';
      });
    }
    resetToMarkup();
    document.addEventListener('DOMContentLoaded', resetToMarkup);
    // bfcache: coming back with the back button restores the whole DOM, state
    // and all, without re-running the script.
    window.addEventListener('pageshow', resetToMarkup);
  }

  wireDisclosures();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      wireTheme(); wireCompact();
    });
  } else {
    wireTheme(); wireCompact();
  }
})();
