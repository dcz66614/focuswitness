/**
 * P007 FocusWitness — Domain Type Definitions
 * Specifications: PROJECT_BOOK.md Section 5.1, 6.1, 6.4, 7.1
 */

/**
 * Fitting mode:
 * - 'single': uses only the negative diversity plane (-0.65 waves)
 * - 'dual': uses both negative and positive diversity planes (-0.65 and +0.65 waves)
 */
export type Mode = 'single' | 'dual';

/**
 * Zernike aberration coefficients in units of waves.
 * - astig0: 0° astigmatism (Z22)
 * - comaX: x-coma (Z31)
 * - spherical: primary spherical aberration (Z40)
 * All values are physically bounded to [-0.15, 0.15] waves.
 */
export interface Coefficients {
  astig0: number;
  comaX: number;
  spherical: number;
}

/**
 * Focus plane defocus diversity values in units of waves.
 * Fixed to -0.65 or +0.65 waves.
 */
export type FocusPlane = -0.65 | 0.65;

/**
 * Fixed optical discrete configuration.
 */
export interface OpticsConfig {
  gridSize: 64;
  pupilRadiusPx: 16;
  diversityWaves: [FocusPlane, FocusPlane];
}

/**
 * Normalized observation intensity arrays for both defocus planes.
 * Each array contains exactly 4096 elements (64x64 grid).
 * Sum of elements in each plane must equal 1.0 within 1e-6 tolerance.
 */
export interface Observations {
  minus: number[];
  plus: number[];
}

/**
 * Case file schema v1 (focuswitness.case/v1)
 */
export interface CaseV1 {
  schema: 'focuswitness.case/v1';
  specVersion: '1.0.0';
  optics: {
    gridSize: 64;
    pupilRadiusPx: 16;
    diversityWaves: [FocusPlane, FocusPlane];
  };
  observations: {
    minus: number[];
    plus: number[];
  };
  groundTruth?: Coefficients | undefined;
  label?: string | undefined;
}

/**
 * Optimization iteration trajectory record.
 */
export interface IterationRecord {
  iter: number;
  loss: number;
  lambda: number;
  accepted: boolean;
  coefficients: Coefficients;
}

/**
 * Optimization termination status.
 */
export type FitStatus = 'converged' | 'max_iterations' | 'stalled' | 'cancelled';

/**
 * Result of Levenberg-Marquardt optimization.
 */
export interface FitResult {
  status: FitStatus;
  mode: Mode;
  estimate: Coefficients;
  initialLoss: number;
  finalLoss: number;
  history: IterationRecord[];
  fittedPlanes: FocusPlane[];
}

/**
 * Local identifiability information spectrum evaluated at a common reference coefficient vector.
 */
export interface InformationSpectrum {
  reference: Coefficients;
  eigenSingle: [number, number, number];
  eigenDual: [number, number, number];
}

/**
 * Fit report schema v1 (focuswitness.report/v1)
 */
export interface FitReportV1 {
  schema: 'focuswitness.report/v1';
  specVersion: '1.0.0';
  caseData: CaseV1;
  fit: FitResult;
  informationAtDualEstimate?: InformationSpectrum | undefined;
}

/**
 * Worker computation request protocol.
 */
export type WorkerRequest =
  | { type: 'GENERATE'; runId: number; coefficients: Coefficients }
  | { type: 'FIT'; runId: number; mode: Mode; observations: CaseV1['observations'] }
  | { type: 'ANALYZE'; runId: number; observations: CaseV1['observations']; reference: Coefficients }
  | { type: 'CANCEL'; runId: number };

/**
 * Worker computation response protocol.
 */
export type WorkerResponse =
  | { type: 'PROGRESS'; runId: number; iteration: IterationRecord }
  | { type: 'GENERATED'; runId: number; caseData: CaseV1 }
  | { type: 'FIT_RESULT'; runId: number; result: FitResult }
  | { type: 'ANALYSIS_RESULT'; runId: number; eigenSingle: number[]; eigenDual: number[] }
  | { type: 'CANCELLED'; runId: number }
  | { type: 'ERROR'; runId: number; code: string; message: string };

/**
 * Preset ID union.
 */
export type PresetId = 'perfect' | 'mixed' | 'astig-only' | 'coma-only' | 'spherical-only';

/**
 * Preset configuration item.
 */
export interface PresetCase {
  id: PresetId;
  label: string;
  coefficients: Coefficients;
  purpose: string;
}
