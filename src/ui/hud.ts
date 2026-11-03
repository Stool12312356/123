import type { GameEvent, Snapshot, Vec3, WeaponConfig } from '../shared/types';
import { WEAPONS, VEHICLES, CLASSES } from '../shared/config';
import { clamp, dist } from '../shared/mathx';

export interface HudContext {
  fps: number; running: boolean; paused: boolean; playerYaw: number; cameraEye: Vec3;
  points: { id: string; name: string; x: number; z: number; radius: number }[];
  vehicles: number[]; wave: { wave: number; total: number };
  spawnPoints: { id: string; name: string; x: number; z: number; owner: number | null }[];
  perf: { render: number; sim: number; ai: number; bodies: number };
  ads: boolean;
}

export class HUD {
  root: HTMLDivElement;
  minimap: HTMLCanvasElement;
  banner: HTMLDivElement;
  feedEl: HTMLDivElement;
  hitEl: HTMLDivElement;
  loading: HTMLDivElement;
  tutorialEl: HTMLDivElement | null = null;
  deathOverlay: HTMLDivElement | null = null;
  scoreboardEl: HTMLDivElement | null = null;
  bannerUntil = 0;
  feedItems: { html: string; until: number }[] = [];
  scoreboardOpen = false;
  matchTeams: { name: string; kills: number; deaths: number; score: number; team: number; alive: boolean }[] = [];
  lastPointOwners = new Map<string, number | null>();
  hitTimer = 0;
  minimapTimer = 0;

  minimapRenderer: import('../render/minimap').Minimap | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud hidden';
    this.root.innerHTML = `
      <div class="minimap-wrap"><canvas width="392" height="392"></canvas><div class="minimap-label">СПАЛЬНЫЙ РАЙОН · 2×2 КМ</div></div>
      <div class="topbar">
        <div class="tickets"><span class="a" id="tk-a">350</span><span class="lbl">БИЛЕТЫ</span><span class="b" id="tk-b">350</span></div>
        <div class="point-strip" id="point-strip"></div>
      </div>
      <div class="topright">
        <div class="perf" id="perf">FPS <b>—</b><br>рендер <b>—</b><br>физика <b>—</b><br>ИИ <b>—</b><br>тел <b>—</b></div>
      </div>
      <div class="mcom-indicator" id="mcom-indicator"></div>
      <div class="killfeed" id="killfeed"></div>
      <div class="banner" id="banner"></div>
      <div class="left-status">
        <div class="hp-block">
          <div class="bar-label"><span>Здоровье</span><span id="hp-val">100</span></div>
          <div class="bar hp big"><i id="hp-bar" style="width:100%"></i></div>
          <div class="bar-label" style="margin-top:8px"><span>Выносливость</span><span id="stam-val">100</span></div>
          <div class="bar stam"><i id="stam-bar" style="width:100%"></i></div>
          <div class="bar-label" style="margin-top:8px;display:none" id="oxy-row"><span>Кислород</span><span id="oxy-val">100</span></div>
          <div class="bar" style="display:none" id="oxy-bar-wrap"><i id="oxy-bar" style="width:100%;background:#5a8fb0"></i></div>
          <div class="bar-label" style="margin-top:8px;display:none" id="veh-row"><span id="veh-name">Техника</span><span id="veh-val">100</span></div>
          <div class="bar veh" style="display:none" id="veh-bar-wrap"><i id="veh-bar" style="width:100%"></i></div>
        </div>
      </div>
      <div class="vehicle-hud" id="vehicle-hud" style="display:none">
        <div><div class="lbl">СКОРОСТЬ</div><span class="spd" id="veh-speed">0</span> км/ч</div>
        <div><div class="lbl">СОСТОЯНИЕ</div><span id="veh-status">НОРМА</span></div>
        <div><div class="lbl">ЭКИПАЖ</div><span id="veh-crew">1</span></div>
      </div>
      <div class="ammo-block">
        <div class="weapon" id="weapon-name">АК-74</div>
        <div class="count"><span id="ammo-mag">30</span><small> / <span id="ammo-res">180</span></small></div>
        <div class="reload" id="reload-text"></div>
        <div class="gadget-row" id="gadgets"></div>
      </div>
      <div class="crosshair" id="crosshair"></div>
      <div class="hitmark" id="hitmark"></div>
      <div class="hint" id="hint" style="display:none"></div>
      <div class="order-hint">F — следуй · T — атакуй · Y — держи точку · TAB — счёт</div>
    `;
    document.body.appendChild(this.root);
    this.minimap = this.root.querySelector('canvas') as HTMLCanvasElement;
    this.banner = this.root.querySelector('#banner') as HTMLDivElement;
    this.feedEl = this.root.querySelector('#killfeed') as HTMLDivElement;
    this.hitEl = this.root.querySelector('#hitmark') as HTMLDivElement;
    this.loading = document.createElement('div');
    this.loading.className = 'loader';
    this.loading.innerHTML = `<div class="loader-inner"><div class="loader-title">Красный Шторм</div><div class="loader-bar"><span></span></div><div class="loader-text">Инициализация…</div></div>`;
    document.body.appendChild(this.loading);
  }

  showLoading(show: boolean, text = '') {
    this.loading.style.display = show ? 'grid' : 'none';
    if (text) this.setLoading(0, text);
  }
  setLoading(pct: number, text: string) {
    const bar = this.loading.querySelector('.loader-bar span') as HTMLElement;
    const t = this.loading.querySelector('.loader-text') as HTMLElement;
    if (bar) bar.style.width = `${clamp(pct, 2, 100)}%`;
    if (t) t.textContent = text;
  }
  showMatch(show: boolean) { this.root.classList.toggle('hidden', !show); }
  showBanner(text: string, ms = 2600) { this.banner.textContent = text; this.banner.classList.add('show'); this.bannerUntil = performance.now() + ms; }
  feed(killer: string, victim: string, head: boolean) {
    this.feedItems.unshift({ html: `<div>${killer}${head ? ' <span class="head">HEADSHOT</span>' : ''} <span style="color:var(--ink-dim)">▸</span> ${victim}</div>`, until: performance.now() + 5200 });
    this.renderFeed();
  }
  killcam(killer: string, victim: string, weapon: string) {
    this.feedItems.unshift({ html: `<div class="you">☠ ${killer} [${WEAPONS[weapon]?.name ?? weapon}] ▸ ${victim}</div>`, until: performance.now() + 6000 });
    this.renderFeed();
    this.showBanner(`Вы погибли: ${killer}`, 2400);
  }
  renderFeed() {
    this.feedEl.innerHTML = this.feedItems.slice(0, 6).map(f => f.html).join('');
  }
  hitmarker(head: boolean) {
    this.hitEl.classList.remove('show');
    void this.hitEl.offsetWidth;
    this.hitEl.classList.toggle('head', head);
    this.hitEl.classList.add('show');
  }
  toggleScoreboard() { this.scoreboardOpen = !this.scoreboardOpen; }
  updateMcom(list: { id: number; armed: boolean; progress: number; destroyed: boolean }[]) {
    const el = this.root.querySelector('#mcom-indicator') as HTMLDivElement;
    el.innerHTML = list.map(m => `<div class="${m.destroyed ? 'done' : m.armed ? 'armed' : ''}">М-СОМ ${m.id + 1}${m.destroyed ? ' ✕' : m.armed ? ` ${Math.round(m.progress)}%` : ''}</div>`).join('');
  }
  showTutorial(show: boolean) {
    if (!show) { this.tutorialEl?.remove(); this.tutorialEl = null; return; }
    if (this.tutorialEl) return;
    const el = document.createElement('div');
    el.className = 'tutorial';
    el.innerHTML = `<h4>ОБУЧЕНИЕ — 1/3</h4><p>WASD — движение, мышь — обзор, ЛКМ — огонь, ПКМ — прицел. Shift — бег, Ctrl — присесть, X — лежать.</p><div class="row"><button class="btn" data-act="skip">Пропустить</button><button class="btn primary" data-act="next">Далее</button></div>`;
    el.querySelector('[data-act=skip]')?.addEventListener('click', () => { this.showTutorial(false); this.onTutorialDone?.(); });
    el.querySelector('[data-act=next]')?.addEventListener('click', () => this.advanceTutorial(el));
    this.tutorialEl = el;
    document.body.appendChild(el);
  }
  tutorialIdx = 0;
  onTutorialDone: (() => void) | null = null;
  advanceTutorial(el: HTMLDivElement) {
    this.tutorialIdx = (this.tutorialIdx + 1) % 3;
    const steps = [
      ['1/3', 'WASD — движение, мышь — обзор, ЛКМ — огонь, ПКМ — прицел. Shift — бег, Ctrl — присесть, X — лежать.'],
      ['2/3', 'E — занять технику или место, G — гаджет (аптечка, ремонт, ящик), R — перезарядка, V — нож.'],
      ['3/3', 'F / T / Y — приказы отряду: следовать, атаковать, держать точку. Tab — таблица счёта. Esc — пауза.']
    ];
    const [n, text] = steps[this.tutorialIdx];
    el.innerHTML = `<h4>ОБУЧЕНИЕ — ${n}</h4><p>${text}</p><div class="row"><button class="btn" data-act="skip">Пропустить</button><button class="btn primary" data-act="${this.tutorialIdx === 2 ? 'done' : 'next'}">${this.tutorialIdx === 2 ? 'В бой' : 'Далее'}</button></div>`;
    el.querySelector('[data-act=skip]')?.addEventListener('click', () => { this.showTutorial(false); this.onTutorialDone?.(); });
    el.querySelector('[data-act=next]')?.addEventListener('click', () => this.advanceTutorial(el));
    el.querySelector('[data-act=done]')?.addEventListener('click', () => { this.showTutorial(false); this.onTutorialDone?.(); });
  }
  showDeath(show: boolean, killer: string | null) {
    if (!show) { this.deathOverlay?.remove(); this.deathOverlay = null; this.deathUntil = 0; return; }
    if (this.deathOverlay) return;
    this.deathUntil = performance.now() + 5200;
    const el = document.createElement('div');
    el.className = 'death-screen';
    el.innerHTML = `<div class="panel"><h2 style="color:var(--red-bright)">Вы убиты</h2><div class="sub">${killer ?? 'Причина неизвестна'} · возрождение через <b data-act="timer">5</b> с</div>
      <div class="sub">Выберите точку возрождения на карте или в списке ниже.</div>
      <div class="actions"><button class="btn primary" data-act="respawn">Возродиться</button><button class="btn" data-act="class">Сменить класс</button></div></div>`;
    el.querySelector('[data-act=respawn]')?.addEventListener('click', () => this.onRespawn?.());
    el.querySelector('[data-act=class]')?.addEventListener('click', () => this.onClass?.());
    document.body.appendChild(el);
    this.deathOverlay = el;
  }
  onRespawn: (() => void) | null = null;
  onClass: (() => void) | null = null;

  handleEvents(events: GameEvent[], snap: Snapshot) {
    for (const e of events) {
      if (e.e === 'point') {
        const was = this.lastPointOwners.get(e.id);
        if (was !== e.team) { this.lastPointOwners.set(e.id, e.team); }
      }
      if (e.e === 'kill') {
        this.matchTeams = this.matchTeams.length ? this.matchTeams : [];
      }
    }
    void snap;
  }

  update(snap: Snapshot, ctx: HudContext) {
    const q = (s: string) => this.root.querySelector(s) as HTMLElement | null;
    const set = (s: string, v: string) => { const el = q(s); if (el && el.textContent !== v) el.textContent = v; };
    set('#tk-a', String(Math.max(0, Math.round(snap.tickets[0]))));
    set('#tk-b', String(Math.max(0, Math.round(snap.tickets[1]))));
    const p = snap.player;
    set('#hp-val', String(Math.max(0, Math.round(p.hp))));
    (q('#hp-bar') as HTMLElement).style.width = `${clamp(p.hp, 0, 100)}%`;
    (q('#hp-bar') as HTMLElement).classList.toggle('low', p.hp < 30);
    set('#stam-val', String(Math.round(p.stamina * 100)));
    (q('#stam-bar') as HTMLElement).style.width = `${clamp(p.stamina * 100, 0, 100)}%`;
    const under = p.underWater || p.oxygen < 0.999;
    (q('#oxy-row') as HTMLElement).style.display = under ? 'flex' : 'none';
    (q('#oxy-bar-wrap') as HTMLElement).style.display = under ? 'block' : 'none';
    if (under) { set('#oxy-val', String(Math.round(p.oxygen * 100))); (q('#oxy-bar') as HTMLElement).style.width = `${p.oxygen * 100}%`; }
    const inVeh = p.vehicle !== null;
    (q('#veh-row') as HTMLElement).style.display = inVeh ? 'flex' : 'none';
    (q('#veh-bar-wrap') as HTMLElement).style.display = inVeh ? 'block' : 'none';
    if (inVeh) {
      set('#veh-val', String(Math.max(0, Math.round(p.vehicleHp))));
      (q('#veh-bar') as HTMLElement).style.width = `${clamp((p.vehicleHp / Math.max(1, p.vehicleMax)) * 100, 0, 100)}%`;
      const v = snap.vehicles.find(v => v.id === p.vehicle);
      if (v) { set('#veh-name', VEHICLES[v.asset]?.name ?? v.asset); }
      (q('#vehicle-hud') as HTMLElement).style.display = 'flex';
      set('#veh-speed', String(Math.round(Math.abs(v?.speed ?? 0) * 3.6)));
      set('#veh-status', (v?.destroyed ? 'УНИЧТОЖЕНА' : (v?.hp ?? 100) < (v?.max ?? 100) * 0.4 ? 'ПОВРЕЖДЕНА' : 'НОРМА'));
      set('#veh-crew', String(snap.entities.filter(e => e.kind === 'vehicle' && e.id === 1000 + (p.vehicle ?? -1)).map(e => e.seat ?? 0)[0] ?? 1));
    } else (q('#vehicle-hud') as HTMLElement).style.display = 'none';
    const w: WeaponConfig = WEAPONS[p.weapon] ?? WEAPONS.w_ak74;
    set('#weapon-name', w.name);
    set('#ammo-mag', String(p.ammo));
    set('#ammo-res', String(p.reserve));
    set('#reload-text', p.reloading > 0 ? 'ПЕРЕЗАРЯДКА…' : p.ammo === 0 ? 'НЕТ ПАТРОНОВ · R' : '');
    const gadgets = q('#gadgets') as HTMLElement;
    const gHtml = p.gadgets.map(g => `<div class="gadget ${g.charges <= 0 ? 'empty' : ''}">${(WEAPONS[g.id]?.name ?? g.id).slice(0, 12)} <b>${g.charges}</b></div>`).join('');
    if (gadgets.innerHTML !== gHtml) gadgets.innerHTML = gHtml;
    // crosshair
    const cross = q('#crosshair') as HTMLElement;
    cross.classList.toggle('hidden', inVeh || ctx.ads || p.stance === 2 || !p.alive);
    // perf
    const perf = q('#perf') as HTMLElement;
    perf.innerHTML = `FPS <b class="${ctx.fps < 45 ? 'warn' : ''}">${ctx.fps}</b><br>рендер <b>${ctx.perf.render.toFixed(1)} мс</b><br>физика <b>${ctx.perf.sim.toFixed(1)} мс</b><br>ИИ <b>${ctx.perf.ai.toFixed(1)} мс</b><br>тел <b>${snap.entities.length}</b><br>патроны <b>${snap.projectiles.length}</b>`;
    // flags
    const strip = q('#point-strip') as HTMLElement;
    const html = snap.points.map((pt, i) => `<div class="flag ${pt.owner === null ? 'neutral' : pt.owner === (this.team ?? 0) ? 'ours' : 'enemy'} ${pt.contested ? 'contested' : ''}" title="${ctx.spawnPoints[i]?.name ?? pt.id}">${String.fromCharCode(65 + i)}<i style="width:${clamp(pt.progress, 0, 100)}%"></i></div>`).join('');
    if (strip.innerHTML !== html) strip.innerHTML = html;
    // banner timers
    if (performance.now() > this.bannerUntil) this.banner.classList.remove('show');
    this.feedItems = this.feedItems.filter(f => f.until > performance.now());
    if (this.feedEl.childElementCount !== this.feedItems.length) this.renderFeed();
    // hint (contextual interaction)
    const hint = q('#hint') as HTMLElement;
    let hintText = '';
    if (!inVeh && p.alive) {
      const near = snap.vehicles.find(v => !v.destroyed && Math.hypot(v.pos[0] - ctx.cameraEye[0], v.pos[2] - ctx.cameraEye[2]) < 5);
      if (near) hintText = `E — ${VEHICLES[near.asset]?.name ?? near.asset}`;
    } else if (inVeh) hintText = 'E — выйти из техники';
    hint.style.display = hintText ? 'block' : 'none';
    if (hintText) hint.textContent = hintText;
    // minimap at ~10 Hz
    this.minimapTimer += 1;
    if (this.minimapTimer > 6) { this.minimapTimer = 0; this.drawMinimap(snap, ctx); }
    // scoreboard
    if (this.scoreboardOpen) this.renderScoreboard(snap); else if (this.scoreboardEl) { this.scoreboardEl.remove(); this.scoreboardEl = null; }
    // wave indicator
    if (ctx.wave.wave > 0) {
      const wv = q('#mcom-indicator') as HTMLElement;
      if (!wv.dataset.wave || wv.dataset.wave !== String(ctx.wave.wave)) { wv.dataset.wave = String(ctx.wave.wave); }
    }
    void dist; void CLASSES;
  }
  team = 0;
  setTeam(t: number) { this.team = t; }

  drawMinimap(snap: Snapshot, ctx: HudContext) {
    if (this.minimapRenderer) {
      this.minimapRenderer.draw(snap, ctx.cameraEye, ctx.playerYaw, this.team, ctx.points);
      return;
    }
    const c = this.minimap;
    const g = c.getContext('2d')!;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#26332e';
    g.fillRect(0, 0, W, H);
    const half = 1000;
    const scale = W / (half * 2);
    const toX = (x: number) => (x + half) * scale;
    const toY = (z: number) => (z + half) * scale;
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo((W / 8) * i, 0); g.lineTo((W / 8) * i, H); g.stroke(); g.beginPath(); g.moveTo(0, (H / 8) * i); g.lineTo(W, (H / 8) * i); g.stroke(); }
    for (const p of ctx.points) {
      const pt = snap.points.find(s => s.id === p.id);
      g.beginPath();
      g.arc(toX(p.x), toY(p.z), Math.max(9, p.radius * scale), 0, Math.PI * 2);
      g.fillStyle = pt?.owner === null || pt?.owner === undefined ? 'rgba(200,200,190,0.16)' : pt.owner === this.team ? 'rgba(90,143,176,0.3)' : 'rgba(226,96,63,0.3)';
      g.fill();
      g.strokeStyle = pt?.owner === this.team ? '#5a8fb0' : pt?.owner === null ? '#8b8b80' : '#e2603f';
      g.lineWidth = 2; g.stroke();
      g.fillStyle = '#e9e4d8'; g.font = 'bold 14px monospace'; g.textAlign = 'center';
      g.fillText(p.name.slice(0, 1), toX(p.x), toY(p.z) + 5);
      if (pt && pt.contested) { g.strokeStyle = '#d3a94b'; g.beginPath(); g.arc(toX(p.x), toY(p.z), Math.max(11, p.radius * scale) + 4, 0, Math.PI * 2); g.stroke(); }
    }
    // team mates and spotted enemies
    for (const a of snap.ai) {
      if (!a.alive) continue;
      const isMate = a.team === this.team;
      if (!isMate && !a.visibleEnemies.length) continue;
      g.fillStyle = isMate ? '#6fa8d6' : '#e2603f';
      g.beginPath(); g.arc(toX(a.pos[0]), toY(a.pos[2]), 3.2, 0, Math.PI * 2); g.fill();
    }
    for (const v of snap.vehicles) {
      if (v.destroyed) continue;
      g.fillStyle = 'rgba(211,169,75,0.85)';
      g.fillRect(toX(v.pos[0]) - 2, toY(v.pos[2]) - 2, 5, 5);
    }
    // player arrow
    const eye = ctx.cameraEye;
    g.save();
    g.translate(toX(eye[0]), toY(eye[2]));
    g.rotate(-ctx.playerYaw);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill();
    g.restore();
  }

  renderScoreboard(snap: Snapshot) {
    if (!this.scoreboardEl) {
      this.scoreboardEl = document.createElement('div');
      this.scoreboardEl.className = 'scoreboard';
      document.body.appendChild(this.scoreboardEl);
    }
    const bots = snap.ai.slice(0, 40);
    const rows = bots.map(a => `<tr><td class="${a.team === 0 ? 't0' : 't1'}">${a.team === 0 ? 'СССР' : 'Противник'}</td><td>${a.cls}</td><td>${Math.round(a.hp)}</td><td>${a.alive ? 'жив' : 'убит'}</td></tr>`).join('');
    this.scoreboardEl.innerHTML = `<h2 style="margin:0 0 12px;font-size:22px">Таблица счёта</h2>
      <table><thead><tr><th>Сторона</th><th>Класс</th><th>HP</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="sub" style="margin-top:12px">Билеты: <b style="color:#5a8fb0">${Math.round(snap.tickets[0])}</b> — <b style="color:#e2603f">${Math.round(snap.tickets[1])}</b></div>`;
  }

  tick(dt: number) {
    this.hitTimer += dt;
    if (this.hitTimer > 0.3) { /* reset handled by CSS animation */ }
    if (this.deathOverlay) {
      const left = Math.max(0, (this.deathUntil - performance.now()) / 1000);
      const t = this.deathOverlay.querySelector('[data-act=timer]') as HTMLElement | null;
      if (t) t.textContent = left > 0 ? String(Math.ceil(left)) : 'сейчас';
      const btn = this.deathOverlay.querySelector('[data-act=respawn]') as HTMLButtonElement | null;
      if (btn) btn.classList.toggle('ready', left <= 0);
    }
  }
  deathUntil = 0;

  dispose() {
    this.root.remove();
    this.loading.remove();
    this.tutorialEl?.remove();
    this.deathOverlay?.remove();
    this.scoreboardEl?.remove();
  }
}
