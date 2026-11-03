import type { AssetEntry, MatchConfig, PlayerIntent, BotIntent, StepResult, WorldSpec, GameEvent, Vec3 } from '../shared/types';

export type MainToSim =
  | { t: 'init'; world: WorldSpec; manifest: Record<string, AssetEntry>; config: MatchConfig }
  | { t: 'intent'; intent: PlayerIntent }
  | { t: 'ai'; intents: BotIntent[] }
  | { t: 'start' }
  | { t: 'pause'; paused: boolean }
  | { t: 'respawn'; point: number }
  | { t: 'selectClass'; cls: string }
  | { t: 'selectWeapon'; weapon: string }
  | { t: 'selectGadget'; index: number }
  | { t: 'command'; order: 'follow' | 'attack' | 'defend' | 'none'; pos?: Vec3; pointId?: string }
  | { t: 'armMcom'; id: number }
  | { t: 'setQuality'; cappedDebris: number }
  | { t: 'test'; op: 'explode' | 'stats' | 'spawnProbe' | 'forceTick' | 'collapse' | 'goto' | 'structures'; pos?: Vec3; radius?: number; id?: number }
  | { t: 'dispose' };

export type SimToMain =
  | { t: 'ready'; meshes: { id: number; asset: string; x: number; y: number; z: number }[]; spawnPoints: { name: string; x: number; z: number; team: number }[]; vehicles: { id: number; asset: string; x: number; z: number; team: number | null }[] }
  | { t: 'status'; phase: string; text: string }
  | { t: 'frame'; result: StepResult }
  | { t: 'error'; message: string; stack?: string }
  | { t: 'gameover'; winner: number | null; stats: { kills: number; deaths: number; score: number; captures: number; assists: number } }
  | { t: 'mcom'; list: { id: number; x: number; z: number; armed: boolean; progress: number; destroyed: boolean; sector: number }[] }
  | { t: 'waves'; wave: number; total: number }
  | { t: 'aiRequest'; obs: unknown };

export type AiToSim = { t: 'intents'; list: BotIntent[]; ms?: number; count?: number } | { t: 'error'; message: string };
