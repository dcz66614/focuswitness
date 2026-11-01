/**
 * P007 FocusWitness — Complex 2D Fast Fourier Transform (FFT)
 *
 * Specifications:
 * - PROJECT_BOOK.md Section 5.2: Fourier convention, Fraunhofer forward model
 * - PROJECT_BOOK.md Chapter 7: MATH01 (<= 1e-9 vs naive DFT), MATH02 (<= 1e-10 roundtrip error)
 * - IMPLEMENTATION_PLAN.md Section 3.3 & Task P007-T003:
 *   fft2(re: Float64Array, im: Float64Array, n: 8 | 16 | 64, inverse?: boolean)
 *   Outputs new Float64Array arrays without mutating inputs.
 *   Inverse transform strictly follows 1/n² normalization.
 */

export type FFTSize = 8 | 16 | 64;

export interface ComplexArray {
  re: Float64Array;
  im: Float64Array;
}

interface TwiddleTables {
  rev: Uint16Array;
  cos: Float64Array;
  sin: Float64Array;
}

/**
 * Precompute bit-reversal indices and trigonometric twiddle factors
 * for the fixed power-of-two grid sizes (8, 16, 64).
 */
function buildTables(n: FFTSize): TwiddleTables {
  const rev = new Uint16Array(n);
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    let x = i;
    let y = 0;
    for (let b = 0; b < bits; b++) {
      y = (y << 1) | (x & 1);
      x >>= 1;
    }
    rev[i] = y;
  }

  const cos = new Float64Array(n);
  const sin = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }

  return { rev, cos, sin };
}

const PRECOMPUTED_TABLES: Record<FFTSize, TwiddleTables> = {
  8: buildTables(8),
  16: buildTables(16),
  64: buildTables(64),
};

/**
 * 1D in-place Cooley-Tukey radix-2 Decimation-In-Time (DIT) FFT.
 *
 * Forward transform twiddle: W = exp(-i * 2*pi*k/s) = cos(2*pi*k/s) - i * sin(2*pi*k/s)
 * Inverse transform twiddle: W = exp(+i * 2*pi*k/s) = cos(2*pi*k/s) + i * sin(2*pi*k/s)
 */
function fft1dInPlace(
  re: Float64Array,
  im: Float64Array,
  n: FFTSize,
  inverse: boolean,
  tables: TwiddleTables
): void {
  const { rev, cos, sin } = tables;

  // 1. Bit-reversal permutation
  for (let i = 0; i < n; i++) {
    const j = rev[i]!;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;

      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }

  // 2. Butterfly stages
  for (let s = 2; s <= n; s <<= 1) {
    const half = s >> 1;
    const step = n / s;
    for (let k = 0; k < n; k += s) {
      for (let j = 0; j < half; j++) {
        const m = j * step;
        const cosA = cos[m]!;
        const sinA = inverse ? sin[m]! : -sin[m]!;

        const idxA = k + j;
        const idxB = k + j + half;

        const uRe = re[idxA]!;
        const uIm = im[idxA]!;
        const bRe = re[idxB]!;
        const bIm = im[idxB]!;

        // Complex multiplication: (bRe + i*bIm) * (cosA + i*sinA)
        const vRe = bRe * cosA - bIm * sinA;
        const vIm = bRe * sinA + bIm * cosA;

        re[idxA] = uRe + vRe;
        im[idxA] = uIm + vIm;
        re[idxB] = uRe - vRe;
        im[idxB] = uIm - vIm;
      }
    }
  }
}

/**
 * Complex 2D Fast Fourier Transform (radix-2, row then column).
 *
 * Mathematical definitions:
 * - Forward (inverse = false):
 *   F(u, v) = sum_{y=0}^{n-1} sum_{x=0}^{n-1} f(x, y) * exp(-i * 2*pi * (u*x + v*y) / n)
 * - Inverse (inverse = true):
 *   f(x, y) = (1/n²) * sum_{v=0}^{n-1} sum_{u=0}^{n-1} F(u, v) * exp(+i * 2*pi * (u*x + v*y) / n)
 *
 * @param re Real components (length n*n, row-major order: index = y*n + x)
 * @param im Imaginary components (length n*n, row-major order: index = y*n + x)
 * @param n Grid dimension (8 | 16 | 64)
 * @param inverse Whether to perform inverse transform (default false). Normalizes by 1/n² when true.
 * @returns Fresh ComplexArray with re and im Float64Array (inputs are not mutated)
 */
export function fft2(
  re: Float64Array,
  im: Float64Array,
  n: 8 | 16 | 64,
  inverse: boolean = false
): ComplexArray {
  if (!(re instanceof Float64Array) || !(im instanceof Float64Array)) {
    throw new TypeError('fft2: re and im must be Float64Array instances');
  }

  if (n !== 8 && n !== 16 && n !== 64) {
    throw new RangeError(`fft2: unsupported FFT size ${n}. Expected 8, 16, or 64`);
  }

  const expectedLength = n * n;
  if (re.length !== expectedLength || im.length !== expectedLength) {
    throw new RangeError(
      `fft2: array length mismatch for n=${n}. Expected ${expectedLength}, got re=${re.length}, im=${im.length}`
    );
  }

  const tables = PRECOMPUTED_TABLES[n];
  const outRe = new Float64Array(re);
  const outIm = new Float64Array(im);

  const scratchRe = new Float64Array(n);
  const scratchIm = new Float64Array(n);

  // 1. Transform rows (for each y: 0 <= y < n)
  for (let y = 0; y < n; y++) {
    const rowOffset = y * n;
    for (let x = 0; x < n; x++) {
      scratchRe[x] = outRe[rowOffset + x]!;
      scratchIm[x] = outIm[rowOffset + x]!;
    }
    fft1dInPlace(scratchRe, scratchIm, n, inverse, tables);
    for (let x = 0; x < n; x++) {
      outRe[rowOffset + x] = scratchRe[x]!;
      outIm[rowOffset + x] = scratchIm[x]!;
    }
  }

  // 2. Transform columns (for each x: 0 <= x < n)
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      scratchRe[y] = outRe[y * n + x]!;
      scratchIm[y] = outIm[y * n + x]!;
    }
    fft1dInPlace(scratchRe, scratchIm, n, inverse, tables);
    for (let y = 0; y < n; y++) {
      outRe[y * n + x] = scratchRe[y]!;
      outIm[y * n + x] = scratchIm[y]!;
    }
  }

  // 3. Inverse transform 1/n² normalization
  if (inverse) {
    const normFactor = 1.0 / (n * n);
    for (let i = 0; i < expectedLength; i++) {
      outRe[i] = outRe[i]! * normFactor;
      outIm[i] = outIm[i]! * normFactor;
    }
  }

  return { re: outRe, im: outIm };
}

/**
 * Convenience wrapper for inverse 2D FFT.
 */
export function ifft2(
  re: Float64Array,
  im: Float64Array,
  n: 8 | 16 | 64
): ComplexArray {
  return fft2(re, im, n, true);
}

/**
 * 2D circular shift moving zero-frequency components to the grid center.
 * For an even grid dimension n, each axis is circularly shifted by n / 2.
 *
 * @param data 2D array of length n * n in row-major order
 * @param n Grid dimension (even positive integer)
 * @returns Shifted Float64Array (does not mutate input)
 */
export function fftshift(data: Float64Array, n: number): Float64Array {
  if (!(data instanceof Float64Array)) {
    throw new TypeError('fftshift: data must be a Float64Array instance');
  }
  if (!Number.isInteger(n) || n <= 0 || n % 2 !== 0) {
    throw new RangeError(`fftshift: n must be a positive even integer, got ${n}`);
  }
  if (data.length !== n * n) {
    throw new RangeError(
      `fftshift: data length mismatch for n=${n}. Expected ${n * n}, got ${data.length}`
    );
  }

  const half = n >> 1;
  const out = new Float64Array(n * n);

  for (let y = 0; y < n; y++) {
    const yShift = (y + half) % n;
    const srcRow = y * n;
    const dstRow = yShift * n;
    for (let x = 0; x < n; x++) {
      const xShift = (x + half) % n;
      out[dstRow + xShift] = data[srcRow + x]!;
    }
  }

  return out;
}

/**
 * Inverse 2D circular shift restoring zero-frequency to (0, 0).
 * For even grid dimension n, circularly shifting by n/2 is self-inverse.
 *
 * @param data 2D array of length n * n in row-major order
 * @param n Grid dimension (even positive integer)
 * @returns Unshifted Float64Array (does not mutate input)
 */
export function ifftshift(data: Float64Array, n: number): Float64Array {
  return fftshift(data, n);
}
