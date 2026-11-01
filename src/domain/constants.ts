/**
 * P007 FocusWitness — Domain Constants
 * Specifications: PROJECT_BOOK.md Section 5.1, 5.3, 5.4, 5.5, 6.1, 6.3, 6.5, 7.1
 */

import type { Coefficients, FocusPlane, Mode, PresetId } from './types';

/**
 * Discrete grid parameters.
 * N = 64, N^2 = 4096 pixels per plane.
 */
export const GRID_SIZE = 64;
export const PIXEL_COUNT = GRID_SIZE * GRID_SIZE; // 4096

/**
 * Optical pupil geometry.
 * Center is (32, 32); radius is 16 px.
 */
export const PUPIL_RADIUS_PX = 16;
export const PUPIL_CENTER_X = 32;
export const PUPIL_CENTER_Y = 32;

/**
 * Defocus diversity planes in units of waves.
 * Fixed to -0.65 and +0.65 waves.
 */
export const DIVERSITY_DEFOCUS_MINUS: FocusPlane = -0.65;
export const DIVERSITY_DEFOCUS_PLUS: FocusPlane = 0.65;
export const DIVERSITY_WAVES: readonly [FocusPlane, FocusPlane] = [
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
] as const;

/**
 * Planes used for fitting in each mode.
 */
export const FITTED_PLANES_SINGLE: readonly [FocusPlane] = [DIVERSITY_DEFOCUS_MINUS] as const;
export const FITTED_PLANES_DUAL: readonly [FocusPlane, FocusPlane] = [
  DIVERSITY_DEFOCUS_MINUS,
  DIVERSITY_DEFOCUS_PLUS,
] as const;

/**
 * Coefficient bounds and dimension names.
 * Box constraint: [-0.15, 0.15] waves for each of the three parameters.
 */
export const COEFFICIENT_MIN = -0.15;
export const COEFFICIENT_MAX = 0.15;
export const COEFFICIENT_NAMES = ['astig0', 'comaX', 'spherical'] as const;
export type CoefficientName = (typeof COEFFICIENT_NAMES)[number];

/**
 * Initial optimization parameters.
 * Always starts from [0, 0, 0].
 */
export const INITIAL_COEFFICIENTS: Readonly<Coefficients> = Object.freeze({
  astig0: 0,
  comaX: 0,
  spherical: 0,
});

/**
 * Levenberg-Marquardt solver constants.
 */
export const MAX_ITERATIONS = 60;
export const FINITE_DIFFERENCE_STEP = 1e-4; // h = 1e-4 waves
export const INITIAL_LAMBDA = 1e-2;
export const LAMBDA_MIN = 1e-7;
export const LAMBDA_MAX = 1e7;
export const LAMBDA_DECREASE_FACTOR = 0.3;
export const LAMBDA_INCREASE_FACTOR = 10;
export const MAX_STEP_DELTA = 0.04; // delta_j bounded to [-0.04, 0.04] waves
export const LOSS_IMPROVEMENT_EPSILON = 1e-18;

/**
 * Linear system regularization constants.
 */
export const DIAGONAL_MIN_REGULARIZATION = 1e-12;
export const MARQUARDT_IDENTITY_EPSILON = 1e-12;

/**
 * Convergence criteria.
 */
export const CONVERGENCE_LOSS_THRESHOLD = 1e-14;
export const CONVERGENCE_STEP_THRESHOLD = 1e-7;
export const CONVERGENCE_RELATIVE_LOSS_THRESHOLD = 1e-10;
export const CONVERGENCE_CONSECUTIVE_STEPS = 3;

/**
 * Identifiability & condition number bounds.
 */
export const CONDITION_NUMBER_MIN_EIGEN = 1e-14;

/**
 * Display constants.
 */
export const LOG_DISPLAY_EPSILON = 1e-8; // log10(max(I, 0) + 1e-8)

/**
 * Schema and version constants.
 */
export const CASE_SCHEMA = 'focuswitness.case/v1' as const;
export const REPORT_SCHEMA = 'focuswitness.report/v1' as const;
export const SPEC_VERSION = '1.0.0' as const;

/**
 * Validation and security limits.
 */
export const MAX_IMPORT_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MiB
export const OBSERVATION_SUM_TOLERANCE = 1e-6;
export const OBSERVATION_SUM_MIN = 1 - OBSERVATION_SUM_TOLERANCE;
export const OBSERVATION_SUM_MAX = 1 + OBSERVATION_SUM_TOLERANCE;

/**
 * Application defaults.
 */
export const DEFAULT_PRESET_ID: PresetId = 'mixed';
export const DEFAULT_MODE: Mode = 'dual';
