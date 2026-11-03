// Procedural asset definitions. Every gameplay ID gets its OWN silhouette, proportions,
// materials and named parts. Nothing here is a renamed duplicate of another item.
import { Builder, addBox, addCylinder, addSphere, addWedge, COLORS as C } from './glb.js';

const main = { id: 'main', color: [1, 1, 1], metallic: 0.15, roughness: 0.72 };
const paint = (m = 0.25, r = 0.5) => [{ id: 'main', color: [1, 1, 1], metallic: m, roughness: r }];
const P = (name, material = 'main') => ({ name, material, builder: new Builder() });

function part(name, fn, material = 'main') { const p = P(name, material); fn(p.builder); return p; }

/* ---------------------------------- WEAPONS ------------------------------------- */
function akBase(b, { short = false, wood = true, folding = false, barrel = 0.42 } = {}) {
  const L = short ? 0.62 : 0.94;
  addBox(b, 0, 0, 0, 0.062, 0.1, short ? 0.26 : 0.42, C.darksteel);                  // receiver
  addBox(b, 0, 0.055, -0.1, 0.052, 0.03, 0.16, C.steel);                            // dust cover
  addCylinder(b, 0, 0.012, 0.22, 0.026, 0.2, C.black, 10, 'z');                      // stock tube
  if (wood) { addBox(b, 0, -0.005, 0.34, 0.055, 0.12, 0.26, C.wood); addBox(b, 0, 0.045, -0.26, 0.07, 0.07, 0.2, C.wood2); }
  else { addBox(b, 0, -0.005, 0.33, 0.03, 0.06, 0.3, C.darksteel); addBox(b, 0, 0.045, -0.26, 0.066, 0.066, 0.2, C.darksteel); }
  addCylinder(b, 0, 0.03, -0.42, 0.017, barrel, C.black, 8, 'z');                     // barrel
  addCylinder(b, 0, 0.03, -0.42 - barrel / 2, 0.026, 0.07, C.darksteel, 8, 'z');      // brake
  addBox(b, 0, -0.09, -0.08, 0.032, 0.17, 0.05, C.darksteel);                        // pistol grip
  addBox(b, 0, -0.1, -0.2, 0.026, 0.03, 0.19, C.steel);                              // trigger guard
  b.curvedMag = true;
  addBox(b, 0, -0.17, -0.02, 0.038, 0.2, 0.07, C.orange);                             // magazine (bakelite, AK-74)
  addBox(b, 0, 0.08, -0.1, 0.006, 0.05, 0.012, C.steel);                              // front sight
  addBox(b, 0, 0.078, 0.12, 0.008, 0.035, 0.01, C.steel);
  if (folding) { addCylinder(b, 0.04, 0.02, 0.2, 0.01, 0.2, C.steel, 6, 'z'); }
  void L;
}

function weaponDefs() {
  const defs = [];
  defs.push({ id: 'w_ak74', item: 'АК-74', category: 'weapon', collider: 'convex', dims: [0.06, 0.26, 0.94], parts: () => [
    part('body', b => akBase(b, { wood: false })) ],
    stats: { caliber: '5.45x39', muzzle: 900, rpm: 650, magazine: 30, damage: 28, spread: 0.004, recoil: 0.9, reload: 2.1 } });
  defs.push({ id: 'w_akm', item: 'АКМ', category: 'weapon', collider: 'convex', dims: [0.06, 0.27, 1.02], parts: () => [
    part('body', b => { akBase(b, { wood: true, barrel: 0.5 }); addBox(b, 0, -0.18, 0.0, 0.04, 0.22, 0.085, C.darkwood); addBox(b, 0, 0.06, -0.12, 0.04, 0.04, 0.06, C.steel); }) ],
    stats: { caliber: '7.62x39', muzzle: 715, rpm: 600, magazine: 30, damage: 36, spread: 0.006, recoil: 1.15, reload: 2.3 } });
  defs.push({ id: 'w_aks74u', item: 'АКС-74У', category: 'weapon', collider: 'convex', dims: [0.06, 0.2, 0.49], parts: () => [
    part('body', b => { akBase(b, { short: true, wood: false, folding: true, barrel: 0.16 }); addCylinder(b, 0, 0.03, -0.55, 0.035, 0.12, C.steel, 8, 'z'); }) ],
    stats: { caliber: '5.45x39', muzzle: 735, rpm: 700, magazine: 30, damage: 24, spread: 0.009, recoil: 1.0, reload: 1.9 } });
  defs.push({ id: 'w_svd', item: 'СВД', category: 'weapon', collider: 'convex', dims: [0.08, 0.3, 1.22], parts: () => [
    part('body', b => {
      addBox(b, 0, 0, 0, 0.06, 0.09, 0.44, C.darksteel); addBox(b, 0, -0.01, 0.4, 0.05, 0.13, 0.38, C.wood2);
      addBox(b, 0, -0.005, -0.32, 0.07, 0.08, 0.24, C.wood); addCylinder(b, 0, 0.03, -0.62, 0.014, 0.6, C.black, 8, 'z');
      addCylinder(b, 0, 0.09, 0.05, 0.028, 0.36, C.black, 10, 'z');
      addCylinder(b, 0, 0.115, -0.02, 0.042, 0.12, C.darksteel, 10, 'z');
      addBox(b, 0, -0.1, -0.04, 0.03, 0.15, 0.05, C.wood); addBox(b, 0, -0.13, -0.12, 0.03, 0.13, 0.06, C.darksteel);
      addBox(b, 0, 0.03, -0.32, 0.09, 0.02, 0.03, C.steel);
    }) ],
    stats: { caliber: '7.62x54R', muzzle: 830, rpm: 90, magazine: 10, damage: 85, spread: 0.0015, recoil: 2.4, reload: 2.8 } });
  defs.push({ id: 'w_pkm', item: 'ПКМ', category: 'weapon', collider: 'convex', dims: [0.1, 0.3, 1.16], parts: () => [
    part('body', b => {
      addBox(b, 0, 0, 0, 0.07, 0.12, 0.46, C.olive); addBox(b, 0, 0.075, 0, 0.05, 0.04, 0.4, C.darkgreen);
      addCylinder(b, 0, 0.02, -0.55, 0.019, 0.72, C.black, 8, 'z'); addCylinder(b, 0, 0.02, -0.9, 0.032, 0.1, C.darksteel, 8, 'z');
      addCylinder(b, 0.02, 0.012, 0.38, 0.024, 0.3, C.darksteel, 8, 'z'); addBox(b, 0, 0.0, 0.6, 0.05, 0.12, 0.2, C.olive2);
      addBox(b, 0, -0.12, -0.05, 0.03, 0.16, 0.05, C.darkgreen); addBox(b, 0, -0.09, -0.18, 0.026, 0.03, 0.2, C.steel);
      addBox(b, -0.07, -0.06, -0.06, 0.07, 0.16, 0.24, C.olive); addBox(b, 0.07, -0.06, -0.06, 0.07, 0.16, 0.24, C.olive);
      addBox(b, 0, 0.09, -0.3, 0.01, 0.06, 0.02, C.steel);
    }) ],
    stats: { caliber: '7.62x54R', muzzle: 825, rpm: 650, magazine: 100, damage: 42, spread: 0.011, recoil: 1.6, reload: 5.0 } });
  defs.push({ id: 'w_rpk', item: 'РПК', category: 'weapon', collider: 'convex', dims: [0.09, 0.29, 1.05], parts: () => [
    part('body', b => { akBase(b, { barrel: 0.55 }); addBox(b, 0, -0.2, -0.02, 0.05, 0.24, 0.1, C.wood2); addBox(b, -0.04, -0.08, -0.2, 0.02, 0.14, 0.12, C.wood); addBox(b, 0.04, -0.08, -0.2, 0.02, 0.14, 0.12, C.wood); addBox(b, 0, 0.05, -0.47, 0.014, 0.1, 0.02, C.steel); }) ],
    stats: { caliber: '7.62x39', muzzle: 745, rpm: 600, magazine: 45, damage: 34, spread: 0.008, recoil: 1.05, reload: 3.2 } });
  defs.push({ id: 'w_rpg7', item: 'РПГ-7', category: 'weapon', collider: 'convex', dims: [0.16, 0.3, 1.25], parts: () => [
    part('body', b => {
      addCylinder(b, 0, 0.06, -0.1, 0.043, 0.9, C.olive, 12, 'z'); addCylinder(b, 0, 0.06, -0.62, 0.055, 0.16, C.darkgreen, 12, 'z');
      addCylinder(b, 0, 0.06, 0.38, 0.07, 0.12, C.darkgreen, 12, 'z');
      addCylinder(b, 0, 0.06, -0.72, 0.037, 0.5, C.rust, 10, 'z'); addCylinder(b, 0, 0.06, -1.0, 0.024, 0.2, C.orange, 8, 'z');
      addWedge(b, 0, 0.0, 0.02, 0.06, 0.1, 0.12, C.darkwood); addBox(b, 0, -0.09, -0.02, 0.04, 0.16, 0.06, C.darkwood);
      addBox(b, 0, -0.09, -0.26, 0.036, 0.15, 0.06, C.darkwood); addBox(b, 0, 0.09, -0.28, 0.02, 0.06, 0.02, C.steel);
      addBox(b, 0, 0.14, 0.0, 0.035, 0.06, 0.24, C.black);
    }) ],
    stats: { caliber: 'PG-7V', muzzle: 300, rpm: 8, magazine: 1, damage: 120, explosive: 3.4, spread: 0.01, recoil: 3.0, reload: 5.5 } });
  defs.push({ id: 'w_spg9', item: 'СПГ-9', category: 'weapon', collider: 'convex', dims: [0.25, 0.55, 2.1], parts: () => [
    part('body', b => {
      addCylinder(b, 0, 0.24, -0.35, 0.06, 1.5, C.olive, 12, 'z'); addCylinder(b, 0, 0.24, 0.5, 0.1, 0.22, C.darkgreen, 12, 'z');
      addCylinder(b, 0, 0.24, -1.2, 0.075, 0.26, C.rust, 12, 'z'); addBox(b, 0, 0.24, -1.45, 0.12, 0.12, 0.24, C.darkgreen);
      addBox(b, 0, 0.0, 0.1, 0.12, 0.3, 0.6, C.olive2); addCylinder(b, -0.12, 0.12, -0.1, 0.02, 0.75, C.darksteel, 6, 'x');
      addCylinder(b, 0.12, 0.12, -0.1, 0.02, 0.75, C.darksteel, 6, 'x');
      addCylinder(b, 0, 0.34, -0.35, 0.04, 0.2, C.black, 8, 'z'); addBox(b, 0, 0.3, 0.2, 0.05, 0.1, 0.06, C.darkwood);
    }) ],
    stats: { caliber: 'PG-9V', muzzle: 435, rpm: 6, magazine: 1, damage: 140, explosive: 4.2, spread: 0.006, recoil: 3.4, reload: 6.0 } });
  defs.push({ id: 'w_pm', item: 'ПМ', category: 'weapon', collider: 'convex', dims: [0.03, 0.13, 0.16], parts: () => [
    part('body', b => { addBox(b, 0, 0.02, 0, 0.028, 0.05, 0.16, C.darksteel); addCylinder(b, 0, 0.02, -0.1, 0.011, 0.04, C.black, 8, 'z'); addBox(b, 0, -0.05, 0.03, 0.026, 0.11, 0.05, C.darkwood); addBox(b, 0, -0.06, -0.01, 0.02, 0.03, 0.05, C.steel); }) ],
    stats: { caliber: '9x18', muzzle: 315, rpm: 300, magazine: 8, damage: 18, spread: 0.012, recoil: 0.55, reload: 1.4 } });
  defs.push({ id: 'w_rgd5', item: 'Граната РГД-5', category: 'weapon', collider: 'convex', dims: [0.06, 0.115, 0.06], parts: () => [
    part('body', b => { addSphere(b, 0, 0, 0, 0.04, C.olive, 10, 7, 1.35); addCylinder(b, 0, 0.07, 0, 0.016, 0.06, C.steel, 8); addBox(b, 0, 0.1, 0.01, 0.01, 0.03, 0.06, C.steel); addBox(b, 0, 0.075, 0.035, 0.008, 0.04, 0.015, C.steel); }) ],
    stats: { explosive: 1.1, frags: 32 } });
  defs.push({ id: 'w_f1', item: 'Граната Ф-1', category: 'weapon', collider: 'convex', dims: [0.058, 0.12, 0.058], parts: () => [
    part('body', b => { addSphere(b, 0, 0, 0, 0.032, C.darkgreen, 9, 7, 1.5); addCylinder(b, 0, 0.062, 0, 0.014, 0.045, C.steel, 8); addCylinder(b, 0, 0.09, 0, 0.006, 0.03, C.steel, 6); }) ],
    stats: { explosive: 1.4, frags: 40 } });
  defs.push({ id: 'w_c4', item: 'Заряд С4', category: 'weapon', collider: 'convex', dims: [0.1, 0.03, 0.2], parts: () => [
    part('body', b => { addBox(b, 0, 0, 0, 0.1, 0.03, 0.2, C.cream); addBox(b, 0, 0.005, 0, 0.11, 0.035, 0.04, C.darksteel); addBox(b, 0, 0.02, 0, 0.02, 0.04, 0.02, C.red); addBox(b, 0.02, 0.001, 0.06, 0.004, 0.004, 0.004, C.steel); addBox(b, -0.03, 0.015, 0.07, 0.012, 0.03, 0.012, C.black); }) ],
    stats: { explosive: 5.0 } });
  defs.push({ id: 'w_tm62', item: 'Мина ТМ-62', category: 'weapon', collider: 'convex', dims: [0.32, 0.11, 0.32], parts: () => [
    part('body', b => { addCylinder(b, 0, 0, 0, 0.16, 0.1, C.olive, 14); addCylinder(b, 0, 0.055, 0, 0.06, 0.02, C.darkgreen, 10); addBox(b, 0, 0.06, 0, 0.03, 0.04, 0.03, C.steel); addCylinder(b, 0, 0.04, 0, 0.006, 0.005, C.red, 6); }) ],
    stats: { explosive: 3.2, trigger: 'pressure' } });
  defs.push({ id: 'w_mon', item: 'Мина МОН-50', category: 'weapon', collider: 'convex', dims: [0.15, 0.08, 0.42], parts: () => [
    part('body', b => { addBox(b, 0, 0, 0, 0.06, 0.06, 0.42, C.olive); addBox(b, 0.034, 0, 0, 0.01, 0.04, 0.36, C.darkgreen); addBox(b, -0.03, 0.05, 0.06, 0.02, 0.05, 0.05, C.steel); addBox(b, 0, -0.05, 0.15, 0.05, 0.04, 0.02, C.darksteel); addBox(b, 0, -0.05, -0.15, 0.05, 0.04, 0.02, C.darksteel); }) ],
    stats: { explosive: 2.8, trigger: 'tripwire' } });
  defs.push({ id: 'w_gp25', item: 'ГП-25', category: 'weapon', collider: 'convex', dims: [0.08, 0.14, 0.4], parts: () => [
    part('body', b => { addCylinder(b, 0, 0, 0, 0.028, 0.4, C.darksteel, 10, 'z'); addCylinder(b, 0, 0, -0.24, 0.04, 0.1, C.olive, 10, 'z'); addBox(b, 0, -0.07, -0.05, 0.035, 0.1, 0.06, C.darkwood); addBox(b, 0, -0.09, 0.1, 0.03, 0.12, 0.05, C.black); }) ],
    stats: { caliber: 'ВОГ-25', muzzle: 76, rpm: 20, magazine: 1, damage: 90, explosive: 2.2, reload: 2.5 } });
  return defs;
}

/* ---------------------------------- GADGETS ------------------------------------- */
function gadgetDefs() {
  const d = [];
  d.push({ id: 'g_medkit', item: 'Аптечка', category: 'gadget', collider: 'cuboid', dims: [0.42, 0.26, 0.3], parts: () => [
    part('body', b => { addBox(b, 0, 0, 0, 0.42, 0.26, 0.3, C.white); addBox(b, 0, 0.06, 0, 0.43, 0.08, 0.31, C.red); addBox(b, 0, 0.05, 0.158, 0.13, 0.06, 0.01, C.white); addBox(b, 0, 0.05, 0.158, 0.05, 0.14, 0.01, C.white); addBox(b, 0, 0.16, 0, 0.12, 0.06, 0.05, C.darksteel); addBox(b, 0, -0.05, 0.16, 0.05, 0.03, 0.02, C.steel); }) ],
    stats: { healRadius: 4, healRate: 22, charges: 4 } });
  d.push({ id: 'g_ammo', item: 'Ящик боеприпасов', category: 'gadget', collider: 'cuboid', dims: [0.6, 0.36, 0.34], parts: () => [
    part('body', b => { addBox(b, 0, 0, 0, 0.6, 0.34, 0.34, C.olive); addBox(b, 0, 0.14, 0, 0.62, 0.06, 0.36, C.darkgreen); addBox(b, -0.15, 0.19, 0, 0.04, 0.03, 0.2, C.steel); addBox(b, 0.15, 0.19, 0, 0.04, 0.03, 0.2, C.steel); addBox(b, 0, 0.02, 0.176, 0.2, 0.06, 0.01, C.yellow); addBox(b, 0, -0.06, 0.176, 0.3, 0.02, 0.01, C.yellow); addBox(b, 0.22, 0.0, 0, 0.02, 0.16, 0.06, C.darksteel); addBox(b, -0.22, 0.0, 0, 0.02, 0.16, 0.06, C.darksteel); }) ],
    stats: { ammoRadius: 5, resupplyInterval: 4 } });
  d.push({ id: 'g_repair', item: 'Ремонтный ключ', category: 'gadget', collider: 'convex', dims: [0.06, 0.05, 0.44], parts: () => [
    part('body', b => { addBox(b, 0, 0, 0, 0.05, 0.05, 0.44, C.steel); addBox(b, 0, 0.02, 0.1, 0.09, 0.03, 0.12, C.darksteel); addCylinder(b, 0, 0, -0.26, 0.06, 0.05, C.steel, 10, 'z'); addCylinder(b, 0, 0, -0.26, 0.03, 0.06, C.black, 8, 'z'); addBox(b, 0, 0.045, 0.14, 0.018, 0.02, 0.2, C.rubber); }) ],
    stats: { repairRate: 14, range: 4.5 } });
  d.push({ id: 'g_drone', item: 'Дрон-разведчик', category: 'gadget', collider: 'cuboid', dims: [0.65, 0.15, 0.65], parts: () => [
    part('body', b => { addBox(b, 0, 0, 0, 0.18, 0.08, 0.22, C.darksteel); addSphere(b, 0, -0.04, -0.06, 0.05, C.black, 8, 6); for (const [x, z] of [[0.24, 0.24], [-0.24, 0.24], [0.24, -0.24], [-0.24, -0.24]]) { addBox(b, x / 2, 0.01, z / 2, 0.05, 0.025, 0.05, C.steel); addCylinder(b, x, 0.04, z, 0.16, 0.012, C.rubber, 12); } }) ],
    stats: { radius: 160, reconTime: 12 } });
  d.push({ id: 'g_spawnbeacon', item: 'Маяк спавна', category: 'gadget', collider: 'cuboid', dims: [0.3, 0.6, 0.3], parts: () => [
    part('body', b => { addCylinder(b, 0, 0, 0, 0.12, 0.16, C.darkgreen, 10); addCylinder(b, 0, 0.3, 0, 0.03, 0.5, C.steel, 8); addSphere(b, 0, 0.58, 0, 0.055, C.red, 8, 6); addBox(b, 0, 0.2, 0.03, 0.16, 0.05, 0.02, C.yellow); }) ],
    stats: { respawnRadius: 12 } });
  d.push({ id: 'g_mortar', item: 'Миномёт 82 мм', category: 'gadget', collider: 'cuboid', dims: [0.8, 1.1, 0.8], parts: () => [
    part('body', b => { addCylinder(b, 0, 0.1, 0, 0.045, 0.9, C.olive, 10); addCylinder(b, 0, -0.3, 0, 0.2, 0.07, C.darkgreen, 12); addBox(b, 0, -0.16, 0, 0.3, 0.2, 0.3, C.darkgreen); addBox(b, 0.2, -0.2, 0.1, 0.06, 0.4, 0.06, C.steel); addBox(b, -0.2, -0.2, 0.1, 0.06, 0.4, 0.06, C.steel); addBox(b, 0, 0.1, 0.12, 0.02, 0.7, 0.02, C.steel); }) ],
    stats: { caliber: '82mm', rpm: 12, damage: 110, explosive: 3.0 } });
  d.push({ id: 'g_ladder', item: 'Штурмовая лестница', category: 'gadget', collider: 'cuboid', dims: [0.6, 3.2, 0.2], parts: () => [
    part('body', b => { addBox(b, -0.28, 0, 0, 0.06, 3.2, 0.05, C.steel); addBox(b, 0.28, 0, 0, 0.06, 3.2, 0.05, C.steel); for (let i = 0; i < 9; i++) addBox(b, 0, -1.5 + i * 0.36, 0, 0.56, 0.04, 0.04, C.steel); addBox(b, 0, -1.62, 0.1, 0.7, 0.06, 0.3, C.darksteel); }) ],
    stats: { climbHeight: 3.2 } });
  return d;
}

/* ---------------------------------- VEHICLES ------------------------------------ */
const wheelPart = (x, z, r, w = 0.32, name = 'wheel') => part(`${name}_${x}_${z}`, b => { addCylinder(b, 0, 0, 0, r, 0.23, C.rubber, 14, 'x'); addCylinder(b, 0, 0, 0, r * 0.55, w, C.olive, 12, 'x'); addCylinder(b, 0, 0, 0, r * 0.2, w + 0.02, C.darksteel, 8, 'x'); });

function vehicleDefs() {
  const d = [];
  d.push({ id: 'v_uaz', item: 'УАЗ-469', category: 'vehicle', class: 'light', collider: 'compound', dims: [1.9, 2.0, 4.2], mass: 1700,
    parts: () => [
      part('body', b => { addBox(b, 0, 0.55, 0, 1.8, 0.55, 3.7, C.olive); addBox(b, 0, 1.05, -0.25, 1.72, 0.08, 2.6, C.olive2); addBox(b, 0, 1.46, -0.3, 1.7, 0.9, 0.07, C.glass); addBox(b, 0, 1.45, 0.98, 1.7, 0.85, 0.07, C.olive); addBox(b, 0.87, 1.45, 0.34, 0.06, 0.8, 1.2, C.olive); addBox(b, -0.87, 1.45, 0.34, 0.06, 0.8, 1.2, C.olive); addBox(b, 0, 1.05, 1.62, 1.76, 0.6, 0.5, C.olive); addBox(b, 0, 1.42, 1.1, 1.7, 0.06, 1.0, C.olive2); addCylinder(b, 0.5, 1.2, -1.72, 0.2, 0.08, C.cream, 10, 'z'); addCylinder(b, -0.5, 1.2, -1.72, 0.2, 0.08, C.cream, 10, 'z'); addBox(b, 0, 0.72, -1.9, 1.84, 0.26, 0.16, C.darksteel); addBox(b, 0, 0.76, 1.88, 1.84, 0.22, 0.12, C.darksteel); addSphere(b, 0, 2.0, -0.2, 0.05, C.sky, 6, 4); }) ],
    wheels: [[-0.92, -1.35], [0.92, -1.35], [-0.92, 1.3], [0.92, 1.3]], wheelRadius: 0.38, seats: 4,
    stats: { maxSpeed: 26, accel: 9, hp: 1400, drive: 'wheel', armor: 0.12, weapon: null } });
  d.push({ id: 'v_gaz66', item: 'ГАЗ-66', category: 'vehicle', class: 'truck', collider: 'compound', dims: [2.4, 2.8, 5.8], mass: 5800,
    parts: () => [
      part('body', b => { addBox(b, 0, 1.0, -1.3, 2.2, 0.9, 2.4, C.olive); addBox(b, 0, 1.55, -1.4, 2.16, 1.0, 1.5, C.glass); addBox(b, 0, 0.9, 1.4, 2.3, 0.5, 3.2, C.olive2); addBox(b, 0, 1.4, 2.8, 2.3, 1.4, 0.1, C.olive); addBox(b, 0, 0.62, -2.7, 2.36, 0.3, 0.3, C.darksteel); addCylinder(b, 0, 2.1, -1.5, 0.03, 0.8, C.darksteel, 6); addBox(b, 0, 2.6, -1.5, 0.2, 0.2, 0.2, C.cream); }) ],
    wheels: [[-1.1, -1.9], [1.1, -1.9], [-1.1, 2.0], [1.1, 2.0]], wheelRadius: 0.52, seats: 8,
    stats: { maxSpeed: 22, accel: 6, hp: 2600, drive: 'wheel', armor: 0.06 } });
  d.push({ id: 'v_ural', item: 'Урал-4320', category: 'vehicle', class: 'truck', collider: 'compound', dims: [2.5, 3.1, 7.6], mass: 8000,
    parts: () => [
      part('body', b => { addBox(b, 0, 1.25, -2.3, 2.4, 1.1, 2.3, C.olive); addBox(b, 0, 1.95, -2.35, 2.32, 1.1, 1.5, C.glass); addBox(b, 0, 1.4, -0.9, 2.45, 0.5, 1.4, C.darkgreen); addBox(b, 0, 1.0, 1.9, 2.5, 0.8, 4.0, C.olive2); addBox(b, 0, 1.45, 3.85, 2.5, 1.0, 0.1, C.olive); addBox(b, 0, 1.45, 0.0, 0.1, 1.0, 3.9, C.olive); for (const x of [-1.2, 1.2]) for (const z of [-3.1, -2.0, -0.5]) addCylinder(b, x, 0.9, z, 0.05, 0.3, C.darksteel, 6); addBox(b, 0, 0.65, -3.5, 2.55, 0.3, 0.3, C.darksteel); }) ],
    wheels: [[-1.2, -2.5], [1.2, -2.5], [-1.2, -0.8], [1.2, -0.8], [-1.2, 2.6], [1.2, 2.6]], wheelRadius: 0.58, seats: 6,
    stats: { maxSpeed: 20, accel: 5, hp: 3200, drive: 'wheel', armor: 0.06 } });
  d.push({ id: 'v_btr80', item: 'БТР-80', category: 'vehicle', class: 'apc', collider: 'compound', dims: [2.9, 2.4, 7.7], mass: 13600,
    parts: () => [
      part('body', b => { addBox(b, 0, 1.1, 0, 2.9, 1.0, 7.4, C.olive); addWedge(b, 0, 1.1, -3.6, 2.9, 1.0, 1.2, C.olive); addBox(b, 0, 1.75, 1.2, 2.6, 0.4, 4.4, C.olive2); addBox(b, 0, 0.75, 3.4, 2.9, 0.7, 0.7, C.darkgreen); addBox(b, 1.3, 1.4, -1.5, 0.1, 0.5, 0.7, C.glass); addBox(b, -1.3, 1.4, -1.5, 0.1, 0.5, 0.7, C.glass); addCylinder(b, 0, 0.9, -3.8, 0.08, 0.5, C.darksteel, 8, 'z'); }) ],
    turret: part('turret', b => { addCylinder(b, 0, 0, 0, 0.72, 0.55, C.olive, 14); addCylinder(b, 0, 0.34, 0, 0.3, 0.2, C.darkgreen, 12); addCylinder(b, 0, 0.05, -1.1, 0.06, 1.6, C.black, 8, 'z'); addBox(b, 0, 0.44, 0.2, 0.3, 0.16, 0.5, C.darksteel); }),
    turretPivot: [0, 1.95, -1.0],
    wheels: [[-1.25, -2.6], [1.25, -2.6], [-1.25, -0.5], [1.25, -0.5], [-1.25, 2.4], [1.25, 2.4], [-1.25, 3.3], [1.25, 3.3]], wheelRadius: 0.52, seats: 9, amphibious: true,
    stats: { maxSpeed: 24, accel: 6, hp: 4200, drive: 'wheel', armor: 0.55, weapon: 'KPVT 14.5', muzzle: 900, rpm: 300, damage: 55 } });
  d.push({ id: 'v_bmp2', item: 'БМП-2', category: 'vehicle', class: 'ifv', collider: 'compound', dims: [3.1, 2.4, 6.7], mass: 14000,
    parts: () => [
      part('body', b => { addWedge(b, 0, 1.1, -2.4, 3.1, 1.2, 2.2, C.olive); addBox(b, 0, 1.15, 0.8, 3.1, 1.1, 5.2, C.olive); addBox(b, 1.56, 0.72, 0.2, 0.1, 0.9, 4.6, C.darkgreen); addBox(b, -1.56, 0.72, 0.2, 0.1, 0.9, 4.6, C.darkgreen); addBox(b, 0, 1.5, 3.1, 2.6, 0.3, 1.2, C.olive2); for (const z of [-2.2, -0.9, 0.6, 2.2]) { addCylinder(b, 1.5, 0.55, z, 0.32, 0.12, C.rubber, 10, 'x'); addCylinder(b, -1.5, 0.55, z, 0.32, 0.12, C.rubber, 10, 'x'); } }) ],
    turret: part('turret', b => { addCylinder(b, 0, 0, 0, 0.8, 0.45, C.olive, 12); addBox(b, 0, 0.36, -0.15, 0.9, 0.4, 1.2, C.olive2); addCylinder(b, 0, 0.28, -1.3, 0.045, 1.5, C.black, 8, 'z'); addCylinder(b, 0.28, 0.38, -0.5, 0.06, 0.7, C.darksteel, 8, 'z'); addBox(b, 0, 0.6, 0.3, 0.25, 0.2, 0.4, C.darksteel); }),
    turretPivot: [0, 1.8, -0.6],
    wheels: [[-1.45, -1.9], [1.45, -1.9], [-1.45, -0.6], [1.45, -0.6], [-1.45, 1.9], [1.45, 1.9]], wheelRadius: 0.42, seats: 10, amphibious: true,
    stats: { maxSpeed: 25, accel: 7, hp: 4400, drive: 'track', armor: 0.6, weapon: '2A42 30мм', muzzle: 960, rpm: 550, damage: 42 } });
  d.push({ id: 'v_t72', item: 'Т-72', category: 'vehicle', class: 'mbt', collider: 'compound', dims: [3.6, 2.4, 6.9], mass: 41000,
    parts: () => [
      part('body', b => { addBox(b, 0, 1.0, 0.1, 3.4, 0.95, 6.4, C.olive); addWedge(b, 0, 1.05, -3.1, 3.4, 0.9, 1.3, C.olive); addBox(b, 1.76, 0.85, 0.1, 0.14, 0.9, 6.2, C.darkgreen); addBox(b, -1.76, 0.85, 0.1, 0.14, 0.9, 6.2, C.darkgreen); for (const z of [-2.2, -1.15, -0.1, 0.95, 2.0]) { addCylinder(b, 1.66, 0.55, z, 0.34, 0.26, C.rubber, 10, 'x'); addCylinder(b, -1.66, 0.55, z, 0.34, 0.26, C.rubber, 10, 'x'); addCylinder(b, 1.66, 0.55, z, 0.14, 0.3, C.olive2, 8, 'x'); } addBox(b, 0, 1.42, 2.9, 2.2, 0.3, 0.8, C.darkgreen); }) ],
    turret: part('turret', b => { addSphere(b, 0, 0.12, 0.1, 1.32, C.olive, 14, 8, 0.6); addBox(b, 0, 0.32, -0.6, 1.7, 0.5, 1.6, C.olive2); addCylinder(b, 0, 0.34, -2.4, 0.075, 2.6, C.black, 10, 'z'); addCylinder(b, 0, 0.34, -3.6, 0.1, 0.3, C.darksteel, 10, 'z'); addCylinder(b, 0.62, 0.45, -0.2, 0.1, 0.5, C.darkgreen, 8); addBox(b, 0, 0.7, 0.7, 0.3, 0.24, 0.4, C.darksteel); addCylinder(b, -0.55, 0.5, 0.3, 0.18, 0.16, C.darksteel, 10); }),
    turretPivot: [0, 1.96, -0.5],
    wheels: [[-1.55, -2.5], [1.55, -2.5], [-1.55, -1.2], [1.55, -1.2], [-1.55, 0.1], [1.55, 0.1], [-1.55, 1.4], [1.55, 1.4], [-1.55, 2.5], [1.55, 2.5]], wheelRadius: 0.36, seats: 3,
    stats: { maxSpeed: 18, accel: 4.5, hp: 9000, drive: 'track', armor: 1.0, weapon: '2A46 125мм', muzzle: 850, rpm: 8, damage: 420, explosive: 5 } });
  d.push({ id: 'v_shilka', item: 'ЗСУ-23-4 «Шилка»', category: 'vehicle', class: 'spaa', collider: 'compound', dims: [3.2, 3.2, 6.5], mass: 21000,
    parts: () => [
      part('body', b => { addBox(b, 0, 1.0, 0, 3.1, 0.9, 6.2, C.olive); addWedge(b, 0, 1.05, -3.0, 3.1, 0.9, 1.0, C.olive); addBox(b, 1.56, 0.8, 0, 0.12, 0.8, 5.8, C.darkgreen); addBox(b, -1.56, 0.8, 0, 0.12, 0.8, 5.8, C.darkgreen); }) ],
    turret: part('turret', b => { addBox(b, 0, 0.5, 0.1, 2.3, 0.9, 2.6, C.olive2); addBox(b, 0, 1.1, 0.3, 1.7, 0.4, 1.4, C.olive); addCylinder(b, -0.35, 0.7, -1.8, 0.05, 2.0, C.black, 8, 'z'); addCylinder(b, 0, 0.7, -1.8, 0.05, 2.0, C.black, 8, 'z'); addCylinder(b, 0.35, 0.7, -1.8, 0.05, 2.0, C.black, 8, 'z'); addCylinder(b, 0.6, 1.2, 0.6, 0.5, 0.24, C.darksteel, 12); addBox(b, 0, 0.95, 1.2, 1.9, 0.6, 0.3, C.darkgreen); }),
    turretPivot: [0, 1.6, 0],
    wheels: [[-1.5, -2.2], [1.5, -2.2], [-1.5, -0.9], [1.5, -0.9], [-1.5, 0.8], [1.5, 0.8], [-1.5, 2.1], [1.5, 2.1]], wheelRadius: 0.36, seats: 4,
    stats: { maxSpeed: 20, accel: 5, hp: 5000, drive: 'track', armor: 0.5, weapon: '4x23мм', muzzle: 970, rpm: 3400, damage: 16 } });
  d.push({ id: 'v_brdm2', item: 'БРДМ-2', category: 'vehicle', class: 'recon', collider: 'compound', dims: [2.4, 2.3, 5.7], mass: 7000,
    parts: () => [
      part('body', b => { addBox(b, 0, 1.0, 0, 2.3, 0.9, 5.4, C.olive); addWedge(b, 0, 1.05, -2.7, 2.3, 0.9, 1.0, C.olive); addBox(b, 0, 1.5, 1.2, 1.9, 0.35, 2.6, C.olive2); addBox(b, 0, 1.35, -1.9, 1.6, 0.4, 0.1, C.glass); addBox(b, 1.1, 0.8, 1.3, 0.12, 0.3, 2.4, C.rubber); addBox(b, -1.1, 0.8, 1.3, 0.12, 0.3, 2.4, C.rubber); }) ],
    turret: part('turret', b => { addCylinder(b, 0, 0, 0, 0.55, 0.4, C.olive, 12); addCylinder(b, 0, 0.15, -0.9, 0.035, 1.2, C.black, 8, 'z'); addBox(b, 0, 0.32, 0.1, 0.2, 0.2, 0.3, C.darksteel); }),
    turretPivot: [0, 1.75, -0.9],
    wheels: [[-1.1, -1.9], [1.1, -1.9], [-1.1, -0.6], [1.1, -0.6], [-1.1, 2.0], [1.1, 2.0]], wheelRadius: 0.4, seats: 4, amphibious: true,
    stats: { maxSpeed: 27, accel: 8, hp: 2600, drive: 'wheel', armor: 0.3, weapon: 'КПВТ 14.5', muzzle: 900, rpm: 300, damage: 55 } });
  d.push({ id: 'v_vaz2101', item: 'ВАЗ-2101', category: 'vehicle', class: 'civil', collider: 'compound', dims: [1.6, 1.4, 4.0], mass: 950,
    parts: () => [
      part('body', b => { addBox(b, 0, 0.62, 0, 1.6, 0.5, 3.9, C.cream); addBox(b, 0, 1.15, 0.2, 1.5, 0.55, 2.0, C.cream); addBox(b, 0, 1.16, -0.78, 1.42, 0.48, 0.06, C.glass); addBox(b, 0, 1.16, 1.2, 1.42, 0.45, 0.06, C.glass); addBox(b, 0.72, 1.16, 0.2, 0.06, 0.45, 1.9, C.glass); addBox(b, -0.72, 1.16, 0.2, 0.06, 0.45, 1.9, C.glass); addBox(b, 0.5, 0.86, -1.92, 0.34, 0.2, 0.04, C.white); addBox(b, -0.5, 0.86, -1.92, 0.34, 0.2, 0.04, C.white); addBox(b, 0, 0.55, -1.98, 1.55, 0.18, 0.14, C.steel); addBox(b, 0, 0.55, 1.98, 1.55, 0.18, 0.14, C.steel); }) ],
    wheels: [[-0.72, -1.3], [0.72, -1.3], [-0.72, 1.3], [0.72, 1.3]], wheelRadius: 0.3, seats: 4,
    stats: { maxSpeed: 30, accel: 9, hp: 700, drive: 'wheel', armor: 0.04 } });
  d.push({ id: 'v_gaz24', item: 'ГАЗ-24 «Волга»', category: 'vehicle', class: 'civil', collider: 'compound', dims: [1.8, 1.5, 4.7], mass: 1450,
    parts: () => [
      part('body', b => { addBox(b, 0, 0.65, 0, 1.8, 0.5, 4.6, C.sky); addBox(b, 0, 1.2, 0.1, 1.7, 0.6, 2.4, C.sky); addBox(b, 0, 1.2, -0.95, 1.6, 0.5, 0.06, C.glass); addBox(b, 0, 1.2, 1.34, 1.6, 0.48, 0.06, C.glass); addBox(b, 0.82, 1.2, 0.2, 0.06, 0.5, 2.2, C.glass); addBox(b, -0.82, 1.2, 0.2, 0.06, 0.5, 2.2, C.glass); addBox(b, 0, 0.9, -2.28, 1.74, 0.26, 0.1, C.cream); addBox(b, 0.55, 0.9, -2.33, 0.36, 0.22, 0.04, C.white); addBox(b, -0.55, 0.9, -2.33, 0.36, 0.22, 0.04, C.white); }) ],
    wheels: [[-0.8, -1.5], [0.8, -1.5], [-0.8, 1.5], [0.8, 1.5]], wheelRadius: 0.32, seats: 5,
    stats: { maxSpeed: 32, accel: 9, hp: 800, drive: 'wheel', armor: 0.04 } });
  d.push({ id: 'v_liaz', item: 'Автобус ЛиАЗ-677', category: 'vehicle', class: 'civil', collider: 'compound', dims: [2.6, 3.1, 10.5], mass: 11000,
    parts: () => [
      part('body', b => { addBox(b, 0, 1.6, 0, 2.6, 2.4, 10.2, C.yellow); addBox(b, 0, 2.1, -1.0, 2.64, 0.9, 7.4, C.glass); addBox(b, 0, 2.1, -5.05, 2.2, 1.0, 0.08, C.glass); addBox(b, 0, 1.1, -5.1, 2.5, 0.5, 0.1, C.darksteel); addBox(b, 0, 2.9, 0, 2.2, 0.16, 9.8, C.cream); addBox(b, 1.31, 1.6, 0, 0.02, 0.6, 9.9, C.red); }) ],
    wheels: [[-1.15, -3.6], [1.15, -3.6], [-1.15, 3.0], [1.15, 3.0]], wheelRadius: 0.5, seats: 20,
    stats: { maxSpeed: 20, accel: 4, hp: 2000, drive: 'wheel', armor: 0.03 } });
  d.push({ id: 'v_kamaz', item: 'КамАЗ-5320', category: 'vehicle', class: 'truck', collider: 'compound', dims: [2.5, 3.0, 8.0], mass: 9000,
    parts: () => [
      part('body', b => { addBox(b, 0, 1.35, -2.4, 2.5, 1.3, 2.4, C.cream); addBox(b, 0, 2.1, -2.5, 2.4, 1.1, 1.6, C.glass); addBox(b, 0, 1.15, 2.0, 2.5, 0.5, 3.6, C.olive2); addBox(b, 0, 1.5, 3.75, 2.5, 1.1, 0.1, C.olive); for (const x of [-1.25, 1.25]) for (const z of [-2.0, 1.0]) addCylinder(b, x, 0.8, z, 0.45, 0.3, C.rubber, 12, 'x'); }) ],
    wheels: [[-1.15, -2.8], [1.15, -2.8], [-1.15, -0.9], [1.15, -0.9], [-1.15, 2.6], [1.15, 2.6]], wheelRadius: 0.52, seats: 3,
    stats: { maxSpeed: 22, accel: 5, hp: 3000, drive: 'wheel', armor: 0.04 } });
  d.push({ id: 'v_tram', item: 'Трамвай', category: 'vehicle', class: 'civil', collider: 'compound', dims: [2.6, 3.4, 14], mass: 20000,
    parts: () => [
      part('body', b => { addBox(b, 0, 1.7, 0, 2.6, 2.6, 13.6, C.red); addBox(b, 0, 2.25, 0, 2.64, 0.9, 11.4, C.glass); addBox(b, 0, 3.15, 0, 2.2, 0.25, 12.8, C.cream); addBox(b, 0, 1.9, -6.85, 2.2, 1.5, 0.1, C.glass); addBox(b, 0, 1.9, 6.85, 2.2, 1.5, 0.1, C.glass); addBox(b, 0, 3.35, 0, 0.1, 0.5, 6, C.darksteel); addBox(b, 0, 3.62, 0, 1.8, 0.06, 0.08, C.darksteel); }) ],
    wheels: [[-1.0, -5.0], [1.0, -5.0], [-1.0, 5.0], [1.0, 5.0]], wheelRadius: 0.35, seats: 25, rail: true,
    stats: { maxSpeed: 14, accel: 3, hp: 6000, drive: 'rail', armor: 0.12 } });
  d.push({ id: 'v_mi24', item: 'Ми-24 «Крокодил»', category: 'aircraft', class: 'heli_attack', collider: 'compound', dims: [17, 5.5, 18], mass: 8500,
    parts: () => [
      part('body', b => { addCylinder(b, 0, 0, 0.4, 0.85, 7.6, C.olive, 14, 'z'); addSphere(b, 0, 0.15, -3.9, 0.95, C.glass, 12, 8); addBox(b, 0, 0.45, -4.3, 0.9, 0.5, 0.7, C.glass); addBox(b, 0, -0.1, 4.4, 0.6, 0.6, 2.0, C.olive); addBox(b, 0, 0.8, 6.2, 0.24, 1.3, 1.2, C.olive2); addCylinder(b, 0, 0.5, 8.4, 0.12, 3.4, C.olive, 8, 'z'); addCylinder(b, 0, 0.6, 10.2, 0.05, 1.2, C.darksteel, 6, 'z'); addBox(b, 0.9, 0.9, 0, 2.6, 0.12, 1.6, C.olive); addBox(b, -0.9, 0.9, 0, 2.6, 0.12, 1.6, C.olive); addBox(b, 1.45, 0.3, -0.3, 0.2, 0.2, 1.2, C.darksteel); addBox(b, -1.45, 0.3, -0.3, 0.2, 0.2, 1.2, C.darksteel); addCylinder(b, 0, 1.4, -0.6, 0.2, 1.3, C.darksteel, 10); }) ],
    rotor: part('rotor', b => { addCylinder(b, 0, 0, 0, 0.24, 0.3, C.darksteel, 10); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; addBox(b, Math.cos(a) * 3.6, 0, Math.sin(a) * 3.6, 7.2, 0.05, 0.38, C.darkgreen, a); } }),
    tailRotor: part('tailrotor', b => { for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI; addBox(b, 0, 0, 0, 0.06, 2.4, 0.24, C.darkgreen, a); } }),
    rotorPivot: [0, 1.55, -0.4], tailRotorPivot: [0.3, 0.6, 10.2], seats: 8,
    stats: { hp: 5200, maxSpeed: 75, weapon: 'ГШ-30К + НАР', rotorRadius: 7.2 } });
  d.push({ id: 'v_mi8', item: 'Ми-8', category: 'aircraft', class: 'heli_transport', collider: 'compound', dims: [18, 5.5, 22], mass: 11000,
    parts: () => [
      part('body', b => { addCylinder(b, 0, 0, 0, 1.25, 8.0, C.olive, 14, 'z'); addSphere(b, 0, 0.25, -4.2, 1.0, C.glass, 12, 8); addBox(b, 0, -0.6, -4.0, 1.8, 0.7, 1.4, C.glass); addCylinder(b, 0, 0.55, 5.6, 0.35, 3.0, C.olive, 8, 'z'); addBox(b, 0, 1.2, 7.8, 0.2, 1.7, 1.3, C.olive2); addCylinder(b, 0, 1.2, 10.0, 0.1, 3.2, C.olive, 8, 'z'); addBox(b, 1.35, 0.2, 0, 0.9, 0.14, 2.0, C.olive); addBox(b, -1.35, 0.2, 0, 0.9, 0.14, 2.0, C.olive); addBox(b, 0.65, -0.7, -1.4, 0.9, 0.14, 0.8, C.darksteel); addBox(b, -0.65, -0.7, -1.4, 0.9, 0.14, 0.8, C.darksteel); addCylinder(b, 0, 1.3, -0.2, 0.15, 1.6, C.darksteel, 10); }) ],
    rotor: part('rotor', b => { addCylinder(b, 0, 0, 0, 0.3, 0.3, C.darksteel, 10); for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; addBox(b, Math.cos(a) * 3.9, 0, Math.sin(a) * 3.9, 7.8, 0.06, 0.42, C.darkgreen, a); } }),
    tailRotor: part('tailrotor', b => { for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI; addBox(b, 0, 0, 0, 0.06, 2.6, 0.26, C.darkgreen, a); } }),
    rotorPivot: [0, 1.5, 0], tailRotorPivot: [0.35, 1.2, 10.0], seats: 14,
    stats: { hp: 4800, maxSpeed: 60, rotorRadius: 7.8 } });
  d.push({ id: 'v_su25', item: 'Су-25 «Грач»', category: 'aircraft', class: 'jet', collider: 'compound', dims: [14.4, 4.7, 15.5], mass: 9500,
    parts: () => [
      part('body', b => { addCylinder(b, 0, 0, 0, 0.9, 12.0, C.olive, 12, 'z'); addSphere(b, 0, 0.1, -6.2, 0.85, C.glass, 12, 8); addBox(b, 2.9, 0.1, -0.5, 5.8, 0.22, 2.4, C.olive); addBox(b, -2.9, 0.1, -0.5, 5.8, 0.22, 2.4, C.olive); addBox(b, 3.6, 0.4, 0.9, 1.4, 0.14, 0.9, C.olive2); addBox(b, -3.6, 0.4, 0.9, 1.4, 0.14, 0.9, C.olive2); addBox(b, 0, 0.7, 4.4, 0.2, 1.6, 1.6, C.olive2); addBox(b, 0, 0.1, 6.4, 3.6, 0.12, 1.0, C.olive); addCylinder(b, 1.1, -0.4, -0.6, 0.28, 2.4, C.darksteel, 10, 'z'); addCylinder(b, -1.1, -0.4, -0.6, 0.28, 2.4, C.darksteel, 10, 'z'); addBox(b, 1.9, -0.3, 0.3, 0.2, 0.2, 2.4, C.rust); addBox(b, -1.9, -0.3, 0.3, 0.2, 0.2, 2.4, C.rust); }) ],
    seats: 1,
    stats: { hp: 4000, maxSpeed: 180, weapon: 'ГШ-30-2 + бомбы' } });
  d.push({ id: 'v_boat', item: 'Катер', category: 'boat', class: 'boat', collider: 'compound', dims: [2.6, 1.6, 7.5], mass: 2200,
    parts: () => [
      part('body', b => { addBox(b, 0, 0.35, 0, 2.4, 0.7, 7.2, C.white); addWedge(b, 0, 0.55, -3.9, 2.2, 0.7, 1.2, C.white); addBox(b, 0, 0.9, 0.4, 1.9, 0.4, 2.4, C.glass); addBox(b, 0, 0.75, -1.4, 1.0, 0.3, 1.2, C.sky); addCylinder(b, 0, 1.4, 1.6, 0.06, 0.7, C.steel, 6); addBox(b, 0, 1.75, 1.6, 0.7, 0.12, 0.3, C.darksteel); addCylinder(b, 0, 0.2, 3.6, 0.3, 0.5, C.darksteel, 8, 'z'); }) ],
    seats: 4,
    stats: { hp: 1600, maxSpeed: 18, mass: 2200 } });
  d.push({ id: 'v_dinghy', item: 'Надувная лодка', category: 'boat', class: 'boat', collider: 'compound', dims: [1.8, 0.8, 4.2], mass: 320,
    parts: () => [
      part('body', b => { addCylinder(b, 0.55, 0.3, 0, 0.32, 3.9, C.olive, 10, 'z'); addCylinder(b, -0.55, 0.3, 0, 0.32, 3.9, C.olive, 10, 'z'); addBox(b, 0, 0.12, 0, 0.7, 0.06, 3.4, C.darkgreen); addBox(b, 0, 0.3, 2.0, 0.3, 0.3, 1.3, C.cream); addBox(b, 0, 0.45, 2.2, 0.25, 0.14, 0.3, C.black); addBox(b, 0.4, 0.42, 0.4, 0.1, 0.06, 0.5, C.wood); }) ],
    seats: 4, stats: { hp: 350, maxSpeed: 12, mass: 320 } });
  d.push({ id: 'v_moto', item: 'Мотоцикл «Урал» с коляской', category: 'vehicle', class: 'civil', collider: 'compound', dims: [1.9, 1.2, 2.4], mass: 480,
    parts: () => [
      part('body', b => { addBox(b, -0.25, 0.75, 0, 0.3, 0.3, 1.7, C.darkgreen); addCylinder(b, -0.25, 0.5, -0.4, 0.28, 0.16, C.rubber, 12, 'x'); addCylinder(b, -0.25, 0.5, 0.75, 0.28, 0.16, C.rubber, 12, 'x'); addBox(b, -0.25, 0.95, 0.25, 0.5, 0.2, 0.6, C.black); addBox(b, -0.25, 1.12, 0.7, 0.8, 0.06, 0.06, C.steel); addBox(b, 0.55, 0.55, 0.15, 0.7, 0.5, 1.5, C.olive2); addCylinder(b, 0.85, 0.25, 0.5, 0.25, 0.12, C.rubber, 10, 'x'); addCylinder(b, -0.25, 0.8, -0.6, 0.12, 0.2, C.cream, 8, 'z'); }) ],
    wheels: [[-0.25, -0.8], [-0.25, 0.85], [0.85, 0.6]], wheelRadius: 0.3, seats: 3,
    stats: { maxSpeed: 26, accel: 8, hp: 400, drive: 'wheel', armor: 0.02 } });
  return d;
}

/* ---------------------------------- CHARACTERS ---------------------------------- */
function animParts(kind) {
  const uniform = kind === 'soldier' ? C.olive : kind === 'officer' ? C.darkgreen : kind === 'engineer' ? C.tan : C.brick;
  const vest = kind === 'soldier' ? C.olive2 : C.darkgreen;
  return [
    part('torso', b => { addBox(b, 0, 1.25, 0, 0.44, 0.62, 0.26, uniform); addBox(b, 0, 1.28, 0.03, 0.46, 0.4, 0.3, vest); addBox(b, 0, 1.2, -0.16, 0.3, 0.22, 0.1, C.leather); addBox(b, 0, 1.33, -0.18, 0.16, 0.14, 0.08, C.olive); addBox(b, 0.15, 1.15, -0.17, 0.1, 0.14, 0.08, C.olive); }),
    part('head', b => { addSphere(b, 0, 1.71, 0, 0.12, C.skin, 10, 8); addSphere(b, 0, 1.76, 0.01, 0.135, kind === 'officer' ? C.darkgreen : C.olive, 10, 6, 0.85); addBox(b, 0, 1.71, -0.12, 0.2, 0.03, 0.06, kind === 'officer' ? C.darkgreen : C.olive); addBox(b, 0, 1.66, -0.1, 0.05, 0.02, 0.02, C.black); }),
    part('arm_l', b => { addBox(b, -0.29, 1.22, 0, 0.14, 0.5, 0.15, uniform); addBox(b, -0.29, 0.94, -0.1, 0.12, 0.3, 0.13, uniform); addSphere(b, -0.29, 0.8, -0.14, 0.06, C.skin, 8, 6); addBox(b, -0.29, 1.25, 0, 0.16, 0.16, 0.17, vest); }),
    part('arm_r', b => { addBox(b, 0.29, 1.22, 0, 0.14, 0.5, 0.15, uniform); addBox(b, 0.29, 0.94, -0.1, 0.12, 0.3, 0.13, uniform); addSphere(b, 0.29, 0.8, -0.14, 0.06, C.skin, 8, 6); addBox(b, 0.29, 1.25, 0, 0.16, 0.16, 0.17, vest); }),
    part('leg_l', b => { addBox(b, -0.12, 0.72, 0, 0.18, 0.5, 0.2, uniform); addBox(b, -0.12, 0.3, 0.02, 0.16, 0.46, 0.18, uniform); addBox(b, -0.12, 0.06, -0.04, 0.17, 0.12, 0.28, C.black); }),
    part('leg_r', b => { addBox(b, 0.12, 0.72, 0, 0.18, 0.5, 0.2, uniform); addBox(b, 0.12, 0.3, 0.02, 0.16, 0.46, 0.18, uniform); addBox(b, 0.12, 0.06, -0.04, 0.17, 0.12, 0.28, C.black); })
  ];
}
function characterDefs() {
  return ['soldier', 'officer', 'engineer', 'conscript'].map(kind => ({
    id: `c_${kind}`, item: { soldier: 'Солдат', officer: 'Офицер', engineer: 'Инженер', conscript: 'Новобранец' }[kind], category: 'character', collider: 'capsule', dims: [0.5, 1.8, 0.4],
    parts: () => animParts(kind), stats: { height: 1.8, rig: 'humanoid', joints: ['torso', 'head', 'arm_l', 'arm_r', 'leg_l', 'leg_r'] }
  }));
}

export { weaponDefs, gadgetDefs, vehicleDefs, characterDefs, part, P, main, paint };
