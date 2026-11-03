import './ui/styles.css';
import { Game } from './game/Game';
import type { Manifest } from './shared/types';

async function loadManifest(): Promise<Manifest> {
  const candidates = ['./assets/manifest.json', './manifest.json', '../assets/manifest.json'];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) return (await res.json()) as Manifest;
    } catch { /* try next */ }
  }
  // last resort: a minimal manifest so the menus still open and report the problem
  return { version: 0, generatedAt: '', sourceFolder: '', assets: [], byId: {}, counts: {}, errors: [{ id: 'manifest', message: 'manifest.json недоступен' }] };
}

async function boot() {
  const app = document.getElementById('app')!;
  const canvas = document.createElement('canvas');
  canvas.id = 'game-canvas';
  canvas.tabIndex = 0;
  app.appendChild(canvas);
  // the manifest is fetched at runtime (not inlined into the bundle) so startup stays light
  const manifest = await loadManifest();
  if (manifest.errors?.length) console.warn('[manifest] build errors', manifest.errors);
  const game = new Game(canvas, manifest);
  game.menus.setManifest(manifest);
  (window as any).__game = game;
  try {
    await game.boot();
  } catch (err) {
    console.error(err);
    const msg = document.createElement('div');
    msg.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#0d1110;color:#e9e4d8;font:14px/1.6 system-ui;padding:40px;text-align:center;z-index:99';
    msg.innerHTML = `<div><h1 style="color:#e2603f">Не удалось запустить игру</h1><p>${String((err as Error).message)}</p><p style="color:#a9a496">Проверьте консоль разработчика. Требуется браузер с WebGL 2.0 и поддержкой WebAssembly.</p></div>`;
    document.body.appendChild(msg);
  }
  const webgl = canvas.getContext('webgl2');
  if (!webgl) console.warn('[render] WebGL2 недоступен — включите аппаратное ускорение');
  if (typeof WebAssembly === 'undefined') console.warn('[physics] WebAssembly недоступен — физика не запустится');
  window.addEventListener('beforeunload', () => game.dispose());
}
boot();
