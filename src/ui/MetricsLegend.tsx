/**
 * P007 FocusWitness — Metrics and Scales Legend
 * Specifications: PROJECT_BOOK.md Section 4.1, 4.2, 5.1, 5.5, FR05, FR13
 * 
 * Guarantees:
 * - Clear annotation of Zernike polynomial terms (Z22, Z31, Z40) and formulas
 * - Units definition: physical bounds [-0.15, 0.15] waves (lambda)
 * - Known diversity defocus planes (-0.65 and +0.65 waves)
 * - Display log scale vs linear fitting distinction
 * - Diverging residual scale with explicit +/- signs and text labels (FR13)
 */

import React from 'react';
import {
  COEFFICIENT_MIN,
  COEFFICIENT_MAX,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
  GRID_SIZE,
  PUPIL_RADIUS_PX,
} from '../domain/constants';

export interface MetricsLegendProps {
  className?: string;
  compact?: boolean;
}

export const MetricsLegend: React.FC<MetricsLegendProps> = ({
  className = '',
  compact = false,
}) => {
  return (
    <div className={`fw-panel fw-legend-panel ${className}`} data-testid="metrics-legend">
      <div className="fw-panel-header">
        <h3 className="fw-panel-title">
          <span>量纲与色标图例</span>
        </h3>
        <span className="fw-panel-badge">FR05 / FR13 规范</span>
      </div>

      <div className="fw-panel-body">
        {/* Zernike Modes Reference */}
        <div className="fw-field-group">
          <div className="fw-field-label">
            <span>待估像差基底 (Zernike 模式)</span>
            <span className="fw-field-desc">单位: waves (λ)</span>
          </div>

          <table className="fw-legend-table" aria-label="Zernike像差模式定义与物理边界">
            <thead>
              <tr>
                <th scope="col">模式</th>
                <th scope="col">物理像差</th>
                <th scope="col">归一化多项式</th>
                <th scope="col">取值区间</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Z22 (0°)</strong></td>
                <td>像散 (Astigmatism)</td>
                <td><code>√6·(u² - v²)</code></td>
                <td>[{COEFFICIENT_MIN}, +{COEFFICIENT_MAX}]</td>
              </tr>
              <tr>
                <td><strong>Z31 (x)</strong></td>
                <td>x-彗差 (Coma)</td>
                <td><code>√8·(3r² - 2)·u</code></td>
                <td>[{COEFFICIENT_MIN}, +{COEFFICIENT_MAX}]</td>
              </tr>
              <tr>
                <td><strong>Z40</strong></td>
                <td>球差 (Spherical)</td>
                <td><code>√5·(6r⁴ - 6r² + 1)</code></td>
                <td>[{COEFFICIENT_MIN}, +{COEFFICIENT_MAX}]</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* FR13: Diverging Residual Scale with explicit +/- signs and text tags */}
        <div className="fw-field-group">
          <div className="fw-field-label">
            <span>残差色标说明 (FR13: 禁止仅靠颜色区分)</span>
            <span className="fw-field-desc">ΔI = I_obs - I_reproj</span>
          </div>

          <div
            className="fw-res-legend"
            role="region"
            aria-label="残差色标图例，包含正负符号与文字标签"
          >
            <div className="fw-res-scale-bar" aria-hidden="true" />
            <div className="fw-res-scale-labels">
              <span className="fw-res-tag-neg" data-testid="res-tag-neg">
                <strong>[-]</strong> 负残差 (观测 &lt; 重投影)
              </span>
              <span className="fw-res-tag-zero" data-testid="res-tag-zero">
                <strong>[0]</strong> 吻合
              </span>
              <span className="fw-res-tag-pos" data-testid="res-tag-pos">
                <strong>[+]</strong> 正残差 (观测 &gt; 重投影)
              </span>
            </div>
            <p className="fw-field-desc" style={{ marginTop: '4px' }}>
              色标采用统一发散配色：青蓝色标注观测低于重投影的负亏损区，洋红暖色标注观测高于重投影的正过剩区。残差图附带数值标量极值 (min / max)。
            </p>
          </div>
        </div>

        {!compact && (
          <>
            {/* Display Transformation Notice */}
            <div className="fw-field-group">
              <div className="fw-field-label">
                <span>光强显示 vs 数值拟合约定</span>
              </div>
              <div className="fw-info-box">
                <p>
                  <strong>显示变换：</strong>光强图像默认采用 <code>log10(I + 1e-8)</code> 对数增强显示，以便观察弱衍射环；
                </p>
                <p style={{ marginTop: '4px' }}>
                  <strong>数值计算：</strong>逆向拟合与梯度求解始终基于<strong>纯物理线性归一化强度</strong> (每平面总能量和为 1.0)，显示变换绝不参与任何优化。
                </p>
              </div>
            </div>

            {/* Diversity and Discrete Geometry */}
            <div className="fw-field-group">
              <div className="fw-field-label">
                <span>离散系统几何与离焦多样性</span>
              </div>
              <ul style={{ fontSize: '0.78rem', color: 'var(--fw-text-muted)', paddingLeft: '1.2rem', lineHeight: '1.6' }}>
                <li>离散网格：{GRID_SIZE} × {GRID_SIZE} (4096 像素)，光瞳半径 R = {PUPIL_RADIUS_PX} px</li>
                <li>离焦多样性基底：负焦面 <code>{DIVERSITY_DEFOCUS_MINUS} waves</code>，正焦面 <code>+{DIVERSITY_DEFOCUS_PLUS} waves</code></li>
                <li>单焦模式仅拟合 <code>{DIVERSITY_DEFOCUS_MINUS}</code> 面；双焦模式联合拟合 <code>{DIVERSITY_DEFOCUS_MINUS}</code> 与 <code>+{DIVERSITY_DEFOCUS_PLUS}</code> 两面</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
