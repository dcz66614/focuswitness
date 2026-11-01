import { describe, it, expect } from 'vitest';
import { fft2, ifft2, fftshift, ifftshift, type FFTSize } from '../../src/math/fft';

/**
 * Independent naive O(N^4) 2D Discrete Fourier Transform oracle
 * used to verify Cooley-Tukey mathematical correctness without
 * sharing any implementation logic.
 */
function naiveDft2(
  re: Float64Array,
  im: Float64Array,
  n: number,
  inverse: boolean = false
): { re: Float64Array; im: Float64Array } {
  const outRe = new Float64Array(n * n);
  const outIm = new Float64Array(n * n);
  const sign = inverse ? 1 : -1;
  const factor = inverse ? 1.0 / (n * n) : 1.0;

  for (let v = 0; v < n; v++) {
    for (let u = 0; u < n; u++) {
      let sumRe = 0;
      let sumIm = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const inIdx = y * n + x;
          const angle = (sign * 2 * Math.PI * (u * x + v * y)) / n;
          const cosA = Math.cos(angle);
          const sinA = Math.sin(angle);
          const r = re[inIdx]!;
          const i = im[inIdx]!;
          sumRe += r * cosA - i * sinA;
          sumIm += r * sinA + i * cosA;
        }
      }
      const outIdx = v * n + u;
      outRe[outIdx] = sumRe * factor;
      outIm[outIdx] = sumIm * factor;
    }
  }

  return { re: outRe, im: outIm };
}

/**
 * Generates a deterministic, complex, asymmetric 2D array.
 */
function createAsymmetricComplexArray(n: number): { re: Float64Array; im: Float64Array } {
  const size = n * n;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const idx = y * n + x;
      // Deterministic asymmetric functions in x and y
      re[idx] = Math.sin(0.4 * x + 0.9 * y) * Math.exp(-0.02 * (x * x + 0.5 * y * y)) + 0.15 * x;
      im[idx] = Math.cos(0.7 * x - 0.3 * y) * (1.0 + 0.05 * y) - 0.2 * y;
    }
  }
  return { re, im };
}

/**
 * Compute the maximum absolute complex difference between two arrays:
 * max_k |z1[k] - z2[k]| = max_k sqrt((re1 - re2)^2 + (im1 - im2)^2)
 */
function maxComplexDiff(
  re1: Float64Array,
  im1: Float64Array,
  re2: Float64Array,
  im2: Float64Array
): number {
  let maxDiff = 0;
  for (let i = 0; i < re1.length; i++) {
    const dr = re1[i]! - re2[i]!;
    const di = im1[i]! - im2[i]!;
    const diff = Math.hypot(dr, di);
    if (diff > maxDiff) {
      maxDiff = diff;
    }
  }
  return maxDiff;
}

describe('Complex 2D FFT (TASK-P007-T003)', () => {
  describe('Contract and Parameter Validation', () => {
    it('accepts valid 8, 16, and 64 grid sizes', () => {
      for (const n of [8, 16, 64] as FFTSize[]) {
        const re = new Float64Array(n * n);
        const im = new Float64Array(n * n);
        const result = fft2(re, im, n);
        expect(result.re).toBeInstanceOf(Float64Array);
        expect(result.im).toBeInstanceOf(Float64Array);
        expect(result.re.length).toBe(n * n);
        expect(result.im.length).toBe(n * n);
      }
    });

    it('rejects unsupported grid dimensions', () => {
      const dummy = new Float64Array(16);
      // @ts-expect-error testing runtime rejection of unsupported n
      expect(() => fft2(dummy, dummy, 4)).toThrow(RangeError);
      // @ts-expect-error testing runtime rejection of unsupported n
      expect(() => fft2(dummy, dummy, 32)).toThrow(RangeError);
      // @ts-expect-error testing runtime rejection of unsupported n
      expect(() => fft2(dummy, dummy, 128)).toThrow(RangeError);
    });

    it('rejects arrays with mismatched lengths', () => {
      const wrongRe = new Float64Array(63);
      const validIm = new Float64Array(64);
      expect(() => fft2(wrongRe, validIm, 8)).toThrow(RangeError);

      const validRe = new Float64Array(64);
      const wrongIm = new Float64Array(65);
      expect(() => fft2(validRe, wrongIm, 8)).toThrow(RangeError);
    });

    it('rejects non-Float64Array inputs', () => {
      const arr = [0, 1, 2, 3] as unknown as Float64Array;
      const valid = new Float64Array(64);
      expect(() => fft2(arr, valid, 8)).toThrow(TypeError);
      expect(() => fft2(valid, arr, 8)).toThrow(TypeError);
    });

    it('strictly avoids mutating input arrays (immutability guarantee)', () => {
      const n: FFTSize = 8;
      const { re, im } = createAsymmetricComplexArray(n);
      const reCopy = new Float64Array(re);
      const imCopy = new Float64Array(im);

      const forward = fft2(re, im, n, false);

      // Input must be byte-for-byte identical
      expect(Array.from(re)).toEqual(Array.from(reCopy));
      expect(Array.from(im)).toEqual(Array.from(imCopy));

      // Returned arrays must be new instances
      expect(forward.re).not.toBe(re);
      expect(forward.im).not.toBe(im);

      // Inverse transform must also not mutate inputs
      const fwdReCopy = new Float64Array(forward.re);
      const fwdImCopy = new Float64Array(forward.im);
      const inverse = fft2(forward.re, forward.im, n, true);

      expect(Array.from(forward.re)).toEqual(Array.from(fwdReCopy));
      expect(Array.from(forward.im)).toEqual(Array.from(fwdImCopy));
      expect(inverse.re).not.toBe(forward.re);
      expect(inverse.im).not.toBe(forward.im);
    });
  });

  describe('Impulse Responses (Delta Functions)', () => {
    it('transforms delta impulse at origin (0,0) to constant 1.0 across all frequencies', () => {
      for (const n of [8, 16, 64] as FFTSize[]) {
        const re = new Float64Array(n * n);
        const im = new Float64Array(n * n);
        re[0] = 1.0; // delta at (0, 0)

        const forward = fft2(re, im, n);

        // Every frequency bin must equal 1.0 + 0.0i
        for (let i = 0; i < n * n; i++) {
          expect(forward.re[i]).toBeCloseTo(1.0, 12);
          expect(forward.im[i]).toBeCloseTo(0.0, 12);
        }

        // Inverse transform of the forward output must reconstruct the original impulse
        const reconstructed = ifft2(forward.re, forward.im, n);
        expect(reconstructed.re[0]).toBeCloseTo(1.0, 12);
        expect(reconstructed.im[0]).toBeCloseTo(0.0, 12);
        for (let i = 1; i < n * n; i++) {
          expect(reconstructed.re[i]).toBeCloseTo(0.0, 12);
          expect(reconstructed.im[i]).toBeCloseTo(0.0, 12);
        }
      }
    });

    it('transforms arbitrary shifted impulse with unity spectral magnitude and restores exactly', () => {
      for (const n of [8, 16, 64] as FFTSize[]) {
        const re = new Float64Array(n * n);
        const im = new Float64Array(n * n);
        const y0 = Math.floor(n / 3);
        const x0 = Math.floor(n / 2) - 1;
        const targetIdx = y0 * n + x0;
        re[targetIdx] = 1.0;

        const forward = fft2(re, im, n);

        // Magnitude of e^{-i 2pi (u x0 + v y0)/n} is 1.0 everywhere
        for (let i = 0; i < n * n; i++) {
          const mag = Math.hypot(forward.re[i]!, forward.im[i]!);
          expect(mag).toBeCloseTo(1.0, 12);
        }

        // Inverse reconstructs the shifted impulse
        const reconstructed = ifft2(forward.re, forward.im, n);
        for (let i = 0; i < n * n; i++) {
          const expectedRe = i === targetIdx ? 1.0 : 0.0;
          expect(reconstructed.re[i]).toBeCloseTo(expectedRe, 12);
          expect(reconstructed.im[i]).toBeCloseTo(0.0, 12);
        }
      }
    });
  });

  describe('Constant Fields (DC Response)', () => {
    it('transforms real constant field to single DC peak of magnitude C * n² at (0,0)', () => {
      for (const n of [8, 16, 64] as FFTSize[]) {
        const C = 2.75;
        const re = new Float64Array(n * n).fill(C);
        const im = new Float64Array(n * n).fill(0.0);

        const forward = fft2(re, im, n);

        // DC at index 0 must equal C * n^2
        expect(forward.re[0]).toBeCloseTo(C * n * n, 10);
        expect(forward.im[0]).toBeCloseTo(0.0, 10);

        // All AC frequencies must be 0
        for (let i = 1; i < n * n; i++) {
          expect(Math.abs(forward.re[i]!)).toBeLessThan(1e-12);
          expect(Math.abs(forward.im[i]!)).toBeLessThan(1e-12);
        }

        // Inverse restores constant C everywhere
        const reconstructed = ifft2(forward.re, forward.im, n);
        for (let i = 0; i < n * n; i++) {
          expect(reconstructed.re[i]).toBeCloseTo(C, 12);
          expect(reconstructed.im[i]).toBeCloseTo(0.0, 12);
        }
      }
    });

    it('transforms complex constant field (Cr + i*Ci) to DC peak (Cr + i*Ci) * n²', () => {
      const n: FFTSize = 16;
      const Cr = 1.25;
      const Ci = -0.75;
      const re = new Float64Array(n * n).fill(Cr);
      const im = new Float64Array(n * n).fill(Ci);

      const forward = fft2(re, im, n);
      expect(forward.re[0]).toBeCloseTo(Cr * n * n, 10);
      expect(forward.im[0]).toBeCloseTo(Ci * n * n, 10);

      for (let i = 1; i < n * n; i++) {
        expect(Math.abs(forward.re[i]!)).toBeLessThan(1e-12);
        expect(Math.abs(forward.im[i]!)).toBeLessThan(1e-12);
      }

      const reconstructed = ifft2(forward.re, forward.im, n);
      for (let i = 0; i < n * n; i++) {
        expect(reconstructed.re[i]).toBeCloseTo(Cr, 12);
        expect(reconstructed.im[i]).toBeCloseTo(Ci, 12);
      }
    });
  });

  describe('Complex Asymmetric Vectors vs Independent Naive DFT Oracle (MATH01)', () => {
    it('matches naive DFT oracle within 1e-12 for 8x8 asymmetric complex input (MATH01 <= 1e-9)', () => {
      const n: FFTSize = 8;
      const { re, im } = createAsymmetricComplexArray(n);

      const fastFwd = fft2(re, im, n, false);
      const naiveFwd = naiveDft2(re, im, n, false);

      const fwdDiff = maxComplexDiff(fastFwd.re, fastFwd.im, naiveFwd.re, naiveFwd.im);
      expect(fwdDiff).toBeLessThan(1e-12); // MATH01 requires <= 1e-9

      const fastInv = fft2(fastFwd.re, fastFwd.im, n, true);
      const naiveInv = naiveDft2(naiveFwd.re, naiveFwd.im, n, true);

      const invDiff = maxComplexDiff(fastInv.re, fastInv.im, naiveInv.re, naiveInv.im);
      expect(invDiff).toBeLessThan(1e-12);
    });

    it('matches naive DFT oracle within 1e-12 for 16x16 asymmetric complex input', () => {
      const n: FFTSize = 16;
      const { re, im } = createAsymmetricComplexArray(n);

      const fast = fft2(re, im, n, false);
      const naive = naiveDft2(re, im, n, false);

      const diff = maxComplexDiff(fast.re, fast.im, naive.re, naive.im);
      expect(diff).toBeLessThan(1e-12);
    });
  });

  describe('Roundtrip Invertibility across 8, 16, and 64 (MATH02)', () => {
    it('satisfies roundtrip invertibility for 8x8 with error <= 1e-12', () => {
      const n: FFTSize = 8;
      const { re, im } = createAsymmetricComplexArray(n);
      const forward = fft2(re, im, n, false);
      const roundtrip = ifft2(forward.re, forward.im, n);

      const error = maxComplexDiff(roundtrip.re, roundtrip.im, re, im);
      expect(error).toBeLessThan(1e-12);
    });

    it('satisfies roundtrip invertibility for 16x16 with error <= 1e-12', () => {
      const n: FFTSize = 16;
      const { re, im } = createAsymmetricComplexArray(n);
      const forward = fft2(re, im, n, false);
      const roundtrip = ifft2(forward.re, forward.im, n);

      const error = maxComplexDiff(roundtrip.re, roundtrip.im, re, im);
      expect(error).toBeLessThan(1e-12);
    });

    it('satisfies MATH02: 64x64 fixed complex sequence roundtrip error <= 1e-10', () => {
      const n: FFTSize = 64;
      const { re, im } = createAsymmetricComplexArray(n);

      // Forward transform
      const forward = fft2(re, im, n, false);

      // Inverse transform via ifft2
      const roundtrip = ifft2(forward.re, forward.im, n);

      const maxErr = maxComplexDiff(roundtrip.re, roundtrip.im, re, im);

      // MATH02 explicit requirement: <= 1e-10
      expect(maxErr).toBeLessThan(1e-10);
      // Double precision radix-2 achieves even tighter bound <= 1e-14
      expect(maxErr).toBeLessThan(1e-13);
    });

    it('satisfies MATH02 using explicit inverse=true flag: fft2(..., true)', () => {
      const n: FFTSize = 64;
      const { re, im } = createAsymmetricComplexArray(n);

      const forward = fft2(re, im, n, false);
      const roundtrip = fft2(forward.re, forward.im, n, true);

      const maxErr = maxComplexDiff(roundtrip.re, roundtrip.im, re, im);
      expect(maxErr).toBeLessThan(1e-10);
    });
  });

  describe('Parseval Theorem (Energy Conservation)', () => {
    it('preserves energy scaled by n²: sum |F|^2 = n² * sum |f|^2', () => {
      for (const n of [8, 16, 64] as FFTSize[]) {
        const { re, im } = createAsymmetricComplexArray(n);

        let inputEnergy = 0;
        for (let i = 0; i < n * n; i++) {
          inputEnergy += re[i]! * re[i]! + im[i]! * im[i]!;
        }

        const forward = fft2(re, im, n);

        let outputEnergy = 0;
        for (let i = 0; i < n * n; i++) {
          outputEnergy += forward.re[i]! * forward.re[i]! + forward.im[i]! * forward.im[i]!;
        }

        const expectedOutputEnergy = inputEnergy * (n * n);
        const relDiff = Math.abs(outputEnergy - expectedOutputEnergy) / expectedOutputEnergy;
        expect(relDiff).toBeLessThan(1e-12);
      }
    });
  });

  describe('Linearity Property', () => {
    it('satisfies FFT(alpha * X + beta * Y) = alpha * FFT(X) + beta * FFT(Y)', () => {
      const n: FFTSize = 16;
      const a = createAsymmetricComplexArray(n);
      const b = createAsymmetricComplexArray(n);
      // Alter b so it is distinct from a
      for (let i = 0; i < n * n; i++) {
        b.re[i] = b.re[i]! * 1.5 - 0.3;
        b.im[i] = b.im[i]! * -0.8 + 0.2;
      }

      const alpha = 1.7;
      const beta = -0.6;

      // Linear combination of inputs
      const combRe = new Float64Array(n * n);
      const combIm = new Float64Array(n * n);
      for (let i = 0; i < n * n; i++) {
        combRe[i] = alpha * a.re[i]! + beta * b.re[i]!;
        combIm[i] = alpha * a.im[i]! + beta * b.im[i]!;
      }

      const fftComb = fft2(combRe, combIm, n);
      const fftA = fft2(a.re, a.im, n);
      const fftB = fft2(b.re, b.im, n);

      for (let i = 0; i < n * n; i++) {
        const expectedRe = alpha * fftA.re[i]! + beta * fftB.re[i]!;
        const expectedIm = alpha * fftA.im[i]! + beta * fftB.im[i]!;
        expect(fftComb.re[i]).toBeCloseTo(expectedRe, 10);
        expect(fftComb.im[i]).toBeCloseTo(expectedIm, 10);
      }
    });
  });

  describe('fftshift and ifftshift Operations', () => {
    it('shifts zero frequency at (0,0) to grid center (n/2, n/2)', () => {
      for (const n of [8, 16, 64]) {
        const data = new Float64Array(n * n);
        data[0] = 99.0;

        const shifted = fftshift(data, n);

        const centerIdx = (n / 2) * n + (n / 2);
        expect(shifted[centerIdx]).toBe(99.0);
        expect(shifted[0]).toBe(0.0);

        // Does not mutate input
        expect(data[0]).toBe(99.0);
      }
    });

    it('is self-inverse for even n: fftshift(fftshift(x)) == x and ifftshift(fftshift(x)) == x', () => {
      for (const n of [8, 16, 64]) {
        const data = new Float64Array(n * n);
        for (let i = 0; i < n * n; i++) {
          data[i] = Math.sin(i * 0.1) + i;
        }

        const shifted = fftshift(data, n);
        const doubleShifted = fftshift(shifted, n);
        const unshifted = ifftshift(shifted, n);

        for (let i = 0; i < n * n; i++) {
          expect(doubleShifted[i]).toBe(data[i]);
          expect(unshifted[i]).toBe(data[i]);
        }
      }
    });

    it('rejects invalid inputs to fftshift', () => {
      const valid = new Float64Array(64);
      // @ts-expect-error non-Float64Array input
      expect(() => fftshift([1, 2, 3], 8)).toThrow(TypeError);
      expect(() => fftshift(valid, 7)).toThrow(RangeError); // odd dimension
      expect(() => fftshift(valid, -8)).toThrow(RangeError); // negative dimension
      expect(() => fftshift(valid, 16)).toThrow(RangeError); // length mismatch (64 != 256)
    });
  });
});
