import type { MapId, WorldSpec, StructureSpec, PropSpec, VehicleSpawn, CapturePoint, Team, DayTime, Weather, Vec3 } from './types';
import { fbm, mulberry32, clamp, valueNoise, lerp } from './mathx';

interface MapPreset {
  name: string; size: number; res: number; water: { level: number; rx: number; rz: number; rotation: number } | null;
  baseHeight: number; relief: number; townRadius: number; pointNames: string[]; theme: 'city' | 'factory' | 'rural' | 'port';
}
const PRESETS: Record<MapId, MapPreset> = {
  sleepy: { name: 'Спальный район', size: 2000, res: 160, water: null, baseHeight: 2, relief: 7, townRadius: 900, theme: 'city', pointNames: ['Площадь Ленина', 'Двор-колодец', 'Школа №12', 'Гаражный кооператив', 'ЦУМ', 'Дом культуры', 'Стадион'] },
  factory: { name: 'Заводская площадка', size: 2000, res: 160, water: null, baseHeight: 1, relief: 9, townRadius: 950, theme: 'factory', pointNames: ['Проходная', 'Цех №3', 'Ж/Д узел', 'Котельная', 'Склад ГСМ', 'Заводоуправление'] },
  suburb: { name: 'Пригород', size: 4000, res: 128, water: { level: -1.5, rx: 620, rz: 900, rotation: 0.35 }, baseHeight: 3, relief: 22, townRadius: 500, theme: 'rural', pointNames: ['Колхоз «Заря»', 'Мост', 'Военная база', 'Дачный посёлок', 'Полевой лагерь', 'Элеватор'] },
  harbor: { name: 'Портовый город', size: 3000, res: 144, water: { level: 0, rx: 1400, rz: 700, rotation: -0.5 }, baseHeight: 1.5, relief: 8, townRadius: 1050, theme: 'port', pointNames: ['Причал', 'Складской район', 'Крановая эстакада', 'Заводской посёлок', 'Набережная', 'Элеватор'] }
};

function heightAt(p: MapPreset, x: number, z: number, seed: number) {
  const half = p.size / 2;
  let h = p.baseHeight + (fbm(x / 380, z / 380, 4, seed) - 0.5) * p.relief;
  const d = Math.hypot(x, z) / half;
  h += Math.pow(clamp(d, 0, 1), 3) * p.relief * 2.4; // rim of hills around the battlefield
  if (p.theme === 'rural') h += Math.sin(x / 700 + 1.3) * 4 + Math.cos(z / 500) * 3;
  if (p.water) {
    const s = Math.sin(p.water.rotation), c = Math.cos(p.water.rotation);
    const wx = (x * c + z * s) / p.water.rx, wz = (-x * s + z * c) / p.water.rz;
    const w = 1 - Math.min(1, Math.hypot(wx, wz));
    h -= w * w * 16;
  }
  // flatten city core a little for readable streets
  if (p.theme === 'city' || p.theme === 'port') h = lerp(h, p.baseHeight + Math.sin(x / 220) * 1.5, 0.35);
  return h;
}

export function sampleTerrain(world: WorldSpec, x: number, z: number) {
  const n = world.res;
  const cell = world.size / n;
  const fx = clamp((x + world.size / 2) / cell, 0, n - 1e-6);
  const fz = clamp((z + world.size / 2) / cell, 0, n - 1e-6);
  const ix = Math.floor(fx), iz = Math.floor(fz), tx = fx - ix, tz = fz - iz;
  const H = (i: number, j: number) => world.heights[(Math.min(n, Math.max(0, j)) * (n + 1)) + Math.min(n, Math.max(0, i))];
  const a = H(ix, iz), b = H(ix + 1, iz), c = H(ix, iz + 1), d = H(ix + 1, iz + 1);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

export function waterDepth(world: WorldSpec, x: number, z: number) {
  if (!world.water) return 0;
  return Math.max(0, world.water.level - sampleTerrain(world, x, z));
}

export function inWater(world: WorldSpec, x: number, z: number) {
  if (!world.water) return false;
  return waterDepth(world, x, z) > 0.7;
}

function nearRoad(roads: { x: number; z: number; r: number }[][], x: number, z: number, pad = 0) {
  for (const road of roads) for (const p of road) if ((p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + pad) ** 2) return true;
  return false;
}

export function generateWorld(mapId: MapId, opts: { time: DayTime; weather: Weather; seed?: number } = { time: 'day', weather: 'clear' }): WorldSpec {
  const p = PRESETS[mapId];
  const seed = opts.seed ?? 1337;
  const rng = mulberry32(seed + mapId.length * 977);
  const half = p.size / 2;
  const heights: number[] = [];
  for (let j = 0; j <= p.res; j++) for (let i = 0; i <= p.res; i++) {
    const x = -half + (i / p.res) * p.size, z = -half + (j / p.res) * p.size;
    heights.push(heightAt(p, x, z, seed));
  }
  const world: WorldSpec = {
    mapId, name: p.name, size: p.size, res: p.res, heights, structures: [], props: [], vehicles: [],
    points: [], teamSpawns: { '0': [], '1': [] }, water: null, roads: [], urban: [], seed,
    time: opts.time, weather: opts.weather
  };
  if (p.water) world.water = { level: p.water.level, cx: 0, cz: 0, rx: p.water.rx, rz: p.water.rz, rotation: p.water.rotation };

  // ---- road network: main axes + ring + spokes
  const mk = (x: number, z: number, r: number) => ({ x, z, r });
  const axisA: { x: number; z: number; r: number }[] = [], axisB: { x: number; z: number; r: number }[] = [];
  for (let t = -half + 60; t <= half - 60; t += 40) {
    if (!inWater(world, t, 0)) axisA.push(mk(t, Math.sin(t / 300) * 40, 9));
    if (!inWater(world, 0, t)) axisB.push(mk(20 + Math.cos(t / 260) * 30, t, 9));
  }
  const rings: { x: number; z: number; r: number }[] = [];
  for (let a = 0; a < Math.PI * 2; a += 0.02) {
    const rr = p.townRadius * 0.62;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr * 0.85;
    if (!inWater(world, x, z)) rings.push(mk(x, z, 7));
  }
  world.roads = [axisA, axisB, rings];
  const spokes: { x: number; z: number; r: number }[] = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + 0.3;
    for (let t = 80; t < p.townRadius; t += 35) {
      const x = Math.cos(a) * t, z = Math.sin(a) * t;
      if (!inWater(world, x, z)) spokes.push(mk(x, z, 6));
    }
  }
  if (spokes.length) world.roads.push(spokes.map(s => ({ ...s, x: s.x * 0.9 })));

  // ---- capture points along a spread pattern
  const nPts = p.pointNames.length;
  p.pointNames.forEach((name, i) => {
    const a = (i / nPts) * Math.PI * 2 + 0.6 + p.theme.length;
    const rr = p.townRadius * (0.35 + (i % 3) * 0.22);
    let x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (inWater(world, x, z)) { x *= 0.45; z *= 0.45; }
    const pt: CapturePoint = { id: `cp${i}`, name, x, z, radius: 55, owner: null, initial: null };
    world.points.push(pt);
    world.urban.push({ x, z, r: 150 });
  });
  const tA = world.points[0], tB = world.points[world.points.length - 1];
  const toEdge = (pt: { x: number; z: number; radius: number }, sign: number) => {
    const l = Math.hypot(pt.x, pt.z) || 1;
    return { x: pt.x + (pt.x / l) * sign * 160, z: pt.z + (pt.z / l) * sign * 160 };
  };
  const baseA = toEdge(tA, 1), baseB = toEdge(tB, 1);
  world.teamSpawns['0'] = [baseA, { x: baseA.x + 30, z: baseA.z - 25 }, { x: baseA.x - 30, z: baseA.z + 25 }];
  world.teamSpawns['1'] = [baseB, { x: baseB.x - 30, z: baseB.z + 25 }, { x: baseB.x + 25, z: baseB.z + 30 }];
  world.points[0].initial = 0; world.points[0].owner = 0;
  world.points[world.points.length - 1].initial = 1; world.points[world.points.length - 1].owner = 1;

  // ---- structures
  const placed: { x: number; z: number; r: number }[] = [];
  let sid = 0;
  const tryPlace = (asset: string, radius: number, ry: number, extraCheck?: (x: number, z: number) => boolean): StructureSpec | null => {
    for (let attempt = 0; attempt < 40; attempt++) {
      const urban = world.urban[Math.floor(rng() * world.urban.length)];
      const ang = rng() * Math.PI * 2, dist = Math.sqrt(rng()) * urban.r;
      const x = Math.round((urban.x + Math.cos(ang) * dist) / 4) * 4;
      const z = Math.round((urban.z + Math.sin(ang) * dist) / 4) * 4;
      if (Math.abs(x) > half - 90 || Math.abs(z) > half - 90) continue;
      if (inWater(world, x, z)) continue;
      if (nearRoad(world.roads, x, z, 2)) continue;
      if (placed.some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < (q.r + radius) ** 2 * 1.15)) continue;
      if (world.points.some(pt => (pt.x - x) ** 2 + (pt.z - z) ** 2 < (pt.radius + radius) ** 2 * 0.8)) continue;
      if (extraCheck && !extraCheck(x, z)) continue;
      placed.push({ x, z, r: radius });
      return { id: sid++, asset, x, z, ry };
    }
    return null;
  };
  const pushStructure = (s: StructureSpec | null) => { if (s) world.structures.push(s); };
  const layout: [string, number][] = p.theme === 'city'
    ? [['b_khrush5', 34], ['b_khrush5', 34], ['b_khrush5_long', 40], ['b_brezh9', 34], ['b_brezh9', 34], ['b_brezh16', 34], ['b_dorm', 24], ['b_school', 44], ['b_dk', 44], ['b_cum', 34], ['b_kinoteatr', 34], ['b_bolnica', 46], ['b_garage', 9], ['b_kiosk', 7], ['b_busstop', 8], ['b_garage', 9], ['b_khrush5', 34], ['b_garage', 9]]
    : p.theme === 'factory'
      ? [['b_shopfloor', 60], ['b_warehouse', 40], ['b_warehouse', 40], ['b_silo', 12], ['b_watertower', 13], ['b_kpp', 16], ['b_barracks', 44], ['b_garage', 9], ['b_garage', 9], ['b_khrush5', 34], ['b_dorm', 26], ['b_shopfloor', 60], ['b_warehouse', 40], ['b_silo', 12], ['b_controltower', 13]]
      : p.theme === 'rural'
        ? [['b_khrush5', 34], ['b_school', 44], ['b_dorm', 26], ['i_barn', 26], ['i_barn', 26], ['i_silo_grain', 13], ['b_garage', 9], ['b_garage', 9], ['b_garage', 9], ['b_barracks', 44], ['b_kpp', 16], ['b_warehouse', 40], ['b_khrush5_long', 40], ['i_shed', 10], ['i_shed', 10], ['i_shed', 10], ['b_khrush5', 34], ['i_barn', 26]]
        : [['b_warehouse', 40], ['b_warehouse', 40], ['b_shopfloor', 60], ['b_cum', 34], ['b_khrush5', 34], ['b_brezh9', 34], ['b_khrush5_long', 40], ['b_garage', 9], ['b_kiosk', 7], ['b_kpp', 16], ['i_container', 10], ['i_container', 10], ['i_container', 10], ['b_watertower', 13], ['b_dorm', 26], ['b_school', 44], ['b_khrush5', 34]];
  for (const [asset, radius] of layout) {
    pushStructure(tryPlace(asset, radius, Math.round(rng() * 8) * (Math.PI / 4)));
  }
  for (const asset of ['i_shed', 'i_watchtower', 'i_tanktrap', 'i_target', 'i_flagpole']) {
    for (let k = 0; k < 2; k++) pushStructure(tryPlace(asset, 12, rng() * 6, (x, z) => !nearRoad(world.roads, x, z, -4)));
  }
  // extra ring of apartment blocks on the outskirts for siege feel
  for (let k = 0; k < (p.theme === 'city' ? 10 : 4); k++) {
    const a = (k / 10) * Math.PI * 2 + 0.2;
    const rr = p.townRadius * 0.9;
    const x = Math.round((Math.cos(a) * rr) / 4) * 4, z = Math.round((Math.sin(a) * rr) / 4) * 4;
    if (Math.abs(x) < half - 80 && Math.abs(z) < half - 80 && !inWater(world, x, z) && !nearRoad(world.roads, x, z, 4)) {
      placed.push({ x, z, r: 30 });
      world.structures.push({ id: sid++, asset: k % 3 === 0 ? 'b_brezh9' : 'b_khrush5', x, z, ry: Math.round(a / (Math.PI / 4)) * (Math.PI / 4) + Math.PI / 4 });
    }
  }
  if (p.water) {
    // piers, cranes and containers along the shoreline
    for (let k = 0; k < 26; k++) {
      const a = (k / 26) * Math.PI * 2;
      const x = Math.cos(a) * p.water.rx * 0.8, z = Math.sin(a) * p.water.rz * 0.8;
      if (Math.abs(x) > half - 40 || Math.abs(z) > half - 40) continue;
      if (!inWater(world, x, z) && rng() > 0.4) continue;
      const asset = ['i_pier', 'i_crane', 'i_container', 'i_container', 'b_kiosk'][k % 5];
      const s = { id: sid++, asset, x: Math.round(x / 4) * 4, z: Math.round(z / 4) * 4, ry: Math.round(rng() * 4) * (Math.PI / 2) };
      if (placed.some(q => (q.x - s.x) ** 2 + (q.z - s.z) ** 2 < 15 ** 2)) continue;
      placed.push({ x: s.x, z: s.z, r: 14 });
      world.structures.push(s);
    }
  }

  // ---- props: 220+ physics objects per map (destructible cover, ambient, trees)
  let pid = 0;
  const propMix = p.theme === 'rural'
    ? ['p_tree_birch', 'p_tree_poplar', 'p_tree_spruce', 'p_fence', 'p_barrel', 'p_crate', 'p_sandbags', 'p_bench', 'p_leninstatue', 'p_tyre', 'p_radiator', 'p_shed']
    : p.theme === 'port'
      ? ['p_barrel', 'p_crate', 'p_crate_ammo', 'p_fence', 'p_tyre', 'p_barrier', 'p_sandbags', 'p_dumpster', 'p_lamp', 'p_powerpole', 'p_konus', 'p_leninstatue']
      : p.theme === 'factory'
        ? ['p_barrel', 'p_crate', 'p_crate_ammo', 'p_barrier', 'p_fence', 'p_tyre', 'p_powerpole', 'p_lamp', 'p_dumpster', 'p_sandbags', 'p_pallet' as string, 'p_konus']
        : ['p_bench', 'p_swing', 'p_sandbox', 'p_slide', 'p_bench_urn', 'p_barrel', 'p_budka', 'p_konus', 'p_fence', 'p_garage_door', 'p_tree_birch', 'p_tree_poplar', 'p_tree_spruce', 'p_lamp', 'p_powerpole', 'p_romashka', 'p_clothesline', 'p_dumpster', 'p_leninstatue', 'p_star', 'p_slogan', 'p_crate', 'p_crate_ammo', 'p_barrier', 'p_sandbags', 'p_radiator', 'p_tyre', 'p_piano'];
  const propCount = p.theme === 'rural' ? 320 : 400;
  for (let i = 0; i < propCount; i++) {
    const asset = propMix[Math.floor(rng() * propMix.length)];
    if (asset === 'p_pallet') continue;
    let x = 0, z = 0, ok = false;
    for (let a = 0; a < 30 && !ok; a++) {
      const center = rng() < 0.72 ? world.urban[Math.floor(rng() * world.urban.length)] : { x: 0, z: 0, r: half * 0.9 };
      const ang = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * center.r;
      x = Math.round((center.x + Math.cos(ang) * rr) / 2) * 2;
      z = Math.round((center.z + Math.sin(ang) * rr) / 2) * 2;
      if (Math.abs(x) > half - 30 || Math.abs(z) > half - 30) continue;
      if (inWater(world, x, z)) continue;
      if (nearRoad(world.roads, x, z, -1)) continue;
      if (placed.some(q => (q.x - x) ** 2 + (q.z - z) ** 2 < 64)) continue;
      ok = true;
    }
    if (!ok) continue;
    const isTree = asset.includes('tree');
    world.props.push({ id: pid++, asset, x, z, ry: Math.round(rng() * 8) * (Math.PI / 4), dynamic: isTree || ['p_barrel', 'p_crate', 'p_tyre', 'p_konus', 'p_bench_urn', 'p_crate_ammo', 'p_radiator'].includes(asset) });
    if (isTree) placed.push({ x, z, r: 4 });
  }

  // ---- vehicles at team bases and objectives
  let vid = 0;
  const pushVehicle = (asset: string, x: number, z: number, ry: number, team: Team | null) => {
    if (Math.abs(x) > half - 30 || Math.abs(z) > half - 30) return;
    world.vehicles.push({ id: vid++, asset, x, z, ry, team });
  };
  const baseComposition: [string, number][] = [['v_t72', 2], ['v_bmp2', 2], ['v_btr80', 2], ['v_uaz', 3], ['v_gaz66', 1], ['v_ural', 1], ['v_mi24', 1], ['v_mi8', 1], ['v_su25', 1]];
  const sideComposition: [string, number][] = [['v_brdm2', 1], ['v_shilka', 1], ['v_vaz2101', 2], ['v_gaz24', 1], ['v_liaz', 1], ['v_kamaz', 1], ['v_moto', 1], ['v_tram', 1], ['v_boat', 1], ['v_dinghy', 1]];
  const flatSpot = (x: number, z: number, ang: number, spread: number, k: number) => ({ x: x + Math.cos(ang) * (spread + k * 8), z: z + Math.sin(ang) * (spread + k * 8) });
  ([0, 1] as Team[]).forEach(team => {
    const spawn = world.teamSpawns[String(team) as '0' | '1'][0];
    let k = 0;
    for (const [asset, count] of baseComposition) for (let c = 0; c < count; c++, k++) {
      if (asset === 'v_su25' && p.theme === 'city') continue;
      const spot = flatSpot(spawn.x, spawn.z, k * 1.1, 18 + (k % 3) * 14, k);
      pushVehicle(asset, spot.x, spot.z, k * 0.7, team);
    }
    for (const [asset, count] of sideComposition) for (let c = 0; c < count; c++, k++) {
      const spot = flatSpot(spawn.x, spawn.z, k * 0.9 + 2, 40 + (k % 4) * 12, k);
      pushVehicle(asset, spot.x, spot.z, k * 0.6, team);
    }
    if (p.water) { pushVehicle('v_boat', spawn.x + 40, spawn.z - 20, 0, team); pushVehicle('v_dinghy', spawn.x - 35, spawn.z + 15, 1, team); }
  });
  // neutral technicals scattered at objectives
  for (const pt of world.points) {
    if (rng() > 0.55) pushVehicle(rng() > 0.5 ? 'v_uaz' : 'v_gaz24', pt.x + (rng() - 0.5) * 60, pt.z + (rng() - 0.5) * 60, rng() * 6, rng() > 0.5 ? 0 : 1);
  }
  return world;
}

export function worldRoadMaterial(world: WorldSpec, x: number, z: number): 'asphalt' | 'dirt' | 'mud' | 'ice' | 'snow' {
  if (world.weather === 'snow') return 'snow';
  if (nearRoad(world.roads, x, z, 0)) return 'asphalt';
  const n = valueNoise(x / 60, z / 60, 7);
  if (n > 0.72) return 'mud';
  return 'dirt';
}

export function objectivePositions(world: WorldSpec): Vec3[] {
  return world.points.map(p => [p.x, sampleTerrain(world, p.x, p.z), p.z] as Vec3);
}
