import type { Vec3 } from './types';
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
export function wrapAngle(a: number) { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; }
export function angleDiff(a: number, b: number) { return wrapAngle(b - a); }
export function damp(cur: number, target: number, lambda: number, dt: number) { return lerp(cur, target, 1 - Math.exp(-lambda * dt)); }
export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: Vec3): Vec3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist2 = (a: Vec3, b: Vec3) => { const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return dx * dx + dy * dy + dz * dz; };
export const dist = (a: Vec3, b: Vec3) => Math.sqrt(dist2(a, b));
export function dirFromYawPitch(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash2(x: number, z: number, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x: number, z: number, seed = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed), c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x: number, z: number, oct = 4, seed = 0) {
  let amp = 0.5, f = 1, sum = 0;
  for (let i = 0; i < oct; i++) { sum += amp * valueNoise(x * f, z * f, seed + i * 7); f *= 2; amp *= 0.5; }
  return sum;
}
export function rayBoxHit(origin: Vec3, dir: Vec3, center: Vec3, size: Vec3): number | null {
  let tmin = -Infinity, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-8) { if (origin[i] < center[i] - size[i] / 2 || origin[i] > center[i] + size[i] / 2) return null; continue; }
    const inv = 1 / dir[i];
    let t1 = (center[i] - size[i] / 2 - origin[i]) * inv, t2 = (center[i] + size[i] / 2 - origin[i]) * inv;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin >= 0 ? tmin : tmax >= 0 ? 0 : null;
}
export function pointInBox(p: Vec3, center: Vec3, size: Vec3) {
  return Math.abs(p[0] - center[0]) <= size[0] / 2 && Math.abs(p[1] - center[1]) <= size[1] / 2 && Math.abs(p[2] - center[2]) <= size[2] / 2;
}
export function clampVec(v: Vec3, maxLen: number): Vec3 { const l = len(v); return l > maxLen ? mul(v, maxLen / l) : v; }
