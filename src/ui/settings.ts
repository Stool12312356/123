import * as THREE from 'three';
import type { QualitySettings, Settings } from '../shared/types';
export type { Settings };
import { clamp } from '../shared/mathx';

export const DEFAULT_SETTINGS: Settings = {
  quality: { resolution: 1, shadows: 2, particles: 1, drawDistance: 1200, debris: 1, ssao: true, bloom: true, motionBlur: false, auto: true, fov: 78 },
  sensitivity: 0.9, invertY: false, fov: 78, volume: 0.75, music: 0.4, sfx: 0.85, hudScale: 1, crosshair: true
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('redstorm-settings-v1');
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_SETTINGS), ...parsed, quality: { ...DEFAULT_SETTINGS.quality, ...(parsed.quality ?? {}) } };
  } catch { return structuredClone(DEFAULT_SETTINGS); }
}
export function saveSettings(s: Settings) {
  try { localStorage.setItem('redstorm-settings-v1', JSON.stringify(s)); } catch { /* storage full / blocked */ }
}

export interface Progress {
  xp: number; level: number; unlocks: string[]; campaign: Record<number, { completed: boolean; bestScore: number; timeMs?: number }>;
  stats: { kills: number; deaths: number; wins: number; matches: number; bestStreak: number };
  tutorialDone: boolean;
}
export const DEFAULT_PROGRESS: Progress = {
  xp: 0, level: 1, unlocks: ['w_ak74', 'w_akm', 'g_medkit', 'g_gp25', 'g_repair'], campaign: {}, stats: { kills: 0, deaths: 0, wins: 0, matches: 0, bestStreak: 0 }, tutorialDone: false
};
export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem('redstorm-progress-v1');
    if (!raw) return structuredClone(DEFAULT_PROGRESS);
    return { ...structuredClone(DEFAULT_PROGRESS), ...JSON.parse(raw) };
  } catch { return structuredClone(DEFAULT_PROGRESS); }
}
export function saveProgress(p: Progress) {
  try { localStorage.setItem('redstorm-progress-v1', JSON.stringify(p)); } catch { /* ignore */ }
}

/** XP curve with unlocks tied to gameplay, not text. */
export function addXp(p: Progress, amount: number): { leveled: boolean; unlocked: string[] } {
  p.xp += amount;
  const level = Math.floor(Math.sqrt(p.xp / 120)) + 1;
  const unlocked: string[] = [];
  const table: [number, string][] = [
    [2, 'w_svd'], [2, 'g_drone'], [3, 'w_pkm'], [3, 'g_ammo'], [3, 'w_rpg7'], [4, 'g_spawnbeacon'], [5, 'w_spk' as string], [5, 'w_spg9'], [6, 'g_ladder'], [7, 'w_f1'], [8, 'w_c4'], [9, 'w_tm62']
  ];
  for (const [lvl, id] of table) if (level >= lvl && !p.unlocks.includes(id) && id !== 'w_spk') { p.unlocks.push(id); unlocked.push(id); }
  const leveled = level > p.level;
  p.level = level;
  saveProgress(p);
  return { leveled, unlocked };
}

export function qualityPreset(name: 'low' | 'medium' | 'high' | 'ultra'): QualitySettings {
  const base = structuredClone(DEFAULT_SETTINGS.quality);
  if (name === 'low') return { ...base, resolution: 0.7, shadows: 0, particles: 0.5, drawDistance: 600, debris: 0.5, ssao: false, bloom: false, motionBlur: false, auto: true };
  if (name === 'medium') return { ...base, resolution: 0.9, shadows: 1, particles: 0.8, drawDistance: 900, debris: 0.8, ssao: false, bloom: true };
  if (name === 'high') return { ...base, resolution: 1, shadows: 2, particles: 1, drawDistance: 1200, debris: 1, ssao: true, bloom: true };
  return { ...base, resolution: 1.25, shadows: 3, particles: 1.6, drawDistance: 1800, debris: 1.6, ssao: true, bloom: true, motionBlur: true };
}

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
export function clampSetting(v: number, lo: number, hi: number) { return clamp(v, lo, hi); }
export const QUICK_TIPS = [
  'Нажмите E у техники, чтобы занять место. Цифры 1–4 переключают оружие и снаряжение.',
  'ПКМ — прицеливание. В прицеле СВД меньше дыхание — выстрел точнее.',
  'У инженера есть ремкомплект: подойдите к подбитой машине и используйте гаджет (кнопка G).',
  'В стене можно пробить проём РПГ-7 и войти в квартиру — боты тоже пользуются такими проходами.',
  'Обрушьте несущие колонны — здание сложится целиком и оставит проходимый завал.',
  'Приказы отряду: F — следовать, T — атаковать, Y — держать точку.',
  'Полигон: стенд разрушений и вся техника для испытаний.'
];
