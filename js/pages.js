/*
 * pages.js — логика страниц NEXUS//DEV
 * ------------------------------------------------------------------
 * Подключается на всех страницах после js/ui-effects.js и использует
 * его API (window.NEXUS). Страница определяется по <body data-page>:
 *   home      — index.html      (флагман, Minecraft, прогресс-бары)
 *   projects  — projects.html   (фильтр, карточки, досье)
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
        statusBadge, formatPlayers, PROJECTS, CATEGORIES, observeReveal, reducedMotion, NICKS } = NX;

    const PAGE = NX.PAGE;

    /* ================================================================
     * Общее для всех страниц
     * ================================================================ */

    /* Прогресс-бары заполняются, когда попадают в зону видимости */
    function initProgressBars(root) {
        const bars = $$(".progress-fill[data-progress]:not(.is-set)", root);
        const fill = el => {
            el.classList.add("is-set");
            el.style.width = clamp(parseFloat(el.getAttribute("data-progress")) || 0, 0, 100) + "%";
        };
        if (!("IntersectionObserver" in window) || reducedMotion()) {
            bars.forEach(fill);
            return;
        }
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (en.isIntersecting) { fill(en.target); io.unobserve(en.target); }
            });
        }, { threshold: 0.3 });
        bars.forEach(b => io.observe(b));
    }

    function progressHtml(value, label, large) {
        return `<div class="progress${large ? " progress-lg" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-label="${escapeHtml(label || "Готовность")}">
            <span>${escapeHtml(label || "READY")}</span>
            <span class="progress-track"><span class="progress-fill" data-progress="${value}"></span></span>
            <span class="progress-val">${value}%</span>
        </div>`;
    }

    /* Счётчик серверов в шапке + живые данные серверов в карточках главной */
    function initServerBindings() {
        const head = $("#header-servers");
        const render = () => {
            const s = Telemetry.summary();
            if (head) head.textContent = `${s.online}/${s.total}`;
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
        ctx.fillStyle = "#090B0A";
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
     * Главная
     * ================================================================ */
    function initHome() {
        // Быстрая «постройка» по клавишам F1–F6 на клавиатуре
        const caps = $$("#key-row .keycap");
        if (caps.length) {
            document.addEventListener("keydown", e => {
                if (e.target.closest("input, textarea, select") || Modal.current) return;
                const m = /^F([1-6])$/.exec(e.key);
                if (!m) return;
                const cap = caps[parseInt(m[1], 10) - 1];
                const row = $("#key-row");
                if (!cap || !row) return;
                const r = row.getBoundingClientRect();
                if (r.bottom < 0 || r.top > window.innerHeight) return;
                e.preventDefault();
                cap.click();
            });
        }
    }

    /* ================================================================
     * Проекты
     * ================================================================ */
    function canDownload(p, s) {
        if (!s) return false;
        const need = p.category === "ue5" ? 3 : 2;
        return s.level >= need;
    }

    function projectCard(p) {
        const wrap = document.createElement("div");
        wrap.className = "card-wrap glow on-scroll";
        wrap.setAttribute("data-category", p.category);
        wrap.id = "project-" + p.id;
        const statusClass = p.status === "LIVE" ? " is-live" : (/PRE|DEV|PROGRESS/.test(p.status) ? " is-pre" : "");
        wrap.innerHTML = `
            <article class="card aug-card project-card${p.flagship ? " is-flagship" : ""}" augmented-ui="tl-clip br-clip exe" aria-labelledby="ptitle-${p.id}">
                <header class="card-head">
                    <img src="assets/icons/${p.icon}.svg" alt="" width="34" height="34">
                    <span class="card-id">${escapeHtml(p.code)}</span>
                </header>
                <div class="card-cat">
                    <span>${escapeHtml(CATEGORIES[p.category])}</span>
                    <span class="status-chip${statusClass}">${escapeHtml(p.status)}</span>
                    ${p.flagship ? '<span class="flagship-ribbon">FLAGSHIP</span>' : ""}
                </div>
                <h3 id="ptitle-${p.id}">${escapeHtml(p.title)}</h3>
                <p class="summary">${escapeHtml(p.summary)}</p>
                ${progressHtml(p.progress, "READY")}
                <div>
                    <p class="sub-label">Tech stack</p>
                    <ul class="chips">${p.stack.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
                </div>
                <div>
                    <p class="sub-label">Ключевые механики</p>
                    <ul class="mech-list">${p.mechanics.slice(0, 4).map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
                </div>
                <footer class="card-actions">
                    <a class="btn" href="#dossier-${p.id}" data-dossier="${p.id}">
                        <img src="assets/icons/archive.svg" alt="" width="18" height="18">
                        ОТКРЫТЬ ДОСЬЕ
                    </a>
                </footer>
            </article>`;
        return wrap;
    }

    function openDossier(id, fromHash) {
        const p = PROJECTS.find(x => x.id === id);
        if (!p) return false;
        const s = Auth.get();
        const allowed = canDownload(p, s);
        const b = p.build;
        const statusClass = p.status === "LIVE" ? " is-live" : (/PRE|DEV|PROGRESS/.test(p.status) ? " is-pre" : "");
        const html = `
            <div class="dossier-head">
                <div>
                    <p class="sub-label">${escapeHtml(p.code)} · ${escapeHtml(CATEGORIES[p.category])}</p>
                    <p class="flagship-sub" style="margin:0">${escapeHtml(p.summary)}</p>
                </div>
                <span class="dossier-stamp${statusClass}">${escapeHtml(p.status)}</span>
                ${progressHtml(p.progress, "READY", true)}
            </div>
            <div class="dossier-grid">
                <div>
                    <h5>Текущая сборка</h5>
                    <table class="edex-table">
                        <tbody>
                            <tr><td>Версия</td><td>${escapeHtml(b.version)}</td></tr>
                            <tr><td>Движок</td><td>${escapeHtml(b.engine)}</td></tr>
                            <tr><td>Платформа</td><td>${escapeHtml(b.platform)}</td></tr>
                            <tr><td>Дата сборки</td><td>${escapeHtml(b.date)}</td></tr>
                            <tr><td>Размер</td><td>${escapeHtml(b.size)}</td></tr>
                            <tr><td>Ветка</td><td>${escapeHtml(b.branch)}</td></tr>
                        </tbody>
                    </table>
                </div>
                <div>
                    <h5>Ключевые механики</h5>
                    <ul class="mech-list">${p.mechanics.map(m => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
                    <h5>Tech stack</h5>
                    <ul class="chips">${p.stack.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
                </div>
                <div class="full">
                    <h5>Описание сборки</h5>
                    <p>${escapeHtml(p.description)}</p>
                    ${p.faction ? `<p><b>Фракция:</b> ${escapeHtml(p.faction)}</p>` : ""}
                </div>
                <div>
                    <h5>Changelog</h5>
                    <ul class="log">${p.changelog.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
                </div>
                <div>
                    <h5>Известные проблемы</h5>
                    <ul class="log">${p.issues.map(c => `<li>${escapeHtml(c)}</li>`).join("")}</ul>
                </div>
                <div class="full">
                    <p class="dossier-lock">${allowed
                        ? `Допуск подтверждён: LEVEL ${s.level} // ${escapeHtml(Auth.levelName(s.level))}. Сборка доступна в кабинете.`
                        : (s ? `Для загрузки нужен уровень допуска ${p.category === "ue5" ? "3 (PLAYTESTER)" : "2 (MEMBER)"}. Ваш уровень: ${s.level}.`
                            : "Загрузка сборок доступна после входа. Демо-доступ: страница входа → DEMO ACCESS.")}</p>
                </div>
            </div>`;
        const buttons = [];
        if (allowed) {
            buttons.push({
                label: "Скачать сборку", primary: true, action: () => {
                    queueDownload(p);
                    window.location.href = "dashboard.html#profile";
                }
            });
        } else {
            buttons.push({ label: s ? "Открыть кабинет" : "Войти для загрузки", primary: true, href: s ? "dashboard.html" : "auth.html" });
        }
        Modal.open({
            title: escapeHtml(p.title),
            subtitle: "ДОСЬЕ // " + escapeHtml(p.code),
            html,
            className: "dossier",
            buttons,
            onClose: () => {
                if (window.location.hash === "#dossier-" + p.id && window.history.replaceState) {
                    window.history.replaceState(null, "", window.location.pathname + window.location.search);
                }
            }
        });
        initProgressBars($(".modal_popup.dossier"));
        if (!fromHash && window.history.replaceState) {
            window.history.replaceState(null, "", "#dossier-" + p.id);
        }
        return true;
    }

    /* Загрузка, поставленная в очередь из досье, — выполнится в кабинете */
    function queueDownload(p) {
        NX.storage.set("nx_pending_dl", p.id);
    }

    function initProjects() {
        const grid = $("#project-grid");
        const tabs = $$("#filter-tabs [data-filter]");
        const info = $("#filter-info");
        if (!grid) return;

        grid.innerHTML = "";
        PROJECTS.forEach(p => grid.appendChild(projectCard(p)));
        observeReveal(grid);
        initProgressBars(grid);

        const counts = { all: PROJECTS.length };
        PROJECTS.forEach(p => { counts[p.category] = (counts[p.category] || 0) + 1; });
        tabs.forEach(t => {
            const c = t.querySelector(".count");
            if (c) c.textContent = String(counts[t.getAttribute("data-filter")] || 0);
        });

        const apply = (filter, silent) => {
            let shown = 0;
            tabs.forEach(t => {
                const on = t.getAttribute("data-filter") === filter;
                t.setAttribute("aria-pressed", String(on));
                t.parentElement.classList.toggle("active", on);
            });
            $$(".card-wrap", grid).forEach(card => {
                const match = filter === "all" || card.getAttribute("data-category") === filter;
                if (match) {
                    const wasHidden = card.hidden;
                    card.hidden = false;
                    shown++;
                    if (wasHidden && !reducedMotion()) {
                        card.classList.remove("is-entering");
                        void card.offsetWidth;
                        card.classList.add("is-entering");
                    }
                    card.classList.add("is-visible");
                } else {
                    card.hidden = true;
                }
            });
            if (info) {
                info.textContent = `> ls /projects${filter === "all" ? "" : "/" + filter} — ${shown} записей`;
            }
            initProgressBars(grid);
            if (!silent) Sound.play("folder");
            NX.storage.set("nx_filter", filter);
        };

        tabs.forEach(t => t.addEventListener("click", () => apply(t.getAttribute("data-filter"))));

        grid.addEventListener("click", e => {
            const btn = e.target.closest("[data-dossier]");
            if (!btn) return;
            e.preventDefault();
            openDossier(btn.getAttribute("data-dossier"));
        });

        const fromHash = () => {
            const h = window.location.hash.replace("#", "");
            if (h.indexOf("dossier-") === 0) {
                const id = h.slice(8);
                const p = PROJECTS.find(x => x.id === id);
                if (p) {
                    const card = document.getElementById("project-" + id);
                    if (card) card.scrollIntoView({ block: "center" });
                    openDossier(id, true);
                }
            } else if (h.indexOf("filter-") === 0) {
                const f = h.slice(7);
                if (f === "all" || CATEGORIES[f]) apply(f, true);
            }
        };

        const saved = NX.storage.get("nx_filter", "all");
        apply(saved === "all" || CATEGORIES[saved] ? saved : "all", true);
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

    const BUILDS = [
        { id: "fortify", name: "FORTIFY MOD", level: 2 },
        { id: "nexuscraft", name: "NEXUS CRAFT modpack", level: 2 },
        { id: "nexustech", name: "NEXUS TECH (dev)", level: 2 },
        { id: "bastion", name: "BASTION: LINE ZERO", level: 3 },
        { id: "trenchworks", name: "TRENCHWORKS plugin", level: 4 }
    ];

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
            });
        }

        let started = false;
        const start = () => {
            const s = Auth.get();
            if (!s) { showLocked(); return; }
            lock.hidden = true;
            app.hidden = false;
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
                const b = BUILDS.find(x => x.id === pending);
                const btn = b && $(`[data-build="${b.id}"]`);
                if (btn) setTimeout(() => btn.click(), 500);
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
            wrap.innerHTML = BUILDS.map(b => {
                const p = PROJECTS.find(x => x.id === b.id);
                const ok = s.level >= b.level;
                return `<tr>
                    <td data-label="Сборка"><b>${escapeHtml(b.name)}</b><br><span class="muted">${escapeHtml(p.build.version)}</span></td>
                    <td data-label="Размер">${escapeHtml(p.build.size)}</td>
                    <td data-label="Допуск">L${b.level}</td>
                    <td data-label="Действие">${ok
                        ? `<button class="btn btn-sm" type="button" data-build="${b.id}"><img src="assets/icons/upload.svg" alt="" width="14" height="14" style="transform:rotate(180deg)">Скачать</button>`
                        : `<span class="access-no">LOCKED</span>`}</td>
                </tr>`;
            }).join("");
        };
        render();

        wrap.addEventListener("click", async e => {
            const btn = e.target.closest("[data-build]");
            if (!btn || btn.classList.contains("is-busy")) return;
            const b = BUILDS.find(x => x.id === btn.getAttribute("data-build"));
            const p = PROJECTS.find(x => x.id === b.id);
            const s = Auth.get();
            if (!s || s.level < b.level) { Sound.play("denied"); toast("ACCESS DENIED: недостаточный уровень допуска", "warn"); return; }
            btn.classList.add("is-busy");
            Sound.play("expand");
            const label = btn.lastChild;
            for (let pct = 0; pct <= 100; pct += randInt(9, 22)) {
                label.textContent = ` ${Math.min(99, pct)}%`;
                Sound.play("stdout");
                await delay(reducedMotion() ? 30 : randInt(120, 260));
            }
            label.textContent = " Проверка SHA…";
            await delay(reducedMotion() ? 50 : 500);
            const sha = (hashString(p.build.version + Date.now()) >>> 0).toString(16).padStart(8, "0");
            Auth.addDownload({ build: p.title, version: p.build.version, date: Date.now(), size: p.build.size, sha, status: "VERIFIED" });
            renderDownloads(true);
            btn.classList.remove("is-busy");
            label.textContent = " Готово";
            Sound.play("granted");
            toast(`${p.title} ${p.build.version}: загрузка завершена (демо), SHA ${sha}`, "ok");
            NX.Syslog.add(`downloads: ${Auth.get().callsign} fetched ${p.title} ${p.build.version}`);
            setTimeout(() => { label.textContent = "Скачать"; }, 2200);
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
                if (map[id] === "sfx") Sound.set(el.checked);
                else Settings.set(map[id], el.checked);
                Sound.play("folder");
                toast(`HUD: ${el.getAttribute("data-name")} — ${el.checked ? "ON" : "OFF"}`);
            });
        });
        const scale = document.getElementById("set-scale");
        if (scale) scale.addEventListener("change", () => {
            Settings.set("scale", scale.value);
            Sound.play("folder");
            toast(`HUD: масштаб — ${scale.options[scale.selectedIndex].text}`);
        });
        const reset = document.getElementById("set-reset");
        if (reset) reset.addEventListener("click", () => {
            Settings.reset();
            Sound.syncUI();
            sync();
            toast("Настройки HUD сброшены");
        });
        const replay = document.getElementById("set-replay");
        if (replay) replay.addEventListener("click", () => {
            try { window.sessionStorage.removeItem("nx_booted"); } catch (e) { /* ignore */ }
            Settings.set("intro", true);
            window.location.href = "index.html";
        });
        document.addEventListener("nexus:settings", sync);

        const avatarBtn = $("#avatar-regen");
        if (avatarBtn) avatarBtn.addEventListener("click", () => {
            const s = Auth.get();
            if (!s) return;
            Auth.update({ avatarSeed: (s.avatarSeed || 0) + 1 });
            renderProfile();
            Sound.play("granted");
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
    initProgressBars();
    if (PAGE === "home") initHome();
    if (PAGE === "projects") initProjects();
    if (PAGE === "dashboard") { initDashboard(); initSessionClock(); }
    if (PAGE === "auth") initAuth();

    NX.Pages = { openDossier, drawAvatar };
})();
