// Pure image measurements for compare-shots.mjs. Images are { width, height, data } with data = RGBA bytes.
// L* is CIE L* (D65). Luminance Y is Rec. 709 relative luminance of the linearised sRGB value.

const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function f(t) {
  return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
}

export function pixelLab(r, g, b) {
  const lr = LIN[r], lg = LIN[g], lb = LIN[b];
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
  const z = (0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz), Y: y };
}

// Per-pixel L*, a*, b*, Y arrays for a whole image.
export function labPlanes(img) {
  const n = img.width * img.height;
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n), Y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = pixelLab(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
    L[i] = p.L; A[i] = p.a; B[i] = p.b; Y[i] = p.Y;
  }
  return { L, A, B, Y, width: img.width, height: img.height };
}

export function meanAbsDiff(a, b) {
  let sum = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    sum += Math.abs(a.data[i * 4] - b.data[i * 4]) + Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]) + Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]);
  }
  return sum / (n * 3);
}

export function mean(array) {
  let sum = 0;
  for (let i = 0; i < array.length; i++) sum += array[i];
  return sum / array.length;
}

// Mean L* of each cell of a cols x rows grid.
export function blockMeans(planes, cols = 16, rows = 9) {
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * planes.width / cols), x1 = Math.floor((c + 1) * planes.width / cols);
      const y0 = Math.floor(r * planes.height / rows), y1 = Math.floor((r + 1) * planes.height / rows);
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += planes.L[y * planes.width + x]; n++; }
      out.push(n ? sum / n : 0);
    }
  }
  return out;
}

export function percentile(values, p) {
  const sorted = [...values].sort((x, y) => x - y);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index];
}

// Share of pixels in each of 12 hue bins (30 degrees), counting only pixels with chroma >= minChroma.
export function hueShares(planes, minChroma = 10) {
  const bins = new Float64Array(12);
  const n = planes.width * planes.height;
  for (let i = 0; i < n; i++) {
    const a = planes.A[i], b = planes.B[i];
    if (Math.hypot(a, b) < minChroma) continue;
    let h = Math.atan2(b, a) * 180 / Math.PI;
    if (h < 0) h += 360;
    bins[Math.min(11, Math.floor(h / 30))]++;
  }
  return Array.from(bins, v => v / n);
}

// Mean of a (2*half+1)^2 patch around (cx, cy) in a plane.
export function patchMean(planes, plane, cx, cy, half = 3) {
  let sum = 0, n = 0;
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) { sum += plane[y * planes.width + x]; n++; }
  return sum / n;
}

export function darkPixelCount(planes, limit = 20) {
  let n = 0;
  for (let i = 0; i < planes.L.length; i++) if (planes.L[i] < limit) n++;
  return n;
}

// Largest per-channel absolute difference between the two TOP corner patches (7 x 7) of two images, 0..255.
// Use it for views where the top of the frame is flat background.
export function cornerBackgroundDiff(a, b, half = 3) {
  let worst = 0;
  const corners = [[half, half], [a.width - 1 - half, half]];
  for (const [cx, cy] of corners) {
    for (let channel = 0; channel < 3; channel++) {
      let sa = 0, sb = 0, n = 0;
      for (let y = cy - half; y <= cy + half; y++) {
        for (let x = cx - half; x <= cx + half; x++) {
          sa += a.data[(y * a.width + x) * 4 + channel];
          sb += b.data[(y * b.width + x) * 4 + channel];
          n++;
        }
      }
      worst = Math.max(worst, Math.abs(sa / n - sb / n));
    }
  }
  return worst;
}

export function orientationDiffDegrees(q1, q2) {
  const dot = Math.abs(q1[0] * q2[0] + q1[1] * q2[1] + q1[2] * q2[2] + q1[3] * q2[3]);
  const n1 = Math.hypot(...q1), n2 = Math.hypot(...q2);
  return 2 * Math.acos(Math.min(1, dot / (n1 * n2))) * 180 / Math.PI;
}
