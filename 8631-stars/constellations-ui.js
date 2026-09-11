/*
 * Constellation picker for the star panorama — plain DOM chips, krpano lines.
 *
 * Usage, from embedpano's onready (after controlbar.js has mounted):
 *
 *     mountConstellations(krpano, document.getElementById('con-strip'),
 *                         window.CONSTELLATIONS, document.getElementById('stage'));
 *
 * `stage` is the box the sky is drawn in. It sizes the camera's field of view
 * and lets a chip click scroll the whole sky into view.
 *
 * The figures come from constellations.js, which build_constellations.py
 * generates. Nothing here knows which constellations exist: adding one is a
 * line in that script and a rebuild (docs/adding-a-constellation.md).
 *
 * Choosing a chip turns the sky to the figure and draws its stick figure as
 * krpano polyline hotspots — on the sphere, so the lines stay glued to the
 * stars while you drag, and long segments follow the true great-circle arc.
 * Its IAU-named stars get labels. Choosing the active chip again, or Esc in
 * the strip, clears it. The selection is mirrored into ?con=ABBR so the
 * address bar is always a shareable link.
 */
(function (global) {
  'use strict';

  var PARAM = 'con';
  var GOLD = 0xE8C98A;

  /*
   * krpano lines take no CSS, so there is no filter to glow with — the halo is
   * geometry: two wide, faint strokes under a thin bright core, drawn in that
   * order. These are the values from the in-browser probe that settled the
   * look ("thinner, with glow").
   */
  var STROKES = [
    { id: 'o', width: 9,   alpha: 0.07 },
    { id: 'i', width: 4,   alpha: 0.20 },
    { id: 'c', width: 1.2, alpha: 0.95 }
  ];
  var LABEL_ALPHA = 0.92;
  var FADE_S = 0.6;
  var TURN_S = 1.3;

  /* The figure's radius times this must fit the SHORT side of the stage. */
  var MARGIN = 1.3;
  var FOV_MIN = 30;    /* maxpixelzoom stops the zoom near here anyway */
  var FOV_MAX = 140;   /* tour.xml's fovmax */

  var LABEL_CSS =
    'color:#e8c98a; font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;' +
    'font-size:11.5px; font-weight:500; letter-spacing:.03em; white-space:nowrap;';

  var CSS = [
    '.con-strip{position:relative;padding:0 0 clamp(10px,1.8vw,14px)}',
    /* Full-bleed track whose first chip lines up with the header text above:
       .page-head is a 44rem column padded by --edge-l. */
    '.con-strip__track{display:flex;gap:8px;overflow-x:auto;',
    '  overscroll-behavior-x:contain;scrollbar-width:none;',
    '  padding:3px var(--edge-r,16px) 3px',
    '    max(16px,var(--edge-l,0px),calc((100% - 44rem)/2 + var(--edge-l,0px)));',
    '  -webkit-mask-image:linear-gradient(to right,transparent 0,#000 12px,#000 calc(100% - 32px),transparent 100%);',
    '  mask-image:linear-gradient(to right,transparent 0,#000 12px,#000 calc(100% - 32px),transparent 100%)}',
    '.con-strip__track::-webkit-scrollbar{display:none}',
    '.con-chip{flex:0 0 auto;-webkit-appearance:none;appearance:none;margin:0;cursor:pointer;',
    '  height:34px;padding:0 15px;border-radius:999px;white-space:nowrap;',
    '  font:600 12.5px/1 ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
    '  letter-spacing:.02em;color:var(--ink-dim,#9095a4);',
    '  background:rgba(13,15,22,.6);border:1px solid var(--rule,#1c2030);',
    '  transition:color .2s ease,border-color .2s ease,background .2s ease,box-shadow .25s ease}',
    '.con-chip:hover{color:var(--ink,#d9dbe3);border-color:rgba(232,201,138,.35)}',
    '.con-chip:focus-visible{outline:2px solid var(--accent,#e8c98a);outline-offset:2px}',
    /* Selected: the same gold and glow as the page's "Read how it was made" badge. */
    '.con-chip[aria-pressed="true"]{color:var(--accent,#e8c98a);',
    '  border-color:rgba(232,201,138,.55);background:rgba(232,201,138,.09);',
    '  box-shadow:0 0 18px rgba(232,201,138,.2)}',
    '@media (max-width:700px){.con-chip{height:32px;padding:0 13px;font-size:12px}}',
    '@media (orientation:landscape) and (max-height:560px) and (max-width:1024px){',
    '  .con-strip{padding-bottom:8px}.con-chip{height:28px;font-size:11.5px}}',
    '@media (prefers-reduced-motion:reduce){.con-chip{transition:none}}'
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

  /*
   * FOV that frames a figure of angular radius `radius` degrees.
   *
   * tour.xml uses fovtype="MFOV": the view fov spans the LONGER side of the
   * stage. For a rectilinear view the half-angles of the two sides are
   * related by their tangents, so for the figure to fit the shorter side:
   *   tan(long/2) = tan(short/2) * long/short,  with short/2 = radius * MARGIN
   */
  /*
   * The stage's size, from the DOM first. krpano's own stagewidth/height are
   * not set yet when a ?con= deep link fires: measured, a deep-linked Orion
   * got fov 43.7 - the 1:1 fallback - instead of ~79, and ran off both edges
   * of the sky. The element is sized by CSS before any of this runs.
   */
  function stageSize(krpano, stage) {
    var w = stage && stage.clientWidth, h = stage && stage.clientHeight;
    if (!(w > 0 && h > 0)) { w = +krpano.get('stagewidth'); h = +krpano.get('stageheight'); }
    if (!(w > 0 && h > 0)) { w = 1; h = 1; }
    return { w: w, h: h };
  }

  function fitFov(krpano, radius, stage) {
    var size = stageSize(krpano, stage);
    var longSide = Math.max(size.w, size.h), shortSide = Math.min(size.w, size.h);
    var half = Math.min(radius * MARGIN, 85) * Math.PI / 180;
    var fov = 2 * Math.atan(Math.tan(half) * longSide / shortSide) * 180 / Math.PI;
    return Math.max(FOV_MIN, Math.min(FOV_MAX, fov));
  }

  function mountConstellations(krpano, strip, data, stage) {
    if (!krpano || !strip || !data || !data.length) { return null; }
    injectCSS();

    var active = -1;
    var drawn = [];   /* ids of every hotspot the current figure owns */

    /* ---- chips ---- */
    var track = document.createElement('div');
    track.className = 'con-strip__track';
    track.setAttribute('role', 'group');
    track.setAttribute('aria-label', 'Show a constellation');
    var chips = data.map(function (fig, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'con-chip';
      b.textContent = fig.name;
      b.title = fig.name + ' (' + fig.abbr + ')';
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { toggle(i); });
      track.appendChild(b);
      return b;
    });
    strip.appendChild(track);
    strip.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && active >= 0) { clearFigure(); e.stopPropagation(); }
    });

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

    function drawFigure(fig, instant) {
      fig.chains.forEach(function (chain, c) {
        STROKES.forEach(function (s, z) {
          var h = add('con_' + c + s.id);
          krpano.set(h + '.polyline', true);
          krpano.set(h + '.fillalpha', 0);
          krpano.set(h + '.bordercolor', GOLD);
          krpano.set(h + '.borderwidth', s.width);
          krpano.set(h + '.borderalpha', 0);
          krpano.set(h + '.zorder', z + 1);
          chain.forEach(function (p, n) {
            krpano.set(h + '.point[' + n + '].ath', p[0]);
            krpano.set(h + '.point[' + n + '].atv', p[1]);
          });
          fadeTo(h + '.borderalpha', s.alpha, instant);
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

    function removeFigure() {
      drawn.forEach(function (id) { krpano.call('removehotspot(' + id + ')'); });
      drawn = [];
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
    function syncChips() {
      chips.forEach(function (b, i) {
        b.setAttribute('aria-pressed', i === active ? 'true' : 'false');
      });
      if (active >= 0) {
        /* Scroll only the track, never the page — scrollIntoView would drag
           the whole document along on a deep-linked load. */
        var tr = track.getBoundingClientRect();
        var cr = chips[active].getBoundingClientRect();
        var left = track.scrollLeft + (cr.left - tr.left) - (track.clientWidth - cr.width) / 2;
        track.scrollTo({ left: Math.max(0, left),
                         behavior: reducedMotion() ? 'auto' : 'smooth' });
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
      syncChips();
      syncUrl();
    }

    function clearFigure() {
      removeFigure();
      active = -1;
      syncChips();
      syncUrl();
    }

    /*
     * The sky is a 90vh box under the header, so on a laptop-height window
     * its lower part starts below the fold, and a figure framed in it is cut
     * off. After a click, scroll just enough to bring the whole box into view
     * - but never so far that the chips themselves go off the top. Clicks
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

    return { select: selectFigure, clear: clearFigure,
             get active() { return active < 0 ? null : data[active].abbr; } };
  }

  global.mountConstellations = mountConstellations;
})(window);
