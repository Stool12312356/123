import type { AssetEntry, PartBox } from '../shared/types';

export interface PartGeo { name: string; positions: Float32Array; indices: Uint32Array; triGroup: Uint32Array; boxes: PartBox[] }
export interface AssetGeo {
  id: string; parts: PartGeo[]; positions: Float32Array; indices: Uint32Array;
  boxes: PartBox[]; min: [number, number, number]; max: [number, number, number];
  partVisibility: Uint8Array;
}
const cache = new Map<string, AssetGeo>();

function parseGLB(buf: ArrayBuffer): { json: any; bin: Uint8Array } {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binStart = 20 + jsonLen + 8;
  return { json, bin: new Uint8Array(buf, binStart) };
}
function readAccessor(json: any, bin: Uint8Array, index: number): Float32Array | Uint32Array {
  const acc = json.accessors[index];
  const bv = json.bufferViews[acc.bufferView];
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[acc.type as 'SCALAR'];
  const count = acc.count * comps;
  const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if (acc.componentType === 5126) return new Float32Array(bin.buffer.slice(bin.byteOffset + offset, bin.byteOffset + offset + count * 4));
  if (acc.componentType === 5125) return new Uint32Array(bin.buffer.slice(bin.byteOffset + offset, bin.byteOffset + offset + count * 4));
  throw new Error('unsupported accessor type ' + acc.componentType);
}

async function fetchGLB(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`asset ${url} HTTP ${res.status}`);
  return res.arrayBuffer();
}

function idbOpen(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    const req = indexedDB.open('redstorm-assets', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('geo');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function loadAssetGeo(entry: AssetEntry): Promise<AssetGeo> {
  if (cache.has(entry.id)) return cache.get(entry.id)!;
  let parsed: any = null;
  const db = await idbOpen();
  if (db) {
    parsed = await new Promise<any>(res => {
      const tx = db.transaction('geo', 'readonly');
      const r = tx.objectStore('geo').get(entry.checksum);
      r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null);
    });
  }
  let geo: AssetGeo;
  if (parsed && parsed.parts) {
    geo = { ...parsed, positions: new Float32Array(parsed.positions), indices: new Uint32Array(parsed.indices), partVisibility: new Uint8Array(parsed.parts.length).fill(1), parts: parsed.parts.map((p: any) => ({ ...p, positions: new Float32Array(p.positions), indices: new Uint32Array(p.indices), triGroup: new Uint32Array(p.triGroup) })) };
  } else {
    const buf = await fetchGLB(`./${entry.glb.replace(/^\.\//, '')}`);
    const { json, bin } = parseGLB(buf);
    const parts: PartGeo[] = [];
    const allPos: number[] = [], allIdx: number[] = [];
    let base = 0;
    for (const mesh of json.meshes || []) {
      for (const prim of mesh.primitives || []) {
        const attrs = prim.attributes;
        if (attrs.POSITION === undefined || prim.indices === undefined) continue;
        const positions = readAccessor(json, bin, attrs.POSITION) as Float32Array;
        const indices = readAccessor(json, bin, prim.indices) as Uint32Array;
        const boxes: PartBox[] = mesh.extras?.boxes ?? [];
        const triGroup = attrs._TRI_GROUP !== undefined ? (readAccessor(json, bin, attrs._TRI_GROUP) as Uint32Array) : new Uint32Array(indices.length / 3);
        const pg: PartGeo = { name: mesh.name, positions, indices, triGroup, boxes };
        parts.push(pg);
        for (let i = 0; i < positions.length; i++) allPos.push(positions[i]);
        for (let i = 0; i < indices.length; i++) allIdx.push(indices[i] + base);
        base += positions.length / 3;
      }
    }
    const positions = new Float32Array(allPos), indices = new Uint32Array(allIdx);
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
    const boxes = parts.flatMap(p => p.boxes);
    geo = { id: entry.id, parts, positions, indices, boxes, min, max, partVisibility: new Uint8Array(parts.length).fill(1) };
    if (db) {
      try {
        const tx = db.transaction('geo', 'readwrite');
        tx.objectStore('geo').put({ ...geo, checksum: entry.checksum }, entry.checksum);
      } catch { /* cache is best effort */ }
    }
  }
  cache.set(entry.id, geo);
  return geo;
}

/** Loads all assets with per-asset failure isolation (requirement 2.2.8). */
export async function loadAllAssets(manifest: Record<string, AssetEntry>, onProgress: (done: number, total: number) => void) {
  const entries = Object.values(manifest);
  const ok = new Map<string, AssetGeo>();
  const failed: string[] = [];
  let done = 0;
  await Promise.all(entries.map(async e => {
    try { ok.set(e.id, await loadAssetGeo(e)); }
    catch (err) { failed.push(e.id); console.warn(`[assets] falling back for ${e.id}:`, err); }
    finally { done++; onProgress(done, entries.length); }
  }));
  return { geo: ok, failed };
}
