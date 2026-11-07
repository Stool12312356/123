/* ============================================================================
   JBEAM SOFT-BODY CORE  (pure JS, no DOM / no Three.js)
   --------------------------------------------------------------------------
   * Nodes   : point masses with position / prev / velocity / mass / friction
   * Beams   : axial mass-spring-damper constraints (XPBD projection)
               - restLength        (permanently mutable -> plastic deformation)
               - stiffness, damping
               - plastic threshold (beamDeform) and fracture limit (strength)
   * Wheels  : hub nodes held by jbeam control arms + force spring/damper,
               tire contact with slip based friction (no rigid body anywhere)
   ========================================================================== */
'use strict';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const SUB_DT = 1 / 900;
const GRAVITY = 9.81;
const V3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
function dist3(a, b) { const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }

/* ------------------------------------------------------------------ terrain */
const FEATURES = {
  kicker: { x0: 37, x1: 45.5, z0: -6.0, z1: 6.0, h: 2.05 },
  wash:   { x0: -18, x1: 12, z0: 8, z1: 15.5, amp: 0.135, freq: 1.75 },
  twist:  { x0: -13, x1: 12, z0: -26, z1: -10, amp: 0.20 }
};
function groundHeight(x, z) {
  let h = 0;
  const K = FEATURES.kicker;
  if (x > K.x0 && x < K.x1 && z > K.z0 && z < K.z1) {
    const t = (x - K.x0) / (K.x1 - K.x0);
    const ez = smoothstep(K.z0, K.z0 + 2.0, z) * smoothstep(K.z1, K.z1 - 2.0, z);
    h = Math.max(h, K.h * t * t * ez);
  }
  const W = FEATURES.wash;
  if (x > W.x0 && x < W.x1 && z > W.z0 && z < W.z1) {
    const ex = smoothstep(W.x0, W.x0 + 2.6, x) * smoothstep(W.x1, W.x1 - 2.6, x);
    const ez = smoothstep(W.z0, W.z0 + 1.8, z) * smoothstep(W.z1, W.z1 - 1.8, z);
    const v = W.amp * Math.sin(x * W.freq) + W.amp * 0.5 * Math.sin(x * W.freq * 2.3 + 1.1);
    h = Math.max(h, v * ex * ez + 0.002 * ex * ez);
  }
  const T = FEATURES.twist;
  if (x > T.x0 && x < T.x1 && z > T.z0 && z < T.z1) {
    const ex = smoothstep(T.x0, T.x0 + 3.6, x) * smoothstep(T.x1, T.x1 - 3.6, x);
    const ez = smoothstep(T.z0, T.z0 + 3.0, z) * smoothstep(T.z1, T.z1 - 3.0, z);
    const s = Math.sin(x * 0.62 - z * 0.40) * 0.5 + 0.5;
    h = Math.max(h, T.amp * s * ex * ez + 0.002);
  }
  return h;
}
const _tn = V3();
function terrainNormal(x, z, out) {
  const e = 0.12;
  out.x = groundHeight(x - e, z) - groundHeight(x + e, z);
  out.y = 2 * e;
  out.z = groundHeight(x, z - e) - groundHeight(x, z + e);
  const l = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z) || 1;
  out.x /= l; out.y /= l; out.z /= l;
  return out;
}

/* ---------------------------------------------------------------- obstacles */
const obstacles = [];
function addCylObs(x, z, r, h, label) { obstacles.push({ type: 'cyl', x, z, r, h, label }); }
function addBoxObs(x, y, z, sx, sy, sz, label) { obstacles.push({ type: 'box', x, y, z, sx, sy, sz, label }); }

addCylObs(24.5, 0, 0.29, 2.55, 'STEEL BOLLARD');
addCylObs(24.5, 7.6, 0.29, 2.55, 'STEEL BOLLARD');
addCylObs(24.5, -7.6, 0.29, 2.55, 'STEEL BOLLARD');
addCylObs(12.5, 5.4, 0.3, 3.2, 'SIGN POST');
/* concrete wedge ramp */
for (let i = 0; i < 8; i++) {
  const t0 = i / 8, t1 = (i + 1) / 8;
  const hh = 1.7 * (1 - (t0 + t1) / 2) + 0.001;
  addBoxObs(30.6 - 1.2 + (2.4 * (t0 + t1) / 2), hh / 2, -9.0, 2.4 / 8, hh, 3.6, 'CONCRETE WEDGE');
}
/* jersey barriers */
for (let i = 0; i < 9; i++) addBoxObs(80, 0.55, -17 + i * 4.2, 0.8, 1.1, 4.0, 'CONCRETE BARRIER');
for (let i = 0; i < 7; i++) addBoxObs(-28 + i * 4.2, 0.55, -28, 4.0, 1.1, 0.8, 'CONCRETE BARRIER');
addBoxObs(14, 0.6, 26, 3.0, 1.2, 3.0, 'CONCRETE BLOCK');
addBoxObs(-6.5, 0.5, 21, 2.2, 1.0, 2.2, 'CONCRETE BLOCK');

/* 3 tonne drop slab (roof crush test) */
const slab = {
  active: false,
  size: V3(2.75, 0.55, 2.65),
  pos: V3(0, -40, 0), vel: V3(),
  mass: 3000, awake: true
};
function dropSlabAt(x, y, z) {
  slab.active = true;
  slab.pos.x = x; slab.pos.z = z;
  slab.pos.y = Math.max(4.6, y + 3.4);
  slab.vel.x = 0; slab.vel.y = -3.5; slab.vel.z = 0;
  slab.awake = true;
}
function updateSlab(dt) {
  if (!slab.active) return;
  const floorY = Math.max(groundHeight(slab.pos.x, slab.pos.z) + slab.size.y * 0.5, 0.58 + slab.size.y * 0.5);
  if (slab.pos.y > floorY) {
    /* free fall until it lands, then steady hydraulic descent */
    slab.vel.y -= GRAVITY * dt;
    slab.vel.y = Math.max(slab.vel.y, -(slab.contactCount ? 1.9 : 9));
    slab.pos.y += slab.vel.y * dt;
    if (slab.pos.y < floorY) { slab.pos.y = floorY; slab.vel.y = 0; }
  } else {
    slab.pos.y = floorY;
    slab.vel.y = 0;
  }
  slab.contactCount = 0;
}

/* ------------------------------------------------------------------- nodes */
let NODE_ID = 0;
class JNode {
  constructor(x, y, z, mass, radius, zone) {
    this.id = NODE_ID++;
    this.pos = V3(x, y, z);
    this.rest = V3(x, y, z);
    this.prev = V3(x, y, z);
    this.vel = V3();
    this.force = V3();
    this.mass = mass;
    this.invMass = mass > 0 ? 1 / mass : 0;
    this.radius = radius;
    this.zone = zone || 'cabin';
    this.grounded = false;
    this.normalY = 0;
    this.contactImpulse = 0;
    this.brk = 0;            // beams broken on this node
    this.car = null;
    this.isHub = false;
    this.isAnchor = false;
    this.grab = false;
    this.spark = 0;
  }
  set(x, y, z) { this.pos.x = this.prev.x = this.rest.x = x; this.pos.y = this.prev.y = this.rest.y = y; this.pos.z = this.prev.z = this.rest.z = z; this.vel.x = this.vel.y = this.vel.z = 0; }
}

/* ------------------------------------------------------------------- beams */
class JBeam {
  constructor(a, b, o) {
    this.a = a; this.b = b;
    this.rest = dist3(a.pos, b.pos);
    this.rest0 = this.rest;
    this.k = o.k;
    this.alpha = o.alpha;
    this.damping = o.damping == null ? 0.22 : o.damping;
    this.plastic = o.plastic;      // strain threshold for permanent bend
    this.strength = o.strength;    // strain at fracture
    this.type = o.type || 'struct';
    this.zone = o.zone || a.zone;
    this.broken = false;
    this.deformed = 0;
    this.plasticStrain = 0;
    this.strain = 0;
    this.stress = 0;
    this.flash = 0;
    this.fatigue = 1;
    this.visible = true;
    this.car = a.car;
  }
  get len() { return dist3(this.a.pos, this.b.pos); }
}

/* =========================================================================
   VEHICLE JBEAM DEFINITIONS
   Each station defines a cross-section of the body shell. The same points
   become BOTH the render shell control points AND the physics nodes, so the
   visual skin is a direct readout of the node lattice.
   ========================================================================= */
const CAR_SPECS = {
  bastion: {
    id: 'bastion',
    name: 'BRUCKEL BASTION',
    sub: 'MUSCLE SEDAN · RWD · 6.2L V8',
    paint: 0x9b1d1d, paintName: 'CRIMSON',
    mass: 1580, wheelR: 0.355, wheelW: 0.27, track: 0.895,
    frontX: 1.36, rearX: -1.55, hubY: 0.36,
    driven: [false, false, true, true],
    engineTorque: 780, brakeTorque: 2600, gearRatios: [3.55, 2.20, 1.55, 1.15, 0.90, 0.72], finalDrive: 3.20,
    suspRate: 52000, suspDamp: 5200, suspTravel: 0.30, suspRest: 0.60,
    k: { struct: 14e6, cage: 55e6, crumple: 2.6e6, susp: 2.0e6, mount: 10e6, frame: 18e6 },
    str: { struct: 0.24, cage: 0.40, crumple: 0.115, susp: 0.55, mount: 0.11, frame: 0.26 },
    plast: { struct: 0.055, cage: 0.07, crumple: 0.028, susp: 0.10, mount: 0.045, frame: 0.06 },
    zoneFront: 1.45, zoneRear: -1.62,
    stations: [
      { x: 2.63, B: [0.44, 0.38], S: [0.50, 0.55], W: [0.60, 0.52], R: [0.68, 0.33], T: [0.72, 0], cabin: false, nose: true },
      { x: 2.44, B: [0.33, 0.60], S: [0.39, 0.80], W: [0.63, 0.84], R: [0.80, 0.70], T: [0.90, 0], cabin: false },
      { x: 2.08, B: [0.30, 0.67], S: [0.37, 0.89], W: [0.71, 0.90], R: [0.95, 0.75], T: [1.01, 0], cabin: false },
      { x: 1.62, B: [0.30, 0.70], S: [0.42, 0.92], W: [0.92, 0.885], R: [1.06, 0.72], T: [1.11, 0], cabin: false },
      { x: 0.98, B: [0.30, 0.70], S: [0.44, 0.92], W: [0.94, 0.885], R: [1.45, 0.60], T: [1.53, 0], cabin: true },
      { x: 0.28, B: [0.30, 0.70], S: [0.44, 0.92], W: [0.95, 0.885], R: [1.47, 0.62], T: [1.55, 0], cabin: true },
      { x: -0.52, B: [0.30, 0.70], S: [0.44, 0.92], W: [0.95, 0.885], R: [1.46, 0.62], T: [1.54, 0], cabin: true },
      { x: -1.16, B: [0.30, 0.70], S: [0.43, 0.92], W: [0.94, 0.87], R: [1.41, 0.57], T: [1.47, 0], cabin: true },
      { x: -1.74, B: [0.30, 0.68], S: [0.42, 0.90], W: [0.94, 0.865], R: [1.02, 0.73], T: [1.07, 0], cabin: false },
      { x: -2.18, B: [0.32, 0.64], S: [0.40, 0.86], W: [0.80, 0.845], R: [0.92, 0.70], T: [0.97, 0], cabin: false },
      { x: -2.48, B: [0.36, 0.55], S: [0.45, 0.74], W: [0.70, 0.74], R: [0.80, 0.60], T: [0.85, 0], cabin: false },
      { x: -2.62, B: [0.47, 0.38], S: [0.54, 0.52], W: [0.62, 0.50], R: [0.70, 0.35], T: [0.74, 0], cabin: false, tail: true }
    ],
    propF: [2.42, 0.30], propR: [-2.40, 0.32],
    details: { bumperF: [2.55, 0.50, 0.30, 1.72], bumperR: [-2.52, 0.50, 0.30, 1.60], grilleY: 0.73, headY: 0.80, headZ: 0.60, tailY: 0.86, tailZ: 0.58, engineX: 1.86, engineY: 0.66, hoodY: 1.02, mirrorX: 0.86, mirrorZ: 0.98, beltY: 0.95, roofY: 1.55, cabinFront: 0.98, cabinRear: -1.16, seatX: -0.12, len: 4.9, halfW: 0.92 }
  },

  covet: {
    id: 'covet',
    name: 'IBISHU COVET',
    sub: 'COMPACT HATCH · FWD · 1.6L I4',
    paint: 0x2b6d8c, paintName: 'AZURE',
    mass: 1035, wheelR: 0.305, wheelW: 0.22, track: 0.815,
    frontX: 1.16, rearX: -1.20, hubY: 0.31,
    driven: [true, true, false, false],
    engineTorque: 400, brakeTorque: 1700, gearRatios: [3.90, 2.35, 1.62, 1.20, 0.95, 0.78], finalDrive: 3.65,
    suspRate: 37000, suspDamp: 3600, suspTravel: 0.28, suspRest: 0.52,
    k: { struct: 8.5e6, cage: 32e6, crumple: 1.8e6, susp: 1.6e6, mount: 7e6, frame: 10e6 },
    str: { struct: 0.19, cage: 0.29, crumple: 0.095, susp: 0.48, mount: 0.09, frame: 0.21 },
    plast: { struct: 0.045, cage: 0.055, crumple: 0.022, susp: 0.09, mount: 0.038, frame: 0.05 },
    zoneFront: 1.12, zoneRear: -1.26,
    stations: [
      { x: 1.95, B: [0.38, 0.34], S: [0.44, 0.50], W: [0.56, 0.48], R: [0.64, 0.30], T: [0.68, 0], cabin: false, nose: true },
      { x: 1.79, B: [0.29, 0.55], S: [0.35, 0.74], W: [0.60, 0.78], R: [0.78, 0.64], T: [0.86, 0], cabin: false },
      { x: 1.48, B: [0.26, 0.62], S: [0.33, 0.82], W: [0.70, 0.83], R: [0.93, 0.68], T: [0.99, 0], cabin: false },
      { x: 1.19, B: [0.26, 0.64], S: [0.37, 0.84], W: [0.88, 0.815], R: [1.02, 0.66], T: [1.07, 0], cabin: false },
      { x: 0.72, B: [0.26, 0.64], S: [0.38, 0.84], W: [0.90, 0.815], R: [1.40, 0.55], T: [1.47, 0], cabin: true },
      { x: 0.10, B: [0.26, 0.64], S: [0.38, 0.84], W: [0.91, 0.815], R: [1.43, 0.57], T: [1.50, 0], cabin: true },
      { x: -0.52, B: [0.26, 0.64], S: [0.38, 0.84], W: [0.91, 0.815], R: [1.42, 0.57], T: [1.49, 0], cabin: true },
      { x: -1.14, B: [0.26, 0.64], S: [0.38, 0.84], W: [0.90, 0.80], R: [1.36, 0.53], T: [1.42, 0], cabin: true },
      { x: -1.58, B: [0.28, 0.62], S: [0.37, 0.81], W: [0.86, 0.78], R: [1.02, 0.62], T: [1.05, 0], cabin: false },
      { x: -1.84, B: [0.32, 0.55], S: [0.40, 0.72], W: [0.70, 0.72], R: [0.82, 0.58], T: [0.86, 0], cabin: false },
      { x: -1.95, B: [0.40, 0.36], S: [0.47, 0.50], W: [0.58, 0.48], R: [0.66, 0.33], T: [0.70, 0], cabin: false, tail: true }
    ],
    propF: [1.10, 0.28], propR: [-1.24, 0.30],
    details: { bumperF: [1.88, 0.44, 0.26, 1.50], bumperR: [-1.86, 0.44, 0.26, 1.42], grilleY: 0.66, headY: 0.74, headZ: 0.52, tailY: 0.80, tailZ: 0.50, engineX: 1.42, engineY: 0.58, hoodY: 0.98, mirrorX: 0.62, mirrorZ: 0.90, beltY: 0.90, roofY: 1.49, cabinFront: 0.72, cabinRear: -1.14, seatX: -0.16, len: 3.9, halfW: 0.84 }
  },

  dseries: {
    id: 'dseries',
    name: 'GAVRIL D-SERIES',
    sub: 'HEAVY FRAME PICKUP · 4WD · DIESEL',
    paint: 0x37474f, paintName: 'GUNMETAL',
    mass: 2380, wheelR: 0.44, wheelW: 0.30, track: 0.975,
    frontX: 1.72, rearX: -1.92, hubY: 0.47,
    driven: [true, true, true, true],
    engineTorque: 1500, brakeTorque: 4200, gearRatios: [4.10, 2.45, 1.65, 1.20, 0.94, 0.75], finalDrive: 3.75,
    suspRate: 82000, suspDamp: 8200, suspTravel: 0.46, suspRest: 0.68,
    k: { struct: 24e6, cage: 75e6, crumple: 5.5e6, susp: 3.2e6, mount: 18e6, frame: 36e6 },
    str: { struct: 0.32, cage: 0.46, crumple: 0.18, susp: 0.62, mount: 0.15, frame: 0.38 },
    plast: { struct: 0.05, cage: 0.06, crumple: 0.03, susp: 0.09, mount: 0.04, frame: 0.05 },
    zoneFront: 1.85, zoneRear: -2.0,
    stations: [
      { x: 2.72, B: [0.62, 0.44], S: [0.72, 0.62], W: [0.86, 0.60], R: [0.96, 0.40], T: [1.02, 0], cabin: false, nose: true },
      { x: 2.52, B: [0.50, 0.68], S: [0.60, 0.88], W: [0.90, 0.95], R: [1.08, 0.82], T: [1.18, 0], cabin: false },
      { x: 2.10, B: [0.46, 0.74], S: [0.56, 0.98], W: [1.00, 1.00], R: [1.26, 0.88], T: [1.34, 0], cabin: false },
      { x: 1.62, B: [0.46, 0.76], S: [0.58, 1.00], W: [1.18, 0.99], R: [1.30, 0.86], T: [1.38, 0], cabin: false },
      { x: 1.16, B: [0.46, 0.76], S: [0.60, 1.00], W: [1.24, 0.99], R: [1.86, 0.72], T: [1.96, 0], cabin: true },
      { x: 0.34, B: [0.46, 0.76], S: [0.60, 1.00], W: [1.26, 0.99], R: [1.90, 0.74], T: [2.00, 0], cabin: true },
      { x: -0.48, B: [0.46, 0.76], S: [0.60, 1.00], W: [1.26, 0.99], R: [1.89, 0.74], T: [1.99, 0], cabin: true },
      { x: -1.02, B: [0.46, 0.76], S: [0.60, 1.00], W: [1.24, 0.98], R: [1.86, 0.72], T: [1.96, 0], cabin: true },
      { x: -1.30, B: [0.42, 0.80], S: [0.52, 1.02], W: [1.02, 1.00], R: [1.06, 0.86], T: [1.10, 0], cabin: false },
      { x: -2.30, B: [0.42, 0.80], S: [0.52, 1.02], W: [1.00, 0.99], R: [1.04, 0.84], T: [1.08, 0], cabin: false },
      { x: -2.58, B: [0.44, 0.76], S: [0.54, 0.96], W: [0.92, 0.94], R: [0.98, 0.78], T: [1.02, 0], cabin: false },
      { x: -2.72, B: [0.56, 0.50], S: [0.64, 0.66], W: [0.76, 0.64], R: [0.82, 0.46], T: [0.86, 0], cabin: false, tail: true }
    ],
    propF: [1.76, 0.34], propR: [-1.62, 0.36],
    details: { bumperF: [2.62, 0.66, 0.34, 2.00], bumperR: [-2.62, 0.66, 0.34, 1.94], grilleY: 0.96, headY: 1.02, headZ: 0.72, tailY: 0.86, tailZ: 0.70, engineX: 2.02, engineY: 0.86, hoodY: 1.35, mirrorX: 1.06, mirrorZ: 1.12, beltY: 1.24, roofY: 2.0, cabinFront: 1.16, cabinRear: -1.02, seatX: 0.10, len: 5.45, halfW: 1.0 }
  }
};

/* =========================================================================
   SOFT CAR — lattice construction
   ========================================================================= */
let CARS = [];
let CAR_UID = 0;

/* ring control-point order */
const CP_T = 0, CP_RL = 1, CP_RR = 2, CP_WL = 3, CP_WR = 4,
      CP_SL = 5, CP_SR = 6, CP_BL = 7, CP_BR = 8, CP_X = 9;
const CP_NAMES = ['T', 'R_L', 'R_R', 'W_L', 'W_R', 'S_L', 'S_R', 'B_L', 'B_R', 'X'];

function makeCP(y, z, station) {
  return { y, z, station, node: null, dx: 0, dy: 0, dz: 0 };
}

class SoftCar {
  constructor(specId, opts) {
    this.spec = CAR_SPECS[specId];
    this.id = ++CAR_UID;
    this.opts = opts || {};
    this.name = this.opts.name || (this.spec.name + ' #' + this.id);
    this.nodes = [];
    this.beams = [];
    this.cps = [];        // control points (flat, 10 per station)
    this.stations = [];
    this.shellFaces = []; // {mat, cp:[[i,dx,dy,dz] x4]} quads in CP space (for skinning)
    this.wheels = [];
    this.suspBeams = [];
    this.mountBeams = [];
    this.damage = { zones: {}, events: [], integrity: 1, deformed: 0, broken: 0, peakG: 0 };
    this.events = [];
    this.lastEvent = {};
    this.reset(opts.x || 0, opts.z || 0, opts.rot || 0);
  }

  /* ------------------------------------------------------------- build ---- */
  reset(x, z, rot) {
    rot = rot || 0;
    this.view = null;
    this.spawn = { x, z, rot: rot || 0 };
    this.lastBrkEvt = {};
    this._zoneNote = {};
    this.hitLabel = undefined;
    this.prevBodyVel = null;
    this.nodes.length = 0; this.beams.length = 0; this.cps.length = 0;
    this.stations.length = 0; this.wheels.length = 0;
    this.suspBeams.length = 0; this.mountBeams.length = 0;
    this.events.length = 0;
    this.lastEvent = {};
    this.acc = { x: 0, y: 0, z: 0 };
    this.speed = 0; this.rpm = 800; this.gear = 1; this.steer = 0;
    this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.airTime = 0; this.roll = 0; this.pitch = 0;
    this.wheelSpin = 0; this.odo = 0;
    this.frame = { fwd: V3(1, 0, 0), up: V3(0, 1, 0), right: V3(0, 0, 1) };
    this.center = V3(); this.centerPrev = V3();
    this.damage = { zones: {}, integrity: 1, deformed: 0, broken: 0, peakG: 0 };
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, reverse: false, auto: true };
    this.spec = CAR_SPECS[this.spec.id] || this.spec;

    const S = this.spec, cosr = Math.cos(rot), sinr = Math.sin(rot);
    const toW = (lx, lz) => V3(x + lx * cosr + lz * sinr, 0, z - lx * sinr + lz * cosr);

    /* --- control points / nodes --- */
    S.stations.forEach((st, si) => {
      const [By, Bz] = st.B, [Sy, Sz] = st.S, [Wy, Wz] = st.W, [Ry, Rz] = st.R, Ty = st.T[0];
      /* lower body tapers inwards so the wheels sit proud of the sills */
      const TA = [1, 0.97, 0.97, 1.0, 1.0, 0.92, 0.92, 0.86, 0.86, 0.86];
      const ring = [
        makeCP(Ty, 0, si),
        makeCP(Ry, Rz * TA[1], si), makeCP(Ry, -Rz * TA[2], si),
        makeCP(Wy, Wz * TA[3], si), makeCP(Wy, -Wz * TA[4], si),
        makeCP(Sy, Sz * TA[5], si), makeCP(Sy, -Sz * TA[6], si),
        makeCP(By, Bz * TA[7], si), makeCP(By, -Bz * TA[8], si),
        makeCP(By - 0.015, 0, si)
      ];
      this.stations.push({ x: st.x, cabin: !!st.cabin, nose: !!st.nose, tail: !!st.tail, ring });
      ring.forEach((cp, ci) => {
        const w = toW(st.x, cp.z);
        const zone = zoneForX(this.spec, st.x);
        const n = new JNode(w.x, cp.y, w.z, 1, 0.13, zone);
        n.car = this;
        n.ring = ci;
        n.station = si;
        n.restLocal = V3(st.x, cp.y, cp.z);
        cp.local = V3(st.x, cp.y, cp.z);
        n.isAnchor = ci === CP_SL || ci === CP_SR || ci === CP_BL || ci === CP_BR;
        n.friction = 0.62;
        cp.node = n;
        this.nodes.push(n);
        this.cps.push(cp);
      });
    });

    /* --- beams --- */
    this.buildBeams(rot, x, z);

    /* --- wheels --- */
    carBasis(this);
    this.buildWheels(toW);

    /* --- node mass distribution to hit the target kerb weight --- */
    let wsum = 0;
    for (const n of this.nodes) wsum += n.hubW || 1;
    const f = S.mass / wsum;
    for (const n of this.nodes) {
      n.mass = (n.hubW || 1) * f;
      n.invMass = 1 / n.mass;
    }
    /* hubs follow the wheels */
    for (const wh of this.wheels) { wh.hub.mass = wh.mass; wh.hub.invMass = 1 / wh.hub.mass; }

    /* --- zone stats --- */
    for (const k of ['front', 'engine', 'cabin', 'rear', 'suspF', 'suspR']) this.damage.zones[k] = { total: 0, intact: 0, deform: 0, broken: 0 };
    for (const b of this.beams) {
      const z = this.damage.zones[b.zone]; if (!z) continue;
      z.total++;
      if (b.type === 'susp') this.suspBeams.push(b);
      if (b.type === 'mount') this.mountBeams.push(b);
    }
    /* rest-pose centre used by the render layer for face orientation */
    {
      let cx = 0, cy = 0, cz = 0, cc = 0;
      for (const n of this.nodes) { if (n.isHub) continue; cx += n.rest.x; cy += n.rest.y; cz += n.rest.z; cc++; }
      this.bodyRestCenter = V3(cx / Math.max(1, cc), cy / Math.max(1, cc), cz / Math.max(1, cc));
    }
    this.updateCenter();
    this.centerPrev.x = this.center.x; this.centerPrev.y = this.center.y; this.centerPrev.z = this.center.z;
    this.gear = 1; this.rpm = 850;
    this.placeDetails();
  }

  /* -------------------------------------------------------------- beams -- */
  beamParams(type) {
    const k = this.spec.k, st = this.spec.str, pl = this.spec.plast;
    /* compliance = 1 / (stiffness * h^2)  (XPBD)  -> implicit, unconditionally stable */
    const base = {
      k: k[type], alpha: 1 / (k[type] * SUB_DT * SUB_DT),
      damping: 0.004,
      plastic: pl[type], strength: st[type], type
    };
    return base;
  }
  addBeam(a, b, type, zone, opts) {
    if (!a || !b || a === b) return null;
    const p = this.beamParams(type);
    Object.assign(p, opts || {});
    if (!opts || opts.strength == null) p.strength = this.spec.str[type] != null ? this.spec.str[type] : p.strength;
    const beam = new JBeam(a, b, p);
    beam.car = this;
    beam.zone = zone || a.zone;
    if (a.zone === 'suspF' || a.zone === 'suspR') beam.zone = a.zone;
    this.beams.push(beam);
    a.brk += 0; b.brk += 0;
    return beam;
  }

  buildBeams(rot, ox, oz) {
    const st = this.stations, n = st.length, S = this.spec;
    const cp = (s, c) => st[s].ring[c].node;
    const zoneOf = (si) => {
      const sx = st[si].x;
      if (sx >= S.zoneFront) return 'front';
      if (sx >= S.details.cabinFront) return 'engine';
      if (sx >= S.details.cabinRear) return 'cabin';
      return 'rear';
    };
    const structType = (si) => {
      const z = zoneOf(si);
      if (z === 'cabin') return 'cage';
      if (z === 'front' || z === 'rear') return 'crumple';
      return 'struct';
    };
    const isCageRing = (si) => st[si].cabin;

    /* --- hoop beams around every section --- */
    for (let s = 0; s < n; s++) {
      const ty = isCageRing(s) ? 'cage' : structType(s);
      const ringPairs = [
        [CP_T, CP_RL], [CP_T, CP_RR], [CP_RL, CP_WL], [CP_RR, CP_WR],
        [CP_WL, CP_SL], [CP_WR, CP_SR], [CP_SL, CP_BL], [CP_SR, CP_BR],
        [CP_BL, CP_X], [CP_BR, CP_X]
      ];
      for (const [a, b] of ringPairs) this.addBeam(cp(s, a), cp(s, b), ty, zoneOf(s));
      /* hoop bracing (triangulation of the section) */
      this.addBeam(cp(s, CP_X), cp(s, CP_WL), ty, zoneOf(s));
      this.addBeam(cp(s, CP_X), cp(s, CP_WR), ty, zoneOf(s));
      /* cross members */
      if (isCageRing(s)) {
        this.addBeam(cp(s, CP_BL), cp(s, CP_BR), 'cage', 'cabin');
        this.addBeam(cp(s, CP_WL), cp(s, CP_WR), 'cage', 'cabin');
        this.addBeam(cp(s, CP_SL), cp(s, CP_SR), 'cage', 'cabin');
        this.addBeam(cp(s, CP_T), cp(s, CP_WL), 'cage', 'cabin');
        this.addBeam(cp(s, CP_T), cp(s, CP_WR), 'cage', 'cabin');
        this.addBeam(cp(s, CP_RL), cp(s, CP_T), 'cage', 'cabin');
        this.addBeam(cp(s, CP_RR), cp(s, CP_T), 'cage', 'cabin');
      } else {
        this.addBeam(cp(s, CP_BL), cp(s, CP_BR), 'frame', zoneOf(s));
      }
    }

    /* --- longitudinal rails --- */
    for (let s = 0; s < n - 1; s++) {
      const ty = structType(s);
      for (let c = 0; c < 10; c++) {
        /* the sill / floor rails stay structural, the shell rails are crumple */
        let t = ty;
        if ((c === CP_BL || c === CP_BR || c === CP_X) && ty === 'crumple') t = 'frame';
        this.addBeam(cp(s, c), cp(s + 1, c), t, zoneOf(s));
      }
      if (isCageRing(s) && isCageRing(s + 1)) {
        /* cabin cage longitudinal reinforcement */
        this.addBeam(cp(s, CP_SL), cp(s + 1, CP_BL), 'cage', 'cabin');
        this.addBeam(cp(s, CP_SR), cp(s + 1, CP_BR), 'cage', 'cabin');
      }
    }

    /* --- longitudinal shear diagonals (make the skin act as a stressed panel) */
    for (let s = 0; s < n - 1; s++) {
      const ty = structType(s);
      const pairs = [
        [CP_WL, CP_SL], [CP_WR, CP_SR], [CP_SL, CP_BL], [CP_SR, CP_BR],
        [CP_RL, CP_WL], [CP_RR, CP_WR], [CP_X, CP_BL], [CP_X, CP_BR],
        [CP_T, CP_RL], [CP_T, CP_RR]
      ];
      for (const [a, b] of pairs) {
        const beamZone = zoneOf(s);
        let t = ty;
        if (!isCageRing(s) && !isCageRing(s + 1) && (a === CP_T || a === CP_RL || a === CP_RR)) t = ty;
        this.addBeam(cp(s, a), cp(s + 1, b), t, beamZone);
        this.addBeam(cp(s, b), cp(s + 1, a), t, beamZone);
      }
    }

    /* --- extra A/B/C pillar diagonal braces for rollover strength --- */
    for (let s = 0; s < n - 1; s++) {
      if (st[s].cabin || st[s + 1].cabin) {
        this.addBeam(cp(s, CP_RL), cp(s + 1, CP_WL), 'cage', 'cabin');
        this.addBeam(cp(s, CP_RR), cp(s + 1, CP_WR), 'cage', 'cabin');
        this.addBeam(cp(s, CP_WL), cp(s + 1, CP_RL), 'cage', 'cabin');
        this.addBeam(cp(s, CP_WR), cp(s + 1, CP_RR), 'cage', 'cabin');
      }
    }

    /* --- panel mount beams (hood latch, bumper stays, door hinges) --- */
    const mountPairs = [
      [0, CP_WL, 1, CP_RL], [0, CP_WR, 1, CP_RR],
      [0, CP_SL, 1, CP_BL], [0, CP_SR, 1, CP_BR],
      [1, CP_WL, 2, CP_SL], [1, CP_WR, 2, CP_SR],
      [n - 1, CP_WL, n - 2, CP_RL], [n - 1, CP_WR, n - 2, CP_RR],
      [n - 1, CP_SL, n - 2, CP_BL], [n - 1, CP_SR, n - 2, CP_BR]
    ];
    for (const [sa, ca, sb, cb] of mountPairs) {
      this.addBeam(cp(sa, ca), cp(sb, cb), 'mount', zoneOf(sa), { strength: S.str.mount * (0.8 + Math.random() * 0.5) });
    }
    /* door hinge towers: beltline of the cabin to the sill */
    for (let si = 4; si <= 7; si++) {
      if (!st[si].cabin) continue;
      this.addBeam(cp(si, CP_WL), cp(si, CP_BL), 'mount', 'cabin', { strength: S.str.mount * 1.3 });
      this.addBeam(cp(si, CP_WR), cp(si, CP_BR), 'mount', 'cabin', { strength: S.str.mount * 1.3 });
    }

    /* front chassis horn beams into the bumper (weak mounts) */
    const nose = st[0], f2 = st[1];
    for (const c of [CP_SL, CP_SR, CP_WL, CP_WR]) {
      this.addBeam(nose.ring[c].node, f2.ring[c].node, 'crumple', 'front', { strength: S.str.crumple * 0.8 });
    }
  }

  /* -------------------------------------------------------------- wheels -- */
  buildWheels(toW) {
    const S = this.spec;
    const positions = [
      { x: S.frontX, z: S.track, front: true, side: 1, name: 'FL' },
      { x: S.frontX, z: -S.track, front: true, side: -1, name: 'FR' },
      { x: S.rearX, z: S.track, front: false, side: 1, name: 'RL' },
      { x: S.rearX, z: -S.track, front: false, side: -1, name: 'RR' }
    ];
    const st = this.stations;
    for (let i = 0; i < 4; i++) {
      const w = positions[i];
      const p = toW(w.x, w.z);
      const hub = new JNode(p.x, S.hubY, p.z, 40, S.wheelR * 0.42, w.front ? 'suspF' : 'suspR');
      hub.car = this; hub.isHub = true; hub.noGround = true; hub.hubW = 0;
      hub.armNode = null;
      this.nodes.push(hub);
      /* choose the control-arm anchor: chassis sill node inboard of the wheel */
      let best = null, bestD = 1e9;
      const targetX = w.x + (w.front ? -0.62 : 0.62);
      const sideRing = w.side > 0 ? CP_BL : CP_BR;
      for (let s = 0; s < st.length; s++) {
        const c = st[s].ring[sideRing].node;
        const d = Math.abs(st[s].x - targetX);
        if (d < bestD) { bestD = d; best = c; }
      }
      hub.armNode = best;
      const armA = this.addBeam(best, hub, 'susp', hub.zone, { k: 3.0e6, damping: 0.4, plastic: 0.18, strength: 0.5 });
      /* lateral track bar across to the opposite frame rail */
      let lat = null, latD = 1e9;
      const otherRing = w.side > 0 ? CP_BR : CP_BL;
      for (let s = 0; s < st.length; s++) {
        const c = st[s].ring[otherRing].node;
        const d = Math.abs(st[s].x - w.x);
        if (d < latD) { latD = d; lat = c; }
      }
      const latB = lat ? this.addBeam(lat, hub, 'susp', hub.zone, { k: 1.1e6, damping: 0.5, plastic: 0.22, strength: 0.55 }) : null;
      /* spring anchor = upper side node above the wheel */
      let spring = null, springD = 1e9;
      const upRing = w.side > 0 ? CP_SL : CP_SR;
      for (let s = 0; s < st.length; s++) {
        const c = st[s].ring[upRing].node;
        const d = Math.abs(st[s].x - w.x);
        if (d < springD) { springD = d; spring = c; }
      }
      hub.springNode = spring;
      /* the visual wheel */
      const wheel = {
        name: w.name, front: w.front, side: w.side,
        hub, mass: S.mass * 0.024, radius: S.wheelR, width: S.wheelW,
        armA, latB, springNode: spring, steer: 0, spin: 0, spinVel: 0,
        comp: 0, contact: 0, slip: 0, load: 0, prevComp: 0, detached: false
      };
      wheel.inertia = 0.5 * wheel.mass * S.wheelR * S.wheelR;
      const anc0 = spring || best;
      const sv = { x: hub.pos.x - anc0.pos.x, y: hub.pos.y - anc0.pos.y, z: hub.pos.z - anc0.pos.z };
      wheel.restGap = sv.x * this.frame.up.x + sv.y * this.frame.up.y + sv.z * this.frame.up.z;
      const bx = hub.pos.x - (spring || best).pos.x, bz = hub.pos.z - (spring || best).pos.z;
      wheel.restLat = bx * this.frame.right.x + bz * this.frame.right.z;
      wheel.restLong = bx * this.frame.fwd.x + bz * this.frame.fwd.z;
      wheel.armStress = 0;
      hub.tire = wheel;
      this.wheels.push(wheel);
    }
  }

  updateCenter() {
    const c = V3();
    let cnt = 0;
    for (const n of this.nodes) {
      if (n.isHub) continue;
      const w = 1;
      c.x += n.pos.x * w; c.y += n.pos.y * w; c.z += n.pos.z * w; cnt += w;
    }
    if (cnt) { c.x /= cnt; c.y /= cnt; c.z /= cnt; }
    this.center.x = c.x; this.center.y = c.y; this.center.z = c.z;
  }

  /* -------------------------------------------------------------- details */
  placeDetails() {
    /* filled by the render layer: bumpers, lights, glass trim etc. */
  }
}

/* =========================================================================
   SOLVER
   ========================================================================= */
const WORLD = { time: 0, substeps: 14, events: [], cars: [], impacts: [] };
let SIM_STEP_COUNT = 0;

function carBasis(car) {
  const b = car.frame, st = car.stations, n = st.length;
  const fwd = b.fwd, up = b.up, right = b.right;
  const nose = st[0].ring[CP_X].node.pos, tail = st[n - 1].ring[CP_X].node.pos;
  fwd.x = nose.x - tail.x; fwd.y = nose.y - tail.y; fwd.z = nose.z - tail.z;
  let l = Math.hypot(fwd.x, fwd.y, fwd.z) || 1;
  fwd.x /= l; fwd.y /= l; fwd.z /= l;
  /* body up: mean roof rail minus mean sill (works upside down too) */
  let ux = 0, uy = 0, uz = 0;
  for (const si of car.stations) {
    const rl = si.ring[CP_RL].node.pos, rr = si.ring[CP_RR].node.pos;
    const bl = si.ring[CP_BL].node.pos, br = si.ring[CP_BR].node.pos;
    ux += (rl.x + rr.x) - (bl.x + br.x);
    uy += (rl.y + rr.y) - (bl.y + br.y);
    uz += (rl.z + rr.z) - (bl.z + br.z);
  }
  l = Math.hypot(ux, uy, uz) || 1;
  ux /= l; uy /= l; uz /= l;
  /* right = fwd x up */
  let rx = fwd.y * uz - fwd.z * uy;
  let ry = fwd.z * ux - fwd.x * uz;
  let rz = fwd.x * uy - fwd.y * ux;
  l = Math.hypot(rx, ry, rz);
  if (!(l > 0.2)) { rx = fwd.z; ry = 0; rz = -fwd.x; l = Math.hypot(rx, rz) || 1; ux = 0; uy = 1; uz = 0; }
  right.x = rx / l; right.y = ry / l; right.z = rz / l;
  up.x = right.y * fwd.z - right.z * fwd.y;
  up.y = right.z * fwd.x - right.x * fwd.z;
  up.z = right.x * fwd.y - right.y * fwd.x;
  l = Math.hypot(up.x, up.y, up.z) || 1;
  up.x /= l; up.y /= l; up.z /= l;
}

function signNoZero(v) { return v < 0 ? -1 : 1; }

SoftCar.prototype.substep = function (dt) {
  if (!this.frame) return;
  carBasis(this);
  const S = this.spec, b = this.frame, nodes = this.nodes;
  const ctl = this.controls;
  const up = b.up, fwd = b.fwd, right = b.right;

  /* ---------------- steering ---------------- */
  const spd = this.speed || 0;
  const steerLimit = spd < 4 ? 0.60 : spd < 12 ? 0.40 : spd < 25 ? 0.26 : 0.15;
  const steerTarget = (ctl.steer || 0) * steerLimit;
  this.steer += (steerTarget - this.steer) * Math.min(1, dt * 12);

  /* ---------------- drivetrain ---------------- */
  const ratios = S.gearRatios, fd = S.finalDrive;
  const drivenWheels = [];
  for (let i = 0; i < 4; i++) if (S.driven[i]) drivenWheels.push(this.wheels[i]);
  const nDriven = drivenWheels.length;
  let omegaAvg = 0;
  for (const w of drivenWheels) omegaAvg += w.spinVel;
  omegaAvg = nDriven ? omegaAvg / nDriven : 0;
  let gear = this.gear || 1;
  let rpm = Math.abs(omegaAvg) * ratios[gear - 1] * fd * 60 / TAU;
  rpm = clamp(rpm, 780, 7600);
  const throttle = ctl.throttle || 0;
  const rev = !!ctl.reverse;
  /* automatic gearbox */
  if (ctl.auto !== false) {
    if (rpm > 6350 && gear < 6) { gear++; this.shiftTimer = 0.12; }
    else if (rpm < 1650 && gear > 1) { gear--; this.shiftTimer = 0.1; }
  }
  this.gear = gear;
  const rpmNorm = clamp(rpm / 7000, 0.1, 1.05);
  const torqueCurve = 0.60 + 0.40 * Math.sin(Math.min(1, rpmNorm) * Math.PI * 0.92) - 0.28 * Math.max(0, rpmNorm - 0.78);
  const shiftCut = this.shiftTimer > 0 ? 0.05 : 1;
  this.shiftTimer = Math.max(0, (this.shiftTimer || 0) - dt);
  let driveTorque = throttle * S.engineTorque * torqueCurve * ratios[gear - 1] * fd * 0.16 / Math.max(1, nDriven) * shiftCut;
  if (rev) driveTorque = -throttle * S.engineTorque * ratios[0] * fd * 0.10 / Math.max(1, nDriven);
  if (this.engineDead) driveTorque = 0;
  this.rpm = lerp(this.rpm || 800, rpm, Math.min(1, dt * 12));
  this.throttle = throttle;
  this.brake = ctl.brake || 0;
  this.handbrake = ctl.handbrake || 0;

  /* ---------------- suspension, tyres, aero ---------------- */
  const brakeTorque = S.brakeTorque;
  for (let i = 0; i < this.wheels.length; i++) {
    const w = this.wheels[i];
    const hub = w.hub;

    if (w.detached) {
      /* free wheel: pure projectile, resting on the ground */
      hub.force.y -= GRAVITY * hub.mass;
      const gh = groundHeight(hub.pos.x, hub.pos.z);
      if (hub.pos.y - w.radius < gh) { hub.pos.y = gh + w.radius; hub.force.y = 0; hub.vel.y *= -0.2; hub.vel.x *= 0.9; hub.vel.z *= 0.9; }
      w.spin += w.spinVel * dt;
      continue;
    }

    /* --- spring between chassis node and hub --- */
    if (w.springNode) {
      const anc = w.springNode;
      const ax = hub.pos.x - anc.pos.x, ay = hub.pos.y - anc.pos.y, az = hub.pos.z - anc.pos.z;
      const dNow = ax * up.x + ay * up.y + az * up.z;
      const comp = dNow - w.restGap;
      w.compRaw = comp;
      const compVel = (comp - (w.prevCompRaw == null ? comp : w.prevCompRaw)) / dt;
      w.prevCompRaw = comp;
      w.comp += (comp - w.comp) * Math.min(1, dt * 30);
      let F = S.suspRate * comp + S.suspDamp * compVel;
      F = clamp(F, -S.suspRate * 0.04, S.suspRate * (S.suspTravel + 0.07));
      if (comp > S.suspTravel) F += (comp - S.suspTravel) * S.suspRate * 7;
      if (comp < -S.suspTravel * 0.25) F += (comp + S.suspTravel * 0.25) * S.suspRate * 2.5;
      w.load = Math.max(0, F);
      hub.force.x -= up.x * F; hub.force.y -= up.y * F; hub.force.z -= up.z * F;
      anc.force.x += up.x * F; anc.force.y += up.y * F; anc.force.z += up.z * F;
    }

    /* --- tyre contact --- */
    const gh = groundHeight(hub.pos.x, hub.pos.z);
    const norm = terrainNormal(hub.pos.x, hub.pos.z, _tn);
    const heightAbove = (hub.pos.y - gh) * norm.y;
    const pen = w.radius - heightAbove;
    w.contact = 0; w.slip = 0;
    const isFront = w.front;
    const steer = isFront ? this.steer : 0;
    const cs = Math.cos(steer), sn = Math.sin(steer);
    const wfx = fwd.x * cs + right.x * sn, wfy = fwd.y * cs + right.y * sn, wfz = fwd.z * cs + right.z * sn;
    const wlx = right.x * cs - fwd.x * sn, wly = right.y * cs - fwd.y * sn, wlz = right.z * cs - fwd.z * sn;
    const vLong = hub.vel.x * wfx + hub.vel.y * wfy + hub.vel.z * wfz;
    const vLat = hub.vel.x * wlx + hub.vel.y * wly + hub.vel.z * wlz;

    if (pen > 0) {
      w.contact = 1;
      const vN = hub.vel.x * norm.x + hub.vel.y * norm.y + hub.vel.z * norm.z;
      const kTire = S.suspRate * 5.0;
      let Fn = kTire * Math.min(pen, w.radius * 0.85) - 2100 * vN;
      Fn = clamp(Fn, 0, S.suspRate * 3.4);
      w.load = Fn;
      const mu = 1.22;
      const Fmax = mu * Fn;
      /* --- longitudinal slip ratio --- */
      const ref = Math.max(1.4, Math.abs(vLong));
      const kappa = (w.spinVel * w.radius - vLong) / ref;
      let Fx = Fmax * Math.tanh(kappa * 4.2);
      /* --- lateral slip angle force --- */
      let Fy = -Fmax * Math.tanh(vLat * 2.4);
      /* combined slip friction ellipse */
      const mag = Math.hypot(Fx, Fy);
      if (mag > Fmax) { const sc = Fmax / mag; Fx *= sc; Fy *= sc; }
      w.slip = clamp(Math.abs(kappa) * 2.2 + Math.abs(vLat) * 0.12, 0, 1);
      w.dbg = { Fx, Fy, Fn, kappa, vLong, vLat, driveTorque, pen, spin: w.spinVel };
      /* the tyre force is reacted by the chassis through the control arms:
         60% into the spring anchor, 40% into the lower arm anchor */
      const hx = wfx * Fx + wlx * Fy;
      const hy = wfy * Fx + wly * Fy;
      const hz = wfz * Fx + wlz * Fy;
      const a1 = w.springNode || w.hub.armNode, a2 = w.hub.armNode || a1;
      if (a1) { a1.force.x += hx * 0.6; a1.force.y += hy * 0.6; a1.force.z += hz * 0.6; }
      if (a2) { a2.force.x += hx * 0.4; a2.force.y += hy * 0.4; a2.force.z += hz * 0.4; }
      hub.force.y += norm.y * Fn;
      w.traction = hx;
      /* --- wheel spin dynamics --- */
      const wTorque = Fx * w.radius;
      let spinTorque = driveTorque - wTorque;
      /* brakes */
      const brakeFrac = clamp(this.brake * (isFront ? 0.62 : 0.38) * 1.7 + (this.handbrake * (isFront ? 0.0 : 1.0)), 0, 1);
      if (brakeFrac > 0.01) {
        const tb = brakeTorque * brakeFrac;
        const om = w.spinVel;
        const dOm = tb / w.inertia * dt;
        if (Math.abs(om) <= dOm) w.spinVel = 0; else w.spinVel -= Math.sign(om) * dOm;
      }
      w.spinVel += (spinTorque / Math.max(0.4, w.inertia)) * dt;
      /* rolling resistance */
      w.spinVel -= Math.sign(w.spinVel) * Math.min(Math.abs(w.spinVel), 0.45 * dt);
      w.spinVel = clamp(w.spinVel, -260, 320);
      hub.contactImpulse = Math.max(hub.contactImpulse, Math.abs(vN));
    } else {
      w.load = 0;
      /* airborne: free spin-up from the engine, brakes still act */
      w.spinVel += (driveTorque / Math.max(0.4, w.inertia)) * dt;
      const brakeFrac = clamp(this.brake + this.handbrake, 0, 1);
      if (brakeFrac > 0.01) {
        const dOm = brakeTorque * brakeFrac / w.inertia * dt;
        if (Math.abs(w.spinVel) <= dOm) w.spinVel = 0; else w.spinVel -= Math.sign(w.spinVel) * dOm;
      }
      w.spinVel = clamp(w.spinVel, -300, 340);
    }
    w.spin += w.spinVel * dt;
  }

  /* ---------------- gravity, aero, grabber ---------------- */
  for (const n of nodes) {
    if (n.pos.y < -30 || !isFinite(n.pos.x) || !isFinite(n.pos.y) || !isFinite(n.pos.z)) {
      n.pos.x = this.center.x; n.pos.y = 25; n.pos.z = this.center.z;
      n.prev.x = n.pos.x; n.prev.y = n.pos.y; n.prev.z = n.pos.z;
      n.vel.x = n.vel.y = n.vel.z = 0;
      continue;
    }
    n.force.y -= GRAVITY * n.mass;
    const sp = Math.hypot(n.vel.x, n.vel.y, n.vel.z);
    const drag = 0.0018 * sp * (n.isHub ? 0 : 1);
    n.force.x -= n.vel.x * drag;
    n.force.y -= n.vel.y * drag * 0.35;
    n.force.z -= n.vel.z * drag;
    if (n.grab && this.grabTarget) {
      const k = 2600;
      n.force.x += (this.grabTarget.x - n.pos.x) * k * n.mass;
      n.force.y += (this.grabTarget.y - n.pos.y) * k * n.mass;
      n.force.z += (this.grabTarget.z - n.pos.z) * k * n.mass;
      n.vel.x *= 0.93; n.vel.y *= 0.93; n.vel.z *= 0.93;
    }
  }
  /* chassis aero drag (quadratic on the whole body) */
  const bv = this.bodyVel || { x: 0, y: 0, z: 0 };
  const sp2 = Math.hypot(bv.x, bv.z);
  if (sp2 > 1) {
    const cda = 0.5 * 1.2 * (S.mass / 1500) * 0.62 * 1.9;
    const fx = -bv.x * sp2 * cda, fz = -bv.z * sp2 * cda;
    for (const n of nodes) { n.force.x += fx / nodes.length; n.force.z += fz / nodes.length; }
  }
};

/* ---------------------------------------------------------------- collide */
const hash = new Map();
const HASH_CELL = 0.8;
function hashKey(x, y, z) {
  return ((x / HASH_CELL) | 0) * 73856093 ^ ((y / HASH_CELL) | 0) * 19349663 ^ ((z / HASH_CELL) | 0) * 83492791;
}
function nodeNodeCollisions(cars) {
  if (cars.length < 2) return;
  const invDt = 1 / SUB_DT;
  hash.clear();
  for (const car of cars) {
    for (const n of car.nodes) {
      if (n.isHub) continue;
      const k = hashKey(n.pos.x, n.pos.y, n.pos.z);
      let arr = hash.get(k);
      if (!arr) { arr = []; hash.set(k, arr); }
      arr.push(n);
    }
  }
  for (const car of cars) {
    for (const n of car.nodes) {
      if (n.isHub) continue;
      const cx = (n.pos.x / HASH_CELL) | 0, cy = (n.pos.y / HASH_CELL) | 0, cz = (n.pos.z / HASH_CELL) | 0;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const arr = hash.get((cx + ox) * 73856093 ^ (cy + oy) * 19349663 ^ (cz + oz) * 83492791);
        if (!arr) continue;
        for (const m of arr) {
          if (m.car === car) continue;
          const dx = m.pos.x - n.pos.x, dy = m.pos.y - n.pos.y, dz = m.pos.z - n.pos.z;
          const rr = n.radius + m.radius;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < rr * rr && d2 > 1e-9) {
            const d = Math.sqrt(d2);
            const nx = dx / d, ny = dy / d, nz = dz / d;
            const wA = n.invMass / (n.invMass + m.invMass), wB = 1 - wA;
            const push = rr - d;
            n.pos.x -= nx * push * wA; n.pos.y -= ny * push * wA; n.pos.z -= nz * push * wA;
            m.pos.x += nx * push * wB; m.pos.y += ny * push * wB; m.pos.z += nz * push * wB;
            /* relative velocity -> inelastic impulse along the normal */
            const rvx = (m.pos.x - m.prev.x) * invDt - (n.pos.x - n.prev.x) * invDt;
            const rvy = (m.pos.y - m.prev.y) * invDt - (n.pos.y - n.prev.y) * invDt;
            const rvz = (m.pos.z - m.prev.z) * invDt - (n.pos.z - n.prev.z) * invDt;
            const rvn = rvx * nx + rvy * ny + rvz * nz;
            if (rvn < 0) {
              const j = -rvn * 1.05 / (n.invMass + m.invMass);
              n.prev.x += nx * j * n.invMass * SUB_DT; n.prev.y += ny * j * n.invMass * SUB_DT; n.prev.z += nz * j * n.invMass * SUB_DT;
              m.prev.x -= nx * j * m.invMass * SUB_DT; m.prev.y -= ny * j * m.invMass * SUB_DT; m.prev.z -= nz * j * m.invMass * SUB_DT;
              n.contactImpulse = Math.max(n.contactImpulse, -rvn);
              m.contactImpulse = Math.max(m.contactImpulse, -rvn);
              car.onImpact(-rvn, n);
              m.car.onImpact(-rvn, m);
            }
          }
        }
      }
    }
  }
}


/* ---------------------------------------------------------------------------
   Contact resolution: positional projection + velocity-level inelastic
   impulse (restitution 0) so contacts never inject energy into the lattice.
   n = outward normal of the surface, pointing towards the node.
   ------------------------------------------------------------------------- */
function contactResolve(n, nx, ny, nz, push, friction, restitution) {
  const invDt = 1 / SUB_DT;
  let vx = (n.pos.x - n.prev.x) * invDt;
  let vy = (n.pos.y - n.prev.y) * invDt;
  let vz = (n.pos.z - n.prev.z) * invDt;
  n.pos.x += nx * push; n.pos.y += ny * push; n.pos.z += nz * push;
  const vn = vx * nx + vy * ny + vz * nz;
  if (vn < 0) {
    const j = -vn * (1 + (restitution || 0));
    vx += nx * j; vy += ny * j; vz += nz * j;
  }
  const vtn = vx * nx + vy * ny + vz * nz;
  let tx = vx - nx * vtn, ty = vy - ny * vtn, tz = vz - nz * vtn;
  const damp = 1 - clamp(friction == null ? 0.2 : friction, 0, 1);
  tx *= damp; ty *= damp; tz *= damp;
  vx = tx + nx * vtn; vy = ty + ny * vtn; vz = tz + nz * vtn;
  n.prev.x = n.pos.x - vx / invDt;
  n.prev.y = n.pos.y - vy / invDt;
  n.prev.z = n.pos.z - vz / invDt;
  n.contactImpulse = Math.max(n.contactImpulse, -vn);
}

function groundCollisions(cars) {
  const nrm = V3();
  for (const car of cars) {
    for (const n of car.nodes) {
      if (n.isHub) continue;
      const h = groundHeight(n.pos.x, n.pos.z);
      const pen = h + n.radius - n.pos.y;
      n.grounded = false;
      if (pen > 0) {
        terrainNormal(n.pos.x, n.pos.z, nrm);
        contactResolve(n, nrm.x, nrm.y, nrm.z, pen, 0.30, 0);
        n.grounded = true;
        n.normalY = nrm.y;
      }
      collideNodeObstacles(n);
    }
  }
}

function collideNodeObstacles(n) {
  const r = n.radius;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o.type === 'cyl') {
      if (n.pos.y - r > o.h || n.pos.y + r < 0) continue;
      const dx = n.pos.x - o.x, dz = n.pos.z - o.z;
      const d2 = dx * dx + dz * dz;
      const rr = o.r + r;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 1e-4;
        contactResolve(n, dx / d, 0, dz / d, rr - d, 0.32, 0.02);
        const sp = Math.hypot(n.vel.x, n.vel.z);
        n.contactImpulse = Math.max(n.contactImpulse, sp);
      }
    } else {
      const dx = n.pos.x - o.x, dy = n.pos.y - o.y, dz = n.pos.z - o.z;
      const ex = o.sx / 2 + r, ey = o.sy / 2 + r, ez = o.sz / 2 + r;
      const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
      if (ax < ex && ay < ey && az < ez) {
        const px = ex - ax, py = ey - ay, pz = ez - az;
        if (py <= px && py <= pz) {
          const sy = signNoZero(dy);
          contactResolve(n, 0, sy, 0, py, 0.35, 0.02);
        } else if (px <= pz) {
          const sx = signNoZero(dx);
          contactResolve(n, sx, 0, 0, px, 0.3, 0.02);
        } else {
          const sz = signNoZero(dz);
          contactResolve(n, 0, 0, sz, pz, 0.3, 0.02);
        }
        n.contactImpulse = Math.max(n.contactImpulse, Math.hypot(n.vel.x, n.vel.y, n.vel.z));
      }
    }
  }
  /* hydraulic roof-crush press */
  if (slab.active) {
    const hx = slab.size.x / 2 + r, hy = slab.size.y / 2 + r, hz = slab.size.z / 2 + r;
    const dx = n.pos.x - slab.pos.x, dy = n.pos.y - slab.pos.y, dz = n.pos.z - slab.pos.z;
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    if (ax < hx && ay < hy && az < hz) {
      const py = hy - ay;
      if (dy < 0) {
        /* node underneath the press: squeeze it downwards, the press does not move */
        slab.contactCount = (slab.contactCount || 0) + 1;
        contactResolve(n, 0, -1, 0, py, 0.55, 0);
        n.contactImpulse = Math.max(n.contactImpulse, Math.abs(slab.vel.y) + 8);
      } else {
        /* node above the press: slide it off the side */
        n.pos.y += py; n.prev.y += py;
      }
    }
  }
}

/* --------------------------------------------------------------- beams --- */
function solveBeams(car, iterations) {
  const beams = car.beams;
  const h2 = SUB_DT * SUB_DT;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      if (b.broken) continue;
      const A = b.a, B = b.b;
      const dx = B.pos.x - A.pos.x, dy = B.pos.y - A.pos.y, dz = B.pos.z - A.pos.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) continue;
      const strain = (len - b.rest) / b.rest;
      const absStrain = strain < 0 ? -strain : strain;
      b.strain = strain;
      b.stress = absStrain;
      /* already converged: nothing to project (keeps the solver cheap at rest) */
      if (it > 0 && absStrain < 0.0009) continue;

      /* --- control arms behave as tethers: the wheel is located by the
             suspension link, the arm only limits travel and can shear off --- */
      if (b.type === 'susp') {
        b.stress = Math.abs(strain);
        if (len > b.rest * 1.42) {
          const wA = A.invMass, wB = B.invMass;
          const wsum = wA + wB + b.alpha * 0.25;
          const corr = (len - b.rest * 1.42) / (len * wsum);
          A.pos.x += (B.pos.x - A.pos.x) * corr * wA;
          A.pos.y += (B.pos.y - A.pos.y) * corr * wA;
          A.pos.z += (B.pos.z - A.pos.z) * corr * wA;
          B.pos.x -= (B.pos.x - A.pos.x) * corr * wB / 1.0;
          B.pos.y -= (B.pos.y - A.pos.y) * corr * wB / 1.0;
          B.pos.z -= (B.pos.z - A.pos.z) * corr * wB / 1.0;
        }
        if (Math.abs(strain) > b.strength) { b.broken = true; car.noteBreak(b, Math.abs(strain)); }
        continue;
      }

      /* --- plasticity: metal yields permanently --- */
      if (absStrain > b.plastic) {
        const excess = (absStrain - b.plastic) / b.plastic;
        const rate = Math.min(0.5, excess * 0.35);
        const plasticMove = (len - b.rest) * rate;
        b.rest += plasticMove;
        b.plasticStrain += Math.abs(plasticMove) / b.rest0;
        b.deformed = b.plasticStrain;
        b.flash = 1;
        if (!b.silent && it === 0) car.noteDeform(b);
        b.fatigue = Math.max(0.35, b.fatigue - Math.min(0.004, excess * 0.0009));
      }
      /* --- fracture --- */
      if (absStrain > b.strength * b.fatigue) {
        b.broken = true;
        car.noteBreak(b, absStrain);
        continue;
      }
      /* --- compliant axial constraint --- */
      const wA = A.invMass, wB = B.invMass;
      const wsum = wA + wB + b.alpha;
      if (wsum <= 1e-12) continue;
      const corr = (len - b.rest) / (len * wsum);
      const cx = dx * corr, cy = dy * corr, cz = dz * corr;
      A.pos.x += cx * wA; A.pos.y += cy * wA; A.pos.z += cz * wA;
      B.pos.x -= cx * wB; B.pos.y -= cy * wB; B.pos.z -= cz * wB;
      b.stress = Math.abs(strain);
    }
  }
}

/* axial beam damping (metal is not rubbery) */
function beamDamping(car, dt) {
  const beams = car.beams;
  for (let i = 0; i < beams.length; i++) {
    const b = beams[i];
    if (b.broken) continue;
    const A = b.a, B = b.b;
    const dx = B.pos.x - A.pos.x, dy = B.pos.y - A.pos.y, dz = B.pos.z - A.pos.z;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const nx = dx / l, ny = dy / l, nz = dz / l;
    const rvx = B.vel.x - A.vel.x, rvy = B.vel.y - A.vel.y, rvz = B.vel.z - A.vel.z;
    const vax = rvx * nx + rvy * ny + rvz * nz;
    const wsum = A.invMass + B.invMass;
    if (wsum <= 0) continue;
    const imp = -vax * b.damping / wsum;
    A.vel.x -= nx * imp * A.invMass; A.vel.y -= ny * imp * A.invMass; A.vel.z -= nz * imp * A.invMass;
    B.vel.x += nx * imp * B.invMass; B.vel.y += ny * imp * B.invMass; B.vel.z += nz * imp * B.invMass;
  }
}

/* prismatic wheel links: horizontal hub offsets follow the chassis, vertical is free */
function solveWheelLinks(car) {
  const f = car.frame, right = f.right, fwd = f.fwd;
  for (const w of car.wheels) {
    if (w.detached) continue;
    const anc = w.springNode || w.hub.armNode;
    if (!anc) continue;
    const offL = (w.hub.pos.x - anc.pos.x) * right.x + (w.hub.pos.z - anc.pos.z) * right.z;
    const offF = (w.hub.pos.x - anc.pos.x) * fwd.x + (w.hub.pos.z - anc.pos.z) * fwd.z;
    const eL = offL - w.restLat;
    const eF = offF - w.restLong;
    const cx = (right.x * eL + fwd.x * eF) * 0.9;
    const cz = (right.z * eL + fwd.z * eF) * 0.9;
    w.hub.pos.x -= cx;
    w.hub.pos.z -= cz;
    w.linkErr = Math.abs(eL) + Math.abs(eF);
    /* wheel hitting world geometry */
    collideNodeObstacles(w.hub);
    if (w.linkErr > 0.22) w.armStress = (w.armStress || 0) + 1;
    else w.armStress = Math.max(0, (w.armStress || 0) - 0.02);
    if (w.armStress > 40 && w.armA && !w.armA.broken) {
      w.armA.broken = true;
      car.noteBreak(w.armA, 9);
      w.armStress = 0;
    }
  }
}

/* --------------------------------------------------------- impact report -- */
SoftCar.prototype.onImpact = function (speed, node) {
  const now = WORLD.time;
  if (speed < 3.2) return;
  if (now - (this.lastImpactEvt || -9) < 0.28) return;
  this.lastImpactEvt = now;
  this.pushEvent('IMPACT', 'CONTACT IMPULSE ' + (speed * 3.6).toFixed(0) + ' KM/H', 1.8);
  WORLD.lastImpact = Math.max(WORLD.lastImpact, speed);
};

SoftCar.prototype.noteDeform = function (b) {
  const now = WORLD.time;
  if (!this._zoneNote) this._zoneNote = {};
  if (now - (this._zoneNote[b.zone] || -9) < 1.6) return;
  this._zoneNote[b.zone] = now;
  this.pushEvent('BENT', zoneLabel(b.zone) + ' BEAMS YIELDING', 0.55);
};

SoftCar.prototype.noteBreak = function (b, strain) {
  b.broken = true;
  const z = this.damage.zones[b.zone];
  if (z) { z.broken++; }
  this.damage.broken++;
  const now = WORLD.time;
  const key = b.zone + b.type;
  if (b.type === 'susp') {
    const w = this.wheels.find(ww => ww.armA === b || ww.latB === b);
    const wn = w ? (w.front ? 'FRONT ' : 'REAR ') + (w.side > 0 ? 'LEFT' : 'RIGHT') : '';
    this.pushEvent('BREAK', (wn || zoneLabel(b.zone)) + ' SUSPENSION SHEARED', 2.2);
    if (w) { w.detached = true; w.hub.grab = false; w.hub.force.x = w.hub.force.y = w.hub.force.z = 0; }
  } else if (b.type === 'mount') {
    const txt = b.zone === 'front' ? 'HOOD LATCH / BUMPER MOUNT BROKEN'
      : b.zone === 'rear' ? 'BOOT / REAR BUMPER MOUNT BROKEN'
      : 'DOOR HINGE TORN FROM CAGE';
    this.pushEvent('BREAK', txt, 1.7);
  } else if (now - (this.lastBrkEvt && this.lastBrkEvt[key] || -9) > 0.6) {
    if (!this.lastBrkEvt) this.lastBrkEvt = {};
    this.lastBrkEvt[key] = now;
    this.pushEvent('BREAK', zoneLabel(b.zone) + ' ' + beamTypeLabel(b.type) + ' FRACTURED', 1.8);
  }
  WORLD.events.push({ t: now, type: 'break', car: this, zone: b.zone, strain });
  if (WORLD.events.length > 80) WORLD.events.shift();
};

SoftCar.prototype.pushEvent = function (kind, text, weight) {
  const now = WORLD.time;
  this.events.push({ t: now, kind, text, weight: weight || 1 });
  if (this.events.length > 40) this.events.shift();
  WORLD.events.push({ t: now, type: kind, car: this, text });
  if (WORLD.events.length > 120) WORLD.events.shift();
};

function zoneForX(spec, sx) {
  if (sx > spec.zoneFront) return 'front';
  if (sx > spec.details.cabinFront + 1e-3) return 'engine';
  if (sx >= spec.details.cabinRear) return 'cabin';
  return 'rear';
}

function zoneLabel(z) {
  return ({ front: 'FRONT CRUMPLE ZONE', engine: 'ENGINE / COWL', cabin: 'CABIN CAGE', rear: 'REAR SECTION', suspF: 'FRONT SUSPENSION', suspR: 'REAR SUSPENSION' })[z] || 'CHASSIS';
}
function beamTypeLabel(t) {
  return ({ struct: 'CHASSIS', cage: 'CAGE', crumple: 'CRUMPLE', frame: 'FRAME RAIL', susp: 'SUSPENSION', mount: 'MOUNT' })[t] || 'BEAM';
}

/* ------------------------------------------------------------- integration */
function integrateNodes(car, dt) {
  for (const n of car.nodes) {
    if (n.invMass === 0) continue;
    n.prev.x = n.pos.x; n.prev.y = n.pos.y; n.prev.z = n.pos.z;
    n.vel.x += n.force.x * n.invMass * dt;
    n.vel.y += n.force.y * n.invMass * dt;
    n.vel.z += n.force.z * n.invMass * dt;
    /* clamp insane velocities for stability */
    const v = Math.hypot(n.vel.x, n.vel.y, n.vel.z);
    if (v > 120) { const s = 120 / v; n.vel.x *= s; n.vel.y *= s; n.vel.z *= s; }
    n.pos.x += n.vel.x * dt;
    n.pos.y += n.vel.y * dt;
    n.pos.z += n.vel.z * dt;
    n.force.x = n.force.y = n.force.z = 0;
    n.contactImpulse *= 0.86;
  }
}
function finishNodes(car, dt) {
  const inv = 1 / dt;
  for (const n of car.nodes) {
    n.vel.x = (n.pos.x - n.prev.x) * inv;
    n.vel.y = (n.pos.y - n.prev.y) * inv;
    n.vel.z = (n.pos.z - n.prev.z) * inv;
  }
}

function updateCarDamage(car) {
  const zones = car.damage.zones;
  for (const k in zones) { zones[k].intact = 0; zones[k].deform = 0; }
  let def = 0, brk = 0, live = 0;
  for (const b of car.beams) {
    const z = zones[b.zone];
    if (b.broken) { brk++; if (z) z.broken = Math.min(z.total, (z.broken || 0)); }
    else { live++; if (z) z.intact++; if (b.plasticStrain > 0.012) { def++; if (z) z.deform++; } }
  }
  car.damage.deformed = def;
  car.damage.broken = brk;
  car.damage.live = live;
  /* suspension zone stats from susp beams per axle */
  let total = 0, int = 0;
  for (const b of car.suspBeams) { total++; if (!b.broken) int++; }
  car.damage.suspTotal = total;
  car.damage.suspIntact = int;
  let integrity = 0, cnt = 0;
  for (const k of ['front', 'engine', 'cabin', 'rear']) {
    const z = zones[k];
    if (!z || !z.total) continue;
    const score = clamp((z.intact - z.deform * 0.55) / z.total, 0, 1);
    integrity += score; cnt++;
  }
  car.damage.integrity = cnt ? clamp(integrity / cnt, 0, 1) : 1;
  /* severity in G from the change of the body's average velocity */
  const bv = car.bodyVel || { x: 0, y: 0, z: 0 };
  const pv = car.prevBodyVel || bv;
  const gRaw = Math.hypot(bv.x - pv.x, bv.y - pv.y, bv.z - pv.z) / Math.max(1e-4, car.lastFrameDt) / GRAVITY;
  const g = clamp(gRaw, 0, 240);
  car.prevBodyVel = { x: bv.x, y: bv.y, z: bv.z };
  car.damage.gNow = g;
  /* structural overload is the 20 Hz low-passed impact acceleration */
  car.damage.gSmoothed = lerp(car.damage.gSmoothed == null ? 0 : car.damage.gSmoothed, g, 0.22);
  if (car.damage.gSmoothed > car.damage.peakG) car.damage.peakG = car.damage.gSmoothed;
  car.damage.peakG = Math.max(0, car.damage.peakG * 0.99998);
  const ev = WORLD.time;
  if (car.damage.gSmoothed > 12 && ev - (car.lastGCall || -9) > 0.8) {
    car.lastGCall = ev;
    car.pushEvent('IMPACT', 'IMPACT OVERLOAD ' + car.damage.gSmoothed.toFixed(1) + ' G', 2.4);
  }
}

/* =========================================================================
   WORLD STEP
   ========================================================================= */
WORLD.cars = [];
WORLD.lastImpact = 0;

function worldSpawn(specId, opts) {
  const car = new SoftCar(specId, opts);
  car.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, reverse: false, auto: true };
  WORLD.cars.push(car);
  CARS.push(car);
  return car;
}

function worldStep(dt, substeps, stats) {
  substeps = substeps || 1;
  const h = dt / substeps;
  const cars = WORLD.cars;
  for (let s = 0; s < substeps; s++) {
    updateSlab(h);
    for (let i = 0; i < cars.length; i++) cars[i].substep(h);
    for (let i = 0; i < cars.length; i++) integrateNodes(cars[i], h);
    groundCollisions(cars);
    nodeNodeCollisions(cars);
    for (let i = 0; i < cars.length; i++) solveWheelLinks(cars[i]);
    for (let i = 0; i < cars.length; i++) solveBeams(cars[i], 2);
    for (let i = 0; i < cars.length; i++) { beamDamping(cars[i], h); finishNodes(cars[i], h); }
    WORLD.time += h;
    SIM_STEP_COUNT++;
  }
  if (stats !== false) updateWorldStats(dt);
}

function updateWorldStats(dt) {
  const cars = WORLD.cars;
  const inv = 1 / dt;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    car.centerPrev.x = car.center.x; car.centerPrev.y = car.center.y; car.centerPrev.z = car.center.z;
    car.updateCenter();
    car.lastFrameDt = dt;
    let mvx = 0, mvy = 0, mvz = 0, mc = 0;
    for (const n of car.nodes) { mvx += n.vel.x; mvy += n.vel.y; mvz += n.vel.z; mc++; }
    if (mc) { mvx /= mc; mvy /= mc; mvz /= mc; }
    car.bodyVel = { x: mvx, y: mvy, z: mvz };
    car.speed = Math.hypot(mvx, mvz);
    carBasis(car);
    car.roll = Math.atan2(car.frame.right.y, car.frame.up.y) * 57.2958;
    car.pitch = Math.asin(clamp(car.frame.fwd.y, -1, 1)) * 57.2958;
    updateCarDamage(car);
  }
}

function resetWorld() {
  slab.active = false;
  WORLD.time = 0;
  WORLD.events.length = 0;
  for (const c of WORLD.cars) c.reset(c.spawn.x, c.spawn.z, c.spawn.rot || 0);
}

/* -------------------------------------------------------------- test hook */
if (typeof window === 'undefined') {
  globalThis.JBEAM = {
    CAR_SPECS, SoftCar, WORLD, worldSpawn, worldStep, updateWorldStats, resetWorld, groundHeight,
    obstacles, slab, dropSlabAt, carBasis, V3, dist3, clamp
  };
}
