/**
 * P007 FocusWitness — Levenberg-Marquardt Aberration Optimizer
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 5.3: Observations, objective function, and residuals
 * - PROJECT_BOOK.md Section 5.4: LM Numerical Inversion:
 *   - a_init = [0, 0, 0], box constraint [-0.15, 0.15]^3, max 60 iterations, no random init.
 *   - Central difference h = 1e-4 waves.
 *   - (G + lambda*D + 1e-12*I)*delta = -g, D_jj = max(G_jj, 1e-12), initial lambda = 1e-2.
 *   - delta_j bounded to [-0.04, 0.04] waves, a_new = clip(a + delta, -0.15, 0.15).
 *   - If L_new < L_current - 1e-18: accept; lambda = max(lambda * 0.3, 1e-7).
 *     Else: reject; lambda = min(lambda * 10, 1e7).
 *     At most one history event per trial.
 *   - Convergence criteria:
 *     L <= 1e-14, or accepted max(abs(delta)) < 1e-7, or 3 consecutive accepted relative loss improvement < 1e-10.
 *     Explicit termination status: 'converged' | 'max_iterations' | 'stalled' | 'cancelled'.
 *   - Uses Gaussian elimination with partial pivoting (linear3.ts).
 *     Singular/non-finite must report NUMERIC_FAILURE.
 * - IMPLEMENTATION_PLAN.md Section 3.3:
 *   fit(observations, mode, onProgress?, shouldCancel?) MUST NOT receive or read groundTruth.
 */

import type {
  CaseV1,
  Coefficients,
  FitResult,
  FitStatus,
  FocusPlane,
  IterationRecord,
  Mode,
  Observations,
} from '../domain/types';
import {
  COEFFICIENT_MAX,
  COEFFICIENT_MIN,
  CONVERGENCE_CONSECUTIVE_STEPS,
  CONVERGENCE_LOSS_THRESHOLD,
  CONVERGENCE_RELATIVE_LOSS_THRESHOLD,
  CONVERGENCE_STEP_THRESHOLD,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
  INITIAL_COEFFICIENTS,
  INITIAL_LAMBDA,
  LAMBDA_DECREASE_FACTOR,
  LAMBDA_INCREASE_FACTOR,
  LAMBDA_MAX,
  LAMBDA_MIN,
  LOSS_IMPROVEMENT_EPSILON,
  MAX_ITERATIONS,
  MAX_STEP_DELTA,
} from '../domain/constants';
import { computeGramAndGradient, computeResidualsAndLoss, lossAndJacobian } from './jacobian';
import { solveDampedSystem } from './linear3';

/**
 * Clips a value to the box constraint [COEFFICIENT_MIN, COEFFICIENT_MAX].
 */
function clipCoefficient(val: number): number {
  return Math.max(COEFFICIENT_MIN, Math.min(COEFFICIENT_MAX, val));
}

/**
 * Clips a step delta to [-MAX_STEP_DELTA, MAX_STEP_DELTA].
 */
function clipDelta(val: number): number {
  return Math.max(-MAX_STEP_DELTA, Math.min(MAX_STEP_DELTA, val));
}

/**
 * Levenberg-Marquardt optimization for recovering unknown aberration coefficients
 * from defocused intensity observations.
 *
 * CRITICAL CONTRACT:
 * - This function accepts strictly observations, mode, optional onProgress callback,
 *   and optional shouldCancel predicate.
 * - It NEVER receives, reads, or inspects groundTruth.
 *
 * @param observations Observation intensity buffers (minus and plus for dual; minus for single)
 * @param mode 'single' or 'dual'
 * @param onProgress Optional callback invoked on each trial with the IterationRecord
 * @param shouldCancel Optional cancellation check predicate
 * @returns FitResult conforming to PROJECT_BOOK.md Section 5.4 & 6.1
 */
export function fit(
  observations: CaseV1['observations'] | Observations,
  mode: Mode,
  onProgress?: (iteration: IterationRecord) => void,
  shouldCancel?: () => boolean
): FitResult {
  // Enforce contract: sanitize observations object to never read any groundTruth property
  const cleanObservations = {
    minus: observations.minus,
    plus: observations.plus,
  };

  const fittedPlanes: FocusPlane[] =
    mode === 'single'
      ? [DIVERSITY_DEFOCUS_MINUS]
      : [DIVERSITY_DEFOCUS_MINUS, DIVERSITY_DEFOCUS_PLUS];

  // Initial estimate strictly [0, 0, 0] per PROJECT_BOOK.md Section 5.4
  let a: Coefficients = {
    astig0: INITIAL_COEFFICIENTS.astig0,
    comaX: INITIAL_COEFFICIENTS.comaX,
    spherical: INITIAL_COEFFICIENTS.spherical,
  };

  const history: IterationRecord[] = [];

  // Early cancellation check
  if (shouldCancel && shouldCancel()) {
    const initLj = computeResidualsAndLoss(cleanObservations, a, mode);
    return {
      status: 'cancelled',
      mode,
      estimate: { ...a },
      initialLoss: initLj.loss,
      finalLoss: initLj.loss,
      history,
      fittedPlanes,
    };
  }

  // Initial evaluation: loss, residuals, and numerical Jacobian at a_init
  let lj = lossAndJacobian(cleanObservations, a, mode);
  const initialLoss = lj.loss;
  let currentLoss = initialLoss;
  let currentResiduals = lj.residuals;
  let currentJacobian = lj.jacobian;

  // Immediate convergence check at a_init
  if (currentLoss <= CONVERGENCE_LOSS_THRESHOLD) {
    return {
      status: 'converged',
      mode,
      estimate: { ...a },
      initialLoss,
      finalLoss: currentLoss,
      history,
      fittedPlanes,
    };
  }

  let lambda = INITIAL_LAMBDA;
  let status: FitStatus = 'max_iterations';
  let consecutiveSmallRelSteps = 0;

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    // Check cancellation at the beginning of each iteration
    if (shouldCancel && shouldCancel()) {
      status = 'cancelled';
      break;
    }

    // 1. Compute normal equations: G = J^T * J, g = J^T * r
    const { G, g } = computeGramAndGradient(currentJacobian, currentResiduals, lj.rows);

    // 2. Solve damped system: (G + lambda*D + 1e-12*I) * delta = -g
    // Throws NumericFailureError if singular or non-finite per specification
    const rawDelta = solveDampedSystem(G, g, lambda);

    // 3. Bound step: delta_j in [-0.04, 0.04] waves
    const d0 = clipDelta(rawDelta[0]);
    const d1 = clipDelta(rawDelta[1]);
    const d2 = clipDelta(rawDelta[2]);

    const maxAbsDelta = Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2));

    // 4. Candidate parameter: a_new = clip(a + delta, -0.15, 0.15)
    const aNew: Coefficients = {
      astig0: clipCoefficient(a.astig0 + d0),
      comaX: clipCoefficient(a.comaX + d1),
      spherical: clipCoefficient(a.spherical + d2),
    };

    // 5. Evaluate candidate loss
    const candidate = computeResidualsAndLoss(cleanObservations, aNew, mode);
    const candidateLoss = candidate.loss;

    const trialLambda = lambda;

    // 6. Acceptance criterion: L_new < L_current - 1e-18
    if (candidateLoss < currentLoss - LOSS_IMPROVEMENT_EPSILON) {
      // Step accepted!
      const lossDiff = currentLoss - candidateLoss;
      const relImprovement = lossDiff / Math.max(currentLoss, 1e-30);

      a = aNew;
      currentLoss = candidateLoss;
      currentResiduals = candidate.residuals;

      const record: IterationRecord = {
        iter,
        loss: currentLoss,
        lambda: trialLambda,
        accepted: true,
        coefficients: { ...a },
      };
      history.push(record);
      if (onProgress) {
        onProgress(record);
      }

      // Decrease damping: lambda = max(lambda * 0.3, 1e-7)
      lambda = Math.max(lambda * LAMBDA_DECREASE_FACTOR, LAMBDA_MIN);

      // Check convergence criteria (Section 5.4):
      // Condition 1: L <= 1e-14
      if (currentLoss <= CONVERGENCE_LOSS_THRESHOLD) {
        status = 'converged';
        break;
      }

      // Condition 2: max(abs(delta)) < 1e-7 on accepted step
      if (maxAbsDelta < CONVERGENCE_STEP_THRESHOLD) {
        status = 'converged';
        break;
      }

      // Condition 3: consecutive 3 accepted steps with relative loss improvement < 1e-10
      if (relImprovement < CONVERGENCE_RELATIVE_LOSS_THRESHOLD) {
        consecutiveSmallRelSteps++;
        if (consecutiveSmallRelSteps >= CONVERGENCE_CONSECUTIVE_STEPS) {
          status = 'converged';
          break;
        }
      } else {
        consecutiveSmallRelSteps = 0;
      }

      // If we will continue to next iteration, recompute full Jacobian at new a
      if (iter < MAX_ITERATIONS) {
        lj = lossAndJacobian(cleanObservations, a, mode);
        currentJacobian = lj.jacobian;
        currentResiduals = lj.residuals;
      }
    } else {
      // Step rejected!
      const record: IterationRecord = {
        iter,
        loss: currentLoss,
        lambda: trialLambda,
        accepted: false,
        coefficients: { ...a },
      };
      history.push(record);
      if (onProgress) {
        onProgress(record);
      }

      consecutiveSmallRelSteps = 0;

      // Check stalled condition: already at max lambda and cannot make progress
      if (lambda >= LAMBDA_MAX) {
        status = 'stalled';
        break;
      }

      // Increase damping: lambda = min(lambda * 10, 1e7)
      lambda = Math.min(lambda * LAMBDA_INCREASE_FACTOR, LAMBDA_MAX);
      // a, currentJacobian, and currentResiduals remain unchanged for next trial
    }
  }

  return {
    status,
    mode,
    estimate: { ...a },
    initialLoss,
    finalLoss: currentLoss,
    history,
    fittedPlanes,
  };
}
