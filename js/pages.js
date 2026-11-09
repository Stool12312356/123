/*
 * pages.js — логика страниц NEXUS//DEV
 * ------------------------------------------------------------------
 * Подключается на всех страницах после js/ui-effects.js и использует
 * его API (window.NEXUS). Страница определяется по <body data-page>:
 *   home      — index.html      (ядро экосистемы — логика в ui-effects.js)
 *   projects  — projects.html   (фильтры, карточки, загрузки, досье, конструктор проектов)
 *   dashboard — dashboard.html  (профиль и роль, настройки HUD)
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
        Settings, Sound, Auth, ACCESS_CODES, ROLES, ROLE_IDS, PERMISSIONS, ACCESS, Catalog, PROJECT_ICONS,
        toast, showBanner, Modal, Tabs, Telemetry, statusBadge, formatPlayers,
        PROJECTS, CATEGORIES, BASE_CATEGORIES, STATUSES, observeReveal, reducedMotion } = NX;

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

    function canDownload(p) {
        return Auth.canDownload(p);
    }

    function accessText(p) {
        return (ACCESS[p.access] || ACCESS.public).label;
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

    function dlButtonInner(p) {
        return `${canDownload(p) ? ICON_DOWNLOAD : ICON_LOCK}<span>${p.url ? "СКАЧАТЬ" : "СКАЧАТЬ СБОРКУ"}</span>`;
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
            if (canDownload(p)) return true;
            Sound.play("denied");
            if (!s) {
                NX.storage.set("nx_pending_dl", p.id);
                toast(`${p.title}: нужен вход (доступ: ${accessText(p)}). Перенаправляю на вход…`, "warn");
                setTimeout(() => { window.location.href = "auth.html"; }, 1300);
            } else {
                toast(`${p.title}: доступ «${accessText(p)}», у вас роль ${ROLES[s.role].label}. Сменить роль — в кабинете или командой role.`, "warn", { ttl: 5200 });
            }
            return false;
        },
        /* Внешняя ссылка (проекты из конструктора): открываем сразу, в обработчике клика,
           чтобы браузер не заблокировал новую вкладку */
        openLink(p) {
            const a = document.createElement("a");
            a.href = p.url;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            document.body.appendChild(a);
            a.click();
            a.remove();
            Sound.play("granted");
            const s = Auth.get();
            if (s) {
                Auth.addDownload({ build: p.title, version: p.version, date: Date.now(), size: p.size, sha: "external", status: "LINK" });
                NX.Syslog.add(`downloads: ${s.callsign} opened ${p.title} ${p.version} (external link)`);
            }
            toast(`${p.title} ${p.version}: открываю ссылку на скачивание в новой вкладке`, "ok", { ttl: 4200 });
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
            if (p.url) { this.openLink(p); if (typeof opts.onDone === "function") opts.onDone("external"); return; }
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
            btns().forEach(b => { b.classList.remove("is-running"); b.innerHTML = dlButtonInner(p); });
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
     * Проекты — витрина загрузок + конструктор (ADMIN / CREATOR)
     * ================================================================ */
    const ICON_EDIT = '<img src="assets/icons/edit.svg" alt="" width="15" height="15">';
    const ICON_DELETE = '<img src="assets/icons/ban.svg" alt="" width="15" height="15">';

    function categoryLabel(p) {
        return CATEGORIES[p.category] || CATEGORIES.other;
    }

    /* Обложка карточки: загруженная картинка или векторная HUD-графика с иконкой */
    function artHtml(p, iconSize) {
        const cover = p.cover
            ? `<img class="art-cover" src="${escapeHtml(p.cover)}" alt="" loading="lazy">`
            : `${projectArt(p)}<span class="art-icon"><img src="assets/icons/${escapeHtml(p.icon)}.svg" alt="" width="${iconSize}" height="${iconSize}"></span>`;
        return `${cover}
            <span class="art-code">${escapeHtml(p.code)}</span>
            <span class="art-cat">${escapeHtml(categoryLabel(p))}</span>
            ${p.custom ? '<span class="art-flag">CUSTOM</span>' : (p.edited ? '<span class="art-flag">EDITED</span>' : "")}`;
    }

    function tagsHtml(p) {
        if (!p.tags || !p.tags.length) return "";
        return `<ul class="ptags" aria-label="Стек и особенности">${p.tags.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
    }

    /* Кнопки управления — видимость по роли переключается через data-require без перерисовки */
    function adminButtonsHtml(p) {
        return `<div class="pcard-admin" data-require="edit">
            <button class="btn btn-sm" type="button" data-edit="${p.id}" data-require="edit">${ICON_EDIT}<span>РЕДАКТИРОВАТЬ</span></button>
            <button class="btn btn-sm btn-danger" type="button" data-delete="${p.id}" data-require="delete" data-require-id="${p.id}">${ICON_DELETE}<span>УДАЛИТЬ</span></button>
        </div>`;
    }

    function projectCard(p) {
        const wrap = document.createElement("div");
        wrap.className = "pcard-wrap glow on-scroll";
        wrap.setAttribute("data-status", p.status);
        wrap.setAttribute("data-category", p.category);
        wrap.setAttribute("data-hud", p.id);
        wrap.id = "project-" + p.id;
        wrap.innerHTML = `
            <article class="pcard aug-card" augmented-ui="tl-clip br-clip exe" aria-labelledby="ptitle-${p.id}">
                <div class="pcard-art art-${escapeHtml(p.category)}${p.cover ? " has-cover" : ""}">
                    ${artHtml(p, 34)}
                </div>
                <div class="pcard-body">
                    ${badgeHtml(p)}
                    <h3 id="ptitle-${p.id}">${escapeHtml(p.title)}</h3>
                    <p class="summary">${escapeHtml(p.summary)}</p>
                    ${tagsHtml(p)}
                    <dl class="pmeta">
                        <div><dt>Версия</dt><dd>${escapeHtml(p.version)}</dd></div>
                        <div><dt>Размер</dt><dd>${escapeHtml(p.size)}</dd></div>
                        <div><dt>Платформа</dt><dd>${escapeHtml(p.platform)}</dd></div>
                    </dl>
                    ${hudHtml()}
                    <div class="pcard-actions">
                        <button class="btn btn-primary btn-dl" type="button" data-dl="${p.id}">${dlButtonInner(p)}</button>
                        <button class="btn btn-ghost" type="button" data-details="${p.id}"><img src="assets/icons/info.svg" alt="" width="16" height="16"><span>Досье</span></button>
                    </div>
                    ${adminButtonsHtml(p)}
                    <p class="pcard-access${canDownload(p) ? " is-ok" : ""}" data-access="${p.id}">${accessLine(p)}</p>
                </div>
            </article>`;
        NX.applyPermissions(wrap);
        return wrap;
    }

    function accessLine(p) {
        const s = Auth.get();
        if (!p.access || p.access === "public") return "Публичный релиз · вход не требуется";
        if (canDownload(p)) return `Доступ открыт · ${accessText(p)}`;
        return s ? `Нужна роль ${ACCESS[p.access].short} · у вас ${ROLES[s.role].label}` : `Нужен вход · ${accessText(p)}`;
    }

    function openDetails(id, fromHash) {
        const p = PROJECTS.find(x => x.id === id);
        if (!p) return false;
        const notes = p.notes && p.notes.length ? p.notes.map(n => `
                            <div class="pd-note">
                                <p class="pd-note-head"><b>v${escapeHtml(n.version)}</b><span>${escapeHtml(n.date || "")}</span></p>
                                <ul class="log">${n.items.map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
                            </div>`).join("") : '<p class="muted">Патчноут пока не опубликован.</p>';
        const html = `
            <div class="pd" data-hud="${p.id}">
                <div class="pd-art pcard-art art-${escapeHtml(p.category)}${p.cover ? " has-cover" : ""}">
                    ${artHtml(p, 40)}
                </div>
                <div class="pd-head">
                    ${badgeHtml(p)}
                    <p>${escapeHtml(p.summary)}</p>
                    ${tagsHtml(p)}
                </div>
                <div class="pd-grid">
                    <div>
                        <h5>Сборка</h5>
                        <table class="edex-table pd-table"><tbody>
                            <tr><td>Версия</td><td>${escapeHtml(p.version)}</td></tr>
                            <tr><td>Обновлено</td><td>${escapeHtml(p.updated)}</td></tr>
                            <tr><td>Размер</td><td>${escapeHtml(p.size)}</td></tr>
                            <tr><td>Платформа</td><td>${escapeHtml(p.platform)}</td></tr>
                            <tr><td>${p.url ? "Ссылка" : "Файл"}</td><td class="pd-file">${escapeHtml(p.url || p.file)}</td></tr>
                            <tr><td>Доступ</td><td>${escapeHtml(accessText(p))}</td></tr>
                            ${p.custom ? `<tr><td>Автор</td><td>${escapeHtml(p.author || "—")}</td></tr>` : ""}
                        </tbody></table>
                        ${p.requirements ? `<h5>Требования</h5><p>${escapeHtml(p.requirements)}</p>` : ""}
                    </div>
                    <div>
                        <h5>Patch notes</h5>
                        ${notes}
                    </div>
                </div>
                ${hudHtml()}
                <p class="pcard-access${canDownload(p) ? " is-ok" : ""}">${accessLine(p)}</p>
                <div class="pd-actions">
                    <button class="btn btn-primary btn-dl" type="button" data-dl="${p.id}">${dlButtonInner(p)}</button>
                    <button class="btn" type="button" data-edit="${p.id}" data-require="edit">${ICON_EDIT}<span>РЕДАКТИРОВАТЬ</span></button>
                    <button class="btn btn-danger" type="button" data-delete="${p.id}" data-require="delete" data-require-id="${p.id}">${ICON_DELETE}<span>УДАЛИТЬ</span></button>
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
        NX.applyPermissions(modal);
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

    /* ----- Патчноут: текст ⇄ структура { version, date, items } -----
       Строка «v1.2.0 · 2026-11-09» начинает новую версию, остальные строки — пункты списка. */
    function notesToText(notes) {
        return (notes || []).map(n => [`v${n.version}${n.date ? " · " + n.date : ""}`]
            .concat(n.items.map(i => "- " + i)).join("\n")).join("\n\n");
    }
    function textToNotes(text, version) {
        const notes = [];
        let cur = null;
        String(text || "").split(/\r?\n/).forEach(raw => {
            const l = raw.trim();
            if (!l) return;
            const m = /^v(\d[\w.+\-]*)\s*(?:[·|—]\s*(.+))?$/i.exec(l);
            if (m) {
                cur = { version: m[1], date: (m[2] || "").trim().slice(0, 20), items: [] };
                notes.push(cur);
                return;
            }
            if (!cur) {
                cur = { version: version, date: NX.dateISO(new Date()), items: [] };
                notes.push(cur);
            }
            cur.items.push(l.replace(/^[-•*]\s*/, "").slice(0, 240));
        });
        return notes.filter(n => n.items.length).slice(0, 12).map(n => Object.assign(n, { items: n.items.slice(0, 30) }));
    }

    /* Сжатие картинки через <canvas>: не больше 960×540, JPEG — чтобы уместиться в localStorage */
    function compressImage(file) {
        return new Promise((resolve, reject) => {
            if (!file || !/^image\//.test(file.type)) { reject(new Error("type")); return; }
            if (file.size > 20 * 1024 * 1024) { reject(new Error("size")); return; }
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("read"));
            reader.onload = () => {
                const img = new Image();
                img.onerror = () => reject(new Error("decode"));
                img.onload = () => {
                    const encode = (maxW, maxH, q) => {
                        const k = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
                        const w = Math.max(1, Math.round(img.naturalWidth * k));
                        const h = Math.max(1, Math.round(img.naturalHeight * k));
                        const c = document.createElement("canvas");
                        c.width = w;
                        c.height = h;
                        const ctx = c.getContext("2d");
                        ctx.fillStyle = "#0b0d0c";
                        ctx.fillRect(0, 0, w, h);
                        ctx.drawImage(img, 0, 0, w, h);
                        return c.toDataURL("image/jpeg", q);
                    };
                    try {
                        let url = encode(960, 540, 0.82);
                        if (url.length > 420000) url = encode(800, 450, 0.7);
                        if (url.length > 420000) url = encode(640, 360, 0.6);
                        resolve(url);
                    } catch (e) {
                        reject(new Error("canvas"));
                    }
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    const DEFAULT_ACCESS = { available: "public", closed: "user", dev: "admin" };
    const DEFAULT_PLATFORM = { ue5: "Windows · DX12", minecraft: "Java 1.21.1", tools: "Windows · Linux", other: "—" };

    /* Конструктор / редактор проекта */
    function openEditor(id) {
        const editing = id ? PROJECTS.find(x => x.id === id) : null;
        if (id && !editing) return;
        if (!Auth.can(editing ? "edit" : "create")) {
            Sound.play("denied");
            toast(`${editing ? "Редактирование" : "Создание"} проектов доступно ролям ADMIN и CREATOR. Сменить роль: кабинет или команда role.`, "warn", { ttl: 5000 });
            return;
        }
        const d = editing || { title: "", category: "ue5", status: "available", access: "public", version: "", file: "", url: "",
            sizeMB: "", platform: "", summary: "", notes: [], tags: [], icon: "archive", cover: "" };
        const state = { cover: d.cover || "", icon: d.icon || "archive", accessTouched: !!editing };
        const opt = (obj, cur) => Object.keys(obj).map(k => `<option value="${escapeHtml(k)}"${k === cur ? " selected" : ""}>${escapeHtml(typeof obj[k] === "string" ? obj[k] : obj[k].label)}</option>`).join("");
        const icons = PROJECT_ICONS.map(ic => `
            <label class="pe-icon" title="${ic}">
                <input type="radio" name="pe-icon" value="${ic}"${ic === state.icon ? " checked" : ""}>
                <span><img src="assets/icons/${ic}.svg" alt="${ic}" width="22" height="22"></span>
            </label>`).join("");
        const html = `
            <form class="pe-form" id="pe-form" novalidate>
                <div class="pe-grid">
                    <div class="pe-col">
                        <div class="field">
                            <label for="pe-title">Название проекта</label>
                            <input class="input" id="pe-title" type="text" maxlength="${Catalog.MAX_TITLE}" placeholder="Например: IRON FRONT" value="${escapeHtml(d.title)}" required>
                            <p class="field-error" aria-live="polite"></p>
                        </div>
                        <div class="pe-row">
                            <div class="field">
                                <label for="pe-category">Категория / тег</label>
                                <select class="select" id="pe-category">${opt(CATEGORIES, d.category)}</select>
                            </div>
                            <div class="field">
                                <label for="pe-status">Статус</label>
                                <select class="select" id="pe-status">${Object.keys(STATUSES).map(k => `<option value="${k}"${k === d.status ? " selected" : ""}>${escapeHtml(STATUSES[k].label)}</option>`).join("")}</select>
                            </div>
                        </div>
                        <div class="pe-row">
                            <div class="field">
                                <label for="pe-version">Версия сборки</label>
                                <input class="input" id="pe-version" type="text" maxlength="32" placeholder="v0.1.0-alpha" value="${escapeHtml(d.version ? "v" + d.version : "")}" required>
                                <p class="field-error" aria-live="polite"></p>
                            </div>
                            <div class="field">
                                <label for="pe-access">Кто может скачивать</label>
                                <select class="select" id="pe-access">${opt(ACCESS, d.access)}</select>
                            </div>
                        </div>
                        <div class="field">
                            <label for="pe-file">Ссылка или имя файла <i>— https://… откроется при скачивании</i></label>
                            <input class="input" id="pe-file" type="text" maxlength="400" spellcheck="false" placeholder="https://example.com/build.zip или MyGame-0.1.0-Win64.zip" value="${escapeHtml(d.url || d.file)}" required>
                            <p class="field-error" aria-live="polite"></p>
                        </div>
                        <div class="pe-row">
                            <div class="field">
                                <label for="pe-size">Размер, MiB <i>— необязательно</i></label>
                                <input class="input" id="pe-size" type="number" min="0.1" max="500000" step="0.1" placeholder="50" value="${escapeHtml(d.sizeMB || "")}">
                            </div>
                            <div class="field">
                                <label for="pe-platform">Платформа <i>— необязательно</i></label>
                                <input class="input" id="pe-platform" type="text" maxlength="40" placeholder="${escapeHtml(DEFAULT_PLATFORM[d.category] || "—")}" value="${escapeHtml(editing ? d.platform : "")}">
                            </div>
                        </div>
                        <div class="field">
                            <label for="pe-tags">Стек технологий / особенности <i>— через запятую</i></label>
                            <input class="input" id="pe-tags" type="text" maxlength="240" placeholder="UE5, C++, Multiplayer, Lumen" value="${escapeHtml((d.tags || []).join(", "))}">
                            <ul class="ptags pe-tags-preview" id="pe-tags-preview" aria-hidden="true"></ul>
                        </div>
                    </div>
                    <div class="pe-col">
                        <p class="pe-label">Обложка / картинка</p>
                        <div class="pe-cover pcard-art" id="pe-cover"></div>
                        <div class="pe-cover-actions">
                            <label class="btn btn-sm pe-upload">
                                <img src="assets/icons/upload.svg" alt="" width="15" height="15">
                                <span>Загрузить изображение</span>
                                <input type="file" id="pe-file-input" accept="image/*">
                            </label>
                            <button class="btn btn-sm" type="button" id="pe-cover-clear">${ICON_DELETE}<span>Убрать</span></button>
                        </div>
                        <p class="pe-hint" id="pe-cover-info">JPG / PNG / WebP · сжимается до 960×540 и хранится в браузере</p>
                        <p class="pe-label">Иконка <i>— если картинка не загружена</i></p>
                        <div class="pe-icons" role="radiogroup" aria-label="Иконка проекта">${icons}</div>
                    </div>
                </div>
                <div class="field">
                    <label for="pe-summary">Краткое описание <i>— для карточки</i> <span class="pe-count" id="pe-summary-count">0/220</span></label>
                    <textarea class="input pe-textarea" id="pe-summary" rows="2" maxlength="220" placeholder="Одно-два предложения: что это и для кого." required>${escapeHtml(d.summary)}</textarea>
                    <p class="field-error" aria-live="polite"></p>
                </div>
                <div class="field">
                    <label for="pe-notes">Подробное описание / патчноут <i>— для окна «Досье»; строка «v0.2.0 · 2026-11-09» начинает новую версию</i></label>
                    <textarea class="input pe-textarea" id="pe-notes" rows="6" maxlength="6000" placeholder="v0.1.0 · ${NX.dateISO(new Date())}&#10;- Первая публичная сборка&#10;- Поддержка геймпада">${escapeHtml(notesToText(d.notes))}</textarea>
                </div>
                <div class="field">
                    <label for="pe-req">Требования <i>— необязательно</i></label>
                    <input class="input" id="pe-req" type="text" maxlength="300" placeholder="Windows 10+, 8 GiB RAM" value="${escapeHtml(d.requirements || "")}">
                </div>
            </form>`;

        const modal = Modal.open({
            title: editing ? "РЕДАКТИРОВАНИЕ ПРОЕКТА" : "НОВЫЙ ПРОЕКТ",
            subtitle: editing ? `${escapeHtml(editing.code)} · ${escapeHtml(editing.title)}` : "конструктор · nx_custom_projects",
            className: "pe-modal",
            html,
            buttons: [{ label: editing ? "Сохранить" : "Опубликовать", primary: true, icon: editing ? "checkmark" : "upload", action: () => submit() }]
        });
        const f = id2 => $("#" + id2, modal);
        const cover = f("pe-cover");
        const coverInfo = f("pe-cover-info");

        const drawCover = () => {
            const preview = {
                id: editing ? editing.id : "new-" + (f("pe-title").value || "x"),
                code: editing ? editing.code : Catalog.nextCode(),
                category: f("pe-category").value,
                icon: state.icon,
                cover: state.cover,
                custom: !editing || editing.custom,
                edited: !!editing && !editing.custom
            };
            cover.className = `pe-cover pcard-art art-${preview.category}${state.cover ? " has-cover" : ""}`;
            cover.innerHTML = artHtml(preview, 40);
            f("pe-cover-clear").disabled = !state.cover;
        };
        const drawTags = () => {
            const tags = f("pe-tags").value.split(",").map(t => t.trim()).filter(Boolean).slice(0, 12);
            f("pe-tags-preview").innerHTML = tags.map(t => `<li>${escapeHtml(t.slice(0, 28))}</li>`).join("");
        };
        const drawCount = () => {
            f("pe-summary-count").textContent = `${f("pe-summary").value.length}/220`;
        };
        drawCover();
        drawTags();
        drawCount();

        f("pe-tags").addEventListener("input", drawTags);
        f("pe-summary").addEventListener("input", drawCount);
        f("pe-category").addEventListener("change", () => {
            drawCover();
            f("pe-platform").placeholder = DEFAULT_PLATFORM[f("pe-category").value] || "—";
        });
        f("pe-status").addEventListener("change", () => {
            if (!state.accessTouched) f("pe-access").value = DEFAULT_ACCESS[f("pe-status").value] || "public";
        });
        f("pe-access").addEventListener("change", () => { state.accessTouched = true; });
        $$("input[name='pe-icon']", modal).forEach(r => r.addEventListener("change", () => {
            state.icon = r.value;
            Sound.play("folder");
            drawCover();
        }));
        f("pe-file-input").addEventListener("change", e => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            coverInfo.textContent = "Обработка изображения…";
            compressImage(file).then(url => {
                state.cover = url;
                coverInfo.textContent = `${file.name.slice(0, 40)} → ${Math.round(url.length * 0.75 / 1024)} KiB (JPEG)`;
                Sound.play("granted");
                drawCover();
            }).catch(err => {
                coverInfo.textContent = err.message === "type" ? "Это не изображение — выберите JPG, PNG или WebP"
                    : err.message === "size" ? "Файл больше 20 MiB — выберите изображение поменьше" : "Не удалось прочитать изображение";
                Sound.play("denied");
            });
            e.target.value = "";
        });
        f("pe-cover-clear").addEventListener("click", () => {
            state.cover = "";
            coverInfo.textContent = "Картинка убрана — используется иконка";
            Sound.play("panels");
            drawCover();
        });
        $$(".input", modal).forEach(inp => {
            inp.addEventListener("input", () => setFieldError(inp, ""));
            inp.addEventListener("keydown", e => { if (e.key.length === 1) Sound.play("stdin"); });
        });
        f("pe-form").addEventListener("submit", e => { e.preventDefault(); if (submit()) Modal.close(); });

        function setFieldError(input, msg) {
            const field = input.closest(".field");
            if (!field) return;
            field.classList.toggle("is-invalid", !!msg);
            const err = field.querySelector(".field-error");
            if (err) err.textContent = msg || "";
            input.setAttribute("aria-invalid", msg ? "true" : "false");
        }

        function submit() {
            const title = f("pe-title").value.trim().replace(/\s+/g, " ");
            const version = f("pe-version").value.trim().replace(/^v/i, "");
            const target = f("pe-file").value.trim();
            const summary = f("pe-summary").value.trim();
            let ok = true;
            if (title.length < 2) { setFieldError(f("pe-title"), "Минимум 2 символа"); ok = false; }
            if (!/^[0-9A-Za-z][0-9A-Za-z.+\-_]{0,31}$/.test(version)) { setFieldError(f("pe-version"), "Например: v0.1.0-alpha"); ok = false; }
            const isUrl = /^https?:\/\/\S+$/i.test(target);
            if (!target) { setFieldError(f("pe-file"), "Укажите ссылку https://… или имя файла"); ok = false; }
            else if (!isUrl && /^[a-z]+:/i.test(target)) { setFieldError(f("pe-file"), "Разрешены только ссылки http(s):// или имя файла"); ok = false; }
            if (summary.length < 10) { setFieldError(f("pe-summary"), "Минимум 10 символов"); ok = false; }
            if (!ok) {
                Sound.play("denied");
                const bad = $(".field.is-invalid .input", modal);
                if (bad) bad.focus();
                return false;
            }
            const category = f("pe-category").value;
            const data = {
                title,
                category,
                status: f("pe-status").value,
                access: f("pe-access").value,
                version,
                url: isUrl ? target : "",
                file: isUrl ? (target.split(/[?#]/)[0].split("/").pop() || "download") : target,
                sizeMB: parseFloat(f("pe-size").value) || (editing ? editing.sizeMB : 50),
                platform: f("pe-platform").value.trim() || (editing ? editing.platform : DEFAULT_PLATFORM[category]) || "—",
                summary,
                notes: textToNotes(f("pe-notes").value, version),
                requirements: f("pe-req").value.trim(),
                tags: f("pe-tags").value.split(",").map(t => t.trim().slice(0, 28)).filter(Boolean).slice(0, 12),
                icon: state.icon,
                cover: state.cover
            };
            if (editing && Downloads.active[editing.id]) Downloads.cancel(editing.id);
            const res = editing ? Catalog.update(editing.id, data) : Catalog.create(data);
            if (!res.ok) {
                Sound.play("denied");
                toast(res.error === "quota"
                    ? "Не хватает места в localStorage — уберите или уменьшите картинку, удалите старые проекты"
                    : "Недостаточно прав для этого действия", "warn", { ttl: 5200 });
                return false;
            }
            Sound.play("granted");
            toast(editing ? `Проект обновлён: ${res.project.title}` : `Проект опубликован: ${res.project.title} (${res.project.code})`, "ok");
            NX.Syslog.add(`catalog: ${Auth.get().callsign} ${editing ? "updated" : "created"} ${res.project.id}`);
            setTimeout(() => {
                const card = document.getElementById("project-" + res.project.id);
                if (card) {
                    card.scrollIntoView({ block: "center", behavior: reducedMotion() ? "auto" : "smooth" });
                    card.classList.remove("is-new");
                    void card.offsetWidth;
                    card.classList.add("is-new");
                }
            }, 220);
            return true;
        }
        setTimeout(() => { const t = f("pe-title"); if (t) t.focus({ preventScroll: true }); }, 60);
    }

    function confirmDelete(id) {
        const p = PROJECTS.find(x => x.id === id);
        if (!p) return;
        if (!Auth.can("delete", p)) {
            Sound.play("denied");
            toast(p.custom ? "Удаление доступно ролям ADMIN и CREATOR" : "Официальные проекты удаляет только CREATOR", "warn");
            return;
        }
        Modal.open({
            title: "УДАЛЕНИЕ ПРОЕКТА",
            subtitle: `${escapeHtml(p.code)} · ${escapeHtml(p.title)}`,
            className: "confirm-modal",
            html: `<div class="confirm-box">
                <img src="assets/icons/alert.svg" alt="" width="40" height="40">
                <p>Удалить <b>${escapeHtml(p.title)}</b> из каталога? Карточка исчезнет у всех ролей в этом браузере.</p>
                <p class="muted">${p.custom ? "Проект создан через сайт — восстановить его будет нельзя." : "Это официальный проект. Вернуть его можно в «Разделы → Вернуть официальные проекты»."}</p>
            </div>`,
            buttons: [{
                label: "Удалить", primary: true, icon: "ban", action: () => {
                    if (Downloads.active[p.id]) Downloads.cancel(p.id);
                    const res = Catalog.remove(p.id);
                    if (!res.ok) { Sound.play("denied"); toast("Недостаточно прав для удаления", "warn"); return; }
                    Sound.play("denied");
                    toast(`Проект удалён: ${p.title}`, "warn");
                    NX.Syslog.add(`catalog: ${Auth.get().callsign} deleted ${p.id}`);
                }
            }]
        });
    }

    /* Разделы каталога (только CREATOR): свои категории + сброс официальных проектов */
    function openSections() {
        if (!Auth.can("sections")) {
            Sound.play("denied");
            toast("Управление разделами доступно только роли CREATOR", "warn");
            return;
        }
        const modal = Modal.open({
            title: "РАЗДЕЛЫ КАТАЛОГА",
            subtitle: "CREATOR · nx_custom_categories",
            className: "sections-modal",
            html: `<div class="sec-wrap">
                <table class="edex-table sec-table"><thead><tr><th>Раздел</th><th>Проектов</th><th>Действия</th></tr></thead><tbody id="sec-body"></tbody></table>
                <form class="sec-add" id="sec-add" novalidate>
                    <input class="input" id="sec-new" type="text" maxlength="24" placeholder="НОВЫЙ РАЗДЕЛ, например MOBILE" aria-label="Название нового раздела">
                    <button class="btn btn-sm btn-primary" type="submit"><img src="assets/icons/plus.svg" alt="" width="15" height="15"><span>Добавить</span></button>
                </form>
                <div class="sec-restore">
                    <p id="sec-restore-info"></p>
                    <button class="btn btn-sm" type="button" id="sec-restore"><img src="assets/icons/reload.svg" alt="" width="15" height="15"><span>Вернуть официальные проекты</span></button>
                </div>
            </div>`
        });
        const body = $("#sec-body", modal);
        const render = () => {
            body.innerHTML = Object.keys(CATEGORIES).map(id => {
                const count = PROJECTS.filter(p => p.category === id).length;
                const base = !!BASE_CATEGORIES[id];
                return `<tr data-cat="${escapeHtml(id)}">
                    <td>${base ? `<b>${escapeHtml(CATEGORIES[id])}</b> <span class="muted">· базовый</span>`
                        : `<input class="input input-sm" type="text" maxlength="24" value="${escapeHtml(CATEGORIES[id])}" aria-label="Название раздела">`}</td>
                    <td>${count}</td>
                    <td>${base ? '<span class="muted">—</span>' : `<div class="sec-actions">
                        <button class="btn btn-sm" type="button" data-sec-save>${ICON_EDIT}<span>Сохранить</span></button>
                        <button class="btn btn-sm btn-danger" type="button" data-sec-del>${ICON_DELETE}<span>Удалить</span></button></div>`}</td>
                </tr>`;
            }).join("");
            const hidden = Catalog.readHidden().length;
            const edited = Catalog.readCustom().filter(x => x.builtin).length;
            $("#sec-restore-info", modal).textContent = hidden || edited
                ? `Официальных проектов: удалено ${hidden}, изменено ${edited}.`
                : "Официальные проекты в исходном состоянии.";
            $("#sec-restore", modal).disabled = !hidden && !edited;
        };
        render();
        const fail = res => {
            Sound.play("denied");
            toast(res.error === "exists" ? "Такой раздел уже есть" : res.error === "short" ? "Название — минимум 2 символа" : "Недостаточно прав", "warn");
        };
        body.addEventListener("click", e => {
            const row = e.target.closest("tr[data-cat]");
            if (!row) return;
            const id = row.getAttribute("data-cat");
            if (e.target.closest("[data-sec-save]")) {
                const res = Catalog.renameCategory(id, $("input", row).value);
                if (!res.ok) { fail(res); return; }
                Sound.play("granted");
                toast(`Раздел переименован: ${CATEGORIES[id]}`, "ok");
                render();
            } else if (e.target.closest("[data-sec-del]")) {
                const label = CATEGORIES[id];
                const res = Catalog.removeCategory(id);
                if (!res.ok) { fail(res); return; }
                Sound.play("denied");
                toast(`Раздел удалён: ${label}${res.moved ? ` · проектов перенесено в OTHER: ${res.moved}` : ""}`, "warn");
                render();
            }
        });
        $("#sec-add", modal).addEventListener("submit", e => {
            e.preventDefault();
            const inp = $("#sec-new", modal);
            const res = Catalog.addCategory(inp.value);
            if (!res.ok) { fail(res); return; }
            inp.value = "";
            Sound.play("granted");
            toast(`Раздел добавлен: ${CATEGORIES[res.id]}`, "ok");
            render();
        });
        $("#sec-restore", modal).addEventListener("click", () => {
            const res = Catalog.restore();
            if (!res.ok) { fail(res); return; }
            Sound.play("granted");
            toast("Официальные проекты восстановлены", "ok");
            render();
        });
    }

    function initProjects() {
        const grid = $("#project-grid");
        const tabs = $$("#filter-tabs [data-filter]");
        const catBox = $("#cat-tabs");
        const info = $("#filter-info");
        if (!grid) return;

        let current = "all";
        let currentCat = "all";

        const plural = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "сборка" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? "сборки" : "сборок"}`;

        const updateCounts = () => {
            const counts = { all: PROJECTS.length };
            PROJECTS.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });
            tabs.forEach(t => {
                const c = t.querySelector(".count");
                if (c) c.textContent = String(counts[t.getAttribute("data-filter")] || 0);
            });
        };

        const renderCats = () => {
            if (!catBox) return;
            if (currentCat !== "all" && !CATEGORIES[currentCat]) currentCat = "all";
            const items = [["all", "ВСЕ РАЗДЕЛЫ", PROJECTS.length]].concat(Object.keys(CATEGORIES).map(id => [id, CATEGORIES[id], PROJECTS.filter(p => p.category === id).length]));
            catBox.innerHTML = items.map(([id, label, n]) =>
                `<button type="button" class="cat-chip${id === currentCat ? " active" : ""}" data-cat-filter="${escapeHtml(id)}" aria-pressed="${id === currentCat}">${escapeHtml(label)}<span>${n}</span></button>`).join("");
        };

        const renderEmpty = () => {
            const old = $(".catalog-empty", grid);
            if (old) old.remove();
            const shown = $$(".pcard-wrap", grid).filter(c => !c.hidden).length;
            if (shown) return;
            const box = document.createElement("div");
            box.className = "catalog-empty";
            box.innerHTML = `<img src="assets/icons/search.svg" alt="" width="34" height="34">
                <p>${PROJECTS.length ? "В этом разделе пока нет сборок." : "Каталог пуст."}</p>
                <button class="btn btn-primary btn-sm" type="button" data-create data-require="create"><img src="assets/icons/plus.svg" alt="" width="15" height="15"><span>СОЗДАТЬ ПРОЕКТ</span></button>`;
            grid.appendChild(box);
            NX.applyPermissions(box);
        };

        const apply = (filter, silent) => {
            current = filter;
            let shown = 0;
            tabs.forEach(t => {
                const on = t.getAttribute("data-filter") === filter;
                t.setAttribute("aria-pressed", String(on));
                t.parentElement.classList.toggle("active", on);
            });
            $$(".cat-chip", catBox || grid).forEach(c => {
                const on = c.getAttribute("data-cat-filter") === currentCat;
                c.classList.toggle("active", on);
                c.setAttribute("aria-pressed", String(on));
            });
            $$(".pcard-wrap", grid).forEach(card => {
                const match = (filter === "all" || card.getAttribute("data-status") === filter)
                    && (currentCat === "all" || card.getAttribute("data-category") === currentCat);
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
            if (info) info.textContent = plural(shown);
            renderEmpty();
            if (!silent) Sound.play("folder");
            NX.storage.set("nx_filter2", filter);
        };

        const render = () => {
            grid.innerHTML = "";
            PROJECTS.forEach(p => grid.appendChild(projectCard(p)));
            observeReveal(grid);
            updateCounts();
            renderCats();
            apply(current, true);
        };

        const saved = NX.storage.get("nx_filter2", "all");
        current = saved === "all" || STATUSES[saved] ? saved : "all";
        render();

        tabs.forEach(t => t.addEventListener("click", () => {
            if (t.getAttribute("data-filter") === current) return;
            grid.classList.add("is-filtering");
            setTimeout(() => { apply(t.getAttribute("data-filter")); grid.classList.remove("is-filtering"); }, reducedMotion() ? 0 : 140);
        }));
        if (catBox) catBox.addEventListener("click", e => {
            const c = e.target.closest("[data-cat-filter]");
            if (!c || c.getAttribute("data-cat-filter") === currentCat) return;
            currentCat = c.getAttribute("data-cat-filter");
            apply(current);
        });

        // Кнопки карточек и модалок: скачать, досье, редактировать, удалить, создать, разделы
        document.addEventListener("click", e => {
            const dl = e.target.closest("[data-dl]");
            if (dl) {
                const p = PROJECTS.find(x => x.id === dl.getAttribute("data-dl"));
                if (p) Downloads.run(p);
                return;
            }
            const det = e.target.closest("[data-details]");
            if (det) { openDetails(det.getAttribute("data-details")); return; }
            const ed = e.target.closest("[data-edit]");
            if (ed) { openEditor(ed.getAttribute("data-edit")); return; }
            const del = e.target.closest("[data-delete]");
            if (del) { confirmDelete(del.getAttribute("data-delete")); return; }
            if (e.target.closest("[data-create]")) { openEditor(); return; }
            if (e.target.closest("[data-sections]")) openSections();
        });

        // Плашка текущей роли над каталогом
        const roleChip = $("#role-chip");
        const paintRole = () => {
            if (!roleChip) return;
            const s = Auth.get();
            const r = s ? ROLES[s.role] : null;
            roleChip.innerHTML = r
                ? `<span>РОЛЬ</span><b>${r.label}</b><i>${escapeHtml(r.name)}${s.role === "user" ? " · только скачивание" : ""}</i>`
                : `<span>РОЛЬ</span><b>GUEST</b><i>войдите, чтобы скачивать закрытые сборки</i>`;
        };
        paintRole();

        // Вход / выход / смена роли — перерисовать доступ (во время загрузки — после её окончания)
        let stale = false;
        const refresh = () => {
            if (Object.keys(Downloads.active).length) { stale = true; return; }
            stale = false;
            render();
        };
        document.addEventListener("nexus:auth", () => { paintRole(); refresh(); });
        document.addEventListener("nexus:dl-idle", () => { if (stale) setTimeout(refresh, 2500); });

        // Изменения каталога: точечно, чтобы не сбивать идущие загрузки других проектов
        document.addEventListener("nexus:catalog", e => {
            const { action, id } = e.detail || {};
            const old = id ? document.getElementById("project-" + id) : null;
            const p = id ? PROJECTS.find(x => x.id === id) : null;
            if (action === "create" && p) {
                grid.appendChild(projectCard(p));
                observeReveal(grid);
                currentCat = "all";
                if (current !== "all" && current !== p.status) current = "all";
            } else if (action === "update" && p && old) {
                const card = projectCard(p);
                card.classList.add("is-visible");
                old.replaceWith(card);
                if (currentCat !== "all" && currentCat !== p.category) currentCat = "all";
            } else if (action === "delete" && old) {
                old.remove();
                if (Modal.current && $(`[data-hud="${id}"]`, Modal.current.modal)) Modal.close(true);
            } else {
                refresh();
                return;
            }
            updateCounts();
            renderCats();
            apply(current, true);
        });

        const fromHash = () => {
            let h = decodeURIComponent(window.location.hash.replace("#", ""));
            if (h === "new" || h === "create") {
                if (window.history.replaceState) window.history.replaceState(null, "", window.location.pathname + window.location.search);
                openEditor();
                return;
            }
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
                    if (card.hidden) { currentCat = "all"; apply("all", true); }
                    card.scrollIntoView({ block: "center" });
                }
                openDetails(p.id, true);
            }
        };
        window.addEventListener("hashchange", fromHash);
        setTimeout(fromHash, 60);

        // Отложенная загрузка: гость нажал «Скачать», вошёл — продолжаем здесь
        const pending = NX.storage.get("nx_pending_dl", null);
        if (pending && Auth.get()) {
            NX.storage.remove("nx_pending_dl");
            const p = PROJECTS.find(x => x.id === pending);
            if (p && canDownload(p)) {
                setTimeout(() => {
                    const card = document.getElementById("project-" + p.id);
                    if (card) { if (card.hidden) { currentCat = "all"; apply("all", true); } card.scrollIntoView({ block: "center" }); }
                    toast(`Доступ подтверждён — запускаю загрузку ${p.title}`, "ok");
                    Downloads.run(p);
                }, 700);
            } else if (p) {
                toast(`${p.title}: доступ «${accessText(p)}». Сменить роль — в кабинете или командой role.`, "warn", { ttl: 5000 });
            }
        }
    }

    /* ================================================================
     * Кабинет: профиль, роль и права, история загрузок
     * ================================================================ */
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
                Auth.login({ callsign: "demo_operator", role: "user", demo: true, remember: true });
                await showBanner("ACCESS GRANTED", { sub: "DEMO ACCESS · ROLE USER" });
                demoBtn.classList.remove("is-busy");
                start();
                toast("Демо-доступ: роль USER. Переключить роль можно ниже или командой role", "ok", { ttl: 4800 });
            });
        }

        let started = false;
        const map = { profile: "dtab-profile", settings: "dtab-settings" };
        const start = () => {
            const s = Auth.get();
            if (!s) { showLocked(); return; }
            lock.hidden = true;
            app.hidden = false;
            if (NX.storage.sessionGet("nx_welcome")) {
                try { window.sessionStorage.removeItem("nx_welcome"); } catch (e) { /* ignore */ }
                setTimeout(() => toast(`Добро пожаловать, ${s.callsign}! Роль: ${ROLES[s.role].label} // ${ROLES[s.role].name}`, "ok", { ttl: 4500 }), 350);
            }
            renderProfile();
            if (started) return;
            started = true;
            initSettingsPanel();
            const h = window.location.hash.replace("#", "");
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
        };

        // Выход
        $$("[data-logout]").forEach(btn => btn.addEventListener("click", () => {
            Auth.logout();
            Sound.play("denied");
            toast("Сессия завершена", "warn");
            setTimeout(() => { window.location.href = "auth.html"; }, 400);
        }));

        // Вход / выход / смена роли (в т.ч. из терминала или подвала) — сразу обновить кабинет
        document.addEventListener("nexus:auth", () => {
            if (!Auth.get()) { showLocked(); return; }
            if (app.hidden) start(); else renderProfile();
        });

        start();
    }

    function renderProfile() {
        const s = Auth.get();
        if (!s) return;
        const role = ROLES[s.role];
        drawAvatar($("#avatar-canvas"), avatarSeed(s));
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
        set("profile-name", s.callsign);
        set("profile-id", s.id);
        set("profile-level", `${role.label} // ${role.name}`);
        set("pi-callsign", s.callsign);
        set("pi-email", s.email);
        set("pi-id", s.id);
        set("pi-role", `${role.label} — ${role.name}${s.demo ? " (DEMO)" : ""}`);
        set("pi-registered", formatDate(s.registered));
        set("pi-last", formatDate(s.lastLogin));
        set("pi-session", s.expires ? "до " + formatDate(s.expires) : "запомнена на устройстве");
        $$("#clearance-bars i").forEach((el, i) => el.classList.toggle("on", i < role.rank));

        // Карточка роли
        const card = $("#role-card");
        if (card) {
            card.setAttribute("data-role", s.role);
            set("role-name", role.label);
            set("role-title", role.name);
            set("role-desc", role.desc);
        }

        // Матрица прав: строки — права, колонки — роли
        const perm = $("#perm-body");
        if (perm) {
            perm.innerHTML = PERMISSIONS.map(x => {
                const cells = ROLE_IDS.map(id => {
                    const ok = ROLES[id].rank >= ROLES[x.min].rank;
                    return `<td data-label="${ROLES[id].label}" class="${id === s.role ? "is-current" : ""}"><span class="${ok ? "access-yes" : "access-no"}">${ok ? "YES" : "—"}</span></td>`;
                }).join("");
                return `<tr><td data-label="Право">${escapeHtml(x.label)}</td>${cells}</tr>`;
            }).join("");
            $$("#perm-head th[data-role-col]").forEach(th => th.classList.toggle("is-current", th.getAttribute("data-role-col") === s.role));
        }
        renderDownloads();
    }

    function renderDownloads(highlightFirst) {
        const s = Auth.get();
        const body = $("#dl-body");
        if (!s || !body) return;
        const list = s.downloads || [];
        if (!list.length) {
            body.innerHTML = '<tr><td colspan="5" data-label="История">Загрузок пока нет — сборки скачиваются в <a href="projects.html">центре загрузок</a></td></tr>';
            return;
        }
        body.innerHTML = list.map((d, i) => `
            <tr class="${highlightFirst && i === 0 ? "is-new" : ""}">
                <td data-label="Сборка"><b>${escapeHtml(d.build)}</b><br><span class="muted">${escapeHtml(d.version)}</span></td>
                <td data-label="Дата">${escapeHtml(formatDate(d.date))}</td>
                <td data-label="Размер">${escapeHtml(d.size)}</td>
                <td data-label="SHA-256">${d.sha === "external" ? "внешняя ссылка" : escapeHtml(d.sha) + "…"}</td>
                <td data-label="Статус"><span class="badge badge-online">${escapeHtml(d.status)}</span></td>
            </tr>`).join("");
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
                $("#auth-session-meta").textContent = `${s.id} · ${ROLES[s.role].label} // ${ROLES[s.role].name}`;
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
            await step(`role ${ROLES[opts.role].label} // ${ROLES[opts.role].name}`);
            vlog("session token issued (stored locally, demo mode)");
            Auth.login({ callsign: opts.callsign, email: opts.email, role: opts.role, remember: opts.remember, demo: opts.demo, registered: opts.register ? Date.now() : undefined });
            NX.storage.sessionSet("nx_welcome", "1");
            // Гость нажимал «Скачать» на закрытой сборке — возвращаем его в центр загрузок
            const pending = NX.storage.get("nx_pending_dl", null);
            await showBanner("ACCESS GRANTED", { keep: true, sub: `${opts.callsign.toUpperCase()} · ${ROLES[opts.role].label} — ${pending ? "возврат к загрузке…" : "переход в кабинет…"}` });
            await delay(fast ? 150 : 650);
            window.location.href = pending ? "projects.html" : "dashboard.html";
        };

        const CALLSIGN_RE = /^[A-Za-z0-9_.\-]{3,24}$/;
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

        const resolveCode = raw => {
            const code = (raw || "").trim().toUpperCase();
            if (!code) return { code: "", role: "user", ok: true };
            const role = ACCESS_CODES[code];
            return { code, role: role || "user", ok: !!role };
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
                role: c.role,
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
                role: c.role,
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
            code.value = "";
            runSequence({ callsign: "demo_operator", role: "user", remember: true, demo: true });
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

    NX.Pages = { openDetails, openEditor, openSections, confirmDelete, drawAvatar, Downloads, textToNotes, notesToText, compressImage };
})();
