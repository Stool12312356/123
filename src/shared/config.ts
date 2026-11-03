import type { ClassId, ClassConfig, Difficulty, ModeConfig, WeaponConfig, VehicleConfig, Vec3 } from './types';
import { generateWorld } from './worldgen';

export const WEAPONS: Record<string, WeaponConfig> = {
  w_ak74: { id: 'w_ak74', name: 'АК-74', class: ['assault', 'engineer'], caliber: '5.45x39', muzzle: 900, rpm: 650, magazine: 30, damage: 29, spread: 0.0035, recoil: 0.9, reload: 2.1, automatic: true, projectile: 'bullet', penetration: 0.5 },
  w_akm: { id: 'w_akm', name: 'АКМ', class: ['assault'], caliber: '7.62x39', muzzle: 715, rpm: 600, magazine: 30, damage: 36, spread: 0.0055, recoil: 1.2, reload: 2.3, automatic: true, projectile: 'bullet', penetration: 0.65 },
  w_aks74u: { id: 'w_aks74u', name: 'АКС-74У', class: ['engineer', 'assault', 'support', 'recon'], caliber: '5.45x39', muzzle: 735, rpm: 700, magazine: 30, damage: 25, spread: 0.008, recoil: 1.0, reload: 1.9, automatic: true, projectile: 'bullet', penetration: 0.42 },
  w_svd: { id: 'w_svd', name: 'СВД', class: ['recon'], caliber: '7.62x54R', muzzle: 830, rpm: 90, magazine: 10, damage: 88, spread: 0.0008, recoil: 2.6, reload: 2.8, automatic: false, zoom: 4, projectile: 'bullet', penetration: 0.9 },
  w_pkm: { id: 'w_pkm', name: 'ПКМ', class: ['support'], caliber: '7.62x54R', muzzle: 825, rpm: 650, magazine: 100, damage: 40, spread: 0.009, recoil: 1.5, reload: 5.2, automatic: true, projectile: 'bullet', penetration: 0.8 },
  w_rpk: { id: 'w_rpk', name: 'РПК', class: ['support'], caliber: '7.62x39', muzzle: 745, rpm: 600, magazine: 45, damage: 33, spread: 0.007, recoil: 1.1, reload: 3.2, automatic: true, projectile: 'bullet', penetration: 0.6 },
  w_rpg7: { id: 'w_rpg7', name: 'РПГ-7', class: ['engineer'], caliber: 'PG-7V', muzzle: 300, rpm: 8, magazine: 1, damage: 120, spread: 0.006, recoil: 3, reload: 5.5, automatic: false, explosive: 3.4, projectile: 'rocket' },
  w_spg9: { id: 'w_spg9', name: 'СПГ-9', class: ['support'], caliber: 'PG-9V', muzzle: 435, rpm: 6, magazine: 1, damage: 140, spread: 0.005, recoil: 3.4, reload: 6, automatic: false, explosive: 4.2, projectile: 'rocket' },
  w_pm: { id: 'w_pm', name: 'ПМ', class: ['assault', 'engineer', 'support', 'recon'], caliber: '9x18', muzzle: 315, rpm: 300, magazine: 8, damage: 19, spread: 0.01, recoil: 0.6, reload: 1.4, automatic: false, projectile: 'bullet', penetration: 0.3 },
  w_rgd5: { id: 'w_rgd5', name: 'РГД-5', class: ['assault', 'engineer', 'support', 'recon'], caliber: 'граната', muzzle: 18, rpm: 40, magazine: 1, damage: 110, spread: 0.01, recoil: 1, reload: 1.2, automatic: false, explosive: 1.9, frags: 32, projectile: 'grenade', gravity: -9.81, drag: 0.02 },
  w_f1: { id: 'w_f1', name: 'Ф-1', class: ['assault', 'support'], caliber: 'граната', muzzle: 18, rpm: 40, magazine: 1, damage: 130, spread: 0.01, recoil: 1, reload: 1.2, automatic: false, explosive: 2.3, frags: 40, projectile: 'grenade', gravity: -9.81, drag: 0.02 },
  w_c4: { id: 'w_c4', name: 'Заряд С4', class: ['support'], caliber: 'C4', muzzle: 0, rpm: 30, magazine: 3, damage: 0, spread: 0, recoil: 0, reload: 2, automatic: false, explosive: 5.5, projectile: 'c4' },
  w_tm62: { id: 'w_tm62', name: 'Мина ТМ-62', class: ['engineer'], caliber: 'мина', muzzle: 0, rpm: 30, magazine: 4, damage: 0, spread: 0, recoil: 0, reload: 2.4, automatic: false, explosive: 3.6, projectile: 'mine' },
  w_gp25: { id: 'w_gp25', name: 'ГП-25', class: ['assault'], caliber: 'ВОГ-25', muzzle: 76, rpm: 20, magazine: 1, damage: 95, spread: 0.008, recoil: 1.6, reload: 2.6, automatic: false, explosive: 2.4, projectile: 'grenade', gravity: -9.81, drag: 0.01 },
  w_mortar: { id: 'w_mortar', name: 'Миномёт 82 мм', class: ['support'], caliber: '82 мм', muzzle: 120, rpm: 12, magazine: 1, damage: 120, spread: 0.005, recoil: 2, reload: 3.2, automatic: false, explosive: 3.2, projectile: 'mortar', gravity: -9.81, drag: 0.005 },
  g_medkit: { id: 'g_medkit', name: 'Аптечка', class: ['assault'], caliber: 'gadget', muzzle: 0, rpm: 30, magazine: 4, damage: 0, spread: 0, recoil: 0, reload: 0.8, automatic: false, gadget: true, projectile: 'medkit' },
  g_ammo: { id: 'g_ammo', name: 'Ящик боеприпасов', class: ['support'], caliber: 'gadget', muzzle: 0, rpm: 30, magazine: 3, damage: 0, spread: 0, recoil: 0, reload: 0.9, automatic: false, gadget: true, projectile: 'ammo' },
  g_repair: { id: 'g_repair', name: 'Ремонтный ключ', class: ['engineer'], caliber: 'gadget', muzzle: 0, rpm: 30, magazine: 99, damage: 0, spread: 0, recoil: 0, reload: 0.5, automatic: false, gadget: true, projectile: 'repair' },
  g_drone: { id: 'g_drone', name: 'Дрон-разведчик', class: ['recon'], caliber: 'gadget', muzzle: 0, rpm: 30, magazine: 1, damage: 0, spread: 0, recoil: 0, reload: 1, automatic: false, gadget: true, projectile: 'medkit' },
  g_spawnbeacon: { id: 'g_spawnbeacon', name: 'Маяк спавна', class: ['recon'], caliber: 'gadget', muzzle: 0, rpm: 30, magazine: 1, damage: 0, spread: 0, recoil: 0, reload: 1, automatic: false, gadget: true, projectile: 'ammo' },
  g_mortar: { id: 'w_mortar', name: 'Миномёт 82 мм', class: ['support'], caliber: '82 мм', muzzle: 120, rpm: 12, magazine: 1, damage: 120, spread: 0.005, recoil: 2, reload: 3.2, automatic: false, explosive: 3.2, projectile: 'mortar', gravity: -9.81, drag: 0.005 },
  g_ladder: { id: 'g_ladder', name: 'Штурмовая лестница', class: ['recon', 'engineer'], caliber: 'gadget', muzzle: 0, rpm: 30, magazine: 2, damage: 0, spread: 0, recoil: 0, reload: 1, automatic: false, gadget: true, projectile: 'medkit' }
};

export const CLASSES: Record<ClassId, ClassConfig> = {
  assault: { id: 'assault', name: 'Штурмовик', weapons: ['w_ak74', 'w_akm'], gadgets: ['g_gp25', 'g_medkit'], role: 'Лечение и подавление' },
  engineer: { id: 'engineer', name: 'Инженер', weapons: ['w_aks74u', 'w_rpg7'], gadgets: ['g_repair', 'w_tm62'], role: 'Техника и мины' },
  support: { id: 'support', name: 'Поддержка', weapons: ['w_pkm', 'w_rpk'], gadgets: ['g_ammo', 'w_c4'], role: 'Боеприпасы и подрыв' },
  recon: { id: 'recon', name: 'Разведчик', weapons: ['w_svd', 'w_aks74u'], gadgets: ['g_drone', 'g_spawnbeacon'], role: 'Обнаружение и респавн' }
};

export const MODES: Record<string, ModeConfig> = {
  conquest: { id: 'conquest', name: 'Штурм', description: 'Захват и удержание точек. Потеря билетов при смерти и потере флага.', tickets: 350, points: 7, bots: 63 },
  rush: { id: 'rush', name: 'Прорыв', description: 'Атака и оборона. Заряды на М-СОМ, сектора открываются по этапам.', tickets: 120, points: 4, bots: 63 },
  holdout: { id: 'holdout', name: 'Штурм укрепрайона', description: 'Оборона здания от волн ботов. Разрушения сохраняются между волнами.', tickets: 5, points: 1, bots: 40 },
  campaign: { id: 'campaign', name: 'Кампания', description: 'Семь операций: квартал, мост, конвой, танковый прорыв, вертолёты, финал.', tickets: 300, points: 7, bots: 47 },
  range: { id: 'range', name: 'Полигон', description: 'Стенд разрушений, мишени и вся техника. Тестирование без ограничений.', tickets: 0, points: 2, bots: 4 }
};

export const DIFFICULTY: Record<Difficulty, { reaction: number; accuracy: number; label: string; retreat: number }> = {
  private: { reaction: 0.8, accuracy: 0.3, label: 'Рядовой', retreat: 0.25 },
  sergeant: { reaction: 0.5, accuracy: 0.55, label: 'Сержант', retreat: 0.4 },
  veteran: { reaction: 0.25, accuracy: 0.75, label: 'Ветеран', retreat: 0.55 }
};

export const VEHICLES: Record<string, VehicleConfig> = {
  v_uaz: { id: 'v_uaz', name: 'УАЗ-469', mass: 1700, hp: 1400, maxSpeed: 26, accel: 9, drive: 'wheel', armor: 0.12, seats: 4 },
  v_gaz66: { id: 'v_gaz66', name: 'ГАЗ-66', mass: 5800, hp: 2600, maxSpeed: 22, accel: 6, drive: 'wheel', armor: 0.06, seats: 8 },
  v_ural: { id: 'v_ural', name: 'Урал-4320', mass: 8000, hp: 3200, maxSpeed: 20, accel: 5, drive: 'wheel', armor: 0.06, seats: 6 },
  v_btr80: { id: 'v_btr80', name: 'БТР-80', mass: 13600, hp: 4200, maxSpeed: 24, accel: 6, drive: 'wheel', armor: 0.55, seats: 9, weapon: 'КПВТ 14.5', muzzle: 900, rpm: 300, damage: 52, amphibious: true },
  v_bmp2: { id: 'v_bmp2', name: 'БМП-2', mass: 14000, hp: 4400, maxSpeed: 25, accel: 7, drive: 'track', armor: 0.6, seats: 10, weapon: '2А42 30 мм', muzzle: 960, rpm: 550, damage: 42, amphibious: true },
  v_t72: { id: 'v_t72', name: 'Т-72', mass: 41000, hp: 9000, maxSpeed: 18, accel: 4.5, drive: 'track', armor: 1.0, seats: 3, weapon: '2А46 125 мм', muzzle: 850, rpm: 8, damage: 420, explosive: 5 },
  v_shilka: { id: 'v_shilka', name: 'ЗСУ-23-4 «Шилка»', mass: 21000, hp: 5000, maxSpeed: 20, accel: 5, drive: 'track', armor: 0.5, seats: 4, weapon: '4×23 мм', muzzle: 970, rpm: 2200, damage: 16 },
  v_brdm2: { id: 'v_brdm2', name: 'БРДМ-2', mass: 7000, hp: 2600, maxSpeed: 27, accel: 8, drive: 'wheel', armor: 0.3, seats: 4, weapon: 'КПВТ 14.5', muzzle: 900, rpm: 300, damage: 52, amphibious: true },
  v_vaz2101: { id: 'v_vaz2101', name: 'ВАЗ-2101', mass: 950, hp: 700, maxSpeed: 30, accel: 9, drive: 'wheel', armor: 0.04, seats: 4 },
  v_gaz24: { id: 'v_gaz24', name: 'ГАЗ-24 «Волга»', mass: 1450, hp: 800, maxSpeed: 32, accel: 9, drive: 'wheel', armor: 0.04, seats: 5 },
  v_liaz: { id: 'v_liaz', name: 'ЛиАЗ-677', mass: 11000, hp: 2000, maxSpeed: 20, accel: 4, drive: 'wheel', armor: 0.03, seats: 20 },
  v_kamaz: { id: 'v_kamaz', name: 'КамАЗ-5320', mass: 9000, hp: 3000, maxSpeed: 22, accel: 5, drive: 'wheel', armor: 0.04, seats: 3 },
  v_tram: { id: 'v_tram', name: 'Трамвай', mass: 20000, hp: 6000, maxSpeed: 14, accel: 3, drive: 'rail', armor: 0.12, seats: 25 },
  v_mi24: { id: 'v_mi24', name: 'Ми-24', mass: 8500, hp: 5200, maxSpeed: 75, accel: 12, drive: 'air', armor: 0.45, seats: 8, weapon: 'ГШ-30К + НАР', muzzle: 900, rpm: 400, damage: 60, explosive: 2.6 },
  v_mi8: { id: 'v_mi8', name: 'Ми-8', mass: 11000, hp: 4800, maxSpeed: 60, accel: 8, drive: 'air', armor: 0.3, seats: 14 },
  v_su25: { id: 'v_su25', name: 'Су-25', mass: 9500, hp: 4000, maxSpeed: 180, accel: 20, drive: 'air', armor: 0.6, seats: 1, weapon: 'ГШ-30-2 + бомбы', muzzle: 900, rpm: 600, damage: 55, explosive: 2.4 },
  v_boat: { id: 'v_boat', name: 'Катер', mass: 2200, hp: 1600, maxSpeed: 18, accel: 6, drive: 'boat', armor: 0.08, seats: 4 },
  v_dinghy: { id: 'v_dinghy', name: 'Надувная лодка', mass: 320, hp: 350, maxSpeed: 12, accel: 5, drive: 'boat', armor: 0.02, seats: 4 },
  v_moto: { id: 'v_moto', name: 'Мотоцикл «Урал»', mass: 480, hp: 400, maxSpeed: 26, accel: 8, drive: 'wheel', armor: 0.02, seats: 3 }
};

export const CAMPAIGN = [
  { id: 1, name: 'Зачистка квартала', map: 'sleepy', mode: 'conquest', bots: 23, tickets: 200, brief: 'Выбить противника из двора-колодца и удержать школу.', objective: 'Захватите все точки района' },
  { id: 2, name: 'Оборона моста', map: 'suburb', mode: 'holdout', bots: 31, tickets: 5, brief: 'Пригород. Мост — единственная переправа. Удержите позиции пять волн.', objective: 'Переживите пять волн' },
  { id: 3, name: 'Конвой', map: 'suburb', mode: 'rush', bots: 31, tickets: 140, brief: 'Сопроводите колонну через дачный посёлок.', objective: 'Уничтожьте все М-СОМ' },
  { id: 4, name: 'Танковый прорыв', map: 'factory', mode: 'conquest', bots: 39, tickets: 260, brief: 'Прорвать оборону завода на Т-72.', objective: 'Захватите проходную и цеха' },
  { id: 5, name: 'Вертолётная поддержка', map: 'harbor', mode: 'rush', bots: 39, tickets: 140, brief: 'Поддержите десант с воздуха на Ми-24.', objective: 'Уничтожьте М-СОМ в порту' },
  { id: 6, name: 'Порт под огнём', map: 'harbor', mode: 'conquest', bots: 47, tickets: 300, brief: 'Смешанный бой на набережной.', objective: 'Удержите большинство флагов' },
  { id: 7, name: 'Красный шторм', map: 'sleepy', mode: 'conquest', bots: 63, tickets: 400, brief: 'Финальный бой в центре города. Тотальные разрушения.', objective: 'Сломите сопротивление' }
] as const;

export const STORE_KEY = 'redstorm-settings-v1';
export const PROGRESS_KEY = 'redstorm-progress-v1';
export const SPAWN_SAMPLE: Vec3[] = generateWorld('sleepy', { time: 'day', weather: 'clear' }).teamSpawns['0'].map(s => [s.x, 0, s.z]);
