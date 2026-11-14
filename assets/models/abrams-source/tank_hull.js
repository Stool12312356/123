// ============================================================================
//  M1A2 Abrams – materials, hull, running gear
//  Coordinates: +X forward, +Y up, +Z = tank's right.  Units: metres.
// ============================================================================
const MAT = {
  tan:    { c: [178, 150, 108], r: 0.78, m: 0, k: 0 },
  tan2:   { c: [170, 142, 101], r: 0.80, m: 0, k: 0 },
  tanD:   { c: [150, 124, 88], r: 0.84, m: 0, k: 0 },
  steel:  { c: [70, 62, 55], r: 0.58, m: 0.7, k: 4 },
  rubber: { c: [33, 32, 31], r: 0.92, m: 0, k: 2 },
  gun:    { c: [46, 49, 56], r: 0.36, m: 0.9, k: 1 },
  glass:  { c: [16, 22, 27], r: 0.06, m: 0, k: 3 },
  dark:   { c: [9, 9, 9], r: 1.0, m: 0, k: 6 },
  lens:   { c: [92, 94, 92], r: 0.08, m: 0, k: 3 },
  red:    { c: [96, 16, 12], r: 0.15, m: 0, k: 3 },
  canvas: { c: [128, 108, 78], r: 0.96, m: 0, k: 6 },
  wood:   { c: [120, 96, 66], r: 0.9, m: 0, k: 6 },
  mesh:   { c: [150, 124, 88], r: 0.8, m: 0, k: 5 },
  ground: { c: [96, 96, 98], r: 0.6, m: 0, k: 7 },
};
const TK = {
  turX: 0.40, turY: 1.52,           // turret origin in world
  trunX: 1.53, trunY: 0.41,         // trunnion in turret space
  trackZ: 1.42, wheelR: 0.3175, wheelY: 0.3925,
  wheelX: [2.37, 1.42, 0.63, -0.14, -0.88, -1.62, -2.37],     // uneven spacing measured from the drawing
  sprocket: { x: -3.33, y: 0.82, r: 0.3397 },
  idler: { x: 3.20, y: 0.70, r: 0.30 },
  rollers: [{ x: -1.55, y: 0.955 }, { x: 0.75, y: 0.95 }],
  pitch: 0.194,
};
const GA = 6.8 * DEG, GT = Math.tan(GA);
const HY = 1.50, FA = 3 * DEG;
const glY = x => Math.min(HY, 1.31 + (3.86 - x) * GT);   // glacis: 1.27 m at the nose, meets the roof 1.6 m further back

// ---------------------------------------------------------------- track path
function trackPath(circles) {
  const n = circles.length, tn = [], segs = [];
  for (let i = 0; i < n; i++) {
    const a = circles[i], b = circles[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, D = Math.hypot(dx, dy);
    const hx = dx / D, hy = dy / D, k = (a.r - b.r) / D, s = Math.sqrt(1 - k * k);
    tn.push([hx * k - hy * s, hy * k + hx * s]);
  }
  let L = 0;
  for (let i = 0; i < n; i++) {
    const c = circles[i], p = tn[(i - 1 + n) % n], q = tn[i];
    const a0 = Math.atan2(p[1], p[0]), a1 = Math.atan2(q[1], q[0]);
    let da = a0 - a1; while (da < -1e-7) da += 2 * Math.PI; while (da > 2 * Math.PI - 1e-7) da -= 2 * Math.PI; if (da < 0) da = 0;
    segs.push({ arc: 1, c, a0, da, len: c.r * da, s0: L, idx: i }); L += c.r * da;
    const b = circles[(i + 1) % n], p0 = [c.x + c.r * q[0], c.y + c.r * q[1]], p1 = [b.x + b.r * q[0], b.y + b.r * q[1]];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    segs.push({ arc: 0, p0, p1, len, s0: L }); L += len;
  }
  return {
    segs, L,
    at(s) {
      s = ((s % L) + L) % L;
      for (const g of segs) {
        if (s <= g.s0 + g.len + 1e-9) {
          const t = s - g.s0;
          if (g.arc) { const a = g.a0 - t / g.c.r; return [g.c.x + g.c.r * Math.cos(a), g.c.y + g.c.r * Math.sin(a)]; }
          const f = g.len > 0 ? t / g.len : 0; return [g.p0[0] + (g.p1[0] - g.p0[0]) * f, g.p0[1] + (g.p1[1] - g.p0[1]) * f];
        }
      }
      return [segs[0].c.x, segs[0].c.y];
    },
  };
}
function makeTrack() {
  const off = 0.03; // pin line above wheel surface
  const build = (ix) => {
    const cs = [{ x: TK.sprocket.x, y: TK.sprocket.y, r: TK.sprocket.r }];
    for (const r of TK.rollers) cs.push({ x: r.x, y: r.y, r: 0.09 + off });
    cs.push({ x: ix, y: TK.idler.y, r: TK.idler.r + off });
    for (const wx of TK.wheelX) cs.push({ x: wx, y: TK.wheelY, r: TK.wheelR + off });
    return trackPath(cs);
  };
  let p = build(TK.idler.x); const N = Math.round(p.L / TK.pitch);
  let lo = TK.idler.x - 0.2, hi = TK.idler.x + 0.2;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (build(mid).L > N * TK.pitch) hi = mid; else lo = mid; }
  TK.idler.x = (lo + hi) / 2; p = build(TK.idler.x); p.N = N; p.pitch = p.L / N;
  return p;
}

// ---------------------------------------------------------------- wheels
function makeWheel(R, lugs = true) {
  const g = new Geo(), k = R / 0.3175, O = [0, 0, 0], Z = [0, 0, 1], SEG = 44;
  for (const side of [1, -1]) {
    g.push(m4.S(1, 1, side));
    g.mat(MAT.tan);
    g.lathe(O, Z, [[0.04, 0.10], [0.052, 0.262 * k]], SEG);
    g.mat(MAT.rubber);
    g.lathe(O, Z, [[0.052, 0.262 * k], [0.043, 0.276 * k], [0.040, 0.300 * k], [0.050, 0.3175 * k], [0.180, 0.3175 * k], [0.190, 0.300 * k], [0.188, 0.276 * k], [0.180, 0.262 * k]], SEG, { smooth: 50 * DEG });
    g.mat(MAT.tan);
    g.lathe(O, Z, [[0.180, 0.262 * k], [0.170, 0.256 * k], [0.150, 0.246 * k], [0.126, 0.215 * k], [0.117, 0.172 * k], [0.127, 0.137], [0.158, 0.127], [0.167, 0.119],
      [0.171, 0.079], [0.197, 0.073], [0.211, 0.059], [0.216, 0.03], [0.216, 0]], SEG, { smooth: 38 * DEG });
    if (side === 1 && lugs) {
      g.mat(MAT.tanD);
      for (let i = 0; i < 10; i++) { const a = i / 10 * 2 * Math.PI; g.bolt([Math.cos(a) * 0.099, Math.sin(a) * 0.099, 0.168], Z, 0.0115, 0.02); }
      g.mat(MAT.glass); g.lathe(O, Z, [[0.216, 0.028], [0.219, 0.024], [0.219, 0]], 12);
    }
    g.pop();
  }
  g.mat(MAT.tanD); g.lathe(O, Z, [[-0.04, 0.10], [0.04, 0.10]], 20);
  return g;
}
function makeSprocket() {
  const g = new Geo(), O = [0, 0, 0], Z = [0, 0, 1];
  g.mat(MAT.tan);
  g.lathe(O, Z, [[-0.30, 0], [-0.30, 0.17], [-0.27, 0.21], [0.25, 0.21], [0.265, 0.19], [0.272, 0.13], [0.30, 0.12], [0.312, 0.10], [0.312, 0]], 36, { smooth: 30 * DEG });
  g.mat(MAT.tanD);
  for (let i = 0; i < 12; i++) { const a = i / 12 * 2 * Math.PI; g.bolt([Math.cos(a) * 0.16, Math.sin(a) * 0.16, 0.266], Z, 0.013, 0.02); }
  g.mat(MAT.steel);
  for (const sz of [1, -1]) {
    const zc = sz * 0.3005;
    g.lathe(O, Z, [[zc - 0.015, 0.20], [zc - 0.015, 0.228], [zc + 0.015, 0.228], [zc + 0.015, 0.20]], 44, { smooth: 10 * DEG });
    g.lathe(O, Z, [[zc - 0.015, 0.276], [zc - 0.015, 0.302], [zc + 0.015, 0.302], [zc + 0.015, 0.276]], 44, { smooth: 10 * DEG });
    for (let i = 0; i < 11; i++) {   // webs between the oval lightening holes
      g.push(m4.RZ((i + 0.5) / 11 * 2 * Math.PI));
      g.prism([[0.222, -0.036], [0.253, -0.020], [0.253, 0.020], [0.222, 0.036]], zc - 0.014, zc + 0.014, 0.003);
      g.prism([[0.249, -0.020], [0.282, -0.038], [0.282, 0.038], [0.249, 0.020]], zc - 0.014, zc + 0.014, 0.003);
      g.pop();
    }
    for (let i = 0; i < 11; i++) {
      g.push(m4.RZ(i / 11 * 2 * Math.PI));
      g.prism([[0.295, -0.052], [0.372, -0.017], [0.372, 0.017], [0.295, 0.052]], zc - 0.015, zc + 0.015, 0.004);
      g.pop();
    }
  }
  return g;
}
function makeRoller() {
  const g = new Geo(), O = [0, 0, 0], Z = [0, 0, 1];
  for (const side of [1, -1]) {
    g.push(m4.S(1, 1, side));
    g.mat(MAT.tan); g.lathe(O, Z, [[0.05, 0.0], [0.05, 0.07]], 20);
    g.mat(MAT.rubber); g.lathe(O, Z, [[0.05, 0.07], [0.05, 0.09], [0.19, 0.09], [0.19, 0.07]], 20, { smooth: 10 * DEG });
    g.mat(MAT.tan); g.lathe(O, Z, [[0.19, 0.07], [0.17, 0.05], [0.20, 0.035], [0.20, 0]], 20);
    g.pop();
  }
  g.mat(MAT.tanD); g.lathe(O, Z, [[-0.05, 0.04], [0.05, 0.04]], 12);
  return g;
}
// T-158 double-pin shoe with two replaceable rubber pads, end connectors and centre guide
function makeLink(p) {
  const g = new Geo(), h = p / 2;
  for (const s of [1, -1]) {
    g.push(m4.S(1, 1, s));
    g.mat(MAT.steel);
    // shoe body: two pin bosses (octagonal) joined by web
    g.prism([[-0.080, -0.012], [-0.080, 0.004], [-0.066, 0.019], [0.066, 0.019], [0.080, 0.004], [0.080, -0.012], [0.062, -0.030], [-0.062, -0.030]], 0.034, 0.287, 0.004);
    // pad retaining frame
    g.bbox(-0.071, 0.071, 0.017, 0.027, 0.048, 0.276, 0.004);
    g.mat(MAT.rubber);
    g.bbox(-0.062, 0.062, 0.022, 0.046, 0.058, 0.266, 0.009);
    // inner wheel-path rubber
    g.bbox(-0.058, 0.058, -0.034, -0.026, 0.050, 0.270, 0.003);
    g.mat(MAT.steel);
    // end connector (bridges to next shoe)
    g.prism([[h - 0.060, -0.018], [h - 0.060, 0.010], [h - 0.046, 0.024], [h + 0.046, 0.024], [h + 0.060, 0.010], [h + 0.060, -0.018], [h + 0.044, -0.032], [h - 0.044, -0.032]], 0.289, 0.3175, 0.004);
    g.bolt([h, -0.006, 0.3175], [0, 0, 1], 0.013, 0.008);
    // pin ends
    g.lathe([-0.040, -0.004, 0.280], [0, 0, 1], [[0, 0.015], [0.012, 0.015], [0.012, 0]], 8);
    g.lathe([0.040, -0.004, 0.280], [0, 0, 1], [[0, 0.015], [0.012, 0.015], [0.012, 0]], 8);
    g.pop();
  }
  g.mat(MAT.steel);
  // centre connector + guide horn
  g.prism([[h - 0.048, -0.030], [h - 0.048, 0.012], [h - 0.036, 0.022], [h + 0.036, 0.022], [h + 0.048, 0.012], [h + 0.048, -0.030]], -0.032, 0.032, 0.004);
  g.prism([[h - 0.046, -0.028], [h + 0.046, -0.028], [h + 0.016, -0.118], [h - 0.016, -0.118]], -0.024, 0.024, 0.006);
  g.bolt([h, 0.022, 0], [0, 1, 0], 0.014, 0.008);
  return g;
}

// ---------------------------------------------------------------- hull
function buildHull(g) {
  const GLP = [Math.sin(GA), Math.cos(GA), 0, 3.86, 1.31, 0], FNP = [Math.sin(FA), Math.cos(FA), 0, 3.56, 1.425, 0];
  g.mat(MAT.tan);
  // central upper hull: roof + glacis (the glacis sinks between the sponsons toward the nose)
  const BOW1 = [0.877, -0.481, 0, 3.86, 1.31, 0], BOW2 = [0.483, -0.876, 0, 3.58, 0.80, 0];
  g.cv([[0, 1, 0, 0, HY, 0], GLP, [0, -1, 0, 0, 1.14, 0], [0, 0, 1, 0, 0, 1.10, 0], [0, 0, -1, 0, 0, -1.10, 0], [-1, 0, 0, -4.04, 0, 0], BOW1], 0.012);
  // sponsons over the tracks: level top all the way to the front mudguards
  for (const s of [1, -1]) g.cv([[0, 1, 0, 0, HY, 0], GLP, [0, -1, 0, 0, 1.27, 0], [0, 0, s, 0, 0, s * 1.74], [0, 0, -s, 0, 0, s * 1.08, 0], [-1, 0, 0, -4.04, 0, 0], [1, 0, 0, 3.60, 0, 0]], 0.012);
  // lower tub
  g.cv([[0, -1, 0, 0, 0.48, 0], [0, 1, 0, 0, 1.2, 0, 0], GLP, BOW1, BOW2, [0, 0, 1, 0, 0, 1.08], [0, 0, -1, 0, 0, -1.08],
    [-1, 0, 0, -4.04, 0, 0], [-0.52, -0.37, 0, -4.04, 0.86, 0]], 0.012);
  // engine deck: ramps up behind the turret ring to 1.78 m, full width
  g.cv([[0, 1, 0, 0, 1.78, 0], [0.208, 0.978, 0, -1.02, HY, 0], [0, -1, 0, 0, 1.40, 0, 0], [-1, 0, 0, -4.04, 0, 0], [0, 0, 1, 0, 0, 1.74], [0, 0, -1, 0, 0, -1.74]], 0.02);

  // turret race ring
  g.mat(MAT.tanD);
  g.lathe([TK.turX, 0, 0], [0, 1, 0], [[HY - 0.005, 1.20], [HY + 0.018, 1.20], [HY + 0.026, 1.18], [HY + 0.026, 1.045], [HY + 0.05, 1.045]], 72, { smooth: 30 * DEG });
  for (let i = 0; i < 40; i++) { const a = (i + 0.5) / 40 * 2 * Math.PI; g.bolt([TK.turX + Math.cos(a) * 1.125, HY + 0.026, Math.sin(a) * 1.125], [0, 1, 0], 0.014, 0.01); }

  // ---- glacis furniture ------------------------------------------------------
  g.push(m4.T(2.84, glY(2.84), 0), m4.RZ(-GA));
  g.mat(MAT.tan2);
  g.prism([[-0.40, -0.44], [0.24, -0.44], [0.40, -0.26], [0.40, 0.26], [0.24, 0.44], [-0.40, 0.44]], 0, 0.018, 0.008, 'xz');
  g.mat(MAT.tan);
  g.prism([[-0.31, -0.36], [0.12, -0.36], [0.27, -0.21], [0.27, 0.21], [0.12, 0.36], [-0.31, 0.36]], 0.015, 0.062, 0.014, 'xz');
  // periscopes
  for (const [px, pz, ang] of [[0.215, 0, 0], [0.15, -0.255, 38], [0.15, 0.255, -38]]) {
    g.push(m4.T(px, 0.062, pz), m4.RY(ang * DEG));
    g.mat(MAT.tan); g.cv([[1, 0.35, 0, 0.045, 0, 0], [-1, 0.2, 0, -0.045, 0, 0], [0, 1, 0, 0, 0.062, 0], [0, -1, 0, 0, -0.01, 0, 0], [0, 0, 1, 0, 0, 0.095], [0, 0, -1, 0, 0, -0.095]], 0.006);
    g.mat(MAT.glass); g.push(m4.T(0.036, 0.028, 0), m4.RZ(-19.3 * DEG)); g.box(-0.004, 0.006, -0.018, 0.018, -0.075, 0.075); g.pop();
    g.pop();
  }
  // hinge + handle
  g.mat(MAT.tanD);
  g.cyl([-0.34, 0.05, -0.2], [-0.34, 0.05, 0.2], 0.022, 10, 0.004);
  g.bbox(-0.37, -0.28, 0.01, 0.06, -0.26, -0.20, 0.006); g.bbox(-0.37, -0.28, 0.01, 0.06, 0.20, 0.26, 0.006);
  g.tube(roundPath([[-0.12, 0.06, -0.09], [-0.12, 0.10, -0.09], [-0.12, 0.10, 0.09], [-0.12, 0.06, 0.09]], 0.02, 4), 0.008, 6);
  g.pop();
  // fuel filler caps + bolted plates on the glacis
  for (const s of [1, -1]) {
    g.push(m4.T(3.14, glY(3.14), s * 0.66), m4.RZ(-GA));
    g.mat(MAT.tan2); g.lathe([0, 0, 0], [0, 1, 0], [[0, 0.115], [0.016, 0.115], [0.026, 0.10], [0.026, 0.05], [0.04, 0.045], [0.04, 0]], 20);
    g.mat(MAT.tanD); for (let i = 0; i < 6; i++) { const a = i / 6 * 2 * Math.PI; g.bolt([Math.cos(a) * 0.085, 0.024, Math.sin(a) * 0.085], [0, 1, 0], 0.011, 0.008); }
    g.pop();
    // access plate
    g.push(m4.T(2.64, glY(2.64), s * 0.79), m4.RZ(-GA));
    g.mat(MAT.tan2); g.bbox(-0.22, 0.22, 0, 0.012, -0.26, 0.26, 0.006);
    g.mat(MAT.tanD); for (const bx of [-0.19, 0, 0.19]) for (const bz of [-0.23, 0.23]) g.bolt([bx, 0.012, bz], [0, 1, 0], 0.011, 0.007);
    g.pop();
    // lifting eye
    g.push(m4.T(3.64, glY(3.64), s * 0.40), m4.RZ(-GA));
    g.mat(MAT.tanD); g.tube(arcPts([0, 0.0, 0], [1, 0, 0], [0, 1, 0], 0.05, 0, Math.PI, 8), 0.014, 8);
    g.pop();
  }
  // headlight clusters
  for (const s of [1, -1]) {
    g.push(m4.T(3.63, glY(3.63), s * 1.02), m4.RZ(-GA), m4.S(0.72, 0.72, 0.72 * s));
    g.mat(MAT.tan); g.bbox(-0.13, 0.11, 0, 0.035, -0.17, 0.17, 0.008);
    g.push(m4.RZ(GA));
    g.mat(MAT.tanD);
    g.lathe([-0.07, 0.115, -0.065], [1, 0, 0], [[0, 0], [0, 0.05], [0.03, 0.074], [0.13, 0.078], [0.135, 0.07]], 20);
    g.lathe([-0.05, 0.095, 0.075], [1, 0, 0], [[0, 0], [0, 0.035], [0.03, 0.05], [0.11, 0.052], [0.114, 0.046]], 16);
    g.bbox(-0.03, 0.03, 0.0, 0.07, -0.09, -0.04, 0.005); g.bbox(-0.02, 0.03, 0.0, 0.06, 0.055, 0.095, 0.005);
    g.mat(MAT.lens);
    g.lathe([0.064, 0.115, -0.065], [1, 0, 0], [[0, 0.07], [0.008, 0.05], [0.011, 0]], 20, { smooth: 60 * DEG });
    g.lathe([0.063, 0.095, 0.075], [1, 0, 0], [[0, 0.046], [0.006, 0.03], [0.008, 0]], 16, { smooth: 60 * DEG });
    g.mat(MAT.tan);
    // brush guard
    g.tube(roundPath([[0.10, 0.0, -0.165], [0.10, 0.225, -0.165], [0.10, 0.225, 0.165], [0.10, 0.0, 0.165]], 0.05, 5), 0.011, 8);
    g.tube(roundPath([[-0.12, 0.0, -0.165], [-0.10, 0.225, -0.165], [-0.10, 0.225, 0.165], [-0.12, 0.0, 0.165]], 0.05, 5), 0.011, 8);
    g.tube([[-0.10, 0.225, 0], [0.10, 0.225, 0]], 0.011, 8);
    g.pop(); g.pop();
  }
  // tow lugs + shackles (front & rear), tow pintle
  for (const s of [1, -1]) {
    g.mat(MAT.tan);
    g.prism([[3.70, 1.335], [3.90, 1.312], [3.925, 1.275], [3.90, 1.235], [3.80, 1.25]], s * 0.99 - 0.03, s * 0.99 + 0.03, 0.01);
    g.prism([[3.70, 1.335], [3.90, 1.312], [3.925, 1.275], [3.90, 1.235], [3.80, 1.25]], s * 0.87 - 0.03, s * 0.87 + 0.03, 0.01);
    g.mat(MAT.steel);
    g.cyl([3.885, 1.275, s * 0.82], [3.885, 1.275, s * 1.04], 0.02, 10, 0.004);
    g.tube([[3.885, 1.275, s * 0.845], [3.90, 1.21, s * 0.845], [3.915, 1.13, s * 0.865], [3.92, 1.085, s * 0.93], [3.915, 1.13, s * 0.995], [3.90, 1.21, s * 1.015], [3.885, 1.275, s * 1.015]], 0.019, 8);
    g.mat(MAT.tan);
    g.prism([[3.50, 0.80], [3.60, 0.83], [3.665, 0.79], [3.655, 0.70], [3.60, 0.665], [3.52, 0.70]], s * 0.86 - 0.028, s * 0.86 + 0.028, 0.01);
    g.mat(MAT.steel);
    g.tube([[3.64, 0.71, s * 0.86], [3.67, 0.65, s * 0.86], [3.65, 0.60, s * 0.86], [3.60, 0.60, s * 0.86]], 0.016, 8);
    g.mat(MAT.tan);
    g.prism([[-3.82, 0.70], [-3.98, 0.66], [-4.07, 0.72], [-4.07, 0.82], [-3.92, 0.90]], s * 0.72 - 0.035, s * 0.72 + 0.035, 0.012);
    g.mat(MAT.steel);
    g.tube(arcPts([-4.03, 0.70, s * 0.72], [1, 0, 0], [0, 1, 0], 0.062, 0, 2 * Math.PI, 16).slice(0, 16), 0.017, 8, { closed: true });
  }
  g.mat(MAT.tan); g.bbox(-4.11, -3.92, 0.66, 0.80, -0.09, 0.09, 0.015);
  g.mat(MAT.steel); g.lathe([-4.15, 0.69, 0], [0, 1, 0], [[0, 0], [0, 0.028], [0.10, 0.028], [0.10, 0]], 10);
  g.bbox(-4.18, -4.10, 0.67, 0.70, -0.04, 0.04, 0.006); g.bbox(-4.18, -4.10, 0.775, 0.80, -0.04, 0.04, 0.006);

  // ---- front mudguards (curve down from the sponson top to the nose) / rear flaps -------
  for (const s of [1, -1]) {
    g.push(m4.S(1, 1, s));
    g.mat(MAT.tan);
    g.push(m4.T(0, -0.078, 0));
    g.prism([[3.54, 1.385], [3.75, 1.365], [3.765, 1.411], [3.54, 1.432]], 1.085, 1.755, 0.006);
    g.prism([[3.75, 1.365], [3.868, 1.308], [3.902, 1.342], [3.765, 1.411]], 1.085, 1.755, 0.006);
    g.prism([[3.868, 1.308], [3.934, 1.218], [3.977, 1.232], [3.902, 1.342]], 1.085, 1.755, 0.006);
    g.prism([[3.934, 1.218], [3.962, 1.11], [4.004, 1.115], [3.977, 1.232]], 1.085, 1.755, 0.006);
    g.mat(MAT.tanD); for (const bz of [1.18, 1.34, 1.50, 1.66]) g.bolt([3.63, 1.423, bz], [0, 1, 0], 0.012, 0.007);
    g.mat(MAT.rubber);
    g.prism([[3.966, 1.115], [3.972, 0.99], [3.998, 0.99], [4.0, 1.115]], 1.095, 1.745, 0.005);
    g.pop();
    g.mat(MAT.rubber);
    // rear flap
    g.bbox(-4.075, -4.05, 0.98, 1.20, 1.24, 1.76, 0.005);
    g.pop();
  }

  // ---- rear plate: plain upper band, left grille, taller projecting centre (exhaust) door, short right grille, tail lights
  const grille = (z0, z1, y0, y1, xf, nv) => {
    g.mat(MAT.tan);
    g.bbox(xf, -4.03, y1 - 0.035, y1, z0, z1, 0.008); g.bbox(xf, -4.03, y0, y0 + 0.035, z0, z1, 0.008);
    g.bbox(xf, -4.03, y0, y1, z0, z0 + 0.035, 0.008); g.bbox(xf, -4.03, y0, y1, z1 - 0.035, z1, 0.008);
    g.mat(MAT.dark); g.box(xf + 0.04, -4.046, y0 + 0.03, y1 - 0.03, z0 + 0.03, z1 - 0.03);
    g.mat(MAT.tanD);
    const n = Math.round((y1 - y0 - 0.07) / 0.037);
    for (let i = 1; i < n; i++) { const y = y0 + 0.035 + i * (y1 - y0 - 0.07) / n; g.box(xf + 0.014, xf + 0.021, y - 0.0045, y + 0.0045, z0 + 0.03, z1 - 0.03); }
    for (let i = 1; i < nv; i++) { const z = z0 + (z1 - z0) * i / nv; g.box(xf + 0.006, xf + 0.024, y0 + 0.03, y1 - 0.03, z - 0.007, z + 0.007); }
    g.mat(MAT.steel);
    for (const z of [z0 + 0.018, z1 - 0.018]) for (const y of [y0 + 0.018, y1 - 0.018]) g.bolt([xf, y, z], [-1, 0, 0], 0.009, 0.006);
  };
  grille(-1.03, -0.30, 1.09, 1.54, -4.085, 6);
  grille(0.50, 1.02, 1.09, 1.54, -4.085, 4);
  grille(-0.27, 0.48, 1.03, 1.565, -4.15, 5);
  g.mat(MAT.tan);
  g.bbox(-4.17, -4.03, 1.565, 1.60, -0.30, 0.51, 0.008);                    // hood over the exhaust door
  g.bbox(-4.062, -4.03, 1.60, 1.755, -1.03, 1.02, 0.007);                   // plain upper band
  g.bbox(-4.075, -4.03, 1.60, 1.63, 0.51, 1.02, 0.006);
  g.mat(MAT.tanD);
  g.box(-4.066, -4.06, 1.60, 1.755, -0.305, -0.295);
  for (const z of [-0.95, -0.38, 0.40, 0.95]) for (const y of [1.63, 1.73]) g.bolt([-4.062, y, z], [-1, 0, 0], 0.011, 0.007);
  for (const s of [1, -1]) {
    g.push(m4.S(1, 1, s));
    g.mat(MAT.tan);
    g.bbox(-4.075, -4.03, 1.53, 1.755, 1.36, 1.64, 0.008);                  // tail-light housing
    g.bbox(-4.058, -4.03, 1.22, 1.50, 1.20, 1.70, 0.006);                   // access plate below it
    g.lathe([-4.06, 1.645, 1.50], [-1, 0, 0], [[0, 0], [0, 0.088], [0.045, 0.088], [0.056, 0.078], [0.056, 0.064]], 20, { smooth: 30 * DEG });
    g.mat(MAT.red); g.lathe([-4.114, 1.645, 1.50], [-1, 0, 0], [[0, 0.064], [0.007, 0.05], [0.011, 0]], 16, { smooth: 60 * DEG });
    g.mat(MAT.tanD);
    for (const z of [1.24, 1.66]) for (const y of [1.26, 1.46]) g.bolt([-4.058, y, z], [-1, 0, 0], 0.01, 0.006);
    g.pop();
  }

  // ---- engine deck -------------------------------------------------------------
  const DY = 1.78;
  for (const s of [1, -1]) {
    g.push(m4.S(1, 1, s));
    const x0 = -3.02, x1 = -2.40, z0 = 0.24, z1 = 1.50;
    g.mat(MAT.tan);
    g.bbox(x0 - 0.04, x1 + 0.04, DY - 0.01, DY + 0.034, z0 - 0.04, z0, 0.006); g.bbox(x0 - 0.04, x1 + 0.04, DY - 0.01, DY + 0.034, z1, z1 + 0.04, 0.006);
    g.bbox(x0 - 0.04, x0, DY - 0.01, DY + 0.034, z0, z1, 0.006); g.bbox(x1, x1 + 0.04, DY - 0.01, DY + 0.034, z0, z1, 0.006);
    g.bbox((x0 + x1) / 2 - 0.02, (x0 + x1) / 2 + 0.02, DY, DY + 0.034, z0, z1, 0.005);
    g.mat(MAT.dark); g.box(x0, x1, DY, DY + 0.004, z0, z1);
    g.mat(MAT.tanD);
    for (let i = 0; i < 14; i++) { g.push(m4.T(x0 + 0.025 + i * 0.044, DY + 0.017, 0), m4.RZ(-35 * DEG)); g.box(-0.02, 0.02, -0.003, 0.003, z0, z1); g.pop(); }
    // forward access door
    g.mat(MAT.tan2); g.bbox(-3.94, -3.12, DY, DY + 0.014, 0.21, 1.50, 0.007);
    g.mat(MAT.tanD);
    for (const bx of [-3.91, -3.53, -3.15]) for (const bz of [0.25, 0.65, 1.06, 1.46]) g.bolt([bx, DY + 0.014, bz], [0, 1, 0], 0.012, 0.008);
    g.tube(roundPath([[-3.56, DY + 0.01, 0.85], [-3.56, DY + 0.06, 0.85], [-3.38, DY + 0.06, 0.85], [-3.38, DY + 0.01, 0.85]], 0.02, 4), 0.008, 6);
    // lifting eye rear
    g.tube(arcPts([-3.96, DY, 1.58], [0, 0, 1], [0, 1, 0], 0.045, 0, Math.PI, 8), 0.013, 8);
    g.pop();
  }
  g.mat(MAT.tan2); g.bbox(-3.94, -2.40, DY, DY + 0.014, -0.17, 0.17, 0.007);
  g.mat(MAT.tanD);
  for (let i = 0; i < 8; i++) for (const bz of [-0.14, 0.14]) g.bolt([-3.88 + i * 0.2, DY + 0.014, bz], [0, 1, 0], 0.012, 0.008);
  g.tube(roundPath([[-3.3, DY + 0.01, 0], [-3.3, DY + 0.06, 0], [-3.1, DY + 0.06, 0], [-3.1, DY + 0.01, 0]], 0.02, 4), 0.008, 6);

  // ---- side skirts: 7 sections of unequal length (joints measured from the drawing) ------
  const SKX = [3.88, 1.82, 0.82, 0.31, -0.51, -1.25, -2.75, -4.04], SB = 0.74, ST = 1.42;
  for (const s of [1, -1]) {
    g.push(m4.S(1, 1, s));
    for (let k = 0; k < 7; k++) {
      const x1 = SKX[k] - (k ? 0.008 : 0), x0 = SKX[k + 1] + 0.008, thick = k < 3, zi = 1.757, zo = thick ? 1.835 : 1.812, xm = (x0 + x1) / 2, len = x1 - x0;
      let poly;
      if (k === 0) poly = [[x0, SB], [3.50, SB], [3.88, 1.17], [3.865, 1.235], [3.72, 1.332], [2.95, ST], [x0, ST]];
      else if (k === 6) poly = [[x1, 1.16], [x1, ST], [x0, ST], [x0, 1.16]];
      else poly = [[x0, SB], [x1, SB], [x1, ST], [x0, ST]];
      g.mat((k === 2 || k === 5) ? MAT.tan2 : MAT.tan);
      g.prism(poly, zi, zo, thick ? 0.016 : 0.010);
      if (k === 6) g.prism([[x1, SB], [x1, 1.17], [x1 - 0.29, 1.17], [x1 - 0.09, SB]], zi, zo, 0.010);   // arch over the drive sprocket
      g.mat(MAT.tanD);
      // hinge brackets on the hull side, strap + bolts on the plate
      const hxs = k === 0 ? [x0 + 0.22, 2.72] : len > 1.4 ? [x0 + 0.22, xm, x1 - 0.22] : len > 0.7 ? [x0 + 0.18, x1 - 0.18] : [x0 + 0.13, x1 - 0.13];
      for (const hx of hxs) {
        g.bbox(hx - 0.06, hx + 0.06, ST - 0.03, ST + 0.034, 1.71, 1.775, 0.006);
        g.cyl([hx - 0.07, ST + 0.014, 1.775], [hx + 0.07, ST + 0.014, 1.775], 0.015, 8, 0.003);
        g.bbox(hx - 0.036, hx + 0.036, ST - 0.115, ST + 0.004, 1.77, zo + 0.008, 0.004);
        for (const by of [0.045, 0.092]) for (const bx of [-0.017, 0.017]) g.bolt([hx + bx, ST - by, zo + 0.008], [0, 0, 1], 0.010, 0.006);
      }
      // retaining latch between neighbouring panels
      if (k > 0) {
        g.bbox(x1 - 0.04, x1 + 0.055, 0.93, 0.99, zo - 0.012, zo + 0.012, 0.005);
        g.bolt([x1 + 0.03, 0.96, zo + 0.012], [0, 0, 1], 0.011, 0.007);
      }
      // grab handle / step
      if (k > 0 && k < 6 && len > 0.7) g.tube(roundPath([[xm - 0.075, 0.84, zo - 0.004], [xm - 0.075, 0.84, zo + 0.038], [xm + 0.075, 0.84, zo + 0.038], [xm + 0.075, 0.84, zo - 0.004]], 0.016, 4), 0.008, 6);
      if (k === 0) { g.bbox(2.78, 2.94, 0.845, 0.86, zo - 0.004, zo + 0.06, 0.004); g.bbox(2.78, 2.94, 0.845, 0.93, zo - 0.004, zo + 0.008, 0.004); }
    }
    g.pop();
  }

  // ---- suspension ----------------------------------------------------------------
  g.mat(MAT.tanD);
  for (const s of [1, -1]) {
    g.push(m4.S(1, 1, s));
    for (const wx of TK.wheelX) {
      g.cyl([wx, TK.wheelY, 1.14], [wx, TK.wheelY, 1.40], 0.075, 14);
      g.prism([[wx - 0.07, TK.wheelY - 0.09], [wx + 0.07, TK.wheelY - 0.06], [wx - 0.36, 0.70], [wx - 0.46, 0.60]], 1.06, 1.17, 0.012);
      g.cyl([wx - 0.41, 0.65, 1.04], [wx - 0.41, 0.65, 1.19], 0.10, 14, 0.01);
    }
    g.cyl([TK.sprocket.x, TK.sprocket.y, 1.04], [TK.sprocket.x, TK.sprocket.y, 1.14], 0.27, 24, 0.02);
    g.cyl([TK.idler.x, TK.idler.y, 1.04], [TK.idler.x, TK.idler.y, 1.40], 0.08, 14);
    g.prism([[TK.idler.x - 0.5, 0.60], [TK.idler.x - 0.5, 0.84], [TK.idler.x + 0.08, TK.idler.y + 0.09], [TK.idler.x + 0.08, TK.idler.y - 0.09]], 1.05, 1.15, 0.012);
    for (const r of TK.rollers) { g.cyl([r.x, r.y, 1.04], [r.x, r.y, 1.40], 0.035, 10); g.bbox(r.x - 0.07, r.x + 0.07, r.y - 0.07, r.y + 0.12, 1.05, 1.12, 0.01); }
    g.pop();
  }
}
