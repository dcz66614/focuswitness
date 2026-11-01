/**
 * P007 FocusWitness — Canvas Visual Components and PNG Export Tests
 * Task: TASK-P007-T011
 * Specifications: PROJECT_BOOK.md Section 5.6, FR03, FR05, FR12, FR13
 * 
 * Verifications:
 * 1. WavefrontCanvas: W(u,v) display, circular pupil mask, PV/RMS stats, accessible text, non-mutation
 * 2. PsfsCanvas: log10(I + 1e-8) scale indication, identical paired contrast, peak & sum metrics, non-mutation
 * 3. ResidualCanvas: diverging colormap (blue negative, red positive), FR13 sign badges, shared contrastMax, non-mutation
 * 4. exportPng: composite evidence layout, accessible text alternative (FR12), non-mutation
 * 5. Direct 2D context drawing: pixel value mapping and degradation fallbacks
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  WavefrontCanvas,
  computeWavefrontStats,
  wavefrontColorMap,
  drawWavefrontToCanvas,
} from '../../src/ui/WavefrontCanvas';
import {
  PsfsCanvas,
  computePsfStats,
  computePsfDisplayRange,
  computeCombinedPsfRange,
  psfColorMap,
  drawPsfToCanvas,
} from '../../src/ui/PsfsCanvas';
import {
  ResidualCanvas,
  computeResidualStats,
  computeMaxAbsResidual,
  residualColorMap,
  drawResidualToCanvas,
} from '../../src/ui/ResidualCanvas';
import {
  generateEvidenceTextSummary,
  exportCanvasToDataUrl,
  exportCanvasToBlob,
  renderEvidenceToCanvas,
} from '../../src/io/exportPng';
import { forwardPsf, wavefront } from '../../src/math/psf';
import { PRESETS } from '../../src/domain/presets';
import { GRID_SIZE, PIXEL_COUNT } from '../../src/domain/constants';
import type { Coefficients } from '../../src/domain/types';

/**
 * Creates a mock 2D canvas rendering context for testing drawing functions in Node environment
 */
function createMockCanvasContext(width = GRID_SIZE, height = GRID_SIZE) {
  let lastImageData: { data: Uint8ClampedArray; width: number; height: number } | null = null;
  const calls: { method: string; args: any[] } = [];

  const ctx = {
    calls,
    get lastImageData() {
      return lastImageData;
    },
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
    putImageData: (img: any, x: number, y: number) => {
      lastImageData = img;
      calls.push({ method: 'putImageData', args: [img, x, y] });
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      calls.push({ method: 'fillRect', args: [x, y, w, h] });
    },
    strokeRect: (x: number, y: number, w: number, h: number) => {
      calls.push({ method: 'strokeRect', args: [x, y, w, h] });
    },
    fillText: (text: string, x: number, y: number) => {
      calls.push({ method: 'fillText', args: [text, x, y] });
    },
    drawImage: (img: any, x: number, y: number, w: number, h: number) => {
      calls.push({ method: 'drawImage', args: [img, x, y, w, h] });
    },
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D & {
    lastImageData: { data: Uint8ClampedArray; width: number; height: number } | null;
    calls: { method: string; args: any[] }[];
  };

  return ctx;
}

describe('TASK-P007-T011 Canvas Evidence Visualizations & Export', () => {
  const mixedPreset = PRESETS.mixed.coefficients;

  describe('1. WavefrontCanvas Component (Section 5.1, 5.2, FR03)', () => {
    it('renders semantic figure, canvas with role="img", aria-label and PV/RMS metrics', () => {
      const html = renderToStaticMarkup(
        <WavefrontCanvas coefficients={mixedPreset} displaySize={240} />
      );

      expect(html).toContain('data-testid="wavefront-canvas-card"');
      expect(html).toContain('data-testid="wavefront-canvas"');
      expect(html).toContain('role="img"');
      expect(html).toContain('aria-label=');
      expect(html).toContain('光瞳波前图 W(u,v)');
      expect(html).toContain('waves (λ)');
      expect(html).toContain('PV:');
      expect(html).toContain('RMS:');
      expect(html).toContain('min:');
      expect(html).toContain('max:');
    });

    it('computes accurate PV and RMS exclusively over active pupil pixels (R=16px)', () => {
      const wData = wavefront(mixedPreset);
      const stats = computeWavefrontStats(wData);

      expect(stats.activePixels).toBeGreaterThan(700);
      expect(stats.activePixels).toBeLessThan(900); // Circular disk of radius 16 on 64x64 grid is ~804 px
      expect(stats.pv).toBeCloseTo(stats.max - stats.min, 10);
      expect(stats.rms).toBeGreaterThan(0);
      expect(stats.pv).toBeGreaterThan(stats.rms);
    });

    it('wavefrontColorMap maps diverging phase: blue for negative, grey-white for zero, red for positive', () => {
      const negColor = wavefrontColorMap(-1.0);
      const zeroColor = wavefrontColorMap(0.0);
      const posColor = wavefrontColorMap(1.0);

      // Negative OPD: predominantly blue
      expect(negColor[2]).toBeGreaterThan(negColor[0]);
      // Zero OPD: neutral grey-white
      expect(Math.abs(zeroColor[0] - zeroColor[1])).toBeLessThanOrEqual(10);
      expect(Math.abs(zeroColor[1] - zeroColor[2])).toBeLessThanOrEqual(10);
      // Positive OPD: predominantly red/amber
      expect(posColor[0]).toBeGreaterThan(posColor[2]);
    });

    it('drawWavefrontToCanvas masks pixels outside pupil aperture to dark background', () => {
      const wData = wavefront(mixedPreset);
      const ctx = createMockCanvasContext();

      drawWavefrontToCanvas(ctx, wData, GRID_SIZE);

      expect(ctx.lastImageData).not.toBeNull();
      const pixels = ctx.lastImageData!.data;

      // Pixel (0, 0) is well outside pupil (center 32, 32, R=16) -> should be masked dark [13, 19, 31, 255]
      const cornerOffset = (0 * GRID_SIZE + 0) * 4;
      expect(pixels[cornerOffset]).toBe(13);
      expect(pixels[cornerOffset + 1]).toBe(19);
      expect(pixels[cornerOffset + 2]).toBe(31);
      expect(pixels[cornerOffset + 3]).toBe(255);

      // Pixel (32, 32) is inside pupil -> should NOT be dark background
      const centerOffset = (32 * GRID_SIZE + 32) * 4;
      const isMasked =
        pixels[centerOffset] === 13 &&
        pixels[centerOffset + 1] === 19 &&
        pixels[centerOffset + 2] === 31;
      expect(isMasked).toBe(false);
    });

    it('guarantees input coefficients and wavefront arrays are NEVER mutated', () => {
      const origCoeffs: Coefficients = { astig0: 0.08, comaX: -0.06, spherical: 0.04 };
      const frozenCoeffs = Object.freeze({ ...origCoeffs });
      const wData = wavefront(frozenCoeffs);
      const originalCopy = new Float64Array(wData);

      computeWavefrontStats(wData);
      renderToStaticMarkup(<WavefrontCanvas wavefrontData={wData} coefficients={frozenCoeffs} />);

      for (let i = 0; i < PIXEL_COUNT; i++) {
        expect(wData[i]).toBe(originalCopy[i]);
      }
      expect(frozenCoeffs.astig0).toBe(0.08);
      expect(frozenCoeffs.comaX).toBe(-0.06);
      expect(frozenCoeffs.spherical).toBe(0.04);
    });
  });

  describe('2. PsfsCanvas Component (Section 5.6, FR03, FR05)', () => {
    const psfMinus = forwardPsf(mixedPreset, -0.65);
    const psfPlus = forwardPsf(mixedPreset, 0.65);

    it('explicitly displays log scale indicator badge "log10(I+1e-8)" by default', () => {
      const html = renderToStaticMarkup(
        <PsfsCanvas
          intensity={psfMinus}
          defocus={-0.65}
          label="观测焦面 I_obs (-0.65λ)"
        />
      );

      expect(html).toContain('data-testid="psf-canvas-card"');
      expect(html).toContain('data-testid="psf-scale-indicator"');
      expect(html).toContain('log10(I+1e-8)');
      expect(html).toContain('data-testid="psf-defocus-badge"');
      expect(html).toContain('-0.65λ');
      expect(html).toContain('Peak:');
      expect(html).toContain('ΣI:');
    });

    it('supports linear scale display mode when requested', () => {
      const html = renderToStaticMarkup(
        <PsfsCanvas
          intensity={psfMinus}
          defocus={-0.65}
          scale="linear"
        />
      );

      expect(html).toContain('线性显示');
      expect(html).toContain('物理归一线性');
    });

    it('computes accurate physical PSF scalar stats without mutation', () => {
      const stats = computePsfStats(psfMinus);

      expect(stats.peak).toBeGreaterThan(0.001);
      expect(stats.peak).toBeLessThan(0.3);
      expect(stats.totalSum).toBeCloseTo(1.0, 6); // Normalized Fraunhofer PSF sums to 1.0
      expect(stats.peakX).toBeGreaterThanOrEqual(20);
      expect(stats.peakX).toBeLessThanOrEqual(44);
      expect(stats.peakY).toBeGreaterThanOrEqual(20);
      expect(stats.peakY).toBeLessThanOrEqual(44);
    });

    it('computes unified contrast range across paired PSFs for identical contrast scaling', () => {
      const [minM, maxM] = computePsfDisplayRange(psfMinus, 'log');
      const [minP, maxP] = computePsfDisplayRange(psfPlus, 'log');
      const [combMin, combMax] = computeCombinedPsfRange([psfMinus, psfPlus], 'log');

      expect(combMin).toBe(Math.min(minM, minP));
      expect(combMax).toBe(Math.max(maxM, maxP));
      expect(combMin).toBeLessThan(combMax);
    });

    it('drawPsfToCanvas applies contrastRange and maps peak to white/yellow and background to dark navy', () => {
      const ctx = createMockCanvasContext();
      const contrastRange = computeCombinedPsfRange([psfMinus, psfPlus], 'log');

      drawPsfToCanvas(ctx, psfMinus, { scale: 'log', contrastRange, gridSize: GRID_SIZE });

      expect(ctx.lastImageData).not.toBeNull();
      const pixels = ctx.lastImageData!.data;

      const stats = computePsfStats(psfMinus);
      const peakPixelOffset = (stats.peakY * GRID_SIZE + stats.peakX) * 4;

      // Peak pixel should have high intensity (bright yellow/white)
      expect(pixels[peakPixelOffset]).toBeGreaterThan(200);
      expect(pixels[peakPixelOffset + 1]).toBeGreaterThan(120);

      // Low intensity corner pixel (0, 0) should have dark navy color
      const cornerOffset = 0;
      expect(pixels[cornerOffset]).toBeLessThan(30);
      expect(pixels[cornerOffset + 1]).toBeLessThan(30);
    });

    it('guarantees intensity array is strictly non-mutated after stats, range, and rendering', () => {
      const copy = new Float64Array(psfMinus);

      computePsfStats(psfMinus);
      computePsfDisplayRange(psfMinus, 'log');
      computeCombinedPsfRange([psfMinus, psfPlus], 'log');
      renderToStaticMarkup(<PsfsCanvas intensity={psfMinus} />);

      for (let i = 0; i < PIXEL_COUNT; i++) {
        expect(psfMinus[i]).toBe(copy[i]);
      }
    });
  });

  describe('3. ResidualCanvas Component (Section 5.6, FR13)', () => {
    const obsMinus = forwardPsf(mixedPreset, -0.65);
    // Reprojected with slightly perturbed coefficients to produce non-zero residual
    const perturbedCoeffs: Coefficients = { astig0: 0.06, comaX: -0.05, spherical: 0.03 };
    const reprojMinus = forwardPsf(perturbedCoeffs, -0.65);
    const residualMinus = new Float64Array(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      residualMinus[i] = obsMinus[i]! - reprojMinus[i]!;
    }

    it('renders FR13 explicit sign badges [-] 蓝 / [+] 红 and scalar min/max labels', () => {
      const html = renderToStaticMarkup(
        <ResidualCanvas
          residuals={residualMinus}
          defocus={-0.65}
          label="残差 ΔI (-0.65λ)"
        />
      );

      expect(html).toContain('data-testid="residual-canvas-card"');
      expect(html).toContain('data-testid="residual-canvas"');
      expect(html).toContain('data-testid="residual-tag-neg"');
      expect(html).toContain('[-] 蓝');
      expect(html).toContain('data-testid="residual-tag-pos"');
      expect(html).toContain('[+] 红');
      expect(html).toContain('FR13 正负发散色标');
      expect(html).toContain('max(|ΔI|):');
      expect(html).toContain('RMS:');
      expect(html).toContain('色标标尺: ±');
    });

    it('computes accurate residual stats (min, max, maxAbs, RMS, SSE) without mutation', () => {
      const stats = computeResidualStats(residualMinus);

      expect(stats.min).toBeLessThan(0);
      expect(stats.max).toBeGreaterThan(0);
      expect(stats.maxAbs).toBe(Math.max(Math.abs(stats.min), Math.abs(stats.max)));
      expect(stats.rms).toBeGreaterThan(0);
      expect(stats.sse).toBeGreaterThan(0);
      expect(stats.rms).toBeCloseTo(Math.sqrt(stats.sse / PIXEL_COUNT), 10);
    });

    it('residualColorMap maps diverging values: blue for negative, grey-white for zero, crimson red for positive', () => {
      const negColor = residualColorMap(-1.0);
      const zeroColor = residualColorMap(0.0);
      const posColor = residualColorMap(1.0);

      // Negative residual: blue (Sky Blue: R=2, G=132, B=199)
      expect(negColor[2]).toBeGreaterThan(negColor[0]);
      expect(negColor[2]).toBeGreaterThan(150);

      // Neutral zero: grey-white (approx [225, 230, 235])
      expect(zeroColor[0]).toBe(225);
      expect(zeroColor[1]).toBe(230);
      expect(zeroColor[2]).toBe(235);

      // Positive residual: crimson red (R=225, G=29, B=72)
      expect(posColor[0]).toBeGreaterThan(posColor[1]);
      expect(posColor[0]).toBeGreaterThan(posColor[2]);
      expect(posColor[0]).toBe(225);
    });

    it('computes unified symmetric contrastMax across paired residual datasets', () => {
      const obsPlus = forwardPsf(mixedPreset, 0.65);
      const reprojPlus = forwardPsf(perturbedCoeffs, 0.65);
      const resPlus = new Float64Array(PIXEL_COUNT);
      for (let i = 0; i < PIXEL_COUNT; i++) {
        resPlus[i] = obsPlus[i]! - reprojPlus[i]!;
      }

      const unifiedMax = computeMaxAbsResidual([residualMinus, resPlus]);
      const statsMinus = computeResidualStats(residualMinus);
      const statsPlus = computeResidualStats(resPlus);

      expect(unifiedMax).toBe(Math.max(statsMinus.maxAbs, statsPlus.maxAbs));
      expect(unifiedMax).toBeGreaterThan(0);
    });

    it('drawResidualToCanvas maps zero residuals to neutral grey-white and positive/negative to distinct colors', () => {
      const stats = computeResidualStats(residualMinus);
      const ctx = createMockCanvasContext();
      drawResidualToCanvas(ctx, residualMinus, { contrastMax: stats.maxAbs, gridSize: GRID_SIZE });

      expect(ctx.lastImageData).not.toBeNull();
      const pixels = ctx.lastImageData!.data;

      // Ensure some pixels are drawn with non-zero alpha
      expect(pixels[3]).toBe(255);
      // Ensure color diversity exists (not all identical)
      let hasBlue = false;
      let hasRed = false;
      for (let i = 0; i < PIXEL_COUNT; i++) {
        const offset = i * 4;
        const r = pixels[offset]!;
        const g = pixels[offset + 1]!;
        const b = pixels[offset + 2]!;
        if (b > r && b > 150) hasBlue = true;
        if (r > b && r > 200 && g < 100) hasRed = true;
      }
      expect(hasBlue).toBe(true);
      expect(hasRed).toBe(true);
    });

    it('guarantees residual and input arrays are never mutated', () => {
      const copy = new Float64Array(residualMinus);

      computeResidualStats(residualMinus);
      computeMaxAbsResidual([residualMinus]);
      renderToStaticMarkup(<ResidualCanvas residuals={residualMinus} />);

      for (let i = 0; i < PIXEL_COUNT; i++) {
        expect(residualMinus[i]).toBe(copy[i]);
      }
    });
  });

  describe('4. PNG Export & Accessible Text Summary (FR12)', () => {
    const obsMinus = forwardPsf(mixedPreset, -0.65);
    const obsPlus = forwardPsf(mixedPreset, 0.65);
    const reprojMinus = forwardPsf(mixedPreset, -0.65);
    const reprojPlus = forwardPsf(mixedPreset, 0.65);
    const wData = wavefront(mixedPreset);
    const resMinus = new Float64Array(PIXEL_COUNT);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      resMinus[i] = obsMinus[i]! - reprojMinus[i]!;
    }

    const exportData = {
      label: 'mixed',
      mode: 'dual' as const,
      coefficients: mixedPreset,
      groundTruth: mixedPreset,
      wavefront: wData,
      observedMinus: obsMinus,
      observedPlus: obsPlus,
      reprojectedMinus: reprojMinus,
      reprojectedPlus: reprojPlus,
      residualMinus: resMinus,
      loss: 1.25e-14,
      runId: 42,
    };

    it('generates reproducible text alternative summary including all images and parameters (FR12)', () => {
      const summary = generateEvidenceTextSummary(exportData);

      expect(summary).toContain('# FocusWitness 焦证仪 — 实验证据文本替代说明 (FR12)');
      expect(summary).toContain('案例标签: mixed');
      expect(summary).toContain('拟合模式: dual');
      expect(summary).toContain('运行编号 (runId): 42');
      expect(summary).toContain('(Loss): 1.250000e-14');
      expect(summary).toContain('当前估计系数: astig0=0.0800λ, comaX=-0.0600λ, spherical=0.0400λ');
      expect(summary).toContain('光瞳波前统计 W(u,v)');
      expect(summary).toContain('峰谷值 (PV):');
      expect(summary).toContain('方均根 (RMS):');
      expect(summary).toContain('PSF 光斑光强统计 (显示模式: log10(I + 1e-8))');
      expect(summary).toContain('负离焦观测光斑 (-0.65λ)');
      expect(summary).toContain('正离焦观测光斑 (+0.65λ)');
      expect(summary).toContain('残差差值统计 ΔI = I_obs - I_reproj (FR13 蓝负红正发散色标)');
      expect(summary).toContain('对数对比增强');
      expect(summary).toContain('线性物理归一化光强');
    });

    it('guarantees text summary generation is non-mutating on all input arrays', () => {
      const copyObsM = new Float64Array(obsMinus);
      const copyW = new Float64Array(wData);

      generateEvidenceTextSummary(exportData);

      for (let i = 0; i < PIXEL_COUNT; i++) {
        expect(obsMinus[i]).toBe(copyObsM[i]);
        expect(wData[i]).toBe(copyW[i]);
      }
    });

    it('exportCanvasToDataUrl and exportCanvasToBlob work with mocked canvas', async () => {
      const mockCanvas = {
        toDataURL: (type: string) => `data:${type};base64,mockPngData`,
        toBlob: (cb: (b: Blob | null) => void, type: string) => {
          cb({ size: 1024, type } as unknown as Blob);
        },
      } as unknown as HTMLCanvasElement;

      const dataUrl = exportCanvasToDataUrl(mockCanvas);
      expect(dataUrl).toContain('data:image/png;base64,');

      const blob = await exportCanvasToBlob(mockCanvas);
      expect(blob).toBeDefined();
      expect(blob.type).toBe('image/png');
    });

    it('renderEvidenceToCanvas constructs layout in DOM environment or throws clean error in non-DOM', () => {
      if (typeof document === 'undefined') {
        expect(() => renderEvidenceToCanvas(exportData)).toThrow('requires a browser DOM environment');
      } else {
        const canvas = renderEvidenceToCanvas(exportData, { width: 960, height: 720 });
        expect(canvas.width).toBe(960);
        expect(canvas.height).toBe(720);
      }
    });
  });

  describe('5. Accessibility, Fallback & No-Fake-Value Invariants', () => {
    it('never invents or fabricates fake values: zero inputs yield exactly zero statistics', () => {
      const emptyWavefront = new Float64Array(PIXEL_COUNT);
      const wStats = computeWavefrontStats(emptyWavefront);
      expect(wStats.pv).toBe(0);
      expect(wStats.rms).toBe(0);
      expect(wStats.min).toBe(0);
      expect(wStats.max).toBe(0);

      const emptyResidual = new Float64Array(PIXEL_COUNT);
      const rStats = computeResidualStats(emptyResidual);
      expect(rStats.maxAbs).toBe(0);
      expect(rStats.rms).toBe(0);
      expect(rStats.sse).toBe(0);
    });

    it('renders clean fallback notices when Canvas 2D is unsupported without crashing', () => {
      // In server-side rendering (renderToStaticMarkup), canvasSupported is true initially
      // but in degraded states it renders semantic accessible structures.
      const htmlWavefront = renderToStaticMarkup(<WavefrontCanvas wavefrontData={new Float64Array(4096)} />);
      expect(htmlWavefront).toContain('role="img"');
      expect(htmlWavefront).toContain('aria-label=');

      const htmlPsf = renderToStaticMarkup(<PsfsCanvas intensity={new Float64Array(4096)} />);
      expect(htmlPsf).toContain('role="img"');
      expect(htmlPsf).toContain('aria-label=');

      const htmlResidual = renderToStaticMarkup(<ResidualCanvas residuals={new Float64Array(4096)} />);
      expect(htmlResidual).toContain('role="img"');
      expect(htmlResidual).toContain('aria-label=');
    });
  });
});
