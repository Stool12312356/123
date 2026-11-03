import type { ClassId, DayTime, Difficulty, Manifest, MapId, MatchConfig, ModeId, QualitySettings, Settings, Weather } from '../shared/types';
import { CAMPAIGN, CLASSES, MODES, VEHICLES, WEAPONS } from '../shared/config';
import { qualityPreset, saveSettings, saveProgress, formatTime, QUICK_TIPS, type Progress } from './settings';

interface MenuHandlers {
  settings: Settings;
  progress: Progress;
  onStart: (cfg: MatchConfig) => void;
  onSettings: (s: Settings) => void;
  onExit: () => void;
  onResume: () => void;
  onRestart: () => void;
  onSpawn: (index: number) => void;
  onClass: (cls: ClassId) => void;
  onOrder: (order: 'follow' | 'attack' | 'defend' | 'none', pos?: [number, number, number]) => void;
  onQuality: (q: QualitySettings) => void;
  /** start campaign mission by id (mission number, 1-based) */
  onNextMission: (missionId: number) => void;
}

const MAP_NAMES: Record<MapId, string> = { sleepy: 'Спальный район', factory: 'Заводская площадка', suburb: 'Пригород', harbor: 'Портовый город' };
const MODE_IDS: ModeId[] = ['conquest', 'rush', 'holdout', 'campaign', 'range'];

export class Menus {
  root: HTMLDivElement;
  handlers: MenuHandlers;
  screen: 'main' | 'mode' | 'match' | 'mission' | 'loadout' | 'settings' | 'controls' | 'progress' | 'credits' | 'guide' = 'main';
  selectedMode: ModeId | null = null;
  selectedMap: MapId = 'sleepy';
  spawnEl: HTMLDivElement | null = null;
  pauseEl: HTMLDivElement | null = null;
  resultEl: HTMLDivElement | null = null;
  deathEl: HTMLElement | null = null;
  selectedClass: ClassId = 'assault';
  spawnPoints: { id: string; name: string; x: number; z: number; owner: number | null }[] = [];
  cfgDraft: MatchConfig;
  mapPreviewEl: HTMLElement | null = null;

  constructor(h: MenuHandlers) {
    this.handlers = h;
    this.cfgDraft = {
      mode: 'conquest', map: 'sleepy', bots: 31, difficulty: 'sergeant', time: 'day', weather: 'clear',
      tickets: 350, playerTeam: 0, quality: { ...h.settings.quality }
    };
    this.root = document.createElement('div');
    document.body.appendChild(this.root);
  }

  private btn(label: string, act: string, cls = ''): string { return `<button class="btn ${cls}" data-act="${act}">${label}</button>`; }

  showMain(manifest: Manifest, screen?: 'main' | 'mode' | 'match' | 'mission' | 'loadout' | 'settings' | 'controls' | 'progress' | 'credits' | 'guide') {
    // keep the active screen unless the caller navigates explicitly (a render must not reset it)
    if (screen) this.screen = screen;
    this.lastManifest = manifest;
    const prog = this.handlers.progress;
    const nextXp = Math.pow(prog.level, 2) * 120;
    const pct = Math.min(100, (prog.xp / Math.max(1, nextXp)) * 100);
    this.root.innerHTML = `
      <div class="menu-root">
        <aside class="menu-side">
          <div class="brand"><div class="brand-mark">★</div><div class="brand-text"><b>КРАСНЫЙ ШТОРМ</b><span>одиночный театр боевых действий</span></div></div>
          ${this.nav('mode', 'В бой', 'режимы и карты')}
          ${this.nav('loadout', 'Снаряжение', 'классы и оружие')}
          ${this.nav('progress', 'Прогресс', `уровень ${prog.level}`)}
          ${this.nav('guide', 'Руководство', 'управление')}
          ${this.nav('settings', 'Настройки', 'графика и звук')}
          <div class="spacer"></div>
          <div class="player-card">
            <div>Уровень <b>${prog.level}</b> · опыт <b>${prog.xp}</b></div>
            <div class="xp-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
            <div style="margin-top:8px">Матчей <b>${prog.stats.matches}</b> · побед <b>${prog.stats.wins}</b></div>
            <div>Ассетов: <b>${manifest.assets.length}</b> (${manifest.assets.filter(a => a.procedural).length} проц.)</div>
          </div>
        </aside>
        <main class="menu-body" id="menu-body"></main>
      </div>`;
    this.renderBody();
  }

  private nav(act: string, label: string, sub: string) { return `<button class="nav-btn ${this.screen === act ? 'active' : ''}" data-nav="${act}"><span>${label}</span><small>${sub}</small></button>`; }

  private renderBody() {
    const body = this.root.querySelector('#menu-body') as HTMLElement;
    if (!body) return;
    const h = this.handlers;
    if (this.screen === 'main' || this.screen === 'mode') {
      body.innerHTML = `
        <h1 class="screen-title">Выбор операции</h1>
        <div class="screen-sub">Полностью офлайновый матч против ботов: до 64 участников, командная борьба за точки, разрушаемые панельные дома и техника. ${QUICK_TIPS[0]}</div>
        <div class="cards">
          ${MODE_IDS.map(id => { const m = MODES[id]; return `<div class="card ${this.cfgDraft.mode === id ? 'selected' : ''}" data-mode="${id}"><div class="tag">${m.points > 5 ? 'ОСНОВНОЙ РЕЖИМ' : 'ОПЕРАЦИЯ'}</div><h3>${m.name}</h3><p>${m.description}</p><div class="meta"><span>до ${m.bots} ботов</span><span>билеты ${m.tickets || '—'}</span></div></div>`; }).join('')}
        </div>
        <div class="actions">${this.btn('Настроить матч', 'to-match', 'primary')}</div>
      `;
    } else if (this.screen === 'match') {
      const mode = this.cfgDraft.mode;
      body.innerHTML = `
        <h1 class="screen-title">${MODES[mode].name}</h1>
        <div class="screen-sub">${MODES[mode].description}</div>
        <div class="section-title">Карта</div>
        <div class="cards">
          ${(Object.keys(MAP_NAMES) as MapId[]).map(id => `<div class="card ${this.cfgDraft.map === id ? 'selected' : ''}" data-map="${id}"><h3>${MAP_NAMES[id]}</h3><p>${id === 'sleepy' ? '2×2 км · хрущёвки, школа, дворы-колодцы, гаражи. Максимальные разрушения.' : id === 'factory' ? '2×2 км · цеха, трубы, ж/д узел и проходные.' : id === 'suburb' ? '4×4 км · поля, река, мост, военная база, авиация.' : '3×3 км · набережная, краны, склады, снег.'}</p><div class="meta"><span>${id === 'suburb' ? 'техника + авиация' : id === 'harbor' ? 'смешанный бой' : 'пехота + броня'}</span></div></div>`).join('')}
        </div>
        <div class="row" style="margin-top:22px">
          <div class="field"><label>Ботов (всего)</label><select data-f="bots">${[15, 23, 31, 39, 47, 55, 63].map(n => `<option value="${n}" ${this.cfgDraft.bots === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label>Сложность</label><select data-f="difficulty">${(['private', 'sergeant', 'veteran'] as Difficulty[]).map(d => `<option value="${d}" ${this.cfgDraft.difficulty === d ? 'selected' : ''}>${d === 'private' ? 'Рядовой' : d === 'sergeant' ? 'Сержант' : 'Ветеран'}</option>`).join('')}</select></div>
          <div class="field"><label>Время суток</label><select data-f="time">${(['dawn', 'day', 'dusk', 'night'] as DayTime[]).map(t => `<option value="${t}" ${this.cfgDraft.time === t ? 'selected' : ''}>${t === 'dawn' ? 'Рассвет' : t === 'day' ? 'День' : t === 'dusk' ? 'Закат' : 'Ночь'}</option>`).join('')}</select></div>
          <div class="field"><label>Погода</label><select data-f="weather">${(['clear', 'rain', 'fog', 'snow'] as Weather[]).map(w => `<option value="${w}" ${this.cfgDraft.weather === w ? 'selected' : ''}>${w === 'clear' ? 'Ясно' : w === 'rain' ? 'Дождь' : w === 'fog' ? 'Туман' : 'Снег'}</option>`).join('')}</select></div>
          <div class="field"><label>Билеты</label><select data-f="tickets">${[150, 250, 350, 500].map(t => `<option value="${t}" ${this.cfgDraft.tickets === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label>Сторона игрока</label><select data-f="playerTeam"><option value="0" ${this.cfgDraft.playerTeam === 0 ? 'selected' : ''}>СССР (синие)</option><option value="1" ${this.cfgDraft.playerTeam === 1 ? 'selected' : ''}>Противник (красные)</option></select></div>
        </div>
        <div class="section-title">Быстрый запуск</div>
        <div class="actions">
          ${this.btn('Начать матч', 'start', 'primary')}
          ${this.btn('Назад', 'to-main', 'ghost')}
          ${this.btn('Полигон', 'start-range', 'ghost')}
          ${mode === 'campaign' ? this.btn('Кампания', 'to-mission', '') : ''}
        </div>
        <div class="sub" style="margin-top:18px;color:var(--ink-dim);font-size:12px">${QUICK_TIPS[1]}</div>
      `;
      this.renderMapPreview(body);
    } else if (this.screen === 'mission') {
      body.innerHTML = `
        <h1 class="screen-title">Кампания</h1>
        <div class="screen-sub">Семь связанных операций: от зачистки квартала до тотального штурма центра города. Прогресс сохраняется локально.</div>
        <div class="mission-list">
          ${CAMPAIGN.map((m, i) => {
            const done = h.progress.campaign[m.id]?.completed;
            const locked = i > 0 && !h.progress.campaign[CAMPAIGN[i - 1].id]?.completed && !h.progress.campaign[m.id]?.completed;
            return `<div class="mission ${locked ? 'locked' : ''}" data-mission="${locked ? '' : m.id}"><div class="num">${String(m.id).padStart(2, '0')}</div><div><h4>${m.name}</h4><p>${m.brief}</p><p style="margin-top:4px;color:var(--gold)">${m.objective}</p></div><div class="state">${done ? 'ВЫПОЛНЕНО' : locked ? 'ЗАКРЫТО' : 'ДОСТУПНО'}</div></div>`;
          }).join('')}
        </div>
        <div class="actions">${this.btn('Назад', 'to-match', 'ghost')}${this.btn('Сбросить прогресс кампании', 'reset-campaign', 'ghost')}</div>
      `;
    } else if (this.screen === 'loadout') {
      body.innerHTML = `
        <h1 class="screen-title">Снаряжение</h1>
        <div class="screen-sub">Четыре класса с разными ролями. Разблокировки выдаются за опыт и реально меняют доступное оружие и гаджеты.</div>
        <div class="cards">
          ${(Object.keys(CLASSES) as ClassId[]).map(id => { const c = CLASSES[id]; return `<div class="card ${this.selectedClass === id ? 'selected' : ''}" data-class="${id}"><div class="tag">${c.role}</div><h3>${c.name}</h3><p>${c.weapons.map(w => WEAPONS[w]?.name ?? w).join(' / ')}</p><div class="meta">${c.gadgets.map(g => `<span>${WEAPONS[g]?.name ?? g}</span>`).join('')}</div></div>`; }).join('')}
        </div>
        <div class="section-title">Арсенал</div>
        <div class="cards">
          ${Object.values(WEAPONS).filter(w => !w.gadget).map(w => {
            const unlocked = h.progress.unlocks.includes(w.id);
            const lvl = w.id === 'w_svd' ? 2 : ['w_pkm', 'w_rpg7'].includes(w.id) ? 3 : ['w_spg9'].includes(w.id) ? 5 : ['w_f1'].includes(w.id) ? 7 : ['w_c4'].includes(w.id) ? 8 : 0;
            return `<div class="card" style="${unlocked ? '' : 'opacity:0.45'}"><h3>${w.name}</h3><p>${w.caliber} · ${w.rpm} в/м · магазин ${w.magazine}</p><div class="meta"><span>${unlocked ? 'ДОСТУПНО' : `УРОВЕНЬ ${lvl || 1}`}</span><span>${w.explosive ? 'ОСКОЛОЧНО-ФУГАСНЫЙ' : 'ПУЛЕВОЙ'}</span></div></div>`;
          }).join('')}
        </div>
        <div class="actions">${this.btn('В бой', 'to-match', 'primary')}${this.btn('Назад', 'to-main', 'ghost')}</div>
      `;
    } else if (this.screen === 'settings') {
      const s = h.settings;
      const q = s.quality;
      body.innerHTML = `
        <h1 class="screen-title">Настройки</h1>
        <div class="screen-sub">Параметры сохраняются в localStorage и применяются немедленно. Автонастройка качества удерживает цель 60 FPS.</div>
        <div class="section-title">Графика</div>
        <div class="row">
          ${(['low', 'medium', 'high', 'ultra'] as const).map(p => `<button class="btn" data-preset="${p}">${p === 'low' ? 'Низкая' : p === 'medium' ? 'Средняя' : p === 'high' ? 'Высокая' : 'Ультра'}</button>`).join('')}
        </div>
        <div class="row" style="margin-top:14px">
          <div class="field"><label>Разрешение ${q.resolution.toFixed(2)}×</label><input type="range" min="0.5" max="1.3" step="0.05" value="${q.resolution}" data-q="resolution"></div>
          <div class="field"><label>Тени ${q.shadows}</label><input type="range" min="0" max="3" step="1" value="${q.shadows}" data-q="shadows"></div>
          <div class="field"><label>Частицы ${q.particles.toFixed(1)}×</label><input type="range" min="0.2" max="2" step="0.1" value="${q.particles}" data-q="particles"></div>
          <div class="field"><label>Дальность ${q.drawDistance} м</label><input type="range" min="400" max="2200" step="100" value="${q.drawDistance}" data-q="drawDistance"></div>
          <div class="field"><label>Обломки ${(q.debris * 100).toFixed(0)}%</label><input type="range" min="0.3" max="2" step="0.1" value="${q.debris}" data-q="debris"></div>
          <div class="field"><label>Поле зрения ${q.fov}°</label><input type="range" min="60" max="100" step="1" value="${q.fov}" data-q="fov"></div>
        </div>
        <div class="row" style="margin-top:12px">
          <label class="switch"><input type="checkbox" data-q="ssao" ${q.ssao ? 'checked' : ''}>SSAO</label>
          <label class="switch"><input type="checkbox" data-q="bloom" ${q.bloom ? 'checked' : ''}>Bloom</label>
          <label class="switch"><input type="checkbox" data-q="motionBlur" ${q.motionBlur ? 'checked' : ''}>Motion blur</label>
          <label class="switch"><input type="checkbox" data-q="auto" ${q.auto ? 'checked' : ''}>Автоснижение качества</label>
        </div>
        <div class="section-title">Звук</div>
        <div class="row">
          <div class="field"><label>Общая громкость ${(s.volume * 100).toFixed(0)}%</label><input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-s="volume"></div>
          <div class="field"><label>Эффекты ${(s.sfx * 100).toFixed(0)}%</label><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-s="sfx"></div>
          <div class="field"><label>Музыка ${(s.music * 100).toFixed(0)}%</label><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-s="music"></div>
        </div>
        <div class="section-title">Управление</div>
        <div class="row">
          <div class="field"><label>Чувствительность ${s.sensitivity.toFixed(2)}</label><input type="range" min="0.2" max="2.5" step="0.05" value="${s.sensitivity}" data-s="sensitivity"></div>
          <label class="switch"><input type="checkbox" data-s="invertY" ${s.invertY ? 'checked' : ''}>Инверсия по Y</label>
          <label class="switch"><input type="checkbox" data-s="crosshair" ${s.crosshair ? 'checked' : ''}>Прицел</label>
        </div>
        <div class="actions">${this.btn('Сбросить настройки', 'reset-settings', 'ghost')}${this.btn('К управлению', 'to-controls', 'ghost')}${this.btn('Назад', 'to-main', '')}</div>
      `;
    } else if (this.screen === 'controls' || this.screen === 'guide') {
      const binds: [string, string][] = [
        ['W A S D', 'Движение'], ['Мышь', 'Обзор'], ['ЛКМ', 'Огонь'], ['ПКМ / Z', 'Прицеливание'],
        ['Shift', 'Спринт'], ['Ctrl', 'Присесть'], ['X', 'Лечь'], ['Space', 'Прыжок'],
        ['R', 'Перезарядка'], ['E', 'Занять технику / действие'], ['G', 'Гаджет'], ['V', 'Нож'],
        ['1–4', 'Класс / снаряжение'], ['F / T / Y', 'Приказы отряду'], ['Tab', 'Таблица счёта'], ['Esc', 'Пауза']
      ];
      body.innerHTML = `
        <h1 class="screen-title">${this.screen === 'guide' ? 'Руководство' : 'Управление'}</h1>
        <div class="screen-sub">Все элементы управления работают и в пехотном бою, и при управлении техникой. Приказы отряду реально меняют поведение ботов.</div>
        <div class="keybind-grid">${binds.map(([k, v]) => `<div class="keybind"><span>${v}</span><kbd>${k}</kbd></div>`).join('')}</div>
        <div class="section-title">Механики</div>
        <div class="cards">
          <div class="card"><h3>Разрушение</h3><p>Пули откалывают бетон, взрывы выбивают панели стен, обрушение несущих колонн складывает секции дома. Кратеры меняют рельеф и навигацию.</p></div>
          <div class="card"><h3>Техника</h3><p>Танк, БМП, БТР, УАЗ, вертолёты и штурмовик. Гусеницы иммобилизуют машину, двигатель дымит, башня клинит, боекомплект детонирует.</p></div>
          <div class="card"><h3>Отряд</h3><p>Боты захватывают точки, укрываются, обходят с фланга, чинят технику и используют транспорт. Приказ атаки направляет их на выбранную позицию.</p></div>
          <div class="card"><h3>Полигон</h3><p>Отдельный режим с мишенями и стендом разрушений: проверьте каждую единицу техники и оружия.</p></div>
        </div>
        <div class="actions">${this.btn('Назад', 'to-main', 'ghost')}</div>
      `;
    } else if (this.screen === 'progress') {
      const p = h.progress;
      body.innerHTML = `
        <h1 class="screen-title">Прогресс</h1>
        <div class="screen-sub">Опыт начисляется за убийства, захваты, уничтожение техники и победы. Уровни открывают оружие и гаджеты.</div>
        <div class="stats-grid">
          <div class="stat"><b>${p.level}</b><span>Уровень</span></div>
          <div class="stat"><b>${p.xp}</b><span>Опыт</span></div>
          <div class="stat"><b>${p.stats.kills}</b><span>Убийства</span></div>
          <div class="stat"><b>${p.stats.deaths}</b><span>Смерти</span></div>
          <div class="stat"><b>${p.stats.wins}/${p.stats.matches}</b><span>Победы</span></div>
        </div>
        <div class="section-title">Кампания</div>
        <div class="mission-list">${CAMPAIGN.map(m => `<div class="mission"><div class="num">${String(m.id).padStart(2, '0')}</div><div><h4>${m.name}</h4><p>${m.map} · лучший счёт ${p.campaign[m.id]?.bestScore ?? 0}</p></div><div class="state">${p.campaign[m.id]?.completed ? 'ПРОЙДЕНО' : '—'}</div></div>`).join('')}</div>
        <div class="section-title">Разблокировано</div>
        <p class="screen-sub">${p.unlocks.map(u => WEAPONS[u]?.name ?? u).join(', ')}</p>
        <div class="actions">${this.btn('В бой', 'to-match', 'primary')}${this.btn('Сбросить прогресс', 'reset-progress', 'ghost')}</div>
      `;
    }
    this.wire();
  }

  private renderMapPreview(body: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'spawn-map';
    el.style.marginTop = '22px';
    el.style.aspectRatio = '2/1';
    el.innerHTML = this.mapSvg(this.cfgDraft.map);
    body.appendChild(el);
    this.mapPreviewEl = el;
  }

  mapSvg(map: MapId) {
    const seed = map === 'sleepy' ? 11 : map === 'factory' ? 23 : map === 'suburb' ? 37 : 41;
    let pts = '';
    for (let i = 0; i < 240; i++) {
      const x = (Math.sin(i * 12.9898 + seed) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233 + seed) * 12345.6789) % 1;
      pts += `<rect x="${Math.abs(x) * 600}" y="${Math.abs(y) * 300}" width="4" height="3" fill="rgba(210,205,190,0.18)"/>`;
    }
    const flags = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    return `<svg viewBox="0 0 600 300" preserveAspectRatio="xMidYMid slice">
      <rect width="600" height="300" fill="#2a3833"/>
      <path d="M0,150 C120,120 200,180 320,150 C420,120 520,170 600,140" stroke="#3d4d46" stroke-width="10" fill="none"/>
      <path d="M300,0 C280,80 330,160 300,300" stroke="#3d4d46" stroke-width="8" fill="none"/>
      ${map === 'suburb' || map === 'harbor' ? `<ellipse cx="${map === 'suburb' ? 380 : 200}" cy="${map === 'suburb' ? 210 : 90}" rx="${map === 'suburb' ? 150 : 170}" ry="${map === 'suburb' ? 50 : 40}" fill="#2c4a52" opacity="0.85"/>` : ''}
      ${pts}
      ${flags.map((f, i) => { const x = 90 + (i % 4) * 140, y = 70 + Math.floor(i / 4) * 150; return `<g><circle cx="${x}" cy="${y}" r="20" fill="rgba(233,228,216,0.1)" stroke="#8b8b80"/><text x="${x}" y="${y + 5}" font-family="monospace" font-size="14" fill="#e9e4d8" text-anchor="middle">${f}</text></g>`; }).join('')}
      <text x="16" y="286" font-family="monospace" font-size="11" fill="#8b8b80">${MAP_NAMES[map]} · ${map === 'suburb' ? '4×4' : map === 'harbor' ? '3×3' : '2×2'} км</text>
    </svg>`;
  }

  private wire() {
    const h = this.handlers;
    this.root.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => {
      const nav = (el as HTMLElement).dataset.nav!;
      this.screen = nav === 'loadout' || nav === 'settings' || nav === 'progress' || nav === 'guide' ? (nav as typeof this.screen) : 'mode';
      if (!this.lastManifest) return;
      this.showMain(this.lastManifest);
    }));
    this.root.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => {
      this.cfgDraft.mode = (el as HTMLElement).dataset.mode as ModeId;
      this.screen = 'match';
      if (this.lastManifest) this.showMain(this.lastManifest);
    }));
    this.root.querySelectorAll('[data-map]').forEach(el => el.addEventListener('click', () => {
      this.cfgDraft.map = (el as HTMLElement).dataset.map as MapId;
      if (this.lastManifest) this.showMain(this.lastManifest);
    }));
    this.root.querySelectorAll('[data-mission]').forEach(el => el.addEventListener('click', () => {
      const id = Number((el as HTMLElement).dataset.mission);
      if (!id) return;
      const m = CAMPAIGN.find(c => c.id === id)!;
      this.cfgDraft.mode = m.mode as ModeId;
      this.cfgDraft.map = m.map as MapId;
      this.cfgDraft.bots = m.bots;
      this.cfgDraft.tickets = m.tickets;
      this.cfgDraft.mission = m.id;
      this.start();
    }));
    this.root.querySelectorAll('[data-class]').forEach(el => el.addEventListener('click', () => {
      this.selectedClass = (el as HTMLElement).dataset.class as ClassId;
      h.onClass(this.selectedClass);
      if (this.lastManifest) this.showMain(this.lastManifest);
    }));
    this.root.querySelectorAll('[data-act]').forEach(el => el.addEventListener('click', () => {
      const act = (el as HTMLElement).dataset.act!;
      const rerender = () => { if (this.lastManifest) this.showMain(this.lastManifest); };
      if (act === 'to-match') { this.screen = 'match'; rerender(); }
      else if (act === 'to-main') { this.screen = 'mode'; rerender(); }
      else if (act === 'to-mission') { this.screen = 'mission'; rerender(); }
      else if (act === 'to-controls') { this.screen = 'controls'; rerender(); }
      else if (act === 'start') this.start();
      else if (act === 'start-range') { this.cfgDraft.mode = 'range'; this.cfgDraft.map = 'sleepy'; this.start(); }
      else if (act === 'reset-settings') { localStorage.removeItem('redstorm-settings-v1'); location.reload(); }
      else if (act === 'reset-progress') { localStorage.removeItem('redstorm-progress-v1'); location.reload(); }
      else if (act === 'reset-campaign') { h.progress.campaign = {}; saveProgress(h.progress); rerender(); }
    }));
    this.root.querySelectorAll('[data-preset]').forEach(el => el.addEventListener('click', () => {
      const p = (el as HTMLElement).dataset.preset as 'low' | 'medium' | 'high' | 'ultra';
      h.settings.quality = qualityPreset(p);
      saveSettings(h.settings);
      h.onQuality(h.settings.quality);
      if (this.lastManifest) this.showMain(this.lastManifest);
    }));
    this.root.querySelectorAll('[data-q]').forEach(el => {
      const key = (el as HTMLElement).dataset.q as keyof QualitySettings;
      el.addEventListener('input', () => {
        const input = el as HTMLInputElement;
        const val = input.type === 'checkbox' ? input.checked : Number(input.value);
        (h.settings.quality as any)[key] = val;
        saveSettings(h.settings);
        h.onQuality(h.settings.quality);
        if (input.type === 'range' && this.lastManifest) this.showMain(this.lastManifest);
      });
    });
    this.root.querySelectorAll('[data-s]').forEach(el => {
      const key = (el as HTMLElement).dataset.s as keyof Settings;
      el.addEventListener('input', () => {
        const input = el as HTMLInputElement;
        const val = input.type === 'checkbox' ? input.checked : Number(input.value);
        (h.settings as any)[key] = val;
        saveSettings(h.settings);
        h.onSettings(h.settings);
      });
    });
    this.root.querySelectorAll('select[data-f]').forEach(el => {
      const key = (el as HTMLElement).dataset.f!;
      el.addEventListener('change', () => {
        const input = el as HTMLSelectElement;
        const numeric = ['bots', 'tickets', 'playerTeam'].includes(key);
        (this.cfgDraft as any)[key] = numeric ? Number(input.value) : input.value;
      });
    });
  }

  private lastManifest: Manifest | null = null;

  private start() {
    const cfg: MatchConfig = {
      ...this.cfgDraft,
      quality: { ...this.handlers.settings.quality },
      bots: this.cfgDraft.mode === 'range' ? 4 : this.cfgDraft.bots
    };
    this.setMenuVisible(false);
    const root = this.root.querySelector('.menu-root') as HTMLElement | null;
    if (root) root.remove();
    this.handlers.onStart(cfg);
  }

  setMenuVisible(v: boolean) {
    const root = this.root.querySelector('.menu-root') as HTMLElement | null;
    if (root) root.style.display = v ? 'flex' : 'none';
  }

  showSpawn(show: boolean, points: { id: string; name: string; x: number; z: number; owner: number | null }[], cfg: MatchConfig | null) {
    this.spawnPoints = points;
    if (!show) { this.spawnEl?.remove(); this.spawnEl = null; return; }
    if (this.spawnEl) return;
    const el = document.createElement('div');
    el.className = 'overlay-menu';
    el.innerHTML = `<div class="panel wide">
      <h2>Развёртывание</h2>
      <div class="sub">${cfg ? MODES[cfg.mode].name : ''} · ${cfg ? MAP_NAMES[cfg.map] : ''} · ${cfg ? cfg.bots : 0} ботов · ${cfg ? (cfg.difficulty === 'private' ? 'Рядовой' : cfg.difficulty === 'sergeant' ? 'Сержант' : 'Ветеран') : ''}</div>
      <div class="row" style="align-items:flex-start;gap:22px">
        <div style="flex:1.2;min-width:280px">
          <div class="section-title" style="margin-top:0">Точки возрождения</div>
          <div class="cards" style="grid-template-columns:1fr 1fr">
            ${points.map((p, i) => `<div class="card" data-spawn="${i}"><h3>${p.name}</h3><div class="meta"><span>${p.owner === 0 ? 'СССР' : p.owner === 1 ? 'противник' : 'нейтрально'}</span><span>${Math.round(Math.hypot(p.x, p.z))} м</span></div></div>`).join('')}
          </div>
        </div>
        <div style="flex:1;min-width:260px">
          <div class="section-title" style="margin-top:0">Класс</div>
          <div class="class-grid" style="grid-template-columns:1fr 1fr">
            ${(Object.keys(CLASSES) as ClassId[]).map(id => `<div class="class-card ${this.selectedClass === id ? 'selected' : ''}" data-cls="${id}"><h4>${CLASSES[id].name}</h4><p>${CLASSES[id].role}</p><div class="loadout">${CLASSES[id].weapons.map(w => WEAPONS[w].name).join(' / ')}</div></div>`).join('')}
          </div>
        </div>
      </div>
      <div class="actions"><button class="btn primary" data-act="deploy">В бой</button><button class="btn" data-act="exit">В главное меню</button></div>
    </div>`;
    el.querySelectorAll('[data-spawn]').forEach(c => c.addEventListener('click', () => {
      this.handlers.onSpawn(Number((c as HTMLElement).dataset.spawn));
      this.setSpawnIndex(Number((c as HTMLElement).dataset.spawn));
    }));
    el.querySelectorAll('[data-cls]').forEach(c => c.addEventListener('click', () => {
      this.selectedClass = (c as HTMLElement).dataset.cls as ClassId;
      this.handlers.onClass(this.selectedClass);
      el.querySelectorAll('[data-cls]').forEach(x => x.classList.toggle('selected', x === c));
    }));
    el.querySelector('[data-act=deploy]')?.addEventListener('click', () => this.hideSpawn());
    el.querySelector('[data-act=exit]')?.addEventListener('click', () => this.handlers.onExit());
    document.body.appendChild(el);
    this.spawnEl = el;
  }
  setSpawnIndex(idx: number) {
    this.spawnEl?.querySelectorAll('[data-spawn]').forEach((c, i) => c.classList.toggle('selected', i === idx));
  }
  hideSpawn() { this.spawnEl?.remove(); this.spawnEl = null; }

  showPause(show: boolean) {
    if (!show) { this.pauseEl?.remove(); this.pauseEl = null; return; }
    if (this.pauseEl) return;
    const el = document.createElement('div');
    el.className = 'overlay-menu';
    el.innerHTML = `<div class="panel">
      <h2>Пауза</h2><div class="sub">Мир остановлен. Настройки и управление доступны.</div>
      <div class="actions">
        <button class="btn primary" data-act="resume">Продолжить</button>
        <button class="btn" data-act="settings">Настройки</button>
        <button class="btn" data-act="restart">Рестарт матча</button>
        <button class="btn" data-act="exit">Выйти в меню</button>
      </div>
      <div class="section-title">Подсказка</div><p class="screen-sub">${QUICK_TIPS[Math.floor(Math.random() * QUICK_TIPS.length)]}</p>
    </div>`;
    el.querySelector('[data-act=resume]')?.addEventListener('click', () => this.handlers.onResume());
    el.querySelector('[data-act=restart]')?.addEventListener('click', () => { this.hidePause(); this.handlers.onRestart(); });
    el.querySelector('[data-act=exit]')?.addEventListener('click', () => this.handlers.onExit());
    el.querySelector('[data-act=settings]')?.addEventListener('click', () => {
      this.hidePause();
      this.handlers.onResume();
      this.screen = 'settings';
      if (this.lastManifest) this.showMain(this.lastManifest);
      this.handlers.onSettings(this.handlers.settings);
    });
    document.body.appendChild(el);
    this.pauseEl = el;
  }
  hidePause() { this.pauseEl?.remove(); this.pauseEl = null; }

  showDeath(show: boolean, killer: string | null) { void show; void killer; }

  showResult(data: { winner: number | null; won: boolean; stats: { kills: number; deaths: number; score: number; captures: number; assists: number }; xp: number; level: number; leveled: boolean; unlocked: string[]; mode: ModeId; mission?: number }) {
    this.resultEl?.remove();
    const nextMission = data.won && data.mission !== undefined
      ? (CAMPAIGN as readonly { id: number; name: string }[]).find(m => m.id === data.mission! + 1) ?? null
      : null;
    const el = document.createElement('div');
    el.className = 'result-screen';
    el.innerHTML = `<div class="panel">
      <h1 class="${data.won ? 'win' : 'lose'}">${data.won ? 'ПОБЕДА' : data.winner === null ? 'НИЧЬЯ' : 'ПОРАЖЕНИЕ'}</h1>
      <div class="sub">${MODES[data.mode].name} · ${data.won ? 'операция выполнена' : 'операция провалена'}</div>
      <div class="stats-grid">
        <div class="stat"><b>${data.stats.kills}</b><span>Убийства</span></div>
        <div class="stat"><b>${data.stats.deaths}</b><span>Смерти</span></div>
        <div class="stat"><b>${data.stats.score}</b><span>Очки</span></div>
        <div class="stat"><b>${data.stats.captures}</b><span>Захваты</span></div>
        <div class="stat"><b>${data.stats.assists}</b><span>Помощь</span></div>
      </div>
      <div class="unlocks">+${data.xp} опыта · уровень ${data.level}${data.leveled ? ' · НОВЫЙ УРОВЕНЬ' : ''}</div>
      ${data.unlocked.length ? `<div class="unlocks">Открыто: ${data.unlocked.join(', ')}</div>` : ''}
      <div class="actions" style="justify-content:center">
        ${nextMission ? `<button class="btn primary" data-act="next">Следующая миссия: ${nextMission.name}</button>` : `<button class="btn primary" data-act="again">${data.mission !== undefined ? 'Повторить миссию' : 'Ещё матч'}</button>`}
        ${nextMission ? '<button class="btn" data-act="again">Повторить</button>' : ''}
        <button class="btn" data-act="main">В главное меню</button>
      </div>
    </div>`;
    el.querySelector('[data-act=again]')?.addEventListener('click', () => { el.remove(); this.handlers.onRestart(); });
    if (nextMission) el.querySelector('[data-act=next]')?.addEventListener('click', () => { el.remove(); this.handlers.onNextMission(nextMission.id); });
    el.querySelector('[data-act=main]')?.addEventListener('click', () => { el.remove(); this.handlers.onExit(); });
    document.body.appendChild(el);
    this.resultEl = el;
  }

  dispose() {
    this.root.remove();
    this.spawnEl?.remove(); this.pauseEl?.remove(); this.resultEl?.remove();
  }
  setManifest(m: Manifest) { this.lastManifest = m; }
  toggleScoreboard() { /* handled by HUD */ }
  formatTime = formatTime;
  vehicles = VEHICLES;
}
