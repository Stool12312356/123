/*
 * ui-effects.js — общее ядро для всех страниц NEXUS//DEV
 * ------------------------------------------------------------------
 * Браузерные (Vanilla JS) аналоги модулей eDEX-UI для темы «blade».
 * Никакого Electron / Node.js: нет require(), fs, ipc, systeminformation.
 *
 *  - Настройки HUD и сессия пользователя (localStorage)
 *  - Звуки интерфейса                         ← classes/audiofx.class.js
 *  - Экран загрузки и баннеры ACCESS ...      ← _renderer.js displayLine/displayTitleScreen
 *  - Часы, системная информация               ← classes/clock.class.js, sysinfo.class.js
 *  - Графики, карта памяти, сеть, радар       ← cpuinfo / ramwatcher / netstat / conninfo / locationGlobe
 *  - Телеметрия игровых серверов, toplist     ← toplist.class.js
 *  - Модальные окна (перетаскиваемые)         ← classes/modal.class.js
 *  - Консоль                                  ← упрощённая замена xterm.js + node-pty
 *  - Данные проектов (PROJECTS) и серверов (SERVERS) — общие для всех страниц
 *
 * Логика отдельных страниц (projects / dashboard / auth) — в js/pages.js,
 * он использует API, опубликованное здесь в window.NEXUS.
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
        defaults: { sfx: false, intro: true, grid: true, glow: true, motion: true, scale: "normal" },
        data: null,
        load() {
            this.data = Object.assign({}, this.defaults, storage.getJSON(this.KEY, {}));
            return this.data;
        },
        get(key) {
            if (!this.data) this.load();
            return this.data[key];
        },
        set(key, value) {
            if (!this.data) this.load();
            this.data[key] = value;
            storage.setJSON(this.KEY, this.data);
            this.apply();
        },
        reset() {
            this.data = Object.assign({}, this.defaults);
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
     * Звук (audiofx.class.js) — выключен по умолчанию
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
        volumes: { stdout: 0.35, stdin: 0.4, folder: 0.5, granted: 0.5, denied: 0.5, panels: 0.5, info: 0.5, expand: 0.5, keyboard: 0.5, theme: 0.5 },
        cache: {},
        lastPlay: {},
        get enabled() {
            return Settings.get("sfx") === true;
        },
        play(name) {
            if (!this.enabled || !this.files[name]) return;
            const now = performance.now();
            if ((name === "stdout" || name === "stdin") && this.lastPlay[name] && now - this.lastPlay[name] < 60) return;
            this.lastPlay[name] = now;
            try {
                let base = this.cache[name];
                if (!base) {
                    base = new Audio(this.files[name]);
                    base.preload = "auto";
                    this.cache[name] = base;
                }
                const a = base.paused ? base : base.cloneNode(true);
                a.volume = this.volumes[name] || 0.5;
                a.currentTime = 0;
                const p = a.play();
                if (p && typeof p.catch === "function") p.catch(() => { /* автоплей заблокирован браузером */ });
            } catch (e) { /* ignore */ }
        },
        set(on) {
            Settings.set("sfx", !!on);
            this.syncUI();
            if (on) this.play("granted");
            document.dispatchEvent(new CustomEvent("nexus:settings"));
        },
        syncUI() {
            const btn = $("#sound-toggle");
            const state = $("#sound-state");
            if (btn) btn.setAttribute("aria-pressed", String(this.enabled));
            if (state) state.textContent = this.enabled ? "ON" : "OFF";
        }
    };

    function initSoundToggle() {
        const btn = $("#sound-toggle");
        Sound.syncUI();
        if (btn) btn.addEventListener("click", () => Sound.set(!Sound.enabled));
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
            const session = {
                callsign,
                email: opts.email || `${callsign.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@nexus.dev.example`,
                id: this.makeId(callsign),
                level,
                demo: !!opts.demo,
                registered: (prev && prev.callsign === callsign && prev.registered) || opts.registered || now,
                lastLogin: now,
                expires: opts.remember === false ? now + 2 * 3600 * 1000 : null,
                avatarSeed: (prev && prev.callsign === callsign && prev.avatarSeed) || 0,
                downloads: (prev && prev.callsign === callsign && prev.downloads) || this.seedDownloads(level)
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
        seedDownloads(level) {
            const day = 86400000;
            const list = [
                { build: "FORTIFY MOD", version: "0.9.2-beta (Fabric 1.21.1)", date: Date.now() - 9 * day, size: "4.1 MiB", sha: "a91f3c0d", status: "VERIFIED" },
                { build: "NEXUS CRAFT modpack", version: "2026.10", date: Date.now() - 6 * day, size: "212 MiB", sha: "5be0217a", status: "VERIFIED" }
            ];
            if (level >= 3) {
                list.push({ build: "BASTION: LINE ZERO", version: "0.3.6-prealpha (build 2187)", date: Date.now() - 3 * day, size: "18.1 GiB", sha: "c47d99e2", status: "VERIFIED" });
            }
            return list;
        },
        addDownload(entry) {
            const s = this.get();
            if (!s) return null;
            s.downloads = [entry].concat(s.downloads || []).slice(0, 20);
            storage.setJSON(this.KEY, s);
            return s;
        }
    };

    /* Индикатор пользователя в шапке, подсказки в консоли и кнопках */
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
    }

    /* ================================================================
     * Тосты (короткие HUD-уведомления)
     * ================================================================ */
    function toast(text, type) {
        let wrap = $("#toast-stack");
        if (!wrap) {
            wrap = document.createElement("div");
            wrap.id = "toast-stack";
            wrap.className = "toast-stack";
            wrap.setAttribute("role", "status");
            wrap.setAttribute("aria-live", "polite");
            document.body.appendChild(wrap);
        }
        const el = document.createElement("div");
        el.className = "toast" + (type ? " toast-" + type : "");
        const t = document.createElement("span");
        t.className = "toast-time";
        t.textContent = timeStr();
        el.appendChild(t);
        el.appendChild(document.createTextNode(text));
        wrap.appendChild(el);
        setTimeout(() => el.classList.add("leaving"), 3200);
        setTimeout(() => el.remove(), 3600);
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

            // --- displayLine(): построчный вывод лога с «живыми» задержками
            const appendLine = text => {
                const div = document.createElement("div");
                div.textContent = text;
                log.appendChild(div);
                if (log.childElementCount > 120) log.removeChild(log.firstChild);
            };

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
                if (n === 2 || n === 4) ms = 260;
                else if (n > 4 && n < 25) ms = 14;
                else if (n === 25) ms = 200;
                else if (n === 42) ms = 150;
                else if (n > 42 && n < 82) ms = 11;
                else if (n >= BOOT_LOG.length - 2) ms = 160;
                else ms = Math.pow(1 - (n / 1000), 3) * 12;
                // Короткие задержки копим и выводим по несколько строк за кадр
                debt += ms;
                if (debt >= 32) {
                    await this.wait(debt);
                    debt = 0;
                }
            }

            // --- displayTitleScreen(): логотип и glitch-эффект
            if (!this.skipped) {
                log.remove();
                Sound.play("theme");
                await this.wait(300);
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

        await wait(200);
        body.classList.add("solidBackground");
        await wait(100);
        title.className = "flash";
        await wait(300);
        title.className = "boxed";
        await wait(100);
        title.className = "glitch";
        await wait(500);
        body.classList.remove("solidBackground");
        title.className = "boxed";
        await wait(full ? 700 : 500);
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
        if (reducedMotion()) {
            screen.innerHTML = `<h1 class="boxed" data-text="${escapeHtml(text)}">${escapeHtml(text)}</h1>`;
            await delay(900);
        } else {
            await titleSequence(screen, text, delay, false);
        }
        if (opts.sub) {
            const p = document.createElement("p");
            p.className = "banner-sub";
            p.textContent = opts.sub;
            screen.appendChild(p);
            await delay(500);
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
        const hash = window.location.hash.replace("#", "");
        if (hash && hash !== "home" && hash !== "top") return false;
        return true;
    }

    /* Появление интерфейса после загрузки (initUI) */
    let uiRevealed = false;
    function revealUI() {
        const first = !uiRevealed;
        uiRevealed = true;
        document.body.classList.remove("ui-ready");
        void document.body.offsetWidth;
        document.body.classList.add("ui-ready");
        Sound.play("expand");
        setTimeout(() => Sound.play("panels"), 500);
        if (first) {
            setTimeout(() => Terminal.greet(), reducedMotion() ? 0 : 900);
        }
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
     * Системная информация (sysinfo.class.js + hardwareInspector.class.js)
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
        set("hw-platform", `${os.full} / ${detectBrowser()}`);
        set("hw-cores", navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : "N/A");
        set("hw-screen", `${window.screen.width}x${window.screen.height}`);
        set("hw-lang", (navigator.language || "—").toUpperCase());

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

    /* ================================================================
     * Линейный график на canvas (аналог smoothie.js в eDEX-UI)
     * ================================================================ */
    class LineChart {
        constructor(canvas, opts) {
            this.canvas = canvas;
            this.ctx = canvas.getContext("2d");
            this.opts = Object.assign({ series: 1, points: 60, min: 0, max: 100, invert: false, fill: false, alphas: [1, 0.55] }, opts || {});
            this.data = [];
            for (let s = 0; s < this.opts.series; s++) {
                this.data.push(new Array(this.opts.points).fill(this.opts.min));
            }
            this.resize();
            if ("ResizeObserver" in window) {
                new ResizeObserver(() => { this.resize(); this.draw(); }).observe(canvas);
            } else {
                window.addEventListener("resize", () => { this.resize(); this.draw(); });
            }
        }
        resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
            const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
            if (this.canvas.width !== w || this.canvas.height !== h) {
                this.canvas.width = w;
                this.canvas.height = h;
            }
            this.dpr = dpr;
        }
        push(values) {
            values.forEach((v, i) => {
                if (!this.data[i]) return;
                this.data[i].push(v);
                this.data[i].shift();
            });
        }
        draw() {
            const { ctx, canvas, opts } = this;
            if (!ctx) return;
            const w = canvas.width;
            const h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            const step = w / (opts.points - 1);
            const p = 2 * this.dpr;
            const toY = v => {
                const n = (clamp(v, opts.min, opts.max) - opts.min) / (opts.max - opts.min);
                return opts.invert ? p + n * (h - p * 2) : h - p - n * (h - p * 2);
            };
            this.data.forEach((series, si) => {
                ctx.beginPath();
                series.forEach((v, i) => {
                    const x = i * step;
                    const y = toY(v);
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                ctx.strokeStyle = rgba(opts.alphas[si] !== undefined ? opts.alphas[si] : 0.6);
                ctx.lineWidth = 1.2 * this.dpr;
                ctx.stroke();
                if (opts.fill && si === 0) {
                    ctx.lineTo(w, opts.invert ? 0 : h);
                    ctx.lineTo(0, opts.invert ? 0 : h);
                    ctx.closePath();
                    ctx.fillStyle = rgba(0.12);
                    ctx.fill();
                }
            });
        }
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
     * BUILD FARM / CPU (cpuinfo.class.js) — синтетическая нагрузка + реальный FPS
     * ================================================================ */
    function initCpu() {
        const c1 = $("#cpu-canvas-1");
        const c2 = $("#cpu-canvas-2");
        if (!c1 || !c2) return;
        const chart1 = new LineChart(c1, { series: 2, points: 50 });
        const chart2 = new LineChart(c2, { series: 2, points: 50 });
        const cores = [walker(48, 2, 98, 8, 0.05), walker(56, 2, 98, 8, 0.05), walker(22, 2, 95, 6, 0.03), walker(32, 2, 95, 8, 0.05)];
        const avg1 = $("#cpu-avg1"), avg2 = $("#cpu-avg2");
        const fpsEl = $("#cpu-fps"), loadEl = $("#cpu-load"), maxEl = $("#cpu-max"), tasksEl = $("#cpu-tasks");
        let visible = true;
        let max = 0;
        let tasks = randInt(1800, 2600);

        whenVisible(c1.closest(".mod"), v => { visible = v; });

        let frames = 0;
        let lastFpsTime = performance.now();
        const countFrame = now => {
            frames++;
            if (now - lastFpsTime >= 1000) {
                if (fpsEl) fpsEl.textContent = String(Math.round(frames * 1000 / (now - lastFpsTime)));
                frames = 0;
                lastFpsTime = now;
            }
            requestAnimationFrame(countFrame);
        };
        requestAnimationFrame(countFrame);

        for (let i = 0; i < 50; i++) {
            const v = cores.map(f => f());
            chart1.push([v[0], v[1]]);
            chart2.push([v[2], v[3]]);
        }
        chart1.draw();
        chart2.draw();

        setInterval(() => {
            const v = cores.map(f => f());
            chart1.push([v[0], v[1]]);
            chart2.push([v[2], v[3]]);
            const load = (v[0] + v[1] + v[2] + v[3]) / 4;
            max = Math.max(max * 0.995, load);
            tasks = Math.max(0, tasks - randInt(0, 12));
            if (tasks < 50) tasks = randInt(1800, 2600);
            if (visible) {
                chart1.draw();
                chart2.draw();
                if (avg1) avg1.textContent = String(Math.round((v[0] + v[1]) / 2));
                if (avg2) avg2.textContent = String(Math.round((v[2] + v[3]) / 2));
                if (loadEl) loadEl.textContent = Math.round(load) + "%";
                if (maxEl) maxEl.textContent = Math.round(max) + "%";
                if (tasksEl) tasksEl.textContent = String(tasks);
            }
        }, 500);
    }

    /* ================================================================
     * Память (ramwatcher.class.js) — 440 точек, перемешанных случайно
     * ================================================================ */
    function initRam() {
        const map = $("#ram-pointmap");
        if (!map) return;
        const POINTS = 440;
        const points = [];
        const frag = document.createDocumentFragment();
        for (let i = 0; i < POINTS; i++) {
            const p = document.createElement("div");
            p.className = "ram-point free";
            frag.appendChild(p);
            points.push(p);
        }
        map.appendChild(frag);
        for (let i = points.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = points[i]; points[i] = points[j]; points[j] = t;
        }

        const totalGiB = 64;
        const used = walker(0.46, 0.25, 0.82, 0.025);
        const avail = walker(0.14, 0.06, 0.22, 0.01);
        const swap = walker(0.18, 0.02, 0.6, 0.02);
        const info = $("#ram-info");
        const bar = $("#ram-swapbar");
        const swapText = $("#ram-swaptext");
        const swapTotal = 16;

        const update = () => {
            const u = used();
            const a = avail();
            const active = Math.round(POINTS * u);
            const available = Math.round(POINTS * Math.min(1 - u, a));
            for (let i = 0; i < POINTS; i++) {
                const cls = i < active ? "ram-point active" : (i < active + available ? "ram-point available" : "ram-point free");
                if (points[i].className !== cls) points[i].className = cls;
            }
            if (info) info.textContent = `USING ${(totalGiB * u).toFixed(1)} OUT OF ${totalGiB.toFixed(1)} GiB`;
            const s = swap();
            if (bar) { bar.value = Math.round(s * 100); bar.textContent = Math.round(s * 100) + "%"; }
            if (swapText) swapText.textContent = (swapTotal * s).toFixed(1) + " GiB";
        };
        update();
        setInterval(update, 1500);
    }

    /* ================================================================
     * Сеть (netstat.class.js + conninfo.class.js)
     * ================================================================ */
    const Net = { online: navigator.onLine !== false };

    function initNetwork() {
        const stateEl = $("#net-state");
        const typeEl = $("#net-type");
        const pingEl = $("#net-ping");
        const uplinkState = $("#uplink-state");
        const uplinkDot = $("#uplink-dot");
        const conn = $("#mod_conninfo");
        const totalEl = $("#net-total");

        const paint = () => {
            const label = Net.online ? "ONLINE" : "OFFLINE";
            if (stateEl) stateEl.textContent = label;
            if (uplinkState) uplinkState.textContent = label;
            if (uplinkDot) uplinkDot.classList.toggle("is-offline", !Net.online);
            if (conn) conn.classList.toggle("offline", !Net.online);
        };
        const applyOnline = () => {
            Net.online = navigator.onLine !== false;
            paint();
            Syslog.add(Net.online ? "netstat: uplink restored, interface UP" : "netstat: uplink lost, interface DOWN", !Net.online);
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

        const ping = walker(24, 9, 80, 4, 0.03);
        setInterval(() => {
            if (!pingEl) return;
            if (!Net.online) { pingEl.textContent = "-- ms"; return; }
            const rtt = nc && nc.rtt ? nc.rtt / 2 + ping() / 2 : ping();
            pingEl.textContent = Math.round(rtt) + " ms";
        }, 2000);

        const top = $("#conn-canvas-top");
        const bottom = $("#conn-canvas-bottom");
        if (!top || !bottom) return;
        const up = new LineChart(top, { series: 1, points: 70, max: 2, fill: true });
        const down = new LineChart(bottom, { series: 1, points: 70, max: 12, fill: true, invert: true });
        const upW = walker(0.6, 0.02, 1.9, 0.18, 0.04);
        const downW = walker(4, 0.1, 11.5, 0.9, 0.05);
        let sentMB = 0, recvMB = 0;
        let visible = true;
        whenVisible(conn, v => { visible = v; });
        for (let i = 0; i < 70; i++) {
            up.push([Net.online ? upW() : 0]);
            down.push([Net.online ? downW() : 0]);
        }
        up.draw();
        down.draw();
        setInterval(() => {
            const u = Net.online ? upW() : 0;
            const d = Net.online ? downW() : 0;
            sentMB += u * 0.5;
            recvMB += d * 0.5;
            up.push([u]);
            down.push([d]);
            if (visible) {
                up.draw();
                down.draw();
                if (totalEl) totalEl.textContent = `${Math.round(sentMB)} MB OUT, ${Math.round(recvMB)} MB IN`;
            }
        }, 500);
    }

    /* ================================================================
     * Игровые серверы (общие данные для статуса, радара, toplist, кабинета)
     * ================================================================ */
    const SERVERS = [
        { id: "mc-hub-01", name: "NEXUS CRAFT · Hub", type: "MINECRAFT", project: "NEXUS CRAFT", city: "Франкфурт", cc: "DE", angle: 15, dist: 0.28, ping: 12, cpu: 31, ram: 44, players: 86, max: 300, status: "online", uptime: 99.98, software: "Velocity 3.3 / Paper 1.21.1" },
        { id: "mc-surv-01", name: "Survival+ (Fortify Mod)", type: "MINECRAFT", project: "NEXUS CRAFT", city: "Франкфурт", cc: "DE", angle: 40, dist: 0.36, ping: 14, cpu: 58, ram: 71, players: 142, max: 200, status: "online", uptime: 99.95, software: "Fabric 1.21.1 + Fortify 0.9" },
        { id: "mc-build-01", name: "Creative / Build", type: "MINECRAFT", project: "NEXUS CRAFT", city: "Хельсинки", cc: "FI", angle: 330, dist: 0.82, ping: 31, cpu: 22, ram: 39, players: 37, max: 120, status: "online", uptime: 99.97, software: "Paper 1.21.1 + WorldEdit" },
        { id: "mc-games-01", name: "Mini-games", type: "MINECRAFT", project: "NEXUS CRAFT", city: "Амстердам", cc: "NL", angle: 285, dist: 0.48, ping: 47, cpu: 83, ram: 77, players: 58, max: 150, status: "degraded", uptime: 99.61, software: "Paper 1.21.1 + Minigames 3.2" },
        { id: "ue5-pt-01", name: "BASTION Playtest EU-1", type: "UE5", project: "BASTION: LINE ZERO", city: "Варшава", cc: "PL", angle: 95, dist: 0.6, ping: 24, cpu: 64, ram: 58, players: 12, max: 16, status: "online", uptime: 99.12, software: "UE 5.4 Dedicated Server (0.3.7)" },
        { id: "ue5-pt-02", name: "BASTION Playtest EU-2", type: "UE5", project: "BASTION: LINE ZERO", city: "Прага", cc: "CZ", angle: 135, dist: 0.42, ping: 0, cpu: 0, ram: 0, players: 0, max: 16, status: "offline", uptime: 97.84, software: "UE 5.4 Dedicated Server (0.3.7)" },
        { id: "net-api-01", name: "NEXUS ID / API", type: "NETWORK", project: "NEXUS ID", city: "Амстердам", cc: "NL", angle: 250, dist: 0.7, ping: 18, cpu: 17, ram: 33, players: 412, max: 0, status: "online", uptime: 99.99, software: "Docker / Nginx / Postgres 16" }
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
            return { online: up.length, total: SERVERS.length, avgPing, players };
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
            else if (n.status === "online" && r > 0.9988) n.status = "offline";

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
                const msg = n.status === "offline" ? `healthcheck: ${n.id} (${n.name}) is DOWN — игроки перенаправлены в hub`
                    : n.status === "degraded" ? `healthcheck: ${n.id} TPS drop / latency ${Math.round(n.ping)} ms`
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

    /* Таблица «Статус серверов» на главной + сводки */
    function initStatusTable() {
        const tbody = $("#status-body");
        const updated = $("#status-updated");
        const labels = ["Сервер", "Проект", "Локация", "Статус", "Игроки", "Ping", "CPU", "Аптайм"];
        const rows = {};

        if (tbody) {
            SERVERS.forEach(n => {
                const tr = document.createElement("tr");
                tr.innerHTML = labels.map((l, i) => `<td data-label="${l}" data-col="${i}"></td>`).join("");
                tr.children[0].textContent = n.id;
                tr.children[1].textContent = n.project;
                tr.children[2].textContent = `${n.city}, ${n.cc}`;
                tr.children[6].innerHTML = '<span class="loadbar"><span class="loadbar-track"><span class="loadbar-fill"></span></span><span class="loadbar-val"></span></span>';
                tbody.appendChild(tr);
                rows[n.id] = tr;
            });
        }

        const render = () => {
            SERVERS.forEach(n => {
                const tr = rows[n.id];
                if (!tr) return;
                const c = tr.children;
                const badge = statusBadge(n.status);
                if (c[3].innerHTML !== badge) c[3].innerHTML = badge;
                const up = Telemetry.isUp(n);
                c[4].textContent = formatPlayers(n);
                c[5].textContent = up ? Math.round(n.ping) + " ms" : "—";
                const fill = c[6].querySelector(".loadbar-fill");
                const val = c[6].querySelector(".loadbar-val");
                if (fill) fill.style.width = (up ? Math.round(n.cpu) : 0) + "%";
                if (val) val.textContent = up ? Math.round(n.cpu) + "%" : "—";
                c[7].textContent = n.uptime.toFixed(2) + "%";
                tr.classList.toggle("is-offline", !up);
                if (n.changed) {
                    tr.classList.remove("flash");
                    void tr.offsetWidth;
                    tr.classList.add("flash");
                }
            });
            const s = Telemetry.summary();
            $$("[data-sum='online']").forEach(el => { el.textContent = `${s.online}/${s.total}`; });
            $$("[data-sum='ping']").forEach(el => { el.textContent = Math.round(s.avgPing) + " ms"; });
            $$("[data-sum='players']").forEach(el => { el.textContent = String(s.players); });
            if (updated) updated.textContent = timeStr();
        };

        Telemetry.on(render);
        render();
    }

    /* TOP SERVERS (toplist.class.js) */
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
     * Радар серверов (замена 3D-глобуса locationGlobe.class.js)
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
                        if (n.status === "degraded") {
                            ctx.beginPath();
                            ctx.arc(x, y, 7 * dpr, 0, Math.PI * 2);
                            ctx.strokeStyle = rgba(0.3 + glow * 0.5);
                            ctx.lineWidth = 1 * dpr;
                            ctx.stroke();
                        }
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
     * SYSLOG (вкладка терминала)
     * ================================================================ */
    const NICKS = ["Kobalt_Fox", "trench_rat", "Aster", "Nyx404", "ironwolf", "pixel_sapper", "Mira", "hedgehog_mk2", "Lumen", "ByteKnight", "vasya_builder", "Orbital"];

    const Syslog = {
        el: null,
        queue: [],
        add(text, warn) {
            const ts = timeStr();
            if (!this.el) { this.queue.push([ts, text, warn]); if (this.queue.length > 50) this.queue.shift(); return; }
            this.write(ts, text, warn);
        },
        write(ts, text, warn) {
            const el = this.el;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
            const line = document.createElement("div");
            if (warn) line.className = "w";
            const t = document.createElement("span");
            t.className = "t";
            t.textContent = `[${ts}] `;
            line.appendChild(t);
            line.appendChild(document.createTextNode(text));
            el.appendChild(line);
            while (el.childElementCount > 250) el.removeChild(el.firstChild);
            if (atBottom) el.scrollTop = el.scrollHeight;
        },
        init() {
            this.el = $("#syslog");
            if (!this.el) return;
            this.queue.forEach(q => this.write(q[0], q[1], q[2]));
            this.queue = [];
            const tpl = [
                () => { const n = pick(SERVERS.filter(s => s.type === "MINECRAFT" && Telemetry.isUp(s))); return n ? `[${n.id}] ${pick(NICKS)} joined the game` : null; },
                () => { const n = pick(SERVERS.filter(s => s.type === "MINECRAFT" && Telemetry.isUp(s))); return n ? `[${n.id}] TPS 20.0 · ${Math.round(n.players)} players · ${Math.round(n.ram)}% heap` : null; },
                () => `fortify-mod: trench network recalculated in chunk [${randInt(-60, 60)}, ${randInt(-60, 60)}] (${randInt(40, 480)} blocks)`,
                () => { const n = Telemetry.find("ue5-pt-01"); return n && Telemetry.isUp(n) ? `ue5-pt-01: match #${randInt(4000, 9999)} started — map "Ridge-0${randInt(1, 9)}", ${pick(["4v4", "6v6", "8v8"])}` : null; },
                () => `buildfarm: BASTION 0.3.7.${randInt(2200, 2299)} cook ${pick(["started", "complete"])} (Win64, shaders ${randInt(40, 100)}%)`,
                () => `backup: mc-surv-01 world snapshot saved (${rand(1.8, 3.2).toFixed(1)} GiB)`,
                () => `velocity: routed ${pick(NICKS)} → ${pick(["mc-surv-01", "mc-build-01", "mc-games-01"])}`,
                () => `nexus-id: ${randInt(2, 40)} logins/min, 0 failed signatures`
            ];
            this.add("syslogd: started, kernel log buffer attached");
            this.add("boot: NEXUS//DEV web shell initialised (adapted from eDEX-UI)");
            const loop = () => {
                const line = pick(tpl)();
                if (line) this.add(line);
                setTimeout(loop, rand(900, 2600));
            };
            setTimeout(loop, 1200);
        }
    };

    /* ================================================================
     * Вкладки внутри терминала (ul#main_shell_tabs) — для всех страниц
     * ================================================================ */
    const Tabs = {
        /* Переключить вкладку по id кнопки-таба */
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
            if (tab.id === "tabbtn-log") {
                const log = $("#syslog");
                if (log) log.scrollTop = log.scrollHeight;
            }
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
                    tab.addEventListener("click", () => Tabs.activate(tab, false));
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
     * Данные проектов (реестр разработок)
     * ================================================================ */
    const CATEGORIES = { ue5: "UNREAL ENGINE 5", minecraft: "MINECRAFT", network: "NETWORK" };

    const PROJECTS = [
        {
            id: "bastion",
            code: "NX-01",
            title: "BASTION: LINE ZERO",
            category: "ue5",
            status: "PRE-ALPHA",
            progress: 38,
            icon: "unreal",
            flagship: true,
            summary: "Тактическая RTS на Unreal Engine 5: удерживайте фронт, копайте окопы и стройте город-крепость за Sci-Fi фракцию «Кобальтовый Синдикат».",
            stack: ["Unreal Engine 5.4", "C++", "Blueprints", "Mass Entity", "Nanite / Lumen", "World Partition", "Gameplay Ability System"],
            mechanics: [
                "Система укреплений: окопы, рвы, противотанковые ежи, ДОТы",
                "Упрощённое градостроительство: сектора, энергия, снабжение",
                "Фракция «Кобальтовый Синдикат»: дроны, щиты, орбитальные удары",
                "Деформация ландшафта и разрушаемые позиции",
                "Линии снабжения и мораль отрядов"
            ],
            build: { version: "0.3.7-prealpha (build 2214)", engine: "UE 5.4.4 (custom fork)", platform: "Win64 / DX12", date: "2026-11-02", size: "18.4 GiB", branch: "main → playtest" },
            description: "Флагман студии. Камерная RTS на 30–60 минут: игрок получает участок фронта и небольшой посёлок за ним. Днём — расширение города и производство, ночью — оборона. Главная особенность — инженерная система: траншеи роются прямо в ландшафте, рвы задерживают технику, противотанковые ежи и мешки с песком меняют маршруты ИИ в реальном времени. Градостроительство намеренно упрощено: сектора вместо отдельных зданий, три ресурса и одна линия снабжения, которую нужно защищать.",
            faction: "Кобальтовый Синдикат — колонисты внешних лун, ушедшие от метрополии. Технологичны, но малочисленны: компенсируют это дронами-сапёрами, энергощитами и мобильными ДОТами.",
            changelog: [
                "0.3.7 — копание траншей теперь перестраивает навмеш за < 40 мс",
                "0.3.6 — добавлены противотанковые ежи и рвы, ИИ техники учитывает препятствия",
                "0.3.5 — первая версия градостроительства: 6 типов секторов",
                "0.3.0 — переход на Mass Entity, до 1200 юнитов на карте"
            ],
            issues: ["Lumen даёт артефакты в глубоких траншеях", "Сохранения несовместимы с 0.3.6", "Мультиплеер только по приглашениям"]
        },
        {
            id: "trenchworks",
            code: "NX-02",
            title: "TRENCHWORKS",
            category: "ue5",
            status: "ALPHA",
            progress: 61,
            icon: "cpp",
            summary: "Плагин UE5 для процедурной деформации ландшафта: окопы и рвы копаются в реальном времени, навигация перестраивается на лету.",
            stack: ["UE5 Plugin", "C++", "Geometry Script", "Runtime Virtual Texture", "Recast NavMesh"],
            mechanics: [
                "Копание траншей кистью в рантайме",
                "Автостыковка сегментов и брустверы",
                "Частичная перестройка NavMesh",
                "Сохранение изменений в ячейках World Partition"
            ],
            build: { version: "0.6.1-alpha", engine: "UE 5.4", platform: "Win64 / Linux", date: "2026-10-27", size: "36 MiB", branch: "plugin/main" },
            description: "Ядро инженерной системы BASTION, вынесенное в отдельный плагин. Ландшафт хранится как слой высот поверх Landscape; при копании меняются только затронутые тайлы, а NavMesh пересобирается локально. Плагин планируется выложить в открытый доступ под GPL-3.0 после стабилизации API.",
            changelog: ["0.6.1 — брустверы из вынутого грунта", "0.6.0 — поддержка World Partition", "0.5.2 — экспорт траншей в сплайны"],
            issues: ["Нет поддержки Nanite Landscape", "Документация API в процессе"]
        },
        {
            id: "cobalt",
            code: "NX-03",
            title: "COBALT SYNDICATE · ART BIBLE",
            category: "ue5",
            status: "IN PROGRESS",
            progress: 47,
            icon: "blender",
            summary: "Визуальный язык и лор вымышленной Sci-Fi фракции: юниты, постройки, интерфейс командира и звуковой дизайн.",
            stack: ["Blender", "Substance Painter", "Niagara", "MetaSounds", "UE5 Materials"],
            mechanics: [
                "14 юнитов: от сапёров-дронов до шагающих ДОТов",
                "9 секторов города в модульной стилистике",
                "Энергощиты и орбитальные удары (Niagara)",
                "HUD командира в духе eDEX-UI"
            ],
            build: { version: "art-pack 2026.10", engine: "UE 5.4 / Blender 4.2", platform: "Assets", date: "2026-10-19", size: "6.2 GiB", branch: "art/main" },
            description: "Синдикат строит из того, что есть: модульные контейнеры, кобальтовые сплавы, оранжевая маркировка опасности. Интерфейс командира вдохновлён тем же eDEX-UI, что и этот сайт.",
            changelog: ["Октябрь — финальные модели 6 юнитов", "Сентябрь — гайд по цветам и маркировке", "Август — первые концепты секторов"],
            issues: ["Анимации шагающих ДОТов в черновом виде"]
        },
        {
            id: "nexuscraft",
            code: "NX-10",
            title: "NEXUS CRAFT",
            category: "minecraft",
            status: "LIVE",
            progress: 82,
            icon: "minecraft",
            summary: "Сеть серверов Minecraft сообщества: Hub, Survival+ с модом укреплений, Creative и мини-игры. Бесплатно и без доната.",
            stack: ["Paper 1.21.1", "Velocity", "Fabric", "Java 21", "LuckPerms", "CoreProtect"],
            mechanics: [
                "Единый аккаунт NEXUS ID для сайта и серверов",
                "Survival+ с модом FORTIFY и сезонными событиями",
                "Анти-гриф, откаты, приватные регионы",
                "Никакого pay-to-win: сервер некоммерческий"
            ],
            build: { version: "season 2026.4", engine: "Paper / Fabric 1.21.1", platform: "Java Edition", date: "2026-11-05", size: "modpack 212 MiB", branch: "prod" },
            description: "Сеть живёт на волонтёрских серверах и полностью некоммерческая: ни привилегий за деньги, ни лутбоксов. Сервер Survival+ служит полигоном для механик из BASTION — окопы и укрепления сначала проверяются здесь.",
            changelog: ["Сезон 2026.4 — новая карта Survival+", "Hub переведён на Velocity", "Добавлены мини-игры «Осада» и «Сапёр»"],
            issues: ["Mini-games: просадки TPS в вечерние часы"]
        },
        {
            id: "fortify",
            code: "NX-11",
            title: "FORTIFY MOD",
            category: "minecraft",
            status: "BETA",
            progress: 54,
            icon: "java",
            summary: "Мод для Minecraft: окопы, мешки с песком, колючая проволока и противотанковые ежи — порт инженерной системы BASTION.",
            stack: ["Fabric 1.21.1", "Java 21", "Gradle", "Mixin"],
            mechanics: [
                "Блок-окоп с укрытием от снарядов",
                "Ежи блокируют мобов, вагонетки и лошадей",
                "Мешки с песком гасят взрывы",
                "Чертежи укреплений и инструмент сапёра"
            ],
            build: { version: "0.9.2-beta", engine: "Fabric Loader 0.16", platform: "Java Edition 1.21.1", date: "2026-10-30", size: "4.1 MiB", branch: "release/0.9" },
            description: "Мод добавляет 23 блока и 4 инструмента. Цель — дать игрокам почувствовать механику обороны из BASTION задолго до релиза игры. Исходники открыты, сборки публикуются для участников сообщества.",
            changelog: ["0.9.2 — совместимость с Sodium", "0.9.0 — колючая проволока и чертежи", "0.8.0 — противотанковые ежи"],
            issues: ["Конфликт с модом Create при установке рельс"]
        },
        {
            id: "nexustech",
            code: "NX-12",
            title: "NEXUS TECH",
            category: "minecraft",
            status: "IN DEV",
            progress: 27,
            icon: "gradle",
            summary: "Sci-Fi мод во вселенной Кобальтового Синдиката: энергосети, дроны-строители и щитовые генераторы.",
            stack: ["NeoForge 1.21.1", "Java 21", "GeckoLib", "Gradle"],
            mechanics: [
                "Энергосеть с подстанциями и перегрузками",
                "Дроны-строители по чертежам",
                "Щитовые генераторы для баз",
                "Квесты-лор о колонистах внешних лун"
            ],
            build: { version: "0.2.0-dev", engine: "NeoForge 21.1", platform: "Java Edition 1.21.1", date: "2026-10-12", size: "9.8 MiB", branch: "dev" },
            description: "Экспериментальный мод, связывающий Minecraft-направление со вселенной BASTION. Модели юнитов адаптируются из арт-библии Синдиката.",
            changelog: ["0.2.0 — первые дроны", "0.1.0 — энергосеть и кабели"],
            issues: ["Нет баланса энергии", "Модели дронов временные"]
        },
        {
            id: "grid",
            code: "NX-20",
            title: "NEXUS GRID",
            category: "network",
            status: "LIVE",
            progress: 76,
            icon: "docker",
            summary: "Инфраструктура серверов: контейнеры, мониторинг, автоматические бэкапы и единая панель управления.",
            stack: ["Docker", "Pterodactyl", "Prometheus", "Grafana", "Restic", "Nginx"],
            mechanics: [
                "Каждый сервер — отдельный контейнер",
                "Бэкапы миров каждые 30 минут",
                "Алерты в Discord при падении TPS",
                "Панель управления в кабинете разработчика"
            ],
            build: { version: "infra 2026.11", engine: "Docker 27 / Debian 12", platform: "x86_64", date: "2026-11-01", size: "—", branch: "infra/main" },
            description: "Всё, на чём держатся игровые серверы. Конфигурации описаны как код и лежат в открытом репозитории. Таблица серверов в кабинете — фронтенд для этой системы.",
            changelog: ["Переезд на Restic", "Grafana-дашборды для плейтестов UE5"],
            issues: ["Хельсинки: единственный узел без резервирования"]
        },
        {
            id: "relay",
            code: "NX-21",
            title: "PLAYTEST RELAY",
            category: "network",
            status: "ALPHA",
            progress: 44,
            icon: "steam",
            summary: "Оркестрация выделенных серверов UE5 для плейтестов BASTION: очередь, матчмейкинг и автоскейл.",
            stack: ["UE5 Dedicated Server", "Go", "Agones", "Kubernetes", "Steamworks"],
            mechanics: [
                "Очередь плейтестеров по уровню допуска",
                "Автозапуск серверов под матч",
                "Сбор телеметрии матчей и крашей",
                "Раздача сборок через кабинет"
            ],
            build: { version: "0.4.0-alpha", engine: "Agones 1.42", platform: "Linux x86_64", date: "2026-10-22", size: "—", branch: "relay/main" },
            description: "Система, которая поднимает выделенные серверы BASTION только на время матча. Доступ к плейтестам выдаётся по уровню допуска PLAYTESTER и выше.",
            changelog: ["0.4.0 — интеграция с NEXUS ID", "0.3.0 — сбор крашдампов"],
            issues: ["EU-2 выведен на обслуживание"]
        },
        {
            id: "nexusid",
            code: "NX-22",
            title: "NEXUS ID",
            category: "network",
            status: "ALPHA",
            progress: 33,
            icon: "unlock",
            summary: "Единый аккаунт для портала, серверов Minecraft и плейтестов. Этот сайт — его будущий фронтенд.",
            stack: ["OAuth 2.1", "Postgres 16", "Rust", "WebAuthn"],
            mechanics: [
                "Один логин для сайта, Minecraft и UE5",
                "Уровни допуска: MEMBER → DEVELOPER",
                "Коды доступа для плейтестов",
                "Без трекинга и рекламы"
            ],
            build: { version: "0.3.0-alpha", engine: "Rust 1.82 / axum", platform: "Linux x86_64", date: "2026-10-15", size: "—", branch: "id/main" },
            description: "Пока что вход на сайте — демонстрационный и хранит профиль только в вашем браузере. Когда NEXUS ID выйдет из альфы, форма входа будет подключена к нему.",
            changelog: ["0.3.0 — коды доступа", "0.2.0 — WebAuthn"],
            issues: ["Нет восстановления пароля"]
        }
    ];

    /* ================================================================
     * Консоль (упрощённая замена xterm.js)
     * ================================================================ */
    const Terminal = {
        out: null,
        input: null,
        history: [],
        hIndex: 0,
        greeted: false,
        commands: {},

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
                await delay(speed || 14);
            }
        },
        async greet() {
            if (this.greeted || !this.out) return;
            this.greeted = true;
            const s = Auth.get();
            await this.type("NEXUS//DEV web shell v2.0.0 — interface adapted from eDEX-UI", "", 10);
            this.printHtml(`Welcome back, <span class="hl">${escapeHtml(s ? s.callsign : "guest")}</span>`);
            this.print(s ? `Уровень допуска: LEVEL ${s.level} // ${Auth.levelName(s.level)}` : "Вы не авторизованы. Команда «login» откроет вход.");
            this.print("Введите «help», чтобы увидеть список команд.");
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
            if (fn) {
                fn.call(this, args, line);
            } else {
                this.print(`${name}: command not found. Введите «help».`, "err");
                Sound.play("denied");
            }
        },
        init() {
            this.out = $("#term-output");
            this.input = $("#term-input");
            const form = $("#term-form");
            const term = $("#term");
            if (!this.out || !this.input || !form) return;

            form.addEventListener("submit", e => {
                e.preventDefault();
                const v = this.input.value;
                this.input.value = "";
                this.run(v);
            });
            term.addEventListener("click", e => {
                if (e.target.closest("a, button")) return;
                const sel = window.getSelection ? String(window.getSelection()) : "";
                if (!sel) this.input.focus({ preventScroll: true });
            });
            this.input.addEventListener("keydown", e => {
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
                    if (!v) return;
                    const matches = Object.keys(this.commands).filter(c => c.indexOf(v) === 0);
                    if (matches.length === 1) {
                        e.preventDefault();
                        this.input.value = matches[0] + " ";
                    } else if (matches.length > 1) {
                        e.preventDefault();
                        this.print(matches.join("  "));
                    }
                } else if (e.key.length === 1) {
                    Sound.play("stdin");
                }
            });

            const go = (url, msg) => {
                this.print(msg || `Переход: ${url} …`);
                setTimeout(() => { window.location.href = url; }, 500);
            };
            const scrollTo = id => {
                const el = document.getElementById(id);
                if (el) el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
            };
            const findProject = q => {
                q = (q || "").toLowerCase();
                return PROJECTS.find(p => p.id === q || p.code.toLowerCase() === q || p.title.toLowerCase().indexOf(q) === 0);
            };

            this.commands = {
                help() {
                    [
                        "Доступные команды:",
                        "  projects [ue5|minecraft|network] — реестр разработок",
                        "  open <id>       — открыть досье проекта (например: open bastion)",
                        "  status          — сводка по игровым серверам",
                        "  servers         — список серверов",
                        "  ip              — адрес сервера Minecraft",
                        "  faction         — лор фракции «Кобальтовый Синдикат»",
                        "  fortify         — список укреплений BASTION",
                        "  login | register | logout — вход, регистрация, выход",
                        "  dashboard       — личный кабинет",
                        "  whoami          — текущий пользователь",
                        "  neofetch        — информация о системе браузера",
                        "  date, echo, history, clear",
                        "  sfx on|off      — звуки интерфейса eDEX-UI",
                        "  credits         — лицензия и происхождение интерфейса",
                        "  reboot          — повторить анимацию загрузки"
                    ].forEach(l => this.print(l));
                },
                projects(args) {
                    const cat = (args[0] || "").toLowerCase();
                    const list = PROJECTS.filter(p => !cat || p.category === cat);
                    if (!list.length) { this.print(`projects: неизвестная категория «${cat}». Доступно: ue5, minecraft, network`, "err"); return; }
                    this.print("ID            CATEGORY          STATUS        PROGRESS");
                    list.forEach(p => {
                        const bar = "█".repeat(Math.round(p.progress / 10)).padEnd(10, "░");
                        this.print(`${p.id.padEnd(13)} ${CATEGORIES[p.category].padEnd(17)} ${p.status.padEnd(13)} ${bar} ${p.progress}%`);
                    });
                    this.printHtml('Полный реестр: <a href="projects.html">projects.html</a> · досье: <span class="hl">open &lt;id&gt;</span>');
                },
                open(args) {
                    const p = findProject(args[0]);
                    if (!p) { this.print(`open: проект «${args[0] || ""}» не найден. Введите «projects».`, "err"); return; }
                    go(`projects.html#dossier-${p.id}`, `Открываю досье ${p.code} · ${p.title} …`);
                },
                dossier(args) { this.commands.open.call(this, args); },
                status() {
                    const s = Telemetry.summary();
                    this.print(`servers online : ${s.online}/${s.total}`);
                    this.print(`players online : ${s.players}`);
                    this.print(`avg ping       : ${Math.round(s.avgPing)} ms`);
                    this.print("подробнее → раздел «Статус серверов» или кабинет");
                    scrollTo("status");
                },
                servers() {
                    this.print("ID           TYPE       STATUS       PLAYERS   PING");
                    SERVERS.forEach(n => {
                        this.print(`${n.id.padEnd(12)} ${n.type.padEnd(10)} ${n.status.toUpperCase().padEnd(12)} ${formatPlayers(n).padEnd(9)} ${Telemetry.isUp(n) ? Math.round(n.ping) + " ms" : "—"}`);
                    });
                },
                ip() {
                    this.printHtml('Minecraft Java Edition 1.21.1 → <span class="hl">play.nexusdev.example</span>');
                    copyText("play.nexusdev.example").then(ok => { if (ok) this.print("адрес скопирован в буфер обмена"); });
                },
                faction() {
                    [
                        "КОБАЛЬТОВЫЙ СИНДИКАТ // COBALT SYNDICATE",
                        "Колонисты внешних лун, отказавшиеся подчиняться метрополии.",
                        "Малочисленны, но технологичны: дроны-сапёры, энергощиты,",
                        "мобильные ДОТы и орбитальные удары по запросу командира.",
                        "Девиз: «Держи линию. Остальное — инженерия.»"
                    ].forEach(l => this.print(l));
                },
                fortify() {
                    this.print("TYPE        COST   BUILD   EFFECT");
                    [
                        ["TRENCH", "20", "8s", "укрытие пехоты −60% урона"],
                        ["MOAT", "35", "14s", "техника замедлена на 70%"],
                        ["HEDGEHOG", "15", "5s", "блокирует проход техники"],
                        ["BUNKER", "120", "40s", "огневая точка, 6 бойцов"],
                        ["WIRE", "10", "4s", "пехота замедлена на 50%"],
                        ["SANDBAG", "8", "3s", "гасит осколки и взрывы"]
                    ].forEach(r => this.print(`${r[0].padEnd(11)} ${r[1].padEnd(6)} ${r[2].padEnd(7)} ${r[3]}`));
                },
                login() {
                    const s = Auth.get();
                    if (s) { this.print(`Вы уже вошли как ${s.callsign} (LEVEL ${s.level}). Команда «dashboard» откроет кабинет.`); return; }
                    go("auth.html", "Открываю защищённый терминал авторизации…");
                },
                register() {
                    go("auth.html#register", "Открываю форму регистрации…");
                },
                logout() {
                    if (!Auth.get()) { this.print("logout: вы и так гость"); return; }
                    Auth.logout();
                    this.print("Сессия завершена. До встречи на линии фронта.");
                    Sound.play("denied");
                },
                dashboard() { go("dashboard.html", "Открываю личный кабинет…"); },
                cabinet() { go("dashboard.html", "Открываю личный кабинет…"); },
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
                        window.scrollTo(0, 0);
                        Boot.run().then(revealUI);
                    }, 400);
                },
                exit() { this.print("logout: в браузере некуда выходить :) Используйте «logout»."); },
                clear() { this.out.innerHTML = ""; },
                ls() { this.print(Object.keys(DOCS).map(k => DOCS[k].title).join("  ")); },
                cat(args) {
                    const q = (args[0] || "").toLowerCase();
                    const key = Object.keys(DOCS).find(k => DOCS[k].title.toLowerCase() === q);
                    if (key) { this.print(`Открываю ${DOCS[key].title}…`); Docs.open(key); }
                    else this.print(`cat: ${args[0] || ""}: No such file or directory`, "err");
                }
            };
            updateUserUI();
        }
    };

    /* ================================================================
     * Модальные окна (modal.class.js) — перетаскиваются за заголовок
     * ================================================================ */
    const Modal = {
        current: null,
        lastFocus: null,
        open(opts) {
            this.close(true);
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
                el.textContent = b.label;
                if (b.href) {
                    el.href = b.href;
                    if (b.external) { el.target = "_blank"; el.rel = "noopener noreferrer"; }
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
                    if (b.close || (b.href && b.href.charAt(0) === "#")) this.close();
                });
                actions.appendChild(el);
            });

            document.body.appendChild(backdrop);
            document.body.appendChild(modal);
            requestAnimationFrame(() => backdrop.classList.add("visible"));

            if (!reducedMotion()) {
                modal.classList.add("blink");
                setTimeout(() => modal.classList.remove("blink"), 160);
            }

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
            modal.remove();
            backdrop.remove();
            this.current = null;
            if (typeof onClose === "function") onClose();
            if (!silent && this.lastFocus && typeof this.lastFocus.focus === "function") {
                this.lastFocus.focus({ preventScroll: true });
            }
        },
        makeDraggable(modal, handle) {
            if (!handle) return;
            let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
            handle.addEventListener("pointerdown", e => {
                if (e.button !== 0) return;
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
     * Файлы на главной (filesystem.class.js → открытие в модалке)
     * ================================================================ */
    const DOCS = {
        readme: {
            title: "README.md",
            subtitle: "/srv/nexus/docs",
            html: `
                <h5>NEXUS//DEV — некоммерческий портал инди-разработки</h5>
                <p>Небольшая команда энтузиастов, которая делает тактическую RTS на Unreal Engine 5 и поддерживает сеть серверов Minecraft с собственными модами.</p>
                <ul>
                    <li><b>BASTION: LINE ZERO</b> — флагманская RTS с системой укреплений и упрощённым градостроительством</li>
                    <li><b>NEXUS CRAFT</b> — серверы Minecraft без доната и pay-to-win</li>
                    <li><b>FORTIFY / NEXUS TECH</b> — моды, переносящие механики BASTION в Minecraft</li>
                </ul>
                <p>Проект некоммерческий: всё, что мы делаем, бесплатно для игроков, а код сайта открыт под GPL-3.0.</p>`
        },
        devlog: {
            title: "devlog-07.md",
            subtitle: "BASTION // окопы",
            html: `
                <h5>Devlog #7 — как мы роем окопы в Unreal Engine 5</h5>
                <p>Главная механика BASTION — инженерная оборона. Игрок рисует линию траншеи, и сапёры начинают копать её прямо в ландшафте. За последний месяц мы переписали систему трижды.</p>
                <ol>
                    <li><b>Деформация.</b> Высоты хранятся отдельным слоем поверх Landscape, меняются только затронутые тайлы 32×32.</li>
                    <li><b>Навигация.</b> NavMesh пересобирается локально — меньше 40 мс на сегмент.</li>
                    <li><b>ИИ.</b> Техника оценивает рвы и ежи как стоимость прохода, а не как стены: иногда выгоднее объехать, иногда — прорваться.</li>
                </ol>
<pre class="code"><code>// TrenchSubsystem.cpp (фрагмент)
void UTrenchSubsystem::DigSegment(const FTrenchSegment&amp; Seg)
{
    HeightLayer-&gt;Carve(Seg.Spline, Seg.Depth, Seg.Width);
    NavSystem-&gt;RebuildTiles(Seg.GetBounds().ExpandBy(200.f));
    OnTrenchChanged.Broadcast(Seg.Id);
}</code></pre>
                <p>Следующий шаг — брустверы из вынутого грунта и укрепление стенок досками.</p>`
        },
        patch: {
            title: "patchnotes-0.3.7.txt",
            subtitle: "BASTION",
            html: `
<pre class="code"><code>BASTION: LINE ZERO — 0.3.7-prealpha (build 2214)
================================================
[+] Окопы перестраивают навигацию за &lt; 40 мс
[+] Противотанковые ежи можно разбирать сапёрами
[+] Сектор «Ремонтный док» в градостроительстве
[*] Мораль отрядов падает медленнее в укрытиях
[*] Синдикат: щит ДОТа потребляет на 15% меньше энергии
[-] Исправлен вылет при одновременном копании 50+ сегментов
[-] Исправлено мерцание Lumen на краях рвов
[!] Сохранения 0.3.6 не поддерживаются</code></pre>`
        },
        fortify: {
            title: "fortifications.md",
            subtitle: "дизайн-документ",
            html: `
                <h5>Укрепления BASTION</h5>
                <table class="edex-table">
                    <thead><tr><th>Тип</th><th>Стоимость</th><th>Постройка</th><th>Эффект</th></tr></thead>
                    <tbody>
                        <tr><td>Окоп</td><td>20</td><td>8 c</td><td>Пехота получает на 60% меньше урона</td></tr>
                        <tr><td>Ров</td><td>35</td><td>14 c</td><td>Техника замедляется на 70%</td></tr>
                        <tr><td>Противотанковый ёж</td><td>15</td><td>5 c</td><td>Блокирует проход техники</td></tr>
                        <tr><td>ДОТ</td><td>120</td><td>40 c</td><td>Огневая точка на 6 бойцов</td></tr>
                        <tr><td>Колючая проволока</td><td>10</td><td>4 c</td><td>Пехота замедляется на 50%</td></tr>
                        <tr><td>Мешки с песком</td><td>8</td><td>3 c</td><td>Гасят осколки и взрывы</td></tr>
                    </tbody>
                </table>
                <p>Все укрепления можно разрушить: артиллерия засыпает окопы, сапёры противника разбирают ежи.</p>`
        },
        modpack: {
            title: "modpack.json",
            subtitle: "NEXUS CRAFT",
            html: `
<pre class="code"><code>{
  "name": "NEXUS CRAFT",
  "season": "2026.4",
  "minecraft": "1.21.1",
  "loader": "fabric@0.16.5",
  "mods": [
    { "id": "fortify", "version": "0.9.2-beta", "side": "both" },
    { "id": "sodium", "version": "0.6.0", "side": "client" },
    { "id": "lithium", "version": "0.13.0", "side": "both" },
    { "id": "voicechat", "version": "2.5.24", "side": "both" }
  ],
  "server": "play.nexusdev.example"
}</code></pre>`
        },
        rules: {
            title: "server-rules.md",
            subtitle: "NEXUS CRAFT",
            html: `
                <h5>Правила серверов NEXUS CRAFT</h5>
                <ol>
                    <li>Без гриферства и читов. Откаты делаются через CoreProtect, бан — навсегда.</li>
                    <li>Уважайте других игроков: никаких оскорблений и спама.</li>
                    <li>Окопы и укрепления (мод FORTIFY) можно строить только в своём регионе или в зоне «Фронт».</li>
                    <li>Сервер некоммерческий: торговля внутриигровыми вещами за реальные деньги запрещена.</li>
                    <li>Нашли баг — сообщите в кабинете или в Discord и получите значок «Сапёр».</li>
                </ol>`
        },
        faq: {
            title: "FAQ.md",
            subtitle: "частые вопросы",
            html: `
                <h5>Когда выйдет BASTION?</h5>
                <p>Сейчас игра в пре-альфе. Закрытые плейтесты проходят раз в две недели для участников с уровнем PLAYTESTER.</p>
                <h5>Как попасть на плейтест?</h5>
                <p>Зарегистрируйтесь и введите код доступа, полученный от команды. Для демонстрации используйте кнопку DEMO ACCESS на странице входа.</p>
                <h5>Сколько стоит сервер Minecraft?</h5>
                <p>Нисколько. Проект некоммерческий, без доната и привилегий за деньги.</p>
                <h5>Почему сайт выглядит как терминал?</h5>
                <p>Дизайн перенесён из открытого проекта eDEX-UI (тема «blade») с соблюдением лицензии GPL-3.0.</p>`
        },
        license: {
            title: "LICENSE",
            subtitle: "GPL-3.0",
            html: `
                <h5>GNU General Public License v3.0</h5>
                <p>Код этого сайта распространяется под лицензией GPL-3.0. Вы можете свободно использовать, изучать, изменять и распространять его при условии сохранения той же лицензии и указания авторства.</p>
                <p>Визуальный стиль, CSS-правила, шрифты, звуки и иконки перенесены и адаптированы из <a href="https://github.com/GitSquared/edex-ui" target="_blank" rel="noopener noreferrer">eDEX-UI</a> (© Gabriel “Squared” Saillard, GPL-3.0). Скошенные рамки — библиотека augmented-ui 1.1.2 (BSD-2-Clause).</p>
                <p>Полный текст лицензии — в файле <a href="LICENSE">LICENSE</a> в корне сайта.</p>`,
            buttons: [{ label: "Открыть LICENSE", href: "LICENSE" }]
        }
    };

    const Docs = {
        open(key) {
            const doc = DOCS[key];
            if (!doc) return;
            Sound.play("folder");
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
     * Копирование в буфер (адрес сервера и т.п.)
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
    function initCopyButtons() {
        document.addEventListener("click", e => {
            const btn = e.target.closest("[data-copy]");
            if (!btn) return;
            e.preventDefault();
            const text = btn.getAttribute("data-copy");
            copyText(text).then(ok => {
                Sound.play(ok ? "granted" : "denied");
                toast(ok ? `Скопировано: ${text}` : `Не удалось скопировать. Адрес: ${text}`, ok ? "ok" : "warn");
                btn.classList.add("is-done");
                setTimeout(() => btn.classList.remove("is-done"), 1200);
            });
        });
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
     * Появление при скролле, счётчики, клавиши, глитч
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

    function initCounters() {
        const els = $$("[data-count]");
        const animate = el => {
            const target = parseInt(el.getAttribute("data-count"), 10) || 0;
            const suffix = el.getAttribute("data-suffix") || "";
            if (reducedMotion()) { el.textContent = target + suffix; return; }
            const dur = 1200;
            const t0 = performance.now();
            const step = now => {
                const p = clamp((now - t0) / dur, 0, 1);
                const eased = 1 - Math.pow(1 - p, 3);
                el.textContent = Math.round(target * eased) + suffix;
                if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        };
        if (!("IntersectionObserver" in window)) { els.forEach(animate); return; }
        const io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (en.isIntersecting) { animate(en.target); io.unobserve(en.target); }
            });
        }, { threshold: 0.5 });
        els.forEach(el => io.observe(el));
    }

    /* Клавиши (keyboard.css): «меню постройки» укреплений */
    function initKeys() {
        const row = $("#key-row");
        const caption = $("#key-caption");
        if (!row) return;
        const keys = $$(".keycap", row);

        if ("IntersectionObserver" in window && !reducedMotion()) {
            const io = new IntersectionObserver(entries => {
                entries.forEach(en => {
                    if (en.isIntersecting) {
                        row.classList.add("is-revealing");
                        Sound.play("keyboard");
                        io.disconnect();
                    }
                });
            }, { threshold: 0.6 });
            io.observe(row);
        }

        keys.forEach(k => {
            k.addEventListener("click", () => {
                keys.forEach(o => o.classList.remove("active", "blink"));
                k.classList.add("active");
                Sound.play("stdin");
                if (caption) {
                    caption.innerHTML = "";
                    const sign = document.createElement("span");
                    sign.className = "prompt-sign";
                    sign.textContent = "> ";
                    caption.appendChild(sign);
                    caption.appendChild(document.createTextNode(k.getAttribute("data-desc") || ""));
                }
            });
        });

        setInterval(() => {
            if (reducedMotion() || keys.some(k => k.classList.contains("active"))) return;
            const k = pick(keys);
            k.classList.add("blink");
            setTimeout(() => k.classList.remove("blink"), 1000);
        }, 4000);
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
        setTimeout(loop, 3500);
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
        initCpu();
        initRam();
        initStatusTable();
        initToplist();
        initRadar();
        Tabs.init();
        Terminal.init();
        Docs.init();
        initCopyButtons();
        initNav();
        observeReveal();
        initCounters();
        initKeys();
        initGlitch();

        setInterval(tickTelemetry, 2000);

        // Синхронизация входа/выхода между вкладками браузера
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
        storage, Settings, Sound, Auth, LEVELS, ACCESS_CODES, toast, showBanner, Modal, Tabs, Syslog,
        SERVERS, Telemetry, statusBadge, formatPlayers, PROJECTS, CATEGORIES, Docs, LineChart, walker,
        observeReveal, reducedMotion, copyText, updateUserUI, NICKS
    };

    init();
})();
