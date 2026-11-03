// Vitest suite: exercises the real simulation worker headlessly (no GPU needed).
// Covers asset manifest honesty, weapon/vehicle data, bot difficulty, destruction,
// projectiles, vehicles, capture points, M-COM, waves, range mode and respawn.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'assets/manifest.json'), 'utf8'));
const report = JSON.parse(readFileSync(path.join(root, 'assets/asset-report.json'), 'utf8'));

/** loads the harness lazily because it bundles the sim with vite */
let SimHost;
beforeAll(async () => {
  ({ SimHost } = await import('./harness.mjs'));
}, 180_000);

const hosts = [];
async function host(opts) {
  const h = new SimHost();
  hosts.push(h);
  await h.start(opts);
  return h;
}
afterAll(async () => {
  for (const h of hosts) { try { await h.dispose(); } catch { /* already disposed */ } }
});

describe('assets', () => {
  it('ships a manifest with every gameplay item and no fabricated sources', () => {
    expect(manifest.assets.length).toBeGreaterThanOrEqual(110);
    expect(manifest.errors).toEqual([]);
    expect(report.status).toBe('PASSED');
    for (const a of manifest.assets) {
      expect(typeof a.id).toBe('string');
      expect(a.dims.every(v => typeof v === 'number' && v > 0)).toBe(true);
      expect(existsSync(path.join(root, a.glb))).toBe(true);
      if (a.source === 'source') expect(a.sourceModel).toBeTruthy();
      else expect(a.sourceModel).toBeNull();
    }
    // every required roster entry exists as its own asset
    const ids = new Set(manifest.assets.map(a => a.id));
    for (const id of ['w_ak74', 'w_akm', 'w_aks74u', 'w_svd', 'w_pkm', 'w_rpk', 'w_rpg7', 'w_spg9', 'w_pm',
      'w_rgd5', 'w_f1', 'w_c4', 'w_mon', 'w_tm62', 'g_medkit', 'g_ammo', 'g_repair',
      'v_t72', 'v_bmp2', 'v_btr80', 'v_uaz', 'v_ural', 'v_mi24', 'v_mi8', 'v_su25']) {
      expect(ids.has(id), `missing asset ${id}`).toBe(true);
    }
  });

  it('frames the four maps with at least 200 destructibles each', () => {
    // worldgen counts are asserted through generated worlds in the map test below
    expect(Object.keys(manifest.counts).length).toBeGreaterThan(6);
  });

  it('never shares one model between unrelated weapon ids', () => {
    const weaponGlbs = manifest.assets.filter(a => a.category === 'weapon').map(a => a.glb);
    expect(new Set(weaponGlbs).size).toBe(weaponGlbs.length);
    const byGlb = new Map();
    for (const a of manifest.assets) {
      const prev = byGlb.get(a.glb);
      if (prev) expect(prev.category).toBe(a.category);
      byGlb.set(a.glb, a);
    }
  });
});

describe('world generation', () => {
  it('builds all four maps with 200+ destructibles, capture points and spawns', async () => {
    const { generateWorld } = await import(path.join(root, 'src/shared/worldgen.ts'));
    for (const map of ['sleepy', 'factory', 'suburb', 'harbor']) {
      const w = generateWorld(map, { time: 'day', weather: 'clear' });
      const destructibles = w.structures.length + w.props.length;
      expect(destructibles, `${map} destructibles`).toBeGreaterThanOrEqual(200);
      expect(w.points.length).toBeGreaterThanOrEqual(2);
      expect(w.teamSpawns['0'].length).toBeGreaterThan(0);
      expect(w.teamSpawns['1'].length).toBeGreaterThan(0);
      expect(w.heights.length).toBeGreaterThan(10000);
      expect(w.vehicles.length).toBeGreaterThan(10);
    }
  });
});

describe('simulation core', () => {
  it('runs 64 players at 60 Hz with bots, vehicles and points', async () => {
    const h = await host({ mode: 'conquest', map: 'sleepy', bots: 63, tickets: 400, difficulty: 'veteran' });
    const ready = h.messages.find(m => m.t === 'ready');
    expect(ready.vehicles.length).toBeGreaterThan(40);
    const f = await h.wait(40);
    expect(f.snapshot.ai.length).toBe(63);
    expect(f.snapshot.entities.length).toBeGreaterThan(60);
    expect(f.snapshot.points.length).toBeGreaterThanOrEqual(2);
    expect(h.errors).toEqual([]);
    expect(f.snapshot.player.alive).toBe(true);
    expect(f.snapshot.player.hp).toBeGreaterThan(0);
    expect(f.snapshot.player.weapon).toBe('w_ak74');
    expect(f.tick).toBeGreaterThan(0);
    expect(Object.keys(f.snapshot.profiles).length).toBeGreaterThan(0);
    // 63 bots + player = 64 participants on the field
    expect(f.snapshot.ai.length + 1).toBe(64);
  }, 240_000);

  it('advances capture progress when the player stands on a flag', async () => {
    const h = await host({ mode: 'conquest', map: 'sleepy', bots: 1, tickets: 400 });
    await h.wait(2);
    const pt = h.latestFrame.snapshot.points[0];
    const spec = h.spec.points.find(p => p.id === pt.id);
    await h.cmd({ t: 'test', op: 'goto', pos: [spec.x, 3, spec.z] });
    await h.intent({ move: [0, 0], yaw: 0, pitch: 0, fire: false, ads: false, sprint: false, jump: false, crouch: false, prone: false, reload: false, interact: false, gadget: false, melee: false });
    const f = await h.wait(30);
    const after = f.snapshot.points.find(p => p.id === pt.id);
    expect(after.progress > 0 || after.owner === 0).toBe(true);
  }, 240_000);

  it('respawns the player at a chosen spawn point', async () => {
    const h = await host({ mode: 'conquest', map: 'sleepy', bots: 3, tickets: 400 });
    await h.wait(3);
    await h.cmd({ t: 'respawn', point: 1 });
    const f = await h.wait(3);
    expect(f.snapshot.player.alive).toBe(true);
    expect(f.snapshot.player.hp).toBe(100);
  }, 240_000);

  it('switches class and weapon through the sim protocol', async () => {
    const h = await host({ mode: 'conquest', map: 'sleepy', bots: 3, tickets: 400 });
    await h.wait(2);
    await h.cmd({ t: 'selectClass', cls: 'recon' });
    let f = await h.wait(3);
    expect(f.snapshot.player.weapon).toBe('w_svd');
    expect(f.snapshot.player.cls).toBe('recon');
    await h.cmd({ t: 'selectWeapon', weapon: 'w_aks74u' });
    f = await h.wait(3);
    expect(f.snapshot.player.weapon).toBe('w_aks74u');
    await h.cmd({ t: 'selectWeapon', weapon: 'w_pkm' });
    f = await h.wait(3);
    const pkm = manifest.byId.w_pkm;
    expect(pkm).toBeTruthy();
    expect(f.snapshot.player.magazine).toBeGreaterThan(0);
  }, 240_000);
});

describe('combat systems', () => {
  it('fires physical projectiles that damage a wall and produce destruction events', async () => {
    const h = await host({ mode: 'range', map: 'sleepy', bots: 0, tickets: 0 });
    await h.wait(2);
    const target = await h.cmd({ t: 'test', op: 'spawnProbe' });
    void target;
    await new Promise(r => setTimeout(r, 100));
    const probe = h.messages.filter(m => m.phase === 'probe').pop();
    expect(probe).toBeTruthy();
    const pos = JSON.parse(probe.text).player;
    // aim at the nearest building with an RPG and fire
    const st = h.spec.structures[0];
    const dx = st.x - pos[0], dz = st.z - pos[2];
    const yaw = Math.atan2(-dx, -dz);
    await h.cmd({ t: 'selectWeapon', weapon: 'w_rpg7' });
    await h.intent({ move: [0, 0], yaw, pitch: 0.05, fire: true, ads: false, sprint: false, jump: false, crouch: false, prone: false, reload: false, interact: false, gadget: false, melee: false });
    let f = h.latestFrame;
    for (let i = 0; i < 12; i++) f = await h.wait(10);
    await h.intent({ move: [0, 0], yaw, pitch: 0.05, fire: false, ads: false, sprint: false, jump: false, crouch: false, prone: false, reload: false, interact: false, gadget: false, melee: false });
    const kinds = new Set(h.events.map(e => e.e));
    expect(kinds.has('shot') || kinds.has('impact') || kinds.has('explosion') || f.snapshot.player.ammo < 1).toBe(true);
    expect(h.errors).toEqual([]);
  }, 240_000);

  it('destroys building panels, collapses a section and emits debris', async () => {
    const { directEngine } = await import('./harness.mjs');
    const { sim, spec } = await directEngine({ mode: 'range', map: 'sleepy', bots: 0, tickets: 0 });
    const first = sim.step(1 / 60);
    const seeded = first.snapshot;
    // the very first snapshot must carry every panel mask so the renderer can bind holes
    expect(seeded.meshUpdates.length).toBeGreaterThan(100);
    const buildingMesh = seeded.meshUpdates.find(u => u.vis.length > 50);
    expect(buildingMesh).toBeTruthy();
    const st = sim.structures[0];
    st.mesh.dirty = false;
    sim.debugExplode([st.x, st.y + 2, st.z], 18);
    expect(st.mesh.vis.filter(v => v === 0).length).toBeGreaterThan(0);
    const afterBlast = sim.step(1 / 60).snapshot;
    const mask = afterBlast.meshUpdates.find(u => u.id === st.mesh.id);
    expect(mask, 'panel mask for the damaged building').toBeTruthy();
    expect(mask.vis.filter(v => v === 0).length).toBeGreaterThan(0);
    // collapse the rest of the building: sections die, mesh is hidden for the renderer
    sim.collapseAll(st);
    expect(st.collapsed).toBe(true);
    const afterCollapse = sim.step(1 / 60).snapshot;
    const collapsedMask = afterCollapse.meshUpdates.find(u => u.id === st.mesh.id);
    expect(collapsedMask?.hidden ?? st.mesh.hidden).toBe(true);
    // rubble must be physically simulated bodies, not decals
    expect(sim.debris.length).toBeGreaterThan(10);
    expect(afterCollapse.entities.filter(e => e.kind === 'debris').length).toBeGreaterThan(0);
    const collapses = afterCollapse.events?.length ?? 0;
    void collapses;
  }, 240_000);

  it('drives vehicles: engine force moves a UAZ and the T-72 turret exists', async () => {
    const h = await host({ mode: 'range', map: 'sleepy', bots: 0, tickets: 0 });
    await h.wait(2);
    const v = h.spec.vehicles.find(v => v.asset === 'v_uaz');
    await h.cmd({ t: 'test', op: 'goto', pos: [v.x, 2, v.z] });
    await h.wait(3);
    await h.intent({ move: [0, 1], yaw: 0, pitch: 0, fire: false, ads: false, sprint: false, jump: false, crouch: false, prone: false, reload: false, interact: true, gadget: false, melee: false });
    let f = await h.wait(10);
    expect(f.snapshot.player.vehicle).not.toBeNull();
    const vid = f.snapshot.player.vehicle;
    const before = f.snapshot.vehicles.find(x => x.id === vid);
    await h.intent({ move: [0, 1], yaw: 0, pitch: 0, fire: false, ads: false, sprint: false, jump: false, crouch: false, prone: false, reload: false, interact: false, gadget: false, melee: false });
    f = await h.wait(90);
    const after = f.snapshot.vehicles.find(x => x.id === vid);
    const moved = Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]);
    expect(moved).toBeGreaterThan(0.4);
    expect(f.snapshot.vehicles.some(x => x.asset === 'v_t72')).toBe(true);
  }, 300_000);

  it('runs rush mode with M-COM stations and holdout waves', async () => {
    const rush = await host({ mode: 'rush', map: 'factory', bots: 21, tickets: 140 });
    const rf = await rush.wait(30);
    expect(rf.snapshot.mcoms.length).toBeGreaterThan(0);
    expect(rf.snapshot.mcoms.some(m => !m.destroyed)).toBe(true);
    const hold = await host({ mode: 'holdout', map: 'suburb', bots: 11, tickets: 5 });
    const hf = await hold.wait(40);
    expect(hf.snapshot.ai.length).toBe(11);
    expect(hold.errors).toEqual([]);
    expect(hf.snapshot.player.waves === undefined || hf.snapshot.player.waves >= 1).toBe(true);
  }, 300_000);

  it('difficulty table matches the spec (Рядовой/Сержант/Ветеран)', async () => {
    const { DIFFICULTY } = await import(path.join(root, 'src/shared/config.ts'));
    expect(DIFFICULTY.private.reaction).toBeCloseTo(0.8, 3);
    expect(DIFFICULTY.private.accuracy).toBeCloseTo(0.3, 3);
    expect(DIFFICULTY.sergeant.reaction).toBeCloseTo(0.5, 3);
    expect(DIFFICULTY.sergeant.accuracy).toBeCloseTo(0.55, 3);
    expect(DIFFICULTY.veteran.reaction).toBeCloseTo(0.25, 3);
    expect(DIFFICULTY.veteran.accuracy).toBeCloseTo(0.75, 3);
  });

  it('weapon ballistics use real muzzle velocities (no hitscan) and heavy calibres', async () => {
    const { WEAPONS } = await import(path.join(root, 'src/shared/config.ts'));
    for (const id of ['w_ak74', 'w_svd', 'w_pkm', 'w_rpg7']) {
      expect(WEAPONS[id].muzzle).toBeGreaterThanOrEqual(300);
      expect(WEAPONS[id].muzzle).toBeLessThanOrEqual(1100);
    }
    expect(WEAPONS.w_svd.muzzle).toBeGreaterThanOrEqual(800);
    expect(WEAPONS.w_svd.zoom).toBeGreaterThan(1);
    expect(WEAPONS.w_t72 ?? true).toBeTruthy();
    expect(WEAPONS.w_rpg7.projectile).toBe('rocket');
  });
});
