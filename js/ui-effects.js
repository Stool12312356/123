/*
 * ui-effects.js — общее ядро для всех страниц NEXUS//DEV
 * ------------------------------------------------------------------
 * Браузерные (Vanilla JS) аналоги модулей eDEX-UI для темы «blade».
 * Никакого Electron / Node.js: нет require(), fs, ipc, systeminformation.
 *
 *  - Настройки HUD и сессия пользователя (localStorage)
 *  - Звуки интерфейса (включены по умолчанию, активируются при первом
 *    взаимодействии пользователя со страницей)  ← classes/audiofx.class.js
 *  - Экран загрузки и баннеры ACCESS ...      ← _renderer.js
 *  - Часы, системная информация, сеть, радар  ← clock / sysinfo / netstat / locationGlobe
 *  - Телеметрия игровых серверов
 *  - Модальные окна, тосты, вкладки
 *  - Скрытый терминал-оверлей: клавиша ~ / Ё или кнопка с иконкой терминала
 *  - Данные проектов (PROJECTS) и серверов (SERVERS) — общие для всех страниц
 *
 * Логика отдельных страниц — в js/pages.js (использует window.NEXUS).
 * Сайт работает как с http(s)://, так и с file://.
 * ------------------------------------------------------------------
 */
(function () {
    "use strict";

    /* ================================================================
     * Утилиты
     * ================================================================ */
    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
    const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
    const rand = (min, max) => Math.random() * (max - min) + min;
    const randInt = (min, max) => Math.floor(rand(min, max + 1));
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    const pad = (n, l) => String(n).padStart(l || 2, "0");
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const startTime = Date.now();
    const PAGE = (document.body && document.body.getAttribute("data-page")) || "home";

    const storage = {
        get(key, fallback) {
            try {
                const v = window.localStorage.getItem(key);
                return v === null ? fallback : v;
            } catch (e) {
                return fallback;
            }
        },
        set(key, value) {
            try { window.localStorage.setItem(key, value); } catch (e) { /* приватный режим */ }
        },
        remove(key) {
            try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
        },
        getJSON(key, fallback) {
            try {
                const v = this.get(key, null);
                return v ? JSON.parse(v) : fallback;
            } catch (e) {
                return fallback;
            }
        },
        setJSON(key, value) {
            this.set(key, JSON.stringify(value));
        },
        sessionGet(key) {
            try { return window.sessionStorage.getItem(key); } catch (e) { return null; }
        },
        sessionSet(key, value) {
            try { window.sessionStorage.setItem(key, value); } catch (e) { /* ignore */ }
        }
    };

    function escapeHtml(text) {
        const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    function timeStr(d) {
        d = d || new Date();
        return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function dateStr(d) {
        d = d || new Date();
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    /* Простой хэш строки → число (для стабильных ID и аватаров) */
    function hashString(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return h >>> 0;
    }

    /* Цвет темы читаем из CSS-переменных (blade.json → :root) */
    function readTheme() {
        const cs = getComputedStyle(document.documentElement);
        const r = parseInt(cs.getPropertyValue("--color_r"), 10);
        const g = parseInt(cs.getPropertyValue("--color_g"), 10);
        const b = parseInt(cs.getPropertyValue("--color_b"), 10);
        return { r: isNaN(r) ? 204 : r, g: isNaN(g) ? 94 : g, b: isNaN(b) ? 55 : b };
    }
    const THEME = readTheme();
    const rgba = a => `rgba(${THEME.r}, ${THEME.g}, ${THEME.b}, ${a === undefined ? 1 : a})`;

    /* Выполнять колбэк только пока элемент виден (экономия CPU) */
    function whenVisible(el, onChange) {
        if (!el) return;
        if (!("IntersectionObserver" in window)) {
            onChange(true);
            return;
        }
        const io = new IntersectionObserver(entries => {
            entries.forEach(entry => onChange(entry.isIntersecting));
        }, { rootMargin: "80px" });
        io.observe(el);
    }

    /* ================================================================
     * Настройки HUD (вкладка «Настройки HUD» в кабинете)
     * ================================================================ */
    const Settings = {
        KEY: "nx_settings",
        VERSION: 2,
        defaults: { sfx: true, intro: true, grid: true, glow: true, motion: true, scale: "normal" },
        data: null,
        load() {
            const saved = storage.getJSON(this.KEY, {}) || {};
            // v2: звук включён по умолчанию — старые сохранения без версии получают SFX ON
            if (saved.v !== this.VERSION) {
                saved.sfx = true;
                saved.v = this.VERSION;
            }
            this.data = Object.assign({}, this.defaults, saved);
            return this.data;
        },
        get(key) {
            if (!this.data) this.load();
            return this.data[key];
        },
        set(key, value) {
            if (!this.data) this.load();
            this.data[key] = value;
            this.data.v = this.VERSION;
            storage.setJSON(this.KEY, this.data);
            this.apply();
        },
        reset() {
            this.data = Object.assign({ v: this.VERSION }, this.defaults);
            storage.setJSON(this.KEY, this.data);
            this.apply();
        },
        /* Применение к <html>. Тот же код продублирован инлайном в <head>,
           чтобы при загрузке страницы не было мигания. */
        apply() {
            const d = document.documentElement;
            d.classList.toggle("hud-no-grid", this.get("grid") === false);
            d.classList.toggle("hud-no-glow", this.get("glow") === false);
            d.classList.toggle("hud-reduced", this.get("motion") === false);
            const scale = this.get("scale");
            if (scale && scale !== "normal") d.setAttribute("data-hud-scale", scale);
            else d.removeAttribute("data-hud-scale");
        }
    };
    Settings.load();

    const reducedMotion = () =>
        (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
        Settings.get("motion") === false;

    /* ================================================================
     * Звук (audiofx.class.js)
     * SFX включены по умолчанию, но браузеры запрещают звук до первого
     * действия пользователя — поэтому до первого клика/нажатия клавиши
     * звуки молча пропускаются, а после него «оживают».
     * ================================================================ */
    const Sound = {
        files: {
            stdout: "assets/audio/stdout.wav",
            stdin: "assets/audio/stdin.wav",
            folder: "assets/audio/folder.wav",
            granted: "assets/audio/granted.wav",
            denied: "assets/audio/denied.wav",
            panels: "assets/audio/panels.wav",
            info: "assets/audio/info.wav",
            expand: "assets/audio/expand.wav",
            keyboard: "assets/audio/keyboard.wav",
            theme: "assets/audio/theme.wav"
        },
        /* Мягкие уровни громкости */
        volumes: { stdout: 0.18, stdin: 0.22, folder: 0.28, granted: 0.32, denied: 0.3, panels: 0.25, info: 0.28, expand: 0.28, keyboard: 0.25, theme: 0.3 },
        cache: {},
        lastPlay: {},
        unlocked: false,
        get enabled() {
            return Settings.get("sfx") === true;
        },
        play(name) {
            if (!this.enabled || !this.unlocked || !this.files[name]) return;
            const now = performance.now();
            const gap = (name === "stdout" || name === "stdin") ? 55 : 35;
            if (this.lastPlay[name] && now - this.lastPlay[name] < gap) return;
            this.lastPlay[name] = now;
            try {
                let base = this.cache[name];
                if (!base) {
                    base = new Audio(this.files[name]);
                    base.preload = "auto";
                    this.cache[name] = base;
                }
                const a = base.paused ? base : base.cloneNode(true);
                a.volume = this.volumes[name] || 0.25;
                a.currentTime = 0;
                const p = a.play();
                if (p && typeof p.catch === "function") p.catch(() => { /* автоплей заблокирован браузером */ });
            } catch (e) { /* ignore */ }
        },
        set(on) {
            Settings.set("sfx", !!on);
            this.unlocked = true;
            this.syncUI();
            if (on) this.play("granted");
            toast(on ? "Звуки интерфейса включены" : "Звуки интерфейса выключены");
            document.dispatchEvent(new CustomEvent("nexus:settings"));
        },
        syncUI() {
            const btn = $("#sound-toggle");
            const state = $("#sound-state");
            if (btn) {
                btn.setAttribute("aria-pressed", String(this.enabled));
                btn.setAttribute("title", this.enabled ? "Звуки включены — нажмите, чтобы выключить" : "Звуки выключены — нажмите, чтобы включить");
            }
            if (state) state.textContent = this.enabled ? "ON" : "OFF";
        },
        /* Первое взаимодействие пользователя разблокирует звук */
        armUnlock() {
            const unlock = e => {
                if (this.unlocked) return;
                if (e.type === "keydown" && (e.key === "Tab" || e.key === "Shift")) return;
                this.unlocked = true;
                ["pointerdown", "keydown", "touchstart"].forEach(t => document.removeEventListener(t, unlock, true));
                // Предзагрузка самых частых звуков
                ["stdin", "folder", "info", "granted"].forEach(n => {
                    if (!this.cache[n]) { const a = new Audio(this.files[n]); a.preload = "auto"; this.cache[n] = a; }
                });
            };
            ["pointerdown", "keydown", "touchstart"].forEach(t => document.addEventListener(t, unlock, true));
        }
    };

    function initSoundToggle() {
        const btn = $("#sound-toggle");
        Sound.syncUI();
        Sound.armUnlock();
        if (btn) btn.addEventListener("click", () => Sound.set(!Sound.enabled));

        // Мягкий отклик на клики по кнопкам-ссылкам и карточкам (у остальных элементов свои звуки)
        document.addEventListener("click", e => {
            const el = e.target.closest("a.btn[href], a.how-wrap, .footer-col a, .crumbs a, .brand");
            if (el) Sound.play("folder");
        });
    }

    /* ================================================================
     * Сессия пользователя (демо-авторизация, только localStorage)
     * Пароли НЕ сохраняются — хранится лишь профиль.
     * ================================================================ */
    const LEVELS = {
        1: "OBSERVER",
        2: "MEMBER",
        3: "PLAYTESTER",
        4: "DEVELOPER"
    };
    const ACCESS_CODES = {
        "PLAYTEST": 3,
        "NEXUS-DEV": 4
    };

    const Auth = {
        KEY: "nx_session",
        get() {
            const s = storage.getJSON(this.KEY, null);
            if (!s || !s.callsign) return null;
            if (s.expires && Date.now() > s.expires) {
                storage.remove(this.KEY);
                return null;
            }
            return s;
        },
        isLoggedIn() {
            return !!this.get();
        },
        level() {
            const s = this.get();
            return s ? s.level : 0;
        },
        makeId(callsign) {
            const h = hashString(callsign.toLowerCase()).toString(16).toUpperCase().padStart(8, "0");
            return `NX-${h.slice(0, 4)}-${h.slice(4, 8)}`;
        },
        levelName(level) {
            return LEVELS[level] || "OBSERVER";
        },
        login(opts) {
            const callsign = String(opts.callsign || "guest").trim().slice(0, 24);
            const prev = this.get();
            const now = Date.now();
            const level = clamp(opts.level || 2, 1, 4);
            const same = prev && prev.callsign === callsign;
            const session = {
                callsign,
                email: opts.email || `${callsign.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@nexus.dev.example`,
                id: this.makeId(callsign),
                level,
                demo: !!opts.demo,
                registered: (same && prev.registered) || opts.registered || now,
                lastLogin: now,
                expires: opts.remember === false ? now + 2 * 3600 * 1000 : null,
                avatarSeed: (same && prev.avatarSeed) || 0,
                downloads: (same && prev.downloads) || this.seedDownloads()
            };
            storage.setJSON(this.KEY, session);
            updateUserUI();
            return session;
        },
        update(patch) {
            const s = this.get();
            if (!s) return null;
            Object.assign(s, patch);
            storage.setJSON(this.KEY, s);
            updateUserUI();
            return s;
        },
        logout() {
            storage.remove(this.KEY);
            updateUserUI();
        },
        seedDownloads() {
            const day = 86400000;
            return [
                { build: "NEXUS LAUNCHER", version: "1.4.1", date: Date.now() - 12 * day, size: "38 MiB", sha: "5be0217a", status: "VERIFIED" }
            ];
        },
        addDownload(entry) {
            const s = this.get();
            if (!s) return null;
            s.downloads = [entry].concat(s.downloads || []).slice(0, 20);
            storage.setJSON(this.KEY, s);
            return s;
        }
    };

    /* Индикатор пользователя в шапке и элементы, зависящие от входа */
    function updateUserUI() {
        const s = Auth.get();
        const userEl = $("#header-user");
        if (userEl) userEl.textContent = s ? `${s.callsign.toUpperCase()} · L${s.level}` : "GUEST";
        $$("[data-auth-label]").forEach(el => {
            const [guest, user] = el.getAttribute("data-auth-label").split("|");
            el.textContent = s ? user : guest;
        });
        $$("[data-auth-href]").forEach(el => {
            const [guest, user] = el.getAttribute("data-auth-href").split("|");
            el.setAttribute("href", s ? user : guest);
        });
        const prompt = $("#term-prompt");
        if (prompt) prompt.textContent = `${s ? s.callsign.toLowerCase() : "guest"}@nexus:~$`;
        document.dispatchEvent(new CustomEvent("nexus:auth"));
    }

    /* ================================================================
     * Тосты (HUD-уведомления в углу экрана)
     * type: "ok" | "warn" | "info" (по умолчанию)
     * ================================================================ */
    function toast(text, type, opts) {
        opts = opts || {};
        let wrap = $("#toast-stack");
        if (!wrap) {
            wrap = document.createElement("div");
            wrap.id = "toast-stack";
            wrap.className = "toast-stack";
            wrap.setAttribute("role", "status");
            wrap.setAttribute("aria-live", "polite");
            document.body.appendChild(wrap);
        }
        while (wrap.childElementCount >= 4) wrap.removeChild(wrap.firstChild);
        const el = document.createElement("div");
        el.className = "toast" + (type ? " toast-" + type : "");
        const head = document.createElement("span");
        head.className = "toast-head";
        head.textContent = `${type === "ok" ? "SUCCESS" : type === "warn" ? "WARNING" : "SYSTEM"} · ${timeStr()}`;
        const body = document.createElement("span");
        body.className = "toast-body";
        body.textContent = text;
        const bar = document.createElement("i");
        bar.className = "toast-bar";
        el.appendChild(head);
        el.appendChild(body);
        el.appendChild(bar);
        el.addEventListener("click", () => dismiss());
        wrap.appendChild(el);
        const ttl = opts.ttl || 3600;
        bar.style.animationDuration = ttl + "ms";
        let gone = false;
        const dismiss = () => {
            if (gone) return;
            gone = true;
            el.classList.add("leaving");
            setTimeout(() => el.remove(), 320);
        };
        setTimeout(dismiss, ttl);
        return el;
    }

    /* ================================================================
     * Экран загрузки (boot_screen) — по мотивам _renderer.js
     * ================================================================ */
    /* edex-ui/src/assets/misc/boot_log.txt из eDEX-UI (встроен, чтобы работать через file://) */
    const BOOT_LOG = [
        "Welcome to NEXUS//DEV!",
        "vm_page_bootstrap: 987323 free pages and 53061 wired pages",
        "kext submap [0xffffff7f8072e000 - 0xffffff8000000000], kernel text [0xffffff8000200000 - 0xffffff800072e000]",
        "zone leak detection enabled",
        "standard timeslicing quantum is 10000 us",
        "mig_table_max_displ = 72",
        "TSC Deadline Timer supported and enabled",
        "eDEXACPICPU: ProcessorId=1 LocalApicId=0 Enabled",
        "eDEXACPICPU: ProcessorId=2 LocalApicId=2 Enabled",
        "eDEXACPICPU: ProcessorId=3 LocalApicId=1 Enabled",
        "eDEXACPICPU: ProcessorId=4 LocalApicId=3 Enabled",
        "eDEXACPICPU: ProcessorId=5 LocalApicId=255 Disabled",
        "eDEXACPICPU: ProcessorId=6 LocalApicId=255 Disabled",
        "eDEXACPICPU: ProcessorId=7 LocalApicId=255 Disabled",
        "eDEXACPICPU: ProcessorId=8 LocalApicId=255 Disabled",
        "calling mpo_policy_init for TMSafetyNet",
        "Security policy loaded: Safety net for Rollback (TMSafetyNet)",
        "calling mpo_policy_init for Sandbox",
        "Security policy loaded: Seatbelt sandbox policy (Sandbox)",
        "calling mpo_policy_init for Quarantine",
        "Security policy loaded: Quarantine policy (Quarantine)",
        "Copyright (c) 1982, 1986, 1989, 1991, 1993, 2015",
        "The Regents of the University of Adelaide. All rights reserved.",
        "",
        "HN_ Framework successfully initialized",
        "using 16384 buffer headers and 10240 cluster IO buffer headers",
        "IOAPIC: Version 0x20 Vectors 64:87",
        "ACPI: System State [S0 S3 S4 S5] (S3)",
        "PFM64 0xf10000000, 0xf0000000",
        "[ PCI configuration begin ]",
        "eDEXIntelCPUPowerManagement: Turbo Ratios 0046",
        "eDEXIntelCPUPowerManagement: (built 13:08:12 Jun 18 2011) initialization complete",
        "console relocated to 0xf10000000",
        "PCI configuration changed (bridge=16 device=4 cardbus=0)",
        "[ PCI configuration end, bridges 12 devices 16 ]",
        "mbinit: done [64 MB total pool size, (42/21) split]",
        "Pthread support ABORTS when sync kernel primitives misused",
        "com.eDEX.eDEXFSCompressionTypeZlib kmod start",
        "com.eDEX.eDEXTrololoBootScreen kmod start",
        "com.eDEX.eDEXFSCompressionTypeZlib load succeeded",
        "com.eDEX.eDEXFSCompressionTypeDataless load succeeded",
        "",
        "eDEXIntelCPUPowerManagementClient: ready",
        "BTCOEXIST off",
        "wl0: Broadcom BCM4331 802.11 Wireless Controller",
        "5.100.98.75",
        "",
        "FireWire (OHCI) Lucent ID 5901 built-in now active, GUID c82a14fffee4a086; max speed s800.",
        "rooting via boot-uuid from /chosen: F5670083-AC74-33D3-8361-AC1977EE4AA2",
        "Waiting on <dict ID=\"0\"><key>IOProviderClass</key><string ID=\"1\">",
        "IOResources</string><key>IOResourceMatch</key><string ID=\"2\">boot-uuid-media</string></dict>",
        "Got boot device = IOService:/eDEXACPIPlatformExpert/PCI0@0/eDEXACPIPCI/SATA@1F,2/",
        "eDEXIntelPchSeriesAHCI/PRT0@0/IOAHCIDevice@0/eDEXAHCIDiskDriver/SarahI@sTheBestDriverIOAHCIBlockStorageDevice/IOBlockStorageDriver/",
        "eDEX SSD TS128C Media/IOGUIDPartitionScheme/Customer@2",
        "BSD root: disk0s2, major 14, minor 2",
        "Kernel is LP64",
        "IOThunderboltSwitch::i2cWriteDWord - status = 0xe00002ed",
        "IOThunderboltSwitch::i2cWriteDWord - status = 0x00000000",
        "IOThunderboltSwitch::i2cWriteDWord - status = 0xe00002ed",
        "IOThunderboltSwitch::i2cWriteDWord - status = 0xe00002ed",
        "eDEXUSBMultitouchDriver::checkStatus - received Status Packet, Payload 2: device was reinitialized",
        "MottIsAScrub::checkstatus - true, Mott::Scrub",
        "[IOBluetoothHCIController::setConfigState] calling registerService",
        "AirPort_Brcm4331: Ethernet address e4:ce:8f:46:18:d2",
        "IO80211Controller::dataLinkLayerAttachComplete():  adding eDEXEFINVRAM notification",
        "IO80211Interface::efiNVRAMPublished():",
        "Created virtif 0xffffff800c32ee00 p2p0",
        "BCM5701Enet: Ethernet address c8:2a:14:57:a4:7a",
        "Previous Shutdown Cause: 3",
        "NTFS driver 3.8 [Flags: R/W].",
        "NTFS volume name BOOTCAMP, version 3.1.",
        "DSMOS has arrived",
        "en1: 802.11d country code set to 'US'.",
        "en1: Supported channels 1 2 3 4 5 6 7 8 9 10 11 36 40 44 48 52 56 60 64 100 104 108 112 116 120 124 128 132 136 140 149 153 157 161 165",
        "m_thebest",
        "MacAuthEvent en1   Auth result for: 00:60:64:1e:e9:e4  MAC AUTH succeeded",
        "MacAuthEvent en1   Auth result for: 00:60:64:1e:e9:e4 Unsolicited  Auth",
        "wlEvent: en1 en1 Link UP",
        "AirPort: Link Up on en1",
        "en1: BSSID changed to 00:60:64:1e:e9:e4",
        "virtual bool IOHIDEventSystemUserClient::initWithTask(task*, void*, UInt32):",
        "Client task not privileged to open IOHIDSystem for mapping memory (e00002c1)",
        "",
        "",
        "Boot Complete"
    ];

    const Boot = {
        running: false,
        skipped: false,
        timers: [],
        wait(ms) {
            return new Promise(resolve => {
                if (this.skipped) { resolve(); return; }
                const id = setTimeout(resolve, ms);
                this.timers.push({ id, resolve });
            });
        },
        skip() {
            if (!this.running || this.skipped) return;
            this.skipped = true;
            this.timers.forEach(t => { clearTimeout(t.id); t.resolve(); });
            this.timers = [];
        },
        async run() {
            if (this.running) return;
            this.running = true;
            this.skipped = false;

            const body = document.body;
            body.classList.add("is-booting", "solidBackground");

            const screen = document.createElement("section");
            screen.id = "boot_screen";
            screen.setAttribute("aria-hidden", "true");
            const log = document.createElement("div");
            log.className = "boot_log";
            screen.appendChild(log);

            const skipBtn = document.createElement("button");
            skipBtn.type = "button";
            skipBtn.className = "boot_skip";
            skipBtn.textContent = "SKIP [ESC]";

            body.appendChild(screen);
            body.appendChild(skipBtn);

            const onKey = e => {
                if (e.key === "Escape" || e.key === "Enter" || e.key === " ") Boot.skip();
            };
            const onClick = () => Boot.skip();
            skipBtn.addEventListener("click", onClick);
            screen.addEventListener("click", onClick);
            document.addEventListener("keydown", onKey);

            const appendLine = text => {
                const div = document.createElement("div");
                div.textContent = text;
                log.appendChild(div);
                if (log.childElementCount > 120) log.removeChild(log.firstChild);
            };

            // displayLine(): построчный вывод лога (ускорен ~в 2 раза относительно оригинала)
            let debt = 0;
            for (let i = 0; i < BOOT_LOG.length && !this.skipped; i++) {
                const line = BOOT_LOG[i];
                appendLine(line);
                Sound.play(line === "Boot Complete" ? "granted" : "stdout");
                const n = i + 1;
                if (n === 2) {
                    appendLine(`NEXUS//DEV Kernel version 2.0.0 boot at ${new Date().toString()}; root:xnu-1699.22.73~1/RELEASE_X86_64`);
                }
                let ms;
                if (n === 2 || n === 4) ms = 140;
                else if (n > 4 && n < 25) ms = 7;
                else if (n === 25) ms = 110;
                else if (n === 42) ms = 80;
                else if (n > 42 && n < 82) ms = 6;
                else if (n >= BOOT_LOG.length - 2) ms = 90;
                else ms = 6;
                debt += ms;
                if (debt >= 32) {
                    await this.wait(debt);
                    debt = 0;
                }
            }

            // displayTitleScreen(): логотип и glitch-эффект
            if (!this.skipped) {
                log.remove();
                Sound.play("theme");
                await this.wait(200);
            }
            if (!this.skipped) {
                await titleSequence(screen, "NEXUS//DEV", this.wait.bind(this), true);
            }

            document.removeEventListener("keydown", onKey);
            screen.remove();
            skipBtn.remove();
            body.classList.remove("is-booting", "solidBackground");
            storage.sessionSet("nx_booted", "1");
            this.running = false;
        }
    };

    /* Последовательность заголовка из displayTitleScreen() */
    async function titleSequence(screen, text, wait, full) {
        const body = document.body;
        body.classList.remove("solidBackground");
        screen.classList.add("center");
        const title = document.createElement("h1");
        title.textContent = text;
        title.setAttribute("data-text", text);
        screen.innerHTML = "";
        screen.appendChild(title);

        await wait(160);
        body.classList.add("solidBackground");
        await wait(90);
        title.className = "flash";
        await wait(240);
        title.className = "boxed";
        await wait(90);
        title.className = "glitch";
        await wait(420);
        body.classList.remove("solidBackground");
        title.className = "boxed";
        await wait(full ? 500 : 380);
        return title;
    }

    /* Полноэкранный баннер «ACCESS GRANTED / DENIED» в стиле экрана загрузки */
    async function showBanner(text, opts) {
        opts = opts || {};
        const screen = document.createElement("section");
        screen.id = "boot_screen";
        screen.className = "center banner" + (opts.denied ? " is-denied" : "");
        screen.setAttribute("role", "alert");
        document.body.appendChild(screen);
        document.body.classList.add("is-booting");
        Sound.play(opts.denied ? "denied" : "granted");
        let dismissed = false;
        screen.addEventListener("click", () => { dismissed = true; });
        if (reducedMotion()) {
            screen.innerHTML = `<h1 class="boxed" data-text="${escapeHtml(text)}">${escapeHtml(text)}</h1>`;
            await delay(800);
        } else {
            await titleSequence(screen, text, ms => dismissed ? Promise.resolve() : delay(ms), false);
        }
        if (opts.sub) {
            const p = document.createElement("p");
            p.className = "banner-sub";
            p.textContent = opts.sub;
            screen.appendChild(p);
            if (!dismissed) await delay(450);
        }
        if (!opts.keep) {
            screen.remove();
            document.body.classList.remove("is-booting", "solidBackground");
        }
        return screen;
    }

    function shouldBoot() {
        if (PAGE !== "home") return false;
        if (reducedMotion()) return false;
        if (Settings.get("intro") === false) return false;
        if (storage.sessionGet("nx_booted") === "1") return false;
        if (window.location.hash && window.location.hash !== "#top") return false;
        return true;
    }

    /* Появление интерфейса после загрузки (initUI) */
    function revealUI() {
        document.body.classList.remove("ui-ready");
        void document.body.offsetWidth;
        document.body.classList.add("ui-ready");
        Sound.play("expand");
        document.dispatchEvent(new CustomEvent("nexus:ready"));
    }

    /* ================================================================
     * Часы (clock.class.js)
     * ================================================================ */
    function initClock() {
        const clock = $("#clock");
        const headerClock = $("#header-clock");
        const headerTz = $("#header-tz");
        if (headerTz) {
            const off = -new Date().getTimezoneOffset() / 60;
            headerTz.textContent = (off >= 0 ? "+" : "") + off;
        }
        const spans = clock ? clock.querySelectorAll("span") : [];
        const tick = () => {
            const d = new Date();
            const str = pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
            for (let i = 0; i < spans.length && i < 6; i++) {
                if (spans[i].textContent !== str[i]) spans[i].textContent = str[i];
            }
            if (headerClock) headerClock.textContent = timeStr(d);
        };
        tick();
        setInterval(tick, 1000);
    }

    /* ================================================================
     * Системная информация (sysinfo.class.js)
     * ================================================================ */
    function detectOS() {
        const ua = navigator.userAgent || "";
        const uaData = navigator.userAgentData;
        const platform = (uaData && uaData.platform) || navigator.platform || "";
        if (/android/i.test(ua)) return { short: "android", full: "Android" };
        if (/iphone|ipad|ipod/i.test(ua)) return { short: "ios", full: "iOS" };
        if (/win/i.test(platform) || /windows/i.test(ua)) return { short: "win32", full: "Windows" };
        if (/mac/i.test(platform) || /mac os/i.test(ua)) return { short: "darwin", full: "macOS" };
        if (/cros/i.test(ua)) return { short: "chromeos", full: "ChromeOS" };
        if (/linux/i.test(platform) || /linux/i.test(ua)) return { short: "linux", full: "Linux" };
        return { short: "web", full: "Unknown" };
    }

    function detectBrowser() {
        const ua = navigator.userAgent || "";
        if (/edg\//i.test(ua)) return "Edge";
        if (/opr\//i.test(ua)) return "Opera";
        if (/firefox|fxios/i.test(ua)) return "Firefox";
        if (/chrome|crios|chromium/i.test(ua)) return "Chromium";
        if (/safari/i.test(ua)) return "Safari";
        return "Browser";
    }

    function formatUptime(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        return `${h}:${pad(m)}:${pad(s % 60)}`;
    }

    function initSysinfo() {
        const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
        const os = detectOS();
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

        set("sys-type", os.short);
        const tick = () => {
            const d = new Date();
            set("sys-year", String(d.getFullYear()));
            set("sys-date", `${months[d.getMonth()]} ${d.getDate()}`);
            set("sys-uptime", formatUptime(Date.now() - startTime));
        };
        tick();
        setInterval(tick, 1000);

        if (typeof navigator.getBattery === "function") {
            navigator.getBattery().then(battery => {
                const update = () => {
                    if (battery.charging && battery.level >= 1) set("sys-power", "WIRED");
                    else if (battery.charging) set("sys-power", "CHARGE");
                    else set("sys-power", Math.round(battery.level * 100) + "%");
                };
                update();
                battery.addEventListener("levelchange", update);
                battery.addEventListener("chargingchange", update);
            }).catch(() => set("sys-power", "ON"));
        } else {
            set("sys-power", "ON");
        }

        $$(".js-year").forEach(el => { el.textContent = String(new Date().getFullYear()); });
    }

    /* Случайное блуждание в пределах [min, max] */
    function walker(start, min, max, stepSize, spikeChance) {
        let v = start;
        return () => {
            v += rand(-stepSize, stepSize);
            if (spikeChance && Math.random() < spikeChance) v += rand(stepSize * 2, stepSize * 5);
            v = clamp(v, min, max);
            return v;
        };
    }

    /* ================================================================
     * Сеть (netstat.class.js)
     * ================================================================ */
    const Net = { online: navigator.onLine !== false };

    function initNetwork() {
        const stateEl = $("#net-state");
        const typeEl = $("#net-type");
        const pingEl = $("#net-ping");
        const uplinkState = $("#uplink-state");
        const uplinkDot = $("#uplink-dot");

        const paint = () => {
            const label = Net.online ? "ONLINE" : "OFFLINE";
            if (stateEl) stateEl.textContent = label;
            if (uplinkState) uplinkState.textContent = label;
            if (uplinkDot) uplinkDot.classList.toggle("is-offline", !Net.online);
        };
        const applyOnline = () => {
            Net.online = navigator.onLine !== false;
            paint();
            Syslog.add(Net.online ? "netstat: uplink restored, interface UP" : "netstat: uplink lost, interface DOWN", !Net.online);
            toast(Net.online ? "Соединение восстановлено" : "Нет соединения с сетью", Net.online ? "ok" : "warn");
            Telemetry.emit();
        };
        window.addEventListener("online", applyOnline);
        window.addEventListener("offline", applyOnline);
        paint();

        const nc = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        const updateType = () => {
            if (!typeEl) return;
            if (nc && nc.effectiveType) {
                const down = nc.downlink ? ` · ${nc.downlink} Mb/s` : "";
                typeEl.textContent = nc.effectiveType.toUpperCase() + down;
            } else {
                typeEl.textContent = "BROADBAND";
            }
        };
        updateType();
        if (nc && typeof nc.addEventListener === "function") nc.addEventListener("change", updateType);

        if (!pingEl) return;
        const ping = walker(24, 9, 80, 4, 0.03);
        setInterval(() => {
            if (!Net.online) { pingEl.textContent = "-- ms"; return; }
            const rtt = nc && nc.rtt ? nc.rtt / 2 + ping() / 2 : ping();
            pingEl.textContent = Math.round(rtt) + " ms";
        }, 2000);
    }

    /* ================================================================
     * Игровые серверы (общие данные для главной, радара и кабинета)
     * ================================================================ */
    const SERVERS = [
        { id: "mc-hub-01", name: "NEXUS CRAFT · Hub", type: "MINECRAFT", city: "Франкфурт", cc: "DE", angle: 15, dist: 0.28, ping: 12, cpu: 31, ram: 44, players: 86, max: 300, status: "online", uptime: 99.98, software: "Velocity 3.3 / Paper 1.21.1" },
        { id: "mc-surv-01", name: "Survival+ (Fortify Mod)", type: "MINECRAFT", city: "Франкфурт", cc: "DE", angle: 40, dist: 0.36, ping: 14, cpu: 58, ram: 71, players: 142, max: 200, status: "online", uptime: 99.95, software: "Fabric 1.21.1 + Fortify 0.9" },
        { id: "mc-build-01", name: "Creative / Build", type: "MINECRAFT", city: "Хельсинки", cc: "FI", angle: 330, dist: 0.82, ping: 31, cpu: 22, ram: 39, players: 37, max: 120, status: "online", uptime: 99.97, software: "Paper 1.21.1 + WorldEdit" },
        { id: "mc-games-01", name: "Mini-games", type: "MINECRAFT", city: "Амстердам", cc: "NL", angle: 285, dist: 0.48, ping: 47, cpu: 83, ram: 77, players: 58, max: 150, status: "degraded", uptime: 99.61, software: "Paper 1.21.1 + Minigames 3.2" },
        { id: "ue5-pt-01", name: "BASTION Playtest EU-1", type: "UE5", city: "Варшава", cc: "PL", angle: 95, dist: 0.6, ping: 24, cpu: 64, ram: 58, players: 12, max: 16, status: "online", uptime: 99.12, software: "UE 5.4 Dedicated Server (0.3.7)" },
        { id: "ue5-pt-02", name: "BASTION Playtest EU-2", type: "UE5", city: "Прага", cc: "CZ", angle: 135, dist: 0.42, ping: 0, cpu: 0, ram: 0, players: 0, max: 16, status: "offline", uptime: 97.84, software: "UE 5.4 Dedicated Server (0.3.7)" },
        { id: "net-api-01", name: "NEXUS ID / API", type: "NETWORK", city: "Амстердам", cc: "NL", angle: 250, dist: 0.7, ping: 18, cpu: 17, ram: 33, players: 412, max: 0, status: "online", uptime: 99.99, software: "Docker / Nginx / Postgres 16" }
    ];
    SERVERS.forEach(n => {
        n.pid = randInt(1200, 9800);
        n.lock = false;
    });

    const Telemetry = {
        listeners: [],
        on(fn) { this.listeners.push(fn); },
        emit() { this.listeners.forEach(fn => fn(SERVERS)); },
        isUp(n) { return n.status === "online" || n.status === "degraded"; },
        summary() {
            const up = SERVERS.filter(n => this.isUp(n));
            const avgPing = up.length ? up.reduce((s, n) => s + n.ping, 0) / up.length : 0;
            const players = SERVERS.filter(n => n.max > 0).reduce((s, n) => s + (this.isUp(n) ? n.players : 0), 0);
            const core = Telemetry.find("net-api-01");
            return { online: up.length, total: SERVERS.length, avgPing, players, coreUp: !!core && this.isUp(core) };
        },
        find(id) { return SERVERS.find(n => n.id === id); }
    };

    function formatPlayers(n) {
        if (!Telemetry.isUp(n)) return "—";
        return n.max > 0 ? `${Math.round(n.players)}/${n.max}` : `${Math.round(n.players)} сес.`;
    }

    /*
     * tickTelemetry() — точка интеграции с реальным мониторингом.
     * Замените тело функции на fetch() к своему API и заполните SERVERS.
     */
    function tickTelemetry() {
        SERVERS.forEach(n => {
            if (n.lock) return; // сервер в процессе перезапуска (кабинет)
            const r = Math.random();
            const prev = n.status;
            if (n.status === "offline" && n.type !== "UE5" && r < 0.04) n.status = "online";
            else if (n.status === "online" && r < 0.003) n.status = "degraded";
            else if (n.status === "degraded" && r < 0.06) n.status = "online";
            else if (n.status === "online" && n.id !== "net-api-01" && r > 0.9988) n.status = "offline";

            if (n.status === "offline") {
                n.ping = 0; n.cpu = 0; n.ram = 0; n.players = 0;
            } else {
                const base = n.status === "degraded" ? 50 : 10 + n.dist * 24;
                n.ping = clamp((n.ping || base) + rand(-3, 3), base * 0.7, base * 1.5);
                n.cpu = clamp((n.cpu || 30) + rand(-6, 6), 5, n.status === "degraded" ? 98 : 90);
                n.ram = clamp((n.ram || 40) + rand(-2, 2), 15, 92);
                const cap = n.max > 0 ? n.max : 900;
                n.players = clamp(Math.round((n.players || 1) + rand(-4, 4.4)), 0, cap);
            }
            n.changed = prev !== n.status;
            if (n.changed) {
                const msg = n.status === "offline" ? `healthcheck: ${n.id} (${n.name}) is DOWN`
                    : n.status === "degraded" ? `healthcheck: ${n.id} latency ${Math.round(n.ping)} ms`
                        : `healthcheck: ${n.id} is back ONLINE`;
                Syslog.add(msg, n.status !== "online");
            }
        });
        Telemetry.emit();
    }

    function statusBadge(s) {
        switch (s) {
            case "online": return '<span class="badge badge-online">ONLINE</span>';
            case "degraded": return '<span class="badge badge-degraded">DEGRADED</span>';
            case "restarting": return '<span class="badge badge-restarting">RESTARTING</span>';
            default: return '<span class="badge badge-offline">OFFLINE</span>';
        }
    }

    /* Сводки по сети: [data-sum="online|players|ping|releases|state"], шапка */
    function initSummary() {
        const head = $("#header-servers");
        const render = () => {
            const s = Telemetry.summary();
            const ok = Net.online && s.coreUp;
            if (head) head.textContent = `${s.online}/${s.total}`;
            $$("[data-sum='online']").forEach(el => { el.textContent = `${s.online}/${s.total}`; });
            $$("[data-sum='ping']").forEach(el => { el.textContent = Math.round(s.avgPing) + " ms"; });
            $$("[data-sum='players']").forEach(el => { el.textContent = String(s.players); });
            $$("[data-sum='releases']").forEach(el => { el.textContent = String(PROJECTS.filter(p => p.status === "available").length); });
            $$("[data-sum='state']").forEach(el => { el.textContent = ok ? "SYSTEM ONLINE" : "SYSTEM DEGRADED"; });
            $$("[data-sum-state]").forEach(el => el.classList.toggle("is-degraded", !ok));
        };
        Telemetry.on(render);
        render();
    }

    /* TOP SERVERS (toplist.class.js) — кабинет */
    function initToplist() {
        const tbody = $("#toplist tbody");
        if (!tbody) return;
        const render = () => {
            const top = SERVERS.filter(n => Telemetry.isUp(n)).sort((a, b) => b.cpu - a.cpu).slice(0, 5);
            tbody.innerHTML = top.map(n => `<tr><td>${n.pid}</td><td>${escapeHtml(n.id)}</td><td>${n.max > 0 ? Math.round(n.players) : "—"}</td><td>${Math.round(n.cpu)}%</td></tr>`).join("");
        };
        Telemetry.on(render);
        render();
    }

    /* ================================================================
     * Радар серверов (замена 3D-глобуса locationGlobe.class.js) — кабинет
     * ================================================================ */
    function initRadar() {
        const canvas = $("#radar-canvas");
        if (!canvas || !canvas.getContext) return;
        const ctx = canvas.getContext("2d");
        const info = $("#radar-info");
        let visible = true;
        let angle = 0;
        let last = performance.now();
        let dpr = 1;

        const resize = () => {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
            const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        };
        resize();
        if ("ResizeObserver" in window) new ResizeObserver(resize).observe(canvas);
        else window.addEventListener("resize", resize);

        const updateInfo = () => { if (info) info.textContent = `${Telemetry.summary().online}/${SERVERS.length} SERVERS`; };
        Telemetry.on(updateInfo);
        updateInfo();

        const draw = now => {
            const dt = Math.min(100, now - last);
            last = now;
            if (visible) {
                if (!reducedMotion()) angle = (angle + dt * 0.0012) % (Math.PI * 2);
                const w = canvas.width, h = canvas.height;
                const cx = w / 2, cy = h / 2;
                const R = Math.min(w, h) / 2 - 4 * dpr;
                if (R < 10) { requestAnimationFrame(draw); return; } // canvas скрыт (display: none)
                ctx.clearRect(0, 0, w, h);

                ctx.lineWidth = 1 * dpr;
                for (let i = 1; i <= 4; i++) {
                    ctx.beginPath();
                    ctx.arc(cx, cy, R * i / 4, 0, Math.PI * 2);
                    ctx.strokeStyle = rgba(i === 4 ? 0.5 : 0.18);
                    ctx.stroke();
                }
                ctx.beginPath();
                ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
                ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
                ctx.strokeStyle = rgba(0.15);
                ctx.stroke();
                for (let i = 0; i < 72; i++) {
                    const a = i * Math.PI / 36;
                    const len = i % 6 === 0 ? 7 : 3;
                    ctx.beginPath();
                    ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
                    ctx.lineTo(cx + Math.cos(a) * (R - len * dpr), cy + Math.sin(a) * (R - len * dpr));
                    ctx.strokeStyle = rgba(0.45);
                    ctx.stroke();
                }

                const sweep = 0.9;
                for (let i = 0; i < 24; i++) {
                    const a0 = angle - sweep * (i / 24);
                    const a1 = angle - sweep * ((i + 1) / 24);
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    ctx.arc(cx, cy, R, a1, a0);
                    ctx.closePath();
                    ctx.fillStyle = rgba(0.22 * (1 - i / 24));
                    ctx.fill();
                }
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R);
                ctx.strokeStyle = rgba(0.9);
                ctx.lineWidth = 1.5 * dpr;
                ctx.stroke();

                SERVERS.forEach(n => {
                    const a = n.angle * Math.PI / 180;
                    const x = cx + Math.cos(a) * R * n.dist;
                    const y = cy + Math.sin(a) * R * n.dist;
                    let diff = (angle - a) % (Math.PI * 2);
                    if (diff < 0) diff += Math.PI * 2;
                    const glow = Math.max(0, 1 - diff / 2.4);
                    if (!Telemetry.isUp(n)) {
                        ctx.beginPath();
                        ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2);
                        ctx.setLineDash([2 * dpr, 2 * dpr]);
                        ctx.strokeStyle = rgba(0.5);
                        ctx.lineWidth = 1 * dpr;
                        ctx.stroke();
                        ctx.setLineDash([]);
                    } else {
                        ctx.beginPath();
                        if (n.type === "UE5") {
                            const s = (3 + glow * 2.5) * dpr;
                            ctx.rect(x - s, y - s, s * 2, s * 2);
                        } else {
                            ctx.arc(x, y, (2.5 + glow * 2.5) * dpr, 0, Math.PI * 2);
                        }
                        ctx.fillStyle = rgba(0.35 + glow * 0.65);
                        ctx.fill();
                    }
                    if (glow > 0.05 || n.status !== "online") {
                        ctx.font = `${10 * dpr}px "Fira Mono", monospace`;
                        ctx.fillStyle = rgba(Math.max(0.35, glow));
                        ctx.fillText(n.id, x + 7 * dpr, y - 5 * dpr);
                    }
                });

                ctx.beginPath();
                ctx.arc(cx, cy, 2.5 * dpr, 0, Math.PI * 2);
                ctx.fillStyle = rgba(1);
                ctx.fill();
            }
            requestAnimationFrame(draw);
        };
        whenVisible(canvas, v => { visible = v; });
        requestAnimationFrame(draw);
    }

    /* ================================================================
     * SYSLOG — кольцевой буфер событий (просмотр: команда «syslog» в терминале)
     * ================================================================ */
    const NICKS = ["Kobalt_Fox", "trench_rat", "Aster", "Nyx404", "ironwolf", "pixel_sapper", "Mira", "hedgehog_mk2", "Lumen", "ByteKnight", "vasya_builder", "Orbital"];

    const Syslog = {
        buffer: [],
        add(text, warn) {
            this.buffer.push({ ts: timeStr(), text, warn: !!warn });
            if (this.buffer.length > 120) this.buffer.shift();
        },
        tail(n) {
            return this.buffer.slice(-(n || 20));
        },
        init() {
            const tpl = [
                () => { const n = pick(SERVERS.filter(s => s.type === "MINECRAFT" && Telemetry.isUp(s))); return n ? `[${n.id}] ${pick(NICKS)} joined the game` : null; },
                () => `cdn: ${pick(PROJECTS.filter(p => p.status === "available")).title} — ${randInt(3, 40)} downloads/min`,
                () => `backup: mc-surv-01 world snapshot saved (${rand(1.8, 3.2).toFixed(1)} GiB)`,
                () => `nexus-id: ${randInt(2, 40)} logins/min, 0 failed signatures`
            ];
            this.add("syslogd: started, kernel log buffer attached");
            this.add("boot: NEXUS//DEV web shell initialised (adapted from eDEX-UI)");
            const loop = () => {
                const line = pick(tpl)();
                if (line) this.add(line);
                setTimeout(loop, rand(2000, 5000));
            };
            setTimeout(loop, 1500);
        }
    };

    /* ================================================================
     * Вкладки (ul[role=tablist]) — для всех страниц
     * ================================================================ */
    const Tabs = {
        activate(tab, focus) {
            const list = tab.closest("[role='tablist']");
            if (!list) return;
            const tabs = $$("[role='tab']", list);
            tabs.forEach(t => {
                const selected = t === tab;
                t.setAttribute("aria-selected", String(selected));
                t.tabIndex = selected ? 0 : -1;
                t.parentElement.classList.toggle("active", selected);
                const panel = document.getElementById(t.getAttribute("aria-controls"));
                if (panel) {
                    panel.hidden = !selected;
                    panel.classList.toggle("active", selected);
                }
            });
            if (focus) tab.focus();
            Sound.play("folder");
            tab.dispatchEvent(new CustomEvent("nexus:tab", { bubbles: true, detail: { id: tab.id } }));
        },
        byId(id) {
            const t = document.getElementById(id);
            if (t) this.activate(t, false);
        },
        init() {
            $$("[role='tablist']").forEach(list => {
                const tabs = $$("[role='tab']", list);
                tabs.forEach((tab, i) => {
                    tab.addEventListener("click", () => {
                        if (tab.getAttribute("aria-selected") === "true") return;
                        Tabs.activate(tab, false);
                    });
                    tab.addEventListener("keydown", e => {
                        let idx = null;
                        if (e.key === "ArrowRight") idx = (i + 1) % tabs.length;
                        else if (e.key === "ArrowLeft") idx = (i - 1 + tabs.length) % tabs.length;
                        else if (e.key === "Home") idx = 0;
                        else if (e.key === "End") idx = tabs.length - 1;
                        if (idx !== null) {
                            e.preventDefault();
                            Tabs.activate(tabs[idx], true);
                        }
                    });
                });
            });
        }
    };

    /* ================================================================
     * Каталог проектов (центр загрузок)
     * status: "available" — доступно для скачивания
     *         "closed"    — закрытый тест (нужен уровень допуска)
     *         "dev"       — в разработке (dev-снапшоты для разработчиков)
     * access: минимальный уровень допуска для скачивания (0 — без входа)
     * ================================================================ */
    const CATEGORIES = { ue5: "UNREAL ENGINE 5", minecraft: "MINECRAFT", network: "PLATFORM" };
    const STATUSES = {
        available: { label: "ДОСТУПНО ДЛЯ СКАЧИВАНИЯ", short: "ДОСТУПНО" },
        closed: { label: "ЗАКРЫТЫЙ ТЕСТ", short: "ЗАКРЫТЫЙ ТЕСТ" },
        dev: { label: "В РАЗРАБОТКЕ", short: "В РАЗРАБОТКЕ" }
    };

    const PROJECTS = [
        {
            id: "launcher",
            code: "NX-00",
            title: "NEXUS LAUNCHER",
            category: "network",
            status: "available",
            access: 0,
            icon: "terminal",
            summary: "Лаунчер экосистемы: вход через NEXUS ID, установка и автообновление всех сборок в один клик.",
            version: "1.4.2",
            size: "38 MiB",
            sizeMB: 38,
            platform: "Windows · Linux",
            updated: "2026-11-04",
            file: "NexusLauncher-1.4.2-setup.exe",
            requirements: "Windows 10+ или Linux (glibc 2.31+), 200 MiB свободного места.",
            notes: [
                { version: "1.4.2", date: "2026-11-04", items: ["Возобновление прерванных загрузок", "Проверка SHA-256 после установки", "Исправлен вылет при смене папки библиотеки"] },
                { version: "1.4.0", date: "2026-10-12", items: ["Вход через NEXUS ID", "Каналы обновлений: stable / playtest"] }
            ]
        },
        {
            id: "fortify",
            code: "NX-11",
            title: "FORTIFY MOD",
            category: "minecraft",
            status: "available",
            access: 0,
            icon: "java",
            summary: "Мод для Minecraft: окопы, мешки с песком, колючая проволока и противотанковые ежи.",
            version: "0.9.2-beta",
            size: "4.1 MiB",
            sizeMB: 4.1,
            platform: "Fabric · Java 1.21.1",
            updated: "2026-10-30",
            file: "fortify-0.9.2-beta+fabric-1.21.1.jar",
            requirements: "Minecraft Java 1.21.1, Fabric Loader 0.16+, Fabric API.",
            notes: [
                { version: "0.9.2-beta", date: "2026-10-30", items: ["Совместимость с Sodium 0.6", "Ежи блокируют вагонетки и лошадей", "Исправлено дублирование мешков с песком"] },
                { version: "0.9.0-beta", date: "2026-10-02", items: ["Колючая проволока", "Чертежи укреплений и инструмент сапёра"] }
            ]
        },
        {
            id: "modpack",
            code: "NX-10",
            title: "NEXUS CRAFT MODPACK",
            category: "minecraft",
            status: "available",
            access: 0,
            icon: "minecraft",
            summary: "Готовая сборка для серверов NEXUS CRAFT: моды, настройки и адрес сервера уже внутри.",
            version: "2026.4",
            size: "212 MiB",
            sizeMB: 212,
            platform: "Fabric · Java 1.21.1",
            updated: "2026-11-05",
            file: "nexus-craft-2026.4.mrpack",
            requirements: "Minecraft Java 1.21.1, 4 GiB RAM для клиента. Установка через NEXUS LAUNCHER или Modrinth App.",
            notes: [
                { version: "2026.4", date: "2026-11-05", items: ["Новый сезон Survival+", "FORTIFY 0.9.2, Sodium 0.6, Voice Chat 2.5", "Оптимизированы настройки шейдеров"] },
                { version: "2026.3", date: "2026-08-21", items: ["Мини-игры «Осада» и «Сапёр»"] }
            ]
        },
        {
            id: "bastion",
            code: "NX-01",
            title: "BASTION: LINE ZERO",
            category: "ue5",
            status: "closed",
            access: 3,
            icon: "unreal",
            summary: "Тактическая RTS на Unreal Engine 5 с инженерной обороной и упрощённым градостроительством.",
            version: "0.3.7-prealpha",
            size: "18.4 GiB",
            sizeMB: 18841,
            platform: "Windows · DX12",
            updated: "2026-11-02",
            file: "BASTION-0.3.7-prealpha-Win64.zip",
            requirements: "Windows 10/11 64-bit, GTX 1070 / RX 5600 XT, 16 GiB RAM, SSD. Нужен уровень допуска PLAYTESTER.",
            notes: [
                { version: "0.3.7", date: "2026-11-02", items: ["Копание траншей перестраивает навигацию за < 40 мс", "Противотанковые ежи можно разбирать сапёрами", "Исправлено мерцание Lumen на краях рвов"] },
                { version: "0.3.6", date: "2026-10-14", items: ["Рвы и противотанковые ежи", "ИИ техники учитывает препятствия"] }
            ]
        },
        {
            id: "trenchworks",
            code: "NX-02",
            title: "TRENCHWORKS",
            category: "ue5",
            status: "dev",
            access: 4,
            icon: "cpp",
            summary: "Плагин UE5 для деформации ландшафта в реальном времени: окопы, рвы и перестройка навигации.",
            version: "0.6.1-alpha",
            size: "36 MiB",
            sizeMB: 36,
            platform: "UE 5.4 · Win64 / Linux",
            updated: "2026-10-27",
            file: "Trenchworks-0.6.1-UE5.4.zip",
            requirements: "Unreal Engine 5.4. Dev-снапшоты доступны с уровнем допуска DEVELOPER.",
            notes: [
                { version: "0.6.1", date: "2026-10-27", items: ["Брустверы из вынутого грунта", "Сохранение изменений в ячейках World Partition"] }
            ]
        },
        {
            id: "nexustech",
            code: "NX-12",
            title: "NEXUS TECH",
            category: "minecraft",
            status: "dev",
            access: 4,
            icon: "gradle",
            summary: "Sci-Fi мод: энергосети, дроны-строители и щитовые генераторы для баз.",
            version: "0.2.0-dev",
            size: "9.8 MiB",
            sizeMB: 9.8,
            platform: "NeoForge · Java 1.21.1",
            updated: "2026-10-12",
            file: "nexus-tech-0.2.0-dev+neoforge-1.21.1.jar",
            requirements: "Minecraft Java 1.21.1, NeoForge 21.1. Dev-снапшоты доступны с уровнем допуска DEVELOPER.",
            notes: [
                { version: "0.2.0-dev", date: "2026-10-12", items: ["Первые дроны-строители", "Энергосеть и кабели"] }
            ]
        }
    ];

    /* ================================================================
     * Модальные окна (modal.class.js) — перетаскиваются за заголовок
     * ================================================================ */
    const Modal = {
        current: null,
        lastFocus: null,
        open(opts) {
            this.close(true);
            // Окно не должно оказаться под терминалом-оверлеем (например, «open <id>» на странице проектов)
            if (Terminal.isOpen) Terminal.close();
            this.lastFocus = document.activeElement;

            const backdrop = document.createElement("div");
            backdrop.className = "modal_backdrop";

            const modal = document.createElement("div");
            modal.className = "modal_popup info" + (opts.className ? " " + opts.className : "");
            modal.setAttribute("augmented-ui", "tr-clip bl-clip exe");
            modal.setAttribute("role", "dialog");
            modal.setAttribute("aria-modal", "true");
            modal.setAttribute("aria-labelledby", "modal_title");
            modal.innerHTML = `
                <button class="modal_close" type="button" aria-label="Закрыть"><img src="assets/icons/close.svg" alt=""></button>
                <h1 id="modal_title">${opts.title}${opts.subtitle ? ` <i>${opts.subtitle}</i>` : ""}</h1>
                <div class="modal_body">${opts.html}</div>
                <div class="modal_actions"></div>`;
            const actions = modal.querySelector(".modal_actions");
            (opts.buttons || []).concat(opts.noClose ? [] : [{ label: "Закрыть", close: true }]).forEach(b => {
                const el = document.createElement(b.href ? "a" : "button");
                el.className = "btn" + (b.primary ? " btn-primary" : "");
                if (b.icon) {
                    const img = document.createElement("img");
                    img.src = `assets/icons/${b.icon}.svg`;
                    img.alt = "";
                    el.appendChild(img);
                }
                el.appendChild(document.createTextNode(b.label));
                if (b.href) {
                    el.href = b.href;
                } else {
                    el.type = "button";
                }
                el.addEventListener("click", e => {
                    if (b.action) {
                        e.preventDefault();
                        const keep = b.action(el, modal) === false;
                        if (!keep) this.close();
                        return;
                    }
                    if (b.close) this.close();
                });
                actions.appendChild(el);
            });

            document.body.appendChild(backdrop);
            document.body.appendChild(modal);
            requestAnimationFrame(() => {
                backdrop.classList.add("visible");
                modal.classList.add("is-open");
            });

            backdrop.addEventListener("click", () => this.close());
            modal.querySelector(".modal_close").addEventListener("click", () => this.close());
            this.makeDraggable(modal, modal.querySelector("h1"));

            const onKey = e => {
                if (e.key === "Escape") this.close();
                if (e.key === "Tab") {
                    const f = $$("a[href], button:not([disabled]), input, [tabindex]:not([tabindex='-1'])", modal);
                    if (!f.length) return;
                    const first = f[0], last = f[f.length - 1];
                    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
                    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
                }
            };
            document.addEventListener("keydown", onKey);

            this.current = { modal, backdrop, onKey, onClose: opts.onClose };
            Sound.play("info");
            setTimeout(() => {
                const btn = modal.querySelector(".modal_close");
                if (btn) btn.focus({ preventScroll: true });
            }, 30);
            return modal;
        },
        close(silent) {
            if (!this.current) return;
            const { modal, backdrop, onKey, onClose } = this.current;
            document.removeEventListener("keydown", onKey);
            this.current = null;
            if (silent || reducedMotion()) {
                modal.remove();
                backdrop.remove();
            } else {
                modal.classList.remove("is-open");
                modal.classList.add("is-closing");
                backdrop.classList.remove("visible");
                setTimeout(() => { modal.remove(); backdrop.remove(); }, 180);
                Sound.play("panels");
            }
            if (typeof onClose === "function") onClose();
            if (!silent && this.lastFocus && typeof this.lastFocus.focus === "function") {
                this.lastFocus.focus({ preventScroll: true });
            }
        },
        makeDraggable(modal, handle) {
            if (!handle) return;
            let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
            handle.addEventListener("pointerdown", e => {
                if (e.button !== 0 || window.innerWidth < 768) return;
                const rect = modal.getBoundingClientRect();
                modal.style.transform = "none";
                modal.style.left = rect.left + "px";
                modal.style.top = rect.top + "px";
                sx = e.clientX; sy = e.clientY; ox = rect.left; oy = rect.top;
                dragging = true;
                handle.setPointerCapture(e.pointerId);
            });
            handle.addEventListener("pointermove", e => {
                if (!dragging) return;
                const w = modal.offsetWidth;
                const x = clamp(ox + e.clientX - sx, -w + 80, window.innerWidth - 80);
                const y = clamp(oy + e.clientY - sy, 0, window.innerHeight - 60);
                modal.style.left = x + "px";
                modal.style.top = y + "px";
            });
            const stop = e => {
                dragging = false;
                if (handle.hasPointerCapture && handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
            };
            handle.addEventListener("pointerup", stop);
            handle.addEventListener("pointercancel", stop);
        }
    };

    /* ================================================================
     * Документы (FAQ, правила, лицензия) — открываются в модальном окне
     * по кнопкам с атрибутом data-doc
     * ================================================================ */
    const DOCS = {
        faq: {
            title: "FAQ",
            subtitle: "частые вопросы",
            html: `
                <h5>Что такое NEXUS//DEV?</h5>
                <p>Некоммерческая экосистема инди-проектов: единый аккаунт, центр загрузок сборок и модов, серверы и закрытые тесты. Всё бесплатно и без рекламы.</p>
                <h5>Нужна ли регистрация, чтобы скачать сборку?</h5>
                <p>Нет — публичные релизы («Доступно для скачивания») качаются без входа. Аккаунт нужен для закрытых тестов, dev-снапшотов, истории загрузок и управления серверами.</p>
                <h5>Как попасть на закрытый тест?</h5>
                <p>Зарегистрируйтесь и введите код доступа от команды. Для демонстрации используйте кнопку DEMO ACCESS на странице входа.</p>
                <h5>Почему сайт выглядит как терминал?</h5>
                <p>Дизайн перенесён из открытого проекта eDEX-UI (тема «blade») с соблюдением лицензии GPL-3.0. Кстати, попробуйте нажать <kbd>~</kbd>.</p>`
        },
        rules: {
            title: "Правила",
            subtitle: "серверы и сообщество",
            html: `
                <h5>Правила сообщества NEXUS//DEV</h5>
                <ol>
                    <li>Без гриферства, читов и эксплойтов. Откаты делаются автоматически, бан — навсегда.</li>
                    <li>Уважайте других игроков: никаких оскорблений и спама.</li>
                    <li>Не распространяйте сборки закрытых тестов за пределами экосистемы.</li>
                    <li>Проект некоммерческий: торговля внутриигровыми вещами за реальные деньги запрещена.</li>
                    <li>Нашли баг — сообщите через кабинет: это лучший способ помочь проекту.</li>
                </ol>`
        },
        license: {
            title: "LICENSE",
            subtitle: "GPL-3.0",
            html: `
                <h5>GNU General Public License v3.0</h5>
                <p>Код этого сайта распространяется под лицензией GPL-3.0. Вы можете свободно использовать, изучать, изменять и распространять его при условии сохранения той же лицензии и указания авторства.</p>
                <p>Визуальный стиль, CSS-правила, шрифты, звуки и иконки перенесены и адаптированы из <a href="https://github.com/GitSquared/edex-ui" target="_blank" rel="noopener noreferrer">eDEX-UI</a> (© Gabriel “Squared” Saillard, GPL-3.0). Скошенные рамки — библиотека augmented-ui 1.1.2 (BSD-2-Clause).</p>`,
            buttons: [{ label: "Открыть LICENSE", href: "LICENSE" }]
        }
    };

    const Docs = {
        open(key) {
            const doc = DOCS[key];
            if (!doc) return;
            Modal.open({ title: doc.title, subtitle: doc.subtitle, html: doc.html, buttons: doc.buttons });
        },
        init() {
            document.addEventListener("click", e => {
                const docBtn = e.target.closest("[data-doc]");
                if (docBtn) {
                    e.preventDefault();
                    Docs.open(docBtn.getAttribute("data-doc"));
                }
            });
        }
    };

    /* ================================================================
     * Скрытый терминал-оверлей (замена xterm.js + node-pty)
     * Открывается клавишей ~ / Ё или кнопками [data-terminal].
     * ================================================================ */
    const Terminal = {
        root: null,
        out: null,
        input: null,
        history: [],
        hIndex: 0,
        greeted: false,
        commands: {},
        isOpen: false,
        lastFocus: null,

        build() {
            const root = document.createElement("div");
            root.className = "term-overlay";
            root.id = "term-overlay";
            root.hidden = true;
            root.innerHTML = `
                <div class="term-backdrop" data-term-close></div>
                <div class="term-window-wrap glow">
                    <section class="term-window aug-frame" augmented-ui="tr-clip bl-clip exe" role="dialog" aria-modal="true" aria-labelledby="term-title">
                        <h3 class="panel-title shell-title"><span id="term-title">TERMINAL</span><span>MAIN SHELL · [~] / [ESC]</span></h3>
                        <button class="modal_close" type="button" aria-label="Закрыть терминал" data-term-close><img src="assets/icons/close.svg" alt=""></button>
                        <div class="term" id="term">
                            <div class="term-output" id="term-output" role="log" aria-live="polite" aria-label="Вывод терминала"></div>
                            <form class="term-line" id="term-form" autocomplete="off">
                                <label class="term-prompt" id="term-prompt" for="term-input">guest@nexus:~$</label>
                                <input class="term-input" id="term-input" type="text" spellcheck="false" autocapitalize="off" autocomplete="off" enterkeyhint="send" aria-label="Введите команду, например help">
                            </form>
                        </div>
                    </section>
                </div>`;
            document.body.appendChild(root);
            this.root = root;
            $$("[data-terminal]").forEach(b => b.setAttribute("aria-controls", "term-overlay"));
            this.out = $("#term-output", root);
            this.input = $("#term-input", root);

            $$("[data-term-close]", root).forEach(el => el.addEventListener("click", () => this.close()));
            $("#term-form", root).addEventListener("submit", e => {
                e.preventDefault();
                const v = this.input.value;
                this.input.value = "";
                this.run(v);
            });
            $("#term", root).addEventListener("click", e => {
                if (e.target.closest("a, button")) return;
                const sel = window.getSelection ? String(window.getSelection()) : "";
                if (!sel) this.input.focus({ preventScroll: true });
            });
            this.input.addEventListener("keydown", e => this.onInputKey(e));
            const s = Auth.get();
            $("#term-prompt", root).textContent = `${s ? s.callsign.toLowerCase() : "guest"}@nexus:~$`;
        },
        toggle() {
            if (this.isOpen) this.close(); else this.open();
        },
        open() {
            if (this.isOpen) return;
            if (!this.root) this.build();
            if (Modal.current) Modal.close(true);
            this.lastFocus = document.activeElement;
            this.isOpen = true;
            this.root.hidden = false;
            void this.root.offsetWidth;
            this.root.classList.add("is-open");
            document.body.classList.add("term-open");
            $$("[data-terminal]").forEach(b => b.setAttribute("aria-expanded", "true"));
            Sound.play("expand");
            setTimeout(() => this.input.focus({ preventScroll: true }), 60);
            if (!this.greeted) this.greet();
        },
        close() {
            if (!this.isOpen) return;
            this.isOpen = false;
            this.root.classList.remove("is-open");
            document.body.classList.remove("term-open");
            $$("[data-terminal]").forEach(b => b.setAttribute("aria-expanded", "false"));
            Sound.play("panels");
            setTimeout(() => { if (!this.isOpen) this.root.hidden = true; }, reducedMotion() ? 0 : 200);
            if (this.lastFocus && typeof this.lastFocus.focus === "function") this.lastFocus.focus({ preventScroll: true });
        },

        print(text, cls) {
            if (!this.out) return null;
            const line = document.createElement("div");
            line.className = "line" + (cls ? " " + cls : "");
            line.textContent = text;
            this.out.appendChild(line);
            this.trim();
            this.out.scrollTop = this.out.scrollHeight;
            return line;
        },
        printHtml(html, cls) {
            if (!this.out) return null;
            const line = document.createElement("div");
            line.className = "line" + (cls ? " " + cls : "");
            line.innerHTML = html;
            this.out.appendChild(line);
            this.trim();
            this.out.scrollTop = this.out.scrollHeight;
            return line;
        },
        trim() {
            while (this.out.childElementCount > 300) this.out.removeChild(this.out.firstChild);
        },
        async type(text, cls, speed) {
            const line = this.print("", cls);
            if (!line) return;
            if (reducedMotion()) { line.textContent = text; return; }
            for (let i = 0; i < text.length; i++) {
                line.textContent += text[i];
                if (i % 3 === 0) Sound.play("stdout");
                await delay(speed || 12);
            }
        },
        async greet() {
            this.greeted = true;
            const s = Auth.get();
            await this.type("NEXUS//DEV web shell v2.1.0 — interface adapted from eDEX-UI", "", 8);
            this.printHtml(`Welcome, <span class="hl">${escapeHtml(s ? s.callsign : "guest")}</span>. Вы нашли скрытый терминал.`);
            this.print("Введите «help», чтобы увидеть список команд. [~] или [Esc] — закрыть.");
            this.print("");
        },
        run(raw) {
            const line = raw.trim();
            const prompt = $("#term-prompt");
            this.printHtml(`<span class="term-prompt">${escapeHtml(prompt ? prompt.textContent : "guest@nexus:~$")}</span> ${escapeHtml(raw)}`, "cmd");
            if (!line) return;
            this.history.push(line);
            if (this.history.length > 50) this.history.shift();
            this.hIndex = this.history.length;
            const parts = line.split(/\s+/);
            const name = parts[0].toLowerCase();
            const args = parts.slice(1);
            const fn = this.commands[name];
            Sound.play("stdin");
            if (fn) {
                fn.call(this, args, line);
            } else {
                this.print(`${name}: command not found. Введите «help».`, "err");
                Sound.play("denied");
            }
        },
        onInputKey(e) {
            if (e.key === "ArrowUp") {
                if (!this.history.length) return;
                e.preventDefault();
                this.hIndex = Math.max(0, this.hIndex - 1);
                this.input.value = this.history[this.hIndex] || "";
            } else if (e.key === "ArrowDown") {
                if (!this.history.length) return;
                e.preventDefault();
                this.hIndex = Math.min(this.history.length, this.hIndex + 1);
                this.input.value = this.history[this.hIndex] || "";
            } else if (e.key === "Tab") {
                const v = this.input.value.trim().toLowerCase();
                e.preventDefault();
                if (!v) return;
                const matches = Object.keys(this.commands).filter(c => c.indexOf(v) === 0);
                if (matches.length === 1) this.input.value = matches[0] + " ";
                else if (matches.length > 1) this.print(matches.join("  "));
            } else if (e.key.length === 1) {
                Sound.play("stdin");
            }
        },
        init() {
            // Горячая клавиша: ~ / ` / Ё (код Backquote)
            document.addEventListener("keydown", e => {
                if (e.ctrlKey || e.metaKey || e.altKey) return;
                const isTilde = e.code === "Backquote" || e.key === "`" || e.key === "~" || e.key === "ё" || e.key === "Ё";
                if (isTilde) {
                    const t = e.target;
                    const typing = t && t.closest ? t.closest("input, textarea, select, [contenteditable='true']") : null;
                    // В поле терминала тильда закрывает его, только если строка пуста
                    if (typing && !(this.isOpen && t === this.input && !this.input.value)) return;
                    if (document.body.classList.contains("is-booting")) return;
                    e.preventDefault();
                    this.toggle();
                } else if (e.key === "Escape" && this.isOpen) {
                    e.preventDefault();
                    this.close();
                }
            });
            document.addEventListener("click", e => {
                const btn = e.target.closest("[data-terminal]");
                if (!btn) return;
                e.preventDefault();
                this.toggle();
            });

            const go = (url, msg) => {
                this.print(msg || `Переход: ${url} …`);
                setTimeout(() => { window.location.href = url; }, 450);
            };
            const findProject = q => {
                q = (q || "").toLowerCase();
                if (!q) return null;
                return PROJECTS.find(p => p.id === q || p.code.toLowerCase() === q || p.title.toLowerCase().indexOf(q) === 0);
            };

            this.commands = {
                help() {
                    [
                        "Доступные команды:",
                        "  projects        — каталог сборок и их статус",
                        "  open <id>       — открыть проект (например: open fortify)",
                        "  status          — сводка по сети и серверам",
                        "  servers         — список игровых серверов",
                        "  syslog          — последние системные события",
                        "  login | register | logout — вход, регистрация, выход",
                        "  dashboard       — личный кабинет",
                        "  home            — главная страница",
                        "  whoami          — текущий пользователь",
                        "  neofetch        — информация о системе браузера",
                        "  date, echo, history, clear",
                        "  sfx on|off      — звуки интерфейса eDEX-UI",
                        "  credits         — лицензия и происхождение интерфейса",
                        "  reboot          — повторить анимацию загрузки",
                        "  exit            — закрыть терминал"
                    ].forEach(l => this.print(l));
                },
                projects() {
                    this.print("ID            STATUS                    VERSION");
                    PROJECTS.forEach(p => {
                        this.print(`${p.id.padEnd(13)} ${STATUSES[p.status].label.padEnd(25)} ${p.version}`);
                    });
                    this.printHtml('Центр загрузок: <a href="projects.html">projects.html</a> · подробнее: <span class="hl">open &lt;id&gt;</span>');
                },
                open(args) {
                    const p = findProject(args[0]);
                    if (!p) { this.print(`open: проект «${args[0] || ""}» не найден. Введите «projects».`, "err"); return; }
                    go(`projects.html#${p.id}`, `Открываю ${p.code} · ${p.title} …`);
                },
                status() {
                    const s = Telemetry.summary();
                    this.print(`network        : ${Net.online && s.coreUp ? "SYSTEM ONLINE" : "SYSTEM DEGRADED"}`);
                    this.print(`servers online : ${s.online}/${s.total}`);
                    this.print(`players online : ${s.players}`);
                    this.print(`avg ping       : ${Math.round(s.avgPing)} ms`);
                    this.print(`releases       : ${PROJECTS.filter(p => p.status === "available").length} доступно для скачивания`);
                },
                servers() {
                    this.print("ID           TYPE       STATUS       PLAYERS   PING");
                    SERVERS.forEach(n => {
                        this.print(`${n.id.padEnd(12)} ${n.type.padEnd(10)} ${n.status.toUpperCase().padEnd(12)} ${formatPlayers(n).padEnd(9)} ${Telemetry.isUp(n) ? Math.round(n.ping) + " ms" : "—"}`);
                    });
                },
                syslog() {
                    Syslog.tail(15).forEach(l => this.print(`[${l.ts}] ${l.text}`, l.warn ? "warn" : ""));
                },
                login() {
                    const s = Auth.get();
                    if (s) { this.print(`Вы уже вошли как ${s.callsign} (LEVEL ${s.level}). Команда «dashboard» откроет кабинет.`); return; }
                    go("auth.html", "Открываю защищённый терминал авторизации…");
                },
                register() { go("auth.html#register", "Открываю форму регистрации…"); },
                logout() {
                    if (!Auth.get()) { this.print("logout: вы и так гость"); return; }
                    Auth.logout();
                    this.print("Сессия завершена.");
                    toast("Сессия завершена", "warn");
                    Sound.play("denied");
                },
                dashboard() { go("dashboard.html", "Открываю личный кабинет…"); },
                home() { go("index.html", "Возвращаюсь на главную…"); },
                whoami() {
                    const s = Auth.get();
                    this.print(s ? `${s.callsign} · ${s.id} · LEVEL ${s.level} // ${Auth.levelName(s.level)}` : "guest (не авторизован)");
                },
                neofetch() {
                    const os = detectOS();
                    const s = Auth.get();
                    const art = [
                        "  ▄▀▀▀▀▀▀▀▀▀▀▄  ",
                        "  █ ▐█▌  ▐█▌ █  ",
                        "  █  NEXUS//  █  ",
                        "  █    DEV    █  ",
                        "  ▀▄▄▄▄▄▄▄▄▄▄▀  "
                    ];
                    const info = [
                        `${s ? s.callsign.toLowerCase() : "guest"}@nexus`,
                        "-------------",
                        `OS: ${os.full}`,
                        `Browser: ${detectBrowser()}`,
                        `Uptime: ${formatUptime(Date.now() - startTime)}`,
                        `Resolution: ${window.screen.width}x${window.screen.height}`,
                        `CPU threads: ${navigator.hardwareConcurrency || "N/A"}`,
                        `Clearance: ${s ? "LEVEL " + s.level : "NONE"}`,
                        "Theme: blade (eDEX-UI)",
                        "Font: United Sans / Fira Mono"
                    ];
                    const rows = Math.max(art.length, info.length);
                    for (let i = 0; i < rows; i++) this.print(`${(art[i] || "").padEnd(19)}${info[i] || ""}`);
                },
                date() { this.print(new Date().toString()); },
                echo(args) { this.print(args.join(" ")); },
                history() { this.history.forEach((h, i) => this.print(`${String(i + 1).padStart(4)}  ${h}`)); },
                sfx(args) {
                    const v = (args[0] || "").toLowerCase();
                    if (v === "on") { Sound.set(true); this.print("sfx: enabled"); }
                    else if (v === "off") { Sound.set(false); this.print("sfx: disabled"); }
                    else this.print(`sfx: ${Sound.enabled ? "on" : "off"} (используйте «sfx on» или «sfx off»)`);
                },
                theme() { this.print("theme: blade — rgb(204, 94, 55) on #090B0A. Настройки HUD — в кабинете."); },
                credits() {
                    this.printHtml('UI inspired by &amp; adapted from <a href="https://github.com/GitSquared/edex-ui" target="_blank" rel="noopener noreferrer">eDEX-UI</a> (GPL-3.0) by Gabriel “Squared” Saillard.');
                    this.printHtml('Рамки: augmented-ui 1.1.2 (BSD-2-Clause). Лицензия сайта: <a href="LICENSE">GPL-3.0</a>.');
                },
                sudo() { this.print("guest is not in the sudoers file. This incident will be reported.", "err"); Sound.play("denied"); },
                reboot() {
                    this.print("Broadcast message: the system is going down for reboot NOW!");
                    setTimeout(() => {
                        this.close();
                        window.scrollTo(0, 0);
                        Boot.run().then(revealUI);
                    }, 400);
                },
                exit() { this.close(); },
                clear() { this.out.innerHTML = ""; }
            };
        }
    };

    /* ================================================================
     * Копирование в буфер
     * ================================================================ */
    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
        }
        return Promise.resolve(fallbackCopy(text));
    }
    function fallbackCopy(text) {
        try {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            return ok;
        } catch (e) {
            return false;
        }
    }

    /* ================================================================
     * Навигация: активная страница, мобильное меню
     * ================================================================ */
    function initNav() {
        const nav = $("#site-nav");
        const toggle = $("#menu-toggle");
        const links = $$(".nav-tabs a");

        links.forEach(a => {
            const on = a.getAttribute("data-nav") === PAGE;
            a.parentElement.classList.toggle("active", on);
            if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
        });

        const setMenu = open => {
            if (!nav || !toggle) return;
            nav.classList.toggle("open", open);
            toggle.setAttribute("aria-expanded", String(open));
            toggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
        };
        if (toggle && nav) {
            toggle.addEventListener("click", () => {
                setMenu(!nav.classList.contains("open"));
                Sound.play("panels");
            });
        }
        links.forEach(a => a.addEventListener("click", () => { setMenu(false); Sound.play("folder"); }));
        document.addEventListener("keydown", e => { if (e.key === "Escape") setMenu(false); });
        document.addEventListener("click", e => {
            if (nav && nav.classList.contains("open") && !e.target.closest("#site-nav") && !e.target.closest("#menu-toggle")) setMenu(false);
        });
        window.addEventListener("resize", () => { if (window.innerWidth >= 900) setMenu(false); });
    }

    /* ================================================================
     * Появление при скролле, счётчики, глитч
     * ================================================================ */
    function observeReveal(root) {
        const els = $$(".on-scroll:not(.is-visible)", root);
        if (!("IntersectionObserver" in window) || reducedMotion()) {
            els.forEach(el => el.classList.add("is-visible"));
            return;
        }
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (en.isIntersecting) {
                    en.target.classList.add("is-visible");
                    io.unobserve(en.target);
                }
            });
        }, { threshold: 0.08, rootMargin: "0px 0px -30px 0px" });
        els.forEach(el => io.observe(el));
    }

    function initGlitch() {
        const els = $$(".hero-accent");
        if (!els.length) return;
        const loop = () => {
            if (!reducedMotion()) {
                const el = pick(els);
                el.classList.add("glitch");
                setTimeout(() => el.classList.remove("glitch"), randInt(180, 420));
            }
            setTimeout(loop, randInt(4500, 9000));
        };
        setTimeout(loop, 3000);
    }

    /* ================================================================
     * Старт
     * ================================================================ */
    function init() {
        Settings.apply();
        initSoundToggle();
        updateUserUI();
        initClock();
        initSysinfo();
        Syslog.init();
        initNetwork();
        initSummary();
        initToplist();
        initRadar();
        Tabs.init();
        Terminal.init();
        Docs.init();
        initNav();
        observeReveal();
        initGlitch();

        setInterval(tickTelemetry, 2000);

        // Синхронизация входа/выхода и настроек между вкладками браузера
        window.addEventListener("storage", e => {
            if (e.key === Auth.KEY) updateUserUI();
            if (e.key === Settings.KEY) { Settings.load(); Settings.apply(); Sound.syncUI(); }
        });

        if (shouldBoot()) {
            Boot.run().then(revealUI);
        } else {
            revealUI();
        }
    }

    /* Публичное API для js/pages.js */
    window.NEXUS = {
        PAGE, $, $$, clamp, rand, randInt, pick, pad, delay, escapeHtml, timeStr, dateStr, hashString, rgba,
        storage, Settings, Sound, Auth, LEVELS, ACCESS_CODES, toast, showBanner, Modal, Tabs, Syslog, Terminal,
        SERVERS, Telemetry, statusBadge, formatPlayers, PROJECTS, CATEGORIES, STATUSES, Docs,
        observeReveal, reducedMotion, copyText, updateUserUI, NICKS
    };

    init();
})();
