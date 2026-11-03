// Shared data contracts used by the sim worker, AI worker and renderer.
export type Vec3 = [number, number, number];
export type Team = 0 | 1;
export type Difficulty = 'private' | 'sergeant' | 'veteran';
export type ModeId = 'conquest' | 'rush' | 'holdout' | 'campaign' | 'range';
export type MapId = 'sleepy' | 'factory' | 'suburb' | 'harbor';
export type ClassId = 'assault' | 'engineer' | 'support' | 'recon';
export type Weather = 'clear' | 'rain' | 'fog' | 'snow';
export type DayTime = 'dawn' | 'day' | 'dusk' | 'night';

export interface PartBox { c: Vec3; s: Vec3; ry: number }
export interface AssetEntry {
  id: string; category: string; item: string; kind: string | null;
  source: 'source' | 'procedural'; placeholder: boolean; procedural: boolean;
  sourceModel: string | null; glb: string; scale: number; pivot: Vec3; dims: Vec3;
  materials: string[]; textures: string[]; lod: { level: number; distance: number; glb: string }[];
  collider: string; checksum: string; bytes: number; triangles: number; parts: string[];
  stats: Record<string, number | string | null>; building: { height: number; sections: number } | null;
  wheels: [number, number][] | null; wheelRadius: number | null; seats: number | null;
  turretPivot: Vec3 | null; rotorPivot: Vec3 | null; tailRotorPivot: Vec3 | null;
  amphibious: boolean; rail: boolean;
}
export interface Manifest { version: number; generatedAt: string; sourceFolder: string; assets: AssetEntry[]; byId: Record<string, AssetEntry>; counts: Record<string, number>; errors: { id: string; message: string }[] }

export interface StructureSpec { id: number; asset: string; x: number; z: number; ry: number; y?: number }
export interface PropSpec { id: number; asset: string; x: number; z: number; ry: number; dynamic: boolean; y?: number }
export interface VehicleSpawn { id: number; asset: string; x: number; z: number; ry: number; team: Team | null }
export interface CapturePoint { id: string; name: string; x: number; z: number; radius: number; owner: Team | null; initial: Team | null }
export interface WaterSpec { level: number; cx: number; cz: number; rx: number; rz: number; rotation: number }
export interface WorldSpec {
  mapId: MapId; name: string; size: number; res: number; heights: number[];
  structures: StructureSpec[]; props: PropSpec[]; vehicles: VehicleSpawn[];
  points: CapturePoint[]; teamSpawns: Record<'0' | '1', { x: number; z: number }[]>;
  water: WaterSpec | null; roads: { x: number; z: number; r: number }[][];
  urban: { x: number; z: number; r: number }[];
  seed: number; time: DayTime; weather: Weather;
}
export interface WeaponConfig {
  id: string; name: string; class: ClassId[]; caliber: string; muzzle: number; rpm: number;
  magazine: number; damage: number; spread: number; recoil: number; reload: number;
  explosive?: number; pellets?: number; automatic: boolean; zoom?: number; gadget?: boolean;
  projectile?: 'bullet' | 'rocket' | 'grenade' | 'mortar' | 'c4' | 'mine' | 'repair' | 'medkit' | 'ammo';
  gravity?: number; drag?: number; penetration?: number; frags?: number;
}
export interface VehicleConfig {
  id: string; name: string; mass: number; hp: number; maxSpeed: number; accel: number; drive: 'wheel' | 'track' | 'rail' | 'air' | 'boat';
  armor: number; seats: number; weapon?: string; muzzle?: number; rpm?: number; damage?: number; explosive?: number; amphibious?: boolean;
}
export interface ClassConfig { id: ClassId; name: string; weapons: string[]; gadgets: string[]; role: string }
export interface ModeConfig { id: ModeId; name: string; description: string; tickets: number; points: number; bots: number }

export interface EntitySnapshot {
  id: number; kind: 'player' | 'bot' | 'vehicle' | 'debris' | 'projectile' | 'gadget' | 'pickup';
  asset: string; team: Team; pos: Vec3; quat: [number, number, number, number];
  hp: number; maxHp: number; alive: boolean; crouch?: number; stance?: number;
  turretYaw?: number; wheelSpin?: number; speed?: number; rotor?: number; seat?: number;
  driver?: number; destroyed?: boolean; burning?: boolean; name?: string; cls?: ClassId;
  aim?: Vec3; reloading?: number; ammo?: number; magazine?: number; spotted?: boolean;
  vehicle?: number; status?: string; boost?: number;
}
export interface PlayerStateSnapshot {
  hp: number; maxHp: number; stamina: number; oxygen: number; ammo: number; magazine: number;
  reserve: number; reloading: number; weapon: string; gadgets: { id: string; charges: number }[]; seat: number;
  vehicle: number | null; vehicleHp: number; vehicleMax: number; killedBy: string | null; alive: boolean;
  stance: number; sprint: boolean; underWater: boolean; score: number; kills: number; deaths: number;
  assists: number; capture: number; vehWeaponReady: boolean; spg?: boolean; breath?: number;
  ads: boolean; cls: ClassId; speed: number;
  xp?: number; matchTime?: number; wave?: number; waves?: number; objective?: string;
}
export type GameEvent =
  | { e: 'shot'; pos: Vec3; dir: Vec3; weapon: string; owner: number }
  | { e: 'impact'; pos: Vec3; normal: Vec3; material: string; weapon: string }
  | { e: 'explosion'; pos: Vec3; radius: number; kind: string; water: boolean }
  | { e: 'hit'; target: number; damage: number; head: boolean; owner: number; pos: Vec3 }
  | { e: 'kill'; victim: number; killer: number; weapon: string; head: boolean; victimName: string; killerName: string }
  | { e: 'destroy'; piece: number; pos: Vec3; kind: string; fragment: string | null; size: number }
  | { e: 'collapse'; section: string; pos: Vec3; size: number; building: number }
  | { e: 'reload'; state: number; weapon: string }
  | { e: 'vehicleEnter'; vehicle: number; seat: number }
  | { e: 'vehicleExit'; vehicle: number }
  | { e: 'vehicleDestroyed'; vehicle: number; pos: Vec3 }
  | { e: 'order'; order: string; target: Vec3 }
  | { e: 'point'; id: string; team: Team | null; progress: number }
  | { e: 'notice'; text: string }
  | { e: 'sound'; pos: Vec3; kind: string; volume: number }
  | { e: 'craters'; craters: { x: number; z: number; r: number; depth: number }[] }
  | { e: 'spawnCrater'; pos: Vec3; radius: number }
  | { e: 'mcom'; id: number; armed: boolean; progress: number; destroyed: boolean };

export interface StepResult {
  t: 'frame'; tick: number; time: number; snapshot: Snapshot; events: GameEvent[];
}
export interface Snapshot {
  entities: EntitySnapshot[]; player: PlayerStateSnapshot; tick: number; time: number;
  tickets: [number, number]; points: { id: string; owner: Team | null; progress: number; contested: number }[];
  ai: AiObservation[];
  projectiles: { id: number; pos: Vec3; vel: Vec3; kind: string }[];
  meshUpdates: { id: number; vis: number[]; hidden: boolean }[];
  props: { id: number; pos: Vec3; quat: [number, number, number, number] }[];
  targets?: { x: number; y: number; z: number; kind: 'target' | 'barrel'; hit: boolean }[];
  craters: { x: number; z: number; r: number; depth: number }[];
  mcoms: { id: number; x: number; z: number; armed: boolean; progress: number; destroyed: boolean; sector: number }[];
  vehicles: { id: number; asset: string; pos: Vec3; quat: [number, number, number, number]; turretYaw: number; speed: number; rotor: number; destroyed: boolean; hp: number; max: number }[];
  profiles: Record<string, number>;
}
export interface AiObservation {
  id: number; team: Team; pos: Vec3; hp: number; alive: boolean; vehicle: number | null;
  visibleEnemies: { id: number; pos: Vec3; dist: number }[]; target: number | null;
  suppressed: number; lastDamage: number; cls: ClassId; ammoRatio: number; objective: string; yaw: number;
}
export interface PlayerIntent {
  move: [number, number]; yaw: number; pitch: number; fire: boolean; ads: boolean; sprint: boolean;
  jump: boolean; crouch: boolean; prone: boolean; reload: boolean; interact: boolean;
  gadget: boolean; melee: boolean; order?: 'follow' | 'attack' | 'defend' | 'none'; orderTarget?: Vec3;
  ping?: Vec3; voice?: boolean;
}
export interface BotIntent {
  id: number; move: [number, number]; speed: number; yaw: number; pitch: number; fire: boolean;
  reload: boolean; crouch: boolean; stance: number; enterVehicle?: number | null; exitVehicle?: boolean;
  gadget?: boolean; target?: number | null; vehicleThrottle?: number; vehicleSteer?: number;
  turretYaw?: number; turretPitch?: number; jump?: boolean; repair?: boolean; revive?: boolean;
  order?: string; aimPoint?: Vec3;
}
export interface MatchConfig {
  mode: ModeId; map: MapId; bots: number; difficulty: Difficulty; time: DayTime; weather: Weather;
  tickets: number; playerTeam: Team; mission?: number; quality: QualitySettings;
}
export interface QualitySettings {
  resolution: number; shadows: number; particles: number; drawDistance: number; debris: number;
  ssao: boolean; bloom: boolean; motionBlur: boolean; auto: boolean; fov: number;
}
export interface Settings {
  quality: QualitySettings; sensitivity: number; invertY: boolean; fov: number; volume: number;
  music: number; sfx: number; hudScale: number; crosshair: boolean;
}
