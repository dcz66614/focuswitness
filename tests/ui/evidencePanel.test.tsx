/**
 * P007 FocusWitness — EvidencePanel UI Acceptance Tests
 * Task: TASK-P007-T013
 * Specifications: PROJECT_BOOK.md Section 5.5, FR06
 *
 * Requirements & Verifications:
 * 1. Display 3 local singular values (单焦 3 个, 双焦 3 个: sqrt(e1), sqrt(e2), sqrt(e3))
 * 2. Display comparison reference point (共同参考点 a_ref: a_astig0, a_comaX, a_spherical, 保证同点线性化)
 * 3. Strict boundary warning: 不可等同概率或全局唯一 (LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE, 局部线性化灵敏度比)
 * 4. Incomplete state handling: 未完成双焦拟合时明确显示未完成状态，绝不伪造或编造分析值
 * 5. Monotonicity and positive semi-definiteness: 验证迹不下降与最小特征值不下降
 * 6. Fallback integrity: 防止使用不同参考点造成误导
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EvidencePanel,
  EVIDENCE_PANEL_TITLE,
  EVIDENCE_BOUNDARY_ALERT_TITLE,
  EVIDENCE_INCOMPLETE_TEXT,
  type EvidencePanelProps,
} from '../../src/ui/EvidencePanel';
import {
  analyzeLocal,
  LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE,
  type LocalAnalysisResult,
} from '../../src/math/identifiable';
import {
  PRESET_MIXED,
  PRESET_ASTIG_ONLY,
  PRESET_COMA_ONLY,
  PRESET_SPHERICAL_ONLY,
  PRESET_PERFECT,
} from '../../src/domain/presets';
import { formatScientific, formatCoeffWave } from '../../src/ui/HistoryPlot';
import type { Coefficients, FitResult, InformationSpectrum } from '../../src/domain/types';

describe('P007-T013 EvidencePanel Acceptance Suite', () => {
  const referenceMixed: Coefficients = {
    astig0: 0.08,
    comaX: -0.06,
    spherical: 0.04,
  };

  describe('1. Display of 3 Local Singular Values (3个局部奇异值显示, FR06 & 5.5)', () => {
    it('displays exactly 3 singular values for both single and dual planes at common a_ref', () => {
      const analysis = analyzeLocal(referenceMixed);
      const html = renderToStaticMarkup(<EvidencePanel reference={referenceMixed} isDualFitComplete={true} />);

      // Must render singular values table
      expect(html).toContain('data-testid="singular-values-table"');

      // Must render rows for mode 0, 1, 2
      expect(html).toContain('data-testid="singular-row-0"');
      expect(html).toContain('data-testid="singular-row-1"');
      expect(html).toContain('data-testid="singular-row-2"');

      // Check single-plane 3 singular values
      expect(html).toContain('data-testid="singular-val-single-0"');
      expect(html).toContain('data-testid="singular-val-single-1"');
      expect(html).toContain('data-testid="singular-val-single-2"');

      // Check dual-plane 3 singular values
      expect(html).toContain('data-testid="singular-val-dual-0"');
      expect(html).toContain('data-testid="singular-val-dual-1"');
      expect(html).toContain('data-testid="singular-val-dual-2"');

      // Check formatted values match math oracle sqrt(ei)
      expect(html).toContain(formatScientific(analysis.singularValuesSingle[0], 4));
      expect(html).toContain(formatScientific(analysis.singularValuesSingle[1], 4));
      expect(html).toContain(formatScientific(analysis.singularValuesSingle[2], 4));

      expect(html).toContain(formatScientific(analysis.singularValuesDual[0], 4));
      expect(html).toContain(formatScientific(analysis.singularValuesDual[1], 4));
      expect(html).toContain(formatScientific(analysis.singularValuesDual[2], 4));
    });

    it('verifies singular values are the square roots of the Jacobi eigenvalues', () => {
      const analysis = analyzeLocal(referenceMixed);
      expect(analysis.singularValuesSingle[0]).toBeCloseTo(Math.sqrt(analysis.eigenSingle[0]), 12);
      expect(analysis.singularValuesSingle[1]).toBeCloseTo(Math.sqrt(analysis.eigenSingle[1]), 12);
      expect(analysis.singularValuesSingle[2]).toBeCloseTo(Math.sqrt(analysis.eigenSingle[2]), 12);

      expect(analysis.singularValuesDual[0]).toBeCloseTo(Math.sqrt(analysis.eigenDual[0]), 12);
      expect(analysis.singularValuesDual[1]).toBeCloseTo(Math.sqrt(analysis.eigenDual[1]), 12);
      expect(analysis.singularValuesDual[2]).toBeCloseTo(Math.sqrt(analysis.eigenDual[2]), 12);
    });

    it('displays gain ratios indicating monotonicity from single to dual plane', () => {
      const html = renderToStaticMarkup(<EvidencePanel reference={referenceMixed} isDualFitComplete={true} />);
      expect(html).toContain('data-testid="singular-ratio-0"');
      expect(html).toContain('data-testid="singular-ratio-1"');
      expect(html).toContain('data-testid="singular-ratio-2"');
      expect(html).toContain('▲ 增益');
    });

    it('evaluates and displays valid 3 singular values across all standard presets', () => {
      const presets = [
        PRESET_PERFECT,
        PRESET_MIXED,
        PRESET_ASTIG_ONLY,
        PRESET_COMA_ONLY,
        PRESET_SPHERICAL_ONLY,
      ];

      for (const preset of presets) {
        const html = renderToStaticMarkup(
          <EvidencePanel reference={preset.coefficients} isDualFitComplete={true} />
        );
        expect(html).toContain('data-testid="singular-values-table"');
        expect(html).toContain('data-testid="singular-val-single-0"');
        expect(html).toContain('data-testid="singular-val-dual-2"');
      }
    });
  });

  describe('2. Common Reference Point Display & Integrity (比较参考点 a_ref, Section 5.5)', () => {
    it('displays common reference point with all three coefficients and explicit λ units', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      expect(html).toContain('data-testid="evidence-reference-point"');
      expect(html).toContain('共同比较参考点 a_ref');

      // All 3 coefficient items
      expect(html).toContain('data-testid="ref-coeff-item-astig0"');
      expect(html).toContain('data-testid="ref-coeff-item-comaX"');
      expect(html).toContain('data-testid="ref-coeff-item-spherical"');

      // Values with explicit signs and λ units
      expect(html).toContain(formatCoeffWave(referenceMixed.astig0)); // +0.0800 λ
      expect(html).toContain(formatCoeffWave(referenceMixed.comaX));  // -0.0600 λ
      expect(html).toContain(formatCoeffWave(referenceMixed.spherical)); // +0.0400 λ
    });

    it('explicitly guarantees and explains that single and dual are linearized at the SAME point', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      expect(html).toContain('data-testid="reference-guarantee-tag"');
      expect(html).toContain('J_single(a_ref) 与 J_dual(a_ref) 同点线性化');
      expect(html).toContain('为避免不同工作点切空间差异导致的虚假对比');
      expect(html).toContain('严格在双焦面最终估计值 a_ref 处求值比较');
    });

    it('automatically extracts reference point from completed dualFitResult estimate', () => {
      const mockDualFit: FitResult = {
        status: 'converged',
        mode: 'dual',
        estimate: { astig0: 0.05, comaX: -0.02, spherical: 0.03 },
        initialLoss: 0.01,
        finalLoss: 1e-15,
        history: [],
        fittedPlanes: [-0.65, 0.65],
      };

      const html = renderToStaticMarkup(<EvidencePanel dualFitResult={mockDualFit} />);

      expect(html).toContain('data-testid="evidence-reference-point"');
      expect(html).toContain(formatCoeffWave(mockDualFit.estimate.astig0));
      expect(html).toContain(formatCoeffWave(mockDualFit.estimate.comaX));
      expect(html).toContain(formatCoeffWave(mockDualFit.estimate.spherical));
    });
  });

  describe('3. Strict Boundary Warning: 不可等同概率或全局唯一 (Section 5.5, FR06)', () => {
    it('prominently renders the boundary warning alert banner', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      expect(html).toContain('data-testid="evidence-boundary-alert"');
      expect(html).toContain('role="alert"');
      expect(html).toContain(EVIDENCE_BOUNDARY_ALERT_TITLE);
    });

    it('strictly includes LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE text', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      expect(html).toContain(LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE);
      expect(html).toContain('局部可辨识不等于全局唯一解');
      expect(html).toContain('非概率置信度');
      expect(html).toContain('严禁夸大为物理参数的全局唯一性证明');
    });

    it('explicitly states that metrics cannot be equated to probability or global uniqueness', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      expect(html).toContain('不可等同概率或全局唯一');
      expect(html).toContain('条件数与 3 个奇异值仅为局部线性化切空间的灵敏度比');
      expect(html).toContain('非贝叶斯置信区间');
    });

    it('renders the boundary warning even in incomplete state to educate the user', () => {
      const html = renderToStaticMarkup(<EvidencePanel />);

      expect(html).toContain('data-testid="evidence-boundary-alert"');
      expect(html).toContain('不可等同概率或全局唯一');
      expect(html).toContain(LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE);
    });
  });

  describe('4. Incomplete State Handling & Zero Fabrication Guarantee (未完成状态与绝不伪造分析值)', () => {
    it('displays incomplete state when rendered without props and NEVER forges analysis values', () => {
      const html = renderToStaticMarkup(<EvidencePanel />);

      // Incomplete status badge & state box
      expect(html).toContain('data-testid="evidence-status-badge"');
      expect(html).toContain('未完成');
      expect(html).toContain('data-testid="evidence-incomplete-state"');
      expect(html).toContain(EVIDENCE_INCOMPLETE_TEXT);
      expect(html).toContain('绝不伪造、编造或推测分析值');

      // STRICT REQUIREMENT: NEVER forge or fabricate analysis values
      expect(html).not.toContain('data-testid="singular-values-table"');
      expect(html).not.toContain('data-testid="singular-val-single-0"');
      expect(html).not.toContain('data-testid="singular-val-dual-0"');
      expect(html).not.toContain('data-testid="trace-single"');
      expect(html).not.toContain('data-testid="cond-single"');
    });

    it('displays incomplete state when dualFitResult is null or undefined', () => {
      const html = renderToStaticMarkup(<EvidencePanel dualFitResult={null} />);

      expect(html).toContain('data-testid="evidence-incomplete-state"');
      expect(html).toContain(EVIDENCE_INCOMPLETE_TEXT);
      expect(html).not.toContain('data-testid="singular-values-table"');
    });

    it('displays cancelled message when dual fit was cancelled and never shows fake values', () => {
      const mockCancelledFit: FitResult = {
        status: 'cancelled',
        mode: 'dual',
        estimate: { astig0: 0.01, comaX: 0.02, spherical: 0.03 },
        initialLoss: 0.05,
        finalLoss: 0.04,
        history: [],
        fittedPlanes: [-0.65, 0.65],
      };

      const html = renderToStaticMarkup(<EvidencePanel dualFitResult={mockCancelledFit} />);

      expect(html).toContain('data-testid="evidence-incomplete-state"');
      expect(html).toContain('双焦拟合已取消 — 未完成同点比较');
      expect(html).toContain('当前不显示伪造分析值');
      expect(html).not.toContain('data-testid="singular-values-table"');
    });

    it('honors isDualFitComplete=false override even if reference or analysisResult is passed', () => {
      const analysis = analyzeLocal(referenceMixed);

      // Even if analysisResult is passed, if isDualFitComplete is false, MUST show incomplete!
      const html = renderToStaticMarkup(
        <EvidencePanel
          analysisResult={analysis}
          reference={referenceMixed}
          isDualFitComplete={false}
        />
      );

      expect(html).toContain('data-testid="evidence-incomplete-state"');
      expect(html).toContain(EVIDENCE_INCOMPLETE_TEXT);
      expect(html).not.toContain('data-testid="singular-values-table"');
    });

    it('safely handles invalid reference coefficients without throwing or fabricating values', () => {
      const invalidRef: any = {
        astig0: NaN,
        comaX: 0.5, // outside [-0.15, 0.15]
        spherical: 'invalid',
      };

      const html = renderToStaticMarkup(
        <EvidencePanel reference={invalidRef} isDualFitComplete={true} />
      );

      expect(html).toContain('data-testid="evidence-incomplete-state"');
      expect(html).toContain('参考点系数无效 — 无法计算信息谱');
      expect(html).not.toContain('data-testid="singular-values-table"');
    });
  });

  describe('5. Information Spectrum Diagnostic Metrics & Monotonicity (5.5 信息矩阵诊断指标)', () => {
    it('displays Gram matrix traces and confirms trace monotonicity Tr(G_d) >= Tr(G_s)', () => {
      const analysis = analyzeLocal(referenceMixed);
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      expect(html).toContain('data-testid="card-trace-metrics"');
      expect(html).toContain('data-testid="trace-single"');
      expect(html).toContain('data-testid="trace-dual"');
      expect(html).toContain('data-testid="trace-delta"');
      expect(html).toContain(analysis.traceSingle.toFixed(6));
      expect(html).toContain(analysis.traceDual.toFixed(6));
      expect(html).toContain('✓ 满足 G_d - G_s 半正定：迹单调不下降');
    });

    it('displays condition numbers kappa for both single and dual models', () => {
      const analysis = analyzeLocal(referenceMixed);
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      expect(html).toContain('data-testid="card-condition-number"');
      expect(html).toContain('data-testid="cond-single"');
      expect(html).toContain('data-testid="cond-dual"');
      expect(html).toContain(analysis.conditionNumberSingle.toFixed(2));
      expect(html).toContain(analysis.conditionNumberDual.toFixed(2));
      expect(html).toContain('局部条件数 κ = σ₁ / max(σ₃, 10⁻¹⁴)');
    });

    it('displays bottleneck eigenvalue e3 and confirms non-decreasing bottleneck sensitivity', () => {
      const analysis = analyzeLocal(referenceMixed);
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      expect(html).toContain('data-testid="eigen-bottleneck-dual"');
      expect(html).toContain(formatScientific(analysis.eigenDual[2], 3));
      expect(html).toContain('✓ 瓶颈特征值不下降 (e_dual,3 ≥ e_single,3)');
    });

    it('displays eigenvalue spectra for both single and dual Gram matrices', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      expect(html).toContain('data-testid="card-eigenvalues"');
      expect(html).toContain('Gram 矩阵特征谱 (e₁ ≥ e₂ ≥ e₃ ≥ 0)');
      expect(html).toContain('G_dual = G_single + J₊ᵀJ₊');
    });
  });

  describe('6. Input Types & Integration Flexibility (支持直接传入分析结果或拟合对象)', () => {
    it('accepts pre-computed LocalAnalysisResult directly', () => {
      const analysis = analyzeLocal(referenceMixed);
      const html = renderToStaticMarkup(<EvidencePanel analysisResult={analysis} />);

      expect(html).toContain('data-testid="singular-values-table"');
      expect(html).toContain(formatScientific(analysis.singularValuesSingle[0], 4));
      expect(html).toContain(formatScientific(analysis.singularValuesDual[0], 4));
    });

    it('accepts InformationSpectrum interface and derives singular values automatically', () => {
      const spectrum: InformationSpectrum = {
        reference: referenceMixed,
        eigenSingle: [0.0716, 0.0327, 0.0155],
        eigenDual: [0.1241, 0.0762, 0.0235],
      };

      const html = renderToStaticMarkup(<EvidencePanel analysisResult={spectrum} />);

      expect(html).toContain('data-testid="singular-values-table"');
      const expectedS0 = Math.sqrt(spectrum.eigenSingle[0]);
      expect(html).toContain(formatScientific(expectedS0, 4));
    });

    it('supports completed dualFitResult with max_iterations or stalled', () => {
      const mockStalledFit: FitResult = {
        status: 'max_iterations',
        mode: 'dual',
        estimate: { astig0: 0.03, comaX: 0.01, spherical: -0.02 },
        initialLoss: 0.02,
        finalLoss: 1e-6,
        history: [],
        fittedPlanes: [-0.65, 0.65],
      };

      const html = renderToStaticMarkup(<EvidencePanel dualFitResult={mockStalledFit} />);

      expect(html).toContain('data-testid="singular-values-table"');
      expect(html).toContain(formatCoeffWave(mockStalledFit.estimate.astig0));
    });

    it('renders current UI mode info when mode prop is provided', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel
          reference={referenceMixed}
          isDualFitComplete={true}
          mode="single"
        />
      );

      expect(html).toContain('data-testid="evidence-current-mode"');
      expect(html).toContain('当前显示模式: 单焦面 (single)');
    });
  });

  describe('7. Semantic HTML, Accessibility & Styling (语义与无障碍)', () => {
    it('renders semantic landmarks, region role, and accessible label', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      expect(html).toContain('role="region"');
      expect(html).toContain('aria-label="局部证据与信息谱面板"');
      expect(html).toContain(EVIDENCE_PANEL_TITLE);
    });

    it('attaches custom className and style if provided', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel
          reference={referenceMixed}
          isDualFitComplete={true}
          className="custom-evidence-class"
          style={{ marginTop: '20px' }}
        />
      );

      expect(html).toContain('custom-evidence-class');
      expect(html).toContain('margin-top:20px');
    });
  });

  describe('8. Text Readability & High Contrast on Light Surfaces (TASK-P007-FIX-R1-B002)', () => {
    it('guarantees all single-plane singular value cells have explicit dark foreground color #212529', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      // Single singular values must explicitly set color:#212529, never inheriting global light #f1f5f9
      for (let idx = 0; idx < 3; idx++) {
        const singleValMatch = html.match(new RegExp(`<td[^>]*data-testid="singular-val-single-${idx}"[^>]*>`))?.[0];
        expect(singleValMatch).toBeDefined();
        expect(singleValMatch).toContain('color:#212529');
      }
    });

    it('guarantees table headers and dual-plane values have high-contrast dark text', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      // Thead headers must explicitly set color:#212529
      expect(html).toContain('<thead style="background-color:#f1f3f5;color:#212529">');
      expect(html).toContain('color:#212529;font-weight:600">奇异值主模态</th>');

      // Dual singular values must set high-contrast dark blue #084298
      for (let idx = 0; idx < 3; idx++) {
        const dualValMatch = html.match(new RegExp(`<td[^>]*data-testid="singular-val-dual-${idx}"[^>]*>`))?.[0];
        expect(dualValMatch).toBeDefined();
        expect(dualValMatch).toContain('color:#084298');
      }

      // Root table must include class fw-evidence-table and explicit color #212529
      expect(html).toContain('class="fw-est-table fw-evidence-table"');
    });

    it('guarantees diagnostic cards (trace, condition number, bottleneck) have explicit dark text', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      // Card 1: trace single must have explicit color #212529 (was inheriting light text)
      const traceSingleEl = html.match(/<span[^>]*data-testid="trace-single"[^>]*>/)?.[0];
      expect(traceSingleEl).toBeDefined();
      expect(traceSingleEl).toContain('color:#212529');

      // trace dual must have high-contrast #084298
      const traceDualEl = html.match(/<span[^>]*data-testid="trace-dual"[^>]*>/)?.[0];
      expect(traceDualEl).toBeDefined();
      expect(traceDualEl).toContain('color:#084298');

      // Card 2: cond single must have explicit color #212529
      const condSingleEl = html.match(/<span[^>]*data-testid="cond-single"[^>]*>/)?.[0];
      expect(condSingleEl).toBeDefined();
      expect(condSingleEl).toContain('color:#212529');

      // cond dual must have high-contrast #084298
      const condDualEl = html.match(/<span[^>]*data-testid="cond-dual"[^>]*>/)?.[0];
      expect(condDualEl).toBeDefined();
      expect(condDualEl).toContain('color:#084298');

      // eigen bottleneck must have explicit color #212529
      const eigenBottleneckEl = html.match(/<span[^>]*data-testid="eigen-bottleneck-dual"[^>]*>/)?.[0];
      expect(eigenBottleneckEl).toBeDefined();
      expect(eigenBottleneckEl).toContain('color:#212529');
    });

    it('guarantees reference point cards and coefficient values have explicit dark foreground', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      const refCard = html.match(/<div[^>]*data-testid="evidence-reference-point"[^>]*>/)?.[0];
      expect(refCard).toBeDefined();
      expect(refCard).toContain('color:#212529');

      for (const name of ['astig0', 'comaX', 'spherical']) {
        const coeffValEl = html.match(new RegExp(`<div[^>]*data-testid="ref-coeff-${name}"[^>]*>`))?.[0];
        expect(coeffValEl).toBeDefined();
        expect(coeffValEl).toContain('color:#212529');
      }
    });

    it('guarantees boundary alert and incomplete state display high-contrast dark text', () => {
      // Completed state alert
      const htmlComplete = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );
      const alertElComplete = htmlComplete.match(/<div[^>]*data-testid="evidence-boundary-alert"[^>]*>/)?.[0];
      expect(alertElComplete).toBeDefined();
      expect(alertElComplete).toContain('color:#3d2c00');

      // Incomplete state
      const htmlIncomplete = renderToStaticMarkup(<EvidencePanel />);
      const alertElIncomplete = htmlIncomplete.match(/<div[^>]*data-testid="evidence-boundary-alert"[^>]*>/)?.[0];
      expect(alertElIncomplete).toBeDefined();
      expect(alertElIncomplete).toContain('color:#3d2c00');

      const incStateEl = htmlIncomplete.match(/<div[^>]*data-testid="evidence-incomplete-state"[^>]*>/)?.[0];
      expect(incStateEl).toBeDefined();
      expect(incStateEl).toContain('color:#212529');

      const incTitleEl = htmlIncomplete.match(/<div[^>]*data-testid="evidence-incomplete-title"[^>]*>/)?.[0];
      expect(incTitleEl).toBeDefined();
      expect(incTitleEl).toContain('color:#212529');
    });
  });

  describe('9. Narrow Panel Layout & Readability Assertions (TASK-P007-FIX-R2-B005)', () => {
    it('provides an explicit horizontal scroll container for the singular values table', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      // Scroll container exists with testid and proper styling
      const scrollContainerMatch = html.match(/<div[^>]*data-testid="singular-values-scroll-container"[^>]*>/)?.[0];
      expect(scrollContainerMatch).toBeDefined();
      expect(scrollContainerMatch).toContain('overflow-x:auto');
      expect(scrollContainerMatch).toContain('class="fw-table-scroll-container"');

      // Visual scroll hint indicator is present
      expect(html).toContain('data-testid="evidence-scroll-hint"');
      expect(html).toContain('窄面板支持横向滚动');
    });

    it('sets reasonable minimum width (>= 560px) on singular values table to prevent squishing', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      const tableMatch = html.match(/<table[^>]*data-testid="singular-values-table"[^>]*>/)?.[0];
      expect(tableMatch).toBeDefined();
      expect(tableMatch).toContain('min-width:580px');
    });

    it('strictly prohibits number wrapping (white-space: nowrap) in all single and dual singular value cells', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      for (let idx = 0; idx < 3; idx++) {
        const singleCell = html.match(new RegExp(`<td[^>]*data-testid="singular-val-single-${idx}"[^>]*>`))?.[0];
        expect(singleCell).toBeDefined();
        expect(singleCell).toContain('white-space:nowrap');

        const dualCell = html.match(new RegExp(`<td[^>]*data-testid="singular-val-dual-${idx}"[^>]*>`))?.[0];
        expect(dualCell).toBeDefined();
        expect(dualCell).toContain('white-space:nowrap');

        const ratioCell = html.match(new RegExp(`<td[^>]*data-testid="singular-ratio-${idx}"[^>]*>`))?.[0];
        expect(ratioCell).toBeDefined();
        expect(ratioCell).toContain('white-space:nowrap');
      }
    });

    it('strictly prohibits vertical character stacking of modal titles and meanings', () => {
      const html = renderToStaticMarkup(
        <EvidencePanel reference={referenceMixed} isDualFitComplete={true} />
      );

      // All header cells have nowrap
      const thMatches = html.match(/<th[^>]*white-space:nowrap[^>]*>/g);
      expect(thMatches).toBeDefined();
      expect(thMatches?.length).toBe(5);

      // Modal rows retain complete 3 singular values data across both modes
      for (let idx = 0; idx < 3; idx++) {
        expect(html).toContain(`data-testid="singular-row-${idx}"`);
        expect(html).toContain(`data-testid="singular-val-single-${idx}"`);
        expect(html).toContain(`data-testid="singular-val-dual-${idx}"`);
      }
    });

    it('prevents scientific notation and ratio breaks across multiple presets', () => {
      const presets = [PRESET_PERFECT, PRESET_MIXED, PRESET_ASTIG_ONLY];
      for (const preset of presets) {
        const html = renderToStaticMarkup(
          <EvidencePanel reference={preset.coefficients} isDualFitComplete={true} />
        );
        for (let idx = 0; idx < 3; idx++) {
          const singleCell = html.match(new RegExp(`<td[^>]*data-testid="singular-val-single-${idx}"[^>]*>`))?.[0];
          expect(singleCell).toContain('white-space:nowrap');
          const dualCell = html.match(new RegExp(`<td[^>]*data-testid="singular-val-dual-${idx}"[^>]*>`))?.[0];
          expect(dualCell).toContain('white-space:nowrap');
        }
      }
    });
  });
});
