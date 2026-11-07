/* ============================================================================
   VEHICLE VISUALS — 4-node skinned hull, panels, wheels, JBeam x-ray
   ========================================================================== */
/* closed cross-section loop order (X -> left sill -> beltline -> roof -> right) */
const RING_LOOP = [9, 7, 5, 3, 1, 0, 2, 4, 6, 8];
function ringNeighbors(a, b) {
  let ia = RING_LOOP.indexOf(a), ib = RING_LOOP.indexOf(b);
  if ((ia + 1) % 10 === ib) return [RING_LOOP[(ia + 9) % 10], RING_LOOP[(ib + 1) % 10]];
  return [RING_LOOP[(ib + 9) % 10], RING_LOOP[(ia + 1) % 10]];
}
function crv(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function makeCarMaterials(spec) {
  const paint = new THREE.MeshPhysicalMaterial({
    color: spec.paint, metalness: 0.5, roughness: 0.3,
    clearcoat: 1.0, clearcoatRoughness: 0.1, envMapIntensity: 1.0,
    side: THREE.DoubleSide
  });
  return {
    paint,
    paintDark: new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.paint).multiplyScalar(0.5), metalness: 0.5, roughness: 0.45 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x101d26, metalness: 0.25, roughness: 0.05, transparent: true, opacity: 0.62, side: THREE.DoubleSide
    }),
    trim: new THREE.MeshStandardMaterial({ color: 0x15181b, metalness: 0.3, roughness: 0.7, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd7dde3, metalness: 1.0, roughness: 0.14 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0e1012, metalness: 0.0, roughness: 0.95 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc2c9cf, metalness: 0.95, roughness: 0.22 }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x2a2f34, metalness: 0.7, roughness: 0.45 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xf3f6f2, emissive: 0xfff4d8, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x8c0d0d, emissive: 0xff1a08, emissiveIntensity: 0.5, roughness: 0.3 }),
    indicator: new THREE.MeshStandardMaterial({ color: 0xd88a12, emissive: 0xff9a10, emissiveIntensity: 0.35, roughness: 0.4 }),
    engine: new THREE.MeshStandardMaterial({ color: 0x33383d, metalness: 0.85, roughness: 0.42 }),
    engineRed: new THREE.MeshStandardMaterial({ color: 0x8d1f14, metalness: 0.6, roughness: 0.5 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.6 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x1d2226, roughness: 0.85 })
  };
}

/* =========================================================================
   Hull topology: quads in control-point space (paint / glass / trim split)
   ========================================================================= */
function buildShellFaces(car) {
  const st = car.stations, n = st.length;
  const idx = (s, c) => s * 10 + c;
  const faces = [];
  const push = (mat, a, b, c, d, sub) => faces.push({ mat, cp: [a, b, c, d], sub: sub || [4, 3] });
  for (let s = 0; s < n - 1; s++) {
    const A = st[s], B = st[s + 1];
    const bothCabin = A.cabin && B.cabin;
    const crossing = A.cabin !== B.cabin;
    const sub = bothCabin ? [5, 3] : [4, 3];
    const subS = [5, 4];
    const topMat = crossing ? 'glass' : 'paint';
    push(topMat, idx(s, CP_T), idx(s + 1, CP_T), idx(s + 1, CP_RL), idx(s, CP_RL), sub);
    push(topMat, idx(s, CP_T), idx(s, CP_RR), idx(s + 1, CP_RR), idx(s + 1, CP_T), sub);
    push(bothCabin ? 'glass' : 'paint', idx(s, CP_RL), idx(s, CP_WL), idx(s + 1, CP_WL), idx(s + 1, CP_RL), subS);
    push(bothCabin ? 'glass' : 'paint', idx(s, CP_RR), idx(s + 1, CP_RR), idx(s + 1, CP_WR), idx(s, CP_WR), subS);
    push('paint', idx(s, CP_WL), idx(s, CP_SL), idx(s + 1, CP_SL), idx(s + 1, CP_WL), subS);
    push('paint', idx(s, CP_WR), idx(s + 1, CP_WR), idx(s + 1, CP_SR), idx(s, CP_SR), subS);
    push('paint', idx(s, CP_SL), idx(s, CP_BL), idx(s + 1, CP_BL), idx(s + 1, CP_SL), [4, 2]);
    push('paint', idx(s, CP_SR), idx(s + 1, CP_SR), idx(s + 1, CP_BR), idx(s, CP_BR), [4, 2]);
    push('trim', idx(s, CP_BL), idx(s + 1, CP_BL), idx(s + 1, CP_X), idx(s, CP_X), [4, 2]);
    push('trim', idx(s, CP_BR), idx(s, CP_X), idx(s + 1, CP_X), idx(s + 1, CP_BR), [4, 2]);
    if (crossing) {
      push('paint', idx(s, CP_RL), idx(s + 1, CP_RL), idx(s + 1, CP_WL), idx(s, CP_WL), subS);
      push('paint', idx(s, CP_RR), idx(s, CP_WR), idx(s + 1, CP_WR), idx(s + 1, CP_RR), subS);
    }
  }
  for (const s of [0, n - 1]) {
    const fan = [
      [CP_T, CP_RL, CP_WL], [CP_T, CP_WL, CP_RR], [CP_T, CP_RR, CP_WR],
      [CP_RL, CP_SL, CP_WL], [CP_RR, CP_WR, CP_SR],
      [CP_WL, CP_SL, CP_BL], [CP_WR, CP_BR, CP_SR],
      [CP_SL, CP_BL, CP_X], [CP_SR, CP_X, CP_BR],
      [CP_T, CP_RR, CP_RL]
    ];
    for (const t of fan) faces.push({ mat: 'paint', tri: [idx(s, t[0]), idx(s, t[1]), idx(s, t[2])] });
  }
  return faces;
}

/* =========================================================================
   ShellSkin — every hull vertex is bound to the 4 nodes of its patch
   ========================================================================= */
class ShellSkin {
  constructor(car) {
    this.car = car;
    this.group = new THREE.Group();
    this.wireGroup = new THREE.Group();
    car.group.add(this.group);
    car.group.add(this.wireGroup);
    this.build();
    this.updateReskin();  /* bind skin at the current rest pose */
  }

  build() {
    const car = this.car;
    const faces = buildShellFaces(car);
    const mkBucket = () => ({ pos: [], uv: [], idx: [], skin: [], w: [] });
    const B = { paint: mkBucket(), glass: mkBucket(), trim: mkBucket() };
    const st = car.stations, nSt = st.length;
    const restOf = (si, ri) => st[si].ring[ri].node.rest;

    /* smooth (Catmull-Rom) surface point of a cell at parameters u (stations) and v (ring) */
    const cellPoint = (s1, ra, rb, u, v, out) => {
      const ra_ = ringNeighbors(ra, rb)[0], rb_ = ringNeighbors(ra, rb)[1];
      const si = [Math.max(0, s1 - 1), s1, s1 + 1, Math.min(nSt - 1, s1 + 2)];
      let px = 0, py = 0, pz = 0;
      for (let k = 0; k < 4; k++) {
        const s = si[k];
        const a = restOf(s, ra_), b = restOf(s, ra), c = restOf(s, rb), d = restOf(s, rb_);
        const sIdx = s1 + (k - 1);
        const wS = (k === 0 || k === 3) ? 0 : 1; /* station weights applied below */
        /* ring interpolation for this station */
        const rx = crv(a.x, b.x, c.x, d.x, v);
        const ry = crv(a.y, b.y, c.y, d.y, v);
        const rz = crv(a.z, b.z, c.z, d.z, v);
        void sIdx;
        /* station blending weights (uniform CR basis at u) */
        const t = u, t2 = t * t, t3 = t2 * t;
        const w0 = 0.5 * (-t3 + 2 * t2 - t);
        const w1 = 0.5 * (3 * t3 - 5 * t2 + 2);
        const w2 = 0.5 * (-3 * t3 + 4 * t2 + t);
        const w3 = 0.5 * (t3 - t2);
        const w = [w0, w1, w2, w3][k] * (wS ? 1 : 1);
        px += rx * w; py += ry * w; pz += rz * w;
      }
      return out.set(px, py, pz);
    };

    const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pc = new THREE.Vector3(), _pd = new THREE.Vector3();
    const addPatch = (bucket, corners, s1, ra, rb, nu, nv) => {
      const tri = corners.length === 3;
      const base = bucket.pos.length / 3;
      const n = corners.length;
      const verts = [];
      if (!tri) {
        for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
          const u = i / nu, v = j / nv;
          verts.push([u, v, (1 - u) * (1 - v), u * (1 - v), u * v, (1 - u) * v]);
        }
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
          const a = i * (nv + 1) + j;
          bucket.idx.push(base + a, base + a + nv + 1, base + a + 1, base + a + 1, base + a + nv + 1, base + a + nv + 2);
        }
      } else {
        const S = Math.max(2, nu);
        for (let i = 0; i <= S; i++) for (let j = 0; j <= S - i; j++) {
          verts.push([i / S, j / S, 1 - i / S - j / S, i / S, j / S, 0]);
        }
        let off = 0;
        for (let i = 0; i < S; i++) {
          const rowLen = S - i + 1;
          for (let j = 0; j < S - i; j++) {
            const a = base + off + j, b = a + 1, c = a + rowLen, d = c + 1;
            bucket.idx.push(a, c, b);
            if (j < S - i - 1) bucket.idx.push(b, c, d);
          }
          off += rowLen;
        }
      }
      /* outward winding check on the rest pose + panel bulge amount */
      let bulge = 0;
      {
        const c0 = corners[0].node.rest, c1 = corners[1].node.rest;
        const c2 = corners[2].node.rest, c3 = corners[3] ? corners[3].node.rest : c2;
        let ax = c1.x - c0.x, ay = c1.y - c0.y, az = c1.z - c0.z;
        let bx = c3.x - c0.x, by = c3.y - c0.y, bz = c3.z - c0.z;
        const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const mx = (c0.x + c1.x + c2.x + c3.x) / 4 - car.bodyRestCenter.x;
        const my = (c0.y + c1.y + c2.y + c3.y) / 4 - car.bodyRestCenter.y;
        const mz = (c0.z + c1.z + c2.z + c3.z) / 4 - car.bodyRestCenter.z;
        const nl = Math.hypot(nx, ny, nz) || 1;
        let ox = nx / nl, oy = ny / nl, oz = nz / nl;
        if (nx * mx + ny * my + nz * mz < 0) {
          for (let k = base * 3; k < bucket.idx.length; k += 3) {
            const t = bucket.idx[k + 1]; bucket.idx[k + 1] = bucket.idx[k + 2]; bucket.idx[k + 2] = t;
          }
          ox = -ox; oy = -oy; oz = -oz;
        }
        _pa.set(ox, oy, oz);
        const cellW = Math.min(Math.hypot(ax, ay, az), Math.hypot(bx, by, bz));
        bulge = Math.min(0.032, cellW * 0.12);
      }
      for (const v of verts) {
        const ws = [v[2], v[3], v[4], v[5]];
        /* bilinear anchor = weighted control nodes (this is the skin) */
        let bx = 0, by = 0, bz = 0;
        for (let k = 0; k < n; k++) {
          bx += corners[k].node.rest.x * ws[k];
          by += corners[k].node.rest.y * ws[k];
          bz += corners[k].node.rest.z * ws[k];
        }
        let px = bx, py = by, pz = bz;
        if (!tri && bulge > 0) {
          /* convex panel bulge (crown of the bodywork) */
          const bmp = Math.sin(Math.PI * v[0]) * Math.sin(Math.PI * v[1]) * bulge;
          px += _pa.x * bmp; py += _pa.y * bmp; pz += _pa.z * bmp;
        }
        bucket.pos.push(px, py, pz);
        bucket.uv.push(v[0] * nu * 0.5, v[1] * nv * 0.5);
        const skin = [];
        for (let k = 0; k < 4; k++) {
          if (k < n) {
            const node = corners[k].node;
            skin.push(node, px - node.rest.x, py - node.rest.y, pz - node.rest.z);
          } else skin.push(null, 0, 0, 0);
        }
        bucket.skin.push(skin);
        bucket.w.push(v[2], v[3], v[4], v[5]);
      }
    };

    const idxOf = (si, ci) => si * 10 + ci;
    for (const f of faces) {
      const bucket = B[f.mat] || B.paint;
      if (f.tri) {
        addPatch(bucket, f.tri.map(i => car.cps[i]), 0, 0, 0, 3, 0);
      } else {
        const s1 = Math.floor(f.cp[0] / 10);
        const ra = f.cp[0] % 10, rb = f.cp[1] % 10;
        addPatch(bucket, f.cp.map(i => car.cps[i]), s1, ra, rb, f.sub[0], f.sub[1]);
      }
    }

    this.data = {};
    for (const key of ['paint', 'glass', 'trim']) {
      const b = B[key];
      if (!b.pos.length) continue;
      const count = b.pos.length / 3;
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(b.pos);
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
      geo.setIndex(b.idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const nodeRefs = new Array(count);
      const offs = new Float32Array(count * 12);
      const wts = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        const sk = b.skin[i];
        const refs = [null, null, null, null];
        for (let k = 0; k < 4; k++) {
          const node = sk[k * 4];
          if (!node) continue;
          refs[k] = node;
          offs[i * 12 + k * 3] = sk[k * 4 + 1];
          offs[i * 12 + k * 3 + 1] = sk[k * 4 + 2];
          offs[i * 12 + k * 3 + 2] = sk[k * 4 + 3];
        }
        nodeRefs[i] = refs;
        const w0 = b.w[i * 4], w1 = b.w[i * 4 + 1], w2 = b.w[i * 4 + 2], w3 = b.w[i * 4 + 3];
        const sum = w0 + w1 + w2 + w3 || 1;
        wts[i * 4] = w0 / sum; wts[i * 4 + 1] = w1 / sum; wts[i * 4 + 2] = w2 / sum; wts[i * 4 + 3] = w3 / sum;
      }
      const mat = this.car.mats[key];
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = key !== 'glass';
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = key === 'glass' ? 3 : 1;
      this.group.add(mesh);
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x39d2ff, transparent: true, opacity: 0.18, depthWrite: false })
      );
      wire.frustumCulled = false;
      this.wireGroup.add(wire);
      this.data[key] = { geo, mesh, wire, pos, nodeRefs, offs, wts, count };
    }
    this.wireGroup.visible = false;
  }

  /* bind the skin at the current pose: offsets become 0, rest = actual */
  updateReskin() {
    for (const key in this.data) {
      const d = this.data[key];
      const o = d.offs, w = d.wts, r = d.nodeRefs;
      for (let i = 0; i < d.count; i++) {
        /* weighted rest position of this vertex */
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 4; k++) {
          const n = r[i][k];
          if (!n) continue;
          const wk = w[i * 4 + k];
          x += n.pos.x * wk; y += n.pos.y * wk; z += n.pos.z * wk;
        }
        d.pos[i * 3] = x; d.pos[i * 3 + 1] = y; d.pos[i * 3 + 2] = z;
        for (let k = 0; k < 4; k++) {
          const n = r[i][k];
          if (!n) { o[i * 12 + k * 3] = o[i * 12 + k * 3 + 1] = o[i * 12 + k * 3 + 2] = 0; continue; }
          o[i * 12 + k * 3] = x - n.pos.x;
          o[i * 12 + k * 3 + 1] = y - n.pos.y;
          o[i * 12 + k * 3 + 2] = z - n.pos.z;
        }
      }
      d.geo.attributes.position.needsUpdate = true;
      d.geo.computeVertexNormals();
    }
  }

  update() {
    for (const key in this.data) {
      const d = this.data[key];
      const pos = d.pos, refs = d.nodeRefs, offs = d.offs, w = d.wts;
      for (let i = 0; i < d.count; i++) {
        const r = refs[i];
        let x = 0, y = 0, z = 0;
        for (let k = 0; k < 4; k++) {
          const n = r[k];
          if (!n) continue;
          const wk = w[i * 4 + k];
          x += (n.pos.x + offs[i * 12 + k * 3]) * wk;
          y += (n.pos.y + offs[i * 12 + k * 3 + 1]) * wk;
          z += (n.pos.z + offs[i * 12 + k * 3 + 2]) * wk;
        }
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      }
      d.geo.attributes.position.needsUpdate = true;
      d.geo.computeVertexNormals();
    }
  }

  setXray(mode) {
    for (const key in this.data) {
      const d = this.data[key];
      d.mesh.visible = mode !== 2;
      if (key === 'glass') continue;
      d.mesh.material.transparent = mode === 1;
      d.mesh.material.opacity = mode === 1 ? 0.22 : 1;
      d.mesh.material.depthWrite = mode !== 1;
    }
    this.wireGroup.visible = mode === 2;
  }
}

/* =========================================================================
   Detail parts anchored to body nodes, positioned in the physical body frame
   ========================================================================= */
function weightedPoint(nodes, out) {
  out.set(0, 0, 0);
  for (const n of nodes) { out.x += n.pos.x; out.y += n.pos.y; out.z += n.pos.z; }
  out.multiplyScalar(1 / Math.max(1, nodes.length));
  return out;
}

class CarDetails {
  constructor(car) {
    this.car = car;
    this.group = new THREE.Group();
    this.parts = [];
    car.group.add(this.group);
    const S = car.spec, D = S.details, M = car.mats, st = car.stations;
    const cp = (si, ci) => st[Math.max(0, Math.min(st.length - 1, si))].ring[ci].node;
    const last = st.length - 1;

    const add = (geo, mat, nodes, target) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      /* target is in car-local rest coordinates; convert to an offset from the
         anchor point (mean of the bound nodes' rest positions, also local) */
      let ax = 0, ay = 0, az = 0;
      for (const n of nodes) { const r = n.restLocal; ax += r.x; ay += r.y; az += r.z; }
      ax /= nodes.length; ay /= nodes.length; az /= nodes.length;
      this.parts.push({ mesh, nodes, base: new THREE.Vector3(target[0] - ax, target[1] - ay, target[2] - az) });
      return mesh;
    };

    /* ---- bumpers ---- */
    const bf = D.bumperF;
    add(new THREE.BoxGeometry(bf[2], bf[1], bf[3]), M.trim,
      [cp(0, CP_SL), cp(0, CP_SR), cp(0, CP_WL), cp(0, CP_WR)], [S.propF[0] + 0.02, bf[1] * 0.5 + S.propF[1] - 0.3, 0]);
    const br = D.bumperR;
    add(new THREE.BoxGeometry(br[2], br[1], br[3]), M.trim,
      [cp(last, CP_SL), cp(last, CP_SR), cp(last, CP_WL), cp(last, CP_WR)], [S.propR[0] - 0.02, br[1] * 0.5 + S.propR[1] - 0.32, 0]);

    /* ---- grille + lights ---- */
    add(new THREE.BoxGeometry(0.1, 0.3, D.headZ * 1.2), M.trim,
      [cp(0, CP_WL), cp(0, CP_WR), cp(0, CP_RL), cp(0, CP_RR)], [S.propF[0] - 0.03, D.grilleY, 0]);
    for (let i = 0; i < 4; i++) {
      add(new THREE.BoxGeometry(0.05, 0.018, D.headZ * 1.1), M.chrome,
        [cp(0, CP_WL), cp(0, CP_WR)], [S.propF[0] + 0.02, D.grilleY - 0.09 + i * 0.06, 0]);
    }
    for (const side of [1, -1]) {
      add(new THREE.BoxGeometry(0.1, 0.17, D.headZ * 0.5), M.headlight,
        [cp(0, CP_SL), cp(0, CP_SR), cp(0, CP_WL), cp(0, CP_WR)], [S.propF[0] - 0.02, D.headY, side * D.headZ * 0.75 + side * 0.12]);
      add(new THREE.BoxGeometry(0.08, 0.09, D.headZ * 0.32), M.indicator,
        [cp(0, CP_SL), cp(0, CP_SR)], [S.propF[0] - 0.02, D.headY - 0.16, side * D.headZ * 0.82]);
      add(new THREE.BoxGeometry(0.09, 0.15, D.tailZ * 0.44), M.taillight,
        [cp(last, CP_SL), cp(last, CP_SR), cp(last, CP_WL), cp(last, CP_WR)], [S.propR[0] + 0.01, D.tailY, side * D.tailZ * 0.8]);
    }
    /* number plates */
    add(new THREE.BoxGeometry(0.04, 0.12, 0.44), M.plate,
      [cp(0, CP_SL), cp(0, CP_SR)], [S.propF[0] + 0.06, S.propF[1] + 0.12, 0]);
    add(new THREE.BoxGeometry(0.04, 0.12, 0.44), M.plate,
      [cp(last, CP_SL), cp(last, CP_SR)], [S.propR[0] - 0.06, S.propR[1] + 0.12, 0]);

    /* ---- mirrors ---- */
    for (const side of [1, -1]) {
      add(new THREE.BoxGeometry(0.17, 0.11, 0.1), M.paintDark,
        [cp(4, CP_WL), cp(4, CP_WR)], [D.mirrorX, D.mirrorZ + 0.05, side * (D.halfW + 0.13)]);
    }

    /* ---- engine block under the bonnet (visible through the x-ray) ---- */
    add(new THREE.BoxGeometry(0.84, D.engineY * 0.62, D.halfW * 1.2), M.engine,
      [cp(2, CP_SL), cp(2, CP_SR), cp(3, CP_SL), cp(3, CP_SR)], [D.engineX, D.engineY, 0]);
    add(new THREE.BoxGeometry(0.62, 0.08, D.halfW * 0.95), M.engineRed,
      [cp(2, CP_SL), cp(2, CP_SR), cp(3, CP_SL), cp(3, CP_SR)], [D.engineX, D.engineY + 0.27, 0]);
    for (const side of [1, -1]) {
      add(new THREE.BoxGeometry(0.5, 0.09, 0.09), M.engineRed,
        [cp(2, CP_SL), cp(2, CP_SR), cp(3, CP_SL), cp(3, CP_SR)], [D.engineX, D.engineY + 0.33, side * 0.22]);
    }
    add(new THREE.BoxGeometry(0.06, D.engineY * 0.55, D.halfW * 1.5), M.rimDark,
      [cp(1, CP_SL), cp(1, CP_SR), cp(1, CP_WL), cp(1, CP_WR)], [S.propF[0] - 0.22, D.engineY + 0.05, 0]);
    /* exhaust */
    for (const side of [1, -1]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 10), M.chrome);
      pipe.rotation.z = Math.PI / 2;
      const holder = new THREE.Group();
      holder.add(pipe);
      this.group.add(holder);
      this.parts.push({ mesh: holder, nodes: [cp(last, CP_X), cp(last - 1, CP_X)], base: new THREE.Vector3(S.propR[0] - 0.12, 0.22, side * 0.42) });
    }
    /* ---- interior ---- */
    for (const side of [1, -1]) {
      add(new THREE.BoxGeometry(0.52, 0.1, 0.44), M.seat,
        [cp(5, CP_SL), cp(5, CP_SR)], [D.seatX, D.beltY - 0.5, side * 0.34]);
      add(new THREE.BoxGeometry(0.12, 0.55, 0.44), M.seat,
        [cp(5, CP_SL), cp(5, CP_SR)], [D.seatX - 0.26, D.beltY - 0.24, side * 0.34]);
    }
    const sw = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 14), M.trim);
    sw.rotation.y = Math.PI / 2; sw.rotation.z = 0.32;
    const swh = new THREE.Group(); swh.add(sw);
    this.group.add(swh);
    this.parts.push({ mesh: swh, nodes: [cp(5, CP_SL), cp(5, CP_SR)], base: new THREE.Vector3(D.seatX + 0.4, D.beltY - 0.08, 0.34) });
    /* dashboard */
    add(new THREE.BoxGeometry(0.26, 0.16, D.halfW * 1.6), M.trim,
      [cp(4, CP_SL), cp(4, CP_SR)], [D.cabinFront - 0.22, D.beltY - 0.22, 0]);

    /* ---- model accents ---- */
    if (S.id === 'dseries') {
      for (const side of [1, -1]) {
        add(new THREE.BoxGeometry(0.07, 0.06, D.halfW * 1.7), M.rimDark,
          [cp(4, CP_T), cp(5, CP_T)], [D.cabinFront - 0.1, D.roofY + 0.05, side * D.halfW * 0.55]);
      }
      /* ladder rack over the bed */
      add(new THREE.BoxGeometry(1.1, 0.05, D.halfW * 1.9), M.rimDark,
        [cp(last - 1, CP_T), cp(last - 2, CP_T)], [0, 0.08, 0]);
    }
    if (S.id === 'bastion') {
      add(new THREE.BoxGeometry(0.12, 0.06, D.halfW * 1.1), M.trim,
        [cp(last - 1, CP_T), cp(last - 2, CP_T)], [0, 0.03, 0]);
    }
    if (S.id === 'covet') {
      add(new THREE.BoxGeometry(0.1, 0.05, D.halfW * 1.5), M.paintDark,
        [cp(last - 1, CP_T), cp(last - 2, CP_T)], [0, 0.04, 0]);
    }
  }

  update() {
    const car = this.car, f = car.frame;
    _m1.makeBasis(_v1.set(f.fwd.x, f.fwd.y, f.fwd.z), _v2.set(f.up.x, f.up.y, f.up.z), _v3.set(f.right.x, f.right.y, f.right.z));
    const bq = _q1.setFromRotationMatrix(_m1);
    for (const p of this.parts) {
      weightedPoint(p.nodes, _v4);
      _v5.copy(p.base).applyQuaternion(bq);
      p.mesh.position.copy(_v4).add(_v5);
      p.mesh.quaternion.copy(bq);
    }
  }
}

/* =========================================================================
   Wheels
   ========================================================================= */
class WheelView {
  constructor(car, wheel) {
    this.car = car; this.wheel = wheel;
    this.group = new THREE.Group();
    const M = car.mats, R = wheel.radius, W = wheel.width;
    this.spinner = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(R, R, W, 22, 1), M.rubber);
    tyre.rotation.x = Math.PI / 2;
    tyre.castShadow = true;
    this.spinner.add(tyre);
    for (let i = 0; i < 14; i++) {
      const blk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.016, W * 0.86), M.rubber);
      const a = i / 14 * TAU;
      blk.position.set(Math.cos(a) * R * 0.995, Math.sin(a) * R * 0.995, 0);
      blk.rotation.z = a;
      this.spinner.add(blk);
    }
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.64, R * 0.64, W * 0.84, 20, 1), M.rim);
    rim.rotation.x = Math.PI / 2;
    this.spinner.add(rim);
    const hubcap = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.2, R * 0.24, W * 0.9, 12), M.rimDark);
    hubcap.rotation.x = Math.PI / 2;
    this.spinner.add(hubcap);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(R * 0.56, R * 0.09, W * 0.22), M.rim);
      const a = i / 5 * TAU;
      spoke.position.set(Math.cos(a) * R * 0.33, Math.sin(a) * R * 0.33, W * 0.38);
      spoke.rotation.z = a;
      this.spinner.add(spoke);
    }
    this.group.add(this.spinner);
    car.group.add(this.group);
    wheel.view = this;
  }
  update() {
    const w = this.wheel, hub = w.hub, f = this.car.frame;
    this.group.position.set(hub.pos.x, hub.pos.y, hub.pos.z);
    _m1.makeBasis(_v1.set(f.fwd.x, f.fwd.y, f.fwd.z), _v2.set(f.up.x, f.up.y, f.up.z), _v3.set(f.right.x, f.right.y, f.right.z));
    this.group.quaternion.setFromRotationMatrix(_m1);
    this.group.rotateY(w.front ? this.car.steer : 0);
    this.spinner.rotation.z = -w.spin;
    this.group.visible = !this.car.viewRef || this.car.viewRef.xray === 0;
  }
}

/* =========================================================================
   JBeam x-ray debug visualiser
   ========================================================================= */
const BEAM_COL_NORMAL = new THREE.Color(0x2fbf6a);
const BEAM_COL_TENSION = new THREE.Color(0xffc21f);
const BEAM_COL_PLASTIC = new THREE.Color(0xff2d16);
const BEAM_COL_BENT = new THREE.Color(0x9a4cff);
const NODE_COL_NORMAL = new THREE.Color(0x36e07a);
const NODE_COL_HOT = new THREE.Color(0xffd23f);

class SkeletonView {
  constructor(car) {
    this.car = car;
    const nodes = car.nodes;
    this.count = nodes.length;
    const posArr = new Float32Array(this.count * 3);
    const colArr = new Float32Array(this.count * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.1, vertexColors: true, sizeAttenuation: true, depthWrite: false, transparent: true, opacity: 0.95
    }));
    this.points.frustumCulled = false;
    this.pointsPos = posArr; this.pointsCol = colArr;
    const beams = car.beams;
    this.beamCount = beams.length;
    const bp = new Float32Array(this.beamCount * 6);
    const bc = new Float32Array(this.beamCount * 6);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    bg.setAttribute('color', new THREE.BufferAttribute(bc, 3));
    this.lines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.lines.frustumCulled = false;
    this.beamPos = bp; this.beamCol = bc;
    this.group = new THREE.Group();
    this.group.add(this.points);
    this.group.add(this.lines);
    this.group.visible = false;
    car.group.add(this.group);
  }
  update(dt) {
    const car = this.car, nodes = car.nodes;
    for (let i = 0; i < this.count; i++) {
      const n = nodes[i];
      this.pointsPos[i * 3] = n.pos.x; this.pointsPos[i * 3 + 1] = n.pos.y; this.pointsPos[i * 3 + 2] = n.pos.z;
      const c = (n.contactImpulse > 1.2 || n.isHub) ? NODE_COL_HOT : NODE_COL_NORMAL;
      this.pointsCol[i * 3] = c.r; this.pointsCol[i * 3 + 1] = c.g; this.pointsCol[i * 3 + 2] = c.b;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    const beams = car.beams, bp = this.beamPos, bc = this.beamCol;
    for (let i = 0; i < this.beamCount; i++) {
      const b = beams[i], o = i * 6;
      if (b.broken) {
        bp[o] = bp[o + 3] = b.a.pos.x; bp[o + 1] = bp[o + 4] = b.a.pos.y; bp[o + 2] = bp[o + 5] = b.a.pos.z;
        bc[o] = bc[o + 3] = 0.08; bc[o + 1] = bc[o + 4] = 0.08; bc[o + 2] = bc[o + 5] = 0.08;
        continue;
      }
      bp[o] = b.a.pos.x; bp[o + 1] = b.a.pos.y; bp[o + 2] = b.a.pos.z;
      bp[o + 3] = b.b.pos.x; bp[o + 4] = b.b.pos.y; bp[o + 5] = b.b.pos.z;
      const st = Math.abs(b.strain);
      const yieldAmt = clamp((st - b.plastic * 0.45) / (b.plastic * 0.8), 0, 1);
      let c;
      if (b.plasticStrain > 0.05) c = BEAM_COL_BENT;
      else if (b.plasticStrain > 0.004) c = _col.copy(BEAM_COL_PLASTIC).lerp(BEAM_COL_BENT, clamp(b.plasticStrain * 6, 0, 1));
      else c = _col.copy(BEAM_COL_NORMAL).lerp(BEAM_COL_TENSION, yieldAmt);
      if (b.flash > 0) { c = _col.copy(BEAM_COL_PLASTIC); b.flash = Math.max(0, b.flash - dt * 2.2); }
      bc[o] = bc[o + 3] = c.r; bc[o + 1] = bc[o + 4] = c.g; bc[o + 2] = bc[o + 5] = c.b;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
  dispose() {
    this.points.geometry.dispose();
    this.lines.geometry.dispose();
  }
  setVisible(v) { this.group.visible = v; }
}

/* =========================================================================
   CarView
   ========================================================================= */
class CarView {
  constructor(car) {
    this.car = car;
    car.mats = makeCarMaterials(car.spec);
    car.group = new THREE.Group();
    scene.add(car.group);
    this.skin = new ShellSkin(car);
    this.details = new CarDetails(car);
    this.wheels = car.wheels.map(w => new WheelView(car, w));
    this.skeleton = new SkeletonView(car);
    this.xray = 0;
    /* align the hinge handles and chassis with the rebuilt lattice */
    car.group.position.set(0, 0, 0);
  }
  setXray(mode) {
    this.xray = mode;
    this.skin.setXray(mode);
    this.skeleton.setVisible(mode > 0);
    this.details.group.visible = mode === 0;
    for (const w of this.wheels) w.group.visible = mode === 0 && !w.wheel.detached;
  }
  update(dt) {
    this.skin.update();
    this.details.update();
    for (const w of this.wheels) w.update();
    if (this.xray > 0) this.skeleton.update(dt);
  }
}
