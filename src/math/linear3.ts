/**
 * P007 FocusWitness — 3x3 Linear System Solver with Partial Pivoting
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 5.4: Solve (G + lambda*D + 1e-12*I)*delta = -g
 *   using 3x3 Gaussian elimination with partial pivoting.
 *   Singular or non-finite numbers must report NUMERIC_FAILURE, never silently produce NaN.
 * - IMPLEMENTATION_PLAN.md Section 3.3 / 4 (P007-T005)
 */

import {
  DIAGONAL_MIN_REGULARIZATION,
  MARQUARDT_IDENTITY_EPSILON,
} from '../domain/constants';

/**
 * Custom error thrown when numerical failure (singularity, non-finite values)
 * occurs during linear system solution.
 */
export class NumericFailureError extends Error {
  readonly code = 'NUMERIC_FAILURE';

  constructor(message: string) {
    super(`NUMERIC_FAILURE: ${message}`);
    this.name = 'NumericFailureError';
  }
}

/**
 * Solves a 3x3 system A * x = b using Gaussian elimination with partial pivoting.
 *
 * @param A Matrix entries, flat row-major array of length 9 or 3x3 nested array:
 *          [a00, a01, a02, a10, a11, a12, a20, a21, a22]
 * @param b Right-hand side vector of length 3: [b0, b1, b2]
 * @returns Solution vector [x0, x1, x2]
 * @throws NumericFailureError if matrix is singular, degenerate, or contains non-finite entries.
 */
export function solveLinear3(
  A: ArrayLike<number> | ArrayLike<number>[],
  b: ArrayLike<number>
): [number, number, number] {
  // 1. Flatten and validate matrix A
  let a00: number, a01: number, a02: number;
  let a10: number, a11: number, a12: number;
  let a20: number, a21: number, a22: number;

  if (Array.isArray(A) && A.length === 3 && Array.isArray(A[0])) {
    const row0 = A[0] as ArrayLike<number>;
    const row1 = (A as ArrayLike<number>[])[1]!;
    const row2 = (A as ArrayLike<number>[])[2]!;
    a00 = row0[0]!; a01 = row0[1]!; a02 = row0[2]!;
    a10 = row1[0]!; a11 = row1[1]!; a12 = row1[2]!;
    a20 = row2[0]!; a21 = row2[1]!; a22 = row2[2]!;
  } else {
    const flat = A as ArrayLike<number>;
    if (flat.length < 9) {
      throw new NumericFailureError(`Matrix A must have at least 9 elements, got ${flat.length}`);
    }
    a00 = flat[0]!; a01 = flat[1]!; a02 = flat[2]!;
    a10 = flat[3]!; a11 = flat[4]!; a12 = flat[5]!;
    a20 = flat[6]!; a21 = flat[7]!; a22 = flat[8]!;
  }

  if (b.length < 3) {
    throw new NumericFailureError(`Vector b must have at least 3 elements, got ${b.length}`);
  }

  let y0 = b[0]!;
  let y1 = b[1]!;
  let y2 = b[2]!;

  // Check finite
  if (
    !Number.isFinite(a00) || !Number.isFinite(a01) || !Number.isFinite(a02) ||
    !Number.isFinite(a10) || !Number.isFinite(a11) || !Number.isFinite(a12) ||
    !Number.isFinite(a20) || !Number.isFinite(a21) || !Number.isFinite(a22) ||
    !Number.isFinite(y0)  || !Number.isFinite(y1)  || !Number.isFinite(y2)
  ) {
    throw new NumericFailureError('Matrix A or vector b contains non-finite values');
  }

  const PIVOT_TOL = 1e-15;

  // --- Step 0: Pivot in column 0 ---
  let maxVal = Math.abs(a00);
  let pivotRow = 0;

  if (Math.abs(a10) > maxVal) {
    maxVal = Math.abs(a10);
    pivotRow = 1;
  }
  if (Math.abs(a20) > maxVal) {
    maxVal = Math.abs(a20);
    pivotRow = 2;
  }

  if (maxVal < PIVOT_TOL) {
    throw new NumericFailureError(`Matrix A is singular in column 0 (pivot=${maxVal})`);
  }

  if (pivotRow === 1) {
    let t = a00; a00 = a10; a10 = t;
    t = a01; a01 = a11; a11 = t;
    t = a02; a02 = a12; a12 = t;
    t = y0; y0 = y1; y1 = t;
  } else if (pivotRow === 2) {
    let t = a00; a00 = a20; a20 = t;
    t = a01; a01 = a21; a21 = t;
    t = a02; a02 = a22; a22 = t;
    t = y0; y0 = y2; y2 = t;
  }

  // Eliminate row 1
  const f10 = a10 / a00;
  a11 -= f10 * a01;
  a12 -= f10 * a02;
  y1 -= f10 * y0;
  a10 = 0.0;

  // Eliminate row 2
  const f20 = a20 / a00;
  a21 -= f20 * a01;
  a22 -= f20 * a02;
  y2 -= f20 * y0;
  a20 = 0.0;

  // --- Step 1: Pivot in column 1 ---
  maxVal = Math.abs(a11);
  pivotRow = 1;

  if (Math.abs(a21) > maxVal) {
    maxVal = Math.abs(a21);
    pivotRow = 2;
  }

  if (maxVal < PIVOT_TOL) {
    throw new NumericFailureError(`Matrix A is singular in column 1 (pivot=${maxVal})`);
  }

  if (pivotRow === 2) {
    let t = a11; a11 = a21; a21 = t;
    t = a12; a12 = a22; a22 = t;
    t = y1; y1 = y2; y2 = t;
  }

  // Eliminate row 2
  const f21 = a21 / a11;
  a22 -= f21 * a12;
  y2 -= f21 * y1;
  a21 = 0.0;

  // --- Step 2: Check pivot in column 2 ---
  if (Math.abs(a22) < PIVOT_TOL) {
    throw new NumericFailureError(`Matrix A is singular in column 2 (pivot=${Math.abs(a22)})`);
  }

  // --- Back Substitution ---
  const x2 = y2 / a22;
  const x1 = (y1 - a12 * x2) / a11;
  const x0 = (y0 - a01 * x1 - a02 * x2) / a00;

  if (!Number.isFinite(x0) || !Number.isFinite(x1) || !Number.isFinite(x2)) {
    throw new NumericFailureError('Gaussian elimination produced non-finite solution');
  }

  return [x0, x1, x2];
}

/**
 * Solves the Levenberg-Marquardt damped normal system:
 *   (G + lambda*D + 1e-12*I) * delta = -g
 *
 * where:
 *   D_jj = max(G_jj, 1e-12), D_jk = 0 (j != k)
 *   I is the 3x3 identity matrix
 *
 * @param G 3x3 Gram matrix J^T * J (flat length 9)
 * @param g 3x1 Gradient vector J^T * r (flat length 3)
 * @param lambda Damping coefficient
 * @returns Step vector delta [delta0, delta1, delta2]
 */
export function solveDampedSystem(
  G: ArrayLike<number>,
  g: ArrayLike<number>,
  lambda: number
): [number, number, number] {
  if (!Number.isFinite(lambda) || lambda < 0) {
    throw new NumericFailureError(`Damping parameter lambda must be non-negative finite, got ${lambda}`);
  }

  const d00 = Math.max(G[0]!, DIAGONAL_MIN_REGULARIZATION);
  const d11 = Math.max(G[4]!, DIAGONAL_MIN_REGULARIZATION);
  const d22 = Math.max(G[8]!, DIAGONAL_MIN_REGULARIZATION);

  const A = new Float64Array(9);
  A[0] = G[0]! + lambda * d00 + MARQUARDT_IDENTITY_EPSILON;
  A[1] = G[1]!;
  A[2] = G[2]!;

  A[3] = G[3]!;
  A[4] = G[4]! + lambda * d11 + MARQUARDT_IDENTITY_EPSILON;
  A[5] = G[5]!;

  A[6] = G[6]!;
  A[7] = G[7]!;
  A[8] = G[8]! + lambda * d22 + MARQUARDT_IDENTITY_EPSILON;

  const b = [-g[0]!, -g[1]!, -g[2]!];

  return solveLinear3(A, b);
}
