/* Procedural textures: everything is drawn on canvases at start-up, no image files. */
import * as THREE from "three";
import { mulberry } from "../core/rng";

let aniso = 1;
function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d", { willReadFrequently: true })!; draw(x, w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; return t;
}
function noise(x: CanvasRenderingContext2D, w: number, h: number, amt: number, rnd: () => number) { const d = x.getImageData(0, 0, w, h); for (let i = 0; i < d.data.length; i += 4) { const v = (rnd() - .5) * amt; d.data[i] += v; d.data[i + 1] += v; d.data[i + 2] += v * .8; } x.putImageData(d, 0, 0); }
function wallpaper(base: string, stripe: string, seed: number, stains: number) {
  return canvasTex(512, 352, (x, w, h) => {
    const r = mulberry(seed);
    x.fillStyle = base; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 32) { x.fillStyle = stripe; x.fillRect(i, 0, 12, h); }
    x.fillStyle = "rgba(90,70,20,.10)";
    for (let i = 16; i < w; i += 32) for (let j = 10; j < h; j += 26) { x.beginPath(); x.moveTo(i, j - 5); x.lineTo(i + 4, j); x.lineTo(i, j + 5); x.lineTo(i - 4, j); x.fill(); }
    for (let k = 0; k < stains; k++) {
      const cx = r() * w, cy = h * (.55 + r() * .5), rad = 20 + r() * 90;
      const sg = x.createRadialGradient(cx, cy, 0, cx, cy, rad); sg.addColorStop(0, "rgba(95,70,20,.28)"); sg.addColorStop(.7, "rgba(110,85,25,.12)"); sg.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = sg; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
    noise(x, w, h, 22, r);
  });
}
function doorTex(kind: "wood" | "metal" | "manila") {
  return canvasTex(128, 256, (x, w, h) => {
    const r = mulberry(kind === "metal" ? 81 : kind === "manila" ? 83 : 82);
    if (kind === "metal") {
      x.fillStyle = "#6c7366"; x.fillRect(0, 0, w, h);
      for (let k = 0; k < 7; k++) { const cx = r() * w, cy = h * (.25 + r() * .75), rad = 10 + r() * 40, g = x.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, "rgba(112,62,26,.45)"); g.addColorStop(1, "rgba(112,62,26,0)"); x.fillStyle = g; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); }
      x.strokeStyle = "rgba(30,32,28,.55)"; x.lineWidth = 3; x.strokeRect(9, 9, w - 18, h - 18);
      x.fillStyle = "rgba(38,40,34,.85)"; for (const [px, py] of [[15, 15], [w - 15, 15], [15, h - 15], [w - 15, h - 15]]) { x.beginPath(); x.arc(px, py, 2.6, 0, 7); x.fill(); }
      x.fillStyle = "#bdb79c"; x.fillRect(24, 58, w - 48, 22); x.fillStyle = "rgba(50,46,34,.75)"; for (let k = 0; k < 5; k++) x.fillRect(30 + k * 14, 66, 9, 6);
      x.fillStyle = "rgba(40,40,34,.6)"; x.fillRect(0, h - 34, w, 34);
    } else {
      const base = kind === "manila" ? [104, 68, 38] : [138, 108, 66];
      x.fillStyle = `rgb(${base.join(",")})`; x.fillRect(0, 0, w, h);
      for (let k = 0; k < 40; k++) { x.strokeStyle = `rgba(50,30,12,${.06 + r() * .12})`; x.lineWidth = 1; const gx = r() * w; x.beginPath(); x.moveTo(gx, 0); x.bezierCurveTo(gx + (r() - .5) * 8, h * .3, gx + (r() - .5) * 8, h * .7, gx + (r() - .5) * 4, h); x.stroke(); }
      x.strokeStyle = "rgba(40,24,10,.55)"; x.lineWidth = 3;
      if (kind === "wood") {                                  // the old wooden door with a small window
        x.fillStyle = "#14130d"; x.fillRect(28, 26, 72, 74);
        const g = x.createLinearGradient(28, 26, 100, 100); g.addColorStop(0, "rgba(200,190,140,.22)"); g.addColorStop(1, "rgba(200,190,140,.04)"); x.fillStyle = g; x.fillRect(28, 26, 72, 74);
        x.fillStyle = `rgb(${base.join(",")})`; x.fillRect(62, 26, 4, 74); x.fillRect(28, 61, 72, 4);
        x.strokeRect(28, 26, 72, 74); x.strokeRect(24, 130, 80, 104);
      } else { x.strokeRect(20, 20, 88, 96); x.strokeRect(20, 134, 88, 102); }
    }
    noise(x, w, h, 16, r);
  });
}
export function makeTextures(maxAniso: number) {
  aniso = maxAniso;
  return {
  concrete: canvasTex(256, 256, (x, w, h) => {
    const r = mulberry(1901); x.fillStyle = "#9b9fa0"; x.fillRect(0, 0, w, h);
    noise(x, w, h, 35, r); x.strokeStyle = "rgba(38,43,45,.3)"; x.lineWidth = 2;
    x.strokeRect(1, 1, w - 2, h - 2);
    for (let n = 0; n < 24; n++) { const a = r() * w, b = r() * h; x.beginPath(); x.moveTo(a, b); x.lineTo(a + r() * 12, b + r() * 18); x.stroke(); }
  }),
  alphaSign: canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = "#697879"; x.fillRect(0, 0, w, h); x.strokeStyle = "#eeeedd"; x.lineWidth = 6; x.strokeRect(10, 10, w - 20, h - 20);
    x.fillStyle = "#eeeedd"; x.font = "bold 82px sans-serif"; x.textAlign = "center"; x.fillText("A", w / 2, 96);
  }),
  walls: [0, 1, 2].map(k => wallpaper("#cdb75a", "rgba(225,205,120,.35)", 11 + k, 3 + k * 2)),
  pale: wallpaper("#d8d0a8", "rgba(240,232,200,.4)", 41, 2),
  carpet: canvasTex(256, 256, (x, w, h) => {        // tight Berber loops, seamless on all four edges
    const r = mulberry(5); x.fillStyle = "#94805a"; x.fillRect(0, 0, w, h);
    const loop = (cx: number, cy: number, rw: number, rh: number, col: string) => { for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { x.fillStyle = col; x.beginPath(); x.ellipse(cx + ox, cy + oy, rw, rh, 0, 0, 7); x.fill(); } };
    for (let row = 0; row < 32; row++) for (let k = 0; k < 32; k++) {
      const cx = k * 8 + (row % 2) * 4 + (r() - .5) * 1.5, cy = row * 8 + (r() - .5) * 1.5;
      const v = r(); loop(cx, cy, 3.4, 2.6, v < .45 ? "rgba(70,55,30,.55)" : v < .8 ? "rgba(168,148,104,.6)" : "rgba(122,102,66,.6)");
      loop(cx - .6, cy - .7, 1.5, 1.1, "rgba(200,182,140,.35)");
    }
    noise(x, w, h, 26, r);
  }),
  ceil: canvasTex(256, 256, (x, w, h) => {
    const r = mulberry(9); x.fillStyle = "#d6d0ae"; x.fillRect(0, 0, w, h);
    for (let k = 0; k < 900; k++) { x.fillStyle = "rgba(90,80,50,.25)"; x.fillRect(r() * w, r() * h, 1.5, 1.5); }
    x.strokeStyle = "rgba(141,133,106,.55)"; x.lineWidth = 2; x.strokeRect(0, 0, w, h); x.beginPath(); x.moveTo(w / 2, 0); x.lineTo(w / 2, h); x.moveTo(0, h / 2); x.lineTo(w, h / 2); x.stroke();
    noise(x, w, h, 14, r);
  }),
  panel: canvasTex(128, 256, (x, w, h) => {
    x.fillStyle = "#fffbe6"; x.fillRect(0, 0, w, h);
    x.strokeStyle = "rgba(170,160,120,.55)"; x.lineWidth = 2; for (let i = 8; i < w; i += 10) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, h); x.stroke(); } for (let j = 8; j < h; j += 10) { x.beginPath(); x.moveTo(0, j); x.lineTo(w, j); x.stroke(); }
    x.strokeStyle = "#b7ae8e"; x.lineWidth = 8; x.strokeRect(0, 0, w, h);
  }),
  tally: canvasTex(320, 200, (x, w, h) => {      // scratched tally marks: lighter plaster showing through the wallpaper
    const r = mulberry(1234); x.clearRect(0, 0, w, h); x.lineCap = "round";
    const scratch = (x0: number, y0: number, x1: number, y1: number) => {
      x.strokeStyle = "rgba(60,45,15,.55)"; x.lineWidth = 3.2; x.beginPath(); x.moveTo(x0 + 1.2, y0 + 1.2); x.lineTo(x1 + 1.2, y1 + 1.2); x.stroke();
      x.strokeStyle = "rgba(246,238,205,.95)"; x.lineWidth = 2; x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo((x0 + x1) / 2 + (r() - .5) * 4, (y0 + y1) / 2, x1, y1); x.stroke();
    };
    let gx = 14, gy = 18;
    for (let g = 0; g < 11; g++) {
      const n = g === 10 ? 3 : 5;
      for (let k = 0; k < Math.min(n, 4); k++) { const xx = gx + k * 9 + (r() - .5) * 3; scratch(xx, gy + (r() - .5) * 4, xx + (r() - .5) * 5, gy + 44 + (r() - .5) * 5); }
      if (n === 5) scratch(gx - 5, gy + 34 + r() * 4, gx + 38, gy + 8 + r() * 4);
      gx += 58 + (r() - .5) * 6; if (gx > w - 50) { gx = 14 + r() * 8; gy += 62; }
    }
  }),
  red: wallpaper("#6a1712", "rgba(132,30,24,.4)", 61, 6),
  manila: wallpaper("#b3925f", "rgba(198,170,120,.35)", 51, 2),
  wood: canvasTex(256, 256, (x, w, h) => {        // floor planks, 0.5 m wide; seamless on all four edges
    const r = mulberry(71);
    for (let p = 0; p < 8; p++) {
      const y = p * 32, tone = 92 + r() * 30;
      x.fillStyle = `rgb(${tone + 42},${tone + 8},${tone - 32})`; x.fillRect(0, y, w, 32);
      for (let g = 0; g < 12; g++) { x.strokeStyle = `rgba(60,34,14,${.07 + r() * .13})`; x.lineWidth = 1; const gy = y + 2 + r() * 28; x.beginPath(); x.moveTo(0, gy); x.bezierCurveTo(w * .3, gy + (r() - .5) * 6, w * .7, gy + (r() - .5) * 6, w, gy); x.stroke(); }
      x.fillStyle = "rgba(30,18,8,.6)"; x.fillRect(0, y, w, 1.5); x.fillRect(r() * w, y, 1.5, 32);
    }
    noise(x, w, h, 18, r);
  }),
  doorWood: doorTex("wood"), doorMetal: doorTex("metal"), doorManila: doorTex("manila"),
  paper: canvasTex(256, 180, (x, w, h) => {
    const r = mulberry(91); x.fillStyle = "#e6dcc0"; x.fillRect(0, 0, w, h);
    x.strokeStyle = "rgba(120,140,170,.35)"; x.lineWidth = 1; for (let y = 24; y < h; y += 14) { x.beginPath(); x.moveTo(8, y); x.lineTo(w - 8, y); x.stroke(); }
    x.strokeStyle = "rgba(40,35,60,.75)"; x.lineWidth = 1.4;
    for (let y = 22; y < h - 10; y += 14) { let px = 14; const end = w - 20 - r() * 60; x.beginPath(); x.moveTo(px, y); while (px < end) { px += 3 + r() * 4; x.lineTo(px, y - 2 - r() * 5); px += 2; x.lineTo(px, y); } x.stroke(); }
    noise(x, w, h, 10, r);
  }),
  peel: canvasTex(256, 256, (x, w, h) => {       // a torn flap of wallpaper with deep red showing underneath
    const r = mulberry(97); x.clearRect(0, 0, w, h);
    const pts: [number, number][] = []; for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2, rad = 62 + r() * 46; pts.push([w / 2 + Math.cos(a) * rad, h / 2 + Math.sin(a) * rad * 1.1]); }
    const path = () => { x.beginPath(); pts.forEach(([px, py], k) => k ? x.lineTo(px, py) : x.moveTo(px, py)); x.closePath(); };
    x.save(); x.translate(4, 7); x.filter = "blur(4px)"; path(); x.fillStyle = "rgba(30,20,5,.45)"; x.fill(); x.restore(); x.filter = "none";
    path(); x.fillStyle = "#dccb7e"; x.fill();
    x.save(); x.translate(w / 2, h / 2); x.scale(.84, .84); x.translate(-w / 2, -h / 2); path();
    const g = x.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, 120); g.addColorStop(0, "#4e0b08"); g.addColorStop(1, "#8a1c14"); x.fillStyle = g; x.fill(); x.clip();
    for (let k = 0; k < 14; k++) { x.strokeStyle = "rgba(36,3,2,.5)"; x.lineWidth = 1 + r() * 2.5; const sx = r() * w, sy = r() * h * .6; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + (r() - .5) * 6, sy + 40 + r() * 70); x.stroke(); }
    x.restore();
    noise(x, w, h, 18, r);
  }),
  figure: canvasTex(128, 320, (x, w, h) => {     // soft human silhouette for the peripheral shadow
    x.clearRect(0, 0, w, h); x.filter = "blur(6px)"; x.fillStyle = "rgba(6,5,2,1)";
    x.beginPath(); x.ellipse(w / 2, 52, 20, 25, 0, 0, 7); x.fill();
    x.beginPath(); x.moveTo(w / 2 - 34, 92); x.quadraticCurveTo(w / 2, 70, w / 2 + 34, 92); x.lineTo(w / 2 + 28, 210); x.lineTo(w / 2 + 18, 312); x.lineTo(w / 2 - 18, 312); x.lineTo(w / 2 - 28, 210); x.closePath(); x.fill();
  })
  };
}
export type Textures = ReturnType<typeof makeTextures>;
