// Headless boot smoke test: constructs the real RenderCore (WebGL stubbed), builds the menu
// backdrop terrain and renders frames. This is what catches "Cannot read properties of
// undefined (reading 'sunPos')" — palette/sky must be valid before the first match starts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><canvas id="c"></canvas></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window as unknown as Window & typeof globalThis;
  for (const key of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'HTMLDivElement', 'Event', 'MouseEvent', 'self']) (globalThis as any)[key] = (w as any)[key];
  try { Object.defineProperty(globalThis, 'navigator', { value: w.navigator, configurable: true }); } catch { /* read-only in node */ }
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
  (globalThis as any).devicePixelRatio = 1;
  (w.HTMLCanvasElement.prototype as any).getContext = () => null;   // let WebGL fail loudly but not fatally
  return w;
}

/** A minimal WebGL2 context: enough surface for three.js to initialise without a GPU. */
const GL_CONST: Record<string, number> = {
  VERSION: 0x1F02, SHADING_LANGUAGE_VERSION: 0x8B8C, VENDOR: 0x1F00, RENDERER: 0x1F01,
  MAX_TEXTURE_SIZE: 0x0D33, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C, MAX_TEXTURE_IMAGE_UNITS: 0x8872,
  MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D,
  MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB, MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD,
  MAX_VARYING_VECTORS: 0x8DFC, MAX_VERTEX_ATTRIBS: 0x8869, MAX_SAMPLES: 0x8D57,
  MAX_ATTRIBUTES: 16, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF, MAX_ARRAY_TEXTURE_LAYERS: 0x88FF,
  MAX_3D_TEXTURE_SIZE: 0x8073, FRAMEBUFFER_COMPLETE: 0x8CD5, HIGH_FLOAT: 0x8DF2, MEDIUM_FLOAT: 0x8DF1
};

function fakeWebGL2() {
  const ext = { EXT_texture_filter_anisotropic: true };
  const handler: ProxyHandler<any> = {
    get(target, prop) {
      if (prop in target) return (target as any)[prop];
      const name = String(prop);
      if (name === 'getExtension') return (n: string) => (String(n).toLowerCase().includes('texture_filter_anisotropic') ? { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 1 } : null);
      if (name === 'getParameter') return (n: number) => {
        // three.js asks for VERSION (0x1F02) and SHADING_LANGUAGE_VERSION / VENDOR / RENDERER strings
        if (n === 0x1F02) return 'WebGL 2.0 (stub)';
        if (n === 0x8B8C || n === 0x1F00 || n === 0x1F01) return 'stub';
        if (n === 0x0D33 || n === 0x8872 || n === 0x84E8) return 16384;   // max texture size / units
        if (n === 0x8DFB || n === 0x8DFC) return 1024;                    // max samples / vertex outputs
        if (n === 0x8B4D) return 16;                                     // MAX_VERTEX_UNIFORM_VECTORS
        return 4096;
      };
      if (name === 'getInternalformatParameter') return () => new Int32Array([4]);
      if (name === 'checkFramebufferStatus') return () => 0x8CD5;
      if (name === 'getShaderPrecisionFormat') return () => ({ precision: 23, rangeMin: 127, rangeMax: 127 });
      if (name === 'getSupportedExtensions') return () => Object.keys(ext);
      if (name === 'createTexture' || name === 'createBuffer' || name === 'createFramebuffer') return () => ({});
      if (name === 'getProgramParameter') return (_p: unknown, n: number) => {
        if (n === 0x8B86 || n === 0x8B89) return 0;          // ACTIVE_ATTRIBUTES / ACTIVE_UNIFORMS
        if (n === 0x8B82 || n === 0x8B80) return true;        // LINK_STATUS / COMPILE_STATUS
        return 0;
      };
      if (name === 'getActiveUniform') return () => null;
      if (name === 'getActiveAttrib') return () => null;
      if (name === 'getAttachedShaders') return () => [];
      if (name === 'getShaderParameter') return () => true;
      if (name === 'getUniformLocation') return () => ({});
      if (name === 'getAttribLocation') return () => 0;
      if (name === 'getContextAttributes') return () => ({ alpha: true, antialias: true });
      if (name === 'getError') return () => 0;
      if (name in GL_CONST) return GL_CONST[name];
      if (/^[A-Z0-9_]+$/.test(name)) return 1;
      return () => undefined;
    },
    set() { return true; }
  };
  return new Proxy({}, handler);
}

describe('boot', () => {
  beforeEach(() => { installDom(); vi.resetModules(); });

  it('initialises the renderer and survives menu frames before a match exists', async () => {
    const { RenderCore, skyPalette } = await import('../src/render/core');
    const { generateWorld } = await import('../src/shared/worldgen');
    // the palette must exist straight after construction — the menu loop uses it on frame 1
    expect(skyPalette('day', 'clear').sunPos).toBeDefined();
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    (canvas as any).getContext = () => fakeWebGL2();
    const core = new RenderCore(canvas, { resolution: 1, shadows: 0, particles: 0, drawDistance: 900, debris: 0, ssao: false, bloom: false, motionBlur: false, auto: false, fov: 75 });
    // regression: the palette used to be assigned only in applyTimeOfDay(), so the very first
    // menu frame threw "Cannot read properties of undefined (reading 'sunPos')"
    expect(core.palette).toBeTruthy();
    expect(core.palette.sunPos).toBeInstanceOf(Object);
    core.camera.position.set(0, 100, 0);
    expect(() => core.render(0.016, core.camera)).not.toThrow();
    expect(() => core.applyTimeOfDay('night', 'snow')).not.toThrow();
    expect(core.palette.sunPos.y).toBeGreaterThanOrEqual(0);
    expect(() => core.render(0.016, core.camera)).not.toThrow();
    // a match start rebuilds the terrain twice in a row without leaking / throwing
    const spec = generateWorld('sleepy', { time: 'day', weather: 'clear' });
    expect(() => core.buildTerrain(spec)).not.toThrow();
    expect(() => core.buildTerrain(spec)).not.toThrow();
    expect(() => core.addCrater({ x: 5, z: 5, r: 4, depth: 1.2 }, spec)).not.toThrow();
    expect(() => core.render(0.016, core.camera)).not.toThrow();
  });
});
