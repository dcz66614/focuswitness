/**
 * P007 FocusWitness — Presets
 * Specifications: PROJECT_BOOK.md Section 7.1
 *
 * Five frozen presets:
 * - perfect: (0, 0, 0)
 * - mixed: (0.08, -0.06, 0.04)
 * - astig-only: (0.10, 0, 0)
 * - coma-only: (0, -0.08, 0)
 * - spherical-only: (0, 0, 0.10)
 */

import type { PresetCase, PresetId } from './types';
import { DEFAULT_PRESET_ID } from './constants';

export const PRESET_PERFECT: Readonly<PresetCase> = Object.freeze({
  id: 'perfect',
  label: '无像差 (Perfect)',
  coefficients: Object.freeze({
    astig0: 0.00,
    comaX: 0.00,
    spherical: 0.00,
  }),
  purpose: '对称/零像差基线',
});

export const PRESET_MIXED: Readonly<PresetCase> = Object.freeze({
  id: 'mixed',
  label: '混合像差 (Mixed)',
  coefficients: Object.freeze({
    astig0: 0.08,
    comaX: -0.06,
    spherical: 0.04,
  }),
  purpose: '默认逆向恢复演示',
});

export const PRESET_ASTIG_ONLY: Readonly<PresetCase> = Object.freeze({
  id: 'astig-only',
  label: '纯像散 (Astigmatism Only)',
  coefficients: Object.freeze({
    astig0: 0.10,
    comaX: 0.00,
    spherical: 0.00,
  }),
  purpose: '非旋转对称 PSF',
});

export const PRESET_COMA_ONLY: Readonly<PresetCase> = Object.freeze({
  id: 'coma-only',
  label: '纯彗差 (Coma Only)',
  coefficients: Object.freeze({
    astig0: 0.00,
    comaX: -0.08,
    spherical: 0.00,
  }),
  purpose: '非中心对称 PSF',
});

export const PRESET_SPHERICAL_ONLY: Readonly<PresetCase> = Object.freeze({
  id: 'spherical-only',
  label: '纯球差 (Spherical Only)',
  coefficients: Object.freeze({
    astig0: 0.00,
    comaX: 0.00,
    spherical: 0.10,
  }),
  purpose: '两侧离焦响应差异',
});

export const PRESETS: Readonly<Record<PresetId, PresetCase>> = Object.freeze({
  'perfect': PRESET_PERFECT,
  'mixed': PRESET_MIXED,
  'astig-only': PRESET_ASTIG_ONLY,
  'coma-only': PRESET_COMA_ONLY,
  'spherical-only': PRESET_SPHERICAL_ONLY,
});

export const PRESET_LIST: readonly PresetCase[] = Object.freeze([
  PRESET_MIXED, // default first
  PRESET_PERFECT,
  PRESET_ASTIG_ONLY,
  PRESET_COMA_ONLY,
  PRESET_SPHERICAL_ONLY,
]);

export const DEFAULT_PRESET: PresetCase = PRESETS[DEFAULT_PRESET_ID];

/**
 * Type guard for PresetId
 */
export function isPresetId(id: unknown): id is PresetId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PRESETS, id);
}

/**
 * Safe retrieval of a preset by ID.
 * Returns default preset if ID is invalid.
 */
export function getPreset(id: PresetId): PresetCase {
  return PRESETS[id] ?? DEFAULT_PRESET;
}
