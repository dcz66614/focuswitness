/**
 * P007 FocusWitness — Numerical Jacobian and Residual Evaluation
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 5.3: Observations, objective function, and residuals
 *   r_p,k(a) = I_p,k(a) - O_p,k
 *   L(a; S)  = sum_{p in S} sum_{k=0..4095} r_p,k(a)^2
 *   S_single = {-0.65}, S_dual = {-0.65, +0.65}
 * - PROJECT_BOOK.md Section 5.4: Central difference J[:, j] = (r(a + h*ej) - r(a - h*ej)) / (2*h),
 *   h = 1e-4 waves. Model extrapolation outside box allowed only during numerical derivative calculation.
 * - IMPLEMENTATION_PLAN.md Section 3.3:
 *   lossAndJacobian(observations, coefficients, mode) returns residuals vector, unscaled loss,
 *   numerical J (shape (|S|*4096) x 3).
 */

import type { CaseV1, Coefficients, Mode } from '../domain/types';
import {
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
  FINITE_DIFFERENCE_STEP,
  PIXEL_COUNT,
} from '../domain/constants';
import { forwardPsf } from './psf';

export interface LossAndJacobianResult {
  residuals: Float64Array;
  loss: number;
  jacobian: Float64Array; // shape (rows x 3), row-major: index = row * 3 + col
  rows: number;
  cols: number;
}

export interface ResidualsAndLossResult {
  residuals: Float64Array;
  loss: number;
  rows: number;
}

/**
 * Validates coefficient parameters are finite numbers.
 */
function validateCoefficients(coefficients: Coefficients): void {
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
      'Coefficients must contain finite numbers for astig0, comaX, and spherical'
    );
  }
}

/**
 * Validates mode is 'single' or 'dual'.
 */
function validateMode(mode: Mode): void {
  if (mode !== 'single' && mode !== 'dual') {
    throw new TypeError(`Invalid mode "${mode}": must be 'single' or 'dual'`);
  }
}

/**
 * Validates observations object and required plane buffers.
 */
function validateObservations(
  observations: CaseV1['observations'] | { minus: ArrayLike<number>; plus?: ArrayLike<number> },
  mode: Mode
): void {
  if (!observations || typeof observations !== 'object') {
    throw new TypeError('Observations must be an object with minus and plus buffers');
  }

  if (!observations.minus || observations.minus.length !== PIXEL_COUNT) {
    throw new TypeError(
      `observations.minus must contain exactly ${PIXEL_COUNT} elements, got ${observations.minus?.length}`
    );
  }

  if (mode === 'dual') {
    if (!observations.plus || observations.plus.length !== PIXEL_COUNT) {
      throw new TypeError(
        `observations.plus must contain exactly ${PIXEL_COUNT} elements for dual mode, got ${observations.plus?.length}`
      );
    }
  }
}

/**
 * Computes residuals and unscaled sum-of-squares loss L(a; S) without numerical derivatives.
 * Fast path for candidate step evaluation in the Levenberg-Marquardt optimizer.
 */
export function computeResidualsAndLoss(
  observations: CaseV1['observations'] | { minus: ArrayLike<number>; plus?: ArrayLike<number> },
  coefficients: Coefficients,
  mode: Mode
): ResidualsAndLossResult {
  validateCoefficients(coefficients);
  validateMode(mode);
  validateObservations(observations, mode);

  const numPlanes = mode === 'single' ? 1 : 2;
  const totalRows = numPlanes * PIXEL_COUNT;
  const residuals = new Float64Array(totalRows);

  let loss = 0.0;

  // Plane 0: defocus -0.65 waves
  const IMinus = forwardPsf(coefficients, DIVERSITY_DEFOCUS_MINUS);
  const obsMinus = observations.minus;
  for (let k = 0; k < PIXEL_COUNT; k++) {
    const r = IMinus[k]! - obsMinus[k]!;
    residuals[k] = r;
    loss += r * r;
  }

  // Plane 1 (if dual mode): defocus +0.65 waves
  if (mode === 'dual') {
    const IPlus = forwardPsf(coefficients, DIVERSITY_DEFOCUS_PLUS);
    const obsPlus = observations.plus!;
    const offset = PIXEL_COUNT;
    for (let k = 0; k < PIXEL_COUNT; k++) {
      const r = IPlus[k]! - obsPlus[k]!;
      residuals[offset + k] = r;
      loss += r * r;
    }
  }

  return { residuals, loss, rows: totalRows };
}

/**
 * Computes the residual vector, unscaled loss, and central-difference numerical Jacobian
 * matrix J of shape (|S|*4096) x 3.
 *
 * For each parameter j in {0: astig0, 1: comaX, 2: spherical}:
 *   J[:, j] = (r(a + h*ej) - r(a - h*ej)) / (2*h) = (I(a + h*ej) - I(a - h*ej)) / (2*h)
 * with finite difference step h = 1e-4 waves.
 *
 * @param observations Observation intensity buffers (minus, plus)
 * @param coefficients Unknown aberration coefficients (astig0, comaX, spherical)
 * @param mode 'single' (|S|=1, 4096 rows) or 'dual' (|S|=2, 8192 rows)
 * @returns LossAndJacobianResult
 */
export function lossAndJacobian(
  observations: CaseV1['observations'] | { minus: ArrayLike<number>; plus?: ArrayLike<number> },
  coefficients: Coefficients,
  mode: Mode
): LossAndJacobianResult {
  validateCoefficients(coefficients);
  validateMode(mode);
  validateObservations(observations, mode);

  const numPlanes = mode === 'single' ? 1 : 2;
  const totalRows = numPlanes * PIXEL_COUNT;
  const residuals = new Float64Array(totalRows);
  let loss = 0.0;

  // 1. Evaluate baseline forward PSF and residuals r(a)
  const IMinus = forwardPsf(coefficients, DIVERSITY_DEFOCUS_MINUS);
  const obsMinus = observations.minus;
  for (let k = 0; k < PIXEL_COUNT; k++) {
    const r = IMinus[k]! - obsMinus[k]!;
    residuals[k] = r;
    loss += r * r;
  }

  let IPlus: Float64Array | null = null;
  if (mode === 'dual') {
    IPlus = forwardPsf(coefficients, DIVERSITY_DEFOCUS_PLUS);
    const obsPlus = observations.plus!;
    const offset = PIXEL_COUNT;
    for (let k = 0; k < PIXEL_COUNT; k++) {
      const r = IPlus[k]! - obsPlus[k]!;
      residuals[offset + k] = r;
      loss += r * r;
    }
  }

  // 2. Evaluate central-difference Jacobian J[:, j]
  // jacobian array is flat: J[row * 3 + col]
  const jacobian = new Float64Array(totalRows * 3);
  const h = FINITE_DIFFERENCE_STEP;
  const inv2h = 1.0 / (2.0 * h);

  const a0 = coefficients.astig0;
  const a1 = coefficients.comaX;
  const a2 = coefficients.spherical;

  // Perturbation vectors for 3 parameters:
  // j = 0: astig0
  // j = 1: comaX
  // j = 2: spherical
  for (let j = 0; j < 3; j++) {
    const aPlus: Coefficients = {
      astig0: j === 0 ? a0 + h : a0,
      comaX: j === 1 ? a1 + h : a1,
      spherical: j === 2 ? a2 + h : a2,
    };

    const aMinus: Coefficients = {
      astig0: j === 0 ? a0 - h : a0,
      comaX: j === 1 ? a1 - h : a1,
      spherical: j === 2 ? a2 - h : a2,
    };

    // Forward PSF for negative diversity plane (-0.65)
    const plusMinus = forwardPsf(aPlus, DIVERSITY_DEFOCUS_MINUS);
    const minusMinus = forwardPsf(aMinus, DIVERSITY_DEFOCUS_MINUS);

    for (let k = 0; k < PIXEL_COUNT; k++) {
      jacobian[k * 3 + j] = (plusMinus[k]! - minusMinus[k]!) * inv2h;
    }

    // Forward PSF for positive diversity plane (+0.65) if dual mode
    if (mode === 'dual') {
      const plusPlus = forwardPsf(aPlus, DIVERSITY_DEFOCUS_PLUS);
      const minusPlus = forwardPsf(aMinus, DIVERSITY_DEFOCUS_PLUS);
      const offset = PIXEL_COUNT;
      for (let k = 0; k < PIXEL_COUNT; k++) {
        jacobian[(offset + k) * 3 + j] = (plusPlus[k]! - minusPlus[k]!) * inv2h;
      }
    }
  }

  return {
    residuals,
    loss,
    jacobian,
    rows: totalRows,
    cols: 3,
  };
}

/**
 * Computes Gram matrix G = J^T * J (3x3) and gradient vector g = J^T * r (3x1).
 *
 * @param jacobian Flat Float64Array of shape (rows x 3), row-major
 * @param residuals Flat Float64Array of length rows
 * @param rows Number of rows in Jacobian / residuals
 * @returns { G: Float64Array(9), g: Float64Array(3) }
 */
export function computeGramAndGradient(
  jacobian: Float64Array,
  residuals: Float64Array,
  rows: number
): { G: Float64Array; g: Float64Array } {
  let g00 = 0.0, g01 = 0.0, g02 = 0.0;
  let g11 = 0.0, g12 = 0.0;
  let g22 = 0.0;

  let grad0 = 0.0, grad1 = 0.0, grad2 = 0.0;

  for (let i = 0; i < rows; i++) {
    const base = i * 3;
    const j0 = jacobian[base]!;
    const j1 = jacobian[base + 1]!;
    const j2 = jacobian[base + 2]!;
    const r = residuals[i]!;

    g00 += j0 * j0;
    g01 += j0 * j1;
    g02 += j0 * j2;

    g11 += j1 * j1;
    g12 += j1 * j2;

    g22 += j2 * j2;

    grad0 += j0 * r;
    grad1 += j1 * r;
    grad2 += j2 * r;
  }

  const G = new Float64Array(9);
  G[0] = g00; G[1] = g01; G[2] = g02;
  G[3] = g01; G[4] = g11; G[5] = g12;
  G[6] = g02; G[7] = g12; G[8] = g22;

  const g = new Float64Array(3);
  g[0] = grad0;
  g[1] = grad1;
  g[2] = grad2;

  return { G, g };
}

/**
 * Computes the 3x3 Gram matrix G = J^T * J directly.
 *
 * @param jacobian Flat Float64Array of shape (rows x 3), row-major
 * @param rows Number of rows
 * @returns 3x3 symmetric matrix as flat Float64Array of length 9
 */
export function computeGramMatrix(
  jacobian: Float64Array,
  rows: number
): Float64Array {
  let g00 = 0.0, g01 = 0.0, g02 = 0.0;
  let g11 = 0.0, g12 = 0.0;
  let g22 = 0.0;

  for (let i = 0; i < rows; i++) {
    const base = i * 3;
    const j0 = jacobian[base]!;
    const j1 = jacobian[base + 1]!;
    const j2 = jacobian[base + 2]!;

    g00 += j0 * j0;
    g01 += j0 * j1;
    g02 += j0 * j2;

    g11 += j1 * j1;
    g12 += j1 * j2;

    g22 += j2 * j2;
  }

  const G = new Float64Array(9);
  G[0] = g00; G[1] = g01; G[2] = g02;
  G[3] = g01; G[4] = g11; G[5] = g12;
  G[6] = g02; G[7] = g12; G[8] = g22;

  return G;
}
