/*
 * Control bar for the star panorama — plain DOM, no krpano skin.
 *
 * krpano's stock vtourskin is a 68KB XML file that draws its buttons as
 * sprite-sheet crops inside the WebGL canvas. That means it cannot inherit the
 * page's colours, it renders at its own scale, and every tweak is a hunt
 * through XML that a krpano re-tile will overwrite. This replaces it with nine
 * real <button> elements sitting above the canvas: styled by CSS, coloured by
 * the page's own custom properties, reachable by keyboard and screen readers.
 *
 * Usage, from embedpano's onready:
 *
 *     mountControlBar(krpano, document.getElementById('stage'));
 *
 * The bar mounts into `stage`, NOT into krpano's own container. Two reasons:
 * events on the bar can never reach krpano's drag handler (siblings don't
 * bubble into each other), and fullscreen can take the sky and the buttons
 * together — krpano's own fullscreen would leave the bar behind.
 */
(function (global) {
  'use strict';

  /*
   * Material Symbols Rounded, downloaded from fonts.google.com and inlined.
   * The .svg files they came from are kept in icons/ as the source of truth.
   *
   * Inlined rather than <img src>, because an <img> cannot be recoloured by
   * CSS — the hover state needs fill:currentColor to pick up the page's gold.
   *
   * One family throughout: the four directions are arrow_back / _forward /
   * _upward / _downward, the zoom pair is add / remove, and they sit at the
   * same stroke weight as the fullscreen brackets and the headset.
   *
   * The zoom pair is add + remove rather than add_2 + its counterpart, because
   * Material Symbols has no remove_2 — add_2 is drawn noticeably larger than
   * plain remove, so pairing them puts a big plus next to a small minus.
   *
   * All nine share viewBox="0 -960 960 960" — Material Symbols' baseline-origin
   * grid, which is why the y values are negative.
   */
  var ICONS = {
    arrow_back: 'm313-440 196 196q12 12 11.5 28T508-188q-12 11-28 11.5T452-188L188-452q-6-6-8.5-13t-2.5-15q0-8 2.5-15t8.5-13l264-264q11-11 27.5-11t28.5 11q12 12 12 28.5T508-715L313-520h447q17 0 28.5 11.5T800-480q0 17-11.5 28.5T760-440H313Z',
    arrow_forward: 'M647-440H200q-17 0-28.5-11.5T160-480q0-17 11.5-28.5T200-520h447L451-716q-12-12-11.5-28t12.5-28q12-11 28-11.5t28 11.5l264 264q6 6 8.5 13t2.5 15q0 8-2.5 15t-8.5 13L508-188q-11 11-27.5 11T452-188q-12-12-12-28.5t12-28.5l195-195Z',
    arrow_upward: 'M440-647 244-451q-12 12-28 11.5T188-452q-11-12-11.5-28t11.5-28l264-264q6-6 13-8.5t15-2.5q8 0 15 2.5t13 8.5l264 264q11 11 11 27.5T772-452q-12 12-28.5 12T715-452L520-647v447q0 17-11.5 28.5T480-160q-17 0-28.5-11.5T440-200v-447Z',
    arrow_downward: 'M440-313v-447q0-17 11.5-28.5T480-800q17 0 28.5 11.5T520-760v447l196-196q12-12 28-11.5t28 12.5q11 12 11.5 28T772-452L508-188q-6 6-13 8.5t-15 2.5q-8 0-15-2.5t-13-8.5L188-452q-11-11-11-27.5t11-28.5q12-12 28.5-12t28.5 12l195 195Z',
    add: 'M440-440H240q-17 0-28.5-11.5T200-480q0-17 11.5-28.5T240-520h200v-200q0-17 11.5-28.5T480-760q17 0 28.5 11.5T520-720v200h200q17 0 28.5 11.5T760-480q0 17-11.5 28.5T720-440H520v200q0 17-11.5 28.5T480-200q-17 0-28.5-11.5T440-240v-200Z',
    remove: 'M240-440q-17 0-28.5-11.5T200-480q0-17 11.5-28.5T240-520h480q17 0 28.5 11.5T760-480q0 17-11.5 28.5T720-440H240Z',
    fullscreen: 'M200-200h80q17 0 28.5 11.5T320-160q0 17-11.5 28.5T280-120H160q-17 0-28.5-11.5T120-160v-120q0-17 11.5-28.5T160-320q17 0 28.5 11.5T200-280v80Zm560 0v-80q0-17 11.5-28.5T800-320q17 0 28.5 11.5T840-280v120q0 17-11.5 28.5T800-120H680q-17 0-28.5-11.5T640-160q0-17 11.5-28.5T680-200h80ZM200-760v80q0 17-11.5 28.5T160-640q-17 0-28.5-11.5T120-680v-120q0-17 11.5-28.5T160-840h120q17 0 28.5 11.5T320-800q0 17-11.5 28.5T280-760h-80Zm560 0h-80q-17 0-28.5-11.5T640-800q0-17 11.5-28.5T680-840h120q17 0 28.5 11.5T840-800v120q0 17-11.5 28.5T800-640q-17 0-28.5-11.5T760-680v-80Z',
    fullscreen_exit: 'M240-240h-80q-17 0-28.5-11.5T120-280q0-17 11.5-28.5T160-320h120q17 0 28.5 11.5T320-280v120q0 17-11.5 28.5T280-120q-17 0-28.5-11.5T240-160v-80Zm480 0v80q0 17-11.5 28.5T680-120q-17 0-28.5-11.5T640-160v-120q0-17 11.5-28.5T680-320h120q17 0 28.5 11.5T840-280q0 17-11.5 28.5T800-240h-80ZM240-720v-80q0-17 11.5-28.5T280-840q17 0 28.5 11.5T320-800v120q0 17-11.5 28.5T280-640H160q-17 0-28.5-11.5T120-680q0-17 11.5-28.5T160-720h80Zm480 0h80q17 0 28.5 11.5T840-680q0 17-11.5 28.5T800-640H680q-17 0-28.5-11.5T640-680v-120q0-17 11.5-28.5T680-840q17 0 28.5 11.5T720-800v80Z',
    head_mounted_device: 'M300-240q-66 0-113-47t-47-113v-163q0-51 32-89.5t82-47.5q57-11 113-15.5t113-4.5q57 0 113.5 4.5T706-700q50 10 82 48t32 89v163q0 66-47 113t-113 47h-40q-13 0-26-1.5t-25-6.5l-64-22q-12-5-25-5t-25 5l-64 22q-12 5-25 6.5t-26 1.5h-40Zm0-80h40q7 0 13.5-1t12.5-3q29-9 56.5-19t57.5-10q30 0 58 9.5t56 19.5q6 2 12.5 3t13.5 1h40q33 0 56.5-23.5T740-400v-163q0-22-14-38t-35-21q-52-11-104.5-14.5T480-640q-54 0-106 4t-105 14q-21 4-35 20.5T220-563v163q0 33 23.5 56.5T300-320ZM70-400q-13 0-21.5-8.5T40-430v-100q0-13 8.5-21.5T70-560q13 0 21.5 8.5T100-530v100q0 13-8.5 21.5T70-400Zm820 0q-13 0-21.5-8.5T860-430v-100q0-13 8.5-21.5T890-560q13 0 21.5 8.5T920-530v100q0 13-8.5 21.5T890-400Zm-410-80Z'
  };

  /*
   * Colours come from the host page's custom properties, with the current
   * values as fallbacks so the bar still looks right if it is ever dropped into
   * a page that doesn't define them.
   */
  var CSS = [
    '.pano-bar{position:absolute;left:0;right:0;bottom:0;z-index:5;',
    '  display:flex;justify-content:center;',
    '  padding:0 10px calc(12px + env(safe-area-inset-bottom,0px));',
    /* The strip is only a positioning frame — clicks must fall through it to
       the sky, or the bottom of the panorama would become undraggable. Only
       the buttons themselves take pointer events back. */
    '  pointer-events:none}',
    '.pano-bar__inner{display:flex;align-items:center;gap:1px;max-width:100%;',
    '  padding:5px 8px;border-radius:999px;pointer-events:auto;',
    '  background:rgba(13,15,22,.72);border:1px solid var(--rule,#1c2030);',
    '  -webkit-backdrop-filter:blur(12px) saturate(1.3);',
    '  backdrop-filter:blur(12px) saturate(1.3);',
    '  box-shadow:0 6px 26px rgba(0,0,0,.5)}',
    '.pano-bar__sep{flex:0 0 1px;align-self:stretch;margin:5px 6px;',
    '  background:var(--rule,#1c2030)}',
    '.pano-bar button{-webkit-appearance:none;appearance:none;border:0;',
    '  background:none;margin:0;padding:0;cursor:pointer;',
    '  width:36px;height:36px;border-radius:50%;',
    '  display:inline-flex;align-items:center;justify-content:center;',
    '  color:var(--ink-dim,#9095a4);',
    /* touch-action:none is what lets a press-and-hold pan on a phone: without
       it the browser claims the gesture as a scroll and never delivers the
       pointermove/pointerup pair. */
    '  touch-action:none;-webkit-user-select:none;user-select:none;',
    '  -webkit-tap-highlight-color:transparent;',
    '  transition:color .2s ease,transform .12s ease}',
    /* Hover lights the glyph itself rather than filling a disc behind it. The
       glow is on the svg, not the button, so drop-shadow traces the arrow's
       own outline instead of boxing it — the same lit-from-within look the
       page's badge has. Two shadows: a tight core and a wider halo. */
    '.pano-bar button:hover{color:var(--accent,#e8c98a)}',
    '.pano-bar button[data-active="1"],.pano-bar button:active{',
    '  color:var(--accent,#e8c98a);transform:scale(.92)}',
    '.pano-bar button svg{transition:filter .2s ease}',
    '.pano-bar button:hover svg,.pano-bar button:focus-visible svg{',
    '  filter:drop-shadow(0 0 4px rgba(232,201,138,.8))',
    '         drop-shadow(0 0 11px rgba(232,201,138,.45))}',
    '.pano-bar button[data-active="1"] svg,.pano-bar button:active svg{',
    '  filter:drop-shadow(0 0 5px rgba(232,201,138,.95))',
    '         drop-shadow(0 0 16px rgba(232,201,138,.6))}',
    /* The focus ring stays a real outline - a glow alone is not a reliable
       focus indicator, and it is the only cue a keyboard user gets. */
    '.pano-bar button:focus-visible{outline:2px solid var(--accent,#e8c98a);',
    '  outline-offset:2px}',
    '.pano-bar svg{width:21px;height:21px;fill:currentColor;display:block;',
    /* The SVG must never be the event target, or a pointerdown that starts on
       the glyph and ends on the button rim looks like a lost press. */
    '  pointer-events:none}',
    /* Fullscreen strips the framing the article gives the stage: a rounded,
       bordered black box makes sense inline, not edge to edge on a monitor.
       :fullscreen and :-webkit-full-screen have to be separate rules — a
       browser that fails to parse either selector drops the whole rule.
       !important because the host styles its stage through an id selector
       (#stage), which outranks any class this file could use. Without it the
       border survives as a hairline around the screen, and on a phone the
       12px corner radius rounds off the corners of the display. */
    '.pano-stage:fullscreen{border-radius:0!important;border:0!important}',
    '.pano-stage:-webkit-full-screen{border-radius:0!important;border:0!important}',
    /* Same breakpoints the page already uses for phones in both orientations. */
    '@media (max-width:700px),(orientation:landscape) and (max-height:560px) and (max-width:1024px){',
    '  .pano-bar{padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}',
    '  .pano-bar__inner{padding:4px 6px}',
    '  .pano-bar button{width:32px;height:32px}',
    '  .pano-bar svg{width:19px;height:19px}',
    '  .pano-bar__sep{margin:5px 3px}}',
    '@media (prefers-reduced-motion:reduce){',
    '  .pano-bar button,.pano-bar button svg{transition:none}',
    '  .pano-bar button[data-active="1"],.pano-bar button:active{transform:none}}'
  ].join('\n');

  function injectCSS() {
    if (document.getElementById('pano-bar-css')) { return; }
    var style = document.createElement('style');
    style.id = 'pano-bar-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function iconSVG(name) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 -960 960 960');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  function makeButton(icon, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.title = label;
    b.appendChild(iconSVG(icon));
    return b;
  }

  function mountControlBar(krpano, stage) {
    if (!krpano || !stage) { return null; }
    injectCSS();
    stage.classList.add('pano-stage');

    var bar = document.createElement('div');
    bar.className = 'pano-bar';
    var inner = document.createElement('div');
    inner.className = 'pano-bar__inner';
    /* "group", not "toolbar": the toolbar role tells a screen reader that the
       arrow keys move between the buttons, which would need a roving tabindex
       to be true. Here every button is its own tab stop, and the arrow keys
       fall through to krpano and pan the sky — which is more useful. */
    inner.setAttribute('role', 'group');
    inner.setAttribute('aria-label', 'Panorama controls');
    bar.appendChild(inner);

    function separator() {
      var s = document.createElement('span');
      s.className = 'pano-bar__sep';
      inner.appendChild(s);
    }

    /* Every held button's release function, so one window blur can let go of
       all of them at once. A force left at ±1 spins the sky forever. */
    var releasers = [];

    /*
     * Press-and-hold rather than click-to-step.
     *
     * hlookat_moveforce / vlookat_moveforce / fov_moveforce are krpano's own
     * control inputs — the same three the stock skin drives from its arrow
     * buttons drove. Feeding them keeps krpano's easing
     * and momentum instead of a hand-rolled approximation of it; the movement
     * is identical to holding an arrow key.
     */
    function bindHold(button, variable, force) {
      var held = false;

      function press() {
        if (held) { return; }
        held = true;
        button.setAttribute('data-active', '1');
        krpano.set(variable, force);
      }

      function release() {
        if (!held) { return; }
        held = false;
        button.removeAttribute('data-active');
        krpano.set(variable, 0);
      }

      /* Pointer capture is what makes dragging off the button safe: the
         pointerup is still delivered here rather than to whatever is now under
         the cursor, so the force always gets cleared. */
      button.addEventListener('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) { return; }
        if (button.setPointerCapture) {
          try { button.setPointerCapture(e.pointerId); } catch (err) { /* older Safari */ }
        }
        press();
      });
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);

      /* Keyboard has to hold too, or the buttons are decorative for anyone not
         using a mouse. Auto-repeat keydowns are ignored — press() is already
         idempotent, but the guard keeps the intent obvious. */
      button.addEventListener('keydown', function (e) {
        if (e.repeat) { return; }
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar') {
          e.preventDefault();
          press();
        }
      });
      button.addEventListener('keyup', function (e) {
        if (e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar') {
          e.preventDefault();
          release();
        }
      });
      button.addEventListener('blur', release);

      releasers.push(release);
      inner.appendChild(button);
      return button;
    }

    function releaseAll() {
      for (var i = 0; i < releasers.length; i++) { releasers[i](); }
    }

    /* Alt-tabbing away mid-press never delivers the pointerup, which would
       leave the sky rotating on its own when the tab comes back. */
    global.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { releaseAll(); }
    });

    /*
     * Half force, so the buttons move at half the speed krpano's arrow keys do.
     * These forces feed an accelerate-and-decay model, and terminal speed is
     * proportional to the force, so 0.5 is a clean halving. Doing it here
     * rather than through control.keybspeed keeps the physical arrow keys at
     * their normal speed — only the buttons are slowed.
     */
    var SPEED = 0.5;

    bindHold(makeButton('arrow_back', 'Look left'), 'hlookat_moveforce', -SPEED);
    bindHold(makeButton('arrow_forward', 'Look right'), 'hlookat_moveforce', +SPEED);
    bindHold(makeButton('arrow_upward', 'Look up'), 'vlookat_moveforce', -SPEED);
    bindHold(makeButton('arrow_downward', 'Look down'), 'vlookat_moveforce', +SPEED);

    separator();

    bindHold(makeButton('add', 'Zoom in'), 'fov_moveforce', -SPEED);
    bindHold(makeButton('remove', 'Zoom out'), 'fov_moveforce', +SPEED);

    separator();

    /*
     * Fullscreen targets the stage, not krpano.
     *
     * krpano's own `set(fullscreen,true)` promotes its container — which holds
     * the canvas and nothing else, so the bar would vanish the moment you used
     * it. Fullscreening the stage takes the sky and the buttons together.
     */
    function fullscreenElement() {
      return document.fullscreenElement || document.webkitFullscreenElement || null;
    }

    var canFullscreen = !!(
      (document.fullscreenEnabled && stage.requestFullscreen) ||
      (document.webkitFullscreenEnabled && stage.webkitRequestFullscreen)
    );

    if (canFullscreen) {
      var fsButton = makeButton('fullscreen', 'Enter fullscreen');
      fsButton.addEventListener('click', function () {
        if (fullscreenElement()) {
          var exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) { Promise.resolve(exit.call(document)).catch(function () {}); }
        } else {
          var enter = stage.requestFullscreen || stage.webkitRequestFullscreen;
          if (enter) { Promise.resolve(enter.call(stage)).catch(function () {}); }
        }
      });
      inner.appendChild(fsButton);

      /* Driven by the event, not by the click, so pressing Esc or F11 leaves
         the icon telling the truth. */
      var syncFullscreen = function () {
        var on = fullscreenElement() === stage;
        var label = on ? 'Exit fullscreen' : 'Enter fullscreen';
        fsButton.replaceChild(iconSVG(on ? 'fullscreen_exit' : 'fullscreen'), fsButton.firstChild);
        fsButton.setAttribute('aria-label', label);
        fsButton.title = label;
      };
      document.addEventListener('fullscreenchange', syncFullscreen);
      document.addEventListener('webkitfullscreenchange', syncFullscreen);
      syncFullscreen();
    }

    /*
     * VR stays visible everywhere. On a machine with no headset krpano falls
     * back to its own split-screen cardboard mode, which is a real answer on a
     * phone; hiding the button would just make the feature undiscoverable on
     * the devices that can actually use it.
     */
    var vrButton = makeButton('head_mounted_device', 'View in VR');
    vrButton.addEventListener('click', function () {
      if (krpano.get('webvr')) {
        krpano.call('webvr.enterVR()');
      } else {
        krpano.trace(2, 'controlbar: webvr plugin not loaded — is plugins/webvr.xml included?');
      }
    });
    inner.appendChild(vrButton);

    stage.appendChild(bar);
    return bar;
  }

  global.mountControlBar = mountControlBar;
})(window);
