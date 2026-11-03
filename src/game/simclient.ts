import type { AssetEntry, GameEvent, MatchConfig, Snapshot, WorldSpec, Vec3 } from '../shared/types';
import type { MainToSim, SimToMain } from '../sim/protocol';

export class SimClient {
  worker: Worker | null = null;
  onFrame: ((snap: Snapshot, events: GameEvent[]) => void) | null = null;
  onGameOver: ((winner: number | null, stats: { kills: number; deaths: number; score: number; captures: number; assists: number }) => void) | null = null;
  onStatus: ((phase: string, text: string) => void) | null = null;
  onReady: ((meshes: { id: number; asset: string; x: number; y: number; z: number }[]) => void) | null = null;
  onMcom: ((list: { id: number; x: number; z: number; armed: boolean; progress: number; destroyed: boolean; sector: number }[]) => void) | null = null;
  onWaves: ((wave: number, total: number) => void) | null = null;
  onError: ((message: string) => void) | null = null;
  lastFrameAt = 0;

  async start(world: WorldSpec, manifest: Record<string, AssetEntry>, config: MatchConfig) {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<SimToMain>) => {
      const m = ev.data;
      switch (m.t) {
        case 'frame':
          this.lastFrameAt = performance.now();
          this.onFrame?.(m.result.snapshot, m.result.events);
          break;
        case 'gameover': this.onGameOver?.(m.winner, m.stats); break;
        case 'status': this.onStatus?.(m.phase, m.text); break;
        case 'ready': this.onReady?.(m.meshes); break;
        case 'mcom': this.onMcom?.(m.list); break;
        case 'waves': this.onWaves?.(m.wave, m.total); break;
        case 'error': console.error('[sim]', m.message, m.stack); this.onError?.(m.message); break;
      }
    };
    this.worker.onerror = (e) => { console.error('[sim worker]', e.message); this.onError?.(e.message); };
    this.send({ t: 'init', world, manifest, config });
  }

  send(msg: MainToSim) {
    this.worker?.postMessage(msg);
  }

  dispose() {
    if (!this.worker) return;
    try { this.worker.postMessage({ t: 'dispose' } satisfies MainToSim); } catch { /* already gone */ }
    this.worker.terminate();
    this.worker = null;
    this.onFrame = null;
  }
}

export type { Vec3 };
