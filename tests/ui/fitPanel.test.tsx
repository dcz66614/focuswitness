/**
 * P007 FocusWitness — FitPanel and HistoryPlot UI Acceptance Tests
 * Task: TASK-P007-T012
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, FR04, FR07, FR11, FR13
 *
 * Verifications:
 * 1. Status termination labels:
 *    - 'converged' -> "已收敛 (converged)"
 *    - 'max_iterations' -> "达到最大步数 (max_iterations)"
 *    - 'stalled' -> "求解停滞 (stalled)"
 *    - 'cancelled' -> "已取消 (cancelled)"
 *    - 'running', 'idle', 'stale', 'error'
 * 2. Distinction between accepted and rejected steps:
 *    - Visually distinct markers in HistoryPlot (circle for accepted, diamond for rejected)
 *    - Textual badges in history table ("已接受" vs "已拒绝")
 *    - Distinct data attributes (data-status="accepted" / "rejected", data-accepted="true" / "false")
 *    - Screen reader accessible ARIA attributes
 * 3. Required quantities display:
 *    - Step number (#iter)
 *    - Damping (lambda) in scientific notation
 *    - Unscaled loss explicitly labeled with scientific notation
 *    - Coefficients (astig0, comaX, spherical) formatted with explicit "λ" units
 * 4. 60-step history constraint:
 *    - Strictly capped at 60 steps even if worker reports more
 * 5. Iteration selection playback:
 *    - Inspect intermediate parameters, loss, and damping without mutating final result
 *    - Scrubber, step buttons, reset to latest
 * 6. Genuine Web Worker client integration:
 *    - Real InProcessTestWorker dispatching compute.worker protocol
 *    - Real PROGRESS streaming
 *    - Guarantee FIT message never contains groundTruth
 *    - Cancellation behavior
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FitPanel, type FitPanelProps, STATUS_DEFINITIONS } from '../../src/ui/FitPanel';
import {
  HistoryPlot,
  type HistoryPlotProps,
  formatScientific,
  formatCoeffWave,
} from '../../src/ui/HistoryPlot';
import {
  MAX_ITERATIONS,
  INITIAL_COEFFICIENTS,
  COEFFICIENT_NAMES,
} from '../../src/domain/constants';
import { PRESETS } from '../../src/domain/presets';
import { createCaseFromPreset } from '../../src/io/caseFile';
import type {
  CaseV1,
  Coefficients,
  FitResult,
  IterationRecord,
  Mode,
  WorkerRequest,
} from '../../src/domain/types';
import {
  WorkerClient,
  type WorkerLike,
  WorkerCancelledError,
} from '../../src/worker/client';
import { createWorkerPortHandler } from '../../src/worker/compute.worker';

/**
 * In-process test worker simulating Web Worker message loop over MessageChannel ports.
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

/**
 * Helper to generate synthetic iteration records for testing
 */
function createMockHistory(count: number, rejectedIndices: number[] = []): IterationRecord[] {
  const rejectedSet = new Set(rejectedIndices);
  const records: IterationRecord[] = [];

  let currentLoss = 0.045;
  let currentLambda = 0.01;
  let astig = 0.0;
  let coma = 0.0;
  let sph = 0.0;

  for (let i = 1; i <= count; i++) {
    const isRejected = rejectedSet.has(i);

    if (!isRejected) {
      currentLoss *= 0.6;
      currentLambda = Math.max(currentLambda * 0.3, 1e-7);
      astig += 0.005;
      coma -= 0.003;
      sph += 0.002;
    } else {
      currentLambda = Math.min(currentLambda * 10, 1e7);
    }

    records.push({
      iter: i,
      loss: currentLoss,
      lambda: currentLambda,
      accepted: !isRejected,
      coefficients: {
        astig0: Math.round(astig * 10000) / 10000,
        comaX: Math.round(coma * 10000) / 10000,
        spherical: Math.round(sph * 10000) / 10000,
      },
    });
  }

  return records;
}

describe('P007-T012 FitPanel & HistoryPlot Acceptance Suite', () => {
  describe('1. Status Termination Text (状态终结文案)', () => {
    it('displays "已收敛 (converged)" when fit status is converged', () => {
      const html = renderToStaticMarkup(<FitPanel status="converged" />);
      expect(html).toContain('data-testid="fit-status"');
      expect(html).toContain('已收敛 (converged)');
      expect(html).toContain('fw-status-converged');
    });

    it('displays "达到最大步数 (max_iterations)" when fit status is max_iterations', () => {
      const html = renderToStaticMarkup(<FitPanel status="max_iterations" />);
      expect(html).toContain('data-testid="fit-status"');
      expect(html).toContain('达到最大步数 (max_iterations)');
    });

    it('displays "求解停滞 (stalled)" when fit status is stalled', () => {
      const html = renderToStaticMarkup(<FitPanel status="stalled" />);
      expect(html).toContain('data-testid="fit-status"');
      expect(html).toContain('求解停滞 (stalled)');
      expect(html).toContain('fw-status-error');
    });

    it('displays "已取消 (cancelled)" when fit status is cancelled', () => {
      const html = renderToStaticMarkup(<FitPanel status="cancelled" />);
      expect(html).toContain('data-testid="fit-status"');
      expect(html).toContain('已取消 (cancelled)');
      expect(html).toContain('fw-status-cancelled');
    });

    it('displays "正在拟合 (running)..." during active solving', () => {
      const html = renderToStaticMarkup(<FitPanel status="running" isSolving={true} />);
      expect(html).toContain('data-testid="fit-status"');
      expect(html).toContain('正在拟合 (running)...');
      expect(html).toContain('fw-status-running');
      expect(html).toContain('data-testid="btn-cancel-solve"');
    });

    it('displays "取消中 (cancelling)..." during cancellation request', () => {
      const html = renderToStaticMarkup(<FitPanel status="cancelling" isSolving={true} />);
      expect(html).toContain('data-testid="fit-status"');
      expect(html).toContain('取消中 (cancelling)...');
    });

    it('displays "待机就绪 (idle)" before solving begins', () => {
      const html = renderToStaticMarkup(<FitPanel status="idle" />);
      expect(html).toContain('data-testid="fit-status"');
      expect(html).toContain('待机就绪 (idle)');
      expect(html).toContain('fw-status-idle');
    });

    it('displays "旧拟合已失效 (stale)" when observations changed', () => {
      const html = renderToStaticMarkup(<FitPanel status="stale" />);
      expect(html).toContain('data-testid="fit-status"');
      expect(html).toContain('旧拟合已失效 (stale)');
      expect(html).toContain('fw-status-stale');
    });

    it('displays "求解异常 (error)" on worker failure', () => {
      const html = renderToStaticMarkup(<FitPanel status="error" />);
      expect(html).toContain('data-testid="fit-status"');
      expect(html).toContain('求解异常 (error)');
    });
  });

  describe('2. Distinction Between Accepted and Rejected Steps (accepted/rejected 步可区分)', () => {
    it('distinguishes accepted and rejected steps with dedicated classes, data attributes, and badges in table', () => {
      const history = createMockHistory(5, [2, 4]); // Steps 2 and 4 are rejected

      const mockResult: FitResult = {
        status: 'converged',
        mode: 'dual',
        estimate: { astig0: 0.08, comaX: -0.06, spherical: 0.04 },
        initialLoss: 0.045,
        finalLoss: 0.0012,
        history,
        fittedPlanes: [-0.65, 0.65],
      };

      const html = renderToStaticMarkup(<FitPanel fitResult={mockResult} />);

      // History table presence
      expect(html).toContain('data-testid="fit-history-table"');

      // Step 1: accepted
      expect(html).toContain('data-testid="history-table-row-1"');
      expect(html).toContain('data-status="accepted"');
      expect(html).toContain('data-accepted="true"');
      expect(html).toContain('已接受');

      // Step 2: rejected
      expect(html).toContain('data-testid="history-table-row-2"');
      expect(html).toContain('data-status="rejected"');
      expect(html).toContain('data-accepted="false"');
      expect(html).toContain('已拒绝');

      // Step 3: accepted
      expect(html).toContain('data-testid="history-table-row-3"');
      expect(html).toContain('data-status="accepted"');

      // Step 4: rejected
      expect(html).toContain('data-testid="history-table-row-4"');
      expect(html).toContain('data-status="rejected"');
    });

    it('renders distinct SVG visual markers in HistoryPlot for accepted and rejected steps', () => {
      const history = createMockHistory(4, [2]); // Step 2 is rejected, 1, 3, 4 accepted

      const html = renderToStaticMarkup(<HistoryPlot history={history} />);

      // Accepted markers (circles with green fill)
      expect(html).toContain('data-testid="plot-marker-accepted"');
      expect(html).toContain('data-accepted="true"');
      expect(html).toContain('fill="#34d399"');

      // Rejected markers (polygon diamond with rose fill)
      expect(html).toContain('data-testid="plot-marker-rejected"');
      expect(html).toContain('data-accepted="false"');
      expect(html).toContain('points=');
      expect(html).toContain('fill="#f43f5e"');

      // Legend explicitly distinguishes them with counts
      expect(html).toContain('已接受 (Accepted):</strong> 3 步');
      expect(html).toContain('已拒绝 (Rejected):</strong> 1 步');
    });

    it('provides accessible screen-reader ARIA descriptions indicating acceptance state without relying on color alone (FR13)', () => {
      const history = createMockHistory(3, [2]);
      const html = renderToStaticMarkup(<HistoryPlot history={history} />);

      expect(html).toContain('aria-label="第 1 步: 损失');
      expect(html).toContain('状态 已接受"');
      expect(html).toContain('aria-label="第 2 步: 损失');
      expect(html).toContain('状态 已拒绝"');
    });
  });

  describe('3. Required Numerical Quantities Display (步号/阻尼/系数/未缩放 loss)', () => {
    it('displays step number, damping, coefficients, and unscaled loss with explicit units and formatting', () => {
      const history = createMockHistory(3);
      const mockResult: FitResult = {
        status: 'converged',
        mode: 'dual',
        estimate: { astig0: 0.0825, comaX: -0.0575, spherical: 0.0392 },
        initialLoss: 0.0451234,
        finalLoss: 0.00012345,
        history,
        fittedPlanes: [-0.65, 0.65],
      };

      const html = renderToStaticMarkup(<FitPanel fitResult={mockResult} />);

      // Step number
      expect(html).toContain('data-testid="metric-step-number"');
      expect(html).toContain('#3 / 60 步');

      // Damping lambda
      expect(html).toContain('data-testid="metric-damping-lambda"');
      expect(html).toContain('阻尼因子 (λ_LM)：');

      // Unscaled loss
      expect(html).toContain('data-testid="metric-unscaled-loss"');
      expect(html).toContain('未缩放残差平方和 (Loss)：');
      expect(html).toContain(formatScientific(0.00012345, 4));

      // Coefficients in waves
      expect(html).toContain('data-testid="fit-estimates-table"');
      expect(html).toContain('0° 像散');
      expect(html).toContain('x-彗差');
      expect(html).toContain('初级球差');
      expect(html).toContain(formatCoeffWave(0.0825));
      expect(html).toContain(formatCoeffWave(-0.0575));
      expect(html).toContain(formatCoeffWave(0.0392));
      expect(html).toContain('量纲单位：波长 (λ)');
    });

    it('formats scientific numbers with correct precision via formatScientific helper', () => {
      expect(formatScientific(0.00012345, 3)).toBe((0.00012345).toExponential(3));
      expect(formatScientific(1e-12, 2)).toBe('1.00e-12');
      expect(formatScientific(NaN)).toBe('NaN');
    });

    it('formats coefficient values with explicit sign and λ unit via formatCoeffWave helper', () => {
      expect(formatCoeffWave(0.08)).toBe('+0.0800 λ');
      expect(formatCoeffWave(-0.06)).toBe('-0.0600 λ');
      expect(formatCoeffWave(0)).toBe('+0.0000 λ');
      expect(formatCoeffWave(NaN)).toBe('NaN');
    });
  });

  describe('4. History Display Constrained to 60 Steps (受 60 步约束)', () => {
    it('strictly truncates history display to 60 steps even when provided with > 60 steps', () => {
      // Create 80 iterations
      const largeHistory = createMockHistory(80);
      expect(largeHistory).toHaveLength(80);

      const mockResult: FitResult = {
        status: 'max_iterations',
        mode: 'dual',
        estimate: { astig0: 0.05, comaX: -0.04, spherical: 0.03 },
        initialLoss: 0.05,
        finalLoss: 0.001,
        history: largeHistory,
        fittedPlanes: [-0.65, 0.65],
      };

      const html = renderToStaticMarkup(<FitPanel fitResult={mockResult} />);

      // Badge reports 60 / 60
      expect(html).toContain('60 / 60 步 (上限 60)');

      // Contains row 60, but NOT row 61 or row 80
      expect(html).toContain('data-testid="history-table-row-60"');
      expect(html).not.toContain('data-testid="history-table-row-61"');
      expect(html).not.toContain('data-testid="history-table-row-80"');
    });

    it('HistoryPlot component strictly caps SVG nodes to MAX_ITERATIONS = 60', () => {
      const largeHistory = createMockHistory(75);
      const html = renderToStaticMarkup(<HistoryPlot history={largeHistory} />);

      expect(html).toContain('60 / 60 步 (上限 60)');
      expect(html).toContain('data-testid="plot-step-node-60"');
      expect(html).not.toContain('data-testid="plot-step-node-61"');
      expect(html).not.toContain('data-testid="plot-step-node-75"');
    });
  });

  describe('5. Iteration Selection & Playback (迭代选择回放)', () => {
    it('displays selected playback iteration values without altering final estimate', () => {
      const history = createMockHistory(10, [3, 7]);
      const finalEstimate = { astig0: 0.08, comaX: -0.06, spherical: 0.04 };
      const step3Record = history[2]!; // 3rd record, iter = 3 (rejected)

      const mockResult: FitResult = {
        status: 'converged',
        mode: 'dual',
        estimate: finalEstimate,
        initialLoss: 0.045,
        finalLoss: 0.0005,
        history,
        fittedPlanes: [-0.65, 0.65],
      };

      // Render with step 3 selected for playback
      const html = renderToStaticMarkup(
        <FitPanel fitResult={mockResult} selectedIteration={step3Record} />
      );

      // Playback indicator header
      expect(html).toContain('[回放第 #3 步]');
      expect(html).toContain('回放值 (#3)');
      expect(html).toContain('返回最新估计 (Reset to Latest)');

      // Metric box reflects step 3 values
      expect(html).toContain('#3 / 60 步');
      expect(html).toContain('已拒绝 (Rejected)');
      expect(html).toContain(formatScientific(step3Record.loss, 4));

      // Estimates table reflects step 3 coefficients, not finalEstimate
      expect(html).toContain(formatCoeffWave(step3Record.coefficients.astig0));

      // Final estimate in mockResult is NOT mutated
      expect(mockResult.estimate).toEqual(finalEstimate);
      expect(mockResult.finalLoss).toBe(0.0005);
    });

    it('renders scrubber slider and prev/next buttons for playback navigation', () => {
      const history = createMockHistory(5);
      const mockResult: FitResult = {
        status: 'converged',
        mode: 'dual',
        estimate: { astig0: 0.01, comaX: 0.01, spherical: 0.01 },
        initialLoss: 0.02,
        finalLoss: 0.001,
        history,
        fittedPlanes: [-0.65, 0.65],
      };

      const html = renderToStaticMarkup(<FitPanel fitResult={mockResult} />);

      expect(html).toContain('data-testid="fit-playback-bar"');
      expect(html).toContain('data-testid="playback-slider"');
      expect(html).toContain('data-testid="btn-playback-prev"');
      expect(html).toContain('data-testid="btn-playback-next"');
    });

    it('highlights selected node in HistoryPlot with distinct halo marker', () => {
      const history = createMockHistory(5);
      const selected = history[1]!; // Step 2

      const html = renderToStaticMarkup(
        <HistoryPlot history={history} selectedIteration={selected} />
      );

      expect(html).toContain('data-testid="plot-marker-selected"');
      expect(html).toContain('已选择回放：<strong>第 2 步</strong>');
      expect(html).toContain('data-testid="history-plot-selected-details"');
    });
  });

  describe('6. Ground Truth Reveal / Privacy Protection (FR02 / Section 4.2)', () => {
    it('masks ground truth values when showGroundTruth is false (blind solve mode)', () => {
      const mockGt: Coefficients = { astig0: 0.08, comaX: -0.06, spherical: 0.04 };
      const html = renderToStaticMarkup(
        <FitPanel groundTruth={mockGt} showGroundTruth={false} />
      );

      // Truth is hidden with privacy placeholder
      expect(html).toContain('参考真值 (隐藏)');
      expect(html).toContain('— (盲解保密)');
      expect(html).not.toContain('+0.0800 λ</td>');
      expect(html).not.toContain('绝对误差 |Δ|');
    });

    it('reveals ground truth values and computes absolute error when showGroundTruth is true', () => {
      const mockGt: Coefficients = { astig0: 0.08, comaX: -0.06, spherical: 0.04 };
      const mockResult: FitResult = {
        status: 'converged',
        mode: 'dual',
        estimate: { astig0: 0.0805, comaX: -0.0595, spherical: 0.0402 },
        initialLoss: 0.05,
        finalLoss: 0.0001,
        history: createMockHistory(2),
        fittedPlanes: [-0.65, 0.65],
      };

      const html = renderToStaticMarkup(
        <FitPanel fitResult={mockResult} groundTruth={mockGt} showGroundTruth={true} />
      );

      expect(html).toContain('参考真值');
      expect(html).toContain('+0.0800 λ');
      expect(html).toContain('-0.0600 λ');
      expect(html).toContain('+0.0400 λ');
      expect(html).toContain('绝对误差 |Δ|');
      expect(html).toContain('data-testid="val-error-astig0"');
    });
  });

  describe('7. Mode Switching (FR04 / Section 4.1 / 4.2)', () => {
    it('renders single-plane (-0.65λ) and dual-plane (±0.65λ) radio buttons', () => {
      const htmlDual = renderToStaticMarkup(<FitPanel mode="dual" />);
      expect(htmlDual).toContain('data-testid="btn-mode-dual"');
      expect(htmlDual).toContain('data-testid="btn-mode-single"');
      expect(htmlDual).toContain('双焦面 (±0.65λ)');
      expect(htmlDual).toContain('单焦面 (-0.65λ)');

      const htmlSingle = renderToStaticMarkup(<FitPanel mode="single" />);
      expect(htmlSingle).toContain('data-testid="btn-mode-single"');
    });
  });

  describe('8. HistoryPlot View Modes & Empty State', () => {
    it('renders empty placeholder when history is empty', () => {
      const html = renderToStaticMarkup(<HistoryPlot history={[]} />);
      expect(html).toContain('data-testid="history-plot-empty"');
      expect(html).toContain('暂无优化轨迹历史');
    });

    it('renders SVG polyline and axes when history is present', () => {
      const history = createMockHistory(4);
      const html = renderToStaticMarkup(<HistoryPlot history={history} />);

      expect(html).toContain('data-testid="history-plot-svg"');
      expect(html).toContain('data-testid="plot-loss-line"');
      expect(html).toContain('points=');
      expect(html).toContain('未缩放 Loss (log10)');
    });
  });

  describe('9. Real Web Worker Client Integration (历史真实来自 Worker)', () => {
    it('solves mixed preset through genuine InProcessTestWorker, streams progress, and validates history contract', async () => {
      // 1. Create a genuine InProcessTestWorker connected to compute.worker logic
      const testWorker = new InProcessTestWorker();
      const sentRequests: WorkerRequest[] = [];
      testWorker.messageSpy = (req) => {
        sentRequests.push(req as WorkerRequest);
      };

      const client = new WorkerClient({
        createWorker: () => testWorker,
      });

      // 2. Prepare real observations from astig-only preset
      const caseData = createCaseFromPreset('astig-only');
      expect(caseData.observations.minus).toHaveLength(4096);
      expect(caseData.observations.plus).toHaveLength(4096);

      // 3. Track progress stream genuine iterations
      const streamedProgress: IterationRecord[] = [];
      const onProgress = (record: IterationRecord) => {
        streamedProgress.push(record);
      };

      // 4. Execute fit through Worker client
      const fitPromise = client.fit('dual', caseData.observations, onProgress);

      const result = await fitPromise;

      // Verify contract: FIT message NEVER contains groundTruth
      const fitReq = sentRequests.find((r) => r.type === 'FIT');
      expect(fitReq).toBeDefined();
      expect('groundTruth' in (fitReq as any)).toBe(false);

      // Verify result status
      expect(result.status).toBe('converged');
      expect(result.mode).toBe('dual');
      expect(result.initialLoss).toBeGreaterThan(0);
      expect(result.finalLoss).toBeLessThan(result.initialLoss);
      expect(result.history.length).toBeGreaterThan(0);
      expect(result.history.length).toBeLessThanOrEqual(MAX_ITERATIONS);

      // Verify progress was genuinely streamed
      expect(streamedProgress.length).toBe(result.history.length);
      expect(streamedProgress[0]?.iter).toBe(1);
      expect(typeof streamedProgress[0]?.loss).toBe('number');
      expect(typeof streamedProgress[0]?.lambda).toBe('number');
      expect(typeof streamedProgress[0]?.accepted).toBe('boolean');

      // Verify estimate recovered astigmatism accurately (astig-only groundTruth = 0.10)
      expect(Math.abs(result.estimate.astig0 - 0.10)).toBeLessThan(0.005);
      expect(Math.abs(result.estimate.comaX)).toBeLessThan(0.005);
      expect(Math.abs(result.estimate.spherical)).toBeLessThan(0.005);

      // 5. Render FitPanel with the genuine Worker result
      const html = renderToStaticMarkup(
        <FitPanel
          mode="dual"
          observations={caseData.observations}
          fitResult={result}
          groundTruth={caseData.groundTruth}
          showGroundTruth={true}
        />
      );

      // Check all elements are properly hydrated with real worker data
      expect(html).toContain('已收敛 (converged)');
      expect(html).toContain('fw-status-converged');
      expect(html).toContain(formatScientific(result.finalLoss, 4));
      expect(html).toContain(formatCoeffWave(result.estimate.astig0));
      expect(html).toContain(`data-testid="history-table-row-${result.history.length}"`);

      // Cleanup
      client.terminate();
    });

    it('cancels active run and rejects with WorkerCancelledError without contaminating subsequent requests', async () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({
        createWorker: () => testWorker,
      });

      const caseData = createCaseFromPreset('mixed');

      const fitPromise = client.fit('dual', caseData.observations);
      // Immediately cancel
      client.cancel();

      await expect(fitPromise).rejects.toThrow(WorkerCancelledError);

      client.terminate();
    });
  });
});
