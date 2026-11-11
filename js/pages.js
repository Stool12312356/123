/*
 * pages.js — логика страниц NEXUS//DEV
 * ------------------------------------------------------------------
 * Подключается на всех страницах после js/ui-effects.js и использует
 * его API (window.NEXUS). Страница определяется по <body data-page>:
 *   home      — index.html      (ядро экосистемы — логика в ui-effects.js)
 *   projects  — projects.html   (фильтры, карточки, загрузки, досье, конструктор проектов)
 *   dashboard — dashboard.html  (кабинет: кошелёк, подписка, библиотека, уведомления, безопасность, профиль)
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
                Auth.addDownload({ id: p.id, build: p.title, version: p.version, date: Date.now(), size: p.size, sha: "external", status: "LINK" });
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
                Auth.addDownload({ id: p.id, build: p.title, version: p.version, date: Date.now(), size: p.size, sha, status: "VERIFIED" });
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
     * Кабинет NEXUS ID: обзор, кошелёк (тестовые платежи), подписка и
     * поддержка проектов, библиотека, уведомления, безопасность,
     * профиль и роль, настройки HUD
     * ================================================================ */
    const DASH_TABS = {
        overview: "Обзор",
        wallet: "Кошелёк",
        plus: "Подписка и поддержка",
        library: "Библиотека",
        services: "Сервисы",
        notifications: "Уведомления",
        security: "Безопасность",
        profile: "Профиль и роль",
        settings: "Настройки HUD"
    };
    const { Account, PLANS, TEST_CARDS, WALLET_LIMITS, formatMoney, cardBrand, luhnOk, topupBonus, deviceName } = NX;
    const money = k => formatMoney(k);

    const dash = { txFilter: "all", txLimit: 10, notifFilter: "all", profileDirty: false, paying: false };

    function setText(id, v) {
        const el = document.getElementById(id);
        if (el && el.textContent !== String(v)) el.textContent = v;
    }

    function ago(ts) {
        const diff = Date.now() - ts;
        const min = Math.round(diff / 60000);
        if (diff < 0 || min < 1) return "только что";
        if (min < 60) return `${min} мин назад`;
        const h = Math.round(min / 60);
        if (h < 24) return `${h} ч назад`;
        const d = Math.round(h / 24);
        if (d === 1) return "вчера";
        if (d < 30) return `${d} дн. назад`;
        return dateStr(new Date(ts));
    }

    function plural(n, one, few, many) {
        const m10 = n % 10, m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
        return many;
    }

    function parseSizeMiB(str) {
        const m = String(str || "").match(/([\d.,]+)\s*(KiB|MiB|GiB|KB|MB|GB)?/i);
        if (!m) return 0;
        const v = parseFloat(m[1].replace(",", "."));
        const u = (m[2] || "MiB").toUpperCase();
        if (u.startsWith("G")) return v * 1024;
        if (u.startsWith("K")) return v / 1024;
        return v;
    }

    /* Сумма из строки «1 250,50» → копейки */
    function parseRub(str) {
        const clean = String(str || "").replace(/[\s\u00a0₽]/g, "").replace(",", ".");
        if (!/^\d+(\.\d{0,2})?$/.test(clean)) return NaN;
        return Math.round(parseFloat(clean) * 100);
    }

    /* Плавный счётчик суммы */
    function animateMoney(el, to) {
        if (!el) return;
        const from = Number(el.getAttribute("data-kop"));
        el.setAttribute("data-kop", String(to));
        if (!Number.isFinite(from) || from === to || reducedMotion()) { el.textContent = money(to); return; }
        const t0 = performance.now(), dur = 700;
        const step = now => {
            const k = Math.min(1, (now - t0) / dur);
            const e = 1 - Math.pow(1 - k, 3);
            el.textContent = money(Math.round(from + (to - from) * e));
            if (k < 1 && el.getAttribute("data-kop") === String(to)) requestAnimationFrame(step);
            else if (k >= 1) el.textContent = money(to);
        };
        requestAnimationFrame(step);
        el.classList.remove("is-bump");
        void el.offsetWidth;
        el.classList.add("is-bump");
    }

    function downloadFile(name, text, type) {
        try {
            const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            return true;
        } catch (e) {
            toast("Браузер не разрешил сохранить файл", "warn");
            return false;
        }
    }

    function goTab(key, opts) {
        opts = opts || {};
        if (!DASH_TABS[key]) return;
        const tab = document.getElementById("dtab-" + key);
        if (tab && tab.getAttribute("aria-selected") !== "true") Tabs.byId("dtab-" + key);
        const shell = $(".dash-shell");
        if (opts.scroll !== false && shell) {
            const top = shell.getBoundingClientRect().top;
            if (top < 0 || top > window.innerHeight * 0.6) shell.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
        }
        if (opts.target) {
            setTimeout(() => {
                const el = $(opts.target);
                if (el) el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
            }, 80);
        }
    }

    /* Открыть кошелёк с подставленной суммой (например, «не хватает средств») */
    function openTopup(kop) {
        goTab("wallet", { target: "#topup-form" });
        if (kop > 0) {
            const rub = Math.max(WALLET_LIMITS.min, Math.ceil(kop / 100) * 100);
            const input = $("#topup-amount");
            if (input) {
                input.value = String(rub / 100);
                input.dispatchEvent(new Event("input"));
            }
        }
        setTimeout(() => { const i = $("#topup-amount"); if (i) i.focus({ preventScroll: true }); }, 350);
    }

    function fieldError(input, text) {
        const field = input.closest(".field");
        if (!field) return;
        field.classList.toggle("is-invalid", !!text);
        const err = field.querySelector(".field-error");
        if (err) err.textContent = text || "";
        if (text) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
    }

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
                await showBanner("ACCESS GRANTED", { sub: "NEXUS ID · DEMO" });
                demoBtn.classList.remove("is-busy");
                start();
                toast("Вход выполнен: демо-аккаунт demo_operator", "ok", { ttl: 4200 });
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
                setTimeout(() => toast(`Добро пожаловать, ${s.callsign}!`, "ok", { ttl: 4000 }), 350);
            }
            dash.profileDirty = false;
            renderProfile();
            if (started) return;
            started = true;
            initSettingsPanel();
            initWallet();
            initPlus();
            initLibrary();
            initNotifications();
            initSecurity();
            initProfileForm();
            initServicesTab();

            app.addEventListener("nexus:tab", e => {
                const key = e.detail.id.replace("dtab-", "");
                if (!DASH_TABS[key]) return;
                setText("dash-crumb", `NEXUS ID / ${DASH_TABS[key].toUpperCase()}`);
                if (window.history.replaceState) window.history.replaceState(null, "", "#" + key);
                if (key === "wallet") drawSbpQr();
            });
            const fromHash = () => {
                const k = window.location.hash.replace("#", "");
                if (DASH_TABS[k]) goTab(k, { scroll: false });
                else if (k === "servers") goTab("overview", { scroll: false });
            };
            fromHash();
            window.addEventListener("hashchange", fromHash);
            // Переходы между разделами: [data-goto], [data-topup]
            app.addEventListener("click", e => {
                const topup = e.target.closest("[data-topup]");
                if (topup) { e.preventDefault(); openTopup(0); return; }
                const go = e.target.closest("[data-goto]");
                if (go) { e.preventDefault(); goTab(go.getAttribute("data-goto"), { target: go.getAttribute("data-scroll") }); }
            });
            setInterval(() => { if (!app.hidden && document.visibilityState === "visible") renderOverview(); }, 60000);
        };

        // Выход
        $$("[data-logout]").forEach(btn => btn.addEventListener("click", () => {
            Auth.logout();
            Sound.play("denied");
            toast("Вы вышли из аккаунта", "warn");
            setTimeout(() => { window.location.href = "auth.html"; }, 400);
        }));

        // Вход / выход / смена роли (в т.ч. из терминала или подвала) — сразу обновить кабинет
        document.addEventListener("nexus:auth", () => {
            if (!Auth.get()) { showLocked(); return; }
            if (app.hidden) start(); else renderProfile();
        });
        document.addEventListener("nexus:account", () => { if (!app.hidden) renderProfile(); });
        document.addEventListener("nexus:catalog", () => { if (!app.hidden) { renderLibrary(); renderOverview(); renderPlus(); } });

        start();
    }

    /* Полная перерисовка кабинета (имя сохранено для совместимости) */
    function renderProfile() {
        const s = Auth.get();
        const a = Account.get();
        if (!s || !a) return;
        renderIdentity(s, a);
        renderOverview(s, a);
        renderWallet(s, a);
        renderPlus(s, a);
        renderLibrary(s, a);
        renderNotifications(s, a);
        renderSecurity(s, a);
        renderProfileTab(s, a);
        renderServices();
    }

    /* ----- Сервисы: NEXUS VPN и NEXUS IDE ----- */
    function renderServices() {
        const { VPN, IDEStore, formatBytes: fmtBytes, formatDuration, serviceTier } = NX;
        if (!VPN || !$("#dpanel-services")) return;
        const st = VPN.get();
        if (!st) return;
        const srv = st.connected ? VPN.find(st.server) : null;
        const card = $("#svc-vpn");
        if (card) card.setAttribute("data-state", srv ? "on" : "off");
        const status = $("#svc-vpn-status b");
        if (status) status.textContent = srv ? "ЗАЩИЩЕНО" : "ОТКЛЮЧЕНО";
        const entry = st.entry ? VPN.find(st.entry) : null;
        setText("svc-vpn-server", srv ? `${srv.city}, ${srv.cc}${entry ? " · через " + entry.cc : ""}` : (st.lastServer && VPN.find(st.lastServer) ? `последний: ${VPN.find(st.lastServer).city}` : "—"));
        setText("svc-vpn-ip", srv ? VPN.exitIp(srv, st) : "реальный IP");
        setText("svc-vpn-proto", VPN.PROTOCOLS[st.protocol].label);
        setText("svc-vpn-uptime", srv ? formatDuration(Date.now() - st.since) : "—");
        const q = VPN.quota(st);
        setText("svc-vpn-quota", isFinite(q.limit) ? `${fmtBytes(q.used)} из ${fmtBytes(q.limit)}` : `${fmtBytes(q.used)} · без лимита`);
        const bar = $("#svc-vpn-quota-bar");
        if (bar) { bar.style.width = (isFinite(q.limit) ? q.pct : 0) + "%"; bar.classList.toggle("is-warn", q.pct > 85); }
        const tgl = $("#svc-vpn-toggle");
        if (tgl) {
            tgl.querySelector("span").textContent = srv ? "Отключить" : "Быстрое подключение";
            tgl.classList.toggle("btn-primary", !srv);
        }
        const badge = $("#nav-badge-services");
        if (badge) { badge.hidden = !srv; badge.title = srv ? `VPN: ${srv.city}` : ""; }
        setText("ov-quick-vpn", srv ? `защищено · ${srv.city}` : "тестовый VPN-клиент");

        const hist = $("#svc-vpn-history");
        if (hist) {
            hist.innerHTML = st.history.length ? st.history.slice(0, 6).map(h => {
                const sv = VPN.find(h.server);
                const why = { quota: "лимит трафика", plan: "нет доступа", switch: "смена сервера", killswitch: "обрыв связи" }[h.reason] || "";
                return `<li><img src="assets/icons/shield.svg" alt="" width="16" height="16">
                    <span class="feed-text"><b>${escapeHtml(sv ? sv.city + ", " + sv.country : h.server)}</b><i>${escapeHtml(VPN.PROTOCOLS[h.protocol] ? VPN.PROTOCOLS[h.protocol].label : "")} · ${escapeHtml(formatDuration(h.end - h.start))}${why ? " · " + escapeHtml(why) : ""} · ${escapeHtml(ago(h.end))}</i></span>
                    <span class="feed-amount">${escapeHtml(fmtBytes(h.bytes))}</span></li>`;
            }).join("") : '<li class="feed-empty">Сеансов пока нет — подключитесь, чтобы увидеть историю.</li>';
        }

        const pro = serviceTier() === "pro";
        const s = Auth.get();
        setText("svc-tier", pro ? (s && s.role === "creator" && Account.get().plan.id === "free" ? "CREATOR · все возможности" : "NEXUS+ · все возможности") : "тариф FREE");
        const up = $("#svc-upgrade");
        if (up) up.hidden = pro;

        const sum = IDEStore.summary();
        if (sum) {
            setText("svc-ide-count", `${sum.count} из ${sum.limit}`);
            setText("svc-ide-last", sum.last ? `${sum.last.name} · ${ago(sum.last.updated)}` : "проектов пока нет");
            const rec = $("#svc-ide-recent");
            if (rec) {
                rec.innerHTML = sum.recent.map(p => `<li><a href="ide.html#p=${encodeURIComponent(p.id)}"><img src="assets/icons/file.svg" alt="" width="14" height="14"><b>${escapeHtml(p.name)}</b><span>${Object.keys(p.files).length} ${plural(Object.keys(p.files).length, "файл", "файла", "файлов")} · ${escapeHtml(fmtBytes(IDEStore.projectSize(p)))}</span></a></li>`).join("");
                rec.hidden = !sum.recent.length;
            }
        }
    }

    function initServicesTab() {
        const { VPN } = NX;
        const tgl = $("#svc-vpn-toggle");
        if (!VPN || !tgl) return;
        tgl.addEventListener("click", async () => {
            const st = VPN.get();
            if (!st) return;
            if (st.connected) {
                VPN.disconnect("user");
                Sound.play("panels");
                toast("NEXUS VPN отключён", "info");
                return;
            }
            const target = (st.lastServer && VPN.canUse(VPN.find(st.lastServer)).ok) ? st.lastServer : null;
            const srv = target ? VPN.find(target) : VPN.best();
            tgl.classList.add("is-busy");
            tgl.disabled = true;
            tgl.querySelector("span").textContent = "Подключение…";
            await delay(reducedMotion() ? 100 : 900);
            tgl.classList.remove("is-busy");
            tgl.disabled = false;
            const res = VPN.connect(srv ? srv.id : null);
            if (!res || !res.ok) {
                renderServices();
                Sound.play("denied");
                toast(res ? res.text : "Не удалось подключиться", "warn", { ttl: 5000 });
                return;
            }
            Sound.play("granted");
            toast(`NEXUS VPN: защищено · ${res.server.city}, ${res.server.country}`, "ok");
        });
        document.addEventListener("nexus:vpn", renderServices);
        document.addEventListener("nexus:ide", renderServices);
        setInterval(() => {
            const panel = $("#dpanel-services");
            if (document.visibilityState !== "visible" || !Auth.get()) return;
            if (panel && !panel.hidden) renderServices();
            else { const st = NX.VPN.get(); if (st && st.connected) setText("ov-quick-vpn", `защищено · ${NX.VPN.find(st.server).city}`); }
        }, 1000);
    }

    /* ----- Левая колонка: карточка аккаунта и бейджи меню ----- */
    function renderIdentity(s, a) {
        const role = ROLES[s.role];
        const plan = PLANS[a.plan.id];
        drawAvatar($("#avatar-canvas"), avatarSeed(s));
        setText("profile-name", a.profile.displayName || s.callsign);
        setText("profile-id", s.id);
        setText("id-role", role.label);
        const planEl = $("#id-plan");
        if (planEl) {
            planEl.textContent = plan.label;
            planEl.setAttribute("data-plan", plan.id);
        }
        const frame = $("#avatar-frame");
        if (frame) frame.setAttribute("data-plan", plan.id);
        animateMoney($("#id-balance"), a.balance);
        setText("session-device", deviceName());

        const unread = a.notifications.filter(n => !n.read).length;
        const nb = $("#nav-badge-notifications");
        if (nb) { nb.hidden = !unread; nb.textContent = unread > 99 ? "99+" : String(unread); }
        const lib = libraryState(s);
        const lb = $("#nav-badge-library");
        if (lb) { lb.hidden = !lib.updates; lb.textContent = String(lib.updates); lb.title = "Доступны обновления"; }
        const sec = Account.securityScore(a, s);
        const sb = $("#nav-badge-security");
        if (sb) { sb.hidden = sec.score >= 50; sb.title = "Защита аккаунта ниже 50%"; }
    }

    /* ----- Обзор ----- */
    function renderOverview(s, a) {
        s = s || Auth.get();
        a = a || Account.get();
        if (!s || !a) return;
        const hour = new Date().getHours();
        const hello = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
        setText("ov-greeting", `${hello}, ${a.profile.displayName || s.callsign}`);
        let today;
        try { today = new Date().toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); } catch (e) { today = dateStr(new Date()); }
        setText("ov-date", today);

        animateMoney($("#ov-balance"), a.balance);
        const lastIn = a.tx.find(t => t.type === "topup" && t.status === "ok");
        setText("ov-balance-sub", lastIn ? `пополнение ${ago(lastIn.date)}` : "пополните, чтобы оформить NEXUS+");
        const plan = Account.planInfo(a);
        setText("ov-plan", plan.label);
        setText("ov-plan-sub", plan.until ? `до ${dateStr(new Date(plan.until))}${plan.autoRenew ? " · автопродление" : ""}` : "базовый тариф, бесплатно");
        const lib = libraryState(s);
        setText("ov-downloads", String((s.downloads || []).length));
        setText("ov-downloads-sub", lib.updates ? `${lib.updates} ${plural(lib.updates, "обновление", "обновления", "обновлений")} доступно` : `${lib.available} ${plural(lib.available, "сборка доступна", "сборки доступны", "сборок доступно")}`);
        const sec = Account.securityScore(a, s);
        setText("ov-security", sec.score + "%");
        setText("ov-security-sub", `${sec.items.filter(x => x.done).length} из ${sec.items.length} пунктов`);

        // Лента активности: операции, загрузки, события безопасности
        const feed = $("#ov-feed");
        if (feed) {
            const items = [];
            a.tx.slice(0, 8).forEach(t => items.push({ date: t.date, icon: t.amount > 0 ? "plus" : "portfolio", title: t.title, meta: t.method + (t.status === "failed" ? " · отклонён" : ""), amount: t.status === "ok" ? t.amount : null, failed: t.status === "failed" }));
            (s.downloads || []).slice(0, 6).forEach(d => items.push({ date: d.date, icon: "download", title: `Загрузка ${d.build}`, meta: `${d.version} · ${d.size}` }));
            a.security.log.slice(0, 6).forEach(l => items.push({ date: l.date, icon: l.ok ? "lock" : "alert", title: l.event, meta: l.device, failed: !l.ok }));
            items.sort((x, y) => y.date - x.date);
            feed.innerHTML = items.slice(0, 7).map(it => `
                <li class="${it.failed ? "is-failed" : ""}">
                    <img src="assets/icons/${it.icon}.svg" alt="" width="16" height="16">
                    <span class="feed-text"><b>${escapeHtml(it.title)}</b><i>${escapeHtml(it.meta || "")} · ${escapeHtml(ago(it.date))}</i></span>
                    ${it.amount !== null && it.amount !== undefined ? `<span class="feed-amount ${it.amount > 0 ? "is-plus" : ""}">${escapeHtml(formatMoney(it.amount, { sign: true }))}</span>` : ""}
                </li>`).join("") || '<li class="feed-empty">Событий пока нет</li>';
        }

        // Проверка аккаунта
        const extra = [
            { id: "topup", label: "Баланс пополнен хотя бы раз", done: a.tx.some(t => t.type === "topup" && t.status === "ok"), tab: "wallet", action: "Пополнить" },
            { id: "profile", label: "Профиль заполнен", done: !!(a.profile.bio || a.profile.discord || a.profile.github), tab: "profile", action: "Заполнить" }
        ];
        const all = sec.items.concat(extra);
        const pct = Math.round(all.filter(x => x.done).length / all.length * 100);
        setText("ov-check-score", pct + "%");
        const bar = $("#ov-check-bar");
        if (bar) bar.style.width = pct + "%";
        const cl = $("#ov-checklist");
        if (cl) cl.innerHTML = checklistHtml(all);

        // Свежие релизы
        const rel = $("#ov-releases");
        if (rel) {
            const owned = ownedVersions(s);
            const list = PROJECTS.slice().sort((x, y) => String(y.updated).localeCompare(String(x.updated))).slice(0, 4);
            rel.innerHTML = list.map(p => {
                const mine = owned[p.id];
                const upd = mine && mine !== p.version;
                return `<li>
                    <img src="assets/icons/${escapeHtml(p.icon)}.svg" alt="" width="18" height="18">
                    <span class="rel-text"><b>${escapeHtml(p.title)}</b><i>${escapeHtml(p.version)} · ${escapeHtml(p.updated)}</i></span>
                    ${upd ? '<span class="badge badge-online">UPDATE</span>' : `<span class="rel-status">${escapeHtml(STATUSES[p.status].label)}</span>`}
                    <a class="btn btn-sm" href="projects.html#${encodeURIComponent(p.id)}">${upd ? "Обновить" : "Открыть"}</a>
                </li>`;
            }).join("");
        }
    }

    function checklistHtml(items) {
        return items.map(x => `
            <li class="${x.done ? "is-done" : ""}">
                <span class="cl-mark" aria-hidden="true">${x.done ? "✓" : "!"}</span>
                <span class="cl-text">${escapeHtml(x.label)}</span>
                ${x.done ? '<span class="cl-ok">OK</span>' : `<button class="link-btn" type="button" data-goto="${x.tab}"${x.id === "2fa" ? ' data-scroll="#twofa-box"' : x.id === "pwd" ? ' data-scroll="#pwd-form"' : x.id === "sessions" ? ' data-scroll="#sess-body"' : ""}>${escapeHtml(x.action)} →</button>`}
            </li>`).join("");
    }

    /* ----- Кошелёк ----- */
    function txLabel(t) {
        return { topup: "Пополнение", bonus: "Бонус", cashback: "Кешбэк", plan: "Подписка", donate: "Поддержка", spend: "Списание", refund: "Возврат" }[t.type] || "Операция";
    }

    function renderWallet(s, a) {
        animateMoney($("#w-balance"), a.balance);
        setText("w-account", s.id);
        const from = Date.now() - 30 * 86400000;
        const ok = a.tx.filter(t => t.status === "ok" && t.date >= from);
        setText("w-in", money(ok.filter(t => t.type === "topup").reduce((x, t) => x + t.amount, 0)));
        setText("w-out", money(-ok.filter(t => t.amount < 0).reduce((x, t) => x + t.amount, 0)));
        setText("w-bonus", money(a.tx.filter(t => t.status === "ok" && (t.type === "bonus" || t.type === "cashback")).reduce((x, t) => x + t.amount, 0)));
        setText("w-today", money(Account.todayTopups(a)));

        // Сохранённые карты
        const cards = $("#saved-cards");
        if (cards) {
            cards.innerHTML = a.cards.length ? a.cards.map(c => `
                <li>
                    <span class="sc-brand">${escapeHtml(c.brand)}</span>
                    <span class="sc-num">•••• ${escapeHtml(c.last4)}</span>
                    <span class="sc-exp">${escapeHtml(c.exp)}</span>
                    <button class="btn btn-sm btn-danger" type="button" data-card-remove="${escapeHtml(c.id)}" aria-label="Удалить карту •••• ${escapeHtml(c.last4)}">Удалить</button>
                </li>`).join("") : '<li class="muted">Карт пока нет — отметьте «Сохранить карту» при оплате.</li>';
        }
        const savedWrap = $("#pay-saved-wrap");
        if (savedWrap) {
            const c = a.cards[0];
            savedWrap.hidden = !c;
            if (c) setText("pay-saved-label", `${c.brand} •••• ${c.last4} · ${c.exp}`);
            const radio = savedWrap.querySelector("input");
            if (!c && radio && radio.checked) {
                const cardRadio = $("input[name='pay-method'][value='card']");
                if (cardRadio) { cardRadio.checked = true; cardRadio.dispatchEvent(new Event("change", { bubbles: true })); }
            }
        }
        renderTx(a);
    }

    function filteredTx(a) {
        return a.tx.filter(t => {
            if (dash.txFilter === "in") return t.status === "ok" && t.amount > 0;
            if (dash.txFilter === "out") return t.status === "ok" && t.amount < 0;
            if (dash.txFilter === "failed") return t.status !== "ok";
            return true;
        });
    }

    function renderTx(a) {
        a = a || Account.get();
        const body = $("#tx-body");
        if (!a || !body) return;
        const list = filteredTx(a);
        setText("tx-count", `${a.tx.length} ${plural(a.tx.length, "операция", "операции", "операций")}`);
        if (!list.length) {
            body.innerHTML = `<tr><td colspan="5" data-label="Операции">${a.tx.length ? "Нет операций по этому фильтру" : "Операций пока нет — пополните баланс любым способом выше"}</td></tr>`;
        } else {
            body.innerHTML = list.slice(0, dash.txLimit).map(t => `
                <tr class="${t.status !== "ok" ? "is-failed" : ""}">
                    <td data-label="Дата">${escapeHtml(formatDate(t.date))}<br><span class="muted">${escapeHtml(t.id)}</span></td>
                    <td data-label="Операция"><b>${escapeHtml(t.title)}</b>${t.comment ? `<br><span class="muted">«${escapeHtml(t.comment)}»</span>` : ""}${t.reason ? `<br><span class="muted">${escapeHtml(t.reason)}</span>` : ""}</td>
                    <td data-label="Способ">${escapeHtml(t.method)}</td>
                    <td data-label="Статус"><span class="badge ${t.status === "ok" ? "badge-online" : "badge-offline"}">${t.status === "ok" ? "ВЫПОЛНЕНО" : "ОТКЛОНЁН"}</span></td>
                    <td data-label="Сумма" class="num"><span class="tx-amount ${t.status !== "ok" ? "is-void" : t.amount > 0 ? "is-plus" : "is-minus"}">${escapeHtml(formatMoney(t.amount, { sign: true }))}</span></td>
                </tr>`).join("");
        }
        const more = $("#tx-more");
        if (more) more.hidden = list.length <= dash.txLimit;
    }

    /* Псевдо-QR для СБП (тестовый, не сканируется банком) */
    function drawSbpQr() {
        const c = $("#sbp-qr");
        if (!c || !c.getContext || c.offsetParent === null) return;
        const ctx = c.getContext("2d");
        const n = 29, px = Math.floor(c.width / n);
        const s = Auth.get();
        let h = hashString(`${s ? s.id : "guest"}:${($("#topup-amount") || {}).value || ""}`) || 7;
        const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
        const bg = getComputedStyle(document.documentElement).getPropertyValue("--color_light_black").trim() || "#090B0A";
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = NX.rgba(1);
        const finder = (x, y) => {
            ctx.fillRect(x * px, y * px, 7 * px, 7 * px);
            ctx.fillStyle = bg; ctx.fillRect((x + 1) * px, (y + 1) * px, 5 * px, 5 * px);
            ctx.fillStyle = NX.rgba(1); ctx.fillRect((x + 2) * px, (y + 2) * px, 3 * px, 3 * px);
        };
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                const inFinder = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
                if (!inFinder && rnd() > 0.52) ctx.fillRect(x * px, y * px, px, px);
            }
        }
        finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    }

    function initWallet() {
        const form = $("#topup-form");
        if (!form) return;
        const amount = $("#topup-amount");
        const grid = $("#amount-grid");
        const num = $("#card-number"), exp = $("#card-exp"), cvc = $("#card-cvc"), holder = $("#card-holder");

        // Тестовые карты
        const tc = $("#test-cards");
        if (tc) tc.innerHTML = TEST_CARDS.map(c => `
            <li><code>${c.number}</code><span>${escapeHtml(c.label)}</span><button class="btn btn-sm" type="button" data-test-card="${c.number}">Подставить</button></li>`).join("");

        const currentKop = () => parseRub(amount.value);
        const updateAmount = () => {
            const kop = currentKop();
            const valid = Number.isFinite(kop) && kop >= WALLET_LIMITS.min && kop <= WALLET_LIMITS.max;
            $$(".amount-btn", grid).forEach(b => {
                const on = Number.isFinite(kop) && +b.getAttribute("data-amount") * 100 === kop;
                b.classList.toggle("active", on);
                b.setAttribute("aria-pressed", String(on));
            });
            const bonus = valid ? topupBonus(kop) : 0;
            setText("topup-total", valid ? money(kop) : "—");
            setText("topup-credit", valid && bonus ? `· зачислим ${money(kop + bonus)}` : "");
            setText("topup-bonus", bonus ? `Бонус к пополнению: +${money(bonus)}` : "Бонус от 1 000 ₽ — +5%, от 5 000 ₽ — +10%");
            $("#topup-bonus").classList.toggle("is-on", !!bonus);
            const btnText = $("#topup-submit span");
            if (btnText) btnText.textContent = valid ? `Оплатить ${money(kop)}` : "Оплатить";
            if ($("#pane-sbp") && !$("#pane-sbp").hidden) drawSbpQr();
            return valid;
        };
        grid.addEventListener("click", e => {
            const b = e.target.closest("[data-amount]");
            if (!b) return;
            amount.value = b.getAttribute("data-amount");
            fieldError(amount, "");
            updateAmount();
            Sound.play("folder");
        });
        amount.addEventListener("input", () => { fieldError(amount, ""); updateAmount(); });
        updateAmount();

        // Способы оплаты
        const methodNow = () => (form.querySelector("input[name='pay-method']:checked") || {}).value || "card";
        form.addEventListener("change", e => {
            if (e.target.name !== "pay-method") return;
            const m = methodNow();
            $("#pane-card").hidden = m !== "card";
            $("#pane-sbp").hidden = m !== "sbp";
            if (m === "sbp") drawSbpQr();
            Sound.play("folder");
        });

        // Карта: форматирование и живое превью
        const preview = () => {
            const digits = num.value.replace(/\D/g, "");
            const brand = cardBrand(digits);
            setText("cp-brand", brand);
            setText("cp-number", (digits + "•".repeat(Math.max(0, 16 - digits.length))).slice(0, Math.max(16, digits.length)).replace(/(.{4})/g, "$1 ").trim());
            setText("cp-holder", holder.value.trim() || "CARDHOLDER");
            setText("cp-exp", exp.value || "MM/YY");
            $("#card-preview").setAttribute("data-brand", brand.toLowerCase());
        };
        num.addEventListener("input", () => {
            const d = num.value.replace(/\D/g, "").slice(0, 19);
            num.value = d.replace(/(.{4})/g, "$1 ").trim();
            fieldError(num, "");
            preview();
        });
        exp.addEventListener("input", e => {
            let d = exp.value.replace(/\D/g, "").slice(0, 4);
            if (d.length === 1 && +d > 1) d = "0" + d;
            exp.value = d.length > 2 || (d.length === 2 && e.inputType !== "deleteContentBackward") ? d.slice(0, 2) + "/" + d.slice(2) : d;
            fieldError(exp, "");
            preview();
        });
        cvc.addEventListener("input", () => { cvc.value = cvc.value.replace(/\D/g, "").slice(0, 4); fieldError(cvc, ""); });
        holder.addEventListener("input", () => {
            const v = holder.value.toUpperCase().replace(/[^A-Z .'-]/g, "");
            if (v !== holder.value) holder.value = v;
            fieldError(holder, "");
            preview();
        });
        form.addEventListener("click", e => {
            const b = e.target.closest("[data-test-card]");
            if (!b) return;
            num.value = b.getAttribute("data-test-card");
            const y = (new Date().getFullYear() + 3) % 100;
            exp.value = `12/${NX.pad(y)}`;
            cvc.value = "123";
            if (!holder.value) {
                const s = Auth.get();
                holder.value = (s ? s.callsign : "TEST USER").toUpperCase().replace(/[^A-Z .'-]/g, " ").replace(/\s+/g, " ").trim() || "TEST USER";
            }
            [num, exp, cvc, holder].forEach(i => fieldError(i, ""));
            preview();
            Sound.play("granted");
            toast(`Подставлена тестовая карта ${b.getAttribute("data-test-card").slice(-4)}`, "info");
        });

        const validateCard = () => {
            let ok = true;
            const digits = num.value.replace(/\D/g, "");
            if (!luhnOk(digits)) { fieldError(num, digits.length < 13 ? "Введите номер карты полностью" : "Номер карты введён с ошибкой"); ok = false; }
            const m = exp.value.match(/^(\d{2})\/(\d{2})$/);
            if (!m || +m[1] < 1 || +m[1] > 12) { fieldError(exp, "Формат MM/YY"); ok = false; }
            else {
                const end = new Date(2000 + +m[2], +m[1], 1).getTime();
                if (end <= Date.now()) { fieldError(exp, "Срок действия карты истёк"); ok = false; }
                else if (end > Date.now() + 20 * 365 * 86400000) { fieldError(exp, "Проверьте год"); ok = false; }
            }
            if (!/^\d{3,4}$/.test(cvc.value)) { fieldError(cvc, "3 цифры с обратной стороны"); ok = false; }
            if (holder.value.trim().length < 2) { fieldError(holder, "Как на карте, латиницей"); ok = false; }
            return ok;
        };

        form.addEventListener("submit", e => {
            e.preventDefault();
            if (dash.paying) return;
            const kop = currentKop();
            if (!Number.isFinite(kop)) { fieldError(amount, "Введите сумму числом, например 500"); amount.focus(); Sound.play("denied"); return; }
            const chk = Account.checkTopup(kop);
            if (!chk.ok) { fieldError(amount, chk.text); amount.focus(); Sound.play("denied"); return; }
            const m = methodNow();
            let card = null, result = "ok", label = "";
            if (m === "card") {
                if (!validateCard()) {
                    Sound.play("denied");
                    const bad = form.querySelector("#pane-card .field.is-invalid .input");
                    if (bad) bad.focus();
                    return;
                }
                const digits = num.value.replace(/\D/g, "");
                const test = TEST_CARDS.find(c => c.number.replace(/\s/g, "") === digits);
                result = test ? test.result : "ok";
                card = { brand: cardBrand(digits), last4: digits.slice(-4), exp: exp.value, holder: holder.value.trim() };
                label = `${card.brand} •• ${card.last4}`;
            } else if (m === "saved") {
                const a = Account.get();
                const c = a && a.cards[0];
                if (!c) return;
                label = `${c.brand} •• ${c.last4}`;
            } else {
                label = "СБП";
            }
            runPayment({ kop, method: m, label, result, card, saveCard: m === "card" && $("#card-save").checked });
        });

        // Промокод
        const promo = $("#promo-form");
        if (promo) promo.addEventListener("submit", e => {
            e.preventDefault();
            const input = $("#promo-code");
            const res = Account.applyPromo(input.value);
            const msg = $("#promo-msg");
            msg.classList.toggle("is-error", !res || !res.ok);
            if (!res || !res.ok) {
                msg.textContent = res ? res.text : "Не удалось активировать промокод";
                Sound.play("denied");
                return;
            }
            msg.textContent = `Зачислено ${money(res.amount)} по промокоду ${res.code}`;
            input.value = "";
            Sound.play("granted");
            toast(`Промокод ${res.code}: +${money(res.amount)}`, "ok");
        });

        // Карты, фильтр, «ещё», выписка
        $("#dpanel-wallet").addEventListener("click", e => {
            const rm = e.target.closest("[data-card-remove]");
            if (rm) {
                Account.removeCard(rm.getAttribute("data-card-remove"));
                Sound.play("panels");
                toast("Карта удалена из аккаунта", "ok");
                return;
            }
            const f = e.target.closest("[data-tx-filter]");
            if (f) {
                dash.txFilter = f.getAttribute("data-tx-filter");
                dash.txLimit = 10;
                $$("[data-tx-filter]").forEach(b => b.classList.toggle("active", b === f));
                Sound.play("folder");
                renderTx();
            }
        });
        $("#tx-more").addEventListener("click", () => { dash.txLimit += 10; renderTx(); Sound.play("folder"); });
        $("#tx-export").addEventListener("click", () => {
            const a = Account.get();
            const s = Auth.get();
            if (!a || !a.tx.length) { toast("Операций для выписки пока нет", "warn"); return; }
            const esc = v => `"${String(v).replace(/"/g, '""')}"`;
            const rows = [["Дата", "ID", "Тип", "Операция", "Способ", "Статус", "Сумма, ₽"]].concat(a.tx.map(t => [
                formatDate(t.date), t.id, txLabel(t), t.title, t.method, t.status === "ok" ? "выполнено" : "отклонён", (t.amount / 100).toFixed(2).replace(".", ",")
            ]));
            const csv = "\ufeff" + rows.map(r => r.map(esc).join(";")).join("\r\n");
            if (downloadFile(`nexus-wallet-${s.id}-${NX.dateISO(new Date())}.csv`, csv, "text/csv;charset=utf-8")) toast("Выписка сохранена в CSV", "ok");
        });
        document.addEventListener("nexus:theme", drawSbpQr);
    }

    /* Платёж: окно с этапами обработки, 3-D Secure и результатом */
    function runPayment(opt) {
        dash.paying = true;
        const steps = opt.method === "sbp"
            ? ["Формирование QR-кода СБП", "Ожидание подтверждения в приложении банка", "Зачисление на баланс"]
            : ["Создание платежа", "Авторизация в банке-эмитенте", opt.result === "3ds" ? "Подтверждение 3-D Secure" : "Проверка антифрод-системой", "Зачисление на баланс"];
        const modal = Modal.open({
            title: "Оплата",
            subtitle: `${money(opt.kop)} · ${escapeHtml(opt.label)}`,
            className: "pay-modal",
            noClose: true,
            html: `
                <div class="pay-flow">
                    <ol class="pay-steps">${steps.map((t, i) => `<li data-step="${i}"><span class="ps-mark"></span>${escapeHtml(t)}</li>`).join("")}</ol>
                    <div class="pay-stage" id="pay-stage"><div class="pay-spinner" aria-hidden="true"></div><p>Не закрывайте окно до завершения платежа…</p></div>
                </div>`,
            onClose: () => { dash.paying = false; }
        });
        const alive = () => Modal.current && Modal.current.modal === modal;
        const stage = () => modal.querySelector("#pay-stage");
        const mark = (i, state) => {
            $$(".pay-steps li", modal).forEach((li, k) => {
                li.classList.toggle("is-done", k < i || (k === i && state === "done"));
                li.classList.toggle("is-active", k === i && state === "active");
                li.classList.toggle("is-failed", k === i && state === "failed");
            });
        };
        const finish = (ok, reason) => {
            if (!alive()) return;
            const st = stage();
            if (ok) {
                const res = Account.topup(opt.kop, opt.label, { card: opt.card, saveCard: opt.saveCard });
                if (!res || !res.ok) { finish(false, res ? res.text : "Ошибка зачисления"); return; }
                mark(steps.length, "done");
                Sound.play("granted");
                st.innerHTML = `
                    <div class="pay-result is-ok">
                        <img src="assets/icons/checkmark.svg" alt="" width="40" height="40">
                        <p class="pr-title">Платёж выполнен</p>
                        <p class="pr-amount">+${escapeHtml(money(opt.kop + res.bonus))}</p>
                        <p class="pr-meta">${res.bonus ? `в том числе бонус ${escapeHtml(money(res.bonus))} · ` : ""}баланс ${escapeHtml(money(res.balance))}<br>Операция ${escapeHtml(res.tx.id)} · ${escapeHtml(formatDate(res.tx.date))}</p>
                    </div>`;
                if (opt.method === "card") ["card-number", "card-cvc"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
                const numEl = $("#card-number");
                if (numEl) numEl.dispatchEvent(new Event("input"));
                toast(`Баланс пополнен на ${money(opt.kop + res.bonus)}`, "ok");
            } else {
                Account.failTopup(opt.kop, opt.label, reason);
                Sound.play("denied");
                st.innerHTML = `
                    <div class="pay-result is-failed">
                        <img src="assets/icons/alert.svg" alt="" width="40" height="40">
                        <p class="pr-title">Платёж отклонён</p>
                        <p class="pr-meta">${escapeHtml(reason)}<br>Деньги не списаны. Попробуйте другую карту или СБП.</p>
                    </div>`;
            }
            const actions = modal.querySelector(".modal_actions");
            actions.innerHTML = "";
            const done = document.createElement("button");
            done.type = "button";
            done.className = "btn btn-primary";
            done.textContent = ok ? "Готово" : "Понятно";
            done.addEventListener("click", () => Modal.close());
            actions.appendChild(done);
            dash.paying = false;
            done.focus({ preventScroll: true });
        };

        const ask3ds = () => new Promise(resolve => {
            let tries = 0;
            stage().innerHTML = `
                <form class="tds-form" id="tds-form" novalidate>
                    <p class="tds-bank">3-D SECURE · ${escapeHtml(opt.label)}</p>
                    <p>Банк отправил код подтверждения на телефон.<br><span class="muted">Тестовый код: <b>1234</b></span></p>
                    <div class="field">
                        <label for="tds-code">Код из SMS</label>
                        <input class="input" id="tds-code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
                        <span class="field-error" role="alert"></span>
                    </div>
                    <div class="tds-actions">
                        <button class="btn btn-primary btn-sm" type="submit">Подтвердить</button>
                        <button class="btn btn-sm" type="button" data-tds-cancel>Отменить</button>
                    </div>
                </form>`;
            const f = $("#tds-form", modal);
            const input = $("#tds-code", modal);
            setTimeout(() => input.focus({ preventScroll: true }), 40);
            f.addEventListener("submit", ev => {
                ev.preventDefault();
                if (input.value.trim() === "1234") { resolve(true); return; }
                tries++;
                Sound.play("denied");
                if (tries >= 3) { resolve(false); return; }
                fieldError(input, `Неверный код. Осталось попыток: ${3 - tries}`);
                input.select();
            });
            f.querySelector("[data-tds-cancel]").addEventListener("click", () => resolve(null));
        });

        (async () => {
            const wait = ms => delay(reducedMotion() ? Math.min(ms, 120) : ms);
            for (let i = 0; i < steps.length; i++) {
                if (!alive()) { toast("Платёж отменён — деньги не списаны", "warn"); return; }
                mark(i, "active");
                if (opt.method === "sbp" && i === 1) {
                    stage().innerHTML = `<canvas class="pay-qr" id="pay-qr" width="140" height="140" aria-hidden="true"></canvas><p>Отсканируйте QR в приложении банка…<br><span class="muted">тестовый режим — подтверждение автоматически</span></p>`;
                    const src = $("#sbp-qr");
                    const dst = $("#pay-qr", modal);
                    if (src && dst) { drawSbpQr(); dst.getContext("2d").drawImage(src, 0, 0, dst.width, dst.height); }
                    await wait(2200);
                } else if (opt.result === "3ds" && i === 2) {
                    const ok = await ask3ds();
                    if (!alive()) return;
                    if (ok !== true) { mark(i, "failed"); finish(false, ok === null ? "Подтверждение 3-D Secure отменено" : "3-D Secure: неверный код подтверждения"); return; }
                    stage().innerHTML = '<div class="pay-spinner" aria-hidden="true"></div><p>Код принят, завершаем платёж…</p>';
                    await wait(500);
                } else {
                    await wait(i === 0 ? 650 : 900);
                }
                if (!alive()) { toast("Платёж отменён — деньги не списаны", "warn"); return; }
                if (i === 1 && opt.result === "declined") { mark(i, "failed"); finish(false, "Банк-эмитент отклонил операцию (код 05)"); return; }
                if (i === 1 && opt.result === "funds") { mark(i, "failed"); finish(false, "Недостаточно средств на карте (код 51)"); return; }
                Sound.play("stdout");
                mark(i, "done");
            }
            finish(true);
        })();
    }

    /* ----- Подписка и поддержка проектов ----- */
    function renderPlus(s, a) {
        s = s || Auth.get();
        a = a || Account.get();
        if (!s || !a) return;
        setText("plus-balance", money(a.balance));
        const info = Account.planInfo(a);
        setText("pc-label", info.label);
        setText("pc-name", info.name);
        const cur = $("#plan-current");
        if (cur) cur.setAttribute("data-plan", info.id);
        const days = info.until ? Math.max(0, Math.ceil((info.until - Date.now()) / 86400000)) : 0;
        setText("pc-meta", info.id === "free" ? "Бесплатно, без ограничений по времени" :
            info.autoRenew ? `Активен до ${dateStr(new Date(info.until))} · ${days} ${plural(days, "день", "дня", "дней")} · следующее списание ${money(info.price)}${a.balance < info.price ? " — пополните баланс" : ""}`
                : `Автопродление выключено — тариф закончится ${dateStr(new Date(info.until))}`);
        const renewWrap = $("#pc-renew-wrap");
        if (renewWrap) {
            renewWrap.hidden = info.id === "free";
            const r = $("#pc-renew");
            if (r) r.checked = !!info.autoRenew;
        }
        const cancel = $("#pc-cancel");
        if (cancel) cancel.hidden = info.id === "free";

        const grid = $("#plan-grid");
        if (grid) {
            const curPlan = PLANS[a.plan.id];
            grid.innerHTML = Object.keys(PLANS).map(id => {
                const p = PLANS[id];
                const isCur = id === a.plan.id;
                let btn;
                if (isCur) btn = '<button class="btn btn-sm" type="button" disabled>Текущий тариф</button>';
                else if (id === "free") btn = '<button class="btn btn-sm" type="button" data-plan-buy="free">Перейти на FREE</button>';
                else {
                    const credit = curPlan.price && a.plan.until > Date.now() ? Math.round(curPlan.price * (a.plan.until - Date.now()) / (30 * 86400000)) : 0;
                    const price = Math.max(0, p.price - credit);
                    btn = a.balance >= price
                        ? `<button class="btn btn-sm btn-primary" type="button" data-plan-buy="${id}">Оформить · ${escapeHtml(money(price))}</button>`
                        : `<button class="btn btn-sm" type="button" data-plan-topup="${price - a.balance}">Пополнить на ${escapeHtml(money(price - a.balance))}</button>`;
                }
                return `<article class="plan-card${isCur ? " is-current" : ""}" data-plan="${id}">
                    ${isCur ? '<span class="plan-flag">ВАШ ТАРИФ</span>' : id === "plus" ? '<span class="plan-flag">ПОПУЛЯРНЫЙ</span>' : ""}
                    <h3>${escapeHtml(p.label)}</h3>
                    <p class="plan-name">${escapeHtml(p.name)}</p>
                    <p class="plan-price"><b>${escapeHtml(money(p.price))}</b>${p.price ? " / 30 дней" : ""}</p>
                    <p class="plan-desc">${escapeHtml(p.desc)}</p>
                    <ul class="plan-perks">${p.perks.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
                    ${btn}
                </article>`;
            }).join("");
        }

        const list = $("#fund-list");
        if (list) {
            let total = 0;
            list.innerHTML = PROJECTS.map(p => {
                const f = Account.funding(p.id);
                total += f.mine;
                const pct = Math.min(100, Math.round(f.raised / f.goal * 100));
                return `<li class="fund-item">
                    <img src="assets/icons/${escapeHtml(p.icon)}.svg" alt="" width="22" height="22">
                    <div class="fund-body">
                        <p class="fund-head"><b>${escapeHtml(p.title)}</b><span>${pct}%</span></p>
                        <div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div>
                        <p class="fund-meta">${escapeHtml(money(f.raised))} из ${escapeHtml(money(f.goal))} · на ${escapeHtml(f.purpose)}${f.mine ? ` · <b>ваш вклад ${escapeHtml(money(f.mine))}</b>` : ""}</p>
                    </div>
                    <button class="btn btn-sm" type="button" data-donate="${escapeHtml(p.id)}"><img src="assets/icons/heart.svg" alt="" width="14" height="14">Поддержать</button>
                </li>`;
            }).join("");
            setText("fund-total", total ? `Вы поддержали проекты на ${money(total)} — спасибо!` : "");
        }
    }

    function initPlus() {
        const panel = $("#dpanel-plus");
        if (!panel) return;
        panel.addEventListener("click", e => {
            const top = e.target.closest("[data-plan-topup]");
            if (top) { openTopup(+top.getAttribute("data-plan-topup")); return; }
            const buy = e.target.closest("[data-plan-buy]");
            if (buy) { confirmPlan(buy.getAttribute("data-plan-buy")); return; }
            const don = e.target.closest("[data-donate]");
            if (don) openDonate(don.getAttribute("data-donate"));
        });
        $("#pc-renew").addEventListener("change", e => {
            Account.setAutoRenew(e.target.checked);
            Sound.play("folder");
            toast(`Автопродление ${e.target.checked ? "включено" : "выключено"}`, "ok");
        });
        $("#pc-cancel").addEventListener("click", () => {
            const info = Account.planInfo();
            Modal.open({
                title: "Отменить подписку",
                subtitle: info.label,
                className: "confirm-modal",
                html: `<div class="confirm-box"><img src="assets/icons/alert.svg" alt="" width="34" height="34"><p>Автопродление будет выключено, а тариф <b>${escapeHtml(info.label)}</b> останется активным до <b>${escapeHtml(dateStr(new Date(info.until)))}</b>.</p><p class="muted">Возобновить можно в любой момент до этой даты.</p></div>`,
                buttons: [{ label: "Отменить подписку", icon: "ban", action: () => { Account.cancelPlan(false); Sound.play("panels"); toast("Подписка отменена — тариф действует до конца периода", "ok"); } }]
            });
        });
    }

    function confirmPlan(id) {
        const p = PLANS[id];
        const a = Account.get();
        if (!p || !a) return;
        if (id === "free") {
            Modal.open({
                title: "Перейти на FREE",
                className: "confirm-modal",
                html: `<div class="confirm-box"><img src="assets/icons/alert.svg" alt="" width="34" height="34"><p>Тариф ${escapeHtml(PLANS[a.plan.id].label)} отключится сразу, неиспользованные дни не возвращаются.</p><p class="muted">Чтобы тариф доработал до конца периода, используйте «Отменить подписку».</p></div>`,
                buttons: [{ label: "Перейти на FREE", action: () => { Account.cancelPlan(true); Sound.play("panels"); toast("Тариф изменён на FREE", "ok"); } }]
            });
            return;
        }
        const cur = PLANS[a.plan.id];
        const credit = cur.price && a.plan.until > Date.now() ? Math.round(cur.price * (a.plan.until - Date.now()) / (30 * 86400000)) : 0;
        const price = Math.max(0, p.price - credit);
        Modal.open({
            title: `Оформить ${escapeHtml(p.label)}`,
            subtitle: "30 дней",
            className: "confirm-modal",
            html: `<div class="confirm-box"><img src="assets/icons/star.svg" alt="" width="34" height="34">
                <p>Списать <b>${escapeHtml(money(price))}</b> с баланса NEXUS ID${credit ? ` (стоимость ${escapeHtml(money(p.price))} минус остаток текущего тарифа ${escapeHtml(money(credit))})` : ""}?</p>
                <p class="muted">Баланс после оплаты: ${escapeHtml(money(a.balance - price))}. Автопродление можно выключить в любой момент.</p></div>`,
            buttons: [{
                label: `Оплатить ${money(price)}`, primary: true, icon: "checkmark", action: () => {
                    const res = Account.subscribe(id);
                    if (!res || !res.ok) {
                        Sound.play("denied");
                        toast(res ? res.text : "Не удалось оформить подписку", "warn");
                        if (res && res.error === "funds") setTimeout(() => openTopup(res.need), 200);
                        return;
                    }
                    Sound.play("granted");
                    showBanner(`${p.label} ACTIVE`, { sub: `до ${dateStr(new Date(Date.now() + 30 * 86400000))}` });
                    toast(`Подписка ${p.label} активна`, "ok");
                }
            }]
        });
    }

    function openDonate(pid) {
        const p = PROJECTS.find(x => x.id === pid);
        const a = Account.get();
        if (!p || !a) return;
        const cash = Account.planInfo(a).cashback || 0;
        let kop = 10000;
        const modal = Modal.open({
            title: "Поддержать проект",
            subtitle: escapeHtml(p.title),
            className: "donate-modal",
            html: `
                <form class="donate-form" id="donate-form" novalidate>
                    <p class="mod-lead">Сбор: ${escapeHtml(Account.funding(p.id).purpose)}. Баланс: <b>${escapeHtml(money(a.balance))}</b></p>
                    <div class="amount-grid amount-grid-4" id="donate-grid">
                        ${[50, 100, 250, 500].map(v => `<button type="button" class="amount-btn${v === 100 ? " active" : ""}" data-amount="${v}">${v} ₽</button>`).join("")}
                    </div>
                    <div class="field">
                        <label for="donate-amount">Сумма, ₽</label>
                        <input class="input" id="donate-amount" type="text" inputmode="decimal" value="100" autocomplete="off">
                        <span class="field-error" role="alert"></span>
                    </div>
                    <div class="field">
                        <label for="donate-comment">Комментарий для команды <i>— необязательно</i></label>
                        <input class="input" id="donate-comment" type="text" maxlength="140" placeholder="Спасибо за проект!">
                    </div>
                    <p class="bonus-hint${cash ? " is-on" : ""}" id="donate-cash">${cash ? `Кешбэк ${cash}% по тарифу ${escapeHtml(PLANS[a.plan.id].label)}` : "С подпиской NEXUS+ вернём 5% на баланс"}</p>
                </form>`,
            buttons: [{
                label: "Поддержать", primary: true, icon: "heart", action: () => {
                    const input = $("#donate-amount", modal);
                    kop = parseRub(input.value);
                    if (!Number.isFinite(kop) || kop < 1000) { fieldError(input, "Минимум 10 ₽"); Sound.play("denied"); return false; }
                    const res = Account.donate(p.id, kop, $("#donate-comment", modal).value.trim());
                    if (!res || !res.ok) {
                        if (res && res.error === "funds") {
                            fieldError(input, `${res.text}`);
                            Sound.play("denied");
                            Modal.close();
                            setTimeout(() => openTopup(res.need), 200);
                            toast("Не хватает средств — пополните баланс", "warn");
                            return;
                        }
                        fieldError(input, res ? res.text : "Ошибка");
                        return false;
                    }
                    Sound.play("granted");
                    toast(`Спасибо! ${p.title} получил ${money(kop)}`, "ok");
                }
            }]
        });
        const input = $("#donate-amount", modal);
        const sync = () => {
            const v = parseRub(input.value);
            $$("#donate-grid .amount-btn", modal).forEach(b => b.classList.toggle("active", +b.getAttribute("data-amount") * 100 === v));
            if (cash && Number.isFinite(v)) setText("donate-cash", `Кешбэк ${cash}%: вернём ${money(Math.round(v * cash / 100))} на баланс`);
        };
        $("#donate-grid", modal).addEventListener("click", e => {
            const b = e.target.closest("[data-amount]");
            if (!b) return;
            input.value = b.getAttribute("data-amount");
            fieldError(input, "");
            sync();
        });
        input.addEventListener("input", () => { fieldError(input, ""); sync(); });
        $("#donate-form", modal).addEventListener("submit", e => { e.preventDefault(); modal.querySelector(".modal_actions .btn-primary").click(); });
        sync();
    }

    /* ----- Библиотека ----- */
    function ownedVersions(s) {
        const out = {};
        (s.downloads || []).slice().reverse().forEach(d => {
            const p = PROJECTS.find(x => x.id === d.id) || PROJECTS.find(x => x.title === d.build);
            if (p) out[p.id] = d.version;
        });
        return out;
    }

    function libraryState(s) {
        const owned = ownedVersions(s);
        const rows = PROJECTS.map(p => {
            const access = canDownload(p);
            const mine = owned[p.id] || null;
            let state = "new";
            if (!access) state = "locked";
            else if (mine && mine !== p.version) state = "update";
            else if (mine) state = "ok";
            return { p, access, mine, state };
        });
        return {
            rows,
            available: rows.filter(r => r.access).length,
            owned: rows.filter(r => r.mine).length,
            updates: rows.filter(r => r.state === "update").length
        };
    }

    function renderLibrary(s) {
        s = s || Auth.get();
        if (!s) return;
        const st = libraryState(s);
        setText("lib-available", String(st.available));
        setText("lib-owned", String(st.owned));
        setText("lib-updates", String(st.updates));
        const total = (s.downloads || []).reduce((x, d) => x + parseSizeMiB(d.size), 0);
        setText("lib-size", total >= 1024 ? `${(total / 1024).toFixed(1)} GiB` : `${Math.round(total)} MiB`);
        const order = { update: 0, ok: 1, new: 2, locked: 3 };
        const list = $("#lib-list");
        if (list) {
            list.innerHTML = st.rows.slice().sort((x, y) => order[x.state] - order[y.state]).map(r => {
                const p = r.p;
                const stateHtml = {
                    update: `<span class="lib-state is-update">Обновление ${escapeHtml(r.mine)} → ${escapeHtml(p.version)}</span>`,
                    ok: `<span class="lib-state is-ok">Актуальная версия ${escapeHtml(p.version)}</span>`,
                    new: `<span class="lib-state">Не скачано · ${escapeHtml(p.version)} · ${escapeHtml(p.size)}</span>`,
                    locked: `<span class="lib-state is-locked">Нужна роль ${escapeHtml((ACCESS[p.access] || ACCESS.admin).short)}</span>`
                }[r.state];
                const btn = r.state === "locked"
                    ? '<span class="btn btn-sm is-disabled" aria-disabled="true"><img src="assets/icons/lock.svg" alt="" width="14" height="14">Нет доступа</span>'
                    : `<a class="btn btn-sm${r.state === "update" ? " btn-primary" : ""}" href="projects.html#${encodeURIComponent(p.id)}"><img src="assets/icons/download.svg" alt="" width="14" height="14">${r.state === "update" ? "Обновить" : r.state === "ok" ? "Открыть" : "Скачать"}</a>`;
                return `<li class="lib-item is-${r.state}">
                    <span class="lib-icon"><img src="assets/icons/${escapeHtml(p.icon)}.svg" alt="" width="22" height="22"></span>
                    <span class="lib-text"><b>${escapeHtml(p.title)}</b><i>${escapeHtml(CATEGORIES[p.category] || p.category)} · ${escapeHtml(STATUSES[p.status].label)}</i>${stateHtml}</span>
                    ${btn}
                </li>`;
            }).join("") || '<li class="muted">Каталог пуст</li>';
        }
        renderDownloads();
    }

    function renderDownloads(highlightFirst) {
        const s = Auth.get();
        const body = $("#dl-body");
        if (!s || !body) return;
        const list = s.downloads || [];
        const clear = $("#dl-clear");
        if (clear) clear.hidden = !list.length;
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

    function initLibrary() {
        const clear = $("#dl-clear");
        if (clear) clear.addEventListener("click", () => {
            Modal.open({
                title: "Очистить историю",
                className: "confirm-modal",
                html: '<div class="confirm-box"><img src="assets/icons/alert.svg" alt="" width="34" height="34"><p>История загрузок будет удалена. Скачанные файлы на компьютере останутся.</p><p class="muted">Библиотека перестанет показывать обновления для этих сборок.</p></div>',
                buttons: [{ label: "Очистить", icon: "close", action: () => { Auth.update({ downloads: [] }); Sound.play("panels"); toast("История загрузок очищена", "ok"); } }]
            });
        });
    }

    /* ----- Уведомления ----- */
    function renderNotifications(s, a) {
        a = a || Account.get();
        if (!a) return;
        const unread = a.notifications.filter(n => !n.read).length;
        setText("notif-summary", a.notifications.length ? `${unread} ${plural(unread, "непрочитанное", "непрочитанных", "непрочитанных")} из ${a.notifications.length}` : "уведомлений нет");
        const list = $("#notif-list");
        if (list) {
            const f = dash.notifFilter;
            const items = a.notifications.filter(n => f === "all" || (f === "unread" ? !n.read : n.type === f));
            list.innerHTML = items.map(n => {
                const t = Account.NOTIF_TYPES[n.type] || Account.NOTIF_TYPES.system;
                return `<li class="notif${n.read ? "" : " is-unread"}" data-notif="${escapeHtml(n.id)}">
                    <span class="notif-icon"><img src="assets/icons/${t.icon}.svg" alt="" width="18" height="18"></span>
                    <div class="notif-body">
                        <p class="notif-title"><b>${escapeHtml(n.title)}</b><span class="notif-type">${escapeHtml(t.label)}</span></p>
                        ${n.text ? `<p class="notif-text">${escapeHtml(n.text)}</p>` : ""}
                        <p class="notif-time">${escapeHtml(formatDate(n.date))} · ${escapeHtml(ago(n.date))}</p>
                    </div>
                    <div class="notif-actions">
                        ${n.link ? `<button class="btn btn-sm" type="button" data-notif-open="${escapeHtml(n.id)}">Открыть</button>` : ""}
                        <button class="btn btn-sm" type="button" data-notif-remove="${escapeHtml(n.id)}" aria-label="Удалить уведомление"><img src="assets/icons/close.svg" alt="" width="12" height="12"></button>
                    </div>
                </li>`;
            }).join("") || `<li class="notif-empty">${a.notifications.length ? "Нет уведомлений по этому фильтру" : "Здесь появятся платежи, релизы и события безопасности"}</li>`;
        }
        $$("[data-pref]").forEach(el => {
            const k = el.getAttribute("data-pref");
            if (k !== "security") el.checked = a.prefs[k] !== false;
        });
        const readAll = $("#notif-read-all");
        if (readAll) readAll.disabled = !unread;
        const clear = $("#notif-clear");
        if (clear) clear.disabled = !a.notifications.length;
    }

    function initNotifications() {
        const panel = $("#dpanel-notifications");
        if (!panel) return;
        panel.addEventListener("click", e => {
            const f = e.target.closest("[data-notif-filter]");
            if (f) {
                dash.notifFilter = f.getAttribute("data-notif-filter");
                $$("[data-notif-filter]").forEach(b => b.classList.toggle("active", b === f));
                Sound.play("folder");
                renderNotifications();
                return;
            }
            const rm = e.target.closest("[data-notif-remove]");
            if (rm) { Account.removeNotification(rm.getAttribute("data-notif-remove")); Sound.play("panels"); return; }
            const op = e.target.closest("[data-notif-open]");
            const a = Account.get();
            if (op && a) {
                const n = a.notifications.find(x => x.id === op.getAttribute("data-notif-open"));
                if (!n) return;
                Account.markRead(n.id);
                if (DASH_TABS[n.link]) goTab(n.link);
                else if (n.link) window.location.href = n.link;
                return;
            }
            const item = e.target.closest("[data-notif]");
            if (item && item.classList.contains("is-unread")) { Account.markRead(item.getAttribute("data-notif")); Sound.play("folder"); }
        });
        $("#notif-read-all").addEventListener("click", () => { Account.markRead(null); Sound.play("granted"); toast("Все уведомления прочитаны", "ok"); });
        $("#notif-clear").addEventListener("click", () => {
            Modal.open({
                title: "Очистить уведомления",
                className: "confirm-modal",
                html: '<div class="confirm-box"><img src="assets/icons/alert.svg" alt="" width="34" height="34"><p>Удалить все уведомления?</p><p class="muted">История операций в кошельке останется.</p></div>',
                buttons: [{ label: "Удалить все", icon: "close", action: () => { Account.removeNotification(null); Sound.play("panels"); toast("Уведомления удалены", "ok"); } }]
            });
        });
        $$("[data-pref]").forEach(el => el.addEventListener("change", () => {
            const k = el.getAttribute("data-pref");
            if (k === "security") return;
            Account.setPref(k, el.checked);
            Sound.play("folder");
            toast(`${el.getAttribute("data-name")[0].toUpperCase()}${el.getAttribute("data-name").slice(1)} — ${el.checked ? "включены" : "выключены"}`, "ok");
        }));
    }

    /* ----- Безопасность ----- */
    function renderSecurity(s, a) {
        const sec = Account.securityScore(a, s);
        setText("sec-score", sec.score + "%");
        const bar = $("#sec-bar");
        if (bar) { bar.style.width = sec.score + "%"; bar.parentElement.setAttribute("data-level", sec.score >= 75 ? "high" : sec.score >= 50 ? "mid" : "low"); }
        const cl = $("#sec-checklist");
        if (cl) cl.innerHTML = checklistHtml(sec.items);

        const on = a.security.twoFA;
        const box = $("#twofa-box");
        if (box) box.classList.toggle("is-on", on);
        setText("twofa-state", on ? "Включена · код из письма" : "Выключена");
        setText("twofa-text", on
            ? `При входе с нового устройства потребуется код из письма. Резервных кодов: ${a.security.backup.length}.`
            : "При входе с нового устройства потребуется код из письма. Без него злоумышленник не войдёт, даже зная пароль.");
        const t = $("#twofa-toggle");
        if (t) { t.textContent = on ? "Выключить 2FA" : "Включить 2FA"; t.classList.toggle("btn-primary", !on); t.classList.toggle("btn-danger", on); }
        const codes = $("#twofa-codes");
        if (codes) codes.hidden = !on;
        setText("pwd-changed", a.security.pwdChanged ? `изменён ${ago(a.security.pwdChanged)}` : "не менялся");

        const sb = $("#sess-body");
        if (sb) {
            sb.innerHTML = a.security.sessions.map(x => `
                <tr class="${x.current ? "is-current" : ""}">
                    <td data-label="Устройство"><b>${escapeHtml(x.device)}</b>${x.current ? ' <span class="badge badge-online">ЭТО УСТРОЙСТВО</span>' : ""}</td>
                    <td data-label="Где">${escapeHtml(x.place)}</td>
                    <td data-label="IP">${escapeHtml(x.ip)}</td>
                    <td data-label="Активность">${x.current ? "сейчас" : escapeHtml(ago(x.last))}</td>
                    <td data-label="">${x.current ? "" : `<button class="btn btn-sm btn-danger" type="button" data-sess-end="${escapeHtml(x.id)}">Завершить</button>`}</td>
                </tr>`).join("");
        }
        setText("sess-count", `${a.security.sessions.length} ${plural(a.security.sessions.length, "активный сеанс", "активных сеанса", "активных сеансов")}`);
        const endAll = $("#sess-end-all");
        if (endAll) endAll.hidden = a.security.sessions.length <= 1;

        const lb = $("#seclog-body");
        if (lb) lb.innerHTML = a.security.log.slice(0, 12).map(l => `
            <tr>
                <td data-label="Дата">${escapeHtml(formatDate(l.date))}</td>
                <td data-label="Событие">${escapeHtml(l.event)}</td>
                <td data-label="Устройство">${escapeHtml(l.device)}</td>
                <td data-label="Результат"><span class="badge ${l.ok ? "badge-online" : "badge-offline"}">${l.ok ? "OK" : "ОТКАЗ"}</span></td>
            </tr>`).join("");
    }

    function pwdStrength(v) {
        let score = 0;
        if (v.length >= 8) score++;
        if (v.length >= 12) score++;
        if (/[a-zа-яё]/.test(v) && /[A-ZА-ЯЁ]/.test(v)) score++;
        if (/\d/.test(v)) score++;
        if (/[^A-Za-zА-Яа-яЁё0-9]/.test(v)) score++;
        return Math.min(4, score);
    }

    /* Подтверждение по коду из письма (письмо приходит в «Уведомления») */
    function emailCodeFlow(opts) {
        const s = Auth.get();
        if (!s) return;
        let current = String(NX.randInt(100000, 999999));
        let tries = 0;
        const modal = Modal.open({
            title: opts.title,
            subtitle: "подтверждение по email",
            className: "confirm-modal",
            html: `
                <form class="tds-form" id="code-form" novalidate>
                    <p>Мы отправили 6-значный код на <b>${escapeHtml(s.email)}</b>. Письмо продублировано в «Уведомлениях» кабинета.</p>
                    <div class="field">
                        <label for="code-input">Код из письма</label>
                        <input class="input code-input" id="code-input" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
                        <span class="field-error" role="alert"></span>
                    </div>
                    <button class="link-btn" type="button" data-resend>Отправить код ещё раз</button>
                </form>`,
            buttons: [{
                label: "Подтвердить", primary: true, icon: "checkmark", action: () => {
                    const input = $("#code-input", modal);
                    if (input.value.trim() === current) { opts.onOk(); return; }
                    tries++;
                    Sound.play("denied");
                    if (tries >= 5) { Account.logEvent(`${opts.title}: превышено число попыток`, false); toast("Слишком много попыток — запросите новый код позже", "warn"); return; }
                    fieldError(input, `Неверный код. Осталось попыток: ${5 - tries}`);
                    input.select();
                    return false;
                }
            }]
        });
        const send = () => {
            Account.notify("security", "Код подтверждения NEXUS ID", `Ваш код: ${current}. Никому его не сообщайте.`, { toast: false });
            toast(`Письмо на ${s.email}: код ${current} (тестовый режим)`, "info", { ttl: 9000 });
        };
        send();
        $("#code-form", modal).addEventListener("submit", e => { e.preventDefault(); modal.querySelector(".modal_actions .btn-primary").click(); });
        modal.querySelector("[data-resend]").addEventListener("click", () => {
            current = String(NX.randInt(100000, 999999));
            send();
            Sound.play("info");
        });
        const input = $("#code-input", modal);
        input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 6); fieldError(input, ""); });
        setTimeout(() => input.focus({ preventScroll: true }), 60);
    }

    function showBackupCodes(codes) {
        const s = Auth.get();
        Modal.open({
            title: "Резервные коды",
            subtitle: "2FA",
            className: "confirm-modal",
            html: `<p>Каждый код можно использовать один раз, если нет доступа к почте. Храните их отдельно от пароля.</p>
                <ol class="code-grid">${codes.map(c => `<li><code>${escapeHtml(c)}</code></li>`).join("")}</ol>`,
            buttons: [
                { label: "Скопировать", icon: "clipboard", action: () => { NX.copyText(codes.join("\n")); toast("Коды скопированы", "ok"); return false; } },
                { label: "Скачать .txt", icon: "download", action: () => { downloadFile(`nexus-backup-codes-${s ? s.id : "account"}.txt`, `NEXUS ID — резервные коды 2FA\n${s ? s.callsign + " · " + s.id : ""}\n\n${codes.join("\n")}\n`); return false; } }
            ]
        });
    }

    function initSecurity() {
        const panel = $("#dpanel-security");
        if (!panel) return;
        $("#twofa-toggle").addEventListener("click", () => {
            const a = Account.get();
            if (!a) return;
            if (!a.security.twoFA) {
                emailCodeFlow({
                    title: "Включение 2FA",
                    onOk: () => {
                        const codes = Account.setTwoFA(true);
                        Sound.play("granted");
                        toast("Двухфакторная защита включена", "ok");
                        setTimeout(() => showBackupCodes(codes), 250);
                    }
                });
            } else {
                emailCodeFlow({
                    title: "Выключение 2FA",
                    onOk: () => { Account.setTwoFA(false); Sound.play("panels"); toast("Двухфакторная защита выключена", "warn"); }
                });
            }
        });
        $("#twofa-codes").addEventListener("click", () => {
            const a = Account.get();
            if (!a) return;
            Modal.open({
                title: "Резервные коды",
                className: "confirm-modal",
                html: `<div class="confirm-box"><img src="assets/icons/lock.svg" alt="" width="34" height="34"><p>Осталось кодов: <b>${a.security.backup.length}</b>.</p><p class="muted">Новый набор заменит старые коды — они перестанут работать.</p></div>`,
                buttons: [
                    { label: "Показать текущие", action: () => { setTimeout(() => showBackupCodes(a.security.backup), 200); } },
                    { label: "Создать новые", primary: true, action: () => { const codes = Account.regenBackup(); Sound.play("granted"); setTimeout(() => showBackupCodes(codes), 200); } }
                ]
            });
        });

        // Смена пароля
        const form = $("#pwd-form");
        const cur = $("#pwd-current"), nw = $("#pwd-new"), rep = $("#pwd-repeat");
        const labels = ["слишком простой", "слабый", "средний", "хороший", "надёжный"];
        nw.addEventListener("input", () => {
            const sc = nw.value ? pwdStrength(nw.value) : 0;
            $("#pwd-strength-meter").setAttribute("data-level", String(nw.value ? Math.max(1, sc) : 0));
            setText("pwd-strength", nw.value ? `Надёжность: ${labels[sc]}` : "—");
            fieldError(nw, "");
        });
        [cur, rep].forEach(i => i.addEventListener("input", () => fieldError(i, "")));
        form.addEventListener("submit", e => {
            e.preventDefault();
            let ok = true;
            if (cur.value.length < 6) { fieldError(cur, "Введите текущий пароль"); ok = false; }
            if (nw.value.length < 8) { fieldError(nw, "Минимум 8 символов"); ok = false; }
            else if (pwdStrength(nw.value) < 2) { fieldError(nw, "Добавьте цифры, заглавные буквы или символы"); ok = false; }
            else if (nw.value === cur.value) { fieldError(nw, "Новый пароль совпадает с текущим"); ok = false; }
            if (rep.value !== nw.value) { fieldError(rep, "Пароли не совпадают"); ok = false; }
            if (!ok) { Sound.play("denied"); const bad = form.querySelector(".field.is-invalid .input"); if (bad) bad.focus(); return; }
            Account.changePassword();
            form.reset();
            nw.dispatchEvent(new Event("input"));
            Sound.play("granted");
            toast("Пароль изменён. Другие устройства попросят войти заново", "ok");
        });

        panel.addEventListener("click", e => {
            const end = e.target.closest("[data-sess-end]");
            if (end) { Account.endSession(end.getAttribute("data-sess-end")); Sound.play("panels"); toast("Сеанс завершён", "ok"); }
        });
        $("#sess-end-all").addEventListener("click", () => {
            const n = Account.endSession(null);
            Sound.play("panels");
            toast(n ? `Завершено сеансов: ${n}` : "Других сеансов нет", "ok");
        });

        $("#acc-export").addEventListener("click", () => {
            const data = Account.exportData();
            if (!data) return;
            if (downloadFile(`nexus-account-${data.session.id}.json`, JSON.stringify(data, null, 2), "application/json")) {
                Account.logEvent("Экспорт данных аккаунта");
                toast("Данные аккаунта сохранены в JSON", "ok");
            }
        });
        $("#acc-delete").addEventListener("click", () => {
            const s = Auth.get();
            if (!s) return;
            const modal = Modal.open({
                title: "Удаление аккаунта",
                subtitle: escapeHtml(s.callsign),
                className: "confirm-modal",
                html: `<div class="confirm-box"><img src="assets/icons/alert.svg" alt="" width="34" height="34">
                    <p>Будут удалены баланс, история операций, подписка, уведомления и настройки безопасности. Это действие нельзя отменить.</p>
                    <p class="muted">Для подтверждения введите логин <b>${escapeHtml(s.callsign)}</b>.</p></div>
                    <div class="field"><label for="del-confirm">Логин</label><input class="input" id="del-confirm" type="text" autocomplete="off"><span class="field-error" role="alert"></span></div>`,
                buttons: [{
                    label: "Удалить навсегда", icon: "ban", action: () => {
                        const input = $("#del-confirm", modal);
                        if (input.value.trim() !== s.callsign) { fieldError(input, "Логин не совпадает"); Sound.play("denied"); return false; }
                        Account.destroy();
                        Sound.play("denied");
                        toast("Аккаунт удалён", "warn");
                        setTimeout(() => { window.location.href = "index.html"; }, 700);
                    }
                }]
            });
        });
    }

    /* ----- Профиль и роль ----- */
    const TIMEZONES = ["Europe/Amsterdam", "Europe/Berlin", "Europe/Brussels", "Europe/Warsaw", "Europe/London", "Europe/Kyiv", "Europe/Minsk", "Europe/Moscow", "Asia/Almaty", "Asia/Yekaterinburg", "Asia/Novosibirsk", "UTC"];

    function renderProfileTab(s, a) {
        const role = ROLES[s.role];
        setText("pi-callsign", s.callsign);
        setText("pi-id", s.id);
        setText("pi-role", `${role.label} — ${role.name}`);
        setText("pi-registered", formatDate(s.registered));
        setText("pi-last", formatDate(s.lastLogin));
        setText("pi-session", s.expires ? "до " + formatDate(s.expires) : "запомнена на устройстве");

        if (!dash.profileDirty) fillProfileForm(s, a);

        const card = $("#role-card");
        if (card) {
            card.setAttribute("data-role", s.role);
            setText("role-name", role.label);
            setText("role-title", role.name);
            setText("role-desc", role.desc);
        }
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

        // Значки
        const dl = s.downloads || [];
        const closedIds = PROJECTS.filter(p => p.status === "closed").map(p => p.id);
        const owned = ownedVersions(s);
        const badges = [
            { icon: "sign-in", label: "На связи", desc: "Первый вход в NEXUS ID", done: true },
            { icon: "download", label: "Первая загрузка", desc: "Скачать любую сборку", done: dl.length > 0 },
            { icon: "archive", label: "Коллекционер", desc: "5 загрузок", done: dl.length >= 5 },
            { icon: "flag", label: "Тестировщик", desc: "Скачать сборку закрытого теста", done: closedIds.some(id => owned[id]) },
            { icon: "portfolio", label: "Инвестор", desc: "Пополнить баланс", done: a.tx.some(t => t.type === "topup" && t.status === "ok") },
            { icon: "heart", label: "Меценат", desc: "Поддержать проект", done: Object.keys(a.donations).some(k => a.donations[k] > 0) },
            { icon: "star", label: "NEXUS+", desc: "Оформить подписку", done: a.plan.id !== "free" },
            { icon: "lock", label: "Под защитой", desc: "Включить 2FA", done: a.security.twoFA }
        ];
        setText("ach-count", `${badges.filter(b => b.done).length} / ${badges.length}`);
        const grid = $("#ach-grid");
        if (grid) grid.innerHTML = badges.map(b => `
            <li class="ach${b.done ? " is-done" : ""}" title="${escapeHtml(b.desc)}">
                <img src="assets/icons/${b.icon}.svg" alt="" width="20" height="20">
                <b>${escapeHtml(b.label)}</b>
                <span>${escapeHtml(b.done ? "получен" : b.desc)}</span>
            </li>`).join("");
    }

    function fillProfileForm(s, a) {
        const f = $("#profile-form");
        if (!f) return;
        const tz = $("#pf-tz");
        if (tz && !tz.options.length) {
            const zones = TIMEZONES.slice();
            if (a.profile.timezone && !zones.includes(a.profile.timezone)) zones.unshift(a.profile.timezone);
            tz.innerHTML = zones.map(z => `<option value="${escapeHtml(z)}">${escapeHtml(z.replace("_", " "))}</option>`).join("");
        }
        $("#pf-name").value = a.profile.displayName || s.callsign;
        $("#pf-email").value = s.email || "";
        $("#pf-bio").value = a.profile.bio || "";
        setText("pf-bio-count", `${(a.profile.bio || "").length}/200`);
        $("#pf-country").value = a.profile.country || "NL";
        if (tz) tz.value = a.profile.timezone || TIMEZONES[0];
        $("#pf-discord").value = a.profile.discord || "";
        $("#pf-github").value = a.profile.github || "";
        $("#pf-public").checked = a.profile.public !== false;
    }

    function initProfileForm() {
        const f = $("#profile-form");
        if (!f) return;
        f.addEventListener("input", e => {
            dash.profileDirty = true;
            if (e.target.classList.contains("input")) fieldError(e.target, "");
            if (e.target.id === "pf-bio") setText("pf-bio-count", `${e.target.value.length}/200`);
        });
        f.addEventListener("change", () => { dash.profileDirty = true; });
        f.addEventListener("submit", e => {
            e.preventDefault();
            const name = $("#pf-name"), email = $("#pf-email"), gh = $("#pf-github");
            let ok = true;
            const nv = name.value.trim();
            if (nv.length < 3 || !/^[\wА-Яа-яЁё .-]+$/.test(nv)) { fieldError(name, "3–24 символа: буквы, цифры, пробел, _ . -"); ok = false; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) { fieldError(email, "Проверьте адрес email"); ok = false; }
            if (gh.value.trim() && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(gh.value.trim())) { fieldError(gh, "Только латиница, цифры и дефис"); ok = false; }
            if (!ok) { Sound.play("denied"); const bad = f.querySelector(".field.is-invalid .input"); if (bad) bad.focus(); return; }
            const s = Auth.get();
            const emailChanged = s && s.email !== email.value.trim();
            dash.profileDirty = false;
            Account.updateProfile({
                displayName: nv,
                bio: $("#pf-bio").value.trim().slice(0, 200),
                country: $("#pf-country").value,
                timezone: $("#pf-tz").value,
                discord: $("#pf-discord").value.trim(),
                github: gh.value.trim(),
                public: $("#pf-public").checked
            });
            if (emailChanged) {
                Auth.update({ email: email.value.trim() });
                Account.notify("security", "Email изменён", `Новый адрес: ${email.value.trim()}`, { toast: false });
            }
            Sound.play("granted");
            toast("Профиль сохранён", "ok");
        });
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
    /* ================================================================
     * Политика конфиденциальности: оглавление и данные в этом браузере
     * ================================================================ */
    const STORAGE_LABELS = {
        nx_session: "сессия и профиль",
        nx_accounts: "кошелёк, уведомления, безопасность",
        nx_settings: "настройки HUD",
        nx_custom_projects: "проекты из конструктора",
        nx_hidden_projects: "скрытые официальные проекты",
        nx_custom_categories: "свои разделы каталога",
        nx_tickets: "обращения в поддержку",
        nx_consent: "уведомление о хранилище",
        nx_pending_dl: "отложенная загрузка",
        nx_vpn: "тестовый VPN: настройки и сеансы",
        nx_ide: "проекты NEXUS IDE",
        nx_booted: "заставка показана",
        nx_welcome: "приветствие после входа"
    };

    function formatBytes(b) {
        if (b < 1024) return `${b} Б`;
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1).replace(".", ",")} КБ`;
        return `${(b / 1024 / 1024).toFixed(2).replace(".", ",")} МБ`;
    }

    function initTocSpy(listSel) {
        const links = $$(`${listSel} a[href^="#"]`);
        if (!links.length) return;
        const map = new Map();
        links.forEach(a => {
            const sec = document.getElementById(a.getAttribute("href").slice(1));
            if (sec) map.set(sec, a);
            a.addEventListener("click", e => {
                if (!sec) return;
                e.preventDefault();
                const top = sec.getBoundingClientRect().top + window.scrollY - 120;
                window.scrollTo({ top, behavior: reducedMotion() ? "auto" : "smooth" });
                if (window.history.replaceState) window.history.replaceState(null, "", "#" + sec.id);
                Sound.play("folder");
            });
        });
        if (!("IntersectionObserver" in window)) return;
        const seen = new Set();
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => { if (en.isIntersecting) seen.add(en.target); else seen.delete(en.target); });
            const first = [...map.keys()].find(sec => seen.has(sec));
            if (!first) return;
            links.forEach(a => a.classList.toggle("active", a === map.get(first)));
        }, { rootMargin: "-120px 0px -55% 0px" });
        map.forEach((a, sec) => io.observe(sec));
    }

    function initPrivacy() {
        initTocSpy("#toc-list");
        const body = $("#storage-body");
        const render = () => {
            if (!body) return;
            const rows = NX.SiteData.list();
            const total = rows.reduce((s, r) => s + r.bytes, 0);
            setText("storage-summary", rows.length
                ? `Сейчас сайт хранит ${rows.length} ${plural(rows.length, "запись", "записи", "записей")} общим объёмом ${formatBytes(total)}. Эти данные есть только на этом устройстве.`
                : "В этом браузере нет данных сайта.");
            body.innerHTML = rows.length ? rows.map(r => `
                <tr>
                    <td data-label="Хранилище">${r.area === "localStorage" ? "localStorage" : "sessionStorage"}</td>
                    <td data-label="Ключ"><code>${escapeHtml(r.key)}</code>${STORAGE_LABELS[r.key] ? `<br><span class="muted">${escapeHtml(STORAGE_LABELS[r.key])}</span>` : ""}</td>
                    <td data-label="Размер" class="num">${escapeHtml(formatBytes(r.bytes))}</td>
                </tr>`).join("") : '<tr><td colspan="3" data-label="Данные">Пусто — сайт ничего не сохранил</td></tr>';
            const exp = $("#storage-export"), clr = $("#storage-clear");
            if (exp) exp.disabled = !rows.length;
            if (clr) clr.disabled = !rows.length;
        };
        render();
        window.addEventListener("storage", render);
        ["nexus:auth", "nexus:account", "nexus:settings"].forEach(ev => document.addEventListener(ev, render));

        const exp = $("#storage-export");
        if (exp) exp.addEventListener("click", () => {
            if (downloadFile(`nexus-site-data-${NX.dateISO(new Date())}.json`, JSON.stringify(NX.SiteData.exportJSON(), null, 2), "application/json")) {
                Sound.play("granted");
                toast("Копия данных сайта сохранена в JSON", "ok");
            }
        });
        const clr = $("#storage-clear");
        if (clr) clr.addEventListener("click", () => {
            const n = NX.SiteData.list().length;
            Modal.open({
                title: "Удалить все данные сайта",
                subtitle: `${n} ${plural(n, "запись", "записи", "записей")}`,
                className: "confirm-modal",
                html: `<div class="confirm-box"><img src="assets/icons/alert.svg" alt="" width="34" height="34">
                    <p>Будут удалены вход, все аккаунты NEXUS ID в этом браузере (баланс, история, подписка), настройки HUD,
                    проекты из конструктора и обращения.</p>
                    <p class="muted">Отменить удаление нельзя. Перед удалением можно скачать копию.</p></div>`,
                buttons: [{
                    label: "Удалить всё", icon: "close", action: () => {
                        NX.SiteData.clearAll();
                        Sound.play("denied");
                        toast("Данные сайта удалены. Страница перезагрузится", "warn");
                        setTimeout(() => window.location.reload(), 900);
                    }
                }]
            });
        });
    }

    /* ================================================================
     * Контакты: каналы связи, форма обращения, мои обращения
     * ================================================================ */
    const TICKETS_KEY = "nx_tickets";
    const TOPICS = {
        bug: { label: "Ошибка на сайте", tag: "bug", project: true },
        build: { label: "Сборка или сервер", tag: "build", project: true },
        account: { label: "Аккаунт и данные", tag: "account", project: false },
        idea: { label: "Идея или отзыв", tag: "idea", project: true },
        collab: { label: "Сотрудничество", tag: "collab", project: false }
    };

    function ticketId() {
        const n = Date.now().toString(36).toUpperCase().slice(-4);
        const r = Math.random().toString(36).toUpperCase().slice(2, 4).padEnd(2, "0");
        return `NX-T-${n}${r}`;
    }

    function diagnostics() {
        const s = Auth.get();
        const os = NX.detectOS();
        const ver = (($("script[src*='ui-effects.js']") || {}).src || "").split("v=")[1] || "—";
        const lines = [
            `Браузер: ${NX.detectBrowser()}`,
            `Система: ${os.full}`,
            `Экран: ${window.screen.width}×${window.screen.height} @${window.devicePixelRatio || 1}x, окно ${window.innerWidth}×${window.innerHeight}`,
            `Язык: ${navigator.language || "—"}`,
            `Тема HUD: ${Settings.get("theme") || "blade"}`,
            `Аккаунт: ${s ? `${s.id} · ${ROLES[s.role].label}` : "гость"}`,
            `Версия сайта: ${ver}`,
            `Время: ${new Date().toISOString()}`
        ];
        return lines.join("\n");
    }

    function initContacts() {
        const C = NX.SITE.contacts;
        const grid = $("#channel-grid");
        const issuesUrl = C.github ? C.github.replace(/\/$/, "") + "/issues" : "";
        if (grid) {
            const cards = [];
            if (C.email) cards.push({ icon: "mail", title: "Email", text: "Вопросы по аккаунту, данным и сотрудничеству", value: C.email, href: `mailto:${C.email}`, cta: "Написать" });
            if (C.discord) cards.push({ icon: "discord", title: "Discord", text: "Сообщество, тестеры и быстрые вопросы", value: C.discord.replace(/^https?:\/\//, ""), href: C.discord, cta: "Присоединиться", ext: true });
            if (C.telegram) cards.push({ icon: "satellite", title: "Telegram", text: "Новости проектов и связь с командой", value: C.telegram.replace(/^https?:\/\//, ""), href: C.telegram, cta: "Открыть", ext: true });
            if (issuesUrl) cards.push({ icon: "github", title: "GitHub Issues", text: "Баг-репорты и предложения по сайту. Обращения публичные — не пишите туда личные данные", value: issuesUrl.replace(/^https?:\/\//, ""), href: issuesUrl, cta: "Открыть issues", ext: true });
            cards.push({ icon: "edit", title: "Форма на сайте", text: "Соберём обращение с номером и технической информацией и отправим через удобный канал", value: "ниже на этой странице", href: "#contact-form", cta: "Заполнить", local: true });
            grid.innerHTML = cards.map(c => `
                <li class="channel">
                    <span class="channel-icon"><img src="assets/icons/${c.icon}.svg" alt="" width="24" height="24"></span>
                    <h3>${escapeHtml(c.title)}</h3>
                    <p>${escapeHtml(c.text)}</p>
                    <p class="channel-value">${escapeHtml(c.value)}</p>
                    <a class="btn btn-sm" href="${escapeHtml(c.href)}"${c.ext ? ' target="_blank" rel="noopener noreferrer"' : ""}${c.local ? " data-scroll-form" : ""}>${escapeHtml(c.cta)}${c.ext ? ' <img src="assets/icons/external.svg" alt="" width="12" height="12">' : ""}</a>
                </li>`).join("");
            grid.addEventListener("click", e => {
                const a = e.target.closest("[data-scroll-form]");
                if (!a) return;
                e.preventDefault();
                const f = $("#contact-form");
                window.scrollTo({ top: f.getBoundingClientRect().top + window.scrollY - 140, behavior: reducedMotion() ? "auto" : "smooth" });
                setTimeout(() => { const i = $("#ct-name"); if (i) i.focus({ preventScroll: true }); }, 400);
            });
        }

        const form = $("#contact-form");
        if (!form) return;
        const name = $("#ct-name"), email = $("#ct-email"), msg = $("#ct-message"), project = $("#ct-project");
        const diag = $("#ct-diag"), diagPre = $("#ct-diag-preview"), agree = $("#ct-agree");
        let currentId = ticketId();
        setText("ticket-preview", currentId);

        const fillProjects = () => {
            const cur = project.value;
            project.innerHTML = '<option value="">— не относится к проекту —</option><option value="site">Сайт NEXUS//DEV</option>' +
                PROJECTS.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} · ${escapeHtml(p.version)}</option>`).join("");
            if ([...project.options].some(o => o.value === cur)) project.value = cur;
        };
        fillProjects();
        document.addEventListener("nexus:catalog", fillProjects);

        const prefill = () => {
            const s = Auth.get();
            if (!s) return;
            const a = NX.Account.get();
            if (!name.value) name.value = (a && a.profile.displayName) || s.callsign;
            if (!email.value && s.email && !/\.example$/.test(s.email)) email.value = s.email;
        };
        prefill();
        document.addEventListener("nexus:auth", prefill);

        const topicNow = () => (form.querySelector("input[name='ct-topic']:checked") || {}).value || "bug";
        const syncTopic = () => {
            const t = TOPICS[topicNow()];
            $("#ct-project-field").hidden = !t.project;
        };
        const syncDiag = () => {
            diagPre.hidden = !diag.checked;
            if (diag.checked) diagPre.textContent = diagnostics();
        };
        syncTopic();
        syncDiag();
        // Предвыбор темы по ссылке: contacts.html#bug, #build, #account, #idea, #collab
        const hashTopic = window.location.hash.slice(1);
        if (TOPICS[hashTopic]) {
            const r = form.querySelector(`input[name='ct-topic'][value='${hashTopic}']`);
            if (r) { r.checked = true; syncTopic(); }
        }

        form.addEventListener("change", e => {
            if (e.target.name === "ct-topic") { syncTopic(); Sound.play("folder"); }
            if (e.target === diag) syncDiag();
            if (e.target === agree) setText("ct-agree-error", "");
        });
        form.addEventListener("input", e => {
            if (e.target.classList.contains("input")) fieldError(e.target, "");
            if (e.target === msg) setText("ct-count", `${msg.value.length}/1500`);
        });
        form.addEventListener("reset", () => {
            setTimeout(() => {
                [name, email, msg].forEach(i => fieldError(i, ""));
                setText("ct-count", "0/1500");
                setText("ct-agree-error", "");
                syncTopic();
                syncDiag();
                prefill();
            }, 0);
        });

        form.addEventListener("submit", e => {
            e.preventDefault();
            let ok = true;
            if (name.value.trim().length < 2) { fieldError(name, "Как к вам обращаться?"); ok = false; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim())) { fieldError(email, "Нужен email, чтобы мы могли ответить"); ok = false; }
            if (msg.value.trim().length < 15) { fieldError(msg, "Опишите подробнее — хотя бы пару предложений"); ok = false; }
            if (!agree.checked) { setText("ct-agree-error", "Подтвердите, что прочитали политику конфиденциальности"); ok = false; }
            if (!ok) {
                Sound.play("denied");
                const bad = form.querySelector(".field.is-invalid .input");
                if (bad) bad.focus();
                return;
            }
            const topic = TOPICS[topicNow()];
            const projOpt = !$("#ct-project-field").hidden && project.value ? project.options[project.selectedIndex].text : "";
            const subject = `[${currentId}] ${topic.label}${projOpt ? " · " + projOpt : ""}`;
            const text = [
                `Обращение: ${currentId}`,
                `Тема: ${topic.label}`,
                projOpt ? `Проект: ${projOpt}` : "",
                `От: ${name.value.trim()} <${email.value.trim()}>`,
                "",
                msg.value.trim(),
                diag.checked ? "\n— Техническая информация —\n" + diagnostics() : ""
            ].filter((l, i) => l !== "" || i === 4).join("\n");
            openSendDialog({ id: currentId, topic: topicNow(), subject, text, project: project.value, emailAddr: email.value.trim() }, issuesUrl, () => {
                form.reset();
                currentId = ticketId();
                setText("ticket-preview", currentId);
            });
        });

        renderTickets();
        window.addEventListener("storage", e => { if (e.key === TICKETS_KEY) renderTickets(); });
        const list = $("#ticket-list");
        if (list) list.addEventListener("click", e => {
            if (!e.target.closest("[data-tickets-clear]")) return;
            NX.storage.remove(TICKETS_KEY);
            renderTickets();
            Sound.play("panels");
        });
    }

    function openSendDialog(t, issuesUrl, onSent) {
        const C = NX.SITE.contacts;
        const save = channel => {
            const list = NX.storage.getJSON(TICKETS_KEY, []);
            const arr = Array.isArray(list) ? list : [];
            arr.unshift({ id: t.id, topic: t.topic, project: t.project || "", date: Date.now(), channel });
            NX.storage.setJSON(TICKETS_KEY, arr.slice(0, 20));
            renderTickets();
            if (NX.Account && Auth.get()) NX.Account.notify("system", `Обращение ${t.id} создано`, `${TOPICS[t.topic].label} · ${channel}`, { toast: false, link: "contacts.html" });
            NX.Syslog.add(`support: обращение ${t.id} (${channel})`);
            onSent();
        };
        const buttons = [];
        if (C.email) buttons.push({
            label: "Отправить письмом", primary: true, icon: "mail", action: () => {
                const href = `mailto:${C.email}?subject=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.text)}`;
                window.location.href = href.length > 1900 ? `mailto:${C.email}?subject=${encodeURIComponent(t.subject)}` : href;
                if (href.length > 1900) { NX.copyText(t.text); toast("Текст длинный — он скопирован, вставьте его в письмо", "info", { ttl: 6000 }); }
                save("email");
                toast(`Обращение ${t.id} передано в почтовый клиент`, "ok");
            }
        });
        if (issuesUrl) buttons.push({
            label: "Создать issue на GitHub", primary: !C.email, icon: "github", action: () => {
                const url = `${issuesUrl}/new?title=${encodeURIComponent(t.subject)}&body=${encodeURIComponent(t.text.replace(/^От: .*$/m, "От: " + t.text.match(/^От: ([^<]*)/m)[1].trim()))}`;
                window.open(url, "_blank", "noopener");
                save("GitHub");
                toast(`Обращение ${t.id}: откройте вкладку GitHub и нажмите Submit`, "ok", { ttl: 6000 });
            }
        });
        buttons.push({
            label: "Скопировать текст", icon: "clipboard", action: () => {
                NX.copyText(t.text);
                toast("Текст обращения скопирован", "ok");
                return false;
            }
        });
        Modal.open({
            title: `Обращение ${escapeHtml(t.id)}`,
            subtitle: "готово к отправке",
            className: "send-modal",
            html: `
                <p>Проверьте текст и выберите, как отправить обращение.${C.email ? "" : " Сейчас обращения принимаются через GitHub Issues."}</p>
                ${issuesUrl ? '<p class="send-warn"><img src="assets/icons/alert.svg" alt="" width="14" height="14"> Issues на GitHub публичные: email из формы туда не попадёт, не добавляйте личные данные в текст.</p>' : ""}
                <pre class="send-preview">${escapeHtml(t.text)}</pre>`,
            buttons
        });
    }

    function renderTickets() {
        const list = $("#ticket-list");
        if (!list) return;
        const raw = NX.storage.getJSON(TICKETS_KEY, []);
        const arr = Array.isArray(raw) ? raw : [];
        setText("tickets-count", String(arr.length));
        list.innerHTML = arr.length ? arr.map(t => `
            <li>
                <b>${escapeHtml(t.id)}</b>
                <span>${escapeHtml((TOPICS[t.topic] || TOPICS.bug).label)} · ${escapeHtml(t.channel)}</span>
                <i>${escapeHtml(formatDate(t.date))}</i>
            </li>`).join("") + '<li class="ticket-clear"><button class="link-btn" type="button" data-tickets-clear>Очистить список</button></li>'
            : '<li class="muted">Здесь появятся номера ваших обращений — назовите номер, если будете писать повторно.</li>';
    }

    /* ================================================================
     * 404: путь, подсказки «возможно, вы искали»
     * ================================================================ */
    function levenshtein(a, b) {
        if (a === b) return 0;
        const m = a.length, n = b.length;
        if (!m) return n;
        if (!n) return m;
        let prev = Array.from({ length: n + 1 }, (_, j) => j);
        for (let i = 1; i <= m; i++) {
            const cur = [i];
            for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = cur;
        }
        return prev[n];
    }

    function init404() {
        // <base> указывает на корень сайта — якоря «#…» должны оставаться на этой странице
        $$('a[href^="#"]').forEach(a => { a.href = window.location.pathname + window.location.search + a.getAttribute("href"); });

        // 404.html?path=/foo — проверка страницы без сервера (file://) или команда терминала «404»
        const askedPath = new URLSearchParams(window.location.search).get("path");
        let path;
        if (askedPath) {
            path = (askedPath.charAt(0) === "/" ? "" : "/") + askedPath;
        } else {
            path = window.location.pathname;
            try { path = decodeURIComponent(path); } catch (e) { /* ignore */ }
            if (window.location.protocol === "file:") path = "/" + path.split("/").pop();
            path += window.location.search;
        }
        path = path.slice(0, 80);
        setText("nf-path", path);
        setText("nf-path2", path);
        NX.Syslog.add(`http: 404 ${path}`);

        const PAGES_IDX = [
            { keys: ["index", "home", "main", "glavnaya", "start"], href: "index.html", label: "Главная" },
            { keys: ["projects", "project", "builds", "downloads", "games", "catalog", "proekty"], href: "projects.html", label: "Проекты и сборки" },
            { keys: ["dashboard", "cabinet", "kabinet", "account", "profile", "lk"], href: "dashboard.html", label: "Личный кабинет" },
            { keys: ["wallet", "balance", "topup", "pay", "billing"], href: "dashboard.html#wallet", label: "Кабинет → Кошелёк" },
            { keys: ["security", "2fa", "password"], href: "dashboard.html#security", label: "Кабинет → Безопасность" },
            { keys: ["subscription", "plus", "donate", "support-project"], href: "dashboard.html#plus", label: "Кабинет → Подписка и поддержка" },
            { keys: ["auth", "login", "signin", "register", "signup", "vhod"], href: "auth.html", label: "Вход и регистрация" },
            { keys: ["privacy", "policy", "gdpr", "cookies", "data"], href: "privacy.html", label: "Политика конфиденциальности" },
            { keys: ["contacts", "contact", "support", "help", "about", "feedback"], href: "contacts.html", label: "Контакты" }
        ];
        PROJECTS.forEach(p => PAGES_IDX.push({ keys: [p.id, p.title.toLowerCase().replace(/[^a-z0-9а-яё]+/g, "")], href: "projects.html#" + p.id, label: `Проект ${p.title}` }));

        const tokens = path.toLowerCase().replace(/\.html?$/, "").split(/[\/\-_.?=&#\s]+/).filter(t => t.length >= 2 && t !== "123");
        const scored = [];
        PAGES_IDX.forEach(pg => {
            let best = Infinity;
            tokens.forEach(t => pg.keys.forEach(k => {
                if (!k) return;
                if (k === t) best = Math.min(best, 0);
                else if (k.length >= 4 && (k.includes(t) && t.length >= 4 || t.includes(k))) best = Math.min(best, 0.5);
                else {
                    const d = levenshtein(t, k);
                    if (d <= Math.max(1, Math.floor(k.length * 0.34))) best = Math.min(best, d);
                }
            }));
            if (best < Infinity) scored.push({ pg, best });
        });
        const seen = new Set();
        const top = scored.sort((a, b) => a.best - b.best).filter(x => !seen.has(x.pg.href) && seen.add(x.pg.href)).slice(0, 4);
        if (top.length) {
            $("#nf-suggest").hidden = false;
            $("#nf-links").innerHTML = top.map(x => `<li><a href="${escapeHtml(x.pg.href)}"><span class="prompt-sign">&gt;</span> ${escapeHtml(x.pg.label)}</a></li>`).join("");
        }

        const back = $("#nf-back");
        if (back) back.addEventListener("click", () => {
            if (document.referrer && window.history.length > 1) window.history.back();
            else window.location.href = "index.html";
        });
        setTimeout(() => Sound.play("denied"), 400);
    }

    if (PAGE === "projects") initProjects();
    if (PAGE === "dashboard") { initDashboard(); initSessionClock(); }
    if (PAGE === "auth") initAuth();
    if (PAGE === "privacy") initPrivacy();
    if (PAGE === "contacts") initContacts();
    if (PAGE === "404") init404();

    // Смена цветовой схемы: перерисовать canvas-аватары (они рисуются один раз)
    document.addEventListener("nexus:theme", () => {
        $$("canvas[data-avatar-seed]").forEach(c => drawAvatar(c, c.getAttribute("data-avatar-seed")));
    });

    NX.Pages = { goTab, openTopup, runPayment, openDetails, openEditor, openSections, confirmDelete, drawAvatar, Downloads, textToNotes, notesToText, compressImage };
})();
