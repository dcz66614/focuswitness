/**
 * P007 FocusWitness — Evidence PNG Export and Accessible Text Summary
 * Specifications: PROJECT_BOOK.md Section 4.1, 5.6, 6.5, FR03, FR05, FR12, FR13
 * 
 * Rules:
 * - Exports composite evidence views (wavefront, observed PSFs, reprojected PSFs, residuals)
 * - Guarantees identical contrast parameters across paired PSF plots and symmetric residual scale
 * - Clearly indicates log scale transform: log10(I + 1e-8)
 * - Includes FR13 diverging sign indicators: [-] blue / [+] red
 * - Provides reproducible image and estimated values text alternative explanation (FR12)
 * - Strictly non-mutating: does not alter underlying arrays or feed back fake numbers
 */

import type { Coefficients, FocusPlane, Mode } from '../domain/types';
import {
  GRID_SIZE,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
} from '../domain/constants';
import { drawWavefrontToCanvas, computeWavefrontStats } from '../ui/WavefrontCanvas';
import {
  drawPsfToCanvas,
  computeCombinedPsfRange,
  computePsfStats,
} from '../ui/PsfsCanvas';
import {
  drawResidualToCanvas,
  computeMaxAbsResidual,
  computeResidualStats,
} from '../ui/ResidualCanvas';

export interface EvidenceExportData {
  label?: string;
  mode?: Mode;
  coefficients?: Coefficients;
  groundTruth?: Coefficients;
  wavefront?: Float64Array | number[];
  observedMinus: Float64Array | number[];
  observedPlus?: Float64Array | number[];
  reprojectedMinus?: Float64Array | number[];
  reprojectedPlus?: Float64Array | number[];
  residualMinus?: Float64Array | number[];
  residualPlus?: Float64Array | number[];
  loss?: number;
  runId?: number;
}

export interface EvidenceExportOptions {
  width?: number;
  height?: number;
  includeWavefront?: boolean;
  scale?: 'log' | 'linear';
  title?: string;
}

/**
 * Generates an accessible, reproducible text summary of the evidence images and estimated parameters (FR12).
 * Strictly non-mutating.
 */
export function generateEvidenceTextSummary(data: EvidenceExportData): string {
  const lines: string[] = [];
  lines.push('# FocusWitness 焦证仪 — 实验证据文本替代说明 (FR12)');
  lines.push(`- 案例标签: ${data.label ?? 'mixed'}`);
  lines.push(`- 拟合模式: ${data.mode ?? 'dual'}`);
  if (data.runId !== undefined) {
    lines.push(`- 运行编号 (runId): ${data.runId}`);
  }
  if (data.loss !== undefined) {
    lines.push(`- 目标损失 (Loss): ${data.loss.toExponential(6)}`);
  }

  lines.push('\n## 1. 像差参数估计');
  if (data.coefficients) {
    const c = data.coefficients;
    lines.push(`- 当前估计系数: astig0=${c.astig0.toFixed(4)}λ, comaX=${c.comaX.toFixed(4)}λ, spherical=${c.spherical.toFixed(4)}λ`);
  }
  if (data.groundTruth) {
    const gt = data.groundTruth;
    lines.push(`- 参考真值系数: astig0=${gt.astig0.toFixed(4)}λ, comaX=${gt.comaX.toFixed(4)}λ, spherical=${gt.spherical.toFixed(4)}λ`);
  }

  if (data.wavefront) {
    const wStats = computeWavefrontStats(data.wavefront);
    lines.push('\n## 2. 光瞳波前统计 W(u,v)');
    lines.push(`- 峰谷值 (PV): ${wStats.pv.toFixed(4)} λ`);
    lines.push(`- 方均根 (RMS): ${wStats.rms.toFixed(4)} λ`);
    lines.push(`- 标量范围: [${wStats.min.toFixed(4)}, +${wStats.max.toFixed(4)}] λ`);
  }

  lines.push('\n## 3. PSF 光斑光强统计 (显示模式: log10(I + 1e-8))');
  const obsMinusStats = computePsfStats(data.observedMinus);
  lines.push(`- 负离焦观测光斑 (${DIVERSITY_DEFOCUS_MINUS}λ): 峰值=${obsMinusStats.peak.toFixed(5)}, 坐标=(${obsMinusStats.peakX},${obsMinusStats.peakY}), 总能量和=${obsMinusStats.totalSum.toFixed(4)}`);

  if (data.observedPlus) {
    const obsPlusStats = computePsfStats(data.observedPlus);
    lines.push(`- 正离焦观测光斑 (+${DIVERSITY_DEFOCUS_PLUS}λ): 峰值=${obsPlusStats.peak.toFixed(5)}, 坐标=(${obsPlusStats.peakX},${obsPlusStats.peakY}), 总能量和=${obsPlusStats.totalSum.toFixed(4)}`);
  }

  if (data.reprojectedMinus) {
    const repMinusStats = computePsfStats(data.reprojectedMinus);
    lines.push(`- 负离焦重投影光斑 (${DIVERSITY_DEFOCUS_MINUS}λ): 峰值=${repMinusStats.peak.toFixed(5)}, 坐标=(${repMinusStats.peakX},${repMinusStats.peakY}), 总能量和=${repMinusStats.totalSum.toFixed(4)}`);
  }

  if (data.reprojectedPlus) {
    const repPlusStats = computePsfStats(data.reprojectedPlus);
    lines.push(`- 正离焦重投影光斑 (+${DIVERSITY_DEFOCUS_PLUS}λ): 峰值=${repPlusStats.peak.toFixed(5)}, 坐标=(${repPlusStats.peakX},${repPlusStats.peakY}), 总能量和=${repPlusStats.totalSum.toFixed(4)}`);
  }

  lines.push('\n## 4. 残差差值统计 ΔI = I_obs - I_reproj (FR13 蓝负红正发散色标)');
  if (data.residualMinus) {
    const resMinusStats = computeResidualStats(data.residualMinus);
    lines.push(`- 负离焦残差 (${DIVERSITY_DEFOCUS_MINUS}λ): 极值范围=[${resMinusStats.min.toExponential(3)}, +${resMinusStats.max.toExponential(3)}], max(|ΔI|)=${resMinusStats.maxAbs.toExponential(3)}, RMS=${resMinusStats.rms.toExponential(3)}`);
  }

  if (data.residualPlus) {
    const resPlusStats = computeResidualStats(data.residualPlus);
    lines.push(`- 正离焦残差 (+${DIVERSITY_DEFOCUS_PLUS}λ): 极值范围=[${resPlusStats.min.toExponential(3)}, +${resPlusStats.max.toExponential(3)}], max(|ΔI|)=${resPlusStats.maxAbs.toExponential(3)}, RMS=${resPlusStats.rms.toExponential(3)}`);
  }

  lines.push('\n## 5. 约定说明');
  lines.push('- 显示变换 log10(I+1e-8) 仅用于对数对比增强，数值逆向拟合始终基于线性物理归一化光强。');
  lines.push('- 对照组光斑统一采用相同对比范围；残差热图统一采用以 0 为对称中心的相同色标标尺。');

  return lines.join('\n');
}

/**
 * Creates an in-memory 64x64 canvas, renders a sub-image into it, and returns the canvas.
 */
function createSubCanvas(
  drawFn: (ctx: CanvasRenderingContext2D) => void,
  size = GRID_SIZE
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawFn(ctx);
  return canvas;
}

/**
 * Renders composite evidence grid into a newly created HTMLCanvasElement.
 * Accommodates header, wavefront, paired PSFs, paired residuals, colorbar, and legends.
 */
export function renderEvidenceToCanvas(
  data: EvidenceExportData,
  options: EvidenceExportOptions = {}
): HTMLCanvasElement {
  if (typeof document === 'undefined') {
    throw new Error('renderEvidenceToCanvas requires a browser DOM environment');
  }

  const width = options.width ?? 960;
  const height = options.height ?? 720;
  const scale = options.scale ?? 'log';
  const title = options.title ?? 'FocusWitness 焦证仪 — 双焦面像差反演证据视图 (FR03 / FR12)';

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to acquire 2D canvas context');
  }

  // 1. Dark theme background
  ctx.fillStyle = '#0b0f17';
  ctx.fillRect(0, 0, width, height);

  // 2. Header banner
  ctx.fillStyle = '#121824';
  ctx.fillRect(0, 0, width, 56);
  ctx.strokeStyle = '#2a3850';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, width, 56);

  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText(title, 20, 32);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px sans-serif';
  const metaText = `模式: ${data.mode ?? 'dual'} | 案例: ${data.label ?? 'mixed'} | 64×64 网格 | 显示: log10(I+1e-8)`;
  ctx.fillText(metaText, 20, 48);

  // 3. Compute shared contrast bounds for PSFs
  const psfDatasets: (Float64Array | number[])[] = [data.observedMinus];
  if (data.observedPlus) psfDatasets.push(data.observedPlus);
  if (data.reprojectedMinus) psfDatasets.push(data.reprojectedMinus);
  if (data.reprojectedPlus) psfDatasets.push(data.reprojectedPlus);
  const sharedPsfRange = computeCombinedPsfRange(psfDatasets, scale);

  // 4. Compute shared symmetric contrast max for Residuals
  const resDatasets: (Float64Array | number[] | undefined)[] = [data.residualMinus, data.residualPlus];
  const sharedResMax = computeMaxAbsResidual(resDatasets);

  // 5. Layout grid cells
  // We place 6 main cells in a 3x2 or 2x3 grid:
  // Col 1: Observed (-0.65λ) / (+0.65λ)
  // Col 2: Reprojected (-0.65λ) / (+0.65λ)
  // Col 3: Residual (-0.65λ) / (+0.65λ)
  const cellW = 160;
  const cellH = 160;
  const startX = 30;
  const startY = 80;
  const gapX = 40;
  const gapY = 50;

  const renderCell = (
    subCanvas: HTMLCanvasElement | null,
    x: number,
    y: number,
    header: string,
    badge: string,
    footer: string
  ) => {
    // Cell Card Background
    ctx.fillStyle = '#182234';
    ctx.strokeStyle = '#2a3850';
    ctx.fillRect(x - 8, y - 24, cellW + 16, cellH + 54);
    ctx.strokeRect(x - 8, y - 24, cellW + 16, cellH + 54);

    // Header
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(header, x, y - 10);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '10px monospace';
    ctx.fillText(badge, x + cellW - 50, y - 10);

    // Image
    if (subCanvas) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(subCanvas, x, y, cellW, cellH);
    }

    // Footer stats
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(footer, x, y + cellH + 16);
  };

  // Row 1: Minus plane (-0.65λ)
  // 1A. Obs Minus
  const cObsMinus = createSubCanvas((subCtx) =>
    drawPsfToCanvas(subCtx, data.observedMinus, { scale, contrastRange: sharedPsfRange })
  );
  renderCell(
    cObsMinus,
    startX,
    startY,
    '观测焦面 (-0.65λ)',
    'log10',
    `Peak: ${computePsfStats(data.observedMinus).peak.toFixed(4)}`
  );

  // 1B. Reproj Minus
  if (data.reprojectedMinus) {
    const cRepMinus = createSubCanvas((subCtx) =>
      drawPsfToCanvas(subCtx, data.reprojectedMinus!, { scale, contrastRange: sharedPsfRange })
    );
    renderCell(
      cRepMinus,
      startX + cellW + gapX,
      startY,
      '重投影 (-0.65λ)',
      '相同对比',
      `Peak: ${computePsfStats(data.reprojectedMinus).peak.toFixed(4)}`
    );
  }

  // 1C. Residual Minus
  if (data.residualMinus) {
    const cResMinus = createSubCanvas((subCtx) =>
      drawResidualToCanvas(subCtx, data.residualMinus!, { contrastMax: sharedResMax })
    );
    const rStats = computeResidualStats(data.residualMinus);
    renderCell(
      cResMinus,
      startX + (cellW + gapX) * 2,
      startY,
      '残差 ΔI (-0.65λ)',
      '[-]蓝/[+]红',
      `max|r|: ${rStats.maxAbs.toExponential(2)}`
    );
  }

  // Row 2: Plus plane (+0.65λ)
  const row2Y = startY + cellH + gapY;

  // 2A. Obs Plus
  if (data.observedPlus) {
    const cObsPlus = createSubCanvas((subCtx) =>
      drawPsfToCanvas(subCtx, data.observedPlus!, { scale, contrastRange: sharedPsfRange })
    );
    renderCell(
      cObsPlus,
      startX,
      row2Y,
      '观测焦面 (+0.65λ)',
      'log10',
      `Peak: ${computePsfStats(data.observedPlus).peak.toFixed(4)}`
    );
  }

  // 2B. Reproj Plus
  if (data.reprojectedPlus) {
    const cRepPlus = createSubCanvas((subCtx) =>
      drawPsfToCanvas(subCtx, data.reprojectedPlus!, { scale, contrastRange: sharedPsfRange })
    );
    renderCell(
      cRepPlus,
      startX + cellW + gapX,
      row2Y,
      '重投影 (+0.65λ)',
      '相同对比',
      `Peak: ${computePsfStats(data.reprojectedPlus).peak.toFixed(4)}`
    );
  }

  // 2C. Residual Plus
  if (data.residualPlus) {
    const cResPlus = createSubCanvas((subCtx) =>
      drawResidualToCanvas(subCtx, data.residualPlus!, { contrastMax: sharedResMax })
    );
    const rStats = computeResidualStats(data.residualPlus);
    renderCell(
      cResPlus,
      startX + (cellW + gapX) * 2,
      row2Y,
      '残差 ΔI (+0.65λ)',
      '[-]蓝/[+]红',
      `max|r|: ${rStats.maxAbs.toExponential(2)}`
    );
  }

  // 6. Right side panel: Wavefront and parameters
  const panelX = startX + (cellW + gapX) * 3;
  const panelW = width - panelX - 30;

  // Wavefront sub-canvas
  if (data.wavefront) {
    const cWavefront = createSubCanvas((subCtx) =>
      drawWavefrontToCanvas(subCtx, data.wavefront!)
    );
    const wStats = computeWavefrontStats(data.wavefront);

    ctx.fillStyle = '#182234';
    ctx.strokeStyle = '#2a3850';
    ctx.fillRect(panelX, startY - 24, panelW, cellH + 54);
    ctx.strokeRect(panelX, startY - 24, panelW, cellH + 54);

    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('光瞳波前 W(u,v)', panelX + 10, startY - 10);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '10px monospace';
    ctx.fillText('waves (λ)', panelX + panelW - 65, startY - 10);

    if (cWavefront) {
      ctx.imageSmoothingEnabled = false;
      const wfSize = 130;
      ctx.drawImage(cWavefront, panelX + (panelW - wfSize) / 2, startY, wfSize, wfSize);
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(`PV: ${wStats.pv.toFixed(4)}λ | RMS: ${wStats.rms.toFixed(4)}λ`, panelX + 10, startY + cellH + 16);
  }

  // Inversion summary box in right panel
  ctx.fillStyle = '#182234';
  ctx.strokeStyle = '#2a3850';
  ctx.fillRect(panelX, row2Y - 24, panelW, cellH + 54);
  ctx.strokeRect(panelX, row2Y - 24, panelW, cellH + 54);

  ctx.fillStyle = '#f1f5f9';
  ctx.font = 'bold 11px sans-serif';
  ctx.fillText('反演估计与可信度', panelX + 10, row2Y - 10);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px sans-serif';
  let lineY = row2Y + 12;

  if (data.coefficients) {
    ctx.fillText(`astig0:    ${data.coefficients.astig0.toFixed(4)} λ`, panelX + 10, lineY);
    lineY += 16;
    ctx.fillText(`comaX:     ${data.coefficients.comaX.toFixed(4)} λ`, panelX + 10, lineY);
    lineY += 16;
    ctx.fillText(`spherical: ${data.coefficients.spherical.toFixed(4)} λ`, panelX + 10, lineY);
    lineY += 20;
  }

  if (data.loss !== undefined) {
    ctx.fillStyle = '#38bdf8';
    ctx.fillText(`Loss: ${data.loss.toExponential(4)}`, panelX + 10, lineY);
    lineY += 16;
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '9px sans-serif';
  ctx.fillText('FR13: 残差采用蓝(-)红(+)发散标度', panelX + 10, lineY);
  lineY += 14;
  ctx.fillText('纯物理归一拟合，对数增强仅作展示', panelX + 10, lineY);

  // 7. Footer
  ctx.fillStyle = '#121824';
  ctx.fillRect(0, height - 36, width, 36);
  ctx.fillStyle = '#64748b';
  ctx.font = '11px sans-serif';
  ctx.fillText(
    'P007 焦证仪 FocusWitness | 双焦面像差反演与局部可辨识性实验室 | 纯本地离线生成',
    20,
    height - 14
  );

  return canvas;
}

/**
 * Converts a Canvas to a PNG Blob.
 */
export function exportCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (!canvas.toBlob) {
      reject(new Error('HTMLCanvasElement.toBlob is not supported in this environment'));
      return;
    }
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create Blob from canvas'));
        }
      },
      'image/png'
    );
  });
}

/**
 * Converts a Canvas to a PNG Data URL string.
 */
export function exportCanvasToDataUrl(canvas: HTMLCanvasElement): string {
  if (!canvas.toDataURL) {
    throw new Error('HTMLCanvasElement.toDataURL is not supported in this environment');
  }
  return canvas.toDataURL('image/png');
}

/**
 * Triggers a browser file download of the canvas content as a PNG image.
 */
export function downloadPng(canvas: HTMLCanvasElement, filename = 'focuswitness-view.png'): void {
  if (typeof document === 'undefined') return;
  const dataUrl = exportCanvasToDataUrl(canvas);
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
