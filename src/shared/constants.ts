export const FIXED_DT = 1 / 60;
export const SNAPSHOT_HZ = 20;
export const GROUP = {
  TERRAIN: 0x0001, BUILDING: 0x0002, PROP: 0x0004, CHARACTER: 0x0008, VEHICLE: 0x0010,
  DEBRIS: 0x0020, PROJECTILE: 0x0040, WATER: 0x0080
};
export const BULLET_GRAVITY = 9.81;
export const SOUND_SPEED = 343;
export const PLAYER_HEIGHT = 1.8;
export const STANCE = { stand: 1, crouch: 0.62, prone: 0.32 } as const;
export const SPEED = { walk: 5, run: 8, sprint: 8.4, crouch: 2.6, prone: 1.1, ads: 3.4 } as const;
export const MAX_DEBRIS = 1200;
export const MAX_PROJECTILES = 700;
export const MAX_BODIES = 2200;
export const GRAVITY = -9.81;
export const TERRAIN_RES_DEFAULT = 160;
export const RESERVED_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ControlLeft', 'KeyR', 'KeyF', 'KeyG', 'KeyE', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'KeyQ', 'KeyZ', 'KeyX', 'KeyC', 'Escape', 'Tab'];
export const MATERIALS: Record<string, { density: number; friction: number; restitution: number; strength: number; pen: number; sound: string }> = {
  concrete: { density: 2400, friction: 0.9, restitution: 0.05, strength: 3.2, pen: 0.12, sound: 'concrete' },
  brick: { density: 1800, friction: 0.85, restitution: 0.04, strength: 2.6, pen: 0.15, sound: 'brick' },
  steel: { density: 7850, friction: 0.55, restitution: 0.3, strength: 6, pen: 0.05, sound: 'metal' },
  wood: { density: 650, friction: 0.7, restitution: 0.2, strength: 1.2, pen: 0.6, sound: 'wood' },
  glass: { density: 2500, friction: 0.3, restitution: 0.1, strength: 0.3, pen: 0.9, sound: 'glass' },
  dirt: { density: 1500, friction: 0.95, restitution: 0.02, strength: 2, pen: 0.8, sound: 'dirt' },
  rubber: { density: 1100, friction: 1.1, restitution: 0.55, strength: 0.6, pen: 0.9, sound: 'rubber' },
  sand: { density: 1600, friction: 0.9, restitution: 0.03, strength: 0.8, pen: 0.7, sound: 'sand' },
  armor: { density: 7850, friction: 0.5, restitution: 0.15, strength: 12, pen: 0.02, sound: 'armor' },
  flesh: { density: 1000, friction: 0.8, restitution: 0.05, strength: 0.6, pen: 1, sound: 'flesh' }
};
export function materialOf(asset: string): string {
  if (/tree|wood|shed|pier|fence|bench|piano|crate|clothesline/i.test(asset)) return 'wood';
  if (/bucket|barrel|fuel|rail|locomotive|crane|container/i.test(asset)) return 'steel';
  if (/glass|window|kiosk|busstop/i.test(asset)) return 'glass';
  if (/v_|i_missile|i_radar/i.test(asset)) return 'armor';
  if (/khrush|brezh|school|dorm|dk|cum|kinoteatr|bolnica|garage|warehouse|shopfloor|kpp|barracks|silo|tower|bridge|block|sandbags/i.test(asset)) return 'concrete';
  return 'concrete';
}
