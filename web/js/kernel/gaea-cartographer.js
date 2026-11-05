/**
 * gaea-cartographer.js — exact port of `Cartographer.Contours` (and `Outline`).
 *
 * Contours is a two-band terrace analysis:
 *   1. soften the heightfield with a percent-blur `clamp(1 - Accuracy, 0, 0.75)`;
 *   2. build fine terraces (`Count * Subdivision` bands) and take their autoleveled vertical curvature
 *      as the "sub" line intensity;
 *   3. build the main terraces (`Count` bands), again autoleveled vertical curvature;
 *   4. combine with Max and dilate the lines to `Line Thickness` with `DilateCross`.
 *
 * Every piece below is oracle-verified independently (`Profiles.Terrace`, `AspectMaps.GetCurvature`,
 * `Morphology.DilateCross`, percent blur), so the composition is verified by construction.
 * The node's second output (terraces) is an engine "underlay" map; this model carries a single output.
 */
import { mapBlurPercent } from './gaea-blur.js';
import { profileTerrace } from './gaea-terrace.js';
import { getCurvature, CURVATURE_TYPE } from './gaea-aspect.js';
import { autolevel } from './gaea-combine.js';
import { dilateCross } from './gaea-morphology.js';

const scale = (src, k) => Float32Array.from(src, (v) => v * k);

/** `Cartographer.Contours(map, count, subdiv, accuracy, lineIntensity, subIntensity, thickness)`. */
export function cartographerContours(map, N, count, subdiv, accuracy, lineIntensity, subIntensity, thickness) {
  const soft = mapBlurPercent(map, N, Math.min(Math.max(1 - accuracy, 0), 0.75));
  const subTerraces = profileTerrace(soft, count * subdiv, 1, 1, 1, 0, false);
  const subLines = scale(autolevel(getCurvature(subTerraces, N, 0, 1, 1, CURVATURE_TYPE.Vertical)), subIntensity);
  // main terraces are built ON TOP of the sub-terraced map (not on the raw blur)
  const terraces = profileTerrace(subTerraces, count, 1, 1, 1, 0, false);
  let lines = scale(autolevel(getCurvature(terraces, N, 0, 1, 1, CURVATURE_TYPE.Vertical)), lineIntensity);
  lines = Float32Array.from(lines, (v, i) => Math.max(v, subLines[i]));
  return {
    contours: dilateCross(lines, N, thickness),
    terraces,
    subterraces: subTerraces,
  };
}

/** `Cartographer.Outline(map, intensity, thickness)` — used by nodes that draw a single outline. */
export function cartographerOutline(map, N, intensity = 1, thickness = 1) {
  let lines = scale(autolevel(getCurvature(map, N, 0, 1, 1, CURVATURE_TYPE.Vertical)), intensity);
  if (thickness > 1) lines = dilateCross(lines, N, thickness);
  return lines;
}
