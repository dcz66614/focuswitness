/**
 * P007 FocusWitness — Iteration History & Trajectory Plot
 * Task: TASK-P007-T012
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, FR04, FR07, FR11, FR13
 *
 * Requirements:
 * 1. Visual distinction between accepted and rejected steps (colors, markers, ARIA)
 * 2. Step number, damping, coefficients, and unscaled loss display
 * 3. History strictly constrained to 60 steps (MAX_ITERATIONS = 60)
 * 4. Interactive iteration playback selection with keyboard accessibility
 * 5. Dual visualization: Loss & Damping trajectory vs Coefficients trajectory
 */

import React, { useState } from 'react';
import type { Coefficients, IterationRecord } from '../domain/types';
import { MAX_ITERATIONS, COEFFICIENT_MIN, COEFFICIENT_MAX } from '../domain/constants';

export interface HistoryPlotProps {
  /** Optimization iteration trajectory from Worker (constrained to <= 60 steps) */
  history?: IterationRecord[] | undefined;

  /** Currently selected iteration for playback */
  selectedIteration?: IterationRecord | null | undefined;

  /** Callback fired when user selects an iteration step */
  onSelectIteration?: ((record: IterationRecord | null) => void) | undefined;

  /** Height of SVG viewport in pixels (default: 220) */
  height?: number | undefined;

  /** Width of SVG viewport in pixels (default: 560) */
  width?: number | undefined;

  /** Unscaled initial loss for scale calibration */
  initialLoss?: number | undefined;

  /** Additional CSS class */
  className?: string | undefined;
}

export type PlotViewMode = 'loss' | 'coefficients';

/**
 * Formats a number to scientific notation with fixed precision
 */
export function formatScientific(num: number, fractionDigits = 3): string {
  if (!Number.isFinite(num)) return 'NaN';
  return num.toExponential(fractionDigits);
}

/**
 * Formats a coefficient value in waves with explicit sign and 4 decimal places
 */
export function formatCoeffWave(val: number): string {
  if (!Number.isFinite(val)) return 'NaN';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(4)} λ`;
}

export const HistoryPlot: React.FC<HistoryPlotProps> = ({
  history = [],
  selectedIteration = null,
  onSelectIteration,
  height = 220,
  width = 560,
  initialLoss,
  className = '',
}) => {
  const [viewMode, setViewMode] = useState<PlotViewMode>('loss');

  // Strict constraint: display at most 60 steps (MAX_ITERATIONS)
  const displayHistory = history.slice(0, MAX_ITERATIONS);
  const totalSteps = displayHistory.length;

  const acceptedCount = displayHistory.filter((h) => h.accepted).length;
  const rejectedCount = displayHistory.filter((h) => !h.accepted).length;

  // Chart padding
  const padLeft = 60;
  const padRight = 30;
  const padTop = 25;
  const padBottom = 35;

  const chartW = Math.max(width - padLeft - padRight, 100);
  const chartH = Math.max(height - padTop - padBottom, 80);

  // Helper to compute x coordinate for iteration index i (0 to totalSteps - 1)
  const getX = (index: number): number => {
    if (totalSteps <= 1) return padLeft + chartW / 2;
    return padLeft + (chartW * index) / (totalSteps - 1);
  };

  // Bounds for Loss (logarithmic scale)
  const allLosses = displayHistory.map((h) => h.loss);
  if (initialLoss !== undefined && Number.isFinite(initialLoss) && initialLoss > 0) {
    allLosses.push(initialLoss);
  }
  const validLosses = allLosses.filter((l) => Number.isFinite(l) && l > 0);
  const minLossVal = validLosses.length > 0 ? Math.min(...validLosses) : 1e-8;
  const maxLossVal = validLosses.length > 0 ? Math.max(...validLosses) : 1e-2;

  const minLog = Math.log10(Math.max(minLossVal, 1e-16));
  const maxLog = Math.log10(Math.max(maxLossVal, minLossVal * 10));
  const logSpan = maxLog - minLog > 1e-4 ? maxLog - minLog : 1;

  const getYLoss = (loss: number): number => {
    const safeLoss = Math.max(loss, 1e-16);
    const logL = Math.log10(safeLoss);
    const normalized = (logL - minLog) / logSpan;
    // Lower loss -> lower on screen (closer to bottom of chart)
    return padTop + chartH * (1 - Math.max(0, Math.min(1, normalized)));
  };

  // Bounds for Coefficients: fixed to domain [-0.15, +0.15] waves
  const coeffMin = COEFFICIENT_MIN; // -0.15
  const coeffMax = COEFFICIENT_MAX; // +0.15
  const coeffSpan = coeffMax - coeffMin;

  const getYCoeff = (val: number): number => {
    const clamped = Math.max(coeffMin, Math.min(coeffMax, val));
    const normalized = (clamped - coeffMin) / coeffSpan;
    return padTop + chartH * (1 - normalized);
  };

  // Generate SVG polyline points
  const lossPoints = displayHistory.map((h, i) => `${getX(i)},${getYLoss(h.loss)}`).join(' ');
  const astigPoints = displayHistory.map((h, i) => `${getX(i)},${getYCoeff(h.coefficients.astig0)}`).join(' ');
  const comaPoints = displayHistory.map((h, i) => `${getX(i)},${getYCoeff(h.coefficients.comaX)}`).join(' ');
  const sphPoints = displayHistory.map((h, i) => `${getX(i)},${getYCoeff(h.coefficients.spherical)}`).join(' ');

  const handleStepClick = (record: IterationRecord) => {
    if (selectedIteration && selectedIteration.iter === record.iter) {
      onSelectIteration?.(null); // toggle off
    } else {
      onSelectIteration?.(record);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, record: IterationRecord) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleStepClick(record);
    }
  };

  return (
    <div
      className={`fw-history-plot-card ${className}`}
      data-testid="history-plot"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        backgroundColor: 'var(--fw-surface-card)',
        border: '1px solid var(--fw-border)',
        borderRadius: 'var(--fw-radius-md)',
        padding: '12px',
      }}
    >
      {/* Top Header & View Controls */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h3
            style={{
              fontSize: '0.88rem',
              fontWeight: 600,
              color: 'var(--fw-text-main)',
              margin: 0,
            }}
          >
            迭代收敛轨迹 (LM Trajectory)
          </h3>
          <span
            className="fw-panel-badge"
            style={{ fontSize: '0.72rem' }}
            data-testid="history-step-count-badge"
          >
            {totalSteps} / {MAX_ITERATIONS} 步 (上限 60)
          </span>
        </div>

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <div
            role="group"
            aria-label="轨迹视图选择"
            style={{
              display: 'inline-flex',
              backgroundColor: 'var(--fw-surface-inset)',
              borderRadius: 'var(--fw-radius-sm)',
              padding: '2px',
            }}
          >
            <button
              type="button"
              data-testid="view-mode-loss"
              onClick={() => setViewMode('loss')}
              style={{
                background: viewMode === 'loss' ? 'var(--fw-primary)' : 'transparent',
                color: viewMode === 'loss' ? 'var(--fw-text-inverse)' : 'var(--fw-text-muted)',
                border: 'none',
                borderRadius: 'var(--fw-radius-sm)',
                padding: '3px 8px',
                fontSize: '0.72rem',
                fontWeight: viewMode === 'loss' ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              未缩放 Loss / 阻尼
            </button>
            <button
              type="button"
              data-testid="view-mode-coeff"
              onClick={() => setViewMode('coefficients')}
              style={{
                background: viewMode === 'coefficients' ? 'var(--fw-primary)' : 'transparent',
                color: viewMode === 'coefficients' ? 'var(--fw-text-inverse)' : 'var(--fw-text-muted)',
                border: 'none',
                borderRadius: 'var(--fw-radius-sm)',
                padding: '3px 8px',
                fontSize: '0.72rem',
                fontWeight: viewMode === 'coefficients' ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              像差参数轨迹 (a_j)
            </button>
          </div>
        </div>
      </div>

      {/* Trajectory Status & Legend Bar */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          fontSize: '0.75rem',
          color: 'var(--fw-text-muted)',
          borderBottom: '1px solid var(--fw-border-subtle)',
          paddingBottom: '6px',
        }}
      >
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          {/* Accepted Step Legend */}
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            title="目标函数降低，LM 接受步并更新参数"
          >
            <span
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: '#34d399',
                border: '1px solid #059669',
              }}
            />
            <strong style={{ color: '#34d399' }}>已接受 (Accepted):</strong> {acceptedCount} 步
          </span>

          {/* Rejected Step Legend */}
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            title="目标函数未降低，LM 拒绝步并增大阻尼"
          >
            <span
              style={{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                backgroundColor: '#f43f5e',
                transform: 'rotate(45deg)',
                border: '1px solid #9f1239',
              }}
            />
            <strong style={{ color: '#f43f5e' }}>已拒绝 (Rejected):</strong> {rejectedCount} 步
          </span>
        </div>

        {/* Selected iteration badge */}
        {selectedIteration ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              border: '1px solid var(--fw-primary-border)',
              borderRadius: 'var(--fw-radius-pill)',
              padding: '2px 8px',
              color: 'var(--fw-primary)',
            }}
          >
            <span>
              已选择回放：<strong>第 {selectedIteration.iter} 步</strong> (
              {selectedIteration.accepted ? '已接受' : '已拒绝'})
            </span>
            <button
              type="button"
              data-testid="btn-reset-playback-plot"
              onClick={() => onSelectIteration?.(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--fw-primary)',
                cursor: 'pointer',
                fontWeight: 'bold',
                padding: '0 2px',
              }}
              title="清除选择，返回最终结果"
            >
              ✕
            </button>
          </div>
        ) : (
          <span style={{ color: 'var(--fw-text-subtle)' }}>点击图上节点可进入迭代回放</span>
        )}
      </div>

      {/* SVG Canvas Plot */}
      {totalSteps === 0 ? (
        <div
          data-testid="history-plot-empty"
          style={{
            height: `${height}px`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px dashed var(--fw-border-subtle)',
            borderRadius: 'var(--fw-radius-sm)',
            color: 'var(--fw-text-subtle)',
            fontSize: '0.8rem',
            gap: '4px',
          }}
        >
          <span>暂无优化轨迹历史</span>
          <span style={{ fontSize: '0.72rem' }}>启动【盲解】后将实时展示最多 60 步 LM 阻尼与未缩放损失</span>
        </div>
      ) : (
        <svg
          data-testid="history-plot-svg"
          viewBox={`0 0 ${width} ${height}`}
          style={{
            width: '100%',
            height: 'auto',
            maxHeight: `${height}px`,
            overflow: 'visible',
            backgroundColor: 'var(--fw-surface-inset)',
            borderRadius: 'var(--fw-radius-sm)',
          }}
          role="img"
          aria-label={`优化历史轨迹图，展示 ${totalSteps} 步迭代，已接受 ${acceptedCount} 步，已拒绝 ${rejectedCount} 步`}
        >
          {/* Grid lines and Axes */}
          <g className="grid" stroke="var(--fw-border-subtle)" strokeWidth="0.75" strokeDasharray="3 3">
            {/* Horizontal grid lines */}
            <line x1={padLeft} y1={padTop} x2={padLeft + chartW} y2={padTop} />
            <line x1={padLeft} y1={padTop + chartH * 0.5} x2={padLeft + chartW} y2={padTop + chartH * 0.5} />
            <line x1={padLeft} y1={padTop + chartH} x2={padLeft + chartW} y2={padTop + chartH} />

            {/* Vertical zero/mid lines */}
            <line x1={padLeft} y1={padTop} x2={padLeft} y2={padTop + chartH} />
            <line x1={padLeft + chartW} y1={padTop} x2={padLeft + chartW} y2={padTop + chartH} />
          </g>

          {/* Y Axis Labels */}
          {viewMode === 'loss' ? (
            <g
              className="y-axis-labels"
              fill="var(--fw-text-subtle)"
              fontSize="9"
              fontFamily="var(--fw-font-mono)"
              textAnchor="end"
            >
              <text x={padLeft - 6} y={padTop + 4}>
                {formatScientific(maxLossVal, 1)}
              </text>
              <text x={padLeft - 6} y={padTop + chartH * 0.5 + 3}>
                {formatScientific(Math.pow(10, minLog + logSpan * 0.5), 1)}
              </text>
              <text x={padLeft - 6} y={padTop + chartH + 2}>
                {formatScientific(minLossVal, 1)}
              </text>
              <text
                x={padLeft - 22}
                y={padTop + chartH / 2}
                transform={`rotate(-90, ${padLeft - 22}, ${padTop + chartH / 2})`}
                textAnchor="middle"
                fontSize="9"
                fill="var(--fw-text-muted)"
              >
                未缩放 Loss (log10)
              </text>
            </g>
          ) : (
            <g
              className="y-axis-labels"
              fill="var(--fw-text-subtle)"
              fontSize="9"
              fontFamily="var(--fw-font-mono)"
              textAnchor="end"
            >
              <text x={padLeft - 6} y={padTop + 4}>
                +0.15λ
              </text>
              <text x={padLeft - 6} y={padTop + chartH * 0.5 + 3}>
                0.00λ
              </text>
              <text x={padLeft - 6} y={padTop + chartH + 2}>
                -0.15λ
              </text>
              <text
                x={padLeft - 22}
                y={padTop + chartH / 2}
                transform={`rotate(-90, ${padLeft - 22}, ${padTop + chartH / 2})`}
                textAnchor="middle"
                fontSize="9"
                fill="var(--fw-text-muted)"
              >
                像差系数 (Waves)
              </text>
            </g>
          )}

          {/* X Axis Labels */}
          <g
            className="x-axis-labels"
            fill="var(--fw-text-subtle)"
            fontSize="9"
            fontFamily="var(--fw-font-mono)"
            textAnchor="middle"
          >
            <text x={padLeft} y={padTop + chartH + 16}>
              #{displayHistory[0]?.iter ?? 1}
            </text>
            {totalSteps > 1 && (
              <text x={padLeft + chartW} y={padTop + chartH + 16}>
                #{displayHistory[totalSteps - 1]?.iter ?? totalSteps}
              </text>
            )}
            <text x={padLeft + chartW / 2} y={padTop + chartH + 16}>
              迭代步数 (Iter ≤ 60)
            </text>
          </g>

          {/* Trajectory Polylines */}
          {viewMode === 'loss' ? (
            <g className="loss-curves">
              {/* Main unscaled loss trajectory line */}
              <polyline
                data-testid="plot-loss-line"
                fill="none"
                stroke="var(--fw-primary)"
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                points={lossPoints}
              />
            </g>
          ) : (
            <g className="coeff-curves">
              {/* Zero reference line */}
              <line
                x1={padLeft}
                y1={getYCoeff(0)}
                x2={padLeft + chartW}
                y2={getYCoeff(0)}
                stroke="var(--fw-border)"
                strokeWidth="1"
              />

              {/* a_astig0 line (cyan) */}
              <polyline
                data-testid="plot-coeff-astig-line"
                fill="none"
                stroke="#38bdf8"
                strokeWidth="2"
                strokeLinejoin="round"
                points={astigPoints}
              />
              {/* a_comaX line (violet) */}
              <polyline
                data-testid="plot-coeff-coma-line"
                fill="none"
                stroke="#a78bfa"
                strokeWidth="2"
                strokeLinejoin="round"
                points={comaPoints}
              />
              {/* a_sph line (amber) */}
              <polyline
                data-testid="plot-coeff-sph-line"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2"
                strokeLinejoin="round"
                points={sphPoints}
              />
            </g>
          )}

          {/* Interactive Iteration Markers */}
          <g className="markers">
            {displayHistory.map((rec, i) => {
              const cx = getX(i);
              const cy = viewMode === 'loss' ? getYLoss(rec.loss) : getYCoeff(rec.coefficients.astig0);
              const isSelected = selectedIteration?.iter === rec.iter;
              const isAccepted = rec.accepted;

              return (
                <g
                  key={`step-${rec.iter}-${i}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`第 ${rec.iter} 步: 损失 ${formatScientific(rec.loss)}, 阻尼 ${formatScientific(rec.lambda)}, 状态 ${isAccepted ? '已接受' : '已拒绝'}`}
                  onClick={() => handleStepClick(rec)}
                  onKeyDown={(e) => handleKeyDown(e, rec)}
                  style={{ cursor: 'pointer', outline: 'none' }}
                  data-testid={`plot-step-node-${rec.iter}`}
                >
                  {/* Selected halo indicator */}
                  {isSelected && (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={9}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={2.5}
                      strokeDasharray="3 2"
                      data-testid="plot-marker-selected"
                    />
                  )}

                  {/* Distinct Marker: Green Circle for Accepted, Crimson Diamond for Rejected */}
                  {isAccepted ? (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={4.5}
                      fill="#34d399"
                      stroke="#059669"
                      strokeWidth={1.5}
                      data-testid="plot-marker-accepted"
                      data-accepted="true"
                    />
                  ) : (
                    <polygon
                      points={`${cx},${cy - 5} ${cx + 5},${cy} ${cx},${cy + 5} ${cx - 5},${cy}`}
                      fill="#f43f5e"
                      stroke="#881337"
                      strokeWidth={1.5}
                      data-testid="plot-marker-rejected"
                      data-accepted="false"
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      )}

      {/* Trajectory Details / Current Hovered / Selected Step Stats */}
      {selectedIteration && (
        <div
          data-testid="history-plot-selected-details"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: '8px',
            backgroundColor: 'var(--fw-surface-inset)',
            border: '1px solid var(--fw-primary-border)',
            borderRadius: 'var(--fw-radius-sm)',
            padding: '8px 10px',
            fontSize: '0.76rem',
          }}
        >
          <div>
            <span style={{ color: 'var(--fw-text-subtle)' }}>步号与判定：</span>
            <div>
              <strong>#{selectedIteration.iter}</strong>{' '}
              <span
                style={{
                  color: selectedIteration.accepted ? '#34d399' : '#f43f5e',
                  fontWeight: 600,
                }}
              >
                {selectedIteration.accepted ? '已接受 (Accepted)' : '已拒绝 (Rejected)'}
              </span>
            </div>
          </div>

          <div>
            <span style={{ color: 'var(--fw-text-subtle)' }}>未缩放 Loss：</span>
            <div style={{ fontFamily: 'var(--fw-font-mono)' }}>
              {formatScientific(selectedIteration.loss, 4)}
            </div>
          </div>

          <div>
            <span style={{ color: 'var(--fw-text-subtle)' }}>阻尼因子 λ：</span>
            <div style={{ fontFamily: 'var(--fw-font-mono)' }}>
              {formatScientific(selectedIteration.lambda, 3)}
            </div>
          </div>

          <div>
            <span style={{ color: 'var(--fw-text-subtle)' }}>参数 (astig/coma/sph)：</span>
            <div style={{ fontFamily: 'var(--fw-font-mono)', fontSize: '0.72rem' }}>
              [{selectedIteration.coefficients.astig0.toFixed(3)},{' '}
              {selectedIteration.coefficients.comaX.toFixed(3)},{' '}
              {selectedIteration.coefficients.spherical.toFixed(3)}]
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
