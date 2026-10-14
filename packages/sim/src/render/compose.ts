/**
 * Facade composition for building ORIENTATION: buildings are authored
 * facing south on an (L along the street × D deep) canvas, then composed
 * onto their footprint for the real frontage. Shared by the facade lots
 * (townRender) and the courthouse (civic.ts).
 */
import { hexToRgb, shade, type RGB } from "../palette.js";
import { C, type Put } from "./core.js";

/**
 * Compose a south-authored facade canvas (L × D, street at the bottom)
 * onto its footprint for frontage o, following the 3/4-from-the-south
 * camera: the visible wall strip is always the building's SOUTH face.
 *  - S: as authored (front wall visible).
 *  - N: street at the top. The front collapses to a 1-row sign/awning
 *    overhang on the north roof edge, the roof fills the body, and the
 *    visible south strip is a plain BACK wall (service door, AC, cans).
 *  - E/W: turned 90° so the ridge and front strip run along the street;
 *    the south face becomes a SIDE wall with side windows.
 */
export function composeFacade(
  buf: Array<RGB | null>,
  L: number,
  D: number,
  o: number,
  by0: number,
  faceTop: number,
  by1: number,
  bx0: number,
  bx1: number,
  body: RGB,
  planFlip: boolean,
  AX: number,
  AY: number,
  FW: number,
  FH: number,
  clip: Put,
): void {
  const out = (l: number, d: number, c: RGB): void => {
    let x: number, y: number;
    if (o === 0) { x = l; y = d; }
    else if (o === 1) { x = l; y = D - 1 - d; }
    else if (o === 2) { x = d; y = L - 1 - l; }
    else { x = D - 1 - d; y = l; }
    if (x < 0 || y < 0 || x >= FW || y >= FH) return;
    clip(AX + x, AY + y, c);
  };
  if (o === 0 || planFlip) {
    for (let d = 0; d < D; d++) for (let l = 0; l < L; l++) {
      const c = buf[d * L + l];
      if (c) out(l, d, c);
    }
    return;
  }
  const roofRows = Math.max(0, faceTop - by0);
  const backRows = o === 1 ? (by1 - by0 >= 5 ? 2 : 1) : 0;
  const sideCols = o >= 2 ? 2 : 0;
  const backWall = shade(body, 0.9);
  for (let d = 0; d < D; d++) {
    for (let l = 0; l < L; l++) {
      let src = d; // canvas row to sample
      let c: RGB | null;
      if (d < by0 || d > by1 || l < bx0 || l > bx1) {
        c = buf[d * L + l]!; // apron / margins as authored
        if (!c) continue;
        out(l, d, c);
        continue;
      }
      if (d === by1) src = faceTop; // the collapsed front strip
      else if (d < by0 + backRows) src = -1; // back wall
      else {
        // stretch the roof band over the body
        const span = by1 - (by0 + backRows);
        const k = d - (by0 + backRows);
        src = roofRows > 0 ? by0 + Math.min(roofRows - 1, Math.floor((k * roofRows) / Math.max(1, span))) : -2;
      }
      if (src === -1) {
        c = l === ((bx0 + bx1) >> 1) ? C.door : l === bx1 - 1 ? hexToRgb("#9aa0a6") : l === bx0 + 1 ? hexToRgb("#3a4a3a") : backWall;
        if (d === by0 && backRows > 1) c = shade(backWall, 0.92);
      } else if (src === -2) {
        c = shade(body, 0.8);
      } else {
        c = buf[src * L + l] ?? shade(body, 0.8);
      }
      // E/W: the lateral end that faces the camera becomes a side wall
      if (sideCols > 0 && d >= by0 && d < by1) {
        const endL = o === 2 ? bx0 : bx1; // canvas column that lands at screen-south
        const k = o === 2 ? l - endL : endL - l;
        if (k >= 0 && k < sideCols) c = k === 0 && (d - by0) % 3 === 1 ? C.windowDark : shade(body, k === 0 ? 0.92 : 0.84);
      }
      out(l, d, c);
    }
  }
}

