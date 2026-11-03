import { initRapier, type RapierModule } from './rapier';
import type { AssetEntry } from '../shared/types';
import type { AssetGeo } from './assetgeo';
import type {
  WorldSpec, MatchConfig, PlayerIntent, BotIntent, Vec3, Team, ClassId, Snapshot, GameEvent,
  EntitySnapshot, PlayerStateSnapshot, AiObservation, StepResult, StructureSpec, PropSpec, QualitySettings
} from '../shared/types';
import { FIXED_DT, GROUP, MATERIALS, materialOf, MAX_DEBRIS, MAX_PROJECTILES, STANCE } from '../shared/constants';
import { WEAPONS, VEHICLES, DIFFICULTY, MODES, CLASSES } from '../shared/config';
import { add, sub, mul, dot, len, norm, clamp, clampVec, dist, dist2, dirFromYawPitch, lerp, angleDiff, mulberry32 } from '../shared/mathx';
import { sampleTerrain, inWater, waterDepth } from '../shared/worldgen';

type RAPIER = RapierModule;
type RB = ReturnType<RapierModule['World']['prototype']['createRigidBody']>;

interface MeshPart { name: string; start: number; count: number; boxes: { c: Vec3; s: Vec3; ry: number }[]; vis: boolean }
interface MeshRecord {
  id: number; asset: string; parts: MeshPart[]; pos: Vec3; quat: [number, number, number, number];
  vis: Uint8Array; dirty: boolean; size: number; destroyed: boolean; fragment?: string | null; hidden?: boolean;
}
interface StructureInst {
  id: number; asset: string; x: number; z: number; y: number; ry: number; body: RB | null; mesh: MeshRecord;
  health: number; maxHealth: number; supports: { local: Vec3; hp: number; alive: boolean; name: string }[];
  walls: { name: string; local: Vec3; hp: number; maxHp: number; alive: boolean; partIndex: number }[];
  sections: { name: string; local: Vec3; hp: number; maxHp: number; alive: boolean; supportsLeft: number; totalSupports: number; meshId: number }[];
  collapsed: boolean; team: Team | null;
}
interface PropInst { id: number; asset: string; x: number; z: number; ry: number; body: RB | null; mesh: MeshRecord; dynamic: boolean; health: number; broken: boolean; fragment: string | null; size: number }
interface CharState {
  id: number; isPlayer: boolean; team: Team; cls: ClassId; pos: Vec3; vel: Vec3; yaw: number; pitch: number;
  hp: number; maxHp: number; stamina: number; oxygen: number; alive: boolean; stance: 0 | 1 | 2; crouchT: number;
  body: RB; mesh: MeshRecord; weapon: string; gadget: string; magazine: number; reserve: number; reloading: number;
  fireCooldown: number; recoil: number; vehicle: number | null; seat: number; name: string; kills: number; deaths: number; score: number;
  assists: number; captures: number; spawnProtect: number; lastDamage: number; suppressed: number; lastKilledBy: string | null;
  intent: PlayerIntent; ai: BotIntent | null; jumpCd: number; sprint: boolean; ads: boolean; breath: number;
  gadgetCharges: Record<string, number>; lastShot: number; burst: number; killsThisLife: number; damagers: Map<number, number>;
  order: 'follow' | 'attack' | 'defend' | 'none'; orderTarget: Vec3 | null; voiceCd: number; spottedBy: number[];
  headYaw: number; stepDist: number; fallStart: number | null; underwaterTime: number; lastGadget: number;
  enteredAt: number; pingT: number; aiState: string; reviveProgress: number; mortarCd: number;
  respawnAt?: number; eventsDrown?: boolean;
}
interface VehicleInst {
  id: number; asset: string; cfgName: string; mass: number; hp: number; maxHp: number; team: Team | null;
  body: RB; colliders: any[]; controller: any; drive: 'wheel' | 'track' | 'rail' | 'air' | 'boat';
  seats: number; occupants: (number | null)[]; mesh: MeshRecord; turretYaw: number; turretPitch: number;
  wheels: { x: number; z: number; r: number }[]; rotorAngle: number; rotorSpeed: number; engine: number;
  destroyed: boolean; burning: number; trackHp: number; engineHp: number; turretHp: number; ammoHp: number;
  fireCd: number; lastImpact: number; speed: number; throttle: number; steer: number; brake: number; ry: number;
  colliderHandle: number; seatMesh: number[]; landing: boolean; flightPitch: number; flightRoll: number; sinking: number;
  smoke: number; stuck: number; spawnProtect: number; rotorHp: number; yawInput: number;
}
interface Projectile {
  id: number; kind: string; pos: Vec3; vel: Vec3; owner: number; team: Team; life: number; damage: number;
  explosive: number; weapon: string; gravity: number; drag: number; tracer: boolean; penetrations: number;
  armed: boolean; fuse: number; radius: number; bounces: number; meshPos: Vec3; meshActive: boolean;
}
interface Debris { body: RB; size: number; meshId: number; born: number; metal: boolean; asleep: boolean }
interface Crater { x: number; z: number; r: number; depth: number }
interface McomState { id: number; x: number; z: number; y: number; armed: boolean; progress: number; destroyed: boolean; sector: number; team: Team }

export class SimEngine {
  R!: RAPIER;
  world: any;
  eventQueue: any;
  manifest!: Record<string, AssetEntry>;
  geo!: Record<string, AssetGeo>;
  spec!: WorldSpec;
  cfg!: MatchConfig;
  time = 0; tick = 0;
  rng = mulberry32(1337);
  chars = new Map<number, CharState>();
  vehicles = new Map<number, VehicleInst>();
  projectiles: Projectile[] = [];
  debris: Debris[] = [];
  meshes = new Map<number, MeshRecord>();
  structures: StructureInst[] = [];
  props: PropInst[] = [];
  playerId = 1;
  player: CharState | null = null;
  events: GameEvent[] = [];
  craters: Crater[] = [];
  points: { id: string; name: string; x: number; z: number; y: number; radius: number; owner: Team | null; progress: number; contested: number }[] = [];
  tickets: [number, number] = [350, 350];
  paused = false; started = false; over = false; winner: number | null = null; meshesSeeded = false;
  aiPending = false;
  quality: QualitySettings;
  nextId = 100;
  mcoms: McomState[] = [];
  sector = 0;
  wave = 0; wavesTotal = 5;
  terrainCollider: any = null;
  heightScale = 1;
  debrisCapped = MAX_DEBRIS;
  collapseSections = new Set<string>();
  destroyIndex = new Map<number, { kind: 'structure' | 'prop' | 'vehicle' | 'char' | 'debris'; ref: any }>();
  charBodies = new Map<number, { collider: any; body: RB }>();
  vehicleBodies = new Map<number, VehicleInst>();
  staticMeshes = 0;
  structureColliderHandles: number[] = [];
  pendingPropColliders: number[] = [];
  visionCache = new Map<number, { tick: number; list: { id: number; pos: Vec3; dist: number }[]; target: number | null }>();
  solidGrid: Uint8Array = new Uint8Array(0); gridCell = 6; gridN = 0;
  markSolid(cx: number, cz: number, dims: Vec3, ry: number, pad = 0) {
    const r = Math.hypot(dims[0], dims[2]) / 2 + pad;
    const n = this.gridN, half = this.spec.size / 2;
    const x0 = Math.max(0, Math.floor((cx - r + half) / this.gridCell)), x1 = Math.min(n - 1, Math.ceil((cx + r + half) / this.gridCell));
    const z0 = Math.max(0, Math.floor((cz - r + half) / this.gridCell)), z1 = Math.min(n - 1, Math.ceil((cz + r + half) / this.gridCell));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.solidGrid[z * n + x] = 1;
    void ry;
  }
  isSolidAt(x: number, z: number) {
    const n = this.gridN;
    if (!n) return true;
    const half = this.spec.size / 2;
    const gx = Math.floor((x + half) / this.gridCell), gz = Math.floor((z + half) / this.gridCell);
    if (gx < 0 || gz < 0 || gx >= n || gz >= n) return true;
    if (this.solidGrid[gz * n + gx]) return true;
    // small buildings may not fill a cell: test neighbours as well
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = gx + dx, nz = gz + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      if (this.solidGrid[nz * n + nx] && (dx === 0 || dz === 0)) return true;
    }
    return false;
  }
  lastTickMs = 0;
  lastSimMs = 0;
  prof: Record<string, number> = {};
  hulls = new Map<string, { boxes: { c: Vec3; s: Vec3; ry: number; part: string }[]; min: Vec3; max: Vec3; length: number; width: number; height: number }>();
  buildHulls() {
    for (const [id, geo] of Object.entries(this.geo)) {
      const boxes: { c: Vec3; s: Vec3; ry: number; part: string }[] = [];
      for (const part of geo.parts) {
        if ((id.startsWith('c_') || id.startsWith('w_') || id.startsWith('g_')) && part.name !== 'body') continue;
        if (part.name.includes('turret') || part.name === 'rotor' || part.name === 'tailrotor') continue;
        for (const b of part.boxes) {
          if (b.s[0] * b.s[1] * b.s[2] < 0.02) continue;
          if (b.s[0] > 60 || b.s[1] > 90 || b.s[2] > 60) continue;
          if (b.s[0] < 0.12 && b.s[1] < 0.12) continue;
          boxes.push({ c: b.c, s: b.s, ry: b.ry || 0, part: part.name });
        }
      }
      const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const b of boxes) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], b.c[k] - b.s[k] / 2); max[k] = Math.max(max[k], b.c[k] + b.s[k] / 2); }
      if (!boxes.length) { min[0] = min[1] = min[2] = -0.5; max[0] = max[1] = max[2] = 0.5; }
      this.hulls.set(id, { boxes, min, max, length: max[2] - min[2], width: max[0] - min[0], height: max[1] - min[1] });
    }
  }
  hullOf(id: string) { return this.hulls.get(id) ?? { boxes: [{ c: [0, 0, 0] as Vec3, s: [1, 1, 1] as Vec3, ry: 0, part: 'body' }], min: [0, 0, 0] as Vec3, max: [1, 1, 1] as Vec3, length: 1, width: 1, height: 1 }; }
  private profStart = 0;
  castTime = 0; castCount = 0; rayTime = 0; rayCount = 0; fireTime = 0;
  timedCast(...args: any[]) { const t = performance.now(); const r = this.world.castShape(...args); this.castTime += performance.now() - t; this.castCount++; return r; }
  profMark(name: string) { const now = performance.now(); if (this.profStart) this.prof[name] = (this.prof[name] ?? 0) + (now - this.profStart); this.profStart = now; }
  /** events raised outside of step() (debug hooks, mode scripts) are flushed by the next step */
  pendingEvents: GameEvent[] = [];

  /**
   * Explosion outside the tick loop. Events AND mesh dirtiness raised here are queued for the
   * next step, otherwise the following step() would clear them before the renderer sees them.
   */
  debugExplode(pos: Vec3, radius: number) {
    const prevEvents = this.events;
    this.events = this.pendingEvents;
    try {
      // aim at the middle of the building so blast exposure actually reaches the sections
      let cx = pos[0], cy = pos[1], cz = pos[2];
      let best: StructureInst | null = null, bd = Infinity;
      for (const st of this.structures) {
        const d = (st.x - pos[0]) ** 2 + (st.z - pos[2]) ** 2;
        if (d < bd) { bd = d; best = st; }
      }
      if (best && bd < (radius + 30) ** 2) { cx = best.x; cy = best.y + 2; cz = best.z; }
      this.explode([cx, cy, cz], radius, { id: 0, kind: 'test', pos: [cx, cy, cz], vel: [0, 0, 0], owner: 0, team: 0, life: 0, damage: 260, explosive: radius / 4, weapon: 'w_rpg7', gravity: 0, drag: 0, tracer: false, penetrations: 1, armed: true, fuse: 0, radius, bounces: 0, meshActive: false, meshPos: [cx, cy, cz] }, 'shell');
    } finally {
      this.events = prevEvents;
      // whatever this call broke must be re-sent: find changed masks by comparing with the last snapshot
      for (const [id, sent] of this.lastSentMasks) {
        const m = this.meshes.get(id);
        if (!m) continue;
        if (m.hidden !== sent.hidden || m.vis.some((v, i) => v !== sent.vis[i])) this.meshesDirtied.add(id);
      }
    }
  }
  meshesDirtied = new Set<number>();
  lastSentMasks = new Map<number, { vis: Uint8Array; hidden: boolean }>();
  collapseAll(st: StructureInst) { for (const sec of st.sections) if (sec.alive) this.collapseSection(st, sec); }
  statusText = '';
  lastSnapshot: Snapshot | null = null;
  public orders: { follow: number; attack: number; defend: number } = { follow: 0, attack: 0, defend: 0 };
  timeOfDay = 'day';
  commandPoint: string | null = null;
  log: string[] = [];

  constructor(quality: QualitySettings) { this.quality = quality; }

  async init(spec: WorldSpec, manifest: Record<string, AssetEntry>, geo: Record<string, AssetGeo>, cfg: MatchConfig) {
    this.R = await initRapier();
    this.spec = spec; this.manifest = manifest; this.geo = geo; this.cfg = cfg;
    this.world = new this.R.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.dt = FIXED_DT;
    this.eventQueue = new this.R.EventQueue(true);
    this.tickets = [cfg.tickets, cfg.tickets];
    this.timeOfDay = cfg.time;
    this.debrisCapped = Math.round(MAX_DEBRIS * clamp(cfg.quality.debris, 0.2, 2));
    this.buildHulls();
    this.buildTerrain();
    this.gridCell = Math.max(4, Math.round(this.spec.size / 340));
    this.gridN = Math.ceil(this.spec.size / this.gridCell);
    this.solidGrid = new Uint8Array(this.gridN * this.gridN);
    this.buildWorldObjects();
    this.spawnTeams();
    this.setupMode();
    // seed the first snapshot with every mesh mask (panel visibility for destruction)
    for (const m of this.meshes.values()) m.dirty = true;
    this.started = true;
  }

  /* ------------------------------- terrain ------------------------------- */
  buildTerrain() {
    const spec = this.spec, n = spec.res;
    const xs = spec.size / n, zs = spec.size / n;
    const hs = new Float32Array((n + 1) * (n + 1));
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) hs[j * (n + 1) + i] = spec.heights[j * (n + 1) + i];
    const scale = { x: spec.size, y: 1, z: spec.size };
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
    const desc = this.R.ColliderDesc.heightfield(n, n, hs, scale).setFriction(0.95).setCollisionGroups((GROUP.TERRAIN << 16) | 0xffff);
    this.terrainCollider = this.world.createCollider(desc, body);
  }

  groundY(x: number, z: number) { return sampleTerrain(this.spec, x, z); }

  /* --------------------------- world construction ------------------------ */
  buildWorldObjects() {
    for (const s of this.spec.structures) this.addStructure(s);
    for (const p of this.spec.props) this.addProp(p);
    for (const v of this.spec.vehicles) {
      const entry = this.manifest[v.asset];
      if (entry && (entry.category === 'vehicle' || entry.category === 'aircraft' || entry.category === 'boat')) this.addVehicle(v.asset, v.x, v.z, v.ry, v.team, v.id + 1000);
    }
  }

  meshId() { return this.nextId++; }

  registerMesh(asset: string, geo: AssetGeo, pos: Vec3, quat: [number, number, number, number]): MeshRecord {
    const id = this.meshId();
    const parts: MeshPart[] = [];
    let base = 0;
    for (const pg of geo.parts) {
      const triCount = pg.indices.length / 3;
      let maxG = 0;
      for (const g of pg.triGroup) maxG = Math.max(maxG, g);
      parts.push({ name: pg.name, start: base + triCount, count: 0, boxes: pg.boxes.slice(0, Math.max(0, maxG + 1)), vis: true });
      base += triCount;
    }
    void parts;
    const m: MeshRecord = { id, asset, parts, pos, quat, vis: new Uint8Array(geo.parts.length).fill(1), dirty: true, size: 3, destroyed: false, hidden: false };
    this.meshes.set(id, m);
    return m;
  }

  addStructure(s: StructureSpec) {
    const entry = this.manifest[s.asset];
    const geo = this.geo[s.asset];
    if (!entry || !geo) { console.warn('missing structure asset', s.asset); return; }
    const gy = this.groundY(s.x, s.z);
    const mesh = this.registerMesh(s.asset, geo, [s.x, gy, s.z], [0, Math.sin(s.ry / 2), 0, Math.cos(s.ry / 2)]);
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(s.x, gy, s.z).setRotation({ x: 0, y: Math.sin(s.ry / 2), z: 0, w: Math.cos(s.ry / 2) }));
    const cs = Math.cos(s.ry), sn = Math.sin(s.ry);
    let totalMass = 0;
    for (const part of geo.parts) {
      if (!part.boxes.length) continue;
      const groups = new Map<number, number[]>();
      for (let i = 0; i < part.triGroup.length; i++) {
        const g = part.triGroup[i];
        (groups.get(g) ?? groups.set(g, []).get(g)!).push(i);
      }
      const boxes = part.boxes;
      void groups;
      for (const box of boxes) {
        if (Math.min(box.s[0], box.s[1], box.s[2]) < 0.12) continue;
        if (box.s[0] * box.s[1] * box.s[2] < 0.02) continue;
        if (box.s[0] > 40 || box.s[1] > 80 || box.s[2] > 40) continue;
        const wx = s.x + box.c[0] * cs + box.c[2] * sn;
        const wz = s.z - box.c[0] * sn + box.c[2] * cs;
        const wy = gy + box.c[1];
        const ry = box.ry || 0;
        const desc = this.R.ColliderDesc.cuboid(Math.max(0.05, box.s[0] / 2), Math.max(0.05, box.s[1] / 2), Math.max(0.05, box.s[2] / 2))
          .setTranslation(box.c[0], box.c[1], box.c[2]).setRotation({ x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) })
          .setFriction(0.85).setRestitution(0.05)
          .setCollisionGroups((GROUP.BUILDING << 16) | 0xffff);
        const col = this.world.createCollider(desc, body);
        this.structureColliderHandles.push(col.handle);
        totalMass += box.s[0] * box.s[1] * box.s[2];
      }
    }
    void totalMass;
    const height = entry.building?.height ?? 10;
    const sections = entry.building?.sections ?? 1;
    const totalW = geo.max[0] - geo.min[0];
    const supported: StructureInst['supports'] = [];
    const walls: StructureInst['walls'] = [];
    const secArr: StructureInst['sections'] = [];
    const perSection = Math.max(1, sections);
    const sectionWidth = totalW / perSection;
    for (let k = 0; k < perSection; k++) {
      const cx = -totalW / 2 + sectionWidth / 2 + k * sectionWidth;
      secArr.push({ name: `section_${k}`, local: [cx, 0, 0], hp: height * 60, maxHp: height * 60, alive: true, supportsLeft: 4, totalSupports: 4, meshId: mesh.id });
      for (let j = 0; j < 4; j++) supported.push({ local: [cx + (j % 2 ? 1 : -1) * (sectionWidth / 2 - 0.6), 0, (j < 2 ? -1 : 1) * ((geo.max[2] - geo.min[2]) / 2 - 0.6)], hp: height * 14, alive: true, name: `col_${k}_${j}` });
    }
    geo.parts.forEach((part, idx) => {
      if (!part.name.startsWith('wall')) return;
      const b = part.boxes[0];
      if (!b) return;
      walls.push({ name: part.name, local: [b.c[0], b.c[1], b.c[2]], hp: 420, maxHp: 420, alive: true, partIndex: idx });
    });
    const inst: StructureInst = { id: s.id, asset: s.asset, x: s.x, z: s.z, y: gy, ry: s.ry, body, mesh, health: height * 90, maxHealth: height * 90, supports: supported, walls, sections: secArr, collapsed: false, team: null };
    this.markSolid(s.x, s.z, geo.max.map((v, i) => v - geo.min[i]) as Vec3, s.ry);
    this.structures.push(inst);
    for (const h of this.structureColliderHandles) this.destroyIndex.set(h, { kind: 'structure', ref: inst });
    this.structureColliderHandles = [];
    this.staticMeshes++;
  }

  addProp(p: PropSpec) {
    const entry = this.manifest[p.asset];
    const geo = this.geo[p.asset];
    if (!entry || !geo) return;
    const gy = this.groundY(p.x, p.z);
    const mesh = this.registerMesh(p.asset, geo, [p.x, gy, p.z], [0, Math.sin(p.ry / 2), 0, Math.cos(p.ry / 2)]);
    const dims: Vec3 = entry.dims;
    const bodyDesc = this.R.RigidBodyDesc[p.dynamic ? 'dynamic' : 'fixed']().setTranslation(p.x, gy + dims[1] / 2, p.z).setRotation({ x: 0, y: Math.sin(p.ry / 2), z: 0, w: Math.cos(p.ry / 2) });
    if (p.dynamic) bodyDesc.setLinearDamping(0.12).setAngularDamping(0.35).setCanSleep(true);
    const body = this.world.createRigidBody(bodyDesc);
    const mat = MATERIALS[materialOf(p.asset)] ?? MATERIALS.concrete;
    let collider;
    if (p.asset.includes('tree')) {
      collider = this.world.createCollider(this.R.ColliderDesc.cylinder(dims[1] * 0.28, Math.max(0.18, dims[0] * 0.12)).setTranslation(0, dims[1] * 0.28 - dims[1] / 2, 0).setFriction(0.8).setCollisionGroups((GROUP.PROP << 16) | 0xffff), body);
    } else {
      const hull = this.hullOf(p.asset);
      const multi = !p.dynamic && hull.boxes.length > 1 && hull.boxes.length < 40;
      collider = this.world.createCollider(this.R.ColliderDesc.cuboid(dims[0] / 2, dims[1] / 2, dims[2] / 2).setDensity(mat.density / 1000).setFriction(mat.friction).setRestitution(mat.restitution).setCollisionGroups((GROUP.PROP << 16) | 0xffff), body);
      if (multi) {
        const cy = (hull.min[1] + hull.max[1]) / 2;
        for (const b of hull.boxes) {
          if (b.s[0] * b.s[1] * b.s[2] < 0.05 || b.s[0] > 40) continue;
          const c2 = this.world.createCollider(this.R.ColliderDesc.cuboid(b.s[0] / 2, b.s[1] / 2, b.s[2] / 2).setTranslation(b.c[0], b.c[1] - cy, b.c[2]).setFriction(mat.friction).setCollisionGroups((GROUP.PROP << 16) | 0xffff), body);
          this.destroyIndex.set(c2.handle, { kind: 'prop', ref: null as any });
          this.pendingPropColliders.push(c2.handle);
        }
      }
      if (p.dynamic && p.asset.includes('fence')) { this.world.createCollider(this.R.ColliderDesc.cuboid(dims[0] / 2, 0.1, dims[2] / 2).setTranslation(0, 0, 0).setDensity(0.4).setFriction(0.8), body); }
    }
    if (!p.dynamic) this.markSolid(p.x, p.z, dims, p.ry, -1);
    const prop: PropInst = { id: p.id, asset: p.asset, x: p.x, z: p.z, ry: p.ry, body, mesh, dynamic: p.dynamic, health: p.dynamic ? 90 : 220, broken: false, fragment: null, size: Math.max(dims[0], dims[2]) };
    this.props.push(prop);
    this.destroyIndex.set(collider.handle, { kind: 'prop', ref: prop });
    for (const h of this.pendingPropColliders) this.destroyIndex.set(h, { kind: 'prop', ref: prop });
    this.pendingPropColliders = [];
  }

  /** occupied spawn footprints, so two machines are never stacked on the same spot */
  vehicleFootprints: { x: number; z: number; r: number }[] = [];
  freeVehicleSpot(x: number, z: number, r: number) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const clash = this.vehicleFootprints.some(f => (f.x - x) ** 2 + (f.z - z) ** 2 < (f.r + r + 1.2) ** 2);
      if (!clash) break;
      const a = this.rng() * Math.PI * 2, d = r + 3 + this.rng() * 6;
      x += Math.cos(a) * d; z += Math.sin(a) * d;
    }
    this.vehicleFootprints.push({ x, z, r });
    return { x, z };
  }

  /** local terrain grade (rise over run) sampled on a small cross */
  slopeAt(x: number, z: number): number {
    const e = 1.6;
    const hx = this.groundY(x + e, z) - this.groundY(x - e, z);
    const hz = this.groundY(x, z + e) - this.groundY(x, z - e);
    return Math.hypot(hx, hz) / (2 * e);
  }

  /**
   * Wheeled/tracked machines must not spawn on a bank: the suspension cannot reach the
   * ground and the vehicle slides with no wheel contact (invisible after the first bump).
   * Search a widening ring for a spot that is both free and flat enough.
   */
  parkVehicle(x: number, z: number, r: number, maxSlope = 0.22) {
    const spot = this.freeVehicleSpot(x, z, r);
    let best = spot, bestSlope = this.slopeAt(spot.x, spot.z);
    if (bestSlope <= maxSlope) return best;
    for (let i = 1; i <= 14; i++) {
      const a = (i * 2.399) % (Math.PI * 2), d = 4 + i * 3.2;
      const cx = spot.x + Math.cos(a) * d, cz = spot.z + Math.sin(a) * d;
      const s = this.slopeAt(cx, cz);
      if (s < bestSlope) { bestSlope = s; best = { x: cx, z: cz }; }
      if (bestSlope <= maxSlope * 0.6) break;
    }
    this.vehicleFootprints[this.vehicleFootprints.length - 1] = { x: best.x, z: best.z, r };
    return best;
  }

  addVehicle(asset: string, x: number, z: number, ry: number, team: Team | null, id: number) {
    const entry = this.manifest[asset];
    const geo = this.geo[asset];
    const cfg = VEHICLES[asset];
    if (!entry || !cfg) return null;
    const dims = entry.dims;
    const isAir = cfg.drive === 'air';
    const spot = cfg.drive === 'wheel' || cfg.drive === 'track'
      ? this.parkVehicle(x, z, Math.max(2.5, dims[0] / 2))
      : this.freeVehicleSpot(x, z, Math.max(2.5, dims[0] / 2));
    x = spot.x; z = spot.z;
    const hullPre = this.hullOf(asset);
    const cyPre = (hullPre.min[1] + hullPre.max[1]) / 2;
    // the body origin is the hull centre, so the undercarriage sits (cy - min.y) below it;
    // placing the body by dims[1]/2 left the wheels hanging above the ground.
    const undercarriage = cyPre - hullPre.min[1];
    // ride height for a car = floor clearance + wheel radius + suspension travel; spawning lower
    // embeds the chassis in the terrain and Rapier fires it into the sky
    const rideHeight = undercarriage + (entry.wheelRadius ?? 0.4) + (entry.wheels?.length ? 0.56 : 0);
    const gy = isAir
      ? this.groundY(x, z) + (asset === 'v_su25' ? 1.4 : 1.6)
      : this.groundY(x, z) + (cfg.drive === 'wheel' || cfg.drive === 'track' ? rideHeight + 0.05 : undercarriage + 0.05);
    const mesh = this.registerMesh(asset, geo, [x, gy, z], [0, Math.sin(ry / 2), 0, Math.cos(ry / 2)]);
    const bodyDesc = this.R.RigidBodyDesc.dynamic().setTranslation(x, gy, z).setRotation({ x: 0, y: Math.sin(ry / 2), z: 0, w: Math.cos(ry / 2) })
      .setLinearDamping(isAir ? 0.55 : 0.08).setAngularDamping(isAir ? 2.2 : 0.6).setCcdEnabled(true);
    const body = this.world.createRigidBody(bodyDesc);
    const colliders: any[] = [];
    const hull = this.hullOf(asset);
    const cy = (hull.min[1] + hull.max[1]) / 2;
    for (const b of hull.boxes) {
      if (b.s[0] * b.s[1] * b.s[2] < 0.35) continue;
      if ((b.part.startsWith('wheel_') || b.part === 'body' || b.part === 'rotor' || b.part === 'tailrotor')) continue;
      if (b.c[1] < hull.min[1] + 0.25) continue;
      colliders.push(this.world.createCollider(this.R.ColliderDesc.cuboid(b.s[0] / 2, b.s[1] / 2, b.s[2] / 2)
        .setTranslation(b.c[0], b.c[1] - cy, b.c[2]).setFriction(0.4).setRestitution(0.1)
        .setCollisionGroups((GROUP.VEHICLE << 16) | 0xffff), body));
    }
    if (!colliders.length) colliders.push(this.world.createCollider(this.R.ColliderDesc.cuboid(dims[0] / 2, dims[1] / 2, dims[2] / 2).setCollisionGroups((GROUP.VEHICLE << 16) | 0xffff), body));
    // The chassis must weigh what the vehicle config says (41 t for a T-72, 1.7 t for a UAZ):
    // collider volumes alone gave a 16 kg UAZ, so wheel forces behaved like a toy.
    const hullVol = Math.max(0.5, dims[0] * dims[1] * dims[2] * 0.55);
    const density = cfg.mass / hullVol;
    for (const c of colliders) c.setDensity(density);
    for (const c of colliders) { this.destroyIndex.set(c.handle, { kind: 'vehicle', ref: null as any }); }
    (this as any).pendingVehicleColliders = (this as any).pendingVehicleColliders ?? [];
    (this as any).pendingVehicleColliders.push({ id, recs: colliders });
    let controller: any = null;
    const wheels = (entry.wheels ?? []).map(([wx, wz]) => ({ x: wx, z: wz, r: entry.wheelRadius ?? 0.4 }));
    if (cfg.drive === 'wheel' || cfg.drive === 'track') {
      controller = this.world.createVehicleController(body);
      const r = entry.wheelRadius ?? 0.4;
      // wheels hang from the hull floor, not from a fraction of the bounding box, otherwise
      // the suspension ray ends inside the chassis and the machine slides on its belly
      const wheelY = hull.min[1] - cy - 0.04;
      const travel = clamp(0.34 + undercarriage * 0.25, 0.34, 0.85);
      for (const w of wheels) {
        controller.addWheel({ x: w.x, y: wheelY, z: w.z }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, travel, w.r);
        const idx = controller.numWheels() - 1;
        controller.setWheelSuspensionStiffness(idx, cfg.drive === 'track' ? 60 : 38);
        controller.setWheelSuspensionCompression(idx, 0.75);
        controller.setWheelSuspensionRelaxation(idx, 0.35);
        controller.setWheelMaxSuspensionTravel(idx, travel);
        controller.setWheelFrictionSlip(idx, cfg.drive === 'track' ? 1.6 : 1.4);
      }
    }
    const inst: VehicleInst = {
      id, asset, cfgName: asset, mass: cfg.mass, hp: cfg.hp, maxHp: cfg.hp, team,
      body, colliders, controller, drive: cfg.drive, seats: cfg.seats, occupants: new Array(cfg.seats).fill(null),
      mesh, turretYaw: 0, turretPitch: 0, wheels, rotorAngle: 0, rotorSpeed: 0, engine: 0,
      destroyed: false, burning: 0, trackHp: 100, engineHp: 100, turretHp: 100, ammoHp: 100,
      fireCd: 0, lastImpact: 0, speed: 0, throttle: 0, steer: 0, brake: 1, ry,
      colliderHandle: colliders[0]?.handle ?? -1, seatMesh: [], landing: false, flightPitch: 0, flightRoll: 0, sinking: 0, smoke: 0, stuck: 0, spawnProtect: 0, rotorHp: 1, yawInput: 0
    };
    this.vehicles.set(id, inst);
    for (const c of colliders) this.destroyIndex.set(c.handle, { kind: 'vehicle', ref: inst });
    return inst;
  }

  /* ------------------------------- entities ------------------------------ */
  spawnTeams() {
    const teamCounts: [number, number] = [0, 0];
    const total = this.cfg.bots;
    const classes: ClassId[] = ['assault', 'engineer', 'support', 'recon'];
    for (let i = 0; i < total; i++) {
      const team: Team = (i % 2 === 0 ? 0 : 1);
      teamCounts[team]++;
      const cls = classes[i % 4];
      const spawn = this.pickSpawn(team);
      this.spawnCharacter({ id: 100 + i, team, cls, isPlayer: false, x: spawn.x, z: spawn.z, name: `${team === 0 ? 'Сокол' : 'Ворон'}-${Math.floor(i / 2) + 1}` });
    }
    const pspawn = this.pickSpawn(this.cfg.playerTeam);
    this.player = this.spawnCharacter({ id: this.playerId, team: this.cfg.playerTeam, cls: 'assault', isPlayer: true, x: pspawn.x, z: pspawn.z, name: 'Игрок' });
    for (const pt of this.spec.points) {
      this.points.push({ id: pt.id, name: pt.name, x: pt.x, z: pt.z, y: this.groundY(pt.x, pt.z), radius: pt.radius, owner: pt.initial ?? null, progress: 0, contested: 0 });
    }
    this.tickets = [this.cfg.tickets, this.cfg.tickets];
  }

  pickSpawn(team: Team) {
    const spawns = this.spec.teamSpawns[String(team) as '0' | '1'];
    const owned = this.points.filter(p => p.owner === team);
    const base = spawns[Math.floor(this.rng() * spawns.length)] ?? { x: 0, z: 0 };
    const usePoint = owned.length > 0 && this.rng() < 0.5 ? owned[Math.floor(this.rng() * owned.length)] : null;
    const cx = usePoint ? usePoint.x : base.x, cz = usePoint ? usePoint.z : base.z;
    const a = this.rng() * Math.PI * 2, r = 6 + this.rng() * 18;
    return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
  }

  spawnCharacter(opts: { id: number; team: Team; cls: ClassId; isPlayer: boolean; x: number; z: number; name: string; yaw?: number }) {
    const cfg = CLASSES[opts.cls];
    const weapon = cfg.weapons[0], gadget = cfg.gadgets[0];
    const y = this.groundY(opts.x, opts.z) + 1.0;
    const bodyDesc = this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(opts.x, y, opts.z);
    const body = this.world.createRigidBody(bodyDesc);
    const collider = this.world.createCollider(this.R.ColliderDesc.capsule(0.55, 0.35).setFriction(0.4).setCollisionGroups((GROUP.CHARACTER << 16) | 0xffff), body);
    const geo = this.geo[`c_soldier`];
    const mesh = this.registerMesh('c_soldier', geo, [opts.x, y, opts.z], [0, 0, 0, 1]);
    const ch: CharState = {
      id: opts.id, isPlayer: opts.isPlayer, team: opts.team, cls: opts.cls, pos: [opts.x, y, opts.z], vel: [0, 0, 0],
      yaw: opts.yaw ?? (opts.team === 0 ? 0 : Math.PI), pitch: 0, hp: 100, maxHp: 100, stamina: 1, oxygen: 1, alive: true,
      stance: 0, crouchT: 0, body, mesh, weapon, gadget, magazine: WEAPONS[weapon].magazine, reserve: WEAPONS[weapon].magazine * 6,
      reloading: 0, fireCooldown: 0, recoil: 0, vehicle: null, seat: -1, name: opts.name, kills: 0, deaths: 0, score: 0,
      assists: 0, captures: 0, spawnProtect: 2, lastDamage: -10, suppressed: 0, lastKilledBy: null,
      intent: { move: [0, 0], yaw: 0, pitch: 0, fire: false, ads: false, sprint: false, jump: false, crouch: false, prone: false, reload: false, interact: false, gadget: false, melee: false },
      ai: null, jumpCd: 0, sprint: false, ads: false, breath: 0, gadgetCharges: { [gadget]: 3, [cfg.gadgets[1]]: 2 }, lastShot: -99,
      burst: 0, killsThisLife: 0, damagers: new Map(), order: 'none', orderTarget: null, voiceCd: 0, spottedBy: [],
      headYaw: 0, stepDist: 0, fallStart: null, underwaterTime: 0, lastGadget: -99, enteredAt: 0, pingT: 0,
      aiState: 'advance', reviveProgress: 0, mortarCd: 0
    };
    this.chars.set(ch.id, ch);
    this.charBodies.set(ch.id, { collider, body });
    return ch;
  }

  /* -------------------------------- modes -------------------------------- */
  setupMode() {
    const mode = this.cfg.mode;
    if (mode === 'rush') {
      this.mcoms = [];
      let id = 0;
      for (let sector = 0; sector < 2; sector++) {
        for (let k = 0; k < 2; k++) {
          const pt = this.points[sector === 0 ? this.points.length - 1 : Math.floor(this.points.length / 2)];
          const ang = k * Math.PI + sector;
          const x = pt.x + Math.cos(ang) * 22, z = pt.z + Math.sin(ang) * 22;
          this.mcoms.push({ id: id++, x, z, y: this.groundY(x, z), armed: false, progress: 0, destroyed: false, sector, team: 1 });
        }
      }
      this.tickets = [Math.floor(this.cfg.tickets / 2), this.cfg.tickets];
    } else if (mode === 'holdout') {
      const pt = this.points[0];
      this.tickets = [this.cfg.tickets, 999];
      this.wave = 1;
      this.points.forEach(p => { p.owner = 0; });
    } else if (mode === 'range') {
      // polygon: no tickets, no capture pressure — targets and demolition stands instead
      this.tickets = [999, 999];
      this.points.forEach(p => { p.owner = 0; });
      this.spawnRangeTargets();
    }
  }

  /** static steel targets and explosive barrels placed down-range from the player spawn */
  rangeTargets: { body: RB; x: number; z: number; y: number; hit: boolean; kind: 'target' | 'barrel' }[] = [];
  rangeHits = 0;
  spawnRangeTargets() {
    const base = this.spec.teamSpawns['0'][0] ?? { x: 0, z: 0 };
    const dirX = -base.x, dirZ = -base.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    const ux = dirX / len, uz = dirZ / len;
    for (let row = 0; row < 5; row++) {
      for (let col = -2; col <= 2; col++) {
        const d = 28 + row * 16;
        const x = base.x + ux * d - uz * col * 7;
        const z = base.z + uz * d + ux * col * 7;
        const gy = this.groundY(x, z);
        const kind = (row + col) % 3 === 0 ? 'barrel' : 'target';
        const h = kind === 'barrel' ? 0.9 : 1.7;
        const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed().setTranslation(x, gy + h / 2, z));
        this.world.createCollider(this.R.ColliderDesc.cuboid(kind === 'barrel' ? 0.3 : 0.5, h / 2, kind === 'barrel' ? 0.3 : 0.06).setFriction(0.7), body);
        this.destroyIndex.set(body.handle, { kind: 'prop', ref: { asset: kind === 'barrel' ? 'p_barrel' : 'p_crate', id: -1, health: 1 } as any });
        this.rangeTargets.push({ body, x, z, y: gy, hit: false, kind });
      }
    }
  }

  /* ------------------------------- main step ----------------------------- */
  stepAI(intents: BotIntent[]) {
    for (const it of intents) {
      const c = this.chars.get(it.id);
      if (!c || c.isPlayer || !c.alive) continue;
      c.ai = it;
      // support intents from the AI worker: engineers patch vehicles, medics pick up downed allies
      if (it.repair) this.botRepair(c);
      if (it.revive) this.botRevive(c);
    }
    this.aiPending = false;
  }

  /** Engineer bots repair the nearest friendly vehicle they are standing next to. */
  botRepairCount = 0;
  botReviveCount = 0;
  botRepair(ch: CharState) {
    let best: VehicleInst | null = null;
    let bd = 7;
    for (const v of this.vehicles.values()) {
      const t = v.body.translation();
      const d = dist([t.x, t.y, t.z], ch.pos);
      if (d < bd && !v.destroyed && (v.hp < v.maxHp * 0.92 || v.trackHp < 85 || v.engineHp < 85)) { bd = d; best = v; }
    }

    if (!best) return;
    best.hp = Math.min(best.maxHp, best.hp + best.maxHp * 0.18);
    best.trackHp = Math.min(100, best.trackHp + 26);
    best.engineHp = Math.min(100, best.engineHp + 20);
    this.botRepairCount++;
    const t = best.body.translation();
    this.events.push({ e: 'sound', pos: [t.x, t.y, t.z], kind: 'repair', volume: 0.5 });
  }

  /** Medic / any bot revives a downed teammate within reach (bleed-out model: hp 0 but not yet dead). */
  botRevive(ch: CharState) {
    let best: CharState | null = null;
    let bd = 3.4;
    for (const o of this.chars.values()) {
      if (o === ch || o.alive || o.team !== ch.team || o.isPlayer) continue;
      if ((o as any).respawnAt && this.time > (o as any).respawnAt - 0.2) continue;
      const d = dist(o.pos, ch.pos);
      if (d < bd) { bd = d; best = o; }
    }

    if (!best) return;
    best.hp = Math.max(35, best.maxHp * 0.4);
    best.alive = true;
    (best as any).respawnAt = undefined;
    best.body.setTranslation({ x: best.pos[0], y: best.pos[1], z: best.pos[2] }, true);
    this.botReviveCount++;
    this.events.push({ e: 'notice', text: `${ch.name} поднял ${best.name}` });
  }

  step(dt = FIXED_DT): StepResult {
    if (!this.started || this.paused) return this.frameResult([]);
    this.events = [];
    if (this.pendingEvents.length) { this.events.push(...this.pendingEvents); this.pendingEvents.length = 0; }
    // masks changed outside a tick (debug/scripted explosions) are re-dirtied here, never silently lost
    if (this.meshesDirtied.size) {
      for (const id of this.meshesDirtied) { const m = this.meshes.get(id); if (m) m.dirty = true; }
      this.meshesDirtied.clear();
    }
    const t0 = performance.now();
    this.profStart = t0;
    this.time += dt; this.tick++;
    this.updateCharacters(dt); this.profMark('chars');
    this.updateVehicles(dt); this.profMark('vehicles');
    this.updateProjectiles(dt); this.profMark('projectiles');
    this.updateProps(dt); this.profMark('props');
    this.updateDebris(dt); this.profMark('debris');
    this.updateWorldCues(dt); this.profMark('cues');
    pumpTimers(this);
    this.updateModes(dt); this.profMark('modes');
    this.world.step(this.eventQueue); this.profMark('step');
    this.collectContacts(); this.profMark('contacts');
    const t1 = performance.now();
    this.lastSimMs = t1 - t0;
    const res = this.frameResult(this.events);
    this.lastTickMs = performance.now() - t0;
    if (this.tick % 10 === 0) { this.castTime = 0; this.castCount = 0; this.rayTime = 0; this.rayCount = 0; this.prof = {}; }
    return res;
  }

  frameResult(events: GameEvent[]): StepResult {
    const snapshot = this.buildSnapshot();
    this.lastSnapshot = snapshot;
    return { t: 'frame', tick: this.tick, time: this.time, snapshot, events };
  }

  /* ------------------------------ characters ----------------------------- */
  updateCharacters(dt: number) {
    for (const ch of this.chars.values()) {
      if (!ch.alive) { ch.body = ch.body; continue; }
      ch.lastDamage += dt;
      ch.spawnProtect = Math.max(0, ch.spawnProtect - dt);
      ch.suppressed = Math.max(0, ch.suppressed - dt * 0.7);
      ch.voiceCd = Math.max(0, ch.voiceCd - dt);
      if (ch.reloading > 0) ch.reloading = Math.max(0, ch.reloading - dt);
      ch.fireCooldown = Math.max(0, ch.fireCooldown - dt);
      ch.mortarCd = Math.max(0, ch.mortarCd - dt);
      if (ch.vehicle !== null && this.vehicles.get(ch.vehicle)?.drive === 'air') { this.updateAircrew(ch, dt); continue; }
      const wantSprint = ch.isPlayer ? ch.intent.sprint : (ch.ai?.speed ?? 1) > 1.2;
      let mx = ch.isPlayer ? ch.intent.move[0] : (ch.ai?.move[0] ?? 0);
      let mz = ch.isPlayer ? ch.intent.move[1] : (ch.ai?.move[1] ?? 0);
      if (ch.vehicle !== null) { mx = 0; mz = 0; }
      const mlen = Math.hypot(mx, mz);
      if (mlen > 1) { mx /= mlen; mz /= mlen; }
      const targetStance: 0 | 1 | 2 = ch.isPlayer ? (ch.intent.prone ? 2 : ch.intent.crouch ? 1 : 0) : (ch.ai?.stance === 2 ? 2 : ch.ai?.stance === 1 ? 1 : 0);
      ch.stance = targetStance;
      const height = STANCE[['stand', 'crouch', 'prone'][ch.stance] as 'stand'];
      const eyeH = 1.65 * height;
      let speed = mlen > 0.1 ? (ch.stance === 2 ? 1.1 : ch.stance === 1 ? 2.6 : wantSprint && ch.stamina > 0.05 ? 8.4 : 5) : 0;
      if (ch.ads) speed = Math.min(speed, 3.2);
      if (ch.stance === 0 && wantSprint && mlen > 0.1) { ch.stamina = Math.max(0, ch.stamina - dt * 0.16); if (ch.stamina <= 0.02) speed = 5; }
      else ch.stamina = Math.min(1, ch.stamina + dt * (mlen > 0.1 ? 0.07 : 0.16));
      ch.sprint = wantSprint && ch.stamina > 0.05 && mlen > 0.1 && !ch.ads;
      const yawTarget = ch.isPlayer ? ch.intent.yaw : (ch.ai?.yaw ?? ch.yaw);
      ch.yaw += angleDiff(ch.yaw, yawTarget) * Math.min(1, dt * (ch.isPlayer ? 30 : 8));
      ch.pitch = ch.isPlayer ? ch.intent.pitch : lerp(ch.pitch, ch.ai?.pitch ?? 0, Math.min(1, dt * 6));
      const fwd: Vec3 = [-Math.sin(ch.yaw), 0, -Math.cos(ch.yaw)];
      const right: Vec3 = [Math.cos(ch.yaw), 0, -Math.sin(ch.yaw)];
      const desired: Vec3 = [fwd[0] * mz + right[0] * mx, 0, fwd[2] * mz + right[2] * mx];
      const depth = waterDepth(this.spec, ch.pos[0], ch.pos[2]);
      const swimming = depth > 1.4;
      if (swimming) {
        // submerged: oxygen drains (faster the deeper you are), then drowning damage starts
        const submerged = depth > 1.9;
        if (submerged) {
          ch.oxygen = Math.max(0, ch.oxygen - dt * (depth > 3 ? 0.055 : 0.04));
          ch.underwaterTime += dt;
          if (ch.oxygen <= 0) this.damageCharacter(ch, 16 * dt, null, 'Утопление', false);
        } else {
          ch.oxygen = Math.min(1, ch.oxygen + dt * 0.25);
        }
        speed = Math.min(speed, submerged ? 3.2 : 4.4);
      } else { ch.oxygen = Math.min(1, ch.oxygen + dt * 0.3); ch.underwaterTime = 0; }
      const groundH = this.groundY(ch.pos[0], ch.pos[2]);
      const slope = (() => {
        const e = 1.2;
        const hx = this.groundY(ch.pos[0] + e, ch.pos[2]) - this.groundY(ch.pos[0] - e, ch.pos[2]);
        const hz = this.groundY(ch.pos[0], ch.pos[2] + e) - this.groundY(ch.pos[0], ch.pos[2] - e);
        return Math.hypot(hx, hz) / (2 * e);
      })();
      const sliding = slope > 1.19 && !swimming;
      const moveVel: Vec3 = sliding ? [desired[0] * speed * 0.3 + (this.groundY(ch.pos[0] + 1, ch.pos[2]) - groundH) * -2, -1.2, desired[2] * speed * 0.3] : [desired[0] * speed, ch.vel[1], desired[2] * speed];
      // gravity / jump / fall damage
      if (ch.pos[1] > groundH + 1.2 + height * 0.5) { ch.vel[1] -= 9.81 * dt; if (ch.fallStart === null) ch.fallStart = ch.pos[1]; }
      else { ch.vel[1] = Math.max(0, ch.vel[1]); if (ch.fallStart !== null) { const drop = ch.fallStart - ch.pos[1]; if (drop > 6 && !swimming) this.damageCharacter(ch, (drop - 6) * 7.5, null, 'Падение', false); ch.fallStart = null; } }
      const jump = ch.isPlayer ? ch.intent.jump : ch.ai?.jump;
      if (jump && ch.jumpCd <= 0 && (ch.pos[1] <= groundH + 1.4 + height * 0.5 || swimming)) { ch.vel[1] = 4.6; ch.jumpCd = 0.8; }
      ch.jumpCd = Math.max(0, ch.jumpCd - dt);
      // integrate with collision resolution against the physics world
      let next: Vec3 = [ch.pos[0] + moveVel[0] * dt, ch.pos[1] + ch.vel[1] * dt, ch.pos[2] + moveVel[2] * dt];
      const floorY = (swimming ? this.spec.water!.level - 0.9 : groundH + height * 0.55) + (swimming ? 0 : 0.02);
      if (next[1] < floorY) { if (ch.vel[1] < -6.5 && ch.fallStart === null) ch.fallStart = null; next[1] = floorY; ch.vel[1] = 0; }
      // character vs static/dynamic world using shape cast (prevents walking through walls)
      const dir = sub(next, ch.pos);
      const dl = len(dir);
      const nearSolid = this.isSolidAt(next[0], next[2]) || this.isSolidAt(ch.pos[0], ch.pos[2]);
      if (dl > 1e-5 && nearSolid) {
        const hit = this.timedCast(
          { x: ch.pos[0], y: ch.pos[1], z: ch.pos[2] }, { x: 0, y: 0, z: 0, w: 1 },
          { x: dir[0] / dl, y: dir[1] / dl, z: dir[2] / dl }, new this.R.Capsule(0.55, 0.35), 0.02, dl,
          true, undefined, undefined, undefined, undefined, (col: any) => {
            const groups = col.collisionGroups();
            return ((groups >>> 16) & (GROUP.CHARACTER | GROUP.PROJECTILE | GROUP.WATER)) === 0;
          }
        );
        if (hit) { const t = Math.max(0, hit.time_of_impact - 0.02); next = [ch.pos[0] + dir[0] / dl * t, ch.pos[1] + dir[1] / dl * t, ch.pos[2] + dir[2] / dl * t]; }
      }
      // block against vehicle bodies (enter instead of pass through)
      for (const v of this.vehicles.values()) {
        const vp = v.body.translation();
        const d2 = (vp.x - next[0]) ** 2 + (vp.z - next[2]) ** 2;
        if (d2 > 400) continue;
        const dims = this.manifest[v.asset].dims;
        if (d2 < (dims[0] * 0.6) ** 2 + (dims[2] * 0.5) ** 2 + 1 && Math.abs(vp.y - next[1]) < dims[1]) {
          const push = norm([next[0] - vp.x, 0, next[2] - vp.z]);
          const rr = Math.max(dims[0], dims[2]) * 0.5 + 0.3;
          next = [vp.x + push[0] * rr, next[1], vp.z + push[2] * rr];
        }
      }
      const bound = this.spec.size / 2 - 8;
      next = [clamp(next[0], -bound, bound), next[1], clamp(next[2], -bound, bound)];
      ch.pos = next;
      ch.body.setNextKinematicTranslation({ x: ch.pos[0], y: ch.pos[1], z: ch.pos[2] });
      ch.mesh.pos = [ch.pos[0], ch.pos[1] - height * 0.55 - 0.15, ch.pos[2]];
      ch.mesh.quat = [0, Math.sin(ch.yaw / 2), 0, Math.cos(ch.yaw / 2)];
      if (ch.isPlayer) this.handlePlayerWeapons(ch, dt);
      else this.handleBotWeapons(ch, dt);
      if (ch.hp <= 0) this.killCharacter(ch, ch.lastKilledBy);
      // footstep cadence for audio/anim
      const wspeed = Math.hypot(moveVel[0], moveVel[2]);
      ch.stepDist += wspeed * dt;
      if (ch.stepDist > 1.9) { ch.stepDist = 0; this.events.push({ e: 'sound', pos: [...ch.pos], kind: swimming ? 'water_step' : 'step', volume: 0.35 }); }
    }
  }

  updateAircrew(ch: CharState, dt: number) {
    const v = this.vehicles.get(ch.vehicle!);
    if (!v) { ch.vehicle = null; return; }
    ch.pos = [v.body.translation().x, v.body.translation().y, v.body.translation().z];
    if (ch.isPlayer) this.handlePlayerWeapons(ch, dt);
    else this.handleBotWeapons(ch, dt);
  }

  updatePlayerIntent(intent: PlayerIntent) {
    if (this.player) this.player.intent = intent;
  }

  currentWeapon(ch: CharState) {
    const w = WEAPONS[ch.weapon] ?? WEAPONS.w_ak74;
    return w;
  }

  eyePos(ch: CharState): Vec3 {
    const h = ch.stance === 2 ? 0.35 : ch.stance === 1 ? 1.15 : 1.62;
    return [ch.pos[0], ch.pos[1] - 0.45 + h, ch.pos[2]];
  }

  handlePlayerWeapons(ch: CharState, dt: number) {
    const it = ch.intent;
    ch.ads = it.ads;
    if (it.reload && ch.magazine < this.currentWeapon(ch).magazine && ch.reloading <= 0) this.startReload(ch);
    if (it.gadget) { this.useGadget(ch, false); ch.intent.gadget = false; }
    if (it.melee) { this.melee(ch); ch.intent.melee = false; }
    if (it.interact) { this.interact(ch); ch.intent.interact = false; }
    if (it.fire && ch.fireCooldown <= 0 && ch.reloading <= 0) {
      if (ch.magazine > 0) this.fireWeapon(ch);
      else { this.startReload(ch); }
    }
    ch.breath = clamp(ch.breath - dt * (ch.ads ? 0.08 : -0.15), 0, 1);
  }

  handleBotWeapons(ch: CharState, dt: number) {
    const it = ch.ai;
    if (!it) return;
    ch.ads = ch.stance === 2;
    if (it.reload && ch.reloading <= 0 && ch.magazine < this.currentWeapon(ch).magazine) this.startReload(ch);
    if (it.gadget) { this.useGadget(ch, true); it.gadget = false; }
    if (it.fire && ch.fireCooldown <= 0 && ch.reloading <= 0 && ch.magazine > 0) {
      const target = it.target != null ? this.chars.get(it.target) : null;
      if (target && target.alive) {
        const eye = this.eyePos(ch);
        const tp = this.eyePos(target);
        const d = dist(eye, tp);
        const skill = DIFFICULTY[this.cfg.difficulty].accuracy;
        const suppressionPenalty = ch.suppressed * 0.4 + (target.sprint ? 0.12 : 0) + (d > 120 ? 0.15 : 0);
        const spread = clamp(1 - skill + suppressionPenalty, 0.05, 1) * 0.055 * (d / 60 + 0.4);
        const aim: Vec3 = [tp[0] + (this.rng() - 0.5) * spread * d * 0.25, tp[1] + (this.rng() - 0.5) * spread * d * 0.15, tp[2] + (this.rng() - 0.5) * spread * d * 0.25];
        ch.yaw = Math.atan2(-(aim[0] - eye[0]), -(aim[2] - eye[2]));
        ch.pitch = Math.atan2(aim[1] - eye[1], Math.hypot(aim[0] - eye[0], aim[2] - eye[2]));
        this.fireWeapon(ch, aim);
      }
    }
    if (ch.magazine <= 0 && ch.reloading <= 0) this.startReload(ch);
  }

  startReload(ch: CharState) {
    const w = this.currentWeapon(ch);
    if (ch.reserve <= 0) return;
    ch.reloading = w.reload;
    const need = w.magazine - ch.magazine;
    if (ch.isPlayer) this.events.push({ e: 'reload', state: 1, weapon: ch.weapon });
    setTimeoutSim(this, w.reload, () => {
      if (!ch.alive) return;
      const take = Math.min(need, ch.reserve);
      ch.magazine += take; ch.reserve -= take;
      if (ch.isPlayer) this.events.push({ e: 'reload', state: 0, weapon: ch.weapon });
    });
  }

  fireWeapon(ch: CharState, aimPoint?: Vec3) {
    const w = this.currentWeapon(ch);
    if (ch.magazine <= 0) return;
    ch.magazine--;
    ch.fireCooldown = 60 / w.rpm;
    ch.lastShot = this.time;
    ch.burst++;
    const eye = this.eyePos(ch);
    const dir = aimPoint ? norm(sub(aimPoint, eye)) : dirFromYawPitch(ch.yaw, ch.pitch);
    const moving = Math.hypot(ch.vel[0], ch.vel[2]) > 0.5;
    const spread = w.spread * (ch.ads ? 0.45 : 1) * (ch.stance === 2 ? 0.6 : ch.stance === 1 ? 0.8 : 1) * (moving ? 1.9 : 1) * (1 + ch.recoil * 0.35);
    const jittered: Vec3 = norm([dir[0] + (this.rng() - 0.5) * spread * 2, dir[1] + (this.rng() - 0.5) * spread * 2, dir[2] + (this.rng() - 0.5) * spread * 2]);
    ch.recoil = Math.min(2.4, ch.recoil + w.recoil * 0.16);
    if (ch.isPlayer) ch.pitch = clamp(ch.pitch + w.recoil * 0.004 * (ch.ads ? 0.7 : 1), -1.5, 1.5);
    const start: Vec3 = [eye[0] + jittered[0] * 0.6, eye[1] + jittered[1] * 0.6, eye[2] + jittered[2] * 0.6];
    const projectileKind = w.projectile ?? 'bullet';
    if (projectileKind === 'bullet') {
      this.addProjectile({ kind: 'bullet', pos: start, vel: mul(jittered, w.muzzle), owner: ch.id, team: ch.team, damage: w.damage, explosive: 0, weapon: ch.weapon, gravity: -9.81, drag: 0.0009, penetration: w.penetration ?? 0.5, life: 4 });
    } else if (projectileKind === 'rocket') {
      this.addProjectile({ kind: 'rocket', pos: start, vel: mul(jittered, w.muzzle), owner: ch.id, team: ch.team, damage: w.damage, explosive: w.explosive ?? 3, weapon: ch.weapon, gravity: -2.2, drag: 0.0004, penetration: 1.2, life: 8, armed: false, fuse: 0 });
    } else if (projectileKind === 'grenade' || projectileKind === 'mortar') {
      const speed = projectileKind === 'mortar' ? 120 : 18 + (ch.pitch + 0.4) * 14;
      this.addProjectile({ kind: projectileKind, pos: start, vel: mul(norm([jittered[0], jittered[1] + 0.35, jittered[2]]), speed), owner: ch.id, team: ch.team, damage: w.damage, explosive: w.explosive ?? 2, weapon: ch.weapon, gravity: -9.81, drag: 0.02, penetration: 0, life: 8, fuse: 3.2 });
    }
    this.events.push({ e: 'shot', pos: start, dir: jittered, weapon: ch.weapon, owner: ch.id });
    // muzzle blast suppresses nearby enemies (fire discipline / suppression system)
    for (const other of this.chars.values()) {
      if (!other.alive || other.team === ch.team) continue;
      if (dist2(other.pos, ch.pos) < 2500) other.suppressed = Math.min(1.5, other.suppressed + 0.25);
    }
  }

  addProjectile(p: {
    kind: string; pos: Vec3; vel: Vec3; owner: number; team: Team; damage: number; explosive: number; weapon: string;
    gravity: number; drag: number; penetration: number; life: number; armed?: boolean; fuse?: number;
  }) {
    const w = WEAPONS[p.weapon];
    if (this.projectiles.length > MAX_PROJECTILES) {
      const idx = this.projectiles.findIndex(pr => pr.kind === 'bullet');
      if (idx >= 0) this.projectiles.splice(idx, 1);
    }
    const proj: Projectile = {
      id: this.nextId++, kind: p.kind, pos: [...p.pos], vel: [...p.vel], owner: p.owner, team: p.team, life: p.life,
      damage: p.damage, explosive: p.explosive, weapon: p.weapon, gravity: p.gravity, drag: p.drag,
      tracer: p.kind !== 'bullet' ? true : true, penetrations: Math.round((p.penetration ?? 0.5) * 4) + 1,
      armed: p.armed ?? true, fuse: p.fuse ?? 0, radius: (w?.explosive ?? p.explosive) * 4 + 2, bounces: 0, meshActive: p.kind !== 'bullet',
      meshPos: [...p.pos]
    };
    this.projectiles.push(proj);
  }

  /* ----------------------------- projectiles ----------------------------- */
  updateProjectiles(dt: number) {
    const keep: Projectile[] = [];
    for (const pr of this.projectiles) {
      pr.life -= dt;
      if (pr.life <= 0) { if (pr.kind === 'grenade' || pr.kind === 'mortar') this.explode(pr.pos, pr.explosive * 5 + 2, pr); continue; }
      pr.vel[1] += pr.gravity * dt;
      const speed = len(pr.vel);
      if (pr.drag) { const f = Math.max(0, 1 - pr.drag * speed * dt); pr.vel = mul(pr.vel, f); }
      if (pr.kind === 'rocket') { pr.vel = mul(pr.vel, 1 + dt * 1.1); if (speed > 60) pr.armed = true; }
      if (pr.kind === 'grenade' || pr.kind === 'mortar') {
        const g = this.groundY(pr.pos[0], pr.pos[2]);
        if (pr.pos[1] <= g + 0.15) {
          pr.pos[1] = g + 0.15;
          pr.vel = [pr.vel[0] * 0.35, Math.abs(pr.vel[1]) * 0.28, pr.vel[2] * 0.35];
          pr.bounces++;
          if (pr.bounces > 2 && speed < 6) { this.explode(pr.pos, pr.explosive * 5 + 2, pr); continue; }
        }
        if (!pr.armed) { keep.push(pr); continue; }
      }
      const travel = len(pr.vel) * dt;
      if (travel < 1e-4) { keep.push(pr); continue; }
      const dir = mul(pr.vel, 1 / speed);
      let remaining = travel;
      let guard = 0;
      let alive = true;
      while (remaining > 0.0001 && guard++ < 6) {
        const hit = this.raycast([...pr.pos], dir, remaining, pr.owner);
        if (!hit) { pr.pos = add(pr.pos, mul(dir, remaining)); remaining = 0; break; }
        const impactPoint = add(pr.pos, mul(dir, hit.toi));
        // resolve the hit
        if (hit.kind === 'char') {
          const target = hit.char;
          const head = impactPoint[1] > target.pos[1] + 0.55;
          const dmg = pr.damage * (head ? 2.2 : 1) * (pr.kind === 'bullet' ? clamp(1 - hit.toi / 800, 0.35, 1) : 1);
          this.damageCharacter(target, dmg, pr.owner, pr.weapon, head);
          this.events.push({ e: 'impact', pos: impactPoint, normal: [-dir[0], -dir[1], -dir[2]], material: 'flesh', weapon: pr.weapon });
          if (pr.kind === 'rocket' || pr.kind === 'grenade' || pr.kind === 'mortar') { this.explode(impactPoint, pr.radius, pr); }
          alive = false; break;
        }
        if (hit.kind === 'vehicle') {
          this.damageVehicle(hit.vehicle, pr.damage, pr.owner, pr.weapon, impactPoint, dir);
          if (pr.kind === 'rocket') { this.explode(impactPoint, pr.radius, pr); alive = false; break; }
          this.events.push({ e: 'impact', pos: impactPoint, normal: [-dir[0], -dir[1], -dir[2]], material: 'armor', weapon: pr.weapon });
          // bullets ricochet off armour depending on angle
          if (pr.kind === 'bullet' && Math.abs(dir[1]) < 0.35 && pr.bounces < 2) { pr.vel = [pr.vel[0] * -0.28, Math.abs(pr.vel[1]) + 3, pr.vel[2] * -0.28]; pr.bounces++; pr.pos = add(impactPoint, mul(pr.vel, 0.002)); break; }
          alive = false; break;
        }
        if (hit.kind === 'structure' || hit.kind === 'prop') {
          const matName = hit.kind === 'prop' ? materialOf(hit.prop.asset) : materialOf(hit.structure.asset);
          const mat = MATERIALS[matName] ?? MATERIALS.concrete;
          this.events.push({ e: 'impact', pos: impactPoint, normal: [-dir[0], -dir[1], -dir[2]], material: matName, weapon: pr.weapon });
          if (pr.kind === 'bullet') {
            const penetrationEnergy = len(pr.vel);
            if (hit.kind === 'structure') this.damageStructure(hit.structure, pr.damage * 0.55, impactPoint, 'bullet', pr.owner);
            else this.damageProp(hit.prop, pr.damage * 0.8, impactPoint, pr.owner);
            pr.penetrations--;
            const thicknessCost = mat.strength * 40;
            if (pr.penetrations <= 0 || penetrationEnergy < thicknessCost || matName === 'concrete' && penetrationEnergy < 500) { alive = false; break; }
            pr.vel = mul(pr.vel, 0.62); pr.damage *= 0.55;
            pr.pos = add(impactPoint, mul(dir, 0.28));
            remaining -= Math.min(remaining, 0.35);
            continue;
          }
          if (pr.kind === 'rocket' || pr.kind === 'grenade' || pr.kind === 'mortar') {
            if (hit.kind === 'structure') this.damageStructure(hit.structure, pr.damage, impactPoint, 'explosive', pr.owner);
            else this.damageProp(hit.prop, pr.damage * 2, impactPoint, pr.owner);
            this.explode(impactPoint, pr.radius, pr);
            alive = false; break;
          }
          alive = false; break;
        }
        // terrain
        this.events.push({ e: 'impact', pos: impactPoint, normal: [0, 1, 0], material: 'dirt', weapon: pr.weapon });
        if (pr.kind === 'bullet') { this.events.push({ e: 'spawnCrater', pos: impactPoint, radius: 0.35 }); }
        if (pr.kind === 'rocket' || pr.kind === 'grenade' || pr.kind === 'mortar') this.explode(impactPoint, pr.radius, pr);
        alive = false; break;
      }
      if (alive) keep.push(pr);
    }
    this.projectiles = keep;
  }

  /** Analytic raycast against characters, vehicles, structures, props and the terrain heightfield. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, excludeOwner = -1): { kind: 'char' | 'vehicle' | 'structure' | 'prop' | 'terrain'; toi: number; char?: any; vehicle?: any; structure?: any; prop?: any; point: Vec3 } | null {
    const rayT0 = performance.now();
    let best: any = null;
    // characters (sphere-ish: capsule approximated by 2 spheres + cylinder test)
    for (const ch of this.chars.values()) {
      if (!ch.alive || ch.id === excludeOwner) continue;
      if (ch.vehicle !== null) continue;
      const t = this.rayChar(origin, dir, ch, maxDist);
      if (t !== null && (!best || t < best.toi)) best = { kind: 'char', toi: t, char: ch };
    }
    for (const v of this.vehicles.values()) {
      if (v.occupants.includes(excludeOwner)) continue;
      const dims = this.manifest[v.asset].dims;
      const p = v.body.translation(), q = v.body.rotation();
      const local = rotateInv([origin[0] - p.x, origin[1] - p.y, origin[2] - p.z], q);
      const ldir = rotateInv(dir, q);
      let gap = rayBoxHit(local, ldir, [0, 0, 0], [dims[0], dims[1], dims[2]]);
      if (gap !== null) {
        const hull = this.hullOf(v.asset);
        for (const b of hull.boxes) {
          const t = rayBoxHit(local, ldir, b.c, b.s);
          if (t !== null && (gap === null || t < gap)) gap = t;
        }
      }
      if (gap !== null && gap < maxDist && (!best || gap < best.toi)) best = { kind: 'vehicle', toi: gap, vehicle: v };
    }
    for (const st of this.structures) {
      if (st.collapsed) continue;
      const dims = this.manifest[st.asset].dims;
      if (!this.rayNearBox(origin, dir, [st.x, st.y, st.z], dims, maxDist)) continue;
      const q = { x: 0, y: Math.sin(st.ry / 2), z: 0, w: Math.cos(st.ry / 2) };
      const local = rotateInv([origin[0] - st.x, origin[1] - st.y, origin[2] - st.z], q);
      const ldir = rotateInv(dir, q);
      const hull = this.hullOf(st.asset);
      let bestT: number | null = null;
      for (const b of hull.boxes) {
        const bq = { x: 0, y: Math.sin(b.ry / 2), z: 0, w: Math.cos(b.ry / 2) };
        const lo = rotateInv(sub(local, b.c), bq), ld = rotateInv(ldir, bq);
        const t = rayBoxHit(lo, ld, [0, 0, 0], b.s);
        if (t === null || t >= maxDist) continue;
        if (b.part.startsWith('wall')) {
          const w = st.walls.find(w => w.name === b.part);
          if (w && !w.alive) continue;
        }
        if (st.collapsed) continue;
        if (bestT === null || t < bestT) bestT = t;
      }
      if (bestT !== null && (!best || bestT < best.toi)) best = { kind: 'structure', toi: bestT, structure: st };
    }
    for (const prop of this.props) {
      if (prop.broken || !prop.body) continue;
      const dims = this.manifest[prop.asset].dims;
      const ptr = prop.body.translation();
      if (!this.rayNearBox(origin, dir, [ptr.x, ptr.y, ptr.z], dims, maxDist)) continue;
      const q = prop.body.rotation();
      const local = rotateInv([origin[0] - ptr.x, origin[1] - ptr.y, origin[2] - ptr.z], q);
      const ldir = rotateInv(dir, q);
      const t = rayBoxHit(local, ldir, [0, 0, 0], [dims[0], dims[1], dims[2]]);
      if (t !== null && t < maxDist && (!best || t < best.toi)) best = { kind: 'prop', toi: t, prop };
    }
    // terrain march (cheap & robust for heightfields)
    let step = 1.0;
    for (let d = 0; d < maxDist; d += step) {
      const p: Vec3 = [origin[0] + dir[0] * d, origin[1] + dir[1] * d, origin[2] + dir[2] * d];
      const g = this.groundY(p[0], p[2]);
      if (p[1] <= g) {
        // refine
        let lo = Math.max(0, d - step), hi = d;
        for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; const mp: Vec3 = [origin[0] + dir[0] * mid, origin[1] + dir[1] * mid, origin[2] + dir[2] * mid]; if (mp[1] <= this.groundY(mp[0], mp[2])) hi = mid; else lo = mid; }
        if (!best || hi < best.toi) best = { kind: 'terrain', toi: hi };
        break;
      }
      step = Math.min(6, 1 + d * 0.02);
    }
    if (best) best.point = add(origin, mul(dir, best.toi));
    this.rayTime += performance.now() - rayT0; this.rayCount++;
    return best;
  }

  /** Cheap sphere-vs-ray rejection used as a broad phase before exact box tests. */
  rayNearBox(origin: Vec3, dir: Vec3, center: Vec3, dims: Vec3, maxDist: number) {
    const rel: Vec3 = [center[0] - origin[0], center[1] - origin[1], center[2] - origin[2]];
    const proj = rel[0] * dir[0] + rel[1] * dir[1] + rel[2] * dir[2];
    const radius = Math.hypot(dims[0], dims[1], dims[2]) * 0.55;
    if (proj < -radius || proj > maxDist + radius) return false;
    const px = rel[0] - dir[0] * proj, py = rel[1] - dir[1] * proj, pz = rel[2] - dir[2] * proj;
    return px * px + py * py + pz * pz < radius * radius;
  }

  rayChar(origin: Vec3, dir: Vec3, ch: CharState, maxDist: number): number | null {
    const h = ch.stance === 2 ? 0.65 : ch.stance === 1 ? 1.25 : 1.75;
    const center: Vec3 = [ch.pos[0], ch.pos[1] - 0.45 + h / 2, ch.pos[2]];
    const t = rayBoxHit(origin, dir, center, [0.62, h, 0.55]);
    if (t !== null && t < maxDist) return t;
    return null;
  }

  /* ------------------------------- damage --------------------------------- */
  damageCharacter(ch: CharState, amount: number, ownerId: number | null, weapon: string, head: boolean) {
    if (!ch.alive || ch.spawnProtect > 0 || amount <= 0) return;
    ch.hp -= amount;
    ch.lastDamage = 0;
    ch.suppressed = Math.min(1.6, ch.suppressed + 0.35);
    const attacker = ownerId != null ? this.chars.get(ownerId) : null;
    if (attacker && attacker.id !== ch.id) {
      ch.damagers.set(attacker.id, (ch.damagers.get(attacker.id) ?? 0) + amount);
      ch.lastKilledBy = attacker.name;
    } else if (ownerId == null) ch.lastKilledBy = weapon;
    this.events.push({ e: 'hit', target: ch.id, damage: amount, head, owner: ownerId ?? 0, pos: [...ch.pos] });
    if (ch.hp <= 0) this.killCharacter(ch, ch.lastKilledBy ?? weapon);
  }

  killCharacter(ch: CharState, byName: string | null) {
    if (!ch.alive) return;
    ch.alive = false;
    ch.hp = 0;
    ch.deaths++;
    this.events.push({ e: 'kill', victim: ch.id, killer: this.lastAttackerId(ch), weapon: 'w_ak74', head: false, victimName: ch.name, killerName: byName ?? 'Поле боя' });
    if (ch.vehicle !== null) this.exitVehicle(ch, true);
    this.tickets[ch.team] = Math.max(0, this.tickets[ch.team] - 1);
    // ragdoll: a dynamic body replaces the kinematic capsule and reacts to explosions / impacts
    const rag = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(ch.pos[0], ch.pos[1], ch.pos[2]).setLinearDamping(0.25).setAngularDamping(0.6));
    this.world.createCollider(this.R.ColliderDesc.capsule(0.45, 0.3).setDensity(0.35).setFriction(0.8).setCollisionGroups((GROUP.DEBRIS << 16) | 0xffff), rag);
    for (const other of this.chars.values()) if (other.alive && other.team !== ch.team && dist2(other.pos, ch.pos) < 900) other.suppressed = Math.min(1.5, other.suppressed + 0.2);
    const attacker = this.lastAttackerId(ch);
    const a = attacker ? this.chars.get(attacker) : null;
    if (a) {
      a.score += 100; a.kills++; a.killsThisLife++;
      if (a.isPlayer) { /* stats surface via snapshot */ }
    }
    for (const [id, dmg] of ch.damagers) if (id !== attacker && dmg > 40) { const ac = this.chars.get(id); if (ac) { ac.assists++; ac.score += 25; } }
    ch.damagers.clear();
    ch.mesh.hidden = true; ch.mesh.dirty = true;
    this.debris.push({ body: rag, size: 2, meshId: ch.mesh.id, born: this.time, metal: false, asleep: false });
    ch.respawnAt = this.time + (ch.isPlayer ? 5 : 7 + this.rng() * 6);
    this.pendingCorpses.push({ id: ch.id, body: rag });
    if (ch.isPlayer) this.events.push({ e: 'notice', text: `Вы погибли: ${byName ?? 'неизвестно'}` });
  }

  lastAttackerId(ch: CharState): number {
    let bestId = 0, bestDmg = 0;
    for (const [id, d] of ch.damagers) if (d > bestDmg) { bestDmg = d; bestId = id; }
    return bestId;
  }

  reviveCharacter(ch: CharState) {
    ch.alive = true; ch.hp = 100; ch.oxygen = 1; ch.stamina = 1; ch.suppressed = 0; ch.fallStart = null;
    const spawn = this.pickSpawn(ch.team);
    ch.pos = [spawn.x, this.groundY(spawn.x, spawn.z) + 1.0, spawn.z];
    ch.body.setTranslation({ x: ch.pos[0], y: ch.pos[1], z: ch.pos[2] }, true);
    ch.mesh.hidden = false; ch.mesh.dirty = true; ch.mesh.pos = [...ch.pos];
    ch.spawnProtect = 2.5;
    ch.magazine = this.currentWeapon(ch).magazine;
    ch.reserve = this.currentWeapon(ch).magazine * 6;
    ch.killsThisLife = 0;
    const corpse = this.debris.find(d => d.meshId === ch.mesh.id);
    if (corpse) { this.world.removeRigidBody(corpse.body); this.debris.splice(this.debris.indexOf(corpse), 1); }
  }

  pendingCorpses: { id: number; body: RB }[] = [];

  damageStructure(st: StructureInst, amount: number, at: Vec3, kind: string, owner: number | null) {
    const local = rotateInv([at[0] - st.x, at[1] - st.y, at[2] - st.z], { x: 0, y: Math.sin(st.ry / 2), z: 0, w: Math.cos(st.ry / 2) });
    st.health -= amount;
    let hitWall = false;
    for (const w of st.walls) {
      if (!w.alive) continue;
      if (Math.abs(local[0] - w.local[0]) < 2.6 && Math.abs(local[1] - w.local[1]) < 1.8) {
        w.hp -= kind === 'explosive' ? amount * 1.6 : amount;
        hitWall = true;
        if (w.hp <= 0) this.breachWall(st, w, at, kind);
      }
    }
    if (!hitWall) {
      // floor/column damage -> support strain
      for (const sup of st.supports) {
        if (!sup.alive) continue;
        if (Math.abs(local[0] - sup.local[0]) < 4 && Math.abs(local[2] - sup.local[2]) < 4) {
          sup.hp -= kind === 'explosive' ? amount * 1.8 : amount * 0.4;
          if (sup.hp <= 0) this.breakSupport(st, sup, at);
        }
      }
    }
    const halfW = (this.manifest[st.asset].dims[0] / (st.sections.length || 1)) / 2;
    for (const sec of st.sections) {
      const alive = st.supports.filter(s => s.alive && Math.abs(s.local[0] - sec.local[0]) < halfW).length;
      sec.supportsLeft = alive;
      if (alive === 0 && sec.alive && !st.collapsed) this.collapseSection(st, sec);
    }
    if (st.health <= 0 && !st.collapsed) { for (const sec of st.sections) if (sec.alive) this.collapseSection(st, sec); }
  }

  breachWall(st: StructureInst, w: StructureInst['walls'][number], at: Vec3, kind: string) {
    w.alive = false;
    const geo = this.geo[st.asset];
    const pg = geo.parts[w.partIndex];
    if (!pg) return;
    // spawn physical fragments for the panel geometry
    const rng = mulberry32(st.id * 31 + w.partIndex * 7);
    const cs = Math.cos(st.ry), sn = Math.sin(st.ry);
    const chunkCount = kind === 'explosive' ? 7 : 3;
    for (let i = 0; i < chunkCount; i++) {
      const size: Vec3 = [0.5 + rng() * 1.1, 0.35 + rng() * 0.9, 0.16 + rng() * 0.2];
      const wx = st.x + w.local[0] * cs + w.local[2] * sn + (rng() - 0.5) * 1.6;
      const wz = st.z - w.local[0] * sn + w.local[2] * cs + (rng() - 0.5) * 1.6;
      const wy = st.y + w.local[1] + (rng() - 0.5) * 1.4;
      this.spawnDebrisPiece([wx, wy, wz], size, at, 'concrete', 1.2);
    }
    this.events.push({ e: 'destroy', piece: st.id * 1000 + w.partIndex, pos: [st.x, st.y + w.local[1], st.z], kind: 'wall', fragment: null, size: 2.2 });
    this.events.push({ e: 'sound', pos: [st.x, st.y, st.z], kind: 'wall_break', volume: 1 });
    // open the render hole (part index mapping) and pierce surrounding geometry
    st.mesh.vis[w.partIndex] = 0; st.mesh.dirty = true;
    if (this.player) { const d = dist(this.player.pos, [st.x, st.y, st.z]); if (d < 120) this.player.suppressed = Math.min(1.2, this.player.suppressed + 0.2); }
    void pg;
  }

  breakSupport(st: StructureInst, sup: StructureInst['supports'][number], at: Vec3) {
    sup.alive = false;
    const cs = Math.cos(st.ry), sn = Math.sin(st.ry);
    const wx = st.x + sup.local[0] * cs + sup.local[2] * sn;
    const wz = st.z - sup.local[0] * sn + sup.local[2] * cs;
    this.spawnDebrisPiece([wx, st.y + 2, wz], [0.6, 2.4, 0.6], at, 'concrete', 4);
    this.events.push({ e: 'destroy', piece: st.id * 1000 + 999, pos: [wx, st.y + 2, wz], kind: 'column', fragment: null, size: 3 });
    this.events.push({ e: 'sound', pos: [wx, st.y, wz], kind: 'column_break', volume: 1 });
  }

  collapseSection(st: StructureInst, sec: StructureInst['sections'][number]) {
    sec.alive = false;
    const cs = Math.cos(st.ry), sn = Math.sin(st.ry);
    const wx = st.x + sec.local[0] * cs, wz = st.z - sec.local[0] * sn;
    const entry = this.manifest[st.asset];
    const height = entry.building?.height ?? 12;
    const width = entry.dims[0] / (entry.building?.sections ?? 1);
    // the section becomes a physical falling chunk, then splits into rubble
    const chunks = 10;
    for (let f = 0; f < 4; f++) {
      for (let i = 0; i < chunks; i++) {
        const size: Vec3 = [width / 3.2, Math.max(0.6, height / 5), entry.dims[2] / 3.0];
        const x = wx + (i % 3 - 1) * width / 3;
        const z = wz + (Math.floor(i / 3) - 1) * entry.dims[2] / 3;
        const y = st.y + (f + 0.5) * (height / 4);
        this.spawnDebrisPiece([x, y, z], size, [wx, st.y + 1, wz], 'concrete', 8);
      }
    }
    // crush everyone inside
    for (const ch of this.chars.values()) {
      if (!ch.alive) continue;
      if (Math.abs(ch.pos[0] - wx) < width / 2 + 1 && Math.abs(ch.pos[2] - wz) < entry.dims[2] / 2 + 2 && ch.pos[1] < st.y + height) {
        this.damageCharacter(ch, 240, null, 'Обрушение', false);
      }
    }
    this.pendingEvents.push({ e: 'collapse', section: sec.name, pos: [wx, st.y + height / 2, wz], size: Math.max(width, height), building: st.id });
    this.events.push({ e: 'sound', pos: [wx, st.y + height / 2, wz], kind: 'collapse', volume: 1.4 });
    // camera shake / dust suppression
    for (const ch of this.chars.values()) { const d = dist(ch.pos, [wx, st.y, wz]); if (d < 220) ch.suppressed = Math.min(1.6, ch.suppressed + 1.6 * (1 - d / 220)); }
    if (st.sections.every(s => !s.alive)) { st.collapsed = true; st.mesh.hidden = true; st.mesh.dirty = true; }
    st.mesh.dirty = true;
  }

  spawnDebrisPiece(pos: Vec3, size: Vec3, impact: Vec3, material: string, massMul = 1) {
    if (this.debris.length > this.debrisCapped) {
      const idx = this.debris.findIndex(d => d.size < 1.5 && d.asleep);
      if (idx >= 0) { this.world.removeRigidBody(this.debris[idx].body); this.debris.splice(idx, 1); }
    }
    const body = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(pos[0], pos[1], pos[2])
      .setRotation({ x: this.rng() * 0.4, y: this.rng() * 6.28, z: this.rng() * 0.4, w: 1 }).setLinearDamping(0.06).setAngularDamping(0.4).setCanSleep(true));
    const mat = MATERIALS[material] ?? MATERIALS.concrete;
    const col = this.world.createCollider(this.R.ColliderDesc.cuboid(size[0] / 2, size[1] / 2, size[2] / 2)
      .setDensity(mat.density / 2200 * massMul).setFriction(mat.friction).setRestitution(mat.restitution * 0.6)
      .setCollisionGroups((GROUP.DEBRIS << 16) | 0xffff), body);
    const dirAway = norm(sub(pos, impact));
    const force = 3 + this.rng() * 7;
    body.applyImpulse({ x: (dirAway[0] + (this.rng() - 0.5) * 0.6) * force * 120, y: (Math.abs(dirAway[1]) * 0.3 + 0.6) * force * 120, z: (dirAway[2] + (this.rng() - 0.5) * 0.6) * force * 120 }, true);
    body.applyTorqueImpulse({ x: (this.rng() - 0.5) * 900, y: (this.rng() - 0.5) * 900, z: (this.rng() - 0.5) * 900 }, true);
    this.debris.push({ body, size: Math.max(size[0], size[1], size[2]), meshId: -1, born: this.time, metal: material === 'steel', asleep: false });
    this.destroyIndex.set(col.handle, { kind: 'debris', ref: { body } });
    const ev = { e: 'destroy' as const, piece: this.nextId++, pos: [...pos] as Vec3, kind: 'debris', fragment: 'concrete', size: Math.max(size[0], size[1], size[2]) };
    this.events.push(ev);
  }

  damageProp(prop: PropInst, amount: number, at: Vec3, owner: number | null) {
    prop.health -= amount;
    const matName = materialOf(prop.asset);
    if (matName === 'wood' && amount > 40) prop.health = Math.min(prop.health, 0);
    if (prop.health <= 0 && !prop.broken) {
      prop.broken = true;
      prop.mesh.hidden = true; prop.mesh.dirty = true;
      const dims = this.manifest[prop.asset].dims;
      const pb = prop.body;
      if (!pb) return;
      const tr = pb.translation();
      if (pb.isDynamic()) { pb.applyImpulse({ x: (this.rng() - 0.5) * 400, y: 200, z: (this.rng() - 0.5) * 400 }, true); }
      else {
        this.world.removeRigidBody(pb);
        prop.body = null;
        for (let i = 0; i < 5; i++) this.spawnDebrisPiece([tr.x + (this.rng() - 0.5) * dims[0], tr.y + this.rng() * dims[1], tr.z + (this.rng() - 0.5) * dims[2]], [dims[0] / 3, dims[1] / 3, dims[2] / 3], at, matName, 1);
      }
      if (prop.asset.includes('tree')) {
        this.events.push({ e: 'destroy', piece: prop.id, pos: [tr.x, tr.y, tr.z], kind: 'tree', fragment: prop.asset, size: dims[1] });
      } else this.events.push({ e: 'destroy', piece: prop.id, pos: [tr.x, tr.y, tr.z], kind: 'prop', fragment: prop.asset, size: Math.max(dims[0], dims[2]) });
      this.events.push({ e: 'sound', pos: [tr.x, tr.y, tr.z], kind: 'prop_break', volume: 0.8 });
    }
  }

  damageVehicle(v: VehicleInst, amount: number, owner: number | null, weapon: string, at: Vec3, dir?: Vec3) {
    if (v.destroyed || v.spawnProtect > 0) return;
    const cfg = VEHICLES[v.asset];
    // angle-of-incidence / effective thickness model
    const angleFactor = dir ? clamp(1 / Math.max(0.25, Math.abs(dot(norm(dir), norm(sub(at, [v.body.translation().x, v.body.translation().y, v.body.translation().z])))) + 0.15), 0.3, 1.8) : 1;
    const penetration = amount / Math.max(0.15, cfg.armor * 60 * angleFactor);
    if (penetration < 0.2) {
      this.events.push({ e: 'impact', pos: at, normal: [0, 1, 0], material: 'armor', weapon });
      return;
    }
    v.hp -= amount * (0.35 + penetration * 0.65);
    // hit zone based damage of modules
    const p = v.body.translation();
    const dx = at[0] - p.x, dz = at[2] - p.z;
    if (Math.abs(dz) > (this.manifest[v.asset].dims[2] / 2) * 0.45) {
      if (v.drive === 'wheel' || v.drive === 'track') { v.trackHp -= amount * 0.5; if (v.trackHp <= 0) v.trackHp = 0; }
      else { v.engineHp -= amount * 0.3; }
    } else if (Math.abs(dx) < 0.4 && Math.abs(dz) < (this.manifest[v.asset].dims[2] / 2) * 0.5 && at[1] > p.y + (this.manifest[v.asset].dims[1] * 0.15)) {
      v.turretHp -= amount * 0.25;
    }
    if (Math.random() < 0.2) v.ammoHp -= amount * 0.2;
    const attacker = owner != null ? this.chars.get(owner) : null;
    if (attacker) { attacker.score += 10; }
    // crew damage from penetrating hits
    for (const oid of v.occupants) { if (oid != null) { const oc = this.chars.get(oid); if (oc && penetration > 0.7) this.damageCharacter(oc, amount * 0.18, owner, weapon, false); } }
    if (v.hp <= 0 || v.ammoHp <= 0) this.destroyVehicle(v, attacker ?? null);
  }

  destroyVehicle(v: VehicleInst, attacker: CharState | null) {
    if (v.destroyed) return;
    v.destroyed = true; v.hp = 0; v.burning = 1;
    if (attacker) attacker.score += 250;
    this.events.push({ e: 'vehicleDestroyed', vehicle: v.id, pos: [v.body.translation().x, v.body.translation().y, v.body.translation().z] });
    this.events.push({ e: 'sound', pos: [v.body.translation().x, v.body.translation().y, v.body.translation().z], kind: 'vehicle_explode', volume: 1.5 });
    for (const oid of v.occupants) { if (oid != null) { const oc = this.chars.get(oid); if (oc) { this.damageCharacter(oc, 120, attacker?.id ?? null, 'Техника', false); } } }
    v.occupants.fill(null);
    v.mesh.dirty = true;
    // ammo detonation: turret physically detaches and flies
    if (v.asset === 'v_t72' || v.asset === 'v_bmp2' || v.asset === 'v_shilka') {
      const p = v.body.translation();
      const turretBody = this.world.createRigidBody(this.R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y + 1.4, p.z)
        .setLinvel((this.rng() - 0.5) * 12, 24 + this.rng() * 14, (this.rng() - 0.5) * 12).setAngvel({ x: (this.rng() - 0.5) * 6, y: (this.rng() - 0.5) * 6, z: (this.rng() - 0.5) * 6 }));
      this.world.createCollider(this.R.ColliderDesc.cylinder(0.6, 1.3).setDensity(3).setCollisionGroups((GROUP.DEBRIS << 16) | 0xffff), turretBody);
      this.debris.push({ body: turretBody, size: 3.4, meshId: -1, born: this.time, metal: true, asleep: false });
      this.events.push({ e: 'explosion', pos: [p.x, p.y, p.z], radius: 12, kind: 'ammo', water: false });
    } else this.explode([v.body.translation().x, v.body.translation().y, v.body.translation().z], 7, null, 'vehicle');
  }

  /* ------------------------------- explosions ---------------------------- */
  explode(pos: Vec3, radius: number, projectile: Projectile | null, kind = 'shell') {
    const water = pos[1] < (this.spec.water?.level ?? -999) + 0.3;
    this.events.push({ e: 'explosion', pos: [...pos], radius, kind, water });
    this.events.push({ e: 'sound', pos: [...pos], kind: 'explosion', volume: 1.2 });
    if (water) {
      // underwater shock wave: wider radius, higher impulse
      radius *= 1.45;
      for (const ch of this.chars.values()) { if (ch.alive && waterDepth(this.spec, ch.pos[0], ch.pos[2]) > 0.5 && dist(ch.pos, pos) < radius) this.damageCharacter(ch, 55 * (1 - dist(ch.pos, pos) / radius), projectile?.owner ?? null, 'Гидроудар', false); }
    }
    const ownerId = projectile?.owner ?? null;
    for (const ch of this.chars.values()) {
      if (!ch.alive) continue;
      const d = dist(ch.pos, pos);
      if (d > radius) continue;
      const falloff = Math.pow(1 - d / radius, 1.4);
      this.damageCharacter(ch, projectile && projectile.damage > 50 ? projectile.damage * falloff * 0.8 : 90 * falloff, ownerId, projectile?.weapon ?? 'Взрыв', false);
      ch.suppressed = Math.min(2, ch.suppressed + 1.4 * falloff);
      ch.vel = [ch.vel[0] + (ch.pos[0] - pos[0]) * falloff * 9, ch.vel[1] + falloff * 6, ch.vel[2] + (ch.pos[2] - pos[2]) * falloff * 9];
      ch.fallStart = null;
    }
    for (const v of this.vehicles.values()) if (!v.destroyed && dist([v.body.translation().x, v.body.translation().y, v.body.translation().z], pos) < radius * 1.2) {
      this.damageVehicle(v, (projectile?.damage ?? 100) * clamp(radius / 6, 0.5, 8) * 0.8, ownerId, projectile?.weapon ?? 'Взрыв', pos);
      v.body.applyImpulse({ x: (v.body.translation().x - pos[0]) * 400, y: 900, z: (v.body.translation().z - pos[2]) * 400 }, true);
    }
    // blast power scales with radius: a 155 mm shell and a 250 kg bomb do not carve the same hole
    const blast = (projectile?.damage ?? 100) * clamp(radius / 6, 0.45, 10);
    for (const st of this.structures) {
      const c: Vec3 = [st.x, st.y + 3, st.z];
      const d = dist(c, pos);
      if (d < radius + 24) this.damageStructure(st, blast * clamp(1 - d / (radius + 24), 0.15, 1), pos, 'explosive', ownerId);
    }
    for (const prop of this.props) {
      if (prop.broken) continue;
      const tr = prop.body?.translation() as { x: number; y: number; z: number } | undefined;
      if (!tr) continue;
      const d = Math.hypot(tr.x - pos[0], tr.y - pos[1], tr.z - pos[2]);
      if (d < radius + 4) {
        this.damageProp(prop, blast * (1 - d / (radius + 4)), pos, ownerId);
        if (prop.body?.isDynamic()) prop.body.applyImpulse({ x: (tr.x - pos[0]) * 260, y: 220 + Math.abs(tr.y - pos[1]) * 80, z: (tr.z - pos[2]) * 260 }, true);
      }
    }
    for (const d of this.debris) {
      const p = d.body.translation();
      const dd = Math.hypot(p.x - pos[0], p.y - pos[1], p.z - pos[2]);
      if (dd < radius * 1.5) d.body.applyImpulse({ x: (p.x - pos[0]) * 40, y: 40, z: (p.z - pos[2]) * 40 }, true);
    }
    // terrain crater
    if (!water) {
      const cr = { x: pos[0], z: pos[2], r: Math.max(2, radius * 0.5), depth: Math.min(2.6, radius * 0.18) };
      this.craters.push(cr);
      if (this.craters.length > 400) this.craters.shift();
      this.applyCrater(cr);
      this.events.push({ e: 'spawnCrater', pos: [...pos], radius: cr.r });
    }
  }

  applyCrater(cr: Crater) {
    const n = this.spec.res, cell = this.spec.size / n;
    const xs = Math.max(0, Math.floor((cr.x - cr.r + this.spec.size / 2) / cell)), xe = Math.min(n, Math.ceil((cr.x + cr.r + this.spec.size / 2) / cell));
    const zs = Math.max(0, Math.floor((cr.z - cr.r + this.spec.size / 2) / cell)), ze = Math.min(n, Math.ceil((cr.z + cr.r + this.spec.size / 2) / cell));
    const heights = this.spec.heights;
    for (let j = zs; j <= ze; j++) for (let i = xs; i <= xe; i++) {
      const x = -this.spec.size / 2 + i * cell, z = -this.spec.size / 2 + j * cell;
      const d = Math.hypot(x - cr.x, z - cr.z);
      if (d > cr.r) continue;
      const drop = cr.depth * Math.pow(1 - d / cr.r, 1.7);
      heights[j * (n + 1) + i] -= drop;
    }
    // update heightfield collider
    if (this.terrainCollider) {
      this.world.removeCollider(this.terrainCollider, false);
      const hs = new Float32Array((n + 1) * (n + 1));
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) hs[j * (n + 1) + i] = heights[j * (n + 1) + i];
      const body = this.world.createRigidBody(this.R.RigidBodyDesc.fixed());
      this.terrainCollider = this.world.createCollider(this.R.ColliderDesc.heightfield(n, n, hs, { x: this.spec.size, y: 1, z: this.spec.size }).setFriction(0.95).setCollisionGroups((GROUP.TERRAIN << 16) | 0xffff), body);
    }
    this.events.push({ e: 'craters', craters: [{ ...cr }] });
  }

  /* -------------------------------- gadgets ------------------------------ */
  useGadget(ch: CharState, isBot: boolean) {
    if (this.time - ch.lastGadget < 0.8) return;
    ch.lastGadget = this.time;
    const w = WEAPONS[ch.gadget];
    const other = ch.cls === 'assault' ? 'g_gp25' : ch.cls === 'support' ? 'g_ammo' : ch.cls === 'recon' ? 'g_spawnbeacon' : 'g_repair';
    const id = (ch.gadgetCharges[ch.gadget] ?? 0) > 0 ? ch.gadget : other;
    const charges = ch.gadgetCharges[id] ?? 0;
    if (charges <= 0) { if (ch.isPlayer) this.events.push({ e: 'notice', text: `${WEAPONS[id]?.name ?? id}: заряды израсходованы` }); return; }
    ch.gadgetCharges[id] = charges - 1;
    switch (id) {
      case 'g_medkit': {
        const medics = [...this.chars.values()].filter(c => c.alive && c.team === ch.team && dist(c.pos, ch.pos) < 6);
        for (const c of medics) c.hp = Math.min(100, c.hp + 55);
        this.events.push({ e: 'notice', text: 'Аптечка развёрнута: +55 HP отряду' });
        this.events.push({ e: 'sound', pos: ch.pos, kind: 'gadget', volume: 0.6 });
        break;
      }
      case 'g_ammo': {
        for (const c of [...this.chars.values()]) if (c.alive && c.team === ch.team && dist(c.pos, ch.pos) < 6) { c.reserve = WEAPONS[c.weapon].magazine * 6; c.gadgetCharges[c.gadget] = Math.max(c.gadgetCharges[c.gadget] ?? 0, 2); }
        this.events.push({ e: 'notice', text: 'Ящик боеприпасов: боезапас пополнен' });
        break;
      }
      case 'g_repair': {
        let repaired = false;
        for (const v of this.vehicles.values()) {
          if (v.destroyed || dist([v.body.translation().x, v.body.translation().y, v.body.translation().z], ch.pos) > 5.5) continue;
          v.hp = Math.min(v.maxHp, v.hp + v.maxHp * 0.35); v.trackHp = Math.min(100, v.trackHp + 60); v.engineHp = Math.min(100, v.engineHp + 40);
          v.destroyed = false;
          repaired = true;
        }
        if (repaired) this.events.push({ e: 'notice', text: 'Техника отремонтирована' });
        else this.events.push({ e: 'notice', text: 'Ремонт: рядом нет техники' });
        break;
      }
      case 'g_drone': {
        const enemies = [...this.chars.values()].filter(c => c.alive && c.team !== ch.team && dist(c.pos, ch.pos) < 90);
        for (const e of enemies) e.spottedBy.push(ch.team);
        this.events.push({ e: 'notice', text: `Дрон: обнаружено целей — ${enemies.length}` });
        break;
      }
      case 'g_spawnbeacon': {
        ch.pos = [...ch.pos];
        this.beacons = this.beacons ?? [];
        this.beacons.push({ x: ch.pos[0], z: ch.pos[2], team: ch.team, mesh: -1 });
        this.events.push({ e: 'notice', text: 'Маяк спавна установлен: отряд возрождается рядом' });
        break;
      }
      case 'g_ladder': {
        ch.vel[1] = 8; ch.jumpCd = 1.5;
        this.events.push({ e: 'notice', text: 'Штурмовая лестница' });
        break;
      }
      case 'w_c4': case 'w_tm62': {
        const dir = dirFromYawPitch(ch.yaw, ch.pitch);
        const ground = this.groundY(ch.pos[0] + dir[0] * 2, ch.pos[2] + dir[2] * 2) + (id === 'w_c4' ? 2.2 : 0.1);
        this.mines.push({ x: ch.pos[0] + dir[0] * 2, z: ch.pos[2] + dir[2] * 2, y: ground, owner: ch.id, team: ch.team, kind: id, armed: false, fuse: 1.2, c4remote: id === 'w_c4' });
        this.events.push({ e: 'notice', text: id === 'w_c4' ? 'Заряд С4 установлен (взрывается повторным использованием)' : 'Мина ТМ-62 установлена' });
        break;
      }
      default: {
        // GP-25 grenade launcher etc: fire as projectile
        if (w && w.explosive) {
          const dir = dirFromYawPitch(ch.yaw, ch.pitch + 0.08);
          this.addProjectile({ kind: 'grenade', pos: this.eyePos(ch), vel: mul(dir, 76), owner: ch.id, team: ch.team, damage: w.damage, explosive: w.explosive, weapon: id, gravity: -9.81, drag: 0.01, penetration: 0, life: 6, fuse: 2.5 });
          this.events.push({ e: 'shot', pos: this.eyePos(ch), dir, weapon: id, owner: ch.id });
        }
      }
    }
    void isBot;
  }

  beacons: { x: number; z: number; team: Team; mesh: number }[] = [];
  mines: { x: number; z: number; y: number; owner: number; team: Team; kind: string; armed: boolean; fuse: number; c4remote: boolean }[] = [];

  melee(ch: CharState) {
    const eye = this.eyePos(ch);
    const dir = dirFromYawPitch(ch.yaw, ch.pitch);
    const hit = this.raycast(eye, dir, 3.2, ch.id);
    if (hit?.kind === 'char') this.damageCharacter(hit.char, 85, ch.id, 'Нож', true);
    else if (hit?.kind === 'prop') this.damageProp(hit.prop, 60, hit.point, ch.id);
    this.events.push({ e: 'sound', pos: ch.pos, kind: 'melee', volume: 0.5 });
    ch.fireCooldown = 0.6;
  }

  interact(ch: CharState) {
    // enter/exit vehicle, arm M-COM, revive teammate
    if (ch.vehicle !== null) { this.exitVehicle(ch); return; }
    let bestV: VehicleInst | null = null, bestD = 36;
    for (const v of this.vehicles.values()) {
      if (v.destroyed) continue;
      const seat = v.occupants.findIndex(o => o === null);
      if (seat < 0) continue;
      if (v.team !== null && v.team !== ch.team) continue;
      const p = v.body.translation();
      const d = (p.x - ch.pos[0]) ** 2 + (p.z - ch.pos[2]) ** 2;
      if (d < bestD) { bestD = d; bestV = v; }
    }
    if (bestV) { this.enterVehicle(ch, bestV); return; }
    for (const m of this.mcoms) {
      if (m.destroyed || ch.team !== 1) continue;
      if ((m.x - ch.pos[0]) ** 2 + (m.z - ch.pos[2]) ** 2 < 25) { m.armed = true; this.events.push({ e: 'notice', text: 'М-СОМ активирован! Уничтожьте его.' }); return; }
    }
    for (const other of this.chars.values()) if (!other.alive && other.team === ch.team && dist(other.pos, ch.pos) < 3) { this.reviveCharacter(other); this.events.push({ e: 'notice', text: `${other.name} поднят` }); return; }
  }

  enterVehicle(ch: CharState, v: VehicleInst) {
    const seat = v.occupants.findIndex(o => o === null);
    if (seat < 0 || v.destroyed) return;
    v.occupants[seat] = ch.id;
    ch.vehicle = v.id; ch.seat = seat;
    const p = v.body.translation();
    ch.pos = [p.x, p.y + 0.5, p.z];
    ch.mesh.hidden = true; ch.mesh.dirty = true;
    this.events.push({ e: 'vehicleEnter', vehicle: v.id, seat });
    if (ch.isPlayer) this.events.push({ e: 'notice', text: `${VEHICLES[v.asset].name}: место ${seat + 1} из ${v.seats}` });
  }

  exitVehicle(ch: CharState, forced = false) {
    if (ch.vehicle === null) return;
    const v = this.vehicles.get(ch.vehicle);
    if (v) {
      v.occupants[ch.seat] = null;
      const p = v.body.translation();
      const dir = norm([ch.pos[0] - p.x, 0, ch.pos[2] - p.z]);
      const dd = Math.max(...this.manifest[v.asset].dims.slice(0, 3)) * 0.6 + 1.3;
      ch.pos = [p.x + (dir[0] || 1) * dd, Math.max(this.groundY(p.x + dir[0] * dd, p.z + dir[2] * dd), p.y - 1) + 1.0, p.z + (dir[2] || 0) * dd];
      ch.vel = [0, 0, 0];
      ch.mesh.hidden = false; ch.mesh.dirty = true;
    }
    ch.vehicle = null; ch.seat = -1;
    ch.body.setTranslation({ x: ch.pos[0], y: ch.pos[1], z: ch.pos[2] }, true);
    this.events.push({ e: 'vehicleExit', vehicle: v?.id ?? -1 });
    void forced;
  }

  /* -------------------------------- vehicles ----------------------------- */
  updateVehicles(dt: number) {
    for (const v of this.vehicles.values()) {
      const cfg = VEHICLES[v.asset];
      v.spawnProtect = Math.max(0, v.spawnProtect - dt);
      const driver = v.occupants[0] != null ? this.chars.get(v.occupants[0]!) : null;
      if (v.destroyed || v.burning > 0) {
        if (v.destroyed) { v.burning = 1; v.smoke += dt; if (v.smoke % 1.5 < dt) this.events.push({ e: 'sound', pos: [v.body.translation().x, v.body.translation().y, v.body.translation().z], kind: 'fire', volume: 0.5 }); }
        if (v.controller) { v.throttle = 0; v.steer = 0; v.brake = 1; }
      } else {
        const throttle = driver ? driver.isPlayer ? (driver.intent.move[1] ?? 0) : (driver.ai?.vehicleThrottle ?? 0) : 0;
        const steer = driver ? driver.isPlayer ? (driver.intent.move[0] ?? 0) : (driver.ai?.vehicleSteer ?? 0) : 0;
        v.throttle = throttle; v.steer = steer;
        v.brake = Math.abs(throttle) < 0.05 ? 1 : 0;
        v.engine = Math.min(1, Math.abs(throttle));
        void steer;
      }
      if (v.drive === 'wheel' || v.drive === 'track') {
        const trackOk = v.trackHp > 0;
        const engineOk = v.engineHp > 0;
        // Rapier's wheel engine force is in newtons, so derive it from the real chassis mass:
        // a 3 t UAZ needs ~7 kN per wheel to reach its rated 9 m/s². (The old
        // (mass/1400)*140 formula produced 170 N for that whole vehicle — it never moved.)
        const chassisMass = v.body.mass();
        const wheelCount = Math.max(1, v.controller?.numWheels?.() ?? 4);
        const power = (chassisMass * cfg.accel * 1.35) / wheelCount;
        const brakeForce = (chassisMass * 11) / wheelCount;
        if (!v.destroyed && v.controller) {
          v.controller.updateVehicle(dt);
          const n = v.controller.numWheels();
          for (let i = 0; i < n; i++) {
            const w = v.wheels[i];
            const front = w ? w.z < 0 : i < n / 2;
            v.controller.setWheelSteering(i, trackOk ? v.steer * 0.45 * (front ? 1 : 0.35) : 0);
            v.controller.setWheelEngineForce(i, engineOk && trackOk ? v.throttle * power : 0);
            v.controller.setWheelBrake(i, v.brake * brakeForce);
          }
          if (!engineOk) v.body.setLinvel({ x: 0, y: v.body.linvel().y, z: 0 }, true);
        }
        const lv = v.body.linvel();
        const fwdDir = rotateDir([0, 0, 1], v.body.rotation());
        v.speed = lv.x * fwdDir[0] + lv.z * fwdDir[2];
        v.body.setLinearDamping(0.08);
      } else if (v.drive === 'air') {
        const isJet = v.asset === 'v_su25';
        const rot = v.body.rotation();
        const q = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
        const angVel = v.body.angvel();
        v.turretYaw += ((driver?.isPlayer ? 0 : driver?.ai?.turretYaw ?? 0) - v.turretYaw) * Math.min(1, dt * 3);
        const speed = len([v.body.linvel().x, v.body.linvel().y, v.body.linvel().z]);
        if (isJet) {
          const fwd = rotateDir([0, 0, -1], q);
          const lift = clamp(speed / 90, 0, 1) * 110;
          // NOTE: Rapier keeps addForce() alive across steps — use an impulse (F·dt) so the
          // thrust is applied exactly once per fixed tick.
          v.body.applyImpulse({ x: fwd[0] * v.throttle * 90 * 1000 * dt, y: (lift * 1000 * 0.9 + fwd[1] * v.throttle * 90000) * dt, z: fwd[2] * v.throttle * 90 * 1000 * dt }, true);
          v.body.applyTorqueImpulse({ x: -v.steer * 2000 * clamp(speed / 60, 0.1, 1), y: 0, z: -v.turretYaw * 0 }, true);
          if (!driver) v.throttle = 0;
          if (driver && driver.isPlayer) { v.body.applyTorqueImpulse({ x: 0, y: -driver.intent.move[0] * 2400, z: 0 }, true); }
        } else {
          const rotorHealthy = v.rotorHp === undefined ? 1 : v.rotorHp;
          // rotor idles at 96% of weight so a parked machine settles on its gear;
          // collective (W/S) takes it past 1.0 g and it climbs
          const collective = clamp(0.995 + v.throttle * 0.45, 0, 1.45);
          // lift must cancel the *actual* body mass (chassis + crew + cargo), not the bare config mass
          const lift = collective * v.body.mass() * 9.81 * rotorHealthy / 1000;
          v.body.applyImpulse({ x: 0, y: lift * 1000 * dt, z: 0 }, true);
          v.body.applyTorqueImpulse({ x: -v.steer * 600, y: 0, z: 0 }, true);
          v.body.applyTorqueImpulse({ x: 0, y: driver ? 0 : 0, z: -v.turretYaw * 0 }, true);
          // cyclic: pitch on the stick, yaw on the pedals (A/D), plus a little bank when turning
          const pitchInput = driver ? (driver.isPlayer ? (driver.intent.pitch ?? 0) : (driver.ai?.pitch ?? 0)) : 0;
          const yawInput = driver ? (driver.isPlayer ? (driver.intent.move[0] ?? 0) : (driver.ai?.vehicleSteer ?? 0)) : 0;
          v.yawInput = yawInput;
          const airMass = Math.max(1, v.body.mass()) / 1000;
          v.body.applyTorqueImpulse({ x: -pitchInput * 900 * airMass, y: -yawInput * 1400 * airMass, z: -yawInput * 120 * airMass }, true);
          // forward cyclic: nose-down tilt translates into horizontal flight
          const fwdAir = rotateDir([0, 0, 1], v.body.rotation());
          if (Math.abs(v.throttle) > 0.05) {
            v.body.applyImpulse({ x: fwdAir[0] * v.throttle * v.body.mass() * 2.2 * dt, y: 0, z: fwdAir[2] * v.throttle * v.body.mass() * 2.2 * dt }, true);
          }
          v.rotorSpeed = lerp(v.rotorSpeed, v.destroyed ? 0.2 : 1, dt * 0.7);
          v.rotorAngle += v.rotorSpeed * dt * 40;
          v.landing = this.groundY(v.body.translation().x, v.body.translation().z) > v.body.translation().y - 2.5;
          const airVel = v.body.linvel();
          const airFwd = rotateDir([0, 0, 1], v.body.rotation());
          v.speed = airVel.x * airFwd[0] + airVel.z * airFwd[2];
          if (v.speed < 0.2 && Math.abs(v.throttle) < 0.05) v.speed = 0;
          // parked on its gear with the collective down: the gear holds the airframe
          if (v.landing && Math.abs(v.throttle) < 0.05 && Math.abs(v.body.linvel().y) < 3) {
            const lv = v.body.linvel();
            v.body.setLinvel({ x: lv.x * 0.9, y: 0, z: lv.z * 0.9 }, true);
          }
        }
        if (v.rotorHp !== undefined && v.rotorHp <= 0 && !v.landing) {
          v.body.applyTorqueImpulse({ x: (this.rng() - 0.5) * 40000, y: (this.rng() - 0.5) * 40000, z: (this.rng() - 0.5) * 40000 }, true);
        }
        // heavy airframes crash-land
        if (v.body.translation().y < this.groundY(v.body.translation().x, v.body.translation().z) + 1.2) {
          if (speed > 30) this.damageVehicle(v, 400, null, 'Крушение', [v.body.translation().x, v.body.translation().y, v.body.translation().z]);
          const gy = this.groundY(v.body.translation().x, v.body.translation().z);
          v.body.setTranslation({ x: v.body.translation().x, y: Math.max(gy + this.manifest[v.asset].dims[1] * 0.32, v.body.translation().y), z: v.body.translation().z }, true);
          v.body.setLinvel({ x: v.body.linvel().x * 0.85, y: Math.max(0, v.body.linvel().y), z: v.body.linvel().z * 0.85 }, true);
        }
      } else if (v.drive === 'boat') {
        const level = this.spec.water?.level ?? 0;
        const p = v.body.translation();
        const buoy = clamp((level - p.y + 0.4) * 2.2, -1, 3);
        v.body.applyImpulse({ x: 0, y: buoy * cfg.mass * dt * 3, z: 0 }, true);
        const fwd = rotateDir([0, 0, -1], v.body.rotation());
        v.body.applyImpulse({ x: fwd[0] * v.throttle * cfg.mass * dt * 0.5, y: 0, z: fwd[2] * v.throttle * cfg.mass * dt * 0.5 }, true);
        v.body.applyTorqueImpulse({ x: 0, y: -v.steer * cfg.mass * dt * 0.6, z: 0 }, true);
        v.speed = Math.hypot(v.body.linvel().x, v.body.linvel().z);
      }
      // amphibious / sinking vehicles in deep water
      const depth = waterDepth(this.spec, v.body.translation().x, v.body.translation().z);
      if (depth > 1.6 && !cfg.amphibious && v.drive !== 'air' && v.drive !== 'boat') {
        v.sinking += dt * 0.35;
        v.body.applyImpulse({ x: 0, y: -cfg.mass * 0.6 * dt, z: 0 }, true);
        if (v.sinking > 2.4 && !v.destroyed) {
          this.destroyVehicle(v, null);
          for (const oid of v.occupants) {
            if (oid != null) {
              const oc = this.chars.get(oid);
              if (!oc) continue;
              this.exitVehicle(oc);
              oc.eventsDrown = true;
              const drown = setTimeoutSim(this, 10, () => { if (oc.alive) this.damageCharacter(oc, 160, null, 'Утопление', false); });
              void drown;
              this.events.push({ e: 'notice', text: 'Экипаж покидает тонущую машину! 10 секунд на эвакуацию.' });
            }
          }
        }
      }
      // weapons
      v.fireCd = Math.max(0, v.fireCd - dt);
      const gunner = driver;
      if (gunner && cfg.weapon && v.fireCd <= 0 && !v.destroyed) {
        const want = gunner.isPlayer ? gunner.intent.fire : (gunner.ai?.fire ?? false);
        if (want && (Math.abs(v.steer) > 0.9 ? false : true)) {
          const muzzle: Vec3 = [v.body.translation().x, v.body.translation().y + 1.6, v.body.translation().z];
          const aimDir: Vec3 = gunner.isPlayer ? dirFromYawPitch(gunner.yaw, gunner.pitch) : dirFromYawPitch(gunner.ai?.yaw ?? 0, gunner.ai?.pitch ?? 0);
          v.fireCd = 60 / (cfg.rpm ?? 120);
          const isShell = (cfg.damage ?? 20) > 300;
          this.addProjectile({
            kind: isShell ? 'shell' : 'bullet', pos: muzzle, vel: mul(aimDir, cfg.muzzle ?? 900), owner: gunner.id, team: v.team ?? 0,
            damage: cfg.damage ?? 40, explosive: cfg.explosive ?? 0, weapon: v.asset, gravity: -9.81, drag: 0.0004,
            penetration: 3, life: 6
          });
          this.events.push({ e: 'shot', pos: muzzle, dir: aimDir, weapon: v.asset, owner: gunner.id });
        }
      }
      // sync mesh
      const p = v.body.translation(), q = v.body.rotation();
      v.mesh.pos = [p.x, p.y - this.manifest[v.asset].dims[1] * 0.3, p.z];
      v.mesh.quat = [q.x, q.y, q.z, q.w];
    }
  }

  rotorHp = 1;

  updateProps(dt: number) {
    void dt;
    for (const p of this.props) {
      if (!p.body || !p.dynamic) continue;
      const t = p.body.translation(), q = p.body.rotation();
      p.mesh.pos = [t.x, t.y, t.z];
      p.mesh.quat = [q.x, q.y, q.z, q.w];
    }
  }

  updateDebris(dt: number) {
    this.debris = this.debris.filter(d => {
      if (this.time - d.born > 600) { this.world.removeRigidBody(d.body); return false; }
      if (d.meshId < 0) { const t = d.body.translation(); d.asleep = d.body.isSleeping?.() ?? false; void t; }
      return true;
    });
    void dt;
  }

  updateWorldCues(dt: number) {
    void dt;
    // mines
    for (const m of this.mines) {
      m.fuse -= dt;
      if (!m.armed && m.fuse <= 0) m.armed = true;
      if (!m.armed) continue;
      for (const ch of this.chars.values()) {
        if (!ch.alive || ch.team === m.team) continue;
        const d = Math.hypot(ch.pos[0] - m.x, ch.pos[2] - m.z);
        if (d < (m.kind === 'w_c4' ? 3 : 2.2) || (m.kind === 'w_mon' && d < 6)) {
          this.explode([m.x, m.y + 0.4, m.z], m.kind === 'w_c4' ? 9 : 6, { id: 0, kind: 'mine', pos: [m.x, m.y, m.z], vel: [0, 0, 0], owner: m.owner, team: m.team, life: 0, damage: 120, explosive: 3, weapon: m.kind, gravity: 0, drag: 0, tracer: false, penetrations: 0, armed: true, fuse: 0, radius: 7, bounces: 0, meshActive: false, meshPos: [0, 0, 0] }, 'mine');
          m.armed = false; m.fuse = 9999;
          break;
        }
      }
    }
    this.mines = this.mines.filter(m => m.fuse < 9000);
    this.projectiles = this.projectiles.filter(pr => pr.life > -0.5);
    // bots respawn
    for (const ch of this.chars.values()) {
      if (!ch.alive && (ch as any).respawnAt && this.time > (ch as any).respawnAt) {
        if (ch.isPlayer) continue;
        this.reviveCharacter(ch);
      }
    }
    // player death respawn handled on input; keep 5s window
    if (this.player && !this.player.alive) {
      const c = this.player as any;
      if (c.respawnAt && this.time > c.respawnAt + 0.1 && this.autoRespawn) this.reviveCharacter(this.player);
    }
    // mcom arming/defuse & rush state
    for (const m of this.mcoms) {
      if (m.destroyed) continue;
      const attackers = [...this.chars.values()].filter(c => c.alive && c.team === 1 && Math.hypot(c.pos[0] - m.x, c.pos[2] - m.z) < 4);
      const defenders = [...this.chars.values()].filter(c => c.alive && c.team === 0 && Math.hypot(c.pos[0] - m.x, c.pos[2] - m.z) < 4);
      if (attackers.length && !m.armed) { m.armed = true; m.progress = 0; }
      if (m.armed) {
        if (defenders.length && !attackers.length) { m.armed = false; m.progress = 0; }
        else if (attackers.length) { m.progress += 100 / 30 * 1; }
        if (m.progress >= 100) { m.destroyed = true; m.armed = false; this.explode([m.x, m.y + 1, m.z], 16, null, 'mcom'); this.events.push({ e: 'notice', text: 'М-СОМ уничтожен!' }); }
      }
    }
  }

  autoRespawn = false;

  /** spawn point selection for the player: nearest owned capture point / team base cluster */

  /** debug/test hook: nearest structure to a point (id) */
  structureReport(limit = 40) {
    return this.structures.slice(0, limit).map(s => ({ id: s.id, asset: s.asset, x: s.x, y: s.y, z: s.z, health: s.health, maxHealth: s.maxHealth, collapsed: s.collapsed, walls: s.walls.filter(w => w.alive).length, supports: s.supports.filter(w => w.alive).length, sections: s.sections.filter(w => w.alive).length }));
  }

  nearestStructure(pos: Vec3) {
    let best: StructureInst | null = null, bd = Infinity;
    for (const s of this.structures) {
      const d = (s.x - pos[0]) ** 2 + (s.z - pos[2]) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best ? { id: best.id, x: best.x, z: best.z, sections: best.sections.length, walls: best.walls.length, collapsed: best.collapsed } : null;
  }

  /** debug/test hook: teleport the player (validation of collision / spawn areas) */
  debugGoto(pos: Vec3) {
    const p = this.player;
    if (!p) return;
    p.pos = [...pos];
    p.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true);
    p.mesh.pos = [...pos];
  }

  respawnPlayerAt(index: number) {
    const p = this.player;
    if (!p) return;
    const owned = this.points.filter(pt => pt.owner === p.team);
    const base = this.spec.teamSpawns[String(p.team) as '0' | '1'];
    const usePoint = owned[index % Math.max(1, owned.length)] ?? null;
    const anchor = usePoint ?? base[index % Math.max(1, base.length)] ?? { x: 0, z: 0 };
    const a = this.rng() * Math.PI * 2, r = 5 + this.rng() * 12;
    p.pos = [anchor.x + Math.cos(a) * r, this.groundY(anchor.x, anchor.z) + 1.0, anchor.z + Math.sin(a) * r];
    p.body.setTranslation({ x: p.pos[0], y: p.pos[1], z: p.pos[2] }, true);
    this.reviveCharacter(p);
    p.pos = [anchor.x + Math.cos(a) * r, this.groundY(anchor.x, anchor.z) + 1.0, anchor.z + Math.sin(a) * r];
    p.body.setTranslation({ x: p.pos[0], y: p.pos[1], z: p.pos[2] }, true);
    p.mesh.pos = [...p.pos];
    p.mesh.hidden = false; p.mesh.dirty = true;
  }

  updateModes(dt: number) {
    // capture points
    for (const pt of this.points) {
      let n0 = 0, n1 = 0;
      for (const ch of this.chars.values()) if (ch.alive && ch.vehicle === null) {
        const d = Math.hypot(ch.pos[0] - pt.x, ch.pos[2] - pt.z);
        if (d < pt.radius) { if (ch.team === 0) n0++; else n1++; }
      }
      pt.contested = n0 > 0 && n1 > 0 ? 1 : 0;
      if (n0 > n1 && pt.owner !== 0) { pt.progress += (n0 - n1) * dt * 12; if (pt.progress >= 100) { pt.owner = 0; pt.progress = 0; this.events.push({ e: 'point', id: pt.id, team: 0, progress: 100 }); this.events.push({ e: 'notice', text: `${pt.name} захвачен` }); } }
      else if (n1 > n0 && pt.owner !== 1) { pt.progress += (n1 - n0) * dt * 12; if (pt.progress >= 100) { pt.owner = 1; pt.progress = 0; this.events.push({ e: 'point', id: pt.id, team: 1, progress: 100 }); this.events.push({ e: 'notice', text: `${pt.name} захвачен противником` }); } }
      else if (n0 === 0 && n1 === 0 && pt.owner !== null) { /* hold */ }
      if (pt.owner !== null) { const enemy: Team = pt.owner === 0 ? 1 : 0; void enemy; }
    }
    // ticket bleed for held majority in Conquest
    if (this.cfg.mode === 'conquest' || this.cfg.mode === 'campaign') {
      const c0 = this.points.filter(p => p.owner === 0).length, c1 = this.points.filter(p => p.owner === 1).length;
      if (c0 > c1) this.tickets[1] -= (c0 - c1) * dt * 0.35;
      if (c1 > c0) this.tickets[0] -= (c1 - c0) * dt * 0.35;
      this.tickets = [Math.max(-1, this.tickets[0]), Math.max(-1, this.tickets[1])];
    }
    if (this.cfg.mode === 'rush') {
      const sectorMcoms = this.mcoms.filter(m => m.sector === this.sector);
      if (sectorMcoms.every(m => m.destroyed) && this.sector < 1) { this.sector++; this.events.push({ e: 'notice', text: 'Сектор прорван. Второй рубеж!' }); }
      if (this.mcoms.every(m => m.destroyed)) this.endMatch(1);
    }
    if (this.cfg.mode === 'holdout') {
      // enemies attack the building; waves push in
      const enemiesAlive = [...this.chars.values()].filter(c => c.team === 1 && c.alive).length;
      if (enemiesAlive === 0) {
        this.wave++;
        if (this.wave > this.wavesTotal) this.endMatch(0);
        else {
          this.events.push({ e: 'notice', text: `Волна ${this.wave} из ${this.wavesTotal}` });
          for (const ch of this.chars.values()) {
            if (ch.team === 1) {
              const spawn = this.pickSpawn(1);
              ch.pos = [spawn.x, this.groundY(spawn.x, spawn.z) + 1, spawn.z];
              if (!ch.alive) this.reviveCharacter(ch);
              else ch.body.setTranslation({ x: ch.pos[0], y: ch.pos[1], z: ch.pos[2] }, true);
            }
          }
        }
      }
    }
    if (this.cfg.mode === 'range') { this.tickets = [0, 0]; return; }
    if (this.tickets[0] <= 0 || this.tickets[1] <= 0) {
      if (this.tickets[0] <= 0 && this.tickets[1] <= 0) this.endMatch(null);
      else this.endMatch(this.tickets[0] > 0 ? 0 : 1);
    }
  }

  endMatch(winner: number | null) {
    if (this.over) return;
    this.over = true; this.winner = winner;
    this.events.push({ e: 'notice', text: winner === null ? 'Ничья' : winner === 0 ? 'Победа советских войск' : 'Противник победил' });
  }

  collectContacts() {
    this.eventQueue.drainCollisionEvents((h1: number, h2: number, started: boolean) => {
      if (!started) return;
      const rec1 = this.destroyIndex.get(h1), rec2 = this.destroyIndex.get(h2);
      if (!rec1 || !rec2) return;
      // vehicle ramming: destroy props / damage structures with momentum
      if (rec1.kind === 'vehicle' && rec2.kind === 'prop' && rec2.ref.body) {
        const v = rec1.ref as VehicleInst; const prop = rec2.ref as PropInst;
        const speed = Math.hypot(v.body.linvel().x, v.body.linvel().y, v.body.linvel().z);
        if (speed > 4) {
          const mass = VEHICLES[v.asset].mass;
          const energy = 0.5 * mass * speed * speed;
          if (energy > 40000) { this.damageProp(prop, energy / 300, [v.body.translation().x, v.body.translation().y, v.body.translation().z], v.occupants[0]); }
          this.events.push({ e: 'sound', pos: [v.body.translation().x, v.body.translation().y, v.body.translation().z], kind: 'ram', volume: 1 });
          if (prop.body?.isDynamic()) prop.body.applyImpulse({ x: v.body.linvel().x * 120, y: 320, z: v.body.linvel().z * 120 }, true);
          if (energy > 120000) this.damageVehicle(v, energy / 9000, null, 'Таран', [v.body.translation().x, v.body.translation().y, v.body.translation().z]);
        }
      }
      if (rec1.kind === 'vehicle' && rec2.kind === 'structure') {
        const v = rec1.ref as VehicleInst, st = rec2.ref as StructureInst;
        const speed = Math.hypot(v.body.linvel().x, v.body.linvel().y, v.body.linvel().z);
        if (speed > 6) {
          const mass = VEHICLES[v.asset].mass;
          const energy = 0.5 * mass * speed * speed * 0.05;
          this.damageStructure(st, Math.min(180, energy / 200), [v.body.translation().x, v.body.translation().y + 1, v.body.translation().z], 'ram', v.occupants[0]);
          this.damageVehicle(v, energy / 9000, null, 'Таран', [v.body.translation().x, v.body.translation().y, v.body.translation().z]);
        }
      }
      if (rec1.kind === 'debris' && rec2.kind === 'structure' && Math.random() < 0.02) {
        const b = (rec1.ref as { body: RB }).body;
        const p = b.translation();
        const lv = b.linvel();
        const speed = Math.hypot(lv.x, lv.y, lv.z);
        if (speed > 5) this.damageStructure(rec2.ref as StructureInst, speed * 4, [p.x, p.y, p.z], 'debris', null);
      }
    });
    this.eventQueue.drainContactForceEvents(() => { /* force data available for future tuning */ });
  }

  /* ------------------------------- snapshots ----------------------------- */
  buildAiSnapshot(): AiObservation[] {
    const out: AiObservation[] = [];
    for (const ch of this.chars.values()) {
      if (ch.isPlayer || !ch.alive) continue;
      let cached = this.visionCache.get(ch.id);
      if (!cached || this.tick - cached.tick > 6 + (ch.id % 5)) {
        const list: { id: number; pos: Vec3; dist: number }[] = [];
        for (const other of this.chars.values()) {
          if (other.team === ch.team || !other.alive) continue;
          const d = dist(other.pos, ch.pos);
          if (d > 230) continue;
          if (this.canSee(ch, other)) list.push({ id: other.id, pos: [...other.pos], dist: d });
        }
        cached = { tick: this.tick, list, target: ch.ai?.target ?? null };
        this.visionCache.set(ch.id, cached);
      }
      out.push({ id: ch.id, team: ch.team, pos: [...ch.pos], hp: ch.hp, alive: ch.alive, vehicle: ch.vehicle,
        visibleEnemies: cached.list, target: ch.ai?.target ?? null, suppressed: ch.suppressed, lastDamage: ch.lastDamage,
        cls: ch.cls, ammoRatio: ch.magazine / WEAPONS[ch.weapon].magazine, objective: ch.aiState, yaw: ch.yaw });
    }
    return out;
  }

  buildSnapshot(): Snapshot {
    const entities: EntitySnapshot[] = [];
    for (const ch of this.chars.values()) {
      const isPlayer = ch.isPlayer;
      entities.push({
        id: ch.id, kind: isPlayer ? 'player' : 'bot', asset: ch.mesh.asset, team: ch.team,
        pos: [ch.pos[0], ch.pos[1], ch.pos[2]], quat: [0, Math.sin(ch.yaw / 2), 0, Math.cos(ch.yaw / 2)],
        hp: ch.hp, maxHp: ch.maxHp, alive: ch.alive, stance: ch.stance, name: ch.name, cls: ch.cls,
        vehicle: ch.vehicle ?? undefined, seat: ch.seat, aim: [ch.yaw, ch.pitch, 0] as any,
        ammo: ch.magazine, magazine: ch.magazine, reloading: ch.reloading, spotted: ch.spottedBy.length > 0,
        status: ch.aiState
      });
    }
    for (const v of this.vehicles.values()) {
      entities.push({
        id: 1000 + v.id, kind: 'vehicle', asset: v.asset, team: v.team ?? 0,
        pos: [v.body.translation().x, v.body.translation().y, v.body.translation().z],
        quat: [v.body.rotation().x, v.body.rotation().y, v.body.rotation().z, v.body.rotation().w],
        hp: v.hp, maxHp: v.maxHp, alive: !v.destroyed, destroyed: v.destroyed, burning: v.destroyed,
        turretYaw: v.turretYaw, speed: v.speed, rotor: v.rotorAngle, driver: v.occupants[0] ?? undefined,
        seat: v.occupants.filter(o => o != null).length, wheelSpin: v.speed * 7
      });
    }
    for (const pr of this.projectiles) if (pr.kind !== 'bullet') entities.push({ id: pr.id, kind: 'projectile', asset: pr.kind, team: pr.team, pos: [...pr.pos], quat: [0, 0, 0, 1], hp: 1, maxHp: 1, alive: true, status: pr.kind });
    for (const d of this.debris) {
      const p = d.body.translation(), q = d.body.rotation();
      entities.push({ id: d.body.handle * 7 + 3, kind: 'debris', asset: d.size > 2.2 ? 'debris_large' : 'debris_small', team: 0, pos: [p.x, p.y, p.z], quat: [q.x, q.y, q.z, q.w], hp: 1, maxHp: 1, alive: true, status: d.size > 2.2 ? 'large' : 'small' });
    }
    const p = this.player!;
    const pv = p.vehicle !== null ? this.vehicles.get(p.vehicle) : null;
    const playerState: PlayerStateSnapshot = {
      hp: p.hp, maxHp: p.maxHp, stamina: p.stamina, oxygen: p.oxygen, ammo: p.magazine, magazine: WEAPONS[p.weapon].magazine,
      reserve: p.reserve, reloading: p.reloading, weapon: p.weapon, gadgets: Object.entries(p.gadgetCharges).map(([id, n]) => ({ id, charges: n })),
      seat: p.seat, vehicle: p.vehicle, vehicleHp: pv?.hp ?? 0, vehicleMax: pv?.maxHp ?? 0,
      killedBy: p.alive ? null : p.lastKilledBy, alive: p.alive, stance: p.stance, sprint: p.sprint,
      underWater: waterDepth(this.spec, p.pos[0], p.pos[2]) > 1.6, score: p.score, kills: p.kills, deaths: p.deaths,
      assists: p.assists, capture: this.points.filter(pt => pt.owner === p.team).length, vehWeaponReady: (pv?.fireCd ?? 0) <= 0,
      ads: p.ads, cls: p.cls, speed: pv ? pv.speed : Math.hypot(p.vel[0], p.vel[2]),
      xp: p.score, matchTime: this.time, wave: this.wave, waves: this.wavesTotal
    };
    const ai: AiObservation[] = [];
    for (const ch of this.chars.values()) {
      if (ch.isPlayer || !ch.alive) continue;
      let cached = this.visionCache.get(ch.id);
      if (!cached || this.tick - cached.tick > 6 + (ch.id % 5)) {
        const list: { id: number; pos: Vec3; dist: number }[] = [];
        for (const other of this.chars.values()) {
          if (other.team === ch.team || !other.alive) continue;
          const d = dist(other.pos, ch.pos);
          if (d > 230) continue;
          if (this.canSee(ch, other)) list.push({ id: other.id, pos: [...other.pos], dist: d });
        }
        cached = { tick: this.tick, list, target: ch.ai?.target ?? null };
        this.visionCache.set(ch.id, cached);
      }
      const visible = cached.list;
      ai.push({ id: ch.id, team: ch.team, pos: [...ch.pos], hp: ch.hp, alive: ch.alive, vehicle: ch.vehicle, visibleEnemies: visible, target: ch.ai?.target ?? null, suppressed: ch.suppressed, lastDamage: ch.lastDamage, cls: ch.cls, ammoRatio: ch.magazine / WEAPONS[ch.weapon].magazine, objective: ch.aiState, yaw: ch.yaw });
    }
    // the first snapshot carries every mesh mask so the renderer can bind holes to buildings;
    // afterwards only changed records are sent.
    const updates: { id: number; vis: number[]; hidden: boolean }[] = [];
    for (const m of this.meshes.values()) {
      if (!m.dirty) continue;
      m.dirty = false;
      updates.push({ id: m.id, vis: Array.from(m.vis), hidden: m.hidden ?? false });
      this.lastSentMasks.set(m.id, { vis: Uint8Array.from(m.vis), hidden: m.hidden ?? false });
    }
    // team visibility filtering: strip enemies the player cannot see (no wallhacks)
    const playerTeam = this.player!.team;
    const filteredAi = ai.map(o => o.team === playerTeam ? o : { ...o, pos: [0, 0, 0] as Vec3, visibleEnemies: o.visibleEnemies.map(v => ({ ...v, pos: [0, 0, 0] as Vec3 })) });
    return {
      entities, player: playerState, tick: this.tick, time: this.time, tickets: [...this.tickets] as [number, number],
      points: this.points.map(pt => ({ id: pt.id, owner: pt.owner, progress: pt.progress, contested: pt.contested })),
      ai: filteredAi,
      projectiles: this.projectiles.filter(pr => pr.kind !== 'bullet').map(pr => ({ id: pr.id, pos: [...pr.pos], vel: [...pr.vel], kind: pr.kind })),
      meshUpdates: updates,
      profiles: { ...this.prof, castMs: this.castTime / 10, castN: this.castCount / 10, rayMs: this.rayTime / 10, rayN: this.rayCount / 10 },
      targets: this.rangeTargets.map(t => ({ x: t.x, y: t.y, z: t.z, kind: t.kind, hit: t.hit })),
      props: this.props.filter(p => p.dynamic && p.body).map(p => {
        const t = p.body!.translation(), q = p.body!.rotation();
        return { id: p.id, pos: [t.x, t.y, t.z] as Vec3, quat: [q.x, q.y, q.z, q.w] as [number, number, number, number] };
      }),
      craters: this.craters.slice(-60),
      mcoms: this.mcoms.map(m => ({ id: m.id, x: m.x, z: m.z, armed: m.armed, progress: m.progress, destroyed: m.destroyed, sector: m.sector })),
      vehicles: [...this.vehicles.values()].map(v => ({ id: v.id, asset: v.asset, pos: [v.body.translation().x, v.body.translation().y, v.body.translation().z] as Vec3, quat: [v.body.rotation().x, v.body.rotation().y, v.body.rotation().z, v.body.rotation().w] as [number, number, number, number], turretYaw: v.turretYaw, speed: v.speed, rotor: v.rotorAngle, destroyed: v.destroyed, hp: v.hp, max: v.maxHp }))
    };
  }

  canSee(a: CharState, b: CharState) {
    const eye = this.eyePos(a);
    const target = this.eyePos(b);
    const d = sub(target, eye);
    const dl = len(d);
    if (dl > 240) return false;
    const dir = mul(d, 1 / dl);
    const fwd = dirFromYawPitch(a.yaw, a.pitch);
    const cos = dot(fwd, dir);
    const fov = 0.2; // ~78° cone of vision
    if (cos < fov && a.suppressed < 0.8) return false;
    const hit = this.raycast(eye, dir, dl - 0.4, a.id);
    if (hit && hit.kind !== 'char') {
      // dust and smoke reduce detection
      const smokePenalty = hit.kind === 'structure' ? 0 : 0;
      void smokePenalty;
      return false;
    }
    return true;
  }
}

function rotateInv(v: Vec3, q: { x: number; y: number; z: number; w: number }): Vec3 {
  const ix = -q.x, iy = -q.y, iz = -q.z, iw = q.w;
  const tx = 2 * (iy * v[2] - iz * v[1]);
  const ty = 2 * (iz * v[0] - ix * v[2]);
  const tz = 2 * (ix * v[1] - iy * v[0]);
  return [v[0] + iw * tx + (iy * tz - iz * ty), v[1] + iw * ty + (iz * tx - ix * tz), v[2] + iw * tz + (ix * ty - iy * tx)];
}
function rotateDir(v: Vec3, q: { x: number; y: number; z: number; w: number }): Vec3 {
  const tx = 2 * (q.y * v[2] - q.z * v[1]);
  const ty = 2 * (q.z * v[0] - q.x * v[2]);
  const tz = 2 * (q.x * v[1] - q.y * v[0]);
  return [v[0] + q.w * tx + (q.y * tz - q.z * ty), v[1] + q.w * ty + (q.z * tx - q.x * tz), v[2] + q.w * tz + (q.x * ty - q.y * tx)];
}
function rayBoxHit(origin: Vec3, dir: Vec3, center: Vec3, size: Vec3): number | null {
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

interface SimTimers { timers: { at: number; fn: () => void }[] }
const timerStore = new WeakMap<SimEngine, SimTimers>();
export function pumpTimers(sim: SimEngine) {
  const store = timerStore.get(sim);
  if (!store) return;
  const due = store.timers.filter(t => t.at <= sim.time);
  if (!due.length) return;
  store.timers = store.timers.filter(t => t.at > sim.time);
  for (const t of due) { try { t.fn(); } catch (e) { console.warn(e); } }
}
function setTimeoutSim(sim: SimEngine, seconds: number, fn: () => void) {
  let store = timerStore.get(sim);
  if (!store) { store = { timers: [] }; timerStore.set(sim, store); }
  store.timers.push({ at: sim.time + seconds, fn });
  return fn;
}
