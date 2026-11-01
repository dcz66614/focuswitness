/**
 * P007 FocusWitness — PSF Forward Imaging Model
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 5.1: Discrete optical geometry (N=64, pupil radius=16px)
 * - PROJECT_BOOK.md Section 5.2: Fraunhofer forward model, phase phi(x,y; a, d), FFT2, fftshift, normalization
 * - PROJECT_BOOK.md Chapter 7: MATH03 (sum equals 1 within 1e-12), MATH04 (perfect PSF max diff <= 1e-10)
 * - IMPLEMENTATION_PLAN.md Section 3.3: forwardPsf(coefficients: Coefficients, defocusWaves: FocusPlane): Float64Array
 */

import type { Coefficients, FocusPlane } from '../domain/types';
import { GRID_SIZE, PIXEL_COUNT } from '../domain/constants';
import { fft2, fftshift } from './fft';
import { getZernikeBasis, wavefront } from './zernike';

export { wavefront } from './zernike';

export interface ComplexField {
  re: Float64Array;
  im: Float64Array;
}

/**
 * Computes the complex pupil field P(x, y; a, d) = A(x, y) * exp(i * phi)
 * on the 64x64 grid.
 *
 * phi(x, y; a, d) = 2*pi * (a0*Z22 + a1*Z31 + a2*Z40 + d*Z20)
 * Outside the pupil aperture, A(x, y) = 0, so real and imaginary parts are strictly 0.0.
 */
export function computePupilField(
  coefficients: Coefficients,
  defocusWaves: number
): ComplexField {
  if (
    !coefficients ||
    typeof coefficients.astig0 !== 'number' ||
    typeof coefficients.comaX !== 'number' ||
    typeof coefficients.spherical !== 'number' ||
    !Number.isFinite(coefficients.astig0) ||
    !Number.isFinite(coefficients.comaX) ||
    !Number.isFinite(coefficients.spherical)
  ) {
    throw new TypeError(
      'computePupilField: coefficients must contain finite astig0, comaX, and spherical numbers'
    );
  }

  if (typeof defocusWaves !== 'number' || !Number.isFinite(defocusWaves)) {
    throw new TypeError('computePupilField: defocusWaves must be a finite number');
  }

  const basis = getZernikeBasis();
  const activeIndices = basis.activePixelIndices;
  const len = activeIndices.length;

  const z20 = basis.z20;
  const z22 = basis.z22;
  const z31 = basis.z31;
  const z40 = basis.z40;

  const a0 = coefficients.astig0;
  const a1 = coefficients.comaX;
  const a2 = coefficients.spherical;
  const d = defocusWaves;

  const twoPi = 2.0 * Math.PI;

  const re = new Float64Array(PIXEL_COUNT);
  const im = new Float64Array(PIXEL_COUNT);

  for (let i = 0; i < len; i++) {
    const idx = activeIndices[i]!;
    const phi = twoPi * (a0 * z22[idx]! + a1 * z31[idx]! + a2 * z40[idx]! + d * z20[idx]!);
    re[idx] = Math.cos(phi);
    im[idx] = Math.sin(phi);
  }

  return { re, im };
}

/**
 * Forward model: computes the 64x64 PSF intensity distribution for given aberration
 * coefficients and defocus diversity.
 *
 * Steps per PROJECT_BOOK.md Section 5.2:
 * 1. P(x,y; a, d) = A(x,y) * [cos(phi) + i*sin(phi)]
 * 2. F = FFT2(P)
 * 3. Iraw = fftshift(|F|^2) (zero frequency shifted to display center)
 * 4. I[k] = Iraw[k] / sum(Iraw) (normalized so sum equals 1.0)
 *
 * @param coefficients Unknown aberration coefficients (astig0, comaX, spherical) in waves
 * @param defocusWaves Defocus diversity in waves (e.g. -0.65 or +0.65)
 * @returns Shifted and normalized 4096 Float64Array
 */
export function forwardPsf(
  coefficients: Coefficients,
  defocusWaves: FocusPlane | number
): Float64Array {
  // 1. Complex pupil field P
  const { re, im } = computePupilField(coefficients, defocusWaves);

  // 2. 2D FFT
  const F = fft2(re, im, GRID_SIZE, false);

  // 3. |F|^2 power spectrum
  const rawPower = new Float64Array(PIXEL_COUNT);
  const fRe = F.re;
  const fIm = F.im;
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const r = fRe[i]!;
    const m = fIm[i]!;
    rawPower[i] = r * r + m * m;
  }

  // 4. fftshift: move zero-frequency to display center (32, 32)
  const shifted = fftshift(rawPower, GRID_SIZE);

  // 5. Normalization: sum(I) = 1.0
  let totalPower = 0.0;
  for (let i = 0; i < PIXEL_COUNT; i++) {
    totalPower += shifted[i]!;
  }

  const out = new Float64Array(PIXEL_COUNT);
  if (totalPower > 0) {
    const invTotal = 1.0 / totalPower;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      out[i] = shifted[i]! * invTotal;
    }
  }

  return out;
}
