/**
 * P007 FocusWitness — Shell Component
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, FR01, FR02, FR13
 * 
 * Layout Architecture:
 * - Top: Sticky Header with FocusWitness title, quick status, and primary actions
 * - 3-Column Desktop Grid (>= 1200px) / Stacked Narrow Layout (< 1200px):
 *   - Left: Optical / Experiment Configuration (Controls, Sliders, Truth Switch, Zernike Legend)
 *   - Center: Evidence Matrix (Observed, Reprojected, Residual panels for ±0.65 waves)
 *   - Right: Inversion & Credibility (Mode single/dual, recovered coeffs, loss, LM trace, Fisher spectrum)
 * - Bottom: Audit Footer (Iteration timeline slot, physical assumptions, export shortcuts)
 */

import React from 'react';
import '../app.css';
import { Controls, type ControlsProps, type StatusType } from './Controls';
import { MetricsLegend } from './MetricsLegend';
import { DIVERSITY_DEFOCUS_MINUS, DIVERSITY_DEFOCUS_PLUS } from '../domain/constants';

export interface ShellProps {
  title?: string;
  subtitle?: string;
  status?: StatusType;
  headerSlot?: React.ReactNode;
  leftSlot?: React.ReactNode;
  centerSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
  bottomSlot?: React.ReactNode;
  controlsProps?: ControlsProps;
  className?: string;
}

export const Shell: React.FC<ShellProps> = ({
  title = 'FocusWitness 焦证仪',
  subtitle = '双焦面像差反演与局部可辨识性实验室',
  status = 'idle',
  headerSlot,
  leftSlot,
  centerSlot,
  rightSlot,
  bottomSlot,
  controlsProps,
  className = '',
}) => {
  return (
    <div className={`fw-app ${className}`} data-testid="focuswitness-shell">
      {/* Top Navigation / App Header (Section 4.1) */}
      <header className="fw-header" role="banner" data-testid="shell-header">
        <div className="fw-header-title-group">
          <h1 className="fw-header-title">{title}</h1>
          <span className="fw-header-subtitle">{subtitle}</span>
        </div>

        {headerSlot ? (
          <div className="fw-header-actions">{headerSlot}</div>
        ) : (
          <div className="fw-header-status-area">
            <span style={{ fontSize: '0.8rem', color: 'var(--fw-text-muted)' }}>
              离散规格：64×64 网格 | R=16px
            </span>
          </div>
        )}
      </header>

      {/* Main 3-Column Application Layout */}
      <main className="fw-layout" role="main" data-testid="shell-main-layout">
        {/* Left Column: Optical & Experiment Configuration */}
        <aside
          className="fw-col fw-col-left"
          aria-label="光瞳与实验配置"
          data-testid="shell-col-left"
        >
          {leftSlot ? (
            leftSlot
          ) : (
            <>
              <Controls status={status} {...controlsProps} />
              <MetricsLegend />
            </>
          )}
        </aside>

        {/* Center Column: Evidence Matrix (PSF & Residuals) */}
        <section
          className="fw-col fw-col-center"
          aria-label="证据矩阵与像差对比"
          data-testid="shell-col-center"
        >
          {centerSlot ? (
            centerSlot
          ) : (
            <div className="fw-panel fw-evidence-matrix" data-testid="evidence-matrix-placeholder">
              <div className="fw-panel-header">
                <h2 className="fw-panel-title">
                  <span>证据矩阵 (Evidence Matrix)</span>
                </h2>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span className="fw-panel-badge">64×64 统一分辨率</span>
                  <span className="fw-panel-badge">log10(I+1e-8) 显示</span>
                </div>
              </div>

              <div className="fw-panel-body">
                <p className="fw-field-desc">
                  同屏并置观测光强、当前参数重投影光强及二者带符号差值残差，保证相同物理分辨率与统一色标标度。
                </p>

                {/* 6-cell evidence matrix grid */}
                <div className="fw-matrix-grid">
                  {/* Row 1: Observed PSFs */}
                  <div className="fw-matrix-cell" data-testid="cell-obs-minus">
                    <div className="fw-matrix-cell-header">
                      <span>观测焦面 I_obs ({DIVERSITY_DEFOCUS_MINUS}λ)</span>
                      <span className="fw-panel-badge">离焦 -0.65</span>
                    </div>
                    <div className="fw-matrix-cell-content" aria-label="负离焦观测光斑插槽">
                      <span>观测 PSF (-0.65λ) 视图插槽 (T011)</span>
                    </div>
                  </div>

                  <div className="fw-matrix-cell" data-testid="cell-obs-plus">
                    <div className="fw-matrix-cell-header">
                      <span>观测焦面 I_obs (+{DIVERSITY_DEFOCUS_PLUS}λ)</span>
                      <span className="fw-panel-badge">离焦 +0.65</span>
                    </div>
                    <div className="fw-matrix-cell-content" aria-label="正离焦观测光斑插槽">
                      <span>观测 PSF (+0.65λ) 视图插槽 (T011)</span>
                    </div>
                  </div>

                  {/* Row 2: Reprojected PSFs */}
                  <div className="fw-matrix-cell" data-testid="cell-reproj-minus">
                    <div className="fw-matrix-cell-header">
                      <span>重投影 I_mod ({DIVERSITY_DEFOCUS_MINUS}λ)</span>
                      <span className="fw-panel-badge">当前估计</span>
                    </div>
                    <div className="fw-matrix-cell-content" aria-label="负离焦重投影光斑插槽">
                      <span>重投影 PSF (-0.65λ) 视图插槽 (T011)</span>
                    </div>
                  </div>

                  <div className="fw-matrix-cell" data-testid="cell-reproj-plus">
                    <div className="fw-matrix-cell-header">
                      <span>重投影 I_mod (+{DIVERSITY_DEFOCUS_PLUS}λ)</span>
                      <span className="fw-panel-badge">当前估计</span>
                    </div>
                    <div className="fw-matrix-cell-content" aria-label="正离焦重投影光斑插槽">
                      <span>重投影 PSF (+0.65λ) 视图插槽 (T011)</span>
                    </div>
                  </div>

                  {/* Row 3: Residual Heatmaps */}
                  <div className="fw-matrix-cell" data-testid="cell-res-minus">
                    <div className="fw-matrix-cell-header">
                      <span>残差 ΔI ({DIVERSITY_DEFOCUS_MINUS}λ)</span>
                      <span className="fw-res-tag-neg">[-] 蓝 / [+] 红</span>
                    </div>
                    <div className="fw-matrix-cell-content" aria-label="负离焦残差热图插槽">
                      <span>差值残差 (-0.65λ) 视图插槽 (T011)</span>
                    </div>
                  </div>

                  <div className="fw-matrix-cell" data-testid="cell-res-plus">
                    <div className="fw-matrix-cell-header">
                      <span>残差 ΔI (+{DIVERSITY_DEFOCUS_PLUS}λ)</span>
                      <span className="fw-res-tag-pos">[-] 蓝 / [+] 红</span>
                    </div>
                    <div className="fw-matrix-cell-content" aria-label="正离焦残差热图插槽">
                      <span>差值残差 (+0.65λ) 视图插槽 (T011)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="fw-panel-footer">
                <span>残差标量极值说明：所有残差热图均标注标量数值范围，不单依赖伪彩色区分。</span>
              </div>
            </div>
          )}
        </section>

        {/* Right Column: Inversion & Credibility Analysis */}
        <aside
          className="fw-col fw-col-right"
          aria-label="反演与可信度分析"
          data-testid="shell-col-right"
        >
          {rightSlot ? (
            rightSlot
          ) : (
            <>
              {/* Inversion Summary Panel */}
              <div className="fw-panel" data-testid="inversion-panel-placeholder">
                <div className="fw-panel-header">
                  <h2 className="fw-panel-title">
                    <span>反演结果与参数估计</span>
                  </h2>
                  <span className="fw-panel-badge">LM 优化器</span>
                </div>
                <div className="fw-panel-body">
                  <table className="fw-est-table" aria-label="当前估计参数与真值对比">
                    <thead>
                      <tr>
                        <th scope="col">像差模式</th>
                        <th scope="col">当前估计</th>
                        <th scope="col">参考真值</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>0° 像散 (a_astig0)</td>
                        <td>0.0000 λ</td>
                        <td>—</td>
                      </tr>
                      <tr>
                        <td>x-彗差 (a_comaX)</td>
                        <td>0.0000 λ</td>
                        <td>—</td>
                      </tr>
                      <tr>
                        <td>初级球差 (a_sph)</td>
                        <td>0.0000 λ</td>
                        <td>—</td>
                      </tr>
                    </tbody>
                  </table>

                  <div className="fw-info-box" style={{ marginTop: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>当前残差平方和 (Loss)：</span>
                      <strong style={{ fontFamily: 'var(--fw-font-mono)' }}>未启动计算</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span>阻尼系数 (λ_LM)：</span>
                      <span style={{ fontFamily: 'var(--fw-font-mono)' }}>0.0100</span>
                    </div>
                  </div>
                </div>
                <div className="fw-panel-footer">
                  <span>盲解启动初值恒定为 [0, 0, 0]，真值绝不传入拟合算法。</span>
                </div>
              </div>

              {/* Credibility & Fisher Information Placeholder */}
              <div className="fw-panel" data-testid="credibility-panel-placeholder">
                <div className="fw-panel-header">
                  <h3 className="fw-panel-title">
                    <span>局部可辨识性对照 (T013)</span>
                  </h3>
                  <span className="fw-panel-badge">G_single vs G_dual</span>
                </div>
                <div className="fw-panel-body">
                  <div className="fw-matrix-cell-content" style={{ minHeight: '120px' }}>
                    <span>单/双焦面信息矩阵特征值谱与局部奇异值插槽 (T013)</span>
                  </div>
                </div>
                <div className="fw-panel-footer">
                  <span>特征值对照统一在双焦面最终估计点求值，避免参数差异导致误判。</span>
                </div>
              </div>
            </>
          )}
        </aside>
      </main>

      {/* Bottom Area: Timeline, Audit & Physical Simplifications Note */}
      <footer className="fw-footer" role="contentinfo" data-testid="shell-footer">
        {bottomSlot ? (
          bottomSlot
        ) : (
          <>
            <div className="fw-footer-notes">
              <strong>P007 焦证仪 (FocusWitness) 物理学简化说明：</strong>
              <span>
                单色标量远场 Fraunhofer 衍射模型；圆孔径无中心遮挡；已知固定离焦 ±0.65 waves；3 阶像差估计范围 [-0.15, +0.15] waves。
              </span>
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--fw-text-subtle)', textAlign: 'right' }}>
              <span>FocusWitness UI 核心骨架 | 纯本地样式与离线渲染</span>
            </div>
          </>
        )}
      </footer>
    </div>
  );
};
