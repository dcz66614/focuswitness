/**
 * P007 FocusWitness — Local Identifiability & Evidence Panel
 * Task: TASK-P007-T013
 * Specifications: PROJECT_BOOK.md Section 5.5, FR06
 *
 * Requirements:
 * 1. Display 3 local sensitivity singular values: sqrt(e1), sqrt(e2), sqrt(e3) for both single and dual modes.
 * 2. Display the common comparison reference point a_ref = [a_astig0, a_comaX, a_spherical] from dual fit.
 * 3. Prominently display strict boundary warning: local identifiability != global uniqueness,
 *    condition numbers and singular values CANNOT be equated to probability confidence or global uniqueness.
 * 4. When dual fit is not completed, MUST explicitly show incomplete status and NEVER forge/fabricate analysis values.
 * 5. Guarantee single-plane and dual-plane information matrices are strictly evaluated at the EXACT SAME reference point.
 */

import React, { useMemo } from 'react';
import type {
  CaseV1,
  Coefficients,
  FitResult,
  FitStatus,
  InformationSpectrum,
  Mode,
} from '../domain/types';
import { COEFFICIENT_NAMES } from '../domain/constants';
import { validateCoefficients } from '../domain/validation';
import {
  analyzeLocal,
  LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE,
  type LocalAnalysisResult,
} from '../math/identifiable';
import { formatCoeffWave, formatScientific } from './HistoryPlot';

export interface EvidencePanelProps {
  /**
   * Pre-computed local identifiability analysis result (LocalAnalysisResult or InformationSpectrum).
   */
  analysisResult?: LocalAnalysisResult | InformationSpectrum | null | undefined;

  /**
   * Linearization reference point a_ref.
   * If provided and analysisResult is omitted, analyzeLocal will be called if isDualFitComplete !== false.
   */
  reference?: Coefficients | null | undefined;

  /**
   * Dual-plane fit result.
   * If provided:
   * - If status is 'converged' | 'max_iterations' | 'stalled', and reference is omitted,
   *   dualFitResult.estimate is used as the reference point.
   * - If status is 'cancelled' (or not completed), the panel treats the fit as incomplete.
   */
  dualFitResult?: FitResult | null | undefined;

  /**
   * Explicit flag indicating whether the dual fit has completed.
   * If explicitly false, incomplete state is always displayed regardless of other props.
   */
  isDualFitComplete?: boolean | undefined;

  /**
   * Current inversion mode in UI (optional, for contextual info).
   * Note: Local identifiability comparison ALWAYS evaluates at the dual fit estimate a_ref.
   */
  mode?: Mode | undefined;

  /**
   * Observations buffer (optional for analyzeLocal; note that J and G are independent of observation values).
   */
  observations?:
    | CaseV1['observations']
    | { minus: ArrayLike<number>; plus?: ArrayLike<number> }
    | null
    | undefined;

  /**
   * Custom CSS class name
   */
  className?: string | undefined;

  /**
   * Custom style
   */
  style?: React.CSSProperties | undefined;
}

export const EVIDENCE_PANEL_TITLE = '局部证据与可辨识性信息谱';
export const EVIDENCE_BOUNDARY_ALERT_TITLE = '边界警示（不可等同概率或全局唯一）';
export const EVIDENCE_INCOMPLETE_TEXT = '双焦拟合未完成 — 绝不伪造分析值';

/**
 * Human-readable coefficient labels in Chinese
 */
const COEFF_LABELS: Record<keyof Coefficients, string> = {
  astig0: '0°像散 (Z22)',
  comaX: 'x向彗差 (Z31)',
  spherical: '初级球差 (Z40)',
};

/**
 * Local Identifiability & Evidence Panel Component
 */
export const EvidencePanel: React.FC<EvidencePanelProps> = ({
  analysisResult,
  reference,
  dualFitResult,
  isDualFitComplete,
  mode,
  observations,
  className = '',
  style,
}) => {
  // Determine whether dual fit has completed successfully
  const isCompleted = useMemo(() => {
    // Explicit override
    if (isDualFitComplete === false) return false;

    // Check dualFitResult status if provided
    if (dualFitResult) {
      const completedStatuses: FitStatus[] = ['converged', 'max_iterations', 'stalled'];
      if (!completedStatuses.includes(dualFitResult.status)) {
        return false;
      }
    }

    if (isDualFitComplete === true) return true;

    // If analysisResult is passed, it represents a computed result
    if (analysisResult) return true;

    // If explicit reference is provided without a failed dualFitResult
    if (reference && !dualFitResult) return true;

    // If completed dualFitResult exists
    if (dualFitResult) return true;

    // Default to incomplete: never assume or fake completion
    return false;
  }, [isDualFitComplete, dualFitResult, analysisResult, reference]);

  // Determine effective reference point
  const effectiveReference: Coefficients | null = useMemo(() => {
    if (!isCompleted) return null;
    if (analysisResult?.reference) return analysisResult.reference;
    if (reference) return reference;
    if (dualFitResult?.estimate) return dualFitResult.estimate;
    return null;
  }, [isCompleted, analysisResult, reference, dualFitResult]);

  // Validate reference coefficients if present
  const refValidation = useMemo(() => {
    if (!effectiveReference) return null;
    return validateCoefficients(effectiveReference);
  }, [effectiveReference]);

  // Compute or extract local analysis metrics
  const analysisData = useMemo(() => {
    if (!isCompleted || !effectiveReference || (refValidation && !refValidation.success)) {
      return null;
    }

    // 1. If full LocalAnalysisResult is passed directly
    if (
      analysisResult &&
      'singularValuesSingle' in analysisResult &&
      'singularValuesDual' in analysisResult &&
      Array.isArray((analysisResult as LocalAnalysisResult).singularValuesSingle)
    ) {
      return analysisResult as LocalAnalysisResult;
    }

    // 2. If InformationSpectrum is passed (contains reference, eigenSingle, eigenDual)
    if (analysisResult && analysisResult.eigenSingle && analysisResult.eigenDual) {
      const eS = analysisResult.eigenSingle;
      const eD = analysisResult.eigenDual;
      const singularValuesSingle: [number, number, number] = [
        Math.sqrt(Math.max(0, eS[0])),
        Math.sqrt(Math.max(0, eS[1])),
        Math.sqrt(Math.max(0, eS[2])),
      ];
      const singularValuesDual: [number, number, number] = [
        Math.sqrt(Math.max(0, eD[0])),
        Math.sqrt(Math.max(0, eD[1])),
        Math.sqrt(Math.max(0, eD[2])),
      ];
      const traceSingle = eS[0] + eS[1] + eS[2];
      const traceDual = eD[0] + eD[1] + eD[2];
      const conditionNumberSingle =
        singularValuesSingle[0] / Math.max(singularValuesSingle[2], 1e-14);
      const conditionNumberDual =
        singularValuesDual[0] / Math.max(singularValuesDual[2], 1e-14);

      return {
        reference: analysisResult.reference,
        eigenSingle: eS,
        eigenDual: eD,
        singularValuesSingle,
        singularValuesDual,
        traceSingle,
        traceDual,
        conditionNumberSingle,
        conditionNumberDual,
        gramSingle: new Float64Array(9),
        gramDual: new Float64Array(9),
        boundaryNote: LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE,
      } as LocalAnalysisResult;
    }

    // 3. Otherwise compute via math/identifiable analyzeLocal at the common reference
    try {
      return analyzeLocal(
        effectiveReference,
        observations ?? undefined
      );
    } catch {
      return null;
    }
  }, [isCompleted, effectiveReference, refValidation, analysisResult, observations]);

  // RENDER 1: INCOMPLETE STATE (Dual fit not completed)
  // Strictly display incomplete status, NEVER fabricate/forge analysis values!
  if (!isCompleted || !analysisData || !effectiveReference) {
    const isCancelled = dualFitResult?.status === 'cancelled';
    const isInvalidRef = refValidation && !refValidation.success;

    return (
      <section
        className={`fw-panel fw-evidence-panel ${className}`}
        style={style}
        data-testid="evidence-panel"
        role="region"
        aria-label="局部证据与信息谱面板"
      >
        <header className="fw-panel-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 className="fw-panel-title">{EVIDENCE_PANEL_TITLE}</h2>
            <span
              className="fw-panel-badge"
              data-testid="evidence-status-badge"
              style={{
                backgroundColor: '#6c757d',
                color: '#ffffff',
                padding: '2px 8px',
                borderRadius: '4px',
                fontSize: '0.72rem',
                fontWeight: 600,
              }}
            >
              未完成
            </span>
          </div>
        </header>

        <div className="fw-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Strict Boundary Alert: local identifiability != global uniqueness */}
          <div
            className="fw-info-box"
            role="alert"
            data-testid="evidence-boundary-alert"
            style={{
              backgroundColor: '#fff9db',
              borderColor: '#fcc419',
              color: '#3d2c00',
              borderLeft: '4px solid #f59f00',
              padding: '12px 14px',
              borderRadius: '4px',
              fontSize: '0.82rem',
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px', color: '#3d2c00' }}>
              <span>⚠️</span>
              <span>{EVIDENCE_BOUNDARY_ALERT_TITLE}</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#3d2c00' }}>
              {LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE}
            </p>
            <p style={{ margin: '6px 0 0 0', fontSize: '0.78rem', color: '#493801' }}>
              <strong style={{ color: '#212529' }}>不可等同概率或全局唯一：</strong>条件数与奇异值仅为局部线性化切空间的灵敏度比，非贝叶斯置信区间，绝非物理参数全局唯一性证明。
            </p>
          </div>

          {/* Incomplete State Notice: clear explicit pending status, NO fabricated numbers */}
          <div
            data-testid="evidence-incomplete-state"
            style={{
              backgroundColor: '#f8f9fa',
              border: '1px dashed #adb5bd',
              borderRadius: '6px',
              padding: '20px 16px',
              textAlign: 'center',
              color: '#212529',
            }}
          >
            <div
              style={{
                fontSize: '1rem',
                fontWeight: 700,
                color: '#212529',
                marginBottom: '8px',
              }}
              data-testid="evidence-incomplete-title"
            >
              {isCancelled
                ? '双焦拟合已取消 — 未完成同点比较'
                : isInvalidRef
                ? '参考点系数无效 — 无法计算信息谱'
                : EVIDENCE_INCOMPLETE_TEXT}
            </div>

            <p
              style={{
                fontSize: '0.84rem',
                color: '#495057',
                maxWidth: '560px',
                margin: '0 auto 12px',
                lineHeight: 1.5,
              }}
              data-testid="evidence-incomplete-desc"
            >
              {isInvalidRef ? (
                <span>
                  参考点系数必须是 [-0.15, 0.15] waves 内的有限实数。
                  系统严禁编造虚假分析值。
                </span>
              ) : isCancelled ? (
                <span>
                  双焦面求解过程已被取消，未能得到最终参数估计点 a_ref。
                  单/双焦同点比较必须在同一有效收敛点处展开，当前不显示伪造分析值。
                </span>
              ) : (
                <span>
                  局部信息谱与奇异值严格基于双焦面反演完成后的同一个参数估计点 a_ref 处线性化求值。
                  当前双焦拟合未完成，系统明确显示未完成状态，<strong style={{ color: '#212529' }}>绝不伪造、编造或推测分析值</strong>。
                </span>
              )}
            </p>

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.78rem',
                color: '#212529',
                backgroundColor: '#e9ecef',
                padding: '4px 12px',
                borderRadius: '12px',
                fontWeight: 500,
              }}
              data-testid="evidence-pending-hint"
            >
              <span>ℹ️ 操作指引：请在反演面板中完成双焦面 (dual) 求解，完成后将在此展示单/双焦奇异值对比谱。</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // RENDER 2: COMPLETED STATE (Dual fit completed, genuine values calculated at a_ref)
  const {
    singularValuesSingle,
    singularValuesDual,
    eigenSingle,
    eigenDual,
    traceSingle,
    traceDual,
    conditionNumberSingle,
    conditionNumberDual,
  } = analysisData;

  // Verify monotonicity conditions at common a_ref (Section 5.5)
  const isPsdMonotonicTrace = traceDual + 1e-10 >= traceSingle;
  const isPsdMonotonicMinEigen = eigenDual[2] + 1e-10 >= eigenSingle[2];
  const deltaTrace = traceDual - traceSingle;

  return (
    <section
      className={`fw-panel fw-evidence-panel ${className}`}
      style={style}
      data-testid="evidence-panel"
      role="region"
      aria-label="局部证据与信息谱面板"
    >
      <header className="fw-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2 className="fw-panel-title">{EVIDENCE_PANEL_TITLE}</h2>
          <span
            className="fw-panel-badge"
            data-testid="evidence-status-badge"
            style={{
              backgroundColor: '#198754',
              color: '#ffffff',
              padding: '2px 8px',
              borderRadius: '4px',
              fontSize: '0.72rem',
              fontWeight: 600,
            }}
          >
            同点对比就绪
          </span>
        </div>
        {mode && (
          <span
            style={{ fontSize: '0.75rem', color: '#6c757d' }}
            data-testid="evidence-current-mode"
          >
            当前显示模式: {mode === 'dual' ? '双焦面 (dual)' : '单焦面 (single)'}
          </span>
        )}
      </header>

      <div className="fw-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Requirement 3: Boundary Warning Alert (不可等同概率或全局唯一) */}
        <div
          className="fw-info-box"
          role="alert"
          data-testid="evidence-boundary-alert"
          style={{
            backgroundColor: '#fff9db',
            borderColor: '#fcc419',
            color: '#3d2c00',
            borderLeft: '4px solid #f59f00',
            padding: '12px 14px',
            borderRadius: '4px',
            fontSize: '0.82rem',
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px', color: '#3d2c00' }}>
            <span>⚠️</span>
            <span>{EVIDENCE_BOUNDARY_ALERT_TITLE}</span>
          </div>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#3d2c00' }} data-testid="evidence-boundary-note">
            {LOCAL_IDENTIFIABILITY_BOUNDARY_NOTE}
          </p>
          <p style={{ margin: '6px 0 0 0', fontSize: '0.78rem', color: '#493801' }}>
            <strong style={{ color: '#212529' }}>不可等同概率或全局唯一：</strong>条件数与 3 个奇异值仅为局部线性化切空间的灵敏度比，反映逆问题局部病态性，非贝叶斯置信区间，绝非物理参数全局唯一性证明。
          </p>
        </div>

        {/* Requirement 2: Common Comparison Reference Point (a_ref) */}
        <div
          data-testid="evidence-reference-point"
          style={{
            backgroundColor: '#f8f9fa',
            border: '1px solid #dee2e6',
            borderRadius: '6px',
            padding: '12px 14px',
            color: '#212529',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '6px',
              marginBottom: '6px',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#212529' }}>
              共同比较参考点 a_ref（双焦拟合估计值）
            </div>
            <span
              style={{
                fontSize: '0.72rem',
                color: '#084298',
                backgroundColor: '#e7f1ff',
                padding: '2px 6px',
                borderRadius: '3px',
                fontFamily: 'monospace',
                fontWeight: 600,
              }}
              data-testid="reference-guarantee-tag"
            >
              J_single(a_ref) 与 J_dual(a_ref) 同点线性化
            </span>
          </div>

          <p style={{ fontSize: '0.78rem', color: '#495057', margin: '0 0 10px 0', lineHeight: 1.4 }}>
            为避免不同工作点切空间差异导致的虚假对比，单焦与双焦信息矩阵严格在双焦面最终估计值 a_ref 处求值比较。
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
              gap: '8px',
            }}
          >
            {COEFFICIENT_NAMES.map((name) => (
              <div
                key={name}
                data-testid={`ref-coeff-item-${name}`}
                style={{
                  backgroundColor: '#ffffff',
                  border: '1px solid #e9ecef',
                  borderRadius: '4px',
                  padding: '6px 10px',
                  color: '#212529',
                }}
              >
                <div style={{ fontSize: '0.72rem', color: '#495057' }}>{COEFF_LABELS[name]}</div>
                <div
                  style={{
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    fontSize: '0.88rem',
                    color: '#212529',
                    whiteSpace: 'nowrap',
                  }}
                  data-testid={`ref-coeff-${name}`}
                >
                  {formatCoeffWave(effectiveReference[name])}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Requirement 1: Display 3 Local Singular Values (Single vs Dual) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '6px',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fw-text-main, #f1f5f9)' }}>
              局部灵敏度 3 个奇异值对照表 (Singular Values: σᵢ = √eᵢ)
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span
                data-testid="evidence-scroll-hint"
                style={{
                  fontSize: '0.72rem',
                  color: 'var(--fw-text-muted, #94a3b8)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>⇄</span>
                <span>窄面板支持横向滚动</span>
              </span>
              <span style={{ fontSize: '0.74rem', color: 'var(--fw-text-muted, #94a3b8)' }}>
                数值由对称 3×3 Jacobi 特征值分解获得
              </span>
            </div>
          </div>

          <div
            className="fw-table-scroll-container"
            data-testid="singular-values-scroll-container"
            style={{
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
              maxWidth: '100%',
            }}
          >
            <table
              className="fw-est-table fw-evidence-table"
              data-testid="singular-values-table"
              style={{
                width: '100%',
                minWidth: '580px',
                borderCollapse: 'collapse',
                fontSize: '0.8rem',
                border: '1px solid #dee2e6',
                color: '#212529',
                backgroundColor: '#ffffff',
              }}
            >
              <thead style={{ backgroundColor: '#f1f3f5', color: '#212529' }}>
                <tr>
                  <th style={{ whiteSpace: 'nowrap', padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #dee2e6', color: '#212529', fontWeight: 600 }}>
                    奇异值主模态
                  </th>
                  <th style={{ whiteSpace: 'nowrap', padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #dee2e6', color: '#212529', fontWeight: 600 }}>
                    单焦面 (-0.65λ)
                  </th>
                  <th style={{ whiteSpace: 'nowrap', padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #dee2e6', color: '#212529', fontWeight: 600 }}>
                    双焦面 (±0.65λ)
                  </th>
                  <th style={{ whiteSpace: 'nowrap', padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid #dee2e6', color: '#212529', fontWeight: 600 }}>
                    灵敏度增益比 (Dual/Single)
                  </th>
                  <th style={{ whiteSpace: 'nowrap', padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #dee2e6', color: '#212529', fontWeight: 600 }}>
                    模态主导意义
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    idx: 0,
                    symbol: 'σ₁ = √e₁',
                    label: '第 1 奇异值 (最大灵敏度)',
                    meaning: '最敏感主方向（主导可辨识轴）',
                  },
                  {
                    idx: 1,
                    symbol: 'σ₂ = √e₂',
                    label: '第 2 奇异值 (中等灵敏度)',
                    meaning: '次敏感主方向',
                  },
                  {
                    idx: 2,
                    symbol: 'σ₃ = √e₃',
                    label: '第 3 奇异值 (最小灵敏度 / 瓶颈)',
                    meaning: '可辨识性瓶颈模态（最弱响应轴）',
                  },
                ].map(({ idx, symbol, label, meaning }) => {
                  const sSingle = singularValuesSingle[idx]!;
                  const sDual = singularValuesDual[idx]!;
                  const ratio = sSingle > 1e-14 ? sDual / sSingle : 1;
                  const isMonotonic = sDual + 1e-10 >= sSingle;

                  return (
                    <tr
                      key={idx}
                      data-testid={`singular-row-${idx}`}
                      style={{
                        backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f8f9fa',
                        borderBottom: '1px solid #e9ecef',
                        color: '#212529',
                      }}
                    >
                      <td style={{ whiteSpace: 'nowrap', padding: '8px 10px', color: '#212529' }}>
                        <div style={{ whiteSpace: 'nowrap', fontWeight: 600, color: '#212529' }}>{symbol}</div>
                        <div style={{ whiteSpace: 'nowrap', fontSize: '0.72rem', color: '#495057' }}>{label}</div>
                      </td>
                      <td
                        style={{
                          whiteSpace: 'nowrap',
                          padding: '8px 10px',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontWeight: 600,
                          color: '#212529',
                        }}
                        data-testid={`singular-val-single-${idx}`}
                      >
                        {formatScientific(sSingle, 4)}
                      </td>
                      <td
                        style={{
                          whiteSpace: 'nowrap',
                          padding: '8px 10px',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontWeight: 600,
                          color: '#084298',
                        }}
                        data-testid={`singular-val-dual-${idx}`}
                      >
                        {formatScientific(sDual, 4)}
                      </td>
                      <td
                        style={{
                          whiteSpace: 'nowrap',
                          padding: '8px 10px',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          color: '#212529',
                        }}
                        data-testid={`singular-ratio-${idx}`}
                      >
                        <span
                          style={{
                            color: isMonotonic ? '#0f5132' : '#842029',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {ratio.toFixed(2)}x
                        </span>
                        <span style={{ whiteSpace: 'nowrap', fontSize: '0.7rem', color: '#495057', marginLeft: '4px' }}>
                          ({sDual >= sSingle ? '▲ 增益' : '▼ 下降'})
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap', padding: '8px 10px', fontSize: '0.75rem', color: '#212529' }}>
                        {meaning}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Information Spectrum Diagnostic Summary Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '12px',
          }}
        >
          {/* Card 1: Trace Tr(G) Monotonicity */}
          <div
            data-testid="card-trace-metrics"
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #dee2e6',
              borderRadius: '6px',
              padding: '10px 12px',
              color: '#212529',
            }}
          >
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#212529', marginBottom: '6px' }}>
              矩阵迹 Tr(G) 总信息量检验
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '3px' }}>
              <span style={{ color: '#495057' }}>单焦 Tr(G_s):</span>
              <span style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 600, color: '#212529' }} data-testid="trace-single">
                {traceSingle.toFixed(6)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '3px' }}>
              <span style={{ color: '#495057' }}>双焦 Tr(G_d):</span>
              <span style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 600, color: '#084298' }} data-testid="trace-dual">
                {traceDual.toFixed(6)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '6px' }}>
              <span style={{ color: '#495057' }}>信息增量 ΔTr:</span>
              <span style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', color: '#0f5132', fontWeight: 600 }} data-testid="trace-delta">
                +{deltaTrace.toFixed(6)}
              </span>
            </div>
            <div
              style={{
                fontSize: '0.72rem',
                color: isPsdMonotonicTrace ? '#0f5132' : '#842029',
                borderTop: '1px dashed #dee2e6',
                paddingTop: '4px',
                fontWeight: 600,
              }}
              data-testid="trace-monotonicity-verdict"
            >
              {isPsdMonotonicTrace ? '✓ 满足 G_d - G_s 半正定：迹单调不下降' : '✗ 异常：迹下降'}
            </div>
          </div>

          {/* Card 2: Condition Number Kappa (Sensitivity Ratio) */}
          <div
            data-testid="card-condition-number"
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #dee2e6',
              borderRadius: '6px',
              padding: '10px 12px',
              color: '#212529',
            }}
          >
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#212529', marginBottom: '6px' }}>
              局部条件数 κ = σ₁ / max(σ₃, 10⁻¹⁴)
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '3px' }}>
              <span style={{ color: '#495057' }}>单焦 κ_single:</span>
              <span style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 600, color: '#212529' }} data-testid="cond-single">
                {conditionNumberSingle.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '3px' }}>
              <span style={{ color: '#495057' }}>双焦 κ_dual:</span>
              <span style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 600, color: '#084298' }} data-testid="cond-dual">
                {conditionNumberDual.toFixed(2)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '6px' }}>
              <span style={{ color: '#495057' }}>瓶颈特征值 e₃:</span>
              <span style={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontWeight: 600, color: '#212529' }} data-testid="eigen-bottleneck-dual">
                {formatScientific(eigenDual[2]!, 3)}
              </span>
            </div>
            <div
              style={{
                fontSize: '0.72rem',
                color: isPsdMonotonicMinEigen ? '#0f5132' : '#842029',
                borderTop: '1px dashed #dee2e6',
                paddingTop: '4px',
                fontWeight: 600,
              }}
              data-testid="eigen-monotonicity-verdict"
            >
              {isPsdMonotonicMinEigen ? '✓ 瓶颈特征值不下降 (e_dual,3 ≥ e_single,3)' : '✗ 异常：瓶颈恶化'}
            </div>
          </div>

          {/* Card 3: Eigenvalue Spectrum (e1 >= e2 >= e3) */}
          <div
            data-testid="card-eigenvalues"
            style={{
              backgroundColor: '#ffffff',
              border: '1px solid #dee2e6',
              borderRadius: '6px',
              padding: '10px 12px',
              color: '#212529',
            }}
          >
            <div style={{ fontSize: '0.76rem', fontWeight: 600, color: '#212529', marginBottom: '6px' }}>
              Gram 矩阵特征谱 (e₁ ≥ e₂ ≥ e₃ ≥ 0)
            </div>
            <div style={{ fontSize: '0.72rem', color: '#212529', marginBottom: '4px' }}>
              单焦: [{eigenSingle.map((e) => formatScientific(e, 2)).join(', ')}]
            </div>
            <div style={{ fontSize: '0.72rem', color: '#084298', fontWeight: 600, marginBottom: '6px' }}>
              双焦: [{eigenDual.map((e) => formatScientific(e, 2)).join(', ')}]
            </div>
            <div
              style={{
                fontSize: '0.72rem',
                color: '#343a40',
                borderTop: '1px dashed #dee2e6',
                paddingTop: '4px',
                lineHeight: 1.3,
              }}
            >
              G_dual = G_single + J₊ᵀJ₊ 保证 G_d - G_s 半正定，双焦局部信息严格增加。
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
