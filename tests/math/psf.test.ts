/**
 * P007 FocusWitness — Zernike and Forward PSF Unit Tests
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 5.1: Discrete optical geometry, orthonormal Zernike polynomials
 * - PROJECT_BOOK.md Section 5.2: Fraunhofer forward model, wavefront W(u,v)
 * - PROJECT_BOOK.md Chapter 7:
 *   - MATH03: Five presets, each focus plane (-0.65, +0.65): finite, non-negative, |sum(I) - 1| <= 1e-12
 *   - MATH04: 'perfect' preset, +/-0.65: max pixel difference <= 1e-10
 * - IMPLEMENTATION_PLAN.md Section 3.3: Module interfaces
 */

import { describe, it, expect } from 'vitest';
import {
  computePupilCoordinates,
  evalZ20,
  evalZ22,
  evalZ31,
  evalZ40,
  getPupilMask,
  getZernikeBasis,
  wavefront,
  SQRT_3,
  SQRT_5,
  SQRT_6,
  SQRT_8,
} from '../../src/math/zernike';
import { forwardPsf, computePupilField } from '../../src/math/psf';
import { PRESETS } from '../../src/domain/presets';
import {
  GRID_SIZE,
  PIXEL_COUNT,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
} from '../../src/domain/constants';
import type { Coefficients } from '../../src/domain/types';

describe('Zernike Polynomials and Continuous Orthonormality (TASK-P007-T004)', () => {
  describe('Continuous Orthonormality via Numerical Integration', () => {
    // Integrate on continuous unit disk using fine polar grid:
    // (1/pi) * int_0^1 r dr int_0^{2pi} dtheta Z_i(r, theta) * Z_j(r, theta) == delta_{ij}
    const Nr = 200;
    const Nth = 360;
    const dr = 1.0 / Nr;
    const dth = (2.0 * Math.PI) / Nth;

    function innerProduct(
      f1: (u: number, v: number) => number,
      f2: (u: number, v: number) => number
    ): number {
      let sum = 0.0;
      for (let ir = 0; ir < Nr; ir++) {
        const r = (ir + 0.5) * dr;
        for (let ith = 0; ith < Nth; ith++) {
          const theta = (ith + 0.5) * dth;
          const u = r * Math.cos(theta);
          const v = r * Math.sin(theta);
          sum += f1(u, v) * f2(u, v) * r * dr * dth;
        }
      }
      return sum / Math.PI;
    }

    it('evaluates unit norms for Z20, Z22, Z31, Z40 within integration tolerance', () => {
      const normZ20 = innerProduct(evalZ20, evalZ20);
      const normZ22 = innerProduct(evalZ22, evalZ22);
      const normZ31 = innerProduct(evalZ31, evalZ31);
      const normZ40 = innerProduct(evalZ40, evalZ40);

      expect(Math.abs(normZ20 - 1.0)).toBeLessThan(1e-3);
      expect(Math.abs(normZ22 - 1.0)).toBeLessThan(1e-3);
      expect(Math.abs(normZ31 - 1.0)).toBeLessThan(1e-3);
      expect(Math.abs(normZ40 - 1.0)).toBeLessThan(1e-3);
    });

    it('evaluates zero cross-products (orthogonality) between distinct Zernike modes', () => {
      const modes = [
        { name: 'Z20', fn: evalZ20 },
        { name: 'Z22', fn: evalZ22 },
        { name: 'Z31', fn: evalZ31 },
        { name: 'Z40', fn: evalZ40 },
      ];

      for (let i = 0; i < modes.length; i++) {
        for (let j = i + 1; j < modes.length; j++) {
          const cross = innerProduct(modes[i]!.fn, modes[j]!.fn);
          expect(
            Math.abs(cross),
            `Cross product between ${modes[i]!.name} and ${modes[j]!.name} must be ~ 0`
          ).toBeLessThan(1e-3);
        }
      }

      // Exact 1D Simpson quadrature for the non-trivial radial pair (Z20, Z40):
      // int_0^1 Z20(r) * Z40(r) * 2r dr = 0 analytically
      const M = 1000;
      const h = 1.0 / M;
      let simpsonSum = 0.0;
      for (let i = 0; i <= M; i++) {
        const r = i * h;
        const u = r;
        const v = 0.0;
        const integrand = evalZ20(u, v) * evalZ40(u, v) * 2.0 * r;
        const weight = (i === 0 || i === M) ? 1.0 : (i % 2 === 1 ? 4.0 : 2.0);
        simpsonSum += weight * integrand;
      }
      const radialCross = (h / 3.0) * simpsonSum;
      expect(Math.abs(radialCross)).toBeLessThan(1e-9);
    });
  });

  describe('Pupil Mask and Boundary Properties', () => {
    it('evaluates to 0 strictly outside the unit disk (r2 > 1.0)', () => {
      const testPointsOutside = [
        [1.0001, 0],
        [0, 1.0001],
        [-1.0001, 0],
        [0, -1.0001],
        [0.8, 0.8], // r2 = 1.28 > 1
        [2.0, 2.0],
      ];

      for (const [u, v] of testPointsOutside) {
        expect(evalZ20(u!, v!)).toBe(0);
        expect(evalZ22(u!, v!)).toBe(0);
        expect(evalZ31(u!, v!)).toBe(0);
        expect(evalZ40(u!, v!)).toBe(0);
      }
    });

    it('matches analytical values at known special points on the unit disk', () => {
      // Origin (0, 0)
      expect(evalZ20(0, 0)).toBeCloseTo(-SQRT_3, 14);
      expect(evalZ22(0, 0)).toBeCloseTo(0, 14);
      expect(evalZ31(0, 0)).toBeCloseTo(0, 14);
      expect(evalZ40(0, 0)).toBeCloseTo(SQRT_5, 14);

      // (1, 0) on boundary
      expect(evalZ20(1, 0)).toBeCloseTo(SQRT_3, 14);
      expect(evalZ22(1, 0)).toBeCloseTo(SQRT_6, 14);
      expect(evalZ31(1, 0)).toBeCloseTo(SQRT_8, 14);
      expect(evalZ40(1, 0)).toBeCloseTo(SQRT_5, 14);

      // (0, 1) on boundary
      expect(evalZ20(0, 1)).toBeCloseTo(SQRT_3, 14);
      expect(evalZ22(0, 1)).toBeCloseTo(-SQRT_6, 14);
      expect(evalZ31(0, 1)).toBeCloseTo(0, 14);
      expect(evalZ40(0, 1)).toBeCloseTo(SQRT_5, 14);
    });

    it('has exactly 812 active pixels inside radius 16 on 64x64 grid', () => {
      const mask = getPupilMask();
      expect(mask.length).toBe(PIXEL_COUNT);

      let activeCount = 0;
      for (let i = 0; i < PIXEL_COUNT; i++) {
        if (mask[i] === 1.0) activeCount++;
      }
      expect(activeCount).toBe(812);

      const basis = getZernikeBasis();
      expect(basis.activePixelIndices.length).toBe(812);

      // All basis arrays outside mask are strictly 0.0
      for (let i = 0; i < PIXEL_COUNT; i++) {
        if (mask[i] === 0.0) {
          expect(basis.z20[i]).toBe(0.0);
          expect(basis.z22[i]).toBe(0.0);
          expect(basis.z31[i]).toBe(0.0);
          expect(basis.z40[i]).toBe(0.0);
        }
      }
    });

    it('verifies coordinate geometry at pixel centers', () => {
      // Pixel (32, 32): u = (32 + 0.5 - 32) / 16 = 0.5 / 16 = 0.03125
      const coordCenter = computePupilCoordinates(32, 32);
      expect(coordCenter.u).toBeCloseTo(0.03125, 14);
      expect(coordCenter.v).toBeCloseTo(0.03125, 14);
      expect(coordCenter.inside).toBe(true);

      // Pixel (0, 0): u = (0 + 0.5 - 32) / 16 = -31.5 / 16 = -1.96875
      const coordCorner = computePupilCoordinates(0, 0);
      expect(coordCorner.u).toBeCloseTo(-1.96875, 14);
      expect(coordCorner.v).toBeCloseTo(-1.96875, 14);
      expect(coordCorner.inside).toBe(false);
    });
  });
});

describe('Wavefront Function (wavefront)', () => {
  it('returns a Float64Array of 4096 elements', () => {
    const W = wavefront({ astig0: 0.05, comaX: -0.04, spherical: 0.03 });
    expect(W).toBeInstanceOf(Float64Array);
    expect(W.length).toBe(PIXEL_COUNT);
  });

  it('masks values strictly to 0.0 outside the circular pupil', () => {
    const mask = getPupilMask();
    const W = wavefront({ astig0: 0.08, comaX: -0.06, spherical: 0.04 });

    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (mask[i] === 0.0) {
        expect(W[i]).toBe(0.0);
      }
    }
  });

  it('evaluates to all zeros for zero aberration coefficients', () => {
    const W = wavefront({ astig0: 0.0, comaX: 0.0, spherical: 0.0 });
    for (let i = 0; i < PIXEL_COUNT; i++) {
      expect(W[i]).toBe(0.0);
    }
  });

  it('satisfies linear superposition: W(c1 + c2) == W(c1) + W(c2)', () => {
    const c1: Coefficients = { astig0: 0.05, comaX: -0.03, spherical: 0.02 };
    const c2: Coefficients = { astig0: -0.02, comaX: 0.06, spherical: 0.01 };
    const cSum: Coefficients = {
      astig0: c1.astig0 + c2.astig0,
      comaX: c1.comaX + c2.comaX,
      spherical: c1.spherical + c2.spherical,
    };

    const W1 = wavefront(c1);
    const W2 = wavefront(c2);
    const WSum = wavefront(cSum);

    for (let i = 0; i < PIXEL_COUNT; i++) {
      expect(WSum[i]).toBeCloseTo(W1[i]! + W2[i]!, 14);
    }
  });

  it('rejects invalid or non-finite coefficient inputs', () => {
    expect(() => wavefront(null as unknown as Coefficients)).toThrow(TypeError);
    expect(() =>
      wavefront({ astig0: NaN, comaX: 0, spherical: 0 })
    ).toThrow(TypeError);
    expect(() =>
      wavefront({ astig0: 0, comaX: Infinity, spherical: 0 })
    ).toThrow(TypeError);
  });
});

describe('Pupil Field (computePupilField)', () => {
  it('has unit amplitude inside the aperture and zero outside', () => {
    const { re, im } = computePupilField(
      { astig0: 0.08, comaX: -0.06, spherical: 0.04 },
      -0.65
    );
    const mask = getPupilMask();

    for (let i = 0; i < PIXEL_COUNT; i++) {
      const mag2 = re[i]! * re[i]! + im[i]! * im[i]!;
      if (mask[i] === 1.0) {
        expect(mag2).toBeCloseTo(1.0, 14);
      } else {
        expect(re[i]).toBe(0.0);
        expect(im[i]).toBe(0.0);
        expect(mag2).toBe(0.0);
      }
    }
  });

  it('rejects non-finite defocus or coefficients', () => {
    expect(() =>
      computePupilField({ astig0: 0, comaX: 0, spherical: 0 }, NaN)
    ).toThrow(TypeError);
  });
});

describe('Forward PSF Imaging and Acceptance Assertions (TASK-P007-T004)', () => {
  it('returns a shifted, normalized Float64Array of 4096 elements', () => {
    const I = forwardPsf({ astig0: 0, comaX: 0, spherical: 0 }, 0);
    expect(I).toBeInstanceOf(Float64Array);
    expect(I.length).toBe(PIXEL_COUNT);
  });

  it('places the in-focus peak at display center (32, 32) via fftshift', () => {
    const I = forwardPsf({ astig0: 0, comaX: 0, spherical: 0 }, 0);
    let peakIdx = 0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      if (I[i]! > I[peakIdx]!) {
        peakIdx = i;
      }
    }
    const peakX = peakIdx % GRID_SIZE;
    const peakY = Math.floor(peakIdx / GRID_SIZE);
    expect(peakX).toBe(32);
    expect(peakY).toBe(32);
  });

  describe('Golden Assertion MATH03: Normalization across all 5 Presets and Planes', () => {
    const presetEntries = Object.entries(PRESETS);

    it.each(presetEntries)(
      'preset "%s": finite, non-negative, and sum diff <= 1e-12 at both defocus planes',
      (id, preset) => {
        for (const defocus of [DIVERSITY_DEFOCUS_MINUS, DIVERSITY_DEFOCUS_PLUS]) {
          const I = forwardPsf(preset.coefficients, defocus);

          let sum = 0.0;
          let minVal = Infinity;
          for (let i = 0; i < PIXEL_COUNT; i++) {
            const val = I[i]!;
            expect(Number.isFinite(val)).toBe(true);
            expect(val).toBeGreaterThanOrEqual(0.0);
            if (val < minVal) minVal = val;
            sum += val;
          }

          const sumDiff = Math.abs(sum - 1.0);
          console.log(`[MATH03] preset=${id} defocus=${defocus} sumDiff=${sumDiff.toExponential(4)} minVal=${minVal}`);
          expect(
            sumDiff,
            `MATH03 failed for preset "${id}" at defocus ${defocus}: sum diff = ${sumDiff}`
          ).toBeLessThanOrEqual(1e-12);
        }
      }
    );
  });

  describe('Golden Assertion MATH04: Dual-focus Symmetry for Perfect Aberration-free Preset', () => {
    it('satisfies max pixel difference <= 1e-10 between -0.65 and +0.65 diversity planes', () => {
      const perfectCoeffs = PRESETS['perfect'].coefficients;
      const I_minus = forwardPsf(perfectCoeffs, DIVERSITY_DEFOCUS_MINUS);
      const I_plus = forwardPsf(perfectCoeffs, DIVERSITY_DEFOCUS_PLUS);

      let maxDiff = 0.0;
      for (let i = 0; i < PIXEL_COUNT; i++) {
        const diff = Math.abs(I_minus[i]! - I_plus[i]!);
        if (diff > maxDiff) {
          maxDiff = diff;
        }
      }

      console.log(`[MATH04] perfect +/-0.65 maxPixelDiff=${maxDiff.toExponential(4)}`);

      // Project book specification: <= 1e-10
      expect(
        maxDiff,
        `MATH04 failed: max pixel diff between +/-0.65 was ${maxDiff}`
      ).toBeLessThanOrEqual(1e-10);
    });
  });

  describe('Physical Aberration Morphology and Symmetry Tests', () => {
    it('coma-only: breaks inversion symmetry along x-axis', () => {
      const comaCoeffs = PRESETS['coma-only'].coefficients;
      const I = forwardPsf(comaCoeffs, DIVERSITY_DEFOCUS_MINUS);

      // Inversion symmetry would imply I(x, y) == I(63 - x, 63 - y)
      // Primary x-coma (Z31) introduces asymmetric distortion along x
      let maxAsym = 0.0;
      for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          const idx = y * GRID_SIZE + x;
          const invIdx = (63 - y) * GRID_SIZE + (63 - x);
          const diff = Math.abs(I[idx]! - I[invIdx]!);
          if (diff > maxAsym) maxAsym = diff;
        }
      }

      expect(maxAsym).toBeGreaterThan(1e-4);
    });

    it('astig-only: breaks circular rotational symmetry between x and y axes', () => {
      const astigCoeffs = PRESETS['astig-only'].coefficients;
      const I = forwardPsf(astigCoeffs, DIVERSITY_DEFOCUS_MINUS);

      // 0° astigmatism (Z22 ~ u^2 - v^2) elongates the spot along axes
      let maxRotDiff = 0.0;
      for (let dy = 1; dy <= 10; dy++) {
        for (let dx = 1; dx <= 10; dx++) {
          const idxX = (32) * GRID_SIZE + (32 + dx);
          const idxY = (32 + dy) * GRID_SIZE + 32;
          const diff = Math.abs(I[idxX]! - I[idxY]!);
          if (diff > maxRotDiff) maxRotDiff = diff;
        }
      }

      expect(maxRotDiff).toBeGreaterThan(1e-4);
    });

    it('spherical-only: breaks through-focus symmetry (unlike perfect preset)', () => {
      const sphericalCoeffs = PRESETS['spherical-only'].coefficients;
      const I_minus = forwardPsf(sphericalCoeffs, DIVERSITY_DEFOCUS_MINUS);
      const I_plus = forwardPsf(sphericalCoeffs, DIVERSITY_DEFOCUS_PLUS);

      let maxDiff = 0.0;
      for (let i = 0; i < PIXEL_COUNT; i++) {
        const diff = Math.abs(I_minus[i]! - I_plus[i]!);
        if (diff > maxDiff) maxDiff = diff;
      }

      // Spherical aberration causes distinct responses on intra- and extra-focal planes
      expect(maxDiff).toBeGreaterThan(1e-3);
    });
  });

  describe('Contract and Immutability Safeguards', () => {
    it('does not mutate input coefficients object', () => {
      const coeff: Coefficients = Object.freeze({
        astig0: 0.08,
        comaX: -0.06,
        spherical: 0.04,
      });

      expect(() => forwardPsf(coeff, DIVERSITY_DEFOCUS_MINUS)).not.toThrow();
      expect(coeff.astig0).toBe(0.08);
      expect(coeff.comaX).toBe(-0.06);
      expect(coeff.spherical).toBe(0.04);
    });

    it('returns fresh Float64Array instances across successive calls', () => {
      const coeff = PRESETS['mixed'].coefficients;
      const I1 = forwardPsf(coeff, DIVERSITY_DEFOCUS_MINUS);
      const I2 = forwardPsf(coeff, DIVERSITY_DEFOCUS_MINUS);

      expect(I1).not.toBe(I2);
      expect(I1).toEqual(I2);
    });

    it('rejects non-finite input coefficients or defocus values', () => {
      expect(() =>
        forwardPsf({ astig0: NaN, comaX: 0, spherical: 0 }, -0.65)
      ).toThrow(TypeError);
      expect(() =>
        forwardPsf({ astig0: 0, comaX: 0, spherical: 0 }, Infinity)
      ).toThrow(TypeError);
    });
  });
});
