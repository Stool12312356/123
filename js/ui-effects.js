/*
 * ui-effects.js
 * ------------------------------------------------------------------
 * Браузерные (Vanilla JS) аналоги модулей eDEX-UI для темы «blade».
 * Никакого Electron / Node.js: нет require(), fs, ipc, systeminformation.
 *
 *  - Экран загрузки (boot log + glitch-заголовок)  ← _renderer.js displayLine/displayTitleScreen
 *  - Звуки интерфейса                               ← classes/audiofx.class.js
 *  - Часы                                           ← classes/clock.class.js
 *  - Системная информация                           ← classes/sysinfo.class.js
 *  - Графики CPU / сети                             ← classes/cpuinfo.class.js, conninfo.class.js
 *  - Карта памяти                                   ← classes/ramwatcher.class.js
 *  - Статус сети, топ процессов                     ← classes/netstat.class.js, toplist.class.js
 *  - Модальные окна (перетаскиваемые)               ← classes/modal.class.js
 *  - Консоль                                        ← упрощённая замена xterm.js + node-pty
 *
 * Все «системные» данные, которые браузер не отдаёт, — демонстрационные
 * (генерируются локально). Сайт работает как с http(s)://, так и с file://.
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
    const pad = (n, l) => String(n).padStart(l || 2, "0");
    const reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const startTime = Date.now();

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
            try { window.localStorage.setItem(key, value); } catch (e) { /* приватный режим / file:// */ }
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

    /* Цвет темы читаем из CSS-переменных (blade.json → :root) */
    function readTheme() {
        const cs = getComputedStyle(document.documentElement);
        const r = parseInt(cs.getPropertyValue("--color_r"), 10);
        const g = parseInt(cs.getPropertyValue("--color_g"), 10);
        const b = parseInt(cs.getPropertyValue("--color_b"), 10);
        return {
            r: isNaN(r) ? 204 : r,
            g: isNaN(g) ? 94 : g,
            b: isNaN(b) ? 55 : b,
            lightBlack: (cs.getPropertyValue("--color_light_black") || "#090B0A").trim()
        };
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
     * Звук (audiofx.class.js) — выключен по умолчанию
     * ================================================================ */
    const Sound = {
        enabled: storage.get("nc_sfx", "off") === "on",
        files: {
            stdout: "assets/audio/stdout.wav",
            stdin: "assets/audio/stdin.wav",
            folder: "assets/audio/folder.wav",
            granted: "assets/audio/granted.wav",
            panels: "assets/audio/panels.wav",
            info: "assets/audio/info.wav",
            expand: "assets/audio/expand.wav",
            keyboard: "assets/audio/keyboard.wav",
            theme: "assets/audio/theme.wav"
        },
        volumes: { stdout: 0.35, stdin: 0.4, folder: 0.5, granted: 0.5, panels: 0.5, info: 0.5, expand: 0.5, keyboard: 0.5, theme: 0.5 },
        cache: {},
        lastPlay: {},
        play(name) {
            if (!this.enabled || !this.files[name]) return;
            const now = performance.now();
            if (name === "stdout" && this.lastPlay[name] && now - this.lastPlay[name] < 60) return;
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
            this.enabled = !!on;
            storage.set("nc_sfx", this.enabled ? "on" : "off");
            const btn = $("#sound-toggle");
            const state = $("#sound-state");
            if (btn) btn.setAttribute("aria-pressed", String(this.enabled));
            if (state) state.textContent = this.enabled ? "ON" : "OFF";
            if (this.enabled) this.play("granted");
        }
    };

    function initSoundToggle() {
        const btn = $("#sound-toggle");
        if (!btn) return;
        btn.setAttribute("aria-pressed", String(Sound.enabled));
        const state = $("#sound-state");
        if (state) state.textContent = Sound.enabled ? "ON" : "OFF";
        btn.addEventListener("click", () => Sound.set(!Sound.enabled));
    }

    /* ================================================================
     * Экран загрузки (boot_screen) — по мотивам _renderer.js
     * ================================================================ */
    const BOOT_LOG = /* edex-ui/src/assets/misc/boot_log.txt из eDEX-UI (встроен, чтобы работать через file://) */
    [
        "Welcome to NODE//COMMONS!",
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
                    appendLine(`NODE//COMMONS Kernel version 1.0.0 boot at ${new Date().toString()}; root:xnu-1699.22.73~1/RELEASE_X86_64`);
                }
                let ms;
                if (n === 2 || n === 4) ms = 260;
                else if (n > 4 && n < 25) ms = 14;
                else if (n === 25) ms = 200;
                else if (n === 42) ms = 150;
                else if (n > 42 && n < 82) ms = 11;
                else if (n >= BOOT_LOG.length - 2) ms = 160;
                else ms = Math.pow(1 - (n / 1000), 3) * 12;
                // Короткие задержки копим и выводим по несколько строк за кадр,
                // чтобы скорость лога не зависела от минимального шага setTimeout
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
                body.classList.remove("solidBackground");
                screen.classList.add("center");
                const title = document.createElement("h1");
                title.textContent = "NODE//COMMONS";
                title.setAttribute("data-text", "NODE//COMMONS");
                screen.innerHTML = "";
                screen.appendChild(title);

                await this.wait(200);
                body.classList.add("solidBackground");
                await this.wait(100);
                title.className = "flash";
                await this.wait(300);
                title.className = "boxed";
                await this.wait(100);
                title.className = "glitch";
                await this.wait(500);
                body.classList.remove("solidBackground");
                title.className = "boxed";
                await this.wait(700);
            }

            // --- завершение
            document.removeEventListener("keydown", onKey);
            screen.remove();
            skipBtn.remove();
            body.classList.remove("is-booting", "solidBackground");
            storage.sessionSet("nc_booted", "1");
            this.running = false;
        }
    };

    function shouldBoot() {
        if (reducedMotion) return false;
        if (storage.sessionGet("nc_booted") === "1") return false;
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
        // перезапуск CSS-анимаций при повторном reboot
        void document.body.offsetWidth;
        document.body.classList.add("ui-ready");
        Sound.play("expand");
        setTimeout(() => Sound.play("panels"), 500);
        if (first) {
            setTimeout(() => Terminal.greet(), reducedMotion ? 0 : 900);
        }
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
        let spans = clock ? clock.querySelectorAll("span") : [];
        const tick = () => {
            const d = new Date();
            const str = pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
            for (let i = 0; i < spans.length && i < 6; i++) {
                if (spans[i].textContent !== str[i]) spans[i].textContent = str[i];
            }
            if (headerClock) headerClock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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

        // POWER: Battery Status API (если доступен)
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

        const year = $("#year");
        if (year) year.textContent = String(new Date().getFullYear());
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
            const pad = 2 * this.dpr;
            const toY = v => {
                const n = (clamp(v, opts.min, opts.max) - opts.min) / (opts.max - opts.min);
                return opts.invert ? pad + n * (h - pad * 2) : h - pad - n * (h - pad * 2);
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
     * CPU (cpuinfo.class.js) — синтетическая нагрузка + реальный FPS
     * ================================================================ */
    function initCpu() {
        const c1 = $("#cpu-canvas-1");
        const c2 = $("#cpu-canvas-2");
        if (!c1 || !c2) return;
        const chart1 = new LineChart(c1, { series: 2, points: 50 });
        const chart2 = new LineChart(c2, { series: 2, points: 50 });
        const cores = [walker(18, 2, 95, 7, 0.04), walker(26, 2, 95, 7, 0.04), walker(12, 2, 95, 6, 0.03), walker(32, 2, 95, 8, 0.05)];
        const avg1 = $("#cpu-avg1"), avg2 = $("#cpu-avg2");
        const fpsEl = $("#cpu-fps"), loadEl = $("#cpu-load"), maxEl = $("#cpu-max"), tasksEl = $("#cpu-tasks");
        let visible = true;
        let max = 0;
        let tasks = randInt(180, 260);

        whenVisible(c1.closest(".mod"), v => { visible = v; });

        // FPS (реальное значение из requestAnimationFrame)
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

        // предзаполнение, чтобы графики не стартовали с пустой линии
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
            tasks = clamp(tasks + randInt(-3, 3), 150, 320);
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
        // shuffleArray() — как в оригинале
        for (let i = points.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = points[i]; points[i] = points[j]; points[j] = t;
        }

        const totalGiB = navigator.deviceMemory ? Math.max(4, navigator.deviceMemory * 2) : 16;
        const used = walker(0.42, 0.25, 0.78, 0.025);
        const avail = walker(0.14, 0.06, 0.22, 0.01);
        const swap = walker(0.18, 0.02, 0.6, 0.02);
        const info = $("#ram-info");
        const bar = $("#ram-swapbar");
        const swapText = $("#ram-swaptext");
        const swapTotal = Math.round(totalGiB / 4);

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

        const applyOnline = () => {
            Net.online = navigator.onLine !== false;
            const label = Net.online ? "ONLINE" : "OFFLINE";
            if (stateEl) stateEl.textContent = label;
            if (uplinkState) uplinkState.textContent = label;
            if (uplinkDot) uplinkDot.classList.toggle("is-offline", !Net.online);
            if (conn) conn.classList.toggle("offline", !Net.online);
            Syslog.add(Net.online ? "netstat: uplink restored, interface UP" : "netstat: uplink lost, interface DOWN", !Net.online);
        };
        window.addEventListener("online", applyOnline);
        window.addEventListener("offline", applyOnline);
        Net.online = navigator.onLine !== false;
        if (stateEl) stateEl.textContent = Net.online ? "ONLINE" : "OFFLINE";
        if (uplinkState) uplinkState.textContent = Net.online ? "ONLINE" : "OFFLINE";
        if (uplinkDot) uplinkDot.classList.toggle("is-offline", !Net.online);
        if (conn) conn.classList.toggle("offline", !Net.online);

        // Network Information API (если доступен)
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

        // Графики трафика
        const top = $("#conn-canvas-top");
        const bottom = $("#conn-canvas-bottom");
        if (!top || !bottom) return;
        const up = new LineChart(top, { series: 1, points: 70, max: 2, fill: true });
        const down = new LineChart(bottom, { series: 1, points: 70, max: 12, fill: true, invert: true });
        const upW = walker(0.4, 0.02, 1.9, 0.18, 0.04);
        const downW = walker(3, 0.1, 11.5, 0.9, 0.05);
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
     * Телеметрия узлов (данные для таблицы статуса, радара, toplist)
     * ================================================================ */
    const NODES = [
        { id: "ams-01", city: "Амстердам", cc: "NL", angle: 300, dist: 0.35, ping: 14, load: 46, traffic: 3.4, status: "online", uptime: 99.99 },
        { id: "fra-02", city: "Франкфурт", cc: "DE", angle: 20, dist: 0.25, ping: 11, load: 62, traffic: 4.8, status: "online", uptime: 99.98 },
        { id: "ber-01", city: "Берлин", cc: "DE", angle: 60, dist: 0.42, ping: 17, load: 38, traffic: 2.1, status: "online", uptime: 99.95 },
        { id: "hel-01", city: "Хельсинки", cc: "FI", angle: 25, dist: 0.85, ping: 31, load: 29, traffic: 1.6, status: "online", uptime: 99.97 },
        { id: "waw-01", city: "Варшава", cc: "PL", angle: 85, dist: 0.6, ping: 24, load: 55, traffic: 2.7, status: "online", uptime: 99.91 },
        { id: "prg-01", city: "Прага", cc: "CZ", angle: 115, dist: 0.4, ping: 19, load: 41, traffic: 1.9, status: "online", uptime: 99.96 },
        { id: "tll-01", city: "Таллин", cc: "EE", angle: 45, dist: 0.95, ping: 0, load: 0, traffic: 0, status: "offline", uptime: 98.72 },
        { id: "lis-01", city: "Лиссабон", cc: "PT", angle: 235, dist: 0.9, ping: 58, load: 81, traffic: 1.2, status: "degraded", uptime: 99.62 }
    ];
    NODES.forEach(n => {
        n.pid = randInt(1200, 9800);
        n.mem = rand(12, 48);
        n.syncAgo = randInt(1, 25);
        n.syncing = false;
    });

    const Telemetry = {
        listeners: [],
        on(fn) { this.listeners.push(fn); },
        emit() { this.listeners.forEach(fn => fn(NODES)); },
        summary() {
            const online = NODES.filter(n => n.status !== "offline");
            const avgPing = online.length ? online.reduce((s, n) => s + n.ping, 0) / online.length : 0;
            const traffic = online.reduce((s, n) => s + n.traffic, 0);
            return { online: online.length, total: NODES.length, avgPing, traffic };
        }
    };

    /*
     * tickTelemetry() — точка интеграции с реальным мониторингом.
     * Замените тело функции на fetch() к своему API и заполните NODES.
     */
    function tickTelemetry() {
        NODES.forEach(n => {
            // смена статуса (редко)
            const r = Math.random();
            const prev = n.status;
            if (n.status === "offline" && r < 0.04) n.status = "online";
            else if (n.status === "online" && r < 0.003) n.status = "degraded";
            else if (n.status === "degraded" && r < 0.08) n.status = "online";
            else if (n.status === "online" && r > 0.9985) n.status = "offline";

            if (n.status === "offline") {
                n.ping = 0; n.load = 0; n.traffic = 0;
            } else {
                const base = n.status === "degraded" ? 55 : 12 + n.dist * 22;
                n.ping = clamp((n.ping || base) + rand(-3, 3), base * 0.7, base * 1.5);
                n.load = clamp((n.load || 40) + rand(-6, 6), 8, n.status === "degraded" ? 97 : 88);
                n.traffic = clamp((n.traffic || 1.5) + rand(-0.35, 0.35), 0.3, 6.5);
                n.mem = clamp(n.mem + rand(-2, 2), 8, 70);
            }
            // синхронизация с апстримом
            if (n.status !== "offline") {
                if (n.syncing) {
                    if (Math.random() < 0.3) {
                        n.syncing = false;
                        n.syncAgo = 0;
                        Syslog.add(`rsync[${n.pid}]: ${n.id} sync complete, ${randInt(120, 4800)} files, ${rand(0.2, 6).toFixed(1)} GiB`);
                    }
                } else {
                    n.syncAgo += 2 / 60;
                    if (n.syncAgo > 30 && Math.random() < 0.2) n.syncing = true;
                }
            }
            n.changed = prev !== n.status;
            if (n.changed) {
                const msg = n.status === "offline" ? `healthcheck: ${n.id} (${n.city}) is DOWN — failover engaged`
                    : n.status === "degraded" ? `healthcheck: ${n.id} latency above threshold (${Math.round(n.ping)} ms)`
                        : `healthcheck: ${n.id} is back ONLINE`;
                Syslog.add(msg, n.status !== "online");
            }
        });
        Telemetry.emit();
    }

    function initStatusTable() {
        const tbody = $("#status-body");
        const updated = $("#status-updated");
        const headerNodes = $("#header-nodes");
        const sumOnline = $("#sum-online");
        const sumPing = $("#sum-ping");
        const sumTraffic = $("#sum-traffic");
        const labels = ["Узел", "Локация", "Статус", "Ping", "Нагрузка", "Трафик", "Синхр.", "Аптайм"];
        const rows = {};

        if (tbody) {
            NODES.forEach(n => {
                const tr = document.createElement("tr");
                tr.innerHTML = labels.map((l, i) => `<td data-label="${l}" data-col="${i}"></td>`).join("");
                tr.children[0].textContent = n.id;
                tr.children[1].textContent = `${n.city}, ${n.cc}`;
                tr.children[4].innerHTML = '<span class="loadbar"><span class="loadbar-track"><span class="loadbar-fill"></span></span><span class="loadbar-val"></span></span>';
                tbody.appendChild(tr);
                rows[n.id] = tr;
            });
        }

        const statusBadge = s => s === "online" ? '<span class="badge badge-online">ONLINE</span>'
            : s === "degraded" ? '<span class="badge badge-degraded">DEGRADED</span>'
                : '<span class="badge badge-offline">OFFLINE</span>';

        const render = () => {
            NODES.forEach(n => {
                const tr = rows[n.id];
                if (!tr) return;
                const c = tr.children;
                const badge = statusBadge(n.status);
                if (c[2].innerHTML !== badge) c[2].innerHTML = badge;
                c[3].textContent = n.status === "offline" ? "—" : Math.round(n.ping) + " ms";
                const fill = c[4].querySelector(".loadbar-fill");
                const val = c[4].querySelector(".loadbar-val");
                if (fill) fill.style.width = Math.round(n.load) + "%";
                if (val) val.textContent = n.status === "offline" ? "—" : Math.round(n.load) + "%";
                c[5].textContent = n.status === "offline" ? "—" : n.traffic.toFixed(1) + " Gb/s";
                c[6].textContent = n.status === "offline" ? "нет связи" : (n.syncing ? "синхр…" : (n.syncAgo < 1 ? "только что" : Math.floor(n.syncAgo) + " мин назад"));
                c[7].textContent = n.uptime.toFixed(2) + "%";
                tr.classList.toggle("is-offline", n.status === "offline");
                if (n.changed) {
                    tr.classList.remove("flash");
                    void tr.offsetWidth;
                    tr.classList.add("flash");
                }
            });
            const s = Telemetry.summary();
            if (headerNodes) headerNodes.textContent = `${s.online}/${s.total}`;
            if (sumOnline) sumOnline.textContent = `${s.online}/${s.total}`;
            if (sumPing) sumPing.textContent = Math.round(s.avgPing) + " ms";
            if (sumTraffic) sumTraffic.textContent = s.traffic.toFixed(1) + " Gb/s";
            if (updated) {
                const d = new Date();
                updated.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            }
        };

        Telemetry.on(render);
        render();
    }

    /* ================================================================
     * TOP MIRRORS (toplist.class.js)
     * ================================================================ */
    function initToplist() {
        const tbody = $("#toplist tbody");
        if (!tbody) return;
        const render = () => {
            const top = NODES.filter(n => n.status !== "offline").sort((a, b) => b.load - a.load).slice(0, 5);
            tbody.innerHTML = top.map(n => `<tr><td>${n.pid}</td><td>${escapeHtml(n.id)}</td><td>${Math.round(n.load)}%</td><td>${Math.round(n.mem)}%</td></tr>`).join("");
        };
        Telemetry.on(render);
        render();
    }

    /* ================================================================
     * Радар узлов (замена 3D-глобуса locationGlobe.class.js)
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

        Telemetry.on(() => {
            if (info) info.textContent = `${Telemetry.summary().online}/${NODES.length} ENDPOINTS`;
        });

        const draw = now => {
            const dt = Math.min(100, now - last);
            last = now;
            if (visible) {
                if (!reducedMotion) angle = (angle + dt * 0.0012) % (Math.PI * 2);
                const w = canvas.width, h = canvas.height;
                const cx = w / 2, cy = h / 2;
                const R = Math.min(w, h) / 2 - 4 * dpr;
                ctx.clearRect(0, 0, w, h);

                // кольца и оси
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
                // засечки по окружности
                for (let i = 0; i < 72; i++) {
                    const a = i * Math.PI / 36;
                    const len = i % 6 === 0 ? 7 : 3;
                    ctx.beginPath();
                    ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
                    ctx.lineTo(cx + Math.cos(a) * (R - len * dpr), cy + Math.sin(a) * (R - len * dpr));
                    ctx.strokeStyle = rgba(0.45);
                    ctx.stroke();
                }

                // луч развёртки
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

                // узлы
                NODES.forEach(n => {
                    const a = n.angle * Math.PI / 180;
                    const x = cx + Math.cos(a) * R * n.dist;
                    const y = cy + Math.sin(a) * R * n.dist;
                    let diff = (angle - a) % (Math.PI * 2);
                    if (diff < 0) diff += Math.PI * 2;
                    const glow = Math.max(0, 1 - diff / 2.4);
                    if (n.status === "offline") {
                        ctx.beginPath();
                        ctx.arc(x, y, 4 * dpr, 0, Math.PI * 2);
                        ctx.setLineDash([2 * dpr, 2 * dpr]);
                        ctx.strokeStyle = rgba(0.5);
                        ctx.lineWidth = 1 * dpr;
                        ctx.stroke();
                        ctx.setLineDash([]);
                    } else {
                        ctx.beginPath();
                        ctx.arc(x, y, (2.5 + glow * 2.5) * dpr, 0, Math.PI * 2);
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

                // центр
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
    const Syslog = {
        el: null,
        queue: [],
        add(text, warn) {
            const d = new Date();
            const ts = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
            if (!this.el) { this.queue.push([ts, text, warn]); return; }
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
            const paths = ["/debian/dists/bookworm/InRelease", "/ubuntu/pool/main/l/linux/", "/archlinux/core/os/x86_64/core.db", "/fedora/releases/41/Everything/", "/alpine/v3.20/main/x86_64/APKINDEX.tar.gz", "/gnu/emacs/emacs-30.1.tar.xz", "/kde/stable/plasma/", "/blender/release/", "/libreoffice/stable/"];
            const tpl = [
                () => { const n = NODES[randInt(0, NODES.length - 1)]; return n.status === "offline" ? null : `nginx: ${n.id} 200 GET ${paths[randInt(0, paths.length - 1)]} ${randInt(1, 900)}KB`; },
                () => { const n = NODES[randInt(0, NODES.length - 1)]; return n.status === "offline" ? null : `healthcheck: ${n.id} OK ${Math.round(n.ping)}ms load=${Math.round(n.load)}%`; },
                () => `gpg: good signature for ${["Release", "core.db", "SHA256SUMS", "repomd.xml"][randInt(0, 3)]} (upstream key verified)`,
                () => `geo-dns: routed ${randInt(40, 900)} req/s, nearest-node hit ratio ${rand(96, 99.9).toFixed(1)}%`,
                () => `sha256: ${randInt(20, 400)} artifacts verified, 0 mismatches`,
                () => `scheduler: next upstream pull in ${randInt(1, 30)} min`
            ];
            this.add("syslogd: started, kernel log buffer attached");
            this.add("boot: NODE//COMMONS web shell initialised (adapted from eDEX-UI)");
            const loop = () => {
                const line = tpl[randInt(0, tpl.length - 1)]();
                if (line) this.add(line);
                setTimeout(loop, rand(900, 2600));
            };
            setTimeout(loop, 1200);
        }
    };

    /* ================================================================
     * Вкладки терминала (ul#main_shell_tabs)
     * ================================================================ */
    function initShellTabs() {
        const tabs = $$(".shell-tabs [role='tab']");
        if (!tabs.length) return;
        const activate = (tab, focus) => {
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
        };
        tabs.forEach((tab, i) => {
            tab.addEventListener("click", () => activate(tab, false));
            tab.addEventListener("keydown", e => {
                let idx = null;
                if (e.key === "ArrowRight") idx = (i + 1) % tabs.length;
                else if (e.key === "ArrowLeft") idx = (i - 1 + tabs.length) % tabs.length;
                else if (e.key === "Home") idx = 0;
                else if (e.key === "End") idx = tabs.length - 1;
                if (idx !== null) {
                    e.preventDefault();
                    activate(tabs[idx], true);
                }
            });
        });
        Shell.activateTab = id => { const t = document.getElementById(id); if (t) activate(t, false); };
    }
    const Shell = { activateTab: () => {} };

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
            if (!this.out) return;
            const line = document.createElement("div");
            line.className = "line" + (cls ? " " + cls : "");
            line.textContent = text;
            this.out.appendChild(line);
            this.trim();
            this.out.scrollTop = this.out.scrollHeight;
            return line;
        },
        printHtml(html, cls) {
            if (!this.out) return;
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
            if (reducedMotion) { line.textContent = text; return; }
            for (let i = 0; i < text.length; i++) {
                line.textContent += text[i];
                if (i % 3 === 0) Sound.play("stdout");
                await new Promise(r => setTimeout(r, speed || 14));
            }
        },
        async greet() {
            if (this.greeted) return;
            this.greeted = true;
            await this.type("NODE//COMMONS web shell v1.0.0 — interface adapted from eDEX-UI", "", 10);
            this.printHtml('Welcome back, <span class="hl">guest</span>');
            this.print("Введите «help», чтобы увидеть список команд.");
            this.print("");
        },
        run(raw) {
            const line = raw.trim();
            this.printHtml(`<span class="term-prompt">guest@commons:~$</span> ${escapeHtml(raw)}`, "cmd");
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

            const scrollTo = id => {
                const el = document.getElementById(id);
                if (el) el.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
            };

            this.commands = {
                help() {
                    [
                        "Доступные команды:",
                        "  about      — коротко о проекте",
                        "  status     — сводка по узлам сети",
                        "  nodes      — список узлов",
                        "  docs       — перейти к документации",
                        "  join       — как подключить свой сервер",
                        "  neofetch   — информация о системе браузера",
                        "  date       — текущие дата и время",
                        "  whoami     — кто я",
                        "  uname [-a] — имя системы",
                        "  echo TEXT  — вывести текст",
                        "  history    — история команд",
                        "  sfx on|off — звуки интерфейса eDEX-UI",
                        "  theme      — текущая тема",
                        "  credits    — лицензия и происхождение интерфейса",
                        "  reboot     — повторить анимацию загрузки",
                        "  clear      — очистить экран"
                    ].forEach(l => this.print(l));
                },
                about() {
                    this.print("NODE//COMMONS — некоммерческая волонтёрская сеть зеркал для свободного ПО.");
                    this.print("Без рекламы, без трекинга, с открытым кодом. → раздел «О проекте»");
                    scrollTo("about");
                },
                status() {
                    const s = Telemetry.summary();
                    this.print(`nodes online : ${s.online}/${s.total}`);
                    this.print(`avg ping     : ${Math.round(s.avgPing)} ms`);
                    this.print(`throughput   : ${s.traffic.toFixed(1)} Gb/s`);
                    this.print("подробнее → раздел «Статус серверов»");
                },
                nodes() {
                    this.print("ID       LOCATION          STATUS     PING");
                    NODES.forEach(n => {
                        this.print(`${n.id.padEnd(8)} ${(n.city + ", " + n.cc).padEnd(17)} ${n.status.toUpperCase().padEnd(10)} ${n.status === "offline" ? "—" : Math.round(n.ping) + " ms"}`);
                    });
                },
                docs() {
                    this.print("Открываю /srv/commons/docs …");
                    scrollTo("docs");
                },
                join() {
                    this.print("Открываю инструкцию по подключению узла…");
                    Docs.open("join");
                },
                neofetch() {
                    const os = detectOS();
                    const art = [
                        "   ▄▄▄▄▄▄▄▄▄▄   ",
                        "  █ ▄▄▄  ▄▄▄ █  ",
                        "  █ █ █//█ █ █  ",
                        "  █ ▀▀▀  ▀▀▀ █  ",
                        "   ▀▀▀▀▀▀▀▀▀▀   "
                    ];
                    const info = [
                        "guest@commons",
                        "-------------",
                        `OS: ${os.full}`,
                        `Browser: ${detectBrowser()}`,
                        `Uptime: ${formatUptime(Date.now() - startTime)}`,
                        `Resolution: ${window.screen.width}x${window.screen.height}`,
                        `CPU threads: ${navigator.hardwareConcurrency || "N/A"}`,
                        `Language: ${navigator.language || "—"}`,
                        "Theme: blade (eDEX-UI)",
                        "Font: United Sans / Fira Mono"
                    ];
                    const rows = Math.max(art.length, info.length);
                    for (let i = 0; i < rows; i++) {
                        this.print(`${(art[i] || "").padEnd(18)}${info[i] || ""}`);
                    }
                },
                date() { this.print(new Date().toString()); },
                whoami() { this.print("guest"); },
                uname(args) {
                    this.print(args[0] === "-a"
                        ? `CommonsOS web-shell 1.0.0 ${detectOS().short} ${navigator.hardwareConcurrency || 1}-thread browser-js GNU/GPL-3.0`
                        : "CommonsOS");
                },
                echo(args) { this.print(args.join(" ")); },
                history() { this.history.forEach((h, i) => this.print(`${String(i + 1).padStart(4)}  ${h}`)); },
                sfx(args) {
                    const v = (args[0] || "").toLowerCase();
                    if (v === "on") { Sound.set(true); this.print("sfx: enabled"); }
                    else if (v === "off") { Sound.set(false); this.print("sfx: disabled"); }
                    else this.print(`sfx: ${Sound.enabled ? "on" : "off"} (используйте «sfx on» или «sfx off»)`);
                },
                theme() { this.print("theme: blade — rgb(204, 94, 55) on #090B0A. Других тем в этой сборке нет."); },
                credits() {
                    this.printHtml('UI inspired by &amp; adapted from <a href="https://github.com/GitSquared/edex-ui" target="_blank" rel="noopener noreferrer">eDEX-UI</a> (GPL-3.0) by Gabriel “Squared” Saillard.');
                    this.printHtml('Рамки: augmented-ui 1.1.2 (BSD-2-Clause). Лицензия сайта: <a href="LICENSE">GPL-3.0</a>.');
                },
                sudo() { this.print("guest is not in the sudoers file. This incident will be reported.", "err"); },
                reboot() {
                    this.print("Broadcast message: the system is going down for reboot NOW!");
                    setTimeout(() => {
                        window.scrollTo(0, 0);
                        Boot.run().then(revealUI);
                    }, 400);
                },
                exit() { this.print("logout: в браузере некуда выходить :)"); },
                clear() { this.out.innerHTML = ""; },
                ls() { this.print("README.md  quickstart.md  join-network/  rsyncd.conf  nginx.conf  status-api.json  FAQ.md  LICENSE"); },
                cat(args) {
                    const map = { "readme.md": "readme", "quickstart.md": "quickstart", "rsyncd.conf": "rsync", "nginx.conf": "nginx", "status-api.json": "api", "faq.md": "faq", "license": "license" };
                    const key = map[(args[0] || "").toLowerCase()];
                    if (key) { this.print(`Открываю ${args[0]}…`); Docs.open(key); }
                    else this.print(`cat: ${args[0] || ""}: No such file or directory`, "err");
                }
            };
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
            modal.className = "modal_popup info";
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
            (opts.buttons || []).concat([{ label: "Закрыть", close: true }]).forEach(b => {
                const el = document.createElement(b.href ? "a" : "button");
                el.className = "btn";
                el.textContent = b.label;
                if (b.href) {
                    el.href = b.href;
                    if (b.external) { el.target = "_blank"; el.rel = "noopener noreferrer"; }
                } else {
                    el.type = "button";
                }
                el.addEventListener("click", e => {
                    if (b.action) { e.preventDefault(); b.action(); }
                    if (b.close || b.action || (b.href && b.href.charAt(0) === "#")) this.close();
                });
                actions.appendChild(el);
            });

            document.body.appendChild(backdrop);
            document.body.appendChild(modal);
            requestAnimationFrame(() => backdrop.classList.add("visible"));

            // эффект появления как у eDEX-UI: короткое мигание
            if (!reducedMotion) {
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

            this.current = { modal, backdrop, onKey };
            Sound.play("info");
            setTimeout(() => {
                const btn = modal.querySelector(".modal_close");
                if (btn) btn.focus({ preventScroll: true });
            }, 30);
        },
        close(silent) {
            if (!this.current) return;
            const { modal, backdrop, onKey } = this.current;
            document.removeEventListener("keydown", onKey);
            modal.remove();
            backdrop.remove();
            this.current = null;
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
                const w = modal.offsetWidth, h = modal.offsetHeight;
                const x = clamp(ox + e.clientX - sx, -w + 80, window.innerWidth - 80);
                const y = clamp(oy + e.clientY - sy, 0, window.innerHeight - 60);
                modal.style.left = x + "px";
                modal.style.top = y + "px";
                void h;
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
     * Документация (filesystem.class.js → открытие файлов в модалке)
     * ================================================================ */
    const DOCS = {
        readme: {
            title: "README.md",
            subtitle: "/srv/commons/docs",
            html: `
                <h5>NODE//COMMONS — открытая сеть зеркал</h5>
                <p>Проект объединяет серверы добровольцев в единую сеть зеркал для дистрибутивов Linux, пакетных репозиториев и архивов исходного кода свободных проектов.</p>
                <ul>
                    <li>Единая точка входа: <code>mirror.commons.example</code></li>
                    <li>Гео-DNS направляет запрос на ближайший живой узел</li>
                    <li>Синхронизация с апстримом — каждые 2–6 часов, по rsync</li>
                    <li>Проверка подписей и контрольных сумм после каждой синхронизации</li>
                </ul>
                <p>Проект некоммерческий: участие, использование и копирование бесплатны.</p>`
        },
        quickstart: {
            title: "quickstart.md",
            subtitle: "пользователям",
            html: `
                <h5>Используйте зеркало за 1 минуту</h5>
                <p><b>Debian / Ubuntu</b> — замените адрес в <code>/etc/apt/sources.list</code>:</p>
<pre class="code"><code>deb https://mirror.commons.example/debian bookworm main contrib
deb https://mirror.commons.example/ubuntu noble main universe</code></pre>
                <p><b>Arch Linux</b> — добавьте строку в начало <code>/etc/pacman.d/mirrorlist</code>:</p>
<pre class="code"><code>Server = https://mirror.commons.example/archlinux/$repo/os/$arch</code></pre>
                <p><b>Fedora</b> — используйте параметр <code>baseurl</code>:</p>
<pre class="code"><code>baseurl=https://mirror.commons.example/fedora/releases/$releasever/Everything/$basearch/os/</code></pre>`
        },
        join: {
            title: "Стать узлом",
            subtitle: "join-network/",
            html: `
                <h5>Подключите свой сервер к сети</h5>
                <table class="edex-table">
                    <thead><tr><th>Требование</th><th>Минимум</th></tr></thead>
                    <tbody>
                        <tr><td>Канал</td><td>1 Гбит/с, без жёстких лимитов трафика</td></tr>
                        <tr><td>Диск</td><td>2 ТБ (можно зеркалировать часть проектов)</td></tr>
                        <tr><td>ОС</td><td>Любой Linux/BSD с rsync и nginx</td></tr>
                        <tr><td>Доступность</td><td>от 99% в месяц</td></tr>
                    </tbody>
                </table>
                <ol>
                    <li>Склонируйте репозиторий с конфигурациями и скриптами синхронизации.</li>
                    <li>Настройте <code>rsyncd.conf</code> и <code>nginx.conf</code> по шаблонам из этой папки.</li>
                    <li>Запустите первую синхронизацию и проверку целостности.</li>
                    <li>Откройте issue в репозитории проекта с адресом узла — мы добавим его в гео-DNS после проверки.</li>
                </ol>
<pre class="code"><code>git clone https://github.com/Stool12312356/123.git commons
cd commons && ./scripts/first-sync.sh --profile minimal</code></pre>
                <p>Узел можно вывести из сети в любой момент — балансировщик сам перенаправит трафик.</p>`,
            buttons: [{ label: "Открыть репозиторий", href: "https://github.com/Stool12312356/123", external: true }]
        },
        rsync: {
            title: "rsyncd.conf",
            subtitle: "шаблон",
            html: `
<pre class="code"><code># /etc/rsyncd.conf — шаблон узла NODE//COMMONS
uid = nobody
gid = nogroup
use chroot = yes
max connections = 50
log file = /var/log/rsyncd.log
timeout = 600

[debian]
    path = /srv/mirror/debian
    comment = Debian archive (NODE//COMMONS)
    read only = yes
    list = yes

[archlinux]
    path = /srv/mirror/archlinux
    comment = Arch Linux (NODE//COMMONS)
    read only = yes</code></pre>`
        },
        nginx: {
            title: "nginx.conf",
            subtitle: "шаблон",
            html: `
<pre class="code"><code>server {
    listen 443 ssl http2;
    server_name mirror.commons.example;

    root /srv/mirror;
    autoindex on;
    autoindex_exact_size off;

    # без логирования IP-адресов пользователей
    access_log off;

    location ~* \\.(iso|img|tar\\.(gz|xz|zst))$ {
        add_header Cache-Control "public, max-age=86400";
    }

    location = /healthz {
        return 200 "ok";
    }
}</code></pre>`
        },
        api: {
            title: "status-api.json",
            subtitle: "формат телеметрии",
            html: `
                <p>Формат, который ожидает таблица «Статус серверов». Подставьте реальный эндпоинт в функцию <code>tickTelemetry()</code>.</p>
<pre class="code"><code>{
  "updated": "2026-11-09T12:00:00Z",
  "nodes": [
    {
      "id": "ams-01",
      "city": "Амстердам",
      "cc": "NL",
      "status": "online",
      "ping": 14,
      "load": 46,
      "traffic": 3.4,
      "syncAgo": 12,
      "uptime": 99.99
    }
  ]
}</code></pre>`
        },
        faq: {
            title: "FAQ.md",
            subtitle: "частые вопросы",
            html: `
                <h5>Кто платит за серверы?</h5>
                <p>Узлы предоставляют сами участники: университеты, хакспейсы и частные лица. Общие расходы (домен, мониторинг) покрываются пожертвованиями.</p>
                <h5>Собираете ли вы данные?</h5>
                <p>Нет. Мы не храним IP-адреса пользователей и не используем аналитику. Сайт не загружает сторонних скриптов и шрифтов.</p>
                <h5>Почему интерфейс выглядит как терминал из фантастики?</h5>
                <p>Дизайн перенесён из открытого проекта eDEX-UI (тема «blade») с соблюдением лицензии GPL-3.0.</p>
                <h5>Можно ли зеркалировать только часть проектов?</h5>
                <p>Да. Профиль <code>minimal</code> занимает около 600 ГБ.</p>`
        },
        license: {
            title: "LICENSE",
            subtitle: "GPL-3.0",
            html: `
                <h5>GNU General Public License v3.0</h5>
                <p>Код этого сайта распространяется под лицензией GPL-3.0. Вы можете свободно использовать, изучать, изменять и распространять его при условии сохранения той же лицензии и указания авторства.</p>
                <p>Визуальный стиль, CSS-правила, шрифты и иконки перенесены и адаптированы из <a href="https://github.com/GitSquared/edex-ui" target="_blank" rel="noopener noreferrer">eDEX-UI</a> (© Gabriel “Squared” Saillard, GPL-3.0). Скошенные рамки — библиотека augmented-ui 1.1.2 (BSD-2-Clause).</p>
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
                    return;
                }
                const modalLink = e.target.closest("[data-open-modal]");
                if (modalLink) {
                    e.preventDefault();
                    Docs.open(modalLink.getAttribute("data-open-modal"));
                }
            });
        }
    };

    /* ================================================================
     * Навигация: мобильное меню, активная вкладка по скроллу
     * ================================================================ */
    function initNav() {
        const nav = $("#site-nav");
        const toggle = $("#menu-toggle");
        const links = $$(".nav-tabs a");

        const setMenu = open => {
            if (!nav || !toggle) return;
            nav.classList.toggle("open", open);
            toggle.setAttribute("aria-expanded", String(open));
            toggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
        };
        if (toggle) {
            toggle.addEventListener("click", () => {
                setMenu(!nav.classList.contains("open"));
                Sound.play("panels");
            });
        }
        links.forEach(a => a.addEventListener("click", () => setMenu(false)));
        document.addEventListener("keydown", e => { if (e.key === "Escape") setMenu(false); });
        document.addEventListener("click", e => {
            if (nav && nav.classList.contains("open") && !e.target.closest("#site-nav") && !e.target.closest("#menu-toggle")) setMenu(false);
        });
        window.addEventListener("resize", () => { if (window.innerWidth >= 900) setMenu(false); });

        const setActive = id => {
            links.forEach(a => {
                const on = a.getAttribute("data-nav") === id;
                a.parentElement.classList.toggle("active", on);
                if (on) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
            });
        };

        const sections = ["home", "about", "status", "docs"].map(id => document.getElementById(id)).filter(Boolean);
        if ("IntersectionObserver" in window) {
            const visible = new Map();
            const io = new IntersectionObserver(entries => {
                entries.forEach(en => visible.set(en.target.id, en.isIntersecting ? en.intersectionRatio : 0));
                let best = null, bestRatio = 0;
                sections.forEach(s => {
                    const r = visible.get(s.id) || 0;
                    if (r > bestRatio) { best = s.id; bestRatio = r; }
                });
                if (best) setActive(best);
            }, { rootMargin: "-40% 0px -50% 0px", threshold: [0, 0.01, 0.25, 0.5, 1] });
            sections.forEach(s => io.observe(s));
        }
    }

    /* ================================================================
     * Появление при скролле, счётчики, клавиши, глитч
     * ================================================================ */
    function initScrollReveal() {
        const els = $$(".on-scroll");
        if (!("IntersectionObserver" in window) || reducedMotion) {
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
        }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
        els.forEach(el => io.observe(el));
    }

    function initCounters() {
        const els = $$("[data-count]");
        const animate = el => {
            const target = parseInt(el.getAttribute("data-count"), 10) || 0;
            if (reducedMotion) { el.textContent = String(target); return; }
            const dur = 1200;
            const t0 = performance.now();
            const step = now => {
                const p = clamp((now - t0) / dur, 0, 1);
                const eased = 1 - Math.pow(1 - p, 3);
                el.textContent = String(Math.round(target * eased));
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

    function initKeys() {
        const row = $("#key-row");
        const caption = $("#key-caption");
        if (!row) return;
        const keys = $$(".keycap", row);

        // keyboard.css: animation_state_1 → animation_state_2
        if ("IntersectionObserver" in window && !reducedMotion) {
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

        // «Подсказка»: случайная клавиша иногда мигает
        if (!reducedMotion) {
            setInterval(() => {
                if (keys.some(k => k.classList.contains("active"))) return;
                const k = keys[randInt(0, keys.length - 1)];
                k.classList.add("blink");
                setTimeout(() => k.classList.remove("blink"), 1000);
            }, 4000);
        }
    }

    function initGlitch() {
        const el = $(".hero-accent");
        if (!el || reducedMotion) return;
        const loop = () => {
            el.classList.add("glitch");
            setTimeout(() => el.classList.remove("glitch"), randInt(180, 420));
            setTimeout(loop, randInt(4500, 9000));
        };
        setTimeout(loop, 3500);
    }

    /* ================================================================
     * Старт
     * ================================================================ */
    function init() {
        initSoundToggle();
        initClock();
        initSysinfo();
        Syslog.init();
        initNetwork();
        initCpu();
        initRam();
        initStatusTable();
        initToplist();
        initRadar();
        initShellTabs();
        Terminal.init();
        Docs.init();
        initNav();
        initScrollReveal();
        initCounters();
        initKeys();
        initGlitch();

        setInterval(tickTelemetry, 2000);

        if (shouldBoot()) {
            Boot.run().then(revealUI);
        } else {
            revealUI();
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
