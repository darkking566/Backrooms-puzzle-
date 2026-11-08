/* The light-grid shader shared by every surface, the materials and the reusable geometry. */
import * as THREE from "three";
import { S } from "../world/level0";
import type { Textures } from "./textures";

export const H = 2.75;

export const shared = {
  uLM: { value: null as THREE.Texture | null }, uLM2: { value: null as THREE.Texture | null }, uFlick: { value: 1 }, uPower: { value: 1 },
  uLMo: { value: new THREE.Vector2() }, uLMs: { value: 1 },
  uCam: { value: new THREE.Vector3() }, uCamDir: { value: new THREE.Vector3() }, uTorch: { value: 0 }, uAmb: { value: .07 },
  uSeedOff: { value: new THREE.Vector2() }
};
const VERT = `
  varying vec2 vUv; varying vec3 vW; varying vec3 vN;
  #include <fog_pars_vertex>
  void main(){
    vUv = uv; vec4 p = vec4(position, 1.0); vec3 n = normal;
    #ifdef USE_INSTANCING
      p = instanceMatrix * p; n = mat3(instanceMatrix) * n;
    #endif
    vec4 w = modelMatrix * p; vW = w.xyz; vN = normalize(mat3(modelMatrix) * n);
    vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
/* kinds: 0 carpet, 1 wall, 2 ceiling, 3 standing water, 4 pit wall, 5 wooden floor, 6 object */
const FRAG = `
  uniform sampler2D map; uniform vec2 uRep; uniform vec3 uTint; uniform float uKind; uniform float uAlpha;
  uniform sampler2D uLM; uniform sampler2D uLM2; uniform float uFlick; uniform float uPower;
  uniform vec2 uLMo; uniform float uLMs; uniform vec3 uCam; uniform vec3 uCamDir; uniform float uTorch; uniform float uAmb; uniform vec2 uSeedOff;
  varying vec2 vUv; varying vec3 vW; varying vec3 vN;
  #include <fog_pars_fragment>
  float vh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
    return mix(mix(vh(i), vh(i + vec2(1.0, 0.0)), u.x), mix(vh(i + vec2(0.0, 1.0)), vh(i + vec2(1.0, 1.0)), u.x), u.y); }
  float fbm(vec2 p){ return vn(p) * .5 + vn(p * 2.07 + 7.1) * .3 + vn(p * 4.3 + 3.3) * .2; }
  void main(){
    vec4 tx = texture2D(map, vUv * uRep);
    vec3 base = tx.rgb * uTint;
    if (uKind < 0.5) {
      vec2 w = vW.xz;
      vec3 a = texture2D(map, w * 0.85).rgb, b = texture2D(map, mat2(.8, -.6, .6, .8) * w * 0.61 + .37).rgb;
      base = mix(a, b, .5) * uTint;
      float damp = smoothstep(.5, .8, fbm(w * .21 + uSeedOff));
      base *= mix(vec3(1.0), vec3(.64, .57, .47), damp);
      base *= .86 + .28 * fbm(w * .045 + uSeedOff * 1.7);
    } else if (uKind > 4.5 && uKind < 5.5) base = texture2D(map, vW.xz * 0.25).rgb * uTint;
    vec2 sp = vW.xz + vN.xz * 0.3;
    vec2 luv = (sp - uLMo) / uLMs;
    vec4 lms = texture2D(uLM, luv);
    vec3 lm = (lms.rgb + texture2D(uLM2, luv).rgb * uFlick) * 2.0 * uPower;
    if (uKind < 2.5 || uKind > 4.5) base = mix(base, base * vec3(1.35, 0.46, 0.38), lms.a * 0.65);
    float amb = uAmb * (0.45 + 0.55 * uPower);
    float h = clamp(vW.y / 2.75, 0.0, 1.0), k = 1.0;
    if (uKind > 0.5 && uKind < 1.5) k = mix(0.55, 1.05, h) * mix(0.62, 1.0, smoothstep(0.0, 0.4, vW.y)) * mix(1.0, 0.8, smoothstep(2.45, 2.75, vW.y));
    else if (uKind > 1.5 && uKind < 2.5) k = 0.4;
    vec3 L = lm * k + vec3(amb);
    vec3 tv = vW - uCam; float td = max(length(tv), 0.001);
    float torch = uTorch * smoothstep(0.72, 0.93, dot(tv / td, uCamDir)) * 4.0 / (1.0 + td * td * 0.22);
    L += vec3(1.0, 0.95, 0.85) * torch;
    if (uKind > 2.5 && uKind < 3.5) { base = vec3(0.13, 0.11, 0.06); L = lm * 0.55 + vec3(amb) + vec3(1.0,0.95,0.85) * torch * 2.4; }
    if (uKind > 3.5 && uKind < 4.5) {
      float dep = clamp(-vW.y / 1.4, 0.0, 1.0);
      vec3 rim = vW.y > -0.035 ? texture2D(map, vW.xz * 0.85).rgb * 0.75 : vec3(0.34, 0.28, 0.18);
      base = rim * (1.0 - smoothstep(0.0, 1.0, pow(dep, 0.55)));
      L = lm * mix(1.0, 0.2, dep) + vec3(amb) * (1.0 - dep) + vec3(1.0, 0.95, 0.85) * torch * (1.0 - dep);
    }
    gl_FragColor = vec4(base * L, uAlpha > 0.5 ? tx.a : 1.0);
    #include <fog_fragment>
  }`;
export function litMat(tex: THREE.Texture, rep: [number, number], kind: number, tint: [number, number, number] = [1, 1, 1], alpha = false) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ map: { value: tex }, uRep: { value: new THREE.Vector2(...rep) }, uTint: { value: new THREE.Vector3(...tint) }, uKind: { value: kind }, uAlpha: { value: alpha ? 1 : 0 } }, shared, THREE.UniformsLib.fog),
    vertexShader: VERT, fragmentShader: FRAG, fog: true, transparent: alpha, depthWrite: !alpha
  });
}
const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;

export function makeMaterials(TEX: Textures) {
  const pit = litMat(TEX.carpet, [1, 1], 4); pit.side = THREE.BackSide;
  return {
    walls: TEX.walls.map(t => litMat(t, [1, 1], 1)),
    yellower: TEX.walls.map(t => litMat(t, [1, 1], 1, [1.04, 1.0, .86])),
    pale: litMat(TEX.pale, [1, 1], 1), arch: litMat(TEX.pale, [1 / S, 1 / H], 1), pillar: litMat(TEX.walls[0], [.2, 1], 1),
    floor: litMat(TEX.carpet, [2, 2], 0), tile: litMat(TEX.carpet, [.5, .5], 0), ceil: litMat(TEX.ceil, [1, 1], 2), water: litMat(TEX.carpet, [1, 1], 3), pit,
    tally: litMat(TEX.tally, [1, 1], 1, [1, 1, 1], true),
    panel: new THREE.MeshBasicMaterial({ map: TEX.panel }), fpanel: new THREE.MeshBasicMaterial({ map: TEX.panel }),
    dead: new THREE.MeshBasicMaterial({ color: 0x3b382b }), black: new THREE.MeshBasicMaterial({ color: 0x050402 }),
    flicker: new THREE.MeshBasicMaterial({ color: 0xfff6cf }),
    exit: new THREE.MeshBasicMaterial({ color: 0xe6d36a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    proxy: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    figure: new THREE.MeshBasicMaterial({ map: TEX.figure, transparent: true, opacity: .5, depthWrite: false }),
    red: litMat(TEX.red, [1, 1], 1), mwall: litMat(TEX.manila, [1, 1], 1),
    frame: litMat(TEX.walls[0], [1 / S, 1 / H], 1), mframe: litMat(TEX.manila, [1 / S, 1 / H], 1),
    wood: litMat(TEX.wood, [1, 1], 5), furn: litMat(TEX.wood, [1, 1], 6, [.85, .76, .66]), furnDark: litMat(TEX.doorManila, [1, 1], 6),
    door_wood: litMat(TEX.doorWood, [1, 1], 6), door_metal: litMat(TEX.doorMetal, [1, 1], 6), door_manila: litMat(TEX.doorManila, [1, 1], 6),
    knob: new THREE.MeshBasicMaterial({ color: 0x2c2719 }), paper: litMat(TEX.paper, [1, 1], 6), peel: litMat(TEX.peel, [1, 1], 1, [1, 1, 1], true),
    bottle: {
      grey: litMat(white, [1, 1], 6, [.62, .63, .6]), green: litMat(white, [1, 1], 6, [.37, .56, .39]),
      blue: litMat(white, [1, 1], 6, [.31, .43, .6]), reddish: litMat(white, [1, 1], 6, [.63, .28, .23])
    } as Record<string, THREE.ShaderMaterial>,
    cap: litMat(white, [1, 1], 6, [.22, .21, .17]),
    thing: {
      snack_bar: litMat(white, [1, 1], 6, [.7, .35, .2]), crowbar: litMat(white, [1, 1], 6, [.55, .14, .1]), flashlight: litMat(white, [1, 1], 6, [.15, .15, .14]),
      bandage: litMat(white, [1, 1], 6, [.9, .88, .82]), earplugs: litMat(white, [1, 1], 6, [.9, .5, .15]), watch: litMat(white, [1, 1], 6, [.35, .3, .22]),
      firesalt: litMat(white, [1, 1], 6, [.95, .95, .92]), almond_water: litMat(white, [1, 1], 6, [.62, .63, .6])
    } as Record<string, THREE.ShaderMaterial>,
    body: litMat(white, [1, 1], 6, [.25, .24, .2])
  };
}
export type Materials = ReturnType<typeof makeMaterials>;

export function makeGeometry() {
  return {
    floor: new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2),
    tile: new THREE.PlaneGeometry(.5, .5).rotateX(-Math.PI / 2),
    ceil: new THREE.PlaneGeometry(S, S).rotateX(Math.PI / 2).translate(0, H, 0),
    wall: new THREE.BoxGeometry(S + .13, H + .02, .14).translate(0, H / 2 - .01, 0),
    panel: new THREE.PlaneGeometry(.62, 1.24).rotateX(Math.PI / 2).translate(0, H - .01, 0),
    pillar: new THREE.BoxGeometry(.7, H + .02, .7).translate(0, H / 2 - .01, 0),
    pit: new THREE.BoxGeometry(1, 3.2, 1).translate(0, -1.6, 0),
    hole: new THREE.PlaneGeometry(.92, .92).rotateX(Math.PI / 2),
    water: new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2).translate(0, .015, 0),
    exit: new THREE.PlaneGeometry(S * .82, H * .9).translate(0, H * .47, 0),
    tally: new THREE.PlaneGeometry(1.1, .69),
    figure: new THREE.PlaneGeometry(.62, 1.75).translate(0, .875, 0),
    arch: (() => {
      const y0 = -.02, s = new THREE.Shape(); s.moveTo(-S / 2 - .065, y0); s.lineTo(S / 2 + .065, y0); s.lineTo(S / 2 + .065, H); s.lineTo(-S / 2 - .065, H); s.closePath();
      const w = 1.1, top = 1.75, p = new THREE.Path(); p.moveTo(-w, y0); p.lineTo(-w, top); p.absarc(0, top, w, Math.PI, 0, true); p.lineTo(w, y0); p.closePath(); s.holes.push(p);
      return new THREE.ExtrudeGeometry(s, { depth: .3, bevelEnabled: false }).translate(0, 0, -.15);
    })(),
    doorframe: (() => {
      const y0 = -.02, s = new THREE.Shape(); s.moveTo(-S / 2 - .065, y0); s.lineTo(S / 2 + .065, y0); s.lineTo(S / 2 + .065, H + .01); s.lineTo(-S / 2 - .065, H + .01); s.closePath();
      const p = new THREE.Path(); p.moveTo(-.475, y0); p.lineTo(-.475, 2.1); p.lineTo(.475, 2.1); p.lineTo(.475, y0); p.closePath(); s.holes.push(p);
      return new THREE.ExtrudeGeometry(s, { depth: .14, bevelEnabled: false }).translate(0, 0, -.07);
    })(),
    leaf: new THREE.BoxGeometry(.93, 2.08, .045).translate(.465, 1.04, 0),
    knob: new THREE.BoxGeometry(.05, .05, .15),
    peel: new THREE.PlaneGeometry(.9, .9),
    bottle: new THREE.CylinderGeometry(.075, .075, .3, 16).translate(0, .15, 0),
    cap: new THREE.CylinderGeometry(.06, .06, .05, 12).translate(0, .325, 0),
    proxy: new THREE.SphereGeometry(.42, 8, 6).translate(0, .2, 0),
    box: new THREE.BoxGeometry(1, 1, 1),
    tableTop: new THREE.CylinderGeometry(.78, .78, .05, 8).translate(0, .76, 0),
    cabinet: new THREE.CylinderGeometry(.52, .58, .72, 8).translate(0, .36, 0),
    seat: new THREE.BoxGeometry(.44, .05, .44).translate(0, .46, 0),
    chairBack: new THREE.BoxGeometry(.44, .5, .05).translate(0, .74, -.2),
    leg: new THREE.BoxGeometry(.04, .46, .04).translate(0, .23, 0),
    paper: new THREE.PlaneGeometry(.3, .21).rotateX(-Math.PI / 2).translate(0, .79, 0),
    salt: new THREE.IcosahedronGeometry(.07, 0),
    things: {
      snack_bar: new THREE.BoxGeometry(.18, .03, .07).translate(0, .015, 0), crowbar: new THREE.BoxGeometry(.75, .03, .04).translate(0, .015, 0),
      flashlight: new THREE.CylinderGeometry(.03, .035, .22, 10).rotateZ(Math.PI / 2).translate(0, .035, 0), bandage: new THREE.CylinderGeometry(.045, .045, .06, 12).translate(0, .03, 0),
      earplugs: new THREE.BoxGeometry(.05, .02, .03).translate(0, .01, 0), watch: new THREE.BoxGeometry(.06, .015, .06).translate(0, .008, 0),
      firesalt: new THREE.IcosahedronGeometry(.05, 0).translate(0, .04, 0), almond_water: new THREE.CylinderGeometry(.07, .07, .26, 14).translate(0, .13, 0)
    } as Record<string, THREE.BufferGeometry>
  };
}
export type Geometry = ReturnType<typeof makeGeometry>;
