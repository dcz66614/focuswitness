/**
 * P007 FocusWitness — Web Worker Client & Concurrency Controller
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 6.4: Worker Message Protocol
 *   - Sole entry point for heavy computation; exactly one Dedicated Web Worker instance.
 *   - Monotonic runId auditing; expired responses are discarded immediately.
 *   - FIT request structure NEVER contains groundTruth.
 *   - Explicit event loop yield during iterations ensures timely CANCEL handling.
 *   - Error conditions are retryable; worker crashes trigger self-healing recovery.
 *   - Observation buffer ownership is protected: caller buffers are never transferred.
 * - PROJECT_BOOK.md Chapter 7: MATH10
 *   - When A is running and B is started or A is cancelled, A's FIT_RESULT never overwrites B.
 */

import type {
  CaseV1,
  Coefficients,
  FitResult,
  IterationRecord,
  Mode,
  WorkerRequest,
  WorkerResponse,
} from '../domain/types';

/**
 * Standard error emitted when the Worker returns an error response.
 */
export class WorkerError extends Error {
  public readonly code: string;
  public readonly runId: number;

  constructor(code: string, message: string, runId: number) {
    super(`Worker error [${code}] on run ${runId}: ${message}`);
    this.name = 'WorkerError';
    this.code = code;
    this.runId = runId;
  }
}

/**
 * Error emitted when a computation request is cancelled or superseded.
 */
export class WorkerCancelledError extends Error {
  public readonly runId: number;

  constructor(runId: number, message: string = `Computation run ${runId} was cancelled`) {
    super(message);
    this.name = 'WorkerCancelledError';
    this.runId = runId;
  }
}

/**
 * Minimal interface representing a Web Worker or Worker-like mock.
 */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  removeEventListener(type: string, listener: (event: any) => void): void;
  terminate?(): void;
  onmessage?: ((event: any) => void) | null;
  onerror?: ((event: any) => void) | null;
}

/**
 * Configuration options for WorkerClient.
 */
export interface WorkerClientOptions {
  /**
   * Custom worker factory. Useful for tests or custom runtime environments.
   * If omitted, a standard dedicated Web Worker will be instantiated.
   */
  createWorker?: () => WorkerLike;
}

interface PendingRequest {
  runId: number;
  type: 'GENERATE' | 'FIT' | 'ANALYZE';
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  onProgress?: ((iteration: IterationRecord) => void) | undefined;
}

/**
 * Client controller managing communication with the dedicated compute worker.
 *
 * Enforces:
 * - Exactly one Dedicated Worker instance per client.
 * - Monotonically increasing runId.
 * - Stale response rejection (expired runIds discarded).
 * - Complete absence of groundTruth in FIT messages.
 */
export class WorkerClient {
  private worker: WorkerLike | null = null;
  private currentRunId = 0;
  private activeRunId: number | null = null;
  private pendingRequest: PendingRequest | null = null;
  private readonly options: WorkerClientOptions | undefined;
  private messageListener: ((event: any) => void) | null = null;
  private errorListener: ((event: any) => void) | null = null;

  constructor(options?: WorkerClientOptions) {
    this.options = options;
  }

  /**
   * Lazily initializes the single Dedicated Web Worker instance.
   */
  private getWorker(): WorkerLike {
    if (this.worker) {
      return this.worker;
    }

    if (this.options?.createWorker) {
      this.worker = this.options.createWorker();
    } else if (typeof Worker !== 'undefined') {
      this.worker = new Worker(new URL('./compute.worker.ts', import.meta.url), {
        type: 'module',
      });
    } else {
      throw new Error(
        'Web Worker is not supported in the current environment and no createWorker factory was provided'
      );
    }

    this.messageListener = (event: { data: WorkerResponse }) => {
      this.handleMessage(event.data);
    };

    this.errorListener = (event: any) => {
      this.handleError(event);
    };

    if (typeof this.worker.addEventListener === 'function') {
      this.worker.addEventListener('message', this.messageListener);
      this.worker.addEventListener('error', this.errorListener);
    } else {
      this.worker.onmessage = this.messageListener;
      this.worker.onerror = this.errorListener;
    }

    return this.worker;
  }

  /**
   * Dispatches incoming worker responses to the matching active promise.
   * Expired or superseded responses are discarded immediately without effect.
   */
  private handleMessage(response: WorkerResponse): void {
    if (!response || typeof response !== 'object') {
      return;
    }

    const { runId } = response;

    // Discard expired or superseded responses (MATH10 protection)
    if (this.activeRunId === null || runId !== this.activeRunId) {
      return;
    }

    const req = this.pendingRequest;
    if (!req || req.runId !== runId) {
      return;
    }

    switch (response.type) {
      case 'PROGRESS': {
        if (req.type === 'FIT' && req.onProgress) {
          req.onProgress(response.iteration);
        }
        break;
      }

      case 'FIT_RESULT': {
        this.clearPending();
        req.resolve(response.result);
        break;
      }

      case 'GENERATED': {
        this.clearPending();
        req.resolve(response.caseData);
        break;
      }

      case 'ANALYSIS_RESULT': {
        this.clearPending();
        req.resolve({
          eigenSingle: response.eigenSingle,
          eigenDual: response.eigenDual,
        });
        break;
      }

      case 'CANCELLED': {
        this.clearPending();
        req.reject(new WorkerCancelledError(runId));
        break;
      }

      case 'ERROR': {
        this.clearPending();
        req.reject(new WorkerError(response.code, response.message, runId));
        break;
      }
    }
  }

  /**
   * Handles unexpected worker errors or crashes.
   * Resets internal state and enables retry.
   */
  private handleError(event: any): void {
    const errorMsg = event?.message || 'Worker runtime error';
    const failedRunId = this.activeRunId ?? -1;
    const req = this.pendingRequest;

    this.terminate();

    if (req) {
      req.reject(new WorkerError('WORKER_CRASH', `${errorMsg} (can be retried)`, failedRunId));
    }
  }

  /**
   * Clears currently active pending request state.
   */
  private clearPending(): void {
    this.activeRunId = null;
    this.pendingRequest = null;
  }

  /**
   * Cancels the currently active pending request and notifies the worker.
   */
  private cancelActive(reason: string): void {
    if (!this.pendingRequest) return;
    const oldReq = this.pendingRequest;
    const oldRunId = oldReq.runId;

    if (this.worker) {
      const cancelReq: WorkerRequest = {
        type: 'CANCEL',
        runId: oldRunId,
      };
      this.worker.postMessage(cancelReq);
    }

    this.clearPending();
    oldReq.reject(new WorkerCancelledError(oldRunId, reason));
  }

  /**
   * Returns the current active calculation runId, or null if idle.
   */
  public getActiveRunId(): number | null {
    return this.activeRunId;
  }

  /**
   * Requests generation of a CaseV1 object from physical aberration coefficients.
   */
  public generate(coefficients: Coefficients): Promise<CaseV1> {
    const worker = this.getWorker();
    const runId = ++this.currentRunId;

    if (this.pendingRequest) {
      this.cancelActive(`Superseded by new request run ${runId}`);
    }

    this.activeRunId = runId;

    return new Promise<CaseV1>((resolve, reject) => {
      this.pendingRequest = {
        runId,
        type: 'GENERATE',
        resolve,
        reject,
      };

      const request: WorkerRequest = {
        type: 'GENERATE',
        runId,
        coefficients: { ...coefficients },
      };

      worker.postMessage(request);
    });
  }

  /**
   * Requests Levenberg-Marquardt aberration numerical inversion.
   *
   * CONTRACT GUARANTEES:
   * - This method NEVER attaches groundTruth to the request.
   * - Caller observation buffers are preserved and never detached.
   * - Each iteration invokes optional onProgress callback.
   * - Monotonic runId auditing guarantees stale results are discarded.
   */
  public fit(
    mode: Mode,
    observations: CaseV1['observations'],
    onProgress?: (iteration: IterationRecord) => void
  ): Promise<FitResult> {
    const worker = this.getWorker();
    const runId = ++this.currentRunId;

    if (this.pendingRequest) {
      this.cancelActive(`Superseded by new request run ${runId}`);
    }

    this.activeRunId = runId;

    return new Promise<FitResult>((resolve, reject) => {
      this.pendingRequest = {
        runId,
        type: 'FIT',
        resolve,
        reject,
        onProgress,
      };

      // Safeguard against transferring/mutating caller arrays and strip any groundTruth
      const cleanObservations: CaseV1['observations'] = {
        minus: Array.from(observations.minus),
        plus: Array.from(observations.plus),
      };

      const request: WorkerRequest = {
        type: 'FIT',
        runId,
        mode,
        observations: cleanObservations,
      };

      // Double-check contract: FIT request must not have groundTruth
      if ('groundTruth' in (request as Record<string, unknown>)) {
        throw new Error('FIT request MUST NOT contain groundTruth');
      }

      worker.postMessage(request);
    });
  }

  /**
   * Requests local identifiability analysis at a given reference coefficient vector.
   */
  public analyze(
    observations: CaseV1['observations'],
    reference: Coefficients
  ): Promise<{ eigenSingle: number[]; eigenDual: number[] }> {
    const worker = this.getWorker();
    const runId = ++this.currentRunId;

    if (this.pendingRequest) {
      this.cancelActive(`Superseded by new request run ${runId}`);
    }

    this.activeRunId = runId;

    return new Promise<{ eigenSingle: number[]; eigenDual: number[] }>((resolve, reject) => {
      this.pendingRequest = {
        runId,
        type: 'ANALYZE',
        resolve,
        reject,
      };

      const request: WorkerRequest = {
        type: 'ANALYZE',
        runId,
        observations: {
          minus: Array.from(observations.minus),
          plus: Array.from(observations.plus),
        },
        reference: { ...reference },
      };

      worker.postMessage(request);
    });
  }

  /**
   * Cancels the active computation or a specific runId.
   */
  public cancel(runId?: number): void {
    const targetRunId = runId ?? this.activeRunId;
    if (targetRunId === null || targetRunId === undefined) {
      return;
    }

    if (this.worker) {
      const cancelReq: WorkerRequest = {
        type: 'CANCEL',
        runId: targetRunId,
      };
      this.worker.postMessage(cancelReq);
    }

    if (this.pendingRequest && this.pendingRequest.runId === targetRunId) {
      const req = this.pendingRequest;
      this.clearPending();
      req.reject(new WorkerCancelledError(targetRunId));
    }
  }

  /**
   * Terminates the worker instance and cleans up state.
   */
  public terminate(): void {
    if (this.worker) {
      if (this.messageListener) {
        if (typeof this.worker.removeEventListener === 'function') {
          this.worker.removeEventListener('message', this.messageListener);
        }
        this.worker.onmessage = null;
      }
      if (this.errorListener) {
        if (typeof this.worker.removeEventListener === 'function') {
          this.worker.removeEventListener('error', this.errorListener);
        }
        this.worker.onerror = null;
      }

      if (typeof this.worker.terminate === 'function') {
        this.worker.terminate();
      }
      this.worker = null;
    }
    this.clearPending();
  }
}

/**
 * Singleton client instance ensuring only one Dedicated Worker exists across the application.
 */
let singletonClient: WorkerClient | null = null;

/**
 * Returns the singleton WorkerClient instance.
 */
export function getWorkerClient(options?: WorkerClientOptions): WorkerClient {
  if (!singletonClient) {
    singletonClient = new WorkerClient(options);
  }
  return singletonClient;
}

/**
 * Resets the singleton client instance for test isolation.
 */
export function resetWorkerClientForTesting(): void {
  if (singletonClient) {
    singletonClient.terminate();
    singletonClient = null;
  }
}
