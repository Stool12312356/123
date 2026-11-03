/// <reference lib="webworker" />
// Bot brains: behaviour trees + tactical navigation. Runs fully off the render thread.
import type { AiObservation, BotIntent, Difficulty, ClassId, Vec3, MatchConfig, MapId } from '../shared/types';
import { DIFFICULTY, CLASSES } from '../shared/config';
import { mulberry32, norm, sub, dist } from '../shared/mathx';

interface Brain {
  id: number; team: 0 | 1; cls: ClassId; reactionT: number; target: number | null; lastSeen: Vec3 | null;
  state: 'advance' | 'engage' | 'cover' | 'flank' | 'retreat' | 'driver' | 'suppressed' | 'capture' | 'defend';
  waypoint: Vec3 | null; pathT: number; nextDecision: number; scanT: number; strafe: number; strafeT: number;
  driverTarget: Vec3 | null; patrolIdx: number; suppressT: number; lastReload: number; vehicleCd: number;
  stuckT: number; lastPos: Vec3; order: string; orderTarget: Vec3 | null; ammoLow: boolean;
  flare: number; botNeed: number; repairT: number; reviveT: number; classRole: string;
  path: Vec3[]; pathTtl: number; pathGoal: Vec3 | null;
}
interface GridCell { blocked: boolean; cost: number }
interface NavGrid { cells: GridCell[]; size: number; cell: number; half: number }

type Cmd =
  | { t: 'init'; obs: AiObservation[]; config: MatchConfig; points: { id: string; x: number; z: number; owner: number | null; radius: number }[]; vehicles: { id: number; x: number; z: number; seats: number; drive: string; team: number | null }[]; obstacles: { x: number; z: number; r: number }[]; map: MapId }
  | { t: 'tick'; obs: AiObservation[]; points: { id: string; x: number; z: number; owner: number | null; radius: number }[]; vehicles: { id: number; x: number; z: number; seats: number; drive: string; team: number | null; hp?: number; max?: number }[]; destroyed: { x: number; z: number; r: number }[]; downed?: { id: number; team: number; x: number; z: number }[]; time: number; order: { order: string; pos: Vec3 | null } | null; playerPos: Vec3 | null }
  | { t: 'dispose' };

const ctx: DedicatedWorkerGlobalScope = ((globalThis as any).__workerScope ?? self) as DedicatedWorkerGlobalScope;
let brains = new Map<number, Brain>();
let difficulty: Difficulty = 'sergeant';
let config: MatchConfig | null = null;
let nav: NavGrid | null = null;
let rng = mulberry32(4242);
let lastTick = 0;
let orders: { order: string; pos: Vec3 | null } | null = null;
let playerPos: Vec3 | null = null;
let points: { id: string; x: number; z: number; owner: number | null; radius: number }[] = [];
let vehicles: { id: number; x: number; z: number; seats: number; drive: string; team: number | null; hp?: number; max?: number }[] = [];
let wreckZones: { x: number; z: number; r: number }[] = [];
/** teammates currently down (dead but still inside the revive window), refreshed every tick */
let downed: { id: number; team: number; x: number; z: number }[] = [];

const NAV_SIZE = 192;

function buildNav(obstacles: { x: number; z: number; r: number }[], mapSize: number) {
  const cells: GridCell[] = new Array(NAV_SIZE * NAV_SIZE);
  for (let i = 0; i < cells.length; i++) cells[i] = { blocked: false, cost: 1 };
  const cell = mapSize / NAV_SIZE;
  const half = mapSize / 2;
  for (const o of obstacles) {
    const r = Math.max(cell, o.r);
    const x0 = Math.max(0, Math.floor((o.x - r + half) / cell)), x1 = Math.min(NAV_SIZE - 1, Math.ceil((o.x + r + half) / cell));
    const z0 = Math.max(0, Math.floor((o.z - r + half) / cell)), z1 = Math.min(NAV_SIZE - 1, Math.ceil((o.z + r + half) / cell));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const wx = -half + (x + 0.5) * cell, wz = -half + (z + 0.5) * cell;
      if ((wx - o.x) ** 2 + (wz - o.z) ** 2 < r * r) cells[z * NAV_SIZE + x].blocked = true;
    }
  }
  nav = { cells, size: NAV_SIZE, cell, half };
}

function toCell(p: Vec3): [number, number] | null {
  if (!nav) return null;
  const x = Math.floor((p[0] + nav.half) / nav.cell), z = Math.floor((p[2] + nav.half) / nav.cell);
  if (x < 0 || z < 0 || x >= nav.size || z >= nav.size) return null;
  return [x, z];
}
function fromCell(x: number, z: number): Vec3 { return [-nav!.half + (x + 0.5) * nav!.cell, 0, -nav!.half + (z + 0.5) * nav!.cell]; }

/** A* with runtime obstacle costs. Destroyed buildings open paths automatically. */
function findPath(from: Vec3, to: Vec3): Vec3[] {
  if (!nav) return [to];
  const start = toCell(from), goal = toCell(to);
  if (!start || !goal) return [to];
  if (start[0] === goal[0] && start[1] === goal[1]) return [to];
  const open: number[] = [start[1] * nav.size + start[0]];
  const inOpen = new Uint8Array(nav.size * nav.size);
  const gScore = new Float32Array(nav.size * nav.size).fill(Infinity);
  const fScore = new Float32Array(nav.size * nav.size).fill(Infinity);
  const came = new Int32Array(nav.size * nav.size).fill(-1);
  const closed = new Uint8Array(nav.size * nav.size);
  const si = start[1] * nav.size + start[0], gi = goal[1] * nav.size + goal[0];
  gScore[si] = 0;
  fScore[si] = Math.hypot(goal[0] - start[0], goal[1] - start[1]);
  let iterations = 0;
  inOpen[open[0]] = 1;
  while (open.length && iterations++ < 1500) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) if (fScore[open[i]] < fScore[open[bestIdx]]) bestIdx = i;
    const cur = open.splice(bestIdx, 1)[0];
    if (cur === gi) break;
    closed[cur] = 1;
    const cx = cur % nav.size, cz = Math.floor(cur / nav.size);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= nav.size || nz >= nav.size) continue;
      const ni = nz * nav.size + nx;
      if (closed[ni]) continue;
      const cellData = nav.cells[ni];
      if (cellData.blocked) continue;
      const step = dx && dz ? 1.414 : 1;
      const tentative = gScore[cur] + step * cellData.cost;
      if (tentative < gScore[ni]) {
        came[ni] = cur;
        gScore[ni] = tentative;
        fScore[ni] = tentative + Math.hypot(goal[0] - nx, goal[1] - nz);
        if (!inOpen[ni]) { inOpen[ni] = 1; open.push(ni); }
      }
    }
  }
  const path: Vec3[] = [];
  let c = gi;
  if (came[gi] === -1 && gi !== si) return [to];
  while (c !== si && c !== -1) { path.push(fromCell(c % nav.size, Math.floor(c / nav.size))); c = came[c]; }
  path.reverse();
  return path.length ? path : [to];
}

function ensureBrain(o: AiObservation): Brain {
  let b = brains.get(o.id);
  if (!b) {
    const r = rng();
    b = {
      id: o.id, team: o.team, cls: o.cls, reactionT: 0, target: null, lastSeen: null, state: 'advance',
      waypoint: null, pathT: 0, nextDecision: 0, scanT: 0, strafe: r > 0.5 ? 1 : -1, strafeT: 0,
      driverTarget: null, patrolIdx: Math.floor(r * 8), suppressT: 0, lastReload: 0, vehicleCd: 0,
      stuckT: 0, lastPos: [o.pos[0], o.pos[1], o.pos[2]], order: 'none', orderTarget: null, ammoLow: false,
      flare: r * 6, botNeed: 0, repairT: 0, reviveT: 0, classRole: CLASSES[o.cls]?.role ?? '', path: [], pathTtl: 0, pathGoal: null
    };
    brains.set(o.id, b);
  }
  return b;
}

const bt = {
  canFight(b: Brain, o: AiObservation) { return o.alive && o.hp > 25 && o.ammoRatio > 0.02; },
  shouldRetreat(b: Brain, o: AiObservation) { return o.hp < 28 && o.lastDamage < 2.5 && rng() < DIFFICULTY[difficulty].retreat * 0.4; },
  shouldSeekCover(b: Brain, o: AiObservation) { return o.suppressed > 0.7 || (o.hp < 55 && o.visibleEnemies.length > 0); },
  shouldSuppress(b: Brain, o: AiObservation) { return o.visibleEnemies.length > 0 && o.visibleEnemies[0].dist > 60 && b.cls === 'support'; },
  needsVehicle(b: Brain, o: AiObservation) {
    if (o.vehicle !== null) return false;
    const far = b.waypoint ? dist(o.pos, b.waypoint) > 140 : false;
    return far && b.vehicleCd <= 0 && vehicles.length > 0 && rng() < 0.25;
  },
  objective(b: Brain, o: AiObservation) {
    const mine = points.filter(p => p.owner === o.team);
    const enemy = points.filter(p => p.owner !== o.team);
    const pool = mine.length > points.length * 0.6 ? (enemy.length ? enemy : points) : points;
    if (!pool.length) return null;
    return pool[(o.id + b.patrolIdx) % pool.length];
  }
};

function decide(b: Brain, o: AiObservation, time: number) {
  const d = DIFFICULTY[difficulty];
  const visible = o.visibleEnemies.filter(v => v.dist < 260);
  let nearest = visible.sort((a, c) => a.dist - c.dist)[0] ?? null;
  b.reactionT = Math.max(0, b.reactionT - 1);
  if (nearest && nearest.id !== b.target) {
    b.target = nearest.id;
    b.reactionT = d.reaction * 60;
    b.lastSeen = [nearest.pos[0], nearest.pos[1], nearest.pos[2]];
  }
  if (!nearest && time - b.scanT > 150) { b.target = null; b.scanT = time; }
  const order = orders;
  if (order && order.order !== 'none' && o.team === (config?.playerTeam ?? 0)) {
    b.order = order.order; b.orderTarget = order.pos;
    if (order.order === 'attack' && order.pos) { b.waypoint = order.pos; }
    else if (order.order === 'defend' && order.pos) { b.waypoint = order.pos; }
    else if (order.order === 'follow' && playerPos) { const a = rng() * 6.28, r = 6 + rng() * 8; b.waypoint = [playerPos[0] + Math.cos(a) * r, 0, playerPos[2] + Math.sin(a) * r]; }
  }
  if (bt.shouldRetreat(b, o)) { b.state = 'retreat'; return; }
  if (o.suppressed > 1.1) { b.state = 'suppressed'; return; }
  if (bt.shouldSeekCover(b, o)) { b.state = 'cover'; return; }
  if (nearest && b.reactionT <= 0 && bt.canFight(b, o)) {
    b.state = nearest.dist < 45 && rng() < 0.18 ? 'flank' : 'engage';
    return;
  }
  if (bt.shouldSuppress(b, o)) { b.state = 'suppressed'; return; }
  const obj = bt.objective(b, o);
  if (obj && !b.waypoint) b.waypoint = [obj.x, 0, obj.z];
  b.state = 'advance';
}

function coverPoint(o: AiObservation, threat: Vec3): Vec3 {
  // pick a cell behind an obstacle relative to the threat
  let best: Vec3 | null = null, bestScore = -Infinity;
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2;
    const r = 4 + rng() * 16;
    const p: Vec3 = [o.pos[0] + Math.cos(a) * r, 0, o.pos[2] + Math.sin(a) * r];
    const c = toCell(p);
    if (!c) continue;
    const blockedNear = nav!.cells[c[1] * nav!.size + c[0]].blocked;
    if (blockedNear) continue;
    const toThreat = norm(sub(threat, p));
    let shield = 0;
    for (let s = 2; s < 14; s += 3) {
      const cc = toCell([p[0] + toThreat[0] * s, 0, p[2] + toThreat[2] * s]);
      if (cc && nav!.cells[cc[1] * nav!.size + cc[0]].blocked) { shield = 1 - s / 16; break; }
    }
    const score = shield * 2 - dist(o.pos, p) / 40;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best ?? o.pos;
}

function tick(obs: AiObservation[], time: number): BotIntent[] {
  const intents: BotIntent[] = [];
  const d = DIFFICULTY[difficulty];
  for (const o of obs) {
    if (!o.alive) { intents.push({ id: o.id, move: [0, 0], speed: 0, yaw: 0, pitch: 0, fire: false, reload: false, crouch: false, stance: 0 }); continue; }
    const b = ensureBrain(o);
    b.vehicleCd = Math.max(0, b.vehicleCd - 1);
    if (Math.floor(time) - b.nextDecision > 0) { b.nextDecision = Math.floor(time); decide(b, o, time); }
    const visible = o.visibleEnemies;
    const nearest = visible.sort((a, c) => a.dist - c.dist)[0] ?? null;
    const eye: Vec3 = [o.pos[0], o.pos[1] + 1.5, o.pos[2]];
    let move: [number, number] = [0, 0];
    let speed = 0;
    let yaw = o.yaw;
    let pitch = 0;
    let fire = false;
    let reload = o.ammoRatio < 0.15;
    let stance = o.suppressed > 0.5 ? 1 : 0;
    let crouch = stance === 1;
    let targetYaw = yaw;
    let targetPitch = pitch;
    const steer = (goal: Vec3, mag: number): [number, number, number] => {
      const dx = goal[0] - o.pos[0], dz = goal[2] - o.pos[2];
      const l = Math.hypot(dx, dz) || 1;
      const forward = Math.atan2(-dx / l, -dz / l);
      let rel = forward - o.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      return [Math.sin(rel) * mag, Math.cos(rel) * mag, forward];
    };
    if (nearest) {
      const distTo = nearest.dist;
      const aim: Vec3 = nearest.pos;
      targetYaw = Math.atan2(-(aim[0] - eye[0]), -(aim[2] - eye[2]));
      targetPitch = Math.atan2(aim[1] - eye[1], Math.hypot(aim[0] - eye[0], aim[2] - eye[2]));
      yaw = targetYaw; pitch = targetPitch;
      b.target = nearest.id;
      b.lastSeen = [aim[0], aim[1], aim[2]];
      // fire discipline with reaction/accuracy from difficulty table
      const inRange = distTo < (b.cls === 'recon' ? 320 : b.cls === 'support' ? 220 : 160);
      const aimErr = (1 - d.accuracy) * 0.06 + o.suppressed * 0.04;
      fire = b.reactionT <= 0 && inRange && rng() > aimErr * 0.8 && o.ammoRatio > 0.05;
      speed = b.state === 'engage' && distTo > 50 ? 1.6 : b.state === 'flank' ? 1.8 : 0.6;
      if (b.state === 'flank') {
        b.strafeT -= 1;
        if (b.strafeT <= 0) { b.strafe = rng() > 0.5 ? 1 : -1; b.strafeT = 60 + rng() * 80; }
        move = [b.strafe * 0.8, distTo > 30 ? 0.5 : -0.3];
        speed = 1.8;
      } else if (b.state === 'engage') {
        move = [0, 0];
        stance = distTo > 60 ? 1 : 0;
        crouch = stance === 1;
      } else if (b.state === 'cover') {
        const cp = coverPoint(o, aim);
        const st = steer(cp, 1);
        move = [st[0], st[1]]; yaw = st[2];
        speed = 1.5; crouch = true; stance = 1;
      }
    } else if (b.state === 'retreat' && b.lastSeen) {
      const away = norm(sub(o.pos, b.lastSeen));
      const st = steer([o.pos[0] + away[0] * 30, 0, o.pos[2] + away[2] * 30], 1);
      move = [st[0], st[1]]; yaw = st[2];
      speed = 1.9;
      b.waypoint = b.waypoint ?? null;
      if (visible.length === 0 && o.lastDamage > 4) b.state = 'advance';
    } else if (b.state === 'suppressed' && b.lastSeen) {
      // suppression fire into the last known position
      targetYaw = Math.atan2(-(b.lastSeen[0] - eye[0]), -(b.lastSeen[2] - eye[2]));
      yaw = targetYaw;
      fire = rng() < 0.5 && o.ammoRatio > 0.1;
      stance = 1;
      move = [0, 0];
    } else {
      // patrol / capture objective using the navigation grid
      const obj = bt.objective(b, o);
      let goal: Vec3 | null = b.waypoint;
      if (b.order === 'follow' && b.orderTarget && b.orderTarget[0] !== 0) goal = b.orderTarget;
      if (!goal && obj) goal = [obj.x, 0, obj.z];
      if (!goal) goal = [0, 0, 0];
      if (dist(o.pos, goal) < 6) {
        const a = rng() * 6.28, r = 8 + rng() * 20;
        b.waypoint = [goal[0] + Math.cos(a) * r, 0, goal[2] + Math.sin(a) * r];
        goal = b.waypoint;
      }
      const goalChanged = !b.pathGoal || dist(b.pathGoal, goal) > 10;
      if (goalChanged || b.pathTtl <= 0 || !b.path.length) {
        b.path = findPath(o.pos, goal); b.pathGoal = goal; b.pathTtl = 40 + (b.id % 25);
      } else b.pathTtl--;
      while (b.path.length > 1 && dist(o.pos, b.path[0]) < 3) b.path.shift();
      const next = b.path[0] ?? goal;
      const st = steer(next, b.cls === 'support' ? 0.75 : 1);
      move = [st[0], st[1]];
      yaw = st[2];
      speed = 1.35;
      if (dist(o.pos, goal) < 14) speed = 0.6;
    }
    // vehicle usage
    let enterVehicle: number | null = null;
    if (o.vehicle === null && b.vehicleCd <= 0 && (b.state === 'advance') && rng() < 0.02) {
      const near = vehicles.filter(v => v.seats > 0 && (v.team === null || v.team === o.team)).sort((a, c) => dist([a.x, 0, a.z], o.pos) - dist([c.x, 0, c.z], o.pos))[0];
      if (near && dist([near.x, 0, near.z], o.pos) < 25) { enterVehicle = near.id; b.vehicleCd = 300; }
    }
    // engineers patch friendly vehicles, medics pick up downed teammates: both are real
    // intents consumed by the sim (Engine.botRepair / Engine.botRevive)
    let repair = false;
    let revive = false;
    if (o.vehicle === null && (b.state === 'advance' || b.state === 'cover' || b.state === 'suppressed')) {
      b.repairT -= 1;
      b.reviveT -= 1;
      if (b.cls === 'engineer' && b.repairT <= 0 && rng() < 0.35) {
        const hurt = vehicles.some(v => v.team === o.team && dist([v.x, 0, v.z], o.pos) < 6 && (v.hp ?? 1) < (v.max ?? 1) * 0.9);
        if (hurt) { repair = true; b.repairT = 150; }
      }
      if (b.cls === 'assault' && b.reviveT <= 0 && rng() < 0.5) {
        const down = downed.some(d => d.team === o.team && dist([d.x, 0, d.z], o.pos) < 3.2);
        if (down) { revive = true; b.reviveT = 180; }
      }
    }
    const intent: BotIntent = {
      id: o.id, move, speed, yaw, pitch, fire, reload, crouch, stance,
      target: nearest?.id ?? b.target, aimPoint: b.lastSeen ?? undefined,
      enterVehicle, exitVehicle: o.vehicle !== null && b.state === 'retreat' ? true : undefined,
      vehicleThrottle: o.vehicle !== null ? (b.state === 'engage' ? 0.2 : 0.85) : undefined,
      vehicleSteer: o.vehicle !== null ? Math.sin((time + b.flare * 40) / 200) * 0.35 : undefined,
      gadget: rng() < 0.004, order: b.order, repair, revive
    };
    intents.push(intent);
    b.lastPos = [o.pos[0], o.pos[1], o.pos[2]];
  }
  return intents;
}

ctx.onmessage = (ev: MessageEvent<Cmd>) => {
  const msg = ev.data;
  if (msg.t === 'init') {
    config = msg.config;
    difficulty = msg.config.difficulty;
    points = msg.points;
    vehicles = msg.vehicles;
    buildNav(msg.obstacles, msg.map === 'suburb' ? 4000 : msg.map === 'harbor' ? 3000 : 2000);
    brains = new Map();
    ctx.postMessage({ t: 'ready', count: msg.obs.length });
  } else if (msg.t === 'tick') {
    points = msg.points; vehicles = msg.vehicles;
    downed = msg.downed ?? [];
    wreckZones = msg.destroyed.length ? msg.destroyed : wreckZones;
    if (nav && msg.destroyed.length) {
      for (const z of msg.destroyed) {
        const c = toCell([z.x, 0, z.z]);
        if (!c) continue;
        const r = Math.ceil(z.r / nav.cell);
        for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
          const nx = c[0] + dx, nz = c[1] + dz;
          if (nx < 0 || nz < 0 || nx >= nav.size || nz >= nav.size) continue;
          const idx = nz * nav.size + nx;
          // large rubble is walkable-around cover: lower cost, edges remain blocked for path interest
          nav.cells[idx].cost = 1.35;
        }
      }
    }
    orders = msg.order;
    playerPos = msg.playerPos;
    lastTick = msg.time;
    const t0 = performance.now();
    const intents = tick(msg.obs, msg.time);
    ctx.postMessage({ t: 'intents', list: intents, ms: performance.now() - t0, count: intents.length });
  } else if (msg.t === 'dispose') {
    brains.clear();
    ctx.close();
  }
};
