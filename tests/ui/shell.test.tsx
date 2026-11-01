/**
 * P007 FocusWitness — UI Shell, Controls, and MetricsLegend Tests
 * Task: TASK-P007-T010
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, FR01, FR02, FR13
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Shell } from '../../src/ui/Shell';
import { Controls, type ControlsProps, type StatusType } from '../../src/ui/Controls';
import { MetricsLegend } from '../../src/ui/MetricsLegend';
import {
  COEFFICIENT_MIN,
  COEFFICIENT_MAX,
  COEFFICIENT_NAMES,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
  DEFAULT_PRESET_ID,
} from '../../src/domain/constants';
import { PRESET_LIST, PRESETS } from '../../src/domain/presets';
import type { Mode, PresetId, Coefficients } from '../../src/domain/types';

/**
 * Helper to recursively locate a React element node by data-testid in a virtual tree
 */
function findElementByTestId(node: unknown, testId: string): any {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findElementByTestId(item, testId);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const el = node as { props?: { 'data-testid'?: string; children?: unknown } };
  if (el.props?.['data-testid'] === testId) {
    return el;
  }
  if (el.props?.children) {
    return findElementByTestId(el.props.children, testId);
  }
  return null;
}

describe('P007-T010 UI Foundation & Visual System', () => {
  describe('Shell Component Layout & Responsiveness (Section 4.1, FR13)', () => {
    it('renders top-level application shell with responsive CSS classes and semantic landmarks', () => {
      const html = renderToStaticMarkup(<Shell />);

      // Application root wrapper
      expect(html).toContain('class="fw-app');
      expect(html).toContain('data-testid="focuswitness-shell"');

      // Top Header banner
      expect(html).toContain('role="banner"');
      expect(html).toContain('data-testid="shell-header"');
      expect(html).toContain('FocusWitness 焦证仪');

      // 3-Column main layout
      expect(html).toContain('role="main"');
      expect(html).toContain('class="fw-layout');
      expect(html).toContain('data-testid="shell-col-left"');
      expect(html).toContain('data-testid="shell-col-center"');
      expect(html).toContain('data-testid="shell-col-right"');

      // Left column semantic aside
      expect(html).toContain('aria-label="光瞳与实验配置"');

      // Center column semantic section
      expect(html).toContain('aria-label="证据矩阵与像差对比"');

      // Right column semantic aside
      expect(html).toContain('aria-label="反演与可信度分析"');

      // Contentinfo footer
      expect(html).toContain('role="contentinfo"');
      expect(html).toContain('data-testid="shell-footer"');
      expect(html).toContain('物理学简化说明');
    });

    it('renders default evidence matrix placeholder cells with proper defocus annotations', () => {
      const html = renderToStaticMarkup(<Shell />);

      // Evidence matrix cells
      expect(html).toContain('data-testid="cell-obs-minus"');
      expect(html).toContain('data-testid="cell-obs-plus"');
      expect(html).toContain('data-testid="cell-reproj-minus"');
      expect(html).toContain('data-testid="cell-reproj-plus"');
      expect(html).toContain('data-testid="cell-res-minus"');
      expect(html).toContain('data-testid="cell-res-plus"');

      // Contains defocus planes values
      expect(html).toContain(`${DIVERSITY_DEFOCUS_MINUS}λ`);
      expect(html).toContain(`+${DIVERSITY_DEFOCUS_PLUS}λ`);
    });

    it('renders right column inversion and identifiability placeholder panels', () => {
      const html = renderToStaticMarkup(<Shell />);

      expect(html).toContain('data-testid="inversion-panel-placeholder"');
      expect(html).toContain('data-testid="credibility-panel-placeholder"');
      expect(html).toContain('局部可辨识性对照 (T013)');
      expect(html).toContain('G_single vs G_dual');
      expect(html).toContain('特征值对照统一在双焦面最终估计点求值');
    });

    it('allows slot overrides for customizable modular layout', () => {
      const customHeader = <div data-testid="custom-header">自定义顶栏</div>;
      const customLeft = <div data-testid="custom-left">自定义左栏</div>;
      const customCenter = <div data-testid="custom-center">自定义中栏</div>;
      const customRight = <div data-testid="custom-right">自定义右栏</div>;
      const customBottom = <div data-testid="custom-bottom">自定义底栏</div>;

      const html = renderToStaticMarkup(
        <Shell
          headerSlot={customHeader}
          leftSlot={customLeft}
          centerSlot={customCenter}
          rightSlot={customRight}
          bottomSlot={customBottom}
        />,
      );

      expect(html).toContain('data-testid="custom-header"');
      expect(html).toContain('data-testid="custom-left"');
      expect(html).toContain('data-testid="custom-center"');
      expect(html).toContain('data-testid="custom-right"');
      expect(html).toContain('data-testid="custom-bottom"');
    });
  });

  describe('Controls Component — Presets (FR01)', () => {
    it('contains all 5 frozen presets with mixed as default', () => {
      const html = renderToStaticMarkup(<Controls currentPreset={DEFAULT_PRESET_ID} />);

      // Preset select element
      expect(html).toContain('id="preset-select"');
      expect(html).toContain('data-testid="preset-select"');

      // 5 Presets
      expect(PRESET_LIST).toHaveLength(5);
      expect(html).toContain('value="mixed"');
      expect(html).toContain('value="perfect"');
      expect(html).toContain('value="astig-only"');
      expect(html).toContain('value="coma-only"');
      expect(html).toContain('value="spherical-only"');

      // Default label
      expect(html).toContain(PRESETS.mixed.label);
    });

    it('handles preset selection change event and dispatches callback', () => {
      const onPresetChange = vi.fn();
      const controlsEl = Controls({
        currentPreset: 'mixed',
        onPresetChange,
      });

      const selectNode = findElementByTestId(controlsEl, 'preset-select');
      expect(selectNode).not.toBeNull();
      selectNode.props.onChange({ target: { value: 'astig-only' } });

      expect(onPresetChange).toHaveBeenCalledWith('astig-only');
    });
  });

  describe('Controls Component — Mode Switch (FR04 / Section 4.1 / 4.2)', () => {
    it('renders single-mode and dual-mode entries with explicit defocus plane annotations', () => {
      const htmlDual = renderToStaticMarkup(<Controls mode="dual" />);
      expect(htmlDual).toContain('data-testid="mode-single-btn"');
      expect(htmlDual).toContain('data-testid="mode-dual-btn"');
      expect(htmlDual).toContain('aria-checked="true"');
      expect(htmlDual).toContain('双焦模式 (±0.65λ)');
      expect(htmlDual).toContain('单焦模式 (-0.65λ)');
      expect(htmlDual).toContain('双焦模式：联合负平面 (-0.65 waves) 与正平面 (+0.65 waves) 拟合');

      const htmlSingle = renderToStaticMarkup(<Controls mode="single" />);
      expect(htmlSingle).toContain('单焦模式：仅利用负多样性平面 (-0.65 waves) 拟合');
    });

    it('invokes onModeChange callback when mode buttons are clicked', () => {
      const onModeChange = vi.fn();
      const controlsEl = Controls({
        mode: 'dual',
        onModeChange,
      });

      const singleBtn = findElementByTestId(controlsEl, 'mode-single-btn');
      expect(singleBtn).not.toBeNull();
      singleBtn.props.onClick();
      expect(onModeChange).toHaveBeenCalledWith('single');

      const dualBtn = findElementByTestId(controlsEl, 'mode-dual-btn');
      expect(dualBtn).not.toBeNull();
      dualBtn.props.onClick();
      expect(onModeChange).toHaveBeenCalledWith('dual');
    });
  });

  describe('Controls Component — Aberration Sliders & Precision Inputs (FR02)', () => {
    it('renders sliders and numerical inputs for astig0, comaX, and spherical within [-0.15, 0.15]', () => {
      const sampleCoeffs: Coefficients = { astig0: 0.08, comaX: -0.06, spherical: 0.04 };
      const html = renderToStaticMarkup(
        <Controls coefficients={sampleCoeffs} showGroundTruth={true} />,
      );

      for (const name of COEFFICIENT_NAMES) {
        expect(html).toContain(`data-testid="slider-${name}"`);
        expect(html).toContain(`data-testid="input-${name}"`);
        expect(html).toContain(`min="${COEFFICIENT_MIN}"`);
        expect(html).toContain(`max="${COEFFICIENT_MAX}"`);
        expect(html).toContain('step="0.005"');
      }

      expect(html).toContain('0.080');
      expect(html).toContain('-0.060');
      expect(html).toContain('0.040');
    });

    it('triggers onCoefficientChange with clamped value on slider adjustment', () => {
      const onCoefficientChange = vi.fn();
      const controlsEl = Controls({
        coefficients: { astig0: 0, comaX: 0, spherical: 0 },
        onCoefficientChange,
      });

      const astigSlider = findElementByTestId(controlsEl, 'slider-astig0');
      expect(astigSlider).not.toBeNull();
      astigSlider.props.onChange({ target: { value: '0.12' } });
      expect(onCoefficientChange).toHaveBeenCalledWith('astig0', 0.12);

      // Clamped beyond upper bound
      astigSlider.props.onChange({ target: { value: '0.999' } });
      expect(onCoefficientChange).toHaveBeenCalledWith('astig0', COEFFICIENT_MAX);

      // Clamped beyond lower bound
      astigSlider.props.onChange({ target: { value: '-0.5' } });
      expect(onCoefficientChange).toHaveBeenCalledWith('astig0', COEFFICIENT_MIN);
    });
  });

  describe('Controls Component — Ground Truth Toggle & Blind Inversion (FR02)', () => {
    it('masks truth inputs and displays blind mode warning when truth is hidden', () => {
      const html = renderToStaticMarkup(
        <Controls
          coefficients={{ astig0: 0.08, comaX: -0.06, spherical: 0.04 }}
          showGroundTruth={false}
        />,
      );

      expect(html).toContain('data-testid="blind-mode-notice"');
      expect(html).toContain('盲解模式生效：');
      expect(html).toContain('真值像差参数已被隐藏');
      expect(html).toContain('真值严禁传入求解 API');
      expect(html).toContain('type="password"');
      expect(html).toContain('value="***"');
    });

    it('triggers onToggleGroundTruth callback when toggle switch is clicked', () => {
      const onToggleGroundTruth = vi.fn();
      const controlsEl = Controls({
        showGroundTruth: true,
        onToggleGroundTruth,
      });

      const toggleInput = findElementByTestId(controlsEl, 'toggle-ground-truth');
      expect(toggleInput).not.toBeNull();
      toggleInput.props.onChange({ target: { checked: false } });
      expect(onToggleGroundTruth).toHaveBeenCalledWith(false);
    });
  });

  describe('Controls Component — Actions and Status Indicators (Section 4.1, 4.2)', () => {
    it('renders all required action buttons with accessible labels', () => {
      const html = renderToStaticMarkup(<Controls />);

      expect(html).toContain('data-testid="btn-generate"');
      expect(html).toContain('data-testid="btn-solve"');
      expect(html).toContain('data-testid="btn-cancel"');
      expect(html).toContain('data-testid="btn-import"');
      expect(html).toContain('data-testid="btn-export"');
      expect(html).toContain('data-testid="file-import-input"');
    });

    it('triggers callbacks when action buttons are clicked', () => {
      const onGenerate = vi.fn();
      const onSolve = vi.fn();
      const onExport = vi.fn();

      const controlsEl = Controls({
        onGenerate,
        onSolve,
        onExport,
      });

      const btnGen = findElementByTestId(controlsEl, 'btn-generate');
      btnGen.props.onClick();
      expect(onGenerate).toHaveBeenCalledTimes(1);

      const btnSolve = findElementByTestId(controlsEl, 'btn-solve');
      btnSolve.props.onClick();
      expect(onSolve).toHaveBeenCalledTimes(1);

      const btnExport = findElementByTestId(controlsEl, 'btn-export');
      btnExport.props.onClick();
      expect(onExport).toHaveBeenCalledTimes(1);
    });

    it('triggers onImport when a valid file is selected through input', () => {
      const onImport = vi.fn();
      const controlsEl = Controls({ onImport });

      const fileInput = findElementByTestId(controlsEl, 'file-import-input');
      expect(fileInput).not.toBeNull();

      const mockFile = new File(['{"schema":"focuswitness.case/v1"}'], 'test.json', {
        type: 'application/json',
      });
      fileInput.props.onChange({
        target: { files: [mockFile], value: 'test.json' },
      });

      expect(onImport).toHaveBeenCalledWith(mockFile);
    });

    it('correctly renders various status badges and stale notification', () => {
      const statuses: StatusType[] = [
        'idle',
        'ready',
        'stale',
        'running',
        'converged',
        'cancelled',
        'error',
      ];

      for (const st of statuses) {
        const html = renderToStaticMarkup(<Controls status={st} />);
        expect(html).toContain(`fw-status-${st}`);
      }

      // STALE state explicitly displays warning alert box
      const staleHtml = renderToStaticMarkup(<Controls status="stale" />);
      expect(staleHtml).toContain('data-testid="stale-alert"');
      expect(staleHtml).toContain('真值系数已更新，当前观测 PSF 与拟合结果已标为 STALE');
    });

    it('disables modification buttons while solving or running', () => {
      const controlsEl = Controls({ status: 'running', isSolving: true });

      const btnCancel = findElementByTestId(controlsEl, 'btn-cancel');
      expect(btnCancel.props.disabled).toBe(false);

      const btnGen = findElementByTestId(controlsEl, 'btn-generate');
      expect(btnGen.props.disabled).toBe(true);

      const btnSolve = findElementByTestId(controlsEl, 'btn-solve');
      expect(btnSolve.props.disabled).toBe(true);

      const btnExport = findElementByTestId(controlsEl, 'btn-export');
      expect(btnExport.props.disabled).toBe(true);
    });
  });

  describe('MetricsLegend Component (FR05, FR13)', () => {
    it('renders Zernike modes Z22, Z31, Z40 formulas and units in waves', () => {
      const html = renderToStaticMarkup(<MetricsLegend />);

      expect(html).toContain('data-testid="metrics-legend"');
      expect(html).toContain('Z22 (0°)');
      expect(html).toContain('Z31 (x)');
      expect(html).toContain('Z40');
      expect(html).toContain('√6·(u² - v²)');
      expect(html).toContain('√8·(3r² - 2)·u');
      expect(html).toContain('√5·(6r⁴ - 6r² + 1)');
      expect(html).toContain('waves (λ)');
      expect(html).toContain(`[${COEFFICIENT_MIN}, +${COEFFICIENT_MAX}]`);
    });

    it('satisfies FR13: Residual scale explicitly includes text annotations [-] and [+]', () => {
      const html = renderToStaticMarkup(<MetricsLegend />);

      expect(html).toContain('FR13: 禁止仅靠颜色区分');
      expect(html).toContain('data-testid="res-tag-neg"');
      expect(html).toContain('data-testid="res-tag-zero"');
      expect(html).toContain('data-testid="res-tag-pos"');

      // Explicit +/- signs present in text
      expect(html).toContain('[-]</strong> 负残差 (观测 &lt; 重投影)');
      expect(html).toContain('[0]</strong> 吻合');
      expect(html).toContain('[+]</strong> 正残差 (观测 &gt; 重投影)');
    });

    it('clearly notes log display vs linear numerical fitting distinction (FR05)', () => {
      const html = renderToStaticMarkup(<MetricsLegend />);

      expect(html).toContain('log10(I + 1e-8)');
      expect(html).toContain('纯物理线性归一化强度');
      expect(html).toContain('显示变换绝不参与任何优化');
    });

    it('supports compact mode without extended descriptions', () => {
      const htmlCompact = renderToStaticMarkup(<MetricsLegend compact={true} />);
      expect(htmlCompact).toContain('data-testid="metrics-legend"');
      expect(htmlCompact).not.toContain('光强显示 vs 数值拟合约定');
    });
  });

  describe('Keyboard Accessibility and ARIA Semantics (FR13 / Section 4.2)', () => {
    it('has accessible roles, labels, and tabindex on interactive elements', () => {
      const html = renderToStaticMarkup(<Shell />);

      // Accessibility landmarks
      expect(html).toContain('role="banner"');
      expect(html).toContain('role="main"');
      expect(html).toContain('role="contentinfo"');
      expect(html).toContain('role="status"');
      expect(html).toContain('role="radiogroup"');
      expect(html).toContain('role="radio"');

      // Screen reader hidden file input
      expect(html).toContain('class="sr-only"');
      expect(html).toContain('aria-label="导入案例文件"');

      // Inputs have semantic label bindings (HTML output renders htmlFor as for)
      expect(html).toContain('for="preset-select"');
      expect(html).toContain('for="coeff-slider-astig0"');
      expect(html).toContain('for="coeff-slider-comaX"');
      expect(html).toContain('for="coeff-slider-spherical"');
    });
  });
});
