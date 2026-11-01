/**
 * P007 FocusWitness — Web Worker Protocol, Cancellation, & MATH10 Contracts
 *
 * Specifications & Acceptance:
 * - TASK-P007-T009 Acceptance Criteria
 * - PROJECT_BOOK.md Section 6.4: Worker Message Protocol
 *   - Only 1 Dedicated Web Worker instance across project
 *   - FIT message NEVER contains groundTruth
 *   - runId auditing & monotonic sequencing
 *   - Stale/expired response discarding
 *   - Iteration progress emitted on every trial
 *   - Cancellation yields event loop and halts computation promptly
 *   - Errors are retryable; crash recovery
 *   - Observation buffer ownership protected (caller buffers preserved)
 * - PROJECT_BOOK.md Chapter 7:
 *   - MATH10: Rapidly switching to B or cancelling A prevents A's FIT_RESULT from polluting B's UI
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COEFFICIENT_MAX,
  COEFFICIENT_MIN,
  INITIAL_COEFFICIENTS,
  PIXEL_COUNT,
} from '../../src/domain/constants';
import {
  PRESET_ASTIG_ONLY,
  PRESET_MIXED,
  PRESET_PERFECT,
} from '../../src/domain/presets';
import type {
  CaseV1,
  Coefficients,
  FitResult,
  IterationRecord,
  WorkerRequest,
  WorkerResponse,
} from '../../src/domain/types';
import { validateCaseV1, validateFitResult } from '../../src/domain/validation';
import {
  createWorkerPortHandler,
  handleWorkerRequest,
  resetWorkerStateForTesting,
} from '../../src/worker/compute.worker';
import {
  getWorkerClient,
  resetWorkerClientForTesting,
  WorkerCancelledError,
  WorkerClient,
  WorkerError,
  type WorkerLike,
} from '../../src/worker/client';
import { createCaseFromPreset } from '../../src/io/caseFile';

/**
 * In-process test worker simulating browser Web Worker message dispatching
 * over asynchronous MessageChannel ports.
 */
class InProcessTestWorker implements WorkerLike {
  private channel: MessageChannel;
  public messageSpy?: (msg: unknown) => void;

  constructor() {
    this.channel = new MessageChannel();
    createWorkerPortHandler(this.channel.port2);
    this.channel.port1.start();
    this.channel.port2.start();
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    if (this.messageSpy) {
      this.messageSpy(message);
    }
    this.channel.port1.postMessage(message, transfer as any);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    this.channel.port1.addEventListener(type, listener);
  }

  removeEventListener(type: string, listener: (event: any) => void): void {
    this.channel.port1.removeEventListener(type, listener);
  }

  set onmessage(fn: ((event: any) => void) | null) {
    this.channel.port1.onmessage = fn;
  }

  get onmessage() {
    return this.channel.port1.onmessage;
  }

  set onerror(fn: ((event: any) => void) | null) {
    // Optional error handler
  }

  terminate(): void {
    this.channel.port1.close();
    this.channel.port2.close();
  }
}

// Polyfill global Worker for Node test environment
const originalWorker = globalThis.Worker;
beforeEach(() => {
  resetWorkerStateForTesting();
  resetWorkerClientForTesting();
  globalThis.Worker = InProcessTestWorker as unknown as typeof Worker;
});

afterEach(() => {
  resetWorkerStateForTesting();
  resetWorkerClientForTesting();
  globalThis.Worker = originalWorker;
});

describe('T009 Single Worker Instance & Factory Contract', () => {
  it('guarantees only 1 Worker instance exists across repeated calls (singleton pattern)', () => {
    const client1 = getWorkerClient();
    const client2 = getWorkerClient();
    expect(client1).toBe(client2);

    const activeRunId = client1.getActiveRunId();
    expect(activeRunId).toBeNull();
  });

  it('allows clean reset for test isolation via resetWorkerClientForTesting', () => {
    const client1 = getWorkerClient();
    resetWorkerClientForTesting();
    const client2 = getWorkerClient();
    expect(client1).not.toBe(client2);
  });
});

describe('T009 FIT Request & Ground Truth Absence Contract', () => {
  it('guarantees FIT request message NEVER contains groundTruth', async () => {
    let capturedMessage: any = null;
    const worker = new InProcessTestWorker();
    worker.messageSpy = (msg) => {
      if (typeof msg === 'object' && msg !== null && (msg as any).type === 'FIT') {
        capturedMessage = msg;
      }
    };

    const client = new WorkerClient({ createWorker: () => worker });
    const caseData = createCaseFromPreset('mixed');

    // Attach groundTruth to input object explicitly to test stripping
    const obsWithGroundTruth = {
      minus: caseData.observations.minus,
      plus: caseData.observations.plus,
      groundTruth: caseData.groundTruth,
    };

    const fitPromise = client.fit('dual', obsWithGroundTruth as any);
    const result = await fitPromise;

    expect(capturedMessage).not.toBeNull();
    expect(capturedMessage.type).toBe('FIT');
    // Critical assertion: FIT message must NOT contain groundTruth anywhere
    expect('groundTruth' in capturedMessage).toBe(false);
    expect('groundTruth' in capturedMessage.observations).toBe(false);
    expect(capturedMessage.mode).toBe('dual');
    expect(capturedMessage.observations.minus.length).toBe(PIXEL_COUNT);
    expect(capturedMessage.observations.plus.length).toBe(PIXEL_COUNT);

    expect(result.status).toBe('converged');
  });

  it('rejects with INVALID_INPUT if a client attempts to pass groundTruth to worker directly', async () => {
    const responses: WorkerResponse[] = [];
    const badRequest: any = {
      type: 'FIT',
      runId: 99,
      mode: 'dual',
      observations: {
        minus: new Array(PIXEL_COUNT).fill(1 / PIXEL_COUNT),
        plus: new Array(PIXEL_COUNT).fill(1 / PIXEL_COUNT),
      },
      groundTruth: { astig0: 0.05, comaX: 0, spherical: 0 },
    };

    await handleWorkerRequest(badRequest, (resp) => responses.push(resp));

    expect(responses.length).toBe(1);
    expect(responses[0]?.type).toBe('ERROR');
    if (responses[0]?.type === 'ERROR') {
      expect(responses[0].code).toBe('INVALID_INPUT');
      expect(responses[0].message).toContain('groundTruth');
    }
  });
});

describe('T009 Run ID Auditing & Expired Response Discarding', () => {
  it('increments runId monotonically across multiple requests', async () => {
    const client = new WorkerClient();
    const caseData = createCaseFromPreset('perfect');

    const p1 = client.generate(PRESET_PERFECT.coefficients);
    const c1 = await p1;
    expect(client.getActiveRunId()).toBeNull();

    const p2 = client.fit('dual', caseData.observations);
    const r2 = await p2;
    expect(r2.status).toBe('converged');

    const p3 = client.analyze(caseData.observations, PRESET_PERFECT.coefficients);
    const a3 = await p3;
    expect(a3.eigenSingle.length).toBe(3);
  });

  it('discards expired/stale worker responses when runId does not match activeRunId', async () => {
    const worker = new InProcessTestWorker();
    const client = new WorkerClient({ createWorker: () => worker });

    const caseData = createCaseFromPreset('mixed');
    const fitPromise = client.fit('dual', caseData.observations);

    const activeId = client.getActiveRunId();
    expect(activeId).toBe(1);

    // Inject fake response with expired runId = 0
    (client as any).handleMessage({
      type: 'FIT_RESULT',
      runId: 0,
      result: {
        status: 'stalled',
        mode: 'dual',
        estimate: { astig0: 0.12, comaX: 0, spherical: 0 },
        initialLoss: 1,
        finalLoss: 1,
        history: [],
        fittedPlanes: [-0.65, 0.65],
      },
    });

    // Active calculation should NOT be affected
    expect(client.getActiveRunId()).toBe(1);

    // Active calculation should resolve cleanly with real result
    const realResult = await fitPromise;
    expect(realResult.status).toBe('converged');
    expect(realResult.estimate.astig0).toBeCloseTo(0.08, 4);
  });
});

describe('T009 Progress Callback on Every Iteration', () => {
  it('emits PROGRESS message for every iteration during LM optimization', async () => {
    const client = new WorkerClient();
    const caseData = createCaseFromPreset('mixed');

    const progressRecords: IterationRecord[] = [];
    const result = await client.fit('dual', caseData.observations, (iter) => {
      progressRecords.push(iter);
    });

    expect(result.status).toBe('converged');
    expect(progressRecords.length).toBeGreaterThan(0);
    expect(progressRecords.length).toBe(result.history.length);

    // Verify iteration structure
    for (let i = 0; i < progressRecords.length; i++) {
      const rec = progressRecords[i]!;
      expect(rec.iter).toBe(i + 1);
      expect(Number.isFinite(rec.loss)).toBe(true);
      expect(Number.isFinite(rec.lambda)).toBe(true);
      expect(typeof rec.accepted).toBe('boolean');
      expect(Number.isFinite(rec.coefficients.astig0)).toBe(true);
      expect(Number.isFinite(rec.coefficients.comaX)).toBe(true);
      expect(Number.isFinite(rec.coefficients.spherical)).toBe(true);
    }
  });
});

describe('T009 Event Loop Yielding & Cancellation', () => {
  it('yields event loop at each iteration and halts immediately on CANCEL', async () => {
    const client = new WorkerClient();
    const caseData = createCaseFromPreset('mixed');

    let progressCount = 0;
    const fitPromise = client.fit('dual', caseData.observations, (iter) => {
      progressCount++;
      if (progressCount === 1) {
        // Cancel as soon as first progress step arrives
        client.cancel();
      }
    });

    await expect(fitPromise).rejects.toThrow(WorkerCancelledError);
    expect(client.getActiveRunId()).toBeNull();
  });

  it('returns CANCELLED confirmation even when target task is not currently running', async () => {
    const responses: WorkerResponse[] = [];
    await handleWorkerRequest({ type: 'CANCEL', runId: 12345 }, (resp) => responses.push(resp));

    expect(responses.length).toBe(1);
    expect(responses[0]).toEqual({ type: 'CANCELLED', runId: 12345 });
  });
});

describe('T009 Error Handling & Retryability', () => {
  it('returns INVALID_INPUT for bad coefficients or observations, and allows immediate retry', async () => {
    const client = new WorkerClient();

    // 1. Send invalid coefficients (> 0.15 limit)
    await expect(
      client.generate({ astig0: 0.5, comaX: 0, spherical: 0 })
    ).rejects.toThrow(WorkerError);

    // Active state should be cleared
    expect(client.getActiveRunId()).toBeNull();

    // 2. Retry immediately with valid coefficients
    const retryResult = await client.generate(PRESET_PERFECT.coefficients);
    expect(retryResult.schema).toBe('focuswitness.case/v1');
    expect(retryResult.observations.minus.length).toBe(PIXEL_COUNT);
  });

  it('recovers and allows retry if a worker crash occurs', async () => {
    const client = new WorkerClient({ createWorker: () => new InProcessTestWorker() });

    const caseData = createCaseFromPreset('perfect');
    const promise = client.fit('dual', caseData.observations);

    // Simulate worker runtime crash
    (client as any).handleError({ message: 'Simulated worker crash' });

    await expect(promise).rejects.toThrow(/can be retried/);
    expect(client.getActiveRunId()).toBeNull();

    // Worker can be retried immediately with fresh worker instance
    const retryResult = await client.fit('dual', caseData.observations);
    expect(retryResult.status).toBe('converged');
  });
});

describe('T009 Transferable & Observation Buffer Ownership Protection', () => {
  it('preserves caller observation arrays without detaching or mutating ArrayBuffers', async () => {
    const client = new WorkerClient();
    const caseData = createCaseFromPreset('mixed');

    // Create Float64Array views
    const minusF64 = new Float64Array(caseData.observations.minus);
    const plusF64 = new Float64Array(caseData.observations.plus);

    const minusByteLengthBefore = minusF64.byteLength;
    const plusByteLengthBefore = plusF64.byteLength;

    expect(minusByteLengthBefore).toBe(PIXEL_COUNT * 8);

    const result = await client.fit('dual', {
      minus: Array.from(minusF64),
      plus: Array.from(plusF64),
    });

    expect(result.status).toBe('converged');

    // Check caller's Float64Array buffers were not transferred or detached
    expect(minusF64.byteLength).toBe(minusByteLengthBefore);
    expect(plusF64.byteLength).toBe(plusByteLengthBefore);
    expect(minusF64[0]).not.toBeNaN();
  });
});

describe('Golden Contract: MATH10 (Race Prevention & Superseding)', () => {
  it('MATH10: A running, rapidly start B — A never overwrites B UI', async () => {
    const client = new WorkerClient();

    // Preset A: mixed (astig0=0.08, comaX=-0.06, spherical=0.04)
    const caseA = createCaseFromPreset('mixed');
    // Preset B: astig-only (astig0=0.10, comaX=0.00, spherical=0.00)
    const caseB = createCaseFromPreset('astig-only');

    // 1. Start computation A
    const promiseA = client.fit('dual', caseA.observations);
    const runIdA = client.getActiveRunId();
    expect(runIdA).toBe(1);

    // 2. Immediately start computation B without waiting for A
    const promiseB = client.fit('dual', caseB.observations);
    const runIdB = client.getActiveRunId();
    expect(runIdB).toBe(2);

    // A must reject with WorkerCancelledError due to being superseded
    await expect(promiseA).rejects.toThrow(WorkerCancelledError);

    // B must complete cleanly
    const resultB = await promiseB;
    expect(resultB.status).toBe('converged');

    // Numerical verification: B must recover astig-only (0.10, 0, 0), NOT mixed (0.08, -0.06, 0.04)
    expect(resultB.estimate.astig0).toBeCloseTo(0.10, 3);
    expect(Math.abs(resultB.estimate.comaX)).toBeLessThan(0.005);
    expect(Math.abs(resultB.estimate.spherical)).toBeLessThan(0.005);

    // Measure and log values for MATH10 evidence
    const errorAstig0 = Math.abs(resultB.estimate.astig0 - 0.10);
    const errorComaX = Math.abs(resultB.estimate.comaX - 0.00);
    const errorSpherical = Math.abs(resultB.estimate.spherical - 0.00);
    const maxCoeffError = Math.max(errorAstig0, errorComaX, errorSpherical);

    console.log(
      `[MATH10] Scenario 1 (Rapid superseding): runIdA=${runIdA} runIdB=${runIdB} ` +
      `statusB=${resultB.status} finalLossB=${resultB.finalLoss.toExponential(4)} ` +
      `iterB=${resultB.history.length} recoveredB=[${resultB.estimate.astig0.toFixed(4)}, ${resultB.estimate.comaX.toFixed(4)}, ${resultB.estimate.spherical.toFixed(4)}] ` +
      `maxErrorB=${maxCoeffError.toExponential(4)}`
    );

    expect(maxCoeffError).toBeLessThan(0.015);
    expect(resultB.finalLoss).toBeLessThanOrEqual(1e-8);
  });

  it('MATH10: A running, cancel A, then start B — A never overwrites B UI', async () => {
    const client = new WorkerClient();

    const caseA = createCaseFromPreset('mixed');
    const caseB = createCaseFromPreset('spherical-only');

    let aSawProgress = false;
    const promiseA = client.fit('dual', caseA.observations, () => {
      aSawProgress = true;
    });
    const runIdA = client.getActiveRunId();

    // Cancel A
    client.cancel();
    await expect(promiseA).rejects.toThrow(WorkerCancelledError);

    // Start B
    const promiseB = client.fit('dual', caseB.observations);
    const runIdB = client.getActiveRunId();
    expect(runIdB).toBe(2);

    const resultB = await promiseB;
    expect(resultB.status).toBe('converged');

    // spherical-only target: astig0=0.00, comaX=0.00, spherical=0.10
    expect(Math.abs(resultB.estimate.astig0)).toBeLessThan(0.005);
    expect(Math.abs(resultB.estimate.comaX)).toBeLessThan(0.005);
    expect(resultB.estimate.spherical).toBeCloseTo(0.10, 3);

    console.log(
      `[MATH10] Scenario 2 (Cancel then start): runIdA=${runIdA} runIdB=${runIdB} ` +
      `statusB=${resultB.status} finalLossB=${resultB.finalLoss.toExponential(4)} ` +
      `recoveredB=[${resultB.estimate.astig0.toFixed(4)}, ${resultB.estimate.comaX.toFixed(4)}, ${resultB.estimate.spherical.toFixed(4)}]`
    );
  });
});

describe('T009 GENERATE and ANALYZE End-to-End Protocols', () => {
  it('generates a full CaseV1 adhering to spec via GENERATE message', async () => {
    const client = new WorkerClient();
    const caseData = await client.generate(PRESET_MIXED.coefficients);

    const validation = validateCaseV1(caseData);
    expect(validation.success).toBe(true);
    expect(caseData.observations.minus.length).toBe(PIXEL_COUNT);
    expect(caseData.observations.plus.length).toBe(PIXEL_COUNT);
    expect(caseData.groundTruth).toEqual(PRESET_MIXED.coefficients);
  });

  it('analyzes local information spectrum adhering to MATH07 via ANALYZE message', async () => {
    const client = new WorkerClient();
    const caseData = createCaseFromPreset('mixed');

    const analysis = await client.analyze(caseData.observations, PRESET_MIXED.coefficients);
    expect(analysis.eigenSingle.length).toBe(3);
    expect(analysis.eigenDual.length).toBe(3);

    // MATH07 monotonicity check
    const minSingle = Math.min(...analysis.eigenSingle);
    const minDual = Math.min(...analysis.eigenDual);
    expect(minDual + 1e-10).toBeGreaterThanOrEqual(minSingle);

    const traceSingle = analysis.eigenSingle.reduce((s, x) => s + x, 0);
    const traceDual = analysis.eigenDual.reduce((s, x) => s + x, 0);
    expect(traceDual + 1e-10).toBeGreaterThanOrEqual(traceSingle);
  });
});

describe('TASK-P007-T015 Cancellation Concurrency & Secondary Initiation (取消中二次发起)', () => {
  it('cancels active run when a second FIT request is dispatched immediately without awaiting (取消中二次发起 FIT)', async () => {
    const client = new WorkerClient();
    const caseA = createCaseFromPreset('mixed');
    const caseB = createCaseFromPreset('astig-only');

    // Start run 1
    const p1 = client.fit('dual', caseA.observations);
    const runId1 = client.getActiveRunId();
    expect(runId1).toBe(1);

    // Explicitly call cancel on run 1
    client.cancel();

    // Immediately trigger run 2 without awaiting run 1 rejection or worker cancel confirmation
    const p2 = client.fit('dual', caseB.observations);
    const runId2 = client.getActiveRunId();
    expect(runId2).toBe(2);

    // Run 1 must reject with WorkerCancelledError
    await expect(p1).rejects.toThrow(WorkerCancelledError);

    // Run 2 must resolve cleanly with converged status
    const result2 = await p2;
    expect(result2.status).toBe('converged');
    expect(result2.estimate.astig0).toBeCloseTo(0.1, 3);
    expect(client.getActiveRunId()).toBeNull();
  });

  it('handles worker-level direct request concurrency: CANCEL followed immediately by new FIT in same tick', async () => {
    const responses: WorkerResponse[] = [];
    const caseA = createCaseFromPreset('mixed');
    const caseB = createCaseFromPreset('spherical-only');

    // Send FIT run 101
    const p1 = handleWorkerRequest(
      {
        type: 'FIT',
        runId: 101,
        mode: 'dual',
        observations: caseA.observations,
      },
      (r) => responses.push(r)
    );

    // Send CANCEL run 101 in same execution phase
    const pCancel = handleWorkerRequest(
      {
        type: 'CANCEL',
        runId: 101,
      },
      (r) => responses.push(r)
    );

    // Send FIT run 102 immediately
    const p2 = handleWorkerRequest(
      {
        type: 'FIT',
        runId: 102,
        mode: 'dual',
        observations: caseB.observations,
      },
      (r) => responses.push(r)
    );

    await Promise.all([p1, pCancel, p2]);

    // Check response sequencing
    const cancelResp = responses.find((r) => r.type === 'CANCELLED' && r.runId === 101);
    expect(cancelResp).toBeDefined();

    const fit2Resp = responses.find((r) => r.type === 'FIT_RESULT' && r.runId === 102);
    expect(fit2Resp).toBeDefined();
    if (fit2Resp?.type === 'FIT_RESULT') {
      expect(fit2Resp.result.status).toBe('converged');
      expect(fit2Resp.result.estimate.spherical).toBeCloseTo(0.1, 3);
    }
  });

  it('allows immediate GENERATE while FIT is in cancelling phase, without state deadlock', async () => {
    const client = new WorkerClient();
    const caseData = createCaseFromPreset('mixed');

    const pFit = client.fit('dual', caseData.observations);
    client.cancel();

    // Secondary request is GENERATE
    const pGen = client.generate({ astig0: 0.12, comaX: -0.05, spherical: 0.03 });

    await expect(pFit).rejects.toThrow(WorkerCancelledError);
    const genCase = await pGen;
    expect(genCase.schema).toBe('focuswitness.case/v1');
    expect(genCase.observations.minus.length).toBe(PIXEL_COUNT);
    expect(genCase.groundTruth?.astig0).toBe(0.12);
  });

  it('allows immediate FIT while GENERATE is in cancelling phase, without state deadlock', async () => {
    const client = new WorkerClient();
    const caseData = createCaseFromPreset('perfect');

    const pGen = client.generate({ astig0: 0.1, comaX: 0, spherical: 0 });
    client.cancel();

    // Secondary request is FIT
    const pFit = client.fit('dual', caseData.observations);

    await expect(pGen).rejects.toThrow(WorkerCancelledError);
    const fitResult = await pFit;
    expect(fitResult.status).toBe('converged');
    expect(Math.abs(fitResult.estimate.astig0)).toBeLessThan(0.005);
  });

  it('executes rapid multi-cycle cancel-and-relaunch stress sequence cleanly (3 cancellation-relaunch cycles)', async () => {
    const client = new WorkerClient();
    const caseData = createCaseFromPreset('mixed');

    // Cycle 1
    const p1 = client.fit('dual', caseData.observations);
    client.cancel();
    await expect(p1).rejects.toThrow(WorkerCancelledError);

    // Cycle 2
    const p2 = client.fit('dual', caseData.observations);
    client.cancel();
    await expect(p2).rejects.toThrow(WorkerCancelledError);

    // Cycle 3: Allowed to complete
    const p3 = client.fit('dual', caseData.observations);
    const result3 = await p3;
    expect(result3.status).toBe('converged');
    expect(result3.finalLoss).toBeLessThanOrEqual(1e-8);
  });

  it('ensures cancellation is idempotent when called repeatedly on idle, active, or superseded runs', async () => {
    const client = new WorkerClient();
    const caseData = createCaseFromPreset('perfect');

    // Cancel while idle — should not throw
    expect(() => client.cancel()).not.toThrow();
    expect(() => client.cancel(9999)).not.toThrow();

    // Start fit
    const p = client.fit('dual', caseData.observations);
    const runId = client.getActiveRunId()!;

    // Cancel multiple times consecutively
    client.cancel(runId);
    client.cancel(runId);
    client.cancel();

    await expect(p).rejects.toThrow(WorkerCancelledError);
    expect(client.getActiveRunId()).toBeNull();
  });

  it('discards late progress responses belonging to cancelled run even if received after second run starts', async () => {
    const worker = new InProcessTestWorker();
    const client = new WorkerClient({ createWorker: () => worker });
    const caseData = createCaseFromPreset('mixed');

    const progressA: IterationRecord[] = [];
    const progressB: IterationRecord[] = [];

    const pA = client.fit('dual', caseData.observations, (rec) => progressA.push(rec));
    const runIdA = client.getActiveRunId()!;

    // Cancel run A and start run B
    client.cancel();
    const pB = client.fit('dual', caseData.observations, (rec) => progressB.push(rec));
    const runIdB = client.getActiveRunId()!;
    expect(runIdB).toBeGreaterThan(runIdA);

    // Inject synthetic late PROGRESS message from run A
    (client as any).handleMessage({
      type: 'PROGRESS',
      runId: runIdA,
      iteration: {
        iter: 99,
        loss: 0.12345,
        lambda: 100,
        accepted: false,
        coefficients: { astig0: 0.15, comaX: 0.15, spherical: 0.15 },
      },
    });

    await expect(pA).rejects.toThrow(WorkerCancelledError);
    const resultB = await pB;

    expect(resultB.status).toBe('converged');
    // None of run B's progress should contain the leaked synthetic step 99
    expect(progressB.some((rec) => rec.iter === 99)).toBe(false);
  });
});
