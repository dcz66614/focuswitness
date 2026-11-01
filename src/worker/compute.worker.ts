/**
 * P007 FocusWitness — Dedicated Compute Worker
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 6.4: Worker Message Protocol
 *   - GENERATE: forward PSF simulation producing CaseV1
 *   - FIT: Levenberg-Marquardt aberration inversion (never accepts groundTruth)
 *   - ANALYZE: local identifiability eigenvalue spectrum at common reference
 *   - CANCEL: interrupt active calculation, yielding event loop at each iteration
 * - PROJECT_BOOK.md Chapter 7: MATH10
 *   - Rapidly switching or cancelling prevents old runId from polluting UI
 * - IMPLEMENTATION_PLAN.md Section 3.3:
 *   - Worker is the sole entry point for heavy computation
 *   - fit MUST NOT receive or read groundTruth
 */

import type {
  CaseV1,
  Coefficients,
  FitResult,
  FitStatus,
  FocusPlane,
  IterationRecord,
  Mode,
  WorkerRequest,
  WorkerResponse,
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
import {
  validateCoefficients,
  validateMode,
  validateObservations,
} from '../domain/validation';
import {
  computeGramAndGradient,
  computeResidualsAndLoss,
  lossAndJacobian,
} from '../math/jacobian';
import { NumericFailureError, solveDampedSystem } from '../math/linear3';
import { analyzeLocal } from '../math/identifiable';
import { createCaseFromCoefficients } from '../io/caseFile';

/**
 * Worker state machine variables.
 * Enforces single active computation rule: "Worker 同时最多执行一个计算请求"
 */
let activeRunId: number | null = null;
let activeRunCancelled = false;
const cancelledRunIds = new Set<number>();

/**
 * Helper to clip coefficient value to physical bounds [-0.15, 0.15] waves.
 */
function clipCoefficient(val: number): number {
  return Math.max(COEFFICIENT_MIN, Math.min(COEFFICIENT_MAX, val));
}

/**
 * Helper to clip step delta to [-0.04, 0.04] waves.
 */
function clipDelta(val: number): number {
  return Math.max(-MAX_STEP_DELTA, Math.min(MAX_STEP_DELTA, val));
}

/**
 * Explicitly yields execution to the event loop macrotask queue.
 * This allows the Worker to receive and process incoming CANCEL messages
 * or new task dispatches during long-running optimization iterations.
 */
export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export type ResponseSender = (response: WorkerResponse) => void;

/**
 * Handles incoming Worker computation requests.
 *
 * @param request WorkerRequest payload
 * @param postResponse Callback for posting WorkerResponse back to the client
 */
export async function handleWorkerRequest(
  request: WorkerRequest,
  postResponse: ResponseSender
): Promise<void> {
  if (!request || typeof request !== 'object') {
    postResponse({
      type: 'ERROR',
      runId: -1,
      code: 'INVALID_INPUT',
      message: 'Request payload must be a non-null object',
    });
    return;
  }

  const { runId, type } = request;

  if (typeof runId !== 'number' || !Number.isFinite(runId)) {
    postResponse({
      type: 'ERROR',
      runId: -1,
      code: 'INVALID_INPUT',
      message: 'runId must be a valid finite number',
    });
    return;
  }

  // Handle CANCEL request immediately
  if (type === 'CANCEL') {
    cancelledRunIds.add(runId);
    if (activeRunId === runId) {
      activeRunCancelled = true;
    }
    // Per PROJECT_BOOK.md Section 6.4:
    // "若取消新的同 id 任务不在运行，返回明确状态。"
    postResponse({
      type: 'CANCELLED',
      runId,
    });
    return;
  }

  // For computation requests: if an earlier task is running, mark it cancelled
  if (activeRunId !== null && activeRunId !== runId) {
    activeRunCancelled = true;
    cancelledRunIds.add(activeRunId);
  }

  activeRunId = runId;
  activeRunCancelled = false;

  switch (type) {
    case 'GENERATE': {
      const coeffValidation = validateCoefficients(request.coefficients);
      if (!coeffValidation.success) {
        postResponse({
          type: 'ERROR',
          runId,
          code: 'INVALID_INPUT',
          message: coeffValidation.errors.join('; '),
        });
        return;
      }

      try {
        const caseData = createCaseFromCoefficients(coeffValidation.data);
        if (activeRunId === runId && !activeRunCancelled && !cancelledRunIds.has(runId)) {
          postResponse({
            type: 'GENERATED',
            runId,
            caseData,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'ERROR',
          runId,
          code: 'NUMERIC_FAILURE',
          message,
        });
      }
      break;
    }

    case 'ANALYZE': {
      const coeffValidation = validateCoefficients(request.reference);
      if (!coeffValidation.success) {
        postResponse({
          type: 'ERROR',
          runId,
          code: 'INVALID_INPUT',
          message: `Invalid reference coefficients: ${coeffValidation.errors.join('; ')}`,
        });
        return;
      }

      const obsValidation = validateObservations(request.observations);
      if (!obsValidation.success) {
        postResponse({
          type: 'ERROR',
          runId,
          code: 'INVALID_INPUT',
          message: `Invalid observations: ${obsValidation.errors.join('; ')}`,
        });
        return;
      }

      try {
        const result = analyzeLocal(coeffValidation.data, obsValidation.data);
        if (activeRunId === runId && !activeRunCancelled && !cancelledRunIds.has(runId)) {
          postResponse({
            type: 'ANALYSIS_RESULT',
            runId,
            eigenSingle: Array.from(result.eigenSingle),
            eigenDual: Array.from(result.eigenDual),
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        postResponse({
          type: 'ERROR',
          runId,
          code: 'NUMERIC_FAILURE',
          message,
        });
      }
      break;
    }

    case 'FIT': {
      // CRITICAL CONTRACT CHECK per PROJECT_BOOK.md Section 6.4:
      // "FIT 消息结构没有 groundTruth 字段；反演模块 API 应只接收观测，不引用案例真值变量。"
      const rawReq = request as Record<string, unknown>;
      if ('groundTruth' in rawReq || (rawReq['observations'] && 'groundTruth' in (rawReq['observations'] as Record<string, unknown>))) {
        postResponse({
          type: 'ERROR',
          runId,
          code: 'INVALID_INPUT',
          message: 'FIT request MUST NOT contain groundTruth per Section 6.4 contract',
        });
        return;
      }

      const modeValidation = validateMode(request.mode);
      if (!modeValidation.success) {
        postResponse({
          type: 'ERROR',
          runId,
          code: 'INVALID_INPUT',
          message: modeValidation.errors.join('; '),
        });
        return;
      }

      const obsValidation = validateObservations(request.observations);
      if (!obsValidation.success) {
        postResponse({
          type: 'ERROR',
          runId,
          code: 'INVALID_INPUT',
          message: obsValidation.errors.join('; '),
        });
        return;
      }

      const mode = modeValidation.data;
      const cleanObservations = {
        minus: obsValidation.data.minus,
        plus: obsValidation.data.plus,
      };

      await executeFit(runId, mode, cleanObservations, postResponse);
      break;
    }

    default: {
      postResponse({
        type: 'ERROR',
        runId,
        code: 'INVALID_INPUT',
        message: `Unknown request type: ${(request as { type?: string }).type ?? 'undefined'}`,
      });
      break;
    }
  }
}

/**
 * Executes LM numerical inversion asynchronously with event loop yielding at each iteration.
 */
async function executeFit(
  thisRunId: number,
  mode: Mode,
  cleanObservations: { minus: number[]; plus: number[] },
  postResponse: ResponseSender
): Promise<void> {
  const fittedPlanes: FocusPlane[] =
    mode === 'single'
      ? [DIVERSITY_DEFOCUS_MINUS]
      : [DIVERSITY_DEFOCUS_MINUS, DIVERSITY_DEFOCUS_PLUS];

  let a: Coefficients = {
    astig0: INITIAL_COEFFICIENTS.astig0,
    comaX: INITIAL_COEFFICIENTS.comaX,
    spherical: INITIAL_COEFFICIENTS.spherical,
  };

  const history: IterationRecord[] = [];

  // Initial check for cancellation
  if (activeRunId !== thisRunId || activeRunCancelled || cancelledRunIds.has(thisRunId)) {
    postResponse({ type: 'CANCELLED', runId: thisRunId });
    return;
  }

  // Initial evaluation: loss, residuals, and numerical Jacobian at a_init
  let lj = lossAndJacobian(cleanObservations, a, mode);
  const initialLoss = lj.loss;
  let currentLoss = initialLoss;
  let currentResiduals = lj.residuals;
  let currentJacobian = lj.jacobian;

  // Immediate convergence check at a_init
  if (currentLoss <= CONVERGENCE_LOSS_THRESHOLD) {
    if (activeRunId === thisRunId && !activeRunCancelled && !cancelledRunIds.has(thisRunId)) {
      postResponse({
        type: 'FIT_RESULT',
        runId: thisRunId,
        result: {
          status: 'converged',
          mode,
          estimate: { ...a },
          initialLoss,
          finalLoss: currentLoss,
          history,
          fittedPlanes,
        },
      });
    }
    return;
  }

  let lambda = INITIAL_LAMBDA;
  let status: FitStatus = 'max_iterations';
  let consecutiveSmallRelSteps = 0;

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    // 1. Check cancellation before yielding
    if (activeRunId !== thisRunId || activeRunCancelled || cancelledRunIds.has(thisRunId)) {
      postResponse({ type: 'CANCELLED', runId: thisRunId });
      return;
    }

    // 2. Yield event loop so incoming CANCEL messages or superseding requests are processed
    await yieldEventLoop();

    // 3. Check cancellation after yielding
    if (activeRunId !== thisRunId || activeRunCancelled || cancelledRunIds.has(thisRunId)) {
      postResponse({ type: 'CANCELLED', runId: thisRunId });
      return;
    }

    // 4. Normal equations: G = J^T * J, g = J^T * r
    const { G, g } = computeGramAndGradient(currentJacobian, currentResiduals, lj.rows);

    // 5. Solve damped system: (G + lambda*D + 1e-12*I) * delta = -g
    let rawDelta: [number, number, number];
    try {
      rawDelta = solveDampedSystem(G, g, lambda);
    } catch (err: unknown) {
      if (err instanceof NumericFailureError) {
        postResponse({
          type: 'ERROR',
          runId: thisRunId,
          code: 'NUMERIC_FAILURE',
          message: err.message,
        });
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      postResponse({
        type: 'ERROR',
        runId: thisRunId,
        code: 'NUMERIC_FAILURE',
        message,
      });
      return;
    }

    // 6. Bound step: delta_j in [-0.04, 0.04] waves
    const d0 = clipDelta(rawDelta[0]);
    const d1 = clipDelta(rawDelta[1]);
    const d2 = clipDelta(rawDelta[2]);
    const maxAbsDelta = Math.max(Math.abs(d0), Math.abs(d1), Math.abs(d2));

    // 7. Candidate parameter: a_new = clip(a + delta, -0.15, 0.15)
    const aNew: Coefficients = {
      astig0: clipCoefficient(a.astig0 + d0),
      comaX: clipCoefficient(a.comaX + d1),
      spherical: clipCoefficient(a.spherical + d2),
    };

    // 8. Candidate loss
    const candidate = computeResidualsAndLoss(cleanObservations, aNew, mode);
    const candidateLoss = candidate.loss;
    const trialLambda = lambda;

    // 9. Acceptance criterion: L_new < L_current - 1e-18
    if (candidateLoss < currentLoss - LOSS_IMPROVEMENT_EPSILON) {
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

      // Emit progress message for every iteration
      if (activeRunId === thisRunId && !activeRunCancelled && !cancelledRunIds.has(thisRunId)) {
        postResponse({
          type: 'PROGRESS',
          runId: thisRunId,
          iteration: record,
        });
      }

      lambda = Math.max(lambda * LAMBDA_DECREASE_FACTOR, LAMBDA_MIN);

      // Convergence conditions
      if (currentLoss <= CONVERGENCE_LOSS_THRESHOLD) {
        status = 'converged';
        break;
      }

      if (maxAbsDelta < CONVERGENCE_STEP_THRESHOLD) {
        status = 'converged';
        break;
      }

      if (relImprovement < CONVERGENCE_RELATIVE_LOSS_THRESHOLD) {
        consecutiveSmallRelSteps++;
        if (consecutiveSmallRelSteps >= CONVERGENCE_CONSECUTIVE_STEPS) {
          status = 'converged';
          break;
        }
      } else {
        consecutiveSmallRelSteps = 0;
      }

      if (iter < MAX_ITERATIONS) {
        lj = lossAndJacobian(cleanObservations, a, mode);
        currentJacobian = lj.jacobian;
        currentResiduals = lj.residuals;
      }
    } else {
      const record: IterationRecord = {
        iter,
        loss: currentLoss,
        lambda: trialLambda,
        accepted: false,
        coefficients: { ...a },
      };
      history.push(record);

      if (activeRunId === thisRunId && !activeRunCancelled && !cancelledRunIds.has(thisRunId)) {
        postResponse({
          type: 'PROGRESS',
          runId: thisRunId,
          iteration: record,
        });
      }

      consecutiveSmallRelSteps = 0;

      if (lambda >= LAMBDA_MAX) {
        status = 'stalled';
        break;
      }

      lambda = Math.min(lambda * LAMBDA_INCREASE_FACTOR, LAMBDA_MAX);
    }
  }

  // Final check before sending FIT_RESULT
  if (activeRunId !== thisRunId || activeRunCancelled || cancelledRunIds.has(thisRunId)) {
    postResponse({ type: 'CANCELLED', runId: thisRunId });
    return;
  }

  const result: FitResult = {
    status,
    mode,
    estimate: { ...a },
    initialLoss,
    finalLoss: currentLoss,
    history,
    fittedPlanes,
  };

  postResponse({
    type: 'FIT_RESULT',
    runId: thisRunId,
    result,
  });
}

/**
 * Resets worker internal state machine. Useful for isolated test teardown.
 */
export function resetWorkerStateForTesting(): void {
  activeRunId = null;
  activeRunCancelled = false;
  cancelledRunIds.clear();
}

/**
 * Creates a message listener adapter for a MessagePort or Worker context.
 */
export function createWorkerPortHandler(port: {
  postMessage: (message: WorkerResponse) => void;
  onmessage?: ((event: { data: WorkerRequest }) => void) | null;
  addEventListener?: (type: string, listener: (event: { data: WorkerRequest }) => void) => void;
  start?: () => void;
}): void {
  const listener = (event: { data: WorkerRequest }) => {
    void handleWorkerRequest(event.data, (resp) => {
      port.postMessage(resp);
    });
  };

  if (typeof port.addEventListener === 'function') {
    port.addEventListener('message', listener);
  } else {
    port.onmessage = listener;
  }

  if (typeof port.start === 'function') {
    port.start();
  }
}

// Auto-wire dedicated Web Worker global scope when executing inside a Web Worker
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof (self as unknown as { document?: unknown }).document === 'undefined') {
  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    void handleWorkerRequest(event.data, (resp: WorkerResponse) => {
      self.postMessage(resp);
    });
  };
}
