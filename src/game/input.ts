import type { Settings } from '../shared/types';

export class Input {
  keys = new Set<string>();
  pressed = new Set<string>();
  mouseButtons: Record<number, boolean> = {};
  mouseDelta: [number, number] = [0, 0];
  wheel = 0;
  locked = false;
  /** true once the pointer has been locked at least once this session */
  lockedOnce = false;
  settings: Settings;
  private canvas: HTMLCanvasElement;
  private onKeyDown = (e: KeyboardEvent) => {
    if (['Tab', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft'].includes(e.code)) e.preventDefault();
    if (!this.keys.has(e.code)) this.pressed.add(e.code);
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.mouseDelta[0] += e.movementX;
    this.mouseDelta[1] += e.movementY;
  };
  private onMouseDown = (e: MouseEvent) => { this.mouseButtons[e.button] = true; this.pressed.add(`Mouse${e.button}`); };
  private onMouseUp = (e: MouseEvent) => { this.mouseButtons[e.button] = false; };
  private onWheel = (e: WheelEvent) => { this.wheel += Math.sign(e.deltaY); };
  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.canvas;
    if (this.locked) { this.mouseDelta = [0, 0]; this.lockedOnce = true; }
  };
  private onBlur = () => { this.keys.clear(); this.mouseButtons = {}; };
  private onContext = (e: Event) => e.preventDefault();

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.canvas = canvas;
    this.settings = settings;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('contextmenu', this.onContext);
  }

  requestLock(lock: boolean) {
    if (lock && document.pointerLockElement !== this.canvas) {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true } as any) as unknown;
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => this.canvas.requestPointerLock?.());
    } else if (!lock && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  isDown(code: string) { return this.keys.has(code); }
  consumePress(code: string) {
    const has = this.pressed.has(code);
    if (has) this.pressed.delete(code);
    return has;
  }
  endFrame() { this.pressed.clear(); this.mouseDelta = [0, 0]; this.wheel = 0; }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    window.removeEventListener('blur', this.onBlur);
    this.requestLock(false);
  }
}
