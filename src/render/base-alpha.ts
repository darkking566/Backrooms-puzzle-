/* Lived-in props share reusable geometry/materials. No NPC model or gameplay state here. */
import * as THREE from "three";
import type { Level1 } from "../world/level1";
import { S } from "../world/types";
import type { Geometry, Materials } from "./materials";
import type { Pick } from "./view";

export function buildBaseAlpha(w: Level1, G: Geometry, M: Materials, add: (o: THREE.Object3D, pick?: Pick) => void) {
  const angle = Math.PI / 2 - w.rotation * Math.PI / 2;
  const box = (u: number, y: number, v: number, a: number, h: number, b: number, mat: THREE.Material, pick?: Pick) => {
    const mesh = new THREE.Mesh(G.box, mat), [x, z] = w.global(w.distance + u / S, v / S);
    mesh.position.set(x * S, y, z * S); mesh.rotation.y = angle; mesh.scale.set(a, h, b); add(mesh, pick); return mesh;
  };
  for (const u of [.1, 3.5]) {
    box(u, .38, 4.45, 2, .12, 1.05, M.metal);
    for (const du of [-.8, .8]) for (const dv of [-.35, .35]) box(u + du, .18, 4.45 + dv, .06, .36, .06, M.metal);
    box(u, .5, 4.45, 1.95, .17, 1, M.thing.bandage);
    box(u + .2, .6, 4.45, 1.45, .07, 1.02, M.blanket);
    box(u - .72, .63, 4.45, .37, .15, .7, M.thing.bandage);
    box(u, .16, 5.4, .65, .25, .5, M.furnDark);
  }
  box(1.8, .88, 5.85, 7.2, 1.76, .09, M.metal);
  box(2.7, .84, -1.12, 2.65, .12, .85, M.furn);
  for (const du of [-1.1, 1.1]) for (const dv of [-.3, .3]) box(2.7 + du, .4, -1.12 + dv, .07, .8, .07, M.metal);
  box(2.7, 1.63, -1.88, 2.5, 1.15, .1, M.furnDark, { kind: "noticeboard" });
  for (const [u, y, width, height] of [[1.85, 1.78, .36, .37], [2.45, 1.56, .54, .5], [3.25, 1.81, .47, .29]]) {
    box(u, y, -1.81, width, height, .012, M.paper, { kind: "noticeboard" });
    for (let n = 0; n < 3; n++) box(u, y + .07 - n * .065, -1.8, width * .65, .013, .012, M.cap);
  }
  // Two mismatched seats, a folded coat and a cup mark the elder's place.
  for (const u of [1.25, 4.5]) {
    box(u, .47, .55, .48, .07, .48, M.furn);
    box(u, .78, .78, .48, .57, .06, M.furn);
    for (const du of [-.19, .19]) for (const dv of [-.19, .19]) box(u + du, .23, .55 + dv, .04, .46, .04, M.metal);
  }
  box(4.5, .56, .55, .48, .12, .36, M.blanket, { kind: "elder" });
  const object = (geo: THREE.BufferGeometry, mat: THREE.Material, u: number, y: number, v: number, scale: number, pick?: Pick) => {
    const mesh = new THREE.Mesh(geo, mat), [x, z] = w.global(w.distance + u / S, v / S);
    mesh.position.set(x * S, y, z * S); mesh.scale.setScalar(scale); add(mesh, pick); return mesh;
  };
  object(G.bottle, M.metal, 3.1, .9, -1.13, 1.5, { kind: "elder" });
  object(G.cap, M.cap, 3.1, .9, -1.13, 1.5);
  box(3.3, 1.13, -1.13, .19, .05, .05, M.metal); // kettle spout
  box(2.75, 1.12, -1.13, .05, .25, .16, M.metal); // handle
  object(G.bottle, M.thing.bandage, 3.62, .9, -1.05, .5, { kind: "elder" });
  box(2.1, .91, -.95, .45, .015, .27, M.paper);
  object(G.bottle, M.bottle.green, .6, .02, 5.3, 1);
  object(G.bottle, M.bottle.grey, .9, .02, 5.3, .8);
  box(1.7, .93, -1.26, .35, .05, .3, M.metal);
  box(1.7, 1.15, -1.26, .035, .42, .035, M.metal);
  box(1.7, 1.42, -1.26, .45, .19, .35, M.alphaLamp);
  box(2.2, 2.7, 1.5, 1.6, .08, .26, M.alphaLamp);
}
