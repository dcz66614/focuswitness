/**
 * P007 FocusWitness — Wavefront Canvas Component
 * Specifications: PROJECT_BOOK.md Section 5.1, 5.2, 5.6, FR03, FR05, FR12, FR13
 * 
 * Rules:
 * - Displays optical wavefront W(u,v) = a0*Z22 + a1*Z31 + a2*Z40 (excluding known defocus d*Z20)
 * - Units: waves (λ)
 * - Pupil aperture: circular disk r2 <= 1.0 (R=16px from center (32, 32))
 * - Never mutates underlying input data or feeds back fake numbers
 * - Provides accessible text summary and graceful degradation fallback
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { Coefficients } from '../domain/types';
import { GRID_SIZE, PUPIL_RADIUS_PX, PUPIL_CENTER_X, PUPIL_CENTER_Y } from '../domain/constants';
import { wavefront } from '../math/zernike';

export interface WavefrontStats {
  min: number;
  max: number;
  pv: number;
  rms: number;
  activePixels: number;
}

export interface WavefrontCanvasProps {
  /** Aberration coefficients (astig0, comaX, spherical) in waves */
  coefficients?: Coefficients;
  /** Precomputed wavefront array (4096 values); if omitted, computed from coefficients */
  wavefrontData?: Float64Array | number[];
  /** Grid dimension (default: 64) */
  size?: number;
  /** Display canvas CSS width/height in pixels (default: 200) */
  displaySize?: number;
  /** Title or label */
  title?: string;
  /** Subtitle or description */
  subtitle?: string;
  /** Custom CSS class */
  className?: string;
  /** Whether to show PV / RMS scalar metrics (default: true) */
  showStats?: boolean;
}

/**
 * Computes scalar statistics (PV, RMS, min, max) for wavefront inside circular pupil.
 * Strictly non-mutating.
 */
export function computeWavefrontStats(
  wData: Float64Array | number[],
  gridSize = GRID_SIZE
): WavefrontStats {
  let min = Infinity;
  let max = -Infinity;
  let sumSq = 0;
  let activePixels = 0;

  for (let y = 0; y < gridSize; y++) {
    const v = (y + 0.5 - PUPIL_CENTER_Y) / PUPIL_RADIUS_PX;
    for (let x = 0; x < gridSize; x++) {
      const u = (x + 0.5 - PUPIL_CENTER_X) / PUPIL_RADIUS_PX;
      if (u * u + v * v <= 1.0) {
        const val = wData[y * gridSize + x] ?? 0;
        if (val < min) min = val;
        if (val > max) max = val;
        sumSq += val * val;
        activePixels++;
      }
    }
  }

  if (activePixels === 0 || !Number.isFinite(min)) {
    return { min: 0, max: 0, pv: 0, rms: 0, activePixels: 0 };
  }

  const pv = max - min;
  const rms = Math.sqrt(sumSq / activePixels);
  return { min, max, pv, rms, activePixels };
}

/**
 * Maps normalized wavefront phase in [-1, +1] to RGB.
 * Diverging palette: negative OPD = blue, zero = neutral grey-white, positive OPD = red/amber.
 */
export function wavefrontColorMap(t: number): [number, number, number] {
  // t in [-1, 1]
  const clamped = Math.max(-1, Math.min(1, t));
  if (clamped < 0) {
    // [-1, 0] -> Blue to Neutral Grey
    const ratio = -clamped; // 1 to 0
    const r = Math.round(220 - ratio * (220 - 14));
    const g = Math.round(225 - ratio * (225 - 132));
    const b = Math.round(230 - ratio * (230 - 225));
    return [r, g, b];
  } else {
    // [0, 1] -> Neutral Grey to Red/Amber
    const ratio = clamped; // 0 to 1
    const r = Math.round(220 + ratio * (235 - 220));
    const g = Math.round(225 - ratio * (225 - 45));
    const b = Math.round(230 - ratio * (230 - 45));
    return [r, g, b];
  }
}

/**
 * Pure rendering function: draws wavefront data onto 2D canvas context.
 * Strictly non-mutating.
 */
export function drawWavefrontToCanvas(
  ctx: CanvasRenderingContext2D,
  wData: Float64Array | number[],
  gridSize = GRID_SIZE
): void {
  const stats = computeWavefrontStats(wData, gridSize);
  const maxAbs = Math.max(Math.abs(stats.min), Math.abs(stats.max), 1e-4);

  const imgData = ctx.createImageData(gridSize, gridSize);
  const pixels = imgData.data;

  for (let y = 0; y < gridSize; y++) {
    const v = (y + 0.5 - PUPIL_CENTER_Y) / PUPIL_RADIUS_PX;
    for (let x = 0; x < gridSize; x++) {
      const idx = y * gridSize + x;
      const pixelOffset = idx * 4;
      const u = (x + 0.5 - PUPIL_CENTER_X) / PUPIL_RADIUS_PX;

      if (u * u + v * v <= 1.0) {
        const val = wData[idx] ?? 0;
        const norm = val / maxAbs; // in [-1, 1]
        const [r, g, b] = wavefrontColorMap(norm);
        pixels[pixelOffset] = r;
        pixels[pixelOffset + 1] = g;
        pixels[pixelOffset + 2] = b;
        pixels[pixelOffset + 3] = 255;
      } else {
        // Outside pupil aperture: dark masked background
        pixels[pixelOffset] = 13;
        pixels[pixelOffset + 1] = 19;
        pixels[pixelOffset + 2] = 31;
        pixels[pixelOffset + 3] = 255;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

export const WavefrontCanvas: React.FC<WavefrontCanvasProps> = ({
  coefficients,
  wavefrontData,
  size = GRID_SIZE,
  displaySize = 200,
  title = '光瞳波前图 W(u,v)',
  subtitle = '待估未知像差 (不含已知离焦)',
  className = '',
  showStats = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSupported, setCanvasSupported] = useState<boolean>(true);

  // Compute or extract wavefront data without mutating
  const data = useMemo<Float64Array>(() => {
    if (wavefrontData) {
      return wavefrontData instanceof Float64Array
        ? wavefrontData
        : new Float64Array(wavefrontData);
    }
    if (coefficients) {
      return wavefront(coefficients);
    }
    return new Float64Array(size * size);
  }, [coefficients, wavefrontData, size]);

  const stats = useMemo(() => computeWavefrontStats(data, size), [data, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setCanvasSupported(false);
        return;
      }
      drawWavefrontToCanvas(ctx, data, size);
      setCanvasSupported(true);
    } catch {
      setCanvasSupported(false);
    }
  }, [data, size]);

  const ariaDescription = `光瞳波前图，峰谷值PV: ${stats.pv.toFixed(4)}λ，方均根RMS: ${stats.rms.toFixed(4)}λ，标量范围: [${stats.min.toFixed(4)}, +${stats.max.toFixed(4)}]λ`;

  return (
    <figure
      className={`fw-canvas-card ${className}`}
      data-testid="wavefront-canvas-card"
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
        <span>{title}</span>
        <span className="fw-panel-badge" style={{ fontSize: '0.7rem' }}>
          单位: waves (λ)
        </span>
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
          data-testid="wavefront-canvas"
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
            data-testid="wavefront-canvas-fallback"
            role="alert"
            style={{
              padding: '12px',
              textAlign: 'center',
              fontSize: '0.75rem',
              color: 'var(--fw-text-muted)',
            }}
          >
            <p><strong>[Canvas 视图退化]</strong></p>
            <p>环境不支持 2D 画布，提供纯文本波前统计数据：</p>
            <p>PV: {stats.pv.toFixed(4)} λ | RMS: {stats.rms.toFixed(4)} λ</p>
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
            <span>PV: {stats.pv.toFixed(4)} λ</span>
            <span>RMS: {stats.rms.toFixed(4)} λ</span>
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontFamily: 'var(--fw-font-mono)',
            }}
          >
            <span style={{ color: '#38bdf8' }}>min: {stats.min.toFixed(4)} λ</span>
            <span style={{ color: '#fb7185' }}>max: +{stats.max.toFixed(4)} λ</span>
          </div>
          {subtitle && (
            <span style={{ fontSize: '0.7rem', color: 'var(--fw-text-muted)' }}>
              {subtitle}
            </span>
          )}
        </figcaption>
      )}
    </figure>
  );
};
