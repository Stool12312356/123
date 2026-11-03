// Headless UI verification: builds the real HUD and menu DOM in jsdom and drives every
// button, so a dead button / missing handler / runtime error cannot ship unnoticed.
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';

const ctxStub = () => new Proxy({}, {
  get: (_t, prop) => {
    if (prop === 'createLinearGradient') return () => ({ addColorStop: () => {} });
    if (prop === 'canvas') return { width: 512, height: 512 };
    if (prop === 'measureText') return () => ({ width: 10 });
    return () => {};
  },
  set: () => true
});

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window as unknown as Window & typeof globalThis;
  (globalThis as any).window = w;
  (globalThis as any).document = w.document;
  (globalThis as any).HTMLElement = w.HTMLElement;
  (globalThis as any).HTMLCanvasElement = w.HTMLCanvasElement;
  (globalThis as any).localStorage = w.localStorage;
  try { Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true }); } catch { /* node exposes a read-only navigator */ }
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
  (globalThis as any).location = w.location;
  (w.HTMLCanvasElement.prototype as any).getContext = () => ctxStub();
  (w.HTMLElement.prototype as any).requestPointerLock = () => Promise.resolve();
  (w.HTMLElement.prototype as any).scrollIntoView = () => {};
  return w;
}

const manifest = {
  version: 1, generatedAt: '', sourceFolder: '', errors: [],
  assets: [
    { id: 'w_ak74', category: 'weapon', item: 'АК-74', procedural: true, glb: 'assets/models/procedural/w_ak74.glb', dims: [0.06, 0.26, 0.94], parts: [], stats: {}, lod: [] },
    { id: 'w_svd', category: 'weapon', item: 'СВД', procedural: true, glb: 'assets/models/procedural/w_svd.glb', dims: [0.07, 0.3, 1.2], parts: [], stats: {}, lod: [] }
  ],
  byId: {}, counts: {}
} as any;
manifest.byId = { w_ak74: manifest.assets[0], w_svd: manifest.assets[1] };

const settings = {
  quality: { resolution: 1, shadows: 2, particles: 1, drawDistance: 1200, debris: 1, ssao: true, bloom: true, motionBlur: false, auto: true, fov: 78 },
  sensitivity: 1, invertY: false, fov: 78, volume: 0.7, music: 0.4, sfx: 0.8, hudScale: 1, crosshair: true
};
const progress = { xp: 0, level: 1, unlocks: ['w_ak74'], campaign: {}, stats: { kills: 0, deaths: 0, wins: 0, matches: 0, bestStreak: 0 }, tutorialDone: false };

function snapshot(): any {
  return {
    tick: 10, time: 1, tickets: [280, 300],
    player: { hp: 88, maxHp: 100, stamina: 0.7, oxygen: 1, ammo: 24, magazine: 30, reserve: 120, reloading: 0, weapon: 'w_ak74', gadgets: [{ id: 'g_medkit', charges: 2 }], seat: 0, vehicle: null, vehicleHp: 0, vehicleMax: 0, killedBy: null, alive: true, stance: 0, sprint: false, underWater: false, score: 40, kills: 2, deaths: 1, assists: 0, capture: 1, vehWeaponReady: true, ads: false, cls: 'assault', speed: 0 },
    entities: [{ id: 1, kind: 'player', asset: 'c_soldier', team: 0, pos: [0, 1, 0], quat: [0, 0, 0, 1], hp: 88, maxHp: 100, alive: true }],
    ai: [{ id: 5, team: 0, pos: [10, 1, 10], hp: 100, alive: true, vehicle: null, visibleEnemies: [], target: null, suppressed: 0, lastDamage: 0, cls: 'assault', ammoRatio: 1, objective: 'advance', yaw: 0 }],
    projectiles: [], meshUpdates: [], props: [], craters: [], mcoms: [], vehicles: [],
    points: [{ id: 'cp0', owner: 0, progress: 12, contested: 0 }, { id: 'cp1', owner: null, progress: 40, contested: 1 }],
    profiles: { simMs: 1.2, aiMs: 0.4 }
  };
}

describe('HUD', () => {
  let HUD: typeof import('../src/ui/hud').HUD;
  beforeEach(async () => {
    installDom();
    ({ HUD } = await import('../src/ui/hud'));
  });

  it('renders stats, feed, banner, minimap and death screen without errors', async () => {
    const hud = new HUD();
    expect(document.querySelector('.hud')).toBeTruthy();
    hud.setLoading(50, 'Загрузка');
    hud.showLoading(false);
    hud.showMatch(true);
    const ctx = {
      fps: 61, running: true, paused: false, playerYaw: 0.5, cameraEye: [0, 2, 0] as [number, number, number],
      points: [{ id: 'cp0', name: 'Площадь Ленина', x: 0, z: 0, radius: 55 }, { id: 'cp1', name: 'Школа', x: 100, z: 100, radius: 55 }],
      vehicles: [], wave: { wave: 0, total: 5 },
      spawnPoints: [{ id: 'cp0', name: 'Площадь', x: 0, z: 0, owner: 0 }],
      perf: { render: 8, sim: 1.4, ai: 0.5, bodies: 70 }, ads: false
    };
    for (let i = 0; i < 8; i++) { hud.update(snapshot(), ctx); hud.tick(0.016); }
    expect(document.querySelector('#hp-val')!.textContent).toBe('88');
    expect(document.querySelector('#ammo-mag')!.textContent).toBe('24');
    expect(document.querySelector('#weapon-name')!.textContent).toContain('АК-74');
    expect(document.querySelector('#perf')!.innerHTML).toContain('61');
    hud.feed('Сокол-1', 'Ворон-2', true);
    hud.feed('Сокол-2', 'Ворон-1', false);
    expect(document.querySelectorAll('#killfeed div').length).toBe(2);
    hud.showBanner('Точка захвачена', 1000);
    expect(document.querySelector('#banner')!.classList.contains('show')).toBe(true);
    hud.hitmarker(true);
    expect(document.querySelector('#hitmark')!.classList.contains('head')).toBe(true);
    hud.toggleScoreboard();
    hud.update(snapshot(), ctx);
    expect(document.querySelector('.scoreboard')).toBeTruthy();
    hud.toggleScoreboard();
    hud.updateMcom([{ id: 0, armed: true, progress: 40, destroyed: false }]);
    expect(document.querySelector('#mcom-indicator')!.innerHTML).toContain('40');
    let respawned = 0;
    hud.onRespawn = () => { respawned++; };
    hud.showDeath(true, 'Ворон-1');
    // the overlay counts down; the respawn button lights up once the timer elapses
    const timerEl = document.querySelector('.death-screen [data-act=timer]') as HTMLElement;
    expect(timerEl.textContent).toBe('5');
    hud.tick(0.5);
    expect(Number(timerEl.textContent)).toBeGreaterThan(0);
    expect(document.querySelector('.death-screen .sub')!.textContent).toContain('Ворон-1');
    (hud as any).deathUntil = 0;
    hud.tick(0.016);
    expect(document.querySelector('.death-screen [data-act=respawn]')!.classList.contains('ready')).toBe(true);
    document.querySelector('.death-screen [data-act=respawn]')!.dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(respawned).toBe(1);
    hud.showDeath(false, null);
    expect(document.querySelector('.death-screen')).toBeNull();
    hud.killcam('Ворон-1', 'Игрок', 'w_svd');
    hud.dispose();
    expect(document.querySelector('.hud')).toBeNull();
  });

  it('shows vehicle and oxygen readouts when they apply', async () => {
    const hud = new HUD();
    const snap = snapshot();
    snap.player.vehicle = 7; snap.player.vehicleHp = 3200; snap.player.vehicleMax = 4200;
    snap.player.underWater = true; snap.player.oxygen = 0.42;
    snap.vehicles = [{ id: 7, asset: 'v_uaz', pos: [0, 1, 0], quat: [0, 0, 0, 1], turretYaw: 0, speed: 9, rotor: 0, destroyed: false, hp: 3200, max: 4200 }];
    hud.update(snap, {
      fps: 60, running: true, paused: false, playerYaw: 0, cameraEye: [0, 2, 0], points: [], vehicles: [7],
      wave: { wave: 0, total: 1 }, spawnPoints: [], perf: { render: 7, sim: 1, ai: 0.3, bodies: 60 }, ads: true
    });
    expect(document.querySelector('#vehicle-hud')!.textContent).toContain('32');
    expect(document.querySelector('#oxy-val')!.textContent).toBe('42');
    expect(document.querySelector('#crosshair')!.classList.contains('hidden')).toBe(true);
    hud.dispose();
  });
});

describe('Menus', () => {
  it('renders every screen and wires every button to a real callback', async () => {
    installDom();
    const { Menus } = await import('../src/ui/menus');
    const calls: string[] = [];
    const menus: any = new Menus({
      settings: JSON.parse(JSON.stringify(settings)), progress: JSON.parse(JSON.stringify(progress)),
      onStart: (cfg: any) => calls.push('start:' + cfg.mode + ':' + cfg.map + ':' + cfg.bots),
      onSettings: () => calls.push('settings'), onExit: () => calls.push('exit'), onResume: () => calls.push('resume'),
      onRestart: () => calls.push('restart'), onSpawn: (i: number) => calls.push('spawn:' + i),
      onClass: (c: string) => calls.push('class:' + c), onOrder: () => calls.push('order'), onQuality: () => calls.push('quality'),
      onNextMission: (id: number) => calls.push('nextMission:' + id)
    });
    menus.showMain(manifest);
    expect(document.querySelector('.menu-root')).toBeTruthy();
    expect(document.querySelectorAll('[data-nav]').length).toBeGreaterThanOrEqual(5);
    // navigate through every screen
    for (const nav of ['mode', 'loadout', 'settings', 'progress', 'guide']) {
      const btn = [...document.querySelectorAll('[data-nav]')].find(b => (b as HTMLElement).dataset.nav === nav) as HTMLElement;
      btn.dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
      expect(document.querySelector('#menu-body')!.children.length).toBeGreaterThan(0);
      menus.showMain(manifest);
    }
    // mode cards -> match setup screen, then map selection and start
    menus.screen = 'mode';
    menus.showMain(manifest);
    (document.querySelector('[data-nav=mode]') as HTMLElement).dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    (document.querySelector('[data-mode=rush]') as HTMLElement).dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(menus.cfgDraft.mode).toBe('rush');
    expect(document.querySelector('[data-map=factoly]')).toBeNull();
    const mapCard = document.querySelector('[data-map=factory]') as HTMLElement;
    expect(mapCard).toBeTruthy();
    mapCard.dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(menus.cfgDraft.map).toBe('factory');
    menus.screen = 'match';
    menus.showMain(manifest);
    const bots = document.querySelector('select[data-f=bots]') as HTMLSelectElement;
    bots.value = '63';
    bots.dispatchEvent(new (window as any).Event('change', { bubbles: true }));
    expect(menus.cfgDraft.bots).toBe(63);
    (document.querySelector('[data-act=start]') as HTMLElement).dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(calls.some(c => c.startsWith('start:') && c.includes('63'))).toBe(true);
    // campaign list is populated and playable
    menus.screen = 'mission';
    menus.showMain(manifest);
    const missions = document.querySelectorAll('[data-mission]');
    expect(missions.length).toBe(7);
    // settings sliders apply quality without throwing
    menus.screen = 'settings';
    menus.showMain(manifest);
    const range = document.querySelector('input[data-q=fov]') as HTMLInputElement;
    range.value = '90';
    range.dispatchEvent(new (window as any).Event('input', { bubbles: true }));
    expect(menus.handlers.settings.quality.fov).toBe(90);
    expect(calls).toContain('quality');
    const preset = document.querySelector('[data-preset=low]') as HTMLElement;
    preset.dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(menus.handlers.settings.quality.resolution).toBeLessThan(1);
    // spawn screen: list of points, class cards, deploy/exit buttons
    menus.showMain(manifest);
    menus.showSpawn(true, [{ id: 'cp0', name: 'Площадь', x: 0, z: 0, owner: 0 }, { id: 'cp1', name: 'Школа', x: 100, z: 100, owner: null }], { mode: 'conquest', map: 'sleepy', bots: 31, difficulty: 'sergeant', time: 'day', weather: 'clear', tickets: 300, playerTeam: 0, quality: settings.quality });
    expect(document.querySelectorAll('[data-spawn]').length).toBe(2);
    (document.querySelector('[data-spawn="1"]') as HTMLElement).dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(calls).toContain('spawn:1');
    const classCard = document.querySelector('[data-cls=recon]') as HTMLElement;
    classCard.dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(calls).toContain('class:recon');
    (document.querySelector('.overlay-menu [data-act=exit]') as HTMLElement).dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(calls).toContain('exit');
    menus.hideSpawn();
    // pause menu
    menus.showPause(true);
    (document.querySelector('[data-act=resume]') as HTMLElement).dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(calls).toContain('resume');
    menus.showPause(true);
    (document.querySelector('[data-act=restart]') as HTMLElement).dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(calls).toContain('restart');
    // results screen
    menus.showResult({ winner: 0, won: true, stats: { kills: 12, deaths: 3, score: 900, captures: 2, assists: 1 }, xp: 1400, level: 3, leveled: true, unlocked: ['СВД'], mode: 'conquest' });
    expect(document.querySelector('.result-screen')!.textContent).toContain('ПОБЕДА');
    (document.querySelector('.result-screen [data-act=again]') as HTMLElement).dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(calls.filter(c => c === 'restart').length).toBeGreaterThanOrEqual(2);
    // a won campaign mission offers the next mission and hands its id to the game
    menus.showResult({ winner: 0, won: true, stats: { kills: 9, deaths: 1, score: 700, captures: 1, assists: 0 }, xp: 700, level: 4, leveled: false, unlocked: [], mode: 'conquest', mission: 2 });
    const nextBtn = document.querySelector('.result-screen [data-act=next]') as HTMLElement;
    expect(nextBtn.textContent).toContain('Следующая миссия');
    nextBtn.dispatchEvent(new (window as any).MouseEvent('click', { bubbles: true }));
    expect(calls).toContain('nextMission:3');
    // the last mission has no successor, so it offers a replay instead
    menus.showResult({ winner: 0, won: true, stats: { kills: 9, deaths: 1, score: 700, captures: 1, assists: 0 }, xp: 700, level: 4, leveled: false, unlocked: [], mode: 'conquest', mission: 7 });
    expect(document.querySelector('.result-screen [data-act=next]')).toBeNull();
    expect(document.querySelector('.result-screen [data-act=again]')!.textContent).toContain('Повторить');
    menus.dispose();
  });
});
