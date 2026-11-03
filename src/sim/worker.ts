/// <reference lib="webworker" />
import type { MainToSim, SimToMain } from './protocol';
import type { BotIntent, GameEvent, PlayerIntent } from '../shared/types';
import { SimEngine } from './engine';
import { loadAllAssets } from './assetgeo';
import { FIXED_DT, SNAPSHOT_HZ } from '../shared/constants';
import type { AiToSim } from './protocol';
import { WEAPONS as WEAPON_MAG } from '../shared/config';
const WEAPON_MAGAZINES: Record<string, number> = Object.fromEntries(Object.entries(WEAPON_MAG).map(([k, v]) => [k, v.magazine]));

// test hook: direct engine access for headless verification
(globalThis as any).__SimEngine = SimEngine;
(globalThis as any).__loadAllAssets = loadAllAssets;

const ctx: DedicatedWorkerGlobalScope = ((globalThis as any).__workerScope ?? self) as DedicatedWorkerGlobalScope;
let sim: SimEngine | null = null;
let aiWorker: Worker | null = null;
let latestIntents: BotIntent[] = [];
let aiInFlight = false;
let lastAiSent = 0;
let snapshotAcc = 0;
let intent: PlayerIntent | null = null;
let order: { order: 'follow' | 'attack' | 'defend' | 'none'; pos?: [number, number, number]; pointId?: string } | null = null;
let loopTimer: ReturnType<typeof setInterval> | null = null;
let frames = 0, lastStat = 0, lastTickAt = performance.now();
const pendingFrameEvents: GameEvent[] = [];
const pendingMeshUpdates = new Map<number, { id: number; vis: number[]; hidden: boolean }>();

const post = (m: SimToMain) => ctx.postMessage(m);
const SIM_WEAPONS = (id: string) => WEAPON_MAGAZINES[id] ?? 30;

async function init(msg: Extract<MainToSim, { t: 'init' }>) {
  const { geo, failed } = await loadAllAssets(msg.manifest, (done, total) => {
    post({ t: 'status', phase: 'assets', text: `Загрузка моделей ${done}/${total}` });
  });
  if (failed.length) console.warn('[sim] assets failed to load, placeholders active:', failed);
  const cleanGeo: Record<string, any> = {};
  for (const [id, g] of geo) cleanGeo[id] = g;
  sim = new SimEngine(msg.config.quality);
  const merged = JSON.parse(JSON.stringify({ ...msg.manifest }));
  await sim.init(msg.world, merged, cleanGeo, msg.config);
  // AI worker
  aiWorker?.terminate();
  const workerFactory = (globalThis as any).__createAIWorker;
  const aiw: Worker = workerFactory ? workerFactory() : new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' });
  aiWorker = aiw;
  aiw.onmessage = (ev: MessageEvent<AiToSim>) => {
    const m = ev.data;
    if (m.t === 'intents' && sim) {
      if (m.ms !== undefined) (sim as any).aiMs = m.ms;
      latestIntents = m.list;
      aiInFlight = false;
      sim.stepAI(m.list);
    }
  };
  aiw.onerror = (e: ErrorEvent) => { console.error('[ai]', e.message); aiInFlight = false; };
  const obstacles = [...msg.world.structures.map(s => ({ x: s.x, z: s.z, r: Math.max(8, (msg.manifest[s.asset]?.dims[0] ?? 16) / 2) })), ...msg.world.props.filter(p => p.asset.includes('tree')).map(p => ({ x: p.x, z: p.z, r: 1.2 }))];
  aiw.postMessage({
    t: 'init', obs: sim.buildAiSnapshot(), config: msg.config,
    points: sim.points.map(p => ({ id: p.id, x: p.x, z: p.z, owner: p.owner, radius: p.radius })),
    vehicles: [...sim.vehicles.values()].map(v => ({ id: v.id, x: v.body.translation().x, z: v.body.translation().z, seats: v.seats - v.occupants.filter(o => o != null).length, drive: v.drive, team: v.team })),
    obstacles, map: msg.world.mapId
  });
  const meshMap = [...sim.meshes.values()].map(m => ({ id: m.id, asset: m.asset, x: m.pos[0], y: m.pos[1], z: m.pos[2] }));
  post({ t: 'ready', meshes: meshMap, spawnPoints: sim.points.map(p => ({ name: p.name, x: p.x, z: p.z, team: p.owner ?? -1 })), vehicles: [...sim.vehicles.values()].map(v => ({ id: v.id, asset: v.asset, x: v.body.translation().x, z: v.body.translation().z, team: v.team })) });
  startLoop();
}

function aiTick() {
  if (!sim || !aiWorker || aiInFlight) return;
  if (performance.now() - lastAiSent < 110) return;
  const snap = { ai: sim.buildAiSnapshot() };
  lastAiSent = performance.now();
  aiInFlight = true;
  aiWorker.postMessage({
    t: 'tick', obs: snap.ai, time: Math.round(performance.now() / 16.67),
    points: sim.points.map(p => ({ id: p.id, x: p.x, z: p.z, owner: p.owner, radius: p.radius })),
    vehicles: [...sim.vehicles.values()].filter(v => !v.destroyed).map(v => ({ id: v.id, x: v.body.translation().x, z: v.body.translation().z, seats: v.seats - v.occupants.filter(o => o != null).length, drive: v.drive, team: v.team, hp: v.hp, max: v.maxHp })),
    destroyed: sim.craters.slice(-6).map(c => ({ x: c.x, z: c.z, r: c.r })),
    downed: [...sim.chars.values()].filter(c => !c.alive && !c.isPlayer && c.team === (sim!.player?.team ?? 0))
      .slice(0, 24).map(c => ({ id: c.id, team: c.team, x: c.pos[0], z: c.pos[2] })),
    order: order ? { order: order.order, pos: order.pos ?? null } : null,
    playerPos: sim.player ? [...sim.player.pos] : null
  });
}

function startLoop() {
  if (loopTimer !== null) clearInterval(loopTimer);
  lastTickAt = performance.now();
  loopTimer = setInterval(() => {
    if (!sim) return;
    const now = performance.now();
    const elapsed = Math.min(120, now - lastTickAt);
    lastTickAt = now;
    if (sim.paused) return;
    const steps = Math.max(1, Math.min(4, Math.round(elapsed / (FIXED_DT * 1000))) + 1);
    let result = null;
    for (let i = 0; i < steps; i++) {
      if (intent) sim.updatePlayerIntent(intent);
      result = sim.step(FIXED_DT);
      // events are queued across ticks and flushed with the next posted snapshot, so a tick
      // that does not produce a snapshot never swallows a shot, explosion or collapse
      if (result.events.length) {
        for (const e of result.events) pendingFrameEvents.push(e);
        if (pendingFrameEvents.length > 900) pendingFrameEvents.splice(0, pendingFrameEvents.length - 900);
      }
      // intermediate ticks have their snapshots discarded, so keep their destruction deltas
      for (const u of result.snapshot.meshUpdates) pendingMeshUpdates.set(u.id, u);
    }
    frames += steps;
    if (now - lastStat > 1000) {
      lastStat = now;
      (sim as any).perf = { ticks: (sim as any).perf?.ticks ? (sim as any).perf.ticks : 0 };
    }
    snapshotAcc += elapsed / 1000;
    if (result && snapshotAcc >= 1 / SNAPSHOT_HZ) {
      snapshotAcc = 0;
      result.events = pendingFrameEvents.splice(0);
      // the *current* tick's deltas must survive: merge pending first, then this frame's own list
      {
        const own = result.snapshot.meshUpdates;
        if (own.length) for (const u of own) pendingMeshUpdates.set(u.id, u);
        result.snapshot.meshUpdates = pendingMeshUpdates.size ? [...pendingMeshUpdates.values()] : [];
        pendingMeshUpdates.clear();
      }
      const ts0 = performance.now();
      const buildT = performance.now() - ts0;
      const postT0 = performance.now();
      post({ t: 'frame', result });
      if (sim) sim.prof.aiMs = (sim as any).aiMs ?? 0;
      if (sim) { sim.prof.snapshot = buildT; sim.prof.serialize = performance.now() - postT0; }
    }
    if (sim.over) {
      post({ t: 'gameover', winner: sim.winner, stats: { kills: sim.player?.kills ?? 0, deaths: sim.player?.deaths ?? 0, score: sim.player?.score ?? 0, captures: sim.player?.captures ?? 0, assists: sim.player?.assists ?? 0 } });
    }
    if (sim.mcoms.length) post({ t: 'mcom', list: sim.mcoms.map(m => ({ id: m.id, x: m.x, z: m.z, armed: m.armed, progress: m.progress, destroyed: m.destroyed, sector: m.sector })) });
    if (sim.cfg.mode === 'holdout') post({ t: 'waves', wave: sim.wave, total: sim.wavesTotal });
    aiTick();
  }, 16);
}

ctx.onmessage = async (ev: MessageEvent<MainToSim>) => {
  const msg = ev.data;
  try {
    switch (msg.t) {
      case 'init': await init(msg); break;
      case 'intent': intent = msg.intent; sim?.updatePlayerIntent(msg.intent); break;
      case 'ai': sim?.stepAI(msg.intents); break;
      case 'pause': if (sim) sim.paused = msg.paused; break;
      case 'respawn': if (sim?.player) sim.respawnPlayerAt(msg.point); break;
      case 'selectClass': if (sim?.player) { sim.player.cls = msg.cls as any; sim.player.weapon = msg.cls === 'engineer' ? 'w_aks74u' : msg.cls === 'support' ? 'w_pkm' : msg.cls === 'recon' ? 'w_svd' : 'w_ak74'; sim.player.magazine = 30; } break;
      case 'selectWeapon': if (sim?.player) { sim.player.weapon = msg.weapon; sim.player.magazine = SIM_WEAPONS(msg.weapon); sim.player.reserve = SIM_WEAPONS(msg.weapon) * 6; } break;
      case 'selectGadget': if (sim?.player && msg.index !== undefined) { const g = (sim.player as any); const cls = g.cls; g.gadget = cls === 'engineer' ? (msg.index === 0 ? 'g_repair' : 'w_tm62') : cls === 'support' ? (msg.index === 0 ? 'g_ammo' : 'w_c4') : cls === 'recon' ? (msg.index === 0 ? 'g_drone' : 'g_spawnbeacon') : (msg.index === 0 ? 'g_gp25' : 'g_medkit'); } break;
      case 'command': order = { order: msg.order, pos: msg.pos }; sim && (sim.commandPoint = msg.pointId ?? null); break;
      case 'setQuality': if (sim) sim.debrisCapped = msg.cappedDebris; break;
      case 'test': if (sim) {
        if (msg.op === 'explode' && msg.pos) sim.debugExplode(msg.pos, msg.radius ?? 6);
        if (msg.op === 'collapse' && msg.pos) { const st = sim.structures.reduce((best, s) => ((s.x - msg.pos![0]) ** 2 + (s.z - msg.pos![2]) ** 2 < (best ? (best.x - msg.pos![0]) ** 2 + (best.z - msg.pos![2]) ** 2 : Infinity) ? s : best), null as any); if (st) sim.collapseAll(st); }
        if (msg.op === 'stats') post({ t: 'status', phase: 'stats', text: JSON.stringify({ debris: sim.debris.length, projectiles: sim.projectiles.length, meshes: sim.meshes.size, structures: sim.structures.length, props: sim.props.length, tickMs: sim.lastTickMs, simMs: sim.lastSimMs, repairs: (sim as any).botRepairCount ?? 0, revives: (sim as any).botReviveCount ?? 0, mcoms: sim.mcoms.length, wave: sim.wave }) });
        if (msg.op === 'goto' && msg.pos) sim.debugGoto(msg.pos);
        if ((msg.op as string) === 'aiDrill') {
          // drill: put a badly damaged friendly vehicle next to an engineer and a downed ally next to an assault bot
          const eng = [...sim.chars.values()].find(c => c.cls === 'engineer' && !c.isPlayer);
          const veh = [...sim.vehicles.values()].find(v => v.drive !== 'air');
          if (eng && veh) {
            const t = veh.body.translation();
            veh.hp = veh.maxHp * 0.3; veh.trackHp = 20; veh.engineHp = 30;
            eng.pos = [t.x + 2, t.y + 1, t.z];
            eng.body.setTranslation({ x: eng.pos[0], y: eng.pos[1], z: eng.pos[2] }, true);
            sim.botRepair(eng);
          }
          const asl = [...sim.chars.values()].find(c => c.cls === 'assault' && !c.isPlayer && c !== eng);
          const ally = [...sim.chars.values()].find(c => !c.isPlayer && c !== asl && c !== eng && c.team === (asl?.team ?? 0));
          if (asl && ally) {
            ally.alive = false; ally.hp = 0; (ally as any).respawnAt = sim.time + 5;
            asl.pos = [...ally.pos];
            asl.body.setTranslation({ x: ally.pos[0], y: ally.pos[1], z: ally.pos[2] }, true);
            sim.botRevive(asl);
          }
          post({ t: 'status', phase: 'drill', text: 'ok' });
        }
        if (msg.op === 'structures') post({ t: 'status', phase: 'structures', text: JSON.stringify(sim.structureReport(40)) });
        if ((msg.op as string) === 'vehicleProbe' && sim.player) {
          const pl = sim.player as any;
          const v = pl.vehicle != null ? sim.vehicles.get(pl.vehicle) : null;
          post({ t: 'status', phase: 'probe', text: JSON.stringify({
            vehicle: pl.vehicle ?? null, seat: pl.seat ?? null,
            intent: pl.intent ? pl.intent.move : null,
            throttle: v?.throttle ?? null, brake: v?.brake ?? null, steer: v?.steer ?? null,
            wheels: v?.controller?.numWheels?.() ?? 0, mass: v ? v.body.mass() : 0,
            y: v ? v.body.translation().y : 0, speed: v?.speed ?? 0, engineHp: v?.engineHp ?? null, trackHp: v?.trackHp ?? null,
            fuel: v ? (v as any).fuel ?? null : null,
            contacts: v?.controller ? Array.from({ length: v.controller.numWheels() }, (_, i) => v.controller.wheelIsInContact(i)) : [],
            susp: v?.controller ? Array.from({ length: v.controller.numWheels() }, (_, i) => +v.controller.wheelSuspensionLength(i).toFixed(3)) : [],
            contactPoints: v?.controller ? Array.from({ length: v.controller.numWheels() }, (_, i) => { const p = v.controller.wheelContactPoint(i); return p ? [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] : null; }) : [],
            groundY: sim.groundY(v ? v.body.translation().x : 0, v ? v.body.translation().z : 0),
          }) });
        }
        if (msg.op === 'spawnProbe' && sim.player) {
          const pl = sim.player;
          post({ t: 'status', phase: 'probe', text: JSON.stringify({ player: [...pl.pos], ground: sim.groundY(pl.pos[0], pl.pos[2]), alive: pl.alive, hp: pl.hp, geo: Object.keys((sim as any).geo ?? {}).length }) });
        }
      } break;
      case 'dispose': {
        if (loopTimer !== null) clearInterval(loopTimer);
        loopTimer = null;
        aiWorker?.postMessage({ t: 'dispose' });
        aiWorker?.terminate(); aiWorker = null;
        sim = null; latestIntents = [];
        break;
      }
    }
  } catch (err) {
    post({ t: 'error', message: String((err as Error).message), stack: (err as Error).stack });
  }
};
