// The quilled globe in a canvas. Runtime v0: the baked globe only, levels 0-1.
//
//   const globe = await createGlobe({ canvas, dataUrl });
//   globe.flyTo(lon, lat, degreesAcross);
//   globe.setSun(0.35);          // 0 = studio only, 1 = full warm sun
//   globe.pick(x, y);            // -> { lon, lat } | null  (canvas CSS pixels)
//   globe.dispose();
//
// The spec's API (docs/superpowers/specs/2026-09-17-globe-runtime-design.md);
// pick returns no country yet, because countries live in the geometry tiles v1 adds.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BakedGlobe } from "./baked.js";
import * as geo from "./geo.js";

const R = 500;                  // constants.GLOBE_RADIUS_MM: a 1 m globe, in mm
const FOV = 40;                 // vertical, degrees
const MIN_DEG = 12;             // closest zoom: a level-1 texel is 2-4 device px here
const MAX_DEG = 150;
const WHOLE = 180;              // degrees at or past this frame the whole globe
const SUN_ENERGY = 3.0;
// Textures are chosen as if the screen had at most this pixel ratio, though the
// canvas draws at the full one. At 2, the spec's 1.2-device-pixel rule asked a
// retina desktop for 61 tiles (22.1 MB) at first view; at 1.5 it is 29 (10.5 MB).
const TEXTURE_DPR = 1.5;

// The Blender globe view's rig (blender/scene_globe.py), camera-relative so
// turning the globe never darkens the data: energy x tint, from n (towards
// the camera), e (screen right) and u (screen up).
const RIG = {
  key:   { energy: 4.5, tint: [1.0, 0.93, 0.84], from: [0.35, -0.85, 0.40] },
  front: { energy: 1.6, tint: [1.0, 0.97, 0.92], from: [1, 0, 0] },
  rim:   { energy: 1.4, tint: [0.85, 0.90, 1.0], from: [-0.6, 0.8, 0] },
};
const ROOM = [0.30 * 0.6, 0.26 * 0.6, 0.22 * 0.6];   // world background x strength
const SUN_TINT = [1.0, 0.76, 0.54];                  // about 5200 K, linear
const SUN_FROM = geo.lonLatToVec(-30, 23.4);         // world-fixed

const col = ([r, g, b], k = 1) => new THREE.Color(r * k, g * k, b * k);

export async function createGlobe({ canvas, dataUrl = ".", libUrl = "./lib/three/",
                                    start = [12, 26, WHOLE], onFrame, onZoomHint } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true,
                                             powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.AgXToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);
  const half = (FOV / 2) * (Math.PI / 180);

  const lights = {
    keyDir: { value: new THREE.Vector3() }, frontDir: { value: new THREE.Vector3() },
    rimDir: { value: new THREE.Vector3() }, sunDir: { value: new THREE.Vector3(...SUN_FROM) },
    keyCol: { value: col(RIG.key.tint, RIG.key.energy) },
    frontCol: { value: col(RIG.front.tint, RIG.front.energy) },
    rimCol: { value: col(RIG.rim.tint, RIG.rim.energy) },
    sunCol: { value: col(SUN_TINT, SUN_ENERGY * 0.35) },
    ambient: { value: col(ROOM) },
  };

  // Drawn on demand: when the camera moves, a tile lands, the sun or the size
  // changes. A still globe costs no GPU, which a phone's battery notices.
  let dirty = true;
  const redraw = () => { dirty = true; };
  const baked = await new BakedGlobe({ renderer, dataUrl, libUrl, radius: R, lights,
                                       onLoad: redraw }).init();
  scene.add(baked.group);

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.zoomSpeed = 0.8;

  // Cooperative zoom: on a page that scrolls, the wheel scrolls the page until
  // the reader has clicked the globe, or holds ctrl/cmd - which is also what a
  // trackpad pinch sends. The capture listener runs before OrbitControls' own.
  let engaged = false;
  const host = canvas.parentElement || canvas;
  const onWheel = (ev) => {
    controls.enableZoom = engaged || ev.ctrlKey || ev.metaKey;
    if (!controls.enableZoom) onZoomHint?.();
  };
  const onDown = () => { engaged = true; };
  const onLeave = () => { engaged = false; };
  host.addEventListener("wheel", onWheel, { capture: true, passive: true });
  canvas.addEventListener("pointerdown", onDown);
  host.addEventListener("pointerleave", onLeave);

  // The whole globe fits the shorter side with a margin; anything less is a
  // span across it, clamped to the zoom range.
  const distanceFor = (deg) => (deg >= WHOLE ? R / Math.sin(halfMin() * 0.86)
    : geo.distanceForDegrees(Math.min(MAX_DEG, Math.max(MIN_DEG, deg)), R, halfMin()));

  const place = (lon, lat, deg) => {
    const d = distanceFor(deg);
    camera.position.set(...geo.lonLatToVec(lon, lat, d));
    camera.lookAt(0, 0, 0);
  };

  // Degrees across refer to the shorter side of the canvas, so a phone in
  // portrait sees the same span across its width that a desktop sees top to bottom.
  const halfMin = () => (camera.aspect >= 1 ? half : Math.atan(Math.tan(half) * camera.aspect));

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
    controls.minDistance = geo.distanceForDegrees(MIN_DEG, R, halfMin());
    controls.maxDistance = 1.15 * distanceFor(WHOLE);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  place(...start);

  let flight = null;
  const e = new THREE.Vector3(), u = new THREE.Vector3(), n = new THREE.Vector3();
  const aim = (dir, [a, b, c]) => dir.copy(n).multiplyScalar(a).addScaledVector(e, b)
                                     .addScaledVector(u, c).normalize();
  let raf = 0;
  // Off screen - the reader has scrolled to the article - the loop idles.
  let onScreen = true;
  const seen = new IntersectionObserver(([entry]) => { onScreen = entry.isIntersecting; redraw(); });
  seen.observe(canvas);
  const tick = (now) => {
    raf = requestAnimationFrame(tick);
    if (!onScreen) return;
    const moved = flight ? (flight(now), true) : controls.update();
    if (!moved && !dirty) return;
    dirty = false;
    const d = camera.position.length();
    // Near the paper, a drag should move the ground, not whip the planet round.
    controls.rotateSpeed = Math.min(1, Math.max(0.03, (d - R) / (1.5 * R)));
    camera.near = Math.max(0.5, (d - R) * 0.5);
    camera.far = d + R;
    camera.updateProjectionMatrix();

    n.copy(camera.position).normalize();
    e.setFromMatrixColumn(camera.matrixWorld, 0);
    u.setFromMatrixColumn(camera.matrixWorld, 1);
    aim(lights.keyDir.value, RIG.key.from);
    aim(lights.frontDir.value, RIG.front.from);
    aim(lights.rimDir.value, RIG.rim.from);

    const hDev = canvas.clientHeight * Math.min(window.devicePixelRatio || 1, TEXTURE_DPR);
    const halfDiag = Math.atan(Math.tan(half) * Math.hypot(1, camera.aspect));
    baked.update({
      camPos: camera.position.toArray(), sub: geo.vecToLonLat(camera.position.toArray()),
      radius: R, capDeg: geo.visibleCapDeg(d, R, halfDiag), focalPx: hDev / 2 / Math.tan(half),
    });
    renderer.render(scene, camera);
    onFrame?.({ wanted: baked.wanted, ready: baked.ready, bytes: baked.fetchedBytes,
                degrees: geo.degreesAcross(d, R, halfMin()) });
  };
  raf = requestAnimationFrame(tick);

  function flyTo(lon, lat, degreesAcross, ms = 1400) {
    const from = camera.position.clone();
    const fromAlt = from.length() - R;
    const toDist = distanceFor(degreesAcross);
    const to = new THREE.Vector3(...geo.lonLatToVec(lon, lat, 1));
    const q = new THREE.Quaternion().setFromUnitVectors(from.clone().normalize(), to);
    const t0 = performance.now();
    flight = (now) => {
      const s = Math.min(1, (now - t0) / ms);
      const k = s < 0.5 ? 4 * s * s * s : 1 - Math.pow(-2 * s + 2, 3) / 2;   // ease in-out
      const dir = from.clone().normalize().applyQuaternion(
        new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), q, k));
      const alt = Math.exp(Math.log(fromAlt) + (Math.log(toDist - R) - Math.log(fromAlt)) * k);
      camera.position.copy(dir.multiplyScalar(R + alt));
      camera.lookAt(0, 0, 0);
      if (s >= 1) { flight = null; controls.update(); }
    };
  }

  function pick(x, y) {
    const ndc = new THREE.Vector2((x / canvas.clientWidth) * 2 - 1, -(y / canvas.clientHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const t = geo.raySphere(ray.ray.origin.toArray(), ray.ray.direction.toArray(), R);
    if (t === null) return null;
    const [lon, lat] = geo.vecToLonLat(ray.ray.at(t, new THREE.Vector3()).toArray());
    return { lon, lat };
  }

  const onDouble = (ev) => {
    const r = canvas.getBoundingClientRect();
    const hit = pick(ev.clientX - r.left, ev.clientY - r.top);
    if (hit) flyTo(hit.lon, hit.lat, geo.degreesAcross(camera.position.length(), R, halfMin()) / 2);
  };
  canvas.addEventListener("dblclick", onDouble);

  return {
    flyTo,
    pick,
    // What is loaded, for the page's status line and for budget checks.
    stats: () => ({ wanted: baked.wanted, ready: baked.ready, resident: baked.cache.size,
                    fetchedBytes: baked.fetchedBytes,
                    degrees: geo.degreesAcross(camera.position.length(), R, halfMin()) }),
    setSun(v) {
      lights.sunCol.value.copy(col(SUN_TINT, SUN_ENERGY * Math.max(0, Math.min(1, v))));
      redraw();
    },
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      seen.disconnect();
      canvas.removeEventListener("dblclick", onDouble);
      host.removeEventListener("wheel", onWheel, { capture: true });
      canvas.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerleave", onLeave);
      controls.dispose();
      baked.dispose();
      renderer.dispose();
    },
  };
}
