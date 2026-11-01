/**
 * P007 FocusWitness — Main Application Component
 * Task: TASK-P007-T014
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, 5.1-5.6, 6.1-6.5, FR01-FR13
 *
 * Integrated Business Flows:
 * 1. 造像 (Generate): Worker-driven forward simulation from true coefficients into CaseV1.
 * 2. 盲解 (Blind solve): LM inversion from [0,0,0], streaming progress, zero groundTruth leakage.
 * 3. 模式切换 (Mode toggle): Single (-0.65λ) vs Dual (±0.65λ); switching clears old fits.
 * 4. 回放 (Playback): Inspect intermediate steps with reprojected PSF/residuals without mutating final fit.
 * 5. 取消 (Cancel): Timely event loop interruption in Worker, clean cancellation state.
 * 6. 揭示真值 (Reveal truth): Switchable blind mode masking/unmasking.
 * 7. JSON / PNG 输出 (Export): Strictly validated v1 case/report JSON and composite canvas PNG.
 * 8. 切案例不留旧 fit: Switching preset/import immediately clears old fit/analysis data.
 * 9. 主视图无 fake timer: Strictly event and promise driven computation.
 * 10. Worker chunk: Explicitly imports compute worker client for Vite chunk bundling.
 */

import React, { useState, useMemo, useCallback } from 'react';
import type {
  CaseV1,
  Coefficients,
  FitReportV1,
  FitResult,
  FocusPlane,
  InformationSpectrum,
  IterationRecord,
  Mode,
  PresetId,
} from './domain/types';
import {
  DEFAULT_PRESET_ID,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
  INITIAL_COEFFICIENTS,
  MAX_IMPORT_FILE_SIZE_BYTES,
  MAX_ITERATIONS,
} from './domain/constants';
import { PRESETS } from './domain/presets';
import {
  createCaseFromPreset,
  parseCase,
  serializeCase,
  CaseFileError,
} from './io/caseFile';
import {
  createFitReport,
  parseReport,
  serializeReport,
  ReportFileError,
} from './io/reportFile';
import {
  renderEvidenceToCanvas,
  downloadPng,
  generateEvidenceTextSummary,
  type EvidenceExportData,
} from './io/exportPng';
import { forwardPsf } from './math/psf';
import { wavefront } from './math/zernike';
import { analyzeLocal } from './math/identifiable';
import { Shell } from './ui/Shell';
import { Controls, type StatusType } from './ui/Controls';
import { MetricsLegend } from './ui/MetricsLegend';
import { WavefrontCanvas } from './ui/WavefrontCanvas';
import { PsfsCanvas, computeCombinedPsfRange } from './ui/PsfsCanvas';
import { ResidualCanvas, computeMaxAbsResidual } from './ui/ResidualCanvas';
import { FitPanel } from './ui/FitPanel';
import { EvidencePanel } from './ui/EvidencePanel';
import {
  WorkerClient,
  getWorkerClient,
  WorkerCancelledError,
} from './worker/client';

export const APP_TITLE = 'P007 焦证仪 FocusWitness';

export interface AppProps {
  /** Optional custom worker client (e.g. for testing) */
  workerClient?: WorkerClient;
  /** Initial preset ID */
  initialPreset?: PresetId;
  /** Whether to show ground truth initially */
  defaultShowGroundTruth?: boolean;
  /** Optional initial case data (e.g. for testing or imported case preloading) */
  initialCase?: CaseV1;
}

/**
 * Triggers browser download of a text or JSON file.
 */
function downloadTextFile(content: string, filename: string, mimeType = 'application/json'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function App({
  workerClient: injectedWorkerClient,
  initialPreset = DEFAULT_PRESET_ID,
  defaultShowGroundTruth = false,
  initialCase,
}: AppProps = {}) {
  // Concurrency Client (single dedicated Web Worker instance)
  const effectiveWorkerClient = useMemo(() => {
    return injectedWorkerClient ?? getWorkerClient();
  }, [injectedWorkerClient]);

  // Optical and Case State
  const [currentPreset, setCurrentPreset] = useState<PresetId>(() => {
    if (initialCase) {
      return (initialCase.label as PresetId) ?? ('custom' as PresetId);
    }
    return initialPreset;
  });
  const [caseData, setCaseData] = useState<CaseV1>(() => initialCase ?? createCaseFromPreset(initialPreset));
  const [coefficients, setCoefficients] = useState<Coefficients>(() => {
    return initialCase?.groundTruth ?? caseData.groundTruth ?? PRESETS[initialPreset]?.coefficients ?? INITIAL_COEFFICIENTS;
  });

  // Solver and UI Modes
  const [mode, setMode] = useState<Mode>('dual');
  const [showGroundTruth, setShowGroundTruth] = useState<boolean>(defaultShowGroundTruth);
  const [psfScale, setPsfScale] = useState<'log' | 'linear'>('log');

  // Status and Operational Flags
  const [status, setStatus] = useState<StatusType>('ready');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isSolving, setIsSolving] = useState<boolean>(false);

  // Inversion Results & Iteration Playback
  const [fitResult, setFitResult] = useState<FitResult | null>(null);
  const [dualFitResult, setDualFitResult] = useState<FitResult | null>(null);
  const [history, setHistory] = useState<IterationRecord[]>([]);
  const [selectedIteration, setSelectedIteration] = useState<IterationRecord | null>(null);
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);

  const isBusy = isGenerating || isSolving || status === 'running' || status === 'cancelling';

  // Active or displayed coefficients (playback vs final estimate vs initial)
  const displayCoefficients: Coefficients = useMemo(() => {
    if (selectedIteration) {
      return selectedIteration.coefficients;
    }
    if (fitResult) {
      return fitResult.estimate;
    }
    const lastRecord = history[history.length - 1];
    if (lastRecord) {
      return lastRecord.coefficients;
    }
    return INITIAL_COEFFICIENTS;
  }, [selectedIteration, fitResult, history]);

  // Reprojected PSFs at display coefficients (pure Fraunhofer forward model)
  const { reprojectedMinus, reprojectedPlus } = useMemo(() => {
    const minus = forwardPsf(displayCoefficients, DIVERSITY_DEFOCUS_MINUS);
    const plus = forwardPsf(displayCoefficients, DIVERSITY_DEFOCUS_PLUS);
    return { reprojectedMinus: minus, reprojectedPlus: plus };
  }, [displayCoefficients]);

  // Unified contrast range for all 4 PSF plots
  const sharedPsfRange = useMemo<[number, number]>(() => {
    return computeCombinedPsfRange([
      caseData.observations.minus,
      caseData.observations.plus,
      reprojectedMinus,
      reprojectedPlus,
    ]);
  }, [caseData.observations.minus, caseData.observations.plus, reprojectedMinus, reprojectedPlus]);

  // Residual difference arrays
  const { residualMinus, residualPlus } = useMemo(() => {
    const len = caseData.observations.minus.length;
    const resM = new Float64Array(len);
    const resP = new Float64Array(len);
    for (let i = 0; i < len; i++) {
      resM[i] = (caseData.observations.minus[i] ?? 0) - (reprojectedMinus[i] ?? 0);
      resP[i] = (caseData.observations.plus[i] ?? 0) - (reprojectedPlus[i] ?? 0);
    }
    return { residualMinus: resM, residualPlus: resP };
  }, [caseData.observations.minus, caseData.observations.plus, reprojectedMinus, reprojectedPlus]);

  // Unified symmetric upper bound for paired residual plots
  const sharedResMax = useMemo<number>(() => {
    return computeMaxAbsResidual([residualMinus, residualPlus]);
  }, [residualMinus, residualPlus]);

  // 1. Preset Change ("切案例不留旧 fit")
  const handlePresetChange = useCallback((presetId: PresetId) => {
    if (isBusy) return;
    setCurrentPreset(presetId);
    const nextCase = createCaseFromPreset(presetId);
    setCaseData(nextCase);
    if (nextCase.groundTruth) {
      setCoefficients(nextCase.groundTruth);
    }
    // Strict contract: Switch case leaves NO old fit or analysis data
    setFitResult(null);
    setDualFitResult(null);
    setSelectedIteration(null);
    setHistory([]);
    setStatus('ready');
    setStatusMessage(`已切换至预设像差场景：${nextCase.label ?? presetId}`);
  }, [isBusy]);

  // 2. Coefficient Change (Sliders / Numeric inputs)
  const handleCoefficientChange = useCallback((key: keyof Coefficients, val: number) => {
    if (isBusy) return;
    setCoefficients((prev) => ({ ...prev, [key]: val }));
    setCurrentPreset('custom' as PresetId);
    // Mark old fit as STALE until user generates new observations
    setStatus('stale');
    setFitResult(null);
    setDualFitResult(null);
    setSelectedIteration(null);
    setHistory([]);
    setStatusMessage('真值系数已变更，当前拟合结果已标为 STALE。请点击 [造像] 生成新观测。');
  }, [isBusy]);

  // 3. Mode Toggle (Single vs Dual)
  const handleModeChange = useCallback((newMode: Mode) => {
    if (isBusy) return;
    setMode(newMode);
    // Switch mode clears current mode's fit
    setFitResult(null);
    setSelectedIteration(null);
    setHistory([]);
    setStatus('ready');
    setStatusMessage(
      `已切换至${newMode === 'dual' ? '双焦模式 (±0.65λ)' : '单焦模式 (-0.65λ)'}，请点击 [盲解] 求解。`
    );
  }, [isBusy]);

  // 4. Generate Observations (造像)
  const handleGenerate = useCallback(async () => {
    if (isBusy) return;
    setIsGenerating(true);
    setStatus('running');
    setStatusMessage('正在由 Dedicated Web Worker 执行正向造像计算...');

    try {
      const generated = await effectiveWorkerClient.generate(coefficients);
      setCaseData(generated);
      // Clean previous fit when new observations are generated
      setFitResult(null);
      setDualFitResult(null);
      setSelectedIteration(null);
      setHistory([]);
      setStatus('ready');
      setStatusMessage('造像完成：新观测焦面光强数据已生成就绪。');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus('error');
      setStatusMessage(`造像失败: ${msg}`);
    } finally {
      setIsGenerating(false);
    }
  }, [isBusy, coefficients, effectiveWorkerClient]);

  // 5. Blind Inversion Solve (盲解)
  const handleSolve = useCallback(async () => {
    if (isBusy || !caseData) return;
    setIsSolving(true);
    setStatus('running');
    setStatusMessage('LM 盲解反演中（启动初值固定为 [0, 0, 0]，绝不传入真值）...');
    setSelectedIteration(null);
    setHistory([]);
    setFitResult(null);

    try {
      const onProgress = (record: IterationRecord) => {
        setHistory((prev) => {
          if (prev.length >= MAX_ITERATIONS) return prev;
          return [...prev, record];
        });
      };

      const result = await effectiveWorkerClient.fit(mode, caseData.observations, onProgress);
      const constrainedResult: FitResult = {
        ...result,
        history: (result.history || []).slice(0, MAX_ITERATIONS),
      };

      setFitResult(constrainedResult);
      if (mode === 'dual') {
        setDualFitResult(constrainedResult);
      }
      setStatus(constrainedResult.status as StatusType);
      setStatusMessage(
        `反演结束：状态=${constrainedResult.status}，最终 Loss=${constrainedResult.finalLoss.toExponential(4)}`
      );
    } catch (err) {
      if (err instanceof WorkerCancelledError) {
        setStatus('cancelled');
        setStatusMessage('反演计算已由用户主动取消。');
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus('error');
        setStatusMessage(`反演求解失败: ${msg}`);
      }
    } finally {
      setIsSolving(false);
    }
  }, [isBusy, caseData, effectiveWorkerClient, mode]);

  // 6. Cancel Active Computation (取消)
  const handleCancel = useCallback(() => {
    if (isBusy) {
      setStatus('cancelling');
      setStatusMessage('正在向 Worker 发送取消指令并让出事件循环...');
      effectiveWorkerClient.cancel();
    }
  }, [isBusy, effectiveWorkerClient]);

  // 7. Case / Report File Import (导入)
  const handleImportFile = useCallback((file: File) => {
    if (isBusy) return;

    if (file.size > MAX_IMPORT_FILE_SIZE_BYTES) {
      setStatus('error');
      setStatusMessage(
        `导入失败：文件大小 (${(file.size / 1024 / 1024).toFixed(2)} MiB) 超过 2 MiB 安全限制`
      );
      return;
    }

    const processImportedText = (text: string) => {
      try {
        let importedCase: CaseV1;
        if (text.includes('"focuswitness.report/v1"')) {
          const report = parseReport(text);
          importedCase = report.caseData;
        } else {
          importedCase = parseCase(text);
        }

        setCaseData(importedCase);
        if (importedCase.groundTruth) {
          setCoefficients(importedCase.groundTruth);
        }
        // Strict requirement (FIX-R1-B001): External case imports must keep ground truth
        // hidden until the user actively toggles the visibility switch.
        setShowGroundTruth(false);

        setCurrentPreset((importedCase.label as PresetId) ?? ('custom' as PresetId));

        // Strict contract: 切案例不留旧 fit
        setFitResult(null);
        setDualFitResult(null);
        setSelectedIteration(null);
        setHistory([]);
        setStatus('ready');
        setStatusMessage(`成功导入案例：${importedCase.label ?? '自定义导入案例'}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus('error');
        setStatusMessage(`导入校验失败: ${msg}（原有良好数据已受保护保留）`);
      }
    };

    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text !== 'string') {
          setStatus('error');
          setStatusMessage('无法读取文件文本内容');
          return;
        }
        processImportedText(text);
      };

      reader.onerror = () => {
        setStatus('error');
        setStatusMessage('文件读取发生底层错误');
      };

      reader.readAsText(file);
    } else if (typeof (file as any).text === 'function') {
      (file as any)
        .text()
        .then((text: string) => {
          processImportedText(text);
        })
        .catch(() => {
          setStatus('error');
          setStatusMessage('文件读取发生底层错误');
        });
    }
  }, [isBusy]);

  // 8. JSON Export (导出)
  const handleExportJson = useCallback(() => {
    try {
      if (fitResult) {
        let informationSpectrum: InformationSpectrum | undefined = undefined;
        if (dualFitResult && dualFitResult.status !== 'cancelled') {
          const local = analyzeLocal(dualFitResult.estimate);
          informationSpectrum = local;
        }

        const report = createFitReport(caseData, fitResult, informationSpectrum);
        const json = serializeReport(report);
        downloadTextFile(
          json,
          `focuswitness-report-${fitResult.mode}-${Date.now()}.json`,
          'application/json'
        );
      } else {
        const json = serializeCase(caseData);
        downloadTextFile(
          json,
          `focuswitness-case-${caseData.label ?? 'custom'}.json`,
          'application/json'
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`导出 JSON 失败: ${msg}`);
    }
  }, [caseData, fitResult, dualFitResult]);

  // Helper to build export data adhering to exactOptionalPropertyTypes
  const buildEvidenceData = useCallback((): EvidenceExportData => {
    const data: EvidenceExportData = {
      mode,
      coefficients: displayCoefficients,
      wavefront: wavefront(displayCoefficients),
      observedMinus: caseData.observations.minus,
      observedPlus: caseData.observations.plus,
      reprojectedMinus,
      reprojectedPlus,
      residualMinus,
      residualPlus,
    };

    if (caseData.label) {
      data.label = caseData.label;
    }
    if (showGroundTruth && caseData.groundTruth) {
      data.groundTruth = caseData.groundTruth;
    }
    if (fitResult) {
      data.loss = fitResult.finalLoss;
    }
    const runId = effectiveWorkerClient.getActiveRunId();
    if (runId !== null) {
      data.runId = runId;
    }

    return data;
  }, [
    caseData,
    mode,
    displayCoefficients,
    showGroundTruth,
    reprojectedMinus,
    reprojectedPlus,
    residualMinus,
    residualPlus,
    fitResult,
    effectiveWorkerClient,
  ]);

  // 9. PNG Export (导出复合证据画布)
  const handleExportPng = useCallback(() => {
    try {
      const data = buildEvidenceData();
      const canvas = renderEvidenceToCanvas(data, {
        scale: psfScale,
        title: `FocusWitness 证据矩阵导出 [${caseData.label ?? '自定义'}]`,
      });

      downloadPng(canvas, `focuswitness-evidence-${Date.now()}.png`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusMessage(`导出 PNG 失败: ${msg}`);
    }
  }, [buildEvidenceData, caseData.label, psfScale]);

  // 10. Accessible Summary Copy (FR12)
  const handleCopySummary = useCallback(async () => {
    const data = buildEvidenceData();
    const summary = generateEvidenceTextSummary(data);

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(summary);
        setCopiedSummary(true);
        setTimeout(() => setCopiedSummary(false), 3000);
      } catch {
        // Fallback alert
      }
    }
  }, [buildEvidenceData]);

  // Header Slot Actions and Info
  const headerSlot = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--fw-text-muted)' }}>快速预设:</span>
        <select
          value={currentPreset}
          onChange={(e) => handlePresetChange(e.target.value as PresetId)}
          disabled={isBusy}
          className="fw-select"
          style={{ padding: '2px 8px', fontSize: '0.78rem', minWidth: '120px' }}
          aria-label="顶部快捷预设选择"
        >
          {Object.keys(PRESETS).map((pId) => (
            <option key={pId} value={pId}>
              {PRESETS[pId as PresetId]?.label ?? pId}
            </option>
          ))}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        <button
          type="button"
          className="fw-btn fw-btn-primary"
          style={{ padding: '3px 10px', fontSize: '0.78rem' }}
          onClick={handleGenerate}
          disabled={isBusy}
          aria-label="造像"
        >
          造像
        </button>
        <button
          type="button"
          className="fw-btn fw-btn-primary"
          style={{
            padding: '3px 10px',
            fontSize: '0.78rem',
            backgroundColor: '#10b981',
            borderColor: '#10b981',
          }}
          onClick={handleSolve}
          disabled={isBusy}
          aria-label="盲解"
        >
          盲解
        </button>
        <button
          type="button"
          className="fw-btn fw-btn-danger"
          style={{ padding: '3px 8px', fontSize: '0.78rem' }}
          onClick={handleCancel}
          disabled={!isBusy}
          aria-label="取消计算"
        >
          取消
        </button>
      </div>
    </div>
  );

  // Left Slot: Experiment Controls, Wavefront Canvas, and Zernike Legend
  const leftSlot = (
    <>
      <Controls
        currentPreset={currentPreset}
        onPresetChange={handlePresetChange}
        mode={mode}
        onModeChange={handleModeChange}
        coefficients={coefficients}
        onCoefficientChange={handleCoefficientChange}
        showGroundTruth={showGroundTruth}
        onToggleGroundTruth={setShowGroundTruth}
        status={status}
        {...(statusMessage ? { statusMessage } : {})}
        onGenerate={handleGenerate}
        onSolve={handleSolve}
        onCancel={handleCancel}
        onImport={handleImportFile}
        onExport={handleExportJson}
        isGenerating={isGenerating}
        isSolving={isSolving}
      />
      <WavefrontCanvas
        coefficients={showGroundTruth ? coefficients : (displayCoefficients ?? INITIAL_COEFFICIENTS)}
        title="光瞳像差波前图 W(u,v)"
        subtitle={showGroundTruth ? '当前真实光瞳波前分布' : '当前估计/重投影光瞳波前分布'}
      />
      <MetricsLegend />
    </>
  );

  // Center Slot: Full Evidence Matrix with real Canvas views
  const centerSlot = (
    <div className="fw-panel fw-evidence-matrix" data-testid="evidence-matrix">
      <div className="fw-panel-header">
        <h2 className="fw-panel-title">
          <span>证据矩阵 (Evidence Matrix)</span>
        </h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="fw-panel-badge">64×64 统一分辨率</span>
          <button
            type="button"
            className="fw-btn fw-btn-sm"
            data-testid="toggle-psf-scale"
            onClick={() => setPsfScale((prev) => (prev === 'log' ? 'linear' : 'log'))}
            style={{ fontSize: '0.72rem', padding: '2px 8px' }}
          >
            显示标度: {psfScale === 'log' ? '对数 log10(I+1e-8)' : '线性 (Linear)'}
          </button>
          <button
            type="button"
            className="fw-btn fw-btn-sm"
            data-testid="btn-export-matrix-png"
            onClick={handleExportPng}
            style={{ fontSize: '0.72rem', padding: '2px 8px' }}
          >
            导出矩阵 PNG
          </button>
        </div>
      </div>

      <div className="fw-panel-body">
        <p className="fw-field-desc">
          同屏并置观测光强、当前参数重投影光强及二者带符号差值残差，保证相同物理分辨率与统一色标标度。
        </p>

        <div className="fw-matrix-grid">
          {/* Row 1: Observed PSFs */}
          <div className="fw-matrix-cell" data-testid="cell-obs-minus">
            <div className="fw-matrix-cell-header">
              <span>观测焦面 I_obs ({DIVERSITY_DEFOCUS_MINUS}λ)</span>
              <span className="fw-panel-badge">离焦 -0.65</span>
            </div>
            <PsfsCanvas
              intensity={caseData.observations.minus}
              defocus={-0.65}
              label={`观测焦面 I_obs (${DIVERSITY_DEFOCUS_MINUS}λ)`}
              scale={psfScale}
              contrastRange={sharedPsfRange}
              displaySize={160}
            />
          </div>

          <div className="fw-matrix-cell" data-testid="cell-obs-plus">
            <div className="fw-matrix-cell-header">
              <span>观测焦面 I_obs (+{DIVERSITY_DEFOCUS_PLUS}λ)</span>
              <span className="fw-panel-badge">离焦 +0.65</span>
            </div>
            <PsfsCanvas
              intensity={caseData.observations.plus}
              defocus={0.65}
              label={`观测焦面 I_obs (+${DIVERSITY_DEFOCUS_PLUS}λ)`}
              scale={psfScale}
              contrastRange={sharedPsfRange}
              displaySize={160}
            />
          </div>

          {/* Row 2: Reprojected PSFs */}
          <div className="fw-matrix-cell" data-testid="cell-reproj-minus">
            <div className="fw-matrix-cell-header">
              <span>重投影 I_mod ({DIVERSITY_DEFOCUS_MINUS}λ)</span>
              <span className="fw-panel-badge">
                {selectedIteration ? `第 ${selectedIteration.iter} 步` : '当前估计'}
              </span>
            </div>
            <PsfsCanvas
              intensity={reprojectedMinus}
              defocus={-0.65}
              label={`重投影 I_mod (${DIVERSITY_DEFOCUS_MINUS}λ)`}
              scale={psfScale}
              contrastRange={sharedPsfRange}
              displaySize={160}
            />
          </div>

          <div className="fw-matrix-cell" data-testid="cell-reproj-plus">
            <div className="fw-matrix-cell-header">
              <span>重投影 I_mod (+{DIVERSITY_DEFOCUS_PLUS}λ)</span>
              <span className="fw-panel-badge">
                {mode === 'single'
                  ? '单焦未参与拟合(仅供对照)'
                  : selectedIteration
                    ? `第 ${selectedIteration.iter} 步`
                    : '当前估计'}
              </span>
            </div>
            <PsfsCanvas
              intensity={reprojectedPlus}
              defocus={0.65}
              label={`重投影 I_mod (+${DIVERSITY_DEFOCUS_PLUS}λ)`}
              scale={psfScale}
              contrastRange={sharedPsfRange}
              displaySize={160}
            />
          </div>

          {/* Row 3: Residual Heatmaps */}
          <div className="fw-matrix-cell" data-testid="cell-res-minus">
            <div className="fw-matrix-cell-header">
              <span>残差 ΔI ({DIVERSITY_DEFOCUS_MINUS}λ)</span>
              <span className="fw-res-tag-neg">[-] 蓝 / [+] 红</span>
            </div>
            <ResidualCanvas
              residuals={residualMinus}
              defocus={-0.65}
              label={`残差 ΔI (${DIVERSITY_DEFOCUS_MINUS}λ)`}
              contrastMax={sharedResMax}
              displaySize={160}
            />
          </div>

          <div className="fw-matrix-cell" data-testid="cell-res-plus">
            <div className="fw-matrix-cell-header">
              <span>残差 ΔI (+{DIVERSITY_DEFOCUS_PLUS}λ)</span>
              <span className="fw-res-tag-pos">[-] 蓝 / [+] 红</span>
            </div>
            <ResidualCanvas
              residuals={residualPlus}
              defocus={0.65}
              label={`残差 ΔI (+${DIVERSITY_DEFOCUS_PLUS}λ)`}
              contrastMax={sharedResMax}
              displaySize={160}
            />
          </div>
        </div>
      </div>

      <div className="fw-panel-footer">
        <span>
          残差标量极值说明：所有残差热图均标注标量数值范围，不单依赖伪彩色区分（FR13：统一蓝(-)红(+)发散标度）。
        </span>
      </div>
    </div>
  );

  // Right Slot: Inversion FitPanel and Identifiability EvidencePanel
  const isDualComplete =
    dualFitResult !== null &&
    (dualFitResult.status === 'converged' ||
      dualFitResult.status === 'max_iterations' ||
      dualFitResult.status === 'stalled');

  const rightSlot = (
    <>
      <FitPanel
        mode={mode}
        onModeChange={handleModeChange}
        observations={caseData.observations}
        workerClient={effectiveWorkerClient}
        fitResult={fitResult}
        status={status}
        groundTruth={caseData.groundTruth}
        showGroundTruth={showGroundTruth}
        isSolving={isSolving}
        onSolveStart={() => {
          setIsSolving(true);
          setStatus('running');
          setStatusMessage('LM 反演计算中...');
          setSelectedIteration(null);
          setHistory([]);
        }}
        onSolveComplete={(result) => {
          setIsSolving(false);
          setFitResult(result);
          if (mode === 'dual') {
            setDualFitResult(result);
          }
          setStatus(result.status as StatusType);
          setStatusMessage(
            `反演完成：状态=${result.status}，最终 Loss=${result.finalLoss.toExponential(4)}`
          );
        }}
        onSolveCancel={() => {
          setIsSolving(false);
          setStatus('cancelled');
          setStatusMessage('反演计算已由用户取消。');
        }}
        onSolveError={(err) => {
          setIsSolving(false);
          setStatus('error');
          setStatusMessage(`反演失败: ${err.message}`);
        }}
        onSelectIteration={setSelectedIteration}
        selectedIteration={selectedIteration}
      />

      <EvidencePanel
        mode={mode}
        dualFitResult={dualFitResult}
        isDualFitComplete={isDualComplete}
        reference={dualFitResult?.estimate}
        observations={caseData.observations}
      />
    </>
  );

  // Bottom Slot: Audit Notes, Action Shortcuts, Accessible Text Alternative
  const bottomSlot = (
    <footer className="fw-footer" role="contentinfo" data-testid="shell-footer">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '8px',
        }}
      >
        <div className="fw-footer-notes">
          <strong>P007 焦证仪 (FocusWitness) 物理学简化说明：</strong>
          <span>
            单色标量远场 Fraunhofer 衍射模型；圆孔径无中心遮挡；已知固定离焦 ±0.65 waves；3 阶像差估计范围 [-0.15, +0.15] waves。
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="fw-btn fw-btn-sm"
            data-testid="btn-export-json"
            onClick={handleExportJson}
          >
            导出 JSON {fitResult ? '报告' : '案例'}
          </button>
          <button
            type="button"
            className="fw-btn fw-btn-sm"
            data-testid="btn-export-png"
            onClick={handleExportPng}
          >
            导出全景证据 PNG
          </button>
          <button
            type="button"
            className="fw-btn fw-btn-sm"
            data-testid="btn-copy-summary"
            onClick={handleCopySummary}
          >
            {copiedSummary ? '已复制文字摘要' : '复制图像无障碍文本替代'}
          </button>
        </div>
      </div>

      <div style={{ fontSize: '0.72rem', color: 'var(--fw-text-subtle)', textAlign: 'right' }}>
        <span>
          FocusWitness 生产集成架构 | 纯本地离线样式 | 单 Dedicated Web Worker 并发 (无 fake timer)
        </span>
      </div>
    </footer>
  );

  return (
    <Shell
      title={APP_TITLE}
      subtitle="双焦面像差反演与局部可辨识性实验室"
      status={status}
      headerSlot={headerSlot}
      leftSlot={leftSlot}
      centerSlot={centerSlot}
      rightSlot={rightSlot}
      bottomSlot={bottomSlot}
    />
  );
}

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe('P007-T001 skeleton smoke test', () => {
    it('exports valid application placeholder title', () => {
      expect(APP_TITLE).toBe('P007 焦证仪 FocusWitness');
    });

    it('verifies Node 24 runtime environment', () => {
      const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
      expect(major).toBe(24);
    });
  });
}
