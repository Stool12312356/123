// Positional 3D audio built on Web Audio API (HRTF panner + generated impulse reverb).
// Every sound is procedurally synthesised - no external audio files required.
import type { Vec3, Settings } from '../shared/types';
import { clamp } from '../shared/mathx';

interface Voice { gain: GainNode; panner: PannerNode; oscs: OscillatorNode[]; started: number; end: number; bus: GainNode }

const SOUND_SPEED = 343;

export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  ambBus!: GainNode;
  musicBus!: GainNode;
  convolver!: ConvolverNode;
  noiseBuffer!: AudioBuffer;
  voices: Voice[] = [];
  listenerPos: Vec3 = [0, 0, 0];
  listenerFwd: Vec3 = [0, 0, -1];
  settings: Settings | null = null;
  started = false;
  ambientNodes: AudioScheduledSourceNode[] = [];
  ambientGain!: GainNode;
  dopplerEntries: { src: AudioBufferSourceNode; panner: PannerNode; end: number }[] = [];
  muted = false;
  tinnitus = 0;

  async init(settings: Settings) {
    if (this.ctx) return this;
    this.settings = settings;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = settings.volume;
    this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = settings.sfx;
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = settings.sfx * 0.55;
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = settings.music;
    this.sfxBus.connect(this.master);
    this.ambBus.connect(this.master);
    this.musicBus.connect(this.master);
    // algorithmic reverb from a noisy impulse - big panel blocks have long slap echo
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.makeImpulse(2.6, 2.4);
    const wet = ctx.createGain(); wet.gain.value = 0.32;
    this.convolver.connect(wet); wet.connect(this.sfxBus);
    this.noiseBuffer = this.makeNoise(2);
    if (ctx.listener.forwardX) {
      ctx.listener.forwardX.value = 0; ctx.listener.forwardY.value = 0; ctx.listener.forwardZ.value = -1;
      ctx.listener.upX.value = 0; ctx.listener.upY.value = 1; ctx.listener.upZ.value = 0;
    } else {
      (ctx.listener as any).setOrientation(0, 0, -1, 0, 1, 0);
    }
    await ctx.resume();
    this.started = true;
    this.startAmbience();
    return this;
  }

  makeNoise(seconds: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  makeImpulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const slap = Math.exp(-t * 9) * (i % Math.floor(ctx.sampleRate * 0.11) < 90 ? 0.8 : 0.2);
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (0.6 + slap * 0.6);
      }
    }
    return buf;
  }

  setSettings(s: Settings) {
    this.settings = s;
    if (!this.ctx) return;
    this.master.gain.value = s.volume;
    this.sfxBus.gain.value = s.sfx;
    this.ambBus.gain.value = s.sfx * 0.55;
    this.musicBus.gain.value = s.music;
  }

  resume() { this.ctx?.resume(); }
  suspend() { this.ctx?.suspend(); }

  setListener(pos: Vec3, fwd: Vec3, up: Vec3 = [0, 1, 0]) {
    this.listenerPos = pos; this.listenerFwd = fwd;
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos[0]; l.positionY.value = pos[1]; l.positionZ.value = pos[2];
      l.forwardX.value = fwd[0]; l.forwardY.value = fwd[1]; l.forwardZ.value = fwd[2];
      l.upX.value = up[0]; l.upY.value = up[1]; l.upZ.value = up[2];
    } else {
      l.setPosition(pos[0], pos[1], pos[2]);
      l.setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]);
    }
  }

  private panner(pos: Vec3, ref = 8, max = 900): PannerNode {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.maxDistance = max;
    p.rolloffFactor = 1.05;
    p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2];
    return p;
  }

  private track(v: Voice) { this.voices.push(v); if (this.voices.length > 120) this.voices.shift(); }

  gunshot(weapon: string, pos: Vec3, near = false) {
    const ctx = this.ctx; if (!ctx) return;
    const dist = Math.hypot(pos[0] - this.listenerPos[0], pos[1] - this.listenerPos[1], pos[2] - this.listenerPos[2]);
    const heavy = /pkm|svd|kpvt|t72|2a46/i.test(weapon);
    const now = ctx.currentTime + (near ? 0 : dist / SOUND_SPEED);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = heavy ? 0.7 : 1.4;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = heavy ? 620 : 1400; bp.Q.value = 0.9;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = heavy ? 2600 : 5200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(heavy ? 0.9 : 0.55, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + (heavy ? 0.36 : 0.19));
    const panner = this.panner(pos, 6);
    src.connect(bp); bp.connect(lp); lp.connect(g); g.connect(panner); panner.connect(this.sfxBus);
    if (dist < 40) { const wg = ctx.createGain(); wg.gain.value = 0.5; panner.connect(wg); wg.connect(this.convolver); }
    src.start(now); src.stop(now + 0.5);
    this.track({ gain: g, panner, oscs: [], started: now, end: now + 0.5, bus: this.sfxBus });
    // mechanical click for the shooter's own weapon
    if (near) this.click(0.6);
  }

  click(vol = 0.4) {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3200;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    src.connect(hp); hp.connect(g); g.connect(this.sfxBus);
    src.start(now); src.stop(now + 0.06);
  }

  explosion(pos: Vec3, kind = 'shell') {
    const ctx = this.ctx; if (!ctx) return;
    const dist = Math.hypot(pos[0] - this.listenerPos[0], pos[1] - this.listenerPos[1], pos[2] - this.listenerPos[2]);
    const now = ctx.currentTime + dist / SOUND_SPEED;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = 0.4;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2400, now); lp.frequency.exponentialRampToValueAtTime(120, now + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(1.0, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
    const panner = this.panner(pos, 22);
    src.connect(lp); lp.connect(g); g.connect(panner); panner.connect(this.sfxBus);
    const wet = ctx.createGain(); wet.gain.value = 0.7; panner.connect(wet); wet.connect(this.convolver);
    src.start(now); src.stop(now + 2.4);
    // sub-bass thump
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(70, now); osc.frequency.exponentialRampToValueAtTime(24, now + 0.9);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.9, now); og.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    osc.connect(og); og.connect(panner); osc.start(now); osc.stop(now + 1.05);
    this.track({ gain: g, panner, oscs: [osc], started: now, end: now + 2.4, bus: this.sfxBus });
    if (dist < 45) this.tinnitus = Math.max(this.tinnitus, clamp(1 - dist / 45, 0.2, 1));
    void kind;
  }

  collapseSound(pos: Vec3, size: number) {
    const ctx = this.ctx; if (!ctx) return;
    const dist = Math.hypot(pos[0] - this.listenerPos[0], pos[1] - this.listenerPos[1], pos[2] - this.listenerPos[2]);
    const now = ctx.currentTime + dist / SOUND_SPEED;
    for (let i = 0; i < 4; i++) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = 0.3 + i * 0.15;
      const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 500 + i * 300;
      const g = ctx.createGain();
      const start = now + i * 0.22;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.7 * (1 - i * 0.15), start + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 2.6 - i * 0.2);
      const panner = this.panner(pos, 30);
      src.connect(bp); bp.connect(g); g.connect(panner); panner.connect(this.sfxBus);
      const wet = ctx.createGain(); wet.gain.value = 0.8; panner.connect(wet); wet.connect(this.convolver);
      src.start(start); src.stop(start + 3);
    }
    void size;
  }

  /** persistent engine voice per vehicle (created once, updated with rpm/position) */
  engineVoice(id: number, pos: Vec3, rpm: number, kind: 'diesel' | 'turbine' | 'prop' | 'rotor', near = false) {
    const ctx = this.ctx; if (!ctx) return;
    let v = this.vehVoices.get(id);
    if (!v) {
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc.type = kind === 'turbine' || kind === 'rotor' ? 'sawtooth' : 'square';
      osc2.type = 'sawtooth';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 780;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      const panner = this.panner(pos, 16);
      osc.connect(lp); osc2.connect(lp); lp.connect(g); g.connect(panner); panner.connect(this.sfxBus);
      let wobble: OscillatorNode | null = null;
      if (kind === 'rotor') {
        wobble = ctx.createOscillator(); wobble.frequency.value = 16;
        const wg = ctx.createGain(); wg.gain.value = 0.35;
        wobble.connect(wg); wg.connect(g.gain);
        wobble.start();
      }
      osc.start(); osc2.start();
      v = { osc, osc2, gain: g, panner, lp, kind, wobble, targetGain: 0 };
      this.vehVoices.set(id, v);
    }
    const base = kind === 'diesel' ? 38 : kind === 'turbine' ? 96 : kind === 'rotor' ? 62 : 80;
    const f = base + Math.abs(rpm) * (kind === 'turbine' ? 620 : kind === 'rotor' ? 46 : 92);
    v.osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.12);
    v.osc2.frequency.setTargetAtTime(f * 1.51, ctx.currentTime, 0.16);
    v.lp.frequency.setTargetAtTime(near ? 1200 + Math.abs(rpm) * 400 : 700, ctx.currentTime, 0.2);
    v.targetGain = near ? 0.05 + Math.min(0.09, Math.abs(rpm) * 0.05) : 0.02;
    v.gain.gain.setTargetAtTime(v.targetGain, ctx.currentTime, 0.15);
    if (v.panner.positionX) {
      v.panner.positionX.setTargetAtTime(pos[0], ctx.currentTime, 0.08);
      v.panner.positionY.setTargetAtTime(pos[1], ctx.currentTime, 0.08);
      v.panner.positionZ.setTargetAtTime(pos[2], ctx.currentTime, 0.08);
    } else v.panner.setPosition(pos[0], pos[1], pos[2]);
  }
  vehVoices = new Map<number, { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; panner: PannerNode; lp: BiquadFilterNode; kind: string; wobble: OscillatorNode | null; targetGain: number }>();

  engine(pos: Vec3, rpm: number, kind: 'diesel' | 'turbine' | 'prop' | 'rotor') {
    const ctx = this.ctx; if (!ctx) return null;
    const now = ctx.currentTime;
    const base = kind === 'diesel' ? 46 : kind === 'turbine' ? 120 : 70;
    const osc = ctx.createOscillator(); osc.type = kind === 'turbine' ? 'sawtooth' : 'square';
    osc.frequency.value = base + rpm * (kind === 'turbine' ? 700 : 120);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    const panner = this.panner(pos, 14);
    osc.connect(lp); lp.connect(g); g.connect(panner); panner.connect(this.sfxBus);
    osc.start(now);
    const id = { osc, gain: g, panner, lp };
    this.engineVoices.push(id);
    return id;
  }
  engineVoices: { osc: OscillatorNode; gain: GainNode; panner: PannerNode; lp: BiquadFilterNode }[] = [];
  /** stops one-shot engine voices and silences persistent voices not in keep */
  stopEngines(keep?: Set<number>) {
    for (const e of this.engineVoices) { try { e.osc.stop(); } catch { /* already stopped */ } e.gain.disconnect(); e.panner.disconnect(); }
    this.engineVoices = [];
    if (!keep) {
      for (const [, v] of this.vehVoices) { v.gain.gain.setTargetAtTime(0.0001, this.ctx?.currentTime ?? 0, 0.08); try { v.osc.stop((this.ctx?.currentTime ?? 0) + 0.4); v.osc2.stop((this.ctx?.currentTime ?? 0) + 0.4); v.wobble?.stop(); } catch { /* ignore */ } }
      this.vehVoices.clear();
      return;
    }
    for (const [id, v] of this.vehVoices) if (!keep.has(id)) { v.gain.gain.setTargetAtTime(0.0001, this.ctx?.currentTime ?? 0, 0.1); try { v.osc.stop((this.ctx?.currentTime ?? 0) + 0.4); v.osc2.stop((this.ctx?.currentTime ?? 0) + 0.4); v.wobble?.stop(); } catch { /* ignore */ } this.vehVoices.delete(id); }
  }

  /** bullet impact on material: short filtered noise burst */
  impact(pos: Vec3, material = 'concrete') {
    const ctx = this.ctx; if (!ctx) return;
    const dist = Math.hypot(pos[0] - this.listenerPos[0], pos[1] - this.listenerPos[1], pos[2] - this.listenerPos[2]);
    if (dist > 70) return;
    const now = ctx.currentTime + dist / SOUND_SPEED;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = material === 'metal' ? 1.9 : 1.1;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = material === 'metal' ? 3200 : material === 'wood' ? 900 : material === 'water' ? 480 : 1700; bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.22 * clamp(1 - dist / 70, 0.1, 1), now); g.gain.exponentialRampToValueAtTime(0.0001, now + (material === 'metal' ? 0.22 : 0.1));
    const panner = this.panner(pos, 4);
    src.connect(bp); bp.connect(g); g.connect(panner); panner.connect(this.sfxBus);
    src.start(now); src.stop(now + 0.24);
  }

  /** synthesized squad voice line (radio chatter) */
  voice(kind: 'move' | 'contact' | 'grenade' | 'reload' | 'death', pos: Vec3) {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime + Math.min(0.35, Math.hypot(pos[0] - this.listenerPos[0], pos[2] - this.listenerPos[2]) / SOUND_SPEED);
    const base = kind === 'death' ? 96 : kind === 'contact' ? 150 : 128;
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.setValueAtTime(base, now);
    osc.frequency.linearRampToValueAtTime(base * (0.8 + Math.random() * 0.4), now + 0.3);
    const form = ctx.createBiquadFilter(); form.type = 'bandpass'; form.frequency.value = 720; form.Q.value = 5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, now); g.gain.linearRampToValueAtTime(0.12, now + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    const panner = this.panner(pos, 8);
    osc.connect(form); form.connect(g); g.connect(panner); panner.connect(this.sfxBus);
    osc.start(now); osc.stop(now + 0.45);
  }

  step(pos: Vec3, water = false) {
    const ctx = this.ctx; if (!ctx) return;
    const dist = Math.hypot(pos[0] - this.listenerPos[0], pos[2] - this.listenerPos[2]);
    if (dist > 40) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = water ? 0.6 : 1.8;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = water ? 600 : 700 + Math.random() * 300; bp.Q.value = 1.4;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.22, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    const panner = this.panner(pos, 3);
    src.connect(bp); bp.connect(g); g.connect(panner); panner.connect(this.sfxBus);
    src.start(now); src.stop(now + 0.14);
  }

  ui(kind: 'click' | 'hit' | 'kill' | 'capture' | 'deny' | 'levelup') {
    const ctx = this.ctx; if (!ctx) return;
    const now = ctx.currentTime;
    const freqs = { click: [880], hit: [1400], kill: [520, 780], capture: [440, 660, 880], deny: [180], levelup: [523, 659, 784, 1046] }[kind];
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = f;
      const g = ctx.createGain();
      const t = now + i * 0.07;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(g); g.connect(this.musicBus); osc.start(t); osc.stop(t + 0.24);
    });
  }

  startAmbience() {
    const ctx = this.ctx; if (!ctx) return;
    this.ambientGain = ctx.createGain(); this.ambientGain.gain.value = 0.16; this.ambientGain.connect(this.ambBus);
    // wind bed
    const wind = ctx.createBufferSource(); wind.buffer = this.noiseBuffer; wind.loop = true; wind.playbackRate.value = 0.12;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    wind.connect(lp); lp.connect(this.ambientGain); wind.start();
    // birds (далеко грачи) and factory hum
    this.scheduleAmbient();
    this.ambientNodes.push(wind);
  }

  private scheduleAmbient() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // distant factory horn every ~40s
    const horn = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 138;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.4);
      g.gain.setValueAtTime(0.11, t + 1.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 640;
      osc.connect(lp); lp.connect(g); g.connect(this.ambientGain); osc.start(t); osc.stop(t + 2.7);
      const wet = ctx.createGain(); wet.gain.value = 0.4; g.connect(wet); wet.connect(this.convolver);
      setTimeout(horn, 38000 + Math.random() * 25000);
    };
    setTimeout(horn, 6000);
    // radio announcement bursts (громкоговоритель)
    const radio = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer; src.playbackRate.value = 0.5;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.08, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      src.connect(bp); bp.connect(g); g.connect(this.ambientGain);
      src.start(t); src.stop(t + 1.7);
      setTimeout(radio, 22000 + Math.random() * 20000);
    };
    setTimeout(radio, 4000);
    void now;
  }

  /** applies ringing after nearby blasts, decaying naturally */
  update(dt: number) {
    if (!this.ctx) return;
    if (this.tinnitus > 0) {
      this.tinnitus = Math.max(0, this.tinnitus - dt * 0.35);
      const t = this.ctx.currentTime;
      this.master.gain.setTargetAtTime((this.settings?.volume ?? 1) * (1 - this.tinnitus * 0.55), t, 0.1);
    }
    // clean up finished voices (prevents node leaks on long matches)
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter(v => {
      if (v.end + 0.2 < now) { try { v.gain.disconnect(); v.panner.disconnect(); } catch { /* noop */ } return false; }
      return true;
    });
  }

  dispose() {
    this.stopEngines();
    for (const n of this.ambientNodes) { try { n.stop(); } catch { /* noop */ } }
    this.ambientNodes = [];
    for (const v of this.voices) { try { v.gain.disconnect(); v.panner.disconnect(); } catch { /* noop */ } }
    this.voices = [];
    this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}
