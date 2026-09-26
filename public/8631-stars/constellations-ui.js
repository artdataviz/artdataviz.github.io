/*
 * Constellation picker for the star panorama — plain DOM, krpano lines.
 *
 * Usage, from embedpano's onready (after controlbar.js has mounted):
 *
 *     var bar = mountControlBar(krpano, stage);
 *     mountConstellations(krpano, document.getElementById('con-strip'),
 *                         window.CONSTELLATIONS, stage, bar);
 *
 * The figures come from constellations.js, which build_constellations.py
 * generates. Nothing here knows which constellations exist: adding one is a
 * line in that script and a rebuild (docs/adding-a-constellation.md).
 *
 * Two ways in, always in sync:
 *   - the chip strip above the sky, for the page;
 *   - a badge row inside the sky, just above the control bar, opened by the
 *     wand button. It lives inside the stage, so it works in fullscreen too,
 *     where the chip strip is off-screen.
 *
 * Choosing either turns the sky to the figure and draws its stick figure as
 * krpano polyline hotspots — on the sphere, so the lines stay glued to the
 * stars while you drag, and long segments follow the true great-circle arc.
 * Its IAU-named stars get labels. Choosing the active one again, or Esc,
 * clears it. The selection is mirrored into ?con=ABBR so the address bar is
 * always a shareable link.
 */
(function (global) {
  'use strict';

  var PARAM = 'con';
  var GOLD = 0xE8C98A;

  /*
   * krpano lines take no CSS, so there is no filter to glow with — the halo is
   * geometry: two wide, faint strokes under a thin bright core, drawn in that
   * order. `weight` is relative to the core, so LINE_ALPHA sets the whole
   * figure's opacity in one place.
   */
  var LINE_ALPHA = 0.80;
  var STROKES = [
    { id: 'o', width: 9,   weight: 0.074 },
    { id: 'i', width: 4,   weight: 0.21 },
    { id: 'c', width: 1.2, weight: 1.0 }
  ];

  /*
   * Lines stop short of their stars, so a star sits in a clearing rather than
   * being speared. The gap is a SCREEN measurement but the lines live on the
   * sphere, so it is recomputed from the field of view: see refreshGap.
   */
  var GAP_PX = 4;

  var LABEL_ALPHA = 0.92;
  var FADE_S = 0.6;
  var TURN_S = 1.3;

  /* The figure's radius times this must fit the SHORT side of the stage. */
  var MARGIN = 1.3;
  var FOV_MIN = 30;    /* maxpixelzoom stops the zoom near here anyway */
  var FOV_MAX = 140;   /* tour.xml's fovmax */

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  var LABEL_CSS =
    'color:#e8c98a; font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
    'font-size:11.5px; font-weight:500; letter-spacing:.03em; white-space:nowrap;';

  /* Material Symbols Rounded, same family and grid as controlbar.js. The .svg
     files are in icons/ as the source of truth. */
  var ARROWS = {
    left: 'M526-314 381-459q-5-5-7-10t-2-11q0-6 2-11t7-10l145-145q3-3 6.5-4.5t7.5-1.5q8 0 14 5.5t6 14.5v304q0 9-6 14.5t-14 5.5q-2 0-14-6Z',
    right: 'M420-308q-8 0-14-5.5t-6-14.5v-304q0-9 6-14.5t14-5.5q2 0 14 6l145 145q5 5 7 10t2 11q0 6-2 11t-7 10L434-314q-3 3-6.5 4.5T420-308Z'
  };

  var CSS = [
    /* ---- chip strip above the sky ---- */
    '.con-strip{position:relative;padding:0 0 clamp(10px,1.8vw,14px)}',
    '.con-strip__track{display:flex;overflow-x:auto;overscroll-behavior-x:contain;',
    '  scrollbar-width:none;padding:3px max(12px,var(--edge-l,0px)) 3px max(12px,var(--edge-r,0px));',
    '  -webkit-mask-image:linear-gradient(to right,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%);',
    '  mask-image:linear-gradient(to right,transparent 0,#000 14px,#000 calc(100% - 14px),transparent 100%)}',
    '.con-strip__track::-webkit-scrollbar{display:none}',
    /* margin:auto centres the row while it fits and, unlike justify-content,
       does not make the overflow unreachable once it does not. */
    '.con-strip__row{display:flex;gap:8px;margin:auto}',
    '.con-chip{flex:0 0 auto;-webkit-appearance:none;appearance:none;margin:0;cursor:pointer;',
    '  height:34px;padding:0 15px;border-radius:999px;white-space:nowrap;',
    '  font:600 12.5px/1 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
    '  letter-spacing:.02em;color:var(--ink-dim,#9095a4);',
    '  background:rgba(13,15,22,.6);border:1px solid var(--rule,#1c2030);',
    '  transition:color .2s ease,border-color .2s ease,background .2s ease,box-shadow .25s ease}',
    '.con-chip:hover{color:var(--ink,#d9dbe3);border-color:rgba(232,201,138,.35)}',
    '.con-chip:focus-visible{outline:2px solid var(--accent,#e8c98a);outline-offset:2px}',
    '.con-chip[aria-pressed="true"]{color:var(--accent,#e8c98a);',
    '  border-color:rgba(232,201,138,.55);background:rgba(232,201,138,.09);',
    '  box-shadow:0 0 18px rgba(232,201,138,.2)}',
    '@media (max-width:700px){.con-chip{height:32px;padding:0 13px;font-size:12px}}',
    '@media (orientation:landscape) and (max-height:560px) and (max-width:1024px){',
    '  .con-strip{padding-bottom:8px}.con-chip{height:28px;font-size:11.5px}}',

    /* ---- badge row inside the sky, above the control bar ---- */
    '.con-badges{position:absolute;left:50%;transform:translateX(-50%) translateY(6px);',
    '  z-index:5;display:flex;align-items:center;gap:2px;max-width:calc(100% - 20px);',
    '  padding:4px 4px;border-radius:999px;opacity:0;pointer-events:none;',
    '  background:rgba(13,15,22,.72);border:1px solid var(--rule,#1c2030);',
    '  -webkit-backdrop-filter:blur(12px) saturate(1.3);backdrop-filter:blur(12px) saturate(1.3);',
    '  box-shadow:0 6px 26px rgba(0,0,0,.5);',
    '  transition:opacity .22s ease,transform .22s ease}',
    '.con-badges.is-open{opacity:1;transform:translateX(-50%);pointer-events:auto}',
    '.con-badges__scroll{flex:1 1 auto;display:flex;overflow-x:auto;scrollbar-width:none;',
    '  overscroll-behavior-x:contain;scroll-behavior:smooth}',
    '.con-badges__scroll::-webkit-scrollbar{display:none}',
    '.con-badges__row{display:flex;gap:4px;margin:auto}',
    '.con-badge{flex:0 0 auto;-webkit-appearance:none;appearance:none;margin:0;cursor:pointer;',
    '  height:26px;padding:0 11px;border-radius:999px;white-space:nowrap;border:1px solid transparent;',
    '  font:600 11.5px/1 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
    '  letter-spacing:.02em;color:var(--ink-dim,#9095a4);background:none;',
    '  transition:color .2s ease,background .2s ease,border-color .2s ease}',
    '.con-badge:hover{color:var(--ink,#d9dbe3);background:rgba(255,255,255,.06)}',
    '.con-badge:focus-visible{outline:2px solid var(--accent,#e8c98a);outline-offset:1px}',
    '.con-badge[aria-pressed="true"]{color:var(--accent,#e8c98a);',
    '  border-color:rgba(232,201,138,.5);background:rgba(232,201,138,.1)}',
    '.con-badges__arrow{flex:0 0 auto;-webkit-appearance:none;appearance:none;border:0;',
    '  background:none;margin:0;padding:0;cursor:pointer;width:26px;height:26px;border-radius:50%;',
    '  display:inline-flex;align-items:center;justify-content:center;color:var(--ink-dim,#9095a4)}',
    '.con-badges__arrow:hover{color:var(--accent,#e8c98a);background:rgba(255,255,255,.06)}',
    '.con-badges__arrow[disabled]{opacity:.25;cursor:default}',
    '.con-badges__arrow svg{width:22px;height:22px;fill:currentColor;display:block}',
    '@media (prefers-reduced-motion:reduce){.con-chip,.con-badge,.con-badges{transition:none}',
    '  .con-badges__scroll{scroll-behavior:auto}}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('con-strip-css')) { return; }
    var style = document.createElement('style');
    style.id = 'con-strip-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function reducedMotion() {
    return !!(global.matchMedia &&
              global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function arrowSVG(dir) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 -960 960 960');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ARROWS[dir]);
    svg.appendChild(path);
    return svg;
  }

  /* ---- spherical helpers: krpano (ath, atv) <-> unit vectors ---- */

  function toVec(ath, atv) {
    var a = ath * D2R, lat = -atv * D2R;
    return [Math.cos(lat) * Math.cos(a), Math.cos(lat) * Math.sin(a), Math.sin(lat)];
  }

  function toAthAtv(v) {
    return [Math.atan2(v[1], v[0]) * R2D,
            -Math.asin(Math.max(-1, Math.min(1, v[2]))) * R2D];
  }

  /* ath is periodic: express it near `ref` so a segment never wraps the long
     way round the ±180° seam. */
  function near(ath, ref) {
    return ref + (((ath - ref + 180) % 360) + 360) % 360 - 180;
  }

  function slerp(a, b, t, theta) {
    var s = Math.sin(theta);
    if (s < 1e-9) { return a.slice(); }
    var k0 = Math.sin((1 - t) * theta) / s, k1 = Math.sin(t * theta) / s;
    return [a[0] * k0 + b[0] * k1, a[1] * k0 + b[1] * k1, a[2] * k0 + b[2] * k1];
  }

  /*
   * The stage's size, from the DOM first. krpano's own stagewidth/height are
   * not set yet when a ?con= deep link fires: measured, a deep-linked Orion
   * got fov 43.7 — the 1:1 fallback — instead of ~79, and ran off both edges
   * of the sky. The element is sized by CSS before any of this runs.
   */
  function stageSize(krpano, stage) {
    var w = stage && stage.clientWidth, h = stage && stage.clientHeight;
    if (!(w > 0 && h > 0)) { w = +krpano.get('stagewidth'); h = +krpano.get('stageheight'); }
    if (!(w > 0 && h > 0)) { w = 1; h = 1; }
    return { w: w, h: h };
  }

  /*
   * FOV that frames a figure of angular radius `radius` degrees.
   *
   * tour.xml uses fovtype="MFOV": the view fov spans the LONGER side of the
   * stage. For a rectilinear view the half-angles of the two sides are
   * related by their tangents, so for the figure to fit the shorter side:
   *   tan(long/2) = tan(short/2) * long/short,  with short/2 = radius * MARGIN
   */
  function fitFov(krpano, radius, stage) {
    var size = stageSize(krpano, stage);
    var longSide = Math.max(size.w, size.h), shortSide = Math.min(size.w, size.h);
    var half = Math.min(radius * MARGIN, 85) * D2R;
    var fov = 2 * Math.atan(Math.tan(half) * longSide / shortSide) * R2D;
    return Math.max(FOV_MIN, Math.min(FOV_MAX, fov));
  }

  function mountConstellations(krpano, strip, data, stage, bar) {
    if (!krpano || !strip || !data || !data.length) { return null; }
    injectCSS();

    var active = -1;
    var drawn = [];        /* ids of every hotspot the current figure owns */
    var segments = [];     /* the current figure's segments, as unit vectors */
    var lastGapFov = 0;

    /* ---- chips above the sky ---- */
    var track = document.createElement('div');
    track.className = 'con-strip__track';
    var row = document.createElement('div');
    row.className = 'con-strip__row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Show a constellation');
    track.appendChild(row);
    var chips = data.map(function (fig, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'con-chip';
      b.textContent = fig.name;
      b.title = fig.name + ' (' + fig.abbr + ')';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { toggle(i); });
      row.appendChild(b);
      return b;
    });
    strip.appendChild(track);
    strip.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && active >= 0) { clearFigure(); e.stopPropagation(); }
    });

    /* ---- badges inside the sky ---- */
    var badges = null, badgeScroll = null, badgeButtons = [], wand = null;
    var arrowPrev = null, arrowNext = null;

    if (stage && bar && bar.addButton) {
      badges = document.createElement('div');
      badges.className = 'con-badges';
      badges.setAttribute('aria-hidden', 'true');

      arrowPrev = document.createElement('button');
      arrowPrev.type = 'button';
      arrowPrev.className = 'con-badges__arrow';
      arrowPrev.setAttribute('aria-label', 'Scroll constellations left');
      arrowPrev.appendChild(arrowSVG('left'));

      arrowNext = document.createElement('button');
      arrowNext.type = 'button';
      arrowNext.className = 'con-badges__arrow';
      arrowNext.setAttribute('aria-label', 'Scroll constellations right');
      arrowNext.appendChild(arrowSVG('right'));

      badgeScroll = document.createElement('div');
      badgeScroll.className = 'con-badges__scroll';
      var badgeRow = document.createElement('div');
      badgeRow.className = 'con-badges__row';
      badgeRow.setAttribute('role', 'group');
      badgeRow.setAttribute('aria-label', 'Show a constellation');
      badgeScroll.appendChild(badgeRow);

      badgeButtons = data.map(function (fig, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'con-badge';
        b.textContent = fig.name;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () { toggle(i); });
        badgeRow.appendChild(b);
        return b;
      });

      badges.appendChild(arrowPrev);
      badges.appendChild(badgeScroll);
      badges.appendChild(arrowNext);
      stage.appendChild(badges);

      function scrollBadges(dir) {
        badgeScroll.scrollBy({ left: dir * badgeScroll.clientWidth * 0.7,
                               behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
      arrowPrev.addEventListener('click', function () { scrollBadges(-1); });
      arrowNext.addEventListener('click', function () { scrollBadges(1); });
      badgeScroll.addEventListener('scroll', syncArrows);

      wand = bar.addButton('wand_stars', 'Constellations', function () {
        setBadges(badges.className.indexOf('is-open') < 0);
      });
      wand.setAttribute('aria-pressed', 'false');

      /* The row is as wide as the control bar's pill and sits just above it,
         so the two read as one piece of furniture. Both are measured, because
         the bar's width depends on how many buttons the browser supports. */
      var fitToBar = function () {
        var w = bar.inner ? bar.inner.getBoundingClientRect().width : 0;
        if (w > 0) { badges.style.width = Math.round(w) + 'px'; }
        badges.style.bottom = ((bar.el ? bar.el.offsetHeight : 56) + 8) + 'px';
        syncArrows();
      };
      fitToBar();
      global.addEventListener('resize', fitToBar);
      document.addEventListener('fullscreenchange', fitToBar);
      document.addEventListener('webkitfullscreenchange', fitToBar);
      if (global.ResizeObserver && bar.inner) {
        new global.ResizeObserver(fitToBar).observe(bar.inner);
      }
    }

    function syncArrows() {
      if (!badgeScroll) { return; }
      var max = badgeScroll.scrollWidth - badgeScroll.clientWidth;
      arrowPrev.disabled = badgeScroll.scrollLeft <= 1;
      arrowNext.disabled = badgeScroll.scrollLeft >= max - 1;
    }

    function setBadges(open) {
      if (!badges) { return; }
      badges.className = 'con-badges' + (open ? ' is-open' : '');
      badges.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (wand) { wand.setAttribute('aria-pressed', open ? 'true' : 'false'); }
      if (open) { syncArrows(); scrollActiveIntoView(badgeScroll, badgeButtons); }
    }

    /* ---- hotspots ---- */
    function add(id) {
      krpano.call('addhotspot(' + id + ')');
      var h = 'hotspot[' + id + ']';
      /* keep: survive a scene reload; the rest keeps them out of the way of
         dragging — a line or label must never swallow a pointer event. */
      krpano.set(h + '.keep', true);
      krpano.set(h + '.capture', false);
      krpano.set(h + '.enabled', false);
      krpano.set(h + '.handcursor', false);
      drawn.push(id);
      return h;
    }

    function fadeTo(prop, value, instant) {
      if (instant) { krpano.set(prop, value); }
      else { krpano.call('tween(' + prop + ',' + value + ',' + FADE_S + ')'); }
    }

    /* How many degrees a GAP_PX gap is worth at the current zoom. fov spans
       the longer side of the stage (MFOV), so that is the side to divide by. */
    function gapDegrees() {
      var size = stageSize(krpano, stage);
      var fov = +krpano.get('view.fov') || FOV_MAX;
      return GAP_PX * fov / Math.max(size.w, size.h);
    }

    /* A segment shortened at both ends, or null when it is too short to be
       worth drawing at this zoom. */
    function trimmed(seg, gapDeg) {
      var theta = Math.acos(Math.max(-1, Math.min(1,
        seg.a[0] * seg.b[0] + seg.a[1] * seg.b[1] + seg.a[2] * seg.b[2])));
      var gap = gapDeg * D2R;
      if (theta <= gap * 2.2) { return null; }
      var f = gap / theta;
      var p = toAthAtv(slerp(seg.a, seg.b, f, theta));
      var q = toAthAtv(slerp(seg.a, seg.b, 1 - f, theta));
      q[0] = near(q[0], p[0]);
      return [p, q];
    }

    function figureSegments(fig) {
      var out = [];
      fig.chains.forEach(function (chain) {
        for (var i = 0; i + 1 < chain.length; i++) {
          out.push({ a: toVec(chain[i][0], chain[i][1]),
                     b: toVec(chain[i + 1][0], chain[i + 1][1]) });
        }
      });
      return out;
    }

    function segmentPoints(si, ends) {
      STROKES.forEach(function (s) {
        var h = 'hotspot[con_' + si + s.id + ']';
        if (!ends) { krpano.set(h + '.visible', false); return; }
        krpano.set(h + '.visible', true);
        krpano.set(h + '.point[0].ath', ends[0][0]);
        krpano.set(h + '.point[0].atv', ends[0][1]);
        krpano.set(h + '.point[1].ath', ends[1][0]);
        krpano.set(h + '.point[1].atv', ends[1][1]);
      });
    }

    function drawFigure(fig, instant) {
      segments = figureSegments(fig);
      var gap = gapDegrees();
      lastGapFov = +krpano.get('view.fov') || 0;

      segments.forEach(function (seg, si) {
        var ends = trimmed(seg, gap);
        STROKES.forEach(function (s, z) {
          var h = add('con_' + si + s.id);
          krpano.set(h + '.polyline', true);
          krpano.set(h + '.fillalpha', 0);
          krpano.set(h + '.bordercolor', GOLD);
          krpano.set(h + '.borderwidth', s.width);
          krpano.set(h + '.borderalpha', 0);
          krpano.set(h + '.zorder', z + 1);
          krpano.set(h + '.visible', !!ends);
          if (ends) {
            krpano.set(h + '.point[0].ath', ends[0][0]);
            krpano.set(h + '.point[0].atv', ends[0][1]);
            krpano.set(h + '.point[1].ath', ends[1][0]);
            krpano.set(h + '.point[1].atv', ends[1][1]);
          }
          fadeTo(h + '.borderalpha', s.weight * LINE_ALPHA, instant);
        });
      });

      fig.labels.forEach(function (label, j) {
        var h = add('con_l' + j);
        krpano.set(h + '.type', 'text');
        krpano.set(h + '.html', escapeHtml(label.name));
        krpano.set(h + '.ath', label.ath);
        krpano.set(h + '.atv', label.atv);
        krpano.set(h + '.edge', 'left');     /* text starts just right of the star */
        krpano.set(h + '.ox', 9);
        krpano.set(h + '.bg', false);
        krpano.set(h + '.distorted', false);
        krpano.set(h + '.css', LABEL_CSS);
        krpano.set(h + '.txtshadow', '0 0 3 0x000000 1.0');
        krpano.set(h + '.zorder', STROKES.length + 1);
        krpano.set(h + '.alpha', 0);
        fadeTo(h + '.alpha', LABEL_ALPHA, instant);
      });
    }

    /* The gap is a pixel measurement, so it has to be re-cut whenever the zoom
       changes — a fixed angular gap would grow to a canyon zoomed in and close
       up zoomed out. Only the figure on screen is touched, and only when the
       fov has actually moved a few percent. */
    function refreshGap() {
      if (active < 0 || !segments.length) { return; }
      var fov = +krpano.get('view.fov') || 0;
      if (!fov || Math.abs(fov - lastGapFov) < lastGapFov * 0.04) { return; }
      lastGapFov = fov;
      var gap = gapDegrees();
      segments.forEach(function (seg, si) { segmentPoints(si, trimmed(seg, gap)); });
    }

    var gapQueued = false;
    global.__conRefreshGap = function () {
      if (gapQueued) { return; }
      gapQueued = true;
      global.requestAnimationFrame(function () { gapQueued = false; refreshGap(); });
    };
    krpano.call('set(events[con_gap].keep,true);' +
                'set(events[con_gap].onviewchange,js(__conRefreshGap()));');

    function removeFigure() {
      drawn.forEach(function (id) { krpano.call('removehotspot(' + id + ')'); });
      drawn = [];
      segments = [];
    }

    function turnTo(fig, instant) {
      var fov = fitFov(krpano, fig.radius, stage).toFixed(2);
      var a = fig.center.ath, v = fig.center.atv;
      if (instant) {
        krpano.call('lookat(' + a + ',' + v + ',' + fov + ')');
      } else {
        krpano.call('lookto(' + a + ',' + v + ',' + fov +
                    ',tween(easeInOutQuad,' + TURN_S + '),true,true)');
      }
    }

    /* ---- state ---- */
    function scrollActiveIntoView(scroller, buttons) {
      if (active < 0 || !scroller) { return; }
      var sr = scroller.getBoundingClientRect();
      var br = buttons[active].getBoundingClientRect();
      var left = scroller.scrollLeft + (br.left - sr.left) - (scroller.clientWidth - br.width) / 2;
      scroller.scrollTo({ left: Math.max(0, left),
                          behavior: reducedMotion() ? 'auto' : 'smooth' });
    }

    function syncButtons() {
      [chips, badgeButtons].forEach(function (set) {
        set.forEach(function (b, i) {
          b.setAttribute('aria-pressed', i === active ? 'true' : 'false');
        });
      });
      scrollActiveIntoView(track, chips);
      if (badges && badges.className.indexOf('is-open') >= 0) {
        scrollActiveIntoView(badgeScroll, badgeButtons);
      }
    }

    function syncUrl() {
      if (!global.history || !global.history.replaceState || !global.URL) { return; }
      var url = new URL(global.location.href);
      if (active >= 0) { url.searchParams.set(PARAM, data[active].abbr); }
      else { url.searchParams.delete(PARAM); }
      global.history.replaceState(global.history.state, '', url.toString());
    }

    function selectFigure(i, opts) {
      opts = opts || {};
      var instant = reducedMotion();
      removeFigure();
      active = i;
      drawFigure(data[i], instant);
      if (!opts.keepCamera) { turnTo(data[i], instant); }
      syncButtons();
      syncUrl();
    }

    function clearFigure() {
      removeFigure();
      active = -1;
      syncButtons();
      syncUrl();
    }

    /*
     * The sky is a 90vh box under the header, so on a laptop-height window
     * its lower part starts below the fold, and a figure framed in it is cut
     * off. After a click, scroll just enough to bring the whole box into view
     * — but never so far that the chips themselves go off the top. Clicks
     * only: a deep-linked load keeps the page where the browser put it.
     */
    function revealStage() {
      if (!stage) { return; }
      var over = stage.getBoundingClientRect().bottom - global.innerHeight;
      var room = strip.getBoundingClientRect().top;
      var delta = Math.min(over, Math.max(0, room));
      if (delta > 1) {
        global.scrollBy({ top: delta, behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    }

    function toggle(i) {
      if (i === active) { clearFigure(); } else { selectFigure(i); revealStage(); }
    }

    /* ---- deep link ----
     * Wait for the scene: loading it applies tour.xml's <view>, which would
     * overwrite a turn made any earlier. If startlookat is in the URL too,
     * the viewer asked for that exact direction — draw the figure, leave the
     * camera alone. */
    var params = new URLSearchParams(global.location.search);
    var wanted = (params.get(PARAM) || '').toLowerCase();
    var index = -1;
    data.forEach(function (fig, i) {
      if (fig.abbr.toLowerCase() === wanted) { index = i; }
    });
    if (index >= 0) {
      var tries = 0;
      var timer = global.setInterval(function () {
        if (krpano.get('xml.scene') || ++tries > 100) {
          global.clearInterval(timer);
          selectFigure(index, { keepCamera: params.has('startlookat') });
        }
      }, 100);
    }

    return {
      select: selectFigure,
      clear: clearFigure,
      showBadges: setBadges,
      get active() { return active < 0 ? null : data[active].abbr; }
    };
  }

  global.mountConstellations = mountConstellations;
})(window);
