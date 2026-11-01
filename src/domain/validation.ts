/**
 * P007 FocusWitness — Domain Validation & Security
 * Specifications: PROJECT_BOOK.md Section 5.1, 6.1, 6.3, 7.1
 */

import {
  CASE_SCHEMA,
  REPORT_SCHEMA,
  SPEC_VERSION,
  GRID_SIZE,
  PIXEL_COUNT,
  PUPIL_RADIUS_PX,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
  COEFFICIENT_MIN,
  COEFFICIENT_MAX,
  COEFFICIENT_NAMES,
  MAX_IMPORT_FILE_SIZE_BYTES,
  OBSERVATION_SUM_MIN,
  OBSERVATION_SUM_MAX,
} from './constants';
import type {
  CaseV1,
  Coefficients,
  FitReportV1,
  FitResult,
  FitStatus,
  FocusPlane,
  InformationSpectrum,
  IterationRecord,
  Mode,
  OpticsConfig,
  Observations,
  PresetId,
} from './types';
import { isPresetId } from './presets';

export interface ValidationSuccess<T> {
  success: true;
  data: T;
  errors?: never;
}

export interface ValidationFailure {
  success: false;
  errors: string[];
  data?: never;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isFiniteNumber(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val);
}

/**
 * Validates Zernike coefficients:
 * - Must be an object with astig0, comaX, spherical
 * - All three must be finite numbers within [-0.15, 0.15] waves
 */
export function validateCoefficients(input: unknown): ValidationResult<Coefficients> {
  if (!isObject(input)) {
    return { success: false, errors: ['Coefficients must be a non-null object'] };
  }

  const errors: string[] = [];

  for (const name of COEFFICIENT_NAMES) {
    const val = input[name];
    if (!isFiniteNumber(val)) {
      errors.push(`Coefficient '${name}' must be a finite number`);
    } else if (val < COEFFICIENT_MIN || val > COEFFICIENT_MAX) {
      errors.push(
        `Coefficient '${name}' (${val}) is out of allowed range [${COEFFICIENT_MIN}, ${COEFFICIENT_MAX}] waves`,
      );
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      astig0: input['astig0'] as number,
      comaX: input['comaX'] as number,
      spherical: input['spherical'] as number,
    },
  };
}

/**
 * Validates discrete optical geometry configuration:
 * - gridSize === 64
 * - pupilRadiusPx === 16
 * - diversityWaves === [-0.65, 0.65]
 */
export function validateOptics(input: unknown): ValidationResult<OpticsConfig> {
  if (!isObject(input)) {
    return { success: false, errors: ['Optics config must be a non-null object'] };
  }

  const errors: string[] = [];

  if (input['gridSize'] !== GRID_SIZE) {
    errors.push(`optics.gridSize must be ${GRID_SIZE}, got ${String(input['gridSize'])}`);
  }

  if (input['pupilRadiusPx'] !== PUPIL_RADIUS_PX) {
    errors.push(`optics.pupilRadiusPx must be ${PUPIL_RADIUS_PX}, got ${String(input['pupilRadiusPx'])}`);
  }

  const waves = input['diversityWaves'];
  if (!Array.isArray(waves) || waves.length !== 2) {
    errors.push('optics.diversityWaves must be an array of exactly 2 numbers [-0.65, 0.65]');
  } else {
    if (waves[0] !== DIVERSITY_DEFOCUS_MINUS || waves[1] !== DIVERSITY_DEFOCUS_PLUS) {
      errors.push(
        `optics.diversityWaves must be [${DIVERSITY_DEFOCUS_MINUS}, ${DIVERSITY_DEFOCUS_PLUS}], got [${String(waves[0])}, ${String(waves[1])}]`,
      );
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      gridSize: 64,
      pupilRadiusPx: 16,
      diversityWaves: [DIVERSITY_DEFOCUS_MINUS, DIVERSITY_DEFOCUS_PLUS],
    },
  };
}

/**
 * Validates a single observation plane array:
 * - Exactly 4096 elements
 * - Every element is a finite number >= 0
 * - Sum of elements within [1 - 1e-6, 1 + 1e-6]
 */
function validatePlaneArray(plane: unknown, planeName: 'minus' | 'plus'): { errors: string[]; sum: number } {
  const errors: string[] = [];
  let sum = 0;

  if (!Array.isArray(plane)) {
    errors.push(`observations.${planeName} must be an array`);
    return { errors, sum: 0 };
  }

  if (plane.length !== PIXEL_COUNT) {
    errors.push(`observations.${planeName} length must be ${PIXEL_COUNT}, got ${plane.length}`);
    return { errors, sum: 0 };
  }

  let nonFiniteCount = 0;
  let negativeCount = 0;

  for (let i = 0; i < plane.length; i++) {
    const val = plane[i];
    if (!isFiniteNumber(val)) {
      nonFiniteCount++;
    } else if (val < 0) {
      negativeCount++;
      sum += val;
    } else {
      sum += val;
    }
  }

  if (nonFiniteCount > 0) {
    errors.push(`observations.${planeName} contains ${nonFiniteCount} non-finite values (NaN or Infinity)`);
  }
  if (negativeCount > 0) {
    errors.push(`observations.${planeName} contains ${negativeCount} negative values`);
  }

  // Float slack of 1e-12 accounts for double-precision summation roundoff across 4096 elements
  const FLOAT_SUM_SLACK = 1e-12;
  if (
    nonFiniteCount === 0 &&
    (sum < OBSERVATION_SUM_MIN - FLOAT_SUM_SLACK || sum > OBSERVATION_SUM_MAX + FLOAT_SUM_SLACK)
  ) {
    errors.push(
      `observations.${planeName} sum (${sum.toFixed(8)}) outside required normalized range [${OBSERVATION_SUM_MIN}, ${OBSERVATION_SUM_MAX}]`,
    );
  }

  return { errors, sum };
}

/**
 * Validates observations object containing minus and plus planes.
 */
export function validateObservations(input: unknown): ValidationResult<Observations> {
  if (!isObject(input)) {
    return { success: false, errors: ['Observations must be a non-null object'] };
  }

  const minusResult = validatePlaneArray(input['minus'], 'minus');
  const plusResult = validatePlaneArray(input['plus'], 'plus');

  const errors = [...minusResult.errors, ...plusResult.errors];

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      minus: input['minus'] as number[],
      plus: input['plus'] as number[],
    },
  };
}

/**
 * Validates a complete CaseV1 object.
 */
export function validateCaseV1(input: unknown): ValidationResult<CaseV1> {
  if (!isObject(input)) {
    return { success: false, errors: ['Case data must be a non-null object'] };
  }

  const errors: string[] = [];

  if (input['schema'] !== CASE_SCHEMA) {
    errors.push(`schema must be '${CASE_SCHEMA}', got '${String(input['schema'])}'`);
  }

  if (input['specVersion'] !== SPEC_VERSION) {
    errors.push(`specVersion must be '${SPEC_VERSION}', got '${String(input['specVersion'])}'`);
  }

  const opticsRes = validateOptics(input['optics']);
  if (!opticsRes.success) {
    errors.push(...opticsRes.errors);
  }

  const obsRes = validateObservations(input['observations']);
  if (!obsRes.success) {
    errors.push(...obsRes.errors);
  }

  let validGroundTruth: Coefficients | undefined = undefined;
  if (input['groundTruth'] !== undefined) {
    const gtRes = validateCoefficients(input['groundTruth']);
    if (!gtRes.success) {
      errors.push(...gtRes.errors.map((e) => `groundTruth: ${e}`));
    } else {
      validGroundTruth = gtRes.data;
    }
  }

  let validLabel: string | undefined = undefined;
  if (input['label'] !== undefined) {
    if (typeof input['label'] !== 'string') {
      errors.push('label must be a string');
    } else {
      validLabel = input['label'];
    }
  }

  if (errors.length > 0 || !opticsRes.success || !obsRes.success) {
    return { success: false, errors };
  }

  const resultCase: CaseV1 = {
    schema: CASE_SCHEMA,
    specVersion: SPEC_VERSION,
    optics: opticsRes.data,
    observations: obsRes.data,
  };

  if (validGroundTruth !== undefined) {
    resultCase.groundTruth = validGroundTruth;
  }
  if (validLabel !== undefined) {
    resultCase.label = validLabel;
  }

  return {
    success: true,
    data: resultCase,
  };
}

/**
 * Validates raw JSON string representing a CaseV1 file:
 * - Checks file size limit (default 2 MiB)
 * - Safely parses JSON without crashing
 * - Validates schema and numerical contents
 */
export function validateCaseJson(
  jsonString: string,
  maxSizeBytes = MAX_IMPORT_FILE_SIZE_BYTES,
): ValidationResult<CaseV1> {
  if (typeof jsonString !== 'string') {
    return { success: false, errors: ['Input must be a JSON string'] };
  }

  const byteLength = new TextEncoder().encode(jsonString).length;
  if (byteLength > maxSizeBytes) {
    return {
      success: false,
      errors: [
        `File size (${(byteLength / 1024 / 1024).toFixed(2)} MiB) exceeds maximum allowed size of ${(maxSizeBytes / 1024 / 1024).toFixed(0)} MiB`,
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`JSON parse error: ${msg}`] };
  }

  return validateCaseV1(parsed);
}

/**
 * Validates optimization Mode ('single' | 'dual').
 */
export function validateMode(input: unknown): ValidationResult<Mode> {
  if (input === 'single' || input === 'dual') {
    return { success: true, data: input };
  }
  return { success: false, errors: [`Mode must be 'single' or 'dual', got '${String(input)}'`] };
}

/**
 * Validates focus plane (-0.65 | 0.65).
 */
export function validateFocusPlane(input: unknown): ValidationResult<FocusPlane> {
  if (input === -0.65 || input === 0.65) {
    return { success: true, data: input };
  }
  return {
    success: false,
    errors: [
      `Focus plane must be ${DIVERSITY_DEFOCUS_MINUS} or ${DIVERSITY_DEFOCUS_PLUS}, got ${String(input)}`,
    ],
  };
}

/**
 * Validates an IterationRecord.
 */
export function validateIterationRecord(input: unknown): ValidationResult<IterationRecord> {
  if (!isObject(input)) {
    return { success: false, errors: ['IterationRecord must be a non-null object'] };
  }

  const errors: string[] = [];

  if (typeof input['iter'] !== 'number' || !Number.isInteger(input['iter']) || input['iter'] < 0) {
    errors.push('iter must be a non-negative integer');
  }

  if (!isFiniteNumber(input['loss']) || input['loss'] < 0) {
    errors.push('loss must be a non-negative finite number');
  }

  if (!isFiniteNumber(input['lambda']) || input['lambda'] <= 0) {
    errors.push('lambda must be a positive finite number');
  }

  if (typeof input['accepted'] !== 'boolean') {
    errors.push('accepted must be a boolean');
  }

  const coeffRes = validateCoefficients(input['coefficients']);
  if (!coeffRes.success) {
    errors.push(...coeffRes.errors.map((e) => `coefficients: ${e}`));
  }

  if (errors.length > 0 || !coeffRes.success) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      iter: input['iter'] as number,
      loss: input['loss'] as number,
      lambda: input['lambda'] as number,
      accepted: input['accepted'] as boolean,
      coefficients: coeffRes.data,
    },
  };
}

const VALID_FIT_STATUSES: readonly FitStatus[] = ['converged', 'max_iterations', 'stalled', 'cancelled'];

/**
 * Validates a FitResult.
 */
export function validateFitResult(input: unknown): ValidationResult<FitResult> {
  if (!isObject(input)) {
    return { success: false, errors: ['FitResult must be a non-null object'] };
  }

  const errors: string[] = [];

  const status = input['status'];
  if (typeof status !== 'string' || !VALID_FIT_STATUSES.includes(status as FitStatus)) {
    errors.push(`status must be one of: ${VALID_FIT_STATUSES.join(', ')}`);
  }

  const modeRes = validateMode(input['mode']);
  if (!modeRes.success) {
    errors.push(...modeRes.errors);
  }

  const estRes = validateCoefficients(input['estimate']);
  if (!estRes.success) {
    errors.push(...estRes.errors.map((e) => `estimate: ${e}`));
  }

  if (!isFiniteNumber(input['initialLoss']) || input['initialLoss'] < 0) {
    errors.push('initialLoss must be a non-negative finite number');
  }

  if (!isFiniteNumber(input['finalLoss']) || input['finalLoss'] < 0) {
    errors.push('finalLoss must be a non-negative finite number');
  }

  const history = input['history'];
  const validHistory: IterationRecord[] = [];
  if (!Array.isArray(history)) {
    errors.push('history must be an array of iteration records');
  } else {
    for (let i = 0; i < history.length; i++) {
      const recRes = validateIterationRecord(history[i]);
      if (!recRes.success) {
        errors.push(`history[${i}]: ${recRes.errors.join('; ')}`);
      } else {
        validHistory.push(recRes.data);
      }
    }
  }

  const fittedPlanes = input['fittedPlanes'];
  const validPlanes: FocusPlane[] = [];
  if (!Array.isArray(fittedPlanes)) {
    errors.push('fittedPlanes must be an array');
  } else {
    for (let i = 0; i < fittedPlanes.length; i++) {
      const planeRes = validateFocusPlane(fittedPlanes[i]);
      if (!planeRes.success) {
        errors.push(`fittedPlanes[${i}]: ${planeRes.errors.join('; ')}`);
      } else {
        validPlanes.push(planeRes.data);
      }
    }
  }

  if (errors.length > 0 || !modeRes.success || !estRes.success) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      status: status as FitStatus,
      mode: modeRes.data,
      estimate: estRes.data,
      initialLoss: input['initialLoss'] as number,
      finalLoss: input['finalLoss'] as number,
      history: validHistory,
      fittedPlanes: validPlanes,
    },
  };
}

/**
 * Validates InformationSpectrum.
 */
export function validateInformationSpectrum(input: unknown): ValidationResult<InformationSpectrum> {
  if (!isObject(input)) {
    return { success: false, errors: ['InformationSpectrum must be a non-null object'] };
  }

  const errors: string[] = [];

  const refRes = validateCoefficients(input['reference']);
  if (!refRes.success) {
    errors.push(...refRes.errors.map((e) => `reference: ${e}`));
  }

  function validateEigenTuple(tuple: unknown, name: string): [number, number, number] | null {
    if (!Array.isArray(tuple) || tuple.length !== 3) {
      errors.push(`${name} must be a 3-element tuple of numbers`);
      return null;
    }
    for (let i = 0; i < 3; i++) {
      if (!isFiniteNumber(tuple[i])) {
        errors.push(`${name}[${i}] must be a finite number`);
        return null;
      }
    }
    return [tuple[0] as number, tuple[1] as number, tuple[2] as number];
  }

  const eigenSingle = validateEigenTuple(input['eigenSingle'], 'eigenSingle');
  const eigenDual = validateEigenTuple(input['eigenDual'], 'eigenDual');

  if (errors.length > 0 || !refRes.success || !eigenSingle || !eigenDual) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      reference: refRes.data,
      eigenSingle,
      eigenDual,
    },
  };
}

/**
 * Validates a complete FitReportV1 object.
 */
export function validateFitReportV1(input: unknown): ValidationResult<FitReportV1> {
  if (!isObject(input)) {
    return { success: false, errors: ['Fit report must be a non-null object'] };
  }

  const errors: string[] = [];

  if (input['schema'] !== REPORT_SCHEMA) {
    errors.push(`schema must be '${REPORT_SCHEMA}', got '${String(input['schema'])}'`);
  }

  if (input['specVersion'] !== SPEC_VERSION) {
    errors.push(`specVersion must be '${SPEC_VERSION}', got '${String(input['specVersion'])}'`);
  }

  const caseRes = validateCaseV1(input['caseData']);
  if (!caseRes.success) {
    errors.push(...caseRes.errors.map((e) => `caseData: ${e}`));
  }

  const fitRes = validateFitResult(input['fit']);
  if (!fitRes.success) {
    errors.push(...fitRes.errors.map((e) => `fit: ${e}`));
  }

  let infoData: InformationSpectrum | undefined = undefined;
  if (input['informationAtDualEstimate'] !== undefined) {
    const infoRes = validateInformationSpectrum(input['informationAtDualEstimate']);
    if (!infoRes.success) {
      errors.push(...infoRes.errors.map((e) => `informationAtDualEstimate: ${e}`));
    } else {
      infoData = infoRes.data;
    }
  }

  if (errors.length > 0 || !caseRes.success || !fitRes.success) {
    return { success: false, errors };
  }

  const report: FitReportV1 = {
    schema: REPORT_SCHEMA,
    specVersion: SPEC_VERSION,
    caseData: caseRes.data,
    fit: fitRes.data,
  };

  if (infoData !== undefined) {
    report.informationAtDualEstimate = infoData;
  }

  return {
    success: true,
    data: report,
  };
}

/**
 * Validates preset ID.
 */
export function validatePresetId(input: unknown): ValidationResult<PresetId> {
  if (isPresetId(input)) {
    return { success: true, data: input };
  }
  return { success: false, errors: [`Invalid presetId: '${String(input)}'`] };
}
