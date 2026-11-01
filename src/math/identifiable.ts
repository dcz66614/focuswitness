/**
 * P007 FocusWitness — Local Identifiability & 3x3 Symmetric Matrix Spectrum
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 5.5: Local identifiability, common reference point, and evidence boundaries.
 *   - Use the same reference parameter a_ref to construct J_single(a_ref) and J_dual(a_ref).
 *   - Compute G_s = J_s^T * J_s, G_d = J_d^T * J_d.
 *   - SVD / Jacobi eigenvalue algorithm yields sorted e1 >= e2 >= e3 >= 0 (clamp small negative floats).
 *   - Display three sqrt(ei) as local sensitivity singular values.
 *   - Because G_dual = G_single + J_plus^T * J_plus, G_dual - G_single is positive semi-definite.
 *     Minimum eigenvalue and trace are monotonically non-decreasing from single to dual.
 *   - Condition number kappa = sqrt(e1) / max(sqrt(e3), 1e-14).
 *   - Clear evidence boundary: local linearization sensitivity ratio only, never probability confidence,
 *     never proof of global uniqueness.
 * - PROJECT_BOOK.md Chapter 7 MATH07:
 *   - mixed preset at common a_ref satisfies:
 *     lambda_min(Gdual) + 1e-10 >= lambda_min(Gsingle),
 *     trace_dual + 1e-10 >= trace_single.
 * - IMPLEMENTATION_PLAN.md Section 3.3:
 *   - analyzeLocal(reference: Coefficients): returns same-reference single/dual eigenvalues and traces;
 *     never derives information metrics from ground truth.
 */

import type { CaseV1, Coefficients, InformationSpectrum, Mode } from '../domain/types';
import { PIXEL_COUNT } from '../domain/constants';
import { computeGramMatrix, lossAndJacobian } from './jacobian';

/**
 * Default tolerances and parameters for Jacobi eigenvalue decomposition.
 */
export const DEFAULT_JACOBI_TOLERANCE = 1e-15;
export const DEFAULT_MAX_JACOBI_SWEEPS = 50;
export const DEFAULT_NON_NEGATIVE_CLAMP_TOL = 1e-10;
export const CONDITION_NUMBER_MIN_DENOM = 1e-14;

/**
 * Strict boundary warning text: local identifiability does NOT imply global uniqueness.
 */
export const LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE =
  '局部可辨识性分析仅评估在当前参考点局部线性化邻域内的参数灵敏度与逆问题适定性；局部可辨识不等于全局唯一解，非概率置信度，严禁夸大为物理参数的全局唯一性证明。';

/**
 * Options for 3x3 Jacobi eigenvalue decomposition.
 */
export interface JacobiOptions {
  /** Convergence tolerance for off-diagonal Frobenius norm (default: 1e-15) */
  tolerance?: number;
  /** Maximum number of sweeps before stopping (default: 50) */
  maxSweeps?: number;
  /** Whether to clamp small negative eigenvalues to 0.0 (default: true) */
  clampNonNegative?: boolean;
  /** Tolerance threshold for non-negative clamping (default: 1e-10) */
  nonNegativeClampTol?: number;
}

/**
 * Result of 3x3 Jacobi eigenvalue decomposition.
 */
export interface JacobiResult {
  /** Sorted eigenvalues in descending order: e1 >= e2 >= e3 */
  eigenvalues: [number, number, number];
  /**
   * 3x3 Orthogonal eigenvectors matrix stored flat row-major (length 9).
   * Column j corresponds to eigenvector j for eigenvalue j:
   * [v0j, v1j, v2j]^T = [eigenvectors[0*3 + j], eigenvectors[1*3 + j], eigenvectors[2*3 + j]]^T
   */
  eigenvectors: Float64Array;
  /** Number of sweeps performed until convergence */
  sweeps: number;
}

/**
 * Result of local identifiability analysis at a common reference coefficient vector.
 * Satisfies the domain InformationSpectrum interface.
 */
export interface LocalAnalysisResult extends InformationSpectrum {
  /** Common reference point a_ref where both single and dual models are linearized */
  reference: Coefficients;
  /** Single-plane eigenvalues sorted descending: e1 >= e2 >= e3 >= 0 */
  eigenSingle: [number, number, number];
  /** Dual-plane eigenvalues sorted descending: e1 >= e2 >= e3 >= 0 */
  eigenDual: [number, number, number];
  /** Single-plane local sensitivity singular values: sqrt(ei) */
  singularValuesSingle: [number, number, number];
  /** Dual-plane local sensitivity singular values: sqrt(ei) */
  singularValuesDual: [number, number, number];
  /** Single-plane Gram matrix trace */
  traceSingle: number;
  /** Dual-plane Gram matrix trace */
  traceDual: number;
  /** Single-plane local condition number: sqrt(e1) / max(sqrt(e3), 1e-14) */
  conditionNumberSingle: number;
  /** Dual-plane local condition number: sqrt(e1) / max(sqrt(e3), 1e-14) */
  conditionNumberDual: number;
  /** Single-plane 3x3 Gram matrix J_single^T * J_single */
  gramSingle: Float64Array;
  /** Dual-plane 3x3 Gram matrix J_dual^T * J_dual */
  gramDual: Float64Array;
  /** Boundary note explicitly warning that local identifiability != global uniqueness */
  boundaryNote: string;
}

/**
 * Validates that coefficients object is present and contains finite numbers.
 */
export function validateReferenceCoefficients(reference: Coefficients): void {
  if (
    !reference ||
    typeof reference !== 'object' ||
    typeof reference.astig0 !== 'number' ||
    typeof reference.comaX !== 'number' ||
    typeof reference.spherical !== 'number' ||
    !Number.isFinite(reference.astig0) ||
    !Number.isFinite(reference.comaX) ||
    !Number.isFinite(reference.spherical)
  ) {
    throw new TypeError(
      'Reference coefficients must contain finite numbers for astig0, comaX, and spherical'
    );
  }
}

/**
 * Computes the eigenvalues and eigenvectors of a 3x3 real symmetric matrix
 * using the classical Jacobi rotation method.
 *
 * Guarantees:
 * - Eigenvalues sorted in descending order: e1 >= e2 >= e3.
 * - Numerical stability with cancellation-free tangent formula.
 * - Orthogonal eigenvector matrix V: V^T * V = I.
 * - Tracial preservation: sum(eigenvalues) == trace(A) to machine precision.
 * - Non-negative clamping for small negative eigenvalues within tolerance.
 *
 * @param A 3x3 symmetric matrix, flat row-major array of length 9 or 3x3 nested array
 * @param options Jacobi options (tolerance, maxSweeps, clampNonNegative, nonNegativeClampTol)
 * @returns JacobiResult
 */
export function jacobiSymmetric3(
  A: ArrayLike<number> | ArrayLike<number>[],
  options?: JacobiOptions
): JacobiResult {
  const tol = options?.tolerance ?? DEFAULT_JACOBI_TOLERANCE;
  const maxSweeps = options?.maxSweeps ?? DEFAULT_MAX_JACOBI_SWEEPS;
  const clampNonNegative = options?.clampNonNegative ?? true;
  const clampTol = options?.nonNegativeClampTol ?? DEFAULT_NON_NEGATIVE_CLAMP_TOL;

  // 1. Flatten and validate matrix entries
  let a00: number, a01: number, a02: number;
  let a10: number, a11: number, a12: number;
  let a20: number, a21: number, a22: number;

  if (Array.isArray(A) && A.length === 3 && Array.isArray(A[0])) {
    const r0 = A[0] as ArrayLike<number>;
    const r1 = (A as ArrayLike<number>[])[1]!;
    const r2 = (A as ArrayLike<number>[])[2]!;
    a00 = r0[0]!; a01 = r0[1]!; a02 = r0[2]!;
    a10 = r1[0]!; a11 = r1[1]!; a12 = r1[2]!;
    a20 = r2[0]!; a21 = r2[1]!; a22 = r2[2]!;
  } else {
    const flat = A as ArrayLike<number>;
    if (flat.length < 9) {
      throw new TypeError(`Matrix A must contain at least 9 elements, got ${flat.length}`);
    }
    a00 = flat[0]!; a01 = flat[1]!; a02 = flat[2]!;
    a10 = flat[3]!; a11 = flat[4]!; a12 = flat[5]!;
    a20 = flat[6]!; a21 = flat[7]!; a22 = flat[8]!;
  }

  if (
    !Number.isFinite(a00) || !Number.isFinite(a01) || !Number.isFinite(a02) ||
    !Number.isFinite(a10) || !Number.isFinite(a11) || !Number.isFinite(a12) ||
    !Number.isFinite(a20) || !Number.isFinite(a21) || !Number.isFinite(a22)
  ) {
    throw new TypeError('Matrix A contains non-finite entries');
  }

  // 2. Symmetrize off-diagonals to eliminate floating-point representation discrepancy
  let m00 = a00;
  let m11 = a11;
  let m22 = a22;
  let m01 = (a01 + a10) * 0.5;
  let m02 = (a02 + a20) * 0.5;
  let m12 = (a12 + a21) * 0.5;

  // 3. Initialize eigenvectors matrix V as 3x3 identity
  // Column j is eigenvector j: V[0*3 + j], V[1*3 + j], V[2*3 + j]
  let v00 = 1.0, v01 = 0.0, v02 = 0.0;
  let v10 = 0.0, v11 = 1.0, v12 = 0.0;
  let v20 = 0.0, v21 = 0.0, v22 = 1.0;

  let sweep = 0;
  for (; sweep < maxSweeps; sweep++) {
    // Frobenius norm squared of off-diagonal elements
    const offDiagSq = 2.0 * (m01 * m01 + m02 * m02 + m12 * m12);
    if (offDiagSq <= tol * tol) {
      break;
    }

    // --- Pair (0, 1) ---
    if (Math.abs(m01) > 0.0) {
      const tau = (m11 - m00) / (2.0 * m01);
      const t = tau >= 0.0
        ? 1.0 / (tau + Math.sqrt(1.0 + tau * tau))
        : -1.0 / (-tau + Math.sqrt(1.0 + tau * tau));
      const c = 1.0 / Math.sqrt(1.0 + t * t);
      const s = t * c;
      const theta = t * m01;

      m00 -= theta;
      m11 += theta;
      m01 = 0.0;

      const prev02 = m02;
      const prev12 = m12;
      m02 = c * prev02 - s * prev12;
      m12 = s * prev02 + c * prev12;

      // Rotate eigenvector columns 0 and 1
      const oldV00 = v00, oldV01 = v01;
      v00 = c * oldV00 - s * oldV01;
      v01 = s * oldV00 + c * oldV01;

      const oldV10 = v10, oldV11 = v11;
      v10 = c * oldV10 - s * oldV11;
      v11 = s * oldV10 + c * oldV11;

      const oldV20 = v20, oldV21 = v21;
      v20 = c * oldV20 - s * oldV21;
      v21 = s * oldV20 + c * oldV21;
    }

    // --- Pair (0, 2) ---
    if (Math.abs(m02) > 0.0) {
      const tau = (m22 - m00) / (2.0 * m02);
      const t = tau >= 0.0
        ? 1.0 / (tau + Math.sqrt(1.0 + tau * tau))
        : -1.0 / (-tau + Math.sqrt(1.0 + tau * tau));
      const c = 1.0 / Math.sqrt(1.0 + t * t);
      const s = t * c;
      const theta = t * m02;

      m00 -= theta;
      m22 += theta;
      m02 = 0.0;

      const prev01 = m01;
      const prev12 = m12;
      m01 = c * prev01 - s * prev12;
      m12 = s * prev01 + c * prev12;

      // Rotate eigenvector columns 0 and 2
      const oldV00 = v00, oldV02 = v02;
      v00 = c * oldV00 - s * oldV02;
      v02 = s * oldV00 + c * oldV02;

      const oldV10 = v10, oldV12 = v12;
      v10 = c * oldV10 - s * oldV12;
      v12 = s * oldV10 + c * oldV12;

      const oldV20 = v20, oldV22 = v22;
      v20 = c * oldV20 - s * oldV22;
      v22 = s * oldV20 + c * oldV22;
    }

    // --- Pair (1, 2) ---
    if (Math.abs(m12) > 0.0) {
      const tau = (m22 - m11) / (2.0 * m12);
      const t = tau >= 0.0
        ? 1.0 / (tau + Math.sqrt(1.0 + tau * tau))
        : -1.0 / (-tau + Math.sqrt(1.0 + tau * tau));
      const c = 1.0 / Math.sqrt(1.0 + t * t);
      const s = t * c;
      const theta = t * m12;

      m11 -= theta;
      m22 += theta;
      m12 = 0.0;

      const prev01 = m01;
      const prev02 = m02;
      m01 = c * prev01 - s * prev02;
      m02 = s * prev01 + c * prev02;

      // Rotate eigenvector columns 1 and 2
      const oldV01 = v01, oldV02 = v02;
      v01 = c * oldV01 - s * oldV02;
      v02 = s * oldV01 + c * oldV02;

      const oldV11 = v11, oldV12 = v12;
      v11 = c * oldV11 - s * oldV12;
      v12 = s * oldV11 + c * oldV12;

      const oldV21 = v21, oldV22 = v22;
      v21 = c * oldV21 - s * oldV22;
      v22 = s * oldV21 + c * oldV22;
    }
  }

  // 4. Extract raw eigenvalues
  let e0 = m00;
  let e1 = m11;
  let e2 = m22;

  // Apply non-negative clamping if enabled:
  // Tiny negative eigenvalues within tolerance are clamped to 0.0
  if (clampNonNegative) {
    if (e0 < 0.0 && e0 >= -clampTol) e0 = 0.0;
    if (e1 < 0.0 && e1 >= -clampTol) e1 = 0.0;
    if (e2 < 0.0 && e2 >= -clampTol) e2 = 0.0;
  }

  // 5. Sort eigenvalues in descending order: e1 >= e2 >= e3
  // and reorder corresponding eigenvector columns
  const pairs: Array<{
    val: number;
    col: [number, number, number];
  }> = [
    { val: e0, col: [v00, v10, v20] },
    { val: e1, col: [v01, v11, v21] },
    { val: e2, col: [v02, v12, v22] },
  ];

  pairs.sort((a, b) => b.val - a.val);

  const sortedEigenvalues: [number, number, number] = [
    pairs[0]!.val,
    pairs[1]!.val,
    pairs[2]!.val,
  ];

  const sortedEigenvectors = new Float64Array(9);
  // Column 0
  sortedEigenvectors[0] = pairs[0]!.col[0];
  sortedEigenvectors[3] = pairs[0]!.col[1];
  sortedEigenvectors[6] = pairs[0]!.col[2];
  // Column 1
  sortedEigenvectors[1] = pairs[1]!.col[0];
  sortedEigenvectors[4] = pairs[1]!.col[1];
  sortedEigenvectors[7] = pairs[1]!.col[2];
  // Column 2
  sortedEigenvectors[2] = pairs[2]!.col[0];
  sortedEigenvectors[5] = pairs[2]!.col[1];
  sortedEigenvectors[8] = pairs[2]!.col[2];

  return {
    eigenvalues: sortedEigenvalues,
    eigenvectors: sortedEigenvectors,
    sweeps: sweep,
  };
}

/**
 * Checks whether a 3x3 symmetric matrix is positive semi-definite (PSD)
 * by verifying all eigenvalues are non-negative within numerical tolerance.
 *
 * @param A 3x3 matrix
 * @param tolerance Tolerance threshold (default: 1e-10)
 * @returns boolean
 */
export function isPositiveSemiDefinite3(
  A: ArrayLike<number> | ArrayLike<number>[],
  tolerance = DEFAULT_NON_NEGATIVE_CLAMP_TOL
): boolean {
  const result = jacobiSymmetric3(A, {
    clampNonNegative: false,
    tolerance: DEFAULT_JACOBI_TOLERANCE,
  });
  // Check that the minimum eigenvalue is >= -tolerance
  return result.eigenvalues[2] >= -tolerance;
}

/**
 * Computes local sensitivity singular values from eigenvalues: sqrt(max(0, ei)).
 */
export function computeSingularValues(
  eigenvalues: [number, number, number]
): [number, number, number] {
  return [
    Math.sqrt(Math.max(0, eigenvalues[0])),
    Math.sqrt(Math.max(0, eigenvalues[1])),
    Math.sqrt(Math.max(0, eigenvalues[2])),
  ];
}

/**
 * Computes the local condition number kappa = sqrt(e1) / max(sqrt(e3), 1e-14).
 * As specified in PROJECT_BOOK.md Section 5.5.
 */
export function computeLocalConditionNumber(
  eigenvalues: [number, number, number]
): number {
  const s1 = Math.sqrt(Math.max(0, eigenvalues[0]));
  const s3 = Math.sqrt(Math.max(0, eigenvalues[2]));
  return s1 / Math.max(s3, CONDITION_NUMBER_MIN_DENOM);
}

/**
 * Computes the 3x3 Gram matrix G = J^T * J for the forward model at a given reference
 * parameter vector for the specified mode ('single' or 'dual').
 *
 * Does not depend on observation values, as observations are additive constants
 * canceled in central difference derivatives.
 *
 * @param reference Linearization reference parameter vector
 * @param mode 'single' (defocus -0.65 waves) or 'dual' (defocus -0.65 and +0.65 waves)
 * @returns 3x3 symmetric Float64Array of length 9
 */
export function computeInformationMatrix(
  reference: Coefficients,
  mode: Mode
): Float64Array {
  validateReferenceCoefficients(reference);

  // Construct dummy observation buffer of exact PIXEL_COUNT length
  const dummyObs = {
    minus: new Float64Array(PIXEL_COUNT),
    plus: new Float64Array(PIXEL_COUNT),
  };

  const res = lossAndJacobian(dummyObs, reference, mode);
  return computeGramMatrix(res.jacobian, res.rows);
}

/**
 * Analyzes local identifiability at a common reference coefficient vector.
 *
 * IMPLEMENTATION_PLAN.md Section 3.3 & PROJECT_BOOK.md Section 5.5:
 * - Linearizes both single-plane and dual-plane models at the EXACT SAME parameter reference a_ref.
 * - Computes G_single = J_single^T * J_single and G_dual = J_dual^T * J_dual.
 * - Solves the symmetric 3x3 eigenvalue problem via Jacobi's algorithm with non-negative clamping.
 * - Evaluates singular values sqrt(ei), condition numbers, and matrix traces.
 * - Does NOT derive information metrics from ground truth.
 * - Attaches explicit boundary warning: local identifiability != global uniqueness.
 *
 * @param reference Linearization coefficient vector (e.g. estimate from dual fit)
 * @param observations Optional observations buffer (does not alter J or G)
 * @returns LocalAnalysisResult satisfying InformationSpectrum
 */
export function analyzeLocal(
  reference: Coefficients,
  observations?:
    | CaseV1['observations']
    | { minus: ArrayLike<number>; plus?: ArrayLike<number> }
): LocalAnalysisResult {
  validateReferenceCoefficients(reference);

  // Construct observation buffer for lossAndJacobian call
  const obsBuffer =
    observations && observations.minus && observations.minus.length === PIXEL_COUNT
      ? observations
      : {
          minus: new Float64Array(PIXEL_COUNT),
          plus: new Float64Array(PIXEL_COUNT),
        };

  // 1. Compute single and dual Jacobians and Gram matrices at the EXACT SAME reference
  const singleJacRes = lossAndJacobian(obsBuffer, reference, 'single');
  const dualJacRes = lossAndJacobian(obsBuffer, reference, 'dual');

  const gramSingle = computeGramMatrix(singleJacRes.jacobian, singleJacRes.rows);
  const gramDual = computeGramMatrix(dualJacRes.jacobian, dualJacRes.rows);

  // 2. Compute matrix traces directly from diagonal entries: Tr(G) = G00 + G11 + G22
  const traceSingle = gramSingle[0]! + gramSingle[4]! + gramSingle[8]!;
  const traceDual = gramDual[0]! + gramDual[4]! + gramDual[8]!;

  // 3. Decompose symmetric 3x3 Gram matrices via Jacobi algorithm
  const singleEigRes = jacobiSymmetric3(gramSingle, {
    tolerance: DEFAULT_JACOBI_TOLERANCE,
    clampNonNegative: true,
    nonNegativeClampTol: DEFAULT_NON_NEGATIVE_CLAMP_TOL,
  });

  const dualEigRes = jacobiSymmetric3(gramDual, {
    tolerance: DEFAULT_JACOBI_TOLERANCE,
    clampNonNegative: true,
    nonNegativeClampTol: DEFAULT_NON_NEGATIVE_CLAMP_TOL,
  });

  const eigenSingle = singleEigRes.eigenvalues;
  const eigenDual = dualEigRes.eigenvalues;

  // 4. Compute singular values and condition numbers
  const singularValuesSingle = computeSingularValues(eigenSingle);
  const singularValuesDual = computeSingularValues(eigenDual);

  const conditionNumberSingle = computeLocalConditionNumber(eigenSingle);
  const conditionNumberDual = computeLocalConditionNumber(eigenDual);

  return {
    reference: {
      astig0: reference.astig0,
      comaX: reference.comaX,
      spherical: reference.spherical,
    },
    eigenSingle,
    eigenDual,
    singularValuesSingle,
    singularValuesDual,
    traceSingle,
    traceDual,
    conditionNumberSingle,
    conditionNumberDual,
    gramSingle,
    gramDual,
    boundaryNote: LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE,
  };
}
