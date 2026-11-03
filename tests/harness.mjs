// Headless simulation harness: runs the REAL simulation + AI worker in Node.
// A tiny module loader stands in for browser workers so gameplay can be verified
// without a GPU. Rapier's WASM is loaded through Node's WebAssembly support.
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, '.cache/testbuild');

let bundled = false;
export async function bundleHarness() {
  if (bundled) return { sim: path.join(outDir, 'simworker.mjs'), ai: path.join(outDir, 'aiworker.mjs'), world: path.join(outDir, 'world.mjs') };
  mkdirSync(outDir, { recursive: true });
  await build({
    root, configFile: false, logLevel: 'error',
    build: {
      ssr: true, outDir, emptyOutDir: false, target: 'node20', minify: false,
      rollupOptions: {
        input: { simworker: path.join(root, 'src/sim/worker.ts'), aiworker: path.join(root, 'src/ai/worker.ts'), world: path.join(root, 'src/shared/worldgen.ts') },
        output: { format: 'esm', entryFileNames: '[name].mjs' }
      }
    },
    ssr: { noExternal: true }
  });
  bundled = true;
  return { sim: path.join(outDir, 'simworker.mjs'), ai: path.join(outDir, 'aiworker.mjs'), world: path.join(outDir, 'world.mjs') };
}

class WorkerShim {
  constructor(workerPath, tag) {
    this.workerPath = workerPath; this.tag = tag;
    this.onmessage = null; this.onerror = null; this.ctx = null; this.queue = [];
    this.initPromise = this.ensure();
  }
  async ensure() {
    if (this.ctx) return;
    const scope = {
      onmessage: null,
      postMessage: (m) => {
        const data = structuredClone(m);
        queueMicrotask(() => { if (this.onmessage) this.onmessage({ data }); else this.queue.push(data); });
      },
      close: () => { this.ctx = null; },
      addEventListener: () => {}, removeEventListener: () => {}
    };
    this.ctx = scope;
    globalThis.__workerScope = scope;
    // cache-bust: every shim needs a fresh module instance so it re-registers onmessage
    WorkerShim.importSeq = (WorkerShim.importSeq ?? 0) + 1;
    await import(pathToFileURL(this.workerPath).href + `?shim=${WorkerShim.importSeq}`);
    globalThis.__workerScope = undefined;
    for (let i = 0; i < 200 && typeof scope.onmessage !== 'function'; i++) await new Promise(r => setTimeout(r, 10));
    if (typeof scope.onmessage !== 'function') throw new Error(`worker ${this.tag} never registered onmessage`);
    for (const m of this.queue.splice(0)) this.onmessage && this.onmessage({ data: m });
  }
  async postMessage(m) {
    for (let i = 0; i < 200 && typeof this.ctx?.onmessage !== 'function'; i++) await new Promise(r => setTimeout(r, 5));
    if (!this.ctx || typeof this.ctx.onmessage !== 'function') throw new Error(`worker ${this.tag} not ready`);
    this.ctx.onmessage({ data: structuredClone(m) });
  }
  terminate() { this.ctx = null; }
}

export function stubBrowserEnv(assetRoot) {
  globalThis.self = globalThis.self ?? globalThis;
  globalThis.fetch = async (url) => {
    const rel = String(url).replace(/^\.\//, '');
    const file = path.join(assetRoot, rel);
    const buf = readFileSync(file);
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
  globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
}

/**
 * Boots a SimEngine directly in-process (no worker messaging) so tests can assert on
 * internal state such as panel visibility masks. Uses the same bundling as the worker.
 */
export async function directEngine(opts) {
  const { sim: simPath, world: worldPath } = await bundleHarness();
  stubBrowserEnv(root);
  const worldgen = await import(pathToFileURL(worldPath).href + `?direct=${Date.now()}`);
  globalThis.__workerScope = { onmessage: null, postMessage: () => {}, addEventListener() {}, removeEventListener() {}, close() {} };
  await import(pathToFileURL(simPath).href + `?direct=${Date.now()}`);
  const SimEngine = globalThis.__SimEngine;
  const loadAllAssets = globalThis.__loadAllAssets;
  if (!SimEngine || !loadAllAssets) throw new Error('engine test hooks missing from worker bundle');
  const manifest = JSON.parse(readFileSync(path.join(root, 'assets/manifest.json'), 'utf8'));
  const spec = worldgen.generateWorld(opts.map, { time: opts.time ?? 'day', weather: opts.weather ?? 'clear' });
  const { geo } = await loadAllAssets(manifest.byId, () => {});
  const clean = {}; for (const [id, g] of geo) clean[id] = g;
  const quality = { resolution: 1, shadows: 2, particles: 1, drawDistance: 1200, debris: 1, ssao: true, bloom: true, motionBlur: false, auto: true, fov: 75 };
  const config = { mode: opts.mode, map: opts.map, bots: opts.bots ?? 0, difficulty: opts.difficulty ?? 'sergeant', time: opts.time ?? 'day', weather: opts.weather ?? 'clear', tickets: opts.tickets ?? 300, playerTeam: 0, quality };
  const sim = new SimEngine(quality);
  await sim.init(spec, manifest.byId, clean, config);
  return { sim, spec, manifest };
}

export class SimHost {
  constructor() { this.messages = []; this.frames = 0; this.events = []; this.latestFrame = null; this.gameover = null; this.errors = []; }
  async start(opts) {
    const { sim, ai, world } = await bundleHarness();
    stubBrowserEnv(root);
    const simShim = new WorkerShim(sim, 'sim');
    this.sim = simShim;
    simShim.onmessage = (ev) => {
      const m = ev.data;
      this.messages.push(m);
      if (m.t === 'frame') { this.latestFrame = m.result; this.frames++; for (const e of m.result.events) this.events.push(e); }
      if (m.t === 'gameover') this.gameover = m;
      if (m.t === 'error') this.errors.push(m);
    };
    globalThis.__createAIWorker = () => new WorkerShim(ai, 'ai');
    await simShim.initPromise;
    const worldgen = await import(pathToFileURL(world).href);
    const spec = worldgen.generateWorld(opts.map, { time: opts.time ?? 'day', weather: opts.weather ?? 'clear' });
    this.spec = spec;
    const manifest = JSON.parse(readFileSync(path.join(root, 'assets/manifest.json'), 'utf8'));
    const config = {
      mode: opts.mode, map: opts.map, bots: opts.bots ?? 31, difficulty: opts.difficulty ?? 'sergeant',
      time: opts.time ?? 'day', weather: opts.weather ?? 'clear', tickets: opts.tickets ?? 300, playerTeam: opts.playerTeam ?? 0,
      quality: { resolution: 1, shadows: 2, particles: 1, drawDistance: 1200, debris: 1, ssao: true, bloom: true, motionBlur: false, auto: true, fov: 75 }
    };
    await simShim.postMessage({ t: 'init', world: spec, manifest: manifest.byId, config });
    for (let i = 0; i < 1200 && !this.messages.some(m => m.t === 'ready'); i++) {
      if (this.errors.length) throw new Error('sim error during init: ' + this.errors[0].message + '\n' + (this.errors[0].stack ?? ''));
      await new Promise(r => setTimeout(r, 50));
    }
    if (!this.messages.some(m => m.t === 'ready')) throw new Error('sim did not become ready: ' + JSON.stringify(this.messages.slice(-3)).slice(0, 800));
    return this;
  }
  async intent(i) { await this.sim.postMessage({ t: 'intent', intent: i }); }
  async cmd(m) { await this.sim.postMessage(m); }
  async wait(frames, timeoutMs = 300000) {
    const target = this.frames + frames;
    const t0 = Date.now();
    while (this.frames < target) {
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout waiting frames ${this.frames}/${target}`);
      if (this.errors.length) throw new Error('sim error: ' + this.errors[0].message + '\n' + (this.errors[0].stack ?? ''));
      await new Promise(r => setTimeout(r, 5));
    }
    return this.latestFrame;
  }
  async dispose() { await this.sim?.postMessage({ t: 'dispose' }); }
}
