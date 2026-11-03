import * as THREE from 'three';
import { RenderCore } from '../render/core';
import { Effects } from '../render/effects';
import { AssetLibrary, RenderInstance, DebrisPool } from '../render/assets';
import { AudioEngine } from '../audio/audio';
import { Music } from '../audio/music';
import { SimClient } from './simclient';
import { Input } from './input';
import { ViewModel } from './viewmodel';
import { Minimap } from '../render/minimap';
import { HUD } from '../ui/hud';
import { Menus } from '../ui/menus';
import { loadSettings, saveSettings, loadProgress, saveProgress, addXp, type Progress } from '../ui/settings';
import type { AssetEntry, GameEvent, Manifest, MatchConfig, PlayerIntent, QualitySettings, Snapshot, Vec3 } from '../shared/types';
import { generateWorld } from '../shared/worldgen';
import { clamp, damp, dirFromYawPitch } from '../shared/mathx';
import { CAMPAIGN, CLASSES, WEAPONS } from '../shared/config';

interface EntityRec {
  inst: RenderInstance | null; team: number; kind: string;
  lastPos: THREE.Vector3; targetPos: THREE.Vector3; targetQuat: THREE.Quaternion;
  dead: boolean; name?: string; asset: string;
  walkPhase: number; lastYaw: number; hiddenForDriver: boolean;
}

const C_SOLDIER = 'c_soldier';

export class Game {
  core: RenderCore;
  effects: Effects;
  assets: AssetLibrary;
  audio = new AudioEngine();
  music = new Music();
  hud: HUD;
  menus: Menus;
  input: Input;
  viewModel: ViewModel;
  minimap: Minimap;
  sim: SimClient | null = null;
  settings = loadSettings();
  progress: Progress = loadProgress();
  manifest: Manifest;
  config: MatchConfig | null = null;
  snapshot: Snapshot | null = null;
  entities = new Map<number, EntityRec>();
  debrisPool: DebrisPool;
  worldSpec = generateWorld('sleepy', { time: 'day', weather: 'clear' });
  structureMeshes = new Map<number, { inst: RenderInstance; structureIndex: number; asset: string }>();
  propMeshes = new Map<number, RenderInstance>();
  vehicleMeshes = new Map<number, RenderInstance>();
  playerYaw = 0;
  playerPitch = 0;
  playerPos = new THREE.Vector3();
  cameraShake = 0;
  running = false;
  paused = false;
  dead = false;
  /** who killed us (for the killcam) and when the death camera started */
  killerId: number | null = null;
  killerName: string | null = null;
  deathAt = 0;
  killcamPos = new THREE.Vector3();
  killcamLook = new THREE.Vector3();
  killcamAngle = 0;
  matchOver = false;
  matchStart = 0;
  lastFrameTime = performance.now();
  frameTimes: number[] = [];
  cratersSeen = new Set<string>();
  mcomMeshes: THREE.Group[] = [];
  selectedClass = 'assault';
  spawnPoint = 0;
  perf = { render: 0, sim: 0, ai: 0, bodies: 0 };
  lastNotice = '';
  rafId = 0;
  tutorialActive = false;
  waveInfo = { wave: 0, total: 5 };
  lastSnapshotAt = 0;
  simTimeAcc = 0;
  lastWeapon = '';
  objectiveText = '';
  frameBoxHelper: THREE.Box3Helper | null = null;
  disposed = false;

  constructor(canvas: HTMLCanvasElement, manifest: Manifest) {
    this.manifest = manifest;
    this.core = new RenderCore(canvas, this.settings.quality);
    this.effects = new Effects(this.core.scene, this.settings.quality.particles);
    this.assets = new AssetLibrary(manifest);
    this.debrisPool = new DebrisPool(this.core.scene, 1400);
    this.viewModel = new ViewModel(this.assets);
    this.hud = new HUD();
    this.minimap = new Minimap(this.hud.minimap);
    this.hud.minimapRenderer = this.minimap;
    this.minimap.setDims(manifest.byId);
    this.input = new Input(canvas, this.settings);
    this.menus = new Menus({
      settings: this.settings, progress: this.progress,
      onStart: (cfg) => void this.startMatch(cfg),
      onSettings: (s) => {
        this.settings = s; saveSettings(s);
        this.core.setQuality(s.quality); this.audio.setSettings(s); this.input.settings = s;
        this.viewModel.setAspect(window.innerWidth / window.innerHeight);
      },
      onExit: () => this.exitToMenu(),
      onResume: () => this.togglePause(false),
      onRestart: () => void this.restart(),
      onSpawn: (idx) => { this.spawnPoint = idx; this.sim?.send({ t: 'respawn', point: idx }); this.menus.hideSpawn(); this.input.requestLock(true); },
      onClass: (cls) => { this.selectedClass = cls; this.sim?.send({ t: 'selectClass', cls }); },
      onOrder: (order, pos) => this.sim?.send({ t: 'command', order, pos }),
      onQuality: (q) => this.applyQuality(q),
      onNextMission: (id) => {
        const m = CAMPAIGN.find(c => c.id === id);
        if (!m) return;
        // reuse the last match's difficulty/time/weather/team so the campaign stays consistent
        const base = this.config;
        void this.startMatch({
          mode: m.mode as MatchConfig['mode'], map: m.map as MatchConfig['map'],
          bots: m.bots, tickets: m.tickets, mission: m.id,
          difficulty: base?.difficulty ?? 'sergeant', playerTeam: base?.playerTeam ?? 0,
          time: base?.time ?? 'day', weather: base?.weather ?? 'clear',
          quality: { ...this.settings.quality }
        });
      }
    });
    this.hud.setTeam(0);
    this.hud.onRespawn = () => { this.sim?.send({ t: 'respawn', point: this.spawnPoint }); this.menus.showSpawn(true, this.spawnInfo(), this.config); };
    this.hud.onClass = () => this.menus.showSpawn(true, this.spawnInfo(), this.config);
    this.hud.onTutorialDone = () => { this.progress.tutorialDone = true; saveProgress(this.progress); this.tutorialActive = false; };
    this.core.onContextLost = () => this.hud.showBanner('WebGL контекст потерян. Перезагрузите страницу (F5).', 999999);
    this.hud.showLoading(true, 'Загрузка манифеста…');
    window.addEventListener('resize', this.onResize);
    this.onResize();
    document.addEventListener('pointerlockchange', this.onLockChange);
    // clicking the battlefield (or the deploy button) grabs the mouse — required for aiming
    canvas.addEventListener('mousedown', this.onCanvasClick);
  }

  onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    this.core.resize();
    this.viewModel.setAspect(w / Math.max(1, h));
  };

  onCanvasClick = () => {
    if (this.running && !this.paused && !this.matchOver && !this.input.locked) this.input.requestLock(true);
  };

  onLockChange = () => {
    if (!this.input.locked && this.running && !this.paused && !this.matchOver && !this.menus.spawnEl) this.togglePause(true);
  };

  spawnInfo() {
    return this.worldSpec.points.map((p, i) => ({ id: p.id, name: p.name, x: p.x, z: p.z, owner: this.snapshot?.points[i]?.owner ?? p.owner }));
  }

  async boot() {
    await this.assets.loadAll(this.manifest, (done, total) => this.hud.setLoading(Math.round((done / total) * 86), `Модели и материалы: ${done}/${total}`));
    this.hud.setLoading(90, 'Создание карты…');
    this.menus.setManifest(this.manifest);
    this.menus.showMain(this.manifest);
    try { await this.audio.init(this.settings); this.music.start(this.audio.ctx!, this.audio.musicBus); this.music.setIntensity(0.2); }
    catch (e) { console.warn('[audio] init failed (autoplay policy?)', e); }
    // pre-build a menu backdrop
    this.core.buildTerrain(this.worldSpec);
    this.hud.showLoading(false);
    this.loop();
  }

  /* ------------------------------- match lifecycle ------------------------ */
  async startMatch(cfg: MatchConfig) {
    this.hud.showLoading(true, 'Сборка мира…');
    this.hud.setLoading(10, `Карта: ${cfg.map}`);
    this.config = cfg;
    this.hud.setTeam(cfg.playerTeam);
    this.worldSpec = generateWorld(cfg.map, { time: cfg.time, weather: cfg.weather });
    this.core.applyTimeOfDay(cfg.time, cfg.weather);
    this.core.buildTerrain(this.worldSpec);
    this.minimap.setWorld(this.worldSpec);
    this.minimap.team = cfg.playerTeam;
    this.clearWorldInstances();
    this.matchOver = false; this.dead = false;
    this.killerId = null; this.killerName = null;
    this.hud.showDeath(false, null);
    this.killcamPos.set(0, 0, 0); this.killcamLook.set(0, 0, 0); this.killcamAngle = 0;
    await new Promise(r => setTimeout(r, 40));
    // static buildings / installs
    let done = 0;
    const structTotal = Math.max(1, this.worldSpec.structures.length);
    for (const s of this.worldSpec.structures) {
      const inst = this.assets.instance(s.asset, { detail: 0 });
      if (!inst) continue;
      const y = this.core.sampleHeight(this.worldSpec, s.x, s.z);
      inst.group.position.set(s.x, y, s.z);
      inst.group.rotation.y = s.ry;
      inst.group.name = `struct_${s.id}`;
      this.core.scene.add(inst.group);
      this.structureMeshes.set(s.id, { inst, structureIndex: s.id, asset: s.asset });
      done++;
      if (done % 6 === 0) { this.hud.setLoading(20 + (done / structTotal) * 30, `Здания: ${done}/${structTotal}`); await new Promise(r => setTimeout(r, 0)); }
    }
    this.hud.setLoading(52, 'Реквизит и техника…');
    for (const p of this.worldSpec.props) {
      const inst = this.assets.instance(p.asset, { detail: 1 });
      if (!inst) continue;
      const y = this.core.sampleHeight(this.worldSpec, p.x, p.z);
      inst.group.position.set(p.x, y + (this.manifest.byId[p.asset]?.dims[1] ?? 1) / 2, p.z);
      inst.group.rotation.y = p.ry;
      inst.group.traverse(o => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
      this.core.scene.add(inst.group);
      this.propMeshes.set(p.id, inst);
    }
    for (const v of this.worldSpec.vehicles) {
      const entry = this.manifest.byId[v.asset];
      if (!entry) continue;
      const inst = this.assets.instance(v.asset, { detail: 0 });
      if (!inst) continue;
      this.core.scene.add(inst.group);
      inst.group.position.set(v.x, this.core.sampleHeight(this.worldSpec, v.x, v.z) + entry.dims[1] / 2, v.z);
      inst.group.rotation.y = v.ry;
      this.vehicleMeshes.set(v.id, inst);
    }
    this.hud.setLoading(70, 'Запуск физики (Rapier WASM)…');
    this.sim?.dispose();
    const sim = new SimClient();
    this.sim = sim;
    sim.onFrame = (snap, events) => this.onFrame(snap, events);
    sim.onGameOver = (winner, stats) => this.onGameOver(winner, stats);
    sim.onReady = (meshes) => this.bindStructureMeshes(meshes);
    sim.onMcom = (list) => this.hud.updateMcom(list);
    sim.onWaves = (wave, total) => {
      this.waveInfo = { wave, total };
      if (wave > 0) this.hud.showBanner(`Волна ${wave} из ${total}`, 3200);
    };
    sim.onError = (msg) => this.hud.showBanner(`Ошибка физики: ${msg}`, 12000);
    sim.onStatus = (_phase, text) => this.hud.setLoading(80, text);
    await sim.start(this.worldSpec, this.manifest.byId, cfg);
    this.hud.setLoading(96, 'Синхронизация мира…');
    await this.waitForSnapshot(sim, 6000);
    this.hud.showLoading(false);
    this.hud.showMatch(true);
    this.menus.showSpawn(true, this.spawnInfo(), cfg);
    this.running = true; this.paused = false; this.matchStart = performance.now();
    this.tutorialActive = !this.progress.tutorialDone && cfg.mode === 'conquest';
    this.hud.showTutorial(this.tutorialActive);
    this.audio.ui('levelup');
    this.music.setIntensity(0.35);
    this.input.requestLock(true);
  }

  waitForSnapshot(sim: SimClient, timeoutMs: number) {
    return new Promise<void>(resolve => {
      const t0 = performance.now();
      const check = () => {
        if (this.snapshot || this.sim !== sim || performance.now() - t0 > timeoutMs) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
  }

  /** Maps simulator mesh ids (the authoritative destruction identity) to render instances. */
  bindStructureMeshes(meshes: { id: number; asset: string; x: number; y: number; z: number }[]) {
    let unbound = 0;
    for (const m of meshes) {
      if (this.structureMeshes.has(m.id)) continue;
      // sim structure ids equal worldSpec structure ids; other mesh records (props, vehicles, chars) are skipped
      const spec = this.worldSpec.structures.find(s => s.id === m.id);
      if (spec) continue; // already bound by id above
      unbound++;
    }
    if (unbound) console.info('[render] unbound sim meshes (props/vehicles/chars):', unbound);
  }

  clearWorldInstances() {
    for (const b of this.structureMeshes.values()) { this.core.scene.remove(b.inst.group); b.inst.dispose(); }
    for (const p of this.propMeshes.values()) { this.core.scene.remove(p.group); p.dispose(); }
    for (const v of this.vehicleMeshes.values()) { this.core.scene.remove(v.group); v.dispose(); }
    for (const m of this.mcomMeshes) this.core.scene.remove(m);
    this.targetGroup.clear();
    this.core.scene.remove(this.targetGroup);
    for (const p of this.projectileMeshes.values()) this.core.scene.remove(p);
    this.projectileMeshes.clear();
    this.structureMeshes.clear(); this.propMeshes.clear(); this.vehicleMeshes.clear(); this.mcomMeshes = [];
    for (const rec of this.entities.values()) { if (rec.inst) { this.core.scene.remove(rec.inst.group); rec.inst.dispose(); } }
    this.entities.clear();
    this.cratersSeen.clear();
    this.debrisPool.reset();
    this.snapshot = null;
  }

  exitToMenu() {
    this.running = false; this.paused = false; this.matchOver = false; this.dead = false;
    this.sim?.dispose(); this.sim = null;
    this.hud.showMatch(false);
    this.hud.showTutorial(false);
    this.hud.showDeath(false, null);
    this.menus.hideSpawn();
    this.menus.showPause(false);
    this.menus.setMenuVisible(true);
    this.menus.showMain(this.manifest, 'mode');
    this.audio.stopEngines();
    this.music.setIntensity(0.2);
    this.input.requestLock(false);
  }

  async restart() {
    if (!this.config) return;
    await this.startMatch(this.config);
  }

  togglePause(p: boolean) {
    if (this.matchOver) return;
    this.paused = p;
    this.sim?.send({ t: 'pause', paused: p });
    if (p) { this.menus.showPause(true); this.input.requestLock(false); }
    else { this.menus.showPause(false); this.audio.resume(); if (this.running) this.input.requestLock(true); }
  }

  applyQuality(q: QualitySettings) {
    this.settings.quality = q;
    this.core.setQuality(q);
    this.effects.setQuality(q.particles);
    saveSettings(this.settings);
    this.sim?.send({ t: 'setQuality', cappedDebris: Math.round(1200 * q.debris) });
  }

  onGameOver(winner: number | null, stats: { kills: number; deaths: number; score: number; captures: number; assists: number }) {
    if (this.matchOver) return;
    this.matchOver = true;
    const won = winner === this.config!.playerTeam;
    this.progress.stats.matches++;
    if (won) this.progress.stats.wins++;
    this.progress.stats.kills += stats.kills;
    this.progress.stats.deaths += stats.deaths;
    const xp = stats.score + (won ? 500 : 120);
    const { leveled, unlocked } = addXp(this.progress, xp);
    if (won && this.config?.mission !== undefined) {
      this.progress.campaign[this.config.mission] = { completed: true, bestScore: Math.max(stats.score, this.progress.campaign[this.config.mission]?.bestScore ?? 0) };
    }
    saveProgress(this.progress);
    this.hud.showMatch(false);
    this.menus.showResult({
      winner, won, stats, xp, level: this.progress.level, leveled,
      unlocked: unlocked.map(u => WEAPONS[u]?.name ?? u), mode: this.config!.mode, mission: this.config!.mission
    });
    this.input.requestLock(false);
    this.music.setIntensity(0.15);
    this.audio.ui(won ? 'levelup' : 'deny');
  }

  /* ------------------------------- frame loop ----------------------------- */
  loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    this.core.autoQuality(dt);
    this.effects.update(dt);
    this.audio.update(dt);
    if (this.running && this.snapshot) {
      if (!this.paused && !this.matchOver) this.updatePlayerInput(dt);
      this.updateWorld(dt);
      this.renderFrame(dt);
      this.input.endFrame();
    } else {
      this.menuRender(dt);
      this.input.endFrame();
    }
    this.hud.tick(dt);
  };

  menuRender(dt: number) {
    const t = performance.now() / 1000;
    this.core.camera.position.set(Math.cos(t * 0.05) * 300, 105 + Math.sin(t * 0.11) * 7, Math.sin(t * 0.05) * 300);
    this.core.camera.lookAt(0, 18, 0);
    this.core.render(dt, this.core.camera);
  }

  /* ------------------------------- player input --------------------------- */
  updatePlayerInput(dt: number) {
    const snap = this.snapshot;
    if (!snap) return;
    const locked = this.input.locked;
    if (locked) {
      const m = this.input.mouseDelta;
      const sens = 0.0021 * this.settings.sensitivity * (snap.player.ads ? 0.55 : 1);
      this.playerYaw -= m[0] * sens;
      this.playerPitch = clamp(this.playerPitch - m[1] * sens * (this.settings.invertY ? -1 : 1), -1.45, 1.45);
      this.input.mouseDelta = [0, 0];
    }
    if (this.paused && this.input.consumePress('Escape')) { this.togglePause(false); return; }
    if (this.paused) return;
    if (this.input.consumePress('Tab')) this.hud.toggleScoreboard();
    if (this.hud.scoreboardOpen === false && this.hud.team !== (this.config?.playerTeam ?? 0)) this.hud.setTeam(this.config?.playerTeam ?? 0);
    if (this.input.consumePress('KeyR')) this.sim?.send({ t: 'intent', intent: { ...this.intent(), reload: true } });
    if (this.input.consumePress('KeyE')) this.sim?.send({ t: 'intent', intent: { ...this.intent(), interact: true } });
    if (this.input.consumePress('KeyG')) this.sim?.send({ t: 'intent', intent: { ...this.intent(), gadget: true } });
    if (this.input.consumePress('KeyV')) { this.sim?.send({ t: 'intent', intent: { ...this.intent(), melee: true } }); this.viewModel.melee(); }
    if (this.input.consumePress('Digit1')) this.selectSlot(0);
    if (this.input.consumePress('Digit2')) this.selectSlot(1);
    if (this.input.consumePress('Digit3')) this.selectSlot(2);
    if (this.input.consumePress('Digit4')) this.selectSlot(3);
    if (this.input.consumePress('KeyF')) this.sim?.send({ t: 'command', order: 'follow' });
    if (this.input.consumePress('KeyT')) this.sim?.send({ t: 'command', order: 'attack', pos: this.getAimTarget() });
    if (this.input.consumePress('KeyY')) {
      const target = this.nearestOwnedPoint();
      this.sim?.send({ t: 'command', order: 'defend', pos: target ? [target.x, 0, target.z] : this.getAimTarget() });
      this.hud.showBanner(target ? `Отряд держит ${target.name}` : 'Отряд держит позицию', 2200);
    }
    // continuous state (single message per frame)
    this.sim?.send({ t: 'intent', intent: this.intent() });
    const cur = this.snapshot?.player;
    if (!cur) return;
    if (cur.ammo !== this.lastAmmoLatch) {
      if (cur.ammo < this.lastAmmoLatch) this.viewModel.kick(1);
      this.lastAmmoLatch = cur.ammo;
    }
    if (cur.reloading > 0 && this.lastWeapon !== `${cur.weapon}:r`) {
      this.viewModel.startReload(cur.reloading);
      this.lastWeapon = `${cur.weapon}:r`;
    } else if (cur.reloading <= 0) this.lastWeapon = cur.weapon;
  }
  lastAmmoLatch = 0;

  nearestOwnedPoint() {
    const snap = this.snapshot;
    if (!snap) return null;
    const team = this.config?.playerTeam ?? 0;
    let best: { x: number; z: number; name: string } | null = null;
    let bd = Infinity;
    for (let i = 0; i < this.worldSpec.points.length; i++) {
      const pt = this.worldSpec.points[i];
      if (snap.points[i]?.owner !== team) continue;
      const d = (pt.x - this.playerPos.x) ** 2 + (pt.z - this.playerPos.z) ** 2;
      if (d < bd) { bd = d; best = { x: pt.x, z: pt.z, name: pt.name }; }
    }
    return best as { x: number; z: number; name: string } | null;
  }

  /** Weapon slots follow the class loadout: 1 primary, 2 secondary, 3 gadget, 4 equipment. */
  selectSlot(slot: number) {
    const p = this.snapshot?.player;
    if (!p) return;
    const cls = (CLASSES as Record<string, typeof CLASSES.assault>)[p.cls] ?? (CLASSES as Record<string, typeof CLASSES.assault>)[this.selectedClass] ?? CLASSES.assault;
    const options: string[] = [];
    if (slot === 0) options.push(...cls.weapons.filter(w => !WEAPONS[w]?.gadget));
    if (slot === 1) options.push(...cls.weapons.filter(w => WEAPONS[w]?.gadget));
    if (slot === 2) options.push(cls.gadgets[0]);
    if (slot === 3) options.push(cls.gadgets[1]);
    const target = options.find(w => !p.gadgets.some(g => g.id === w)) ?? options[0];
    if (!target) return;
    if (WEAPONS[target]?.gadget) {
      // gadget slots: use charges directly via gadget action (index selects which charge to spend first)
      const idx = cls.gadgets.indexOf(target);
      if (idx >= 0) this.sim?.send({ t: 'selectGadget', index: idx } as any);
      return;
    }
    this.sim?.send({ t: 'selectWeapon', weapon: target });
    this.hud.showBanner(WEAPONS[target]?.name ?? target, 900);
  }

  intent(): PlayerIntent {
    const k = this.input;
    const p = this.snapshot?.player;
    const inVehicle = (p?.vehicle ?? null) !== null;
    const move: [number, number] = [
      (k.isDown('KeyD') ? 1 : 0) - (k.isDown('KeyA') ? 1 : 0),
      (k.isDown('KeyW') ? 1 : 0) - (k.isDown('KeyS') ? 1 : 0)
    ];
    const ads = !inVehicle && (k.isDown('KeyZ') || (k.mouseButtons[2] ?? false));
    const returnFalse = () => false;
    return {
      move, yaw: this.playerYaw, pitch: this.playerPitch,
      fire: inVehicle ? (k.mouseButtons[0] ?? false) : (k.mouseButtons[0] ?? false) || returnFalse(),
      ads,
      sprint: k.isDown('ShiftLeft') && !ads,
      jump: k.isDown('Space'),
      crouch: k.isDown('ControlLeft'),
      prone: k.isDown('KeyX'),
      reload: false, interact: false, gadget: false, melee: false
    };
  }

  getAimTarget(): Vec3 {
    const eye = this.cameraEye();
    const dir = dirFromYawPitch(this.playerYaw, this.playerPitch);
    return [eye[0] + dir[0] * 60, eye[1] + dir[1] * 60, eye[2] + dir[2] * 60];
  }

  cameraEye(): Vec3 {
    const p = this.snapshot?.player;
    if (!p) return [0, 3, 0];
    if (p.vehicle !== null) {
      const v = this.snapshot?.vehicles.find(v => v.id === p.vehicle);
      if (v) return [v.pos[0], v.pos[1] + 2.1, v.pos[2]];
    }
    const h = p.stance === 2 ? 0.4 : p.stance === 1 ? 1.2 : 1.62;
    const bob = Math.sin(performance.now() / 260) * 0.012 * (p.sprint ? 1.4 : 1);
    return [this.playerPos.x, this.playerPos.y - 0.45 + h + bob, this.playerPos.z];
  }

  /* ------------------------------- world update --------------------------- */
  updateWorld(dt: number) {
    const snap = this.snapshot;
    if (!snap) return;
    const mine = snap.entities.find(e => e.kind === 'player');
    if (mine) {
      this.playerPos.set(mine.pos[0], mine.pos[1], mine.pos[2]);
      if (snap.player.vehicle !== null) {
        const v = snap.vehicles.find(v => v.id === snap.player.vehicle);
        if (v) this.playerPos.set(v.pos[0], v.pos[1], v.pos[2]);
      }
      if (!this.input.locked && this.input.lockedOnce && mine.alive && !this.paused) this.input.requestLock(true);
    }
    const alive = new Set<number>();
    for (const e of snap.entities) {
      if (e.kind === 'debris') { this.updateDebrisInstance(e); continue; }
      if (e.kind === 'projectile') { this.updateProjectile(e); continue; }
      if (e.kind === 'vehicle' || e.kind === 'gadget') continue; // vehicles are drawn from the vehicle list
      alive.add(e.id);
      let rec = this.entities.get(e.id);
      if (!rec) {
        rec = {
          inst: null, team: e.team, kind: e.kind,
          lastPos: new THREE.Vector3(...e.pos), targetPos: new THREE.Vector3(...e.pos),
          targetQuat: new THREE.Quaternion(), dead: false, name: e.name, asset: e.asset,
          walkPhase: Math.random() * 6, lastYaw: 0, hiddenForDriver: false
        };
        this.entities.set(e.id, rec);
      }
      rec.targetPos.set(e.pos[0], e.pos[1] - 0.97, e.pos[2]);
      const yaw = Math.atan2(2 * (e.quat[3] * e.quat[1] + e.quat[0] * e.quat[2]), 1 - 2 * (e.quat[1] * e.quat[1] + e.quat[2] * e.quat[2]));
      rec.lastYaw = yaw;
      rec.targetQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const selfPlayer = e.kind === 'player';
      const inAnyVehicle = e.vehicle !== undefined && e.vehicle !== null;
      if (selfPlayer) {
        // first-person: own body is never drawn, but its record keeps interpolation state
        if (rec.inst) rec.inst.group.visible = false;
      } else if (e.alive && !inAnyVehicle) {
        if (!rec.inst) {
          const assetId = this.manifest.byId[e.asset] ? e.asset : C_SOLDIER;
          rec.inst = this.assets.instance(assetId, { detail: 1 });
          if (rec.inst) this.core.scene.add(rec.inst.group);
        }
        if (rec.inst) {
          rec.inst.group.visible = true;
          // team tint so friend/foe reads instantly
          if (!rec.inst.group.userData.tinted) {
            rec.inst.group.userData.tinted = true;
            if (e.team !== (this.config?.playerTeam ?? 0)) rec.inst.setTint(0x8e8a7c);
          }
          // simple walk cycle: bob the body when the position actually changes
          const moved = rec.lastPos.distanceTo(rec.targetPos);
          rec.walkPhase += dt * (moved > 0.001 ? 7 : 0.6);
          rec.inst.group.rotation.z = Math.sin(rec.walkPhase) * clamp(moved * 22, 0, 0.06);
          rec.inst.group.position.y += Math.abs(Math.sin(rec.walkPhase)) * clamp(moved * 14, 0, 0.04);
        }
      } else if (rec.inst) rec.inst.group.visible = false;
      if (rec.inst) {
        const k = clamp(dt * 16, 0.1, 1);
        rec.lastPos.lerp(rec.targetPos, k);
        rec.inst.group.position.copy(rec.lastPos);
        rec.inst.group.quaternion.slerp(rec.targetQuat, k * 0.7);
        if (e.alive !== undefined) rec.dead = !e.alive;
      }
    }
    for (const [id, rec] of this.entities) if (!alive.has(id)) { if (rec.inst) { this.core.scene.remove(rec.inst.group); rec.inst.dispose(); } this.entities.delete(id); }
    // audio: persistent engine voices for nearby machines
    const audible = new Set<number>();
    for (const v of snap.vehicles) {
      if (v.destroyed) continue;
      const d = this.distanceToCamera(v.pos);
      if (d > 190) continue;
      audible.add(v.id);
      const entry = this.manifest.byId[v.asset];
      const kind = entry?.category === 'aircraft' ? (v.asset.includes('mi24') || v.asset.includes('mi8') ? 'rotor' : 'turbine') : 'diesel';
      this.audio.engineVoice(v.id, v.pos, Math.abs(v.speed) / 8, kind as 'diesel' | 'turbine' | 'rotor', d < 40);
    }
    if (audible.size !== this.lastAudibleCount || performance.now() - this.lastEnginePrune > 1000) {
      this.lastEnginePrune = performance.now();
      this.lastAudibleCount = audible.size;
      this.audio.stopEngines(audible);
    }
    this.perf.bodies = snap.entities.length + snap.vehicles.length;
    this.perf.sim = this.lastSimMs;
    this.perf.ai = snap.profiles?.aiMs ?? this.perf.ai;
  }

  lastSimMs = 0;
  lastAudibleCount = 0;
  lastEnginePrune = 0;

  updateDebrisInstance(e: { id: number; pos: Vec3; quat: [number, number, number, number]; status?: string }) {
    const idx = Math.abs(e.id) % 1400;
    this.debrisPool.set(idx, e.pos[0], e.pos[1], e.pos[2], { x: e.quat[0], y: e.quat[1], z: e.quat[2], w: e.quat[3] }, e.status === 'large' ? 1.7 : 0.75);
  }

  updateProjectile(e: { id: number; pos: Vec3; asset: string }) {
    let mesh = this.projectileMeshes.get(e.id);
    if (!mesh) {
      const geo = e.asset === 'rocket' || e.asset === 'mortar' ? new THREE.CylinderGeometry(0.06, 0.1, 0.7, 6) : new THREE.SphereGeometry(0.11, 6, 5);
      const mat = new THREE.MeshStandardMaterial({ color: e.asset === 'rocket' ? 0x4a5230 : 0x2a2a24, emissive: e.asset === 'rocket' ? 0xff5a1a : 0x000000, emissiveIntensity: 1.4 });
      mesh = new THREE.Mesh(geo, mat);
      mesh.geometry.rotateX(Math.PI / 2);
      this.core.scene.add(mesh);
      this.projectileMeshes.set(e.id, mesh);
    }
    mesh.position.set(e.pos[0], e.pos[1], e.pos[2]);
  }
  projectileMeshes = new Map<number, THREE.Mesh>();
  targetGroup = new THREE.Group();

  /* ------------------------------- rendering ------------------------------ */
  /**
   * Death camera: orbit the body (or follow the killer) for the first seconds after death,
   * then hold a slow overhead sweep of the corpse until the player respawns.
   */
  updateKillcam(dt: number, cam: THREE.Camera) {
    const body = this.playerPos;
    const elapsed = (performance.now() - this.deathAt) / 1000;
    const killerRec = this.killerId != null ? this.entities.get(this.killerId) : null;
    const followKiller = killerRec && elapsed < 3.4 && killerRec.lastPos.distanceTo(body) < 160;
    this.killcamAngle += dt * (followKiller ? 0.22 : 0.13);
    const radius = followKiller ? 5.4 : 7.2 + Math.sin(elapsed * 0.35) * 1.1;
    const height = followKiller ? 2.4 : 4.4 + elapsed * 0.22;
    const focus = followKiller && killerRec ? killerRec.lastPos.clone().add(new THREE.Vector3(0, 1.5, 0)) : body.clone().add(new THREE.Vector3(0, 0.7, 0));
    const want = new THREE.Vector3(
      focus.x + Math.cos(this.killcamAngle) * radius,
      focus.y + height,
      focus.z + Math.sin(this.killcamAngle) * radius
    );
    // never clip the camera into the terrain
    const gy = this.worldSpec ? this.core.sampleHeight(this.worldSpec, want.x, want.z) : undefined;
    const minY = (typeof gy === 'number' ? gy : focus.y - 1.2) + 1.1;
    if (want.y < minY) want.y = minY;
    const k = elapsed < 0.35 ? clamp(elapsed / 0.35, 0, 1) : 1;
    this.killcamPos.lerp(want, elapsed < 0.35 ? 1 : clamp(dt * 5, 0, 1));
    if (k < 1) this.killcamPos.copy(want);
    this.killcamLook.lerp(focus, clamp(dt * 6, 0, 1));
    cam.position.copy(this.killcamPos);
    cam.lookAt(this.killcamLook);
    // slow roll for a cinematic feel, damped out as the player respawns
    cam.rotateZ(Math.sin(elapsed * 0.5) * 0.045);
  }

  renderFrame(dt: number) {
    const snap = this.snapshot!;
    const eye = this.cameraEye();
    const cam = this.core.camera;
    const shake = this.effects.shakeOffset(performance.now() / 1000);
    const shakeAmt = Math.min(1, this.cameraShake);
    this.cameraShake = Math.max(0, this.cameraShake - dt * 1.8);
    const fwd = dirFromYawPitch(this.playerYaw, this.playerPitch);
    const dist = 6 * (this.settings.quality.fov / 78) + this.settings.quality.drawDistance * 0.02;
    const target = new THREE.Vector3(eye[0] + fwd[0] * dist, eye[1] + fwd[1] * dist, eye[2] + fwd[2] * dist);
    cam.position.set(eye[0] + shake.x * shakeAmt * 0.25, eye[1] + shake.y * shakeAmt * 0.25, eye[2]);
    cam.lookAt(target);
    if (!snap.player.alive) this.updateKillcam(dt, cam);
    if (shake.roll) cam.rotateZ(shake.roll * shakeAmt);
    const inVeh = snap.player.vehicle !== null;
    const ads = snap.player.ads;
    const baseFov = this.settings.quality.fov;
    const sprintFov = snap.player.sprint ? 5 : 0;
    const zoom = inVeh ? baseFov + 4 : (snap.player.weapon === 'w_svd' && ads) ? 20 : ads ? baseFov * 0.7 : baseFov + sprintFov;
    cam.fov = damp(cam.fov, zoom, 12, dt);
    cam.updateProjectionMatrix();
    this.audio.setListener([cam.position.x, cam.position.y, cam.position.z], fwd);
    // dynamically simulated props (barrels, crates) follow the physics body
    for (const p of snap.props ?? []) {
      const inst = this.propMeshes.get(p.id);
      if (!inst) continue;
      inst.group.position.set(p.pos[0], p.pos[1], p.pos[2]);
      inst.group.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
    }
    // destroyed panels / collapsed buildings
    for (const u of snap.meshUpdates) this.applyMeshUpdate(u);
    // vehicles (physics transform + turret/rotor animation)
    for (const v of snap.vehicles) {
      const inst = this.vehicleMeshes.get(v.id);
      if (!inst) continue;
      const dims = this.manifest.byId[v.asset]?.dims ?? [3, 2, 6];
      inst.group.position.set(v.pos[0], v.pos[1] - dims[1] * 0.18, v.pos[2]);
      inst.group.quaternion.set(v.quat[0], v.quat[1], v.quat[2], v.quat[3]);
      const turret = inst.parts.find(p => p.name.includes('turret'));
      if (turret) turret.rotation.y = v.turretYaw;
      const rotor = inst.parts.find(p => p.name === 'rotor');
      if (rotor) rotor.rotation.y = v.rotor;
      const tail = inst.parts.find(p => p.name === 'tailrotor');
      if (tail) tail.rotation.x = v.rotor * 2.4;
      for (const w of inst.parts) if (w.name.startsWith('wheel_')) w.rotation.x += Math.abs(v.speed) * dt * 0.8;
      if (v.destroyed && !inst.group.userData.burning) {
        inst.group.userData.burning = true;
        inst.setTint(0x241f1a);
        this.effects.explosion(v.pos, 6, 'vehicle');
        this.audio.explosion(v.pos, 'vehicle');
      }
      if (!v.destroyed) inst.group.userData.burning = false;
      const dcam = this.distanceToCamera(v.pos);
      if (v.destroyed && dcam < 130) { if (Math.random() < 0.45) this.effects.smoke([v.pos[0], v.pos[1] + 1, v.pos[2]], 0.7); if (Math.random() < 0.3) this.effects.flame([v.pos[0], v.pos[1] + 0.4, v.pos[2]], 0.8); }
      else if (!v.destroyed && v.hp < v.max * 0.4 && dcam < 100 && Math.random() < 0.3) this.effects.smoke([v.pos[0], v.pos[1] + 1.2, v.pos[2]], 0.45);
      if (Math.abs(v.speed) > 3 && dcam < 130 && Math.random() < 0.5) this.effects.vehicleDust([v.pos[0], v.pos[1] - 1, v.pos[2]], v.speed);
    }
    // craters mirror the sim heightfield
    for (const c of snap.craters ?? []) {
      const key = `${c.x.toFixed(1)}_${c.z.toFixed(1)}_${c.r.toFixed(1)}`;
      if (this.cratersSeen.has(key)) continue;
      this.cratersSeen.add(key);
      this.core.addCrater(c, this.worldSpec);
    }
    // polygon targets (range mode): steel plates and barrels streamed from the sim
    if (snap.targets && snap.targets.length) {
      if (this.targetGroup.children.length !== snap.targets.length) {
        this.core.scene.remove(this.targetGroup);
        this.targetGroup.clear();
        for (const t of snap.targets) {
          const g = new THREE.Group();
          if (t.kind === 'barrel') {
            const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), new THREE.MeshStandardMaterial({ color: 0x5a5232, roughness: 0.7, metalness: 0.3 }));
            b.position.y = 0.45; g.add(b);
          } else {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.1), new THREE.MeshStandardMaterial({ color: 0x4a4a42, metalness: 0.5, roughness: 0.6 }));
            post.position.y = 0.85; g.add(post);
            const plate = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.0, 0.06), new THREE.MeshStandardMaterial({ color: 0x2b2f2c, roughness: 0.5, metalness: 0.4 }));
            plate.position.y = 1.2; g.add(plate);
            const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.22, 16), new THREE.MeshBasicMaterial({ color: 0xd8d4c8, side: THREE.DoubleSide }));
            ring.position.set(0, 1.2, 0.035); g.add(ring);
          }
          g.position.set(t.x, t.y, t.z);
          this.core.scene.add(g);
          this.targetGroup.add(g);
        }
      }
    }
    // M-COM stations
    if (snap.mcoms && snap.mcoms.length && this.mcomMeshes.length !== snap.mcoms.length) {
      for (const m of this.mcomMeshes) this.core.scene.remove(m);
    this.targetGroup.clear();
    this.core.scene.remove(this.targetGroup);
    for (const p of this.projectileMeshes.values()) this.core.scene.remove(p);
    this.projectileMeshes.clear();
      this.mcomMeshes = snap.mcoms.map(() => {
        const g = new THREE.Group();
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.6), new THREE.MeshStandardMaterial({ color: 0x40453a, emissive: 0x220000, emissiveIntensity: 0.8 }));
        g.add(box);
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
        light.position.y = 0.52; g.add(light);
        this.core.scene.add(g);
        return g;
      });
    }
    snap.mcoms?.forEach((m, i) => {
      const g = this.mcomMeshes[i];
      if (!g) return;
      g.position.set(m.x, this.core.sampleHeight(this.worldSpec, m.x, m.z) + 0.36, m.z);
      g.visible = !m.destroyed;
      (g.children[1] as THREE.Mesh).visible = Math.sin(performance.now() / (m.armed ? 110 : 420)) > 0;
      (g.children[1] as THREE.Mesh).position.y = 0.52 + (m.armed ? Math.sin(performance.now() / 180) * 0.05 : 0);
    });
    // viewmodel animation state
    const moveLen = Math.hypot(snap.player.sprint ? 1 : 0, 1) * (this.input.isDown('KeyW') || this.input.isDown('KeyS') || this.input.isDown('KeyA') || this.input.isDown('KeyD') ? 1 : 0);
    this.viewModel.update(dt, snap, { sprinting: snap.player.sprint, moving: moveLen, ads, grounded: true, pitch: this.playerPitch, yawRate: this.playerYaw - this.lastYawSent });
    this.lastYawSent = this.playerYaw;
    this.hud.update(snap, {
      fps: this.core.fps, running: this.running, paused: this.paused, playerYaw: this.playerYaw,
      cameraEye: eye, points: this.worldSpec.points, vehicles: [...this.vehicleMeshes.keys()],
      wave: this.waveInfo, spawnPoints: this.spawnInfo(),
      perf: this.perf, ads
    });
    const overlay = this.viewModel.visible ? { scene: this.viewModel.scene, camera: this.viewModel.camera } : undefined;
    this.core.render(dt, cam, overlay);
    this.perf.render = this.frameTimes.length ? (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length) * 1000 : 0;
  }
  lastYawSent = 0;

  applyMeshUpdate(u: { id: number; vis: number[]; hidden: boolean }) {
    const target = this.structureMeshes.get(u.id);
    if (!target) return;
    target.inst.applyMask(u.vis);
    target.inst.group.visible = !u.hidden;
    if (u.hidden) {
      // collapsed building: physical debris already exists in the sim, so the mesh is removed rather than left floating
      target.inst.group.userData.collapsedAt = performance.now();
    }
  }

  /** Visual-only falling rubble slab, in addition to the physics debris streamed from the sim. */
  spawnDebrisVisual(pos: Vec3, size: number, kind: string) {
    if (this.distanceToCamera(pos) > 220) return;
    const n = kind === 'column' ? 4 : kind === 'wall' ? 3 : 1;
    for (let i = 0; i < n; i++) {
      this.debrisPool.setVisual(pos[0] + (Math.random() - 0.5) * 1.2, pos[1] + Math.random() * 1.5, pos[2] + (Math.random() - 0.5) * 1.2, Math.min(2.2, Math.max(0.5, size * 0.5)), Math.random() * Math.PI);
    }
  }

  distanceToCamera(p: Vec3) {
    const e = this.core.camera.position;
    return Math.hypot(p[0] - e.x, p[1] - e.y, p[2] - e.z);
  }

  /* -------------------------------- events ------------------------------- */
  onFrame(snap: Snapshot, events: GameEvent[]) {
    this.snapshot = snap;
    this.lastSnapshotAt = performance.now();
    this.lastSimMs = snap.profiles?.simMs ?? this.lastSimMs;
    if (snap.player.alive && this.dead) {
      this.dead = false; this.killerId = null; this.killerName = null;
      this.hud.showDeath(false, null);
      this.menus.showSpawn(false, [], null); this.menus.hideSpawn();
    }
    if (!snap.player.alive && !this.dead) {
      this.dead = true;
      this.deathAt = performance.now();
      this.menus.hideSpawn();
      this.input.requestLock(false);
      this.hud.showDeath(true, snap.player.killedBy ?? this.killerName ?? null);
    }
    for (const e of events) this.handleEvent(e);
    this.hud.handleEvents(events, snap);
  }

  handleEvent(e: GameEvent) {
    switch (e.e) {
      case 'shot': {
        const d = this.distanceToCamera(e.pos);
        this.effects.muzzleFlash(e.pos, e.dir);
        const dir = new THREE.Vector3(e.dir[0], e.dir[1], e.dir[2]).multiplyScalar(9);
        this.effects.tracer(e.pos, [e.pos[0] + dir.x, e.pos[1] + dir.y, e.pos[2] + dir.z], e.owner !== 1);
        this.audio.gunshot(e.weapon, e.pos, e.owner === 1);
        if (e.owner === 1) this.viewModel.kick(1.2);
        this.music.setIntensity(clamp(0.55 + 0.3 * (1 - d / 200), 0.3, 0.9));
        break;
      }
      case 'impact': this.effects.impact(e.pos, e.normal, e.material); if (this.distanceToCamera(e.pos) < 40) this.audio.impact(e.pos, e.material); break;
      case 'explosion': {
        this.effects.explosion(e.pos, e.radius, e.kind);
        this.audio.explosion(e.pos, e.kind);
        this.cameraShake = Math.min(1.4, this.cameraShake + clamp(e.radius / 12, 0.2, 1.4) * clamp(1 - this.distanceToCamera(e.pos) / 260, 0, 1));
        this.music.setIntensity(0.9);
        break;
      }
      case 'collapse': {
        this.effects.collapse(e.pos, e.size);
        this.audio.collapseSound(e.pos, e.size);
        this.cameraShake = Math.min(1.6, this.cameraShake + 0.9 * clamp(1 - this.distanceToCamera(e.pos) / 320, 0, 1));
        break;
      }
      case 'destroy': {
        // a wall panel / column / prop was destroyed by the sim
        if (e.kind === 'wall' || e.kind === 'column' || e.kind === 'debris') {
          this.effects.chipsBurst(e.pos, e.kind === 'column' ? 22 : 12, 'concrete');
          this.audio.impact(e.pos, 'concrete');
          const d = this.distanceToCamera(e.pos);
          if (d < 90) this.cameraShake = Math.min(1, this.cameraShake + 0.14 * (1 - d / 90));
        } else if (e.kind === 'tree') {
          this.effects.chipsBurst(e.pos, 10, 'wood');
          this.audio.impact(e.pos, 'wood');
        } else if (e.kind === 'prop') {
          this.effects.chipsBurst(e.pos, 8, 'metal');
          this.audio.impact(e.pos, 'metal');
        }
        this.spawnDebrisVisual(e.pos, e.size, e.kind);
        break;
      }
      case 'kill': {
        if (e.victim === 1) {
          this.killerId = e.killer > 1 ? e.killer : null;
          this.killerName = e.killerName;
          this.hud.killcam(e.killerName, e.victimName, e.weapon);
        }
        else this.hud.feed(e.killerName, e.victimName, e.head);
        this.audio.ui(e.victim === 1 ? 'kill' : 'hit');
        break;
      }
      case 'hit': if (e.owner === 1) { this.hud.hitmarker(e.head); this.audio.ui(e.head ? 'kill' : 'hit'); } break;
      case 'notice': this.hud.showBanner(e.text, 3200); this.lastNotice = e.text; break;
      case 'point': this.hud.showBanner(e.team === this.config?.playerTeam ? 'Точка захвачена' : 'Точка потеряна', 2600); this.audio.ui('capture'); break;
      case 'sound': this.audio.step(e.pos, e.kind === 'water_step'); break;
      case 'vehicleEnter': this.audio.ui('click'); this.hud.showBanner('Вы в технике. E — выйти', 2200); break;
      case 'vehicleExit': this.audio.ui('click'); break;
      case 'vehicleDestroyed': this.audio.explosion(e.pos, 'vehicle'); this.effects.explosion(e.pos, 7, 'vehicle'); break;
      case 'reload': if (e.state > 0) this.viewModel.startReload(2.4); break;
      case 'spawnCrater': this.core.addCrater({ x: e.pos[0], z: e.pos[2], r: e.radius, depth: e.radius * 0.35 }, this.worldSpec); break;
      case 'craters': for (const c of e.craters) this.core.addCrater(c, this.worldSpec); break;
      case 'mcom': this.hud.showBanner(e.destroyed ? 'М-СОМ уничтожен' : e.armed ? 'М-СОМ активирован' : 'М-СОМ обезврежен', 3000); break;
      default: break;
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.core.renderer.domElement.removeEventListener('mousedown', this.onCanvasClick);
    this.sim?.dispose();
    this.effects.dispose();
    this.debrisPool.dispose(this.core.scene);
    this.clearWorldInstances();
    this.viewModel.dispose();
    this.assets.dispose();
    this.audio.dispose();
    this.music.stop();
    this.core.dispose();
    this.input.dispose();
    this.hud.dispose();
    this.menus.dispose();
  }
}
