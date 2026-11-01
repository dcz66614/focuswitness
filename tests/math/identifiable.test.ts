/**
 * P007 FocusWitness — Local Identifiability & Jacobi Eigenvalue Tests
 *
 * Specifications & Acceptance:
 * - TASK-P007-T007 Acceptance
 * - PROJECT_BOOK.md Section 5.5: Local identifiability, common reference point, and evidence boundaries.
 * - PROJECT_BOOK.md Chapter 7:
 *   - MATH07: mixed preset, information matrix at common a_ref satisfies:
 *     lambda_min(Gdual) + 1e-10 >= lambda_min(Gsingle),
 *     trace_dual + 1e-10 >= trace_single;
 *     Jacobi + independent PSD verification.
 * - IMPLEMENTATION_PLAN.md Section 3.3: analyzeLocal(reference: Coefficients).
 */

import { describe, expect, it } from 'vitest';
import {
  PRESET_ASTIG_ONLY,
  PRESET_COMA_ONLY,
  PRESET_MIXED,
  PRESET_PERFECT,
  PRESET_SPHERICAL_ONLY,
} from '../../src/domain/presets';
import { forwardPsf } from '../../src/math/psf';
import {
  analyzeLocal,
  computeInformationMatrix,
  computeLocalConditionNumber,
  computeSingularValues,
  isPositiveSemiDefinite3,
  jacobiSymmetric3,
  LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE,
} from '../../src/math/identifiable';

describe('3x3 Symmetric Jacobi Eigenvalue Solver', () => {
  it('correctly decomposes a 3x3 identity matrix', () => {
    const I = [
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ];
    const res = jacobiSymmetric3(I);
    expect(res.eigenvalues[0]).toBeCloseTo(1.0, 14);
    expect(res.eigenvalues[1]).toBeCloseTo(1.0, 14);
    expect(res.eigenvalues[2]).toBeCloseTo(1.0, 14);
    expect(res.sweeps).toBe(0);
  });

  it('correctly decomposes a diagonal matrix with distinct eigenvalues', () => {
    const D = [
      5.5, 0, 0,
      0, 12.0, 0,
      0, 0, 1.2,
    ];
    const res = jacobiSymmetric3(D);
    expect(res.eigenvalues[0]).toBeCloseTo(12.0, 14);
    expect(res.eigenvalues[1]).toBeCloseTo(5.5, 14);
    expect(res.eigenvalues[2]).toBeCloseTo(1.2, 14);
  });

  it('solves textbook tridiagonal symmetric matrix with exact analytical eigenvalues', () => {
    // A = [[2, -1, 0], [-1, 2, -1], [0, -1, 2]]
    // Analytical eigenvalues: 2 + sqrt(2) ≈ 3.414213562373095, 2.0, 2 - sqrt(2) ≈ 0.585786437626905
    const A = [
      2, -1, 0,
      -1, 2, -1,
      0, -1, 2,
    ];
    const res = jacobiSymmetric3(A);
    const exact0 = 2 + Math.SQRT2;
    const exact1 = 2;
    const exact2 = 2 - Math.SQRT2;

    expect(res.eigenvalues[0]).toBeCloseTo(exact0, 13);
    expect(res.eigenvalues[1]).toBeCloseTo(exact1, 13);
    expect(res.eigenvalues[2]).toBeCloseTo(exact2, 13);

    // Verify trace preservation: 2 + 2 + 2 = 6
    const trace = res.eigenvalues[0] + res.eigenvalues[1] + res.eigenvalues[2];
    expect(trace).toBeCloseTo(6.0, 14);
  });

  it('verifies eigenvector orthogonality V^T * V = I and eigenpair equation A * v = lambda * v', () => {
    const A = [
      4.0, 1.5, 0.8,
      1.5, 3.0, 1.2,
      0.8, 1.2, 2.0,
    ];
    const res = jacobiSymmetric3(A);
    const V = res.eigenvectors;

    // Check V^T * V = I
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        // Dot product of column i and column j
        const dot =
          V[0 * 3 + i]! * V[0 * 3 + j]! +
          V[1 * 3 + i]! * V[1 * 3 + j]! +
          V[2 * 3 + i]! * V[2 * 3 + j]!;
        if (i === j) {
          expect(dot).toBeCloseTo(1.0, 13);
        } else {
          expect(Math.abs(dot)).toBeLessThan(1e-13);
        }
      }
    }

    // Check A * v_j = lambda_j * v_j for each column j
    for (let j = 0; j < 3; j++) {
      const lambda = res.eigenvalues[j];
      const vj = [V[0 * 3 + j]!, V[1 * 3 + j]!, V[2 * 3 + j]!];

      for (let r = 0; r < 3; r++) {
        const Av_r =
          A[r * 3 + 0]! * vj[0]! +
          A[r * 3 + 1]! * vj[1]! +
          A[r * 3 + 2]! * vj[2]!;
        const lambda_v_r = lambda * vj[r]!;
        expect(Av_r).toBeCloseTo(lambda_v_r, 12);
      }
    }
  });

  it('correctly handles rank-1 outer product matrix u * u^T', () => {
    const u = [2.0, -1.0, 3.0];
    const uNormSq = u[0]! * u[0]! + u[1]! * u[1]! + u[2]! * u[2]!; // 4 + 1 + 9 = 14
    const A = [
      u[0]! * u[0]!, u[0]! * u[1]!, u[0]! * u[2]!,
      u[1]! * u[0]!, u[1]! * u[1]!, u[1]! * u[2]!,
      u[2]! * u[0]!, u[2]! * u[1]!, u[2]! * u[2]!,
    ];

    const res = jacobiSymmetric3(A);
    expect(res.eigenvalues[0]).toBeCloseTo(uNormSq, 12);
    expect(res.eigenvalues[1]).toBeCloseTo(0.0, 12);
    expect(res.eigenvalues[2]).toBeCloseTo(0.0, 12);
  });

  it('applies non-negative clamping tolerance to tiny negative numerical noise', () => {
    // Construct a matrix with a tiny negative eigenvalue -1e-12
    const A = [
      1.0, 0, 0,
      0, 0.5, 0,
      0, 0, -1e-12,
    ];

    // With clampNonNegative: true (default)
    const resClamped = jacobiSymmetric3(A, { clampNonNegative: true, nonNegativeClampTol: 1e-10 });
    expect(resClamped.eigenvalues[2]).toBe(0.0);

    // With clampNonNegative: false
    const resRaw = jacobiSymmetric3(A, { clampNonNegative: false });
    expect(resRaw.eigenvalues[2]).toBeCloseTo(-1e-12, 14);
  });

  it('accepts 3x3 nested array input', () => {
    const nested = [
      [3, 1, 0],
      [1, 3, 1],
      [0, 1, 3],
    ];
    const res = jacobiSymmetric3(nested);
    expect(res.eigenvalues[0]).toBeCloseTo(3 + Math.SQRT2, 13);
    expect(res.eigenvalues[1]).toBeCloseTo(3.0, 13);
    expect(res.eigenvalues[2]).toBeCloseTo(3 - Math.SQRT2, 13);
  });

  it('rejects invalid inputs (too few elements, non-finite values)', () => {
    expect(() => jacobiSymmetric3([1, 2, 3])).toThrow(TypeError);
    expect(() => jacobiSymmetric3([1, 2, 3, 4, NaN, 6, 7, 8, 9])).toThrow(TypeError);
    expect(() => jacobiSymmetric3([Infinity, 0, 0, 0, 1, 0, 0, 0, 1])).toThrow(TypeError);
  });
});

describe('Golden Assertion: MATH07 (TASK-P007-T007)', () => {
  it('MATH07: mixed preset information matrix at common a_ref satisfies monotonicity and PSD conditions', () => {
    const ref = PRESET_MIXED.coefficients;

    const analysis = analyzeLocal(ref);

    const lambdaMinDual = analysis.eigenDual[2];
    const lambdaMinSingle = analysis.eigenSingle[2];
    const traceDual = analysis.traceDual;
    const traceSingle = analysis.traceSingle;

    // Log the full measured values for evidence auditing
    console.log('[MATH07] Reference point a_ref:', JSON.stringify(ref));
    console.log(`[MATH07] Single-plane eigenvalues: [${analysis.eigenSingle.map((e) => e.toExponential(6)).join(', ')}]`);
    console.log(`[MATH07] Dual-plane eigenvalues:   [${analysis.eigenDual.map((e) => e.toExponential(6)).join(', ')}]`);
    console.log(`[MATH07] Single-plane singular values: [${analysis.singularValuesSingle.map((s) => s.toExponential(6)).join(', ')}]`);
    console.log(`[MATH07] Dual-plane singular values:   [${analysis.singularValuesDual.map((s) => s.toExponential(6)).join(', ')}]`);
    console.log(`[MATH07] Trace Single: ${traceSingle.toFixed(8)}`);
    console.log(`[MATH07] Trace Dual:   ${traceDual.toFixed(8)}`);
    console.log(`[MATH07] Delta Trace (Dual - Single): ${(traceDual - traceSingle).toFixed(8)}`);
    console.log(`[MATH07] lambda_min(Gsingle): ${lambdaMinSingle.toExponential(6)}`);
    console.log(`[MATH07] lambda_min(Gdual):   ${lambdaMinDual.toExponential(6)}`);
    console.log(`[MATH07] Delta lambda_min (Dual - Single): ${(lambdaMinDual - lambdaMinSingle).toExponential(6)}`);
    console.log(`[MATH07] Condition number Single: ${analysis.conditionNumberSingle.toFixed(4)}`);
    console.log(`[MATH07] Condition number Dual:   ${analysis.conditionNumberDual.toFixed(4)}`);

    // --- GOLDEN ASSERTION MATH07: Eigenvalue & Trace Monotonicity ---
    // 1. Minimum eigenvalue does not decrease: lambda_min(Gdual) + 1e-10 >= lambda_min(Gsingle)
    expect(lambdaMinDual + 1e-10).toBeGreaterThanOrEqual(lambdaMinSingle);

    // 2. Trace does not decrease: trace_dual + 1e-10 >= trace_single
    expect(traceDual + 1e-10).toBeGreaterThanOrEqual(traceSingle);

    // 3. Strict positive semi-definite check on Delta G = G_dual - G_single
    const deltaG = new Float64Array(9);
    for (let k = 0; k < 9; k++) {
      deltaG[k] = analysis.gramDual[k]! - analysis.gramSingle[k]!;
    }

    const deltaEigRes = jacobiSymmetric3(deltaG, { clampNonNegative: false });
    console.log(
      `[MATH07] Delta G eigenvalues: [${deltaEigRes.eigenvalues.map((e) => e.toExponential(6)).join(', ')}]`
    );

    // All eigenvalues of Delta G must be non-negative within floating-point tolerance
    expect(deltaEigRes.eigenvalues[0] + 1e-10).toBeGreaterThanOrEqual(0.0);
    expect(deltaEigRes.eigenvalues[1] + 1e-10).toBeGreaterThanOrEqual(0.0);
    expect(deltaEigRes.eigenvalues[2] + 1e-10).toBeGreaterThanOrEqual(0.0);

    // Independent PSD check helper
    expect(isPositiveSemiDefinite3(deltaG, 1e-10)).toBe(true);

    // 4. Courant-Fischer Weyl Monotonicity for all 3 eigenvalues:
    // lambda_i(Gdual) + 1e-10 >= lambda_i(Gsingle) for i = 0, 1, 2
    expect(analysis.eigenDual[0] + 1e-10).toBeGreaterThanOrEqual(analysis.eigenSingle[0]);
    expect(analysis.eigenDual[1] + 1e-10).toBeGreaterThanOrEqual(analysis.eigenSingle[1]);
    expect(analysis.eigenDual[2] + 1e-10).toBeGreaterThanOrEqual(analysis.eigenSingle[2]);
  });
});

describe('Local Identifiability & Sensitivity Invariance Across Presets', () => {
  const presets = [
    { name: 'perfect', preset: PRESET_PERFECT },
    { name: 'mixed', preset: PRESET_MIXED },
    { name: 'astig-only', preset: PRESET_ASTIG_ONLY },
    { name: 'coma-only', preset: PRESET_COMA_ONLY },
    { name: 'spherical-only', preset: PRESET_SPHERICAL_ONLY },
  ];

  presets.forEach(({ name, preset }) => {
    it(`verifies monotonicity and positive semi-definiteness on preset "${name}"`, () => {
      const analysis = analyzeLocal(preset.coefficients);

      // Descending order of eigenvalues
      expect(analysis.eigenSingle[0]).toBeGreaterThanOrEqual(analysis.eigenSingle[1]);
      expect(analysis.eigenSingle[1]).toBeGreaterThanOrEqual(analysis.eigenSingle[2]);
      expect(analysis.eigenSingle[2]).toBeGreaterThanOrEqual(0);

      expect(analysis.eigenDual[0]).toBeGreaterThanOrEqual(analysis.eigenDual[1]);
      expect(analysis.eigenDual[1]).toBeGreaterThanOrEqual(analysis.eigenDual[2]);
      expect(analysis.eigenDual[2]).toBeGreaterThanOrEqual(0);

      // Monotonicity from single to dual
      expect(analysis.traceDual + 1e-10).toBeGreaterThanOrEqual(analysis.traceSingle);
      expect(analysis.eigenDual[2] + 1e-10).toBeGreaterThanOrEqual(analysis.eigenSingle[2]);

      // Singular values are square roots
      expect(analysis.singularValuesSingle[0]).toBeCloseTo(Math.sqrt(analysis.eigenSingle[0]), 12);
      expect(analysis.singularValuesSingle[1]).toBeCloseTo(Math.sqrt(analysis.eigenSingle[1]), 12);
      expect(analysis.singularValuesSingle[2]).toBeCloseTo(Math.sqrt(analysis.eigenSingle[2]), 12);

      expect(analysis.singularValuesDual[0]).toBeCloseTo(Math.sqrt(analysis.eigenDual[0]), 12);
      expect(analysis.singularValuesDual[1]).toBeCloseTo(Math.sqrt(analysis.eigenDual[1]), 12);
      expect(analysis.singularValuesDual[2]).toBeCloseTo(Math.sqrt(analysis.eigenDual[2]), 12);

      // Condition numbers are finite positive numbers
      expect(Number.isFinite(analysis.conditionNumberSingle)).toBe(true);
      expect(Number.isFinite(analysis.conditionNumberDual)).toBe(true);
      expect(analysis.conditionNumberSingle).toBeGreaterThan(0);
      expect(analysis.conditionNumberDual).toBeGreaterThan(0);
    });
  });

  it('verifies that analyzeLocal is independent of observation buffer content', () => {
    const ref = PRESET_MIXED.coefficients;

    // Actual observations
    const oMinus = forwardPsf(ref, -0.65);
    const oPlus = forwardPsf(ref, 0.65);
    const actualObs = { minus: oMinus, plus: oPlus };

    // Dummy all-zero observations
    const dummyObs = {
      minus: new Float64Array(4096),
      plus: new Float64Array(4096),
    };

    const resActual = analyzeLocal(ref, actualObs);
    const resDummy = analyzeLocal(ref, dummyObs);
    const resNoObs = analyzeLocal(ref);

    for (let k = 0; k < 3; k++) {
      expect(resActual.eigenSingle[k]).toBeCloseTo(resDummy.eigenSingle[k]!, 14);
      expect(resActual.eigenDual[k]).toBeCloseTo(resDummy.eigenDual[k]!, 14);
      expect(resActual.eigenSingle[k]).toBeCloseTo(resNoObs.eigenSingle[k]!, 14);
      expect(resActual.eigenDual[k]).toBeCloseTo(resNoObs.eigenDual[k]!, 14);
    }

    expect(resActual.traceSingle).toBeCloseTo(resDummy.traceSingle, 14);
    expect(resActual.traceDual).toBeCloseTo(resDummy.traceDual, 14);
  });

  it('strictly includes boundary warning note stating local identifiability != global uniqueness', () => {
    const analysis = analyzeLocal(PRESET_PERFECT.coefficients);
    expect(analysis.boundaryNote).toBe(LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE);
    expect(analysis.boundaryNote).toContain('局部可辨识不等于全局唯一解');
    expect(analysis.boundaryNote).toContain('非概率置信度');
    expect(analysis.boundaryNote).toContain('严禁夸大为物理参数的全局唯一性证明');
  });

  it('rejects invalid reference coefficients', () => {
    expect(() => analyzeLocal(null as any)).toThrow(TypeError);
    expect(() => analyzeLocal({ astig0: NaN, comaX: 0, spherical: 0 })).toThrow(TypeError);
    expect(() => analyzeLocal({ astig0: 0, comaX: Infinity, spherical: 0 })).toThrow(TypeError);
    expect(() => computeInformationMatrix({ astig0: 0, comaX: 0 } as any, 'single')).toThrow(TypeError);
  });

  it('standalone helper computeLocalConditionNumber handles zero singular values cleanly', () => {
    const kappa = computeLocalConditionNumber([4.0, 1.0, 0.0]);
    // sqrt(4) / 1e-14 = 2e14
    expect(kappa).toBeCloseTo(2.0 / 1e-14, 2);
  });

  it('standalone helper computeSingularValues returns exact roots', () => {
    const s = computeSingularValues([9.0, 4.0, 1.0]);
    expect(s[0]).toBe(3.0);
    expect(s[1]).toBe(2.0);
    expect(s[2]).toBe(1.0);
  });
});
