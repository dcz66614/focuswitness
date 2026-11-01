import { describe, it, expect } from 'vitest';
import {
  GRID_SIZE,
  PIXEL_COUNT,
  PUPIL_RADIUS_PX,
  PUPIL_CENTER_X,
  PUPIL_CENTER_Y,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
  DIVERSITY_WAVES,
  FITTED_PLANES_SINGLE,
  FITTED_PLANES_DUAL,
  COEFFICIENT_MIN,
  COEFFICIENT_MAX,
  COEFFICIENT_NAMES,
  INITIAL_COEFFICIENTS,
  MAX_ITERATIONS,
  FINITE_DIFFERENCE_STEP,
  INITIAL_LAMBDA,
  LAMBDA_MIN,
  LAMBDA_MAX,
  LAMBDA_DECREASE_FACTOR,
  LAMBDA_INCREASE_FACTOR,
  MAX_STEP_DELTA,
  LOSS_IMPROVEMENT_EPSILON,
  DIAGONAL_MIN_REGULARIZATION,
  MARQUARDT_IDENTITY_EPSILON,
  CONVERGENCE_LOSS_THRESHOLD,
  CONVERGENCE_STEP_THRESHOLD,
  CONVERGENCE_RELATIVE_LOSS_THRESHOLD,
  CONVERGENCE_CONSECUTIVE_STEPS,
  CONDITION_NUMBER_MIN_EIGEN,
  LOG_DISPLAY_EPSILON,
  CASE_SCHEMA,
  REPORT_SCHEMA,
  SPEC_VERSION,
  MAX_IMPORT_FILE_SIZE_BYTES,
  OBSERVATION_SUM_TOLERANCE,
  OBSERVATION_SUM_MIN,
  OBSERVATION_SUM_MAX,
  DEFAULT_PRESET_ID,
  DEFAULT_MODE,
} from '../../src/domain/constants';
import {
  PRESETS,
  PRESET_LIST,
  PRESET_PERFECT,
  PRESET_MIXED,
  PRESET_ASTIG_ONLY,
  PRESET_COMA_ONLY,
  PRESET_SPHERICAL_ONLY,
  DEFAULT_PRESET,
  getPreset,
  isPresetId,
} from '../../src/domain/presets';
import {
  validateCoefficients,
  validateOptics,
  validateObservations,
  validateCaseV1,
  validateCaseJson,
  validateMode,
  validateFocusPlane,
  validateIterationRecord,
  validateFitResult,
  validateInformationSpectrum,
  validateFitReportV1,
  validatePresetId,
} from '../../src/domain/validation';
import type { CaseV1, Coefficients, FitReportV1, FitResult, PresetId } from '../../src/domain/types';

// Helper to construct normalized dummy plane of 4096 elements
function createNormalizedPlane(length = PIXEL_COUNT, fillVal = 1 / PIXEL_COUNT): number[] {
  return new Array(length).fill(fillVal);
}

function createValidCase(): CaseV1 {
  return {
    schema: CASE_SCHEMA,
    specVersion: SPEC_VERSION,
    optics: {
      gridSize: 64,
      pupilRadiusPx: 16,
      diversityWaves: [-0.65, 0.65],
    },
    observations: {
      minus: createNormalizedPlane(),
      plus: createNormalizedPlane(),
    },
    groundTruth: {
      astig0: 0.08,
      comaX: -0.06,
      spherical: 0.04,
    },
    label: 'mixed',
  };
}

describe('Domain Constants Contract', () => {
  it('enforces exact discrete optical grid parameters', () => {
    expect(GRID_SIZE).toBe(64);
    expect(PIXEL_COUNT).toBe(4096);
    expect(PUPIL_RADIUS_PX).toBe(16);
    expect(PUPIL_CENTER_X).toBe(32);
    expect(PUPIL_CENTER_Y).toBe(32);
  });

  it('enforces diversity planes fixed to -0.65 and +0.65 waves', () => {
    expect(DIVERSITY_DEFOCUS_MINUS).toBe(-0.65);
    expect(DIVERSITY_DEFOCUS_PLUS).toBe(0.65);
    expect(DIVERSITY_WAVES).toEqual([-0.65, 0.65]);
    expect(FITTED_PLANES_SINGLE).toEqual([-0.65]);
    expect(FITTED_PLANES_DUAL).toEqual([-0.65, 0.65]);
  });

  it('enforces coefficient bounds [-0.15, 0.15] waves and dimension names', () => {
    expect(COEFFICIENT_MIN).toBe(-0.15);
    expect(COEFFICIENT_MAX).toBe(0.15);
    expect(COEFFICIENT_NAMES).toEqual(['astig0', 'comaX', 'spherical']);
    expect(INITIAL_COEFFICIENTS).toEqual({ astig0: 0, comaX: 0, spherical: 0 });
    expect(Object.isFrozen(INITIAL_COEFFICIENTS)).toBe(true);
  });

  it('enforces LM solver optimization parameters', () => {
    expect(MAX_ITERATIONS).toBe(60);
    expect(FINITE_DIFFERENCE_STEP).toBe(1e-4);
    expect(INITIAL_LAMBDA).toBe(1e-2);
    expect(LAMBDA_MIN).toBe(1e-7);
    expect(LAMBDA_MAX).toBe(1e7);
    expect(LAMBDA_DECREASE_FACTOR).toBe(0.3);
    expect(LAMBDA_INCREASE_FACTOR).toBe(10);
    expect(MAX_STEP_DELTA).toBe(0.04);
    expect(LOSS_IMPROVEMENT_EPSILON).toBe(1e-18);
    expect(DIAGONAL_MIN_REGULARIZATION).toBe(1e-12);
    expect(MARQUARDT_IDENTITY_EPSILON).toBe(1e-12);
    expect(CONVERGENCE_LOSS_THRESHOLD).toBe(1e-14);
    expect(CONVERGENCE_STEP_THRESHOLD).toBe(1e-7);
    expect(CONVERGENCE_RELATIVE_LOSS_THRESHOLD).toBe(1e-10);
    expect(CONVERGENCE_CONSECUTIVE_STEPS).toBe(3);
  });

  it('enforces schema identifiers and import limits', () => {
    expect(CASE_SCHEMA).toBe('focuswitness.case/v1');
    expect(REPORT_SCHEMA).toBe('focuswitness.report/v1');
    expect(SPEC_VERSION).toBe('1.0.0');
    expect(MAX_IMPORT_FILE_SIZE_BYTES).toBe(2 * 1024 * 1024);
    expect(OBSERVATION_SUM_TOLERANCE).toBe(1e-6);
    expect(OBSERVATION_SUM_MIN).toBeCloseTo(1 - 1e-6, 12);
    expect(OBSERVATION_SUM_MAX).toBeCloseTo(1 + 1e-6, 12);
    expect(LOG_DISPLAY_EPSILON).toBe(1e-8);
    expect(CONDITION_NUMBER_MIN_EIGEN).toBe(1e-14);
    expect(DEFAULT_PRESET_ID).toBe('mixed');
    expect(DEFAULT_MODE).toBe('dual');
  });
});

describe('Domain Presets Contract', () => {
  it('enforces the exact 5 frozen preset coefficients', () => {
    // 1. perfect: (0, 0, 0)
    expect(PRESET_PERFECT.id).toBe('perfect');
    expect(PRESET_PERFECT.coefficients).toEqual({
      astig0: 0.00,
      comaX: 0.00,
      spherical: 0.00,
    });

    // 2. mixed: (0.08, -0.06, 0.04)
    expect(PRESET_MIXED.id).toBe('mixed');
    expect(PRESET_MIXED.coefficients).toEqual({
      astig0: 0.08,
      comaX: -0.06,
      spherical: 0.04,
    });

    // 3. astig-only: (0.10, 0, 0)
    expect(PRESET_ASTIG_ONLY.id).toBe('astig-only');
    expect(PRESET_ASTIG_ONLY.coefficients).toEqual({
      astig0: 0.10,
      comaX: 0.00,
      spherical: 0.00,
    });

    // 4. coma-only: (0, -0.08, 0)
    expect(PRESET_COMA_ONLY.id).toBe('coma-only');
    expect(PRESET_COMA_ONLY.coefficients).toEqual({
      astig0: 0.00,
      comaX: -0.08,
      spherical: 0.00,
    });

    // 5. spherical-only: (0, 0, 0.10)
    expect(PRESET_SPHERICAL_ONLY.id).toBe('spherical-only');
    expect(PRESET_SPHERICAL_ONLY.coefficients).toEqual({
      astig0: 0.00,
      comaX: 0.00,
      spherical: 0.10,
    });
  });

  it('guarantees all preset coefficients are strictly within bounds [-0.15, 0.15]', () => {
    for (const preset of PRESET_LIST) {
      for (const key of COEFFICIENT_NAMES) {
        const val = preset.coefficients[key];
        expect(val).toBeGreaterThanOrEqual(COEFFICIENT_MIN);
        expect(val).toBeLessThanOrEqual(COEFFICIENT_MAX);
      }
      expect(Object.isFrozen(preset)).toBe(true);
      expect(Object.isFrozen(preset.coefficients)).toBe(true);
    }
  });

  it('guarantees PRESET_LIST contains all 5 presets with mixed as the default leading entry', () => {
    expect(PRESET_LIST).toHaveLength(5);
    expect(PRESET_LIST[0]?.id).toBe('mixed');
    expect(DEFAULT_PRESET.id).toBe('mixed');
    expect(Object.isFrozen(PRESET_LIST)).toBe(true);
    expect(Object.isFrozen(PRESETS)).toBe(true);
  });

  it('validates preset helper functions', () => {
    expect(getPreset('perfect').id).toBe('perfect');
    expect(getPreset('mixed').id).toBe('mixed');
    expect(getPreset('astig-only').id).toBe('astig-only');
    expect(getPreset('coma-only').id).toBe('coma-only');
    expect(getPreset('spherical-only').id).toBe('spherical-only');
    expect(getPreset('invalid' as unknown as PresetId).id).toBe('mixed');

    expect(isPresetId('mixed')).toBe(true);
    expect(isPresetId('perfect')).toBe(true);
    expect(isPresetId('astig-only')).toBe(true);
    expect(isPresetId('coma-only')).toBe(true);
    expect(isPresetId('spherical-only')).toBe(true);
    expect(isPresetId('random-id')).toBe(false);
    expect(isPresetId(null)).toBe(false);
    expect(isPresetId(123)).toBe(false);
  });
});

describe('Domain Validation Contract — Coefficients', () => {
  it('accepts valid coefficients within [-0.15, 0.15]', () => {
    const res = validateCoefficients({ astig0: 0.05, comaX: -0.05, spherical: 0.12 });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data).toEqual({ astig0: 0.05, comaX: -0.05, spherical: 0.12 });
    }
  });

  it('accepts exact boundary values -0.15 and +0.15', () => {
    const minRes = validateCoefficients({ astig0: -0.15, comaX: -0.15, spherical: -0.15 });
    expect(minRes.success).toBe(true);

    const maxRes = validateCoefficients({ astig0: 0.15, comaX: 0.15, spherical: 0.15 });
    expect(maxRes.success).toBe(true);
  });

  it('rejects coefficients exceeding bounds', () => {
    const outHigh = validateCoefficients({ astig0: 0.150001, comaX: 0, spherical: 0 });
    expect(outHigh.success).toBe(false);
    if (!outHigh.success) {
      expect(outHigh.errors[0]).toContain('out of allowed range');
    }

    const outLow = validateCoefficients({ astig0: 0, comaX: -0.150001, spherical: 0 });
    expect(outLow.success).toBe(false);
    if (!outLow.success) {
      expect(outLow.errors[0]).toContain('out of allowed range');
    }
  });

  it('rejects NaN, Infinity, -Infinity and non-numbers in coefficients', () => {
    expect(validateCoefficients({ astig0: NaN, comaX: 0, spherical: 0 }).success).toBe(false);
    expect(validateCoefficients({ astig0: 0, comaX: Infinity, spherical: 0 }).success).toBe(false);
    expect(validateCoefficients({ astig0: 0, comaX: 0, spherical: -Infinity }).success).toBe(false);
    expect(validateCoefficients({ astig0: '0.08', comaX: 0, spherical: 0 }).success).toBe(false);
    expect(validateCoefficients({ astig0: null, comaX: 0, spherical: 0 }).success).toBe(false);
    expect(validateCoefficients({ comaX: 0, spherical: 0 }).success).toBe(false);
  });

  it('rejects null, non-objects and arrays', () => {
    expect(validateCoefficients(null).success).toBe(false);
    expect(validateCoefficients(undefined).success).toBe(false);
    expect(validateCoefficients([0, 0, 0]).success).toBe(false);
    expect(validateCoefficients('coefficients').success).toBe(false);
  });
});

describe('Domain Validation Contract — Optics', () => {
  it('accepts correct discrete optical configuration', () => {
    const res = validateOptics({
      gridSize: 64,
      pupilRadiusPx: 16,
      diversityWaves: [-0.65, 0.65],
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.gridSize).toBe(64);
      expect(res.data.pupilRadiusPx).toBe(16);
      expect(res.data.diversityWaves).toEqual([-0.65, 0.65]);
    }
  });

  it('rejects invalid gridSize or pupilRadiusPx', () => {
    expect(
      validateOptics({ gridSize: 128, pupilRadiusPx: 16, diversityWaves: [-0.65, 0.65] }).success,
    ).toBe(false);
    expect(
      validateOptics({ gridSize: 64, pupilRadiusPx: 32, diversityWaves: [-0.65, 0.65] }).success,
    ).toBe(false);
  });

  it('rejects invalid diversityWaves array', () => {
    expect(
      validateOptics({ gridSize: 64, pupilRadiusPx: 16, diversityWaves: [-0.5, 0.5] }).success,
    ).toBe(false);
    expect(
      validateOptics({ gridSize: 64, pupilRadiusPx: 16, diversityWaves: [-0.65] }).success,
    ).toBe(false);
    expect(
      validateOptics({ gridSize: 64, pupilRadiusPx: 16, diversityWaves: 'defocus' }).success,
    ).toBe(false);
  });

  it('rejects non-object optics', () => {
    expect(validateOptics(null).success).toBe(false);
    expect(validateOptics(64).success).toBe(false);
  });
});

describe('Domain Validation Contract — Observations', () => {
  it('accepts valid 4096-length non-negative arrays with sum = 1.0', () => {
    const res = validateObservations({
      minus: createNormalizedPlane(),
      plus: createNormalizedPlane(),
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.minus).toHaveLength(4096);
      expect(res.data.plus).toHaveLength(4096);
    }
  });

  it('accepts sums right on tolerance boundaries [1 - 1e-6, 1 + 1e-6]', () => {
    const minusLower = createNormalizedPlane();
    minusLower[0] = (minusLower[0] ?? 0) - 1e-6; // sum = 1 - 1e-6

    const plusUpper = createNormalizedPlane();
    plusUpper[0] = (plusUpper[0] ?? 0) + 1e-6; // sum = 1 + 1e-6

    const res = validateObservations({ minus: minusLower, plus: plusUpper });
    expect(res.success).toBe(true);
  });

  it('rejects observation sums outside tolerance [1 - 1e-6, 1 + 1e-6]', () => {
    const minusTooLow = createNormalizedPlane();
    minusTooLow[0] = (minusTooLow[0] ?? 0) - 1.05e-6;

    const resLow = validateObservations({
      minus: minusTooLow,
      plus: createNormalizedPlane(),
    });
    expect(resLow.success).toBe(false);
    if (!resLow.success) {
      expect(resLow.errors[0]).toContain('outside required normalized range');
    }

    const plusTooHigh = createNormalizedPlane();
    plusTooHigh[0] = (plusTooHigh[0] ?? 0) + 1.05e-6;

    const resHigh = validateObservations({
      minus: createNormalizedPlane(),
      plus: plusTooHigh,
    });
    expect(resHigh.success).toBe(false);
  });

  it('rejects observation arrays with wrong lengths', () => {
    expect(
      validateObservations({
        minus: createNormalizedPlane(4095),
        plus: createNormalizedPlane(),
      }).success,
    ).toBe(false);

    expect(
      validateObservations({
        minus: createNormalizedPlane(),
        plus: createNormalizedPlane(4097),
      }).success,
    ).toBe(false);
  });

  it('rejects observation arrays with negative values', () => {
    const minus = createNormalizedPlane();
    minus[10] = -0.001;
    minus[11] = (minus[11] ?? 0) + 0.001; // keep sum near 1
    const res = validateObservations({ minus, plus: createNormalizedPlane() });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.some((e) => e.includes('negative values'))).toBe(true);
    }
  });

  it('rejects observation arrays with NaN or Infinity', () => {
    const minusWithNaN = createNormalizedPlane();
    minusWithNaN[5] = NaN;
    expect(
      validateObservations({ minus: minusWithNaN, plus: createNormalizedPlane() }).success,
    ).toBe(false);

    const plusWithInf = createNormalizedPlane();
    plusWithInf[100] = Infinity;
    expect(
      validateObservations({ minus: createNormalizedPlane(), plus: plusWithInf }).success,
    ).toBe(false);
  });

  it('rejects non-array or missing planes', () => {
    expect(validateObservations({ minus: 'not an array', plus: createNormalizedPlane() }).success).toBe(
      false,
    );
    expect(validateObservations({ minus: createNormalizedPlane() }).success).toBe(false);
    expect(validateObservations(null).success).toBe(false);
  });
});

describe('Domain Validation Contract — CaseV1 and JSON Import', () => {
  it('accepts complete valid CaseV1 with groundTruth and label', () => {
    const validCase = createValidCase();
    const res = validateCaseV1(validCase);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.schema).toBe(CASE_SCHEMA);
      expect(res.data.specVersion).toBe(SPEC_VERSION);
      expect(res.data.groundTruth).toEqual({ astig0: 0.08, comaX: -0.06, spherical: 0.04 });
      expect(res.data.label).toBe('mixed');
    }
  });

  it('accepts valid CaseV1 without groundTruth or label (pure observations)', () => {
    const c: CaseV1 = {
      schema: CASE_SCHEMA,
      specVersion: SPEC_VERSION,
      optics: {
        gridSize: 64,
        pupilRadiusPx: 16,
        diversityWaves: [-0.65, 0.65],
      },
      observations: {
        minus: createNormalizedPlane(),
        plus: createNormalizedPlane(),
      },
    };
    const res = validateCaseV1(c);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.groundTruth).toBeUndefined();
      expect(res.data.label).toBeUndefined();
    }
  });

  it('rejects mismatched schema or specVersion', () => {
    const badSchema = { ...createValidCase(), schema: 'focuswitness.case/v2' };
    expect(validateCaseV1(badSchema).success).toBe(false);

    const badSpec = { ...createValidCase(), specVersion: '2.0.0' };
    expect(validateCaseV1(badSpec).success).toBe(false);
  });

  it('rejects CaseV1 with invalid groundTruth', () => {
    const badGT = {
      ...createValidCase(),
      groundTruth: { astig0: 0.30, comaX: 0, spherical: 0 },
    };
    const res = validateCaseV1(badGT);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.some((e) => e.includes('groundTruth'))).toBe(true);
    }
  });

  it('rejects CaseV1 with non-string label', () => {
    const badLabel = {
      ...createValidCase(),
      label: 12345,
    };
    expect(validateCaseV1(badLabel).success).toBe(false);
  });

  it('parses and validates valid Case JSON string', () => {
    const jsonStr = JSON.stringify(createValidCase());
    const res = validateCaseJson(jsonStr);
    expect(res.success).toBe(true);
  });

  it('safely catches malformed JSON string without throwing uncaught exceptions', () => {
    const badJson = '{"schema": "focuswitness.case/v1", unclosed...';
    const res = validateCaseJson(badJson);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0]).toContain('JSON parse error');
    }
  });

  it('rejects JSON exceeding maximum allowed file size (2 MiB)', () => {
    // Generate large JSON string exceeding 2 MiB
    const largePadding = 'a'.repeat(2 * 1024 * 1024 + 10);
    const oversizedJson = JSON.stringify({
      ...createValidCase(),
      label: largePadding,
    });
    const res = validateCaseJson(oversizedJson);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors[0]).toContain('exceeds maximum allowed size');
    }
  });

  it('rejects non-string input to validateCaseJson', () => {
    expect(validateCaseJson(null as unknown as string).success).toBe(false);
    expect(validateCaseJson(12345 as unknown as string).success).toBe(false);
  });
});

describe('Domain Validation Contract — Mode, FocusPlane, FitResult, and Report', () => {
  it('validates Mode properly', () => {
    expect(validateMode('single').success).toBe(true);
    expect(validateMode('dual').success).toBe(true);
    expect(validateMode('triple').success).toBe(false);
    expect(validateMode(null).success).toBe(false);
  });

  it('validates FocusPlane properly', () => {
    expect(validateFocusPlane(-0.65).success).toBe(true);
    expect(validateFocusPlane(0.65).success).toBe(true);
    expect(validateFocusPlane(0).success).toBe(false);
    expect(validateFocusPlane(-0.5).success).toBe(false);
  });

  it('validates IterationRecord properly', () => {
    const validRecord = {
      iter: 1,
      loss: 1e-5,
      lambda: 0.01,
      accepted: true,
      coefficients: { astig0: 0.05, comaX: -0.02, spherical: 0.01 },
    };
    expect(validateIterationRecord(validRecord).success).toBe(true);

    expect(validateIterationRecord({ ...validRecord, iter: -1 }).success).toBe(false);
    expect(validateIterationRecord({ ...validRecord, loss: -0.01 }).success).toBe(false);
    expect(validateIterationRecord({ ...validRecord, lambda: 0 }).success).toBe(false);
    expect(validateIterationRecord({ ...validRecord, accepted: 'yes' }).success).toBe(false);
  });

  it('validates FitResult properly', () => {
    const validFit: FitResult = {
      status: 'converged',
      mode: 'dual',
      estimate: { astig0: 0.08, comaX: -0.06, spherical: 0.04 },
      initialLoss: 0.005,
      finalLoss: 1e-15,
      history: [
        {
          iter: 0,
          loss: 0.005,
          lambda: 0.01,
          accepted: true,
          coefficients: { astig0: 0, comaX: 0, spherical: 0 },
        },
      ],
      fittedPlanes: [-0.65, 0.65],
    };
    const res = validateFitResult(validFit);
    expect(res.success).toBe(true);

    expect(validateFitResult({ ...validFit, status: 'unknown_status' }).success).toBe(false);
    expect(validateFitResult({ ...validFit, initialLoss: -1 }).success).toBe(false);
  });

  it('validates InformationSpectrum properly', () => {
    const validInfo = {
      reference: { astig0: 0.08, comaX: -0.06, spherical: 0.04 },
      eigenSingle: [1.2, 0.8, 0.3],
      eigenDual: [2.5, 1.6, 0.7],
    };
    const res = validateInformationSpectrum(validInfo);
    expect(res.success).toBe(true);

    expect(validateInformationSpectrum({ ...validInfo, eigenSingle: [1.2, 0.8] }).success).toBe(
      false,
    );
    expect(validateInformationSpectrum({ ...validInfo, eigenDual: [1, 2, NaN] }).success).toBe(
      false,
    );
  });

  it('validates FitReportV1 properly', () => {
    const validReport: FitReportV1 = {
      schema: REPORT_SCHEMA,
      specVersion: SPEC_VERSION,
      caseData: createValidCase(),
      fit: {
        status: 'converged',
        mode: 'dual',
        estimate: { astig0: 0.08, comaX: -0.06, spherical: 0.04 },
        initialLoss: 0.005,
        finalLoss: 1e-15,
        history: [],
        fittedPlanes: [-0.65, 0.65],
      },
      informationAtDualEstimate: {
        reference: { astig0: 0.08, comaX: -0.06, spherical: 0.04 },
        eigenSingle: [1.2, 0.8, 0.3],
        eigenDual: [2.5, 1.6, 0.7],
      },
    };
    const res = validateFitReportV1(validReport);
    expect(res.success).toBe(true);

    const badSchemaReport = { ...validReport, schema: 'focuswitness.report/v2' };
    expect(validateFitReportV1(badSchemaReport).success).toBe(false);
  });

  it('validates PresetId with validatePresetId', () => {
    expect(validatePresetId('mixed').success).toBe(true);
    expect(validatePresetId('spherical-only').success).toBe(true);
    expect(validatePresetId('invalid-preset').success).toBe(false);
  });
});
