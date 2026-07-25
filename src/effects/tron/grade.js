// The webcam's look "inside the Grid": darker, cooler, mostly desaturated.
// It is applied by the host as a CSS filter; the digitizing laser also needs
// to know exactly what the filtered camera looks like (to put back light the
// filter takes away), so the same grade is available as colour matrices for
// a shader, following the Filter Effects spec, in sRGB like browsers do.
import * as THREE from 'three';

export const GRADE = {
  grayscale: 0.5,
  sepia: 0.35,
  hueRotate: 165,     // degrees
  saturate: 1.5,
  brightness: 0.4,
  contrast: 1.2,
  transition: 0.6,    // s, index.html animates filter changes this long ('ease')
};

const number = (value) => String(+value.toFixed(3));

export function cssFilter(brightness = GRADE.brightness) {
  return `grayscale(${number(GRADE.grayscale)}) sepia(${number(GRADE.sepia)}) `
    + `hue-rotate(${number(GRADE.hueRotate)}deg) saturate(${number(GRADE.saturate)}) `
    + `brightness(${number(brightness)}) contrast(${number(GRADE.contrast)})`;
}

// The four colour matrices before brightness and contrast, in filter order.
export function gradeMatrices() {
  const s = 1 - GRADE.grayscale;
  const grayscale = new THREE.Matrix3().set(
    0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s,
    0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s,
    0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s);
  const t = 1 - GRADE.sepia;
  const sepia = new THREE.Matrix3().set(
    0.393 + 0.607 * t, 0.769 - 0.769 * t, 0.189 - 0.189 * t,
    0.349 - 0.349 * t, 0.686 + 0.314 * t, 0.168 - 0.168 * t,
    0.272 - 0.272 * t, 0.534 - 0.534 * t, 0.131 + 0.869 * t);
  const angle = THREE.MathUtils.degToRad(GRADE.hueRotate);
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  const hue = new THREE.Matrix3().set(
    0.213 + 0.787 * c - 0.213 * n, 0.715 - 0.715 * c - 0.715 * n, 0.072 - 0.072 * c + 0.928 * n,
    0.213 - 0.213 * c + 0.143 * n, 0.715 + 0.285 * c + 0.140 * n, 0.072 - 0.072 * c - 0.283 * n,
    0.213 - 0.213 * c - 0.787 * n, 0.715 - 0.715 * c + 0.715 * n, 0.072 + 0.928 * c + 0.072 * n);
  const u = GRADE.saturate;
  const saturate = new THREE.Matrix3().set(
    0.213 + 0.787 * u, 0.715 - 0.715 * u, 0.072 - 0.072 * u,
    0.213 - 0.213 * u, 0.715 + 0.285 * u, 0.072 - 0.072 * u,
    0.213 - 0.213 * u, 0.715 - 0.715 * u, 0.072 + 0.928 * u);
  return [grayscale, sepia, hue, saturate];
}

// GLSL: grade(rgb, brightness) for raw sRGB camera values; uGrade[4] and
// uContrast come from gradeMatrices() and GRADE.contrast.
export const gradeChunk = /* glsl */`
  uniform mat3 uGrade[4];
  uniform float uContrast;
  vec3 grade(vec3 color, float brightness) {
    for (int i = 0; i < 4; i++) color = clamp(uGrade[i] * color, 0.0, 1.0);
    color = clamp(color * brightness, 0.0, 1.0);
    return clamp((color - 0.5) * uContrast + 0.5, 0.0, 1.0);
  }
`;

// The CSS 'ease' timing function, cubic-bezier(0.25, 0.1, 0.25, 1).
export function cssEase(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const curve = (u, a, b) => 3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  const slope = (u, a, b) => 3 * a * (1 - u) ** 2 + 6 * (b - a) * u * (1 - u) + 3 * (1 - b) * u * u;
  let u = t;
  for (let step = 0; step < 8; step++) {
    const error = curve(u, 0.25, 0.25) - t;
    const derivative = slope(u, 0.25, 0.25);
    if (Math.abs(error) < 1e-5 || Math.abs(derivative) < 1e-6) break;
    u = Math.min(1, Math.max(0, u - error / derivative));
  }
  return curve(u, 0.1, 1);
}
