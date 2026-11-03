// Buildings and props. Buildings expose destructible part naming conventions used by the
// runtime: `wall_*` (fragmented), `col_*` (load-bearing), `slab_*` (floors), `roof`, `stair`.
import { Builder, addBox, addCylinder, addSphere, addWedge, COLORS as C } from './glb.js';

const part = (name, material = 'main') => ({ name, material, builder: new Builder() });
const mk = (name, fn, material = 'main') => { const p = part(name, material); fn(p.builder); return p; };

const WALL_T = 0.28;

function panelWindow(b, x, y, z, ry = 0, w = 1.5, h = 1.5, balcony = false) {
  addBox(b, x, y, z, w, h, 0.06, C.window, ry);
  addBox(b, x, y, z - 0.03, w + 0.16, 0.07, 0.08, C.concrete2, ry);
  addBox(b, x, y, z - 0.03, w + 0.16, 0.07, 0.08, C.concrete2, ry);
  addBox(b, x, y + h / 2 + 0.03, z - 0.03, w + 0.2, 0.08, 0.08, C.concrete2, ry);
  addBox(b, x, y - h / 2 - 0.03, z - 0.03, w + 0.2, 0.08, 0.08, C.concrete2, ry);
  addBox(b, x, y, z - 0.025, 0.05, h, 0.05, C.cream, ry);
  if (balcony) {
    addBox(b, x, y - h / 2 - 0.12, z - 0.55, w + 0.9, 0.12, 1.3, C.concrete, ry);
    addBox(b, x, y - h / 2 + 0.35, z - 1.15, w + 0.9, 0.85, 0.06, C.darkgreen, ry);
    addBox(b, x - (w + 0.9) / 2, y - h / 2 + 0.35, z - 0.55, 0.06, 0.85, 1.3, C.darkgreen, ry);
    addBox(b, x + (w + 0.9) / 2, y - h / 2 + 0.35, z - 0.55, 0.06, 0.85, 1.3, C.darkgreen, ry);
  }
}

function panelHouse({ id, floors, sections, width = 12, depth = 11, color = C.concrete2, balcony = true, roof = 'flat' }) {
  const fh = 2.9;
  const height = floors * fh;
  const parts = [];
  const totalW = width * sections;
  const panelW = width / 2;
  for (let s = 0; s < sections; s++) {
    const x0 = -totalW / 2 + s * width + width / 2;
    for (let f = 0; f < floors; f++) {
      const y = f * fh + fh / 2;
      // long side walls: 2 panels per side -> breachable openings
      for (const [side, pz, frame] of [['l', -depth / 2, -1], ['r', depth / 2, 1]]) {
        for (let p = 0; p < 2; p++) {
          const px = x0 - width / 4 + p * panelW;
          const hasBalcony = balcony && side === 'l' && f > 0 && f % 2 === 1 && p === 0;
          parts.push(mk(`wall_s${s}_f${f}_${side}${p}`, b => {
            const wy = hasBalcony ? y + 0.5 : y + 0.15;
            const ww = hasBalcony ? 1.6 : 1.7, wh = hasBalcony ? 1.2 : 1.4;
            const ex = hasBalcony ? 1.1 : 0;
            addBox(b, px - panelW / 2, y, pz, 0.55, fh, WALL_T, color);
            addBox(b, px + panelW / 2, y, pz, 0.55, fh, WALL_T, color);
            addBox(b, px, y + fh / 2 - 0.22, pz, panelW - 1.1, 0.44, WALL_T, color);
            addBox(b, px, y - fh / 2 + 0.45, pz, panelW - 1.1, 0.9, WALL_T, color);
            addBox(b, px - panelW / 2 + 0.9, wy, pz, 1.8, wh, WALL_T * 0.9, color);
            addBox(b, px + panelW / 2 - 0.9 - ex, wy, pz, 1.8 - ex, wh, WALL_T * 0.9, color);
            addBox(b, px, wy, pz, ww, wh, 0.06, C.window);
            addBox(b, px, wy - wh / 2 - 0.06, pz - frame * 0.03, ww + 0.2, 0.1, 0.12, C.concrete2);
            addBox(b, px, wy + wh / 2 + 0.06, pz - frame * 0.03, ww + 0.2, 0.1, 0.12, C.concrete2);
            addBox(b, px, wy, pz - frame * 0.035, 0.05, wh, 0.05, C.cream);
            if (balcony && side === 'l' && f > 0 && f % 3 === 1 && p === 1) {
              addBox(b, px, y - fh / 2 - 0.12, pz - 0.6, panelW - 1.4, 0.14, 1.4, C.concrete);
              addBox(b, px, y - fh / 2 + 0.4, pz - 1.24, panelW - 1.4, 0.9, 0.07, C.darkgreen);
              addBox(b, px - (panelW - 1.4) / 2, y - fh / 2 + 0.4, pz - 0.6, 0.07, 0.9, 1.4, C.darkgreen);
            }
          }));
        }
      }
      // short side walls
      parts.push(mk(`wall_s${s}_f${f}_w`, b => { addBox(b, x0 - width / 2, y, 0, WALL_T, fh, depth, color); panelWindow(b, x0 - width / 2 - 0.02, y + 0.15, depth / 3, Math.PI / 2, 1.2, 1.2, false); }));
      parts.push(mk(`wall_s${s}_f${f}_e`, b => { addBox(b, x0 + width / 2, y, 0, WALL_T, fh, depth, color); panelWindow(b, x0 + width / 2 + 0.02, y + 0.15, -depth / 3, -Math.PI / 2, 1.2, 1.2, false); }));
      parts.push(mk(`slab_s${s}_f${f}`, b => { addBox(b, x0, f * fh - 0.1, 0, width - 0.1, 0.24, depth - 0.2, C.concrete3); }, 'slab'));
    }
    for (const cx of [-width / 2 + 0.5, width / 2 - 0.5]) for (const cz of [-depth / 2 + 0.5, depth / 2 - 0.5]) {
      parts.push(mk(`col_s${s}_${cx > 0 ? 'e' : 'w'}${cz > 0 ? 's' : 'n'}`, b => { addBox(b, x0 + cx, height / 2, cz, 0.55, height, 0.55, C.concrete); }, 'column'));
    }
    parts.push(mk(`stair_s${s}`, b => {
      addBox(b, x0 + width / 2 - 2.6, height / 2, depth / 2 - 2.2, 3.4, height, 3.4, C.concrete);
      for (let f = 0; f < floors; f++) {
        addBox(b, x0 + width / 2 - 2.6, f * fh + 0.15, depth / 2 - 2.2, 3.2, 0.3, 3.2, C.concrete3);
        for (let st = 0; st < 9; st++) addBox(b, x0 + width / 2 - 2.6, f * fh + 0.3 + st * 0.28, depth / 2 - 2.2 + 1.3 - st * 0.28, 1.3, 0.28, 0.28, C.concrete3);
      }
    }, 'stair'));
    if (roof === 'flat') parts.push(mk(`roof_s${s}`, b => { addBox(b, x0, height + 0.12, 0, width + 0.3, 0.25, depth + 0.4, C.concrete3); addBox(b, x0, height + 0.65, -depth / 2 + 0.1, width, 0.8, 0.2, C.concrete); addBox(b, x0 + width / 4, height + 1.0, depth / 4, 1.2, 1.2, 1.2, C.darksteel); }, 'roof'));
    else parts.push(mk(`roof_s${s}`, b => { addWedge(b, x0, height + 0.6, 0, width + 0.6, 1.2, depth + 0.6, C.brick); }, 'roof'));
  }
  parts.push(mk('details', b => {
    for (let s = 0; s < sections; s++) {
      const x0 = -totalW / 2 + s * width + width / 2;
      addBox(b, x0, 1.3, -depth / 2 - 0.9, 2.2, 2.6, 1.8, C.concrete); addBox(b, x0, 2.9, -depth / 2 - 1.1, 3.0, 0.22, 2.2, C.concrete3);
      addBox(b, x0, 3.6, -depth / 2 - 0.2, 2.4, 0.5, 0.1, C.red);
      addBox(b, x0, height + 1.4, -depth / 2 - 0.1, 3.0, 1.4, 0.15, C.red);
      addBox(b, x0, height + 1.4, -depth / 2 - 0.19, 0.6, 0.6, 0.06, C.gold);
    }
    addBox(b, 0, 0.35, -depth / 2 - 2.4, totalW - 2, 0.14, 1.4, C.concrete3);
  }, 'detail'));
  return { id, floors, sections, width, depth, height, mainParts: parts };
}

function buildingDefs() {
  const d = [];
  const add = (spec, item, kind) => d.push({ id: spec.id, item, category: 'building', kind, collider: 'trimesh', dims: [spec.width * spec.sections, spec.height, spec.depth], parts: () => spec.mainParts, building: spec });
  add(panelHouse({ id: 'b_khrush5', floors: 5, sections: 3, width: 12, depth: 11 }), 'Хрущёвка, 5 этажей', 'khrushchevka');
  add(panelHouse({ id: 'b_khrush5_long', floors: 5, sections: 4, width: 12, depth: 11, balcony: false }), 'Хрущёвка, длинная секция', 'khrushchevka');
  add(panelHouse({ id: 'b_brezh9', floors: 9, sections: 3, width: 13, depth: 12, color: C.concrete, balcony: true }), 'Брежневка, 9 этажей', 'brezhnevka');
  add(panelHouse({ id: 'b_brezh16', floors: 16, sections: 2, width: 14, depth: 13, color: C.concrete2 }), 'Брежневка, 16 этажей', 'brezhnevka');
  add(panelHouse({ id: 'b_dorm', floors: 5, sections: 2, width: 10, depth: 9, color: C.brick, balcony: false, roof: 'pitched' }), 'Общежитие', 'dorm');
  add(panelHouse({ id: 'b_school', floors: 3, sections: 4, width: 16, depth: 14, color: C.concrete2, balcony: false }), 'Школа № 12', 'school');

  d.push({ id: 'b_dk', item: 'Дом культуры', category: 'building', kind: 'dk', collider: 'trimesh', dims: [30, 14, 20], parts: () => [
    mk('body', b => {
      addBox(b, 0, 5, 1, 26, 10, 16, C.concrete2); addBox(b, 0, 1.4, -8.6, 30, 2.8, 6, C.concrete3);
      for (let i = 0; i < 8; i++) addCylinder(b, -12 + i * 3.4, 3.0, -11.2, 0.45, 8.4, C.cream, 10);
      addBox(b, 0, 9.0, -11.3, 28, 1.6, 0.5, C.concrete3);
      addBox(b, 0, 11.5, 1, 9, 3.2, 6, C.glass); addBox(b, 0, 14, 1, 26, 0.8, 17, C.concrete3);
      for (let i = 0; i < 6; i++) addBox(b, -10 + i * 4, 5, -8.05, 2.2, 1.6, 0.1, C.window);
      addBox(b, 0, 9.6, -10, 4, 1.2, 0.2, C.red); addBox(b, 0, 9.6, -10.12, 1.2, 1.2, 0.06, C.gold);
    }, 'detail'),
    ...[-12, -4, 4, 12].map((x, i) => mk(`col_${i}`, b => addBox(b, x, 5, -9.2, 1.0, 10, 1.0, C.cream), 'column'))
  ], building: { height: 14, sections: 1 } });

  d.push({ id: 'b_cum', item: 'Универмаг «ЦУМ»', category: 'building', kind: 'shop', collider: 'trimesh', dims: [26, 10, 18], parts: () => [
    mk('walls', b => { addBox(b, 0, 4, 0, 24, 8, 16, C.concrete2); addBox(b, 0, 8.2, 0, 25, 0.5, 17, C.concrete3); addBox(b, 0, 2.2, -8.1, 22, 4.4, 0.2, C.glass); for (let i = 0; i < 5; i++) addCylinder(b, -10 + i * 5, 1.0, -8.5, 0.15, 2.0, C.steel, 6); addBox(b, 0, 5.4, -8.25, 20, 1.2, 0.3, C.red); addBox(b, 0, 5.4, -8.42, 5, 1.0, 0.1, C.cream); addBox(b, 6, 9.6, -4, 6, 2.4, 0.3, C.red); }, 'detail'),
    ...[-10, 0, 10].map((x, i) => mk(`col_${i}`, b => addBox(b, x, 4, 7.6, 0.8, 8, 0.8, C.concrete3), 'column'))
  ], building: { height: 10, sections: 1 } });

  d.push({ id: 'b_kinoteatr', item: 'Кинотеатр «Родина»', category: 'building', kind: 'cinema', collider: 'trimesh', dims: [24, 12, 18], parts: () => [
    mk('walls', b => { addBox(b, 0, 4.5, 0, 18, 9, 16, C.brick); addBox(b, 0, 1, -9.6, 22, 2, 3, C.concrete3); for (let i = 0; i < 5; i++) addBox(b, -8 + i * 4, 3.0, -9.1, 2.6, 4.2, 0.15, C.glass); addBox(b, 0, 8.0, -9, 19, 1.6, 0.3, C.red); addBox(b, 0, 8, -9.2, 7, 1.2, 0.1, C.cream); addBox(b, 0, 10.2, 2, 8, 2.2, 0.2, C.cream); addBox(b, 0, 12.2, 0, 19, 0.6, 17, C.concrete3); }, 'detail'),
    ...[-8, 0, 8].map((x, i) => mk(`col_${i}`, b => addBox(b, x, 4.5, -8.2, 0.7, 9, 0.7, C.brick2), 'column'))
  ], building: { height: 12, sections: 1 } });

  d.push({ id: 'b_bolnica', item: 'Больница', category: 'building', kind: 'hospital', collider: 'trimesh', dims: [34, 15, 16], parts: () => [
    mk('walls', b => { addBox(b, 0, 5.5, 0, 12, 11, 15, C.cream); addBox(b, 12, 3.8, 0, 16, 7.6, 11, C.cream); addBox(b, -12, 3.8, 0, 16, 7.6, 11, C.cream); for (let f = 0; f < 4; f++) for (let i = 0; i < 6; i++) addBox(b, -12 + i * 5, 1.6 + f * 2.6, 5.55, 1.6, 1.3, 0.1, C.glass); addBox(b, 0, 11.4, 0, 13, 0.6, 16, C.concrete3); addBox(b, 0, 6, -7.6, 3, 3, 0.2, C.red); addBox(b, 0, 6, -7.75, 1, 1, 0.1, C.white); addBox(b, 0, 6, -7.75, 0.28, 1, 0.12, C.red); }, 'detail')
  ], building: { height: 15, sections: 1 } });

  d.push({ id: 'b_garage', item: 'Гараж', category: 'building', kind: 'garage', collider: 'trimesh', dims: [4.0, 2.6, 6.0], parts: () => [
    mk('body', b => { addBox(b, 0, 1.3, 0, 4.0, 2.6, 5.8, C.rust); addBox(b, 0, 2.65, 0, 4.2, 0.1, 6.0, C.darksteel); addBox(b, 0, 1.2, -2.92, 3.6, 2.3, 0.1, C.olive2); addBox(b, 0, 2.4, -2.95, 3.8, 0.12, 0.14, C.darksteel); for (let i = 0; i < 6; i++) addBox(b, 0, 0.25 + i * 0.35, -2.98, 3.5, 0.05, 0.05, C.rust); }) ], building: { height: 2.6, sections: 1 } });

  d.push({ id: 'b_kiosk', item: 'Киоск', category: 'building', kind: 'kiosk', collider: 'trimesh', dims: [3.2, 2.8, 2.4], parts: () => [
    mk('body', b => { addBox(b, 0, 1.3, 0, 3.2, 2.4, 2.3, C.blue); addBox(b, 0, 2.7, 0, 3.6, 0.2, 2.7, C.cream); addBox(b, 0, 1.7, -1.18, 2.6, 0.9, 0.1, C.glass); addBox(b, 0, 0.8, -1.16, 2.8, 0.7, 0.12, C.cream); addBox(b, 1.1, 2.1, -1.2, 0.7, 0.4, 0.1, C.red); }) ], building: { height: 2.8, sections: 1 } });

  d.push({ id: 'b_busstop', item: 'Остановка', category: 'building', kind: 'busstop', collider: 'trimesh', dims: [4.2, 2.6, 1.6], parts: () => [
    mk('body', b => { addBox(b, 0, 2.55, 0, 4.2, 0.14, 1.7, C.steel); addBox(b, 0, 2.4, 0.78, 4.0, 1.2, 0.06, C.glass); addBox(b, -2.0, 1.25, 0, 0.12, 2.5, 1.6, C.steel); addBox(b, 2.0, 1.25, 0, 0.12, 2.5, 1.6, C.steel); addBox(b, 0, 0.55, 0.6, 3.2, 0.12, 0.45, C.wood2); addBox(b, 1.5, 2.75, 0, 0.6, 0.26, 0.05, C.red); }) ], building: { height: 2.6, sections: 1 } });

  d.push({ id: 'b_warehouse', item: 'Склад', category: 'building', kind: 'warehouse', collider: 'trimesh', dims: [24, 9, 16], parts: () => [
    mk('walls', b => { addBox(b, 0, 3.5, 0, 24, 7, 16, C.rust); addWedge(b, 0, 7.8, 0, 24.6, 1.6, 16.6, C.darksteel); for (let i = 0; i < 4; i++) addBox(b, -8 + i * 5.5, 2.2, -8.02, 3.6, 4.4, 0.12, C.olive2); addBox(b, 0, 6.6, -8.1, 20, 0.6, 0.2, C.yellow); }, 'detail'),
    ...[-11, -4, 4, 11].map((x, i) => mk(`col_${i}`, b => addBox(b, x, 3.5, -7.4, 0.5, 7, 0.5, C.darksteel), 'column'))
  ], building: { height: 9, sections: 1 } });

  d.push({ id: 'b_shopfloor', item: 'Цех завода', category: 'building', kind: 'factory', collider: 'trimesh', dims: [40, 14, 24], parts: () => [
    mk('walls', b => { addBox(b, 0, 6, 0, 5, 12, 24, C.brick); addBox(b, 20, 6, 0, 5, 12, 24, C.brick); addBox(b, 10, 6, -11, 30, 12, 2, C.brick); addBox(b, 10, 6, 11, 30, 12, 2, C.brick); for (let i = 0; i < 5; i++) addBox(b, 3 + i * 6, 9.5, -11.2, 3.6, 2.0, 0.2, C.glass); addBox(b, 0, 12.4, 0, 45, 0.8, 25, C.darksteel); }, 'detail'),
    ...[-8, 2, 12, 22, 32].map((x, i) => mk(`col_${i}`, b => addBox(b, x, 6, -8.0, 0.6, 12, 0.6, C.darksteel), 'column')),
    mk('machines', b => { for (let i = 0; i < 4; i++) { addBox(b, 4 + i * 7, 1.2, 3, 3.5, 2.4, 4.5, C.darkgreen); addCylinder(b, 4 + i * 7, 3.0, 3, 0.9, 1.2, C.steel, 10); } }, 'detail')
  ], building: { height: 14, sections: 1 } });

  d.push({ id: 'b_kpp', item: 'КПП военной базы', category: 'building', kind: 'checkpoint', collider: 'trimesh', dims: [10, 4, 4], parts: () => [
    mk('body', b => { addBox(b, 0, 2, 0, 10, 4, 4, C.olive); addBox(b, 0, 4.2, 0, 10.6, 0.4, 4.6, C.darkgreen); addBox(b, 0, 2.4, -2.05, 7, 1.2, 0.1, C.glass); addBox(b, 0, 0.5, -2.05, 1.4, 1.4, 0.1, C.olive2); addBox(b, 0, 4.9, 0, 2.4, 1.0, 0.2, C.red); addBox(b, 0, 4.9, -0.2, 0.9, 0.9, 0.1, C.gold); }) ], building: { height: 4, sections: 1 } });

  d.push({ id: 'b_barracks', item: 'Казарма', category: 'building', kind: 'barracks', collider: 'trimesh', dims: [36, 8, 12], parts: () => [
    mk('walls', b => { addBox(b, 0, 4, 0, 36, 8, 12, C.olive); addBox(b, 0, 8.4, 0, 37, 0.8, 13, C.darkgreen); for (let f = 0; f < 2; f++) for (let i = 0; i < 9; i++) addBox(b, -16 + i * 4, 2.2 + f * 3.2, -6.02, 1.4, 1.4, 0.1, C.glass); addBox(b, 0, 5.4, -6.1, 12, 1.2, 0.2, C.red); addBox(b, 0, 0.9, -6.05, 2.4, 1.8, 0.1, C.darkgreen); }, 'detail'),
    ...[-16, -5, 5, 16].map((x, i) => mk(`col_${i}`, b => addBox(b, x, 4, -5.5, 0.5, 8, 0.5, C.olive2), 'column'))
  ], building: { height: 8, sections: 1 } });

  d.push({ id: 'b_silo', item: 'Заводская труба', category: 'building', kind: 'chimney', collider: 'trimesh', dims: [6, 60, 6], parts: () => [
    mk('body', b => { addCylinder(b, 0, 30, 0, 3.0, 60, C.brick, 16, 'y', 0.55); for (let i = 0; i < 8; i++) addCylinder(b, 0, 4 + i * 7, 0, 3.0 - i * 0.16, 0.5, C.cream, 16); addCylinder(b, 0, 60.2, 0, 1.75, 0.4, C.darksteel, 16); }) ], building: { height: 60, sections: 1 } });

  d.push({ id: 'b_watertower', item: 'Водонапорная башня', category: 'building', kind: 'tower', collider: 'trimesh', dims: [8, 22, 8], parts: () => [
    mk('body', b => { for (const [x, z] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]]) addBox(b, x, 7, z, 0.4, 14, 0.4, C.steel); addCylinder(b, 0, 17, 0, 3.3, 5, C.rust, 14); addCylinder(b, 0, 19.8, 0, 3.4, 0.4, C.darksteel, 14); addCylinder(b, 0, 14.1, 0, 2.6, 0.3, C.darksteel, 12); addBox(b, 0, 6, 0, 6, 0.3, 0.3, C.steel); }) ], building: { height: 22, sections: 1 } });

  d.push({ id: 'b_controltower', item: 'Диспетчерская вышка', category: 'building', kind: 'controltower', collider: 'trimesh', dims: [7, 16, 7], parts: () => [
    mk('body', b => { addBox(b, 0, 6, 0, 5, 12, 5, C.concrete3); addBox(b, 0, 13, 0, 7, 2.6, 7, C.glass); addBox(b, 0, 14.5, 0, 7.6, 0.5, 7.6, C.concrete); addBox(b, 0, 12.3, 0, 7.2, 0.3, 7.2, C.concrete); addBox(b, 0, 16, 0, 0.2, 2.4, 0.2, C.steel); }) ], building: { height: 16, sections: 1 } });

  return d;
}

/* ----------------------------------- PROPS -------------------------------------- */
function propsDefs() {
  const d = [];
  const push = (id, item, dims, fn, extra = {}) => d.push({ id, item, category: 'prop', collider: extra.collider ?? 'convex', dims, parts: () => [mk('body', fn)], ...extra });
  push('p_bench', 'Скамейка', [2.0, 0.9, 0.6], b => { addBox(b, 0, 0.45, 0, 1.9, 0.08, 0.45, C.wood); addBox(b, 0, 0.75, 0.22, 1.9, 0.35, 0.06, C.wood); for (const x of [-0.8, 0.8]) { addBox(b, x, 0.22, -0.2, 0.08, 0.45, 0.08, C.steel); addBox(b, x, 0.22, 0.2, 0.08, 0.45, 0.08, C.steel); addBox(b, x, 0.6, 0.22, 0.08, 0.4, 0.06, C.steel); } });
  push('p_swing', 'Качели', [3.0, 2.4, 1.6], b => { for (const x of [-1.3, 1.3]) { addBox(b, x, 1.2, -0.6, 0.1, 2.4, 0.1, C.steel); addBox(b, x, 1.2, 0.6, 0.1, 2.4, 0.1, C.steel); } addBox(b, 0, 2.4, 0, 2.7, 0.12, 0.12, C.steel); for (const x of [-0.65, 0.65]) { addBox(b, x, 1.5, 0, 0.03, 1.7, 0.03, C.steel); } addBox(b, 0, 0.7, 0, 1.4, 0.08, 0.42, C.wood2); });
  push('p_sandbox', 'Песочница', [2.8, 0.4, 2.8], b => { for (const [x, z] of [[0, -1.35], [0, 1.35], [-1.35, 0], [1.35, 0]]) addBox(b, x, 0.2, z, x ? 0.15 : 2.7, 0.4, z ? 0.15 : 2.7, C.wood2); addBox(b, 0, 0.05, 0, 2.5, 0.1, 2.5, C.sand); addBox(b, 0.9, 0.35, 0.9, 0.12, 0.6, 0.12, C.wood); addWedge(b, 0.9, 0.65, 0.9, 0.5, 0.3, 0.5, C.red); });
  push('p_slide', 'Горка', [1.4, 2.2, 3.2], b => { addBox(b, 0, 1.0, 1.0, 1.2, 0.1, 1.2, C.darksteel); for (const [x, z] of [[-0.5, 1.5], [0.5, 1.5], [-0.5, 0.5], [0.5, 0.5]]) addBox(b, x, 0.6, z, 0.08, 1.2, 0.08, C.steel); addBox(b, 0, 1.5, 1.5, 1.2, 1.0, 0.08, C.steel); const steps = 10; for (let i = 0; i < steps; i++) addBox(b, 0, 1.0 - i * 0.28, 1.4 + i * 0.17, 0.7, 0.05, 0.2, i % 2 ? C.red : C.blue); });
  push('p_bench_urn', 'Урна', [0.5, 0.8, 0.5], b => { addCylinder(b, 0, 0.35, 0, 0.18, 0.55, C.darkgreen, 12); addCylinder(b, 0, 0.65, 0, 0.22, 0.08, C.darkgreen, 12); addCylinder(b, 0, 0.05, 0, 0.24, 0.1, C.steel, 12); });
  push('p_barrel', 'Бочка', [0.6, 0.9, 0.6], b => { addCylinder(b, 0, 0.45, 0, 0.29, 0.86, C.rust, 14); addCylinder(b, 0, 0.3, 0, 0.31, 0.05, C.darksteel, 14); addCylinder(b, 0, 0.6, 0, 0.31, 0.05, C.darksteel, 14); addCylinder(b, 0, 0.88, 0, 0.25, 0.04, C.darksteel, 14); });
  push('p_budka', 'Собачья будка', [1.2, 1.6, 1.4], b => { addBox(b, 0, 0.7, 0, 1.1, 1.2, 1.2, C.wood); addWedge(b, 0, 1.6, 0, 1.4, 0.5, 1.5, C.red); addBox(b, 0, 0.5, -0.62, 0.5, 0.7, 0.08, C.black); });
  push('p_konus', 'Дорожный конус', [0.4, 0.6, 0.4], b => { addCylinder(b, 0, 0.05, 0, 0.2, 0.1, C.black, 10); addCylinder(b, 0, 0.3, 0, 0.17, 0.5, C.orange, 10, 'y', 0.45); addCylinder(b, 0, 0.28, 0, 0.12, 0.07, C.white, 10); });
  push('p_fence', 'Забор', [3.0, 1.8, 0.14], b => { for (const x of [-1.45, 0, 1.45]) addBox(b, x, 0.9, 0, 0.1, 1.8, 0.1, C.concrete3); addBox(b, 0, 1.4, 0, 3.0, 0.08, 0.06, C.steel); addBox(b, 0, 0.7, 0, 3.0, 0.08, 0.06, C.steel); for (let i = 0; i < 10; i++) addBox(b, -1.35 + i * 0.3, 1.05, 0, 0.04, 0.7, 0.04, C.steel); });
  push('p_garage_door', 'Ворота гаража', [3.4, 2.2, 0.12], b => { addBox(b, 0, 1.1, 0, 3.4, 2.2, 0.1, C.olive2); for (let i = 0; i < 6; i++) addBox(b, 0, 0.3 + i * 0.32, -0.06, 3.2, 0.05, 0.04, C.rust); });
  push('p_tree_birch', 'Берёза', [1.6, 9, 1.6], b => { addCylinder(b, 0, 4.5, 0, 0.22, 9, C.white, 10, 'y', 0.5); for (let i = 0; i < 6; i++) addBox(b, 0.1, 1 + i * 1.3, 0, 0.1, 0.2, 0.24, C.black); addSphere(b, 0, 8.2, 0, 2.0, C.green, 10, 7, 0.85); addSphere(b, 1.0, 7.2, 0.5, 1.4, C.green, 9, 6, 0.85); addSphere(b, -0.9, 7.6, -0.4, 1.3, C.darkgreen, 9, 6, 0.85); }, { collider: 'trimesh' });
  push('p_tree_poplar', 'Тополь', [2.0, 14, 2.0], b => { addCylinder(b, 0, 6.5, 0, 0.3, 13, C.darkwood, 10, 'y', 0.4); addSphere(b, 0, 10, 0, 2.2, C.darkgreen, 10, 8, 1.9); addSphere(b, 0.4, 12, 0.3, 1.4, C.green, 8, 6, 1.6); }, { collider: 'trimesh' });
  push('p_tree_spruce', 'Голубая ель', [3.4, 11, 3.4], b => { addCylinder(b, 0, 3, 0, 0.28, 6, C.darkwood, 8); for (let i = 0; i < 5; i++) { const y = 2.5 + i * 1.8; addCylinder(b, 0, y, 0, 1.7 - i * 0.28, 1.4, i % 2 ? C.sky : C.darkgreen, 10, 'y', 0.25); } }, { collider: 'trimesh' });
  push('p_lamp', 'Фонарь', [0.3, 7, 0.3], b => { addCylinder(b, 0, 3.5, 0, 0.09, 7, C.darksteel, 8); addCylinder(b, 0, 7.1, 0.6, 0.05, 1.4, C.darksteel, 6, 'x'); addBox(b, 0, 7.0, 1.25, 0.2, 0.16, 0.5, C.cream); });
  push('p_powerpole', 'Опора ЛЭП', [1.0, 11, 1.0], b => { addCylinder(b, 0, 5.5, 0, 0.18, 11, C.concrete3, 8, 'y', 0.6); addBox(b, 0, 10.2, 0, 0.16, 0.16, 2.6, C.steel); addBox(b, 0, 9.4, 0, 0.16, 0.16, 2.0, C.steel); for (const z of [-1.2, -0.6, 0.6, 1.2]) addBox(b, 0, 9.7, z, 0.12, 0.2, 0.12, C.cream); });
  push('p_romashka', 'Дворовая «ромашка»', [2.0, 1.0, 2.0], b => { addCylinder(b, 0, 0.15, 0, 0.7, 0.3, C.darkgreen, 10); addCylinder(b, 0, 0.9, 0, 0.08, 1.5, C.darkgreen, 8); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; addBox(b, Math.cos(a) * 0.7, 1.25, Math.sin(a) * 0.7, 1.4, 0.12, 0.18, C.olive, a); } addSphere(b, 0, 1.7, 0, 0.24, C.yellow, 10, 6); });
  push('p_clothesline', 'Бельевая верёвка', [4.0, 2.6, 0.1], b => { for (const x of [-1.95, 1.95]) addCylinder(b, x, 1.3, 0, 0.06, 2.6, C.darkwood, 6); for (let i = 0; i < 5; i++) addBox(b, -1.6 + i * 0.8, 2.3, 0, 0.02, 0.02, 0.02, C.steel); addBox(b, -0.8, 2.1, 0, 0.5, 0.5, 0.02, C.cream); addBox(b, 0.4, 2.15, 0, 0.4, 0.4, 0.02, C.red); });
  push('p_dumpster', 'Мусорный контейнер', [2.0, 1.3, 1.3], b => { addBox(b, 0, 0.65, 0, 1.9, 1.2, 1.2, C.darkgreen); addBox(b, 0, 1.3, 0, 2.0, 0.1, 1.3, C.darksteel); for (const x of [-0.7, 0.7]) addCylinder(b, x, 0.1, 0.4, 0.1, 0.08, C.black, 8, 'x'); });
  push('p_leninstatue', 'Памятник Ленину', [3.0, 8.0, 3.0], b => { addBox(b, 0, 0.6, 0, 2.6, 1.2, 2.6, C.concrete2); addBox(b, 0, 2.8, 0, 1.6, 3.2, 1.6, C.concrete); addBox(b, 0, 5.2, 0, 0.9, 1.6, 0.6, C.darkgreen); addSphere(b, 0, 6.15, 0, 0.28, C.darkgreen, 8, 6); addBox(b, 0.5, 5.9, -0.1, 0.7, 0.16, 0.18, C.darkgreen); addBox(b, 0, 3.0, 0.85, 1.6, 0.5, 0.1, C.gold); });
  push('p_star', 'Пятиконечная звезда', [3.0, 3.0, 0.4], b => { for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 - Math.PI / 2; addWedge(b, Math.cos(a) * 0.5, 1.5 + Math.sin(a) * 0.5, 0, 0.5, 1.5, 0.2, C.red); } });
  push('p_slogan', 'Лозунг на здании', [4.0, 1.0, 0.12], b => { addBox(b, 0, 0, 0, 4.0, 1.0, 0.1, C.red); for (let i = 0; i < 6; i++) addBox(b, -1.6 + i * 0.65, 0, -0.07, 0.4, 0.5, 0.05, C.cream); });
  push('p_crate', 'Ящик', [1.1, 1.1, 1.1], b => { addBox(b, 0, 0, 0, 1.0, 1.0, 1.0, C.wood); addBox(b, 0, 0, 0.52, 1.02, 0.12, 0.02, C.darkwood); addBox(b, 0, 0, -0.52, 1.02, 0.12, 0.02, C.darkwood); addBox(b, 0, 0.52, 0, 1.02, 0.02, 1.02, C.darkwood); addBox(b, 0.52, 0, 0, 0.02, 1.02, 1.02, C.darkwood); });
  push('p_crate_ammo', 'Ящик с боеприпасами', [1.2, 0.6, 0.7], b => { addBox(b, 0, 0, 0, 1.2, 0.55, 0.7, C.olive); addBox(b, 0, 0.3, 0, 1.22, 0.06, 0.72, C.darkgreen); addBox(b, 0, 0.02, 0.36, 0.4, 0.16, 0.02, C.yellow); });
  push('p_barrier', 'Бетонный блок', [2.4, 1.1, 0.8], b => { addWedge(b, 0, 0.55, 0, 2.4, 1.1, 0.8, C.concrete3); addBox(b, 0, 0.05, 0, 2.5, 0.12, 0.9, C.concrete); });
  push('p_sandbags', 'Мешки с песком', [2.4, 0.9, 0.8], b => { for (let i = 0; i < 4; i++) addBox(b, -0.9 + i * 0.6, 0.15, 0, 0.55, 0.28, 0.7, C.sand); for (let i = 0; i < 3; i++) addBox(b, -0.6 + i * 0.6, 0.43, 0, 0.55, 0.28, 0.7, i % 2 ? C.sand : C.tan); for (let i = 0; i < 2; i++) addBox(b, -0.3 + i * 0.6, 0.71, 0, 0.55, 0.28, 0.68, C.sand); });
  push('p_radiator', 'Радиатор отопления', [1.2, 0.6, 0.2], b => { for (let i = 0; i < 8; i++) addBox(b, -0.5 + i * 0.14, 0, 0, 0.09, 0.55, 0.14, C.cream); });
  push('p_tyre', 'Покрышка', [1.0, 1.0, 0.36], b => { addCylinder(b, 0, 0, 0, 0.5, 0.35, C.rubber, 16, 'z'); addCylinder(b, 0, 0, 0, 0.28, 0.37, C.darksteel, 12, 'z'); });
  push('p_piano', 'Пианино', [1.5, 1.2, 0.6], b => { addBox(b, 0, 0, 0, 1.5, 1.2, 0.55, C.darkwood); addBox(b, 0, 0.25, -0.3, 1.3, 0.12, 0.2, C.cream); for (const x of [-0.55, 0.55]) addBox(b, x, -0.45, 0, 0.1, 0.3, 0.4, C.black); });
  return d;
}

/* ------------------------- INSTALLATIONS & TERRAIN ITEMS ------------------------- */
function installationDefs() {
  const d = [];
  const add = (id, item, dims, fn, r = {}) => d.push({ id, item, category: 'installation', collider: r.collider ?? 'trimesh', dims, parts: () => [mk('body', fn, r.material || 'main')], ...r });
  add('i_fuel', 'Цистерна ГСМ', [3.2, 3.2, 9], b => { addCylinder(b, 0, 1.8, 0, 1.55, 8.6, C.olive2, 16, 'z'); for (const z of [-3, 0, 3]) addCylinder(b, 0, 1.8, z, 1.6, 0.18, C.darkgreen, 16, 'z'); for (const z of [-3.4, 3.4]) { addBox(b, -1.0, 0.35, z, 0.3, 0.7, 0.8, C.darksteel); addBox(b, 1.0, 0.35, z, 0.3, 0.7, 0.8, C.darksteel); } addCylinder(b, 0, 3.5, 1.5, 0.3, 0.5, C.steel, 10); });
  add('i_rail', 'Железнодорожный вагон', [3.0, 4.2, 14], b => { addBox(b, 0, 1.6, 0, 3.0, 2.8, 13.6, C.rust); addBox(b, 0, 3.2, 0, 3.2, 0.3, 14, C.darksteel); addBox(b, 0, 2.0, -6.85, 2.4, 1.4, 0.1, C.darkwood); for (const x of [-1.2, 1.2]) for (const z of [-4.6, 4.6]) addCylinder(b, x, 0.45, z, 0.45, 0.16, C.darksteel, 10, 'x'); addBox(b, 0, 0.25, 0, 2.4, 0.4, 13, C.darksteel); });
  add('i_locomotive', 'Тепловоз', [3.2, 4.6, 18], b => { addBox(b, 0, 1.9, 0, 3.1, 2.6, 17.6, C.olive); addBox(b, 0, 3.4, -5.5, 2.8, 1.0, 4.0, C.olive2); addBox(b, 0, 3.4, -5.5, 2.84, 0.7, 3.4, C.glass); for (const z of [-6.5, 5.5]) addBox(b, 0, 3.9, z, 2.5, 0.3, 0.6, C.darksteel); addBox(b, 0, 0.5, 0, 2.6, 1.0, 18, C.darksteel); for (const x of [-1.2, 1.2]) for (const z of [-6, -2, 2, 6]) addCylinder(b, x, 0.5, z, 0.5, 0.2, C.steel, 10, 'x'); addCylinder(b, 0, 4.2, 8, 0.25, 1.2, C.black, 8); });
  add('i_crane', 'Портовый кран', [10, 28, 10], b => { for (const [x, z] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) addBox(b, x, 14, z, 0.7, 28, 0.7, C.yellow); addBox(b, 0, 24, 0, 10, 0.7, 10, C.yellow); addBox(b, 0, 27.5, 0, 2.0, 2.0, 2.0, C.rust); addBox(b, 0, 25, -8, 1.0, 1.0, 16, C.yellow); addBox(b, 0, 20, -12, 0.1, 9, 0.1, C.steel); addBox(b, 0, 15.5, -12, 1.2, 0.8, 1.2, C.darksteel); });
  add('i_container', 'Морской контейнер', [2.6, 2.6, 6.5], b => { addBox(b, 0, 1.3, 0, 2.5, 2.5, 6.4, C.rust); for (let i = 0; i < 14; i++) addBox(b, -1.27, 1.3, -3 + i * 0.45, 0.06, 2.4, 0.1, C.darksteel); addBox(b, 0, 1.3, 3.24, 2.2, 2.2, 0.06, C.darksteel); });
  add('i_tank_water', 'Водонапорный бак', [5, 6, 5], b => { addCylinder(b, 0, 3, 0, 2.4, 3.0, C.rust, 14); addCylinder(b, 0, 5.2, 0, 2.5, 0.3, C.darksteel, 14); addCylinder(b, 0, 0.8, 0, 2.4, 1.4, C.concrete3, 12); });
  add('i_bridge', 'Мост', [8, 1.2, 20], b => { addBox(b, 0, 0.5, 0, 8, 0.6, 20, C.concrete); addBox(b, -3.8, 1.0, 0, 0.4, 1.0, 20, C.concrete3); addBox(b, 3.8, 1.0, 0, 0.4, 1.0, 20, C.concrete3); for (const z of [-7, 0, 7]) addBox(b, 0, -1.2, z, 7, 2.0, 1.2, C.concrete3); });
  add('i_pier', 'Причал', [6, 0.6, 24], b => { addBox(b, 0, 0, 0, 6, 0.5, 24, C.wood2); for (let i = 0; i < 8; i++) for (const x of [-2.6, 2.6]) addCylinder(b, x, -1.0, -10.5 + i * 3, 0.16, 2.4, C.darkwood, 8); });
  add('i_radar', 'Радиолокатор', [8, 6, 5], b => { addBox(b, 0, 1.0, 0, 4, 0.6, 3, C.darkgreen); addCylinder(b, 0, 2.2, 0, 0.4, 2.4, C.steel, 8); addBox(b, 0, 3.6, 0, 1.0, 0.6, 0.8, C.darksteel); addCylinder(b, 0, 4.6, 0, 2.6, 0.4, C.cream, 14); addBox(b, 0, 4.6, -0.4, 4.6, 0.1, 0.6, C.cream); });
  add('i_missile', 'Пусковая установка', [4, 8, 8], b => { addBox(b, 0, 1.0, 0, 3.4, 0.8, 6.0, C.olive); for (const x of [-1.2, 1.2]) for (const z of [-2, 0, 2]) addCylinder(b, x, 0.5, z, 0.4, 0.2, C.rubber, 10, 'x'); addBox(b, 0, 1.8, 0, 1.0, 1.0, 1.0, C.darkgreen); addCylinder(b, 0, 3.8, -1, 1.1, 4.0, C.cream, 14, 'z', 0.8); addCylinder(b, 0, 3.8, -3.2, 1.0, 0.6, C.red, 12, 'z', 0.7); });
  add('i_target', 'Мишень', [2.4, 2.0, 0.3], b => { addBox(b, 0, 0.8, 0, 1.2, 1.6, 0.1, C.cream); for (let i = 0; i < 3; i++) addCylinder(b, 0, 1.2, -0.06, 0.5 - i * 0.15, 0.04, i % 2 ? C.red : C.cream, 12, 'z'); addBox(b, -0.4, 0.0, 0, 0.1, 0.8, 0.1, C.steel); addBox(b, 0.4, 0.0, 0, 0.1, 0.8, 0.1, C.steel); });
  add('i_flagpole', 'Флагшток', [1.2, 10, 1.2], b => { addCylinder(b, 0, 5, 0, 0.08, 10, C.steel, 8); addBox(b, 0.8, 9.0, 0, 1.4, 1.0, 0.05, C.red); addBox(b, 0.8, 9.2, -0.05, 0.4, 0.4, 0.04, C.gold); addBox(b, 0, 0.2, 0, 1.0, 0.4, 1.0, C.concrete); });
  add('i_watchtower', 'Наблюдательная вышка', [4, 9, 4], b => { for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) addBox(b, x, 4, z, 0.22, 8, 0.22, C.wood); addBox(b, 0, 8.2, 0, 4.2, 0.3, 4.2, C.wood2); addBox(b, 0, 8.9, 0, 4.0, 1.0, 4.0, C.olive); addWedge(b, 0, 9.7, 0, 4.6, 1.0, 4.6, C.olive2); addBox(b, 0, 10.6, 0, 0.2, 2, 0.2, C.steel); addBox(b, -1.9, 7.0, 0, 0.1, 2.4, 0.6, C.wood); });
  add('i_tanktrap', 'Противотанковый ёж', [1.6, 1.4, 1.6], b => { for (const a of [0, Math.PI / 3, -Math.PI / 3]) addBox(b, 0, 0.7, 0, 1.8, 0.22, 0.22, C.darksteel, a); });
  add('i_shed', 'Сарай', [4, 3, 3], b => { addBox(b, 0, 1.3, 0, 3.8, 2.6, 2.8, C.wood); addWedge(b, 0, 2.9, 0, 4.2, 0.8, 3.2, C.rust); addBox(b, 0, 0.9, -1.42, 1.2, 1.8, 0.06, C.darkwood); for (let i = 0; i < 5; i++) addBox(b, 0, 0.4 + i * 0.5, -1.45, 1.14, 0.04, 0.02, C.wood2); });
  add('i_barn', 'Колхозный амбар', [16, 9, 12], b => { addBox(b, 0, 4, 0, 16, 8, 12, C.brick2); addWedge(b, 0, 8.8, 0, 17, 1.6, 13, C.rust); for (const x of [-6, -2, 2, 6]) addBox(b, x, 2.5, -6.05, 3.4, 5, 0.14, C.wood); addBox(b, 0, 6.4, -6.15, 10, 1.2, 0.2, C.cream); });
  add('i_silo_grain', 'Зерновой элеватор', [6, 16, 6], b => { addCylinder(b, 0, 7, 0, 3.0, 14, C.concrete2, 16); addCylinder(b, 0, 14.6, 0, 3.1, 1.2, C.darksteel, 16, 'y', 0.6); addBox(b, 0, 1, 4, 4, 2, 3, C.concrete3); });
  return d;
}

export { buildingDefs, propsDefs, installationDefs };
