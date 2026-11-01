/**
 * P007 FocusWitness — Case File & Report IO Contract Tests
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 6.1: Schema definitions (focuswitness.case/v1, focuswitness.report/v1)
 * - PROJECT_BOOK.md Section 6.2: Forward-model-based case generation
 * - PROJECT_BOOK.md Section 6.3: Import validation & security (2 MiB limit, strict v1 schema, safe parse)
 * - PROJECT_BOOK.md Chapter 7: MATH08 (five presets export/import round-trip), MATH09 (negative, NaN, length, oversized rejection)
 * - IMPLEMENTATION_PLAN.md Section 3.3: parseCase, serializeCase, serializeReport
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

import {
  parseCase,
  serializeCase,
  createCaseFromCoefficients,
  createCaseFromPreset,
  safeParseCase,
  loadCaseSafely,
  CaseFileError,
} from '../../src/io/caseFile';
import {
  parseReport,
  serializeReport,
  createFitReport,
  safeParseReport,
  ReportFileError,
} from '../../src/io/reportFile';
import {
  CASE_SCHEMA,
  REPORT_SCHEMA,
  SPEC_VERSION,
  PIXEL_COUNT,
  MAX_IMPORT_FILE_SIZE_BYTES,
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
} from '../../src/domain/constants';
import { PRESET_LIST, type PresetId } from '../../src/domain/presets';
import { forwardPsf } from '../../src/math/psf';
import type { CaseV1, Coefficients, FitReportV1, FitResult } from '../../src/domain/types';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('MATH08: Five Presets Export & Import Round-trip Contract', () => {
  const presetIds: PresetId[] = ['perfect', 'mixed', 'astig-only', 'coma-only', 'spherical-only'];

  for (const presetId of presetIds) {
    it(`guarantees complete pixel/parameter fidelity and recomputation for preset '${presetId}'`, () => {
      // 1. Generate case from preset via analytical forward model
      const originalCase = createCaseFromPreset(presetId);
      expect(originalCase.schema).toBe(CASE_SCHEMA);
      expect(originalCase.specVersion).toBe(SPEC_VERSION);
      expect(originalCase.label).toBe(presetId);
      expect(originalCase.observations.minus).toHaveLength(PIXEL_COUNT);
      expect(originalCase.observations.plus).toHaveLength(PIXEL_COUNT);

      // 2. Export (serialize) to JSON
      const jsonText = serializeCase(originalCase);
      expect(typeof jsonText).toBe('string');
      expect(jsonText.length).toBeGreaterThan(0);

      // Verify file size is well under 2 MiB
      const byteSize = new TextEncoder().encode(jsonText).length;
      expect(byteSize).toBeLessThan(MAX_IMPORT_FILE_SIZE_BYTES);

      // 3. Re-import (parse) from JSON
      const importedCase = parseCase(jsonText);

      // 4. Parameter fidelity
      expect(importedCase.schema).toBe(CASE_SCHEMA);
      expect(importedCase.specVersion).toBe(SPEC_VERSION);
      expect(importedCase.label).toBe(presetId);
      expect(importedCase.optics).toEqual(originalCase.optics);
      expect(importedCase.groundTruth).toEqual(originalCase.groundTruth);

      // 5. Pixel fidelity: exact preservation across all 4096 values in both planes
      expect(importedCase.observations.minus).toHaveLength(PIXEL_COUNT);
      expect(importedCase.observations.plus).toHaveLength(PIXEL_COUNT);

      let maxPixelDiffMinus = 0.0;
      let maxPixelDiffPlus = 0.0;
      let minusSum = 0.0;
      let plusSum = 0.0;

      for (let k = 0; k < PIXEL_COUNT; k++) {
        const mOrig = originalCase.observations.minus[k]!;
        const mImp = importedCase.observations.minus[k]!;
        const pOrig = originalCase.observations.plus[k]!;
        const pImp = importedCase.observations.plus[k]!;

        const dM = Math.abs(mOrig - mImp);
        const dP = Math.abs(pOrig - pImp);
        if (dM > maxPixelDiffMinus) maxPixelDiffMinus = dM;
        if (dP > maxPixelDiffPlus) maxPixelDiffPlus = dP;

        expect(mImp).toBeGreaterThanOrEqual(0.0);
        expect(pImp).toBeGreaterThanOrEqual(0.0);
        expect(Number.isFinite(mImp)).toBe(true);
        expect(Number.isFinite(pImp)).toBe(true);

        minusSum += mImp;
        plusSum += pImp;
      }

      // Exact pixel fidelity (JSON float precision preserves doubles identically)
      expect(maxPixelDiffMinus).toBe(0.0);
      expect(maxPixelDiffPlus).toBe(0.0);

      // Intensity sum within tolerance [1 - 1e-6, 1 + 1e-6] (MATH03 requires <= 1e-12)
      expect(Math.abs(minusSum - 1.0)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(plusSum - 1.0)).toBeLessThanOrEqual(1e-12);

      // 6. Forward recomputation check: recomputed values match within numerical tolerance
      expect(importedCase.groundTruth).toBeDefined();
      const recomputedMinus = forwardPsf(importedCase.groundTruth!, DIVERSITY_DEFOCUS_MINUS);
      const recomputedPlus = forwardPsf(importedCase.groundTruth!, DIVERSITY_DEFOCUS_PLUS);

      let recompDiffMinus = 0.0;
      let recompDiffPlus = 0.0;
      let dualLoss = 0.0;

      for (let k = 0; k < PIXEL_COUNT; k++) {
        const rM = recomputedMinus[k]!;
        const rP = recomputedPlus[k]!;
        const obsM = importedCase.observations.minus[k]!;
        const obsP = importedCase.observations.plus[k]!;

        const diffM = Math.abs(rM - obsM);
        const diffP = Math.abs(rP - obsP);
        if (diffM > recompDiffMinus) recompDiffMinus = diffM;
        if (diffP > recompDiffPlus) recompDiffPlus = diffP;

        dualLoss += (rM - obsM) * (rM - obsM) + (rP - obsP) * (rP - obsP);
      }

      // Recomputed PSF is identical within double precision tolerance (<= 1e-14)
      expect(recompDiffMinus).toBeLessThanOrEqual(1e-14);
      expect(recompDiffPlus).toBeLessThanOrEqual(1e-14);

      // Dual loss at imported ground truth is <= 1e-20 (per MATH05 & MATH08)
      expect(dualLoss).toBeLessThanOrEqual(1e-20);

      console.log(
        `[MATH08] preset=${presetId} pixelDiffMinus=${maxPixelDiffMinus.toExponential(4)} pixelDiffPlus=${maxPixelDiffPlus.toExponential(4)} recompDiffMinus=${recompDiffMinus.toExponential(4)} recompDiffPlus=${recompDiffPlus.toExponential(4)} dualLoss=${dualLoss.toExponential(4)}`
      );
    });
  }
});

describe('MATH09: Input Rejection & Non-Destructive Contract', () => {
  // Baseline valid case to test non-destructive failure behavior
  function getBaselineCase(): CaseV1 {
    return createCaseFromPreset('mixed');
  }

  it('rejects negative values in observation arrays and preserves current case', () => {
    const validCase = getBaselineCase();
    const badMinus = [...validCase.observations.minus];
    badMinus[128] = -0.0005;

    const badCasePayload = {
      ...validCase,
      observations: {
        minus: badMinus,
        plus: validCase.observations.plus,
      },
    };
    const badJson = JSON.stringify(badCasePayload);

    // 1. parseCase throws CaseFileError
    expect(() => parseCase(badJson)).toThrow(CaseFileError);

    // 2. safeParseCase returns explicit errors
    const safeResult = safeParseCase(badJson);
    expect(safeResult.success).toBe(false);
    if (!safeResult.success) {
      expect(safeResult.errors.some((e) => e.includes('negative values'))).toBe(true);
    }

    // 3. loadCaseSafely preserves the current valid case intact
    let currentCase = getBaselineCase();
    const loadResult = loadCaseSafely(badJson, currentCase);
    expect(loadResult.success).toBe(false);
    expect(loadResult.error).toBeDefined();
    expect(loadResult.error).toContain('negative values');
    expect(loadResult.caseData).toBe(currentCase);
    expect(loadResult.caseData.observations.minus[128]).toBeGreaterThanOrEqual(0);

    console.log(`[MATH09] Negative values rejected: "${loadResult.error}"`);
  });

  it('rejects NaN and Infinity in observation arrays and preserves current case', () => {
    const validCase = getBaselineCase();

    // NaN in JSON serializes to null, so test both JSON string with null and validateCaseV1 with NaN
    const badMinusNull = [...validCase.observations.minus];
    badMinusNull[10] = null as unknown as number;

    const badJsonNull = JSON.stringify({
      ...validCase,
      observations: {
        minus: badMinusNull,
        plus: validCase.observations.plus,
      },
    });

    expect(() => parseCase(badJsonNull)).toThrow(CaseFileError);

    let currentCase = getBaselineCase();
    const loadNullResult = loadCaseSafely(badJsonNull, currentCase);
    expect(loadNullResult.success).toBe(false);
    expect(loadNullResult.caseData).toBe(currentCase);

    // Raw NaN / Infinity directly
    const badMinusNaN = [...validCase.observations.minus];
    badMinusNaN[10] = NaN;
    expect(() =>
      serializeCase({
        ...validCase,
        observations: { minus: badMinusNaN, plus: validCase.observations.plus },
      })
    ).toThrow(CaseFileError);

    const badPlusInf = [...validCase.observations.plus];
    badPlusInf[10] = Infinity;
    expect(() =>
      serializeCase({
        ...validCase,
        observations: { minus: validCase.observations.minus, plus: badPlusInf },
      })
    ).toThrow(CaseFileError);

    console.log(`[MATH09] NaN/null rejected: "${loadNullResult.error}"`);
  });

  it('rejects array length errors (not 4096 elements) and preserves current case', () => {
    const validCase = getBaselineCase();

    // 4095 elements (one short)
    const shortPlane = validCase.observations.minus.slice(0, 4095);
    const badShortJson = JSON.stringify({
      ...validCase,
      observations: {
        minus: shortPlane,
        plus: validCase.observations.plus,
      },
    });

    expect(() => parseCase(badShortJson)).toThrow(CaseFileError);
    let currentCase = getBaselineCase();
    const shortResult = loadCaseSafely(badShortJson, currentCase);
    expect(shortResult.success).toBe(false);
    expect(shortResult.caseData).toBe(currentCase);
    expect(shortResult.error).toContain('length must be 4096');

    // 4097 elements (one too many)
    const longPlane = [...validCase.observations.minus, 0.0];
    const badLongJson = JSON.stringify({
      ...validCase,
      observations: {
        minus: validCase.observations.minus,
        plus: longPlane,
      },
    });

    expect(() => parseCase(badLongJson)).toThrow(CaseFileError);
    const longResult = loadCaseSafely(badLongJson, currentCase);
    expect(longResult.success).toBe(false);
    expect(longResult.caseData).toBe(currentCase);
    expect(longResult.error).toContain('length must be 4096');

    // Empty array
    const emptyJson = JSON.stringify({
      ...validCase,
      observations: {
        minus: [],
        plus: validCase.observations.plus,
      },
    });
    expect(() => parseCase(emptyJson)).toThrow(CaseFileError);

    console.log(`[MATH09] Length mismatch rejected: "${shortResult.error}"`);
  });

  it('rejects oversized JSON exceeding 2 MiB and preserves current case', () => {
    const validCase = getBaselineCase();
    // Create a padding payload that pushes total byte size beyond 2 MiB
    const padLength = MAX_IMPORT_FILE_SIZE_BYTES + 1024;
    const oversizedPayload = {
      ...validCase,
      comment: 'X'.repeat(padLength),
    };
    const oversizedJson = JSON.stringify(oversizedPayload);
    const byteLength = new TextEncoder().encode(oversizedJson).length;
    expect(byteLength).toBeGreaterThan(MAX_IMPORT_FILE_SIZE_BYTES);

    // Must throw CaseFileError indicating file size exceeded
    expect(() => parseCase(oversizedJson)).toThrow(CaseFileError);

    let currentCase = getBaselineCase();
    const loadResult = loadCaseSafely(oversizedJson, currentCase);
    expect(loadResult.success).toBe(false);
    expect(loadResult.caseData).toBe(currentCase);
    expect(loadResult.error).toContain('exceeds maximum allowed size');

    console.log(
      `[MATH09] Oversized JSON rejected: size=${(byteLength / 1024 / 1024).toFixed(2)} MiB limit=2 MiB error="${loadResult.error}"`
    );
  });

  it('rejects malformed JSON syntax safely without crashing and preserves current case', () => {
    const brokenJson = '{"schema": "focuswitness.case/v1", "broken": ';
    expect(() => parseCase(brokenJson)).toThrow(CaseFileError);

    let currentCase = getBaselineCase();
    const loadResult = loadCaseSafely(brokenJson, currentCase);
    expect(loadResult.success).toBe(false);
    expect(loadResult.caseData).toBe(currentCase);
    expect(loadResult.error).toContain('JSON parse error');
  });

  it('rejects schema or specVersion mismatch and preserves current case', () => {
    const validCase = getBaselineCase();

    const badSchemaJson = JSON.stringify({
      ...validCase,
      schema: 'focuswitness.case/v2',
    });
    expect(() => parseCase(badSchemaJson)).toThrow(CaseFileError);

    const badSpecJson = JSON.stringify({
      ...validCase,
      specVersion: '2.0.0',
    });
    expect(() => parseCase(badSpecJson)).toThrow(CaseFileError);

    let currentCase = getBaselineCase();
    const loadResult = loadCaseSafely(badSchemaJson, currentCase);
    expect(loadResult.success).toBe(false);
    expect(loadResult.caseData).toBe(currentCase);
  });

  it('rejects observation sum outside normalization tolerance [1 - 1e-6, 1 + 1e-6]', () => {
    const validCase = getBaselineCase();
    const unnormalizedPlane = validCase.observations.minus.map((v) => v * 1.5); // sum is ~1.5
    const badSumJson = JSON.stringify({
      ...validCase,
      observations: {
        minus: unnormalizedPlane,
        plus: validCase.observations.plus,
      },
    });

    expect(() => parseCase(badSumJson)).toThrow(CaseFileError);

    let currentCase = getBaselineCase();
    const loadResult = loadCaseSafely(badSumJson, currentCase);
    expect(loadResult.success).toBe(false);
    expect(loadResult.caseData).toBe(currentCase);
    expect(loadResult.error).toContain('outside required normalized range');
  });

  it('rejects groundTruth coefficients outside allowed range [-0.15, 0.15] waves', () => {
    const validCase = getBaselineCase();
    const badGtJson = JSON.stringify({
      ...validCase,
      groundTruth: { astig0: 0.25, comaX: 0, spherical: 0 },
    });

    expect(() => parseCase(badGtJson)).toThrow(CaseFileError);

    let currentCase = getBaselineCase();
    const loadResult = loadCaseSafely(badGtJson, currentCase);
    expect(loadResult.success).toBe(false);
    expect(loadResult.caseData).toBe(currentCase);
    expect(loadResult.error).toContain('out of allowed range');
  });
});

describe('Case IO: Optional Ground Truth & Pure Observation Imports', () => {
  it('supports importing and exporting cases without ground truth (blind case)', () => {
    const fullCase = createCaseFromPreset('mixed');
    const blindCase: CaseV1 = {
      schema: fullCase.schema,
      specVersion: fullCase.specVersion,
      optics: fullCase.optics,
      observations: fullCase.observations,
      label: 'blind-observation',
    };

    const serialized = serializeCase(blindCase);
    const parsed = parseCase(serialized);

    expect(parsed.schema).toBe(CASE_SCHEMA);
    expect(parsed.specVersion).toBe(SPEC_VERSION);
    expect(parsed.groundTruth).toBeUndefined();
    expect(parsed.label).toBe('blind-observation');
    expect(parsed.observations.minus).toHaveLength(PIXEL_COUNT);
    expect(parsed.observations.plus).toHaveLength(PIXEL_COUNT);
  });

  it('correctly loads valid new case and updates state via loadCaseSafely', () => {
    const currentCase = createCaseFromPreset('perfect');
    const newCase = createCaseFromPreset('mixed');
    const newJson = serializeCase(newCase);

    const result = loadCaseSafely(newJson, currentCase);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.caseData.label).toBe('mixed');
    expect(result.caseData.groundTruth).toEqual(newCase.groundTruth);
  });
});

describe('Report File IO Contract: FitReportV1', () => {
  function createSampleReport(includeIdentifiability = true): FitReportV1 {
    const caseData = createCaseFromPreset('mixed');
    const fit: FitResult = {
      status: 'converged',
      mode: 'dual',
      estimate: { astig0: 0.0799, comaX: -0.0598, spherical: 0.0401 },
      initialLoss: 0.012,
      finalLoss: 1.2e-15,
      history: [
        {
          iter: 0,
          loss: 0.012,
          lambda: 0.01,
          accepted: true,
          coefficients: { astig0: 0, comaX: 0, spherical: 0 },
        },
        {
          iter: 1,
          loss: 1.2e-15,
          lambda: 0.003,
          accepted: true,
          coefficients: { astig0: 0.0799, comaX: -0.0598, spherical: 0.0401 },
        },
      ],
      fittedPlanes: [-0.65, 0.65],
    };

    return createFitReport(
      caseData,
      fit,
      includeIdentifiability
        ? {
            reference: fit.estimate,
            eigenSingle: [1.85, 0.92, 0.24],
            eigenDual: [3.71, 1.84, 0.49],
          }
        : undefined
    );
  }

  it('serializes and parses FitReportV1 round-trip with identifiability spectrum', () => {
    const originalReport = createSampleReport(true);
    expect(originalReport.schema).toBe(REPORT_SCHEMA);
    expect(originalReport.specVersion).toBe(SPEC_VERSION);

    const serialized = serializeReport(originalReport);
    expect(typeof serialized).toBe('string');
    expect(serialized.length).toBeGreaterThan(0);

    const parsed = parseReport(serialized);
    expect(parsed.schema).toBe(REPORT_SCHEMA);
    expect(parsed.specVersion).toBe(SPEC_VERSION);
    expect(parsed.fit.status).toBe('converged');
    expect(parsed.fit.finalLoss).toBe(1.2e-15);
    expect(parsed.informationAtDualEstimate).toBeDefined();
    expect(parsed.informationAtDualEstimate?.eigenDual).toEqual([3.71, 1.84, 0.49]);
  });

  it('serializes and parses FitReportV1 round-trip without identifiability spectrum', () => {
    const originalReport = createSampleReport(false);
    expect(originalReport.informationAtDualEstimate).toBeUndefined();

    const serialized = serializeReport(originalReport);
    const parsed = parseReport(serialized);
    expect(parsed.informationAtDualEstimate).toBeUndefined();
    expect(parsed.fit.mode).toBe('dual');
  });

  it('rejects invalid FitReportV1 on serialization', () => {
    const badReport = {
      ...createSampleReport(),
      schema: 'focuswitness.report/v2' as unknown as 'focuswitness.report/v1',
    };
    expect(() => serializeReport(badReport)).toThrow(ReportFileError);
  });

  it('rejects invalid or corrupted Report JSON string on parse', () => {
    expect(() => parseReport('not valid json')).toThrow(ReportFileError);
    expect(safeParseReport('{}').success).toBe(false);
  });
});

describe('Golden Fixture Integration', () => {
  it('parses golden-mixed.json successfully and verifies fidelity with mixed preset', () => {
    const fixturePath = join(__dirname, '../fixtures/golden-mixed.json');
    const rawFixture = readFileSync(fixturePath, 'utf-8');

    const imported = parseCase(rawFixture);
    expect(imported.schema).toBe(CASE_SCHEMA);
    expect(imported.specVersion).toBe(SPEC_VERSION);
    expect(imported.label).toBe('mixed');
    expect(imported.groundTruth).toEqual({ astig0: 0.08, comaX: -0.06, spherical: 0.04 });

    // Recompute with forwardPsf and verify zero diff
    const refMinus = forwardPsf(imported.groundTruth!, DIVERSITY_DEFOCUS_MINUS);
    const refPlus = forwardPsf(imported.groundTruth!, DIVERSITY_DEFOCUS_PLUS);

    let maxDiffMinus = 0.0;
    let maxDiffPlus = 0.0;
    for (let i = 0; i < PIXEL_COUNT; i++) {
      const dM = Math.abs(refMinus[i]! - imported.observations.minus[i]!);
      const dP = Math.abs(refPlus[i]! - imported.observations.plus[i]!);
      if (dM > maxDiffMinus) maxDiffMinus = dM;
      if (dP > maxDiffPlus) maxDiffPlus = dP;
    }

    expect(maxDiffMinus).toBeLessThanOrEqual(1e-14);
    expect(maxDiffPlus).toBeLessThanOrEqual(1e-14);
  });
});
