/**
 * P007 FocusWitness — Zernike Pupil Basis and Wavefront Calculation
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 5.1: Fixed discrete configuration, pupil coordinates, orthonormal Zernike formulas
 * - PROJECT_BOOK.md Section 5.2: Wavefront W(u,v) = a0*Z22 + a1*Z31 + a2*Z40
 * - IMPLEMENTATION_PLAN.md Section 3.3: wavefront(coefficients: Coefficients): Float64Array
 */

import type { Coefficients } from '../domain/types';
import {
  GRID_SIZE,
  PIXEL_COUNT,
  PUPIL_RADIUS_PX,
  PUPIL_CENTER_X,
  PUPIL_CENTER_Y,
} from '../domain/constants';

export const SQRT_3 = Math.sqrt(3);
export const SQRT_5 = Math.sqrt(5);
export const SQRT_6 = Math.sqrt(6);
export const SQRT_8 = Math.sqrt(8);

/**
 * Normalized pupil coordinate calculation for discrete grid pixel (x, y).
 * Coordinates are centered at pixel center (32, 32) with half-pixel offset:
 * u = (x + 0.5 - 32) / 16
 * v = (y + 0.5 - 32) / 16
 */
export function computePupilCoordinates(
  x: number,
  y: number
): { u: number; v: number; r2: number; inside: boolean } {
  const u = (x + 0.5 - PUPIL_CENTER_X) / PUPIL_RADIUS_PX;
  const v = (y + 0.5 - PUPIL_CENTER_Y) / PUPIL_RADIUS_PX;
  const r2 = u * u + v * v;
  const inside = r2 <= 1.0;
  return { u, v, r2, inside };
}

/**
 * Z20: Defocus (known diversity term).
 * Z20(u, v) = sqrt(3) * (2*r2 - 1) on unit disk, 0 outside.
 */
export function evalZ20(u: number, v: number): number {
  const r2 = u * u + v * v;
  if (r2 > 1.0) return 0;
  return SQRT_3 * (2 * r2 - 1);
}

/**
 * Z22: 0° Astigmatism.
 * Z22(u, v) = sqrt(6) * (u*u - v*v) on unit disk, 0 outside.
 */
export function evalZ22(u: number, v: number): number {
  const r2 = u * u + v * v;
  if (r2 > 1.0) return 0;
  return SQRT_6 * (u * u - v * v);
}

/**
 * Z31: Primary x-Coma.
 * Z31(u, v) = sqrt(8) * (3*r2 - 2) * u on unit disk, 0 outside.
 */
export function evalZ31(u: number, v: number): number {
  const r2 = u * u + v * v;
  if (r2 > 1.0) return 0;
  return SQRT_8 * (3 * r2 - 2) * u;
}

/**
 * Z40: Primary Spherical Aberration.
 * Z40(u, v) = sqrt(5) * (6*r2*r2 - 6*r2 + 1) on unit disk, 0 outside.
 */
export function evalZ40(u: number, v: number): number {
  const r2 = u * u + v * v;
  if (r2 > 1.0) return 0;
  return SQRT_5 * (6 * r2 * r2 - 6 * r2 + 1);
}

export interface ZernikeBasis {
  readonly z20: Float64Array;
  readonly z22: Float64Array;
  readonly z31: Float64Array;
  readonly z40: Float64Array;
  readonly pupilMask: Float64Array;
  readonly activePixelIndices: Int32Array;
}

/**
 * Precomputes discrete grid evaluations for the 4 Zernike modes and pupil mask.
 */
function buildZernikeBasis(): ZernikeBasis {
  const z20 = new Float64Array(PIXEL_COUNT);
  const z22 = new Float64Array(PIXEL_COUNT);
  const z31 = new Float64Array(PIXEL_COUNT);
  const z40 = new Float64Array(PIXEL_COUNT);
  const pupilMask = new Float64Array(PIXEL_COUNT);
  const activeIndicesList: number[] = [];

  for (let y = 0; y < GRID_SIZE; y++) {
    const rowOffset = y * GRID_SIZE;
    for (let x = 0; x < GRID_SIZE; x++) {
      const idx = rowOffset + x;
      const { u, v, r2, inside } = computePupilCoordinates(x, y);

      if (inside) {
        pupilMask[idx] = 1.0;
        z20[idx] = SQRT_3 * (2 * r2 - 1);
        z22[idx] = SQRT_6 * (u * u - v * v);
        z31[idx] = SQRT_8 * (3 * r2 - 2) * u;
        z40[idx] = SQRT_5 * (6 * r2 * r2 - 6 * r2 + 1);
        activeIndicesList.push(idx);
      } else {
        pupilMask[idx] = 0.0;
        z20[idx] = 0.0;
        z22[idx] = 0.0;
        z31[idx] = 0.0;
        z40[idx] = 0.0;
      }
    }
  }

  const activePixelIndices = new Int32Array(activeIndicesList);

  return {
    z20,
    z22,
    z31,
    z40,
    pupilMask,
    activePixelIndices,
  };
}

const BASIS: ZernikeBasis = buildZernikeBasis();

/**
 * Returns precomputed basis vectors and pupil mask.
 */
export function getZernikeBasis(): ZernikeBasis {
  return BASIS;
}

/**
 * Returns the 64x64 binary pupil mask (1.0 inside aperture, 0.0 outside).
 */
export function getPupilMask(): Float64Array {
  return BASIS.pupilMask;
}

/**
 * Computes the optical wavefront phase in units of waves across the 64x64 grid.
 *
 * Wavefront formula per PROJECT_BOOK.md Section 5.2:
 * W(u, v) = a0*Z22 + a1*Z31 + a2*Z40
 * (Excludes known defocus d*Z20 to facilitate comparing hidden unknown aberrations).
 * Outside the circular pupil aperture, values are masked to 0.0.
 *
 * @param coefficients Unknown aberration coefficients (astig0, comaX, spherical)
 * @returns Float64Array of 4096 elements in row-major order
 */
export function wavefront(coefficients: Coefficients): Float64Array {
  if (
    !coefficients ||
    typeof coefficients.astig0 !== 'number' ||
    typeof coefficients.comaX !== 'number' ||
    typeof coefficients.spherical !== 'number' ||
    !Number.isFinite(coefficients.astig0) ||
    !Number.isFinite(coefficients.comaX) ||
    !Number.isFinite(coefficients.spherical)
  ) {
    throw new TypeError('wavefront: coefficients must contain finite astig0, comaX, and spherical numbers');
  }

  const a0 = coefficients.astig0;
  const a1 = coefficients.comaX;
  const a2 = coefficients.spherical;

  const out = new Float64Array(PIXEL_COUNT);
  const activeIndices = BASIS.activePixelIndices;
  const len = activeIndices.length;
  const z22 = BASIS.z22;
  const z31 = BASIS.z31;
  const z40 = BASIS.z40;

  for (let i = 0; i < len; i++) {
    const idx = activeIndices[i]!;
    const val = a0 * z22[idx]! + a1 * z31[idx]! + a2 * z40[idx]!;
    // Adding + 0 normalizes -0 to +0
    out[idx] = val === 0 ? 0 : val;
  }

  return out;
}
