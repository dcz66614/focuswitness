/**
 * P007 FocusWitness — PSF Intensity Canvas Component
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, 5.2, 5.6, FR03, FR05, FR12, FR13
 * 
 * Rules:
 * - Visualizes 64×64 PSF intensity distribution
 * - Default display transform: log10(max(I, 0) + 1e-8)
 * - Explicit visual indication of log scale: "log10(I + 1e-8)" (FR03/FR05)
 * - Paired comparison plots share identical contrast parameters [min, max]
 * - Strictly non-mutating: does not alter underlying Float64Array intensity values
 * - Full text alternative and accessible fallback when canvas is unsupported
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { FocusPlane } from '../domain/types';
import { GRID_SIZE } from '../domain/constants';

export interface PsfStats {
  min: number;
  max: number;
  peak: number;
  peakIndex: number;
  peakX: number;
  peakY: number;
  totalSum: number;
}

export interface PsfsCanvasProps {
  /** 4096-element intensity array */
  intensity: Float64Array | number[];
  /** Defocus diversity plane (e.g. -0.65 or +0.65 waves) */
  defocus?: FocusPlane | number;
  /** Title or label (e.g. '观测焦面 I_obs (-0.65λ)') */
  label?: string;
  /** Display scale mode: 'log' (default: log10(I + 1e-8)) or 'linear' */
  scale?: 'log' | 'linear';
  /** External fixed contrast bounds [min, max] to guarantee identical contrast across paired plots */
  contrastRange?: [number, number];
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
 * Computes raw physical scalar statistics for PSF intensity.
 * Strictly non-mutating.
 */
export function computePsfStats(
  intensity: Float64Array | number[],
  gridSize = GRID_SIZE
): PsfStats {
  const len = intensity.length;
  let min = Infinity;
  let max = -Infinity;
  let peak = -Infinity;
  let peakIndex = 0;
  let totalSum = 0;

  for (let i = 0; i < len; i++) {
    const val = intensity[i] ?? 0;
    if (val < min) min = val;
    if (val > max) max = val;
    if (val > peak) {
      peak = val;
      peakIndex = i;
    }
    totalSum += val;
  }

  const peakY = Math.floor(peakIndex / gridSize);
  const peakX = peakIndex % gridSize;

  return {
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    peak: Number.isFinite(peak) ? peak : 0,
    peakIndex,
    peakX,
    peakY,
    totalSum,
  };
}

/**
 * Computes display bounds [min, max] under the selected scale transform.
 */
export function computePsfDisplayRange(
  intensity: Float64Array | number[],
  scale: 'log' | 'linear' = 'log'
): [number, number] {
  const len = intensity.length;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < len; i++) {
    const raw = intensity[i] ?? 0;
    const v = scale === 'log' ? Math.log10(Math.max(raw, 0) + 1e-8) : Math.max(raw, 0);
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (!Number.isFinite(min)) min = scale === 'log' ? -8 : 0;
  if (!Number.isFinite(max) || max === min) max = min + 1e-4;

  return [min, max];
}

/**
 * Computes unified contrast bounds [min, max] across multiple PSF arrays
 * to guarantee identical contrast parameters in paired plots.
 */
export function computeCombinedPsfRange(
  datasets: (Float64Array | number[])[],
  scale: 'log' | 'linear' = 'log'
): [number, number] {
  let globalMin = Infinity;
  let globalMax = -Infinity;

  for (const ds of datasets) {
    if (!ds || ds.length === 0) continue;
    const [dMin, dMax] = computePsfDisplayRange(ds, scale);
    if (dMin < globalMin) globalMin = dMin;
    if (dMax > globalMax) globalMax = dMax;
  }

  if (!Number.isFinite(globalMin)) globalMin = scale === 'log' ? -8 : 0;
  if (!Number.isFinite(globalMax) || globalMax === globalMin) globalMax = globalMin + 1e-4;

  return [globalMin, globalMax];
}

/**
 * High-contrast perceptual colormap for PSF intensities (Magma/Inferno style).
 * t in [0, 1]
 */
export function psfColorMap(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t));

  if (c <= 0.25) {
    // 0.0 to 0.25: deep dark navy to purple
    const rRatio = c / 0.25;
    const r = Math.round(11 + rRatio * (70 - 11));
    const g = Math.round(15 + rRatio * (18 - 15));
    const b = Math.round(23 + rRatio * (95 - 23));
    return [r, g, b];
  } else if (c <= 0.5) {
    // 0.25 to 0.5: purple to red-violet
    const rRatio = (c - 0.25) / 0.25;
    const r = Math.round(70 + rRatio * (182 - 70));
    const g = Math.round(18 + rRatio * (35 - 18));
    const b = Math.round(95 + rRatio * (85 - 95));
    return [r, g, b];
  } else if (c <= 0.75) {
    // 0.5 to 0.75: red-violet to bright orange
    const rRatio = (c - 0.5) / 0.25;
    const r = Math.round(182 + rRatio * (245 - 182));
    const g = Math.round(35 + rRatio * (140 - 35));
    const b = Math.round(85 - rRatio * 65);
    return [r, g, b];
  } else {
    // 0.75 to 1.0: bright orange to white-yellow peak
    const rRatio = (c - 0.75) / 0.25;
    const r = Math.round(245 + rRatio * (255 - 245));
    const g = Math.round(140 + rRatio * (255 - 140));
    const b = Math.round(20 + rRatio * (255 - 20));
    return [r, g, b];
  }
}

/**
 * Pure rendering function: draws PSF intensity onto a 2D canvas context.
 * Strictly non-mutating.
 */
export function drawPsfToCanvas(
  ctx: CanvasRenderingContext2D,
  intensity: Float64Array | number[],
  options?: {
    scale?: 'log' | 'linear';
    contrastRange?: [number, number];
    gridSize?: number;
  }
): void {
  const scale = options?.scale ?? 'log';
  const gridSize = options?.gridSize ?? GRID_SIZE;
  const contrastRange = options?.contrastRange ?? computePsfDisplayRange(intensity, scale);

  const [minVal, maxVal] = contrastRange;
  const range = maxVal - minVal > 1e-12 ? maxVal - minVal : 1e-12;

  const imgData = ctx.createImageData(gridSize, gridSize);
  const pixels = imgData.data;
  const len = gridSize * gridSize;

  for (let i = 0; i < len; i++) {
    const raw = intensity[i] ?? 0;
    const v = scale === 'log' ? Math.log10(Math.max(raw, 0) + 1e-8) : Math.max(raw, 0);
    const norm = Math.max(0, Math.min(1, (v - minVal) / range));

    const [r, g, b] = psfColorMap(norm);
    const offset = i * 4;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
}

export const PsfsCanvas: React.FC<PsfsCanvasProps> = ({
  intensity,
  defocus,
  label = 'PSF 光斑',
  scale = 'log',
  contrastRange,
  size = GRID_SIZE,
  displaySize = 200,
  className = '',
  showStats = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSupported, setCanvasSupported] = useState<boolean>(true);

  // Compute stats and contrast bounds without mutating input
  const stats = useMemo(() => computePsfStats(intensity, size), [intensity, size]);

  const activeRange = useMemo<[number, number]>(() => {
    return contrastRange ?? computePsfDisplayRange(intensity, scale);
  }, [contrastRange, intensity, scale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setCanvasSupported(false);
        return;
      }
      drawPsfToCanvas(ctx, intensity, {
        scale,
        contrastRange: activeRange,
        gridSize: size,
      });
      setCanvasSupported(true);
    } catch {
      setCanvasSupported(false);
    }
  }, [intensity, scale, activeRange, size]);

  const defocusBadge = defocus !== undefined ? (defocus > 0 ? `+${defocus}λ` : `${defocus}λ`) : null;
  const ariaDescription = `${label}，尺寸 ${size}×${size}，显示模式: ${scale === 'log' ? 'log10(I+1e-8) 对数' : '线性'}，峰值光强: ${stats.peak.toFixed(5)}，归一化能量总和: ${stats.totalSum.toFixed(4)}`;

  return (
    <figure
      className={`fw-canvas-card ${className}`}
      data-testid="psf-canvas-card"
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
        <span data-testid="psf-label">{label}</span>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {defocusBadge && (
            <span className="fw-panel-badge" data-testid="psf-defocus-badge">
              {defocusBadge}
            </span>
          )}
          {/* Explicit log scale indicator per Section 5.6 and T011 requirement */}
          <span
            className="fw-panel-badge"
            data-testid="psf-scale-indicator"
            style={{
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              color: 'var(--fw-primary)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
            }}
          >
            {scale === 'log' ? 'log10(I+1e-8)' : '线性显示'}
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
          data-testid="psf-canvas"
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
            data-testid="psf-canvas-fallback"
            role="alert"
            style={{
              padding: '12px',
              textAlign: 'center',
              fontSize: '0.75rem',
              color: 'var(--fw-text-muted)',
            }}
          >
            <p><strong>[Canvas 视图退化]</strong></p>
            <p>环境不支持 2D 画布，提供纯文本光强统计数据：</p>
            <p>峰值: {stats.peak.toFixed(5)} ({stats.peakX}, {stats.peakY})</p>
            <p>总能量: {stats.totalSum.toFixed(4)}</p>
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
            <span>Peak: {stats.peak.toFixed(5)}</span>
            <span>ΣI: {stats.totalSum.toFixed(4)}</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: 'var(--fw-font-mono)',
            }}
          >
            <span>中心位置: ({stats.peakX}, {stats.peakY})</span>
            <span style={{ fontSize: '0.68rem', color: 'var(--fw-text-muted)' }}>
              {scale === 'log' ? '对数增强显示' : '物理归一线性'}
            </span>
          </div>
        </figcaption>
      )}
    </figure>
  );
};
