/**
 * P007 FocusWitness — Inversion Control Panel & Iteration Playback
 * Task: TASK-P007-T012
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, FR04, FR07, FR11, FR13
 *
 * Requirements:
 * 1. Distinction between accepted and rejected steps (visual badges, colors, ARIA attributes)
 * 2. Display of step number, damping (lambda), coefficients (astig0, comaX, spherical), and unscaled loss
 * 3. Status termination labels:
 *    - converged -> 已收敛 (converged)
 *    - max_iterations -> 达到最大步数 (max_iterations)
 *    - stalled -> 求解停滞 (stalled)
 *    - cancelled -> 已取消 (cancelled)
 * 4. Iteration history comes genuinely from Worker via onProgress and FitResult
 * 5. Display count strictly constrained to 60 steps (MAX_ITERATIONS = 60)
 * 6. Iteration selection playback: user can inspect intermediate states without modifying final result
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  CaseV1,
  Coefficients,
  FitResult,
  FitStatus,
  IterationRecord,
  Mode,
} from '../domain/types';
import {
  MAX_ITERATIONS,
  INITIAL_COEFFICIENTS,
  COEFFICIENT_NAMES,
} from '../domain/constants';
import {
  WorkerClient,
  getWorkerClient,
  WorkerCancelledError,
  WorkerError,
} from '../worker/client';
import { HistoryPlot, formatScientific, formatCoeffWave } from './HistoryPlot';

export { HistoryPlot } from './HistoryPlot';

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

export interface FitPanelProps {
  /** Inversion mode: 'single' (-0.65λ) or 'dual' (-0.65λ, +0.65λ) */
  mode?: Mode | undefined;
  onModeChange?: ((mode: Mode) => void) | undefined;

  /** Observations for inversion (minus and plus planes, each 4096 values) */
  observations?: CaseV1['observations'] | null | undefined;

  /** WorkerClient instance (defaults to singleton client from getWorkerClient) */
  workerClient?: WorkerClient | undefined;

  /** External fit result if controlled */
  fitResult?: FitResult | null | undefined;

  /** External status override */
  status?: StatusType | FitStatus | undefined;

  /** Reference ground truth for comparison if revealed (NEVER sent to worker) */
  groundTruth?: Coefficients | null | undefined;

  /** Whether ground truth values should be revealed in UI */
  showGroundTruth?: boolean | undefined;

  /** External solving state */
  isSolving?: boolean | undefined;

  /** Callbacks */
  onSolveStart?: (() => void) | undefined;
  onSolveComplete?: ((result: FitResult) => void) | undefined;
  onSolveCancel?: (() => void) | undefined;
  onSolveError?: ((error: Error) => void) | undefined;

  /** Callback fired when an iteration step is selected for playback */
  onSelectIteration?: ((record: IterationRecord | null) => void) | undefined;

  /** Controlled selected iteration */
  selectedIteration?: IterationRecord | null | undefined;

  className?: string | undefined;
}

export const STATUS_DEFINITIONS: Record<
  StatusType,
  { label: string; badgeClass: string; color: string; desc: string }
> = {
  idle: {
    label: '待机就绪 (idle)',
    badgeClass: 'fw-status-idle',
    color: '#94a3b8',
    desc: '初值恒定为 [0, 0, 0]，等待启动盲解',
  },
  ready: {
    label: '就绪 (ready)',
    badgeClass: 'fw-status-ready',
    color: '#38bdf8',
    desc: '观测数据已就绪，可随时执行 LM 反演',
  },
  stale: {
    label: '旧拟合已失效 (stale)',
    badgeClass: 'fw-status-stale',
    color: '#fbbf24',
    desc: '观测条件已变更，当前拟合结果已失效',
  },
  running: {
    label: '正在拟合 (running)...',
    badgeClass: 'fw-status-running',
    color: '#60a5fa',
    desc: 'LM 有限差分雅可比迭代优化中...',
  },
  cancelling: {
    label: '取消中 (cancelling)...',
    badgeClass: 'fw-status-cancelled',
    color: '#f43f5e',
    desc: '正在通知 Worker 中断当前反演任务...',
  },
  converged: {
    label: '已收敛 (converged)',
    badgeClass: 'fw-status-converged',
    color: '#34d399',
    desc: '残差平方和达到精度阈值，优化成功收敛',
  },
  max_iterations: {
    label: '达到最大步数 (max_iterations)',
    badgeClass: 'fw-status-stale',
    color: '#fb923c',
    desc: '达到 60 步迭代硬上限，输出当前最优估计',
  },
  stalled: {
    label: '求解停滞 (stalled)',
    badgeClass: 'fw-status-error',
    color: '#f87171',
    desc: 'LM 阻尼达到上限，目标函数无法进一步下降',
  },
  cancelled: {
    label: '已取消 (cancelled)',
    badgeClass: 'fw-status-cancelled',
    color: '#f43f5e',
    desc: '用户主动取消当前拟合，保留已确认历史',
  },
  error: {
    label: '求解异常 (error)',
    badgeClass: 'fw-status-error',
    color: '#ef4444',
    desc: '反演计算发生异常，请检查输入或重试',
  },
};

const COEFF_LABELS: Record<
  keyof Coefficients,
  { name: string; symbol: string; formula: string }
> = {
  astig0: { name: '0° 像散', symbol: 'a_astig0', formula: 'Z22: √6(u²-v²)' },
  comaX: { name: 'x-彗差', symbol: 'a_comaX', formula: 'Z31: √8(3r²-2)u' },
  spherical: { name: '初级球差', symbol: 'a_sph', formula: 'Z40: √5(6r⁴-6r²+1)' },
};

export const FitPanel: React.FC<FitPanelProps> = ({
  mode = 'dual',
  onModeChange,
  observations,
  workerClient,
  fitResult: controlledResult,
  status: controlledStatus,
  groundTruth,
  showGroundTruth = false,
  isSolving: controlledIsSolving,
  onSolveStart,
  onSolveComplete,
  onSolveCancel,
  onSolveError,
  onSelectIteration,
  selectedIteration: controlledSelectedIter,
  className = '',
}) => {
  // Internal state for self-contained / uncontrolled operation
  const [internalResult, setInternalResult] = useState<FitResult | null>(null);
  const [internalHistory, setInternalHistory] = useState<IterationRecord[]>([]);
  const [internalStatus, setInternalStatus] = useState<StatusType>('idle');
  const [internalSelectedIter, setInternalSelectedIter] = useState<IterationRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);

  // Effective state combining controlled props and internal state
  const effectiveResult = controlledResult !== undefined ? controlledResult : internalResult;
  const effectiveStatus: StatusType =
    (controlledStatus as StatusType) ??
    (effectiveResult ? (effectiveResult.status as StatusType) : internalStatus);
  const isSolving =
    controlledIsSolving !== undefined
      ? controlledIsSolving
      : effectiveStatus === 'running' || effectiveStatus === 'cancelling';

  // Selected iteration for playback
  const selectedIter =
    controlledSelectedIter !== undefined ? controlledSelectedIter : internalSelectedIter;

  // Active history: from result if finished, otherwise from internal streaming progress
  const fullHistory = useMemo(() => {
    if (effectiveResult && effectiveResult.history && effectiveResult.history.length > 0) {
      return effectiveResult.history;
    }
    return internalHistory;
  }, [effectiveResult, internalHistory]);

  // Strict constraint: displayed history cannot exceed 60 steps
  const displayHistory = useMemo(() => {
    return fullHistory.slice(0, MAX_ITERATIONS);
  }, [fullHistory]);

  const client = useMemo(() => {
    return workerClient ?? getWorkerClient();
  }, [workerClient]);

  // Synchronize internal history when controlledResult changes
  useEffect(() => {
    if (controlledResult) {
      setInternalResult(controlledResult);
      if (controlledResult.history) {
        setInternalHistory(controlledResult.history.slice(0, MAX_ITERATIONS));
      }
    }
  }, [controlledResult]);

  const handleSelectIteration = useCallback(
    (record: IterationRecord | null) => {
      setInternalSelectedIter(record);
      onSelectIteration?.(record);
    },
    [onSelectIteration]
  );

  // Latest or displayed coefficients
  const latestRecord = displayHistory.length > 0 ? displayHistory[displayHistory.length - 1] : null;

  const currentDisplayCoeffs: Coefficients = useMemo(() => {
    // If user is playing back a historical step, show that step's coefficients
    if (selectedIter) {
      return selectedIter.coefficients;
    }
    // If solved, show estimate
    if (effectiveResult) {
      return effectiveResult.estimate;
    }
    // If currently running and has stream progress, show latest progress coefficients
    if (latestRecord) {
      return latestRecord.coefficients;
    }
    // Otherwise initial coefficients [0, 0, 0]
    return INITIAL_COEFFICIENTS;
  }, [selectedIter, effectiveResult, latestRecord]);

  // Current or displayed unscaled loss
  const currentLossDisplay = useMemo(() => {
    if (selectedIter) {
      return selectedIter.loss;
    }
    if (effectiveResult) {
      return effectiveResult.finalLoss;
    }
    if (latestRecord) {
      return latestRecord.loss;
    }
    return null;
  }, [selectedIter, effectiveResult, latestRecord]);

  // Current or displayed damping lambda
  const currentLambdaDisplay = useMemo(() => {
    if (selectedIter) {
      return selectedIter.lambda;
    }
    if (latestRecord) {
      return latestRecord.lambda;
    }
    return 1e-2; // Default initial lambda
  }, [selectedIter, latestRecord]);

  // Initial unscaled loss
  const initialLossDisplay = useMemo(() => {
    if (effectiveResult) {
      return effectiveResult.initialLoss;
    }
    const first = displayHistory[0];
    if (first) {
      return first.loss;
    }
    return null;
  }, [effectiveResult, displayHistory]);

  // Trigger blind inversion solve
  const handleSolve = async () => {
    if (!observations) {
      setErrorMessage('缺少观测数据，请先生成或导入案例');
      return;
    }

    setErrorMessage(null);
    setInternalStatus('running');
    setInternalHistory([]);
    setInternalResult(null);
    setInternalSelectedIter(null);
    onSelectIteration?.(null);
    onSolveStart?.();

    try {
      // Real progress streaming callback
      const onProgress = (record: IterationRecord) => {
        setInternalHistory((prev) => {
          if (prev.length >= MAX_ITERATIONS) {
            return prev; // Constrained to at most 60 steps
          }
          return [...prev, record];
        });
      };

      const result = await client.fit(mode, observations, onProgress);
      setActiveRunId(null);

      // Constrain history in result to 60 steps
      const constrainedResult: FitResult = {
        ...result,
        history: (result.history || []).slice(0, MAX_ITERATIONS),
      };

      setInternalResult(constrainedResult);
      setInternalStatus(constrainedResult.status as StatusType);
      onSolveComplete?.(constrainedResult);
    } catch (err) {
      if (err instanceof WorkerCancelledError) {
        setInternalStatus('cancelled');
        onSolveCancel?.();
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg);
        setInternalStatus('error');
        onSolveError?.(err instanceof Error ? err : new Error(msg));
      }
    }
  };

  // Cancel currently running inversion
  const handleCancel = () => {
    setInternalStatus('cancelling');
    client.cancel();
  };

  // Status definition config
  const statusConfig = STATUS_DEFINITIONS[effectiveStatus] || STATUS_DEFINITIONS.idle;

  // Step slider change for playback
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const stepIdx = parseInt(e.target.value, 10);
    const targetItem = displayHistory[stepIdx - 1];
    if (targetItem) {
      handleSelectIteration(targetItem);
    }
  };

  return (
    <div
      className={`fw-panel fw-fit-panel ${className}`}
      data-testid="fit-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        backgroundColor: 'var(--fw-surface)',
        border: '1px solid var(--fw-border)',
        borderRadius: 'var(--fw-radius-md)',
        padding: '14px',
      }}
    >
      {/* 1. Panel Header & Mode Selection */}
      <div
        className="fw-panel-header"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          borderBottom: '1px solid var(--fw-border)',
          paddingBottom: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2
            className="fw-panel-title"
            style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}
          >
            反演与参数估计 (Inversion)
          </h2>
          <span className="fw-panel-badge" data-testid="optimizer-badge">
            LM 优化器
          </span>
        </div>

        {/* Mode Selector (Single vs Dual) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--fw-text-muted)' }}>模式:</span>
          <div
            role="radiogroup"
            aria-label="拟合模式选择"
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--fw-surface-inset)',
              borderRadius: 'var(--fw-radius-sm)',
              padding: '2px',
            }}
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'dual'}
              data-testid="btn-mode-dual"
              disabled={isSolving}
              onClick={() => onModeChange?.('dual')}
              style={{
                background: mode === 'dual' ? 'var(--fw-primary)' : 'transparent',
                color: mode === 'dual' ? 'var(--fw-text-inverse)' : 'var(--fw-text-muted)',
                border: 'none',
                borderRadius: 'var(--fw-radius-sm)',
                padding: '3px 8px',
                fontSize: '0.72rem',
                fontWeight: mode === 'dual' ? 600 : 400,
                cursor: isSolving ? 'not-allowed' : 'pointer',
              }}
            >
              双焦面 (±0.65λ)
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'single'}
              data-testid="btn-mode-single"
              disabled={isSolving}
              onClick={() => onModeChange?.('single')}
              style={{
                background: mode === 'single' ? 'var(--fw-primary)' : 'transparent',
                color: mode === 'single' ? 'var(--fw-text-inverse)' : 'var(--fw-text-muted)',
                border: 'none',
                borderRadius: 'var(--fw-radius-sm)',
                padding: '3px 8px',
                fontSize: '0.72rem',
                fontWeight: mode === 'single' ? 600 : 400,
                cursor: isSolving ? 'not-allowed' : 'pointer',
              }}
            >
              单焦面 (-0.65λ)
            </button>
          </div>
        </div>
      </div>

      {/* 2. Status Banner & Actions */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '10px',
          backgroundColor: 'var(--fw-surface-card)',
          borderRadius: 'var(--fw-radius-sm)',
          padding: '10px 12px',
          border: '1px solid var(--fw-border-subtle)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--fw-text-muted)' }}>求解状态：</span>
            <span
              data-testid="fit-status"
              className={`fw-status-badge ${statusConfig.badgeClass}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${statusConfig.color}`,
                borderRadius: 'var(--fw-radius-pill)',
                padding: '2px 10px',
                fontSize: '0.78rem',
                fontWeight: 600,
                color: statusConfig.color,
              }}
            >
              {statusConfig.label}
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--fw-text-subtle)' }}>
            {statusConfig.desc}
          </span>
        </div>

        {/* Action Buttons: [开始盲解] [取消] */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            data-testid="btn-start-solve"
            disabled={isSolving || !observations}
            onClick={handleSolve}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: isSolving ? 'var(--fw-surface-hover)' : 'var(--fw-primary)',
              color: isSolving ? 'var(--fw-text-muted)' : 'var(--fw-text-inverse)',
              border: 'none',
              borderRadius: 'var(--fw-radius-sm)',
              padding: '6px 14px',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: isSolving || !observations ? 'not-allowed' : 'pointer',
              boxShadow: 'var(--fw-shadow-sm)',
            }}
          >
            {isSolving ? '优化计算中...' : '开始盲解 (Solve)'}
          </button>

          {isSolving && (
            <button
              type="button"
              data-testid="btn-cancel-solve"
              onClick={handleCancel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                backgroundColor: 'rgba(244, 63, 94, 0.15)',
                color: '#f43f5e',
                border: '1px solid #f43f5e',
                borderRadius: 'var(--fw-radius-sm)',
                padding: '6px 12px',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              取消 (Cancel)
            </button>
          )}
        </div>
      </div>

      {/* Error Banner if any */}
      {errorMessage && (
        <div
          data-testid="fit-error-message"
          role="alert"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #ef4444',
            borderRadius: 'var(--fw-radius-sm)',
            padding: '8px 12px',
            color: '#fca5a5',
            fontSize: '0.78rem',
          }}
        >
          <strong>错误：</strong> {errorMessage}
        </div>
      )}

      {/* 3. Parameter Estimates Table */}
      <div
        data-testid="fit-estimates-container"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--fw-text-main)' }}>
            像差系数估计 (Coefficients)
            {selectedIter && (
              <span
                style={{
                  marginLeft: '8px',
                  color: 'var(--fw-primary)',
                  fontSize: '0.72rem',
                  fontWeight: 400,
                }}
              >
                [回放第 #{selectedIter.iter} 步]
              </span>
            )}
          </span>
          <span style={{ fontSize: '0.72rem', color: 'var(--fw-text-subtle)' }}>
            量纲单位：波长 (λ)
          </span>
        </div>

        <table
          className="fw-est-table"
          data-testid="fit-estimates-table"
          aria-label="像差系数估计值与真值对比"
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.78rem',
            backgroundColor: 'var(--fw-surface-card)',
            borderRadius: 'var(--fw-radius-sm)',
            overflow: 'hidden',
          }}
        >
          <thead>
            <tr style={{ backgroundColor: 'var(--fw-surface-inset)', borderBottom: '1px solid var(--fw-border)' }}>
              <th scope="col" style={{ padding: '6px 8px', textAlign: 'left' }}>像差模式</th>
              <th scope="col" style={{ padding: '6px 8px', textAlign: 'right' }}>
                {selectedIter ? `回放值 (#${selectedIter.iter})` : '当前估计'}
              </th>
              <th scope="col" style={{ padding: '6px 8px', textAlign: 'right' }}>
                参考真值 {showGroundTruth ? '' : '(隐藏)'}
              </th>
              {showGroundTruth && (
                <th scope="col" style={{ padding: '6px 8px', textAlign: 'right' }}>绝对误差 |Δ|</th>
              )}
            </tr>
          </thead>
          <tbody>
            {COEFFICIENT_NAMES.map((key) => {
              const meta = COEFF_LABELS[key];
              const estVal = currentDisplayCoeffs[key];
              const gtVal = groundTruth ? groundTruth[key] : null;
              const hasGt = showGroundTruth && gtVal !== null && gtVal !== undefined;
              const absErr = hasGt ? Math.abs(estVal - gtVal) : null;

              return (
                <tr
                  key={key}
                  data-testid={`row-coeff-${key}`}
                  style={{ borderBottom: '1px solid var(--fw-border-subtle)' }}
                >
                  <td style={{ padding: '6px 8px' }}>
                    <strong>{meta.name}</strong>{' '}
                    <span style={{ color: 'var(--fw-text-subtle)', fontSize: '0.72rem' }}>
                      ({meta.symbol})
                    </span>
                  </td>
                  <td
                    data-testid={`val-estimate-${key}`}
                    style={{
                      padding: '6px 8px',
                      fontFamily: 'var(--fw-font-mono)',
                      textAlign: 'right',
                      color: 'var(--fw-primary)',
                      fontWeight: 600,
                    }}
                  >
                    {formatCoeffWave(estVal)}
                  </td>
                  <td
                    data-testid={`val-truth-${key}`}
                    style={{
                      padding: '6px 8px',
                      fontFamily: 'var(--fw-font-mono)',
                      textAlign: 'right',
                      color: hasGt ? 'var(--fw-text-main)' : 'var(--fw-text-subtle)',
                    }}
                  >
                    {hasGt ? formatCoeffWave(gtVal) : '— (盲解保密)'}
                  </td>
                  {showGroundTruth && (
                    <td
                      data-testid={`val-error-${key}`}
                      style={{
                        padding: '6px 8px',
                        fontFamily: 'var(--fw-font-mono)',
                        textAlign: 'right',
                        color: absErr !== null && absErr < 0.005 ? '#34d399' : '#fb923c',
                      }}
                    >
                      {absErr !== null ? `${absErr.toFixed(4)} λ` : '—'}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 4. Loss & Damping Metrics Box */}
      <div
        data-testid="fit-metrics"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '8px',
          backgroundColor: 'var(--fw-surface-inset)',
          border: '1px solid var(--fw-border-subtle)',
          borderRadius: 'var(--fw-radius-sm)',
          padding: '10px',
          fontSize: '0.78rem',
        }}
      >
        {/* Step count */}
        <div>
          <span style={{ color: 'var(--fw-text-subtle)', fontSize: '0.72rem' }}>当前步数 (步号)：</span>
          <div style={{ fontWeight: 600, fontSize: '0.85rem' }} data-testid="metric-step-number">
            #{selectedIter ? selectedIter.iter : latestRecord ? latestRecord.iter : 0} / {MAX_ITERATIONS} 步
          </div>
        </div>

        {/* Step Acceptance */}
        <div>
          <span style={{ color: 'var(--fw-text-subtle)', fontSize: '0.72rem' }}>步判定状态：</span>
          <div data-testid="metric-step-acceptance">
            {selectedIter ? (
              <span
                style={{
                  color: selectedIter.accepted ? '#34d399' : '#f43f5e',
                  fontWeight: 600,
                }}
              >
                {selectedIter.accepted ? '已接受 (Accepted)' : '已拒绝 (Rejected)'}
              </span>
            ) : latestRecord ? (
              <span
                style={{
                  color: latestRecord.accepted ? '#34d399' : '#f43f5e',
                  fontWeight: 600,
                }}
              >
                {latestRecord.accepted ? '已接受 (Accepted)' : '已拒绝 (Rejected)'}
              </span>
            ) : (
              <span style={{ color: 'var(--fw-text-subtle)' }}>未启动</span>
            )}
          </div>
        </div>

        {/* Unscaled Loss */}
        <div>
          <span style={{ color: 'var(--fw-text-subtle)', fontSize: '0.72rem' }}>
            未缩放残差平方和 (Loss)：
          </span>
          <div
            data-testid="metric-unscaled-loss"
            style={{
              fontFamily: 'var(--fw-font-mono)',
              fontWeight: 600,
              color: 'var(--fw-text-main)',
            }}
          >
            {currentLossDisplay !== null ? formatScientific(currentLossDisplay, 4) : '—'}
          </div>
        </div>

        {/* Damping Lambda */}
        <div>
          <span style={{ color: 'var(--fw-text-subtle)', fontSize: '0.72rem' }}>阻尼因子 (λ_LM)：</span>
          <div
            data-testid="metric-damping-lambda"
            style={{
              fontFamily: 'var(--fw-font-mono)',
              fontWeight: 600,
              color: 'var(--fw-text-main)',
            }}
          >
            {formatScientific(currentLambdaDisplay, 3)}
          </div>
        </div>
      </div>

      {/* 5. Iteration Playback Controls Bar */}
      {displayHistory.length > 0 && (
        <div
          data-testid="fit-playback-bar"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            backgroundColor: 'var(--fw-surface-card)',
            border: selectedIter ? '1px solid var(--fw-primary-border)' : '1px solid var(--fw-border-subtle)',
            borderRadius: 'var(--fw-radius-sm)',
            padding: '10px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>迭代历史回放 (Playback)</span>
              <span
                style={{
                  fontSize: '0.72rem',
                  backgroundColor: 'var(--fw-surface-inset)',
                  padding: '2px 6px',
                  borderRadius: 'var(--fw-radius-sm)',
                  color: 'var(--fw-text-muted)',
                }}
              >
                第 {selectedIter ? selectedIter.iter : displayHistory.length} 步 (共 {displayHistory.length} 步)
              </span>
            </div>

            {selectedIter && (
              <button
                type="button"
                data-testid="btn-exit-playback"
                onClick={() => handleSelectIteration(null)}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid var(--fw-primary-border)',
                  borderRadius: 'var(--fw-radius-sm)',
                  padding: '3px 8px',
                  color: 'var(--fw-primary)',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                }}
              >
                返回最新估计 (Reset to Latest)
              </button>
            )}
          </div>

            {/* Scrubber slider & step buttons */}
            {(() => {
              const firstItem = displayHistory[0];
              const lastItem = displayHistory[displayHistory.length - 1];
              const isFirstSelected = Boolean(firstItem && selectedIter && selectedIter.iter <= firstItem.iter);
              const isLastSelected = Boolean(!selectedIter || (lastItem && selectedIter.iter >= lastItem.iter));

              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    data-testid="btn-playback-prev"
                    disabled={displayHistory.length === 0 || isFirstSelected}
                    onClick={() => {
                      const currentIdx = selectedIter
                        ? displayHistory.findIndex((h) => h.iter === selectedIter.iter)
                        : displayHistory.length - 1;
                      if (currentIdx > 0) {
                        const prevItem = displayHistory[currentIdx - 1];
                        if (prevItem) {
                          handleSelectIteration(prevItem);
                        }
                      }
                    }}
                    style={{
                      backgroundColor: 'var(--fw-surface-inset)',
                      border: '1px solid var(--fw-border)',
                      borderRadius: 'var(--fw-radius-sm)',
                      padding: '4px 8px',
                      color: 'var(--fw-text-main)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                    aria-label="回放上一步"
                  >
                    ◀ 上一步
                  </button>

                  <input
                    type="range"
                    data-testid="playback-slider"
                    min={1}
                    max={displayHistory.length}
                    value={
                      selectedIter
                        ? displayHistory.findIndex((h) => h.iter === selectedIter.iter) + 1
                        : displayHistory.length
                    }
                    onChange={handleSliderChange}
                    style={{ flex: 1, accentColor: 'var(--fw-primary)', cursor: 'pointer' }}
                    aria-label="迭代历史回放滑动条"
                  />

                  <button
                    type="button"
                    data-testid="btn-playback-next"
                    disabled={displayHistory.length === 0 || isLastSelected}
                    onClick={() => {
                      if (!selectedIter) return;
                      const currentIdx = displayHistory.findIndex((h) => h.iter === selectedIter.iter);
                      if (currentIdx >= 0 && currentIdx < displayHistory.length - 1) {
                        const nextItem = displayHistory[currentIdx + 1];
                        if (nextItem) {
                          handleSelectIteration(nextItem);
                        }
                      }
                    }}
                    style={{
                      backgroundColor: 'var(--fw-surface-inset)',
                      border: '1px solid var(--fw-border)',
                      borderRadius: 'var(--fw-radius-sm)',
                      padding: '4px 8px',
                      color: 'var(--fw-text-main)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                    aria-label="回放下一步"
                  >
                    下一步 ▶
                  </button>
                </div>
              );
            })()}

          <div style={{ fontSize: '0.7rem', color: 'var(--fw-text-subtle)' }}>
            注：选择历史迭代仅回放历史参数对应的中间态重投影，绝不变更最终结果与参数估计。
          </div>
        </div>
      )}

      {/* 6. History Trajectory Plot (HistoryPlot) */}
      <HistoryPlot
        history={displayHistory}
        selectedIteration={selectedIter}
        onSelectIteration={handleSelectIteration}
        initialLoss={initialLossDisplay ?? undefined}
        height={210}
      />

      {/* 7. Detailed History Table (<= 60 steps) */}
      {displayHistory.length > 0 && (
        <details
          style={{
            backgroundColor: 'var(--fw-surface-card)',
            border: '1px solid var(--fw-border-subtle)',
            borderRadius: 'var(--fw-radius-sm)',
            padding: '8px 10px',
            fontSize: '0.76rem',
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              fontWeight: 600,
              color: 'var(--fw-text-muted)',
              userSelect: 'none',
            }}
          >
            查看历史迭代数据表 ({displayHistory.length} 步记录)
          </summary>

          <div
            style={{
              maxHeight: '220px',
              overflowY: 'auto',
              marginTop: '8px',
              border: '1px solid var(--fw-border-subtle)',
              borderRadius: 'var(--fw-radius-sm)',
            }}
          >
            <table
              data-testid="fit-history-table"
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.72rem',
                fontFamily: 'var(--fw-font-mono)',
              }}
            >
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--fw-surface-inset)',
                    position: 'sticky',
                    top: 0,
                    borderBottom: '1px solid var(--fw-border)',
                  }}
                >
                  <th style={{ padding: '4px 6px', textAlign: 'left' }}>步号</th>
                  <th style={{ padding: '4px 6px', textAlign: 'center' }}>判定</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>未缩放 Loss</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>阻尼 λ</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>估计 [astig, coma, sph]</th>
                  <th style={{ padding: '4px 6px', textAlign: 'center' }}>回放</th>
                </tr>
              </thead>
              <tbody>
                {displayHistory.map((rec) => {
                  const isSelected = selectedIter?.iter === rec.iter;
                  const isAccepted = rec.accepted;

                  return (
                    <tr
                      key={`hist-row-${rec.iter}`}
                      data-testid={`history-table-row-${rec.iter}`}
                      data-status={isAccepted ? 'accepted' : 'rejected'}
                      data-accepted={isAccepted ? 'true' : 'false'}
                      style={{
                        backgroundColor: isSelected
                          ? 'rgba(56, 189, 248, 0.12)'
                          : isAccepted
                          ? 'transparent'
                          : 'rgba(244, 63, 94, 0.04)',
                        borderBottom: '1px solid var(--fw-border-subtle)',
                      }}
                    >
                      <td style={{ padding: '4px 6px' }}>#{rec.iter}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <span
                          data-testid={`badge-status-${rec.iter}`}
                          style={{
                            display: 'inline-block',
                            padding: '1px 5px',
                            borderRadius: 'var(--fw-radius-sm)',
                            backgroundColor: isAccepted ? 'rgba(52, 211, 153, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                            color: isAccepted ? '#34d399' : '#f43f5e',
                            fontWeight: 600,
                            fontSize: '0.68rem',
                          }}
                        >
                          {isAccepted ? '已接受' : '已拒绝'}
                        </span>
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                        {formatScientific(rec.loss, 4)}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                        {formatScientific(rec.lambda, 2)}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                        [{rec.coefficients.astig0.toFixed(3)}, {rec.coefficients.comaX.toFixed(3)},{' '}
                        {rec.coefficients.spherical.toFixed(3)}]
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        <button
                          type="button"
                          data-testid={`btn-select-iter-${rec.iter}`}
                          onClick={() => handleSelectIteration(rec)}
                          style={{
                            background: isSelected ? 'var(--fw-primary)' : 'transparent',
                            color: isSelected ? 'var(--fw-text-inverse)' : 'var(--fw-primary)',
                            border: '1px solid var(--fw-primary-border)',
                            borderRadius: 'var(--fw-radius-sm)',
                            padding: '1px 6px',
                            fontSize: '0.65rem',
                            cursor: 'pointer',
                          }}
                        >
                          {isSelected ? '回放中' : '选择'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* Panel Footer */}
      <div
        className="fw-panel-footer"
        style={{
          borderTop: '1px solid var(--fw-border-subtle)',
          paddingTop: '8px',
          fontSize: '0.72rem',
          color: 'var(--fw-text-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>盲解初值恒定为 [0, 0, 0]，真值绝不传入拟合算法；历史上限 60 步。</span>
      </div>
    </div>
  );
};
