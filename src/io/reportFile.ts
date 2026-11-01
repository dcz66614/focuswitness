/**
 * P007 FocusWitness — Fit Report File IO & Data Contract
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 6.1: FitReportV1 schema definition (focuswitness.report/v1)
 * - PROJECT_BOOK.md Section 6.3: Import validation & security (2 MiB limit, strict v1 schema)
 * - PROJECT_BOOK.md Section 6.5: Export fit-report-*.json (auditable input, result, trajectory)
 * - IMPLEMENTATION_PLAN.md Section 3.3: serializeReport(report: FitReportV1)
 */

import {
  REPORT_SCHEMA,
  SPEC_VERSION,
  MAX_IMPORT_FILE_SIZE_BYTES,
} from '../domain/constants';
import type {
  CaseV1,
  FitReportV1,
  FitResult,
  InformationSpectrum,
} from '../domain/types';
import {
  validateFitReportV1,
  type ValidationResult,
} from '../domain/validation';

/**
 * Custom error class for Report parsing/serialization failures.
 */
export class ReportFileError extends Error {
  public readonly errors: readonly string[];

  constructor(message: string, errors: readonly string[] = []) {
    super(message);
    this.name = 'ReportFileError';
    this.errors = errors;
  }
}

/**
 * Serializes a FitReportV1 object into a formatted JSON string.
 *
 * Guarantees:
 * - Validates input against FitReportV1 schema before serialization.
 * - Enforces schema 'focuswitness.report/v1' and specVersion '1.0.0'.
 * - CaseData and Fit results must pass numerical and structural checks.
 * - Prevents serialization of NaN, Infinity, or negative losses.
 *
 * @param report Valid FitReportV1 object
 * @param indent Indentation spaces for JSON formatting (default: 2)
 * @returns Formatted JSON string
 */
export function serializeReport(report: FitReportV1, indent: number = 2): string {
  const result = validateFitReportV1(report);
  if (!result.success) {
    const errorMsg = `Cannot serialize invalid FitReportV1: ${result.errors.join('; ')}`;
    throw new ReportFileError(errorMsg, result.errors);
  }

  return JSON.stringify(result.data, null, indent);
}

/**
 * Non-throwing safe parser for Report JSON strings.
 *
 * @param text JSON string to validate and parse
 * @param maxSizeBytes Optional maximum allowed byte size (defaults to 2 MiB)
 * @returns ValidationResult containing data on success or error list on failure
 */
export function safeParseReport(
  text: string,
  maxSizeBytes: number = MAX_IMPORT_FILE_SIZE_BYTES
): ValidationResult<FitReportV1> {
  if (typeof text !== 'string') {
    return { success: false, errors: ['Input must be a JSON string'] };
  }

  const byteLength = new TextEncoder().encode(text).length;
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
    parsed = JSON.parse(text);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, errors: [`JSON parse error: ${msg}`] };
  }

  return validateFitReportV1(parsed);
}

/**
 * Parses a Report JSON string with strict v1 schema validation.
 *
 * Throws ReportFileError if parsing or validation fails.
 *
 * @param text UTF-8 JSON text representation of FitReportV1
 * @returns Validated FitReportV1 object
 */
export function parseReport(text: string): FitReportV1 {
  const result = safeParseReport(text);
  if (!result.success) {
    const errorMsg = `Failed to parse FitReportV1: ${result.errors.join('; ')}`;
    throw new ReportFileError(errorMsg, result.errors);
  }
  return result.data;
}

/**
 * Helper to construct a valid FitReportV1 object from components.
 *
 * @param caseData CaseV1 used for the fit
 * @param fit FitResult produced by the optimizer
 * @param informationAtDualEstimate Optional local identifiability information spectrum
 * @returns Validated FitReportV1
 */
export function createFitReport(
  caseData: CaseV1,
  fit: FitResult,
  informationAtDualEstimate?: InformationSpectrum
): FitReportV1 {
  const report: FitReportV1 = {
    schema: REPORT_SCHEMA,
    specVersion: SPEC_VERSION,
    caseData,
    fit,
  };

  if (informationAtDualEstimate !== undefined) {
    report.informationAtDualEstimate = informationAtDualEstimate;
  }

  const validation = validateFitReportV1(report);
  if (!validation.success) {
    throw new ReportFileError(
      `createFitReport: invalid report data: ${validation.errors.join('; ')}`,
      validation.errors
    );
  }

  return validation.data;
}
