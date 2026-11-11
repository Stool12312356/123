/*
 * services.js — тестовые сервисы NEXUS: VPN-клиент (vpn.html) и IDE (ide.html)
 * ------------------------------------------------------------------
 * Подключается после js/ui-effects.js и js/pages.js. Данные и правила
 * доступа (тарифы FREE / NEXUS+, роль CREATOR) — в window.NEXUS.VPN и
 * window.NEXUS.IDEStore, поэтому кабинет видит то же состояние.
 *
 * VPN — симуляция: туннель, IP выхода, скорость и утечки моделируются
 * в браузере, реальный трафик не шифруется и никуда не перенаправляется.
 * IDE — код выполняется только в iframe с sandbox="allow-scripts" (без
 * allow-same-origin): у него нет доступа к странице, cookie и localStorage сайта.
 * ------------------------------------------------------------------
 */
(function () {
    "use strict";

    const NX = window.NEXUS;
    if (!NX) return;
    const PAGE = NX.PAGE;
    if (PAGE !== "vpn" && PAGE !== "ide") return;

    const { $, $$, clamp, rand, randInt, pick, delay, escapeHtml, timeStr, hashString,
        Auth, Account, VPN, IDEStore, Sound, toast, Modal, showBanner, reducedMotion,
        formatBytes, formatDuration, serviceTier, serviceLimits, copyText } = NX;

    /* ================================================================
     * Общее: доступ только после входа
     * ================================================================ */
    function downloadBlob(name, blob) {
        try {
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
    function plural(n, one, few, many) {
        const m10 = n % 10, m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
        return many;
    }
    function ago(ts) {
        const d = Math.max(0, Date.now() - ts) / 1000;
        if (d < 50) return "только что";
        if (d < 3600) { const m = Math.round(d / 60); return `${m} ${plural(m, "минуту", "минуты", "минут")} назад`; }
        if (d < 86400) { const h = Math.round(d / 3600); return `${h} ${plural(h, "час", "часа", "часов")} назад`; }
        const days = Math.round(d / 86400);
        return `${days} ${plural(days, "день", "дня", "дней")} назад`;
    }
    function planModal(title, text) {
        Modal.open({
            title,
            subtitle: "NEXUS+",
            className: "svc-modal",
            html: `<p>${text}</p>
                <ul class="svc-perks">
                    <li>20 локаций VPN и Secure Core (двойной хоп)</li>
                    <li>VPN без лимита трафика</li>
                    <li>25 проектов в NEXUS IDE, до 1 МБ каждый</li>
                </ul>
                <p class="svc-muted">Подписка оформляется с баланса NEXUS ID в разделе «Подписка и поддержка» (тестовые платежи).</p>`,
            buttons: [{ label: "Оформить NEXUS+", icon: "star", primary: true, href: "dashboard.html#plus" }]
        });
    }

    function gate(start) {
        const lock = $("#svc-lock");
        const app = $(PAGE === "vpn" ? "#vpn-app" : "#ide-app");
        if (!lock || !app) return;
        let userId = null;
        const update = () => {
            const s = Auth.get();
            lock.hidden = !!s;
            app.hidden = !s;
            if (!s) return;
            // Сменился пользователь (вход в другой аккаунт в соседней вкладке) — начать с чистого листа
            if (userId && userId !== s.id) { window.location.reload(); return; }
            if (!userId) { userId = s.id; start(s); }
        };
        const demo = $("#svc-demo");
        if (demo) {
            demo.addEventListener("click", async () => {
                demo.classList.add("is-busy");
                Auth.login({ callsign: "demo_operator", role: "user", demo: true, remember: true });
                await showBanner("ACCESS GRANTED", { sub: "NEXUS ID · DEMO" });
                demo.classList.remove("is-busy");
                update();
                toast("Вход выполнен: демо-аккаунт demo_operator", "ok", { ttl: 4000 });
            });
        }
        document.addEventListener("nexus:auth", update);
        update();
    }

    /* ================================================================
     * NEXUS VPN
     * ================================================================ */
    /* Карта суши 144×56 (шаг 2,5°, широты +84…−56), по 4 клетки на hex-символ */
    const LAND = [
        "0000000001fe03fe00000000000000000000",
        "000000003ff7ffffc000c000000600000000",
        "000000114f8fffff000700000000c0000000",
        "0000016a9000ffff00000001801ff8018000",
        "000003fcef803ffe0000000408fffff0c000",
        "01f8007e77f83ffe0000f8001fffffffff00",
        "c3fffffffe1e1fe00003ff1fffffffffffff",
        "67fffffffe7e1f01c007fcffffffffffffff",
        "03ffffffe04c0e00003f7fffffffffffffff",
        "03ffffffc0700200003e7ffffffffffffce8",
        "00607fffe07e000002167fffffffffff0180",
        "00001ffffe7f00000618fffffffffffe0380",
        "00000ffffeffc0000f3fffffffffffff8300",
        "000007ffffff400001ffffffffffffff4000",
        "000003fffffce00003ffffffffffffff0000",
        "000003ffffff000001fff5fffffffffe0000",
        "000003fffff000000fcde0fffffffff8c000",
        "000003ffffe000000f12fffffffffff08000",
        "000001ffffc000000f045fffffffff318000",
        "000001ffff80000007f003ffffffff170000",
        "0000007fff0000000ffc83ffffffff880000",
        "0000001fff0000000fffffffffffff800000",
        "0000003f810000001ffffff7ffffff000000",
        "00000017800000003ffffdfaffffff000000",
        "00000007800000007fffffff0ffffc000000",
        "00000003884000007ffffefe07e7e0000000",
        "00000001f80000007ffffe7c0783e0800000",
        "000000001c0000007fffff780701f0800000",
        "00000000060000007fffffc00301f0000000",
        "00000000023e00003ffffff0030020400000",
        "00000000017f00001ffffff0008000600000",
        "00000000007fe0000f3fffe0000282000000",
        "00000000007ff000000fffe00001c6000000",
        "0000000000fff000000fff800000ce000000",
        "0000000000fffc00000fff000000ce850000",
        "0000000001ffff800007ff0000004003c000",
        "0000000000ffffc00007ff0000001801e000",
        "00000000007fffc00007ff00000000001000",
        "00000000007fff800007ff000000000c0000",
        "00000000003fff000007ff100000002c4000",
        "00000000001fff000007ff300000007fc000",
        "00000000000fff000007fc30000000ffe000",
        "00000000000ffe000003fc60000003fff000",
        "00000000000ff8000003fc20000007fff800",
        "00000000000ff8000003f800000003fff800",
        "00000000001ff0000001f800000003fff800",
        "00000000001fe0000001f000000003e7f800",
        "00000000001fc0000000000000000301f000",
        "00000000001f80000000000000000000f002",
        "00000000001e000000000000000000000002",
        "00000000003c00000000000000000000200c",
        "00000000003c000000000000000000000018",
        "00000000003c000000000000000000000000",
        "000000000038000000000000000000000000",
        "000000000018800000000000000000000000",
        "000000000008000000000000000000000000"
    ];

    const vs = {
        flow: 0, connecting: null, dropping: false, selected: null,
        filter: "all", sort: "ping", query: "",
        log: [], down: [], up: [], rate: { down: 0, up: 0, target: 0 },
        ping: 0, speedRunning: false, leakRunning: false, hover: null, mouse: null,
        listKey: "", userId: null
    };

    function initVPN(session) {
        vs.userId = session.id;
        const el = {
            mod: $("#vpn-power-mod"), power: $("#vpn-power"), label: $("#vpn-power-label"),
            state: $("#vpn-state"), sub: $("#vpn-sub"), shellState: $("#vpn-shell-state"),
            list: $("#vpn-servers"), search: $("#vpn-search"), sort: $("#vpn-sort"), count: $("#vpn-count"),
            log: $("#vpn-log"), logCount: $("#vpn-log-count"), history: $("#vpn-history")
        };
        for (let i = 0; i < 56; i++) vs.down.push(0), vs.up.push(0);

        /* ----- Журнал туннеля ----- */
        function log(text, tone) {
            vs.log.push({ t: timeStr(new Date()), text, tone: tone || "" });
            if (vs.log.length > 80) vs.log.shift();
            const li = document.createElement("li");
            if (tone) li.className = "is-" + tone;
            li.innerHTML = `<time>${escapeHtml(vs.log[vs.log.length - 1].t)}</time><span>${escapeHtml(text)}</span>`;
            el.log.appendChild(li);
            while (el.log.children.length > 80) el.log.firstChild.remove();
            el.log.scrollTop = el.log.scrollHeight;
            el.logCount.textContent = String(vs.log.length);
            if (tone !== "quiet") Sound.play("stdout");
        }

        /* ----- Основная отрисовка состояния ----- */
        function render() {
            const st = VPN.get();
            if (!st) return;
            const srv = st.connected ? VPN.find(st.server) : null;
            const entry = st.entry ? VPN.find(st.entry) : null;
            const connecting = vs.connecting ? VPN.find(vs.connecting) : null;
            const mode = vs.dropping ? "drop" : connecting ? "connecting" : srv ? "on" : "off";
            el.mod.setAttribute("data-state", mode);
            document.body.setAttribute("data-vpn", mode);
            el.power.setAttribute("aria-pressed", srv ? "true" : "false");
            el.label.textContent = { off: "ПОДКЛЮЧИТЬ", connecting: "ОТМЕНА", on: "ОТКЛЮЧИТЬ", drop: "ЖДИТЕ…" }[mode];
            el.power.setAttribute("aria-label", { off: "Подключить VPN", connecting: "Отменить подключение", on: "Отключить VPN", drop: "Восстановление туннеля" }[mode]);
            el.state.textContent = { off: "НЕ ЗАЩИЩЕНО", connecting: "ПОДКЛЮЧЕНИЕ…", on: "ЗАЩИЩЕНО", drop: "ПЕРЕПОДКЛЮЧЕНИЕ…" }[mode];
            if (mode === "off") {
                const last = st.lastServer && VPN.find(st.lastServer);
                const target = vs.selected ? VPN.find(vs.selected) : (last && VPN.canUse(last).ok ? last : null);
                el.sub.textContent = target ? `Нажмите, чтобы подключиться: ${target.city}, ${target.country}` : "Нажмите, чтобы подключиться к самому быстрому серверу";
            } else if (mode === "on") {
                el.sub.textContent = `${srv.city}, ${srv.country}${entry ? ` · через Secure Core ${entry.city}` : ""}`;
            } else if (mode === "connecting") {
                if (!el.sub.dataset.step) el.sub.textContent = `${connecting.city}, ${connecting.country}…`;
            }
            el.shellState.textContent = { off: "OFFLINE", connecting: "HANDSHAKE", on: `SECURED · ${srv ? srv.cc : ""}`, drop: "LINK LOST" }[mode];
            $("#vpn-session-label").textContent = mode === "on" ? VPN.PROTOCOLS[st.protocol].label : mode;

            const proto = VPN.PROTOCOLS[st.protocol];
            setText("vpn-f-server", srv ? `${srv.city}, ${srv.cc}${entry ? " ← " + entry.cc : ""}` : "—");
            setText("vpn-f-ip", srv ? VPN.exitIp(srv, st) : "реальный");
            setText("vpn-f-vip", srv ? VPN.virtualIp(vs.userId) : "—");
            setText("vpn-f-cipher", srv ? proto.cipher : "—");
            if (!srv) { setText("vpn-f-uptime", "0:00:00"); setText("vpn-f-ping", "—"); }

            $$("input[name='vpn-proto']").forEach(r => { r.checked = r.value === st.protocol; });
            $("#vpn-opt-kill").checked = !!st.killSwitch;
            $("#vpn-opt-adblock").checked = !!st.adblock;
            $("#vpn-opt-auto").checked = !!st.autoConnect;
            $("#vpn-opt-multihop").checked = !!st.multihop && VPN.isPro();
            const pk = $("#vpn-pubkey");
            if (pk) pk.textContent = st.keys ? st.keys.pub : "ещё не создан";
            renderQuota(st);
            renderList();
            renderHistory(st);
            drawMap();
        }
        function setText(id, v) {
            const n = document.getElementById(id);
            if (n && n.textContent !== v) n.textContent = v;
        }
        function renderQuota(st) {
            const q = VPN.quota(st);
            const lim = isFinite(q.limit);
            setText("vpn-quota-label", lim ? `${formatBytes(q.limit)} / месяц` : "без лимита · NEXUS+");
            setText("vpn-quota-text", lim ? `${formatBytes(q.used)} использовано · осталось ${formatBytes(q.left)}` : `${formatBytes(q.used)} за месяц`);
            const bar = $("#vpn-quota-bar");
            if (bar) { bar.style.width = (lim ? q.pct : 100) + "%"; bar.classList.toggle("is-warn", lim && q.pct > 85); bar.classList.toggle("is-free", !lim); }
        }

        /* ----- Список серверов ----- */
        function filtered() {
            const st = VPN.get();
            const q = vs.query.trim().toLowerCase();
            let list = VPN.SERVERS.filter(s => {
                if (q && (s.city + " " + s.country + " " + s.cc).toLowerCase().indexOf(q) < 0) return false;
                if (vs.filter === "fav") return st.favorites.indexOf(s.id) >= 0;
                if (vs.filter === "free") return s.tier === "free";
                if (vs.filter === "all") return true;
                return s.tags.indexOf(vs.filter) >= 0;
            });
            const by = {
                ping: (a, b) => VPN.ping(a, st.protocol) - VPN.ping(b, st.protocol),
                load: (a, b) => VPN.load(a) - VPN.load(b),
                name: (a, b) => a.city.localeCompare(b.city, "ru")
            }[vs.sort];
            list.sort(by);
            return list;
        }
        function renderList(force) {
            const st = VPN.get();
            const list = filtered();
            const tick = Math.floor(Date.now() / 10000);
            const key = JSON.stringify([list.map(s => s.id), st.server, st.favorites, vs.connecting, vs.selected, st.protocol, serviceTier(), tick]);
            if (!force && key === vs.listKey) return;
            vs.listKey = key;
            const focusId = document.activeElement && el.list.contains(document.activeElement) ? document.activeElement.getAttribute("data-connect") || ("fav:" + document.activeElement.getAttribute("data-fav")) : null;
            el.count.textContent = `${list.length} ${plural(list.length, "сервер", "сервера", "серверов")}`;
            el.list.innerHTML = list.length ? list.map(s => {
                const can = VPN.canUse(s).ok;
                const load = VPN.load(s);
                const fav = st.favorites.indexOf(s.id) >= 0;
                const active = st.connected && st.server === s.id;
                const cls = ["vpn-srv", can ? "" : "is-locked", active ? "is-active" : "", vs.connecting === s.id ? "is-connecting" : "", vs.selected === s.id ? "is-selected" : ""].join(" ").trim();
                const tags = s.tags.map(t => VPN.TAGS[t]).join(" · ");
                return `<li class="${cls}">
                    <button class="vpn-srv-main" type="button" data-connect="${s.id}" aria-label="${escapeHtml((active ? "Подключено: " : can ? "Подключиться: " : "Нужен NEXUS+: ") + s.city + ", " + s.country)}">
                        <span class="vpn-cc">${s.cc}</span>
                        <span class="vpn-srv-name"><b>${escapeHtml(s.city)}</b><i>${escapeHtml(s.country)}${tags ? " · " + escapeHtml(tags) : ""}</i></span>
                        <span class="vpn-srv-load" title="Загрузка ${load}%"><i style="width:${load}%" class="${load > 80 ? "is-high" : ""}"></i></span>
                        <span class="vpn-srv-ping">${can ? VPN.ping(s, st.protocol) + " ms" : '<em class="pro-chip">NEXUS+</em>'}</span>
                    </button>
                    <button class="vpn-fav${fav ? " is-on" : ""}" type="button" data-fav="${s.id}" aria-pressed="${fav}" aria-label="${fav ? "Убрать из избранного" : "В избранное"}: ${escapeHtml(s.city)}">★</button>
                </li>`;
            }).join("") : '<li class="vpn-empty">Ничего не найдено</li>';
            if (focusId) {
                const f = focusId.indexOf("fav:") === 0 ? el.list.querySelector(`[data-fav="${focusId.slice(4)}"]`) : el.list.querySelector(`[data-connect="${focusId}"]`);
                if (f) f.focus({ preventScroll: true });
            }
        }
        function renderHistory(st) {
            const why = { quota: "лимит трафика", plan: "нет доступа", switch: "смена сервера", terminal: "из терминала" };
            el.history.innerHTML = st.history.length ? st.history.slice(0, 6).map(h => {
                const s = VPN.find(h.server);
                return `<li><img src="assets/icons/shield.svg" alt="" width="16" height="16">
                    <span class="feed-text"><b>${escapeHtml(s ? s.city + ", " + s.cc : h.server)}</b><i>${escapeHtml(formatDuration(h.end - h.start))}${why[h.reason] ? " · " + why[h.reason] : ""} · ${escapeHtml(ago(h.end))}</i></span>
                    <span class="feed-amount">${escapeHtml(formatBytes(h.bytes))}</span></li>`;
            }).join("") : '<li class="feed-empty">Сеансов пока нет</li>';
        }

        /* ----- Подключение / отключение ----- */
        function denied(res, srv) {
            Sound.play("denied");
            if (res.reason === "plan") {
                planModal(`${srv.city}: нужна подписка`, `Сервер <b>${escapeHtml(srv.city)}, ${escapeHtml(srv.country)}</b> входит в NEXUS+. На тарифе FREE доступны Амстердам, Франкфурт и Нью-Йорк.`);
            } else if (res.reason === "quota") {
                planModal("Лимит трафика исчерпан", `На тарифе FREE доступно ${formatBytes(serviceLimits().vpnData)} в месяц. Счётчик обнулится 1-го числа, а с NEXUS+ лимита нет.`);
            } else {
                toast(res.text || "Не удалось подключиться", "warn");
            }
        }
        async function connectFlow(serverId, reason) {
            const st = VPN.get();
            const srv = VPN.find(serverId) || VPN.best();
            if (!srv) { toast("Нет доступных серверов", "warn"); return; }
            const can = VPN.canUse(srv);
            if (!can.ok) { denied(can, srv); return; }
            if (VPN.quota(st).over) { denied({ reason: "quota" }); return; }
            const token = ++vs.flow;
            const switching = st.connected && st.server !== srv.id;
            vs.connecting = srv.id;
            vs.selected = srv.id;
            el.sub.dataset.step = "";
            render();
            Sound.play("expand");
            const proto = VPN.PROTOCOLS[st.protocol];
            const entry = st.multihop && VPN.isPro() ? VPN.entryFor(srv) : null;
            const t0 = performance.now();
            if (switching) log(`Смена сервера: ${VPN.find(st.server).city} → ${srv.city}`);
            else if (reason) log(reason);
            const steps = [
                `DNS: ${VPN.hostname(srv)} → ${VPN.exitIp(srv, { since: 0 })}`,
                entry ? `Secure Core: вход через ${entry.city} (${entry.cc}), выход — ${srv.city}` : null,
                `${proto.label}: рукопожатие · ${proto.transport}/${proto.port}`,
                `Ключи сессии согласованы · ${proto.cipher}`,
                `Адрес туннеля ${VPN.virtualIp(vs.userId)}/32 · маршрут 0.0.0.0/0, ::/0 → tun0`,
                st.adblock ? "DNS 10.64.0.1 · NetShield фильтрует рекламу и трекеры" : "DNS 10.64.0.1 (NEXUS DNS)",
                st.killSwitch ? "Kill switch: трафик вне туннеля заблокирован" : null
            ].filter(Boolean);
            const stepMs = reducedMotion() ? 60 : Math.round(170 + 90 * proto.handshake + VPN.ping(srv, st.protocol) * 0.6);
            for (const line of steps) {
                el.sub.dataset.step = "1";
                el.sub.textContent = line;
                log(line, "quiet");
                await delay(stepMs);
                if (token !== vs.flow) return;
            }
            const res = VPN.connect(srv.id);
            vs.connecting = null;
            delete el.sub.dataset.step;
            if (!res || !res.ok) { render(); if (res) denied(res, srv); return; }
            const ms = Math.round(performance.now() - t0);
            const now = VPN.get();
            log(`Туннель поднят за ${ms} мс · IP выхода ${VPN.exitIp(srv, now)}`, "ok");
            Sound.play("granted");
            toast(`NEXUS VPN: защищено · ${srv.city}, ${srv.country}`, "ok", { ttl: 3200 });
            vs.rate.target = rand(8, 30);
            render();
        }
        function cancelFlow() {
            vs.flow++;
            vs.connecting = null;
            delete el.sub.dataset.step;
            log("Подключение отменено", "warn");
            Sound.play("panels");
            render();
        }
        function disconnectFlow() {
            const st = VPN.get();
            if (!st.connected) return;
            const srv = VPN.find(st.server);
            const bytes = VPN.sessionBytes(st);
            VPN.disconnect("user");
            log(`Туннель закрыт · ${srv.city} · ${formatDuration(Date.now() - st.since)} · ${formatBytes(bytes)}`, "warn");
            Sound.play("panels");
            vs.rate.target = 0;
            render();
        }
        el.power.addEventListener("click", () => {
            if (vs.dropping) return;
            if (vs.connecting) { cancelFlow(); return; }
            const st = VPN.get();
            if (st.connected) { disconnectFlow(); return; }
            const last = st.lastServer && VPN.find(st.lastServer);
            const target = vs.selected || (last && VPN.canUse(last).ok ? last.id : null);
            connectFlow(target);
        });
        $("#vpn-quick").addEventListener("click", () => {
            const best = VPN.best();
            if (!best) return;
            log(`Быстрое подключение: лучший сервер — ${best.city} (${VPN.ping(best)} ms, загрузка ${VPN.load(best)}%)`);
            connectFlow(best.id);
        });
        el.list.addEventListener("click", e => {
            const fav = e.target.closest("[data-fav]");
            if (fav) {
                const on = VPN.toggleFavorite(fav.getAttribute("data-fav"));
                Sound.play(on ? "granted" : "panels");
                renderList(true);
                return;
            }
            const btn = e.target.closest("[data-connect]");
            if (!btn) return;
            const id = btn.getAttribute("data-connect");
            const st = VPN.get();
            if (st.connected && st.server === id) { toast("Вы уже подключены к этому серверу", "info"); return; }
            if (vs.connecting === id) return;
            connectFlow(id);
        });
        el.search.addEventListener("input", () => { vs.query = el.search.value; renderList(true); });
        el.sort.addEventListener("change", () => { vs.sort = el.sort.value; renderList(true); });
        $("#vpn-filters").addEventListener("click", e => {
            const b = e.target.closest("[data-vf]");
            if (!b) return;
            vs.filter = b.getAttribute("data-vf");
            $$("#vpn-filters [data-vf]").forEach(x => { const on = x === b; x.classList.toggle("active", on); x.setAttribute("aria-pressed", String(on)); });
            Sound.play("folder");
            renderList(true);
        });

        /* ----- Протокол и опции ----- */
        $("#vpn-proto").addEventListener("change", e => {
            const r = e.target.closest("input[name='vpn-proto']");
            if (!r) return;
            const st = VPN.get();
            VPN.set({ protocol: r.value });
            Sound.play("folder");
            log(`Протокол: ${VPN.PROTOCOLS[r.value].label}`);
            if (st.connected) connectFlow(st.server, "Переподключение с новым протоколом");
            else render();
        });
        const opt = (id, key, onText, offText) => {
            $(id).addEventListener("change", e => {
                VPN.set({ [key]: e.target.checked });
                Sound.play(e.target.checked ? "granted" : "panels");
                log(e.target.checked ? onText : offText, e.target.checked ? "" : "warn");
                render();
            });
        };
        opt("#vpn-opt-kill", "killSwitch", "Kill switch включён", "Kill switch выключен: при обрыве трафик пойдёт мимо туннеля");
        opt("#vpn-opt-adblock", "adblock", "NetShield включён: реклама и трекеры блокируются на уровне DNS", "NetShield выключен");
        opt("#vpn-opt-auto", "autoConnect", "Автоподключение при открытии клиента включено", "Автоподключение выключено");
        $("#vpn-opt-multihop").addEventListener("change", e => {
            if (e.target.checked && !VPN.isPro()) {
                e.target.checked = false;
                planModal("Secure Core", "Двойной хоп: трафик сначала идёт на защищённый узел в Швейцарии, Исландии или Швеции, а уже оттуда — на выбранный сервер. Доступно в NEXUS+.");
                return;
            }
            const st = VPN.get();
            VPN.set({ multihop: e.target.checked });
            log(e.target.checked ? "Secure Core включён" : "Secure Core выключен");
            if (st.connected) connectFlow(st.server, "Переподключение: маршрут Secure Core изменён");
            else render();
        });

        /* ----- Тест скорости ----- */
        const gauge = $("#vpn-gauge");
        const gctx = gauge.getContext("2d");
        function drawGauge(value, phase) {
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const W = 260, H = 150;
            if (gauge.width !== W * dpr) { gauge.width = W * dpr; gauge.height = H * dpr; }
            gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            gctx.clearRect(0, 0, W, H);
            const cx = W / 2, cy = 124, r = 100;
            const marks = [0, 10, 50, 100, 250, 500, 1000];
            const pos = v => Math.sqrt(clamp(v, 0, 1000) / 1000);
            const ang = p => Math.PI + p * Math.PI;
            gctx.lineWidth = 10;
            gctx.strokeStyle = NX.rgba(0.14);
            gctx.beginPath(); gctx.arc(cx, cy, r, Math.PI, 2 * Math.PI); gctx.stroke();
            if (value > 0) {
                gctx.strokeStyle = NX.rgba(0.95);
                gctx.shadowColor = NX.rgba(0.7);
                gctx.shadowBlur = 12;
                gctx.beginPath(); gctx.arc(cx, cy, r, Math.PI, ang(pos(value))); gctx.stroke();
                gctx.shadowBlur = 0;
            }
            gctx.fillStyle = NX.rgba(0.6);
            gctx.font = "10px 'Fira Mono', monospace";
            gctx.textAlign = "center";
            marks.forEach(m => {
                const a = ang(pos(m));
                gctx.strokeStyle = NX.rgba(0.5);
                gctx.lineWidth = 1;
                gctx.beginPath();
                gctx.moveTo(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9));
                gctx.lineTo(cx + Math.cos(a) * (r - 16), cy + Math.sin(a) * (r - 16));
                gctx.stroke();
                gctx.fillText(String(m), cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28) + 3);
            });
            const a = ang(pos(value));
            gctx.strokeStyle = NX.rgba(1);
            gctx.lineWidth = 2;
            gctx.beginPath(); gctx.moveTo(cx, cy); gctx.lineTo(cx + Math.cos(a) * (r - 34), cy + Math.sin(a) * (r - 34)); gctx.stroke();
            gctx.fillStyle = NX.rgba(1);
            gctx.beginPath(); gctx.arc(cx, cy, 4, 0, Math.PI * 2); gctx.fill();
            gctx.font = "22px 'United Sans Medium', sans-serif";
            gctx.fillText(value >= 100 ? String(Math.round(value)) : value.toFixed(1), cx, cy - 26);
            gctx.font = "10px 'Fira Mono', monospace";
            gctx.fillStyle = NX.rgba(0.65);
            gctx.fillText(phase || "Мбит/с", cx, cy - 12);
        }
        drawGauge(0, "Мбит/с");
        document.addEventListener("nexus:theme", () => drawGauge(0, "Мбит/с"));
        const ispSpeed = 180 + (hashString(navigator.userAgent || "x") % 300);
        async function animateTo(target, ms, phase, onFrame) {
            if (reducedMotion()) { drawGauge(target, phase); onFrame(target); return target; }
            const t0 = performance.now();
            let v = 0;
            while (performance.now() - t0 < ms) {
                const p = (performance.now() - t0) / ms;
                v = target * (1 - Math.pow(1 - Math.min(1, p * 1.6), 3)) * (0.93 + Math.random() * 0.09);
                drawGauge(v, phase);
                onFrame(v);
                await delay(50);
            }
            return target;
        }
        $("#vpn-speed-btn").addEventListener("click", async () => {
            if (vs.speedRunning) return;
            const btn = $("#vpn-speed-btn");
            vs.speedRunning = true;
            btn.disabled = true;
            btn.querySelector("span").textContent = "Идёт тест…";
            const st = VPN.get();
            const srv = st.connected ? VPN.find(st.server) : null;
            const proto = VPN.PROTOCOLS[st.protocol];
            setText("vpn-speed-where", srv ? `через ${srv.city}` : "без VPN");
            ["vpn-st-ping", "vpn-st-down", "vpn-st-up"].forEach(id => setText(id, "…"));
            Sound.play("expand");
            // Пинг: 8 замеров
            const basePing = srv ? VPN.ping(srv, st.protocol) + (st.entry ? 12 : 0) : randInt(7, 16);
            let sum = 0;
            for (let i = 1; i <= 8; i++) {
                sum += basePing + rand(-2, 4);
                setText("vpn-st-ping", Math.round(sum / i) + " ms");
                drawGauge(0, "ping " + Math.round(sum / i) + " ms");
                await delay(reducedMotion() ? 10 : 90);
            }
            const dist = srv ? Math.min(1, Math.max(0.42, 1 - (VPN.ping(srv) - 10) / 400)) : 1;
            const cap = srv ? ispSpeed * proto.speed * (1 - VPN.load(srv) / 170) * dist * (st.entry ? 0.8 : 1) : ispSpeed;
            const down = cap * rand(0.92, 1);
            await animateTo(down, 3200, "↓ Мбит/с", v => setText("vpn-st-down", v.toFixed(0)));
            setText("vpn-st-down", down.toFixed(0) + " Мбит/с");
            const up = down * rand(0.35, 0.48);
            await animateTo(up, 2400, "↑ Мбит/с", v => setText("vpn-st-up", v.toFixed(0)));
            setText("vpn-st-up", up.toFixed(0) + " Мбит/с");
            drawGauge(down, "↓ Мбит/с");
            log(`Тест скорости${srv ? " через " + srv.city : " без VPN"}: ↓ ${down.toFixed(0)} · ↑ ${up.toFixed(0)} Мбит/с · ping ${Math.round(sum / 8)} ms`, "ok");
            Sound.play("granted");
            btn.disabled = false;
            btn.querySelector("span").textContent = "Повторить тест";
            vs.speedRunning = false;
        });

        /* ----- Проверка утечек и обрыв связи ----- */
        function setCheck(key, state, text) {
            const li = $(`#vpn-checks [data-check="${key}"]`);
            if (!li) return;
            li.setAttribute("data-state", state);
            li.querySelector("i").textContent = text;
        }
        $("#vpn-leak-btn").addEventListener("click", async () => {
            if (vs.leakRunning) return;
            vs.leakRunning = true;
            const st = VPN.get();
            const on = st.connected;
            const srv = on ? VPN.find(st.server) : null;
            const rtc = typeof window.RTCPeerConnection !== "undefined";
            const results = [
                ["ip", on ? ["ok", `${VPN.exitIp(srv, st)} · ${srv.city}, ${srv.cc}`] : ["fail", "сайты видят реальный IP провайдера"]],
                ["dns", on ? ["ok", st.adblock ? "10.64.0.1 · NEXUS DNS + NetShield" : "10.64.0.1 · NEXUS DNS"] : ["fail", "запросы идут на DNS провайдера"]],
                ["webrtc", rtc ? ["warn", "WebRTC включён в браузере: в настоящем VPN его стоит ограничить"] : ["ok", "WebRTC недоступен — утечки нет"]],
                ["ipv6", on ? ["ok", "IPv6 заблокирован внутри туннеля"] : ["fail", "IPv6 идёт мимо VPN"]],
                ["kill", st.killSwitch ? ["ok", "включён — при обрыве сеть блокируется"] : ["warn", "выключен — при обрыве трафик пойдёт напрямую"]]
            ];
            Sound.play("expand");
            for (const [key] of results) setCheck(key, "run", "проверка…");
            for (const [key, [state, text]] of results) {
                await delay(reducedMotion() ? 20 : 420);
                setCheck(key, state, text);
                Sound.play(state === "fail" ? "denied" : "stdout");
            }
            const fails = results.filter(r => r[1][0] === "fail").length;
            log(fails ? `Проверка утечек: найдено проблем — ${fails}` : "Проверка утечек: IP, DNS и IPv6 защищены", fails ? "err" : "ok");
            toast(fails ? "Без VPN сайты видят ваш IP и DNS провайдера" : "Утечек IP и DNS не найдено", fails ? "warn" : "ok");
            vs.leakRunning = false;
        });
        $("#vpn-drop-btn").addEventListener("click", async () => {
            const st = VPN.get();
            if (!st.connected) { toast("Сначала подключитесь к серверу", "warn"); return; }
            if (vs.dropping || vs.connecting) return;
            vs.dropping = true;
            vs.rate.target = 0;
            render();
            Sound.play("denied");
            log("Связь с сервером потеряна: нет ответа на keepalive", "err");
            if (st.killSwitch) {
                log("Kill switch: весь трафик заблокирован до восстановления туннеля — IP не раскрыт", "warn");
                setCheck("kill", "ok", "сработал: трафик заблокирован при обрыве");
            } else {
                log("Kill switch выключен: трафик пошёл напрямую — ваш IP раскрыт!", "err");
                setCheck("kill", "fail", "не сработал: при обрыве IP был раскрыт");
            }
            await delay(reducedMotion() ? 300 : 2400);
            vs.dropping = false;
            if (!VPN.get().connected) { render(); return; }
            log("Повторное рукопожатие · туннель восстановлен", "ok");
            Sound.play("granted");
            vs.rate.target = rand(6, 24);
            render();
        });

        /* ----- Конфигурация WireGuard ----- */
        function serverKey(srv) {
            let s = "";
            let h = hashString("srv:" + srv.id);
            for (let i = 0; i < 32; i++) { h = (h * 1103515245 + 12345) >>> 0; s += String.fromCharCode((h >>> 16) & 255); }
            return window.btoa(s);
        }
        $("#vpn-conf-btn").addEventListener("click", () => {
            const st = VPN.get();
            const keys = VPN.ensureKeys();
            const srv = VPN.find(st.server) || VPN.find(vs.selected) || VPN.find(st.lastServer) || VPN.best() || VPN.SERVERS[0];
            const text = [
                "# NEXUS VPN — ТЕСТОВАЯ конфигурация WireGuard",
                `# Сервер: ${srv.city}, ${srv.country} · создано ${new Date().toISOString()}`,
                "# Демонстрация: хост в зоне .test не существует, подключиться по этому файлу нельзя.",
                "",
                "[Interface]",
                `PrivateKey = ${keys.priv}`,
                `Address = ${VPN.virtualIp(vs.userId)}/32`,
                "DNS = 10.64.0.1",
                "",
                "[Peer]",
                `PublicKey = ${serverKey(srv)}`,
                "AllowedIPs = 0.0.0.0/0, ::/0",
                `Endpoint = ${VPN.hostname(srv)}:51820`,
                "PersistentKeepalive = 25",
                ""
            ].join("\n");
            if (downloadBlob(`nexus-${srv.id}.conf`, new Blob([text], { type: "text/plain;charset=utf-8" }))) {
                log(`Конфигурация для ${srv.city} сохранена: nexus-${srv.id}.conf`, "ok");
                toast(`Файл nexus-${srv.id}.conf сохранён`, "ok");
            }
            render();
        });
        $("#vpn-keys-btn").addEventListener("click", () => {
            VPN.mutate(st => { st.keys = null; }, { action: "keys" });
            VPN.ensureKeys();
            log("Созданы новые ключи WireGuard — старые конфигурации больше не подойдут", "warn");
            toast("Новая пара ключей создана", "ok");
            render();
        });

        /* ----- Карта ----- */
        const canvas = $("#vpn-map");
        const wrap = $("#vpn-map-wrap");
        const tip = $("#vpn-map-tip");
        const ctx = canvas.getContext("2d");
        const map = { w: 0, h: 0, dpr: 1, land: null, raf: 0, last: 0 };
        const COLS = 144, ROWS = 56;
        const proj = (lat, lon) => ({ x: (lon + 180) / 360 * map.w, y: (84 - lat) / (ROWS * 2.5) * map.h });
        function buildLand() {
            const off = document.createElement("canvas");
            off.width = Math.round(map.w * map.dpr);
            off.height = Math.round(map.h * map.dpr);
            const c = off.getContext("2d");
            c.setTransform(map.dpr, 0, 0, map.dpr, 0, 0);
            const cw = map.w / COLS, ch = map.h / ROWS;
            // Сетка меридианов и параллелей
            c.strokeStyle = NX.rgba(0.07);
            c.lineWidth = 1;
            for (let lon = -150; lon <= 150; lon += 30) { const p = proj(0, lon); c.beginPath(); c.moveTo(Math.round(p.x) + 0.5, 0); c.lineTo(Math.round(p.x) + 0.5, map.h); c.stroke(); }
            for (let lat = 60; lat >= -30; lat -= 30) { const p = proj(lat, 0); c.beginPath(); c.moveTo(0, Math.round(p.y) + 0.5); c.lineTo(map.w, Math.round(p.y) + 0.5); c.stroke(); }
            c.strokeStyle = NX.rgba(0.14);
            const eq = proj(0, 0);
            c.setLineDash([2, 4]);
            c.beginPath(); c.moveTo(0, Math.round(eq.y) + 0.5); c.lineTo(map.w, Math.round(eq.y) + 0.5); c.stroke();
            c.setLineDash([]);
            const size = Math.max(1.2, Math.min(cw, ch) * 0.52);
            c.fillStyle = NX.rgba(0.42);
            for (let j = 0; j < ROWS; j++) {
                const row = LAND[j] || "";
                for (let k = 0; k < row.length; k++) {
                    const nib = parseInt(row[k], 16);
                    if (!nib) continue;
                    for (let b = 0; b < 4; b++) {
                        if (!(nib & (8 >> b))) continue;
                        const i = k * 4 + b;
                        c.fillRect(i * cw + (cw - size) / 2, j * ch + (ch - size) / 2, size, size);
                    }
                }
            }
            map.land = off;
        }
        function resizeMap() {
            const w = Math.max(280, wrap.clientWidth);
            const h = Math.round(w * ROWS / COLS);
            map.dpr = Math.min(2, window.devicePixelRatio || 1);
            map.w = w;
            map.h = h;
            canvas.style.height = h + "px";
            canvas.width = Math.round(w * map.dpr);
            canvas.height = Math.round(h * map.dpr);
            buildLand();
            drawMap();
        }
        function arcPoints(a, b) {
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            return { a, b, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - Math.min(90, d * 0.28) } };
        }
        function bez(arc, t) {
            const u = 1 - t;
            return { x: u * u * arc.a.x + 2 * u * t * arc.c.x + t * t * arc.b.x, y: u * u * arc.a.y + 2 * u * t * arc.c.y + t * t * arc.b.y };
        }
        function drawArc(arc, alpha, dash, offset) {
            ctx.strokeStyle = NX.rgba(alpha);
            ctx.lineWidth = 1.5;
            ctx.setLineDash(dash || []);
            ctx.lineDashOffset = offset || 0;
            ctx.beginPath();
            ctx.moveTo(arc.a.x, arc.a.y);
            ctx.quadraticCurveTo(arc.c.x, arc.c.y, arc.b.x, arc.b.y);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        function drawMap(now) {
            if (!map.land || !map.w) return;
            now = now || performance.now();
            const st = VPN.get();
            if (!st) return;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(map.land, 0, 0);
            ctx.setTransform(map.dpr, 0, 0, map.dpr, 0, 0);
            const home = proj(VPN.home.lat, VPN.home.lon);
            const active = st.connected ? VPN.find(st.server) : null;
            const entry = st.entry ? VPN.find(st.entry) : null;
            const target = vs.connecting ? VPN.find(vs.connecting) : null;
            const t = now / 1000;
            const motion = !reducedMotion();

            // Маршрут
            if (active && !vs.dropping) {
                const hops = entry ? [home, proj(entry.lat, entry.lon), proj(active.lat, active.lon)] : [home, proj(active.lat, active.lon)];
                for (let i = 0; i < hops.length - 1; i++) {
                    const arc = arcPoints(hops[i], hops[i + 1]);
                    drawArc(arc, 0.75);
                    if (motion) {
                        for (let k = 0; k < 3; k++) {
                            const p = bez(arc, ((t * 0.45 + k / 3 + i * 0.17) % 1));
                            ctx.fillStyle = NX.rgba(1);
                            ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
                        }
                    }
                }
            } else if (target) {
                const hops = st.multihop && VPN.isPro() && VPN.entryFor(target) ? [home, proj(VPN.entryFor(target).lat, VPN.entryFor(target).lon), proj(target.lat, target.lon)] : [home, proj(target.lat, target.lon)];
                for (let i = 0; i < hops.length - 1; i++) drawArc(arcPoints(hops[i], hops[i + 1]), 0.6, [4, 5], motion ? -t * 30 : 0);
            } else if (active && vs.dropping) {
                drawArc(arcPoints(home, proj(active.lat, active.lon)), 0.3, [2, 6], 0);
            }

            // Серверы
            ctx.font = "10px 'Fira Mono', monospace";
            VPN.SERVERS.forEach(s => {
                const p = proj(s.lat, s.lon);
                const can = VPN.canUse(s).ok;
                const isActive = active && active.id === s.id;
                const isHover = vs.hover === s.id;
                const isSel = vs.selected === s.id || (target && target.id === s.id);
                if (isActive) {
                    const r = 6 + (motion ? (t * 12) % 14 : 6);
                    ctx.strokeStyle = NX.rgba(Math.max(0, 0.8 - (r - 6) / 16));
                    ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
                }
                if (can) {
                    ctx.fillStyle = NX.rgba(isActive ? 1 : 0.92);
                    ctx.fillRect(p.x - 3, p.y - 3, 6, 6);
                } else {
                    ctx.strokeStyle = NX.rgba(0.55);
                    ctx.lineWidth = 1;
                    ctx.strokeRect(p.x - 2.5, p.y - 2.5, 5, 5);
                }
                if (isHover || isSel || isActive) {
                    ctx.strokeStyle = NX.rgba(0.9);
                    ctx.lineWidth = 1;
                    ctx.strokeRect(p.x - 7, p.y - 7, 14, 14);
                }
                if (isActive || isHover || (entry && entry.id === s.id)) {
                    const label = (entry && entry.id === s.id && !isActive ? "CORE " : "") + s.city.toUpperCase();
                    ctx.fillStyle = NX.rgba(1);
                    ctx.textAlign = p.x > map.w - 90 ? "right" : "left";
                    ctx.fillText(label, p.x + (ctx.textAlign === "right" ? -11 : 11), p.y - 8);
                }
            });

            // Пользователь
            ctx.strokeStyle = NX.rgba(1);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(home.x - 6, home.y); ctx.lineTo(home.x + 6, home.y);
            ctx.moveTo(home.x, home.y - 6); ctx.lineTo(home.x, home.y + 6);
            ctx.stroke();
            ctx.beginPath(); ctx.arc(home.x, home.y, 9, 0, Math.PI * 2); ctx.stroke();
            ctx.fillStyle = NX.rgba(0.85);
            ctx.textAlign = "left";
            ctx.fillText(active && !vs.dropping ? "ВЫ · IP СКРЫТ" : "ВЫ", home.x + 12, home.y + 16);
        }
        function loop(now) {
            map.raf = 0;
            if (document.visibilityState === "visible" && !reducedMotion() && !$("#vpn-app").hidden) {
                if (now - map.last > 33) { map.last = now; drawMap(now); }
                map.raf = requestAnimationFrame(loop);
            }
        }
        function startLoop() { if (!map.raf && !reducedMotion()) map.raf = requestAnimationFrame(loop); }
        function serverAt(x, y) {
            let best = null, bd = 13;
            VPN.SERVERS.forEach(s => {
                const p = proj(s.lat, s.lon);
                const d = Math.hypot(p.x - x, p.y - y);
                if (d < bd) { bd = d; best = s; }
            });
            return best;
        }
        canvas.addEventListener("mousemove", e => {
            const r = canvas.getBoundingClientRect();
            const x = e.clientX - r.left, y = e.clientY - r.top;
            const lat = 84 - y / map.h * ROWS * 2.5, lon = x / map.w * 360 - 180;
            $("#vpn-map-coords").textContent = `LAT ${lat.toFixed(2)} · LON ${lon.toFixed(2)}`;
            const s = serverAt(x, y);
            const id = s ? s.id : null;
            canvas.style.cursor = s ? "pointer" : "crosshair";
            if (id !== vs.hover) { vs.hover = id; drawMap(); }
            if (!s) { tip.hidden = true; return; }
            const st = VPN.get();
            const can = VPN.canUse(s).ok;
            tip.innerHTML = `<b>${escapeHtml(s.city)}, ${escapeHtml(s.country)}</b><span>${can ? VPN.ping(s, st.protocol) + " ms" : "NEXUS+"} · загрузка ${VPN.load(s)}%</span>${s.tags.length ? `<i>${escapeHtml(s.tags.map(t => VPN.TAGS[t]).join(" · "))}</i>` : ""}`;
            tip.hidden = false;
            const p = proj(s.lat, s.lon);
            tip.style.left = clamp(p.x + 14, 4, map.w - tip.offsetWidth - 4) + "px";
            tip.style.top = clamp(p.y - tip.offsetHeight - 10, 4, map.h - tip.offsetHeight - 4) + "px";
        });
        canvas.addEventListener("mouseleave", () => { vs.hover = null; tip.hidden = true; drawMap(); });
        canvas.addEventListener("click", e => {
            const r = canvas.getBoundingClientRect();
            const s = serverAt(e.clientX - r.left, e.clientY - r.top);
            if (!s) return;
            const st = VPN.get();
            if (st.connected && st.server === s.id) { toast(`Вы подключены: ${s.city}`, "info"); return; }
            connectFlow(s.id);
        });
        window.addEventListener("resize", () => { clearTimeout(map.rt); map.rt = setTimeout(resizeMap, 120); });
        document.addEventListener("nexus:theme", () => { buildLand(); drawMap(); drawTraffic(); });
        document.addEventListener("visibilitychange", startLoop);

        /* ----- График трафика ----- */
        const tcan = $("#vpn-traffic");
        const tctx = tcan.getContext("2d");
        function drawTraffic() {
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const w = tcan.clientWidth || 300, h = tcan.clientHeight || 110;
            if (tcan.width !== Math.round(w * dpr)) { tcan.width = Math.round(w * dpr); tcan.height = Math.round(h * dpr); }
            tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            tctx.clearRect(0, 0, w, h);
            const max = Math.max(10, ...vs.down) * 1.15;
            tctx.strokeStyle = NX.rgba(0.1);
            tctx.lineWidth = 1;
            for (let i = 1; i < 4; i++) { const y = Math.round(h * i / 4) + 0.5; tctx.beginPath(); tctx.moveTo(0, y); tctx.lineTo(w, y); tctx.stroke(); }
            const n = vs.down.length;
            const xs = i => i / (n - 1) * w;
            const ys = v => h - 2 - v / max * (h - 8);
            tctx.beginPath();
            vs.down.forEach((v, i) => { i ? tctx.lineTo(xs(i), ys(v)) : tctx.moveTo(xs(i), ys(v)); });
            tctx.lineTo(w, h); tctx.lineTo(0, h); tctx.closePath();
            tctx.fillStyle = NX.rgba(0.16);
            tctx.fill();
            tctx.beginPath();
            vs.down.forEach((v, i) => { i ? tctx.lineTo(xs(i), ys(v)) : tctx.moveTo(xs(i), ys(v)); });
            tctx.strokeStyle = NX.rgba(0.95);
            tctx.lineWidth = 1.5;
            tctx.stroke();
            tctx.beginPath();
            vs.up.forEach((v, i) => { i ? tctx.lineTo(xs(i), ys(v)) : tctx.moveTo(xs(i), ys(v)); });
            tctx.setLineDash([3, 3]);
            tctx.strokeStyle = NX.rgba(0.6);
            tctx.stroke();
            tctx.setLineDash([]);
            tctx.fillStyle = NX.rgba(0.55);
            tctx.font = "10px 'Fira Mono', monospace";
            tctx.textAlign = "right";
            tctx.fillText(max.toFixed(0) + " Мбит/с", w - 4, 11);
        }

        /* ----- Тик раз в секунду: аптайм, пинг, трафик, NetShield ----- */
        const TRACKERS = ["ads.metrics.test", "pixel.trackr.test", "cdn.adserve.test", "beacon.analytix.test", "sync.cookiematch.test", "tag.retarget.test"];
        let tick = 0;
        function second() {
            tick++;
            const st = VPN.get();
            if (!st) return;
            const srv = st.connected ? VPN.find(st.server) : null;
            if (srv && !vs.dropping) {
                const proto = VPN.PROTOCOLS[st.protocol];
                if (Math.random() < 0.18) vs.rate.target = Math.random() < 0.25 ? rand(30, 90) * proto.speed : rand(1.5, 18) * proto.speed;
                vs.rate.down += (vs.rate.target - vs.rate.down) * 0.35 + rand(-1, 1);
                vs.rate.down = Math.max(0.2, vs.rate.down);
                vs.rate.up = Math.max(0.05, vs.rate.down * rand(0.12, 0.35));
                vs.ping = VPN.ping(srv, st.protocol, true) + (st.entry ? 12 : 0);
                setText("vpn-f-uptime", formatDuration(Date.now() - st.since));
                setText("vpn-f-ping", vs.ping + " ms");
                setText("vpn-total", formatBytes(VPN.sessionBytes(st)));
                if (st.adblock && Math.random() < 0.22) {
                    const n = randInt(1, 3);
                    VPN.addBlocked(n);
                    if (Math.random() < 0.3) log(`NetShield: заблокирован ${pick(TRACKERS)}`, "quiet");
                }
                if (tick % 25 === 0) log(`keepalive · rtt ${vs.ping} ms`, "quiet");
                if (tick % 120 === 0) log("Rekey: ключи сессии обновлены", "quiet");
                if (tick % 5 === 0) renderQuota(VPN.get());
            } else {
                vs.rate.down *= 0.5;
                vs.rate.up *= 0.5;
                if (!srv) setText("vpn-total", "0 Б");
            }
            setText("vpn-blocked", String(st.connected ? (VPN.get().blocked || 0) : 0));
            setText("vpn-down", vs.rate.down.toFixed(1));
            setText("vpn-up", vs.rate.up.toFixed(1));
            vs.down.push(vs.rate.down); vs.down.shift();
            vs.up.push(vs.rate.up); vs.up.shift();
            drawTraffic();
            renderList();
            if (reducedMotion()) drawMap();
        }

        /* ----- Внешние изменения (кабинет, терминал, другая вкладка) ----- */
        document.addEventListener("nexus:vpn", e => {
            const d = e.detail || {};
            if (d.action === "connect" || d.action === "disconnect" || d.action === "sync") {
                if (d.action === "disconnect" && d.reason && d.reason !== "user") log(d.reason === "quota" ? "Отключено: исчерпан лимит трафика FREE" : d.reason === "plan" ? "Отключено: сервер недоступен на вашем тарифе" : "Туннель закрыт из терминала", "warn");
                if (d.action === "connect" && !vs.connecting) log(`Подключено извне: ${VPN.find(d.server).city}`, "ok");
                render();
            }
        });
        document.addEventListener("nexus:account", () => render());

        /* ----- Старт ----- */
        resizeMap();
        log(`NEXUS VPN client 1.0 · ${VPN.home.tz} · ${VPN.SERVERS.length} серверов`, "quiet");
        const st0 = VPN.get();
        if (st0.connected) {
            const s0 = VPN.find(st0.server);
            log(`Активный туннель: ${s0.city} · ${VPN.PROTOCOLS[st0.protocol].label} · ${formatDuration(Date.now() - st0.since)}`, "ok");
            vs.rate.target = rand(6, 20);
        }
        render();
        startLoop();
        setInterval(second, 1000);
        if (st0.autoConnect && !st0.connected) setTimeout(() => connectFlow(st0.lastServer && VPN.canUse(VPN.find(st0.lastServer)).ok ? st0.lastServer : null, "Автоподключение"), 700);
    }

    /* ================================================================
     * NEXUS IDE — подсветка синтаксиса
     * ================================================================ */
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const span = (cls, text) => `<span class="${cls}">${esc(text)}</span>`;

    const JS_KW = new Set(("break case catch class const continue debugger default delete do else export extends finally for function if import in " +
        "instanceof let new return super switch this throw try typeof var void while with yield async await of static get set").split(" "));
    const JS_LIT = new Set("true false null undefined NaN Infinity".split(" "));
    const JS_GLOBALS = new Set("console window document Math JSON Date Array Object String Number Boolean Promise Map Set Symbol RegExp Error localStorage setTimeout setInterval clearInterval clearTimeout requestAnimationFrame fetch alert".split(" "));
    const REGEX_PREV = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
    const REGEX_KW = new Set(["return", "typeof", "case", "do", "else", "in", "of", "instanceof", "new", "delete", "void", "throw", "yield", "await"]);

    /* Токены JavaScript: { t: тип, v: текст, s: позиция } */
    function jsTokens(src) {
        const out = [];
        const n = src.length;
        let i = 0;
        let prev = null;
        const push = (t, v) => { out.push({ t, v, s: i }); i += v.length; if (t !== "ws" && t !== "com") prev = out[out.length - 1]; };
        while (i < n) {
            const c = src[i];
            const rest2 = src.substr(i, 2);
            if (c === " " || c === "\t" || c === "\n" || c === "\r") {
                let j = i + 1;
                while (j < n && /\s/.test(src[j])) j++;
                push("ws", src.slice(i, j));
            } else if (rest2 === "//") {
                let j = src.indexOf("\n", i);
                if (j < 0) j = n;
                push("com", src.slice(i, j));
            } else if (rest2 === "/*") {
                let j = src.indexOf("*/", i + 2);
                j = j < 0 ? n : j + 2;
                push("com", src.slice(i, j));
            } else if (c === "\"" || c === "'" || c === "`") {
                let j = i + 1;
                while (j < n && src[j] !== c) {
                    if (src[j] === "\\") j++;
                    else if (src[j] === "\n" && c !== "`") break;
                    j++;
                }
                push("str", src.slice(i, Math.min(n, j + 1)));
            } else if (c === "/" && (!prev || (prev.t === "punc" && REGEX_PREV.has(prev.v[prev.v.length - 1])) || (prev.t === "kw" && REGEX_KW.has(prev.v)))) {
                let j = i + 1, cls = false;
                while (j < n && src[j] !== "\n") {
                    if (src[j] === "\\") { j += 2; continue; }
                    if (src[j] === "[") cls = true;
                    else if (src[j] === "]") cls = false;
                    else if (src[j] === "/" && !cls) break;
                    j++;
                }
                if (src[j] === "/") {
                    j++;
                    while (j < n && /[a-z]/i.test(src[j])) j++;
                    push("re", src.slice(i, j));
                } else push("punc", c);
            } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] || ""))) {
                const m = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][+-]?\d+)?)n?/.exec(src.slice(i, i + 40));
                push("num", m ? m[0] : c);
            } else if (/[A-Za-z_$\u00C0-\uFFFF]/.test(c)) {
                let j = i + 1;
                while (j < n && /[\w$\u00C0-\uFFFF]/.test(src[j])) j++;
                const w = src.slice(i, j);
                push(JS_KW.has(w) ? "kw" : JS_LIT.has(w) ? "lit" : "id", w);
            } else {
                let j = i + 1;
                while (j < n && /[=<>!&|+\-*%^~?.:]/.test(src[j]) && /[=<>!&|+\-*%^~?.:]/.test(c) && j - i < 4) j++;
                push("punc", src.slice(i, j));
            }
        }
        return out;
    }
    function hlJS(src) {
        const toks = jsTokens(src);
        let html = "";
        for (let k = 0; k < toks.length; k++) {
            const tk = toks[k];
            switch (tk.t) {
                case "ws": html += tk.v; break;
                case "com": html += span("t-com", tk.v); break;
                case "str": html += span("t-str", tk.v); break;
                case "re": html += span("t-str", tk.v); break;
                case "num": html += span("t-num", tk.v); break;
                case "kw": html += span("t-kw", tk.v); break;
                case "lit": html += span("t-num", tk.v); break;
                case "id": {
                    let p = k - 1;
                    while (p >= 0 && (toks[p].t === "ws" || toks[p].t === "com")) p--;
                    let nx = k + 1;
                    while (nx < toks.length && toks[nx].t === "ws") nx++;
                    const prevDot = p >= 0 && toks[p].t === "punc" && /\.$/.test(toks[p].v);
                    const call = nx < toks.length && toks[nx].v[0] === "(";
                    if (call) html += span("t-fn", tk.v);
                    else if (prevDot) html += span("t-prop", tk.v);
                    else if (JS_GLOBALS.has(tk.v) || /^[A-Z]/.test(tk.v)) html += span("t-type", tk.v);
                    else html += esc(tk.v);
                    break;
                }
                default: html += span("t-punc", tk.v);
            }
        }
        return html;
    }

    function hlCSS(src) {
        let html = "", i = 0, depth = 0, inValue = false, selMode = true;
        const n = src.length;
        const startStatement = from => {
            // Селектор, если до «;» или «}» встретится «{»
            const rest = src.slice(from, from + 2000);
            const m = /[;{}]/.exec(rest.replace(/\/\*[\s\S]*?\*\//g, s => " ".repeat(s.length)).replace(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'/g, s => " ".repeat(s.length)));
            return !m || m[0] === "{";
        };
        selMode = startStatement(0);
        while (i < n) {
            const c = src[i];
            if (src.substr(i, 2) === "/*") {
                let j = src.indexOf("*/", i + 2); j = j < 0 ? n : j + 2;
                html += span("t-com", src.slice(i, j)); i = j; continue;
            }
            if (c === "\"" || c === "'") {
                let j = i + 1;
                while (j < n && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
                html += span("t-str", src.slice(i, j + 1)); i = j + 1; continue;
            }
            if (/\s/.test(c)) { let j = i + 1; while (j < n && /\s/.test(src[j])) j++; html += src.slice(i, j); i = j; continue; }
            if (c === "{") { depth++; inValue = false; html += span("t-punc", c); i++; selMode = startStatement(i); continue; }
            if (c === "}") { depth = Math.max(0, depth - 1); inValue = false; html += span("t-punc", c); i++; selMode = startStatement(i); continue; }
            if (c === ";") { inValue = false; html += span("t-punc", c); i++; selMode = startStatement(i); continue; }
            if (c === "@") {
                const m = /^@[\w-]+/.exec(src.slice(i, i + 40));
                const w = m ? m[0] : "@";
                html += span("t-kw", w); i += w.length; selMode = false; inValue = true; continue;
            }
            if (selMode) {
                let j = i;
                while (j < n && !/[{;}"'\s]/.test(src[j]) && src.substr(j, 2) !== "/*") j++;
                if (j === i) j = i + 1;
                html += span("t-sel", src.slice(i, j)); i = j; continue;
            }
            if (!inValue && c === ":") { inValue = true; html += span("t-punc", c); i++; continue; }
            if (!inValue) {
                const m = /^-{0,2}[\w-]+/.exec(src.slice(i, i + 80));
                if (m) { html += span(m[0].indexOf("--") === 0 ? "t-type" : "t-prop", m[0]); i += m[0].length; continue; }
                html += span("t-punc", c); i++; continue;
            }
            // Значение свойства
            if (c === "#") {
                const m = /^#[\da-fA-F]{3,8}\b/.exec(src.slice(i, i + 10));
                if (m) { html += span("t-num", m[0]); i += m[0].length; continue; }
            }
            if (src.substr(i, 10).toLowerCase() === "!important") { html += span("t-kw", src.substr(i, 10)); i += 10; continue; }
            let m = /^-?(?:\d*\.\d+|\d+)(?:%|[a-zA-Z]+)?/.exec(src.slice(i, i + 30));
            if (m) { html += span("t-num", m[0]); i += m[0].length; continue; }
            m = /^-{0,2}[a-zA-Z_][\w-]*/.exec(src.slice(i, i + 80));
            if (m) {
                const fn = src[i + m[0].length] === "(";
                html += span(fn ? "t-fn" : m[0].indexOf("--") === 0 ? "t-type" : "t-val", m[0]); i += m[0].length; continue;
            }
            html += span("t-punc", c); i++;
        }
        return html;
    }

    const VOID_TAGS = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
    function hlHTML(src) {
        let html = "", i = 0;
        const n = src.length;
        while (i < n) {
            const lt = src.indexOf("<", i);
            if (lt < 0) { html += hlText(src.slice(i)); break; }
            html += hlText(src.slice(i, lt));
            i = lt;
            if (src.substr(i, 4) === "<!--") {
                let j = src.indexOf("-->", i + 4); j = j < 0 ? n : j + 3;
                html += span("t-com", src.slice(i, j)); i = j; continue;
            }
            if (src[i + 1] === "!") {
                let j = src.indexOf(">", i); j = j < 0 ? n : j + 1;
                html += span("t-kw", src.slice(i, j)); i = j; continue;
            }
            const m = /^<(\/?)([A-Za-z][\w:-]*)/.exec(src.slice(i, i + 60));
            if (!m) { html += esc("<"); i++; continue; }
            html += span("t-punc", "<" + m[1]) + span("t-tag", m[2]);
            i += m[0].length;
            const tag = m[2].toLowerCase();
            let attrs = "";
            // Атрибуты до «>»
            while (i < n && src[i] !== ">") {
                const c = src[i];
                if (/\s/.test(c)) { let j = i + 1; while (j < n && /\s/.test(src[j])) j++; html += src.slice(i, j); i = j; continue; }
                if (src.substr(i, 2) === "/>") break;
                if (c === "=") { html += span("t-punc", c); i++; continue; }
                if (c === "\"" || c === "'") {
                    let j = src.indexOf(c, i + 1); j = j < 0 ? n : j + 1;
                    attrs += src.slice(i, j);
                    html += span("t-str", src.slice(i, j)); i = j; continue;
                }
                if (c === "<") break;
                let j = i;
                while (j < n && !/[\s=>"'<]/.test(src[j]) && src.substr(j, 2) !== "/>") j++;
                if (j === i) j = i + 1;
                const word = src.slice(i, j);
                attrs += " " + word;
                html += span(src[j] === "=" || /^[\w:-]+$/.test(word) ? "t-attr" : "t-str", word);
                i = j;
            }
            if (src.substr(i, 2) === "/>") { html += span("t-punc", "/>"); i += 2; continue; }
            if (src[i] === ">") { html += span("t-punc", ">"); i++; }
            if (!m[1] && (tag === "script" || tag === "style")) {
                const close = src.toLowerCase().indexOf("</" + tag, i);
                const end = close < 0 ? n : close;
                const body = src.slice(i, end);
                const type = (/type\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || "";
                if (tag === "style") html += hlCSS(body);
                else if (!type || /javascript|module|babel/i.test(type)) html += hlJS(body);
                else html += esc(body);
                i = end;
            }
        }
        return html;
    }
    function hlText(t) {
        return esc(t).replace(/&amp;(#?\w+;)/g, (m, e) => `<span class="t-num">&amp;${e}</span>`);
    }
    function hlMD(src) {
        let inCode = false;
        return src.split("\n").map(line => {
            if (/^\s*```/.test(line)) { inCode = !inCode; return span("t-com", line); }
            if (inCode) return span("t-str", line);
            if (/^#{1,6}\s/.test(line)) return span("t-kw", line);
            if (/^\s*>/.test(line)) return span("t-com", line);
            let out = esc(line);
            out = out.replace(/^(\s*)([-*+]|\d+\.)(\s)/, (m, a, b, c) => a + `<span class="t-punc">${b}</span>` + c);
            out = out.replace(/`[^`]+`/g, m => `<span class="t-str">${m}</span>`);
            out = out.replace(/\*\*[^*]+\*\*|__[^_]+__/g, m => `<span class="t-fn">${m}</span>`);
            out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, a, b) => `<span class="t-attr">[${a}]</span><span class="t-str">(${b})</span>`);
            return out;
        }).join("\n");
    }
    function langOf(path) {
        const ext = (path.split(".").pop() || "").toLowerCase();
        return { html: "html", htm: "html", svg: "html", xml: "html", css: "css", js: "js", mjs: "js", json: "json", md: "md" }[ext] || "text";
    }
    const LANG_LABEL = { html: "HTML", css: "CSS", js: "JavaScript", json: "JSON", md: "Markdown", text: "Текст" };
    const EXT_BADGE = { html: "<>", css: "#", js: "JS", json: "{}", md: "MD", text: "TXT" };
    function highlight(lang, src) {
        if (src.length > 400000) return esc(src);
        if (lang === "html") return hlHTML(src);
        if (lang === "css") return hlCSS(src);
        if (lang === "js" || lang === "json") return hlJS(src);
        if (lang === "md") return hlMD(src);
        return esc(src);
    }

    /* Защита от бесконечных циклов: в тело for / while с фигурными скобками
       добавляется проверка «if (__nxLoop()) break;» — без переносов строк,
       поэтому номера строк в ошибках не меняются. */
    function guardLoops(src) {
        let toks;
        try { toks = jsTokens(src); } catch (e) { return src; }
        const inserts = [];
        const sig = k => { while (k < toks.length && (toks[k].t === "ws" || toks[k].t === "com")) k++; return k; };
        for (let k = 0; k < toks.length; k++) {
            const tk = toks[k];
            if (tk.t !== "kw" || (tk.v !== "for" && tk.v !== "while")) continue;
            let p = k - 1;
            while (p >= 0 && (toks[p].t === "ws" || toks[p].t === "com")) p--;
            if (p >= 0 && toks[p].t === "punc" && /\.$/.test(toks[p].v)) continue;
            let a = sig(k + 1);
            if (toks[a] && toks[a].v === "await") a = sig(a + 1);
            if (!toks[a] || toks[a].v !== "(") continue;
            let depth = 0, b = a;
            for (; b < toks.length; b++) {
                const v = toks[b].t === "punc" ? toks[b].v : "";
                if (v === "(") depth++;
                else if (v === ")") { depth--; if (depth === 0) break; }
            }
            if (b >= toks.length) continue;
            const body = sig(b + 1);
            if (!toks[body] || toks[body].v !== "{") continue;
            inserts.push(toks[body].s + 1);
        }
        if (!inserts.length) return src;
        let out = "", last = 0;
        inserts.sort((x, y) => x - y).forEach(pos => { out += src.slice(last, pos) + "if(__nxLoop())break;"; last = pos; });
        return out + src.slice(last);
    }

    /* Мост внутри превью: консоль, ошибки, вычисление выражений, ссылки, защита циклов.
       Функция сериализуется в строку и встраивается одной строкой (без комментариев). */
    function previewBridge(T) {
        var P = window.parent;
        function S(v, d) {
            d = d || 0;
            try {
                if (v === null) return "null";
                if (v === undefined) return "undefined";
                var t = typeof v;
                if (t === "string") return d ? JSON.stringify(v) : v;
                if (t === "number" || t === "boolean" || t === "bigint") return String(v);
                if (t === "symbol") return v.toString();
                if (t === "function") return "ƒ " + (v.name || "anonymous") + "()";
                if (v instanceof Error) return v.name + ": " + v.message;
                if (typeof Element !== "undefined" && v instanceof Element) {
                    return "<" + v.tagName.toLowerCase() + (v.id ? "#" + v.id : "") + (typeof v.className === "string" && v.className.trim() ? "." + v.className.trim().split(/\s+/).join(".") : "") + ">";
                }
                if (d > 2) return Array.isArray(v) ? "[…]" : "{…}";
                if (Array.isArray(v)) return "[" + v.slice(0, 50).map(function (x) { return S(x, d + 1); }).join(", ") + (v.length > 50 ? ", …" : "") + "]";
                if (v instanceof Map) return "Map(" + v.size + ")";
                if (v instanceof Set) return "Set(" + v.size + ")";
                if (v instanceof Date) return v.toISOString();
                var keys = Object.keys(v);
                return (v.constructor && v.constructor.name && v.constructor.name !== "Object" ? v.constructor.name + " " : "") + "{" + keys.slice(0, 30).map(function (k) { return k + ": " + S(v[k], d + 1); }).join(", ") + (keys.length > 30 ? ", …" : "") + "}";
            } catch (e) { return String(v); }
        }
        function post(type, level, args, extra) {
            try {
                var m = { __nx: T, type: type, level: level, args: args || [] };
                if (extra) for (var x in extra) m[x] = extra[x];
                P.postMessage(m, "*");
            } catch (e) { }
        }
        ["log", "info", "warn", "error", "debug", "table"].forEach(function (l) {
            var o = console[l] || console.log;
            console[l] = function () {
                post("console", l === "table" || l === "debug" ? "log" : l, [].map.call(arguments, function (a) { return S(a, 0); }));
                try { o.apply(console, arguments); } catch (e) { }
            };
        });
        console.clear = function () { post("clear"); };
        var LS = 0, LN = 0, LW = false;
        window.__nxLoop = function () {
            if (!LS) { LS = Date.now(); LW = false; setTimeout(function () { LS = 0; LN = 0; }, 0); }
            if (++LN % 2000 === 0 && Date.now() - LS > 2500) {
                if (!LW) { LW = true; post("console", "error", ["Цикл выполнялся дольше 2,5 с и был остановлен (защита от зависания)"]); }
                return true;
            }
            return false;
        };
        window.addEventListener("error", function (e) { post("console", "error", [e.message || "Error"], { line: e.lineno || 0, col: e.colno || 0 }); });
        window.addEventListener("unhandledrejection", function (e) { var r = e.reason; post("console", "error", ["Uncaught (in promise) " + (r && r.message ? r.message : S(r, 0))]); });
        window.addEventListener("message", function (e) {
            var d = e.data;
            if (!d || d.__nx !== T || d.type !== "eval") return;
            try { var r = (0, eval)(d.code); post("result", "result", [S(r, 1)]); }
            catch (err) { post("console", "error", [err && err.name ? err.name + ": " + err.message : String(err)]); }
        });
        document.addEventListener("click", function (e) {
            var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
            if (!a) return;
            var h = a.getAttribute("href") || "";
            if (h.charAt(0) === "#" || /^javascript:/i.test(h)) return;
            e.preventDefault();
            post("nav", "", [], { href: h, ext: /^[a-z][a-z0-9+.\-]*:/i.test(h) || h.indexOf("//") === 0 });
        }, true);
        post("ready");
    }
    const BRIDGE_SRC = "(" + previewBridge.toString().replace(/\n\s*/g, " ") + ")";

    /* ================================================================
     * NEXUS IDE — шаблоны проектов
     * ================================================================ */
    const TEMPLATES = {
        web: {
            name: "Веб-страница", icon: "code", entry: "index.html", open: ["index.html", "style.css", "app.js"],
            desc: "HTML + CSS + JavaScript: кнопка, счётчик и часы",
            files: {
                "index.html": [
                    "<!DOCTYPE html>",
                    "<html lang=\"ru\">",
                    "<head>",
                    "  <meta charset=\"utf-8\">",
                    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
                    "  <title>Привет, NEXUS</title>",
                    "  <link rel=\"stylesheet\" href=\"style.css\">",
                    "</head>",
                    "<body>",
                    "  <main class=\"card\">",
                    "    <p class=\"tag\">NEXUS IDE · DEMO</p>",
                    "    <h1>Привет, <span id=\"name\">мир</span>!</h1>",
                    "    <p>Измените код слева — превью обновится само.</p>",
                    "    <label>Как вас зовут?",
                    "      <input id=\"input\" placeholder=\"Ваше имя\" autocomplete=\"off\">",
                    "    </label>",
                    "    <button id=\"btn\" type=\"button\">Нажми меня</button>",
                    "    <p class=\"counter\">Нажатий: <b id=\"count\">0</b></p>",
                    "    <p class=\"clock\" id=\"clock\">--:--:--</p>",
                    "  </main>",
                    "  <script src=\"app.js\"></script>",
                    "</body>",
                    "</html>",
                    ""
                ].join("\n"),
                "style.css": [
                    "/* Тёмная тема в духе NEXUS */",
                    ":root {",
                    "  --accent: #e86e3a;",
                    "  --bg: #0b0c0c;",
                    "}",
                    "",
                    "* { box-sizing: border-box; }",
                    "",
                    "body {",
                    "  margin: 0;",
                    "  min-height: 100vh;",
                    "  display: grid;",
                    "  place-items: center;",
                    "  background: radial-gradient(circle at 30% 20%, #1c1410, var(--bg) 60%);",
                    "  color: #f2e8e1;",
                    "  font: 16px/1.5 system-ui, sans-serif;",
                    "}",
                    "",
                    ".card {",
                    "  width: min(420px, 92vw);",
                    "  padding: 28px;",
                    "  border: 1px solid var(--accent);",
                    "  box-shadow: 0 0 24px rgba(232, 110, 58, 0.25);",
                    "}",
                    "",
                    ".tag {",
                    "  margin: 0;",
                    "  color: var(--accent);",
                    "  font: 12px monospace;",
                    "  letter-spacing: 2px;",
                    "}",
                    "",
                    "h1 { margin: 6px 0 4px; }",
                    "#name { color: var(--accent); }",
                    "",
                    "label { display: grid; gap: 6px; margin: 16px 0; }",
                    "",
                    "input, button {",
                    "  font: inherit;",
                    "  padding: 8px 12px;",
                    "  border: 1px solid var(--accent);",
                    "  background: transparent;",
                    "  color: inherit;",
                    "}",
                    "",
                    "button { background: var(--accent); color: #111; cursor: pointer; }",
                    "button:active { transform: translateY(1px); }",
                    "",
                    ".clock { font: 28px monospace; color: var(--accent); margin-bottom: 0; }",
                    ""
                ].join("\n"),
                "app.js": [
                    "// Логика страницы: события, DOM и консоль",
                    "const input = document.getElementById(\"input\");",
                    "const nameEl = document.getElementById(\"name\");",
                    "const countEl = document.getElementById(\"count\");",
                    "let clicks = 0;",
                    "",
                    "input.addEventListener(\"input\", () => {",
                    "  nameEl.textContent = input.value.trim() || \"мир\";",
                    "});",
                    "",
                    "document.getElementById(\"btn\").addEventListener(\"click\", () => {",
                    "  clicks++;",
                    "  countEl.textContent = clicks;",
                    "  console.log(\"Нажатие №\" + clicks);",
                    "  if (clicks === 10) console.warn(\"Уже 10 нажатий!\");",
                    "});",
                    "",
                    "function tick() {",
                    "  document.getElementById(\"clock\").textContent = new Date().toLocaleTimeString(\"ru-RU\");",
                    "}",
                    "tick();",
                    "setInterval(tick, 1000);",
                    "",
                    "console.info(\"Страница загружена. Попробуйте ввести в консоль: clicks * 2\");",
                    ""
                ].join("\n")
            }
        },
        game: {
            name: "Игра «Змейка»", icon: "lightning", entry: "index.html", open: ["game.js", "index.html"],
            desc: "Canvas, игровой цикл и управление стрелками",
            files: {
                "index.html": [
                    "<!DOCTYPE html>",
                    "<html lang=\"ru\">",
                    "<head>",
                    "  <meta charset=\"utf-8\">",
                    "  <title>Змейка</title>",
                    "  <link rel=\"stylesheet\" href=\"style.css\">",
                    "</head>",
                    "<body>",
                    "  <div class=\"hud\">СЧЁТ <b id=\"score\">0</b> · РЕКОРД <b id=\"best\">0</b></div>",
                    "  <canvas id=\"game\" width=\"400\" height=\"400\"></canvas>",
                    "  <p class=\"help\">Стрелки или WASD · пробел — пауза · кликните по полю, чтобы начать</p>",
                    "  <script src=\"game.js\"></script>",
                    "</body>",
                    "</html>",
                    ""
                ].join("\n"),
                "style.css": [
                    "body {",
                    "  margin: 0;",
                    "  min-height: 100vh;",
                    "  display: flex;",
                    "  flex-direction: column;",
                    "  align-items: center;",
                    "  justify-content: center;",
                    "  gap: 10px;",
                    "  background: #0b0c0c;",
                    "  color: #e86e3a;",
                    "  font: 14px monospace;",
                    "}",
                    "",
                    "canvas {",
                    "  width: min(400px, 90vw);",
                    "  aspect-ratio: 1;",
                    "  border: 1px solid #e86e3a;",
                    "  box-shadow: 0 0 20px rgba(232, 110, 58, 0.3);",
                    "  image-rendering: pixelated;",
                    "}",
                    "",
                    ".hud b { color: #fff; }",
                    ".help { opacity: 0.6; text-align: center; padding: 0 12px; }",
                    ""
                ].join("\n"),
                "game.js": [
                    "// Змейка на canvas: поле 20×20 клеток",
                    "const canvas = document.getElementById(\"game\");",
                    "const ctx = canvas.getContext(\"2d\");",
                    "const SIZE = 20;",
                    "const CELL = canvas.width / SIZE;",
                    "const SPEED = 110; // мс на шаг — сделайте меньше, чтобы ускорить",
                    "",
                    "let snake, dir, nextDir, food, score, paused, over;",
                    "let best = 0;",
                    "",
                    "function reset() {",
                    "  snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];",
                    "  dir = { x: 1, y: 0 };",
                    "  nextDir = dir;",
                    "  score = 0;",
                    "  paused = false;",
                    "  over = false;",
                    "  placeFood();",
                    "  updateHud();",
                    "}",
                    "",
                    "function placeFood() {",
                    "  do {",
                    "    food = { x: Math.floor(Math.random() * SIZE), y: Math.floor(Math.random() * SIZE) };",
                    "  } while (snake.some(p => p.x === food.x && p.y === food.y));",
                    "}",
                    "",
                    "function updateHud() {",
                    "  document.getElementById(\"score\").textContent = score;",
                    "  document.getElementById(\"best\").textContent = best;",
                    "}",
                    "",
                    "function step() {",
                    "  if (paused || over) return;",
                    "  dir = nextDir;",
                    "  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };",
                    "  const hitWall = head.x < 0 || head.y < 0 || head.x >= SIZE || head.y >= SIZE;",
                    "  const hitSelf = snake.some(p => p.x === head.x && p.y === head.y);",
                    "  if (hitWall || hitSelf) {",
                    "    over = true;",
                    "    best = Math.max(best, score);",
                    "    updateHud();",
                    "    console.log(\"Игра окончена. Счёт: \" + score);",
                    "    return;",
                    "  }",
                    "  snake.unshift(head);",
                    "  if (head.x === food.x && head.y === food.y) {",
                    "    score += 10;",
                    "    placeFood();",
                    "    updateHud();",
                    "  } else {",
                    "    snake.pop();",
                    "  }",
                    "}",
                    "",
                    "function draw() {",
                    "  ctx.fillStyle = \"#0b0c0c\";",
                    "  ctx.fillRect(0, 0, canvas.width, canvas.height);",
                    "  ctx.fillStyle = \"rgba(232, 110, 58, 0.08)\";",
                    "  for (let i = 0; i < SIZE; i++) {",
                    "    for (let j = 0; j < SIZE; j++) {",
                    "      if ((i + j) % 2) ctx.fillRect(i * CELL, j * CELL, CELL, CELL);",
                    "    }",
                    "  }",
                    "  ctx.fillStyle = \"#ffffff\";",
                    "  ctx.fillRect(food.x * CELL + 4, food.y * CELL + 4, CELL - 8, CELL - 8);",
                    "  snake.forEach((p, i) => {",
                    "    ctx.fillStyle = i === 0 ? \"#ffb38f\" : \"#e86e3a\";",
                    "    ctx.fillRect(p.x * CELL + 1, p.y * CELL + 1, CELL - 2, CELL - 2);",
                    "  });",
                    "  if (paused || over) {",
                    "    ctx.fillStyle = \"rgba(0, 0, 0, 0.6)\";",
                    "    ctx.fillRect(0, 0, canvas.width, canvas.height);",
                    "    ctx.fillStyle = \"#e86e3a\";",
                    "    ctx.font = \"24px monospace\";",
                    "    ctx.textAlign = \"center\";",
                    "    ctx.fillText(over ? \"GAME OVER · Enter\" : \"ПАУЗА\", canvas.width / 2, canvas.height / 2);",
                    "  }",
                    "}",
                    "",
                    "const KEYS = {",
                    "  ArrowUp: { x: 0, y: -1 }, KeyW: { x: 0, y: -1 },",
                    "  ArrowDown: { x: 0, y: 1 }, KeyS: { x: 0, y: 1 },",
                    "  ArrowLeft: { x: -1, y: 0 }, KeyA: { x: -1, y: 0 },",
                    "  ArrowRight: { x: 1, y: 0 }, KeyD: { x: 1, y: 0 }",
                    "};",
                    "",
                    "document.addEventListener(\"keydown\", e => {",
                    "  const d = KEYS[e.code];",
                    "  if (d && (d.x !== -dir.x || d.y !== -dir.y)) {",
                    "    nextDir = d;",
                    "    e.preventDefault();",
                    "  }",
                    "  if (e.code === \"Space\") { paused = !paused; e.preventDefault(); }",
                    "  if (e.code === \"Enter\" && over) reset();",
                    "});",
                    "canvas.addEventListener(\"click\", () => { if (over) reset(); canvas.focus(); });",
                    "",
                    "reset();",
                    "setInterval(() => { step(); draw(); }, SPEED);",
                    ""
                ].join("\n")
            }
        },
        hud: {
            name: "HUD-виджет", icon: "activity", entry: "index.html", open: ["hud.js", "index.html", "hud.css"],
            desc: "Часы и живой график в стиле eDEX-UI",
            files: {
                "index.html": [
                    "<!DOCTYPE html>",
                    "<html lang=\"ru\">",
                    "<head>",
                    "  <meta charset=\"utf-8\">",
                    "  <title>HUD</title>",
                    "  <link rel=\"stylesheet\" href=\"hud.css\">",
                    "</head>",
                    "<body>",
                    "  <section class=\"panel\">",
                    "    <header><span>PANEL</span><span>SYSTEM</span></header>",
                    "    <h1 id=\"clock\">00:00:00</h1>",
                    "    <div class=\"row\"><span>CPU</span><b id=\"cpu\">0%</b></div>",
                    "    <canvas id=\"graph\" width=\"320\" height=\"90\"></canvas>",
                    "    <div class=\"bars\" id=\"bars\"></div>",
                    "  </section>",
                    "  <script src=\"hud.js\"></script>",
                    "</body>",
                    "</html>",
                    ""
                ].join("\n"),
                "hud.css": [
                    ":root { --c: 232, 110, 58; }",
                    "",
                    "body {",
                    "  margin: 0;",
                    "  min-height: 100vh;",
                    "  display: grid;",
                    "  place-items: center;",
                    "  background: #090b0a;",
                    "  color: rgb(var(--c));",
                    "  font: 13px monospace;",
                    "}",
                    "",
                    ".panel {",
                    "  width: 340px;",
                    "  padding: 10px;",
                    "  border-top: 2px solid rgb(var(--c));",
                    "  background: rgba(var(--c), 0.04);",
                    "}",
                    "",
                    "header {",
                    "  display: flex;",
                    "  justify-content: space-between;",
                    "  border-bottom: 1px solid rgba(var(--c), 0.4);",
                    "  padding-bottom: 4px;",
                    "  font-size: 11px;",
                    "  letter-spacing: 1px;",
                    "}",
                    "",
                    "h1 {",
                    "  margin: 14px 0;",
                    "  text-align: center;",
                    "  font: 42px monospace;",
                    "  letter-spacing: 4px;",
                    "  text-shadow: 0 0 12px rgba(var(--c), 0.6);",
                    "}",
                    "",
                    ".row { display: flex; justify-content: space-between; margin-bottom: 4px; }",
                    "canvas { width: 100%; display: block; }",
                    "",
                    ".bars { display: grid; grid-template-columns: repeat(16, 1fr); gap: 3px; margin-top: 10px; height: 40px; align-items: end; }",
                    ".bars i { background: rgb(var(--c)); opacity: 0.8; transition: height 0.4s; }",
                    ""
                ].join("\n"),
                "hud.js": [
                    "// HUD: часы, график загрузки и столбики",
                    "const graph = document.getElementById(\"graph\");",
                    "const g = graph.getContext(\"2d\");",
                    "const points = new Array(64).fill(0);",
                    "const bars = document.getElementById(\"bars\");",
                    "",
                    "for (let i = 0; i < 16; i++) bars.appendChild(document.createElement(\"i\"));",
                    "",
                    "let load = 30;",
                    "function update() {",
                    "  load = Math.max(3, Math.min(97, load + (Math.random() - 0.5) * 18));",
                    "  points.push(load);",
                    "  points.shift();",
                    "  document.getElementById(\"cpu\").textContent = Math.round(load) + \"%\";",
                    "  document.getElementById(\"clock\").textContent = new Date().toLocaleTimeString(\"ru-RU\");",
                    "  [...bars.children].forEach(b => { b.style.height = (10 + Math.random() * 90) + \"%\"; });",
                    "  draw();",
                    "}",
                    "",
                    "function draw() {",
                    "  const w = graph.width, h = graph.height;",
                    "  g.clearRect(0, 0, w, h);",
                    "  g.strokeStyle = \"rgba(232, 110, 58, 0.15)\";",
                    "  for (let y = 0; y < h; y += h / 4) {",
                    "    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();",
                    "  }",
                    "  g.beginPath();",
                    "  points.forEach((p, i) => {",
                    "    const x = i / (points.length - 1) * w;",
                    "    const y = h - p / 100 * h;",
                    "    i ? g.lineTo(x, y) : g.moveTo(x, y);",
                    "  });",
                    "  g.strokeStyle = \"#e86e3a\";",
                    "  g.lineWidth = 2;",
                    "  g.stroke();",
                    "}",
                    "",
                    "update();",
                    "setInterval(update, 500);",
                    ""
                ].join("\n")
            }
        },
        js: {
            name: "JavaScript-песочница", icon: "terminal", entry: "main.js", open: ["main.js"],
            desc: "Только код и консоль: функции, классы, async",
            files: {
                "main.js": [
                    "// Песочница: результат выводится в консоль справа",
                    "// Выполнить заново — Ctrl+Enter",
                    "",
                    "const greet = name => \"Привет, \" + name + \"!\";",
                    "console.log(greet(\"NEXUS\"));",
                    "",
                    "// Массивы",
                    "const scores = [42, 17, 99, 8, 63];",
                    "console.log(\"Сумма:\", scores.reduce((a, b) => a + b, 0));",
                    "console.log(\"По возрастанию:\", [...scores].sort((a, b) => a - b));",
                    "",
                    "// Классы",
                    "class Player {",
                    "  constructor(name, level) {",
                    "    this.name = name;",
                    "    this.level = level;",
                    "  }",
                    "  levelUp() {",
                    "    this.level++;",
                    "    return this;",
                    "  }",
                    "}",
                    "const p = new Player(\"operator\", 1).levelUp().levelUp();",
                    "console.log(p);",
                    "",
                    "// Асинхронность",
                    "const wait = ms => new Promise(resolve => setTimeout(resolve, ms));",
                    "",
                    "async function countdown() {",
                    "  for (let i = 3; i > 0; i--) {",
                    "    console.info(\"Запуск через \" + i + \"…\");",
                    "    await wait(500);",
                    "  }",
                    "  console.log(\"Готово!\");",
                    "}",
                    "countdown();",
                    "",
                    "// Ошибки тоже видны в консоли — раскомментируйте строку:",
                    "// undefinedFunction();",
                    ""
                ].join("\n")
            }
        },
        blank: {
            name: "Пустой проект", icon: "file", entry: "index.html", open: ["index.html"],
            desc: "Один index.html — начните с чистого листа",
            files: {
                "index.html": [
                    "<!DOCTYPE html>",
                    "<html lang=\"ru\">",
                    "<head>",
                    "  <meta charset=\"utf-8\">",
                    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
                    "  <title>Новый проект</title>",
                    "</head>",
                    "<body>",
                    "  ",
                    "</body>",
                    "</html>",
                    ""
                ].join("\n")
            }
        }
    };
    const NEW_FILE_CONTENT = {
        html: name => `<!DOCTYPE html>\n<html lang="ru">\n<head>\n  <meta charset="utf-8">\n  <title>${name.replace(/\.[^.]+$/, "")}</title>\n</head>\n<body>\n  \n</body>\n</html>\n`,
        css: name => `/* ${name} */\n`,
        js: name => `// ${name}\n`,
        json: () => "{\n  \n}\n",
        md: name => `# ${name.replace(/\.md$/i, "")}\n\n`,
        text: () => ""
    };
    const ALLOWED_EXT = /\.(html?|css|m?js|json|md|txt|svg|xml|csv)$/i;

    /* ================================================================
     * NEXUS IDE — ZIP (без сжатия, метод STORE) для экспорта проекта
     * ================================================================ */
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();
    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }
    function makeZip(files) {
        const enc = new TextEncoder();
        const d = new Date();
        const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
        const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
        const parts = [], central = [];
        let offset = 0;
        files.forEach(f => {
            const name = enc.encode(f.name);
            const data = enc.encode(f.text);
            const crc = crc32(data);
            const lh = new DataView(new ArrayBuffer(30));
            lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
            lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
            lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
            parts.push(lh.buffer, name, data);
            const ch = new DataView(new ArrayBuffer(46));
            ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
            ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
            ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
            ch.setUint32(42, offset, true);
            central.push(ch.buffer, name);
            offset += 30 + name.length + data.length;
        });
        const cdSize = central.reduce((n, b) => n + (b.byteLength !== undefined ? b.byteLength : b.length), 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
        end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
        return new Blob(parts.concat(central, [end.buffer]), { type: "application/zip" });
    }

    /* Markdown → HTML для превью .md */
    function mdToHtml(src) {
        const inline = t => esc(t)
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
            .replace(/\*([^*]+)\*/g, "<i>$1</i>")
            .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, b) => /^(https?:|#|[\w./-]+$)/.test(b) ? `<a href="${b}">${a}</a>` : a);
        const out = [];
        let list = null, code = null, para = [];
        const flush = () => { if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; } if (list) { out.push(`</${list}>`); list = null; } };
        src.split("\n").forEach(line => {
            if (code !== null) {
                if (/^\s*```/.test(line)) { out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); code = null; } else code.push(line);
                return;
            }
            if (/^\s*```/.test(line)) { flush(); code = []; return; }
            let m = /^(#{1,6})\s+(.*)$/.exec(line);
            if (m) { flush(); out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); return; }
            m = /^\s*(?:[-*+]|(\d+)\.)\s+(.*)$/.exec(line);
            if (m) {
                if (para.length) { out.push("<p>" + inline(para.join(" ")) + "</p>"); para = []; }
                const type = m[1] ? "ol" : "ul";
                if (list !== type) { if (list) out.push(`</${list}>`); out.push(`<${type}>`); list = type; }
                out.push("<li>" + inline(m[2]) + "</li>");
                return;
            }
            if (/^\s*>\s?/.test(line)) { flush(); out.push("<blockquote>" + inline(line.replace(/^\s*>\s?/, "")) + "</blockquote>"); return; }
            if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flush(); out.push("<hr>"); return; }
            if (!line.trim()) { flush(); return; }
            if (list) { out.push(`</${list}>`); list = null; }
            para.push(line.trim());
        });
        if (code !== null) out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
        flush();
        return out.join("\n");
    }

    /* ================================================================
     * NEXUS IDE — приложение
     * ================================================================ */
    function initIDE() {
        const el = {
            body: $("#ide-body"), explorer: $("#ide-explorer"), files: $("#ide-files"), tabs: $("#ide-tabs"),
            ta: $("#ide-input"), hl: $("#ide-hl"), hlCode: $("#ide-hl-code"), gutter: $("#ide-gutter"),
            editor: $("#ide-editor"), empty: $("#ide-empty"), frame: $("#ide-frame"), idle: $("#ide-preview-idle"),
            out: $("#ide-console-out"), project: $("#ide-project"), save: $("#ide-save-state"),
            find: $("#ide-find"), findInput: $("#ide-find-input"), replaceInput: $("#ide-replace-input"),
            runCol: $("#ide-run-col"), previewPane: $("#ide-preview-pane")
        };
        const ide = {
            data: null, p: null, active: null, previewFile: null, token: "", lineMap: null,
            dirty: false, saveTimer: 0, runTimer: 0, errors: 0, consoleCount: 0, lastMsg: null,
            history: [], hIndex: 0, collapsed: new Set(), lineH: 22, charW: 8.4, over: false
        };
        const curLine = document.createElement("div");
        curLine.className = "ide-curline";
        el.editor.querySelector(".ide-code").prepend(curLine);

        /* ----- Данные ----- */
        function reloadData() {
            ide.data = IDEStore.get();
        }
        function settings() { return ide.data.settings; }
        function unit() { return " ".repeat(settings().tabSize || 2); }
        function findProject(id) { return ide.data.projects.find(p => p.id === id) || null; }
        function newId() { return "P" + Date.now().toString(36).toUpperCase() + randInt(100, 999); }

        function setSaveState(state) {
            el.save.setAttribute("data-state", state);
            el.save.textContent = { saved: "сохранено", dirty: "не сохранено…", saving: "сохранение…", over: "превышен лимит", error: "ошибка сохранения" }[state] || state;
        }
        function persist(manual) {
            clearTimeout(ide.saveTimer);
            if (!ide.p) return true;
            const size = IDEStore.projectSize(ide.p);
            const lim = IDEStore.limits().ideProjectSize;
            renderMeta();
            if (size > lim) {
                setSaveState("over");
                if (!ide.over || manual) toast(`Проект больше ${formatBytes(lim)} — изменения не сохраняются. Удалите лишнее${serviceTier() === "pro" ? "" : " или оформите NEXUS+ (до 1 МБ)"}`, "warn", { ttl: 6000 });
                ide.over = true;
                return false;
            }
            ide.over = false;
            const snap = JSON.parse(JSON.stringify(ide.p));
            const res = IDEStore.mutate(d => {
                const i = d.projects.findIndex(x => x.id === snap.id);
                if (i >= 0) d.projects[i] = snap; else d.projects.push(snap);
                d.current = snap.id;
                d.settings = ide.data.settings;
            }, { action: "save", id: snap.id });
            ide.dirty = !res.ok;
            setSaveState(res.ok ? "saved" : "error");
            if (!res.ok) toast("Не удалось сохранить проект: хранилище браузера переполнено или недоступно", "warn");
            else if (manual) toast("Проект сохранён", "ok", { ttl: 1800 });
            return res.ok;
        }
        function scheduleSave() {
            ide.dirty = true;
            setSaveState("dirty");
            clearTimeout(ide.saveTimer);
            ide.saveTimer = setTimeout(() => persist(false), 700);
        }
        function saveSettings() {
            IDEStore.mutate(d => { d.settings = ide.data.settings; }, { action: "settings" });
        }

        /* ----- Проекты ----- */
        function renderProjects() {
            const lim = IDEStore.limits();
            el.project.innerHTML = ide.data.projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
            if (ide.p) el.project.value = ide.p.id;
            $("#ide-tier").textContent = `${lim.label} · ${ide.data.projects.length} / ${lim.ideProjects}`;
        }
        function loadProject(id, opts) {
            opts = opts || {};
            if (ide.p && ide.dirty) persist(false);
            const p = findProject(id) || ide.data.projects[0];
            if (!p) return;
            ide.p = p;
            if (!Array.isArray(p.open)) p.open = [];
            p.open = p.open.filter(f => p.files[f] !== undefined);
            if (!p.files[p.entry]) p.entry = Object.keys(p.files).find(f => /\.html?$/i.test(f)) || Object.keys(p.files).find(f => /\.m?js$/i.test(f)) || Object.keys(p.files)[0] || "";
            let active = p.active && p.files[p.active] !== undefined ? p.active : (p.open[0] || p.entry);
            if (active && p.open.indexOf(active) < 0) p.open.push(active);
            ide.previewFile = p.entry;
            ide.collapsed.clear();
            renderProjects();
            renderExplorer();
            openFile(active, { silent: true });
            $("#ide-st-project").textContent = p.name;
            $("#ide-crumb").textContent = `NEXUS IDE / ${p.name.toUpperCase()}`;
            if (window.history.replaceState) window.history.replaceState(null, "", "#p=" + encodeURIComponent(p.id));
            IDEStore.mutate(d => { d.current = p.id; }, { action: "current" });
            clearConsole();
            if (opts.run !== false && (settings().autoRun || opts.run)) run();
            else { el.idle.hidden = false; el.frame.removeAttribute("srcdoc"); }
        }
        function createProject(tplId, name) {
            const lim = IDEStore.limits();
            if (ide.data.projects.length >= lim.ideProjects) { limitModal(); return null; }
            const tpl = TEMPLATES[tplId] || TEMPLATES.web;
            const now = Date.now();
            const p = {
                id: newId(), name: (name || tpl.name).slice(0, 40), template: tplId, entry: tpl.entry,
                files: Object.assign({}, tpl.files), open: tpl.open.slice(), active: tpl.open[0], created: now, updated: now
            };
            const res = IDEStore.mutate(d => { d.projects.push(p); d.current = p.id; }, { action: "create", id: p.id });
            if (!res.ok) { toast("Не удалось создать проект: хранилище браузера переполнено", "warn"); return null; }
            reloadData();
            loadProject(p.id, { run: true });
            Sound.play("granted");
            return p;
        }
        function limitModal() {
            const lim = IDEStore.limits();
            if (serviceTier() === "pro") {
                Modal.open({ title: "Лимит проектов", subtitle: lim.label, html: `<p>Можно хранить до ${lim.ideProjects} проектов. Удалите ненужные, чтобы создать новый.</p>` });
            } else {
                planModal("Лимит проектов", `На тарифе FREE можно хранить ${lim.ideProjects} проекта. Удалите ненужный или оформите NEXUS+ — до 25 проектов.`);
            }
        }
        function newProjectModal() {
            const lim = IDEStore.limits();
            if (ide.data.projects.length >= lim.ideProjects) { limitModal(); return; }
            const cards = Object.keys(TEMPLATES).map((k, i) => {
                const t = TEMPLATES[k];
                return `<label class="tpl-card"><input type="radio" name="ide-tpl" value="${k}"${i === 0 ? " checked" : ""}>
                    <span><img src="assets/icons/${t.icon}.svg" alt="" width="20" height="20"><b>${escapeHtml(t.name)}</b><i>${escapeHtml(t.desc)}</i></span></label>`;
            }).join("");
            Modal.open({
                title: "Новый проект",
                subtitle: `${ide.data.projects.length} / ${lim.ideProjects}`,
                className: "ide-modal",
                html: `<div class="field"><label for="ide-np-name">Название</label><input class="input" id="ide-np-name" type="text" maxlength="40" autocomplete="off" placeholder="Мой проект"><span class="field-error" role="alert"></span></div>
                    <p class="field-label">Шаблон</p><div class="tpl-grid">${cards}</div>`,
                buttons: [{
                    label: "Создать", icon: "plus", primary: true, action: (btn, modal) => {
                        const input = modal.querySelector("#ide-np-name");
                        const tpl = (modal.querySelector("input[name='ide-tpl']:checked") || {}).value || "web";
                        const name = input.value.trim() || TEMPLATES[tpl].name;
                        if (ide.data.projects.some(p => p.name.toLowerCase() === name.toLowerCase())) {
                            input.closest(".field").classList.add("is-invalid");
                            input.closest(".field").querySelector(".field-error").textContent = "Проект с таким названием уже есть";
                            return false;
                        }
                        createProject(tpl, name);
                    }
                }]
            });
            setTimeout(() => { const i = $("#ide-np-name"); if (i) { i.focus(); i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $(".ide-modal .btn-primary").click(); } }); } }, 60);
        }
        function projectModal() {
            const p = ide.p;
            if (!p) return;
            const entries = Object.keys(p.files).filter(f => /\.(html?|m?js|md)$/i.test(f));
            const modal = Modal.open({
                title: "Проект",
                subtitle: escapeHtml(p.name),
                className: "ide-modal",
                html: `<div class="field"><label for="ide-pm-name">Название</label><input class="input" id="ide-pm-name" type="text" maxlength="40" value="${escapeHtml(p.name)}"><span class="field-error" role="alert"></span></div>
                    <div class="field"><label for="ide-pm-entry">Точка входа (запускается в превью)</label><select class="input" id="ide-pm-entry">${entries.map(f => `<option${f === p.entry ? " selected" : ""}>${escapeHtml(f)}</option>`).join("")}</select></div>
                    <dl class="ide-pm-facts">
                        <div><dt>Файлов</dt><dd>${Object.keys(p.files).length}</dd></div>
                        <div><dt>Размер</dt><dd>${formatBytes(IDEStore.projectSize(p))} из ${formatBytes(IDEStore.limits().ideProjectSize)}</dd></div>
                        <div><dt>Создан</dt><dd>${escapeHtml(new Date(p.created).toLocaleString("ru-RU"))}</dd></div>
                        <div><dt>Изменён</dt><dd>${escapeHtml(ago(p.updated))}</dd></div>
                    </dl>
                    <div class="ide-pm-actions">
                        <button class="btn btn-sm" type="button" data-pm="dup"><img src="assets/icons/clipboard.svg" alt="">Дублировать</button>
                        <button class="btn btn-sm" type="button" data-pm="zip"><img src="assets/icons/download.svg" alt="">Скачать ZIP</button>
                        <button class="btn btn-sm btn-danger" type="button" data-pm="del"><img src="assets/icons/close.svg" alt="">Удалить проект</button>
                    </div>`,
                buttons: [{
                    label: "Сохранить", icon: "disk", primary: true, action: (btn, modal) => {
                        const input = modal.querySelector("#ide-pm-name");
                        const name = input.value.trim();
                        const err = t => { input.closest(".field").classList.add("is-invalid"); input.closest(".field").querySelector(".field-error").textContent = t; return false; };
                        if (!name) return err("Введите название");
                        if (ide.data.projects.some(x => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) return err("Проект с таким названием уже есть");
                        p.name = name;
                        p.entry = modal.querySelector("#ide-pm-entry").value || p.entry;
                        ide.previewFile = p.entry;
                        p.updated = Date.now();
                        persist(false);
                        renderProjects();
                        renderExplorer();
                        $("#ide-st-project").textContent = p.name;
                        $("#ide-crumb").textContent = `NEXUS IDE / ${p.name.toUpperCase()}`;
                        toast("Проект обновлён", "ok", { ttl: 1800 });
                        run();
                    }
                }]
            });
            modal.querySelector("[data-pm='dup']").addEventListener("click", () => {
                Modal.close();
                const lim = IDEStore.limits();
                if (ide.data.projects.length >= lim.ideProjects) { limitModal(); return; }
                persist(false);
                const copy = JSON.parse(JSON.stringify(p));
                copy.id = newId();
                let n = 2;
                while (ide.data.projects.some(x => x.name === `${p.name} (${n})`)) n++;
                copy.name = `${p.name} (${n})`.slice(0, 40);
                copy.created = copy.updated = Date.now();
                IDEStore.mutate(d => { d.projects.push(copy); d.current = copy.id; }, { action: "create", id: copy.id });
                reloadData();
                loadProject(copy.id);
                toast(`Создана копия: ${copy.name}`, "ok");
            });
            modal.querySelector("[data-pm='zip']").addEventListener("click", () => { exportZip(); });
            modal.querySelector("[data-pm='del']").addEventListener("click", () => {
                Modal.open({
                    title: "Удалить проект?",
                    subtitle: escapeHtml(p.name),
                    className: "confirm-modal",
                    html: `<p>Проект «${escapeHtml(p.name)}» и все его файлы (${Object.keys(p.files).length}) будут удалены без возможности восстановления. Сначала можно скачать ZIP.</p>`,
                    buttons: [{
                        label: "Удалить", icon: "close", primary: true, action: () => {
                            clearTimeout(ide.saveTimer);
                            ide.dirty = false;
                            IDEStore.mutate(d => { d.projects = d.projects.filter(x => x.id !== p.id); if (d.current === p.id) d.current = null; }, { action: "delete", id: p.id });
                            reloadData();
                            ide.p = null;
                            Sound.play("denied");
                            toast(`Проект «${p.name}» удалён`, "warn");
                            if (ide.data.projects.length) loadProject(ide.data.projects[0].id);
                            else { createProject("web", "Привет, NEXUS"); }
                        }
                    }]
                });
            });
        }
        function exportZip() {
            const p = ide.p;
            if (!p) return;
            persist(false);
            const files = Object.keys(p.files).sort().map(name => ({ name, text: p.files[name] }));
            files.push({ name: "README-NEXUS.txt", text: `${p.name}\nЭкспорт из NEXUS IDE · ${new Date().toISOString()}\nТочка входа: ${p.entry}\nОткройте ${p.entry} в браузере.\n` });
            const safe = p.name.replace(/[^\wа-яё\- ]+/gi, "").trim().replace(/\s+/g, "-") || "project";
            if (downloadBlob(`${safe}.zip`, makeZip(files))) toast(`Архив ${safe}.zip сохранён`, "ok");
        }

        /* ----- Проводник ----- */
        function renderExplorer() {
            const p = ide.p;
            if (!p) { el.files.innerHTML = ""; return; }
            const paths = Object.keys(p.files).sort((a, b) => {
                const da = a.split("/").length, db = b.split("/").length;
                const pa = a.split("/").slice(0, -1).join("/"), pb = b.split("/").slice(0, -1).join("/");
                if (pa !== pb) { if (!pa) return 1; if (!pb) return -1; return pa.localeCompare(pb); }
                return da - db || a.localeCompare(b);
            });
            const dirs = {};
            const root = [];
            paths.forEach(path => {
                const parts = path.split("/");
                if (parts.length === 1) { root.push(path); return; }
                const dir = parts.slice(0, -1).join("/");
                (dirs[dir] = dirs[dir] || []).push(path);
            });
            const fileItem = path => {
                const name = path.split("/").pop();
                const lang = langOf(path);
                const isEntry = path === p.entry;
                return `<li role="treeitem" class="ide-file${path === ide.active ? " is-active" : ""}" aria-selected="${path === ide.active}" data-path="${escapeHtml(path)}">
                    <button class="ide-file-btn" type="button" data-open="${escapeHtml(path)}" title="${escapeHtml(path)}"><span class="ide-ext ext-${lang}">${EXT_BADGE[lang]}</span><span class="ide-fname">${escapeHtml(name)}</span>${isEntry ? '<i class="ide-entry-mark" title="Точка входа">▶</i>' : ""}</button>
                    <span class="ide-file-acts">
                        ${!isEntry && /\.(html?|m?js|md)$/i.test(path) ? `<button type="button" data-entry="${escapeHtml(path)}" title="Сделать точкой входа" aria-label="Сделать точкой входа: ${escapeHtml(name)}">▶</button>` : ""}
                        <button type="button" data-rename="${escapeHtml(path)}" title="Переименовать" aria-label="Переименовать ${escapeHtml(name)}">✎</button>
                        <button type="button" data-delete="${escapeHtml(path)}" title="Удалить" aria-label="Удалить ${escapeHtml(name)}">×</button>
                    </span>
                </li>`;
            };
            let html = "";
            Object.keys(dirs).sort().forEach(dir => {
                const open = !ide.collapsed.has(dir);
                html += `<li role="treeitem" class="ide-dir" aria-expanded="${open}"><button class="ide-dir-btn" type="button" data-dir="${escapeHtml(dir)}"><span class="ide-caret" aria-hidden="true">${open ? "▾" : "▸"}</span><img src="assets/icons/folder.svg" alt="" width="14" height="14">${escapeHtml(dir)}</button>
                    <ul role="group"${open ? "" : " hidden"}>${dirs[dir].map(fileItem).join("")}</ul></li>`;
            });
            html += root.map(fileItem).join("");
            el.files.innerHTML = html || '<li class="ide-files-empty">Файлов нет — создайте первый</li>';
            renderMeta();
        }
        function renderMeta() {
            const p = ide.p;
            if (!p) return;
            const size = IDEStore.projectSize(p);
            const lim = IDEStore.limits().ideProjectSize;
            $("#ide-size").textContent = `${formatBytes(size)} / ${formatBytes(lim)}`;
            const bar = $("#ide-size-bar");
            bar.style.width = clamp(size / lim * 100, 0, 100) + "%";
            bar.classList.toggle("is-warn", size > lim * 0.85);
            $("#ide-entry").textContent = p.entry || "—";
        }
        function validName(name, except) {
            const p = ide.p;
            name = name.trim().replace(/\\/g, "/").replace(/^\/+/, "");
            if (!name) return { error: "Введите имя файла" };
            if (name.length > 80) return { error: "Слишком длинное имя" };
            if (!/^[\w\-. а-яё]+(\/[\w\-. а-яё]+)*$/i.test(name) || /(^|\/)\.\.?($|\/)/.test(name)) return { error: "Допустимы буквы, цифры, «-», «_», «.» и «/» для папок" };
            if (!ALLOWED_EXT.test(name)) return { error: "Поддерживаются .html .css .js .json .md .txt .svg .xml .csv" };
            if (name !== except && Object.keys(p.files).some(f => f.toLowerCase() === name.toLowerCase())) return { error: "Такой файл уже есть" };
            return { name };
        }
        function addFile(name, content) {
            const p = ide.p;
            p.files[name] = content;
            p.updated = Date.now();
            name.split("/").slice(0, -1).forEach((_, i, arr) => ide.collapsed.delete(arr.slice(0, i + 1).join("/")));
            renderExplorer();
            openFile(name);
            scheduleSave();
        }
        el.files.addEventListener("click", e => {
            const t = e.target.closest("button");
            if (!t) return;
            if (t.hasAttribute("data-open")) { openFile(t.getAttribute("data-open")); if (window.innerWidth < 768) setPane("code"); return; }
            if (t.hasAttribute("data-dir")) {
                const d = t.getAttribute("data-dir");
                if (ide.collapsed.has(d)) ide.collapsed.delete(d); else ide.collapsed.add(d);
                Sound.play("folder");
                renderExplorer();
                return;
            }
            if (t.hasAttribute("data-entry")) {
                ide.p.entry = t.getAttribute("data-entry");
                ide.previewFile = ide.p.entry;
                ide.p.updated = Date.now();
                renderExplorer();
                scheduleSave();
                toast(`Точка входа: ${ide.p.entry}`, "info", { ttl: 2000 });
                run();
                return;
            }
            if (t.hasAttribute("data-rename")) { renameModal(t.getAttribute("data-rename")); return; }
            if (t.hasAttribute("data-delete")) { deleteFile(t.getAttribute("data-delete")); }
        });
        function renameModal(path) {
            Modal.open({
                title: "Переименовать файл",
                subtitle: escapeHtml(path),
                className: "ide-modal",
                html: `<div class="field"><label for="ide-rn-input">Новое имя (можно с папкой: css/main.css)</label><input class="input" id="ide-rn-input" type="text" value="${escapeHtml(path)}" autocomplete="off" spellcheck="false"><span class="field-error" role="alert"></span></div>`,
                buttons: [{
                    label: "Переименовать", icon: "edit", primary: true, action: (btn, modal) => {
                        const input = modal.querySelector("#ide-rn-input");
                        const v = validName(input.value, path);
                        if (v.error) { input.closest(".field").classList.add("is-invalid"); input.closest(".field").querySelector(".field-error").textContent = v.error; return false; }
                        if (v.name === path) return;
                        const p = ide.p;
                        p.files[v.name] = p.files[path];
                        delete p.files[path];
                        p.open = p.open.map(f => f === path ? v.name : f);
                        if (p.entry === path) p.entry = v.name;
                        if (ide.active === path) ide.active = v.name;
                        if (ide.previewFile === path) ide.previewFile = v.name;
                        p.updated = Date.now();
                        renderExplorer();
                        openFile(ide.active, { silent: true });
                        scheduleSave();
                        toast(`Файл переименован: ${v.name}`, "ok", { ttl: 2000 });
                    }
                }]
            });
            setTimeout(() => {
                const i = $("#ide-rn-input");
                if (!i) return;
                i.focus();
                const dot = i.value.lastIndexOf(".");
                i.setSelectionRange(i.value.lastIndexOf("/") + 1, dot > 0 ? dot : i.value.length);
                i.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $(".ide-modal .btn-primary").click(); } });
            }, 60);
        }
        function deleteFile(path) {
            const p = ide.p;
            Modal.open({
                title: "Удалить файл?",
                subtitle: escapeHtml(path),
                className: "confirm-modal",
                html: `<p>Файл <code>${escapeHtml(path)}</code> (${formatBytes(IDEStore.utf8Len(p.files[path] || ""))}) будет удалён из проекта «${escapeHtml(p.name)}».</p>`,
                buttons: [{
                    label: "Удалить", icon: "close", primary: true, action: () => {
                        delete p.files[path];
                        p.open = p.open.filter(f => f !== path);
                        if (p.entry === path) p.entry = Object.keys(p.files).find(f => /\.html?$/i.test(f)) || Object.keys(p.files).find(f => /\.m?js$/i.test(f)) || "";
                        if (ide.previewFile === path) ide.previewFile = p.entry;
                        p.updated = Date.now();
                        if (ide.active === path) ide.active = p.open[p.open.length - 1] || null;
                        renderExplorer();
                        openFile(ide.active, { silent: true });
                        scheduleSave();
                        Sound.play("denied");
                    }
                }]
            });
        }
        const newForm = $("#ide-newfile"), newInput = $("#ide-newfile-input"), newErr = $("#ide-newfile-err");
        $("#ide-add-file").addEventListener("click", () => {
            newForm.hidden = !newForm.hidden;
            newErr.textContent = "";
            if (!newForm.hidden) { newInput.value = ""; newInput.focus(); }
        });
        newForm.addEventListener("submit", e => {
            e.preventDefault();
            const v = validName(newInput.value);
            if (v.error) { newErr.textContent = v.error; Sound.play("denied"); return; }
            newForm.hidden = true;
            addFile(v.name, (NEW_FILE_CONTENT[langOf(v.name)] || NEW_FILE_CONTENT.text)(v.name.split("/").pop()));
            Sound.play("granted");
        });
        newInput.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); newForm.hidden = true; } });
        newInput.addEventListener("input", () => { newErr.textContent = ""; });
        const upInput = $("#ide-upload-input");
        $("#ide-upload").addEventListener("click", () => upInput.click());
        upInput.addEventListener("change", () => {
            const list = Array.from(upInput.files || []);
            upInput.value = "";
            let added = 0;
            const next = () => {
                const f = list.shift();
                if (!f) { if (added) toast(`Добавлено файлов: ${added}`, "ok"); return; }
                if (!ALLOWED_EXT.test(f.name)) { toast(`${f.name}: поддерживаются только текстовые файлы`, "warn"); next(); return; }
                if (f.size > 200 * 1024) { toast(`${f.name}: файл больше 200 КБ`, "warn"); next(); return; }
                const reader = new FileReader();
                reader.onload = () => {
                    let name = f.name.replace(/[^\w\-. а-яё]/gi, "_");
                    if (ide.p.files[name] !== undefined) {
                        const dot = name.lastIndexOf(".");
                        let n = 2;
                        while (ide.p.files[`${name.slice(0, dot)}-${n}${name.slice(dot)}`] !== undefined) n++;
                        name = `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
                    }
                    addFile(name, String(reader.result || ""));
                    added++;
                    next();
                };
                reader.onerror = () => { toast(`Не удалось прочитать ${f.name}`, "warn"); next(); };
                reader.readAsText(f);
            };
            next();
        });

        /* ----- Вкладки ----- */
        function renderTabs() {
            const p = ide.p;
            if (!p) { el.tabs.innerHTML = ""; return; }
            el.tabs.innerHTML = p.open.map(path => {
                const lang = langOf(path);
                const on = path === ide.active;
                return `<div class="ide-tab${on ? " is-active" : ""}" role="tab" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-tab="${escapeHtml(path)}" title="${escapeHtml(path)}">
                    <span class="ide-ext ext-${lang}">${EXT_BADGE[lang]}</span><span class="ide-tab-name">${escapeHtml(path.split("/").pop())}</span>
                    <button class="ide-tab-close" type="button" data-close="${escapeHtml(path)}" aria-label="Закрыть ${escapeHtml(path)}" tabindex="-1">×</button></div>`;
            }).join("");
            const act = el.tabs.querySelector(".is-active");
            if (act) act.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
        el.tabs.addEventListener("click", e => {
            const c = e.target.closest("[data-close]");
            if (c) { closeTab(c.getAttribute("data-close")); return; }
            const t = e.target.closest("[data-tab]");
            if (t) openFile(t.getAttribute("data-tab"));
        });
        el.tabs.addEventListener("auxclick", e => {
            const t = e.target.closest("[data-tab]");
            if (t && e.button === 1) { e.preventDefault(); closeTab(t.getAttribute("data-tab")); }
        });
        el.tabs.addEventListener("keydown", e => {
            const t = e.target.closest("[data-tab]");
            if (!t) return;
            const all = $$("[data-tab]", el.tabs);
            const i = all.indexOf(t);
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const n = all[(i + (e.key === "ArrowRight" ? 1 : -1) + all.length) % all.length];
                openFile(n.getAttribute("data-tab"));
                const nt = el.tabs.querySelector(".is-active");
                if (nt) nt.focus();
            } else if (e.key === "Delete") closeTab(t.getAttribute("data-tab"));
            else if (e.key === "Enter") el.ta.focus();
        });
        function closeTab(path) {
            const p = ide.p;
            const i = p.open.indexOf(path);
            if (i < 0) return;
            p.open.splice(i, 1);
            if (ide.active === path) ide.active = p.open[Math.min(i, p.open.length - 1)] || null;
            openFile(ide.active, { silent: true });
            scheduleSave();
        }

        /* ----- Редактор ----- */
        function measure() {
            const fs = settings().fontSize || 14;
            ide.lineH = Math.round(fs * 1.6);
            el.editor.style.setProperty("--ide-fs", fs + "px");
            el.editor.style.setProperty("--ide-lh", ide.lineH + "px");
            el.editor.style.setProperty("--ide-tab", String(settings().tabSize || 2));
            const c = document.createElement("canvas").getContext("2d");
            c.font = `${fs}px "Fira Mono", monospace`;
            ide.charW = c.measureText("0000000000").width / 10 || fs * 0.6;
            $("#ide-st-indent").textContent = `Пробелы: ${settings().tabSize || 2}`;
        }
        function openFile(path, opts) {
            opts = opts || {};
            const p = ide.p;
            if (!path || !p || p.files[path] === undefined) {
                ide.active = null;
                el.ta.value = "";
                el.ta.disabled = true;
                el.empty.hidden = false;
                el.hlCode.innerHTML = "";
                el.gutter.textContent = "";
                renderTabs();
                renderExplorer();
                $("#ide-st-lang").textContent = "—";
                return;
            }
            if (p.open.indexOf(path) < 0) p.open.push(path);
            if (p.open.length > 12) p.open.splice(0, p.open.length - 12);
            const changed = ide.active !== path;
            ide.active = path;
            p.active = path;
            el.ta.disabled = false;
            el.empty.hidden = true;
            if (el.ta.value !== p.files[path] || changed) {
                el.ta.value = p.files[path];
                el.ta.setSelectionRange(0, 0);
                el.ta.scrollTop = 0;
                el.ta.scrollLeft = 0;
            }
            renderCode();
            renderTabs();
            $$(".ide-file", el.files).forEach(li => { const on = li.getAttribute("data-path") === path; li.classList.toggle("is-active", on); li.setAttribute("aria-selected", String(on)); });
            $("#ide-st-lang").textContent = LANG_LABEL[langOf(path)];
            updateCaret();
            if (!opts.silent) { Sound.play("folder"); if (window.innerWidth >= 768) el.ta.focus({ preventScroll: true }); }
            if (find.open) findUpdate();
        }
        let hlRaf = 0;
        function renderCode() {
            cancelAnimationFrame(hlRaf);
            hlRaf = 0;
            const v = el.ta.value;
            const lang = ide.active ? langOf(ide.active) : "text";
            el.hlCode.innerHTML = highlight(lang, v) + "\n ";
            const lines = v.split("\n").length;
            if (Number(el.gutter.dataset.lines) !== lines) {
                el.gutter.dataset.lines = String(lines);
                let s = "";
                for (let i = 1; i <= lines; i++) s += `<span>${i}</span>`;
                el.gutter.innerHTML = s;
            }
            syncScroll();
        }
        function scheduleRender() {
            if (!hlRaf) hlRaf = requestAnimationFrame(renderCode);
        }
        function syncScroll() {
            el.hl.scrollTop = el.ta.scrollTop;
            el.hl.scrollLeft = el.ta.scrollLeft;
            el.gutter.scrollTop = el.ta.scrollTop;
            positionCurLine();
        }
        function caretLine() {
            return el.ta.value.slice(0, el.ta.selectionStart).split("\n").length;
        }
        function positionCurLine() {
            const line = caretLine();
            curLine.style.transform = `translateY(${(line - 1) * ide.lineH - el.ta.scrollTop}px)`;
            curLine.hidden = el.ta.selectionStart !== el.ta.selectionEnd || !ide.active;
        }
        function updateCaret() {
            const v = el.ta.value, s = el.ta.selectionStart;
            const before = v.slice(0, s);
            const line = before.split("\n").length;
            const col = s - before.lastIndexOf("\n");
            const sel = Math.abs(el.ta.selectionEnd - s);
            $("#ide-st-pos").textContent = `Стр ${line}, стлб ${col}${sel ? ` (выделено ${sel})` : ""}`;
            const prev = el.gutter.querySelector(".is-cur");
            if (prev) prev.classList.remove("is-cur");
            const cur = el.gutter.children[line - 1];
            if (cur) cur.classList.add("is-cur");
            positionCurLine();
        }
        function onInput() {
            if (!ide.active || !ide.p) return;
            ide.p.files[ide.active] = el.ta.value;
            ide.p.updated = Date.now();
            scheduleRender();
            updateCaret();
            scheduleSave();
            if (settings().autoRun) {
                clearTimeout(ide.runTimer);
                ide.runTimer = setTimeout(() => run(null, { auto: true }), 900);
            }
        }
        el.ta.addEventListener("input", onInput);
        el.ta.addEventListener("scroll", syncScroll);
        ["keyup", "click", "select", "focus"].forEach(ev => el.ta.addEventListener(ev, updateCaret));
        document.addEventListener("selectionchange", () => { if (document.activeElement === el.ta) updateCaret(); });

        /* Вставка с сохранением истории отмены (Ctrl+Z) */
        function replaceRange(start, end, text, selStart, selEnd) {
            const ta = el.ta;
            ta.focus({ preventScroll: true });
            ta.setSelectionRange(start, end);
            let ok = false;
            try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }
            if (!ok || ta.value.slice(start, start + text.length) !== text) {
                ta.setRangeText(text, start, end, "end");
                onInput();
            }
            if (selStart !== undefined) ta.setSelectionRange(selStart, selEnd === undefined ? selStart : selEnd);
            updateCaret();
        }
        const PAIRS = { "(": ")", "[": "]", "{": "}", "\"": "\"", "'": "'", "`": "`" };
        const CLOSERS = new Set([")", "]", "}", "\"", "'", "`"]);
        function lineBounds(v, s, e) {
            const ls = v.lastIndexOf("\n", s - 1) + 1;
            let le = v.indexOf("\n", e > s && v[e - 1] === "\n" ? e - 1 : e);
            if (le < 0) le = v.length;
            return [ls, le];
        }
        function shiftLines(dir) {
            const ta = el.ta, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
            const [ls, le] = lineBounds(v, s, e);
            const u = unit();
            const lines = v.slice(ls, le).split("\n");
            let first = 0, total = 0;
            const out = lines.map((l, i) => {
                if (dir > 0) { if (i === 0) first = u.length; total += u.length; return u + l; }
                const m = new RegExp("^( {1," + u.length + "}|\\t)").exec(l);
                const d = m ? m[0].length : 0;
                if (i === 0) first = -Math.min(d, s - ls);
                total -= d;
                return l.slice(d);
            });
            replaceRange(ls, le, out.join("\n"), Math.max(ls, s + first), Math.max(ls, e + total));
        }
        function toggleComment() {
            const ta = el.ta, v = ta.value;
            const lang = langOf(ide.active || "");
            const [ls, le] = lineBounds(v, ta.selectionStart, ta.selectionEnd);
            const lines = v.slice(ls, le).split("\n");
            let open, close = "";
            if (lang === "js" || lang === "json") open = "// ";
            else if (lang === "css") { open = "/* "; close = " */"; }
            else if (lang === "html" || lang === "md") { open = "<!-- "; close = " -->"; }
            else return;
            const filled = lines.filter(l => l.trim());
            const o = open.trim(), c = close.trim();
            const isCommented = filled.length && filled.every(l => l.trim().startsWith(o) && (!c || l.trim().endsWith(c)));
            const minIndent = Math.min(...filled.map(l => l.match(/^\s*/)[0].length), 1e9);
            const out = lines.map(l => {
                if (!l.trim()) return l;
                if (isCommented) {
                    let r = l.replace(new RegExp("^(\\s*)" + o.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") + " ?"), "$1");
                    if (c) r = r.replace(new RegExp(" ?" + c.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") + "\\s*$"), "");
                    return r;
                }
                return l.slice(0, minIndent) + open + l.slice(minIndent) + close;
            });
            const text = out.join("\n");
            replaceRange(ls, le, text, ls, ls + text.length);
        }
        function moveLines(dir) {
            const ta = el.ta, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
            const [ls, le] = lineBounds(v, s, e);
            const block = v.slice(ls, le);
            if (dir < 0) {
                if (ls === 0) return;
                const ps = v.lastIndexOf("\n", ls - 2) + 1;
                const prev = v.slice(ps, ls - 1);
                replaceRange(ps, le, block + "\n" + prev, s - prev.length - 1, e - prev.length - 1);
            } else {
                if (le >= v.length) return;
                let ne = v.indexOf("\n", le + 1);
                if (ne < 0) ne = v.length;
                const next = v.slice(le + 1, ne);
                replaceRange(ls, ne, next + "\n" + block, s + next.length + 1, e + next.length + 1);
            }
        }
        function duplicateLines() {
            const ta = el.ta, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
            const [ls, le] = lineBounds(v, s, e);
            const block = v.slice(ls, le);
            replaceRange(le, le, "\n" + block, s + block.length + 1, e + block.length + 1);
        }
        el.ta.addEventListener("keydown", e => {
            const ta = el.ta, v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key;
            if (mod && (key === "s" || key === "S" || key === "ы" || key === "Ы")) { e.preventDefault(); persist(true); return; }
            if (mod && key === "Enter") { e.preventDefault(); run(null, { manual: true }); return; }
            if (mod && (key === "f" || key === "F" || key === "а" || key === "А")) { e.preventDefault(); openFind(false); return; }
            if (mod && (key === "h" || key === "H" || key === "р" || key === "Р")) { e.preventDefault(); openFind(true); return; }
            if (mod && (key === "/" || e.code === "Slash")) { e.preventDefault(); toggleComment(); return; }
            if (e.altKey && e.shiftKey && (key === "ArrowDown" || key === "ArrowUp")) { e.preventDefault(); duplicateLines(); return; }
            if (e.altKey && (key === "ArrowUp" || key === "ArrowDown")) { e.preventDefault(); moveLines(key === "ArrowUp" ? -1 : 1); return; }
            if (key === "Escape" && find.open) { closeFind(); return; }
            if (key === "Tab" && !mod && !e.altKey) {
                e.preventDefault();
                if (e.shiftKey) shiftLines(-1);
                else if (s !== en && v.slice(s, en).indexOf("\n") >= 0) shiftLines(1);
                else replaceRange(s, en, unit(), s + unit().length);
                return;
            }
            if (key === "Enter" && !mod && !e.shiftKey && !e.altKey && !e.isComposing) {
                e.preventDefault();
                const ls = v.lastIndexOf("\n", s - 1) + 1;
                const indent = v.slice(ls, s).match(/^[ \t]*/)[0];
                const before = v.slice(ls, s).replace(/\s+$/, "").slice(-1);
                const after = v[en];
                const lang = langOf(ide.active || "");
                const tagOpen = lang === "html" && /<([a-zA-Z][\w-]*)(?:\s[^<>]*)?>$/.test(v.slice(ls, s)) && v.slice(en, en + 2) === "</";
                if ((PAIRS[before] && PAIRS[before] === after && "([{".indexOf(before) >= 0) || tagOpen) {
                    const ins = "\n" + indent + unit() + "\n" + indent;
                    replaceRange(s, en, ins, s + 1 + indent.length + unit().length);
                } else if ("([{".indexOf(before) >= 0 && before) {
                    const ins = "\n" + indent + unit();
                    replaceRange(s, en, ins, s + ins.length);
                } else {
                    replaceRange(s, en, "\n" + indent, s + 1 + indent.length);
                }
                return;
            }
            if (key === "Backspace" && s === en && s > 0 && !mod) {
                if (PAIRS[v[s - 1]] && PAIRS[v[s - 1]] === v[s]) { e.preventDefault(); replaceRange(s - 1, s + 1, "", s - 1); return; }
                const ls = v.lastIndexOf("\n", s - 1) + 1;
                const lead = v.slice(ls, s);
                const u = unit();
                if (lead.length && /^ +$/.test(lead) && lead.length % u.length === 0) { e.preventDefault(); replaceRange(s - u.length, s, "", s - u.length); return; }
            }
            if (mod || e.altKey || key.length !== 1) return;
            if (CLOSERS.has(key) && s === en && v[s] === key && (key !== "\"" && key !== "'" && key !== "`" || v[s - 1] !== "\\")) {
                e.preventDefault();
                ta.setSelectionRange(s + 1, s + 1);
                updateCaret();
                return;
            }
            if (PAIRS[key]) {
                if (s !== en) { e.preventDefault(); const sel = v.slice(s, en); replaceRange(s, en, key + sel + PAIRS[key], s + 1, en + 1); return; }
                const next = v[s] || "";
                const prev = v[s - 1] || "";
                const quote = key === "\"" || key === "'" || key === "`";
                if ((!next || /[\s)\]};,>]/.test(next)) && (!quote || !/[\w\\]/.test(prev))) {
                    e.preventDefault();
                    replaceRange(s, en, key + PAIRS[key], s + 1);
                    return;
                }
            }
            if (key === ">" && langOf(ide.active || "") === "html" && s === en) {
                const ls = v.lastIndexOf("\n", s - 1) + 1;
                const m = /<([a-zA-Z][\w-]*)(?:\s[^<>]*)?$/.exec(v.slice(Math.max(ls, s - 300), s));
                if (m && v[s - 1] !== "/" && !VOID_TAGS.has(m[1].toLowerCase())) {
                    e.preventDefault();
                    replaceRange(s, en, `></${m[1]}>`, s + 1);
                }
            }
        });

        /* ----- Поиск и замена ----- */
        const find = { open: false, matches: [], idx: -1 };
        function openFind(replace) {
            find.open = true;
            el.find.hidden = false;
            el.find.classList.toggle("with-replace", !!replace || el.find.classList.contains("with-replace"));
            const sel = el.ta.value.slice(el.ta.selectionStart, el.ta.selectionEnd);
            if (sel && sel.indexOf("\n") < 0) el.findInput.value = sel;
            el.findInput.focus();
            el.findInput.select();
            findUpdate();
        }
        function closeFind() {
            find.open = false;
            el.find.hidden = true;
            el.ta.focus();
        }
        function findUpdate() {
            const q = el.findInput.value;
            find.matches = [];
            if (q) {
                const v = el.ta.value.toLowerCase(), ql = q.toLowerCase();
                let i = v.indexOf(ql);
                while (i >= 0 && find.matches.length < 5000) { find.matches.push(i); i = v.indexOf(ql, i + Math.max(1, ql.length)); }
            }
            find.idx = -1;
            $("#ide-find-count").textContent = find.matches.length ? `0 / ${find.matches.length}` : (q ? "нет" : "0 / 0");
        }
        function revealSelection(pos) {
            const v = el.ta.value;
            const before = v.slice(0, pos);
            const line = before.split("\n").length - 1;
            const col = pos - before.lastIndexOf("\n") - 1;
            const top = line * ide.lineH;
            if (top < el.ta.scrollTop || top > el.ta.scrollTop + el.ta.clientHeight - ide.lineH * 2) el.ta.scrollTop = Math.max(0, top - el.ta.clientHeight / 2);
            const x = col * ide.charW;
            if (x < el.ta.scrollLeft || x > el.ta.scrollLeft + el.ta.clientWidth - 60) el.ta.scrollLeft = Math.max(0, x - el.ta.clientWidth / 2);
            syncScroll();
        }
        function findGo(dir) {
            if (!find.matches.length) { findUpdate(); if (!find.matches.length) return; }
            const q = el.findInput.value;
            const s = el.ta.selectionStart, e = el.ta.selectionEnd;
            let i;
            if (dir > 0) { i = find.matches.findIndex(m => m >= (find.idx >= 0 ? e : s)); if (i < 0) i = 0; }
            else { i = -1; for (let k = find.matches.length - 1; k >= 0; k--) if (find.matches[k] < s) { i = k; break; } if (i < 0) i = find.matches.length - 1; }
            find.idx = i;
            const pos = find.matches[i];
            el.ta.setSelectionRange(pos, pos + q.length);
            revealSelection(pos);
            updateCaret();
            $("#ide-find-count").textContent = `${i + 1} / ${find.matches.length}`;
        }
        el.findInput.addEventListener("input", () => { findUpdate(); if (find.matches.length) { el.ta.setSelectionRange(el.ta.selectionStart, el.ta.selectionStart); findGo(1); } });
        el.findInput.addEventListener("keydown", e => {
            if (e.key === "Enter") { e.preventDefault(); findGo(e.shiftKey ? -1 : 1); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFind(); }
        });
        el.replaceInput.addEventListener("keydown", e => {
            if (e.key === "Enter") { e.preventDefault(); $("#ide-replace-one").click(); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeFind(); }
        });
        $("#ide-find-next").addEventListener("click", () => findGo(1));
        $("#ide-find-prev").addEventListener("click", () => findGo(-1));
        $("#ide-find-close").addEventListener("click", closeFind);
        $("#ide-replace-one").addEventListener("click", () => {
            const q = el.findInput.value;
            if (!q) return;
            const s = el.ta.selectionStart, e = el.ta.selectionEnd;
            if (el.ta.value.slice(s, e).toLowerCase() === q.toLowerCase()) {
                const r = el.replaceInput.value;
                replaceRange(s, e, r, s + r.length);
                findUpdate();
            }
            findGo(1);
            el.replaceInput.focus();
        });
        $("#ide-replace-all").addEventListener("click", () => {
            const q = el.findInput.value;
            if (!q) return;
            const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
            const v = el.ta.value;
            const count = (v.match(re) || []).length;
            if (!count) { toast("Совпадений нет", "info", { ttl: 1600 }); return; }
            replaceRange(0, v.length, v.replace(re, () => el.replaceInput.value), 0);
            findUpdate();
            toast(`Заменено: ${count}`, "ok", { ttl: 1800 });
        });

        /* ----- Запуск и консоль ----- */
        function resolvePath(from, href) {
            if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.indexOf("//") === 0) return null;
            href = href.split(/[?#]/)[0];
            const base = from.split("/").slice(0, -1);
            const parts = href.charAt(0) === "/" ? [] : base;
            href.replace(/^\//, "").split("/").forEach(seg => {
                if (seg === "..") parts.pop();
                else if (seg && seg !== ".") parts.push(seg);
            });
            const path = parts.join("/");
            return ide.p.files[path] !== undefined ? path : null;
        }
        const nl = s => (s.match(/\n/g) || []).length;
        const safeScript = s => s.replace(/<\/script/gi, "<\\/script");
        function buildDoc(entry) {
            const files = ide.p.files;
            const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
            const bridge = `<script>${BRIDGE_SRC}(${JSON.stringify(token)});</script>`;
            const regions = [];
            let html = "";
            const lang = langOf(entry);
            if (lang === "js") {
                const pre = `<!DOCTYPE html><html><head><meta charset="utf-8">${bridge}<style>html{color-scheme:dark}body{margin:16px;font:13px/1.6 "Fira Mono",monospace;color:#cfc6bf;background:#0b0c0c}.nx-run{opacity:.6}</style></head><body><p class="nx-run">▶ ${esc(entry)} — вывод в консоли</p>\n<script data-file="${esc(entry)}">\n`;
                const code = safeScript(guardLoops(files[entry]));
                regions.push({ file: entry, start: nl(pre) + 1, end: nl(pre) + 1 + nl(code), extra: 0 });
                html = pre + code + "\n</script>\n</body></html>";
                return { html, token, regions, entry };
            }
            if (lang === "md") {
                html = `<!DOCTYPE html><html><head><meta charset="utf-8">${bridge}<style>html{color-scheme:dark}body{max-width:760px;margin:24px auto;padding:0 18px;font:15px/1.65 system-ui,sans-serif;color:#e9e1db;background:#0b0c0c}a{color:#e86e3a}code,pre{font-family:"Fira Mono",monospace;background:#161312;padding:2px 5px}pre{padding:12px;overflow:auto}blockquote{border-left:3px solid #e86e3a;margin:0;padding-left:12px;opacity:.85}h1,h2,h3{color:#e86e3a}</style></head><body>${mdToHtml(files[entry])}</body></html>`;
                return { html, token, regions, entry };
            }
            if (lang !== "html") {
                html = `<!DOCTYPE html><html><head><meta charset="utf-8">${bridge}</head><body><pre style="white-space:pre-wrap;font:13px monospace;color:#ddd">${esc(files[entry])}</pre></body></html>`;
                return { html, token, regions, entry };
            }
            // HTML: встраиваем локальные CSS / JS / SVG и запоминаем, какие строки откуда
            const src = files[entry] || "";
            const re = /<link\b[^>]*>|<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<img\b[^>]*>/gi;
            let last = 0, m, outLines = 0;
            const emit = s => { html += s; outLines += nl(s); };
            while ((m = re.exec(src))) {
                emit(src.slice(last, m.index));
                last = m.index + m[0].length;
                const tag = m[0];
                if (/^<link/i.test(tag)) {
                    const rel = /rel\s*=\s*["']?([^"'\s>]+)/i.exec(tag);
                    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
                    const f = href && rel && /stylesheet/i.test(rel[1]) ? resolvePath(entry, href[1]) : null;
                    if (f) {
                        const css = files[f].replace(/<\/style/gi, "<\\/style");
                        const head = `<style data-file="${esc(f)}">\n`;
                        const start = outLines + nl(head) + 1;
                        regions.push({ file: f, start, end: start + nl(css), extra: nl(head) + nl(css) + 1 - nl(tag) });
                        emit(head + css + "\n</style>");
                    } else emit(tag);
                } else if (/^<script/i.test(tag)) {
                    const attrs = m[1] || "";
                    const srcAttr = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
                    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || "";
                    const isJS = !type || /javascript|ecmascript/i.test(type);
                    if (srcAttr) {
                        const f = resolvePath(entry, srcAttr[1]);
                        if (f && isJS) {
                            const code = safeScript(guardLoops(files[f]));
                            const head = `<script data-file="${esc(f)}"${attrs.replace(/\bsrc\s*=\s*["'][^"']*["']/i, "").replace(/\b(defer|async)\b/gi, "")}>\n`;
                            const start = outLines + nl(head) + 1;
                            regions.push({ file: f, start, end: start + nl(code), extra: nl(head) + nl(code) + 1 - nl(tag) });
                            emit(head + code + "\n</script>");
                        } else emit(tag);
                    } else if (isJS) {
                        emit(`<script${attrs}>` + guardLoops(m[2]) + "</script>");
                    } else emit(tag);
                } else {
                    const srcM = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag);
                    const f = srcM ? resolvePath(entry, srcM[1]) : null;
                    if (f && /\.svg$/i.test(f)) emit(tag.replace(srcM[0], `src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(files[f])}"`));
                    else emit(tag);
                }
            }
            emit(src.slice(last));
            // Мост — первым в <head> (одной строкой, номера строк не сдвигаются)
            if (/<head\b[^>]*>/i.test(html)) html = html.replace(/<head\b[^>]*>/i, s => s + bridge);
            else if (/<html\b[^>]*>/i.test(html)) html = html.replace(/<html\b[^>]*>/i, s => s + bridge);
            else html = bridge + html;
            return { html, token, regions, entry };
        }
        function mapLine(line) {
            if (!line || !ide.lineMap) return null;
            const r = ide.lineMap.regions.find(x => line >= x.start && line <= x.end);
            if (r) return { file: r.file, line: line - r.start + 1 };
            if (langOf(ide.lineMap.entry) !== "html") return null;
            const extra = ide.lineMap.regions.filter(x => x.end < line).reduce((n, x) => n + x.extra, 0);
            return { file: ide.lineMap.entry, line: Math.max(1, line - extra) };
        }
        function run(file, opts) {
            opts = opts || {};
            const p = ide.p;
            if (!p) return;
            clearTimeout(ide.runTimer);
            const entry = file || ide.previewFile || p.entry;
            if (!entry || p.files[entry] === undefined) {
                el.idle.hidden = false;
                el.idle.querySelector("p").textContent = "Нет точки входа: создайте index.html или main.js";
                return;
            }
            ide.previewFile = entry;
            const doc = buildDoc(entry);
            ide.token = doc.token;
            ide.lineMap = doc;
            clearConsole(true);
            addConsole("sys", `▶ ${entry} · ${timeStr(new Date())}${opts.auto ? " · авто" : ""}`);
            el.frame.srcdoc = doc.html;
            el.idle.hidden = true;
            $("#ide-preview-file").textContent = entry;
            if (opts.manual) {
                Sound.play("granted");
                if (window.innerWidth < 768) setPane(langOf(entry) === "js" ? "console" : "preview");
            }
        }
        function clearConsole(keepHistory) {
            el.out.innerHTML = "";
            ide.errors = 0;
            ide.consoleCount = 0;
            ide.lastMsg = null;
            if (!keepHistory) ide.hIndex = ide.history.length;
            renderProblems();
        }
        function renderProblems() {
            const b = $("#ide-st-problems");
            b.textContent = ide.errors ? `${ide.errors} ${plural(ide.errors, "ошибка", "ошибки", "ошибок")}` : "0 ошибок";
            b.setAttribute("data-count", String(ide.errors));
            const mt = $("#ide-mtab-errors");
            mt.hidden = !ide.errors;
            mt.textContent = String(ide.errors);
            $("#ide-console-count").textContent = String(ide.consoleCount);
        }
        function addConsole(level, text, src) {
            const key = level + "|" + text + "|" + (src ? src.file + src.line : "");
            if (ide.lastMsg && ide.lastMsg.key === key && ide.lastMsg.li.isConnected) {
                ide.lastMsg.n++;
                let badge = ide.lastMsg.li.querySelector(".cl-count");
                if (!badge) { badge = document.createElement("b"); badge.className = "cl-count"; ide.lastMsg.li.prepend(badge); }
                badge.textContent = String(ide.lastMsg.n);
                return;
            }
            const li = document.createElement("li");
            li.className = "cl-" + level;
            const prefix = level === "result" ? "← " : level === "input" ? "› " : "";
            li.innerHTML = `<span class="cl-msg">${escapeHtml(prefix + String(text).slice(0, 5000))}</span>${src ? `<button class="cl-src" type="button" data-goto="${escapeHtml(src.file)}" data-line="${src.line}">${escapeHtml(src.file)}:${src.line}</button>` : ""}`;
            el.out.appendChild(li);
            while (el.out.children.length > 400) el.out.firstChild.remove();
            el.out.scrollTop = el.out.scrollHeight;
            ide.lastMsg = { key, li, n: 1 };
            if (level !== "sys" && level !== "input") ide.consoleCount++;
            if (level === "error") { ide.errors++; Sound.play("denied"); }
            renderProblems();
        }
        el.out.addEventListener("click", e => {
            const b = e.target.closest("[data-goto]");
            if (!b) return;
            gotoLine(b.getAttribute("data-goto"), Number(b.getAttribute("data-line")));
        });
        function gotoLine(file, line) {
            if (ide.p.files[file] === undefined) return;
            openFile(file);
            if (window.innerWidth < 768) setPane("code");
            const lines = el.ta.value.split("\n");
            let pos = 0;
            for (let i = 0; i < Math.min(line - 1, lines.length); i++) pos += lines[i].length + 1;
            el.ta.focus();
            el.ta.setSelectionRange(pos, pos + (lines[line - 1] || "").length);
            revealSelection(pos);
            updateCaret();
        }
        $("#ide-st-problems").addEventListener("click", () => {
            const first = el.out.querySelector(".cl-error");
            if (window.innerWidth < 768) setPane("console");
            if (first) { first.scrollIntoView({ block: "nearest" }); const src = first.querySelector("[data-goto]"); if (src) src.click(); }
        });
        window.addEventListener("message", e => {
            const d = e.data;
            if (!d || d.__nx !== ide.token || e.source !== el.frame.contentWindow) return;
            if (d.type === "console") addConsole(d.level, (d.args || []).join(" "), d.line ? mapLine(d.line) : null);
            else if (d.type === "result") addConsole("result", (d.args || [])[0]);
            else if (d.type === "clear") { clearConsole(true); addConsole("sys", "console.clear()"); }
            else if (d.type === "nav") {
                if (d.ext) { window.open(d.href, "_blank", "noopener"); addConsole("sys", `Внешняя ссылка открыта в новой вкладке: ${d.href}`); return; }
                const f = resolvePath(ide.previewFile, d.href);
                if (f) run(f);
                else addConsole("warn", `Файл не найден в проекте: ${d.href}`);
            }
        });
        const cin = $("#ide-console-input");
        $("#ide-console-form").addEventListener("submit", e => {
            e.preventDefault();
            const code = cin.value.trim();
            if (!code) return;
            ide.history.push(code);
            if (ide.history.length > 50) ide.history.shift();
            ide.hIndex = ide.history.length;
            cin.value = "";
            addConsole("input", code);
            if (!el.frame.contentWindow || el.idle.hidden === false) { run(); setTimeout(() => sendEval(code), 300); }
            else sendEval(code);
        });
        function sendEval(code) {
            try { el.frame.contentWindow.postMessage({ __nx: ide.token, type: "eval", code }, "*"); } catch (e) { addConsole("error", "Превью недоступно"); }
        }
        cin.addEventListener("keydown", e => {
            if (e.key === "ArrowUp" && ide.history.length) { e.preventDefault(); ide.hIndex = Math.max(0, ide.hIndex - 1); cin.value = ide.history[ide.hIndex] || ""; }
            else if (e.key === "ArrowDown") { e.preventDefault(); ide.hIndex = Math.min(ide.history.length, ide.hIndex + 1); cin.value = ide.history[ide.hIndex] || ""; }
        });
        $("#ide-console-clear").addEventListener("click", () => { clearConsole(); Sound.play("panels"); });
        $("#ide-run").addEventListener("click", () => run(null, { manual: true }));
        $("#ide-reload").addEventListener("click", () => run(null, { manual: true }));
        const autoBox = $("#ide-autorun");
        autoBox.addEventListener("change", () => { settings().autoRun = autoBox.checked; saveSettings(); toast(autoBox.checked ? "Автозапуск включён" : "Автозапуск выключен", "info", { ttl: 1600 }); });
        $("#ide-download").addEventListener("click", exportZip);
        $("#ide-new").addEventListener("click", newProjectModal);
        $("#ide-proj-menu").addEventListener("click", projectModal);
        el.project.addEventListener("change", () => { loadProject(el.project.value); Sound.play("folder"); });

        /* ----- Превью во весь экран ----- */
        const fsBtn = $("#ide-fullscreen");
        function setMax(on) {
            el.previewPane.classList.toggle("is-max", on);
            document.documentElement.classList.toggle("ide-max-open", on);
            fsBtn.setAttribute("aria-pressed", String(on));
            fsBtn.title = on ? "Свернуть (Esc)" : "Во весь экран";
        }
        fsBtn.addEventListener("click", () => setMax(!el.previewPane.classList.contains("is-max")));
        document.addEventListener("keydown", e => { if (e.key === "Escape" && el.previewPane.classList.contains("is-max") && !document.querySelector(".modal_popup")) setMax(false); });

        /* ----- Разделители ----- */
        function applyLayout() {
            const s = settings();
            el.body.style.setProperty("--ide-run-w", clamp(s.split, 25, 70) + "%");
            el.runCol.style.setProperty("--ide-console-h", clamp(s.consoleH, 12, 75) + "%");
            el.body.classList.toggle("no-explorer", s.explorer === false);
            $("#ide-explorer-toggle").setAttribute("aria-expanded", String(s.explorer !== false));
            autoBox.checked = !!s.autoRun;
        }
        function dragSplit(handle, axis) {
            handle.addEventListener("pointerdown", e => {
                e.preventDefault();
                handle.setPointerCapture(e.pointerId);
                document.documentElement.classList.add("ide-dragging");
                const move = ev => {
                    if (axis === "x") {
                        const r = el.body.getBoundingClientRect();
                        settings().split = clamp((r.right - ev.clientX) / r.width * 100, 25, 70);
                    } else {
                        const r = el.runCol.getBoundingClientRect();
                        settings().consoleH = clamp((r.bottom - ev.clientY) / r.height * 100, 12, 75);
                    }
                    applyLayout();
                };
                const up = () => {
                    handle.removeEventListener("pointermove", move);
                    handle.removeEventListener("pointerup", up);
                    handle.removeEventListener("pointercancel", up);
                    document.documentElement.classList.remove("ide-dragging");
                    saveSettings();
                };
                handle.addEventListener("pointermove", move);
                handle.addEventListener("pointerup", up);
                handle.addEventListener("pointercancel", up);
            });
            handle.addEventListener("keydown", e => {
                const step = e.shiftKey ? 10 : 3;
                if (axis === "x" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); settings().split = clamp(settings().split + (e.key === "ArrowLeft" ? step : -step), 25, 70); }
                else if (axis === "y" && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); settings().consoleH = clamp(settings().consoleH + (e.key === "ArrowUp" ? step : -step), 12, 75); }
                else return;
                applyLayout();
                saveSettings();
            });
        }
        dragSplit($("#ide-split-v"), "x");
        dragSplit($("#ide-split-h"), "y");
        $("#ide-explorer-toggle").addEventListener("click", () => {
            if (window.innerWidth < 768) { setPane(el.body.getAttribute("data-pane") === "files" ? "code" : "files"); return; }
            settings().explorer = settings().explorer === false;
            applyLayout();
            saveSettings();
        });

        /* ----- Панели на телефоне ----- */
        function setPane(pane) {
            el.body.setAttribute("data-pane", pane);
            $$("#ide-mtabs [data-pane]").forEach(b => b.setAttribute("aria-selected", String(b.getAttribute("data-pane") === pane)));
            if (pane === "code") requestAnimationFrame(syncScroll);
        }
        $("#ide-mtabs").addEventListener("click", e => {
            const b = e.target.closest("[data-pane]");
            if (b) { setPane(b.getAttribute("data-pane")); Sound.play("folder"); }
        });

        /* ----- Настройки и справка ----- */
        $("#ide-settings").addEventListener("click", () => {
            const s = settings();
            Modal.open({
                title: "Настройки редактора",
                className: "ide-modal",
                html: `<div class="field"><label for="ide-set-fs">Размер шрифта</label><select class="input" id="ide-set-fs">${[12, 13, 14, 15, 16, 18, 20].map(n => `<option value="${n}"${n === s.fontSize ? " selected" : ""}>${n} px</option>`).join("")}</select></div>
                    <div class="field"><label for="ide-set-tab">Отступ</label><select class="input" id="ide-set-tab">${[2, 4].map(n => `<option value="${n}"${n === s.tabSize ? " selected" : ""}>${n} пробела</option>`).join("")}</select></div>
                    <label class="toggle"><span class="toggle-text"><b>Автозапуск</b><span>перезапускать превью через секунду после правки</span></span><input type="checkbox" id="ide-set-auto"${s.autoRun ? " checked" : ""}><span class="switch" aria-hidden="true"></span></label>`,
                buttons: [
                    { label: "Сбросить раскладку", icon: "reload", action: () => { Object.assign(s, { split: 46, consoleH: 32, explorer: true }); applyLayout(); saveSettings(); return false; } },
                    {
                        label: "Применить", icon: "checkmark", primary: true, action: (btn, modal) => {
                            s.fontSize = Number(modal.querySelector("#ide-set-fs").value) || 14;
                            s.tabSize = Number(modal.querySelector("#ide-set-tab").value) || 2;
                            s.autoRun = modal.querySelector("#ide-set-auto").checked;
                            saveSettings();
                            measure();
                            applyLayout();
                            renderCode();
                            updateCaret();
                        }
                    }
                ]
            });
        });
        $("#ide-help").addEventListener("click", () => {
            const rows = [
                ["Ctrl + Enter", "запустить превью"], ["Ctrl + S", "сохранить (сохраняется и само)"], ["Ctrl + F / Ctrl + H", "поиск / замена"],
                ["Ctrl + /", "закомментировать строки"], ["Tab / Shift + Tab", "отступ / убрать отступ"], ["Alt + ↑ / ↓", "переместить строку"],
                ["Shift + Alt + ↓", "дублировать строку"], ["Ctrl + Z / Ctrl + Shift + Z", "отменить / вернуть"], ["Esc", "закрыть поиск или полноэкранное превью"]
            ];
            Modal.open({
                title: "Горячие клавиши",
                subtitle: "NEXUS IDE",
                className: "ide-modal",
                html: `<table class="edex-table ide-keys"><tbody>${rows.map(r => `<tr><td><kbd>${escapeHtml(r[0])}</kbd></td><td>${escapeHtml(r[1])}</td></tr>`).join("")}</tbody></table>
                    <p class="svc-muted">Скобки и кавычки закрываются сами, в HTML после «&gt;» добавляется закрывающий тег. Ссылки между страницами проекта работают прямо в превью. В консоли можно выполнить выражение — например, <code>document.title</code>.</p>`
            });
        });

        /* ----- Синхронизация с другими вкладками ----- */
        document.addEventListener("nexus:ide", e => {
            if (!e.detail || e.detail.action !== "sync" || ide.dirty) return;
            const curId = ide.p && ide.p.id;
            reloadData();
            const fresh = curId && findProject(curId);
            if (fresh && ide.p && fresh.updated > ide.p.updated) { loadProject(curId, { run: false }); toast("Проект обновлён в другой вкладке", "info"); }
            else if (!fresh && ide.data.projects.length) loadProject(ide.data.projects[0].id);
            else renderProjects();
        });
        document.addEventListener("nexus:account", () => { renderProjects(); renderMeta(); });
        window.addEventListener("pagehide", () => { if (ide.dirty) persist(false); });
        document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && ide.dirty) persist(false); });
        document.addEventListener("keydown", e => {
            if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S") && document.activeElement !== el.ta && !$("#ide-app").hidden) { e.preventDefault(); persist(true); }
        });

        /* ----- Старт ----- */
        reloadData();
        measure();
        applyLayout();
        if (window.innerWidth < 768) setPane("code");
        const hash = window.location.hash.replace("#", "");
        let target = /^p=/.test(hash) ? decodeURIComponent(hash.slice(2)) : ide.data.current;
        if (!ide.data.projects.length) {
            createProject("web", "Привет, NEXUS");
            toast("Создан первый проект из шаблона «Веб-страница»", "ok", { ttl: 3600 });
        } else {
            loadProject(findProject(target) ? target : ide.data.projects[0].id);
        }
        if (hash === "new") setTimeout(newProjectModal, 400);
        window.addEventListener("hashchange", () => {
            const h = window.location.hash.replace("#", "");
            if (h === "new") newProjectModal();
            else if (/^p=/.test(h)) { const id = decodeURIComponent(h.slice(2)); if (ide.p && id !== ide.p.id && findProject(id)) loadProject(id); }
        });
    }

    /* ================================================================
     * Запуск
     * ================================================================ */
    if (PAGE === "vpn") gate(initVPN);
    else gate(initIDE);
})();
