// The far globe: bake tiles as sphere patches, fetched as the view needs them.
//
// Each tile is its own 16 x 16 patch of sphere with its own two KTX2 textures.
// bakegrid.js decides which tiles the view wants; this file fetches them nearest
// first, six at a time, shows the wanted ones, and evicts the least recently
// wanted past a resident cap. A board-coloured sphere sits just under the
// patches, so a tile still in flight shows the board, never a hole.

import * as THREE from "three";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { parseLevel, selectTiles } from "./bakegrid.js";
import { lonLatToVec } from "./geo.js";
import { FRAGMENT, VERTEX } from "./shader.js";

const SEGMENTS = 16;          // 1.4 deg a segment at level 0: 0.04 mm of chord sag;
                              // coarser levels get more, so a segment never exceeds 1.4 deg
const MAX_IN_FLIGHT = 6;
const BOARD = new THREE.Color("#2b2118");   // constants.BOARD_COLOUR

function patchGeometry(t, radius) {
  const segments = SEGMENTS * 2 ** Math.max(0, -t.level);
  const n = segments + 1;
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const p = lonLatToVec(t.lon0 + ((t.lon1 - t.lon0) * i) / segments,
                            t.lat1 - ((t.lat1 - t.lat0) * j) / segments, radius);
      pos.set(p, 3 * k);
      // v = 0 on the north edge: the packer writes row 0 at the tile's north
      // edge, and a compressed texture is never flipped on upload.
      uv.set([i / segments, j / segments], 2 * k);
    }
  }
  const index = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index.push(a, c, b, b, c, d);             // counter-clockwise from outside
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

export class BakedGlobe {
  constructor({ renderer, dataUrl, libUrl, radius, lights, cap = 160, onLoad }) {
    this.onLoad = onLoad;                      // a tile arrived: the view needs redrawing
    this.dataUrl = dataUrl.replace(/\/?$/, "/");
    this.radius = radius;
    this.lights = lights;                      // uniform objects shared by every material
    this.cap = cap;                            // ~0.5 MB of GPU memory a tile, transcoded
    this.group = new THREE.Group();
    this.cache = new Map();                    // key -> { mesh, last }
    this.inFlight = new Set();
    this.failed = new Set();
    this.frame = 0;
    this.fetchedBytes = 0;
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.loader = new KTX2Loader()
      .setTranscoderPath(libUrl.replace(/\/?$/, "/") + "examples/jsm/libs/basis/")
      .detectSupport(renderer);

    const board = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      uniforms: { ...lights, boardColour: { value: BOARD } },
    });
    this.board = new THREE.Mesh(new THREE.SphereGeometry(radius - 0.5, 128, 64), board);
    this.group.add(this.board);
  }

  // Coarsest first. A level that is not there is skipped, as long as one is.
  async init(levels = [-2, -1, 0, 1]) {
    const loaded = await Promise.all(levels.map(async (level) => {
      const res = await fetch(`${this.dataUrl}bake/${level}/tiles.json`);
      if (res.ok) return parseLevel(await res.json());
      console.warn(`bake level ${level}: ${res.status} ${res.url}`);
      return null;
    }));
    this.levels = loaded.filter(Boolean);
    if (!this.levels.length) throw new Error(`no bake levels under ${this.dataUrl}bake/`);
    return this;
  }

  _texture(tex) {
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = this.anisotropy;
    return tex;
  }

  async _load(t) {
    const base = `${this.dataUrl}bake/${t.level}/${t.y}/${t.x}`;
    const [colour, surface] = await Promise.all([
      this.loader.loadAsync(`${base}.colour.ktx2`),
      this.loader.loadAsync(`${base}.surface.ktx2`),
    ]);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, defines: { USE_MAPS: "" },
      uniforms: { ...this.lights, colourMap: { value: this._texture(colour) },
                  surfaceMap: { value: this._texture(surface) } },
      // A child draws over its parent where both are resident.
      polygonOffset: t.level > 0, polygonOffsetFactor: -t.level, polygonOffsetUnits: -4 * t.level,
    });
    const mesh = new THREE.Mesh(patchGeometry(t, this.radius), material);
    mesh.renderOrder = t.level;
    mesh.frustumCulled = true;
    return mesh;
  }

  _start(t) {
    this.inFlight.add(t.key);
    this._load(t).then((mesh) => {
      this.inFlight.delete(t.key);
      if (this.disposed) return this._free(mesh);
      this.fetchedBytes += t.colourBytes + t.surfaceBytes;
      this.cache.set(t.key, { mesh, last: this.frame });
      this.group.add(mesh);
      this.onLoad?.();
    }, (err) => {
      this.inFlight.delete(t.key);
      this.failed.add(t.key);
      console.warn(`bake tile ${t.key} failed`, err);
      this.onLoad?.();                         // keep the queue moving
    });
  }

  _free(mesh) {
    mesh.geometry.dispose();
    for (const u of ["colourMap", "surfaceMap"]) mesh.material.uniforms[u]?.value?.dispose();
    mesh.material.dispose();
  }

  // view: see bakegrid.js. Call once a frame, before rendering.
  update(view) {
    this.frame++;
    const wanted = selectTiles(this.levels, view);
    const keys = new Set(wanted.map((t) => t.key));
    for (const [key, entry] of this.cache) {
      entry.mesh.visible = keys.has(key);
      if (entry.mesh.visible) entry.last = this.frame;
    }
    for (const t of wanted) {
      if (this.inFlight.size >= MAX_IN_FLIGHT) break;
      if (!this.cache.has(t.key) && !this.inFlight.has(t.key) && !this.failed.has(t.key)) this._start(t);
    }
    if (this.cache.size > this.cap) {
      const idle = [...this.cache].filter(([k]) => !keys.has(k)).sort((a, b) => a[1].last - b[1].last);
      for (const [key, entry] of idle.slice(0, this.cache.size - this.cap)) {
        this.group.remove(entry.mesh);
        this._free(entry.mesh);
        this.cache.delete(key);
      }
    }
    this.wanted = wanted.length;
    this.ready = wanted.filter((t) => this.cache.has(t.key)).length;
  }

  dispose() {
    this.disposed = true;
    for (const { mesh } of this.cache.values()) this._free(mesh);
    this.cache.clear();
    this.board.geometry.dispose();
    this.board.material.dispose();
    this.loader.dispose();
  }
}
