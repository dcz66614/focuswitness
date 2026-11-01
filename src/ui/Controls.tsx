/**
 * P007 FocusWitness — Experiment Controls Component
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, FR01, FR02, FR13
 * 
 * Features:
 * - FR01: 5 Presets (mixed, perfect, astig-only, coma-only, spherical-only)
 * - FR02: Aberration sliders + number inputs in [-0.15, 0.15] waves (Z22, Z31, Z40)
 * - FR02: Ground truth visibility toggle (show / blind solve hide)
 * - Mode selection: Single-plane (-0.65) vs Dual-plane (-0.65, +0.65)
 * - Action buttons: [造像], [盲解], [取消], [导入], [导出]
 * - Status hints and badges (IDLE, STALE, RUNNING, CONVERGED, CANCELLED, etc.)
 * - Keyboard navigable with visible focus states and ARIA semantics
 */

import React from 'react';
import type { Coefficients, Mode, PresetId } from '../domain/types';
import {
  COEFFICIENT_MIN,
  COEFFICIENT_MAX,
  COEFFICIENT_NAMES,
  DEFAULT_PRESET_ID,
} from '../domain/constants';
import { PRESET_LIST, PRESETS } from '../domain/presets';

export type StatusType =
  | 'idle'
  | 'ready'
  | 'stale'
  | 'running'
  | 'cancelling'
  | 'converged'
  | 'max_iterations'
  | 'stalled'
  | 'cancelled'
  | 'error';

export interface ControlsProps {
  currentPreset?: PresetId;
  onPresetChange?: (presetId: PresetId) => void;
  mode?: Mode;
  onModeChange?: (mode: Mode) => void;
  coefficients?: Coefficients;
  onCoefficientChange?: (key: keyof Coefficients, value: number) => void;
  showGroundTruth?: boolean;
  onToggleGroundTruth?: (show: boolean) => void;
  status?: StatusType;
  statusMessage?: string;
  onGenerate?: () => void;
  onSolve?: () => void;
  onCancel?: () => void;
  onImport?: (file: File) => void;
  onExport?: () => void;
  isGenerating?: boolean;
  isSolving?: boolean;
  className?: string;
}

const DEFAULT_COEFFS: Coefficients = {
  astig0: 0.08,
  comaX: -0.06,
  spherical: 0.04,
};

const STATUS_LABELS: Record<StatusType, { label: string; className: string }> = {
  idle: { label: '待机就绪', className: 'fw-status-idle' },
  ready: { label: '就绪', className: 'fw-status-ready' },
  stale: { label: '旧拟合已失效 (STALE)', className: 'fw-status-stale' },
  running: { label: '计算中...', className: 'fw-status-running' },
  cancelling: { label: '取消中...', className: 'fw-status-cancelled' },
  converged: { label: '已收敛', className: 'fw-status-converged' },
  max_iterations: { label: '达到最大步数', className: 'fw-status-stale' },
  stalled: { label: '求解停滞', className: 'fw-status-error' },
  cancelled: { label: '已取消', className: 'fw-status-cancelled' },
  error: { label: '求解异常', className: 'fw-status-error' },
};

const COEFF_LABELS: Record<keyof Coefficients, { name: string; symbol: string; formula: string }> = {
  astig0: { name: '0° 像散', symbol: 'a_astig0', formula: 'Z22: √6(u²-v²)' },
  comaX: { name: 'x-彗差', symbol: 'a_comaX', formula: 'Z31: √8(3r²-2)u' },
  spherical: { name: '初级球差', symbol: 'a_sph', formula: 'Z40: √5(6r⁴-6r²+1)' },
};

export const Controls: React.FC<ControlsProps> = ({
  currentPreset = DEFAULT_PRESET_ID,
  onPresetChange,
  mode = 'dual',
  onModeChange,
  coefficients = DEFAULT_COEFFS,
  onCoefficientChange,
  showGroundTruth = true,
  onToggleGroundTruth,
  status = 'idle',
  statusMessage,
  onGenerate,
  onSolve,
  onCancel,
  onImport,
  onExport,
  isGenerating = false,
  isSolving = false,
  className = '',
}) => {
  const isBusy = isGenerating || isSolving || status === 'running' || status === 'cancelling';

  const handlePresetSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as PresetId;
    if (onPresetChange) {
      onPresetChange(val);
    }
  };

  const handleSliderChange = (key: keyof Coefficients, valStr: string) => {
    if (!showGroundTruth) return;
    const num = parseFloat(valStr);
    if (!Number.isNaN(num) && onCoefficientChange) {
      const clamped = Math.max(COEFFICIENT_MIN, Math.min(COEFFICIENT_MAX, num));
      onCoefficientChange(key, clamped);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0 && onImport) {
      const file = files[0];
      if (file) {
        onImport(file);
      }
    }
    // Clear input value so re-selecting same file triggers change
    e.target.value = '';
  };

  const statusMeta = STATUS_LABELS[status] ?? STATUS_LABELS.idle;

  return (
    <div className={`fw-panel fw-controls-panel ${className}`} data-testid="controls-panel">
      {/* Hidden file input for importing cases */}
      <input
        id="file-import-input"
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label="导入案例文件"
        data-testid="file-import-input"
        disabled={isBusy}
        onChange={handleFileInputChange}
      />

      <div className="fw-panel-header">
        <h2 className="fw-panel-title">
          <span>实验控制面板</span>
        </h2>
        <div
          className={`fw-status-badge ${statusMeta.className}`}
          role="status"
          aria-live="polite"
          data-testid="status-badge"
        >
          <span className="fw-status-badge-dot" aria-hidden="true" />
          <span>{statusMeta.label}</span>
        </div>
      </div>

      <div className="fw-panel-body">
        {/* Status prompt / notification */}
        {status === 'stale' && (
          <div className="fw-info-box fw-info-box-stale" role="alert" data-testid="stale-alert">
            <strong>提示：</strong>真值系数已更新，当前观测 PSF 与拟合结果已标为 STALE。请点击<strong>[造像]</strong>生成新观测。
          </div>
        )}

        {statusMessage && (
          <div className="fw-info-box" role="status" data-testid="status-message">
            {statusMessage}
          </div>
        )}

        {/* Section 4.1 Primary Actions Bar */}
        <div className="fw-field-group">
          <div className="fw-field-label">
            <span>核心操作</span>
            <span className="fw-field-desc">造像与盲解求解</span>
          </div>
          <div className="fw-header-actions" style={{ gap: '8px' }}>
            <button
              type="button"
              className="fw-btn fw-btn-primary"
              onClick={onGenerate}
              disabled={isBusy}
              aria-label="造像：根据真值计算新观测PSF"
              data-testid="btn-generate"
            >
              <span>{isGenerating ? '正在造像...' : '造像 (生成观测)'}</span>
            </button>

            <button
              type="button"
              className="fw-btn fw-btn-primary"
              style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}
              onClick={onSolve}
              disabled={isBusy}
              aria-label="盲解：从零初值[0,0,0]启动LM拟合"
              data-testid="btn-solve"
            >
              <span>{isSolving ? '求解中...' : '盲解 (LM反演)'}</span>
            </button>

            <button
              type="button"
              className="fw-btn fw-btn-danger"
              onClick={onCancel}
              disabled={!isBusy}
              aria-label="取消当前计算任务"
              data-testid="btn-cancel"
            >
              <span>取消</span>
            </button>

            <label
              htmlFor="file-import-input"
              className={`fw-btn ${isBusy ? 'disabled' : ''}`}
              role="button"
              tabIndex={isBusy ? -1 : 0}
              aria-label="导入实验案例 JSON 文件"
              data-testid="btn-import"
            >
              <span>导入</span>
            </label>

            <button
              type="button"
              className="fw-btn"
              onClick={onExport}
              disabled={isBusy}
              aria-label="导出当前案例或结果 JSON"
              data-testid="btn-export"
            >
              <span>导出</span>
            </button>
          </div>
        </div>

        {/* FR01: Preset Selection */}
        <div className="fw-field-group">
          <label htmlFor="preset-select" className="fw-field-label">
            <span>预设像差场景 (FR01)</span>
            <span className="fw-field-desc">5 个冻结预设</span>
          </label>
          <select
            id="preset-select"
            className="fw-select"
            value={currentPreset}
            onChange={handlePresetSelect}
            disabled={isBusy}
            aria-label="预设像差场景选择"
            data-testid="preset-select"
          >
            {PRESET_LIST.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label} — {preset.purpose}
              </option>
            ))}
          </select>
          <div className="fw-field-desc" style={{ marginTop: '2px' }}>
            当前预设：<strong>{PRESETS[currentPreset]?.label ?? currentPreset}</strong> (
            {PRESETS[currentPreset]?.purpose ?? ''})
          </div>
        </div>

        {/* Mode Selection: Single vs Dual */}
        <div className="fw-field-group">
          <div className="fw-field-label">
            <span>反演模式 (Mode)</span>
            <span className="fw-field-desc">焦面多样性配置</span>
          </div>
          <div
            className="fw-pill-group"
            role="radiogroup"
            aria-label="反演模式选择：单焦面或双焦面"
            data-testid="mode-selector"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'single'}
              className={`fw-pill-btn ${mode === 'single' ? 'active' : ''}`}
              onClick={() => onModeChange?.('single')}
              disabled={isBusy}
              data-testid="mode-single-btn"
            >
              单焦模式 (-0.65λ)
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'dual'}
              className={`fw-pill-btn ${mode === 'dual' ? 'active' : ''}`}
              onClick={() => onModeChange?.('dual')}
              disabled={isBusy}
              data-testid="mode-dual-btn"
            >
              双焦模式 (±0.65λ)
            </button>
          </div>
          <div className="fw-field-desc" style={{ marginTop: '2px' }}>
            {mode === 'single'
              ? '单焦模式：仅利用负多样性平面 (-0.65 waves) 拟合'
              : '双焦模式：联合负平面 (-0.65 waves) 与正平面 (+0.65 waves) 拟合'}
          </div>
        </div>

        {/* FR02: Ground Truth Visibility Toggle */}
        <div className="fw-field-group">
          <div className="fw-field-label">
            <span>真值可见性开关 (FR02)</span>
            <span className="fw-field-desc">盲解防偷窥安全</span>
          </div>
          <label className="fw-switch-label">
            <span>{showGroundTruth ? '已显示真值参数' : '盲解模式 (真值已隐藏)'}</span>
            <span className="fw-switch">
              <input
                type="checkbox"
                checked={showGroundTruth}
                onChange={(e) => onToggleGroundTruth?.(e.target.checked)}
                disabled={isBusy}
                aria-label="切换真值参数显示与隐藏"
                data-testid="toggle-ground-truth"
              />
              <span className="fw-switch-slider" />
            </span>
          </label>
          {!showGroundTruth && (
            <div className="fw-info-box fw-info-box-blind" data-testid="blind-mode-notice">
              <strong>盲解模式生效：</strong>真值像差参数已被隐藏。求解算法从零初值 [0, 0, 0] 启动，且真值严禁传入求解 API。
            </div>
          )}
        </div>

        {/* FR02: 3 Aberration Coefficients Sliders and Inputs */}
        <fieldset
          className="fw-field-group"
          style={{ border: 'none', padding: 0, margin: 0 }}
          disabled={isBusy}
        >
          <legend className="fw-field-label" style={{ marginBottom: '6px' }}>
            <span>真值像差参数 (波长 waves, 范围 [-0.15, +0.15])</span>
          </legend>

          {COEFFICIENT_NAMES.map((name) => {
            const meta = COEFF_LABELS[name];
            const val = coefficients[name] ?? 0;
            const inputId = `coeff-slider-${name}`;
            const numId = `coeff-num-${name}`;
            const sliderVal = showGroundTruth ? val : 0;

            return (
              <div key={name} className="fw-field-group" style={{ marginBottom: '8px' }}>
                <div className="fw-field-label">
                  <label htmlFor={inputId}>
                    <strong>{meta.name}</strong> <code>{meta.symbol}</code>
                  </label>
                  <span className="fw-field-desc">{meta.formula}</span>
                </div>

                <div className="fw-slider-row">
                  <input
                    id={inputId}
                    type="range"
                    min={COEFFICIENT_MIN}
                    max={COEFFICIENT_MAX}
                    step={0.005}
                    value={sliderVal}
                    onChange={(e) => handleSliderChange(name, e.target.value)}
                    className="fw-slider"
                    aria-label={`${meta.name} 滑杆`}
                    aria-valuemin={COEFFICIENT_MIN}
                    aria-valuemax={COEFFICIENT_MAX}
                    aria-valuenow={sliderVal}
                    disabled={isBusy || !showGroundTruth}
                    data-testid={`slider-${name}`}
                  />
                  <input
                    id={numId}
                    type={showGroundTruth ? 'number' : 'password'}
                    min={COEFFICIENT_MIN}
                    max={COEFFICIENT_MAX}
                    step={0.005}
                    value={showGroundTruth ? val.toFixed(3) : '***'}
                    onChange={(e) => handleSliderChange(name, e.target.value)}
                    className="fw-num-input"
                    aria-label={`${meta.name} 精确数值输入`}
                    disabled={!showGroundTruth}
                    data-testid={`input-${name}`}
                  />
                </div>
              </div>
            );
          })}
        </fieldset>
      </div>

      <div className="fw-panel-footer">
        <span>FocusWitness 光学参数：N=64, R=16px, 离焦多样性 d=±0.65λ</span>
      </div>
    </div>
  );
};
