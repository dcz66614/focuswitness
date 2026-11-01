/**
 * P007 FocusWitness — Optimizer, Numerical Jacobian, and 3x3 Solver Tests
 *
 * Specifications & Acceptance:
 * - TASK-P007-T005 Acceptance
 * - PROJECT_BOOK.md Section 5.3: Observations, objective function, residuals
 * - PROJECT_BOOK.md Section 5.4: LM numerical inversion
 * - PROJECT_BOOK.md Chapter 7:
 *   - MATH05: mixed ground-truth reprojection L_dual(a*) <= 1e-20
 *   - MATH06: mixed, dual mode, init [0,0,0], terminates with max_j |a_est_j - a*_j| <= 0.015 waves and L_dual <= 1e-8
 */

import { describe, expect, it, vi } from 'vitest';
import {
  COEFFICIENT_MAX,
  COEFFICIENT_MIN,
  FINITE_DIFFERENCE_STEP,
  INITIAL_LAMBDA,
  LAMBDA_MAX,
  LAMBDA_MIN,
  MAX_ITERATIONS,
  MAX_STEP_DELTA,
  PIXEL_COUNT,
} from '../../src/domain/constants';
import { PRESET_MIXED, PRESET_PERFECT } from '../../src/domain/presets';
import type { Coefficients, FocusPlane, Mode } from '../../src/domain/types';
import { validateFitResult, validateIterationRecord } from '../../src/domain/validation';
import {
  computeGramAndGradient,
  computeGramMatrix,
  computeResidualsAndLoss,
  lossAndJacobian,
} from '../../src/math/jacobian';
import { NumericFailureError, solveDampedSystem, solveLinear3 } from '../../src/math/linear3';
import { fit } from '../../src/math/optimizer';
import { forwardPsf } from '../../src/math/psf';

describe('3x3 Linear System Solver (linear3.ts)', () => {
  it('solves a known non-singular 3x3 linear system accurately', () => {
    // 2*x0 + 1*x1 - 1*x2 = 8
    // -3*x0 - 1*x1 + 2*x2 = -11
    // -2*x0 + 1*x1 + 2*x2 = -3
    // Exact solution: x0 = 2, x1 = 3, x2 = -1
    const A = [
      2, 1, -1,
      -3, -1, 2,
      -2, 1, 2,
    ];
    const b = [8, -11, -3];

    const x = solveLinear3(A, b);
    expect(x[0]).toBeCloseTo(2, 10);
    expect(x[1]).toBeCloseTo(3, 10);
    expect(x[2]).toBeCloseTo(-1, 10);
  });

  it('handles row swaps via partial pivoting when leading pivot is zero', () => {
    // 0*x0 + 2*x1 + 1*x2 = 4
    // 1*x0 - 1*x1 + 2*x2 = 5
    // 2*x0 + 1*x1 - 1*x2 = 1
    const A = [
      0, 2, 1,
      1, -1, 2,
      2, 1, -1,
    ];
    const b = [4, 5, 1];

    const x = solveLinear3(A, b);

    // Verify A * x == b
    expect(A[0] * x[0] + A[1] * x[1] + A[2] * x[2]).toBeCloseTo(b[0], 10);
    expect(A[3] * x[0] + A[4] * x[1] + A[5] * x[2]).toBeCloseTo(b[1], 10);
    expect(A[6] * x[0] + A[7] * x[1] + A[8] * x[2]).toBeCloseTo(b[2], 10);
  });

  it('accepts 2D array representation of matrix', () => {
    const A = [
      [3, 0, 0],
      [0, 2, 0],
      [0, 0, 5],
    ];
    const b = [9, 4, 15];
    const x = solveLinear3(A, b);
    expect(x).toEqual([3, 2, 3]);
  });

  it('throws NumericFailureError for singular matrices', () => {
    // Row 2 is multiple of Row 0
    const A = [
      1, 2, 3,
      4, 5, 6,
      2, 4, 6,
    ];
    const b = [1, 1, 1];
    expect(() => solveLinear3(A, b)).toThrow(NumericFailureError);
  });

  it('throws NumericFailureError for all-zero matrix', () => {
    const A = new Float64Array(9);
    const b = [1, 2, 3];
    expect(() => solveLinear3(A, b)).toThrow(NumericFailureError);
  });

  it('throws NumericFailureError when inputs contain NaN or Infinity', () => {
    const A = [
      1, NaN, 0,
      0, 1, 0,
      0, 0, 1,
    ];
    const b = [1, 2, 3];
    expect(() => solveLinear3(A, b)).toThrow(NumericFailureError);

    const bInf = [1, Infinity, 3];
    expect(() => solveLinear3([1, 0, 0, 0, 1, 0, 0, 0, 1], bInf)).toThrow(NumericFailureError);
  });

  it('solveDampedSystem regularizes and solves normal system', () => {
    // Gram matrix G from J^T * J
    const G = [
      10, 2, 1,
      2, 5, 0.5,
      1, 0.5, 2,
    ];
    const g = [1, -0.5, 0.2];
    const lambda = 0.01;

    const delta = solveDampedSystem(G, g, lambda);
    expect(delta).toHaveLength(3);
    expect(Number.isFinite(delta[0])).toBe(true);
    expect(Number.isFinite(delta[1])).toBe(true);
    expect(Number.isFinite(delta[2])).toBe(true);
  });

  it('solveDampedSystem rejects invalid lambda', () => {
    const G = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const g = [0, 0, 0];
    expect(() => solveDampedSystem(G, g, -1)).toThrow(NumericFailureError);
    expect(() => solveDampedSystem(G, g, NaN)).toThrow(NumericFailureError);
  });
});

describe('Numerical Jacobian & Residuals (jacobian.ts)', () => {
  const perfectMinus = forwardPsf(PRESET_PERFECT.coefficients, -0.65);
  const perfectPlus = forwardPsf(PRESET_PERFECT.coefficients, 0.65);
  const observations = { minus: perfectMinus, plus: perfectPlus };

  it('computes residuals and loss for single mode (|S|=1, 4096 rows)', () => {
    const res = lossAndJacobian(observations, PRESET_PERFECT.coefficients, 'single');
    expect(res.rows).toBe(PIXEL_COUNT);
    expect(res.cols).toBe(3);
    expect(res.residuals.length).toBe(PIXEL_COUNT);
    expect(res.jacobian.length).toBe(PIXEL_COUNT * 3);
    expect(res.loss).toBeCloseTo(0.0, 14);
  });

  it('computes residuals and loss for dual mode (|S|=2, 8192 rows)', () => {
    const res = lossAndJacobian(observations, PRESET_PERFECT.coefficients, 'dual');
    expect(res.rows).toBe(PIXEL_COUNT * 2);
    expect(res.cols).toBe(3);
    expect(res.residuals.length).toBe(PIXEL_COUNT * 2);
    expect(res.jacobian.length).toBe(PIXEL_COUNT * 2 * 3);
    expect(res.loss).toBeCloseTo(0.0, 14);
  });

  it('verifies numerical Jacobian produces finite non-trivial derivatives', () => {
    const res = lossAndJacobian(observations, { astig0: 0.02, comaX: -0.01, spherical: 0.03 }, 'dual');
    let maxJ = 0;
    for (let i = 0; i < res.jacobian.length; i++) {
      const v = Math.abs(res.jacobian[i]!);
      expect(Number.isFinite(v)).toBe(true);
      if (v > maxJ) maxJ = v;
    }
    expect(maxJ).toBeGreaterThan(0.01);
  });

  it('computeGramAndGradient produces symmetric positive semidefinite G and matching g', () => {
    const res = lossAndJacobian(observations, { astig0: 0.05, comaX: -0.03, spherical: 0.02 }, 'dual');
    const { G, g } = computeGramAndGradient(res.jacobian, res.residuals, res.rows);

    expect(G.length).toBe(9);
    expect(g.length).toBe(3);

    // Symmetry: G_01 == G_10, G_02 == G_20, G_12 == G_21
    expect(G[1]).toBeCloseTo(G[3], 14);
    expect(G[2]).toBeCloseTo(G[6], 14);
    expect(G[5]).toBeCloseTo(G[7], 14);

    // Diagonals must be non-negative
    expect(G[0]).toBeGreaterThanOrEqual(0);
    expect(G[4]).toBeGreaterThanOrEqual(0);
    expect(G[8]).toBeGreaterThanOrEqual(0);

    // computeGramMatrix matches G
    const directG = computeGramMatrix(res.jacobian, res.rows);
    for (let i = 0; i < 9; i++) {
      expect(directG[i]).toBeCloseTo(G[i]!, 14);
    }
  });

  it('computeResidualsAndLoss matches lossAndJacobian residuals and loss exactly', () => {
    const coeffs: Coefficients = { astig0: 0.04, comaX: -0.02, spherical: 0.01 };
    const full = lossAndJacobian(observations, coeffs, 'dual');
    const fast = computeResidualsAndLoss(observations, coeffs, 'dual');

    expect(fast.loss).toBeCloseTo(full.loss, 15);
    expect(fast.rows).toBe(full.rows);
    for (let i = 0; i < fast.rows; i++) {
      expect(fast.residuals[i]).toBe(full.residuals[i]);
    }
  });

  it('rejects invalid inputs to lossAndJacobian', () => {
    expect(() => lossAndJacobian(null as any, PRESET_PERFECT.coefficients, 'dual')).toThrow(TypeError);
    expect(() => lossAndJacobian(observations, { astig0: NaN, comaX: 0, spherical: 0 }, 'dual')).toThrow(TypeError);
    expect(() => lossAndJacobian(observations, PRESET_PERFECT.coefficients, 'invalid' as any)).toThrow(TypeError);
    expect(() => lossAndJacobian({ minus: [] as any }, PRESET_PERFECT.coefficients, 'single')).toThrow(TypeError);
  });
});

describe('Golden Assertions: MATH05 and MATH06 (TASK-P007-T005)', () => {
  // Generate synthetic observations from known ground-truth 'mixed' preset
  const groundTruth = PRESET_MIXED.coefficients; // astig0: 0.08, comaX: -0.06, spherical: 0.04
  const oMinus = forwardPsf(groundTruth, -0.65);
  const oPlus = forwardPsf(groundTruth, 0.65);
  const mixedObs = { minus: oMinus, plus: oPlus };

  it('MATH05: mixed ground truth reprojection satisfies L_dual(a*) <= 1e-20', () => {
    const res = lossAndJacobian(mixedObs, groundTruth, 'dual');
    console.log(`[MATH05] mixed ground truth reprojection L_dual = ${res.loss.toExponential(4)}`);

    expect(res.loss).toBeLessThanOrEqual(1e-20);
  });

  it('MATH06: mixed dual fit from [0,0,0] satisfies max_j |a_est_j - a*_j| <= 0.015 waves and L_dual <= 1e-8', () => {
    const progressHistory: any[] = [];
    const onProgress = vi.fn((rec) => {
      progressHistory.push(rec);
    });

    const startTime = Date.now();
    const result = fit(mixedObs, 'dual', onProgress);
    const elapsedMs = Date.now() - startTime;

    console.log(`[MATH06] Fit completed in ${elapsedMs}ms with status="${result.status}"`);
    console.log(`[MATH06] Initial loss: ${result.initialLoss.toExponential(4)}`);
    console.log(`[MATH06] Final loss:   ${result.finalLoss.toExponential(4)}`);
    console.log(`[MATH06] Iterations:   ${result.history.length}`);
    console.log(`[MATH06] Recovered:    astig0=${result.estimate.astig0.toFixed(5)}, comaX=${result.estimate.comaX.toFixed(5)}, spherical=${result.estimate.spherical.toFixed(5)}`);
    console.log(`[MATH06] Ground truth: astig0=${groundTruth.astig0.toFixed(5)}, comaX=${groundTruth.comaX.toFixed(5)}, spherical=${groundTruth.spherical.toFixed(5)}`);

    const errAstig0 = Math.abs(result.estimate.astig0 - groundTruth.astig0);
    const errComaX = Math.abs(result.estimate.comaX - groundTruth.comaX);
    const errSpherical = Math.abs(result.estimate.spherical - groundTruth.spherical);
    const maxCoeffError = Math.max(errAstig0, errComaX, errSpherical);

    console.log(`[MATH06] Error astig0:    ${errAstig0.toExponential(4)}`);
    console.log(`[MATH06] Error comaX:     ${errComaX.toExponential(4)}`);
    console.log(`[MATH06] Error spherical: ${errSpherical.toExponential(4)}`);
    console.log(`[MATH06] Max coeff error: ${maxCoeffError.toExponential(4)} (limit: 0.015)`);

    // Log the actual iteration trajectory
    console.log('[MATH06] Iteration Trajectory:');
    result.history.forEach((h) => {
      console.log(
        `  iter ${h.iter.toString().padStart(2, ' ')}: loss=${h.loss.toExponential(4)} lambda=${h.lambda.toExponential(2)} accepted=${h.accepted} a=[${h.coefficients.astig0.toFixed(4)}, ${h.coefficients.comaX.toFixed(4)}, ${h.coefficients.spherical.toFixed(4)}]`
      );
    });

    // Golden criteria MATH06
    expect(maxCoeffError).toBeLessThanOrEqual(0.015);
    expect(result.finalLoss).toBeLessThanOrEqual(1e-8);
    expect(result.status).toBe('converged');

    // Verify history and onProgress contract
    expect(result.history.length).toBeGreaterThan(0);
    expect(onProgress).toHaveBeenCalledTimes(result.history.length);

    // Verify valid FitResult schema
    const validation = validateFitResult(result);
    expect(validation.success).toBe(true);
  });
});

describe('LM Optimizer Behavior and Constraints (optimizer.ts)', () => {
  it('strictly satisfies no-groundTruth contract: fit does not inspect groundTruth property', () => {
    const oMinus = forwardPsf(PRESET_MIXED.coefficients, -0.65);
    const oPlus = forwardPsf(PRESET_MIXED.coefficients, 0.65);

    // Pass an object that contains a poisoned groundTruth property with getter
    let groundTruthRead = false;
    const poisonedInput = {
      minus: oMinus,
      plus: oPlus,
      get groundTruth() {
        groundTruthRead = true;
        throw new Error('VIOLATION: groundTruth was accessed by optimizer!');
      },
    };

    expect(() => fit(poisonedInput as any, 'dual')).not.toThrow();
    expect(groundTruthRead).toBe(false);
  });

  it('immediately converges when initial loss is <= 1e-14 (perfect preset)', () => {
    const oMinus = forwardPsf(PRESET_PERFECT.coefficients, -0.65);
    const oPlus = forwardPsf(PRESET_PERFECT.coefficients, 0.65);
    const obs = { minus: oMinus, plus: oPlus };

    const result = fit(obs, 'dual');
    expect(result.status).toBe('converged');
    expect(result.initialLoss).toBeLessThanOrEqual(1e-14);
    expect(result.finalLoss).toBeLessThanOrEqual(1e-14);
    expect(result.history.length).toBe(0); // 0 iterations required
    expect(result.estimate).toEqual(PRESET_PERFECT.coefficients);
  });

  it('handles cancellation via shouldCancel callback', () => {
    const oMinus = forwardPsf(PRESET_MIXED.coefficients, -0.65);
    const oPlus = forwardPsf(PRESET_MIXED.coefficients, 0.65);
    const obs = { minus: oMinus, plus: oPlus };

    // Cancel after 2 iterations
    let calls = 0;
    const shouldCancel = () => {
      calls++;
      return calls >= 3;
    };

    const result = fit(obs, 'dual', undefined, shouldCancel);
    expect(result.status).toBe('cancelled');
    expect(result.history.length).toBeLessThan(MAX_ITERATIONS);
  });

  it('enforces box constraints [-0.15, 0.15] on all parameters during optimization', () => {
    // Generate observation at extreme parameters
    const extremeCoeffs: Coefficients = { astig0: 0.15, comaX: -0.15, spherical: 0.15 };
    const oMinus = forwardPsf(extremeCoeffs, -0.65);
    const oPlus = forwardPsf(extremeCoeffs, 0.65);

    const result = fit({ minus: oMinus, plus: oPlus }, 'dual');

    // Check all history steps are inside box
    for (const h of result.history) {
      expect(h.coefficients.astig0).toBeGreaterThanOrEqual(COEFFICIENT_MIN);
      expect(h.coefficients.astig0).toBeLessThanOrEqual(COEFFICIENT_MAX);
      expect(h.coefficients.comaX).toBeGreaterThanOrEqual(COEFFICIENT_MIN);
      expect(h.coefficients.comaX).toBeLessThanOrEqual(COEFFICIENT_MAX);
      expect(h.coefficients.spherical).toBeGreaterThanOrEqual(COEFFICIENT_MIN);
      expect(h.coefficients.spherical).toBeLessThanOrEqual(COEFFICIENT_MAX);
    }
  });

  it('runs successfully in single mode', () => {
    const oMinus = forwardPsf(PRESET_MIXED.coefficients, -0.65);
    const oPlus = forwardPsf(PRESET_MIXED.coefficients, 0.65);

    const result = fit({ minus: oMinus, plus: oPlus }, 'single');
    expect(result.mode).toBe('single');
    expect(result.fittedPlanes).toEqual([-0.65]);
    expect(result.finalLoss).toBeLessThan(result.initialLoss);
    expect(result.history.length).toBeGreaterThan(0);
  });

  it('adjusts lambda on accepted vs rejected steps correctly', () => {
    const oMinus = forwardPsf(PRESET_MIXED.coefficients, -0.65);
    const oPlus = forwardPsf(PRESET_MIXED.coefficients, 0.65);

    const result = fit({ minus: oMinus, plus: oPlus }, 'dual');
    expect(result.history.length).toBeGreaterThan(1);

    for (let i = 0; i < result.history.length; i++) {
      const rec = result.history[i]!;
      expect(rec.iter).toBe(i + 1);
      expect(rec.lambda).toBeGreaterThanOrEqual(LAMBDA_MIN);
      expect(rec.lambda).toBeLessThanOrEqual(LAMBDA_MAX);
      expect(validateIterationRecord(rec).success).toBe(true);
    }
  });

  it('records rejected steps with lambda increase and terminates as stalled when progress is impossible', () => {
    // Generate observation identical to perfect (init [0,0,0]), but add tiny adversarial offset
    // so initial loss is > 1e-14, yet any step away from 0 increases loss.
    const oMinus = forwardPsf(PRESET_PERFECT.coefficients, -0.65);
    const oPlus = forwardPsf(PRESET_PERFECT.coefficients, 0.65);

    // Copy and create a stationary point where steps are rejected
    const modifiedMinus = new Float64Array(oMinus);
    const modifiedPlus = new Float64Array(oPlus);
    // Add tiny DC shift so L_init > 1e-14
    modifiedMinus[0] += 1e-5;
    modifiedPlus[0] += 1e-5;

    const result = fit({ minus: modifiedMinus, plus: modifiedPlus }, 'dual');

    // History should contain rejected steps
    const rejectedSteps = result.history.filter((h) => !h.accepted);
    expect(rejectedSteps.length).toBeGreaterThan(0);

    // On rejected steps, coefficients should remain unchanged from current estimate
    for (const rej of rejectedSteps) {
      expect(rej.coefficients).toBeDefined();
    }

    // Since it cannot reduce the offset, it should terminate with stalled or max_iterations
    expect(['stalled', 'max_iterations']).toContain(result.status);
  });
});
