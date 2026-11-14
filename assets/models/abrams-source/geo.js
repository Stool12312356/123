// ============================================================================
//  Math + procedural geometry toolkit (no external libraries)
// ============================================================================
const DEG = Math.PI / 180;
const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  sc: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  mad: (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s],
};
const m4 = {
  ident: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  mulN(...ms) { let m = ms[0]; for (let i = 1; i < ms.length; i++) m = m4.mul(m, ms[i]); return m; },
  T: (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1],
  S: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
  RX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]; },
  RY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; },
  RZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
  persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; },
  ortho(l, r, b, t, n, f) { return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]; },
  lookAt(e, t, up) {
    const f = v3.norm(v3.sub(t, e)), s = v3.norm(v3.cross(f, up)), u = v3.cross(s, f);
    return [s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -v3.dot(s, e), -v3.dot(u, e), v3.dot(f, e), 1];
  },
  inv(m) {
    const o = new Array(16);
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7],
      a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11,
      b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30,
      b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06; det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  tp(m, p) { return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]; },
};

// ---- convex polyhedron from half-spaces -------------------------------------
function _clip(poly, n, d) {
  const out = [], L = poly.length;
  for (let i = 0; i < L; i++) {
    const a = poly[i], b = poly[(i + 1) % L];
    const da = v3.dot(n, a) - d, db = v3.dot(n, b) - d;
    if (da <= 1e-9) out.push(a);
    if ((da > 1e-9 && db < -1e-9) || (da < -1e-9 && db > 1e-9)) out.push(v3.lerp(a, b, da / (da - db)));
  }
  return out;
}
function _faces(pls) {
  const faces = [];
  for (let i = 0; i < pls.length; i++) {
    const n = pls[i].n, o = v3.sc(n, pls[i].d);
    let u = Math.abs(n[1]) < 0.9 ? v3.cross([0, 1, 0], n) : v3.cross([1, 0, 0], n); u = v3.norm(u);
    const v = v3.cross(n, u), S = 60;
    let poly = [v3.mad(v3.mad(o, u, -S), v, -S), v3.mad(v3.mad(o, u, S), v, -S), v3.mad(v3.mad(o, u, S), v, S), v3.mad(v3.mad(o, u, -S), v, S)];
    for (let j = 0; j < pls.length && poly.length >= 3; j++) if (j !== i) poly = _clip(poly, pls[j].n, pls[j].d);
    if (poly.length < 3) continue;
    const cl = [];
    for (const p of poly) { const q = cl[cl.length - 1]; if (!q || v3.len(v3.sub(p, q)) > 1e-6) cl.push(p); }
    if (cl.length > 1 && v3.len(v3.sub(cl[0], cl[cl.length - 1])) < 1e-6) cl.pop();
    if (cl.length >= 3) faces.push({ i, poly: cl });
  }
  return faces;
}

// ---- growable mesh ---------------------------------------------------------
class Geo {
  constructor() {
    this.cap = 4096; this.nv = 0;
    this.P = new Float32Array(this.cap * 3); this.N = new Float32Array(this.cap * 3);
    this.C = new Uint8Array(this.cap * 4); this.M = new Uint8Array(this.cap * 4);
    this.st = [m4.ident()]; this.cur = this.st[0]; this._upd();
    this.c = [200, 200, 200]; this.r = 200; this.me = 0; this.k = 0;
  }
  _grow() {
    this.cap *= 2;
    const P = new Float32Array(this.cap * 3); P.set(this.P); this.P = P;
    const N = new Float32Array(this.cap * 3); N.set(this.N); this.N = N;
    const C = new Uint8Array(this.cap * 4); C.set(this.C); this.C = C;
    const M = new Uint8Array(this.cap * 4); M.set(this.M); this.M = M;
  }
  _upd() {
    const m = this.cur, c0 = [m[0], m[1], m[2]], c1 = [m[4], m[5], m[6]], c2 = [m[8], m[9], m[10]];
    const k0 = v3.cross(c1, c2), k1 = v3.cross(c2, c0), k2 = v3.cross(c0, c1);
    const det = v3.dot(c0, k0); this.flip = det < 0; const s = det < 0 ? -1 : 1;
    this.nm = [v3.sc(k0, s), v3.sc(k1, s), v3.sc(k2, s)];
  }
  mat(m) { this.c = m.c; this.r = Math.round(m.r * 255); this.me = Math.round(m.m * 255); this.k = m.k; return this; }
  push(...ms) { let m = this.cur; for (const x of ms) m = m4.mul(m, x); this.st.push(m); this.cur = m; this._upd(); return this; }
  pop() { this.st.pop(); this.cur = this.st[this.st.length - 1]; this._upd(); return this; }
  _emit(p, n) {
    if (this.nv >= this.cap) this._grow();
    const m = this.cur, i = this.nv * 3, j = this.nv * 4, q = this.nm;
    this.P[i] = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    this.P[i + 1] = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    this.P[i + 2] = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
    let nx = q[0][0] * n[0] + q[1][0] * n[1] + q[2][0] * n[2], ny = q[0][1] * n[0] + q[1][1] * n[1] + q[2][1] * n[2], nz = q[0][2] * n[0] + q[1][2] * n[1] + q[2][2] * n[2];
    const l = Math.hypot(nx, ny, nz) || 1;
    this.N[i] = nx / l; this.N[i + 1] = ny / l; this.N[i + 2] = nz / l;
    this.C[j] = this.c[0]; this.C[j + 1] = this.c[1]; this.C[j + 2] = this.c[2]; this.C[j + 3] = this.r;
    this.M[j] = this.me; this.M[j + 1] = this.k; this.nv++;
  }
  triN(a, b, c, na, nb, nc) {
    const g = v3.cross(v3.sub(b, a), v3.sub(c, a));
    if (v3.dot(g, g) < 1e-18) return;
    let sw = v3.dot(g, [na[0] + nb[0] + nc[0], na[1] + nb[1] + nc[1], na[2] + nb[2] + nc[2]]) < 0;
    if (this.flip) sw = !sw;
    this._emit(a, na); if (sw) { this._emit(c, nc); this._emit(b, nb); } else { this._emit(b, nb); this._emit(c, nc); }
  }
  tri(a, b, c) { const n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(c, a))); this.triN(a, b, c, n, n, n); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  quadN(a, b, c, d, na, nb, nc, nd) { this.triN(a, b, c, na, nb, nc); this.triN(a, c, d, na, nc, nd); }

  // plain box (no bevel)
  box(x0, x1, y0, y1, z0, z1) {
    const p = (x, y, z) => [x, y, z];
    const fq = (a, b, c, d, n) => { this.triN(a, b, c, n, n, n); this.triN(a, c, d, n, n, n); };
    fq(p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1), [1, 0, 0]);
    fq(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), [-1, 0, 0]);
    fq(p(x0, y1, z0), p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), [0, 1, 0]);
    fq(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), [0, -1, 0]);
    fq(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), [0, 0, 1]);
    fq(p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0), [0, 0, -1]);
    return this;
  }
  // beveled box
  bbox(x0, x1, y0, y1, z0, z1, bev = 0.01) {
    if (x0 > x1) [x0, x1] = [x1, x0]; if (y0 > y1) [y0, y1] = [y1, y0]; if (z0 > z1) [z0, z1] = [z1, z0];
    return this.cv([[1, 0, 0, x1, 0, 0], [-1, 0, 0, x0, 0, 0], [0, 1, 0, 0, y1, 0], [0, -1, 0, 0, y0, 0], [0, 0, 1, 0, 0, z1], [0, 0, -1, 0, 0, z0]], bev);
  }
  // convex polyhedron from planes [nx,ny,nz, px,py,pz, bevel?]; chamfered edges w/ weighted normals
  cv(planes, bev = 0.012) {
    const pls = planes.map(q => { const n = v3.norm([q[0], q[1], q[2]]); return { n, d: v3.dot(n, [q[3], q[4], q[5]]), b: q[6] === undefined ? bev : q[6] }; });
    let faces = _faces(pls);
    const ch = [], seen = new Set();
    for (const f of faces) {
      const i = f.i, P = f.poly;
      for (let e = 0; e < P.length; e++) {
        const a = P[e], b = P[(e + 1) % P.length];
        if (v3.len(v3.sub(a, b)) < 1e-5) continue;
        const m = v3.lerp(a, b, 0.5);
        for (let j = 0; j < pls.length; j++) {
          if (j === i) continue;
          if (Math.abs(v3.dot(pls[j].n, m) - pls[j].d) < 1e-6) {
            const key = Math.min(i, j) + '_' + Math.max(i, j);
            if (seen.has(key)) break; seen.add(key);
            const bv = Math.min(pls[i].b, pls[j].b); if (bv <= 0) break;
            const s = v3.add(pls[i].n, pls[j].n), l = v3.len(s); if (l < 1e-6) break;
            const n = v3.sc(s, 1 / l), ca = v3.dot(n, pls[i].n), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
            if (sa < 0.13) break;
            ch.push({ n, d: v3.dot(n, m) - bv * sa, par: [i, j], b: 0 });
            break;
          }
        }
      }
    }
    let all = pls;
    if (ch.length) { all = pls.concat(ch); faces = _faces(all); }
    for (const f of faces) {
      const pl = all[f.i], P = f.poly;
      let ns;
      if (pl.par) {
        ns = P.map(v => {
          let nn = [0, 0, 0], hit = 0;
          for (const pi of pl.par) if (Math.abs(v3.dot(all[pi].n, v) - all[pi].d) < 1e-5) { nn = v3.add(nn, all[pi].n); hit++; }
          return hit ? v3.norm(nn) : pl.n;
        });
      } else ns = P.map(() => pl.n);
      for (let k = 1; k < P.length - 1; k++) this.triN(P[0], P[k], P[k + 1], ns[0], ns[k], ns[k + 1]);
    }
    return this;
  }
  // extruded convex polygon. plane: 'xy' (extrude z), 'xz' (extrude y), 'zy' (extrude x)
  prism(pts, w0, w1, bev = 0.01, plane = 'xy', capBev) {
    let area = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const sg = area > 0 ? 1 : -1, pls = [];
    const map = plane === 'xy' ? (u, v, w) => [u, v, w] : plane === 'xz' ? (u, v, w) => [u, w, v] : (u, v, w) => [w, v, u];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length]; const nu = (b[1] - a[1]) * sg, nv = -(b[0] - a[0]) * sg;
      pls.push([...map(nu, nv, 0), ...map(a[0], a[1], 0)]);
    }
    if (w0 > w1) [w0, w1] = [w1, w0];
    const c0 = [...map(0, 0, -1), ...map(0, 0, w0)], c1 = [...map(0, 0, 1), ...map(0, 0, w1)];
    if (capBev !== undefined) { c0.push(capBev); c1.push(capBev); }
    pls.push(c0, c1);
    return this.cv(pls, bev);
  }
  // surface of revolution. o: origin, A: axis dir, prof: [[t,r],...]
  lathe(o, A, prof, seg = 24, opt = {}) {
    A = v3.norm(A);
    let U = opt.U ? v3.norm(opt.U) : v3.norm(Math.abs(A[1]) < 0.9 ? v3.cross([0, 1, 0], A) : v3.cross([1, 0, 0], A));
    const W = v3.cross(A, U);
    const smooth = Math.cos(opt.smooth === undefined ? 40 * DEG : opt.smooth), a0 = opt.a0 || 0, a1 = opt.a1 === undefined ? 2 * Math.PI : opt.a1;
    const n = prof.length, sn = [];
    for (let i = 0; i < n - 1; i++) { const dt = prof[i + 1][0] - prof[i][0], dr = prof[i + 1][1] - prof[i][1], l = Math.hypot(dt, dr); sn.push(l > 1e-9 ? [-dr / l, dt / l] : null); }
    const sN = [], eN = [];
    for (let i = 0; i < n - 1; i++) { sN.push(sn[i]); eN.push(sn[i]); }
    for (let i = 0; i < n - 2; i++) {
      const a = sn[i], b = sn[i + 1]; if (!a || !b) continue;
      if (a[0] * b[0] + a[1] * b[1] > smooth) { const s = [a[0] + b[0], a[1] + b[1]], l = Math.hypot(s[0], s[1]); const av = [s[0] / l, s[1] / l]; eN[i] = av; sN[i + 1] = av; }
    }
    const P = (t, r, d) => [o[0] + A[0] * t + d[0] * r, o[1] + A[1] * t + d[1] * r, o[2] + A[2] * t + d[2] * r];
    const Nn = (q, d) => [A[0] * q[0] + d[0] * q[1], A[1] * q[0] + d[1] * q[1], A[2] * q[0] + d[2] * q[1]];
    const D = (a) => { const c = Math.cos(a), s = Math.sin(a); return [U[0] * c + W[0] * s, U[1] * c + W[1] * s, U[2] * c + W[2] * s]; };
    for (let k = 0; k < seg; k++) {
      const g0 = a0 + (a1 - a0) * k / seg, g1 = a0 + (a1 - a0) * (k + 1) / seg;
      const d0 = D(g0), d1 = D(g1), dm = D((g0 + g1) / 2);
      for (let i = 0; i < n - 1; i++) {
        if (!sn[i]) continue;
        const [t0, r0] = prof[i], [t1, r1] = prof[i + 1];
        const nd0 = opt.flat ? dm : d0, nd1 = opt.flat ? dm : d1;
        const p00 = P(t0, r0, d0), p10 = P(t1, r1, d0), p11 = P(t1, r1, d1), p01 = P(t0, r0, d1);
        const n00 = Nn(sN[i], nd0), n10 = Nn(eN[i], nd0), n11 = Nn(eN[i], nd1), n01 = Nn(sN[i], nd1);
        if (r0 > 1e-7 || r1 > 1e-7) {
          if (r0 < 1e-7) this.triN(p00, p10, p11, n00, n10, n11);
          else if (r1 < 1e-7) this.triN(p00, p10, p01, n00, n10, n01);
          else this.quadN(p00, p10, p11, p01, n00, n10, n11, n01);
        }
      }
    }
    return this;
  }
  // capped cylinder between two points with small bevel
  cyl(p0, p1, r, seg = 16, bev = 0, opt = {}) {
    const d = v3.sub(p1, p0), h = v3.len(d);
    const pr = bev > 0 ? [[0, 0], [0, r - bev], [bev, r], [h - bev, r], [h, r - bev], [h, 0]] : [[0, 0], [0, r], [h, r], [h, 0]];
    return this.lathe(p0, d, pr, seg, Object.assign({ smooth: bev > 0 ? 50 * DEG : 40 * DEG }, opt));
  }
  // tube along polyline
  tube(pts, r, seg = 8, opt = {}) {
    const n = pts.length, closed = !!opt.closed, T = [];
    for (let i = 0; i < n; i++) {
      const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      T.push(v3.norm(v3.sub(b, a)));
    }
    let u = v3.norm(Math.abs(T[0][1]) < 0.9 ? v3.cross([0, 1, 0], T[0]) : v3.cross([1, 0, 0], T[0]));
    const rings = [];
    for (let i = 0; i < n; i++) {
      u = v3.norm(v3.mad(u, T[i], -v3.dot(u, T[i]))); const w = v3.cross(T[i], u), ring = [];
      for (let k = 0; k < seg; k++) { const a = k / seg * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a); const nn = [u[0] * c + w[0] * s, u[1] * c + w[1] * s, u[2] * c + w[2] * s]; ring.push([v3.mad(pts[i], nn, r), nn]); }
      rings.push(ring);
    }
    const m = closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const A = rings[i], B = rings[(i + 1) % n];
      for (let k = 0; k < seg; k++) { const k1 = (k + 1) % seg; this.quadN(A[k][0], B[k][0], B[k1][0], A[k1][0], A[k][1], B[k][1], B[k1][1], A[k1][1]); }
    }
    if (!closed && opt.caps !== false) {
      for (const [ri, sgn] of [[0, -1], [n - 1, 1]]) {
        const R = rings[ri], nn = v3.sc(T[ri], sgn);
        for (let k = 1; k < seg - 1; k++) this.triN(R[0][0], R[k][0], R[k + 1][0], nn, nn, nn);
      }
    }
    return this;
  }
  sphere(c, r, seg = 12) {
    const pr = []; const m = Math.max(4, seg >> 1);
    for (let i = 0; i <= m; i++) { const a = Math.PI * i / m; pr.push([-Math.cos(a) * r, Math.sin(a) * r]); }
    return this.lathe(c, [0, 1, 0], pr, seg, { smooth: 90 * DEG });
  }
  // hex bolt head along direction d from point p
  bolt(p, d, r = 0.012, h = 0.01) { return this.lathe(p, d, [[0, r], [h, r], [h, 0]], 6, { flat: true, smooth: 0 }); }
  finish() {
    return { n: this.nv, P: this.P.subarray(0, this.nv * 3), N: this.N.subarray(0, this.nv * 3), C: this.C.subarray(0, this.nv * 4), M: this.M.subarray(0, this.nv * 4) };
  }
}
// helpers for paths
function roundPath(pts, rad, steps = 5, closed = false) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) { out.push(pts[i]); continue; }
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const da = v3.sub(a, p), db = v3.sub(b, p), la = v3.len(da), lb = v3.len(db);
    const ra = Math.min(rad, la * 0.45), rb = Math.min(rad, lb * 0.45);
    const A = v3.mad(p, da, ra / la), B = v3.mad(p, db, rb / lb);
    for (let k = 0; k <= steps; k++) { const t = k / steps, s = 1 - t; out.push([s * s * A[0] + 2 * s * t * p[0] + t * t * B[0], s * s * A[1] + 2 * s * t * p[1] + t * t * B[1], s * s * A[2] + 2 * s * t * p[2] + t * t * B[2]]); }
  }
  return out;
}
function arcPts(c, u, v, r, a0, a1, n) { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push(v3.mad(v3.mad(c, u, Math.cos(a) * r), v, Math.sin(a) * r)); } return o; }
