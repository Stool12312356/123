// Minimal synthesised score: layered pad + marching snare. Fully offline.
export class Music {
  ctx: AudioContext | null = null;
  gain: GainNode | null = null;
  nodes: AudioScheduledSourceNode[] = [];
  interval: ReturnType<typeof setInterval> | null = null;
  intensity = 0.3;
  constructor(private dest?: AudioNode) {}
  start(ctx: AudioContext, dest: AudioNode) {
    if (this.ctx) return;
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0.06;
    this.gain.connect(dest);
    this.playPad();
    this.interval = setInterval(() => this.pulse(), 1200);
  }
  private note(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.2) {
    const ctx = this.ctx!; if (!ctx || !this.gain) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    osc.connect(lp); lp.connect(g); g.connect(this.gain);
    osc.start(t); osc.stop(t + dur + 0.05);
    this.nodes.push(osc);
    if (this.nodes.length > 80) this.nodes.splice(0, 40);
  }
  private playPad() {
    const chords = [[55, 82.4, 110], [49, 73.4, 98], [43.6, 65.4, 87.3], [55, 82.4, 130.8]];
    let i = 0;
    const step = () => {
      if (!this.ctx) return;
      const [a, b, c] = chords[i % chords.length];
      this.note(a, 3.6, 'triangle', 0.28 * this.intensity + 0.1);
      this.note(b, 3.2, 'sine', 0.18 * this.intensity + 0.06);
      this.note(c, 2.8, 'sine', 0.12 * this.intensity + 0.04);
      i++;
      setTimeout(step, 3400);
    };
    step();
  }
  private pulse() {
    if (!this.ctx || !this.gain) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.15), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400;
    const g = ctx.createGain(); g.gain.value = 0.2 * this.intensity;
    src.connect(bp); bp.connect(g); g.connect(this.gain);
    src.start(t);
  }
  setIntensity(v: number) {
    this.intensity = Math.max(0, Math.min(1, v));
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(0.04 + this.intensity * 0.06, this.ctx.currentTime, 0.4);
  }
  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    for (const n of this.nodes) { try { n.stop(); } catch { /* noop */ } }
    this.nodes = [];
    this.gain?.disconnect();
    this.gain = null;
    this.ctx = null;
  }
}
