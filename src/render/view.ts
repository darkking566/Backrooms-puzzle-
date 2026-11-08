/* The 3D view: fixed stations, light grid, instanced building, picking, labels, smooth motion, old-photo post.
   It only reads the game; it never changes it. Taps become Pick values for the UI to turn into commands. */
import * as THREE from "three";
import { ck, DV, sstep, type Dir } from "../core/types";
import type { Anim, Game } from "../core/game";
import { edgeCells, edgeKey, passable, isOpenDoor, solid, S, type Cell } from "../world/level0";
import { makeTextures } from "./textures";
import { H, litMat, makeGeometry, makeMaterials, shared, type Geometry, type Materials } from "./materials";

export type Pick =
  | { kind: "exit"; d: Dir } | { kind: "item"; key: string; i: number; j: number } | { kind: "door"; edge: string } | { kind: "flicker"; edge: string }
  | { kind: "wall"; edge: string } | { kind: "tally" } | { kind: "peel" } | { kind: "hole" } | { kind: "pit" } | { kind: "salt" } | { kind: "corpse" }
  | { kind: "notes" } | { kind: "cabinet" } | { kind: "lockedPack" } | { kind: "roomPerson" };
export type Quality = "low" | "mid" | "high";
const TIERS: Record<Quality, { scale: number; R: number; res: number; post: number }> = {
  low: { scale: .6, R: 4, res: 1, post: 0 }, mid: { scale: .8, R: 6, res: .5, post: 1 }, high: { scale: 1, R: 7, res: 1 / 3, post: 2 }
};
const BACK = 1.35, EYE = 1.62, PITCH = -0.09;
const yawOf = (d: number) => -d * Math.PI / 2;
const ease = (t: number) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const shortest = (from: number, to: number) => { let d = to - from; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return from + d; };
interface Hot { pick: Pick; label: string; ly?: number; lp?: THREE.Vector3; tag?: boolean }

export class View {
  readonly canvas: HTMLCanvasElement; readonly labelsEl: HTMLElement;
  renderer: THREE.WebGLRenderer; scene = new THREE.Scene(); camera: THREE.PerspectiveCamera;
  MAT: Materials; GEO: Geometry;
  game: Game | null = null;
  tier: Quality = "mid"; autoQ = true; flash = false; reduceMotion = false; hints = false;
  busy = false; labelText: (p: Pick) => string = () => "";
  onPick: (p: Pick) => void = () => {};
  onLookStart: () => void = () => {};
  private built: THREE.Object3D[] = []; private blockers: THREE.Object3D[] = []; private pickables: THREE.Object3D[] = []; private exitMeshes: THREE.Mesh[] = [];
  private dummy = new THREE.Object3D(); private figure: THREE.Mesh | null = null;
  private rt = new THREE.WebGLRenderTarget(2, 2, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  private post: THREE.ShaderMaterial; private postScene = new THREE.Scene(); private postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private look = { yaw: 0, pitch: 0 }; private frameTimes: number[] = [];
  private torchTarget = 0; private power = 1; private powerAnim: { from: number; to: number; t0: number; dur: number } | null = null; private wasOut = false;
  private loopOn = false; private steady = false; private lastFrame = 0; private doorAnim = false;
  private tubeT = 0; private tubeV = 1; private flickT = 0; private flickV = 1;
  private ray = new THREE.Raycaster(); private occRay = new THREE.Raycaster();
  private listener = (i: number, j: number) => this.dirtyAround(i, j);

  constructor(canvas: HTMLCanvasElement, labelsEl: HTMLElement) {
    this.canvas = canvas; this.labelsEl = labelsEl;
    THREE.ColorManagement.enabled = false;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    const FOGC = new THREE.Color(0x2b2613);
    this.scene.background = FOGC; this.scene.fog = new THREE.FogExp2(FOGC, .069);
    this.camera = new THREE.PerspectiveCamera(68, 1, .05, 70); this.camera.rotation.order = "YXZ";
    const TEX = makeTextures(this.renderer.capabilities.getMaxAnisotropy());
    this.MAT = makeMaterials(TEX); this.GEO = makeGeometry();
    this.post = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uQ: { value: 1 }, uRed: { value: 0 }, uSan: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uQ; uniform float uRed; uniform float uSan; varying vec2 vUv;
        float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uTime) * 43758.5453); }
        void main(){
          vec2 uv = vUv, c = uv - .5, px = 1.0 / uRes; float r2 = dot(c,c);
          vec3 col = texture2D(tDiffuse, uv).rgb;
          if (uQ > 1.5) { vec2 ca = c * .006; col.r = texture2D(tDiffuse, uv + ca).r; col.b = texture2D(tDiffuse, uv - ca).b; }
          if (uQ > 0.5) {
            vec3 blur = (texture2D(tDiffuse, uv + px*vec2(1.5,0.)).rgb + texture2D(tDiffuse, uv - px*vec2(1.5,0.)).rgb + texture2D(tDiffuse, uv + px*vec2(0.,1.5)).rgb + texture2D(tDiffuse, uv - px*vec2(0.,1.5)).rgb) * .25;
            col = mix(col, blur, .35); col += max(blur - .72, 0.) * 1.6 * vec3(1., .95, .75);
          }
          col = 1. - exp(-col * 1.35);
          col *= vec3(1.06, 1.0, .80);
          float l = dot(col, vec3(.299,.587,.114)); col = mix(vec3(l), col, .82 - .25 * uSan);
          col = mix(col, col * vec3(1.2, .76, .7), uRed);
          col *= 1. - r2 * (1.25 + 1.6 * uSan);
          col += (rnd(uv * uRes) - .5) * (uQ > 1.5 ? .07 : .09);
          gl_FragColor = vec4(col, 1.);
        }`,
      depthTest: false, depthWrite: false
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.precompile();
    this.bindInput();
    addEventListener("resize", this.onResize);
  }
  private onResize = () => this.resize();
  dispose() {
    this.loopOn = false; this.game?.world.listeners.splice(this.game.world.listeners.indexOf(this.listener), 1); this.game = null;
    removeEventListener("resize", this.onResize); this.renderer.dispose(); this.renderer.forceContextLoss();
  }
  private get R() { return TIERS[this.tier].R; }
  private RB() { return this.R + 1; }        // drawing range: one ring past R, hidden in fog so new cells never pop into sight
  private setFog() { (this.scene.fog as THREE.FogExp2).density = 1.79 / ((this.R + 1) * S - 2); }

  attach(game: Game) {
    this.game?.world.listeners.splice(this.game.world.listeners.indexOf(this.listener), 1);
    this.game = game; game.world.listeners.push(this.listener);
    this.tiles.clear(); this.pendingDirty.clear(); this.lights = null; this.figure = null;
    shared.uSeedOff.value.set(game.world.hash(1, 2, 3) * 100, game.world.hash(4, 5, 6) * 100);
    this.wasOut = game.run.outageLeft > 0; this.power = this.wasOut ? 0 : 1; this.powerAnim = null;
    this.setFog(); this.placeCamera(); this.syncEnv(true); this.rebuild(Infinity); this.resize();
  }
  setQuality(q: "auto" | Quality) {
    if (q === "auto") { this.autoQ = true; return; }
    this.autoQ = false; this.applyTier(q);
  }
  private applyTier(q: Quality) {
    if (q === this.tier) return;
    this.tier = q; for (const t of this.tiles.values()) t.dirty = true;      // old tiles are stretched until re-baked
    this.setFog(); if (this.game) { this.rebuild(1); } this.resize();
  }
  setHints(on: boolean) { this.hints = on; this.MAT.exit.opacity = on ? .13 : 0; this.render(); }

  /* ---------- camera ---------- */
  private station(i: number, j: number, d: number) { return new THREE.Vector3(i * S - DV[d][0] * BACK, EYE, j * S - DV[d][1] * BACK); }
  placeCamera() {
    const { i, j, d } = this.game!.run.pos;
    this.camera.position.copy(this.station(i, j, d)); this.camera.rotation.set(PITCH, yawOf(d), 0, "YXZ"); this.look = { yaw: 0, pitch: 0 };
  }
  /** Torch, outage and red tint follow the game state. */
  syncEnv(instant = false) {
    const g = this.game!; const { i, j } = g.run.pos;
    this.torchTarget = g.isDark() && g.hasLight() ? 1 : 0;
    shared.uAmb.value = g.isDark() && !g.hasLight() ? .03 : .07;
    const out = g.run.outageLeft > 0;
    if (out !== this.wasOut) { this.wasOut = out; this.powerAnim = { from: this.power, to: out ? 0 : 1, t0: performance.now(), dur: this.reduceMotion ? 1 : out ? (this.flash ? 900 : 1600) : (this.flash ? 1100 : 2200) }; }
    this.post.uniforms.uRed.value = (1 - sstep(.8, 3.2, g.world.redDist(i, j))) * .35;
    this.post.uniforms.uSan.value = 1 - sstep(15, 60, g.run.stats.sanity);
    if (instant) { shared.uTorch.value = this.torchTarget; this.power = out ? 0 : 1; this.powerAnim = null; }
  }

  /* ---------- light grid, cached per cell ---------- */
  private tiles = new Map<string, { d: Uint8Array; f: Uint8Array; dirty: boolean }>();
  private pendingDirty = new Set<string>(); private lights: Map<string, { x: number; z: number; r: number; g: number; b: number; flick: boolean }> | null = null;
  private LM = { tex: null as THREE.DataTexture | null, tex2: null as THREE.DataTexture | null, data: new Uint8Array(4), data2: new Uint8Array(4), n: 0 };
  private bakeCenter: [number, number] | null = null; private pumping = false;
  private dirtyAround(i: number, j: number) { this.lights = null; this.pendingDirty.add(ck(i, j)); }
  private flushDirty() {
    for (const k of this.pendingDirty) { const [i, j] = k.split(",").map(Number); for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) { const t = this.tiles.get(ck(i + di, j + dj)); if (t) t.dirty = true; } }
    this.pendingDirty.clear();
  }
  private buildLights() {
    this.lights = new Map();
    for (const c of this.game!.world.cells.values()) if (c.panel && c.panel !== "dead") {
      const w = c.panel.warm, tint = c.panel.red ? [1.3, .3, .24] : w < .33 ? [1, .93, .76] : w < .66 ? [1, .97, .86] : [.9, 1, .95];
      this.lights.set(ck(c.i, c.j), { x: c.i * S, z: c.j * S, r: tint[0] * c.panel.int, g: tint[1] * c.panel.int, b: tint[2] * c.panel.int, flick: !!c.panel.flick });
    }
  }
  private blockFactor(t?: string) { return t === "open" ? 1 : t === "arch" ? .55 : isOpenDoor(t) ? .6 : 0; }
  private lineOfSight(x0: number, z0: number, x1: number, z1: number) {
    const E = this.game!.world.edges; let ci = Math.round(x0 / S), cj = Math.round(z0 / S), f = 1;
    const len = Math.hypot(x1 - x0, z1 - z0), steps = Math.max(1, Math.ceil(len / .45));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps, ni = Math.round((x0 + (x1 - x0) * t) / S), nj = Math.round((z0 + (z1 - z0) * t) / S);
      if (ni !== ci && nj !== cj) {
        const a = this.blockFactor(E.get(edgeKey(ci, cj, ni > ci ? 1 : 3))) * this.blockFactor(E.get(edgeKey(ni, cj, nj > cj ? 2 : 0)));
        const b = this.blockFactor(E.get(edgeKey(ci, cj, nj > cj ? 2 : 0))) * this.blockFactor(E.get(edgeKey(ci, nj, ni > ci ? 1 : 3)));
        f *= Math.max(a, b);
      } else if (ni !== ci) f *= this.blockFactor(E.get(edgeKey(ci, cj, ni > ci ? 1 : 3)));
      else if (nj !== cj) f *= this.blockFactor(E.get(edgeKey(ci, cj, nj > cj ? 2 : 0)));
      if (f <= 0) return 0;
      ci = ni; cj = nj;
    }
    return f;
  }
  private bakeTile(ti: number, tj: number) {
    const w = this.game!.world, res = TIERS[this.tier].res, tp = Math.round(S / res), k = ck(ti, tj);
    let t = this.tiles.get(k); if (!t || t.d.length !== tp * tp * 4) { t = { d: new Uint8Array(tp * tp * 4), f: new Uint8Array(tp * tp * 4), dirty: false }; this.tiles.set(k, t); }
    t.dirty = false;
    if (!this.lights) this.buildLights();
    const L = this.lights!, cores = w.redCoresNear(ti, tj).map(([a, b]) => [a * S, b * S]), c = w.cells.get(k);
    const wall = (d: number) => solid(w.edges.get(edgeKey(ti, tj, d))), w0 = wall(0), w1 = wall(1), w2 = wall(2), w3 = wall(3), pil = w.zone(ti, tj) === "pillar";
    for (let v = 0; v < tp; v++) for (let u = 0; u < tp; u++) {
      const x = ti * S - S / 2 + (u + .5) * res, z = tj * S - S / 2 + (v + .5) * res;
      let r = 0, g = 0, b = 0, fr = 0, fg = 0, fb = 0;
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) {
        const l = L.get(ck(ti + di, tj + dj)); if (!l) continue;
        const d2 = (l.x - x) ** 2 + (l.z - z) ** 2; if (d2 > 81) continue;
        const vis = (di || dj) ? this.lineOfSight(x, z, l.x, l.z) : 1; if (!vis) continue;
        const a = vis * 1.2 / (1 + d2 * .22);
        if (l.flick) { fr += l.r * a; fg += l.g * a; fb += l.b * a; } else { r += l.r * a; g += l.g * a; b += l.b * a; }
      }
      let rd = 99; for (const [cx, cz] of cores) rd = Math.min(rd, Math.hypot(cx - x, cz - z));
      const red = Math.pow(Math.max(0, Math.min(1, 1 - (rd - 2) / 9)), 1.6);
      let ao = 1;
      if (c) {
        const lx = x - ti * S, lz = z - tj * S; let dmin = 9;
        if (w0) dmin = Math.min(dmin, lz + S / 2); if (w2) dmin = Math.min(dmin, S / 2 - lz);
        if (w3) dmin = Math.min(dmin, lx + S / 2); if (w1) dmin = Math.min(dmin, S / 2 - lx);
        if (pil) dmin = Math.min(dmin, Math.hypot(lx + S / 2, lz + S / 2) - .35);
        ao = .58 + .42 * Math.min(1, Math.max(0, (dmin - .02) / .85));
      }
      const o = (v * tp + u) * 4;
      t.d[o] = Math.min(255, r * ao * 127.5); t.d[o + 1] = Math.min(255, g * ao * 127.5); t.d[o + 2] = Math.min(255, b * ao * 127.5); t.d[o + 3] = red * 255;
      t.f[o] = Math.min(255, fr * ao * 127.5); t.f[o + 1] = Math.min(255, fg * ao * 127.5); t.f[o + 2] = Math.min(255, fb * ao * 127.5); t.f[o + 3] = 255;
    }
  }
  private blitTile(ti: number, tj: number) {
    const t = this.tiles.get(ck(ti, tj)), tp = Math.round(S / TIERS[this.tier].res), n = this.LM.n, RB = this.RB();
    const bx = (ti - this.bakeCenter![0] + RB) * tp, bz = (tj - this.bakeCenter![1] + RB) * tp, D = this.LM.data, D2 = this.LM.data2;
    if (t && t.d.length !== tp * tp * 4) {
      const sp = Math.round(Math.sqrt(t.d.length / 4));
      for (let v = 0; v < tp; v++) for (let u = 0; u < tp; u++) { const so = (Math.floor(v * sp / tp) * sp + Math.floor(u * sp / tp)) * 4, o = ((bz + v) * n + bx + u) * 4; for (let q = 0; q < 4; q++) { D[o + q] = t.d[so + q]; D2[o + q] = t.f[so + q]; } }
      return;
    }
    for (let v = 0; v < tp; v++) {
      const o = ((bz + v) * n + bx) * 4, src = v * tp * 4;
      if (t) { D.set(t.d.subarray(src, src + tp * 4), o); D2.set(t.f.subarray(src, src + tp * 4), o); }
      else { D.fill(0, o, o + tp * 4); D2.fill(0, o, o + tp * 4); }
    }
  }
  private bakeLight(ci: number, cj: number, near = 1) {
    const tp = Math.round(S / TIERS[this.tier].res), RB = this.RB(), cellsW = 2 * RB + 1, span = cellsW * S, n = cellsW * tp, LM = this.LM;
    if (!LM.tex || LM.n !== n) {
      LM.data = new Uint8Array(n * n * 4); LM.data2 = new Uint8Array(n * n * 4);
      const mk = (d: Uint8Array) => { const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat); t.magFilter = t.minFilter = THREE.LinearFilter; return t; };
      LM.tex?.dispose(); LM.tex2?.dispose(); LM.tex = mk(LM.data); LM.tex2 = mk(LM.data2); LM.n = n;
    }
    this.bakeCenter = [ci, cj]; this.flushDirty();
    shared.uLMo.value.set((ci - RB) * S - S / 2, (cj - RB) * S - S / 2); shared.uLMs.value = span; shared.uLM.value = LM.tex; shared.uLM2.value = LM.tex2;
    for (let i = ci - RB; i <= ci + RB; i++) for (let j = cj - RB; j <= cj + RB; j++) {
      const t = this.tiles.get(ck(i, j));
      if ((!t || t.dirty) && Math.max(Math.abs(i - ci), Math.abs(j - cj)) <= near) this.bakeTile(i, j);
      this.blitTile(i, j);
    }
    for (const k of this.tiles.keys()) { const [i, j] = k.split(",").map(Number); if (Math.abs(i - ci) > RB + 2 || Math.abs(j - cj) > RB + 2) this.tiles.delete(k); }
    LM.tex!.needsUpdate = true; LM.tex2!.needsUpdate = true;
    this.pumpBake();
  }
  private pumpBake() { if (!this.pumping) { this.pumping = true; setTimeout(() => this.bakeSlice(), 0); } }
  private bakeSlice() {                // leftover tiles, nearest first, ~3 ms at a time
    this.pumping = false; if (!this.bakeCenter || !this.game) return; this.flushDirty();
    const [ci, cj] = this.bakeCenter, RB = this.RB(), todo: [number, number, number][] = [], { i: pi, j: pj } = this.game.run.pos;
    for (let i = ci - RB; i <= ci + RB; i++) for (let j = cj - RB; j <= cj + RB; j++) { const t = this.tiles.get(ck(i, j)); if (!t || t.dirty) todo.push([i, j, Math.hypot(i - pi, j - pj)]); }
    if (!todo.length) return;
    todo.sort((a, b) => a[2] - b[2]);
    const t0 = performance.now();
    for (const [i, j] of todo) { this.bakeTile(i, j); this.blitTile(i, j); if (performance.now() - t0 > 3) break; }
    this.LM.tex!.needsUpdate = true; this.LM.tex2!.needsUpdate = true;
    if (!this.busy && !this.loopOn) this.render();
    this.pumpBake();
  }

  /* ---------- building ---------- */
  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, list: number[][], colorFn?: (t: number[]) => THREE.Color, keys?: string[]) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, k) => { this.dummy.position.set(t[0], t[1], t[2]); this.dummy.rotation.set(0, t[3] || 0, 0); this.dummy.scale.set(1, 1, 1); this.dummy.updateMatrix(); m.setMatrixAt(k, this.dummy.matrix); if (colorFn) m.setColorAt(k, colorFn(t)); });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (keys) m.userData.keys = keys;
    this.scene.add(m); this.built.push(m); return m;
  }
  private add(o: THREE.Object3D, hot?: Hot, blocker = false) {
    if (hot) o.traverse(x => { x.userData.hot = hot; }); if (hot) o.userData.tag = true;
    this.scene.add(o); this.built.push(o); if (blocker) this.blockers.push(o);
    return o;
  }
  rebuild(near = 1) {
    const g = this.game!, w = g.world, { i: ci, j: cj } = g.run.pos, RB = this.RB(), M = this.MAT, G = this.GEO;
    for (const m of this.built) { this.scene.remove(m); if ((m as THREE.InstancedMesh).isInstancedMesh) (m as THREE.InstancedMesh).dispose(); }
    this.built = []; this.blockers = [];
    const L = { floor: [] as number[][], tile: [] as number[][], ceil: [] as number[][], water: [] as number[][], pit: [] as number[][], hole: [] as number[][], panel: [] as number[][], fpanel: [] as number[][], dead: [] as number[][], pillar: [] as number[][], wood: [] as number[][] };
    const panelOf: (Cell["panel"])[] = [];
    const near_ = (c: { i: number; j: number }) => Math.abs(c.i - ci) <= RB && Math.abs(c.j - cj) <= RB;
    for (const c of w.cells.values()) {
      if (!near_(c)) continue;
      const x = c.i * S, z = c.j * S, zn = w.zone(c.i, c.j);
      if (c.pits.length) {
        for (let gx = 0; gx < 8; gx++) for (let gz = 0; gz < 8; gz++) { const lx = -1.75 + gx * .5, lz = -1.75 + gz * .5; if (!c.pits.some(([px, pz]) => Math.abs(lx - px) < .5 && Math.abs(lz - pz) < .5)) L.tile.push([x + lx, 0, z + lz]); }
        for (const [px, pz] of c.pits) L.pit.push([x + px, 0, z + pz]);
      } else (zn === "manila" ? L.wood : L.floor).push([x, 0, z]);
      L.ceil.push([x, 0, z]);
      if (zn === "dark") L.water.push([x, 0, z]);
      if (c.hole) L.hole.push([x + 1, H - .004, z + 1]);
      if (c.panel) { const rot = w.hash(c.i, c.j, c.ver, 10) < .5 ? Math.PI / 2 : 0; if (c.panel === "dead") L.dead.push([x, 0, z, rot]); else { (c.panel.flick ? L.fpanel : L.panel).push([x, 0, z, rot, panelOf.length]); panelOf.push(c.panel); } }
      if (zn === "pillar") L.pillar.push([x - S / 2, 0, z - S / 2]);
    }
    const walls: number[][][] = [[], [], []], wallKeys: string[][] = [[], [], []], yel: number[][][] = [[], [], []], yelKeys: string[][] = [[], [], []];
    const other: Record<string, { l: number[][]; k: string[] }> = { pale: { l: [], k: [] }, arch: { l: [], k: [] }, red: { l: [], k: [] }, mwall: { l: [], k: [] } };
    for (const [k, t] of w.edges) {
      const [[a, b], [c2, d2]] = edgeCells(k);
      if (Math.abs(a - ci) > RB || Math.abs(b - cj) > RB) continue;
      const vert = k[0] === "v", x = vert ? (a + .5) * S : a * S, z = vert ? b * S : (b + .5) * S, rot = vert ? Math.PI / 2 : 0;
      if (t === "wall") {
        const bucket = w.zone(a, b) === "red" || w.zone(c2, d2) === "red" ? other.red : w.stable(a, b) || w.stable(c2, d2) ? other.pale : null;
        if (bucket) { bucket.l.push([x, 0, z, rot]); bucket.k.push(k); }
        else { const v = Math.floor(w.hash(a, b, vert ? 3 : 4) * 3); (w.yellower(k) ? yel : walls)[v].push([x, 0, z, rot]); (w.yellower(k) ? yelKeys : wallKeys)[v].push(k); }
      } else if (t === "arch") { other.arch.l.push([x, 0, z, rot]); other.arch.k.push(k); }
      else if (t === "mwall") { other.mwall.l.push([x, 0, z, rot]); other.mwall.k.push(k); }
      else if (t === "flicker" || t === "fakeflicker") { const m = new THREE.Mesh(G.wall, M.flicker); m.position.set(x, 0, z); m.rotation.y = rot; m.userData.flick = k; this.add(m, undefined, false); }
      else if (t.startsWith("door")) this.buildDoor(k, t, x, z, rot);
    }
    this.inst(G.floor, M.wood, L.wood); this.inst(G.floor, M.floor, L.floor); this.inst(G.tile, M.tile, L.tile); this.inst(G.ceil, M.ceil, L.ceil); this.inst(G.water, M.water, L.water);
    this.inst(G.pit, M.pit, L.pit); this.inst(G.hole, M.black, L.hole);
    const panelColor = (t: number[]) => { const p = panelOf[t[4]] as { int: number; warm: number; red?: boolean }, s = .82 + p.int * .18, wm = p.warm; return p.red ? new THREE.Color(1, .3, .24) : wm < .33 ? new THREE.Color(s, s * .95, s * .8) : wm < .66 ? new THREE.Color(s, s * .98, s * .9) : new THREE.Color(s * .92, s, s * .96); };
    this.inst(G.panel, M.panel, L.panel, panelColor); this.inst(G.panel, M.fpanel, L.fpanel, panelColor); this.inst(G.panel, M.dead, L.dead);
    const pm = this.inst(G.pillar, M.pillar, L.pillar); if (pm) this.blockers.push(pm);
    walls.forEach((l, v) => { const m = this.inst(G.wall, M.walls[v], l, undefined, wallKeys[v]); if (m) this.blockers.push(m); });
    yel.forEach((l, v) => { const m = this.inst(G.wall, M.yellower[v], l, undefined, yelKeys[v]); if (m) this.blockers.push(m); });
    for (const [name, mat, geo] of [["pale", M.pale, G.wall], ["arch", M.arch, G.arch], ["red", M.red, G.wall], ["mwall", M.mwall, G.wall]] as const) { const m = this.inst(geo, mat, other[name].l, undefined, other[name].k); if (m) this.blockers.push(m); }
    this.decals(ci, cj);
    this.objects(ci, cj);
    if (Math.abs(w.manila[0] + .5 - ci) <= RB + .5 && Math.abs(w.manila[1] + .5 - cj) <= RB + .5) this.buildManila();
    this.maybeFigure();
    if (this.figure) { this.scene.add(this.figure); this.built.push(this.figure); }
    this.bakeLight(ci, cj, near);
    this.rebuildExits();
  }
  private decals(ci: number, cj: number) {
    const w = this.game!.world, R = this.R;
    const decal = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, z: number, vert: boolean, side: number, y: number, hot: Hot) => {
      const m = new THREE.Mesh(geo, mat);
      if (vert) { m.position.set(x + side * .076, y, z); m.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2; } else { m.position.set(x, y, z + side * .076); m.rotation.y = side > 0 ? 0 : Math.PI; }
      this.add(m, hot);
    };
    for (const [k, t] of w.edges) {
      if (t !== "wall") continue;
      const [[a, b], [c2, d2]] = edgeCells(k);
      if (Math.abs(a - ci) > R || Math.abs(b - cj) > R || w.stable(a, b) || w.stable(c2, d2)) continue;
      const vert = k[0] === "v", x = vert ? (a + .5) * S : a * S, z = vert ? b * S : (b + .5) * S;
      if (Math.min(w.redDist(a, b), w.redDist(c2, d2)) <= 2.3 && w.hash(a, b, vert ? 41 : 42, 7) < .55) {
        decal(this.GEO.peel, this.MAT.peel, x, z, vert, w.hash(a, b, vert ? 43 : 44) < .5 ? 1 : -1, .9 + w.hash(a, b, 45) * .7, { pick: { kind: "peel" }, label: "peel" }); continue;
      }
      if (w.hash(a, b, vert ? 7 : 8, 99) > .03) continue;
      decal(this.GEO.tally, this.MAT.tally, x, z, vert, w.hash(a, b, 100) < .5 ? 1 : -1, 1.32, { pick: { kind: "tally" }, label: "tally" });
    }
  }
  private objects(ci: number, cj: number) {
    const g = this.game!, w = g.world, R = this.R, M = this.MAT, G = this.GEO;
    const pack = g.run.lockedPack;
    if (pack && Math.abs(pack.pos.i - ci) <= R && Math.abs(pack.pos.j - cj) <= R) {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(G.box, M.furnDark); body.scale.set(.55, .3, .72); body.position.y = .17; grp.add(body);
      for (const x of [-.17, .17]) { const strap = new THREE.Mesh(G.box, M.body); strap.scale.set(.05, .025, .68); strap.position.set(x, .335, 0); grp.add(strap); }
      if (!pack.openedBy) { const lock = new THREE.Mesh(G.box, M.cap); lock.scale.set(.07, .09, .04); lock.position.set(0, .23, -.38); grp.add(lock); }
      const board = new THREE.Mesh(G.box, M.paper); board.scale.set(.46, .015, .28); board.position.set(.47, .02, .1); grp.add(board);
      const proxy = new THREE.Mesh(G.proxy, M.proxy); proxy.position.y = .15; grp.add(proxy);
      grp.position.set(pack.pos.i * S + .55, 0, pack.pos.j * S + .35);
      this.add(grp, { pick: { kind: "lockedPack" }, label: "lockedPack", ly: .55 });
    }
    for (const c of w.cells.values()) {
      if (Math.abs(c.i - ci) > R || Math.abs(c.j - cj) > R) continue;
      for (const it of c.items) {
        const grp = new THREE.Group();
        if (it.bottle) { grp.add(new THREE.Mesh(G.bottle, M.bottle[it.bottle.color]), new THREE.Mesh(G.cap, M.cap)); if (!it.bottle.full) grp.rotation.z = Math.PI / 2; }
        else grp.add(new THREE.Mesh(G.things[it.id] ?? G.things.snack_bar, M.thing[it.id] ?? M.thing.snack_bar));
        const px = new THREE.Mesh(G.proxy, M.proxy); px.userData.proxy = true; grp.add(px);
        grp.position.set(c.i * S + it.x, it.bottle && !it.bottle.full ? .08 : 0, c.j * S + it.z);
        this.add(grp, { pick: { kind: "item", key: it.key, i: c.i, j: c.j }, label: "item:" + it.key, ly: .5 });
      }
      if (c.hole) { const m = new THREE.Mesh(G.box, M.proxy); m.scale.set(1, .3, 1); m.position.set(c.i * S + 1, H - .15, c.j * S + 1); this.add(m, { pick: { kind: "hole" }, label: "hole" }); }
      if (c.pits.length) { const [px, pz] = c.pits[0]; const m = new THREE.Mesh(G.box, M.proxy); m.scale.set(1, .4, 1); m.position.set(c.i * S + px, .1, c.j * S + pz); this.add(m, { pick: { kind: "pit" }, label: "pit" }); }
      if (c.salt) {
        const grp = new THREE.Group(), sx = c.i * S + S / 2 - .22, sz = c.j * S + S / 2 - .22;
        for (let k = 0; k < 6; k++) { const m = new THREE.Mesh(G.salt, M.thing.firesalt); m.position.set((w.hash(c.i, c.j, k, 1) - .5) * .25, .03 + w.hash(c.i, c.j, k, 2) * .05, (w.hash(c.i, c.j, k, 3) - .5) * .25); m.scale.setScalar(.6 + w.hash(c.i, c.j, k, 4)); grp.add(m); }
        const px = new THREE.Mesh(G.proxy, M.proxy); px.scale.setScalar(.7); grp.add(px);
        grp.position.set(sx, 0, sz); this.add(grp, { pick: { kind: "salt" }, label: "salt", ly: .35 });
      }
    }
    if (w.corpse && g.meta.corpse) {
      const [i, j] = w.corpse, grp = new THREE.Group();
      const torso = new THREE.Mesh(G.box, M.body); torso.scale.set(.42, .2, .7); torso.position.set(0, .1, 0);
      const head = new THREE.Mesh(G.box, M.body); head.scale.set(.2, .18, .22); head.position.set(0, .09, -.5);
      const legs = new THREE.Mesh(G.box, M.body); legs.scale.set(.36, .14, .8); legs.position.set(.05, .07, .72);
      grp.add(torso, head, legs); grp.rotation.y = w.hash(i, j, 77) * 6; grp.position.set(i * S + .6, 0, j * S + .4);
      this.add(grp, { pick: { kind: "corpse" }, label: "corpse", ly: .45 });
    }
  }
  private buildDoor(k: string, t: string, x: number, z: number, rot: number) {
    const w = this.game!.world, kind = t.split("-")[1] as "wood" | "metal" | "manila", open = isOpenDoor(t), M = this.MAT;
    const frame = new THREE.Mesh(this.GEO.doorframe, kind === "manila" ? M.mframe : M.frame); frame.position.set(x, 0, z); frame.rotation.y = rot;
    this.add(frame, undefined, true);
    const grp = new THREE.Group(); grp.position.set(x - Math.cos(rot) * .475, 0, z + Math.sin(rot) * .475); grp.rotation.y = rot;
    const leaf = new THREE.Mesh(this.GEO.leaf, M[`door_${kind}`]), kn = new THREE.Mesh(this.GEO.knob, M.knob); kn.position.set(.82, 1, 0); grp.add(leaf, kn);
    if (open) { grp.rotation.y = rot + (w.opened.get(k) ?? 1.65); this.add(grp); }
    else { this.add(grp, { pick: { kind: "door", edge: k }, label: "door:" + kind, lp: new THREE.Vector3(x, 1.25, z) }); this.blockers.push(leaf); }
    grp.userData.door = k; grp.userData.rot = rot;
  }
  private buildManila() {
    const w = this.game!.world, M = this.MAT, G = this.GEO, grp = new THREE.Group();
    const person = this.game!.run.roomPerson;
    grp.position.set((w.manila[0] + .5) * S, 0, (w.manila[1] + .5) * S);
    const top = new THREE.Mesh(G.tableTop, M.furn), cab = new THREE.Mesh(G.cabinet, M.furnDark), paper = new THREE.Mesh(G.paper, M.paper); paper.rotation.y = .35;
    const notes: Hot = { pick: { kind: "notes" }, label: "notes", ly: .25 }, cabinet: Hot = { pick: { kind: "cabinet" }, label: "cabinet", ly: .1 };
    top.userData.hot = notes; paper.userData.hot = notes; paper.userData.tag = true; cab.userData.hot = cabinet; cab.userData.tag = true;
    grp.add(top, cab, paper);
    const secondChair = person.variant === "first" ? [2.6, 2.6, Math.PI] : [1.15, -.3, -Math.PI / 2];
    for (const [cx, cz, ry] of [[-1.2, .25, Math.PI / 2], secondChair]) {
      const ch = new THREE.Group(); ch.position.set(cx, 0, cz); ch.rotation.y = ry;
      ch.add(new THREE.Mesh(G.seat, M.furn), new THREE.Mesh(G.chairBack, M.furn));
      for (const [lx, lz] of [[-.19, -.19], [.19, -.19], [-.19, .19], [.19, .19]]) { const l = new THREE.Mesh(G.leg, M.furn); l.position.set(lx, 0, lz); ch.add(l); }
      grp.add(ch);
    }
    if (person.present) {
      // A coat and empty flask anchor the narrated person; no character model is required.
      const props = new THREE.Group(); props.position.set(person.variant === "first" ? 2.6 : 1.3, 0, person.variant === "first" ? 2.6 : .2);
      const coat = new THREE.Mesh(G.box, M.body); coat.scale.set(.42, .48, .09); coat.position.set(0, .65, .2); props.add(coat);
      if (person.variant === "first") { const flask = new THREE.Mesh(G.bottle, M.bottle.grey); flask.rotation.z = Math.PI / 2; flask.position.set(.45, .09, -.15); props.add(flask); }
      const proxy = new THREE.Mesh(G.proxy, M.proxy); proxy.position.y = .45; props.add(proxy);
      const hot: Hot = { pick: { kind: "roomPerson" }, label: "roomPerson", ly: .9 };
      props.traverse(o => { o.userData.hot = hot; }); props.userData.tag = true; grp.add(props);
    }
    this.scene.add(grp); this.built.push(grp);
  }
  private maybeFigure() {     // a shadow far down a straight corridor; more often as sanity fails (cosmetic only)
    this.figure = null;
    const g = this.game!, { i, j, d } = g.run.pos, w = g.world;
    const chance = .04 + .3 * (1 - sstep(25, 70, g.run.stats.sanity));
    if (g.run.moves < 4 || Math.random() > chance || w.zone(i, j) === "manila" || g.isDark()) return;
    const s = w.straightRun(i, j, d); if (s < 3) return;
    const fi = i + DV[d][0] * s, fj = j + DV[d][1] * s;
    this.figure = new THREE.Mesh(this.GEO.figure, this.MAT.figure);
    this.figure.position.set(fi * S + (w.hash(fi, fj, 5) - .5), 0, fj * S + (w.hash(fi, fj, 6) - .5)); this.figure.rotation.y = yawOf(d);
  }
  clearFigure() { if (this.figure) { this.scene.remove(this.figure); this.figure = null; } }
  private rebuildExits() {
    const g = this.game!, { i, j, d } = g.run.pos;
    for (const m of this.exitMeshes) this.scene.remove(m);
    this.exitMeshes = []; this.pickables = [];
    for (const dd of [d, (d + 3) % 4, (d + 1) % 4]) {
      const t = g.world.edgeAt(i, j, dd); if (!passable(t)) continue;
      const pl = new THREE.Mesh(this.GEO.exit, this.MAT.exit);
      pl.position.set(i * S + DV[dd][0] * S / 2, 0, j * S + DV[dd][1] * S / 2); pl.rotation.y = yawOf(dd);
      pl.userData.exit = dd; this.scene.add(pl); this.exitMeshes.push(pl); this.pickables.push(pl);
    }
    for (const m of this.built) m.traverse(o => { if (o.userData.hot || o.userData.flick) this.pickables.push(o); });
  }

  /* ---------- render ---------- */
  private tubeAt(t: number) {
    if (this.reduceMotion) return .85;
    if (this.flash) { if (t - this.tubeT > 55) { this.tubeT = t; this.tubeV = Math.random() < .22 ? .08 + Math.random() * .3 : .9 + Math.random() * .1; } return this.tubeV; }
    return .5 + .5 * sstep(-1.2, .6, Math.sin(t / 830) + Math.sin(t / 1970 + 1.3) + Math.sin(t / 3100 + 4.1));
  }
  private powerAt(t: number) {
    const a = this.powerAnim; if (!a) return this.power;
    const k = (t - a.t0) / a.dur;
    if (k >= 1) { this.power = a.to; this.powerAnim = null; this.computeSteady(); return this.power; }
    if (this.flash && !this.reduceMotion) { const seq = a.to ? [0, .5, 0, .7, .15, .9, .6, 1] : [1, .2, 1, .1, .7, .05, 0, 0]; return seq[Math.floor(k * seq.length)]; }
    return a.from + (a.to - a.from) * ease(k);
  }
  tubeValue = 1;
  render(t = performance.now()) {
    if (!this.game) return;
    if (this.flash && !this.reduceMotion) { if (t - this.flickT > 70) { this.flickT = t; this.flickV = Math.random() < .3 ? .25 + Math.random() * .4 : 1; } }
    else this.flickV = this.reduceMotion ? .9 : .78 + .22 * Math.sin(t / 700);
    this.MAT.flicker.color.setRGB(this.flickV, this.flickV * .97, this.flickV * .82);
    const pw = this.powerAt(t), fv = this.tubeAt(t); this.tubeValue = fv * pw;
    shared.uPower.value = pw; shared.uFlick.value = fv;
    this.MAT.panel.color.setScalar(.22 + .78 * pw); this.MAT.fpanel.color.setScalar(.22 + .78 * pw * fv);
    shared.uTorch.value += (this.torchTarget - shared.uTorch.value) * .2;
    const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir); shared.uCam.value.copy(this.camera.position); shared.uCamDir.value.copy(dir);
    this.post.uniforms.uTime.value = (t / 1000) % 100;
    this.renderer.setRenderTarget(this.rt); this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null); this.post.uniforms.tDiffuse.value = this.rt.texture; this.renderer.render(this.postScene, this.postCam);
    if (this.hints) this.placeLabels(); else if (this.labelsEl.firstChild) this.labelsEl.innerHTML = "";
  }
  private loop = (t: number) => {
    if (!this.loopOn) return;
    const tr = this.transient();
    if (!this.steady && !tr) { this.loopOn = false; return; }
    if (tr || t - this.lastFrame > 66) { this.lastFrame = t; this.render(t); }
    requestAnimationFrame(this.loop);
  };
  private setLoop(on: boolean) { if (on && !this.loopOn) { this.loopOn = true; requestAnimationFrame(this.loop); } else if (!on) this.loopOn = false; }
  private visibleCells() {
    const g = this.game!; this.camera.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const vis = new Set<string>(), box = new THREE.Box3();
    for (const [k, c] of g.world.cells) {
      const dx = c.i - g.run.pos.i, dz = c.j - g.run.pos.j;
      if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) { vis.add(k); continue; }
      if (Math.hypot(dx, dz) > this.RB() + .5) continue;
      box.min.set(c.i * S - S / 2, -1, c.j * S - S / 2); box.max.set(c.i * S + S / 2, H, c.j * S + S / 2);
      if (fr.intersectsBox(box)) vis.add(k);
    }
    return vis;
  }
  private computeSteady() {
    const g = this.game!, w = g.world, vis = this.visibleCells();
    this.steady = false;
    for (const k of [w.flickerKey, w.fakeKey]) if (k && vis.has(ck(...edgeCells(k)[0]))) this.steady = true;
    if (!this.steady && this.power > 0 && !g.run.outageLeft) for (const k of vis) { const c = w.cells.get(k), p = c?.panel; if (p && p !== "dead" && p.flick && Math.hypot(c!.i - g.run.pos.i, c!.j - g.run.pos.j) <= 3) { this.steady = true; break; } }
  }
  private transient() { return Math.abs(shared.uTorch.value - this.torchTarget) > .01 || !!this.powerAnim || this.doorAnim; }
  kick() { this.computeSteady(); this.setLoop(this.steady || this.transient()); }

  /* ---------- labels ---------- */
  private occluded(pos: THREE.Vector3) {
    const dir = new THREE.Vector3().subVectors(pos, this.camera.position), dist = dir.length(); dir.divideScalar(dist);
    this.occRay.set(this.camera.position, dir); this.occRay.far = dist - .2;
    return this.occRay.intersectObjects(this.blockers, false).length > 0;
  }
  private placeLabels() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, seen: [number, number][] = [];
    let html = ""; const v = new THREE.Vector3();
    for (const p of this.pickables) {
      let pick: Pick | null = null, pos: THREE.Vector3 | null = null;
      const u = p.userData;
      if (u.exit !== undefined) { pick = { kind: "exit", d: u.exit }; pos = v.copy(p.position).setY(1.3); }
      else if (u.flick) { pick = { kind: "flicker", edge: u.flick }; pos = v.copy(p.position).setY(1.5); }
      else if (u.hot && u.tag) {
        const hot = u.hot as Hot; pick = hot.pick;
        if (hot.lp) pos = v.subVectors(this.camera.position, hot.lp).setY(0).normalize().multiplyScalar(.22).add(hot.lp);
        else { p.getWorldPosition(v); v.y += hot.ly ?? 0; pos = v; }
      }
      if (!pick || !pos) continue;
      if (pos.distanceTo(this.camera.position) > 13) continue;
      const q = pos.clone().project(this.camera);
      if (q.z > 1 || Math.abs(q.x) > 1.02 || Math.abs(q.y) > 1.02) continue;
      if (this.occluded(pos)) continue;
      let sx = (q.x + 1) / 2 * w, sy = (1 - q.y) / 2 * h;
      for (const [ox, oy] of seen) if (Math.abs(ox - sx) < 70 && Math.abs(oy - sy) < 22) sy = oy + 24;
      seen.push([sx, sy]);
      html += `<span class="lbl" style="left:${sx}px;top:${sy}px">${escapeHtml(this.labelText(pick))}</span>`;
    }
    this.labelsEl.innerHTML = html;
  }

  /* ---------- motion ---------- */
  play(anim: Anim, done: () => void) {
    const g = this.game!;
    if (anim.kind === "move" || anim.kind === "turn") {
      this.clearFigure();
      const f = anim.from, to = g.run.pos, fromP = this.camera.position.clone(), toP = this.station(to.i, to.j, to.d);
      const fy = this.camera.rotation.y;
      let ty: number, ctrl: THREE.Vector3, ms: number;
      if (anim.kind === "move") {
        const straight = anim.d === f.d; ty = shortest(fy, yawOf(to.d));
        ctrl = straight ? fromP.clone().lerp(toP, .5) : new THREE.Vector3(f.i * S, EYE, f.j * S); ms = straight ? 900 : 1050;
      } else if (anim.dir === 2) { ty = fy + Math.PI; ctrl = new THREE.Vector3(f.i * S, EYE, f.j * S); ms = 1100; }
      else { ty = shortest(fy, yawOf(to.d)); ctrl = fromP.clone().lerp(toP, .5).lerp(new THREE.Vector3(f.i * S, EYE, f.j * S), .5); ms = 700; }
      this.tween(fromP, ctrl, toP, fy, ty, this.reduceMotion ? 1 : ms, done);
    } else if (anim.kind === "door") {
      const grp = this.built.find(o => o.userData.door === anim.edge);
      if (!grp) { done(); return; }
      const r0 = grp.rotation.y, ang = g.world.opened.get(anim.edge) ?? 1.65, t0 = performance.now(), dur = this.reduceMotion ? 1 : 900;
      this.busy = true; this.doorAnim = true;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur); grp.rotation.y = r0 + ang * ease(k); this.render(now);
        if (k < 1) { requestAnimationFrame(step); return; }
        this.busy = false; this.doorAnim = false; done();
      };
      requestAnimationFrame(step);
    } else done();
  }
  private tween(fromP: THREE.Vector3, ctrlP: THREE.Vector3, toP: THREE.Vector3, fromY: number, toY: number, ms: number, done: () => void) {
    this.busy = true; this.setLoop(false);
    const t0 = performance.now(); let last = t0; const fromX = this.camera.rotation.x; this.look = { yaw: 0, pitch: 0 };
    const step = (now: number) => {
      this.frameTimes.push(now - last); last = now;
      const k = Math.min(1, (now - t0) / ms), e = ease(k);
      const a = fromP.clone().lerp(ctrlP, e), b = ctrlP.clone().lerp(toP, e); this.camera.position.copy(a.lerp(b, e));
      this.camera.position.y = EYE + (this.reduceMotion ? 0 : Math.sin(e * Math.PI * 2) * .025);
      this.camera.rotation.y = fromY + (toY - fromY) * e; this.camera.rotation.x = fromX + (PITCH - fromX) * e;
      this.render(now);
      if (k < 1) requestAnimationFrame(step);
      else { this.busy = false; this.autoQuality(); done(); this.kick(); }
    };
    requestAnimationFrame(step);
  }
  private autoQuality() {
    if (!this.autoQ || this.frameTimes.length < 20) { this.frameTimes = []; return; }
    const ts = this.frameTimes.slice(5).sort((a, b) => a - b), med = ts[Math.floor(ts.length / 2)]; this.frameTimes = [];
    const want: Quality = med > 40 ? "low" : med < 20 ? "high" : "mid", order: Quality[] = ["low", "mid", "high"], ci = order.indexOf(this.tier), wi = order.indexOf(want);
    const next = order[ci + Math.sign(wi - ci)];
    if (next !== this.tier) this.applyTier(next);
  }

  /* ---------- input ---------- */
  private bindInput() {
    const c = this.canvas; let downAt: [number, number] | null = null, dragging = false, lookStart = { yaw: 0, pitch: 0 };
    c.addEventListener("pointerdown", e => { downAt = [e.clientX, e.clientY]; dragging = false; lookStart = { ...this.look }; try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
    c.addEventListener("pointermove", e => {
      if (downAt && !this.busy && this.game) {
        const dx = e.clientX - downAt[0], dy = e.clientY - downAt[1];
        if (!dragging && Math.hypot(dx, dy) > 10) { dragging = true; c.style.cursor = "grabbing"; this.onLookStart(); }
        if (dragging) {
          const k = 2.2 / Math.max(320, c.clientWidth);
          this.look.yaw = Math.max(-1.35, Math.min(1.35, lookStart.yaw + dx * k)); this.look.pitch = Math.max(-.45, Math.min(.35, lookStart.pitch + dy * k));
          this.camera.rotation.y = yawOf(this.game.run.pos.d) + this.look.yaw; this.camera.rotation.x = PITCH + this.look.pitch;
          this.render(); return;
        }
      }
      if (e.pointerType === "mouse" && !this.busy) c.style.cursor = this.pickAt(e.clientX, e.clientY) ? "pointer" : "grab";
    });
    c.addEventListener("pointercancel", () => { downAt = null; dragging = false; });
    c.addEventListener("pointerup", e => {
      const wasDrag = dragging; dragging = false; c.style.cursor = "grab";
      if (!downAt || wasDrag || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 10 || this.busy) { downAt = null; return; }
      downAt = null;
      const p = this.pickAt(e.clientX, e.clientY); if (p) this.onPick(p);
    });
  }
  pickAt(cx: number, cy: number): Pick | null {
    if (!this.game) return null;
    const r = this.canvas.getBoundingClientRect(), ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects(this.pickables.concat(this.blockers), false).filter(h => h.distance < 14);
    let exitHit: Pick | null = null;
    for (const h of hits) {
      const u = h.object.userData;
      if (u.hot) return (u.hot as Hot).pick;
      if (u.exit !== undefined) { exitHit = exitHit || { kind: "exit", d: u.exit }; continue; }
      if (u.flick) { exitHit = exitHit || { kind: "flicker", edge: u.flick }; continue; }
      if (u.keys && h.instanceId !== undefined && h.distance < 4.5) return exitHit || { kind: "wall", edge: u.keys[h.instanceId] };
      break;
    }
    return exitHit;
  }

  /* ---------- misc ---------- */
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight; if (!w || !h) return;
    const dpr = Math.min(devicePixelRatio || 1, 1.5), T = TIERS[this.tier];
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.fov = w / h < .8 ? 78 : 68; this.camera.updateProjectionMatrix();
    this.rt.setSize(Math.max(2, Math.floor(w * dpr * T.scale)), Math.max(2, Math.floor(h * dpr * T.scale)));
    this.post.uniforms.uRes.value.set(this.rt.width, this.rt.height); this.post.uniforms.uQ.value = T.post;
    this.render();
  }
  private precompile() {      // compile every shader up front so the first door or red wall does not stall
    const grp = new THREE.Group(), M = this.MAT as unknown as Record<string, unknown>;
    const mats: THREE.Material[] = [];
    for (const v of Object.values(M)) { if (v instanceof THREE.Material) mats.push(v); else if (Array.isArray(v)) mats.push(...v); else if (v && typeof v === "object") mats.push(...Object.values(v as Record<string, THREE.Material>)); }
    for (const m of mats) { const o = new THREE.Mesh(this.GEO.box, m); o.position.set(0, 1, -3); grp.add(o); const im = new THREE.InstancedMesh(this.GEO.box, m, 1); im.setMatrixAt(0, new THREE.Matrix4()); im.setColorAt(0, new THREE.Color(1, 1, 1)); grp.add(im); }
    void litMat;
    this.scene.add(grp); this.camera.position.set(0, EYE, 0); this.renderer.compile(this.scene, this.camera); this.scene.remove(grp);
  }
}
function escapeHtml(s: string) { return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }
