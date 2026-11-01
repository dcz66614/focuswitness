/**
 * P007 FocusWitness — Residual Difference Canvas Component
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, 5.3, 5.6, FR03, FR05, FR12, FR13
 * 
 * Rules:
 * - Visualizes residual difference r = I_obs - I_reproj
 * - Diverging colormap:
 *     Negative r < 0: Sky Blue (--fw-res-neg)
 *     Neutral r = 0: Grey-White
 *     Positive r > 0: Crimson Red (--fw-res-pos)
 * - FR13 requirement: Cannot rely solely on color to differentiate signs;
 *   explicit sign annotations [-], [0], [+] and scalar bounds are required.
 * - Paired residual plots share identical symmetric contrast max: [-contrastMax, +contrastMax].
 * - Strictly non-mutating: does not alter underlying Float64Array.
 * - Accessible text alternative and graceful degradation fallback.
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { FocusPlane } from '../domain/types';
import { GRID_SIZE } from '../domain/constants';

export interface ResidualStats {
  min: number;
  max: number;
  maxAbs: number;
  rms: number;
  sse: number;
}

export interface ResidualCanvasProps {
  /** 4096-element residual array (r = I_obs - I_reproj), or will be computed from observed/reprojected */
  residuals?: Float64Array | number[];
  observed?: Float64Array | number[];
  reprojected?: Float64Array | number[];
  /** Defocus diversity plane (e.g. -0.65 or +0.65 waves) */
  defocus?: FocusPlane | number;
  /** Title or label (e.g. '残差 ΔI (-0.65λ)') */
  label?: string;
  /** Common symmetric upper bound max(abs(r)) to guarantee identical contrast in paired plots */
  contrastMax?: number;
  /** Grid dimension (default: 64) */
  size?: number;
  /** Display canvas CSS width/height in pixels (default: 200) */
  displaySize?: number;
  /** Custom CSS class */
  className?: string;
  /** Whether to show stats summary footer (default: true) */
  showStats?: boolean;
}

/**
 * Computes scalar statistics (min, max, maxAbs, RMS, SSE) for residual array.
 * Strictly non-mutating.
 */
export function computeResidualStats(residuals: Float64Array | number[]): ResidualStats {
  const len = residuals.length;
  let min = Infinity;
  let max = -Infinity;
  let sumSq = 0;

  for (let i = 0; i < len; i++) {
    const val = residuals[i] ?? 0;
    if (val < min) min = val;
    if (val > max) max = val;
    sumSq += val * val;
  }

  if (len === 0 || !Number.isFinite(min)) {
    return { min: 0, max: 0, maxAbs: 0, rms: 0, sse: 0 };
  }

  const maxAbs = Math.max(Math.abs(min), Math.abs(max));
  const rms = Math.sqrt(sumSq / len);

  return { min, max, maxAbs, rms, sse: sumSq };
}

/**
 * Computes unified symmetric upper bound max(abs(r)) across multiple residual arrays
 * to guarantee identical contrast parameters in paired plots.
 */
export function computeMaxAbsResidual(
  datasets: (Float64Array | number[] | undefined | null)[]
): number {
  let globalMaxAbs = 0;

  for (const ds of datasets) {
    if (!ds || ds.length === 0) continue;
    const stats = computeResidualStats(ds);
    if (stats.maxAbs > globalMaxAbs) {
      globalMaxAbs = stats.maxAbs;
    }
  }

  return globalMaxAbs > 0 ? globalMaxAbs : 1e-6;
}

/**
 * Diverging colormap for residuals per Section 5.6 and FR13.
 * Neutral grey-white at 0, Sky Blue at -1 (Obs < Reproj), Crimson Red at +1 (Obs > Reproj).
 * t in [-1, 1]
 */
export function residualColorMap(t: number): [number, number, number] {
  const clamped = Math.max(-1, Math.min(1, t));

  // Neutral grey-white center at t = 0
  const neutralR = 225;
  const neutralG = 230;
  const neutralB = 235;

  if (clamped < 0) {
    // Negative residual: Blue / Sky (--fw-res-neg: #0284c7 -> [2, 132, 199])
    const ratio = -clamped; // 0 (center) to 1 (full negative)
    const r = Math.round(neutralR - ratio * (neutralR - 2));
    const g = Math.round(neutralG - ratio * (neutralG - 132));
    const b = Math.round(neutralB - ratio * (neutralB - 199));
    return [r, g, b];
  } else {
    // Positive residual: Crimson Red (--fw-res-pos: #e11d48 -> [225, 29, 72])
    const ratio = clamped; // 0 (center) to 1 (full positive)
    const r = Math.round(neutralR + ratio * (225 - neutralR));
    const g = Math.round(neutralG - ratio * (neutralG - 29));
    const b = Math.round(neutralB - ratio * (neutralB - 72));
    return [r, g, b];
  }
}

/**
 * Pure rendering function: draws residual difference onto a 2D canvas context.
 * Strictly non-mutating.
 */
export function drawResidualToCanvas(
  ctx: CanvasRenderingContext2D,
  residuals: Float64Array | number[],
  options?: {
    contrastMax?: number;
    gridSize?: number;
  }
): void {
  const gridSize = options?.gridSize ?? GRID_SIZE;
  const stats = computeResidualStats(residuals);
  const cMax =
    options?.contrastMax && options.contrastMax > 0
      ? options.contrastMax
      : stats.maxAbs > 0
        ? stats.maxAbs
        : 1e-6;

  const imgData = ctx.createImageData(gridSize, gridSize);
  const pixels = imgData.data;
  const len = gridSize * gridSize;

  for (let i = 0; i < len; i++) {
    const r = residuals[i] ?? 0;
    const norm = Math.max(-1, Math.min(1, r / cMax));
    const [red, green, blue] = residualColorMap(norm);

    const offset = i * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
}

export const ResidualCanvas: React.FC<ResidualCanvasProps> = ({
  residuals,
  observed,
  reprojected,
  defocus,
  label = '残差 ΔI',
  contrastMax,
  size = GRID_SIZE,
  displaySize = 200,
  className = '',
  showStats = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSupported, setCanvasSupported] = useState<boolean>(true);

  // Compute or extract residual data without mutating inputs
  const data = useMemo<Float64Array>(() => {
    if (residuals) {
      return residuals instanceof Float64Array ? residuals : new Float64Array(residuals);
    }
    if (observed && reprojected) {
      const len = size * size;
      const res = new Float64Array(len);
      for (let i = 0; i < len; i++) {
        res[i] = (observed[i] ?? 0) - (reprojected[i] ?? 0);
      }
      return res;
    }
    return new Float64Array(size * size);
  }, [residuals, observed, reprojected, size]);

  const stats = useMemo(() => computeResidualStats(data), [data]);

  const effectiveContrastMax = useMemo(() => {
    if (contrastMax && contrastMax > 0) return contrastMax;
    return stats.maxAbs > 0 ? stats.maxAbs : 1e-6;
  }, [contrastMax, stats.maxAbs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setCanvasSupported(false);
        return;
      }
      drawResidualToCanvas(ctx, data, {
        contrastMax: effectiveContrastMax,
        gridSize: size,
      });
      setCanvasSupported(true);
    } catch {
      setCanvasSupported(false);
    }
  }, [data, effectiveContrastMax, size]);

  const defocusBadge = defocus !== undefined ? (defocus > 0 ? `+${defocus}λ` : `${defocus}λ`) : null;
  const ariaDescription = `${label}，尺寸 ${size}×${size}，正负发散色标 (蓝负红正)，极大绝对误差: ${stats.maxAbs.toExponential(3)}，RMS: ${stats.rms.toExponential(3)}，标量区间: [${stats.min.toExponential(3)}, +${stats.max.toExponential(3)}]`;

  return (
    <figure
      className={`fw-canvas-card ${className}`}
      data-testid="residual-canvas-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        margin: 0,
        padding: '8px',
        backgroundColor: 'var(--fw-surface-card)',
        border: '1px solid var(--fw-border-subtle)',
        borderRadius: 'var(--fw-radius-md)',
      }}
    >
      <div
        className="fw-canvas-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'var(--fw-text-muted)',
        }}
      >
        <span data-testid="residual-label">{label}</span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {defocusBadge && (
            <span className="fw-panel-badge" data-testid="residual-defocus-badge">
              {defocusBadge}
            </span>
          )}
          {/* FR13 Diverging sign badges */}
          <span
            className="fw-res-tag-neg"
            data-testid="residual-tag-neg"
            style={{ fontSize: '0.68rem', fontWeight: 600 }}
          >
            [-] 蓝
          </span>
          <span style={{ fontSize: '0.68rem', color: 'var(--fw-text-muted)' }}>/</span>
          <span
            className="fw-res-tag-pos"
            data-testid="residual-tag-pos"
            style={{ fontSize: '0.68rem', fontWeight: 600 }}
          >
            [+] 红
          </span>
        </div>
      </div>

      <div
        className="fw-canvas-wrapper"
        style={{
          position: 'relative',
          width: displaySize,
          height: displaySize,
          margin: '0 auto',
          backgroundColor: 'var(--fw-surface-inset)',
          borderRadius: 'var(--fw-radius-sm)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          data-testid="residual-canvas"
          role="img"
          aria-label={ariaDescription}
          style={{
            width: '100%',
            height: '100%',
            imageRendering: 'pixelated',
            display: canvasSupported ? 'block' : 'none',
          }}
        />

        {!canvasSupported && (
          <div
            className="fw-canvas-fallback"
            data-testid="residual-canvas-fallback"
            role="alert"
            style={{
              padding: '12px',
              textAlign: 'center',
              fontSize: '0.75rem',
              color: 'var(--fw-text-muted)',
            }}
          >
            <p><strong>[Canvas 视图退化]</strong></p>
            <p>环境不支持 2D 画布，提供纯文本残差统计数据：</p>
            <p>极大绝对残差: {stats.maxAbs.toExponential(3)}</p>
            <p>RMS: {stats.rms.toExponential(3)} | SSE: {stats.sse.toExponential(3)}</p>
          </div>
        )}
      </div>

      {showStats && (
        <figcaption
          className="fw-canvas-stats"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            fontSize: '0.72rem',
            color: 'var(--fw-text-subtle)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: 'var(--fw-font-mono)',
            }}
          >
            <span>max(|ΔI|): {stats.maxAbs.toExponential(3)}</span>
            <span>RMS: {stats.rms.toExponential(3)}</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: 'var(--fw-font-mono)',
            }}
          >
            <span style={{ color: '#38bdf8' }}>min: {stats.min.toExponential(3)}</span>
            <span style={{ color: '#fb7185' }}>max: +{stats.max.toExponential(3)}</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.68rem',
              color: 'var(--fw-text-muted)',
            }}
          >
            <span>色标标尺: ±{effectiveContrastMax.toExponential(2)}</span>
            <span data-testid="residual-fr13-indicator">FR13 正负发散色标</span>
          </div>
        </figcaption>
      )}
    </figure>
  );
};
