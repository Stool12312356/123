/* ==========================================================================
 * NEXUS ABRAMS — 3D-модель основного боевого танка M1A1 Abrams
 * на чистом WebGL (без библиотек).
 * --------------------------------------------------------------------------
 *  Геометрия снята с 4-проекционного чертежа M1A1 (вид сбоку / спереди /
 *  сверху / сзади) и сверена с ТТХ: длина с пушкой вперёд 9,83 м, корпус
 *  7,92 м, ширина по экранам 3,66 м, высота по крыше башни ~2,4 м.
 *  Единицы — метры. Оси: +X — вперёд, +Y — вверх, +Z — правый борт.
 *
 *  - Корпус: длинный пологий верхний лобовой лист, нижний лобовой лист,
 *    подбашенный лист, поднятая крыша МТО с решётками, кормовой выхлоп ГТД.
 *  - Ходовая: 7 сдвоенных опорных катков, ленивец спереди, ведущее колесо
 *    сзади, поддерживающие катки, гусеница из отдельных траков.
 *  - Башня: плоская угловатая с клиновидным лбом, длинная кормовая ниша с
 *    корзиной, 120-мм пушка M256 с эжектором и термокожухом, спаренный
 *    пулемёт, командирская башенка с M2, M240 заряжающего, прицел GPS,
 *    дымовые гранатомёты, антенны, датчик ветра, вышибные панели.
 *  - Тени (shadow map), окраска (пустыня / лес / НАТО-3), режим чертежа
 *    с контурами, ортогональные виды как на чертеже, размеры и подписи,
 *    поворот башни, наведение, ход, выстрел с откатом, звук ГТД (WebAudio).
 *  Работает локально (file://) и в iframe-плеере на projects.html.
 * ========================================================================== */
(function () {
    "use strict";

    /* ---------------------------------------------------------------- *
     * Параметры страницы
     * ---------------------------------------------------------------- */
    const params = new URLSearchParams(window.location.search);
    const EMBED = params.get("embed") === "1";
    const STORE_KEY = "nx_abrams";

    function parseAccent(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
        if (!m) return [204 / 255, 94 / 255, 55 / 255];
        const n = parseInt(m[1], 16);
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    }
    const ACCENT = parseAccent(params.get("accent"));
    document.documentElement.style.setProperty("--aq-r", Math.round(ACCENT[0] * 255));
    document.documentElement.style.setProperty("--aq-g", Math.round(ACCENT[1] * 255));
    document.documentElement.style.setProperty("--aq-b", Math.round(ACCENT[2] * 255));
    if (EMBED) document.documentElement.classList.add("aq-embed");

    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);
    const TAU = Math.PI * 2;
    const DEG = Math.PI / 180;
    const wrap180 = a => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };

    /* ---------------------------------------------------------------- *
     * Векторы и матрицы (column-major, как в WebGL)
     * ---------------------------------------------------------------- */
    const V = {
        add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
        sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
        mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
        dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
        cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
        len: a => Math.hypot(a[0], a[1], a[2]),
        norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
    };

    const M4 = {
        ident: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
        persp(fovy, aspect, n, f) {
            const t = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
            return new Float32Array([t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]);
        },
        ortho(l, r, b, t, n, f) {
            const lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
            return new Float32Array([-2 * lr, 0, 0, 0, 0, -2 * bt, 0, 0, 0, 0, 2 * nf, 0, (l + r) * lr, (t + b) * bt, (f + n) * nf, 1]);
        },
        lookAt(e, c, up) {
            let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
            let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
            let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
            l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
            const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
            return new Float32Array([
                xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
                -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1
            ]);
        },
        mul(a, b) {
            const o = new Float32Array(16);
            for (let c = 0; c < 4; c++) {
                for (let r = 0; r < 4; r++) {
                    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
                }
            }
            return o;
        },
        chain() { let m = arguments[0]; for (let i = 1; i < arguments.length; i++) m = M4.mul(m, arguments[i]); return m; },
        invert(m) {
            const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
            const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
            const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
            const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
            const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
            const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
            let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
            if (!det) return M4.ident();
            det = 1 / det;
            return new Float32Array([
                (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det,
                (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
                (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det,
                (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
                (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det,
                (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
                (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det,
                (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det
            ]);
        },
        T(x, y, z) { const m = M4.ident(); m[12] = x; m[13] = y; m[14] = z; return m; },
        S(x, y, z) { const m = M4.ident(); m[0] = x; m[5] = y; m[10] = z; return m; },
        RX(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); },
        RY(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); },
        RZ(a) { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); },
        /* Поворот вокруг оси, проходящей через точку p */
        about(p, R) { return M4.chain(M4.T(p[0], p[1], p[2]), R, M4.T(-p[0], -p[1], -p[2])); },
        xf(m, p) {
            return [
                m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
                m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
                m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
            ];
        },
        xn(m, n) { return [m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]]; },
        transform(m, x, y, z, w) {
            return [
                m[0] * x + m[4] * y + m[8] * z + m[12] * w,
                m[1] * x + m[5] * y + m[9] * z + m[13] * w,
                m[2] * x + m[6] * y + m[10] * z + m[14] * w,
                m[3] * x + m[7] * y + m[11] * z + m[15] * w
            ];
        }
    };

    /* ---------------------------------------------------------------- *
     * Построитель мешей. Цвет: rgb + материал в альфе:
     *   0 — окраска (rgb — множитель к цвету камуфляжа), 1 — «сырой» цвет
     *   (резина, сталь), 2 — светящийся (фары), 3 — стекло / оптика.
     * Нормали граней ориентируются от центра тела — не зависим от обхода.
     * ---------------------------------------------------------------- */
    function Builder() { this.pos = []; this.nrm = []; this.col = []; this.idx = []; this.M = null; }
    const BP = Builder.prototype;
    BP.count = function () { return this.pos.length / 3; };
    BP.tp = function (p) { return this.M ? M4.xf(this.M, p) : [p[0], p[1], p[2]]; };
    BP.tn = function (n) { return V.norm(this.M ? M4.xn(this.M, n) : n); };
    BP.v = function (p, n, c) {
        this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]);
        this.col.push(c[0], c[1], c[2], c[3] || 0);
        return this.pos.length / 3 - 1;
    };
    BP.face = function (pts, c, center) {
        const P = pts.map(p => this.tp(p));
        let n = [0, 0, 0];
        for (let i = 0; i < P.length; i++) {
            const a = P[i], b = P[(i + 1) % P.length];
            n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
        }
        n = V.norm(n);
        if (center) {
            const C = this.tp(center);
            let f = [0, 0, 0];
            P.forEach(p => { f = V.add(f, p); });
            f = V.mul(f, 1 / P.length);
            if (V.dot(n, V.sub(f, C)) < 0) n = V.mul(n, -1);
        }
        const base = this.count();
        P.forEach(p => this.v(p, n, c));
        for (let i = 1; i < P.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
    };
    /* Тело-«лофт»: кольца одинаковой длины, соединённые квадами, торцы закрыты (кольца выпуклые) */
    BP.loft = function (rings, c, noCaps) {
        let C = [0, 0, 0], n = 0;
        rings.forEach(r => r.forEach(p => { C = V.add(C, p); n++; }));
        C = V.mul(C, 1 / n);
        for (let k = 0; k < rings.length - 1; k++) {
            const A = rings[k], B = rings[k + 1];
            for (let i = 0; i < A.length; i++) {
                const j = (i + 1) % A.length;
                this.face([A[i], A[j], B[j], B[i]], c, C);
            }
        }
        if (!noCaps) { this.face(rings[0], c, C); this.face(rings[rings.length - 1], c, C); }
    };
    BP.box = function (min, max, c) {
        const [x0, y0, z0] = min, [x1, y1, z1] = max;
        this.loft([[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]], c);
    };
    /* Профиль в плоскости XY, вытянутый по Z */
    BP.prismZ = function (prof, z0, z1, c) {
        this.loft([prof.map(p => [p[0], p[1], z0]), prof.map(p => [p[0], p[1], z1])], c);
    };
    /* Профиль в плоскости ZY (вид спереди), вытянутый по X */
    BP.prismX = function (prof, x0, x1, c) {
        this.loft([prof.map(p => [x0, p[1], p[0]]), prof.map(p => [x1, p[1], p[0]])], c);
    };
    function basis(d) {
        const up = Math.abs(d[1]) < 0.92 ? [0, 1, 0] : [1, 0, 0];
        const u = V.norm(V.cross(d, up));
        const w = V.cross(u, d);
        return [u, w];
    }
    /* Цилиндр / усечённый конус от a до b (гладкие нормали) */
    BP.cyl = function (a, b, r0, r1, seg, c, capA, capB) {
        const ax = V.sub(b, a), h = V.len(ax), d = V.mul(ax, 1 / (h || 1));
        const [u, w] = basis(d);
        const base = this.count();
        for (let i = 0; i <= seg; i++) {
            const t = i / seg * TAU, ct = Math.cos(t), st = Math.sin(t);
            const rad = V.add(V.mul(u, ct), V.mul(w, st));
            const nn = this.tn(V.add(V.mul(rad, h), V.mul(d, r0 - r1)));
            this.v(this.tp(V.add(a, V.mul(rad, r0))), nn, c);
            this.v(this.tp(V.add(b, V.mul(rad, r1))), nn, c);
        }
        for (let i = 0; i < seg; i++) {
            const k = base + i * 2;
            this.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
        }
        const cap = (p, r, n) => {
            const nn = this.tn(n), cb = this.count();
            this.v(this.tp(p), nn, c);
            for (let i = 0; i <= seg; i++) {
                const t = i / seg * TAU;
                this.v(this.tp(V.add(p, V.add(V.mul(u, Math.cos(t) * r), V.mul(w, Math.sin(t) * r)))), nn, c);
            }
            for (let i = 0; i < seg; i++) this.idx.push(cb, cb + 1 + i, cb + 2 + i);
        };
        if (capA && r0 > 0) cap(a, r0, V.mul(d, -1));
        if (capB && r1 > 0) cap(b, r1, d);
    };
    /* Плоское кольцо (шайба) с нормалью n */
    BP.annulus = function (p, n, r0, r1, seg, c) {
        const [u, w] = basis(V.norm(n));
        const nn = this.tn(n), base = this.count();
        for (let i = 0; i <= seg; i++) {
            const t = i / seg * TAU, rad = V.add(V.mul(u, Math.cos(t)), V.mul(w, Math.sin(t)));
            this.v(this.tp(V.add(p, V.mul(rad, r0))), nn, c);
            this.v(this.tp(V.add(p, V.mul(rad, r1))), nn, c);
        }
        for (let i = 0; i < seg; i++) { const k = base + i * 2; this.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    };
    /* Тело вращения вокруг оси X: prof = [[x, r], ...] (ступеньки — повтором x) */
    BP.lathe = function (prof, cy, cz, seg, c) {
        for (let i = 0; i < prof.length - 1; i++) {
            const [x0, r0] = prof[i], [x1, r1] = prof[i + 1];
            if (Math.abs(x1 - x0) < 1e-6) {
                if (Math.abs(r1 - r0) > 1e-6) this.annulus([x0, cy, cz], [r1 > r0 ? -1 : 1, 0, 0], Math.min(r0, r1), Math.max(r0, r1), seg, c);
            } else this.cyl([x0, cy, cz], [x1, cy, cz], r0, r1, seg, c, false, false);
        }
    };
    /* Труба по ломаной (поручни, скобы, антенны) */
    BP.tube = function (pts, r, seg, c, closed) {
        const n = pts.length;
        const tan = [];
        for (let i = 0; i < n; i++) {
            const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
            tan.push(V.norm(V.sub(b, a)));
        }
        let [u] = basis(tan[0]);
        const base = this.count();
        const cnt = closed ? n + 1 : n;
        for (let k = 0; k < cnt; k++) {
            const i = k % n, t = tan[i];
            u = V.norm(V.sub(u, V.mul(t, V.dot(u, t))));
            const w = V.cross(t, u);
            for (let s = 0; s <= seg; s++) {
                const a = s / seg * TAU, rad = V.add(V.mul(u, Math.cos(a)), V.mul(w, Math.sin(a)));
                this.v(this.tp(V.add(pts[i], V.mul(rad, r))), this.tn(rad), c);
            }
        }
        for (let k = 0; k < cnt - 1; k++) {
            for (let s = 0; s < seg; s++) {
                const a = base + k * (seg + 1) + s, b = a + seg + 1;
                this.idx.push(a, b, a + 1, a + 1, b, b + 1);
            }
        }
    };
    /* Контурные (feature) рёбра для режима чертежа */
    function featureEdges(b, cosThr) {
        const P = b.pos, I = b.idx, map = new Map();
        const q = i => Math.round(P[i * 3] * 2000) + "," + Math.round(P[i * 3 + 1] * 2000) + "," + Math.round(P[i * 3 + 2] * 2000);
        for (let t = 0; t < I.length; t += 3) {
            const ia = I[t], ib = I[t + 1], ic = I[t + 2];
            const ux = P[ib * 3] - P[ia * 3], uy = P[ib * 3 + 1] - P[ia * 3 + 1], uz = P[ib * 3 + 2] - P[ia * 3 + 2];
            const vx = P[ic * 3] - P[ia * 3], vy = P[ic * 3 + 1] - P[ia * 3 + 1], vz = P[ic * 3 + 2] - P[ia * 3 + 2];
            const n = V.norm([uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]);
            if (!isFinite(n[0])) continue;
            [[ia, ib], [ib, ic], [ic, ia]].forEach(([i, j]) => {
                const ka = q(i), kb = q(j);
                if (ka === kb) return;
                const key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
                let e = map.get(key);
                if (!e) { e = { a: i, b: j, n: [] }; map.set(key, e); }
                e.n.push(n);
            });
        }
        const out = [];
        map.forEach(e => {
            let feat = e.n.length === 1;
            if (!feat) {
                let par = false, sharp = false;
                for (let i = 0; i < e.n.length; i++) {
                    for (let j = i + 1; j < e.n.length; j++) {
                        const d = Math.abs(V.dot(e.n[i], e.n[j])) > 0.985 && V.dot(e.n[i], e.n[j]) > 0;
                        if (d) par = true;
                        if (V.dot(e.n[i], e.n[j]) < cosThr) sharp = true;
                    }
                }
                feat = sharp && !par;
            }
            if (feat) out.push(P[e.a * 3], P[e.a * 3 + 1], P[e.a * 3 + 2], P[e.b * 3], P[e.b * 3 + 1], P[e.b * 3 + 2]);
        });
        return out;
    }

    /* ---------------------------------------------------------------- *
     * Размеры M1A1 (м) — по чертежу и ТТХ
     * ---------------------------------------------------------------- */
    const DIM = {
        nose: 3.96, rear: -3.96, muzzle: 5.87, skirt: 1.83, roof: 2.38,
        trackZ: 1.42, trackW: 0.635,
        wheelR: 0.32, wheelY: 0.415,
        wheels: [2.36, 1.46, 0.69, -0.05, -0.79, -1.55, -2.24],
        idler: [3.50, 0.78], sprocket: [-3.10, 0.88], sprocketR: 0.30,
        rollers: [[1.70, 1.03], [-0.40, 1.03], [-2.30, 1.05]], rollerR: 0.10,
        pivot: 0.15,                        /* ось погона башни */
        trunnion: [2.0, 1.88],              /* цапфы пушки */
        elevMin: -9, elevMax: 20
    };

    /* Цвета-множители и «сырые» материалы */
    const P1 = [1, 1, 1, 0], P9 = [0.92, 0.92, 0.92, 0], P8 = [0.82, 0.82, 0.82, 0], P7 = [0.7, 0.7, 0.7, 0], P5 = [0.5, 0.5, 0.5, 0];
    const RUBBER = [0.075, 0.075, 0.07, 1], STEEL = [0.30, 0.29, 0.27, 1], DSTEEL = [0.17, 0.165, 0.16, 1];
    const GUNMETAL = [0.12, 0.12, 0.115, 1], BLACK = [0.02, 0.02, 0.02, 1], GLASS = [0.10, 0.16, 0.18, 3];
    const CANVAS = [0.40, 0.38, 0.27, 1], CANVAS2 = [0.47, 0.42, 0.31, 1];
    const HEAD = [1.0, 0.92, 0.7, 2], TAIL = [0.9, 0.12, 0.08, 2], AMBER = [1.0, 0.55, 0.1, 2];

    /* Высота крыши башни и подбашенного листа в зависимости от X */
    const pl = (x, pts) => {
        if (x >= pts[0][0]) return pts[0][1];
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            if (x <= a[0] && x >= b[0]) return lerp(a[1], b[1], (a[0] - x) / (a[0] - b[0]));
        }
        return pts[pts.length - 1][1];
    };
    /* Корпус: лоб верхнего листа (без фар и проушин), корма, высоты по боковой проекции */
    const HULL_F = 3.82, HULL_R = -3.70;
    const glacisY = x => (x > 2.05 ? 1.22 + (HULL_F - x) / (HULL_F - 2.05) * 0.25 : 1.47);
    /* Башня. Сечение снято с вида сверху (чертёж) и с фото в лоб: низ широкий (±1.60),
       борта завалены внутрь к крыше (±1.25), лобовые «скулы» — клин в плане с
       небольшим изломом. Точки половины контура: [x, z, y] — у маски, угол скулы,
       середина борта, начало кормовой ниши, скос задней стенки. */
    const T_BOT = [[2.15, 0.36, 1.64], [1.51, 1.60, 1.62], [-0.90, 1.53, 1.62], [-1.95, 1.47, 1.80], [-2.15, 1.27, 1.84]];
    const T_TOP = [[2.13, 0.36, 2.25], [1.39, 1.27, 2.31], [-0.90, 1.22, 2.38], [-1.95, 1.18, 2.38], [-2.15, 1.02, 2.38]];
    const roofY = x => pl(x, T_TOP.slice(0, 4).map(p => [p[0], p[2]]));
    /* Полуширина борта башни на высоте y (борт — наклонная плоскость) */
    const wallZ = (x, y) => {
        const bz = pl(x, T_BOT.slice(1, 4).map(p => [p[0], p[1]])), tz = pl(x, T_TOP.slice(1, 4).map(p => [p[0], p[1]]));
        const by = pl(x, T_BOT.slice(1, 4).map(p => [p[0], p[2]])), ty = roofY(x);
        return lerp(bz, tz, clamp((y - by) / (ty - by), 0, 1));
    };

    /* ---------------------------------------------------------------- *
     * Корпус
     * ---------------------------------------------------------------- */
    function buildHull() {
        const b = new Builder();
        /* Высоты — по боковой проекции чертежа: верх лобового листа 1.22 м, подбашенный лист
           1.47 м, крылья и экраны 1.36 м, крыша МТО 1.70 м, низ экранов 0.70 м. */
        const N = HULL_F, R = HULL_R;
        /* Нижняя часть (между гусеницами): нижний лобовой лист, днище, корма */
        b.prismZ([[N, 1.16], [3.28, 0.62], [3.02, 0.47], [-3.38, 0.47], [R, 0.92], [R, 1.24], [N, 1.24]], -1.08, 1.08, P1);
        /* Средняя часть: очень пологий верхний лобовой лист → подбашенный лист */
        b.prismZ([[N, 1.16], [N, 1.22], [2.05, 1.47], [-1.55, 1.47], [-1.55, 1.16]], -1.08, 1.08, P1);
        /* Крыша МТО — поднята к корме */
        b.prismZ([[-1.55, 1.16], [-1.55, 1.47], [-2.00, 1.68], [-3.62, 1.70], [R, 1.64], [R, 1.16]], -1.08, 1.08, P1);
        /* Надгусеничные полки (спонсоны) — ниже подбашенного листа */
        [1, -1].forEach(s => {
            const z0 = 1.08 * s, z1 = 1.74 * s;
            b.prismZ([[N, 1.22], [N, 1.30], [1.85, 1.36], [-1.06, 1.36], [-1.06, 1.22]], Math.min(z0, z1), Math.max(z0, z1), P1);
            b.prismZ([[-1.06, 1.22], [-1.06, 1.36], [-1.43, 1.70], [-3.62, 1.70], [R, 1.64], [R, 1.22]], Math.min(z0, z1), Math.max(z0, z1), P1);
            /* Кромка крыла над экраном */
            b.box([-2.78, 1.33, Math.min(1.74 * s, 1.85 * s)], [3.80, 1.365, Math.max(1.74 * s, 1.85 * s)], P9);
            /* Лобовые торцы крыльев */
            b.box([N - 0.02, 1.22, Math.min(1.08 * s, 1.74 * s)], [N + 0.01, 1.31, Math.max(1.08 * s, 1.74 * s)], P9);
        });

        /* Погон башни */
        b.cyl([DIM.pivot, 1.46, 0], [DIM.pivot, 1.57, 0], 1.10, 1.10, 40, P5, false, true);

        /* Люк механика-водителя + 3 перископа (по центру, под пушкой) */
        const hx = 2.62, hy = glacisY(hx);
        b.M = M4.chain(M4.T(hx, hy, 0), M4.RZ(5 * DEG));
        b.cyl([0, -0.02, 0], [0, 0.06, 0], 0.32, 0.31, 24, P9, false, true);
        b.cyl([0, 0.06, 0], [0, 0.085, 0], 0.22, 0.2, 20, P8, false, true);
        b.box([-0.36, -0.02, -0.06], [-0.28, 0.07, 0.06], P8);
        b.M = null;
        [-0.27, 0, 0.27].forEach((z, i) => {
            const x = 3.0 - Math.abs(z) * 0.25, y = glacisY(x);
            b.box([x - 0.06, y - 0.02, z - 0.09], [x + 0.06, y + 0.07, z + 0.09], P8);
            b.face([[x + 0.061, y + 0.01, z - 0.07], [x + 0.061, y + 0.01, z + 0.07], [x + 0.061, y + 0.055, z + 0.07], [x + 0.061, y + 0.055, z - 0.07]], GLASS, [x, y, z]);
            if (i === 1) b.box([x + 0.06, y + 0.06, z - 0.11], [x + 0.10, y + 0.075, z + 0.11], P7);
        });

        /* Фары с защитными решётками, буксирные проушины */
        [1, -1].forEach(s => {
            /* Фары — по краям лобового листа, у стыка с крыльями (как на фото в лоб) */
            const zc = 0.92 * s;
            b.box([N - 0.01, 1.12, zc - 0.13], [N + 0.07, 1.27, zc + 0.13], P8);
            b.box([N + 0.07, 1.17, zc - 0.11], [N + 0.08, 1.23, zc - 0.01], HEAD);
            b.box([N + 0.07, 1.17, zc + 0.01], [N + 0.08, 1.23, zc + 0.11], [1, 0.6, 0.2, 2]);
            b.tube([[N, 1.11, zc - 0.16], [N + 0.15, 1.11, zc - 0.16], [N + 0.15, 1.29, zc - 0.16], [N + 0.15, 1.29, zc + 0.16], [N + 0.15, 1.11, zc + 0.16], [N, 1.11, zc + 0.16]], 0.012, 6, P8);
            /* Проушина и скоба (по чертежу — на углу носа) */
            const tz = 1.33 * s;
            b.box([N - 0.02, 1.06, tz - 0.06], [N + 0.06, 1.24, tz + 0.06], P8);
            const loop = [];
            for (let i = 0; i <= 14; i++) {
                const a = -0.3 + i / 14 * 4.2;
                loop.push([N + 0.08 + Math.cos(a) * 0.06, 1.04 + Math.sin(a) * 0.10, tz]);
            }
            b.tube(loop, 0.02, 8, DSTEEL);
            /* Нижние буксирные серьги под лобовым листом */
            const sz = 0.92 * s;
            b.box([2.98, 0.45, sz - 0.07], [3.14, 0.58, sz + 0.07], P8);
            const sh = [];
            for (let i = 0; i <= 12; i++) { const a = Math.PI + i / 12 * Math.PI; sh.push([3.10 + Math.cos(a) * 0.07, 0.44 + Math.sin(a) * 0.10, sz]); }
            b.tube(sh, 0.018, 6, DSTEEL);
            /* Боковые фонари-габариты на передних углах крыльев */
            b.box([N - 0.12, 1.30, 1.60 * s - 0.05], [N - 0.02, 1.39, 1.60 * s + 0.05], P8);
            b.box([N - 0.025, 1.32, 1.60 * s - 0.035], [N - 0.015, 1.37, 1.60 * s + 0.035], AMBER);
        });
        /* Шов верхнего лобового листа */
        b.box([N - 0.02, 1.15, -1.08], [N + 0.02, 1.17, 1.08], P8);

        /* Корма: большая жалюзийная решётка выхлопа ГТД AGT-1500 */
        b.box([R - 0.05, 0.98, -1.14], [R + 0.01, 1.56, 1.14], [0.07, 0.07, 0.065, 1]);
        for (let i = 0; i < 9; i++) {
            const y = 1.02 + i * 0.058;
            b.M = M4.about([R - 0.06, y, 0], M4.RZ(-35 * DEG));
            b.box([R - 0.10, y - 0.006, -1.10], [R - 0.02, y + 0.006, -0.03], P8);
            b.box([R - 0.10, y - 0.006, 0.03], [R - 0.02, y + 0.006, 1.10], P8);
            b.M = null;
        }
        b.box([R - 0.11, 0.98, -0.03], [R - 0.04, 1.56, 0.03], P8);
        b.tube([[R - 0.08, 0.97, -1.15], [R - 0.08, 1.57, -1.15], [R - 0.08, 1.57, 1.15], [R - 0.08, 0.97, 1.15]], 0.025, 6, P8, true);
        /* Верхняя кормовая панель */
        b.box([R - 0.03, 1.56, -1.10], [R + 0.01, 1.64, 1.10], P9);
        /* Кормовые ящики с фонарями */
        [1, -1].forEach(s => {
            const z0 = Math.min(1.36 * s, 1.76 * s), z1 = Math.max(1.36 * s, 1.76 * s);
            b.box([-3.96, 1.38, z0], [R, 1.66, z1], P9);
            b.box([-3.965, 1.48, 1.46 * s - 0.05], [-3.955, 1.58, 1.46 * s + 0.05], TAIL);
            b.box([-3.965, 1.48, 1.64 * s - 0.05], [-3.955, 1.58, 1.64 * s + 0.05], AMBER);
            b.box([-3.97, 1.45, z0 + 0.02], [-3.955, 1.46, z1 - 0.02], P7);
            /* Задние проушины */
            b.box([R - 0.08, 0.86, 0.80 * s - 0.06], [R, 1.00, 0.80 * s + 0.06], P8);
            b.cyl([R - 0.06, 0.93, 0.80 * s - 0.07], [R - 0.06, 0.93, 0.80 * s + 0.07], 0.035, 0.035, 10, DSTEEL, true, true);
            /* Грязевые щитки за ведущими колёсами */
            b.box([R - 0.03, 1.02, Math.min(1.12 * s, 1.74 * s)], [R, 1.30, Math.max(1.12 * s, 1.74 * s)], RUBBER);
        });
        /* Буксирный крюк по центру */
        b.box([R - 0.12, 0.80, -0.12], [R, 0.95, 0.12], P8);
        b.tube([[R - 0.12, 0.92, 0], [R - 0.2, 0.92, 0], [R - 0.24, 0.86, 0], [R - 0.2, 0.80, 0], [R - 0.14, 0.82, 0]], 0.03, 8, DSTEEL);

        /* Решётки МТО: три центральные + воздухозаборники на полках */
        const grille = (x0, x1, z0, z1, y) => {
            b.box([x1, y, z0], [x0, y + 0.015, z1], [0.06, 0.06, 0.055, 1]);
            for (let x = x1 + 0.05; x < x0 - 0.02; x += 0.075) b.box([x - 0.012, y + 0.01, z0 + 0.02], [x + 0.012, y + 0.035, z1 - 0.02], P8);
            b.tube([[x0, y + 0.02, z0], [x1, y + 0.02, z0], [x1, y + 0.02, z1], [x0, y + 0.02, z1]], 0.018, 5, P9, true);
        };
        grille(-2.12, -3.58, -0.96, -0.36, 1.695);
        grille(-2.12, -3.58, -0.30, 0.30, 1.695);
        grille(-2.12, -3.58, 0.36, 0.96, 1.695);
        [1, -1].forEach(s => {
            grille(-1.62, -3.58, Math.min(1.16 * s, 1.66 * s), Math.max(1.16 * s, 1.66 * s), 1.695);
            /* Горловины топливных баков */
            b.cyl([-1.50, 1.69, 1.40 * s], [-1.50, 1.75, 1.40 * s], 0.08, 0.08, 14, P8, false, true);
            /* Рым-болты */
            [[3.62, glacisY(3.62)], [-3.55, 1.70]].forEach(([x, y]) => {
                const L = [];
                for (let i = 0; i <= 10; i++) { const a = i / 10 * Math.PI; L.push([x + Math.cos(a) * 0.06, y + Math.sin(a) * 0.07, 1.0 * s]); }
                b.tube(L, 0.016, 6, P8);
            });
        });
        /* Крышки люков МТО (швы) */
        b.box([-2.20, 1.68, -1.0], [-2.08, 1.705, 1.0], P8);

        /* Бортовые экраны: передние — тяжёлые (толще), задние — тонкие. Швы — по чертежу */
        [1, -1].forEach(s => {
            const zz = (a, c) => [Math.min(a * s, c * s), Math.max(a * s, c * s)];
            const [h0, h1] = zz(1.75, 1.83), [l0, l1] = zz(1.79, 1.83);
            /* Передний экран со скошенной передней кромкой */
            b.prismZ([[3.80, 1.36], [3.55, 0.71], [1.895, 0.70], [1.895, 1.36]], h0, h1, P1);
            b.box([0.875, 0.70, h0], [1.885, 1.36, h1], P1);
            b.box([-0.40, 0.70, h0], [0.865, 1.36, h1], P1);
            b.box([-1.10, 0.71, l0], [-0.41, 1.36, l1], P1);
            b.box([-2.48, 0.71, l0], [-1.11, 1.36, l1], P1);
            /* Задний короткий экран со скруглённым низом (над ведущим колесом) */
            b.prismZ([[-2.49, 1.36], [-2.49, 0.72], [-2.58, 0.74], [-2.70, 0.88], [-2.76, 1.03], [-2.76, 1.36]], l0, l1, P1);
            /* Кожух над ведущим колесом до кормы (по чертежу закрывает верх звёздочки) */
            b.prismZ([[-2.76, 1.36], [-2.76, 1.04], [-3.62, 1.08], [-3.62, 1.36]], l0, l1, P9);
            /* Болты по верхней кромке и ручки */
            const zo = 1.835 * s;
            for (let x = 3.6; x > -2.7; x -= 0.29) b.cyl([x, 1.31, zo - 0.008 * s], [x, 1.31, zo + 0.012 * s], 0.018, 0.018, 6, P8, false, true);
            b.box([2.70, 0.86, Math.min(zo, zo + 0.03 * s)], [2.89, 0.97, Math.max(zo, zo + 0.03 * s)], P8);
            b.box([2.73, 0.89, Math.min(zo + 0.03 * s, zo + 0.04 * s)], [2.86, 0.94, Math.max(zo + 0.03 * s, zo + 0.04 * s)], [0.05, 0.05, 0.05, 1]);
            [-0.75, -1.8].forEach(x => b.tube([[x - 0.12, 1.25, zo], [x - 0.12, 1.25, zo + 0.05 * s], [x + 0.12, 1.25, zo + 0.05 * s], [x + 0.12, 1.25, zo]], 0.012, 5, P8));

            /* Ходовая на корпусе: балансиры, кронштейны поддерживающих катков, бортовая передача */
            DIM.wheels.forEach(x => {
                b.tube([[x + 0.34, 0.66, 1.08 * s], [x + 0.34, 0.66, 1.17 * s], [x, DIM.wheelY, 1.17 * s]], 0.055, 8, P8);
            });
            DIM.rollers.forEach(([x, y]) => b.cyl([x, y, 1.08 * s], [x, y, 1.26 * s], 0.04, 0.04, 8, P8, false, false));
            b.cyl([DIM.sprocket[0], DIM.sprocket[1], 1.08 * s], [DIM.sprocket[0], DIM.sprocket[1], 1.24 * s], 0.24, 0.20, 18, P8, false, false);
            b.tube([[3.05, 0.98, 1.10 * s], [3.30, 0.90, 1.18 * s], [DIM.idler[0], DIM.idler[1], 1.18 * s]], 0.06, 8, P8);
        });
        return b;
    }

    /* ---------------------------------------------------------------- *
     * Башня (в координатах корпуса; вращается вокруг оси погона)
     * ---------------------------------------------------------------- */
    function buildTurret() {
        const b = new Builder();
        /* Три пояса: низ (самый широкий), излом лобовых скул (у маски выступает вперёд,
           к углу сходит на нет — борт остаётся плоским), крыша. */
        const tm = T_BOT.map((p, i) => p.map((v, k) => lerp(v, T_TOP[i][k], 0.38)));
        tm[0][0] = 2.25;
        const ring = L => L.map(([x, z, y]) => [x, y, z]).concat(L.slice().reverse().map(([x, z, y]) => [x, y, -z]));
        b.loft([ring(T_BOT), ring(tm), ring(T_TOP)], P1);
        /* Ниша маски между скулами */
        b.box([1.90, 1.60, -0.36], [2.12, 2.24, 0.36], P7);

        /* Накладные плиты крыши над скулами (клин) — видны на виде сверху */
        [1, -1].forEach(s => {
            const pts = [[2.02, 0.44], [1.40, 1.20], [1.10, 1.19], [1.10, 0.44]];
            const top = pts.map(([x, z]) => [x, roofY(x) + 0.014, z * s]), bot = pts.map(([x, z]) => [x, roofY(x) - 0.01, z * s]);
            b.loft([bot, top], P9);
        });
        /* Вышибные панели ниши боекомплекта */
        [[0.05, 0.84], [-0.74, -0.05]].forEach(([z0, z1]) => {
            b.box([-2.02, 2.375, z0], [-1.00, 2.392, z1], P9);
            for (let x = -1.04; x > -2.02; x -= 0.15) { b.box([x - 0.012, 2.39, z0 + 0.02], [x + 0.012, 2.4, z0 + 0.044], P7); b.box([x - 0.012, 2.39, z1 - 0.044], [x + 0.012, 2.4, z1 - 0.02], P7); }
        });


        /* Прицел наводчика GPS («будка» справа спереди) с бронезаслонками */
        b.prismZ([[0.58, 2.28], [1.13, 2.28], [1.13, 2.40], [1.00, 2.56], [0.58, 2.56]], 0.42, 0.98, P1);
        b.face([[1.131, 2.30, 0.50], [1.131, 2.30, 0.90], [1.131, 2.385, 0.90], [1.131, 2.385, 0.50]], GLASS, [0.8, 2.4, 0.7]);
        b.M = M4.about([1.10, 2.40, 0], M4.RZ(28 * DEG));
        b.box([1.10, 2.40, 0.46], [1.14, 2.56, 0.69], P9);
        b.box([1.10, 2.40, 0.71], [1.14, 2.56, 0.94], P9);
        b.M = null;

        /* Командирская башенка (справа) + 12,7-мм M2 */
        const cx = -0.39, cz = 0.46, cy = roofY(cx);
        b.cyl([cx, cy - 0.04, cz], [cx, cy + 0.10, cz], 0.46, 0.44, 32, P9, false, true);
        b.cyl([cx, cy + 0.10, cz], [cx, cy + 0.23, cz], 0.40, 0.38, 28, P1, false, true);
        for (let i = 0; i < 6; i++) {
            const a = i / 6 * TAU + 0.26, nx = Math.cos(a), nz = Math.sin(a);
            const c = [cx + nx * 0.392, cy + 0.165, cz + nz * 0.392];
            const t = [-nz, 0, nx];
            const p = (u, v) => [c[0] + t[0] * u + nx * 0.004, c[1] + v, c[2] + t[2] * u + nz * 0.004];
            b.face([p(-0.08, -0.035), p(0.08, -0.035), p(0.08, 0.035), p(-0.08, 0.035)], GLASS, [cx, cy + 0.165, cz]);
        }
        b.cyl([cx - 0.02, cy + 0.23, cz], [cx - 0.02, cy + 0.29, cz], 0.33, 0.31, 24, P9, false, true);
        b.box([cx - 0.40, cy + 0.22, cz - 0.10], [cx - 0.30, cy + 0.30, cz + 0.10], P8);
        /* Люлька и пулемёт M2 */
        b.box([cx + 0.24, cy + 0.20, cz - 0.07], [cx + 0.62, cy + 0.36, cz + 0.07], P8);
        const my = cy + 0.43;
        b.box([cx + 0.18, my - 0.07, cz - 0.055], [cx + 0.66, my + 0.06, cz + 0.055], GUNMETAL);
        b.box([cx + 0.10, my - 0.04, cz - 0.07], [cx + 0.18, my + 0.03, cz - 0.04], GUNMETAL);
        b.box([cx + 0.10, my - 0.04, cz + 0.04], [cx + 0.18, my + 0.03, cz + 0.07], GUNMETAL);
        b.cyl([cx + 0.66, my, cz], [cx + 0.98, my, cz], 0.033, 0.033, 12, GUNMETAL, false, true);
        b.cyl([cx + 0.98, my, cz], [cx + 1.44, my, cz], 0.022, 0.022, 10, GUNMETAL, false, false);
        b.cyl([cx + 1.44, my, cz], [cx + 1.52, my, cz], 0.03, 0.026, 10, GUNMETAL, true, true);
        b.box([cx + 0.24, my - 0.16, cz - 0.20], [cx + 0.52, my - 0.02, cz - 0.07], [0.27, 0.29, 0.18, 1]);
        b.box([cx + 0.56, my - 0.17, cz - 0.02], [cx + 0.60, my - 0.05, cz + 0.02], GUNMETAL);

        /* Люк заряжающего (слева) на погоне + 7,62-мм M240 */
        const lx = -0.36, lz = -0.48, ly = roofY(lx);
        b.cyl([lx, ly - 0.04, lz], [lx, ly + 0.06, lz], 0.42, 0.42, 30, P9, false, true);
        b.cyl([lx, ly + 0.06, lz], [lx, ly + 0.11, lz], 0.35, 0.34, 26, P1, false, true);
        b.box([lx - 0.42, ly + 0.05, lz - 0.08], [lx - 0.33, ly + 0.12, lz + 0.08], P8);
        const sk = [];
        for (let i = 0; i < 28; i++) { const a = i / 28 * TAU; sk.push([lx + Math.cos(a) * 0.45, ly + 0.10, lz + Math.sin(a) * 0.45]); }
        b.tube(sk, 0.018, 6, P8, true);
        const gx = lx + 0.30, gz = lz - 0.34;
        b.cyl([gx, ly + 0.08, gz], [gx, ly + 0.30, gz], 0.025, 0.025, 8, P8, false, true);
        const gy = ly + 0.34;
        b.box([gx - 0.22, gy - 0.05, gz - 0.035], [gx + 0.16, gy + 0.045, gz + 0.035], GUNMETAL);
        b.box([gx - 0.44, gy - 0.05, gz - 0.025], [gx - 0.22, gy + 0.02, gz + 0.025], GUNMETAL);
        b.cyl([gx + 0.16, gy, gz], [gx + 0.66, gy, gz], 0.016, 0.016, 8, GUNMETAL, false, true);
        b.cyl([gx + 0.04, gy - 0.05, gz], [gx + 0.04, gy - 0.18, gz + 0.06], 0.01, 0.01, 6, GUNMETAL, false, false);
        b.box([gx - 0.12, gy - 0.16, gz + 0.04], [gx + 0.06, gy - 0.02, gz + 0.14], [0.27, 0.29, 0.18, 1]);
        /* Перископ заряжающего */
        b.box([0.10, roofY(0.1) - 0.02, -0.40], [0.26, roofY(0.1) + 0.09, -0.22], P8);
        b.face([[0.261, roofY(0.1) + 0.02, -0.38], [0.261, roofY(0.1) + 0.02, -0.24], [0.261, roofY(0.1) + 0.07, -0.24], [0.261, roofY(0.1) + 0.07, -0.38]], GLASS, [0.18, roofY(0.1), -0.31]);

        /* Датчик бокового ветра (мачта на крыше) */
        b.cyl([-0.86, 2.37, 0.0], [-0.86, 2.95, 0.0], 0.022, 0.018, 8, P8, false, true);
        b.cyl([-0.98, 2.95, 0.0], [-0.70, 2.95, 0.0], 0.03, 0.03, 8, GUNMETAL, true, true);
        b.box([-0.92, 2.36, -0.07], [-0.80, 2.42, 0.07], P8);

        /* Две антенны на кормовых углах */
        [1, -1].forEach(s => {
            const ax = -1.80, az = 1.04 * s;
            b.cyl([ax, 2.37, az], [ax, 2.50, az], 0.065, 0.055, 12, P8, false, true);
            b.cyl([ax, 2.50, az], [ax, 2.62, az], 0.025, 0.02, 8, BLACK, false, true);
            b.tube([[ax, 2.62, az], [ax - 0.04, 3.05, az], [ax - 0.12, 3.40, az]], 0.007, 5, BLACK);
        });

        /* Рым-болты на крыше */
        [[1.60, 0.85], [1.60, -0.85], [-1.70, 1.02], [-1.70, -1.02]].forEach(([x, z]) => {
            const y = roofY(x), L = [];
            for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI; L.push([x + Math.cos(a) * 0.05, y + Math.sin(a) * 0.06, z]); }
            b.tube(L, 0.014, 5, P8);
        });

        /* Дымовые гранатомёты M250 (по 6 труб на борт) */
        [1, -1].forEach(s => {
            const z = (wallZ(1.0, 2.04) + 0.02) * s;
            b.box([0.74, 1.94, Math.min(z - 0.06 * s, z + 0.05 * s)], [1.22, 2.14, Math.max(z - 0.06 * s, z + 0.05 * s)], P8);
            const d = V.norm([0.62, 0.42, 0.66 * s]);
            for (let r = 0; r < 2; r++) {
                for (let k = 0; k < 3; k++) {
                    const p0 = [0.82 + k * 0.16, 1.99 + r * 0.10, z + 0.05 * s];
                    b.cyl(p0, V.add(p0, V.mul(d, 0.18)), 0.036, 0.036, 10, P9, true, false);
                    b.annulus(V.add(p0, V.mul(d, 0.18)), d, 0.0, 0.026, 10, BLACK);
                    b.annulus(V.add(p0, V.mul(d, 0.18)), d, 0.026, 0.036, 10, P9);
                }
            }
        });

        /* Поручни-стеллажи вдоль бортов и корзина кормовой ниши */
        const rail = y => [[0.42, y, 1.68], [-1.95, y, 1.60], [-2.64, y, 1.50], [-2.64, y, -1.50], [-1.95, y, -1.60], [0.42, y, -1.68]];
        b.tube(rail(2.07), 0.022, 6, P8);
        b.tube(rail(2.34), 0.022, 6, P8);
        b.tube(rail(1.99).slice(1, 5), 0.018, 6, P8);
        [[0.42, 1.68], [-0.45, 1.65], [-1.20, 1.63], [-1.95, 1.60]].forEach(([x, z]) => {
            [1, -1].forEach(s => {
                b.cyl([x, 2.04, z * s], [x, 2.37, z * s], 0.018, 0.018, 6, P8, false, true);
                b.cyl([x, 2.07, z * s], [x, 2.07, (wallZ(x, 2.07) - 0.02) * s], 0.016, 0.016, 6, P8, false, false);
                b.cyl([x, 2.34, z * s], [x, 2.34, (wallZ(x, 2.34) - 0.02) * s], 0.016, 0.016, 6, P8, false, false);
            });
        });
        for (let z = -1.5; z <= 1.51; z += 0.5) b.cyl([-2.64, 1.97, z], [-2.64, 2.37, z], 0.018, 0.018, 6, P8, false, true);
        [-2.30].forEach(x => [1, -1].forEach(s => b.cyl([x, 1.97, 1.55 * s], [x, 2.37, 1.55 * s], 0.018, 0.018, 6, P8, false, true)));
        b.box([-2.64, 1.955, -1.50], [-2.10, 1.975, 1.50], P7);
        /* Укладка в корзине и в бортовых стеллажах */
        b.box([-2.60, 1.975, -1.40], [-2.20, 2.22, -0.60], CANVAS);
        b.box([-2.58, 1.975, -0.52], [-2.20, 2.30, 0.30], CANVAS2);
        b.box([-2.60, 1.975, 0.40], [-2.18, 2.16, 1.42], CANVAS);
        b.cyl([-2.55, 2.30, -1.38], [-2.55, 2.30, -0.55], 0.08, 0.08, 14, CANVAS2, true, true);
        b.cyl([-2.42, 2.24, 0.48], [-2.42, 2.24, 1.38], 0.07, 0.07, 14, [0.33, 0.33, 0.23, 1], true, true);
        [1, -1].forEach(s => {
            b.box([-1.85, 2.02, Math.min(1.42 * s, 1.62 * s)], [-0.55, 2.28, Math.max(1.42 * s, 1.62 * s)], s > 0 ? CANVAS : CANVAS2);
        });
        return b;
    }

    /* ---------------------------------------------------------------- *
     * Пушка: маска (качается) и ствол (качается + откат)
     * ---------------------------------------------------------------- */
    const GY = DIM.trunnion[1];
    function buildMantlet() {
        const b = new Builder();
        b.prismX([[-0.31, 1.58], [0.31, 1.58], [0.33, 1.63], [0.33, 2.15], [0.30, 2.20], [-0.30, 2.20], [-0.33, 2.15], [-0.33, 1.63]], 2.06, 2.32, P1);
        b.box([2.30, 1.64, -0.28], [2.37, 2.14, 0.28], P9);
        /* Спаренный пулемёт M240 — справа от пушки */
        b.cyl([2.30, 1.98, 0.25], [2.47, 1.98, 0.25], 0.032, 0.03, 10, P8, false, true);
        b.cyl([2.47, 1.98, 0.25], [2.58, 1.98, 0.25], 0.014, 0.014, 8, GUNMETAL, false, true);
        /* Окно прицела-дальномера / датчик */
        b.box([2.30, 2.04, -0.26], [2.385, 2.12, -0.14], P8);
        b.face([[2.386, 2.055, -0.25], [2.386, 2.055, -0.15], [2.386, 2.105, -0.15], [2.386, 2.105, -0.25]], GLASS, [2.34, 2.08, -0.2]);
        return b;
    }
    function buildBarrel() {
        const b = new Builder();
        const M = DIM.muzzle;
        /* Профиль по чертежу: термокожух с бандажами, эжектор, тонкая дульная часть */
        b.lathe([
            [2.20, 0], [2.20, 0.15], [2.36, 0.15], [2.36, 0.14], [2.42, 0.14], [2.42, 0.156], [2.49, 0.156], [2.49, 0.14],
            [2.90, 0.14], [2.90, 0.156], [2.98, 0.156], [2.98, 0.112], [3.28, 0.108],
            [3.36, 0.158], [3.90, 0.158], [3.98, 0.104],
            [4.56, 0.101], [4.56, 0.111], [4.62, 0.111], [4.62, 0.101],
            [5.20, 0.097], [5.20, 0.107], [5.26, 0.107], [5.26, 0.097],
            [M - 0.05, 0.094], [M - 0.05, 0.099], [M, 0.099], [M, 0.06]
        ], GY, 0, 28, P1);
        /* Канал ствола 120 мм */
        b.cyl([M - 0.35, GY, 0], [M + 0.001, GY, 0], 0.06, 0.06, 20, BLACK, true, false);
        /* Швы эжектора и термокожуха */
        b.cyl([3.62, GY, 0], [3.64, GY, 0], 0.161, 0.161, 28, P8, false, false);
        /* Датчик изгиба ствола (MRS) у дульного среза */
        b.box([M - 0.20, GY + 0.08, -0.03], [M - 0.10, GY + 0.135, 0.03], P8);
        b.box([2.98, GY + 0.105, -0.012], [M - 0.20, GY + 0.115, 0.012], P8);
        return b;
    }

    /* ---------------------------------------------------------------- *
     * Колёса (ось Z, внешняя сторона +Z)
     * ---------------------------------------------------------------- */
    function buildWheel(R, hubR, bolts, holes) {
        const b = new Builder();
        [[0.045, 0.19], [-0.19, -0.045]].forEach(([z0, z1]) => {
            b.cyl([0, 0, z0], [0, 0, z1], R, R, 32, RUBBER, false, false);
            b.annulus([0, 0, z1], [0, 0, 1], R - 0.05, R, 32, RUBBER);
            b.annulus([0, 0, z0], [0, 0, -1], R - 0.05, R, 32, RUBBER);
            b.cyl([0, 0, z0 + 0.012], [0, 0, z1 - 0.012], R - 0.05, R - 0.05, 32, P9, true, true);
            b.cyl([0, 0, z1 - 0.012], [0, 0, z1 - 0.004], R - 0.058, R - 0.062, 32, P8, false, false);
        });
        b.cyl([0, 0, 0.17], [0, 0, 0.215], hubR, hubR * 0.94, 20, P1, false, true);
        b.cyl([0, 0, 0.215], [0, 0, 0.24], hubR * 0.5, hubR * 0.42, 14, P8, false, true);
        for (let i = 0; i < bolts; i++) {
            const a = i / bolts * TAU, r = hubR * 0.74;
            b.cyl([Math.cos(a) * r, Math.sin(a) * r, 0.212], [Math.cos(a) * r, Math.sin(a) * r, 0.226], 0.014, 0.014, 6, DSTEEL, false, true);
        }
        for (let i = 0; i < holes; i++) {
            const a = (i + 0.5) / holes * TAU, r = (R - 0.05 + hubR) / 2;
            b.cyl([Math.cos(a) * r, Math.sin(a) * r, 0.176], [Math.cos(a) * r, Math.sin(a) * r, 0.18], 0.028, 0.028, 10, [0.05, 0.05, 0.05, 1], false, true);
        }
        b.cyl([0, 0, -0.22], [0, 0, 0.22], 0.075, 0.075, 12, P7, false, false);
        return b;
    }
    function buildSprocket() {
        const b = new Builder();
        b.cyl([0, 0, -0.17], [0, 0, 0.20], 0.20, 0.20, 24, P8, false, false);
        [-0.11, 0.11].forEach(zc => {
            b.cyl([0, 0, zc - 0.028], [0, 0, zc + 0.028], 0.255, 0.255, 33, P1, true, true);
            for (let i = 0; i < 11; i++) {
                b.M = M4.RZ(i / 11 * TAU);
                b.prismZ([[0.245, -0.05], [0.335, -0.022], [0.345, 0], [0.335, 0.022], [0.245, 0.05]], zc - 0.026, zc + 0.026, P1);
                b.M = null;
            }
        });
        b.cyl([0, 0, 0.20], [0, 0, 0.25], 0.13, 0.12, 18, P1, false, true);
        for (let i = 0; i < 8; i++) {
            const a = i / 8 * TAU;
            b.cyl([Math.cos(a) * 0.095, Math.sin(a) * 0.095, 0.245], [Math.cos(a) * 0.095, Math.sin(a) * 0.095, 0.262], 0.014, 0.014, 6, DSTEEL, false, true);
        }
        b.cyl([0, 0, 0.25], [0, 0, 0.29], 0.05, 0.04, 12, P8, false, true);
        return b;
    }

    /* ---------------------------------------------------------------- *
     * Обвод гусеницы: окружности в порядке обхода (против часовой, вид с +Z)
     * ---------------------------------------------------------------- */
    const LINK_OFF = 0.045;
    function trackPath() {
        const W = DIM.wheels, R = DIM.wheelR + LINK_OFF;
        const C = [
            [W[W.length - 1], DIM.wheelY, R],
            [W[0], DIM.wheelY, R],
            [DIM.idler[0], DIM.idler[1], R],
            [DIM.rollers[0][0], DIM.rollers[0][1], DIM.rollerR + LINK_OFF],
            [DIM.rollers[1][0], DIM.rollers[1][1], DIM.rollerR + LINK_OFF],
            [DIM.rollers[2][0], DIM.rollers[2][1], DIM.rollerR + LINK_OFF],
            [DIM.sprocket[0], DIM.sprocket[1], DIM.sprocketR + 0.02]
        ];
        const n = C.length, tin = new Array(n), tout = new Array(n), segs = [];
        for (let i = 0; i < n; i++) {
            const A = C[i], B = C[(i + 1) % n];
            const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy);
            const ux = dx / L, uy = dy / L, rx = uy, ry = -ux;
            const s = (A[2] - B[2]) / L, c = Math.sqrt(1 - s * s);
            const nx = rx * c + ux * s, ny = ry * c + uy * s;
            const ang = Math.atan2(ny, nx);
            tout[i] = ang; tin[(i + 1) % n] = ang;
            segs.push([[A[0] + nx * A[2], A[1] + ny * A[2]], [B[0] + nx * B[2], B[1] + ny * B[2]]]);
        }
        const el = [];
        let total = 0;
        for (let i = 0; i < n; i++) {
            let a0 = tin[i], a1 = tout[i];
            while (a1 < a0 - 1e-6) a1 += TAU;
            if (a1 < a0) a1 = a0;
            const arcL = (a1 - a0) * C[i][2];
            el.push({ type: "arc", c: C[i], a0, a1, s0: total, L: arcL }); total += arcL;
            const [p, q] = segs[i], sl = Math.hypot(q[0] - p[0], q[1] - p[1]);
            el.push({ type: "seg", p, q, s0: total, L: sl }); total += sl;
        }
        return {
            L: total,
            at(s) {
                s = ((s % total) + total) % total;
                for (let k = 0; k < el.length; k++) {
                    const e = el[k];
                    if (s <= e.s0 + e.L || k === el.length - 1) {
                        const t = (s - e.s0) / (e.L || 1);
                        if (e.type === "arc") {
                            const a = e.a0 + (e.a1 - e.a0) * t;
                            return [e.c[0] + Math.cos(a) * e.c[2], e.c[1] + Math.sin(a) * e.c[2], -Math.sin(a), Math.cos(a)];
                        }
                        const dx = e.q[0] - e.p[0], dy = e.q[1] - e.p[1], l = Math.hypot(dx, dy) || 1;
                        return [e.p[0] + dx * t, e.p[1] + dy * t, dx / l, dy / l];
                    }
                }
                return [0, 0, 1, 0];
            }
        };
    }
    /* Шаблон трака: u — вдоль гусеницы, n — наружу, w — поперёк */
    function buildLink() {
        const b = new Builder();
        b.box([-0.082, -0.04, -0.29], [0.082, 0.015, 0.29], [0.24, 0.225, 0.2, 1]);
        b.box([-0.066, 0.015, -0.275], [0.066, 0.05, -0.035], RUBBER);
        b.box([-0.066, 0.015, 0.035], [0.066, 0.05, 0.275], RUBBER);
        b.box([0.072, -0.03, 0.283], [0.112, 0.025, 0.33], STEEL);
        b.box([0.072, -0.03, -0.33], [0.112, 0.025, -0.283], STEEL);
        b.box([0.072, -0.03, -0.03], [0.112, 0.025, 0.03], STEEL);
        b.box([-0.068, -0.05, -0.25], [0.068, -0.04, -0.06], RUBBER);
        b.box([-0.068, -0.05, 0.06], [0.068, -0.04, 0.25], RUBBER);
        b.box([-0.032, -0.15, -0.022], [0.032, -0.04, 0.022], STEEL);
        return b;
    }

    /* ---------------------------------------------------------------- *
     * WebGL
     * ---------------------------------------------------------------- */
    const canvas = $("#aq-canvas");
    const fail = $("#aq-fail");
    let gl = null;
    try {
        gl = canvas.getContext("webgl", { antialias: true, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false })
            || canvas.getContext("experimental-webgl", { antialias: true, alpha: false });
    } catch (e) { gl = null; }
    if (!gl) {
        if (fail) fail.hidden = false;
        document.documentElement.classList.add("aq-no-webgl");
        return;
    }
    const UINT32 = !!gl.getExtension("OES_element_index_uint");
    const DERIV = !!gl.getExtension("OES_standard_derivatives");

    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
        return s;
    }
    function program(vs, fs) {
        const p = gl.createProgram();
        gl.attachShader(p, compile(gl.VERTEX_SHADER, "precision highp float;\n" + vs));
        gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
        const pr = { p, u: {}, a: {} };
        const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i); pr.u[info.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, info.name); }
        const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < na; i++) { const info = gl.getActiveAttrib(p, i); pr.a[info.name] = gl.getAttribLocation(p, info.name); }
        return pr;
    }
    function mkBuf(data, target, usage) {
        const buf = gl.createBuffer();
        gl.bindBuffer(target || gl.ARRAY_BUFFER, buf);
        gl.bufferData(target || gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
        return buf;
    }
    function upload(b, withLines, dynamic) {
        const big = b.count() > 65535;
        if (big && !UINT32) throw new Error("mesh too large");
        const m = {
            pos: mkBuf(new Float32Array(b.pos), gl.ARRAY_BUFFER, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW),
            nrm: mkBuf(new Float32Array(b.nrm), gl.ARRAY_BUFFER, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW),
            col: mkBuf(new Float32Array(b.col)),
            ibo: mkBuf(big ? new Uint32Array(b.idx) : new Uint16Array(b.idx), gl.ELEMENT_ARRAY_BUFFER),
            count: b.idx.length, itype: big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, verts: b.count()
        };
        if (withLines) {
            const L = featureEdges(b, 0.8);
            m.lines = { buf: mkBuf(new Float32Array(L)), count: L.length / 3 };
        }
        return m;
    }

    /* ----- Шейдеры ----- */
    const GLSL_SHADOW = `
uniform sampler2D uShadow;
uniform float uShadowRes;
float unpackD(vec4 c) { return dot(c, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
float shadowAt(vec4 sp, float ndl) {
    vec3 p = sp.xyz / sp.w * 0.5 + 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
    float bias = 0.0007 + 0.0022 * (1.0 - ndl);
    float t = 1.0 / uShadowRes, s = 0.0;
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            float d = unpackD(texture2D(uShadow, p.xy + vec2(float(x), float(y)) * t * 1.25));
            s += (p.z - bias > d) ? 0.0 : 1.0;
        }
    }
    return s / 9.0;
}
`;
    const GLSL_NOISE = `
float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 tonemap(vec3 c) { c = 1.0 - exp(-c * 1.15); return sqrt(c); }
`;
    const VS_MAIN = `
attribute vec3 aPos; attribute vec3 aNormal; attribute vec4 aColor;
uniform mat4 uVP; uniform mat4 uModel; uniform mat4 uLightVP;
varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec4 vC; varying vec4 vS;
void main() {
    vec4 w = uModel * vec4(aPos, 1.0);
    vW = w.xyz; vL = aPos; vC = aColor; vS = uLightVP * w;
    vN = mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNormal;
    gl_Position = uVP * w;
}`;
    const FS_MAIN = `precision highp float;
uniform vec3 uCam; uniform vec3 uViewDir; uniform float uOrtho;
uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform vec3 uGnd;
uniform vec3 uPaint; uniform vec3 uPaint2; uniform vec3 uPaint3; uniform float uCamo;
uniform vec3 uDust; uniform float uDirt; uniform float uBlue;
uniform vec3 uFog; uniform float uFogD;
uniform vec3 uFlashPos; uniform float uFlash; uniform float uSeed;
varying vec3 vW; varying vec3 vN; varying vec3 vL; varying vec4 vC; varying vec4 vS;
${GLSL_SHADOW}
${GLSL_NOISE}
void main() {
    vec3 N = normalize(vN);
    vec3 Vd = uOrtho > 0.5 ? -uViewDir : normalize(uCam - vW);
    if (dot(N, Vd) < -0.3) N = -N;
    float mat = vC.a;
    vec3 base = vC.rgb;
    float spec = 0.12, gloss = 22.0;
    if (mat < 0.5) {
        vec3 paint = uPaint;
        if (uCamo > 0.5) {
            vec3 q = vL + vec3(uSeed, 0.0, uSeed * 0.7);
            float n1 = noise3(q * vec3(0.75, 1.1, 0.75)) + 0.45 * noise3(q * 1.9 + 3.7);
            float n2 = noise3(q * vec3(0.9, 1.0, 0.9) + vec3(11.0, 5.0, 2.0)) + 0.45 * noise3(q * 2.2 + 7.0);
            if (n1 > 0.86) paint = uPaint2;
            if (n2 > 1.0) paint = uPaint3;
        }
        base *= paint;
        float g = noise3(vL * 9.0) * 0.06 - 0.03;
        base *= 1.0 + g;
        float dirt = (1.0 - smoothstep(0.15, 1.45, vW.y)) * uDirt * (0.75 + 0.5 * noise3(vL * 3.0));
        base = mix(base, uDust, clamp(dirt, 0.0, 1.0) * 0.6);
    } else if (mat < 1.5) {
        spec = 0.05; gloss = 14.0;
    } else if (mat < 2.5) {
        float k = uBlue > 0.5 ? 0.0 : 1.0;
        gl_FragColor = vec4(mix(vec3(0.75, 0.88, 1.0), base * 1.25, k), 1.0);
        return;
    } else {
        spec = 1.1; gloss = 90.0;
    }
    vec3 alb = base * base;
    float ndl = max(dot(N, uSun), 0.0);
    float sh = shadowAt(vS, ndl);
    vec3 H = normalize(uSun + Vd);
    float sp = pow(max(dot(N, H), 0.0), gloss) * spec * sh * step(0.001, ndl);
    vec3 amb = mix(uGnd, uSky, N.y * 0.5 + 0.5);
    float ao = 0.45 + 0.55 * smoothstep(0.05, 1.4, vW.y);
    vec3 col = alb * (amb * ao + uSunCol * ndl * sh) + uSunCol * sp;
    vec3 fl = uFlashPos - vW; float fd = length(fl);
    col += alb * vec3(1.0, 0.62, 0.28) * uFlash * max(dot(N, fl / max(fd, 0.001)), 0.0) * 14.0 / (1.0 + fd * fd);
    col += amb * pow(1.0 - max(dot(N, Vd), 0.0), 4.0) * 0.06;
    float f = 1.0 - exp(-length(uCam - vW) * uFogD);
    col = mix(col, uFog, f);
    if (uBlue > 0.5) {
        float l = 0.30 + 0.45 * max(dot(N, normalize(vec3(0.35, 0.8, 0.5))), 0.0) + 0.12 * N.y + 0.1 * sh;
        vec3 bp = mix(vec3(0.045, 0.16, 0.38), vec3(0.17, 0.38, 0.70), l);
        gl_FragColor = vec4(bp, 1.0);
        return;
    }
    gl_FragColor = vec4(tonemap(col), 1.0);
}`;
    const VS_SHADOW = `
attribute vec3 aPos;
uniform mat4 uLightVP; uniform mat4 uModel;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.0); }`;
    const FS_SHADOW = `precision highp float;
vec4 packD(float d) {
    vec4 e = fract(d * vec4(1.0, 255.0, 65025.0, 16581375.0));
    e -= e.yzww * vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
    return e;
}
void main() { gl_FragColor = packD(gl_FragCoord.z); }`;
    const VS_GROUND = `
attribute vec3 aPos;
uniform mat4 uVP; uniform mat4 uLightVP;
varying vec3 vW; varying vec4 vS;
void main() { vW = aPos; vS = uLightVP * vec4(aPos, 1.0); gl_Position = uVP * vec4(aPos, 1.0); }`;
    const FS_GROUND = (DERIV ? "#extension GL_OES_standard_derivatives : enable\n" : "") + `precision highp float;
uniform vec3 uCam; uniform vec3 uSun; uniform vec3 uSunCol; uniform vec3 uSky; uniform float uOrtho;
uniform vec3 uG1; uniform vec3 uG2; uniform vec3 uG3; uniform float uGType;
uniform float uScroll; uniform float uTrail; uniform float uBlue;
uniform vec3 uFog; uniform float uFogD; uniform vec3 uFlashPos; uniform float uFlash;
varying vec3 vW; varying vec4 vS;
${GLSL_SHADOW}
${GLSL_NOISE}
float gridLine(vec2 p, float step, float w) {
    vec2 g = p / step;
    ${DERIV ? "vec2 fw = fwidth(g);" : "vec2 fw = vec2(0.02);"}
    vec2 a = abs(fract(g - 0.5) - 0.5) / max(fw, vec2(0.0001));
    return 1.0 - clamp(min(a.x, a.y) - w, 0.0, 1.0);
}
void main() {
    vec2 p = vec2(vW.x + uScroll, vW.z);
    float dist = length(uCam.xz - vW.xz);
    if (uBlue > 0.5) {
        vec3 c = vec3(0.06, 0.20, 0.44);
        float g1 = gridLine(vW.xz, 0.5, 0.0), g2 = gridLine(vW.xz, 2.0, 0.4);
        c = mix(c, vec3(0.30, 0.50, 0.80), g1 * 0.35 * (1.0 - smoothstep(10.0, 40.0, dist)));
        c = mix(c, vec3(0.62, 0.78, 1.0), g2 * 0.5 * (1.0 - smoothstep(20.0, 70.0, dist)));
        float sh = shadowAt(vS, 1.0);
        c *= 0.72 + 0.28 * sh;
        gl_FragColor = vec4(c, 1.0);
        return;
    }
    float n = noise3(vec3(p * 0.12, 0.0)) * 0.6 + noise3(vec3(p * 0.5, 3.0)) * 0.3 + noise3(vec3(p * 2.3, 7.0)) * 0.1;
    vec3 c = mix(uG1, uG2, smoothstep(0.25, 0.75, n));
    if (uGType < 0.5) {
        float rip = sin(p.x * 2.6 + p.y * 0.8 + noise3(vec3(p * 0.6, 1.0)) * 5.0);
        c *= 0.96 + 0.04 * rip;
    } else {
        float gr = noise3(vec3(p * 7.0, 2.0));
        c = mix(c, uG3, smoothstep(0.55, 0.85, gr) * 0.6);
    }
    c *= 0.94 + 0.12 * noise3(vec3(p * 5.0, 5.0));
    float tz = abs(vW.z);
    float band = smoothstep(1.10, 1.14, tz) * (1.0 - smoothstep(1.70, 1.74, tz));
    float behind = 1.0 - smoothstep(2.4, 2.8, vW.x);
    float reach = 1.0 - smoothstep(uTrail - 1.0, uTrail + 1.0, 2.6 - vW.x);
    float tread = 0.55 + 0.45 * step(0.45, fract(p.x / 0.19));
    float trail = band * behind * reach * (1.0 - smoothstep(25.0, 140.0, -vW.x));
    c = mix(c, c * (uGType < 0.5 ? 0.72 : 0.6), trail * tread);
    vec2 q = abs(vec2(vW.x - 0.0, vW.z)) - vec2(3.75, 1.78);
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float ao = mix(0.38, 1.0, smoothstep(-0.4, 1.4, sd));
    vec3 alb = c * c;
    float sh = shadowAt(vS, uSun.y);
    vec3 col = alb * (uSky * 0.55 * ao + uSunCol * uSun.y * sh * mix(0.8, 1.0, ao));
    vec3 fl = uFlashPos - vW; float fd = length(fl);
    col += alb * vec3(1.0, 0.62, 0.28) * uFlash * 10.0 / (1.0 + fd * fd);
    float f = 1.0 - exp(-dist * uFogD);
    col = mix(col, uFog, clamp(f, 0.0, 1.0));
    gl_FragColor = vec4(tonemap(col), 1.0);
}`;
    const VS_SKY = `
attribute vec2 aPos;
varying vec2 vP;
void main() { vP = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;
    const FS_SKY = `precision highp float;
uniform mat4 uIVP; uniform vec3 uSun; uniform vec3 uFog; uniform vec3 uSkyTop; uniform float uBlue; uniform float uOrtho;
varying vec2 vP;
${GLSL_NOISE}
void main() {
    if (uBlue > 0.5) {
        vec3 c = mix(vec3(0.05, 0.17, 0.38), vec3(0.03, 0.10, 0.25), vP.y * 0.5 + 0.5);
        gl_FragColor = vec4(c, 1.0);
        return;
    }
    vec4 a = uIVP * vec4(vP, -1.0, 1.0), b = uIVP * vec4(vP, 1.0, 1.0);
    vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
    float h = uOrtho > 0.5 ? vP.y * 0.5 + 0.2 : d.y;
    vec3 c = mix(uFog, uSkyTop, smoothstep(0.0, 0.55, h));
    c = mix(c, uFog * 0.9, smoothstep(0.0, -0.2, h));
    float s = max(dot(d, uSun), 0.0);
    c += vec3(1.0, 0.85, 0.6) * (pow(s, 600.0) * 4.0 + pow(s, 12.0) * 0.12) * (1.0 - uOrtho);
    gl_FragColor = vec4(tonemap(c), 1.0);
}`;
    const VS_LINE = `
attribute vec3 aPos;
uniform mat4 uVP; uniform mat4 uModel;
void main() { gl_Position = uVP * uModel * vec4(aPos, 1.0); }`;
    const FS_LINE = `precision highp float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }`;
    const VS_PART = `
attribute vec3 aPos; attribute float aSize; attribute vec4 aCol;
uniform mat4 uVP; uniform float uPointScale; uniform float uOrtho; uniform float uMaxPt;
varying vec4 vCol;
void main() {
    gl_Position = uVP * vec4(aPos, 1.0);
    float w = uOrtho > 0.5 ? 1.0 : gl_Position.w;
    gl_PointSize = clamp(aSize * uPointScale / max(w, 0.1), 1.0, uMaxPt);
    vCol = aCol;
}`;
    const FS_PART = `precision highp float;
varying vec4 vCol;
void main() {
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r = dot(q, q);
    if (r > 1.0) discard;
    float a = (1.0 - r);
    a *= a;
    gl_FragColor = vec4(vCol.rgb, vCol.a * a);
}`;

    let PR;
    try {
        PR = {
            main: program(VS_MAIN, FS_MAIN),
            shadow: program(VS_SHADOW, FS_SHADOW),
            ground: program(VS_GROUND, FS_GROUND),
            sky: program(VS_SKY, FS_SKY),
            line: program(VS_LINE, FS_LINE),
            part: program(VS_PART, FS_PART)
        };
    } catch (err) {
        if (fail) { fail.hidden = false; const m = $("#aq-fail-msg"); if (m) m.textContent = String(err.message || err).slice(0, 400); }
        throw err;
    }

    /* ----- Меши ----- */
    const hullB = buildHull(), turretB = buildTurret(), mantB = buildMantlet(), barrelB = buildBarrel();
    const MESH = {
        hull: upload(hullB, true),
        turret: upload(turretB, true),
        mantlet: upload(mantB, true),
        barrel: upload(barrelB, true),
        wheel: upload(buildWheel(DIM.wheelR, 0.115, 10, 6), true),
        idler: upload(buildWheel(DIM.wheelR, 0.13, 8, 0), true),
        roller: upload(buildWheel(DIM.rollerR, 0.05, 0, 0), true),
        sprocket: upload(buildSprocket(), true)
    };

    /* Гусеницы: динамический меш из траков (обе стороны) */
    const PATH = trackPath();
    const LINKS = Math.round(PATH.L / 0.19);
    const PITCH = PATH.L / LINKS;
    const linkB = buildLink();
    const LV = linkB.count();
    const track = (function () {
        const total = LINKS * 2;
        const b = new Builder();
        for (let k = 0; k < total; k++) {
            const base = b.count();
            for (let i = 0; i < LV; i++) {
                b.pos.push(0, 0, 0); b.nrm.push(0, 1, 0);
                b.col.push(linkB.col[i * 4], linkB.col[i * 4 + 1], linkB.col[i * 4 + 2], linkB.col[i * 4 + 3]);
            }
            linkB.idx.forEach(ix => b.idx.push(base + ix));
        }
        const m = upload(b, false, true);
        m.P = new Float32Array(total * LV * 3);
        m.N = new Float32Array(total * LV * 3);
        return m;
    })();
    let lastTrackOff = NaN;
    function updateTrack(off) {
        if (off === lastTrackOff) return;
        lastTrackOff = off;
        const P = track.P, N = track.N, lp = linkB.pos, ln = linkB.nrm;
        let o = 0;
        [DIM.trackZ, -DIM.trackZ].forEach(zc => {
            for (let k = 0; k < LINKS; k++) {
                const f = PATH.at(k * PITCH + off);
                const px = f[0], py = f[1], tx = f[2], ty = f[3], nx = ty, ny = -tx;
                for (let i = 0; i < LV; i++) {
                    const u = lp[i * 3], n = lp[i * 3 + 1], w = lp[i * 3 + 2];
                    P[o] = px + tx * u + nx * n; P[o + 1] = py + ty * u + ny * n; P[o + 2] = zc + w;
                    const nu = ln[i * 3], nn = ln[i * 3 + 1], nw = ln[i * 3 + 2];
                    N[o] = tx * nu + nx * nn; N[o + 1] = ty * nu + ny * nn; N[o + 2] = nw;
                    o += 3;
                }
            }
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, track.pos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, P);
        gl.bindBuffer(gl.ARRAY_BUFFER, track.nrm); gl.bufferSubData(gl.ARRAY_BUFFER, 0, N);
    }

    /* Земля, небо */
    const G = 260;
    const groundBuf = mkBuf(new Float32Array([-G, 0, -G, G, 0, -G, G, 0, G, -G, 0, -G, G, 0, G, -G, 0, G]));
    const skyBuf = mkBuf(new Float32Array([-1, -1, 3, -1, -1, 3]));

    /* Размерные линии (статичны) */
    const dimLines = (function () {
        const L = [], y = 0.02, tick = (x, z, h) => { L.push(x, y, z, x, h, z); };
        const zL = -2.55, zH = -3.25, xW = 6.55, xHt = -4.4, zHt = 2.15;
        L.push(DIM.rear, y, zL, DIM.muzzle, y, zL); tick(DIM.rear, zL, 0.35); tick(DIM.muzzle, zL, 0.35);
        L.push(DIM.rear, y, zL, DIM.rear, y, -1.9); L.push(DIM.muzzle, y, zL, DIM.muzzle, y, -0.3);
        L.push(DIM.rear, y, zH, DIM.nose, y, zH); tick(DIM.rear, zH, 0.3); tick(DIM.nose, zH, 0.3);
        L.push(DIM.nose, y, zH, DIM.nose, y, -1.9); L.push(DIM.rear, y, zH, DIM.rear, y, zL);
        L.push(xW, y, -DIM.skirt, xW, y, DIM.skirt); L.push(xW, y, -DIM.skirt, 3.9, y, -DIM.skirt); L.push(xW, y, DIM.skirt, 3.9, y, DIM.skirt);
        L.push(xHt, 0, zHt, xHt, DIM.roof, zHt); L.push(xHt - 0.15, DIM.roof, zHt, -1.9, DIM.roof, zHt * 0.7); L.push(xHt - 0.15, 0.001, zHt, xHt + 0.15, 0.001, zHt);
        return { buf: mkBuf(new Float32Array(L)), count: L.length / 3 };
    })();

    /* Тени: RGBA-текстура с упакованной глубиной */
    const SHADOW_RES = 2048;
    const shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SHADOW_RES, SHADOW_RES, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const shadowFbo = gl.createFramebuffer();
    const shadowRb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, shadowRb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SHADOW_RES, SHADOW_RES);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, shadowTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, shadowRb);
    const SHADOW_OK = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!SHADOW_OK) {
        gl.bindTexture(gl.TEXTURE_2D, shadowTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    }
    const MAX_PT = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1];

    /* Частицы */
    const MAX_PARTS = 900;
    const partData = new Float32Array(MAX_PARTS * 8);
    const partBuf = mkBuf(partData, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    const parts = [];
    function spawn(o) {
        if (parts.length >= MAX_PARTS) parts.shift();
        parts.push(Object.assign({ v: [0, 0, 0], life: 0, max: 1, size: 0.5, grow: 0, col: [1, 1, 1], a: 0.6, add: false, drag: 0.5, lift: 0 }, o));
    }

    /* ---------------------------------------------------------------- *
     * Окружение и окраска
     * ---------------------------------------------------------------- */
    const CAMOS = [
        { name: "ПУСТЫНЯ", label: "Пустынный CARC 686A (tan)", paint: [0.72, 0.62, 0.45], p2: [0.72, 0.62, 0.45], p3: [0.72, 0.62, 0.45], camo: 0, env: 0 },
        { name: "ЛЕС", label: "Зелёный CARC 383 (NATO green)", paint: [0.30, 0.34, 0.21], p2: [0.30, 0.34, 0.21], p3: [0.30, 0.34, 0.21], camo: 0, env: 1 },
        { name: "НАТО-3", label: "Трёхцветный камуфляж НАТО", paint: [0.30, 0.34, 0.21], p2: [0.36, 0.27, 0.18], p3: [0.10, 0.10, 0.09], camo: 1, env: 1 }
    ];
    const ENVS = [
        { sky: [0.52, 0.62, 0.78], top: [0.30, 0.52, 0.84], fog: [0.86, 0.80, 0.70], gnd: [0.42, 0.36, 0.28], sun: [2.15, 1.95, 1.65],
            g1: [0.74, 0.62, 0.45], g2: [0.66, 0.54, 0.38], g3: [0.56, 0.47, 0.34], gtype: 0, dust: [0.80, 0.70, 0.54], dirt: 0.75, puff: [0.80, 0.70, 0.55] },
        { sky: [0.50, 0.60, 0.72], top: [0.33, 0.50, 0.76], fog: [0.74, 0.78, 0.78], gnd: [0.25, 0.27, 0.18], sun: [2.0, 1.9, 1.7],
            g1: [0.38, 0.42, 0.24], g2: [0.44, 0.40, 0.28], g3: [0.30, 0.36, 0.18], gtype: 1, dust: [0.40, 0.34, 0.25], dirt: 0.7, puff: [0.46, 0.40, 0.31] }
    ];
    const SUN = V.norm([0.42, 0.78, 0.46]);
    const lightVP = (function () {
        const c = [0.6, 1.0, 0];
        const e = V.add(c, V.mul(SUN, 30));
        return M4.mul(M4.ortho(-8, 8, -8, 8, 5, 60), M4.lookAt(e, c, [0, 1, 0]));
    })();
    const VIEWS = [
        { id: "3d", name: "3D" }, { id: "side", name: "СБОКУ" }, { id: "front", name: "СПЕРЕДИ" },
        { id: "top", name: "СВЕРХУ" }, { id: "rear", name: "СЗАДИ" }
    ];

    /* ---------------------------------------------------------------- *
     * Состояние
     * ---------------------------------------------------------------- */
    const DEFAULT_VIEW = { yaw: 0.78, pitch: 0.2, dist: 14 };
    const state = {
        yaw: DEFAULT_VIEW.yaw, pitch: DEFAULT_VIEW.pitch, dist: DEFAULT_VIEW.dist, vYaw: 0, vPitch: 0,
        target: [0.75, 1.15, 0], autoRotate: true, lastInteract: -10, time: 0,
        view: 0, camo: 0, blue: false, dims: false, sound: true,
        az: 0, azT: 0, el: 0, elT: 0, speed: 0, speedT: 0, accel: 0, odo: 0, driven: 0,
        recoilT: 9, reload: 0, flash: 0, shake: 0,
        rock: { p: 0, pv: 0, r: 0, rv: 0 }, susp: 0, turretMoving: 0,
        w: 1, h: 1, dpr: 1, fps: 0, seed: 0
    };
    const keys = new Set();

    function load() {
        try {
            const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
            if (!s || typeof s !== "object") return;
            if (s.camo >= 0 && s.camo < CAMOS.length) state.camo = s.camo | 0;
            if (typeof s.sound === "boolean") state.sound = s.sound;
            if (typeof s.auto === "boolean") state.autoRotate = s.auto;
            if (typeof s.blue === "boolean") state.blue = s.blue;
            if (typeof s.dims === "boolean") state.dims = s.dims;
        } catch (e) { /* приватный режим */ }
    }
    function save() {
        try { localStorage.setItem(STORE_KEY, JSON.stringify({ camo: state.camo, sound: state.sound, auto: state.autoRotate, blue: state.blue, dims: state.dims })); } catch (e) { /* ignore */ }
    }

    /* ---------------------------------------------------------------- *
     * Звук: свист газотурбинного AGT-1500, лязг траков, выстрел
     * ---------------------------------------------------------------- */
    let AC = null, master = null, au = null;
    function ensureAudio() {
        if (!state.sound) return;
        if (!AC) {
            try {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                AC = new Ctx();
                setupAudio();
            } catch (e) { AC = null; return; }
        }
        if (AC.state === "suspended") AC.resume().catch(() => {});
    }
    function noiseBuf(sec) {
        const n = Math.floor(AC.sampleRate * sec), buf = AC.createBuffer(1, n, AC.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }
    function setupAudio() {
        master = AC.createGain(); master.gain.value = state.sound ? 0.55 : 0; master.connect(AC.destination);
        const nb = noiseBuf(2);
        const mk = (type, f) => { const o = AC.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };
        const gain = v => { const g = AC.createGain(); g.gain.value = v; return g; };
        const filt = (type, f, q) => { const b = AC.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.7; return b; };
        const loopNoise = () => { const s = AC.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
        au = { nb };
        /* Турбина: два тона + полосовой фильтр */
        au.t1 = mk("sawtooth", 820); au.t2 = mk("sine", 1640);
        au.tf = filt("bandpass", 1500, 5); au.tg = gain(0.0);
        au.t1.connect(au.tf); au.t2.connect(au.tf); au.tf.connect(au.tg); au.tg.connect(master);
        /* Воздух / свист */
        au.wn = loopNoise(); au.wf = filt("bandpass", 3200, 1.2); au.wg = gain(0.0);
        au.wn.connect(au.wf); au.wf.connect(au.wg); au.wg.connect(master);
        /* Рокот */
        au.rn = loopNoise(); au.rf = filt("lowpass", 140, 0.9); au.rg = gain(0.0);
        au.rn.connect(au.rf); au.rf.connect(au.rg); au.rg.connect(master);
        /* Лязг траков */
        au.c = mk("square", 20); au.cf = filt("bandpass", 520, 2.5); au.cg = gain(0.0);
        au.c.connect(au.cf); au.cf.connect(au.cg); au.cg.connect(master);
        /* Гидравлика башни */
        au.h = mk("triangle", 150); au.hf = filt("lowpass", 600, 1); au.hg = gain(0.0);
        au.h.connect(au.hf); au.hf.connect(au.hg); au.hg.connect(master);
        /* Эхо для выстрела */
        au.dl = AC.createDelay(1.0); au.dl.delayTime.value = 0.38;
        au.df = filt("lowpass", 900, 0.7); au.dg = gain(0.32);
        au.dl.connect(au.df); au.df.connect(au.dg); au.dg.connect(au.dl); au.dg.connect(master);
    }
    function updateAudio(dt) {
        if (!AC || !au) return;
        const t = AC.currentTime, k = clamp(Math.abs(state.speed) / 18.6, 0, 1), acc = clamp(Math.abs(state.accel) / 2, 0, 1);
        const set = (p, v) => p.setTargetAtTime(v, t, 0.12);
        set(au.t1.frequency, 760 + 820 * k + 160 * acc); set(au.t2.frequency, 1520 + 1640 * k + 320 * acc);
        set(au.tf.frequency, 1400 + 1200 * k);
        set(au.tg.gain, 0.018 + 0.03 * k + 0.012 * acc);
        set(au.wg.gain, 0.012 + 0.03 * k);
        set(au.rg.gain, 0.05 + 0.32 * k);
        set(au.c.frequency, Math.max(2, Math.abs(state.speed) / PITCH * 0.5));
        set(au.cg.gain, 0.06 * clamp(k * 4, 0, 1));
        set(au.hg.gain, state.turretMoving > 0.01 ? 0.05 : 0);
        void dt;
    }
    function sfxFire() {
        if (!AC || !au || !state.sound) return;
        const t = AC.currentTime;
        const s = AC.createBufferSource(); s.buffer = au.nb;
        const f = AC.createBiquadFilter(); f.type = "lowpass"; f.frequency.setValueAtTime(7000, t); f.frequency.exponentialRampToValueAtTime(180, t + 1.2);
        const g = AC.createGain(); g.gain.setValueAtTime(1.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
        s.connect(f); f.connect(g); g.connect(master); g.connect(au.dl); s.start(t); s.stop(t + 2);
        const o = AC.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
        const og = AC.createGain(); og.gain.setValueAtTime(1.2, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.9);
    }
    function sfxClank() {
        if (!AC || !au || !state.sound) return;
        const t = AC.currentTime;
        [[880, 0], [610, 0.09], [1250, 0.16]].forEach(([fq, d]) => {
            const o = AC.createOscillator(); o.type = "square"; o.frequency.value = fq;
            const bf = AC.createBiquadFilter(); bf.type = "bandpass"; bf.frequency.value = fq * 1.5; bf.Q.value = 8;
            const g = AC.createGain(); g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.25, t + d + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.12);
            o.connect(bf); bf.connect(g); g.connect(master); o.start(t + d); o.stop(t + d + 0.15);
        });
    }
    function setSound(on) {
        state.sound = on;
        if (on) ensureAudio();
        if (master && AC) master.gain.setTargetAtTime(on ? 0.55 : 0, AC.currentTime, 0.05);
        paintToggles(); save();
    }

    /* ---------------------------------------------------------------- *
     * Кинематика: матрицы корпуса, башни, пушки, колёс
     * ---------------------------------------------------------------- */
    const X = {};
    function kinematics() {
        const bob = Math.sin(state.time * 19) * 0.004 * clamp(Math.abs(state.speed) / 10, 0, 1) + Math.sin(state.time * 7.3) * 0.0025 * clamp(Math.abs(state.speed) / 10, 0, 1);
        X.hull = M4.chain(M4.T(0, bob, 0), M4.about([0, 0.8, 0], M4.mul(M4.RZ(state.susp + state.rock.p), M4.RX(state.rock.r))));
        X.turret = M4.mul(X.hull, M4.about([DIM.pivot, 0, 0], M4.RY(-state.az * DEG)));
        X.gun = M4.mul(X.turret, M4.about([DIM.trunnion[0], DIM.trunnion[1], 0], M4.RZ(state.el * DEG)));
        const t = state.recoilT, rec = t < 0.035 ? 0.34 * (t / 0.035) : 0.34 * Math.exp(-(t - 0.035) * 4.2);
        X.barrel = M4.mul(X.gun, M4.T(-rec, 0, 0));
        X.recoil = rec;
    }
    function wheelM(x, y, z, ang) {
        return z > 0 ? M4.chain(M4.T(x, y, z), M4.RZ(ang)) : M4.chain(M4.T(x, y, z), M4.S(1, 1, -1), M4.RZ(ang));
    }
    function drawList() {
        const L = [
            { m: MESH.hull, M: X.hull }, { m: MESH.turret, M: X.turret },
            { m: MESH.mantlet, M: X.gun }, { m: MESH.barrel, M: X.barrel },
            { m: track, M: M4.ident() }
        ];
        const o = state.odo;
        [DIM.trackZ, -DIM.trackZ].forEach(z => {
            DIM.wheels.forEach(x => L.push({ m: MESH.wheel, M: wheelM(x, DIM.wheelY, z, -o / DIM.wheelR) }));
            L.push({ m: MESH.idler, M: wheelM(DIM.idler[0], DIM.idler[1], z, -o / DIM.wheelR) });
            DIM.rollers.forEach(([x, y]) => L.push({ m: MESH.roller, M: wheelM(x, y, z, -o / DIM.rollerR) }));
            L.push({ m: MESH.sprocket, M: wheelM(DIM.sprocket[0], DIM.sprocket[1], z, -o / (DIM.sprocketR + 0.02)) });
        });
        return L;
    }

    /* ---------------------------------------------------------------- *
     * Камера
     * ---------------------------------------------------------------- */
    function camFit() { return Math.max(12.5, 5.7 / (Math.tan(16 * DEG) * Math.max(0.3, state.w / state.h))); }
    function camMin() { return 4.5; }
    function camMax() { return Math.max(30, camFit() * 1.8); }
    function computeCamera() {
        const v = VIEWS[state.view].id, aspect = state.w / state.h;
        const sh = state.shake, jx = (Math.random() - 0.5) * sh * 0.12, jy = (Math.random() - 0.5) * sh * 0.12;
        state.ortho = v !== "3d";
        if (!state.ortho) {
            const cp = Math.cos(state.pitch);
            const t = [state.target[0] + jx, state.target[1] + jy, state.target[2]];
            state.cam = [t[0] + state.dist * cp * Math.cos(state.yaw), t[1] + state.dist * Math.sin(state.pitch), t[2] + state.dist * cp * Math.sin(state.yaw)];
            state.proj = M4.persp(32 * DEG, aspect, 0.1, 400);
            state.view_ = M4.lookAt(state.cam, t, [0, 1, 0]);
            state.pointScale = state.h / (2 * Math.tan(16 * DEG));
            state.fogD = 0.0045;
        } else {
            let eye, c, up = [0, 1, 0], w, h;
            if (v === "side") { c = [0.95, 1.65, 0]; eye = [0.95, 1.65, -60]; w = 10.2; h = 3.8; }
            else if (v === "front") { c = [0, 1.65, 0]; eye = [60, 1.65, 0]; w = 4.2; h = 3.8; }
            else if (v === "rear") { c = [0, 1.65, 0]; eye = [-60, 1.65, 0]; w = 4.2; h = 3.8; }
            else { c = [0.95, 0, 0]; eye = [0.95, 60, 0]; up = [0, 0, 1]; w = 10.2; h = 4.0; }
            c = [c[0] + jx, c[1] + jy, c[2]]; eye = [eye[0] + jx, eye[1] + jy, eye[2]];
            const hh = Math.max(h / 2, w / 2 / aspect) * 1.14 * (state.orthoZoom || 1);
            state.cam = eye;
            state.proj = M4.ortho(-hh * aspect, hh * aspect, -hh, hh, 1, 140);
            state.view_ = M4.lookAt(eye, c, up);
            state.pointScale = state.h / (2 * hh);
            state.fogD = 0.0;
            state.viewDir = V.norm(V.sub(c, eye));
        }
        if (!state.ortho) state.viewDir = V.norm(V.sub(state.target, state.cam));
        state.vp = M4.mul(state.proj, state.view_);
        state.ivp = M4.invert(state.vp);
    }
    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr)), h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        state.w = w; state.h = h; state.dpr = dpr;
        DEFAULT_VIEW.dist = camFit();
        state.dist = clamp(state.dist, camMin(), camMax());
    }
    function resetView() {
        state.view = 0; state.orthoZoom = 1;
        state.yaw = DEFAULT_VIEW.yaw; state.pitch = DEFAULT_VIEW.pitch; state.dist = DEFAULT_VIEW.dist;
        state.vYaw = 0; state.vPitch = 0;
        paintToggles();
    }

    /* ---------------------------------------------------------------- *
     * Действия: выстрел и пр.
     * ---------------------------------------------------------------- */
    function muzzleFrame() {
        const p = M4.xf(X.barrel, [DIM.muzzle, GY, 0]);
        const q = M4.xf(X.barrel, [DIM.muzzle + 1, GY, 0]);
        return { p, d: V.norm(V.sub(q, p)) };
    }
    function fire() {
        if (state.reload > 0) { toast(`Заряжание… ${state.reload.toFixed(1)} с`); return false; }
        ensureAudio();
        state.recoilT = 0; state.reload = 4.0; state.flash = 1; state.shake = 1;
        const a = state.az * DEG;
        state.rock.pv += 0.22 * Math.cos(a) * Math.cos(state.el * DEG);
        state.rock.rv += -0.22 * Math.sin(a);
        kinematics();
        const { p, d } = muzzleFrame();
        state.flashPos = p;
        const env = ENVS[CAMOS[state.camo].env];
        spawn({ p: V.add(p, V.mul(d, 0.6)), max: 0.12, size: 3.2, grow: 6, col: [1.0, 0.75, 0.35], a: 1, add: true, drag: 0 });
        spawn({ p: V.add(p, V.mul(d, 1.6)), max: 0.09, size: 2.2, grow: 4, col: [1.0, 0.85, 0.5], a: 1, add: true, drag: 0 });
        for (let i = 0; i < 14; i++) {
            const s = V.norm([d[0] + rand(-0.6, 0.6), d[1] + rand(-0.4, 0.5), d[2] + rand(-0.6, 0.6)]);
            spawn({ p: V.add(p, V.mul(d, 0.3)), v: V.mul(s, rand(6, 16)), max: rand(0.08, 0.2), size: rand(0.5, 1.1), col: [1, 0.6, 0.2], a: 0.9, add: true, drag: 4 });
        }
        for (let i = 0; i < 34; i++) {
            const sp = rand(1, 14), side = V.norm(V.cross(d, [0, 1, 0]));
            const v = V.add(V.mul(d, sp), V.add(V.mul(side, rand(-3, 3)), [0, rand(-0.5, 2), 0]));
            spawn({ p: V.add(p, V.mul(d, rand(0, 1.5))), v, max: rand(2.5, 5), size: rand(0.9, 1.7), grow: rand(1.4, 2.6), col: [0.74, 0.72, 0.68], a: rand(0.4, 0.62), drag: 2.2, lift: 0.4 });
        }
        /* Пыль от ударной волны */
        const gp = [p[0] + d[0] * 2.5, 0.1, p[2] + d[2] * 2.5];
        for (let i = 0; i < 26; i++) {
            const a2 = rand(0, TAU), sp = rand(2, 7);
            spawn({ p: [gp[0] + rand(-0.5, 0.5), 0.1, gp[2] + rand(-0.5, 0.5)], v: [Math.cos(a2) * sp + d[0] * 3, rand(0.3, 1.5), Math.sin(a2) * sp + d[2] * 3], max: rand(2, 3.5), size: rand(0.8, 1.5), grow: 1.5, col: env.puff, a: 0.35, drag: 1.8, lift: 0.1 });
        }
        /* Трассер снаряда */
        spawn({ p: V.add(p, V.mul(d, 1)), v: V.mul(d, 260), max: 0.5, size: 0.5, col: [1, 0.9, 0.6], a: 1, add: true, drag: 0 });
        sfxFire();
        if (hint) hint.classList.add("is-hidden");
        return true;
    }
    function setDrive(on) {
        state.speedT = on ? (state.speedT > 0.1 ? state.speedT : 30 / 3.6) : 0;
        syncSliders(true); paintToggles();
    }
    function cycleView(dir) {
        state.view = (state.view + (dir || 1) + VIEWS.length) % VIEWS.length;
        state.orthoZoom = 1;
        paintToggles();
        toast(state.view === 0 ? "Перспектива 3D" : `Ортогональный вид: ${VIEWS[state.view].name.toLowerCase()} — как на чертеже`);
    }

    /* ---------------------------------------------------------------- *
     * Ввод
     * ---------------------------------------------------------------- */
    function interact() { state.lastInteract = state.time; ensureAudio(); }
    const pointers = new Map();
    let drag = null, pinch = null;
    canvas.addEventListener("pointerdown", e => {
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        interact();
        state.vYaw = 0; state.vPitch = 0;
        if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, last: performance.now() };
        else if (pointers.size === 2) {
            const [a, b] = Array.from(pointers.values());
            pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: state.dist, oz: state.orthoZoom || 1 };
            drag = null;
        }
        canvas.classList.add("is-grab");
    });
    canvas.addEventListener("pointermove", e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinch && pointers.size >= 2) {
            const [a, b] = Array.from(pointers.values());
            const d = Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
            if (state.view) state.orthoZoom = clamp(pinch.oz * pinch.d / d, 0.35, 2.5);
            else state.dist = clamp(pinch.dist * pinch.d / d, camMin(), camMax());
            interact();
            return;
        }
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (state.view && Math.hypot(dx, dy) > 0) {
            /* Перетаскивание в ортогональном виде → обратно в 3D с той же стороны */
            const v = VIEWS[state.view].id;
            state.yaw = v === "side" ? -Math.PI / 2 : v === "front" ? 0 : v === "rear" ? Math.PI : -Math.PI / 2;
            state.pitch = v === "top" ? 1.4 : 0.02;
            state.view = 0; paintToggles();
        }
        const k = 0.0055, now = performance.now(), dtm = Math.max(8, now - drag.last) / 1000;
        drag.last = now;
        state.yaw += dx * k;
        state.pitch = clamp(state.pitch + dy * k, -0.04, 1.45);
        state.vYaw = clamp(lerp(state.vYaw, dx * k / dtm, 0.5), -4, 4);
        state.vPitch = clamp(lerp(state.vPitch, dy * k / dtm, 0.5), -3, 3);
        interact();
    });
    const endPointer = e => {
        if (!pointers.has(e.pointerId)) return;
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch = null;
        if (drag && pointers.size === 0) {
            if (performance.now() - drag.last > 90) { state.vYaw = 0; state.vPitch = 0; }
            drag = null;
        }
        if (pointers.size === 0) canvas.classList.remove("is-grab");
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("wheel", e => {
        e.preventDefault();
        const k = e.deltaMode === 1 ? 0.05 : 0.0012;
        if (state.view) state.orthoZoom = clamp((state.orthoZoom || 1) * (1 + e.deltaY * k), 0.35, 2.5);
        else state.dist = clamp(state.dist * (1 + e.deltaY * k), camMin(), camMax());
        interact();
    }, { passive: false });
    canvas.addEventListener("dblclick", e => { e.preventDefault(); resetView(); toast("Вид сброшен"); });
    canvas.addEventListener("contextmenu", e => e.preventDefault());

    /* ---------------------------------------------------------------- *
     * HUD
     * ---------------------------------------------------------------- */
    const toastBox = $("#aq-toast");
    let toastTimer = 0;
    function toast(text) {
        if (!toastBox) return;
        toastBox.textContent = text;
        toastBox.hidden = false;
        toastBox.classList.remove("is-in"); void toastBox.offsetWidth; toastBox.classList.add("is-in");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toastBox.hidden = true; }, 2400);
    }
    const stMode = $("#st-mode"), stView = $("#st-view"), stFps = $("#st-fps"), viewL = $("#ab-view-l"), ready = $("#ab-ready");
    const sTur = $("#ab-turret"), sGun = $("#ab-gun"), sSpd = $("#ab-speed");
    const oTur = $("#ab-turret-v"), oGun = $("#ab-gun-v"), oSpd = $("#ab-speed-v");
    function paintToggles() {
        $$("[data-ab]").forEach(b => {
            const a = b.getAttribute("data-ab");
            let on = null;
            if (a === "auto") on = state.autoRotate;
            else if (a === "sound") on = state.sound;
            else if (a === "blue") on = state.blue;
            else if (a === "dims") on = state.dims;
            else if (a === "drive") on = Math.abs(state.speedT) > 0.05;
            if (on !== null) b.setAttribute("aria-pressed", String(on));
        });
        const on = $("[data-ab='sound'] .ico-on"), off = $("[data-ab='sound'] .ico-off");
        if (on) on.hidden = !state.sound;
        if (off) off.hidden = state.sound;
        if (stMode) stMode.textContent = CAMOS[state.camo].name;
        if (stView) stView.textContent = VIEWS[state.view].name;
        if (viewL) viewL.textContent = state.view ? VIEWS[state.view].name.charAt(0) + VIEWS[state.view].name.slice(1).toLowerCase() : "Вид";
        document.documentElement.classList.toggle("ab-blue", state.blue);
        if (labelsBox) labelsBox.hidden = !state.dims;
    }
    let lastOut = "";
    function syncSliders(force) {
        if (force || document.activeElement !== sTur) sTur.value = String(Math.round(wrap180(state.azT)));
        if (force || document.activeElement !== sGun) sGun.value = String(state.elT);
        if (force || document.activeElement !== sSpd) sSpd.value = String(Math.round(state.speedT * 3.6));
    }
    function updateOutputs() {
        const s = `${Math.round(wrap180(state.az))}|${state.el.toFixed(1)}|${Math.round(state.speed * 3.6)}|${state.reload > 0 ? state.reload.toFixed(1) : "R"}`;
        if (s === lastOut) return;
        lastOut = s;
        oTur.textContent = `${Math.round(wrap180(state.az))}°`;
        oGun.textContent = `${state.el >= 0 ? "+" : ""}${state.el.toFixed(1)}°`;
        oSpd.textContent = `${Math.round(state.speed * 3.6)} км/ч`;
        if (ready) {
            ready.textContent = state.reload > 0 ? `ЗАРЯЖАНИЕ ${state.reload.toFixed(1)}` : "ЗАРЯЖЕНО";
            ready.classList.toggle("is-reload", state.reload > 0);
        }
    }
    sTur.addEventListener("input", () => { state.azT = +sTur.value; interact(); });
    sGun.addEventListener("input", () => { state.elT = +sGun.value; interact(); });
    sSpd.addEventListener("input", () => { state.speedT = +sSpd.value / 3.6; interact(); paintToggles(); });
    [sTur, sGun, sSpd].forEach(s => s.addEventListener("keydown", e => e.stopPropagation()));

    function action(a, el) {
        interact();
        switch (a) {
            case "fire": fire(); break;
            case "drive": setDrive(Math.abs(state.speedT) < 0.05); toast(Math.abs(state.speedT) > 0.05 ? "Вперёд: 30 км/ч" : "Стоп"); break;
            case "center": state.azT = 0; state.elT = 0; syncSliders(true); toast("Башня по-походному: 0°"); break;
            case "camo":
                state.camo = (state.camo + 1) % CAMOS.length; paintToggles(); save();
                toast(CAMOS[state.camo].label);
                break;
            case "blue": state.blue = !state.blue; paintToggles(); save(); toast(state.blue ? "Режим чертежа" : "Обычный режим"); break;
            case "dims": state.dims = !state.dims; paintToggles(); save(); toast(state.dims ? "Размеры и подписи узлов" : "Подписи скрыты"); break;
            case "view": cycleView(1); break;
            case "auto": state.autoRotate = !state.autoRotate; paintToggles(); save(); toast(state.autoRotate ? "Авто-обзор включён" : "Авто-обзор выключен"); break;
            case "sound": setSound(!state.sound); toast(state.sound ? "Звук включён" : "Звук выключен"); break;
            case "reset": resetView(); toast("Вид сброшен"); break;
            case "fullscreen": {
                const d = document;
                if (d.fullscreenElement) d.exitFullscreen && d.exitFullscreen();
                else if (d.documentElement.requestFullscreen) d.documentElement.requestFullscreen().catch(() => toast("Полный экран недоступен в этом окне"));
                break;
            }
            case "close":
                if (EMBED && window.parent !== window) window.parent.postMessage({ type: "nexus:player-close" }, "*");
                else window.location.href = "../projects.html#abrams";
                break;
            default: break;
        }
        if (el && el.blur) el.blur();
    }
    document.addEventListener("click", e => {
        const b = e.target.closest("[data-ab]");
        if (b) action(b.getAttribute("data-ab"), b);
    });
    const HOLD = ["KeyQ", "KeyE", "KeyR", "KeyF", "KeyW", "KeyS"];
    document.addEventListener("keyup", e => { keys.delete(e.code); });
    window.addEventListener("blur", () => keys.clear());
    document.addEventListener("keydown", e => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (HOLD.includes(e.code)) { e.preventDefault(); if (!keys.has(e.code)) interact(); keys.add(e.code); return; }
        const map = { Space: "fire", KeyX: "stopnow", KeyT: "center", KeyC: "camo", KeyB: "blue", KeyL: "dims", KeyV: "view", KeyA: "auto", KeyM: "sound", KeyH: "reset" };
        if (e.key === "Escape") {
            if (document.fullscreenElement) return;
            if (state.view) { resetView(); return; }
            if (EMBED) action("close");
            return;
        }
        const a = map[e.code];
        if (a) {
            e.preventDefault();
            if (e.repeat && a !== "fire") return;
            if (a === "stopnow") { state.speedT = 0; syncSliders(true); paintToggles(); toast("Стоп"); return; }
            action(a);
            return;
        }
        const step = 0.12;
        if (e.key === "ArrowLeft") { state.yaw -= step; interact(); }
        else if (e.key === "ArrowRight") { state.yaw += step; interact(); }
        else if (e.key === "ArrowUp") { state.pitch = clamp(state.pitch + step * 0.6, -0.04, 1.45); interact(); }
        else if (e.key === "ArrowDown") { state.pitch = clamp(state.pitch - step * 0.6, -0.04, 1.45); interact(); }
        else return;
        if (state.view) { state.view = 0; paintToggles(); }
        e.preventDefault();
    });

    /* ---------------------------------------------------------------- *
     * Подписи узлов и размеры (HTML поверх канваса)
     * ---------------------------------------------------------------- */
    const labelsBox = $("#ab-labels");
    const LABELS = [
        { f: "barrel", p: [4.75, GY + 0.1, 0], n: [0, 1, 0.2], t: "120-мм гладкоствольная пушка M256" },
        { f: "barrel", p: [3.62, GY + 0.16, 0], n: [0, 1, -0.2], t: "Эжектор продувки ствола" },
        { f: "turret", p: [-0.10, 2.86, 0.46], n: [0.2, 1, 0.4], t: "Командир: башенка + 12,7-мм M2" },
        { f: "turret", p: [-0.10, 2.70, -0.82], n: [0.2, 1, -0.4], t: "Заряжающий: 7,62-мм M240" },
        { f: "turret", p: [0.85, 2.57, 0.72], n: [0.4, 1, 0.3], t: "Прицел наводчика GPS" },
        { f: "turret", p: [1.0, 2.12, -1.58], n: [0.3, 0.3, -1], t: "Дымовые гранатомёты M250" },
        { f: "turret", p: [1.85, 2.0, 0.95], n: [1, 0.2, 0.6], t: "Комбинированная броня лба башни" },
        { f: "turret", p: [-2.62, 2.36, -0.6], n: [-1, 0.6, 0], t: "Корзина кормовой ниши" },
        { f: "turret", p: [-1.92, 3.38, 1.04], n: [0, 1, 0], t: "Антенны радиостанций" },
        { f: "hull", p: [2.62, 1.45, 0], n: [1, 1, 0], t: "Люк механика-водителя" },
        { f: "hull", p: [2.9, 1.16, 1.84], n: [0, 0, 1], t: "Бортовые броневые экраны" },
        { f: "hull", p: [-0.05, 0.41, 1.66], n: [0, 0, 1], t: "7 опорных катков, торсионы" },
        { f: "hull", p: [-3.10, 0.88, 1.70], n: [-0.3, 0, 1], t: "Ведущее колесо (сзади)" },
        { f: "hull", p: [3.50, 0.70, 1.70], n: [0.3, 0, 1], t: "Направляющее колесо" },
        { f: "hull", p: [-3.78, 1.25, -0.5], n: [-1, 0, 0], t: "Выхлоп ГТД AGT-1500, 1500 л.с." },
        { f: "hull", p: [-2.8, 1.72, 0], n: [0, 1, 0], t: "Решётки МТО" }
    ];
    const DIMS = [
        { a: [1, 0, 0], p: [3.4, 0.02, -2.55], t: `L ${(DIM.muzzle - DIM.rear).toFixed(2)} м с пушкой` },
        { a: [1, 0, 0], p: [-1.6, 0.02, -3.25], t: `${(DIM.nose - DIM.rear).toFixed(2)} м корпус` },
        { a: [0, 0, 1], p: [6.55, 0.02, 0], t: `B ${(DIM.skirt * 2).toFixed(2)} м` },
        { a: [0, 1, 0], p: [-4.4, DIM.roof / 2, 2.15], t: `H ${DIM.roof.toFixed(2)} м` }
    ];
    if (labelsBox) {
        LABELS.forEach(l => { l.el = document.createElement("div"); l.el.className = "ab-label"; l.el.innerHTML = "<b></b>"; l.el.firstChild.textContent = l.t; labelsBox.appendChild(l.el); });
        DIMS.forEach(d => { d.el = document.createElement("div"); d.el.className = "ab-dim"; d.el.textContent = d.t; labelsBox.appendChild(d.el); });
    }
    function project(p) {
        const c = M4.transform(state.vp, p[0], p[1], p[2], 1);
        if (c[3] <= 0.01) return null;
        return [(c[0] / c[3] * 0.5 + 0.5) * canvas.clientWidth, (0.5 - c[1] / c[3] * 0.5) * canvas.clientHeight];
    }
    /* прямоугольники HUD (относительно холста) — подписи под ними не показываем */
    let hudRects = [], hudAt = -1e9;
    function hudObstacles() {
        const now = performance.now();
        if (now - hudAt < 500) return hudRects;
        hudAt = now;
        const cr = canvas.getBoundingClientRect();
        hudRects = [".aq-brand", ".aq-stats", ".ab-panel", ".aq-bar", ".aq-toast"].map(q => document.querySelector(q))
            .filter(e => e && !e.hidden && e.getClientRects().length)
            .map(e => { const r = e.getBoundingClientRect(); return [r.left - cr.left - 4, r.right - cr.left + 4, r.top - cr.top - 4, r.bottom - cr.top + 4]; });
        return hudRects;
    }
    function updateLabels() {
        if (!labelsBox || !state.dims) return;
        const ctr = project([0.6, 1.4, 0]) || [0, 0];
        const boxes = hudObstacles().slice();
        DIMS.forEach(d => {
            const s = project(d.p);
            /* размер вдоль оси взгляда вырождается в точку — прячем */
            const flat = state.ortho && Math.abs(V.dot(d.a, state.viewDir)) > 0.9;
            d.el.hidden = !s || flat;
            if (!s || flat) return;
            const hw = (d.w || (d.w = d.el.offsetWidth) || 90) / 2 + 6;
            s[0] = Math.min(Math.max(s[0], hw), canvas.clientWidth - hw);
            d.el.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px) translate(-50%, -50%)`;
            boxes.push([s[0] - hw, s[0] + hw, s[1] - 12, s[1] + 12]);
        });
        LABELS.forEach(l => {
            const M = X[l.f];
            const p = M4.xf(M, l.p), n = V.norm(M4.xn(M, l.n));
            const toCam = state.ortho ? V.mul(state.viewDir, -1) : V.norm(V.sub(state.cam, p));
            const s = project(p);
            /* в ортопроекциях нормаль «вбок» проходит тест — отсекаем дальнюю половину танка */
            const far = state.ortho && V.dot(V.sub(p, [0, 1.4, 0]), state.viewDir) > 1.2;
            const vis = s && !far && V.dot(n, toCam) > -0.05;
            l.el.hidden = !vis;
            if (!vis) return;
            /* сторона подписи: к краю от центра, но не за пределы экрана */
            const W = canvas.clientWidth, w = (l.w || (l.w = l.el.firstChild.offsetWidth) || 160) + 26;
            let left = s[0] < ctr[0];
            if (!left && s[0] + w > W - 6) left = true;
            else if (left && s[0] - w < 6) left = false;
            /* простое разрежение: подпись, налезающая на уже показанную, скрывается */
            const bx = left ? [s[0] - w, s[0] - 20] : [s[0] + 20, s[0] + w], by = [s[1] - 40, s[1] - 16];
            if (boxes.some(q => bx[0] < q[1] && bx[1] > q[0] && by[0] < q[3] && by[1] > q[2])) { l.el.hidden = true; return; }
            boxes.push([bx[0], bx[1], by[0], by[1]]);
            l.el.classList.toggle("is-left", left);
            l.el.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px)`;
        });
    }

    /* ---------------------------------------------------------------- *
     * Отрисовка
     * ---------------------------------------------------------------- */
    function bindMesh(pr, m, full) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.pos);
        gl.enableVertexAttribArray(pr.a.aPos); gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
        if (full) {
            gl.bindBuffer(gl.ARRAY_BUFFER, m.nrm);
            gl.enableVertexAttribArray(pr.a.aNormal); gl.vertexAttribPointer(pr.a.aNormal, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, m.col);
            gl.enableVertexAttribArray(pr.a.aColor); gl.vertexAttribPointer(pr.a.aColor, 4, gl.FLOAT, false, 0, 0);
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
    }
    function disableAttribs() { for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i); }

    function render() {
        const list = drawList();
        const env = ENVS[CAMOS[state.camo].env], cm = CAMOS[state.camo];
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);

        /* 1. Карта теней */
        if (SHADOW_OK) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
            gl.viewport(0, 0, SHADOW_RES, SHADOW_RES);
            gl.clearColor(1, 1, 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            const pr = PR.shadow;
            gl.useProgram(pr.p);
            disableAttribs();
            gl.uniformMatrix4fv(pr.u.uLightVP, false, lightVP);
            list.forEach(it => {
                bindMesh(pr, it.m, false);
                gl.uniformMatrix4fv(pr.u.uModel, false, it.M);
                gl.drawElements(gl.TRIANGLES, it.m.count, it.m.itype, 0);
            });
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        gl.viewport(0, 0, state.w, state.h);
        const fog = state.blue ? [0.05, 0.17, 0.38] : env.fog;
        gl.clearColor(fog[0], fog[1], fog[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        const fogLin = fog.map(c => c * c), skyLin = env.sky.map(c => c * c), gndLin = env.gnd.map(c => c * c);
        const flash = state.flash, fp = state.flashPos || [0, 0, 0];

        /* 2. Небо */
        disableAttribs();
        gl.depthMask(false);
        let pr = PR.sky;
        gl.useProgram(pr.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
        gl.enableVertexAttribArray(pr.a.aPos); gl.vertexAttribPointer(pr.a.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(pr.u.uIVP, false, state.ivp);
        gl.uniform3fv(pr.u.uSun, SUN); gl.uniform3fv(pr.u.uFog, fogLin); gl.uniform3fv(pr.u.uSkyTop, env.top.map(c => c * c));
        gl.uniform1f(pr.u.uBlue, state.blue ? 1 : 0); gl.uniform1f(pr.u.uOrtho, state.ortho ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.depthMask(true);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, shadowTex);

        /* 3. Земля */
        disableAttribs();
        pr = PR.ground;
        gl.useProgram(pr.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, groundBuf);
        gl.enableVertexAttribArray(pr.a.aPos); gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(pr.u.uVP, false, state.vp); gl.uniformMatrix4fv(pr.u.uLightVP, false, lightVP);
        gl.uniform3fv(pr.u.uCam, state.cam); gl.uniform3fv(pr.u.uSun, SUN); gl.uniform3fv(pr.u.uSunCol, env.sun);
        gl.uniform3fv(pr.u.uSky, skyLin); gl.uniform1f(pr.u.uOrtho, state.ortho ? 1 : 0);
        gl.uniform3fv(pr.u.uG1, env.g1); gl.uniform3fv(pr.u.uG2, env.g2); gl.uniform3fv(pr.u.uG3, env.g3); gl.uniform1f(pr.u.uGType, env.gtype);
        gl.uniform1f(pr.u.uScroll, state.odo % 1000); gl.uniform1f(pr.u.uTrail, Math.min(state.driven, 400));
        gl.uniform1f(pr.u.uBlue, state.blue ? 1 : 0);
        gl.uniform3fv(pr.u.uFog, fogLin); gl.uniform1f(pr.u.uFogD, state.ortho ? 0.0 : 0.0075);
        gl.uniform3fv(pr.u.uFlashPos, fp); gl.uniform1f(pr.u.uFlash, flash);
        gl.uniform1i(pr.u.uShadow, 0); gl.uniform1f(pr.u.uShadowRes, SHADOW_RES);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        /* 4. Танк */
        disableAttribs();
        pr = PR.main;
        gl.useProgram(pr.p);
        gl.uniformMatrix4fv(pr.u.uVP, false, state.vp); gl.uniformMatrix4fv(pr.u.uLightVP, false, lightVP);
        gl.uniform3fv(pr.u.uCam, state.cam); gl.uniform3fv(pr.u.uViewDir, state.viewDir); gl.uniform1f(pr.u.uOrtho, state.ortho ? 1 : 0);
        gl.uniform3fv(pr.u.uSun, SUN); gl.uniform3fv(pr.u.uSunCol, env.sun); gl.uniform3fv(pr.u.uSky, skyLin); gl.uniform3fv(pr.u.uGnd, gndLin);
        gl.uniform3fv(pr.u.uPaint, cm.paint); gl.uniform3fv(pr.u.uPaint2, cm.p2); gl.uniform3fv(pr.u.uPaint3, cm.p3); gl.uniform1f(pr.u.uCamo, cm.camo);
        gl.uniform3fv(pr.u.uDust, env.dust); gl.uniform1f(pr.u.uDirt, env.dirt * (0.6 + 0.4 * clamp(state.driven / 200, 0, 1)));
        gl.uniform1f(pr.u.uBlue, state.blue ? 1 : 0);
        gl.uniform3fv(pr.u.uFog, fogLin); gl.uniform1f(pr.u.uFogD, state.fogD);
        gl.uniform3fv(pr.u.uFlashPos, fp); gl.uniform1f(pr.u.uFlash, flash); gl.uniform1f(pr.u.uSeed, state.seed);
        gl.uniform1i(pr.u.uShadow, 0); gl.uniform1f(pr.u.uShadowRes, SHADOW_RES);
        if (state.blue) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2); }
        list.forEach(it => {
            bindMesh(pr, it.m, true);
            gl.uniformMatrix4fv(pr.u.uModel, false, it.M);
            gl.drawElements(gl.TRIANGLES, it.m.count, it.m.itype, 0);
        });
        gl.disable(gl.POLYGON_OFFSET_FILL);

        /* 5. Контуры (режим чертежа) и размерные линии */
        if (state.blue || state.dims) {
            disableAttribs();
            pr = PR.line;
            gl.useProgram(pr.p);
            gl.uniformMatrix4fv(pr.u.uVP, false, state.vp);
            gl.enableVertexAttribArray(pr.a.aPos);
            gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            if (state.blue) {
                gl.uniform4fv(pr.u.uColor, [0.86, 0.93, 1.0, 0.95]);
                list.forEach(it => {
                    if (!it.m.lines) return;
                    gl.bindBuffer(gl.ARRAY_BUFFER, it.m.lines.buf);
                    gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
                    gl.uniformMatrix4fv(pr.u.uModel, false, it.M);
                    gl.drawArrays(gl.LINES, 0, it.m.lines.count);
                });
            }
            if (state.dims) {
                gl.uniform4fv(pr.u.uColor, state.blue ? [1, 1, 1, 0.9] : [ACCENT[0], ACCENT[1], ACCENT[2], 0.95]);
                gl.bindBuffer(gl.ARRAY_BUFFER, dimLines.buf);
                gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 0, 0);
                gl.uniformMatrix4fv(pr.u.uModel, false, M4.ident());
                gl.drawArrays(gl.LINES, 0, dimLines.count);
            }
            gl.disable(gl.BLEND);
        }

        /* 6. Частицы: дым/пыль (альфа), затем вспышки (аддитивно) */
        if (parts.length) {
            disableAttribs();
            pr = PR.part;
            gl.useProgram(pr.p);
            gl.uniformMatrix4fv(pr.u.uVP, false, state.vp);
            gl.uniform1f(pr.u.uPointScale, state.pointScale); gl.uniform1f(pr.u.uOrtho, state.ortho ? 1 : 0); gl.uniform1f(pr.u.uMaxPt, MAX_PT);
            let n = 0;
            const fillPass = add => {
                const start = n;
                parts.forEach(p => {
                    if (p.add !== add) return;
                    const t = p.life / p.max, o = n * 8;
                    partData[o] = p.p[0]; partData[o + 1] = p.p[1]; partData[o + 2] = p.p[2];
                    partData[o + 3] = p.size * (1 + p.grow * t);
                    const fade = add ? (1 - t) : Math.min(1, t * 25) * Math.pow(1 - t, 1.6);
                    const c = state.blue ? [0.85, 0.93, 1] : p.col;
                    partData[o + 4] = c[0]; partData[o + 5] = c[1]; partData[o + 6] = c[2]; partData[o + 7] = p.a * fade;
                    n++;
                });
                return [start, n - start];
            };
            const sm = fillPass(false), fx = fillPass(true);
            gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, partData.subarray(0, n * 8));
            gl.enableVertexAttribArray(pr.a.aPos); gl.vertexAttribPointer(pr.a.aPos, 3, gl.FLOAT, false, 32, 0);
            gl.enableVertexAttribArray(pr.a.aSize); gl.vertexAttribPointer(pr.a.aSize, 1, gl.FLOAT, false, 32, 12);
            gl.enableVertexAttribArray(pr.a.aCol); gl.vertexAttribPointer(pr.a.aCol, 4, gl.FLOAT, false, 32, 16);
            gl.enable(gl.BLEND); gl.depthMask(false);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            if (sm[1]) gl.drawArrays(gl.POINTS, sm[0], sm[1]);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
            if (fx[1]) gl.drawArrays(gl.POINTS, fx[0], fx[1]);
            gl.depthMask(true); gl.disable(gl.BLEND);
        }
    }

    /* ---------------------------------------------------------------- *
     * Обновление
     * ---------------------------------------------------------------- */
    function approachAngle(cur, target, maxStep) {
        const d = wrap180(target - cur);
        return wrap180(cur + clamp(d, -maxStep, maxStep));
    }
    let dustAcc = 0;
    function update(dt) {
        state.time += dt;
        /* Клавиши: башня / ствол / ход */
        let moved = false;
        if (keys.has("KeyQ")) { state.azT = wrap180(state.az - 30); moved = true; }
        if (keys.has("KeyE")) { state.azT = wrap180(state.az + 30); moved = true; }
        if (!keys.has("KeyQ") && !keys.has("KeyE") && state.keyTurret) { state.azT = state.az; }
        state.keyTurret = keys.has("KeyQ") || keys.has("KeyE");
        if (keys.has("KeyR")) { state.elT = clamp(state.elT + 18 * dt, DIM.elevMin, DIM.elevMax); moved = true; }
        if (keys.has("KeyF")) { state.elT = clamp(state.elT - 18 * dt, DIM.elevMin, DIM.elevMax); moved = true; }
        if (keys.has("KeyW")) { state.speedT = clamp(state.speedT + 12 / 3.6 * dt, -30 / 3.6, 67 / 3.6); moved = true; }
        if (keys.has("KeyS")) { state.speedT = clamp(state.speedT - 12 / 3.6 * dt, -30 / 3.6, 67 / 3.6); moved = true; }
        if (moved) { syncSliders(); state.lastInteract = state.time; paintTogglesThrottled(); }

        /* Башня: ~40°/с, ствол: ~20°/с; над МТО ствол приподнимается */
        const prevAz = state.az;
        state.az = approachAngle(state.az, state.azT, 40 * dt);
        const back = clamp((Math.abs(wrap180(state.az)) - 85) / 25, 0, 1);
        const minEl = lerp(DIM.elevMin, 2.5, back);
        const elT = clamp(state.elT, minEl, DIM.elevMax);
        state.el += clamp(elT - state.el, -20 * dt, 20 * dt);
        state.turretMoving = Math.abs(wrap180(state.az - prevAz)) / Math.max(dt, 1e-4) > 1 ? 1 : 0;

        /* Ход: разгон ~1,5 м/с², торможение ~3,5 м/с² */
        const prevV = state.speed;
        const dv = state.speedT - state.speed;
        const a = Math.sign(dv) === Math.sign(state.speed) || state.speed === 0 ? 1.6 : 3.5;
        state.speed += clamp(dv, -a * dt, a * dt);
        state.accel = lerp(state.accel, (state.speed - prevV) / Math.max(dt, 1e-4), 0.1);
        state.odo += state.speed * dt;
        state.driven += Math.abs(state.speed) * dt;
        state.susp = lerp(state.susp, clamp(state.accel * 0.006, -0.03, 0.03), Math.min(1, dt * 4));

        /* Раскачка корпуса после выстрела (затухающая пружина) */
        const r = state.rock;
        r.pv += (-38 * r.p - 4.5 * r.pv) * dt; r.p += r.pv * dt;
        r.rv += (-46 * r.r - 5.0 * r.rv) * dt; r.r += r.rv * dt;

        state.recoilT += dt;
        if (state.reload > 0) {
            state.reload -= dt;
            if (state.reload <= 0) { state.reload = 0; sfxClank(); }
        }
        state.flash = Math.max(0, state.flash - dt * 9);
        state.shake = Math.max(0, state.shake - dt * 3.5);

        /* Пыль из-под гусениц */
        const env = ENVS[CAMOS[state.camo].env];
        const sp = Math.abs(state.speed);
        if (sp > 0.5) {
            dustAcc += dt * sp * (env.gtype ? 1.2 : 2.6);
            while (dustAcc > 1) {
                dustAcc -= 1;
                const s = Math.random() < 0.5 ? 1 : -1, back2 = state.speed > 0;
                const x = back2 ? rand(-3.4, -2.6) : rand(2.8, 3.6);
                spawn({ p: [x, rand(0.1, 0.5), s * rand(1.2, 1.75)], v: [-state.speed * rand(0.2, 0.6), rand(0.3, 1.2), s * rand(0.1, 0.6)], max: rand(1.5, 3), size: rand(0.8, 1.5), grow: 2.4, col: env.puff, a: env.gtype ? 0.22 : 0.4, drag: 2.5, lift: 0.15 });
            }
            if (Math.random() < dt * (2 + Math.abs(state.accel) * 3)) {
                spawn({ p: [-3.95, rand(1.0, 1.5), rand(-0.9, 0.9)], v: [-rand(0.5, 1.5), rand(0.3, 0.8), rand(-0.3, 0.3)], max: 2, size: 0.6, grow: 2.5, col: [0.5, 0.5, 0.5], a: 0.12, drag: 1, lift: 0.3 });
            }
        }
        /* Частицы */
        for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            p.life += dt;
            if (p.life >= p.max) { parts.splice(i, 1); continue; }
            const k = Math.exp(-p.drag * dt);
            p.v[0] *= k; p.v[1] = p.v[1] * k + p.lift * dt; p.v[2] *= k;
            p.p[0] += (p.v[0] - (p.add ? 0 : state.speed)) * dt; p.p[1] += p.v[1] * dt; p.p[2] += p.v[2] * dt;
            if (p.p[1] < 0.05) { p.p[1] = 0.05; p.v[1] = Math.abs(p.v[1]) * 0.3; }
        }

        /* Камера */
        if (!state.view) {
            if (Math.abs(state.vYaw) > 1e-4 || Math.abs(state.vPitch) > 1e-4) {
                if (!pointers.size) {
                    state.yaw += state.vYaw * dt; state.pitch = clamp(state.pitch + state.vPitch * dt, -0.04, 1.45);
                    const d = Math.exp(-dt * 3.2); state.vYaw *= d; state.vPitch *= d;
                }
            }
            if (state.autoRotate && state.time - state.lastInteract > 6 && !pointers.size) {
                state.yaw += dt * 0.12;
                state.pitch = lerp(state.pitch, 0.2 + Math.sin(state.time * 0.1) * 0.08, dt * 0.3);
            }
        }
    }
    let ptT = 0;
    function paintTogglesThrottled() { if (state.time - ptT > 0.25) { ptT = state.time; paintToggles(); } }

    /* ---------------------------------------------------------------- *
     * Кадр
     * ---------------------------------------------------------------- */
    let last = 0, fpsAcc = 0, fpsN = 0, frozen = false;
    function frame(t) {
        const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
        last = t;
        if (!frozen) update(dt);
        kinematics();
        updateTrack(-state.odo);
        computeCamera();
        render();
        updateLabels();
        updateOutputs();
        updateAudio(dt);
        fpsAcc += dt; fpsN++;
        if (fpsAcc > 0.5) {
            state.fps = Math.round(fpsN / fpsAcc);
            if (stFps) stFps.textContent = String(state.fps);
            fpsAcc = 0; fpsN = 0;
        }
        requestAnimationFrame(frame);
    }

    canvas.addEventListener("webglcontextlost", e => {
        e.preventDefault();
        if (fail) { fail.hidden = false; const m = $("#aq-fail-msg"); if (m) m.textContent = "Видеоконтекст WebGL потерян. Перезагрузите страницу."; }
    });
    window.addEventListener("resize", resize);

    /* ---------------------------------------------------------------- *
     * Старт
     * ---------------------------------------------------------------- */
    load();
    resize();
    state.dist = DEFAULT_VIEW.dist;
    const vq = params.get("view");
    if (vq) { const i = VIEWS.findIndex(v => v.id === vq); if (i >= 0) state.view = i; }
    if (params.get("blue") === "1") state.blue = true;
    paintToggles();
    syncSliders(true);
    [["#st-len", DIM.muzzle - DIM.rear], ["#st-wid", DIM.skirt * 2], ["#st-hgt", DIM.roof]].forEach(([id, v]) => { const el = $(id); if (el) el.textContent = v.toFixed(2); });
    const hint = $("#aq-hint");
    if (hint) setTimeout(() => hint.classList.add("is-hidden"), 7000);
    canvas.addEventListener("pointerdown", () => { if (hint) hint.classList.add("is-hidden"); }, { once: true });
    document.documentElement.classList.add("aq-ready");
    requestAnimationFrame(t => { last = t; frame(t); });

    /* Для тестов и консоли */
    window.NexusAbrams = {
        state, DIM, MESH, fire, resetView, keys, parts, gl,
        setView(id) { const i = VIEWS.findIndex(v => v.id === id); if (i >= 0) { state.view = i; state.orthoZoom = 1; paintToggles(); } },
        setTurret(az, el) { state.azT = state.az = wrap180(az || 0); state.elT = state.el = el || 0; syncSliders(true); },
        setCamo(i) { state.camo = clamp(i | 0, 0, CAMOS.length - 1); paintToggles(); },
        setBlue(on) { state.blue = !!on; paintToggles(); },
        setDims(on) { state.dims = !!on; paintToggles(); },
        freeze(on) { frozen = !!on; },
        step(dt, n) { for (let i = 0; i < (n || 1); i++) update(dt || 1 / 60); },
        stats: () => ({
            hullVerts: MESH.hull.verts, turretVerts: MESH.turret.verts, links: LINKS, trackLen: +PATH.L.toFixed(2),
            length: +(DIM.muzzle - DIM.rear).toFixed(2), width: DIM.skirt * 2, height: DIM.roof, shadow: SHADOW_OK
        })
    };
})();
