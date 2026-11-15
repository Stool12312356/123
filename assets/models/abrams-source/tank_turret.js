// ============================================================================
//  M1A1 Abrams (M1A2 roof kit optional) – turret, roof equipment, gun
//  Turret space: origin at ring centre / turret base, +X toward the gun.
// ============================================================================
// Dimensions taken from the general-arrangement drawing (side/top/front views) and the armour scheme:
// turret 3.30 m wide at the base, 2.54 m at the roof (side plates lean 25 deg), 0.9 m high, nose 1.92 m ahead of the ring centre.
const RH = 0.93, RA = 6 * DEG, TB = 0.11, WL = 0.20, SLEAN = 25 * DEG, NY = 0.43;
// RX0: the roof ahead of this line is one plate falling forward by RA.  CUTH/CUTX: height and foot of the cut-off lower inner
// corner of a cheek.  BX0/BK: ahead of BX0 the base rises toward the nose.  MPROUD/KINM: gun shield frames.
const RX0 = 0.15, CUTH = 0.30, CUTX = 1.89, MPROUD = 0.14, KINM = 0.60, BX0 = 1.30, BK = 0.0;   // BK = 0: level base, as on the user's reference
// Per-side cheek plan AT THE BASE (turret is asymmetric): tx,tz = foot of the cheek at the gun shield, o = cheek/side corner,
// kin = how far the inner edge leans back per metre of height in profile, cw = width of the cut corner along the base.
// Plan angles and leans were checked against two reference meshes and the general-arrangement drawing.
const CH = { 1: { tx: 2.03, tz: 0.39, o: [1.395, 1.66], kin: 0.60, cw: 0.50 }, [-1]: { tx: 2.10, tz: 0.27, o: [1.06, 1.58], kin: 0.76, cw: 0.44 } };
const INZ = s => CH[s].tz;                       // the gun shield is wider on the coax (right) side
const baseY = x => TB + Math.max(0, BK * (x - BX0));
// wall plane through plan-line (x1,z1)->(x2,z2) [right side coords], mirrored for s=-1
function wp(s, x1, z1, x2, z2, lean, yref, bev) {
  const dx = x2 - x1, dz = z2 - z1; let nx = dz, nz = -dx; const l = Math.hypot(nx, nz); nx /= l; nz /= l;
  const c = Math.cos(lean), sn = Math.sin(lean), q = [nx * c, sn, s * nz * c, x1, yref, s * z1];
  if (bev !== undefined) q.push(bev); return q;
}
const TP = { tipx: CH[1].tx, oR: CH[1].o, oL: CH[-1].o, o: CH[1].o, w: [0.0, 1.68], r: [-2.68, 1.57] };
function cheekGeo(s) {
  const q = CH[s], o = q.o, tx = q.tx, tz = q.tz, dx = o[0] - tx, dz = o[1] - tz, l = Math.hypot(dx, dz), nx = dz / l, nz = -dx / l;
  return { o, tx, tz, dx, dz, l, nx, nz, kin: q.kin, cw: q.cw, tl: q.kin * nx, lean: Math.atan(q.kin * nx) };
}
const roofPlane = () => [Math.sin(RA), Math.cos(RA), 0, RX0, RH, 0];
const roofAt = (x, z) => Math.min(RH, RH - Math.tan(RA) * (x - RX0));
// height at which the gun shield frames meet the roof plate
const HT = (RH - Math.tan(RA) * (TP.tipx + MPROUD + KINM * TB - RX0)) / (1 - Math.tan(RA) * KINM);
function turretPlanes(s) {
  // Each cheek is ONE flat plate that leans back from its foot.  The lower inner corner is cut away: P1 on the base edge,
  // P2 up the inner edge, P3 on the base under P2.
  const c = cheekGeo(s);
  const P2 = [c.tx - CUTH * c.kin, TB + CUTH, c.tz], P1x = c.tx + c.dx / c.l * c.cw, P1 = [P1x, baseY(P1x), c.tz + c.dz / c.l * c.cw], P3 = [Math.min(P2[0], CUTX) - 0.10, baseY(CUTX), c.tz];   // foot set back: the facet is under-cut and reads darker than the cheek
  let n = v3.norm(v3.cross(v3.sub(P1, P2), v3.sub(P3, P2)));
  if (v3.dot(n, v3.sub([c.tx - 0.8, 0.5, c.tz + 0.3], P2)) > 0) n = [-n[0], -n[1], -n[2]];
  return {
    ck: wp(s, c.tx, c.tz, c.o[0], c.o[1], c.lean, TB),
    cut: [n[0], n[1], s * n[2], P2[0], P2[1], s * P2[2]],
    sf: wp(s, c.o[0], c.o[1], TP.w[0], TP.w[1], SLEAN, TB),
    sr: wp(s, TP.w[0], TP.w[1], TP.r[0], TP.r[1], SLEAN, TB),
  };
}
function buildTurret(g, VARIANT = 'M1A1') {
  const ROOF = [0, 1, 0, 0, RH, 0], RFR = roofPlane(), bn = v3.norm([BK, -1, 0]), RFL = [bn[0], bn[1], 0, BX0, TB, 0], BOT = [0, -1, 0, 0, TB, 0];   // RFL slot now carries the rising front base
  const UND = [-0.213, -1, 0, -1.80, TB, 0];               // flat base; the bustle underside then rises parallel to the engine-deck ramp, 5 cm clear of it
  // bustle rear is a wedge in profile: upper plate falls back from the roof edge, lower plate rises to meet it
  const REAR = [-1, 0, 0, TP.r[0] + 0.012, 0, 0], REARC = [-0.762, 0.647, 0, TP.r[0], 0.60, 0], REARL = [-0.695, -0.719, 0, TP.r[0], 0.60, 0];
  const R = turretPlanes(1), L = turretPlanes(-1), O = [0, 0, 0], Y = [0, 1, 0], X = [1, 0, 0];
  const BV = 0.018, CF = 1.45;
  g.mat(MAT.tan);
  // core + bustle (one convex shell)
  g.cv([ROOF, RFR, RFL, BOT, UND, REAR, REARC, REARL, [1, 0, 0, CF, 0, 0], R.ck, R.sf, R.sr, L.ck, L.sf, L.sr], BV);
  // cheeks
  g.cv([ROOF, RFR, RFL, BOT, R.ck, R.cut, R.sf, [0, 0, -1, 0, 0, INZ(1), 0.008], [-1, 0, 0, 0.9, 0, 0, 0]], BV);
  g.cv([ROOF, RFR, RFL, BOT, L.ck, L.cut, L.sf, [0, 0, 1, 0, 0, -INZ(-1), 0.008], [-1, 0, 0, 0.9, 0, 0, 0]], BV);
  // turret base collar down to the race ring
  g.mat(MAT.tanD);
  {
    // under-surface: flat ramps falling from just inside every base edge down to the race ring on the hull roof.
    // Two convex bodies: behind BX0 (level base) and ahead of it (base rising toward the nose).
    const E = 0.012, IN = [0.3, TB - 0.05, 0];
    const pl3 = (a, b, c) => { let n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(c, a))); if (v3.dot(n, v3.sub(IN, a)) > 0) n = [-n[0], -n[1], -n[2]]; return [n[0], n[1], n[2], a[0], a[1], a[2]]; };
    const ramp = (pl, nx, nz, px, pz, k, inset) => { const n = v3.norm([nx * k, -1, nz * k]); pl.push([n[0], n[1], n[2], px - nx * inset, TB + E, pz - nz * inset]); };
    const A = [[0, 1, 0, 0, TB + E, 0], [0, -1, 0, 0, -0.02, 0], [1, 0, 0, BX0 + 0.02, 0, 0]], tn = v3.norm([-BK, 1, 0]);
    const B = [[tn[0], tn[1], 0, BX0, TB + E, 0], [0, -1, 0, 0, -0.02, 0], [-1, 0, 0, BX0 - 0.02, 0, 0]];
    ramp(A, -1, 0, -1.78, 0, 0.34, 0);
    { const fr = pl3([1.80, baseY(1.80) + E, -0.3], [1.80, baseY(1.80) + E, 0.3], [1.40, -0.02, 0]); A.push(fr); B.push(fr); }
    for (const s of [1, -1]) {
      const c = cheekGeo(s), P = turretPlanes(s); ramp(A, c.nx, s * c.nz, c.tx, s * c.tz, 0.26, 0.05);
      for (const q of [P.sf, P.sr]) { const l = Math.hypot(q[0], q[2]); ramp(A, q[0] / l, q[2] / l, q[3], q[5], 0.55, 0.04); }
      { const q = P.sf, l = Math.hypot(q[0], q[2]); ramp(B, q[0] / l, q[2] / l, q[3], q[5], 0.55, 0.05); }
      const xa = Math.max(c.o[0], BX0), t = (xa - c.tx) / c.dx, za = c.tz + c.dz * t;
      const a = [xa - c.nx * 0.05, baseY(xa) + E, s * (za - c.nz * 0.05)], b = [c.tx - c.nx * 0.05, baseY(c.tx) + E, s * (c.tz - c.nz * 0.05)];
      B.push(pl3(a, b, [(a[0] + b[0]) / 2 - c.nx * 0.50, -0.02, (a[2] + b[2]) / 2 - s * c.nz * 0.50]));
    }
    g.cv(A, 0.006); g.cv(B, 0.006);
  }

  // ---- roof plates / weld beads ---------------------------------------------
  g.mat(MAT.tan2);
  for (const s of [1, -1]) {   // blow-off panels over the ammunition bustle
    g.bbox(-2.34, -1.32, RH - 0.01, RH + 0.024, s * 0.05, s * 0.80, 0.009);
    g.mat(MAT.tanD);
    for (let i = 0; i < 6; i++) for (const bz of [0.085, 0.765]) g.bolt([-2.30 + i * 0.188, RH + 0.024, s * bz], Y, 0.013, 0.008);
    for (let i = 1; i < 5; i++) for (const bx of [-2.30, -1.36]) g.bolt([bx, RH + 0.024, s * (0.085 + i * 0.136)], Y, 0.013, 0.008);
    g.mat(MAT.tan2);
  }
  g.mat(MAT.tan);
  // weld beads: across the roof where the front plate starts to fall, and along the edges of the gun shield bay
  for (const s of [1, -1]) { const z = s * INZ(s); g.tube([[RX0, RH + 0.001, z], [1.58, roofAt(1.58, z) + 0.001, z]], 0.008, 6); }
  g.tube([[RX0, RH + 0.001, -1.19], [RX0, RH + 0.001, 1.19]], 0.008, 6);
  g.bbox(-1.26, -1.236, RH - 0.004, RH + 0.005, -1.17, 1.17, 0.004);
  g.mat(MAT.tanD);
  for (const s of [1, -1]) for (let i = 0; i < 6; i++) {
    const bx = 0.62 + i * 0.19; g.bolt([bx, roofAt(bx, s * 0.49), s * 0.49], Y, 0.011, 0.007);
    g.bolt([-1.20 + i * 0.19, RH, s * 1.13], Y, 0.011, 0.007);
  }
  g.mat(MAT.tan);
  // ventilator dome
  g.lathe([-1.40, RH, 0.92], Y, [[0, 0.10], [0.02, 0.10], [0.045, 0.085], [0.055, 0.05], [0.055, 0]], 20);
  // lifting eyes
  g.mat(MAT.tanD);
  for (const s of [1, -1]) {
    g.push(m4.T(1.05, roofAt(1.05, s * 0.86) - 0.004, s * 0.86), m4.RZ(-RA)); g.tube(arcPts(O, [0, 0, 1], Y, 0.05, 0, Math.PI, 8), 0.014, 8); g.pop();
    g.tube(arcPts([-2.20, RH, s * 1.04], [1, 0, 0], Y, 0.05, 0, Math.PI, 8), 0.014, 8);
  }

  // ---- commander's weapon station: ring, 8 periscopes, hatch ------------------
  const NP = VARIANT === 'M1A2' ? 8 : 6;
  g.push(m4.T(-0.74, RH, 0.55));
  g.mat(MAT.tan);
  g.lathe(O, Y, [[-0.01, 0.53], [0.04, 0.53], [0.062, 0.505], [0.062, 0.30]], 56);
  for (let i = 0; i < NP; i++) {
    g.push(m4.RY((i + 0.5) * (360 / NP) * DEG));
    g.mat(MAT.tan);
    g.cv([[1, 0, 0, 0.492, 0, 0], [0.55, 1, 0, 0.492, 0.150, 0], [0, 1, 0, 0, 0.192, 0], [0, -1, 0, 0, 0.05, 0, 0], [-1, 0, 0, 0.325, 0, 0, 0],
      [-Math.sin(19 * DEG), 0, Math.cos(19 * DEG), 0.492, 0, 0.150], [-Math.sin(19 * DEG), 0, -Math.cos(19 * DEG), 0.492, 0, -0.150]], 0.008);
    g.mat(MAT.glass); g.box(0.490, 0.496, 0.078, 0.138, -0.118, 0.118);
    g.mat(MAT.tanD); g.bolt([0.40, 0.192, 0.07], Y, 0.009, 0.006); g.bolt([0.40, 0.192, -0.07], Y, 0.009, 0.006);
    g.pop();
  }
  g.mat(MAT.tan);
  g.lathe(O, Y, [[0.06, 0.335], [0.165, 0.335], [0.18, 0.32], [0.18, 0.285]], 40);
  g.mat(MAT.tan2);
  g.lathe(O, Y, [[0.17, 0.285], [0.196, 0.285], [0.208, 0.27], [0.208, 0]], 40);
  g.mat(MAT.tanD);
  g.bbox(-0.36, -0.26, 0.18, 0.225, -0.10, -0.06, 0.006); g.bbox(-0.36, -0.26, 0.18, 0.225, 0.06, 0.10, 0.006);
  g.cyl([-0.33, 0.215, -0.12], [-0.33, 0.215, 0.12], 0.018, 8, 0.003);
  g.tube(roundPath([[0.06, 0.205, -0.07], [0.06, 0.25, -0.07], [0.06, 0.25, 0.07], [0.06, 0.205, 0.07]], 0.02, 4), 0.008, 6);
  for (let i = 0; i < 6; i++) { const a = i / 6 * 2 * Math.PI + 0.5; g.bolt([Math.cos(a) * 0.20, 0.208, Math.sin(a) * 0.20], Y, 0.011, 0.007); }
  // .50 cal M2HB on forward pedestal
  g.mat(MAT.tan);
  g.cv([[1, 0, 0, 0.66, 0, 0], [-1, 0, 0, 0.53, 0, 0], [0, 1, 0, 0, 0.30, 0], [0, -1, 0, 0, -0.02, 0, 0], [0, 0, 1, 0, 0, 0.06], [0, 0, -1, 0, 0, -0.06], [1, 0.8, 0, 0.66, 0.2, 0]], 0.01);
  g.cyl([0.60, 0.29, 0], [0.60, 0.37, 0], 0.035, 12, 0.005);
  g.push(m4.T(0.60, 0.43, 0), m4.RZ(3 * DEG));
  g.mat(MAT.tanD);
  g.bbox(-0.20, 0.16, -0.085, -0.04, -0.05, 0.05, 0.008);                        // cradle
  g.bbox(-0.06, 0.06, -0.085, 0.02, -0.062, -0.045, 0.004); g.bbox(-0.06, 0.06, -0.085, 0.02, 0.045, 0.062, 0.004);
  g.mat(MAT.gun);
  g.bbox(-0.36, 0.13, -0.04, 0.072, -0.034, 0.034, 0.006);                       // receiver
  g.bbox(-0.22, 0.11, 0.070, 0.092, -0.030, 0.030, 0.005);                       // top cover
  g.bbox(-0.385, -0.355, -0.03, 0.06, -0.03, 0.03, 0.004);                       // back plate
  g.bbox(0.02, 0.07, 0.092, 0.115, -0.006, 0.006, 0.002);                        // rear sight
  for (const z of [-0.036, 0.036]) g.tube(roundPath([[-0.38, 0.05, z], [-0.47, 0.05, z], [-0.47, -0.02, z], [-0.38, -0.02, z]], 0.015, 4), 0.009, 6);
  g.bbox(-0.44, -0.385, 0.006, 0.026, -0.022, 0.022, 0.003);                     // butterfly trigger
  g.lathe([0.13, 0.016, 0], X, [[0, 0.034], [0.01, 0.036], [0.27, 0.036], [0.285, 0.028], [0.285, 0.0215]], 16);   // barrel support
  g.lathe([0.13, 0.016, 0], X, [[0.285, 0.0215], [0.99, 0.0175], [0.99, 0.021], [1.05, 0.021], [1.05, 0.0075], [0.9, 0.0075]], 14, { smooth: 20 * DEG });
  g.bbox(0.16, 0.20, 0.05, 0.085, -0.004, 0.004, 0.002);                          // carry handle stub
  g.cyl([-0.05, 0.03, 0.034], [-0.05, 0.03, 0.075], 0.008, 6); g.sphere([-0.05, 0.03, 0.08], 0.014, 8);   // charging handle
  g.mat(MAT.tanD);
  g.bbox(-0.13, 0.13, -0.15, 0.055, -0.20, -0.07, 0.008);                          // ammunition can
  g.bbox(-0.12, 0.12, 0.055, 0.066, -0.195, -0.075, 0.004);
  g.bbox(-0.05, 0.05, 0.02, 0.05, -0.075, -0.034, 0.004);                          // feed chute
  g.pop();
  g.pop();

  // ---- loader's hatch, skate ring, M240 ---------------------------------------
  g.push(m4.T(-0.72, RH, -0.58));
  g.mat(MAT.tan);
  g.lathe(O, Y, [[-0.01, 0.42], [0.032, 0.42], [0.05, 0.40], [0.05, 0.345]], 44);
  g.mat(MAT.tan2);
  g.lathe(O, Y, [[0.04, 0.345], [0.07, 0.345], [0.086, 0.33], [0.086, 0]], 40);
  g.mat(MAT.tan);
  g.push(m4.T(0.17, 0.086, -0.02), m4.RY(25 * DEG));                           // hatch periscope
  g.cv([[1, 0.4, 0, 0.05, 0, 0], [-1, 0.25, 0, -0.05, 0, 0], [0, 1, 0, 0, 0.07, 0], [0, -1, 0, 0, -0.01, 0, 0], [0, 0, 1, 0, 0, 0.10], [0, 0, -1, 0, 0, -0.10]], 0.006);
  g.mat(MAT.glass); g.push(m4.T(0.039, 0.03, 0), m4.RZ(-21.8 * DEG)); g.box(-0.004, 0.006, -0.02, 0.02, -0.08, 0.08); g.pop();
  g.pop();
  g.mat(MAT.tanD);
  g.bbox(-0.40, -0.30, 0.05, 0.11, -0.10, -0.06, 0.006); g.bbox(-0.40, -0.30, 0.05, 0.11, 0.06, 0.10, 0.006);
  g.cyl([-0.36, 0.10, -0.12], [-0.36, 0.10, 0.12], 0.018, 8, 0.003);
  g.tube(roundPath([[-0.08, 0.084, -0.07], [-0.08, 0.13, -0.07], [-0.08, 0.13, 0.07], [-0.08, 0.084, 0.07]], 0.02, 4), 0.008, 6);
  // skate rail
  const railPts = arcPts([0, 0.16, 0], [1, 0, 0], [0, 0, -1], 0.50, -35 * DEG, 205 * DEG, 40);
  g.mat(MAT.tanD); g.tube(railPts, 0.016, 8);
  for (const a of [-35, 10, 60, 110, 160, 205]) { const c = Math.cos(a * DEG) * 0.50, sn = -Math.sin(a * DEG) * 0.50; g.cyl([c, -0.01, sn], [c, 0.16, sn], 0.014, 8); g.lathe([c, 0, sn], Y, [[0, 0.035], [0.012, 0.035], [0.012, 0]], 8); }
  {
    const a = 58 * DEG, px = Math.cos(a) * 0.50, pz = -Math.sin(a) * 0.50;
    g.mat(MAT.tanD); g.bbox(px - 0.04, px + 0.04, 0.13, 0.19, pz - 0.04, pz + 0.04, 0.008); g.cyl([px, 0.19, pz], [px, 0.30, pz], 0.022, 10, 0.004);
    g.push(m4.T(px, 0.345, pz), m4.RY(16 * DEG), m4.RZ(2 * DEG));
    g.bbox(-0.10, 0.10, -0.06, -0.035, -0.035, 0.035, 0.006);
    g.mat(MAT.gun);
    g.bbox(-0.24, 0.20, -0.035, 0.05, -0.026, 0.026, 0.006);
    g.bbox(-0.16, 0.14, 0.048, 0.064, -0.022, 0.022, 0.004);
    g.lathe([0.20, 0.018, 0], X, [[0, 0.02], [0.03, 0.02], [0.05, 0.015], [0.50, 0.012], [0.50, 0.016], [0.58, 0.014], [0.58, 0.006], [0.5, 0.006]], 12, { smooth: 25 * DEG });
    g.cyl([0.20, -0.012, 0], [0.50, -0.012, 0], 0.009, 8);
    g.bbox(0.46, 0.49, 0.03, 0.065, -0.004, 0.004, 0.002);
    g.bbox(0.22, 0.42, 0.028, 0.04, -0.018, 0.018, 0.004);
    g.mat(MAT.rubber);
    g.prism([[-0.24, 0.045], [-0.50, 0.035], [-0.52, -0.055], [-0.46, -0.06], [-0.24, -0.03]], -0.02, 0.02, 0.006);
    g.prism([[-0.12, -0.035], [-0.07, -0.035], [-0.11, -0.13], [-0.16, -0.12]], -0.016, 0.016, 0.005);
    g.mat(MAT.tanD);
    g.bbox(-0.06, 0.11, -0.15, -0.02, -0.12, -0.03, 0.007);
    g.pop();
  }
  g.pop();

  // ---- gunner's primary sight housing (doghouse) --------------------------------
  g.push(m4.T(0.42, roofAt(0.42, 0.86), 0.86));
  g.mat(MAT.tan);
  g.cv([[0, 1, 0, 0, 0.285, 0], [0, -1, 0, 0, -0.07, 0, 0], [Math.cos(10 * DEG), Math.sin(10 * DEG), 0, 0.265, 0, 0], [0.7, 1, 0, 0.23, 0.245, 0],
    [-Math.cos(38 * DEG), Math.sin(38 * DEG), 0, -0.30, 0, 0], [0, 0.10, 1, 0, 0, 0.245], [0, 0.10, -1, 0, 0, -0.245]], 0.014);
  g.push(m4.T(0.245, 0.115, 0), m4.RZ(10 * DEG));
  g.mat(MAT.tan2); g.bbox(-0.02, 0.022, -0.085, 0.085, -0.19, 0.19, 0.007);
  g.mat(MAT.glass); g.box(0.022, 0.025, -0.06, 0.06, -0.165, 0.165);
  g.mat(MAT.tan2); g.box(0.022, 0.027, -0.06, 0.06, -0.006, 0.006);
  for (const s of [1, -1]) {  // armoured doors, open
    g.push(m4.T(0.01, 0, s * 0.20), m4.RY(-s * 18 * DEG)); g.mat(MAT.tan); g.bbox(0.0, 0.19, -0.085, 0.085, -0.012, 0.012, 0.006);
    g.mat(MAT.tanD); g.cyl([0.0, -0.08, 0], [0.0, 0.08, 0], 0.014, 8, 0.003); g.pop();
  }
  g.pop();
  g.mat(MAT.tanD);
  for (const bx of [-0.2, -0.02, 0.16]) for (const bz of [-0.19, 0.19]) g.bolt([bx, 0.285, bz], Y, 0.011, 0.007);
  g.pop();

  // ---- CITV (commander's independent thermal viewer) ---------------------------
  if (VARIANT === 'M1A2') {
  g.push(m4.T(0.50, roofAt(0.50, -0.80), -0.80));
  g.mat(MAT.tan);
  g.lathe(O, Y, [[-0.06, 0.275], [0.03, 0.275], [0.05, 0.255], [0.05, 0.205]], 36);
  g.lathe(O, Y, [[0.05, 0.205], [0.37, 0.205], [0.405, 0.185], [0.425, 0.14], [0.425, 0]], 36, { smooth: 35 * DEG });
  g.mat(MAT.tanD);
  for (let i = 0; i < 10; i++) { const a = i / 10 * 2 * Math.PI; g.bolt([Math.cos(a) * 0.24, 0.05, Math.sin(a) * 0.24], Y, 0.011, 0.007); }
  g.mat(MAT.tan2);
  g.cv([[1, 0, 0, 0.235, 0, 0], [-1, 0, 0, 0.10, 0, 0, 0], [0, 1, 0, 0, 0.375, 0], [0, -1, 0, 0, 0.15, 0], [0, 0, 1, 0, 0, 0.125], [0, 0, -1, 0, 0, -0.125], [1, 0, 1, 0.235, 0, 0.09], [1, 0, -1, 0.235, 0, -0.09]], 0.008);
  g.mat(MAT.glass); g.box(0.235, 0.239, 0.185, 0.345, -0.075, 0.075);
  g.mat(MAT.tan2);
  for (const s of [1, -1]) g.lathe([0, 0.26, s * 0.19], [0, 0, s], [[0, 0.075], [0.03, 0.075], [0.04, 0.06], [0.04, 0]], 16);
  g.mat(MAT.tanD); g.tube(arcPts([0, 0.425, 0], [1, 0, 0], Y, 0.035, 0, Math.PI, 6), 0.009, 6);
  g.pop();
  }

  // ---- crosswind sensor, antennas ------------------------------------------------
  g.mat(MAT.tanD);
  g.lathe([-2.30, RH, 0], Y, [[-0.01, 0.045], [0.06, 0.045], [0.08, 0.02], [0.42, 0.014], [0.42, 0.034], [0.56, 0.034], [0.57, 0.02], [0.57, 0]], 12, { smooth: 20 * DEG });
  for (const s of [1, -1]) {
    g.mat(MAT.tanD);
    g.lathe([-2.30, RH, s * 1.02], Y, [[-0.01, 0.05], [0.05, 0.05], [0.07, 0.035], [0.07, 0.028]], 12);
    g.mat(MAT.rubber);
    g.lathe([-2.30, RH, s * 1.02], Y, [[0.07, 0.028], [0.20, 0.024], [0.22, 0.012], [0.22, 0.008]], 10);
    g.mat(MAT.gun);
    g.tube([[-2.30, RH + 0.22, s * 1.02], [-2.36, RH + 1.0, s * 1.02], [-2.48, RH + 1.9, s * 1.02]], 0.006, 6);
  }

  // ---- smoke grenade launchers (M250, 6 tubes) at cheek/side junction -------------
  for (const s of [1, -1]) {
    const oc = s > 0 ? TP.oR : TP.oL, fa = Math.atan2(oc[1] - TP.w[1], oc[0] - TP.w[0]), back = Math.hypot(oc[0] - 0.18, oc[1] - TP.w[1]);
    g.push(m4.S(1, 1, s), m4.T(oc[0], 0, oc[1]), m4.RY(-fa), m4.T(0, TB, 0), m4.RX(-SLEAN), m4.T(-back + 0.36, 0.02, 0));
    g.mat(MAT.tan);
    g.bbox(-0.36, -0.05, 0.36, 0.69, -0.02, 0.045, 0.01);
    g.bbox(-0.34, -0.07, 0.40, 0.65, 0.04, 0.075, 0.008);
    g.mat(MAT.tanD);
    for (const bx of [-0.335, -0.075]) for (const by of [0.385, 0.665]) g.bolt([bx, by, 0.045], [0, 0, 1], 0.012, 0.008);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
      const yaw = (28 + col * 21) * DEG, el = (20 + row * 6) * DEG;
      const d = [Math.cos(yaw) * Math.cos(el), Math.sin(el), Math.sin(yaw) * Math.cos(el)];
      const base = [-0.115 - col * 0.092, 0.455 + row * 0.125, 0.06];
      g.mat(MAT.tan);
      g.lathe(base, d, [[-0.02, 0.0], [-0.02, 0.054], [0.012, 0.054], [0.02, 0.046], [0.205, 0.046], [0.205, 0.051], [0.232, 0.051], [0.236, 0.047], [0.236, 0.040]], 16, { smooth: 30 * DEG });
      g.mat(MAT.rubber);
      g.lathe(base, d, [[0.236, 0.040], [0.228, 0.036], [0.228, 0]], 16);
    }
    g.pop();
  }

  // ---- side stowage boxes (wedge lockers between the leaning side plate and the widest line) ----
  const ra = Math.atan2(TP.w[1] - TP.r[1], TP.w[0] - TP.r[0]);     // rear side-wall heading
  for (const s of [1, -1]) {
    g.push(m4.S(1, 1, s), m4.T(TP.w[0], 0, TP.w[1]), m4.RY(-ra));
    g.mat(MAT.tan);
    g.cv([[0, 1, 0, 0, 0.80, 0], [0, -1, 0, 0, 0.30, 0], [1, 0, 0, -0.14, 0, 0], [-1, 0, 0, -1.74, 0, 0], [0, 0, 1, 0, 0, 0.005], [0, 0, -1, 0, 0, -0.46, 0], [0, 1, 1.6, 0, 0.80, -0.03]], 0.012);
    g.mat(MAT.tan2);
    g.bbox(-1.75, -0.13, 0.685, 0.71, -0.02, 0.013, 0.004);
    g.bbox(-0.955, -0.925, 0.30, 0.80, -0.02, 0.011, 0.004);
    g.mat(MAT.tanD);
    for (const lx of [-1.52, -1.16, -0.72, -0.36]) { g.bbox(lx - 0.03, lx + 0.03, 0.64, 0.74, -0.005, 0.022, 0.004); g.cyl([lx - 0.04, 0.80, -0.05], [lx + 0.04, 0.80, -0.05], 0.012, 6); }
    g.pop();
  }

  // ---- 3-tier bustle / side basket ---------------------------------------------------
  const nF = v3.norm([TP.w[1] - TP.o[1], 0, -(TP.w[0] - TP.o[0])]);  // outward normal front wall (right)
  const nR = v3.norm([TP.r[1] - TP.w[1], 0, -(TP.r[0] - TP.w[0])]);
  const OFS = 0.075;
  const A = [0.10, 0, TP.o[1] + (TP.o[0] - 0.10) / (TP.o[0] - TP.w[0]) * (TP.w[1] - TP.o[1])];
  const B = v3.mad(A, nF, OFS);
  const kc = OFS / (1 + v3.dot(nF, nR));
  const C = [TP.w[0] + (nF[0] + nR[0]) * kc, 0, TP.w[1] + (nF[2] + nR[2]) * kc];
  const D = [TP.r[0] + nR[0] * OFS, 0, TP.r[1] + nR[2] * OFS];
  const dR = v3.norm(v3.sub(D, C));
  const E = v3.mad(D, dR, (-3.22 - D[0]) / dR[0]);
  const mir = p => [p[0], p[1], -p[2]], atY = (p, y) => [p[0], y, p[2]];
  const loop = [A, B, C, D, E, mir(E), mir(D), mir(C), mir(B), mir(A)];
  const FY = 0.40, TY = 0.80, tiers = [FY, 0.60, TY];
  g.mat(MAT.tan);
  for (const y of tiers) g.tube(roundPath(loop.map(p => atY(p, y)), 0.09, 5), 0.0145, 8);
  // posts
  const posts = [B, v3.lerp(B, C, 0.5), C];
  for (let i = 1; i <= 4; i++) posts.push(v3.lerp(C, D, i / 5));
  posts.push(D, v3.lerp(D, E, 0.92));
  const allPosts = posts.concat(posts.map(mir));
  for (let i = 0; i <= 5; i++) allPosts.push([E[0], 0, E[2] * (1 - 2 * (i + 0.5) / 6)]);
  for (const p of allPosts) g.tube([atY(p, FY), atY(p, TY)], 0.012, 6);
  // struts to the armour + mesh floor
  for (const s of [1, -1]) {
    g.push(m4.S(1, 1, s));
    g.mat(MAT.tan);
    for (const p of posts.slice(0, 8)) { const n = p[0] > TP.w[0] ? nF : nR; g.tube([atY(p, FY), atY(v3.mad(p, n, -OFS - 0.12), FY)], 0.011, 6); g.tube([atY(p, TY), atY(v3.mad(p, n, -OFS - 0.31), TY)], 0.011, 6); }
    g.mat(MAT.mesh);
    g.prism([[A[0], A[2]], [B[0], B[2]], [C[0], C[2]], [TP.w[0], TP.w[1] - 0.02]], FY - 0.018, FY - 0.006, 0, 'xz');
    g.prism([[TP.w[0], TP.w[1] - 0.02], [C[0], C[2]], [D[0], D[2]], [TP.r[0], TP.r[1] - 0.02]], FY - 0.018, FY - 0.006, 0, 'xz');
    g.pop();
  }
  g.mat(MAT.mesh);
  g.prism([[TP.r[0] + 0.02, TP.r[1]], [D[0], D[2]], [E[0], E[2]], [E[0], -E[2]], [D[0], -D[2]], [TP.r[0] + 0.02, -TP.r[1]]], FY - 0.018, FY - 0.006, 0, 'xz');
  // rack floor bearers
  g.mat(MAT.tan);
  for (const z of [-0.9, -0.3, 0.3, 0.9]) g.tube([[-2.52, FY - 0.025, z], [E[0], FY - 0.025, z]], 0.012, 6);
  for (const z of [-1.1, 0, 1.1]) g.tube([[-2.62, 0.52, z], [E[0] + 0.02, FY - 0.03, z]], 0.011, 6);

  // ---- stowage in the bustle rack ----------------------------------------------------
  g.push(m4.T(0, FY - 0.245, 0));
  const ex = E[0];
  g.mat(MAT.wood); g.bbox(ex + 0.04, -2.76, 0.245, 0.50, -1.22, -0.66, 0.008);
  g.mat(MAT.tanD); g.bbox(ex + 0.035, -2.755, 0.33, 0.35, -1.225, -0.655, 0.003); g.bbox(ex + 0.035, -2.755, 0.43, 0.45, -1.225, -0.655, 0.003);
  g.mat(MAT.canvas);
  g.lathe([ex + 0.24, 0.41, -0.56], [0, 0, 1], [[0, 0], [0, 0.12], [0.03, 0.155], [0.2, 0.162], [0.45, 0.156], [0.7, 0.163], [0.86, 0.155], [0.89, 0.12], [0.89, 0]], 18, { smooth: 60 * DEG });
  g.mat(MAT.rubber);
  for (const z of [-0.38, 0.14]) g.lathe([ex + 0.24, 0.41, z], [0, 0, 1], [[0, 0.164], [0.035, 0.164]], 18);
  g.mat(MAT.tan2);
  g.bbox(ex + 0.05, -2.78, 0.245, 0.56, 0.42, 0.92, 0.01);
  g.mat(MAT.tanD); g.bbox(ex + 0.045, -2.775, 0.50, 0.515, 0.415, 0.925, 0.003);
  for (const z0 of [0.98, 1.17]) {  // fuel/water cans
    g.mat(MAT.tanD); g.bbox(ex + 0.05, ex + 0.39, 0.245, 0.68, z0, z0 + 0.165, 0.02);
    g.mat(MAT.tan2); g.cyl([ex + 0.12, 0.68, z0 + 0.08], [ex + 0.12, 0.715, z0 + 0.08], 0.03, 10, 0.004);
    g.tube([[ex + 0.20, 0.68, z0 + 0.08], [ex + 0.22, 0.72, z0 + 0.08], [ex + 0.32, 0.72, z0 + 0.08], [ex + 0.34, 0.68, z0 + 0.08]], 0.01, 6);
  }
  g.mat(MAT.canvas);  // duffel on top of the crate
  g.lathe([ex + 0.22, 0.61, -1.18], [0, 0, 1], [[0, 0], [0, 0.07], [0.03, 0.105], [0.25, 0.112], [0.47, 0.105], [0.50, 0.07], [0.50, 0]], 14, { smooth: 60 * DEG });
  g.pop();
}

// ============================================================================
//  Gun group (pivot = trunnion). +X toward muzzle.
// ============================================================================
function buildGun(g) {
  const O = [0, 0, 0], X = [1, 0, 0], TY = TK.trunY, TX = TK.trunX;
  // Gun shield: full-height block between the cheeks.  Its two side frames stand 14 cm proud of the cheek faces and
  // follow their lean down to a nose on the gun axis, then cut back to the base ("<" in profile); the plate between
  // the frames is recessed.  Wider on the coax (right) side.
  const fx = y => TP.tipx - KINM * (y + TY - TB) + MPROUD - TX;
  const yTop = HT - TY, xTop = fx(yTop), xN = fx(0), yB = TB + 0.04 - TY, xB = CUTX - TX;
  const TOP = HT - TY + 0.004, MHR = INZ(1) - 0.015, MHL = INZ(-1) - 0.015, FW = 0.05;
  const un = v3.norm([yTop, xN - xTop, 0]), ln = v3.norm([-yB, xB - xN, 0]), s6 = Math.sin(6 * DEG), c6 = Math.cos(6 * DEG);
  const body = (z0, z1, off, bev) => g.cv([[Math.sin(RA), Math.cos(RA), 0, xTop, TOP, 0], [un[0], un[1], 0, xN - off, 0, 0], [ln[0], ln[1], 0, xN - off, 0, 0], [0, -1, 0, 0, yB, 0],
    [0, 0, 1, 0, 0, z1, bev], [0, 0, -1, 0, 0, z0, bev], [-1, 0, 0, -0.14, 0, 0, 0]], 0.012);
  g.mat(MAT.tan2); body(-MHL + FW - 0.004, MHR - FW + 0.004, 0.04, 0);
  g.mat(MAT.tan); body(MHR - FW, MHR, 0, 0.007); body(-MHL, -MHL + FW, 0, 0.007);
  g.mat(MAT.tanD);
  for (const zc of [MHR - FW / 2, -MHL + FW / 2]) {
    for (const t of [0.12, 0.31, 0.50, 0.69, 0.88]) g.bolt([xTop + (xN - xTop) * t, yTop * (1 - t), zc], un, 0.016, 0.011);
    for (const t of [0.30, 0.66]) g.bolt([xN + (xB - xN) * t, yB * t, zc], ln, 0.016, 0.011);
  }
  // gun shield collar
  g.mat(MAT.tan);
  g.lathe(O, X, [[0.18, 0.185], [0.455, 0.185], [0.48, 0.165], [0.545, 0.165], [0.565, 0.155], [0.565, 0.14]], 44, { smooth: 30 * DEG });
  g.mat(MAT.tanD);
  for (let i = 0; i < 12; i++) { const a = (i + 0.5) / 12 * 2 * Math.PI; g.bolt([0.48, Math.cos(a) * 0.175, Math.sin(a) * 0.175], X, 0.012, 0.009); }
  // M256 barrel: stub sleeve, thermal shroud, bore evacuator, thermal shroud, muzzle (lengths from the drawing)
  const rs = (x, x0, r0, x1, r1) => r0 + (r1 - r0) * (x - x0) / (x1 - x0);
  const prof = [[0.52, 0.146], [0.83, 0.146], [0.855, 0.128], [0.855, 0.117]];
  const band = (x, r) => prof.push([x - 0.02, r], [x - 0.02, r + 0.006], [x + 0.02, r + 0.006], [x + 0.02, r]);
  band(1.07, 0.117);
  prof.push([1.30, 0.117], [1.30, 0.126], [1.37, 0.153], [1.73, 0.153], [1.80, 0.126], [1.80, 0.100]);
  for (const x of [1.92, 2.34, 2.76, 3.18]) band(x, rs(x, 1.80, 0.100, 3.50, 0.089));
  prof.push([3.50, 0.089], [3.50, 0.097], [3.525, 0.101], [3.60, 0.101], [3.615, 0.097], [3.615, 0.083], [3.672, 0.083], [3.68, 0.076], [3.68, 0.0625]);
  g.mat(MAT.tan);
  g.lathe(O, X, prof, 48, { smooth: 32 * DEG });
  g.mat(MAT.tanD);    // evacuator end rings
  g.lathe(O, X, [[1.385, 0.153], [1.385, 0.1565], [1.415, 0.1565], [1.415, 0.153]], 48, { smooth: 10 * DEG });
  g.lathe(O, X, [[1.685, 0.153], [1.685, 0.1565], [1.715, 0.1565], [1.715, 0.153]], 48, { smooth: 10 * DEG });
  g.mat(MAT.gun);
  g.lathe(O, X, [[3.68, 0.0625], [3.675, 0.060], [3.2, 0.060]], 48, { smooth: 10 * DEG });
  g.mat(MAT.dark); g.lathe(O, X, [[3.2, 0.060], [3.2, 0]], 24);
  // muzzle reference sensor
  g.mat(MAT.tan);
  g.bbox(3.51, 3.61, 0.088, 0.145, 0.012, 0.078, 0.008);
  g.mat(MAT.glass); g.lathe([3.51, 0.121, 0.045], [-1, 0, 0], [[0, 0.016], [0.004, 0.014], [0.004, 0]], 10);
  // thermal sleeve seam + clamps
  g.mat(MAT.tanD);
  for (const x of [2.13, 2.55, 2.97, 3.36]) { const r = rs(x, 1.80, 0.100, 3.50, 0.089); g.bbox(x - 0.03, x + 0.03, r - 0.004, r + 0.012, -0.016, 0.016, 0.004); }
  // coaxial MG port (upper right of the gun) + gunner's auxiliary sight (lower right)
  const CZ = 0.262, cx = xN - 0.035 - 0.11 * (xN - xTop) / yTop, ax = xN - 0.035 + (xB - xN) * (-0.14 / yB);
  g.mat(MAT.tan2);
  g.lathe([cx, 0.11, CZ], X, [[-0.03, 0.044], [0.016, 0.044], [0.024, 0.037], [0.024, 0.024], [-0.05, 0.024]], 20, { smooth: 30 * DEG });
  g.mat(MAT.dark); g.lathe([cx, 0.11, CZ], X, [[-0.05, 0.024], [-0.05, 0]], 14);
  g.mat(MAT.gun); g.lathe([cx, 0.11, CZ], X, [[-0.05, 0.012], [0.05, 0.012], [0.05, 0.006], [0.0, 0.006]], 12, { smooth: 10 * DEG });
  g.mat(MAT.tan2);
  g.lathe([ax, -0.14, CZ], X, [[-0.03, 0.036], [0.012, 0.036], [0.018, 0.030], [0.018, 0.022], [0.006, 0.022]], 16, { smooth: 30 * DEG });
  g.mat(MAT.glass); g.lathe([ax, -0.14, CZ], X, [[0.006, 0.022], [0.006, 0]], 14);
  // lifting eye on the shield top
  g.mat(MAT.tanD);
  g.tube(arcPts([xTop - 0.16, TOP + 0.008, -0.12], [0, 0, 1], [0, 1, 0], 0.035, 0, Math.PI, 6), 0.010, 6);
}

// ============================================================================
function buildTank() {
  const track = makeTrack();
  const hull = new Geo(); buildHull(hull);
  const turret = new Geo(); buildTurret(turret, 'M1A1');
  const turretA2 = new Geo(); buildTurret(turretA2, 'M1A2');
  const gun = new Geo(); buildGun(gun);
  const ground = new Geo(); ground.mat(MAT.ground);
  const G = 70; { const n = [0, 1, 0]; ground.triN([-G, 0, -G], [-G, 0, G], [G, 0, G], n, n, n); ground.triN([-G, 0, -G], [G, 0, G], [G, 0, -G], n, n, n); }
  return {
    track,
    meshes: {
      hull: hull.finish(), turret: turret.finish(), turretA2: turretA2.finish(), gun: gun.finish(), ground: ground.finish(),
      wheel: makeWheel(TK.wheelR).finish(), idler: makeWheel(TK.idler.r, false).finish(), sprocket: makeSprocket().finish(),
      roller: makeRoller().finish(), link: makeLink(track.pitch).finish(),
    },
  };
}
