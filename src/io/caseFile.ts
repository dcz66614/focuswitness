/**
 * P007 FocusWitness — Case File IO & Data Contract
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 6.1: CaseV1 schema definition (focuswitness.case/v1)
 * - PROJECT_BOOK.md Section 6.2: Forward-model-based case generation
 * - PROJECT_BOOK.md Section 6.3: Import validation & security (2 MiB limit, strict v1 schema, safe parse)
 * - PROJECT_BOOK.md Chapter 7: MATH08 (five presets export/import round-trip), MATH09 (negative, NaN, length, oversized rejection)
 * - IMPLEMENTATION_PLAN.md Section 3.3: parseCase(text: string): CaseV1, serializeCase(caseData)
 */

import {
  CASE_SCHEMA,
  SPEC_VERSION,
  GRID_SIZE,
  PIXEL_COUNT,
  PUPIL_RADIUS_PX,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
  MAX_IMPORT_FILE_SIZE_BYTES,
} from '../domain/constants';
import type { CaseV1, Coefficients, PresetId } from '../domain/types';
import { getPreset } from '../domain/presets';
import {
  validateCaseV1,
  validateCaseJson,
  validateCoefficients,
  type ValidationResult,
} from '../domain/validation';
import { forwardPsf } from '../math/psf';

/**
 * Custom error class for Case parsing failures.
 */
export class CaseFileError extends Error {
  public readonly errors: readonly string[];

  constructor(message: string, errors: readonly string[] = []) {
    super(message);
    this.name = 'CaseFileError';
    this.errors = errors;
  }
}

/**
 * Parses a Case JSON string with strict v1 schema validation.
 *
 * Security and validation guarantees:
 * - Input must be a valid JSON string <= 2 MiB (MAX_IMPORT_FILE_SIZE_BYTES).
 * - Safe JSON parsing without executing scripts/HTML.
 * - Strict schema ('focuswitness.case/v1') and specVersion ('1.0.0').
 * - Exactly 4096 non-negative, finite numbers per observation plane.
 * - Normalized intensity sum within [1 - 1e-6, 1 + 1e-6].
 * - Optional groundTruth bounded to [-0.15, 0.15] waves.
 *
 * Throws CaseFileError if any validation check fails.
 *
 * @param text UTF-8 JSON text representation of CaseV1
 * @returns Validated CaseV1 object
 */
export function parseCase(text: string): CaseV1 {
  if (typeof text !== 'string') {
    throw new CaseFileError('parseCase: input must be a JSON string', ['Input must be a string']);
  }

  const result = validateCaseJson(text, MAX_IMPORT_FILE_SIZE_BYTES);
  if (!result.success) {
    const errorMsg = `Failed to parse CaseV1: ${result.errors.join('; ')}`;
    throw new CaseFileError(errorMsg, result.errors);
  }

  return result.data;
}

/**
 * Non-throwing safe parser for Case JSON strings.
 *
 * @param text JSON string to validate and parse
 * @param maxSizeBytes Optional maximum allowed byte size (defaults to 2 MiB)
 * @returns ValidationResult containing data on success or error list on failure
 */
export function safeParseCase(
  text: string,
  maxSizeBytes: number = MAX_IMPORT_FILE_SIZE_BYTES
): ValidationResult<CaseV1> {
  return validateCaseJson(text, maxSizeBytes);
}

/**
 * Serializes a CaseV1 object into a formatted JSON string.
 *
 * Guarantees:
 * - Validates input against CaseV1 schema before serialization.
 * - Prevents serialization of NaN, Infinity, negative observations, or out-of-bound coefficients.
 * - Strips undefined fields cleanly.
 *
 * @param caseData Valid CaseV1 object
 * @param indent Indentation spaces for JSON formatting (default: 2)
 * @returns Formatted JSON string
 */
export function serializeCase(caseData: CaseV1, indent: number = 2): string {
  const result = validateCaseV1(caseData);
  if (!result.success) {
    const errorMsg = `Cannot serialize invalid CaseV1: ${result.errors.join('; ')}`;
    throw new CaseFileError(errorMsg, result.errors);
  }

  return JSON.stringify(result.data, null, indent);
}

/**
 * Generates a valid CaseV1 object from aberration coefficients using the forward model.
 *
 * Per PROJECT_BOOK.md Section 6.2:
 * Computes the two 4096 observation arrays (minus: -0.65 waves, plus: +0.65 waves)
 * using the analytical Zernike pupil + Fraunhofer FFT forward PSF model.
 *
 * @param coefficients Physical aberration coefficients in waves (astig0, comaX, spherical)
 * @param label Optional preset or descriptive label
 * @returns Freshly generated, valid CaseV1
 */
export function createCaseFromCoefficients(
  coefficients: Coefficients,
  label?: string
): CaseV1 {
  const coeffValidation = validateCoefficients(coefficients);
  if (!coeffValidation.success) {
    throw new CaseFileError(
      `createCaseFromCoefficients: invalid coefficients: ${coeffValidation.errors.join('; ')}`,
      coeffValidation.errors
    );
  }

  const minusPsf = forwardPsf(coeffValidation.data, DIVERSITY_DEFOCUS_MINUS);
  const plusPsf = forwardPsf(coeffValidation.data, DIVERSITY_DEFOCUS_PLUS);

  const minus = new Array<number>(PIXEL_COUNT);
  const plus = new Array<number>(PIXEL_COUNT);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    minus[i] = minusPsf[i]!;
    plus[i] = plusPsf[i]!;
  }

  const caseData: CaseV1 = {
    schema: CASE_SCHEMA,
    specVersion: SPEC_VERSION,
    optics: {
      gridSize: GRID_SIZE,
      pupilRadiusPx: PUPIL_RADIUS_PX,
      diversityWaves: [DIVERSITY_DEFOCUS_MINUS, DIVERSITY_DEFOCUS_PLUS],
    },
    observations: {
      minus,
      plus,
    },
    groundTruth: {
      astig0: coeffValidation.data.astig0,
      comaX: coeffValidation.data.comaX,
      spherical: coeffValidation.data.spherical,
    },
  };

  if (typeof label === 'string' && label.length > 0) {
    caseData.label = label;
  }

  return caseData;
}

/**
 * Creates a valid CaseV1 object from one of the five frozen presets.
 *
 * @param presetId Preset identifier ('perfect' | 'mixed' | 'astig-only' | 'coma-only' | 'spherical-only')
 * @returns Fully generated CaseV1 with groundTruth and label
 */
export function createCaseFromPreset(presetId: PresetId): CaseV1 {
  const preset = getPreset(presetId);
  return createCaseFromCoefficients(preset.coefficients, preset.id);
}

/**
 * Safe case loader helper ensuring that invalid imports never overwrite good state.
 *
 * Per PROJECT_BOOK.md Section 6.3:
 * "导入文本只做 JSON 数据解析与严格校验，错误不覆盖当前有效案例。"
 *
 * If parsing and validation succeed, returns the new CaseV1.
 * If validation fails or throws, returns the untouched currentCase with error details.
 *
 * @param text Input JSON text
 * @param currentCase Current valid CaseV1 in application state
 * @returns Object with caseData (new if success, currentCase if failure), success flag, and optional error
 */
export function loadCaseSafely(
  text: string,
  currentCase: CaseV1
): { caseData: CaseV1; success: boolean; error?: string } {
  try {
    const result = safeParseCase(text);
    if (!result.success) {
      return {
        caseData: currentCase,
        success: false,
        error: result.errors.join('; '),
      };
    }
    return {
      caseData: result.data,
      success: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      caseData: currentCase,
      success: false,
      error: `Unexpected error during case import: ${message}`,
    };
  }
}
