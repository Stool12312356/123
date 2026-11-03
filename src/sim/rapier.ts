import RAPIER from '@dimforge/rapier3d-compat';
export type RapierModule = typeof RAPIER;
let ready: Promise<RapierModule> | null = null;
export function initRapier(): Promise<RapierModule> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}
export { RAPIER };
export type RB = RAPIER.RigidBody;
export type Col = RAPIER.Collider;
