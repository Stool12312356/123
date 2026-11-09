/*
 * pages.js — логика страниц NEXUS//DEV
 * ------------------------------------------------------------------
 * Подключается на всех страницах после js/ui-effects.js и использует
 * его API (window.NEXUS). Страница определяется по <body data-page>:
 *   home      — index.html      (ядро экосистемы — логика в ui-effects.js)
 *   projects  — projects.html   (фильтр по статусу, карточки, загрузки, patch notes)
 *   dashboard — dashboard.html  (профиль, серверы, настройки HUD)
 *   auth      — auth.html       (вход, регистрация, DEMO ACCESS)
 *
 * Авторизация демонстрационная: профиль хранится только в localStorage
 * вашего браузера, пароли нигде не сохраняются и никуда не отправляются.
 * ------------------------------------------------------------------
 */
(function () {
    "use strict";

    const NX = window.NEXUS;
    if (!NX) return;

    const { $, $$, clamp, rand, randInt, pick, delay, escapeHtml, timeStr, dateStr, hashString,
        Settings, Sound, Auth, ACCESS_CODES, toast, showBanner, Modal, Tabs, SERVERS, Telemetry,
        statusBadge, formatPlayers, PROJECTS, CATEGORIES, STATUSES, observeReveal, reducedMotion, NICKS } = NX;

    const PAGE = NX.PAGE;

    /* ================================================================
     * Общее для всех страниц
     * ================================================================ */

    /* Живые данные серверов: [data-srv="id"][data-field="status|players|ping"] */
    function initServerBindings() {
        const render = () => {
            $$("[data-srv]").forEach(el => {
                const n = Telemetry.find(el.getAttribute("data-srv"));
                if (!n) return;
                const field = el.getAttribute("data-field");
                if (field === "status") {
                    const html = statusBadge(n.status);
                    if (el.innerHTML !== html) el.innerHTML = html;
                } else if (field === "players") {
                    el.textContent = formatPlayers(n);
                } else if (field === "ping") {
                    el.textContent = Telemetry.isUp(n) ? Math.round(n.ping) + " ms" : "—";
                }
            });
        };
        Telemetry.on(render);
        render();
    }

    /* Идентикон-аватар: симметричная пиксельная маска 7×7 из хэша позывного */
    function drawAvatar(canvas, seedText) {
        if (!canvas || !canvas.getContext) return;
        canvas.setAttribute("data-avatar-seed", seedText || "guest");
        const ctx = canvas.getContext("2d");
        const size = 7;
        const px = 18;
        canvas.width = size * px;
        canvas.height = size * px;
        let h = hashString(seedText || "guest");
        const next = () => {
            h ^= h << 13; h >>>= 0;
            h ^= h >>> 17;
            h ^= h << 5; h >>>= 0;
            return h / 4294967296;
        };
        // Фон — light_black текущей цветовой схемы
        const bg = getComputedStyle(document.documentElement).getPropertyValue("--color_light_black").trim();
        ctx.fillStyle = bg || "#090B0A";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < Math.ceil(size / 2); x++) {
                const r = next();
                if (r > 0.52) {
                    const alpha = r > 0.85 ? 1 : (r > 0.7 ? 0.7 : 0.4);
                    ctx.fillStyle = NX.rgba(alpha);
                    ctx.fillRect(x * px, y * px, px - 1, px - 1);
                    ctx.fillRect((size - 1 - x) * px, y * px, px - 1, px - 1);
                }
            }
        }
        // «прицел» поверх
        ctx.strokeStyle = NX.rgba(0.35);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2 + 0.5, 0); ctx.lineTo(canvas.width / 2 + 0.5, canvas.height);
        ctx.moveTo(0, canvas.height / 2 + 0.5); ctx.lineTo(canvas.width, canvas.height / 2 + 0.5);
        ctx.stroke();
    }

    function avatarSeed(s) {
        return s ? `${s.callsign}#${s.avatarSeed || 0}` : "guest";
    }

    function formatDate(ts) {
        const d = new Date(ts);
        return `${dateStr(d)} ${timeStr(d).slice(0, 5)}`;
    }

    /* ================================================================
     * Центр загрузок: доступ, симуляция загрузки, HUD-графика
     * ================================================================ */
    const ICON_DOWNLOAD = '<img src="assets/icons/download.svg" alt="" width="18" height="18">';
    const ICON_LOCK = '<img src="assets/icons/lock.svg" alt="" width="18" height="18">';

    function canDownload(p, s) {
        if (!p.access) return true;
        return !!s && s.level >= p.access;
    }

    function accessText(p) {
        return p.access ? `L${p.access} · ${Auth.levelName(p.access)}` : "без входа";
    }

    function formatSize(mb) {
        if (mb >= 1024) return (mb / 1024).toFixed(2) + " GiB";
        return mb.toFixed(mb < 10 ? 1 : 0) + " MiB";
    }

    function formatEta(sec) {
        sec = Math.max(0, Math.round(sec));
        return sec >= 60 ? `${Math.floor(sec / 60)}м ${NX.pad(sec % 60)}с` : `${sec}с`;
    }

    /* Генератор псевдослучайных чисел со стабильным зерном (одинаковая графика при каждой загрузке) */
    function seeded(seedText) {
        let h = hashString(seedText) || 1;
        return () => {
            h ^= h << 13; h >>>= 0;
            h ^= h >>> 17;
            h ^= h << 5; h >>>= 0;
            return h / 4294967296;
        };
    }

    /* Векторная HUD-графика проекта: топография (UE5), воксели (Minecraft), граф узлов (платформа) */
    function projectArt(p) {
        const r = seeded(p.id);
        const W = 320, H = 140;
        let g = "";
        if (p.category === "ue5") {
            const cx = 110 + r() * 110, cy = 62 + r() * 30;
            for (let k = 1; k <= 9; k++) {
                const pts = [];
                const base = k * 15;
                for (let i = 0; i < 28; i++) {
                    const a = i / 28 * Math.PI * 2;
                    const rr = base * (0.82 + r() * 0.3);
                    pts.push(`${(cx + Math.cos(a) * rr * 1.6).toFixed(1)},${(cy + Math.sin(a) * rr).toFixed(1)}`);
                }
                g += `<polygon points="${pts.join(" ")}" class="a-line${k % 3 === 0 ? " a-strong" : ""}"/>`;
            }
            g += `<path d="M0 ${H - 26} L${W * 0.35} ${H - 40} L${W * 0.6} ${H - 22} L${W} ${H - 36}" class="a-dash"/>`;
            g += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" class="a-dot"/>`;
            g += `<text x="${(cx + 8).toFixed(1)}" y="${(cy - 6).toFixed(1)}" class="a-txt">ELEV ${(120 + r() * 300).toFixed(0)}m</text>`;
        } else if (p.category === "minecraft") {
            const s = 14;
            for (let y = 0; y < Math.ceil(H / s); y++) {
                for (let x = 0; x < Math.ceil(W / s); x++) {
                    const v = r();
                    const hgt = Math.sin(x * 0.35 + y * 0.1) + Math.cos(y * 0.5) + (v - 0.5);
                    if (hgt > 0.9) g += `<rect x="${x * s + 1}" y="${y * s + 1}" width="${s - 2}" height="${s - 2}" class="a-fill${hgt > 1.5 ? " a-strong" : ""}"/>`;
                    else if (v > 0.86) g += `<rect x="${x * s + 3}" y="${y * s + 3}" width="${s - 6}" height="${s - 6}" class="a-line"/>`;
                }
            }
            g += `<path d="M${W - 92} 20 l24 -12 l24 12 l-24 12 z M${W - 92} 20 v28 l24 12 v-28 M${W - 44} 20 v28 l-24 12" class="a-line a-strong"/>`;
        } else {
            const nodes = [];
            for (let i = 0; i < 13; i++) nodes.push([20 + r() * (W - 40), 16 + r() * (H - 32)]);
            nodes.forEach((n, i) => {
                const near = nodes.map((m, j) => [j, Math.hypot(m[0] - n[0], m[1] - n[1])]).filter(x => x[0] !== i).sort((a, b) => a[1] - b[1]).slice(0, 2);
                near.forEach(([j]) => { if (j > i) g += `<line x1="${n[0].toFixed(1)}" y1="${n[1].toFixed(1)}" x2="${nodes[j][0].toFixed(1)}" y2="${nodes[j][1].toFixed(1)}" class="a-line"/>`; });
            });
            nodes.forEach((n, i) => {
                g += `<circle cx="${n[0].toFixed(1)}" cy="${n[1].toFixed(1)}" r="${i === 0 ? 5 : 2.5}" class="${i === 0 ? "a-ring" : "a-dot"}"/>`;
            });
            g += `<text x="${(nodes[0][0] + 9).toFixed(1)}" y="${(nodes[0][1] + 3).toFixed(1)}" class="a-txt">CORE</text>`;
        }
        // Рамка-прицел и сетка
        g += `<path d="M8 22 V8 H22 M${W - 22} 8 H${W - 8} V22 M8 ${H - 22} V${H - 8} H22 M${W - 22} ${H - 8} H${W - 8} V${H - 22}" class="a-line a-strong"/>`;
        return `<svg class="art-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${g}</svg>`;
    }

    function badgeHtml(p) {
        return `<span class="pbadge pbadge-${p.status}"><i aria-hidden="true"></i>${escapeHtml(STATUSES[p.status].label)}</span>`;
    }

    function dlButtonInner(p, s) {
        return canDownload(p, s) ? `${ICON_DOWNLOAD}<span>СКАЧАТЬ СБОРКУ</span>` : `${ICON_LOCK}<span>СКАЧАТЬ СБОРКУ</span>`;
    }

    function hudHtml() {
        return `<div class="dl-hud" hidden aria-live="polite">
            <div class="dl-row"><span class="dl-stage">CONNECTING</span><span class="dl-pct">0%</span></div>
            <div class="dl-track"><span class="dl-fill"></span></div>
            <div class="dl-row dl-stats"><span class="dl-speed">— MiB/s</span><span class="dl-done">0 / —</span><span class="dl-eta">ETA —</span></div>
        </div>`;
    }

    /* Симуляция загрузки с HUD-прогрессом. Одна активная загрузка на проект. */
    const Downloads = {
        active: {},
        /* Проверка доступа: true — можно качать; иначе показывает тост и уводит на вход / в кабинет */
        guard(p) {
            const s = Auth.get();
            if (canDownload(p, s)) return true;
            Sound.play("denied");
            NX.storage.set("nx_pending_dl", p.id);
            if (!s) {
                toast(`${p.title}: нужен вход и допуск ${accessText(p)}. Перенаправляю на вход…`, "warn");
                setTimeout(() => { window.location.href = "auth.html"; }, 1300);
            } else {
                toast(`${p.title}: требуется допуск ${accessText(p)} (у вас L${s.level}). Открываю кабинет…`, "warn");
                setTimeout(() => { window.location.href = "dashboard.html#profile"; }, 1300);
            }
            return false;
        },
        cancel(id) {
            const job = this.active[id];
            if (job) job.cancelled = true;
        },
        /* btns — кнопки «Скачать» этого проекта, huds — блоки .dl-hud (карточка + модалка) */
        async run(p, opts) {
            opts = opts || {};
            if (this.active[p.id]) { this.cancel(p.id); return; }
            if (!this.guard(p)) return;
            const job = { cancelled: false };
            this.active[p.id] = job;
            const huds = () => $$(`[data-hud="${p.id}"] .dl-hud`);
            const btns = () => $$(`[data-dl="${p.id}"]`);
            const setHud = (fn) => huds().forEach(fn);
            const fast = reducedMotion();

            btns().forEach(b => { b.classList.add("is-running"); b.innerHTML = `<img src="assets/icons/close.svg" alt="" width="16" height="16"><span>ОТМЕНИТЬ</span>`; });
            setHud(h => { h.hidden = false; h.classList.remove("is-done", "is-cancel"); h.querySelector(".dl-fill").style.width = "0%"; });
            const stage = (t) => setHud(h => { h.querySelector(".dl-stage").textContent = t; });
            Sound.play("expand");
            toast(`Загрузка начата: ${p.title} ${p.version}`);

            stage("CONNECTING · cdn.nexus.dev");
            await delay(fast ? 80 : randInt(500, 800));

            // Скорость «канала»: маленькие файлы идут не быстрее ~2.5 с (чтобы прогресс был виден),
            // большие сборки ускоряются (демо ×N), чтобы симуляция укладывалась в ~6 с
            const minT = fast ? 0.4 : 2.5, maxT = fast ? 1.2 : 6;
            const speedBase = Math.min(rand(42, 96), p.sizeMB / minT);
            const accel = Math.max(1, p.sizeMB / (speedBase * maxT));
            let done = 0, last = performance.now(), lastSound = 0;
            stage(accel > 1.5 ? `DOWNLOADING · DEMO ×${Math.round(accel)}` : "DOWNLOADING");
            while (done < p.sizeMB && !job.cancelled) {
                await delay(120);
                const now = performance.now();
                const dt = (now - last) / 1000;
                last = now;
                const speed = speedBase * rand(0.75, 1.2);
                done = Math.min(p.sizeMB, done + speed * dt * accel);
                const pct = done / p.sizeMB * 100;
                const eta = (p.sizeMB - done) / (speed * accel);
                setHud(h => {
                    h.querySelector(".dl-fill").style.width = pct.toFixed(1) + "%";
                    h.querySelector(".dl-pct").textContent = Math.floor(pct) + "%";
                    h.querySelector(".dl-speed").textContent = speed.toFixed(1) + " MiB/s";
                    h.querySelector(".dl-done").textContent = `${formatSize(done)} / ${p.size}`;
                    h.querySelector(".dl-eta").textContent = "ETA " + formatEta(eta);
                });
                if (now - lastSound > 450) { Sound.play("stdout"); lastSound = now; }
            }

            if (!job.cancelled) {
                stage("VERIFYING SHA-256");
                setHud(h => { h.querySelector(".dl-eta").textContent = "ETA 0с"; });
                await delay(fast ? 80 : randInt(600, 900));
            }

            delete this.active[p.id];
            btns().forEach(b => { b.classList.remove("is-running"); b.innerHTML = dlButtonInner(p, Auth.get()); });
            document.dispatchEvent(new CustomEvent("nexus:dl-idle", { detail: { id: p.id } }));

            if (job.cancelled) {
                stage("CANCELLED");
                setHud(h => h.classList.add("is-cancel"));
                Sound.play("denied");
                toast(`Загрузка отменена: ${p.title}`, "warn");
                setTimeout(() => setHud(h => { if (h.classList.contains("is-cancel")) h.hidden = true; }), 2200);
                return;
            }

            const sha = hashString(p.file + Date.now()).toString(16).padStart(8, "0");
            stage(`COMPLETE · SHA ${sha}`);
            setHud(h => {
                h.classList.add("is-done");
                h.querySelector(".dl-pct").textContent = "100%";
                h.querySelector(".dl-done").textContent = p.file;
            });
            Sound.play("granted");
            const s = Auth.get();
            if (s) {
                Auth.addDownload({ build: p.title, version: p.version, date: Date.now(), size: p.size, sha, status: "VERIFIED" });
                NX.Syslog.add(`downloads: ${s.callsign} fetched ${p.title} ${p.version}`);
            }
            toast(`${p.title} ${p.version} загружена и проверена (демо). ${s ? "Запись добавлена в кабинет." : "Войдите, чтобы вести историю загрузок."}`, "ok", { ttl: 5000 });
            if (typeof opts.onDone === "function") opts.onDone(sha);
        }
    };

    /* ================================================================
     * Проекты — витрина загрузок
     * ================================================================ */
    function projectCard(p) {
        const s = Auth.get();
        const wrap = document.createElement("div");
        wrap.className = "pcard-wrap glow on-scroll";
        wrap.setAttribute("data-status", p.status);
        wrap.setAttribute("data-hud", p.id);
        wrap.id = "project-" + p.id;
        wrap.innerHTML = `
            <article class="pcard aug-card" augmented-ui="tl-clip br-clip exe" aria-labelledby="ptitle-${p.id}">
                <div class="pcard-art art-${p.category}">
                    ${projectArt(p)}
                    <span class="art-icon"><img src="assets/icons/${p.icon}.svg" alt="" width="34" height="34"></span>
                    <span class="art-code">${escapeHtml(p.code)}</span>
                    <span class="art-cat">${escapeHtml(CATEGORIES[p.category])}</span>
                </div>
                <div class="pcard-body">
                    ${badgeHtml(p)}
                    <h3 id="ptitle-${p.id}">${escapeHtml(p.title)}</h3>
                    <p class="summary">${escapeHtml(p.summary)}</p>
                    <dl class="pmeta">
                        <div><dt>Версия</dt><dd>${escapeHtml(p.version)}</dd></div>
                        <div><dt>Размер</dt><dd>${escapeHtml(p.size)}</dd></div>
                        <div><dt>Платформа</dt><dd>${escapeHtml(p.platform)}</dd></div>
                    </dl>
                    ${hudHtml()}
                    <div class="pcard-actions">
                        <button class="btn btn-primary btn-dl" type="button" data-dl="${p.id}">${dlButtonInner(p, s)}</button>
                        <button class="btn btn-ghost" type="button" data-details="${p.id}"><img src="assets/icons/info.svg" alt="" width="16" height="16"><span>Подробнее</span></button>
                    </div>
                    <p class="pcard-access${canDownload(p, s) ? " is-ok" : ""}" data-access="${p.id}">${accessLine(p, s)}</p>
                </div>
            </article>`;
        return wrap;
    }

    function accessLine(p, s) {
        if (!p.access) return "Публичный релиз · вход не требуется";
        if (canDownload(p, s)) return `Допуск подтверждён · ${accessText(p)}`;
        return s ? `Нужен допуск ${accessText(p)} · у вас L${s.level}` : `Нужен вход · допуск ${accessText(p)}`;
    }

    function openDetails(id, fromHash) {
        const p = PROJECTS.find(x => x.id === id);
        if (!p) return false;
        const s = Auth.get();
        const html = `
            <div class="pd" data-hud="${p.id}">
                <div class="pd-art pcard-art art-${p.category}">
                    ${projectArt(p)}
                    <span class="art-icon"><img src="assets/icons/${p.icon}.svg" alt="" width="40" height="40"></span>
                    <span class="art-code">${escapeHtml(p.code)}</span>
                    <span class="art-cat">${escapeHtml(CATEGORIES[p.category])}</span>
                </div>
                <div class="pd-head">
                    ${badgeHtml(p)}
                    <p>${escapeHtml(p.summary)}</p>
                </div>
                <div class="pd-grid">
                    <div>
                        <h5>Сборка</h5>
                        <table class="edex-table pd-table"><tbody>
                            <tr><td>Версия</td><td>${escapeHtml(p.version)}</td></tr>
                            <tr><td>Обновлено</td><td>${escapeHtml(p.updated)}</td></tr>
                            <tr><td>Размер</td><td>${escapeHtml(p.size)}</td></tr>
                            <tr><td>Платформа</td><td>${escapeHtml(p.platform)}</td></tr>
                            <tr><td>Файл</td><td class="pd-file">${escapeHtml(p.file)}</td></tr>
                            <tr><td>Допуск</td><td>${escapeHtml(accessText(p))}</td></tr>
                        </tbody></table>
                        <h5>Требования</h5>
                        <p>${escapeHtml(p.requirements)}</p>
                    </div>
                    <div>
                        <h5>Patch notes</h5>
                        ${p.notes.map(n => `
                            <div class="pd-note">
                                <p class="pd-note-head"><b>v${escapeHtml(n.version)}</b><span>${escapeHtml(n.date)}</span></p>
                                <ul class="log">${n.items.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
                            </div>`).join("")}
                    </div>
                </div>
                ${hudHtml()}
                <p class="pcard-access${canDownload(p, s) ? " is-ok" : ""}">${accessLine(p, s)}</p>
                <div class="pd-actions">
                    <button class="btn btn-primary btn-dl" type="button" data-dl="${p.id}">${dlButtonInner(p, s)}</button>
                </div>
            </div>`;
        const modal = Modal.open({
            title: escapeHtml(p.title),
            subtitle: escapeHtml(p.code) + " · v" + escapeHtml(p.version),
            html,
            className: "pd-modal",
            onClose: () => {
                const h = window.location.hash;
                if ((h === "#" + p.id || h === "#dossier-" + p.id) && window.history.replaceState) {
                    window.history.replaceState(null, "", window.location.pathname + window.location.search);
                }
            }
        });
        // Если загрузка уже идёт — показать её состояние в модалке
        if (Downloads.active[p.id]) {
            const b = $(`[data-dl="${p.id}"]`, modal);
            if (b) { b.classList.add("is-running"); b.innerHTML = `<img src="assets/icons/close.svg" alt="" width="16" height="16"><span>ОТМЕНИТЬ</span>`; }
            const cardHud = $(`#project-${p.id} .dl-hud`);
            const hud = $(".dl-hud", modal);
            if (cardHud && hud) { hud.outerHTML = cardHud.outerHTML; }
        }
        if (!fromHash && window.history.replaceState) window.history.replaceState(null, "", "#" + p.id);
        return true;
    }

    function initProjects() {
        const grid = $("#project-grid");
        const tabs = $$("#filter-tabs [data-filter]");
        const info = $("#filter-info");
        if (!grid) return;

        const render = () => {
            grid.innerHTML = "";
            PROJECTS.forEach(p => grid.appendChild(projectCard(p)));
            observeReveal(grid);
        };
        render();

        const counts = { all: PROJECTS.length };
        PROJECTS.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });
        tabs.forEach(t => {
            const c = t.querySelector(".count");
            if (c) c.textContent = String(counts[t.getAttribute("data-filter")] || 0);
        });

        let current = "all";
        const apply = (filter, silent) => {
            current = filter;
            let shown = 0;
            tabs.forEach(t => {
                const on = t.getAttribute("data-filter") === filter;
                t.setAttribute("aria-pressed", String(on));
                t.parentElement.classList.toggle("active", on);
            });
            $$(".pcard-wrap", grid).forEach(card => {
                const match = filter === "all" || card.getAttribute("data-status") === filter;
                if (match) {
                    const wasHidden = card.hidden;
                    card.hidden = false;
                    shown++;
                    card.classList.add("is-visible");
                    if (wasHidden && !reducedMotion()) {
                        card.classList.remove("is-entering");
                        void card.offsetWidth;
                        card.classList.add("is-entering");
                    }
                } else {
                    card.hidden = true;
                }
            });
            if (info) info.textContent = `${shown} ${shown === 1 ? "сборка" : shown < 5 && shown > 0 ? "сборки" : "сборок"}`;
            if (!silent) Sound.play("folder");
            NX.storage.set("nx_filter2", filter);
        };

        tabs.forEach(t => t.addEventListener("click", () => {
            if (t.getAttribute("data-filter") === current) return;
            grid.classList.add("is-filtering");
            setTimeout(() => { apply(t.getAttribute("data-filter")); grid.classList.remove("is-filtering"); }, reducedMotion() ? 0 : 140);
        }));

        // Кнопки «Скачать» и «Подробнее» — и в карточках, и в модалке
        document.addEventListener("click", e => {
            const dl = e.target.closest("[data-dl]");
            if (dl) {
                const p = PROJECTS.find(x => x.id === dl.getAttribute("data-dl"));
                if (p) Downloads.run(p);
                return;
            }
            const det = e.target.closest("[data-details]");
            if (det) openDetails(det.getAttribute("data-details"));
        });

        // Вход / выход в другой вкладке — перерисовать допуск
        // Если в момент входа/выхода идёт загрузка — перерисуем, когда она закончится
        let stale = false;
        const refresh = () => {
            if (Object.keys(Downloads.active).length) { stale = true; return; }
            stale = false;
            render();
            apply(current, true);
        };
        document.addEventListener("nexus:auth", refresh);
        document.addEventListener("nexus:dl-idle", () => { if (stale) setTimeout(refresh, 2500); });

        const fromHash = () => {
            let h = decodeURIComponent(window.location.hash.replace("#", ""));
            if (h.indexOf("dossier-") === 0) h = h.slice(8);
            if (h === "nexuscraft") h = "modpack";
            if (h.indexOf("filter-") === 0) {
                const f = h.slice(7);
                if (f === "all" || STATUSES[f]) apply(f, true);
                return;
            }
            const p = PROJECTS.find(x => x.id === h);
            if (p) {
                const card = document.getElementById("project-" + p.id);
                if (card) {
                    if (card.hidden) apply("all", true);
                    card.scrollIntoView({ block: "center" });
                }
                openDetails(p.id, true);
            }
        };

        const saved = NX.storage.get("nx_filter2", "all");
        apply(saved === "all" || STATUSES[saved] ? saved : "all", true);
        window.addEventListener("hashchange", fromHash);
        setTimeout(fromHash, 60);
    }

    /* ================================================================
     * Кабинет
     * ================================================================ */
    const ACCESS_ROWS = [
        { name: "Портал NEXUS//DEV и devlog", level: 1 },
        { name: "Серверы NEXUS CRAFT", level: 2 },
        { name: "Бета-сборки модов FORTIFY / NEXUS TECH", level: 2 },
        { name: "Плейтесты BASTION: LINE ZERO", level: 3 },
        { name: "Перезапуск и логи игровых серверов", level: 2 },
        { name: "Dev-сборки и плагин TRENCHWORKS", level: 4 }
    ];

    /* Сборки в кабинете — те же проекты, что и в центре загрузок */
    const BUILDS = PROJECTS;

    function initDashboard() {
        const lock = $("#dash-lock");
        const app = $("#dash-app");
        if (!lock || !app) return;

        const showLocked = () => {
            lock.hidden = false;
            app.hidden = true;
        };

        const demoBtn = $("#dash-demo");
        if (demoBtn) {
            demoBtn.addEventListener("click", async () => {
                demoBtn.classList.add("is-busy");
                Auth.login({ callsign: "demo_operator", level: 3, demo: true, remember: true });
                await showBanner("ACCESS GRANTED", { sub: "DEMO ACCESS · LEVEL 3 // PLAYTESTER" });
                demoBtn.classList.remove("is-busy");
                start();
                toast("Демо-доступ активирован: LEVEL 3 // PLAYTESTER", "ok");
            });
        }

        let started = false;
        const start = () => {
            const s = Auth.get();
            if (!s) { showLocked(); return; }
            lock.hidden = true;
            app.hidden = false;
            if (NX.storage.sessionGet("nx_welcome")) {
                try { window.sessionStorage.removeItem("nx_welcome"); } catch (e) { /* ignore */ }
                setTimeout(() => toast(`Добро пожаловать, ${s.callsign}! Допуск: LEVEL ${s.level} // ${Auth.levelName(s.level)}`, "ok", { ttl: 4500 }), 350);
            }
            if (started) { renderProfile(); return; }
            started = true;
            renderProfile();
            initServerPanel();
            initSettingsPanel();
            initDownloads();
            const h = window.location.hash.replace("#", "");
            const map = { profile: "dtab-profile", servers: "dtab-servers", settings: "dtab-settings" };
            if (map[h]) Tabs.byId(map[h]);
            window.addEventListener("hashchange", () => {
                const k = window.location.hash.replace("#", "");
                if (map[k]) Tabs.byId(map[k]);
            });
            // Обновляем hash при переключении вкладки (без прокрутки)
            app.addEventListener("nexus:tab", e => {
                const key = Object.keys(map).find(k => map[k] === e.detail.id);
                if (key && window.history.replaceState) window.history.replaceState(null, "", "#" + key);
            });
            const pending = NX.storage.get("nx_pending_dl", null);
            if (pending) {
                NX.storage.remove("nx_pending_dl");
                const p = BUILDS.find(x => x.id === pending);
                if (p && canDownload(p, Auth.get())) {
                    Tabs.byId("dtab-profile");
                    setTimeout(() => {
                        const row = $(`#build-list [data-hud="${p.id}"]`);
                        if (row) row.scrollIntoView({ block: "center" });
                        toast(`Допуск подтверждён — запускаю загрузку ${p.title}`, "ok");
                        Downloads.run(p, { onDone: () => renderDownloads(true) });
                    }, 600);
                } else if (p) {
                    toast(`${p.title}: требуется допуск ${accessText(p)}. Получите код доступа у команды проекта.`, "warn", { ttl: 5000 });
                }
            }
        };

        // Выход
        $$("[data-logout]").forEach(btn => btn.addEventListener("click", () => {
            Auth.logout();
            Sound.play("denied");
            toast("Сессия завершена", "warn");
            setTimeout(() => { window.location.href = "auth.html"; }, 400);
        }));

        window.addEventListener("storage", e => {
            if (e.key === Auth.KEY && !Auth.get()) showLocked();
        });

        start();
    }

    function renderProfile() {
        const s = Auth.get();
        if (!s) return;
        drawAvatar($("#avatar-canvas"), avatarSeed(s));
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("profile-name", s.callsign);
        set("profile-id", s.id);
        set("profile-level", `LEVEL ${s.level} // ${Auth.levelName(s.level)}`);
        set("pi-callsign", s.callsign);
        set("pi-email", s.email);
        set("pi-id", s.id);
        set("pi-level", `${s.level} — ${Auth.levelName(s.level)}${s.demo ? " (DEMO)" : ""}`);
        set("pi-registered", formatDate(s.registered));
        set("pi-last", formatDate(s.lastLogin));
        set("pi-session", s.expires ? "до " + formatDate(s.expires) : "запомнена на устройстве");
        $$("#clearance-bars i").forEach((el, i) => el.classList.toggle("on", i < s.level));

        const acc = $("#access-body");
        if (acc) {
            acc.innerHTML = ACCESS_ROWS.map(r => {
                const ok = s.level >= r.level;
                return `<tr><td data-label="Ресурс">${escapeHtml(r.name)}</td><td data-label="Уровень">L${r.level} · ${Auth.levelName(r.level)}</td><td data-label="Доступ"><span class="${ok ? "access-yes" : "access-no"}">${ok ? "GRANTED" : "DENIED"}</span></td></tr>`;
            }).join("");
        }
        renderDownloads();
        NX.updateUserUI();
    }

    function renderDownloads(highlightFirst) {
        const s = Auth.get();
        const body = $("#dl-body");
        if (!s || !body) return;
        const list = s.downloads || [];
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="5" data-label="История">Загрузок пока нет</td></tr>';
            return;
        }
        body.innerHTML = list.map((d, i) => `
            <tr class="${highlightFirst && i === 0 ? "is-new" : ""}">
                <td data-label="Сборка"><b>${escapeHtml(d.build)}</b><br><span class="muted">${escapeHtml(d.version)}</span></td>
                <td data-label="Дата">${escapeHtml(formatDate(d.date))}</td>
                <td data-label="Размер">${escapeHtml(d.size)}</td>
                <td data-label="SHA-256">${escapeHtml(d.sha)}…</td>
                <td data-label="Статус"><span class="badge badge-online">${escapeHtml(d.status)}</span></td>
            </tr>`).join("");
    }

    function initDownloads() {
        const wrap = $("#build-list");
        if (!wrap) return;
        const render = () => {
            const s = Auth.get();
            if (!s) return;
            wrap.innerHTML = BUILDS.map(p => {
                const ok = canDownload(p, s);
                return `<tr data-hud="${p.id}">
                    <td data-label="Сборка" class="build-cell"><span class="build-name"><b>${escapeHtml(p.title)}</b><br><span class="muted">${escapeHtml(p.version)} · ${escapeHtml(STATUSES[p.status].short)}</span></span>${hudHtml()}</td>
                    <td data-label="Размер">${escapeHtml(p.size)}</td>
                    <td data-label="Допуск">${p.access ? "L" + p.access : "—"}</td>
                    <td data-label="Действие">${ok
                        ? `<button class="btn btn-sm btn-dl" type="button" data-dl="${p.id}">${ICON_DOWNLOAD}<span>Скачать</span></button>`
                        : `<span class="access-no">LOCKED</span>`}</td>
                </tr>`;
            }).join("");
        };
        render();
        let stale = false;
        const refresh = () => {
            if (Object.keys(Downloads.active).length) { stale = true; return; }
            stale = false;
            render();
        };
        document.addEventListener("nexus:auth", refresh);
        document.addEventListener("nexus:dl-idle", () => { if (stale) setTimeout(refresh, 2500); });

        wrap.addEventListener("click", e => {
            const btn = e.target.closest("[data-dl]");
            if (!btn) return;
            const p = BUILDS.find(x => x.id === btn.getAttribute("data-dl"));
            if (!p) return;
            Downloads.run(p, { onDone: () => renderDownloads(true) });
        });
    }

    /* ----- Управление серверами ----- */
    const actionLog = {
        el: null,
        add(text, warn) {
            if (!this.el) this.el = $("#action-log");
            if (!this.el) return;
            const line = document.createElement("div");
            if (warn) line.className = "w";
            const t = document.createElement("span");
            t.className = "t";
            t.textContent = `[${timeStr()}] `;
            line.appendChild(t);
            line.appendChild(document.createTextNode(text));
            this.el.appendChild(line);
            while (this.el.childElementCount > 120) this.el.removeChild(this.el.firstChild);
            this.el.scrollTop = this.el.scrollHeight;
        }
    };

    function initServerPanel() {
        const body = $("#srv-body");
        if (!body) return;
        const labels = ["Сервер", "Статус", "Игроки", "Ping", "CPU / RAM", "Действия"];
        const rows = {};
        const bar = cls => `<span class="loadbar ${cls}"><span class="loadbar-key">${cls === "srv-cpu" ? "CPU" : "RAM"}</span><span class="loadbar-track"><span class="loadbar-fill"></span></span><span class="loadbar-val"></span></span>`;
        SERVERS.forEach(n => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td data-label="${labels[0]}" class="srv-name"><b>${escapeHtml(n.name)}</b><span>${escapeHtml(n.id)} · ${escapeHtml(n.type)} · ${escapeHtml(n.city)}, ${n.cc}</span></td>
                <td data-label="${labels[1]}" class="srv-status"></td>
                <td data-label="${labels[2]}" class="srv-players"></td>
                <td data-label="${labels[3]}" class="srv-ping"></td>
                <td data-label="${labels[4]}" class="srv-load">${bar("srv-cpu")}${bar("srv-ram")}</td>
                <td data-label="${labels[5]}" class="srv-actions-cell"><div class="srv-actions">
                    <button class="btn btn-sm" type="button" data-restart="${n.id}" aria-label="Перезапуск ${escapeHtml(n.id)}"><img src="assets/icons/play.svg" alt="" width="14" height="14"><span>Перезапуск</span></button>
                    <button class="btn btn-sm" type="button" data-logs="${n.id}" aria-label="Логи ${escapeHtml(n.id)}"><img src="assets/icons/clipboard.svg" alt="" width="14" height="14">Логи</button>
                </div></td>`;
            body.appendChild(tr);
            rows[n.id] = tr;
        });

        const setBar = (el, v, up) => {
            const fill = el.querySelector(".loadbar-fill");
            const val = el.querySelector(".loadbar-val");
            fill.style.width = (up ? Math.round(v) : 0) + "%";
            val.textContent = up ? Math.round(v) + "%" : "—";
        };

        const render = () => {
            SERVERS.forEach(n => {
                const tr = rows[n.id];
                const up = Telemetry.isUp(n);
                const st = tr.querySelector(".srv-status");
                if (n.status === "restarting") {
                    if (!st.querySelector(".badge-restarting")) {
                        st.innerHTML = `${statusBadge("restarting")}<span class="restart-meter"><i></i></span>`;
                    }
                } else {
                    const html = statusBadge(n.status);
                    if (st.innerHTML !== html) st.innerHTML = html;
                }
                tr.querySelector(".srv-players").textContent = n.status === "restarting" ? "…" : formatPlayers(n);
                tr.querySelector(".srv-ping").textContent = up ? Math.round(n.ping) + " ms" : "—";
                setBar(tr.querySelector(".srv-cpu"), n.cpu, up);
                setBar(tr.querySelector(".srv-ram"), n.ram, up);
                tr.classList.toggle("is-offline", n.status === "offline");
                tr.classList.toggle("is-restarting", n.status === "restarting");
                const rb = tr.querySelector("[data-restart]");
                rb.querySelector("span").textContent = n.status === "offline" ? "Запуск" : "Перезапуск";
                rb.disabled = n.status === "restarting";
            });
            const s = Telemetry.summary();
            const set = (k, v) => $$(`[data-dsum='${k}']`).forEach(el => { el.textContent = v; });
            set("online", `${s.online}/${s.total}`);
            set("players", String(s.players));
            set("ping", Math.round(s.avgPing) + " ms");
            const restarting = SERVERS.filter(n => n.status === "restarting").length;
            set("ops", restarting ? `${restarting} RESTART` : "IDLE");
            const upd = $("#srv-updated");
            if (upd) upd.textContent = timeStr();
        };
        Telemetry.on(render);
        render();

        body.addEventListener("click", e => {
            const r = e.target.closest("[data-restart]");
            const l = e.target.closest("[data-logs]");
            if (r) restartServer(r.getAttribute("data-restart"), rows, render);
            if (l) openLogs(l.getAttribute("data-logs"));
        });

        const all = $("#srv-restart-all");
        if (all) {
            all.addEventListener("click", () => {
                const targets = SERVERS.filter(n => n.status === "degraded" || n.status === "offline");
                if (!targets.length) {
                    toast("Все серверы в норме — перезапуск не требуется", "ok");
                    Sound.play("info");
                    return;
                }
                targets.forEach((n, i) => setTimeout(() => restartServer(n.id, rows, render), i * 400));
            });
        }

        actionLog.add(`session: ${Auth.get().callsign} подключён к NEXUS GRID control plane`);
        actionLog.add(`grid: ${SERVERS.length} серверов под управлением, ${Telemetry.summary().online} онлайн`);
    }

    async function restartServer(id, rows, render) {
        const n = Telemetry.find(id);
        const s = Auth.get();
        if (!n || n.lock) return;
        if (!s) { Sound.play("denied"); return; }
        if (s.level < 2) {
            Sound.play("denied");
            toast("ACCESS DENIED: перезапуск доступен с уровня MEMBER", "warn");
            return;
        }
        const wasOffline = n.status === "offline";
        n.lock = true;
        n.status = "restarting";
        n.players = 0;
        Sound.play("expand");
        actionLog.add(`${s.callsign}: ${wasOffline ? "start" : "restart"} ${n.id} (${n.name})`, true);
        NX.Syslog.add(`grid: ${n.id} ${wasOffline ? "start" : "restart"} requested by ${s.callsign}`, true);
        render();

        const tr = rows[id];
        const meter = () => tr.querySelector(".restart-meter > i");
        const stages = n.type === "MINECRAFT"
            ? ["broadcast: «Сервер перезапустится через 5 секунд»", "save-all: мир сохранён", "stop: сервер остановлен", "docker: контейнер пересоздан", "paper: загрузка плагинов и мира", "healthcheck: TPS 20.0"]
            : n.type === "UE5"
                ? ["agones: drain активных матчей", "server: shutdown signal", "docker: образ bastion-server:0.3.7 загружен", "ue5: загрузка карты Ridge-01", "healthcheck: tick 30 Hz стабилен"]
                : ["nginx: graceful drain", "systemd: stop api", "postgres: соединения закрыты", "systemd: start api", "healthcheck: /health 200 OK"];
        for (let i = 0; i < stages.length; i++) {
            await delay(reducedMotion() ? 150 : randInt(550, 1000));
            actionLog.add(`${n.id}: ${stages[i]}`);
            Sound.play("stdout");
            const m = meter();
            if (m) m.style.width = Math.round(((i + 1) / stages.length) * 100) + "%";
        }
        await delay(300);
        n.status = "online";
        n.ping = 10 + n.dist * 24;
        n.cpu = rand(18, 34);
        n.ram = rand(25, 40);
        n.players = n.max > 0 ? randInt(0, Math.min(6, n.max)) : randInt(80, 160);
        n.pid = randInt(1200, 9800);
        n.lock = false;
        n.changed = true;
        Sound.play("granted");
        actionLog.add(`${n.id}: ONLINE (pid ${n.pid})`);
        NX.Syslog.add(`healthcheck: ${n.id} is back ONLINE after restart`);
        toast(`${n.id}: перезапуск завершён — ONLINE`, "ok");
        render();
        tr.classList.remove("flash");
        void tr.offsetWidth;
        tr.classList.add("flash");
        Telemetry.emit();
    }

    function logLine(n) {
        const lvl = Math.random();
        const level = lvl > 0.94 ? "ERROR" : (lvl > 0.82 ? "WARN" : "INFO");
        let msg;
        if (n.status === "offline") {
            msg = pick(["healthcheck failed: connection refused", "container exited with code 137", "waiting for operator…"]);
            return { level: "ERROR", msg };
        }
        if (n.status === "restarting") {
            return { level: "WARN", msg: pick(["shutdown in progress…", "saving state…", "starting up…"]) };
        }
        if (n.type === "MINECRAFT") {
            msg = level === "ERROR" ? pick(["Can't keep up! Is the server overloaded? Running 2140ms behind", "Exception in plugin MiniGames: NullPointerException at ArenaManager.java:212"])
                : level === "WARN" ? pick([`${pick(NICKS)} moved too quickly!`, "Chunk save took 412 ms", "fortify: trench recalculation exceeded 50 ms"])
                    : pick([`${pick(NICKS)} joined the game`, `${pick(NICKS)} left the game`, `<${pick(NICKS)}> кто строит ров у спавна?`, `Saving chunks for level 'world'`, `fortify: hedgehog placed at ${randInt(-900, 900)} ${randInt(60, 90)} ${randInt(-900, 900)}`, `TPS: 20.0, players ${Math.round(n.players)}/${n.max}`]);
        } else if (n.type === "UE5") {
            msg = level === "ERROR" ? pick(["LogNet: Warning: Connection timeout; client 7", "LogMass: Error: entity budget exceeded (1240/1200)"])
                : level === "WARN" ? pick(["LogNavigation: tile rebuild took 46 ms", "LogNet: high packet loss (3.1%) for player 4"])
                    : pick([`LogGameMode: match #${randInt(4000, 9999)} started — Ridge-0${randInt(1, 9)}`, `LogTrench: segment dug (${randInt(4, 30)} m), navmesh tiles ${randInt(2, 9)}`, `LogNet: Join succeeded: ${pick(NICKS)}`, `LogStats: tick ${rand(29.4, 30).toFixed(1)} Hz, ${randInt(600, 1150)} entities`]);
        } else {
            msg = level === "ERROR" ? pick(["upstream timed out (110) while reading response header", "token signature invalid: kid=old-2025"])
                : level === "WARN" ? pick(["rate limit hit for 203.0.113.42", "slow query 312 ms: SELECT * FROM sessions"])
                    : pick([`POST /oauth/token 200 ${randInt(8, 40)}ms`, `GET /v1/servers 200 ${randInt(2, 12)}ms`, `login ok: ${pick(NICKS)}`, "GET /health 200 1ms"]);
        }
        return { level, msg };
    }

    function openLogs(id) {
        const n = Telemetry.find(id);
        if (!n) return;
        let paused = false;
        let timer = null;
        const modal = Modal.open({
            title: "LOGS",
            subtitle: `${escapeHtml(n.id)} — tail -f`,
            className: "logs",
            html: `
                <div class="log-toolbar">
                    <span>${escapeHtml(n.name)} · ${escapeHtml(n.software)}</span>
                    <span class="legend"><span class="badge badge-online">INFO</span><span class="badge badge-degraded">WARN</span><span class="badge badge-offline">ERROR</span></span>
                </div>
                <pre class="log-tail" id="log-tail" aria-live="off"></pre>`,
            buttons: [
                {
                    label: "Пауза", action: el => {
                        paused = !paused;
                        el.textContent = paused ? "Продолжить" : "Пауза";
                        Sound.play("folder");
                        return false;
                    }
                },
                {
                    label: "Копировать", action: () => {
                        const tail = $("#log-tail");
                        NX.copyText(tail ? tail.textContent : "").then(ok => {
                            Sound.play(ok ? "granted" : "denied");
                            toast(ok ? "Логи скопированы в буфер обмена" : "Не удалось скопировать", ok ? "ok" : "warn");
                        });
                        return false;
                    }
                }
            ],
            onClose: () => { if (timer) clearInterval(timer); }
        });
        const tail = $("#log-tail", modal);
        const write = (ts, entry) => {
            const atBottom = tail.scrollHeight - tail.scrollTop - tail.clientHeight < 30;
            const line = document.createElement("div");
            if (entry.level === "WARN") line.className = "lvl-warn";
            if (entry.level === "ERROR") line.className = "lvl-err";
            const t = document.createElement("span");
            t.className = "t";
            t.textContent = `${ts} `;
            line.appendChild(t);
            line.appendChild(document.createTextNode(`[${entry.level}] ${entry.msg}`));
            tail.appendChild(line);
            while (tail.childElementCount > 400) tail.removeChild(tail.firstChild);
            if (atBottom) tail.scrollTop = tail.scrollHeight;
        };
        // Предзаполняем «историю» последних минут
        const now = Date.now();
        for (let i = 40; i > 0; i--) {
            write(timeStr(new Date(now - i * randInt(2500, 4500))), logLine(n));
        }
        tail.scrollTop = tail.scrollHeight;
        timer = setInterval(() => {
            if (paused) return;
            write(timeStr(), logLine(n));
            Sound.play("stdout");
        }, 700);
        actionLog.add(`${Auth.get() ? Auth.get().callsign : "guest"}: tail logs ${n.id}`);
    }

    /* ----- Цветовые схемы eDEX-UI (вкладка «Настройки HUD») ----- */
    function initThemePicker() {
        const grid = $("#theme-grid");
        const Theme = NX.Theme, THEMES = NX.THEMES;
        if (!grid || !Theme || !THEMES) return;
        const label = $("#theme-current");

        const palette = t => {
            const list = [`rgb(${t.r}, ${t.g}, ${t.b})`, t.light_black, t.grey, t.black, t.term.fg, t.term.cursor];
            if (t.ansi) Object.keys(t.ansi).forEach(k => list.push(t.ansi[k]));
            const seen = new Set();
            return list.filter(c => {
                const key = String(c).toLowerCase().replace(/\s+/g, "");
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).slice(0, 9);
        };

        grid.innerHTML = Theme.list().map(id => {
            const t = THEMES[id];
            const accent = `rgb(${t.r}, ${t.g}, ${t.b})`;
            const style = `--t-accent:${accent};--t-bg:${t.light_black};--t-grey:${t.grey};--t-fg:${t.term.fg}`;
            const sw = palette(t).map(c => `<i style="background:${c}"></i>`).join("");
            return `<button type="button" class="theme-card${t.variant ? " is-variant" : ""}" role="radio" aria-checked="false"
                        data-theme-id="${id}" style="${style}" title="theme ${id}">
                    <span class="theme-prev" aria-hidden="true">
                        <span class="tp-head"><b></b><b></b><b></b></span>
                        <span class="tp-title">${escapeHtml(t.label.split(" · ")[0])}</span>
                        <span class="tp-line"></span><span class="tp-line tp-short"></span>
                        <span class="tp-btn"></span>
                    </span>
                    <span class="theme-swatches" aria-hidden="true">${sw}</span>
                    <span class="theme-name">${escapeHtml(t.label)}</span>
                    <span class="theme-desc">${escapeHtml(t.variant ? "вариант: " + t.variant : t.desc)}</span>
                    <span class="theme-badge">АКТИВНА</span>
                </button>`;
        }).join("");

        const sync = () => {
            const cur = Theme.current();
            $$(".theme-card", grid).forEach(card => {
                const on = card.getAttribute("data-theme-id") === cur;
                card.classList.toggle("is-active", on);
                card.setAttribute("aria-checked", on ? "true" : "false");
                card.tabIndex = on ? 0 : -1;
            });
            if (label) label.textContent = THEMES[cur].label;
        };
        sync();

        grid.addEventListener("click", e => {
            const card = e.target.closest(".theme-card");
            if (!card) return;
            const id = card.getAttribute("data-theme-id");
            if (id === Theme.current()) { Sound.play("folder"); return; }
            Theme.set(id);
            card.classList.remove("is-picked");
            void card.offsetWidth;
            card.classList.add("is-picked");
            toast(`Тема интерфейса: ${THEMES[id].label}`, "ok");
        });
        // Клавиатура: стрелки внутри radiogroup
        grid.addEventListener("keydown", e => {
            const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
            if (!(e.key in keys)) return;
            const cards = $$(".theme-card", grid);
            const i = cards.indexOf(document.activeElement);
            if (i < 0) return;
            e.preventDefault();
            const next = cards[(i + keys[e.key] + cards.length) % cards.length];
            next.focus();
            next.click();
        });
        document.addEventListener("nexus:theme", sync);
    }

    /* ----- Настройки HUD ----- */
    function initSettingsPanel() {
        const map = {
            "set-sfx": "sfx",
            "set-intro": "intro",
            "set-grid": "grid",
            "set-glow": "glow",
            "set-motion": "motion"
        };
        const sync = () => {
            Object.keys(map).forEach(id => {
                const el = document.getElementById(id);
                if (el) el.checked = Settings.get(map[id]) !== false;
            });
            const sfx = document.getElementById("set-sfx");
            if (sfx) sfx.checked = Settings.get("sfx") === true;
            const scale = document.getElementById("set-scale");
            if (scale) scale.value = Settings.get("scale") || "normal";
        };
        sync();
        Object.keys(map).forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener("change", () => {
                if (map[id] === "sfx") { Sound.set(el.checked); return; }
                Settings.set(map[id], el.checked);
                Sound.play("folder");
                toast(`HUD: ${el.getAttribute("data-name")} — ${el.checked ? "ON" : "OFF"}`, "ok");
            });
        });
        const scale = document.getElementById("set-scale");
        if (scale) scale.addEventListener("change", () => {
            Settings.set("scale", scale.value);
            Sound.play("folder");
            toast(`HUD: масштаб — ${scale.options[scale.selectedIndex].text}`, "ok");
        });
        const reset = document.getElementById("set-reset");
        if (reset) reset.addEventListener("click", () => {
            Settings.reset();
            Sound.syncUI();
            sync();
            Sound.play("panels");
            toast("Настройки HUD сброшены к значениям по умолчанию", "ok");
        });
        const replay = document.getElementById("set-replay");
        if (replay) replay.addEventListener("click", () => {
            try { window.sessionStorage.removeItem("nx_booted"); } catch (e) { /* ignore */ }
            Settings.set("intro", true);
            window.location.href = "index.html";
        });
        document.addEventListener("nexus:settings", sync);
        initThemePicker();

        const avatarBtn = $("#avatar-regen");
        if (avatarBtn) avatarBtn.addEventListener("click", () => {
            const s = Auth.get();
            if (!s) return;
            Auth.update({ avatarSeed: (s.avatarSeed || 0) + 1 });
            renderProfile();
            Sound.play("granted");
            toast("Аватар перегенерирован", "ok");
        });
    }

    /* Таймер сессии в правой колонке кабинета */
    function initSessionClock() {
        const el = $("#session-timer");
        if (!el) return;
        const t0 = Date.now();
        setInterval(() => {
            const sec = Math.floor((Date.now() - t0) / 1000);
            el.textContent = `${Math.floor(sec / 3600)}:${NX.pad(Math.floor(sec / 60) % 60)}:${NX.pad(sec % 60)}`;
        }, 1000);
    }

    /* ================================================================
     * Авторизация
     * ================================================================ */
    function initAuth() {
        const panel = $("#auth-panel");
        if (!panel) return;
        const sessionView = $("#auth-session");
        /* Тряска рамки при ошибке — на обёртке, чтобы не перебить анимацию появления .shell-anim */
        const shakeTarget = panel.parentElement;
        const shake = () => {
            shakeTarget.classList.remove("shake");
            void shakeTarget.offsetWidth;
            shakeTarget.classList.add("shake");
        };
        const formsView = $("#auth-forms");

        const renderSession = () => {
            const s = Auth.get();
            if (s) {
                formsView.hidden = true;
                sessionView.hidden = false;
                drawAvatar($("#auth-avatar"), avatarSeed(s));
                $("#auth-session-name").textContent = s.callsign;
                $("#auth-session-meta").textContent = `${s.id} · LEVEL ${s.level} // ${Auth.levelName(s.level)}`;
            } else {
                formsView.hidden = false;
                sessionView.hidden = true;
            }
        };

        const logoutBtn = $("#auth-logout");
        if (logoutBtn) logoutBtn.addEventListener("click", () => {
            Auth.logout();
            Sound.play("denied");
            toast("Сессия завершена", "warn");
            renderSession();
        });

        // Хэш #register открывает вкладку регистрации
        if (window.location.hash === "#register") Tabs.byId("atab-register");
        window.addEventListener("hashchange", () => {
            if (window.location.hash === "#register") Tabs.byId("atab-register");
            if (window.location.hash === "#login") Tabs.byId("atab-login");
        });

        // Показ / скрытие пароля
        $$("[data-reveal]").forEach(btn => {
            btn.addEventListener("click", () => {
                const input = document.getElementById(btn.getAttribute("data-reveal"));
                if (!input) return;
                const show = input.type === "password";
                input.type = show ? "text" : "password";
                btn.setAttribute("aria-pressed", String(show));
                btn.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
                Sound.play("stdin");
            });
        });

        // Индикатор надёжности пароля
        const regPass = $("#reg-pass");
        const meter = $("#reg-strength");
        if (regPass && meter) {
            regPass.addEventListener("input", () => {
                const v = regPass.value;
                let lvl = 0;
                if (v.length >= 6) lvl++;
                if (v.length >= 10) lvl++;
                if (/[A-ZА-Я]/.test(v) && /[a-zа-я]/.test(v)) lvl++;
                if (/\d/.test(v) && /[^\wА-Яа-я]/.test(v)) lvl++;
                meter.setAttribute("data-level", String(v ? Math.max(1, lvl) : 0));
            });
        }

        // Ввод в верхнем регистре для кода доступа
        $$("input[data-upper]").forEach(inp => inp.addEventListener("input", () => {
            const pos = inp.selectionStart;
            inp.value = inp.value.toUpperCase();
            try { inp.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
        }));

        // Звук набора в полях
        $$("#auth-forms .input").forEach(inp => inp.addEventListener("keydown", e => {
            if (e.key.length === 1) Sound.play("stdin");
        }));

        const setError = (input, msg) => {
            const field = input.closest(".field");
            if (!field) return;
            field.classList.toggle("is-invalid", !!msg);
            const err = field.querySelector(".field-error");
            if (err) err.textContent = msg || "";
            input.setAttribute("aria-invalid", msg ? "true" : "false");
        };
        $$("#auth-forms .input, #auth-forms input[type=checkbox]").forEach(inp => {
            inp.addEventListener("input", () => setError(inp, ""));
            inp.addEventListener("change", () => setError(inp, ""));
        });

        const verifyLog = $("#verify-log");
        const vlog = (text, cls) => {
            const line = document.createElement("div");
            if (cls) line.className = cls;
            line.textContent = text;
            verifyLog.appendChild(line);
            verifyLog.scrollTop = verifyLog.scrollHeight;
            Sound.play("stdout");
            return line;
        };

        let busy = false;
        const runSequence = async (opts) => {
            if (busy) return;
            busy = true;
            panel.classList.add("is-busy");
            verifyLog.innerHTML = "";
            verifyLog.classList.add("active");
            const fast = reducedMotion();
            const step = async (text, ok) => {
                const line = vlog("> " + text);
                await delay(fast ? 60 : randInt(260, 480));
                if (ok === false) {
                    line.className = "fail";
                    line.textContent += " [ FAIL ]";
                } else {
                    line.className = "ok";
                }
            };
            await step(`handshake nexus-id.auth (TLS 1.3)`);
            await step(opts.register ? `registering callsign "${opts.callsign}"` : `lookup callsign "${opts.callsign}"`);
            await step("verifying credentials");
            if (opts.code !== undefined && opts.code !== "") {
                await step(`access code ${opts.code.replace(/./g, (c, i) => i < 2 ? c : "•")}`, opts.codeOk);
            }
            if (opts.fail) {
                vlog(`ERROR: ${opts.fail}`, "fail");
                shake();
                await showBanner("ACCESS DENIED", { denied: true, sub: opts.fail });
                panel.classList.remove("is-busy");
                busy = false;
                return;
            }
            await step(`clearance LEVEL ${opts.level} // ${Auth.levelName(opts.level)}`);
            vlog("session token issued (stored locally, demo mode)");
            Auth.login({ callsign: opts.callsign, email: opts.email, level: opts.level, remember: opts.remember, demo: opts.demo, registered: opts.register ? Date.now() : undefined });
            NX.storage.sessionSet("nx_welcome", "1");
            await showBanner("ACCESS GRANTED", { keep: true, sub: `${opts.callsign.toUpperCase()} · LEVEL ${opts.level} — переход в кабинет…` });
            await delay(fast ? 150 : 650);
            window.location.href = "dashboard.html";
        };

        const CALLSIGN_RE = /^[A-Za-z0-9_.\-]{3,24}$/;
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

        const resolveCode = raw => {
            const code = (raw || "").trim().toUpperCase();
            if (!code) return { code: "", level: 2, ok: true };
            const lvl = ACCESS_CODES[code];
            return { code, level: lvl || 2, ok: !!lvl };
        };

        // ---- Вход
        const loginForm = $("#login-form");
        if (loginForm) loginForm.addEventListener("submit", e => {
            e.preventDefault();
            const id = $("#login-id"), pass = $("#login-pass"), code = $("#login-code");
            let valid = true;
            const v = id.value.trim();
            if (!v) { setError(id, "Введите позывной или email"); valid = false; }
            else if (!CALLSIGN_RE.test(v) && !EMAIL_RE.test(v)) { setError(id, "Позывной: 3–24 символа A–Z, 0–9, _ . - или корректный email"); valid = false; }
            if (pass.value.length < 6) { setError(pass, "Пароль — минимум 6 символов"); valid = false; }
            if (!valid) {
                Sound.play("denied");
                shake();
                return;
            }
            const c = resolveCode(code.value);
            const isEmail = EMAIL_RE.test(v);
            const callsign = isEmail ? v.split("@")[0].replace(/[^A-Za-z0-9_.\-]/g, "").slice(0, 24) || "operator" : v;
            runSequence({
                callsign,
                email: isEmail ? v : undefined,
                level: c.level,
                code: c.code,
                codeOk: c.ok,
                fail: c.ok ? null : "код доступа не распознан",
                remember: $("#login-remember").checked
            });
        });

        // ---- Регистрация
        const regForm = $("#register-form");
        if (regForm) regForm.addEventListener("submit", e => {
            e.preventDefault();
            const nick = $("#reg-callsign"), mail = $("#reg-email"), pass = $("#reg-pass"), pass2 = $("#reg-pass2"), code = $("#reg-code"), rules = $("#reg-rules");
            let valid = true;
            if (!CALLSIGN_RE.test(nick.value.trim())) { setError(nick, "3–24 символа: латиница, цифры, _ . -"); valid = false; }
            if (!EMAIL_RE.test(mail.value.trim())) { setError(mail, "Некорректный email"); valid = false; }
            if (pass.value.length < 8) { setError(pass, "Минимум 8 символов"); valid = false; }
            if (pass2.value !== pass.value || !pass2.value) { setError(pass2, "Пароли не совпадают"); valid = false; }
            if (!rules.checked) { setError(rules, "Необходимо принять правила"); valid = false; }
            if (!valid) {
                Sound.play("denied");
                shake();
                return;
            }
            const c = resolveCode(code.value);
            runSequence({
                register: true,
                callsign: nick.value.trim(),
                email: mail.value.trim(),
                level: c.level,
                code: c.code,
                codeOk: c.ok,
                fail: c.ok ? null : "код доступа не распознан",
                remember: true
            });
        });

        // ---- DEMO ACCESS
        $$("[data-demo-login]").forEach(btn => btn.addEventListener("click", async () => {
            if (busy) return;
            Tabs.byId("atab-login");
            const id = $("#login-id"), pass = $("#login-pass"), code = $("#login-code");
            const fill = async (input, text) => {
                input.value = "";
                for (let i = 0; i < text.length; i++) {
                    input.value += text[i];
                    Sound.play("stdin");
                    await delay(reducedMotion() ? 0 : 28);
                }
            };
            await fill(id, "demo_operator");
            await fill(pass, "••••••••".replace(/•/g, "x"));
            await fill(code, "PLAYTEST");
            runSequence({ callsign: "demo_operator", level: 3, code: "PLAYTEST", codeOk: true, remember: true, demo: true });
        }));

        renderSession();
    }

    /* ================================================================
     * Старт
     * ================================================================ */
    initServerBindings();
    if (PAGE === "projects") initProjects();
    if (PAGE === "dashboard") { initDashboard(); initSessionClock(); }
    if (PAGE === "auth") initAuth();

    // Смена цветовой схемы: перерисовать canvas-аватары (они рисуются один раз)
    document.addEventListener("nexus:theme", () => {
        $$("canvas[data-avatar-seed]").forEach(c => drawAvatar(c, c.getAttribute("data-avatar-seed")));
    });

    NX.Pages = { openDetails, drawAvatar, Downloads };
})();
