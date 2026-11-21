/* Ages and staleness, computed against the READER's clock.
 *
 * This page is STATIC and rebuilds twice a day, so anything phrased as "2 h
 * old" at build time is a lie by the time it is read. A page built at 15:10 and
 * opened at 22:00 went on claiming the alerts file was two hours old when it
 * was nearly seven — and the alerts limit is three. The build cannot see that
 * happen, and on a page rebuilt twice a day it is most of a product's life.
 *
 * That bug was already fixed once, for imagery, with a bespoke script at the
 * foot of the briefing. This is the same fix made general: one class, applied
 * to anything with a timestamp — the manifest, the freshness table, the image
 * captions — and one place where "how old is that" is decided.
 *
 * The server still writes an age into the HTML. It is the no-JavaScript
 * fallback: less useful, and still true at the moment of the build, which is
 * the right way round.
 *
 * Three jobs:
 *   .u-age[data-since]           text becomes the age, tooltip the absolute
 *   [data-max-age][data-since]   is-stale toggled when it outlives its limit
 *   .stale-alarm / .stale-note   the banners re-derived from those rows
 *
 * No dependencies.
 */
(function () {
  'use strict';

  // A page left open at the dock goes on being read; the labels must not
  // freeze. Every minute is finer than any age shown here changes.
  var TICK_MS = 60000;

  /* "47 min", "3 h 05 m", "2 d 4 h".
   *
   * Not decimal hours. "1.2 h old" reads as a measurement when the useful
   * question is nearer "is that this morning's?" — and below two hours the
   * decimal is actively worse than the minutes it replaced. Hours and minutes
   * to 36 h, then days, because past a day the minutes are noise. */
  function fmtAge(m) {
    if (m < 90) return Math.round(m) + ' min';
    if (m < 60 * 36) return Math.floor(m / 60) + ' h ' + ('0' + Math.round(m % 60)).slice(-2) + ' m';
    return Math.floor(m / 1440) + ' d ' + Math.round((m % 1440) / 60) + ' h';
  }

  function minutesSince(el, now) {
    var t = Date.parse(el.getAttribute('data-since'));
    return isNaN(t) ? null : (now - t) / 60000;
  }

  function applyAges(now) {
    document.querySelectorAll('.u-age[data-since]').forEach(function (el) {
      var m = minutesSince(el, now);
      if (m === null) return;
      var suffix = el.getAttribute('data-suffix') || '';
      // A timestamp in the future is clock skew between here and the source,
      // not a forecast. Say so rather than print a negative duration.
      el.textContent = m < 0 ? 'just now' : fmtAge(m) + (suffix ? ' ' + suffix : '');
      el.title = 'at ' + new Date(Date.parse(el.getAttribute('data-since'))).toLocaleString();
    });
  }

  /* Which products have outlived the limit THEY are judged by.
   *
   * Each row publishes its own limit, because they are not alike: active alerts
   * go stale in three hours and a forecast discussion does not. Those limits
   * already gate what the build reports; what the build cannot do is notice a
   * product crossing its limit afterwards.
   *
   * A stale row keeps its age rather than blanking. The last known time,
   * clearly marked seven hours old, is more use than a dash — and a dash would
   * read as "never fetched", which is a different and wronger claim. */
  function applyStale(now) {
    var stale = [];
    // A row with no timestamp is late by definition and cannot be recomputed,
    // so it is collected first and carried through unchanged. Leaving it to the
    // build instead was a bug: the alarm was pinned open by an undated
    // NON-critical row, because "some row somewhere is undated" is not the same
    // question as "is a CRITICAL row undated".
    document.querySelectorAll('[data-undated]').forEach(function (el) {
      stale.push({label: el.getAttribute('data-label') || '', age: null,
                  limit: null, critical: el.getAttribute('data-critical') === '1'});
    });
    document.querySelectorAll('[data-max-age][data-since]').forEach(function (el) {
      var m = minutesSince(el, now);
      var limit = parseFloat(el.getAttribute('data-max-age'));
      if (m === null || isNaN(limit)) return;
      var bad = m > limit;
      el.classList.toggle('is-stale', bad);
      if (bad) {
        stale.push({
          label: el.getAttribute('data-label') || '',
          age: fmtAge(m),
          limit: limit,
          critical: el.getAttribute('data-critical') === '1'
        });
      }
    });
    return stale;
  }

  /* The banners, re-derived rather than left as the build wrote them.
   *
   * This is the part that matters. The alarm says "do not rely on this page",
   * and it was rendered from the build's own clock — so the one case it exists
   * for, a page read hours after it was made, was the one case it could not
   * fire. The wording stays in the template; only the list and the visibility
   * are decided here.
   *
   * Undated rows arrive here already collected by applyStale, carrying their
   * label and their severity — see the note there on why the build cannot be
   * left to decide them. */
  function applyBanners(stale) {
    var alarm = document.querySelector('.stale-alarm');
    var note = document.querySelector('.stale-note');
    var critical = stale.filter(function (s) { return s.critical; });
    var rest = stale.filter(function (s) { return !s.critical; });

    function fill(el, items, fmt) {
      if (!el) return;
      var list = el.querySelector('.stale-list');
      // Rebuilt as elements, one per source, because the stylesheet lays each
      // out on its own line. textContent, never innerHTML: these labels come
      // from our own build, and there is no reason for that to be load-bearing.
      if (list) {
        list.textContent = '';
        items.forEach(function (s) {
          var span = document.createElement('span');
          span.textContent = fmt(s);
          list.appendChild(span);
        });
      }
      el.hidden = !items.length;
    }
    fill(alarm, critical, function (s) {
      if (s.age === null) {
        return s.label + ' could not be dated at all — it may be missing or may '
          + 'have failed to fetch.';
      }
      // The limit is a round number of hours by construction, so it is said
      // that way. Running it through fmtAge produced "expected within 3 h 00 m",
      // which reads as a measurement of something rather than a rule.
      return s.label + ' is ' + s.age + ' old (expected within '
        + (s.limit / 60) + ' h).';
    });
    // Only one banner at a time: the alarm supersedes the note, which would
    // otherwise say "the rest of the page is current" directly beneath it.
    fill(note, (alarm && !alarm.hidden) ? [] : rest, function (s) {
      return s.label + ' (' + (s.age === null ? 'not dated' : s.age) + ')';
    });
  }

  /* The worst case anywhere in these waters, for the period the READER is in.
   *
   * The zone bulletin is divided into periods — TONIGHT, WED, WED NIGHT — and
   * which one is current depends on when the page is opened. This page is built
   * twice a day and is read at 05:00 before a departure, by which time the
   * period it was built in has ended. Every period ships in the payload and the
   * right one is chosen here, for the same reason every age on this page is.
   *
   * The period containing `now` is the last one that has STARTED. A period in
   * the future is never current, and when the whole bulletin is behind — the
   * last period ended before the reader arrived — nothing is shown rather than
   * the final period presented as though it were now.
   */
  function applyGlance() {
    var host = document.querySelector('[data-glance]');
    var src = document.querySelector('[data-glance-data]');
    if (!host || !src) return;
    var rows;
    try { rows = JSON.parse(src.textContent) || []; } catch (e) { return; }

    var now = Date.now(), cur = null, next = null;
    rows.forEach(function (r, i) {
      var t = Date.parse(r.starts_local);
      if (!isNaN(t) && t <= now) { cur = r; next = rows[i + 1]; }
    });
    // Past the end of the bulletin there is no current period. The last one is
    // not it, and saying so is better than showing yesterday evening as now.
    var ended = cur && next === undefined && rows.length > 1;
    if (!cur || ended) { host.hidden = true; return; }
    host.hidden = false;

    var label = host.querySelector('.glance-period');
    if (label) label.textContent = cur.label.toLowerCase();
    var tiles = host.querySelector('.glance-tiles');
    if (!tiles) return;
    tiles.textContent = '';

    // "PZZ135 — Puget Sound", the way every other zone reference on this page
    // reads. The code alone assumes the reader has the numbers memorised.
    function zone(code, nm) {
      return code ? (nm ? code + ' — ' + nm : code) : '';
    }

    function tile(name, value, unit, sub, note, key) {
      // A quantity this period's forecast does not carry gets no tile. An empty
      // one would read as a measurement of zero, which for visibility in
      // particular is the opposite of what the silence means.
      if (value === null || value === undefined) return;
      var d = document.createElement('div');
      d.className = 'gt' + (key ? ' gt-' + key : '');
      function add(cls, text) {
        if (!text) return;
        var e = document.createElement('div');
        e.className = cls; e.textContent = text; d.appendChild(e);
      }
      add('gt-lab', name);
      var v = document.createElement('div');
      v.className = 'gt-val';
      v.appendChild(document.createTextNode(String(value)));
      if (unit) {
        var u = document.createElement('span');
        u.className = 'gt-unit'; u.textContent = unit; v.appendChild(u);
      }
      d.appendChild(v);
      add('gt-sub', sub);
      add('gt-note', note);
      tiles.appendChild(d);
    }

    tile('Wind', cur.wind_kt, 'kt',
         zone(cur.wind_zone, cur.wind_zone_name)
           + (cur.wind_level ? ' · ' + cur.wind_level : ''),
         cur.outside_wind_kt ? 'coastal and offshore to ' + cur.outside_wind_kt
           + ' kt (' + cur.outside_wind_zone + ')' : '',
         cur.wind_key);
    tile('Gusts', cur.gust_kt, 'kt', zone(cur.gust_zone, cur.gust_zone_name), '', '');
    tile('Seas', cur.seas_ft, 'ft',
         zone(cur.seas_zone, cur.seas_zone_name)
           + (cur.seas_kind ? ' · ' + cur.seas_kind : ''),
         cur.outside_seas_ft ? 'coastal and offshore to ' + cur.outside_seas_ft
           + ' ft (' + cur.outside_seas_zone + ')' : '', '');
    tile('Visibility', cur.vis, '', zone(cur.vis_zone, cur.vis_zone_name), '', '');
    lightningTile(tile, now);
  }

  /* Lightning: the worst any source gives, in any area, over the next 24 hours
   * from when the page is OPENED — the section's own states, not a second
   * judgment. Coloured like the wind tile at the same weight: possible or an
   * NWS thunder mention as small craft, likely as gale, strong or a warning as
   * storm. "Not checked" when no source reached those hours: silence there is
   * not a clear sky. */
  var LTG_VALUE = ['none', 'trace', 'possible', 'likely', 'strong'];
  var LTG_KEY = [null, null, 'sca', 'gale', 'storm'];
  var LTG_SRC = {gridpoint: 'NWS forecast', zone: 'NWS zone forecast', hrrr: 'HRRR',
                 rrfs: 'RRFS', refs: 'REFS'};
  function lightningTile(tile, now) {
    var el = document.querySelector('[data-ltg-glance]');
    var d;
    try { d = el && JSON.parse(el.textContent); } catch (e) { d = null; }
    if (!d || !d.areas) return;
    var alerted = d.areas.filter(function (a) { return a.alert; });
    if (alerted.length) {
      tile('Lightning', 'warning', '', alerted.map(function (a) { return a.label; }).join(', '),
           alerted[0].alert_text || '', 'storm');
      return;
    }
    var t0 = Date.parse(d.t0), best = -1, first = null;
    d.areas.forEach(function (a) {
      a.ranks.forEach(function (r, i) {
        var t = t0 + i * 3600000;
        // The hour in progress counts; hours that have ended do not.
        if (t + 3600000 <= now || t >= now + 24 * 3600000) return;
        if (r > best) best = r;
        if (r >= 2 && (!first || t < first.t)) first = {t: t, area: a.label, src: a.src[i]};
      });
    });
    if (best < 0) { tile('Lightning', 'not checked', '', 'next 24 h', '', ''); return; }
    var sub = 'next 24 h, anywhere in these waters', note = '';
    if (first) {
      // Pacific and 24-hour, as every other time on this page is written.
      var when = new Date(first.t).toLocaleString('en-US', {
        weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
        timeZone: 'America/Los_Angeles'}).replace(',', '');
      sub = first.area + ' · from ' + when;
      note = 'first in the ' + (LTG_SRC[first.src] || first.src) + ' — see Lightning below';
    }
    tile('Lightning', LTG_VALUE[best], '', sub, note, LTG_KEY[best]);
  }

  /* Current / late / stale for a product, judged against ITS reissue cadence
   * or its stated expiry — the badge in the strip at the top of the AFD, zone
   * and High Seas sections, and on each OPC chart.
   *
   * Written by the build, it said "current" all evening about a discussion
   * issued that morning. Same rule and wording as pstate() in
   * src/render/build_page.py; a test runs both on the same cases.
   *
   *   .pstate[data-since][data-cadence]   age against cadence (+6 h margin)
   *   .pstate[data-until]                 expired once past it — expiry wins */
  var LATE_MARGIN_H = 6;
  var PSTATE_TEXT = {current: 'current', late: 'late \u2014 newer issue overdue',
                     stale: 'stale', expired: 'expired', unknown: 'time unknown'};

  function pstate(sinceMs, cadenceH, untilMs, now) {
    if (!isNaN(untilMs)) return now > untilMs ? 'expired' : 'current';
    if (isNaN(sinceMs) || isNaN(cadenceH)) return 'unknown';
    var h = (now - sinceMs) / 3600000;
    if (h <= cadenceH + LATE_MARGIN_H) return 'current';
    if (h <= 2 * cadenceH + LATE_MARGIN_H) return 'late';
    return 'stale';
  }

  function applyCadence(now) {
    document.querySelectorAll('.pstate[data-since]').forEach(function (el) {
      var st = pstate(Date.parse(el.getAttribute('data-since')),
                      parseFloat(el.getAttribute('data-cadence')),
                      Date.parse(el.getAttribute('data-until') || ''), now);
      el.setAttribute('data-state', st);
      el.textContent = PSTATE_TEXT[st];
    });
  }

  /* The lightning timeline, faded where its hours are already behind the
   * reader. Column i is the hour starting t0 + i h; an hour is past once it
   * has ENDED, so the one in progress stays at full strength. */
  function applyLtgPast(now) {
    document.querySelectorAll('table[data-ltg-t0]').forEach(function (t) {
      var t0 = Date.parse(t.getAttribute('data-ltg-t0'));
      if (isNaN(t0)) return;
      t.querySelectorAll('tbody tr').forEach(function (tr) {
        var cells = tr.querySelectorAll('td');
        for (var i = 0; i < cells.length; i++) {
          cells[i].classList.toggle('past', t0 + (i + 1) * 3600000 <= now);
        }
      });
    });
  }

  function paint() {
    var now = Date.now();
    applyAges(now);
    applyCadence(now);
    applyLtgPast(now);
    applyBanners(applyStale(now));
    applyGlance();
  }

  // A seam for testing, and nothing else uses it. The whole point of this file
  // is behaviour that depends on WHEN the page is read, which cannot be checked
  // by reading the source or by waiting a minute for the next tick.
  window.__times = { paint: paint, fmtAge: fmtAge, pstate: pstate, applyLtgPast: applyLtgPast,
                   lightningTile: lightningTile };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint);
  } else {
    paint();
  }
  setInterval(paint, TICK_MS);
})();
