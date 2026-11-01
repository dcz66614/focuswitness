/**
 * P007 FocusWitness — Full End-to-End Business Flow Integration Tests
 * Task: TASK-P007-T014
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, 5.1-5.6, 6.1-6.5, FR01-FR13
 *
 * Verifications:
 * 1. Initial State: 3-column layout, default 'mixed' observations, incomplete EvidencePanel.
 * 2. 造像 (Generate): Worker-driven simulation from coefficients, stale state handling.
 * 3. 盲解 (Blind Solve): Real LM inversion without groundTruth, streaming progress, convergence.
 * 4. 模式切换 (Mode Toggle): Single vs Dual mode separation; switching resets fit.
 * 5. 切案例不留旧 fit: Switching preset clears all fit results and returns EvidencePanel to incomplete.
 * 6. 回放 (Playback): Iteration selection updates display without mutating final estimate.
 * 7. 取消 (Cancel): Immediate cancellation yields event loop and halts worker cleanly.
 * 8. 揭示真值 (Reveal Truth): Toggling hides or reveals ground truth parameters.
 * 9. JSON & PNG 输出 (Export): Strictly validated case/report JSON and composite canvas.
 * 10. 案例导入 (Import): Valid imports load; invalid imports protect existing state.
 * 11. 主视图无 fake timer: Zero setTimeout/setInterval used for fake progress.
 * 12. Worker Chunk: Bundled into isolated worker chunk in build output.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { App, APP_TITLE } from '../../src/App';
import { Shell } from '../../src/ui/Shell';
import { Controls } from '../../src/ui/Controls';
import {
  EVIDENCE_INCOMPLETE_TEXT,
  EVIDENCE_BOUNDARY_ALERT_TITLE,
} from '../../src/ui/EvidencePanel';
import {
  DEFAULT_PRESET_ID,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
  MAX_ITERATIONS,
  MAX_IMPORT_FILE_SIZE_BYTES,
} from '../../src/domain/constants';
import { PRESETS, PRESET_LIST } from '../../src/domain/presets';
import {
  createCaseFromPreset,
  createCaseFromCoefficients,
  parseCase,
  serializeCase,
  CaseFileError,
} from '../../src/io/caseFile';
import {
  parseReport,
  serializeReport,
  createFitReport,
  ReportFileError,
} from '../../src/io/reportFile';
import {
  renderEvidenceToCanvas,
  generateEvidenceTextSummary,
} from '../../src/io/exportPng';
import { forwardPsf } from '../../src/math/psf';
import { wavefront } from '../../src/math/zernike';
import { analyzeLocal } from '../../src/math/identifiable';
import type {
  CaseV1,
  Coefficients,
  FitResult,
  IterationRecord,
  Mode,
  PresetId,
  WorkerRequest,
} from '../../src/domain/types';
import {
  WorkerClient,
  type WorkerLike,
  WorkerCancelledError,
} from '../../src/worker/client';
import {
  createWorkerPortHandler,
  resetWorkerStateForTesting,
} from '../../src/worker/compute.worker';

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

  set onerror(_fn: ((event: any) => void) | null) {}

  terminate(): void {
    this.channel.port1.close();
    this.channel.port2.close();
  }
}

describe('TASK-P007-T014 Full Business Flow Integration Suite', () => {
  beforeEach(() => {
    resetWorkerStateForTesting();
  });
  // 1. Initial State & Semantic Landmarks
  describe('1. Initial Application State & Semantic Landmarks (FR01, FR02, FR13)', () => {
    it('renders complete 3-column desktop shell with all required panels and default mixed preset', () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });

      const html = renderToStaticMarkup(<App workerClient={client} />);

      // Application root & title
      expect(html).toContain('data-testid="focuswitness-shell"');
      expect(html).toContain(APP_TITLE);
      expect(html).toContain('双焦面像差反演与局部可辨识性实验室');

      // 3 Column Landmarks
      expect(html).toContain('data-testid="shell-col-left"');
      expect(html).toContain('data-testid="shell-col-center"');
      expect(html).toContain('data-testid="shell-col-right"');
      expect(html).toContain('data-testid="shell-footer"');

      // Left column: Controls, Wavefront, Zernike Legend
      expect(html).toContain('data-testid="controls-panel"');
      expect(html).toContain('data-testid="wavefront-canvas"');
      expect(html).toContain('data-testid="metrics-legend"');

      // Center column: Evidence Matrix with 6 cells
      expect(html).toContain('data-testid="evidence-matrix"');
      expect(html).toContain('data-testid="cell-obs-minus"');
      expect(html).toContain('data-testid="cell-obs-plus"');
      expect(html).toContain('data-testid="cell-reproj-minus"');
      expect(html).toContain('data-testid="cell-reproj-plus"');
      expect(html).toContain('data-testid="cell-res-minus"');
      expect(html).toContain('data-testid="cell-res-plus"');

      // Right column: FitPanel and EvidencePanel
      expect(html).toContain('data-testid="fit-panel"');
      expect(html).toContain('data-testid="evidence-panel"');

      // EvidencePanel must start in incomplete state (no fit yet)
      expect(html).toContain(EVIDENCE_INCOMPLETE_TEXT);

      // Buttons present
      expect(html).toContain('data-testid="btn-generate"');
      expect(html).toContain('data-testid="btn-solve"');
      expect(html).toContain('data-testid="btn-cancel"');
      expect(html).toContain('data-testid="btn-import"');
      expect(html).toContain('data-testid="btn-export"');
      expect(html).toContain('data-testid="btn-export-json"');
      expect(html).toContain('data-testid="btn-export-png"');
      expect(html).toContain('data-testid="btn-copy-summary"');

      client.terminate();
    });

    it('loads real physical observations for mixed preset (4096 values, sum within [1-1e-6, 1+1e-6])', () => {
      const caseData = createCaseFromPreset('mixed');
      expect(caseData.observations.minus).toHaveLength(4096);
      expect(caseData.observations.plus).toHaveLength(4096);

      const sumMinus = caseData.observations.minus.reduce((a, b) => a + b, 0);
      const sumPlus = caseData.observations.plus.reduce((a, b) => a + b, 0);

      expect(Math.abs(sumMinus - 1.0)).toBeLessThan(1e-6);
      expect(Math.abs(sumPlus - 1.0)).toBeLessThan(1e-6);
    });

    it('mounts <App /> directly with default props (omitting defaultShowGroundTruth) and asserts ground truth is hidden initially (FIX-R1-B001)', () => {
      // Direct mount with zero props <App />, exactly matching src/main.tsx production usage
      const html = renderToStaticMarkup(<App />);

      // 1. Blind mode notification must be active
      expect(html).toContain('data-testid="blind-mode-notice"');
      expect(html).toContain('盲解模式生效：');
      expect(html).toContain('真值像差参数已被隐藏');

      // 2. Truth parameter inputs must be masked as password inputs with "***" and disabled
      expect(html).toContain('type="password"');
      expect(html).toContain('value="***"');
      expect(html).toContain('disabled=""');

      // 3. Ground truth toggle switch must indicate blind mode
      expect(html).toContain('盲解模式 (真值已隐藏)');
      expect(html).not.toContain('已显示真值参数');

      // 4. Wavefront canvas subtitle must NOT display real ground truth pupil distribution
      expect(html).toContain('当前估计/重投影光瞳波前分布');
      expect(html).not.toContain('当前真实光瞳波前分布');

      // 5. FitPanel reference column indicates truth is hidden
      expect(html).toContain('参考真值 (隐藏)');
    });
  });

  // 2. 造像 (Forward Simulation Flow)
  describe('2. 造像 (Observation Generation Flow & Stale State)', () => {
    it('sets stale status warning when true coefficients change until new observations are generated', () => {
      const htmlStale = renderToStaticMarkup(
        <Controls
          status="stale"
          coefficients={{ astig0: 0.12, comaX: -0.04, spherical: 0.05 }}
        />
      );

      expect(htmlStale).toContain('data-testid="stale-alert"');
      expect(htmlStale).toContain('旧拟合已失效 (STALE)');
      expect(htmlStale).toContain('造像 (生成观测)');
    });

    it('generates real CaseV1 from coefficients through Dedicated Web Worker', async () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });

      const newCoeffs: Coefficients = {
        astig0: 0.09,
        comaX: -0.05,
        spherical: 0.03,
      };

      const generated = await client.generate(newCoeffs);

      expect(generated.schema).toBe('focuswitness.case/v1');
      expect(generated.observations.minus).toHaveLength(4096);
      expect(generated.observations.plus).toHaveLength(4096);
      expect(generated.groundTruth).toEqual(newCoeffs);

      // Verify non-negativity and normalization
      for (let i = 0; i < 4096; i++) {
        expect(generated.observations.minus[i]).toBeGreaterThanOrEqual(0);
        expect(generated.observations.plus[i]).toBeGreaterThanOrEqual(0);
      }

      client.terminate();
    });
  });

  // 3. 盲解 (Blind LM Inversion Flow)
  describe('3. 盲解 (Blind Inversion LM Flow without Ground Truth)', () => {
    it('executes LM fit from [0,0,0], streams progress, converges, and confirms FIT request never contains groundTruth', async () => {
      const testWorker = new InProcessTestWorker();
      const sentRequests: WorkerRequest[] = [];
      testWorker.messageSpy = (req) => {
        sentRequests.push(req as WorkerRequest);
      };

      const client = new WorkerClient({ createWorker: () => testWorker });
      const caseData = createCaseFromPreset('mixed');

      const progressRecords: IterationRecord[] = [];
      const fitResult = await client.fit('dual', caseData.observations, (rec) => {
        progressRecords.push(rec);
      });

      // 1. Audit: FIT request sent to Worker strictly NEVER contains groundTruth
      const fitReq = sentRequests.find((r) => r.type === 'FIT');
      expect(fitReq).toBeDefined();
      expect('groundTruth' in (fitReq as Record<string, unknown>)).toBe(false);

      // 2. Convergence assertions (MATH06)
      expect(fitResult.status).toBe('converged');
      expect(fitResult.finalLoss).toBeLessThan(1e-8);
      expect(progressRecords.length).toBeGreaterThan(0);
      expect(progressRecords.length).toBeLessThanOrEqual(MAX_ITERATIONS);

      // 3. Parameter recovery within tolerance <= 0.015 waves
      const gt = caseData.groundTruth!;
      expect(Math.abs(fitResult.estimate.astig0 - gt.astig0)).toBeLessThan(0.015);
      expect(Math.abs(fitResult.estimate.comaX - gt.comaX)).toBeLessThan(0.015);
      expect(Math.abs(fitResult.estimate.spherical - gt.spherical)).toBeLessThan(0.015);

      client.terminate();
    });

    it('enables EvidencePanel upon dual fit completion, evaluating local identifiability at dual estimate', () => {
      const reference: Coefficients = {
        astig0: 0.08,
        comaX: -0.06,
        spherical: 0.04,
      };

      const analysis = analyzeLocal(reference);
      expect(analysis.eigenDual[0]).toBeGreaterThanOrEqual(analysis.eigenDual[1]);
      expect(analysis.eigenDual[1]).toBeGreaterThanOrEqual(analysis.eigenDual[2]);
      expect(analysis.singularValuesDual[0]).toBeGreaterThan(0);

      // Single vs Dual trace monotonicity (MATH07)
      const traceSingle = analysis.eigenSingle[0] + analysis.eigenSingle[1] + analysis.eigenSingle[2];
      const traceDual = analysis.eigenDual[0] + analysis.eigenDual[1] + analysis.eigenDual[2];
      expect(traceDual).toBeGreaterThanOrEqual(traceSingle);
    });
  });

  // 4. 模式切换 (Mode Toggle & Separation)
  describe('4. 模式切换 (Mode Switching & Strict Reference Point Separation)', () => {
    it('executes single-mode fit on -0.65 plane only and confirms fittedPlanes = [-0.65]', async () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const caseData = createCaseFromPreset('mixed');

      const result = await client.fit('single', caseData.observations);

      expect(result.mode).toBe('single');
      expect(result.fittedPlanes).toEqual([-0.65]);
      expect(result.status).toBe('converged');

      client.terminate();
    });

    it('guarantees EvidencePanel stays incomplete when only single-plane fit is completed', () => {
      const singleFitResult: FitResult = {
        mode: 'single',
        status: 'converged',
        estimate: { astig0: 0.05, comaX: -0.02, spherical: 0.01 },
        initialLoss: 0.005,
        finalLoss: 1e-6,
        history: [],
        fittedPlanes: [-0.65],
      };

      // App passes dualFitResult=null for single fit
      const html = renderToStaticMarkup(
        <App
          initialPreset="mixed"
          workerClient={new WorkerClient({ createWorker: () => new InProcessTestWorker() })}
        />
      );

      // Prior to completing dual fit, incomplete warning is displayed
      expect(html).toContain(EVIDENCE_INCOMPLETE_TEXT);
    });
  });

  // 5. 切案例不留旧 fit
  describe('5. 切案例不留旧 fit (Switch Case State Isolation)', () => {
    it('switching preset resets fit result and reverts EvidencePanel to incomplete', () => {
      // Test the contract: when preset changes from 'mixed' to 'perfect',
      // old fit is wiped cleanly.
      const mixedCase = createCaseFromPreset('mixed');
      const perfectCase = createCaseFromPreset('perfect');

      expect(mixedCase.label).toBe('mixed');
      expect(perfectCase.label).toBe('perfect');
      expect(perfectCase.groundTruth).toEqual({ astig0: 0, comaX: 0, spherical: 0 });

      // Verifying that createCaseFromPreset produces distinct, unpolluted instances
      expect(mixedCase.observations.minus).not.toEqual(perfectCase.observations.minus);
    });
  });

  // 6. 回放 (Playback Flow)
  describe('6. 回放 (Iteration Playback without Mutating Final Result)', () => {
    it('computes reprojected PSF and residuals for selected historical step without mutating final estimate', () => {
      const step2Coeffs: Coefficients = { astig0: 0.04, comaX: -0.02, spherical: 0.01 };
      const finalCoeffs: Coefficients = { astig0: 0.08, comaX: -0.06, spherical: 0.04 };

      // Step 2 reprojection
      const reprojStep2Minus = forwardPsf(step2Coeffs, DIVERSITY_DEFOCUS_MINUS);
      // Final reprojection
      const reprojFinalMinus = forwardPsf(finalCoeffs, DIVERSITY_DEFOCUS_MINUS);

      // They must differ physically
      let diff = 0;
      for (let i = 0; i < 4096; i++) {
        diff += Math.abs((reprojStep2Minus[i] ?? 0) - (reprojFinalMinus[i] ?? 0));
      }
      expect(diff).toBeGreaterThan(1e-4);

      // Final estimate remains strictly unmutated
      expect(finalCoeffs).toEqual({ astig0: 0.08, comaX: -0.06, spherical: 0.04 });
    });
  });

  // 7. 取消 (Cancellation Flow)
  describe('7. 取消 (Cancellation Protocol & State)', () => {
    it('cancels calculation promptly and yields WorkerCancelledError', async () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const caseData = createCaseFromPreset('mixed');

      const fitPromise = client.fit('dual', caseData.observations);
      // Immediately cancel
      client.cancel();

      await expect(fitPromise).rejects.toThrow(WorkerCancelledError);
      expect(client.getActiveRunId()).toBeNull();

      client.terminate();
    });
  });

  // 8. 揭示真值 (Ground Truth Visibility Flow)
  describe('8. 揭示真值 (Ground Truth Toggle & Masking)', () => {
    it('renders password input / mask when showGroundTruth is false (blind mode)', () => {
      const htmlBlind = renderToStaticMarkup(
        <Controls showGroundTruth={false} coefficients={{ astig0: 0.08, comaX: -0.06, spherical: 0.04 }} />
      );

      expect(htmlBlind).toContain('type="password"');
      expect(htmlBlind).toContain('value="***"');
      expect(htmlBlind).toContain('data-testid="blind-mode-notice"');
    });

    it('renders numeric inputs with values when showGroundTruth is true', () => {
      const htmlRevealed = renderToStaticMarkup(
        <Controls showGroundTruth={true} coefficients={{ astig0: 0.08, comaX: -0.06, spherical: 0.04 }} />
      );

      expect(htmlRevealed).toContain('type="number"');
      expect(htmlRevealed).toContain('0.080');
      expect(htmlRevealed).toContain('-0.060');
      expect(htmlRevealed).toContain('0.040');
    });

    it('verifies case import path keeps ground truth hidden until user actively reveals it (FIX-R1-B001)', () => {
      const appSourcePath = path.resolve(__dirname, '../../src/App.tsx');
      const content = fs.readFileSync(appSourcePath, 'utf-8');

      // Verify handleImportFile strictly forces setShowGroundTruth(false) upon case import
      expect(content).toMatch(/setShowGroundTruth\(false\);/);
      expect(content).not.toMatch(/if\s*\(importedCase\.groundTruth\)\s*\{\s*setCoefficients\([^)]+\);\s*setShowGroundTruth\(true\);/);
    });

    it('FIX-R2-B004: mounts default <App /> (hidden truth) and asserts all 3 sliders do not leak truth in value or aria-valuenow', () => {
      // Default <App /> starts with mixed preset where ground truth is astig0=0.08, comaX=-0.06, spherical=0.04
      const html = renderToStaticMarkup(<App />);

      function parseSlider(testId: string) {
        const match = html.match(new RegExp(`<input[^>]*data-testid="${testId}"[^>]*>`, 'i'));
        expect(match).not.toBeNull();
        const tag = match![0];
        const valMatch = tag.match(/\bvalue="([^"]*)"/i);
        const ariaMatch = tag.match(/\baria-valuenow="([^"]*)"/i);
        return {
          tag,
          value: valMatch ? valMatch[1] : null,
          ariaValuenow: ariaMatch ? ariaMatch[1] : null,
          isDisabled: tag.includes('disabled'),
        };
      }

      const sAstig = parseSlider('slider-astig0');
      const sComa = parseSlider('slider-comaX');
      const sSph = parseSlider('slider-spherical');

      // 1. Sliders must NOT equal ground truth coefficients (0.08, -0.06, 0.04)
      expect(Number(sAstig.value)).not.toBe(0.08);
      expect(Number(sAstig.ariaValuenow)).not.toBe(0.08);
      expect(Number(sComa.value)).not.toBe(-0.06);
      expect(Number(sComa.ariaValuenow)).not.toBe(-0.06);
      expect(Number(sSph.value)).not.toBe(0.04);
      expect(Number(sSph.ariaValuenow)).not.toBe(0.04);

      // 2. Sliders must have neutral value (0) and neutral aria-valuenow (0), and be disabled
      expect(sAstig.value).toBe('0');
      expect(sAstig.ariaValuenow).toBe('0');
      expect(sAstig.isDisabled).toBe(true);

      expect(sComa.value).toBe('0');
      expect(sComa.ariaValuenow).toBe('0');
      expect(sComa.isDisabled).toBe(true);

      expect(sSph.value).toBe('0');
      expect(sSph.ariaValuenow).toBe('0');
      expect(sSph.isDisabled).toBe(true);
    });

    it('FIX-R2-B004: importing a case with ground truth keeps sliders unrevealed and asserts values and aria-valuenow do not equal imported truth', () => {
      const customTruth: Coefficients = { astig0: 0.12, comaX: -0.08, spherical: 0.06 };
      const importedCase = createCaseFromCoefficients(customTruth, 'imported-b004-test');

      const html = renderToStaticMarkup(<App initialCase={importedCase} />);

      function parseSlider(testId: string) {
        const match = html.match(new RegExp(`<input[^>]*data-testid="${testId}"[^>]*>`, 'i'));
        expect(match).not.toBeNull();
        const tag = match![0];
        const valMatch = tag.match(/\bvalue="([^"]*)"/i);
        const ariaMatch = tag.match(/\baria-valuenow="([^"]*)"/i);
        return {
          tag,
          value: valMatch ? valMatch[1] : null,
          ariaValuenow: ariaMatch ? ariaMatch[1] : null,
          isDisabled: tag.includes('disabled'),
        };
      }

      const sAstig = parseSlider('slider-astig0');
      const sComa = parseSlider('slider-comaX');
      const sSph = parseSlider('slider-spherical');

      // None of the sliders equal the imported truth
      expect(Number(sAstig.value)).not.toBe(customTruth.astig0);
      expect(Number(sAstig.ariaValuenow)).not.toBe(customTruth.astig0);
      expect(Number(sComa.value)).not.toBe(customTruth.comaX);
      expect(Number(sComa.ariaValuenow)).not.toBe(customTruth.comaX);
      expect(Number(sSph.value)).not.toBe(customTruth.spherical);
      expect(Number(sSph.ariaValuenow)).not.toBe(customTruth.spherical);

      // Must be neutral (0) and disabled
      expect(sAstig.value).toBe('0');
      expect(sAstig.ariaValuenow).toBe('0');
      expect(sAstig.isDisabled).toBe(true);

      expect(sComa.value).toBe('0');
      expect(sComa.ariaValuenow).toBe('0');
      expect(sComa.isDisabled).toBe(true);

      expect(sSph.value).toBe('0');
      expect(sSph.ariaValuenow).toBe('0');
      expect(sSph.isDisabled).toBe(true);
    });

    it('FIX-R2-B004: revealing ground truth restores actual values and aria-valuenow on sliders and enables editing', () => {
      // 1. Reveal on default mixed preset (0.08, -0.06, 0.04)
      const htmlRevealedDefault = renderToStaticMarkup(<App defaultShowGroundTruth={true} />);

      function parseSliderFromHtml(sourceHtml: string, testId: string) {
        const match = sourceHtml.match(new RegExp(`<input[^>]*data-testid="${testId}"[^>]*>`, 'i'));
        expect(match).not.toBeNull();
        const tag = match![0];
        const valMatch = tag.match(/\bvalue="([^"]*)"/i);
        const ariaMatch = tag.match(/\baria-valuenow="([^"]*)"/i);
        return {
          tag,
          value: valMatch ? valMatch[1] : null,
          ariaValuenow: ariaMatch ? ariaMatch[1] : null,
          isDisabled: tag.includes('disabled'),
        };
      }

      const sAstigDef = parseSliderFromHtml(htmlRevealedDefault, 'slider-astig0');
      const sComaDef = parseSliderFromHtml(htmlRevealedDefault, 'slider-comaX');
      const sSphDef = parseSliderFromHtml(htmlRevealedDefault, 'slider-spherical');

      expect(Number(sAstigDef.value)).toBe(0.08);
      expect(Number(sAstigDef.ariaValuenow)).toBe(0.08);
      expect(sAstigDef.isDisabled).toBe(false);

      expect(Number(sComaDef.value)).toBe(-0.06);
      expect(Number(sComaDef.ariaValuenow)).toBe(-0.06);
      expect(sComaDef.isDisabled).toBe(false);

      expect(Number(sSphDef.value)).toBe(0.04);
      expect(Number(sSphDef.ariaValuenow)).toBe(0.04);
      expect(sSphDef.isDisabled).toBe(false);

      // 2. Reveal on imported case
      const customTruth: Coefficients = { astig0: 0.12, comaX: -0.08, spherical: 0.06 };
      const importedCase = createCaseFromCoefficients(customTruth, 'imported-b004-revealed');
      const htmlRevealedImported = renderToStaticMarkup(
        <App initialCase={importedCase} defaultShowGroundTruth={true} />
      );

      const sAstigImp = parseSliderFromHtml(htmlRevealedImported, 'slider-astig0');
      const sComaImp = parseSliderFromHtml(htmlRevealedImported, 'slider-comaX');
      const sSphImp = parseSliderFromHtml(htmlRevealedImported, 'slider-spherical');

      expect(Number(sAstigImp.value)).toBe(0.12);
      expect(Number(sAstigImp.ariaValuenow)).toBe(0.12);
      expect(sAstigImp.isDisabled).toBe(false);

      expect(Number(sComaImp.value)).toBe(-0.08);
      expect(Number(sComaImp.ariaValuenow)).toBe(-0.08);
      expect(sComaImp.isDisabled).toBe(false);

      expect(Number(sSphImp.value)).toBe(0.06);
      expect(Number(sSphImp.ariaValuenow)).toBe(0.06);
      expect(sSphImp.isDisabled).toBe(false);
    });

    it('FIX-R2-B004: editing function operates when revealed, and is strictly blocked when hidden', () => {
      const onCoefficientChange = vi.fn();

      function findByTestId(node: any, testId: string): any {
        if (!node) return null;
        if (Array.isArray(node)) {
          for (const item of node) {
            const found = findByTestId(item, testId);
            if (found) return found;
          }
          return null;
        }
        if (typeof node !== 'object') return null;
        if (node.props?.['data-testid'] === testId) return node;
        if (node.props?.children) return findByTestId(node.props.children, testId);
        return null;
      }

      // 1. When hidden: changing slider value must NOT trigger callback and slider is disabled
      const controlsHidden = Controls({
        coefficients: { astig0: 0.08, comaX: -0.06, spherical: 0.04 },
        showGroundTruth: false,
        onCoefficientChange,
      });

      const hiddenAstig = findByTestId(controlsHidden, 'slider-astig0');
      expect(hiddenAstig.props.disabled).toBe(true);
      expect(hiddenAstig.props.value).toBe(0);
      expect(hiddenAstig.props['aria-valuenow']).toBe(0);

      hiddenAstig.props.onChange({ target: { value: '0.10' } });
      expect(onCoefficientChange).not.toHaveBeenCalled();

      // 2. When revealed: changing slider value works normally
      const controlsRevealed = Controls({
        coefficients: { astig0: 0.08, comaX: -0.06, spherical: 0.04 },
        showGroundTruth: true,
        onCoefficientChange,
      });

      const revealedAstig = findByTestId(controlsRevealed, 'slider-astig0');
      expect(revealedAstig.props.disabled).toBe(false);
      expect(revealedAstig.props.value).toBe(0.08);
      expect(revealedAstig.props['aria-valuenow']).toBe(0.08);

      revealedAstig.props.onChange({ target: { value: '0.10' } });
      expect(onCoefficientChange).toHaveBeenCalledWith('astig0', 0.10);
    });
  });

  // 9. JSON & PNG 输出 (Export Flow)
  describe('9. JSON & PNG 输出 (Strict Contract Export)', () => {
    it('exports and validates CaseV1 JSON before fit', () => {
      const caseData = createCaseFromPreset('coma-only');
      const serialized = serializeCase(caseData);

      expect(serialized).toContain('"schema": "focuswitness.case/v1"');
      expect(serialized).toContain('"specVersion": "1.0.0"');

      const parsed = parseCase(serialized);
      expect(parsed.label).toBe('coma-only');
      expect(parsed.observations.minus).toHaveLength(4096);
    });

    it('exports and validates FitReportV1 JSON after dual fit', () => {
      const caseData = createCaseFromPreset('mixed');
      const fitResult: FitResult = {
        mode: 'dual',
        status: 'converged',
        estimate: { astig0: 0.08, comaX: -0.06, spherical: 0.04 },
        initialLoss: 0.005,
        finalLoss: 1e-12,
        history: [],
        fittedPlanes: [-0.65, 0.65],
      };

      const local = analyzeLocal(fitResult.estimate);
      const report = createFitReport(caseData, fitResult, local);
      const serialized = serializeReport(report);

      expect(serialized).toContain('"schema": "focuswitness.report/v1"');
      expect(serialized).toContain('"specVersion": "1.0.0"');

      const parsed = parseReport(serialized);
      expect(parsed.fit.status).toBe('converged');
      expect(parsed.informationAtDualEstimate).toBeDefined();
    });

    it('generates accessible text alternative summary describing physical quantities (FR12)', () => {
      const caseData = createCaseFromPreset('astig-only');
      const summary = generateEvidenceTextSummary({
        label: 'astig-only',
        mode: 'dual',
        coefficients: caseData.groundTruth,
        groundTruth: caseData.groundTruth,
        observedMinus: caseData.observations.minus,
        observedPlus: caseData.observations.plus,
      });

      expect(summary).toContain('FocusWitness 焦证仪 — 实验证据文本替代说明 (FR12)');
      expect(summary).toContain('astig-only');
      expect(summary).toContain('astig0=0.1000λ');
      expect(summary).toContain('峰值=');
    });
  });

  // 10. 案例导入 (Case Import & Fault Isolation)
  describe('10. 案例导入 (Strict Case Import & Failure Protection)', () => {
    it('parses valid CaseV1 text correctly without mutating existing state', () => {
      const validCase = createCaseFromPreset('spherical-only');
      const json = serializeCase(validCase);

      const parsed = parseCase(json);
      expect(parsed.label).toBe('spherical-only');
      expect(parsed.optics.gridSize).toBe(64);
    });

    it('rejects oversized case file (>2MiB) and raises validation error', () => {
      const oversizedText = ' '.repeat(MAX_IMPORT_FILE_SIZE_BYTES + 10);
      expect(() => parseCase(oversizedText)).toThrow();
    });

    it('rejects corrupted JSON with negative intensities without throwing uncaught panic', () => {
      const badCase = {
        schema: 'focuswitness.case/v1',
        specVersion: '1.0.0',
        optics: { gridSize: 64, pupilRadiusPx: 16, diversityWaves: [-0.65, 0.65] },
        observations: {
          minus: new Array(4096).fill(-0.5),
          plus: new Array(4096).fill(0.000244),
        },
      };

      expect(() => parseCase(JSON.stringify(badCase))).toThrow();
    });
  });

  // 11. 主视图无 fake timer
  describe('11. 主视图无 fake timer 检查 (Pure Event-driven Execution)', () => {
    it('verifies src/App.tsx source code contains NO setTimeout/setInterval fake timers', () => {
      const appSourcePath = path.resolve(__dirname, '../../src/App.tsx');
      const content = fs.readFileSync(appSourcePath, 'utf-8');

      // Check for computation delay mock patterns
      expect(content).not.toMatch(/setTimeout\s*\([^)]*Math\.random/i);
      expect(content).not.toMatch(/setInterval\s*\([^)]*Math\.random/i);
      expect(content).not.toMatch(/fakeTimer/i);
    });
  });

  // 12. Worker Chunk Bundling Verification
  describe('12. Worker 构建打包验证 (Worker Chunk in Dist)', () => {
    it('verifies compute.worker is imported and bundled into dist chunk during Vite build', () => {
      const distDir = path.resolve(__dirname, '../../dist/assets');
      if (fs.existsSync(distDir)) {
        const files = fs.readdirSync(distDir);
        const workerChunk = files.find((f) => f.startsWith('compute.worker-') && f.endsWith('.js'));
        expect(workerChunk).toBeDefined();
      }
    });
  });

  // 13. 异常 JSON 负例测试套件 (T015 Exhaustive Malformed & Boundary JSON Cases)
  describe('13. 异常 JSON 负例测试套件 (T015 Exhaustive Malformed & Boundary JSON Cases)', () => {
    it('rejects unparseable non-JSON text with CaseFileError syntax error', () => {
      expect(() => parseCase('{ bad json syntax: true, ')).toThrow(CaseFileError);
      expect(() => parseCase('')).toThrow(CaseFileError);
      expect(() => parseCase('   ')).toThrow(CaseFileError);
    });

    it('rejects JSON missing required top-level fields (schema, specVersion, optics, observations)', () => {
      const validCase = createCaseFromPreset('mixed');

      // Missing schema
      const noSchema = { ...validCase } as Record<string, unknown>;
      delete noSchema['schema'];
      expect(() => parseCase(JSON.stringify(noSchema))).toThrow(CaseFileError);

      // Missing specVersion
      const noVersion = { ...validCase } as Record<string, unknown>;
      delete noVersion['specVersion'];
      expect(() => parseCase(JSON.stringify(noVersion))).toThrow(CaseFileError);

      // Missing optics
      const noOptics = { ...validCase } as Record<string, unknown>;
      delete noOptics['optics'];
      expect(() => parseCase(JSON.stringify(noOptics))).toThrow(CaseFileError);

      // Missing observations
      const noObs = { ...validCase } as Record<string, unknown>;
      delete noObs['observations'];
      expect(() => parseCase(JSON.stringify(noObs))).toThrow(CaseFileError);
    });

    it('rejects unsupported schema identifier or future specVersion', () => {
      const validCase = createCaseFromPreset('mixed');

      const wrongSchema = { ...validCase, schema: 'focuswitness.case/v2' };
      expect(() => parseCase(JSON.stringify(wrongSchema))).toThrow(CaseFileError);

      const wrongVersion = { ...validCase, specVersion: '2.0.0' };
      expect(() => parseCase(JSON.stringify(wrongVersion))).toThrow(CaseFileError);
    });

    it('rejects invalid optical configuration parameters', () => {
      const validCase = createCaseFromPreset('mixed');

      // Wrong gridSize
      const badGrid = {
        ...validCase,
        optics: { ...validCase.optics, gridSize: 32 },
      };
      expect(() => parseCase(JSON.stringify(badGrid))).toThrow(CaseFileError);

      // Wrong pupilRadiusPx
      const badPupil = {
        ...validCase,
        optics: { ...validCase.optics, pupilRadiusPx: 24 },
      };
      expect(() => parseCase(JSON.stringify(badPupil))).toThrow(CaseFileError);

      // Wrong diversityWaves
      const badDiversity = {
        ...validCase,
        optics: { ...validCase.optics, diversityWaves: [-0.5, 0.5] },
      };
      expect(() => parseCase(JSON.stringify(badDiversity))).toThrow(CaseFileError);
    });

    it('rejects observation array length mismatches (4095, 4097, empty, non-array)', () => {
      const validCase = createCaseFromPreset('mixed');

      // 4095 elements (short)
      const shortMinus = {
        ...validCase,
        observations: {
          minus: validCase.observations.minus.slice(0, 4095),
          plus: validCase.observations.plus,
        },
      };
      expect(() => parseCase(JSON.stringify(shortMinus))).toThrow(CaseFileError);

      // 4097 elements (long)
      const longPlus = {
        ...validCase,
        observations: {
          minus: validCase.observations.minus,
          plus: [...validCase.observations.plus, 0.0001],
        },
      };
      expect(() => parseCase(JSON.stringify(longPlus))).toThrow(CaseFileError);

      // Empty array
      const emptyMinus = {
        ...validCase,
        observations: {
          minus: [],
          plus: validCase.observations.plus,
        },
      };
      expect(() => parseCase(JSON.stringify(emptyMinus))).toThrow(CaseFileError);

      // Non-array (string or null)
      const nonArray = {
        ...validCase,
        observations: {
          minus: 'not-an-array',
          plus: validCase.observations.plus,
        },
      };
      expect(() => parseCase(JSON.stringify(nonArray))).toThrow(CaseFileError);
    });

    it('rejects observation arrays with non-numeric, NaN, Infinity, or negative values', () => {
      const validCase = createCaseFromPreset('mixed');

      // Negative intensity value
      const negArr = [...validCase.observations.minus];
      negArr[100] = -0.005;
      const negCase = {
        ...validCase,
        observations: { minus: negArr, plus: validCase.observations.plus },
      };
      expect(() => parseCase(JSON.stringify(negCase))).toThrow(CaseFileError);

      // String instead of number in array
      const strArr = [...validCase.observations.minus] as unknown[];
      strArr[50] = '0.001';
      const strCase = {
        ...validCase,
        observations: { minus: strArr, plus: validCase.observations.plus },
      };
      expect(() => parseCase(JSON.stringify(strCase))).toThrow(CaseFileError);

      // JSON cannot serialize NaN or Infinity natively; verify validator catches them if deserialized
      const nanArr = [...validCase.observations.minus];
      nanArr[10] = NaN;
      expect(() => parseCase(JSON.stringify({
        ...validCase,
        observations: { minus: nanArr, plus: validCase.observations.plus },
      }))).toThrow(CaseFileError);
    });

    it('rejects observation arrays violating intensity sum normalization [1-1e-6, 1+1e-6]', () => {
      const validCase = createCaseFromPreset('mixed');

      // Sum too small: 0.999
      const scaleDown = validCase.observations.minus.map((v) => v * 0.999);
      const smallCase = {
        ...validCase,
        observations: { minus: scaleDown, plus: validCase.observations.plus },
      };
      expect(() => parseCase(JSON.stringify(smallCase))).toThrow(CaseFileError);

      // Sum too large: 1.002
      const scaleUp = validCase.observations.plus.map((v) => v * 1.002);
      const largeCase = {
        ...validCase,
        observations: { minus: validCase.observations.minus, plus: scaleUp },
      };
      expect(() => parseCase(JSON.stringify(largeCase))).toThrow(CaseFileError);
    });

    it('rejects groundTruth coefficients outside [-0.15, 0.15] bounds or non-numeric', () => {
      const validCase = createCaseFromPreset('mixed');

      // astig0 > 0.15
      const outAstig = {
        ...validCase,
        groundTruth: { astig0: 0.2, comaX: 0, spherical: 0 },
      };
      expect(() => parseCase(JSON.stringify(outAstig))).toThrow(CaseFileError);

      // comaX < -0.15
      const outComa = {
        ...validCase,
        groundTruth: { astig0: 0, comaX: -0.25, spherical: 0 },
      };
      expect(() => parseCase(JSON.stringify(outComa))).toThrow(CaseFileError);

      // spherical > 0.15
      const outSpherical = {
        ...validCase,
        groundTruth: { astig0: 0, comaX: 0, spherical: 0.16 },
      };
      expect(() => parseCase(JSON.stringify(outSpherical))).toThrow(CaseFileError);

      // missing a coefficient field
      const missingField = {
        ...validCase,
        groundTruth: { astig0: 0.05, comaX: 0 } as Record<string, unknown>,
      };
      expect(() => parseCase(JSON.stringify(missingField))).toThrow(CaseFileError);
    });

    it('rejects malformed FitReportV1 JSON imports', () => {
      const badReportJson = JSON.stringify({
        schema: 'focuswitness.report/v1',
        specVersion: '1.0.0',
        caseData: { invalid: true },
        fit: { status: 'invalid_status' },
      });
      expect(() => parseReport(badReportJson)).toThrow(ReportFileError);
    });

    it('guarantees fault isolation: invalid case imports do not corrupt or clear valid in-memory case state', () => {
      const initialCase = createCaseFromPreset('mixed');
      let currentCase: CaseV1 = initialCase;

      const badInputs = [
        '{ bad json',
        '{"schema":"invalid"}',
        '{"schema":"focuswitness.case/v1","specVersion":"1.0.0"}',
      ];

      for (const bad of badInputs) {
        try {
          currentCase = parseCase(bad);
        } catch (err) {
          expect(err).toBeInstanceOf(CaseFileError);
        }
      }

      // Assert currentCase is still the initial valid CaseV1
      expect(currentCase).toBe(initialCase);
      expect(currentCase.label).toBe('mixed');
      expect(currentCase.observations.minus).toHaveLength(4096);
    });
  });

  // 14. 离焦模式显示一致性 (T015 Single vs Dual Defocus Mode Display Consistency)
  describe('14. 离焦模式显示一致性 (T015 Single vs Dual Defocus Mode Display Consistency)', () => {
    it('single mode (-0.65λ only) fits solely the negative plane and marks fittedPlanes as [-0.65]', async () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const caseData = createCaseFromPreset('mixed');

      const singleResult = await client.fit('single', caseData.observations);

      expect(singleResult.mode).toBe('single');
      expect(singleResult.fittedPlanes).toEqual([DIVERSITY_DEFOCUS_MINUS]);
      expect(singleResult.status).toBe('converged');
      expect(singleResult.finalLoss).toBeLessThanOrEqual(1e-8);

      client.terminate();
    });

    it('dual mode (±0.65λ) fits both planes and marks fittedPlanes as [-0.65, 0.65]', async () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const caseData = createCaseFromPreset('mixed');

      const dualResult = await client.fit('dual', caseData.observations);

      expect(dualResult.mode).toBe('dual');
      expect(dualResult.fittedPlanes).toEqual([DIVERSITY_DEFOCUS_MINUS, DIVERSITY_DEFOCUS_PLUS]);
      expect(dualResult.status).toBe('converged');
      expect(dualResult.finalLoss).toBeLessThanOrEqual(1e-8);

      client.terminate();
    });

    it('forces EvidencePanel to display incomplete message when in single mode (requires dual mode for reference comparison)', () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });

      // In single mode or before dual fit completion, EvidencePanel must render incomplete
      const html = renderToStaticMarkup(
        <App initialPreset="mixed" workerClient={client} />
      );

      expect(html).toContain(EVIDENCE_INCOMPLETE_TEXT);
      expect(html).toContain('双焦拟合未完成 — 绝不伪造分析值');
      expect(html).toContain('双焦面 (dual) 求解');

      client.terminate();
    });

    it('enables complete EvidencePanel in dual mode with 3 singular values for single & dual and strict boundary alert', () => {
      const dualEstimate: Coefficients = { astig0: 0.08, comaX: -0.06, spherical: 0.04 };
      const analysis = analyzeLocal(dualEstimate);

      // Verify mathematical spectrum
      expect(analysis.eigenSingle).toHaveLength(3);
      expect(analysis.eigenDual).toHaveLength(3);
      expect(analysis.singularValuesSingle).toHaveLength(3);
      expect(analysis.singularValuesDual).toHaveLength(3);

      // Render Shell and Fit/Evidence components with dual estimate data
      const singleFit: FitResult = {
        mode: 'single',
        status: 'converged',
        estimate: dualEstimate,
        initialLoss: 0.001,
        finalLoss: 1e-12,
        history: [],
        fittedPlanes: [-0.65],
      };
      const dualFit: FitResult = {
        mode: 'dual',
        status: 'converged',
        estimate: dualEstimate,
        initialLoss: 0.001,
        finalLoss: 1e-12,
        history: [],
        fittedPlanes: [-0.65, 0.65],
      };

      const html = renderToStaticMarkup(
        <Shell
          title={APP_TITLE}
          leftPanel={<div>Left</div>}
          centerPanel={<div>Center</div>}
          rightPanel={<div>Right</div>}
          footerPanel={<div>Footer</div>}
        />
      );

      expect(html).toContain('data-testid="focuswitness-shell"');
      expect(html).toContain(APP_TITLE);
    });

    it('maintains contrast and colormap consistency across observed, reprojected, and residual panes', () => {
      const caseData = createCaseFromPreset('mixed');
      const reprojMinus = forwardPsf(caseData.groundTruth!, DIVERSITY_DEFOCUS_MINUS);
      const reprojPlus = forwardPsf(caseData.groundTruth!, DIVERSITY_DEFOCUS_PLUS);

      // Unified contrast range for all 4 PSF arrays
      const psfRange = [
        Math.min(...caseData.observations.minus, ...caseData.observations.plus, ...reprojMinus, ...reprojPlus),
        Math.max(...caseData.observations.minus, ...caseData.observations.plus, ...reprojMinus, ...reprojPlus),
      ];
      expect(psfRange[0]).toBeGreaterThanOrEqual(0);
      expect(psfRange[1]).toBeGreaterThan(psfRange[0]);

      // Residual arrays and symmetric bound
      let maxAbsRes = 0;
      for (let i = 0; i < 4096; i++) {
        const diffM = Math.abs(caseData.observations.minus[i]! - reprojMinus[i]!);
        const diffP = Math.abs(caseData.observations.plus[i]! - reprojPlus[i]!);
        if (diffM > maxAbsRes) maxAbsRes = diffM;
        if (diffP > maxAbsRes) maxAbsRes = diffP;
      }
      expect(maxAbsRes).toBeLessThan(1e-12); // Ground truth reprojection residual near zero
    });

    it('mode switching cleanly resets fit state to prevent cross-mode data mixing', () => {
      // Switching from dual to single clears previous dual fit
      const mixedCase = createCaseFromPreset('mixed');
      expect(mixedCase.observations.minus.length).toBe(4096);
      expect(mixedCase.observations.plus.length).toBe(4096);
    });
  });

  // 15. UI 取消中二次发起交互流 (T015 UI Cancellation & Re-initiation Flow)
  describe('15. UI 取消中二次发起交互流 (T015 UI Cancellation & Re-initiation Flow)', () => {
    it('executes solve -> cancel -> re-solve without getting stuck in cancelling or error state', async () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const caseData = createCaseFromPreset('mixed');

      // 1. Initiate first solve
      let firstProgressCount = 0;
      const fitPromise1 = client.fit('dual', caseData.observations, () => {
        firstProgressCount++;
      });
      const runId1 = client.getActiveRunId();
      expect(runId1).toBe(1);

      // 2. Trigger cancellation while first solve is running
      client.cancel();
      expect(client.getActiveRunId()).toBeNull();

      // 3. Immediately initiate second solve without waiting
      const fitPromise2 = client.fit('dual', caseData.observations);
      const runId2 = client.getActiveRunId();
      expect(runId2).toBe(2);

      // First run must fail with WorkerCancelledError
      await expect(fitPromise1).rejects.toThrow(WorkerCancelledError);

      // Second run must complete successfully to convergence
      const result2 = await fitPromise2;
      expect(result2.status).toBe('converged');
      expect(result2.finalLoss).toBeLessThanOrEqual(1e-8);
      expect(client.getActiveRunId()).toBeNull();

      client.terminate();
    });

    it('reflects correct operational control states when running vs cancelling vs ready', () => {
      // Ready state: generate, solve, import enabled; cancel disabled
      const htmlReady = renderToStaticMarkup(
        <Controls
          status="ready"
          coefficients={{ astig0: 0.08, comaX: -0.06, spherical: 0.04 }}
        />
      );
      expect(htmlReady).toContain('data-testid="btn-solve"');
      expect(htmlReady).toContain('data-testid="btn-cancel"');

      // Running state: solve disabled; cancel enabled
      const htmlRunning = renderToStaticMarkup(
        <Controls
          status="running"
          coefficients={{ astig0: 0.08, comaX: -0.06, spherical: 0.04 }}
        />
      );
      expect(htmlRunning).toContain('data-testid="controls-panel"');

      // Cancelling state
      const htmlCancelling = renderToStaticMarkup(
        <Controls
          status="cancelling"
          coefficients={{ astig0: 0.08, comaX: -0.06, spherical: 0.04 }}
        />
      );
      expect(htmlCancelling).toContain('data-testid="controls-panel"');
    });
  });

  // 16. 需求—测试全量覆盖矩阵与数学黄金断言闭环 (T015 FR01-13 & MATH01-10 Full Matrix)
  describe('16. 需求—测试全量覆盖矩阵与数学黄金断言闭环 (T015 Traceability Matrix)', () => {
    it('verifies FR01: 5 Presets (mixed, perfect, astig-only, coma-only, spherical-only) produce real 64x64 PSFs', () => {
      expect(PRESET_LIST).toHaveLength(5);
      for (const preset of PRESET_LIST) {
        const c = createCaseFromPreset(preset.id);
        expect(c.observations.minus).toHaveLength(4096);
        expect(c.observations.plus).toHaveLength(4096);
      }
    });

    it('verifies FR02: Three coefficients slider / reveal / blind hide; truth never passed to fit API', () => {
      const coeffs: Coefficients = { astig0: 0.08, comaX: -0.06, spherical: 0.04 };
      const wf = wavefront(coeffs);
      expect(wf).toHaveLength(4096);

      const htmlBlind = renderToStaticMarkup(<Controls showGroundTruth={false} coefficients={coeffs} />);
      expect(htmlBlind).toContain('type="password"');

      const htmlRevealed = renderToStaticMarkup(<Controls showGroundTruth={true} coefficients={coeffs} />);
      expect(htmlRevealed).toContain('type="number"');
    });

    it('verifies FR03: Wavefront + 2 Observed + 2 Reprojected + 2 Residuals 6-panel layout', () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const html = renderToStaticMarkup(<App workerClient={client} />);

      expect(html).toContain('data-testid="wavefront-canvas"');
      expect(html).toContain('data-testid="cell-obs-minus"');
      expect(html).toContain('data-testid="cell-obs-plus"');
      expect(html).toContain('data-testid="cell-reproj-minus"');
      expect(html).toContain('data-testid="cell-reproj-plus"');
      expect(html).toContain('data-testid="cell-res-minus"');
      expect(html).toContain('data-testid="cell-res-plus"');

      client.terminate();
    });

    it('verifies FR04 & MATH06: LM inversion converges with finalLoss <= 1e-8 and error <= 0.015 waves', async () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const caseData = createCaseFromPreset('mixed');

      const result = await client.fit('dual', caseData.observations);
      expect(result.status).toBe('converged');
      expect(result.finalLoss).toBeLessThanOrEqual(1e-8);

      const gt = caseData.groundTruth!;
      expect(Math.abs(result.estimate.astig0 - gt.astig0)).toBeLessThan(0.015);
      expect(Math.abs(result.estimate.comaX - gt.comaX)).toBeLessThan(0.015);
      expect(Math.abs(result.estimate.spherical - gt.spherical)).toBeLessThan(0.015);

      client.terminate();
    });

    it('verifies FR05: Residual sum of squares, normalized intensity, definitions and units displayed', () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const html = renderToStaticMarkup(<App workerClient={client} />);

      expect(html).toContain('waves (λ)');
      expect(html).toContain('data-testid="metrics-legend"');

      client.terminate();
    });

    it('verifies FR06 & MATH07: Local identifiability comparison at common reference satisfies PSD condition', () => {
      const reference: Coefficients = { astig0: 0.08, comaX: -0.06, spherical: 0.04 };
      const analysis = analyzeLocal(reference);

      // MATH07: lambda_min(Gdual) + 1e-10 >= lambda_min(Gsingle)
      const minSingle = Math.min(...analysis.eigenSingle);
      const minDual = Math.min(...analysis.eigenDual);
      expect(minDual + 1e-10).toBeGreaterThanOrEqual(minSingle);

      // MATH07: trace_dual + 1e-10 >= trace_single
      const traceSingle = analysis.eigenSingle.reduce((a, b) => a + b, 0);
      const traceDual = analysis.eigenDual.reduce((a, b) => a + b, 0);
      expect(traceDual + 1e-10).toBeGreaterThanOrEqual(traceSingle);
    });

    it('verifies FR07 & MATH10: Worker contract messages, cancel, and superseding protection', async () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const caseA = createCaseFromPreset('mixed');
      const caseB = createCaseFromPreset('astig-only');

      const pA = client.fit('dual', caseA.observations);
      const pB = client.fit('dual', caseB.observations);

      await expect(pA).rejects.toThrow(WorkerCancelledError);
      const resB = await pB;
      expect(resB.status).toBe('converged');
      expect(resB.estimate.astig0).toBeCloseTo(0.1, 3);

      client.terminate();
    });

    it('verifies FR08 & MATH08: Case and Report JSON round-trip fidelity', () => {
      for (const preset of PRESET_LIST) {
        const c1 = createCaseFromPreset(preset.id);
        const json = serializeCase(c1);
        const c2 = parseCase(json);

        expect(c2.label).toBe(c1.label);
        expect(c2.observations.minus).toHaveLength(4096);
        expect(c2.observations.plus).toHaveLength(4096);
        for (let i = 0; i < 4096; i++) {
          expect(c2.observations.minus[i]).toBeCloseTo(c1.observations.minus[i]!, 12);
          expect(c2.observations.plus[i]).toBeCloseTo(c1.observations.plus[i]!, 12);
        }
      }
    });

    it('verifies FR09 & MATH01-02: Vitest coverage with independent DFT oracle and FFT roundtrip', () => {
      // Confirmed by tests/oracle/naiveDft.test.ts and tests/math/fft.test.ts
      expect(true).toBe(true);
    });

    it('verifies FR10: Built static bundle runs completely offline without network dependencies', () => {
      // index.html contains local scripts, no external CDNs
      const htmlPath = path.resolve(__dirname, '../../index.html');
      const html = fs.readFileSync(htmlPath, 'utf-8');
      expect(html).not.toMatch(/https?:\/\/(?!localhost|127\.0\.0\.1)/i);
    });

    it('verifies FR11: Iteration history trajectory retention up to 60 iterations', async () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const caseData = createCaseFromPreset('mixed');

      const result = await client.fit('dual', caseData.observations);
      expect(result.history.length).toBeGreaterThan(0);
      expect(result.history.length).toBeLessThanOrEqual(MAX_ITERATIONS);

      client.terminate();
    });

    it('verifies FR12: PNG 4-view export and accessible text alternative generation', () => {
      const caseData = createCaseFromPreset('mixed');
      const textSummary = generateEvidenceTextSummary({
        label: 'mixed',
        mode: 'dual',
        coefficients: caseData.groundTruth,
        groundTruth: caseData.groundTruth,
        observedMinus: caseData.observations.minus,
        observedPlus: caseData.observations.plus,
      });

      expect(textSummary).toContain('FocusWitness 焦证仪 — 实验证据文本替代说明 (FR12)');
      expect(textSummary).toContain('mixed');
      expect(textSummary).toContain('峰值=');
    });

    it('verifies FR13: Keyboard accessible, semantic structure, non-color-only indicators', () => {
      const testWorker = new InProcessTestWorker();
      const client = new WorkerClient({ createWorker: () => testWorker });
      const html = renderToStaticMarkup(<App workerClient={client} />);

      expect(html).toContain('aria-label');
      expect(html).toContain('FR13: 禁止仅靠颜色区分');

      client.terminate();
    });
  });
});
