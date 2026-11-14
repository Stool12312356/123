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
        /* Возвращает false, если запись не удалась (приватный режим или переполнение квоты) */
        set(key, value) {
            try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
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
            return this.set(key, JSON.stringify(value));
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

    /* THEMES:BEGIN — сгенерировано из assets/themes/*.json (не редактировать вручную).
       r/g/b, black, light_black, grey — colors; term — terminal; globe — globe;
       iconFilter / iconFilterBg — CSS filter, перекрашивающий иконки assets/icons
       (#cc5e37) в цвет темы / в цвет фона (для иконок на залитых кнопках).
       injectCSS из JSON не переносится: он двигал панели окна Electron, которых на сайте нет. */
    const THEMES = {
        "blade": {"label": "BLADE", "desc": "Оранжевый неон «Blade Runner» — тема по умолчанию", "variant": "", "light": false, "r": 204, "g": 94, "b": 55, "black": "#000000", "light_black": "#090b0a", "grey": "#262827", "term": {"fg": "#cc5e37", "bg": "#090b0a", "cursor": "#cc5e37", "cursorStyle": "underline", "selection": "rgba(204,94,55,0.3)", "font": "Fira Mono"}, "globe": {"base": "#cc5e37", "marker": "#cc5e37", "pin": "#cc5e37", "satellite": "#cc5e37"}, "iconFilter": "brightness(1)", "iconFilterBg": "brightness(0)"},
        "tron": {"label": "TRON", "desc": "Ледяной циан на чёрном", "variant": "", "light": false, "r": 170, "g": 207, "b": 209, "black": "#000000", "light_black": "#05080d", "grey": "#262828", "term": {"fg": "#aacfd1", "bg": "#05080d", "cursor": "#aacfd1", "cursorStyle": "block", "selection": "rgba(170,207,209,0.3)", "font": "Fira Mono"}, "globe": {"base": "#000000", "marker": "#aacfd1", "pin": "#aacfd1", "satellite": "#aacfd1"}, "iconFilter": "brightness(0) saturate(100%) invert(84%) sepia(9%) saturate(617%) hue-rotate(134deg) brightness(96%) contrast(88%)", "iconFilterBg": "brightness(0) saturate(100%) invert(4%) sepia(6%) saturate(3238%) hue-rotate(176deg) brightness(92%) contrast(102%)"},
        "tron-colorfilter": {"label": "TRON · COLORFILTER", "desc": "Ледяной циан на чёрном", "variant": "цветофильтр терминала", "light": false, "r": 170, "g": 207, "b": 209, "black": "#000000", "light_black": "#05080d", "grey": "#262828", "term": {"fg": "#aacfd1", "bg": "#05080d", "cursor": "#aacfd1", "cursorStyle": "block", "selection": "rgba(170,207,209,0.3)", "font": "Fira Mono", "filter": "hue-rotate(180deg) saturate(0.5)"}, "globe": {"base": "#000000", "marker": "#aacfd1", "pin": "#aacfd1", "satellite": "#aacfd1"}, "iconFilter": "brightness(0) saturate(100%) invert(84%) sepia(9%) saturate(617%) hue-rotate(134deg) brightness(96%) contrast(88%)", "iconFilterBg": "brightness(0) saturate(100%) invert(4%) sepia(6%) saturate(3238%) hue-rotate(176deg) brightness(92%) contrast(102%)"},
        "tron-disrupted": {"label": "TRON · DISRUPTED", "desc": "Ледяной циан на чёрном", "variant": "смещённая раскладка", "light": false, "r": 170, "g": 207, "b": 209, "black": "#000000", "light_black": "#05080d", "grey": "#262828", "term": {"fg": "#aacfd1", "bg": "#05080d", "cursor": "#aacfd1", "cursorStyle": "block", "selection": "rgba(170,207,209,0.3)", "font": "Fira Mono"}, "globe": {"base": "#000000", "marker": "#aacfd1", "pin": "#aacfd1", "satellite": "#aacfd1"}, "iconFilter": "brightness(0) saturate(100%) invert(84%) sepia(9%) saturate(617%) hue-rotate(134deg) brightness(96%) contrast(88%)", "iconFilterBg": "brightness(0) saturate(100%) invert(4%) sepia(6%) saturate(3238%) hue-rotate(176deg) brightness(92%) contrast(102%)"},
        "tron-fulltype": {"label": "TRON · FULLTYPE", "desc": "Ледяной циан на чёрном", "variant": "полная клавиатура", "light": false, "r": 170, "g": 207, "b": 209, "black": "#000000", "light_black": "#05080d", "grey": "#262828", "term": {"fg": "#aacfd1", "bg": "#05080d", "cursor": "#aacfd1", "cursorStyle": "block", "selection": "rgba(170,207,209,0.3)", "font": "Fira Mono"}, "globe": {"base": "#000000", "marker": "#aacfd1", "pin": "#aacfd1", "satellite": "#aacfd1"}, "iconFilter": "brightness(0) saturate(100%) invert(84%) sepia(9%) saturate(617%) hue-rotate(134deg) brightness(96%) contrast(88%)", "iconFilterBg": "brightness(0) saturate(100%) invert(4%) sepia(6%) saturate(3238%) hue-rotate(176deg) brightness(92%) contrast(102%)"},
        "tron-notype": {"label": "TRON · NOTYPE", "desc": "Ледяной циан на чёрном", "variant": "без клавиатуры", "light": false, "r": 170, "g": 207, "b": 209, "black": "#000000", "light_black": "#05080d", "grey": "#262828", "term": {"fg": "#aacfd1", "bg": "#05080d", "cursor": "#aacfd1", "cursorStyle": "block", "selection": "rgba(170,207,209,0.3)", "font": "Fira Mono"}, "globe": {"base": "#000000", "marker": "#aacfd1", "pin": "#aacfd1", "satellite": "#aacfd1"}, "iconFilter": "brightness(0) saturate(100%) invert(84%) sepia(9%) saturate(617%) hue-rotate(134deg) brightness(96%) contrast(88%)", "iconFilterBg": "brightness(0) saturate(100%) invert(4%) sepia(6%) saturate(3238%) hue-rotate(176deg) brightness(92%) contrast(102%)"},
        "tron-typeleft": {"label": "TRON · TYPELEFT", "desc": "Ледяной циан на чёрном", "variant": "клавиатура слева", "light": false, "r": 170, "g": 207, "b": 209, "black": "#000000", "light_black": "#05080d", "grey": "#262828", "term": {"fg": "#aacfd1", "bg": "#05080d", "cursor": "#aacfd1", "cursorStyle": "block", "selection": "rgba(170,207,209,0.3)", "font": "Fira Mono"}, "globe": {"base": "#000000", "marker": "#aacfd1", "pin": "#aacfd1", "satellite": "#aacfd1"}, "iconFilter": "brightness(0) saturate(100%) invert(84%) sepia(9%) saturate(617%) hue-rotate(134deg) brightness(96%) contrast(88%)", "iconFilterBg": "brightness(0) saturate(100%) invert(4%) sepia(6%) saturate(3238%) hue-rotate(176deg) brightness(92%) contrast(102%)"},
        "matrix": {"label": "MATRIX", "desc": "Зелёный код на чёрном", "variant": "", "light": false, "r": 0, "g": 143, "b": 17, "black": "#0d0208", "light_black": "#090b0a", "grey": "#262827", "term": {"fg": "#00ff41", "bg": "#0d0208", "cursor": "#00ff41", "cursorStyle": "underline", "selection": "#008f11", "font": "Fira Mono"}, "globe": {"base": "#008f11", "marker": "#008f11", "pin": "#008f11", "satellite": "#008f11"}, "iconFilter": "brightness(0) saturate(100%) invert(34%) sepia(81%) saturate(2785%) hue-rotate(114deg) brightness(86%) contrast(102%)", "iconFilterBg": "brightness(0) saturate(100%) invert(3%) sepia(5%) saturate(1231%) hue-rotate(97deg) brightness(93%) contrast(98%)"},
        "red": {"label": "RED", "desc": "Красная тревога, стальной серый", "variant": "", "light": false, "r": 204, "g": 0, "b": 34, "black": "#000000", "light_black": "#090b0a", "grey": "#0f2e3d", "term": {"fg": "#cc0022", "bg": "#090b0a", "cursor": "#cc0022", "cursorStyle": "underline", "selection": "rgba(204,0,34,0.3)", "font": "Fira Mono"}, "globe": {"base": "#cc0022", "marker": "#cc0022", "pin": "#cc0022", "satellite": "#cc0022"}, "iconFilter": "brightness(0) saturate(100%) invert(33%) sepia(79%) saturate(5526%) hue-rotate(335deg) brightness(73%) contrast(132%)", "iconFilterBg": "brightness(0) saturate(100%) invert(3%) sepia(5%) saturate(1231%) hue-rotate(97deg) brightness(93%) contrast(98%)"},
        "navy": {"label": "NAVY", "desc": "Сигнальный синий на ночном", "variant": "", "light": false, "r": 20, "g": 119, "b": 205, "black": "#282a36", "light_black": "#222430", "grey": "#222430", "term": {"fg": "#87b7cc", "bg": "#222430", "cursor": "#87b7cc", "cursorStyle": "block", "selection": "rgba(239,240,235,0.3)", "font": "Fira Mono"}, "globe": {"base": "#16739c", "marker": "#ad0c0c", "pin": "#04b80a", "satellite": "#e3f213"}, "ansi": {"red": "#ff5c57", "green": "#5af78e", "yellow": "#f3f99d", "blue": "#57c7ff", "magenta": "#ff6ac1", "cyan": "#9aedfe"}, "iconFilter": "brightness(0) saturate(100%) invert(32%) sepia(91%) saturate(1293%) hue-rotate(187deg) brightness(93%) contrast(89%)", "iconFilterBg": "brightness(0) saturate(100%) invert(12%) sepia(21%) saturate(674%) hue-rotate(194deg) brightness(90%) contrast(93%)"},
        "navy-disrupted": {"label": "NAVY · DISRUPTED", "desc": "Сигнальный синий на ночном", "variant": "смещённая раскладка", "light": false, "r": 20, "g": 119, "b": 205, "black": "#282a36", "light_black": "#222430", "grey": "#222430", "term": {"fg": "#87b7cc", "bg": "#222430", "cursor": "#87b7cc", "cursorStyle": "block", "selection": "rgba(239,240,235,0.3)", "font": "Fira Mono"}, "globe": {"base": "#16739c", "marker": "#ad0c0c", "pin": "#04b80a", "satellite": "#e3f213"}, "ansi": {"red": "#ff5c57", "green": "#5af78e", "yellow": "#f3f99d", "blue": "#57c7ff", "magenta": "#ff6ac1", "cyan": "#9aedfe"}, "iconFilter": "brightness(0) saturate(100%) invert(32%) sepia(91%) saturate(1293%) hue-rotate(187deg) brightness(93%) contrast(89%)", "iconFilterBg": "brightness(0) saturate(100%) invert(12%) sepia(21%) saturate(674%) hue-rotate(194deg) brightness(90%) contrast(93%)"},
        "navy-notype": {"label": "NAVY · NOTYPE", "desc": "Сигнальный синий на ночном", "variant": "без клавиатуры", "light": false, "r": 20, "g": 119, "b": 205, "black": "#282a36", "light_black": "#222430", "grey": "#222430", "term": {"fg": "#87b7cc", "bg": "#222430", "cursor": "#87b7cc", "cursorStyle": "block", "selection": "rgba(239,240,235,0.3)", "font": "Fira Mono"}, "globe": {"base": "#16739c", "marker": "#ad0c0c", "pin": "#04b80a", "satellite": "#e3f213"}, "ansi": {"red": "#ff5c57", "green": "#5af78e", "yellow": "#f3f99d", "blue": "#57c7ff", "magenta": "#ff6ac1", "cyan": "#9aedfe"}, "iconFilter": "brightness(0) saturate(100%) invert(32%) sepia(91%) saturate(1293%) hue-rotate(187deg) brightness(93%) contrast(89%)", "iconFilterBg": "brightness(0) saturate(100%) invert(12%) sepia(21%) saturate(674%) hue-rotate(194deg) brightness(90%) contrast(93%)"},
        "cyborg": {"label": "CYBORG", "desc": "Бирюза на глубоком тёмно-зелёном", "variant": "", "light": false, "r": 95, "g": 215, "b": 215, "black": "#011f1f", "light_black": "#0a3333", "grey": "#034747", "term": {"fg": "#a3c2c2", "bg": "#0a3333", "cursor": "#5cffff", "cursorStyle": "block", "selection": "#ffff5c", "font": "Fira Code"}, "globe": {"base": "#5c5cff", "marker": "#eb0954", "pin": "#85ff5c", "satellite": "#ffff5c"}, "ansi": {"red": "#ad3e5a", "green": "#3cd66f", "yellow": "#c5d63c", "blue": "#3c4dd6", "magenta": "#ad31ad", "cyan": "#31adad"}, "iconFilter": "brightness(0) saturate(100%) invert(85%) sepia(34%) saturate(619%) hue-rotate(123deg) brightness(86%) contrast(95%)", "iconFilterBg": "brightness(0) saturate(100%) invert(14%) sepia(39%) saturate(874%) hue-rotate(131deg) brightness(95%) contrast(94%)"},
        "cyborg-focus": {"label": "CYBORG · FOCUS", "desc": "Бирюза на глубоком тёмно-зелёном", "variant": "режим фокуса", "light": false, "r": 95, "g": 215, "b": 215, "black": "#011f1f", "light_black": "#0a3333", "grey": "#034747", "term": {"fg": "#a3c2c2", "bg": "#0a3333", "cursor": "#5cffff", "cursorStyle": "block", "selection": "#ffff5c", "font": "Fira Code"}, "globe": {"base": "#5c5cff", "marker": "#eb0954", "pin": "#85ff5c", "satellite": "#ffff5c"}, "ansi": {"red": "#ad3e5a", "green": "#3cd66f", "yellow": "#c5d63c", "blue": "#3c4dd6", "magenta": "#ad31ad", "cyan": "#31adad"}, "iconFilter": "brightness(0) saturate(100%) invert(85%) sepia(34%) saturate(619%) hue-rotate(123deg) brightness(86%) contrast(95%)", "iconFilterBg": "brightness(0) saturate(100%) invert(14%) sepia(39%) saturate(874%) hue-rotate(131deg) brightness(95%) contrast(94%)"},
        "nord": {"label": "NORD", "desc": "Холодная арктическая палитра Nord", "variant": "", "light": false, "r": 216, "g": 222, "b": 233, "black": "#3b4252", "light_black": "#2e3440", "grey": "#4c566a", "term": {"fg": "#d8dee9", "bg": "#2e3440", "cursor": "#d8dee9", "cursorStyle": "block", "selection": "rgba(67, 76, 94, 0.8)", "font": "Fira Mono"}, "globe": {"base": "#000000", "marker": "#ebcb8b", "pin": "#81a1c1", "satellite": "#bf616a"}, "ansi": {"red": "#bf616a", "green": "#a3be8c", "yellow": "#ebcb8b", "blue": "#81a1c1", "magenta": "#b48ead", "cyan": "#88c0d0"}, "iconFilter": "brightness(0) saturate(100%) invert(90%) sepia(14%) saturate(142%) hue-rotate(180deg) brightness(98%) contrast(90%)", "iconFilterBg": "brightness(0) saturate(100%) invert(16%) sepia(16%) saturate(827%) hue-rotate(181deg) brightness(91%) contrast(85%)"},
        "chalkboard": {"label": "CHALKBOARD", "desc": "Мягкий меловой белый на графите", "variant": "", "light": false, "r": 239, "g": 240, "b": 235, "black": "#282a36", "light_black": "#222430", "grey": "#222430", "term": {"fg": "#eff0eb", "bg": "#282a36", "cursor": "#97979b", "cursorStyle": "block", "selection": "rgba(239,240,235,0.3)", "font": "Fira Mono"}, "globe": {"base": "#000000", "marker": "#f3f99d", "pin": "#eff0eb", "satellite": "#ff5c57"}, "ansi": {"red": "#ff5c57", "green": "#5af78e", "yellow": "#f3f99d", "blue": "#57c7ff", "magenta": "#ff6ac1", "cyan": "#9aedfe"}, "iconFilter": "brightness(0) saturate(100%) invert(94%) sepia(3%) saturate(1300%) hue-rotate(320deg) brightness(110%) contrast(88%)", "iconFilterBg": "brightness(0) saturate(100%) invert(12%) sepia(21%) saturate(674%) hue-rotate(194deg) brightness(90%) contrast(93%)"},
        "chalkboard-ligatures": {"label": "CHALKBOARD · LIGATURES", "desc": "Мягкий меловой белый на графите", "variant": "лигатуры Fira Code", "light": false, "r": 239, "g": 240, "b": 235, "black": "#282a36", "light_black": "#222430", "grey": "#222430", "term": {"fg": "#eff0eb", "bg": "#282a36", "cursor": "#97979b", "cursorStyle": "block", "selection": "rgba(239,240,235,0.3)", "font": "Fira Code"}, "globe": {"base": "#000000", "marker": "#f3f99d", "pin": "#eff0eb", "satellite": "#ff5c57"}, "ansi": {"red": "#ff5c57", "green": "#5af78e", "yellow": "#f3f99d", "blue": "#57c7ff", "magenta": "#ff6ac1", "cyan": "#9aedfe"}, "iconFilter": "brightness(0) saturate(100%) invert(94%) sepia(3%) saturate(1300%) hue-rotate(320deg) brightness(110%) contrast(88%)", "iconFilterBg": "brightness(0) saturate(100%) invert(12%) sepia(21%) saturate(674%) hue-rotate(194deg) brightness(90%) contrast(93%)"},
        "chalkboard-notype": {"label": "CHALKBOARD · NOTYPE", "desc": "Мягкий меловой белый на графите", "variant": "без клавиатуры", "light": false, "r": 239, "g": 240, "b": 235, "black": "#282a36", "light_black": "#222430", "grey": "#222430", "term": {"fg": "#eff0eb", "bg": "#282a36", "cursor": "#97979b", "cursorStyle": "block", "selection": "rgba(239,240,235,0.3)", "font": "Fira Mono"}, "globe": {"base": "#000000", "marker": "#f3f99d", "pin": "#eff0eb", "satellite": "#ff5c57"}, "ansi": {"red": "#ff5c57", "green": "#5af78e", "yellow": "#f3f99d", "blue": "#57c7ff", "magenta": "#ff6ac1", "cyan": "#9aedfe"}, "iconFilter": "brightness(0) saturate(100%) invert(94%) sepia(3%) saturate(1300%) hue-rotate(320deg) brightness(110%) contrast(88%)", "iconFilterBg": "brightness(0) saturate(100%) invert(12%) sepia(21%) saturate(674%) hue-rotate(194deg) brightness(90%) contrast(93%)"},
        "apollo": {"label": "APOLLO", "desc": "Белый монохром, как приборы «Аполлона»", "variant": "", "light": false, "r": 235, "g": 235, "b": 235, "black": "#000000", "light_black": "#191919", "grey": "#262827", "term": {"fg": "#ebebeb", "bg": "#191919", "cursor": "#ebebeb", "cursorStyle": "block", "selection": "rgba(235,235,235,0.3)", "font": "Fira Mono"}, "globe": {"base": "#000000", "marker": "#ebebeb", "pin": "#ebebeb", "satellite": "#ebebeb"}, "iconFilter": "brightness(0) saturate(100%) invert(100%) sepia(2%) saturate(265%) hue-rotate(72deg) brightness(116%) contrast(84%)", "iconFilterBg": "brightness(0) saturate(100%) invert(8%) sepia(3%) saturate(0%) hue-rotate(332deg) brightness(95%) contrast(95%)"},
        "apollo-notype": {"label": "APOLLO · NOTYPE", "desc": "Белый монохром, как приборы «Аполлона»", "variant": "без клавиатуры", "light": false, "r": 235, "g": 235, "b": 235, "black": "#000000", "light_black": "#191919", "grey": "#262827", "term": {"fg": "#ebebeb", "bg": "#191919", "cursor": "#ebebeb", "cursorStyle": "block", "selection": "rgba(235,235,235,0.3)", "font": "Fira Mono"}, "globe": {"base": "#000000", "marker": "#ebebeb", "pin": "#ebebeb", "satellite": "#ebebeb"}, "iconFilter": "brightness(0) saturate(100%) invert(100%) sepia(2%) saturate(265%) hue-rotate(72deg) brightness(116%) contrast(84%)", "iconFilterBg": "brightness(0) saturate(100%) invert(8%) sepia(3%) saturate(0%) hue-rotate(332deg) brightness(95%) contrast(95%)"},
        "interstellar": {"label": "INTERSTELLAR", "desc": "Светлая тема: голубой на сером", "variant": "", "light": true, "r": 3, "g": 169, "b": 244, "black": "#f3f3f3", "light_black": "#dedede", "grey": "#bfbfbf", "term": {"fg": "#03a9f4", "bg": "#dedede", "cursor": "#03a9f4", "cursorStyle": "bar", "selection": "rgba(3,169,244,0.3)", "font": "Fira Mono"}, "globe": {"base": "#03a9f4", "marker": "#03a9f4", "pin": "#03a9f4", "satellite": "#03a9f4"}, "iconFilter": "brightness(0) saturate(100%) invert(46%) sepia(48%) saturate(2193%) hue-rotate(168deg) brightness(101%) contrast(98%)", "iconFilterBg": "brightness(0) saturate(100%) invert(83%) sepia(0%) saturate(0%) hue-rotate(316deg) brightness(106%) contrast(97%)"}
    };
    /* THEMES:END */

    /* Текущий цвет темы для canvas-графики (радар, графики, аватар).
       Объект изменяется на месте при смене темы — rgba() всегда берёт актуальный цвет. */
    const THEME = { id: "blade", r: 204, g: 94, b: 55 };
    const rgba = a => `rgba(${THEME.r}, ${THEME.g}, ${THEME.b}, ${a === undefined ? 1 : a})`;

    /* ================================================================
     * Цветовые схемы eDEX-UI (assets/themes/*.json → THEMES)
     * Тема применяется инлайн-переменными на <html>; тот же набор переменных
     * кэшируется в nx_settings.themeVars, чтобы скрипт в <head> применил его
     * до первой отрисовки (без мигания оранжевой blade на других темах).
     * ================================================================ */
    const Theme = {
        DEFAULT: "blade",
        list() { return Object.keys(THEMES); },
        get(id) { return THEMES[id] || null; },
        resolve(name) {
            if (!name) return null;
            const q = String(name).trim().toLowerCase().replace(/[\s_·]+/g, "-").replace(/-+/g, "-");
            if (THEMES[q]) return q;
            const hits = this.list().filter(id => id.startsWith(q));
            return hits.length === 1 ? hits[0] : null;
        },
        suggest(name) {
            const q = String(name || "").toLowerCase();
            return this.list().filter(id => id.includes(q) || q.includes(id.split("-")[0])).slice(0, 4);
        },
        current() {
            const id = Settings.get("theme");
            return THEMES[id] ? id : this.DEFAULT;
        },
        hexToTriplet(hex) {
            let h = String(hex || "").replace("#", "").trim();
            if (h.length === 3) h = h.split("").map(c => c + c).join("");
            const n = parseInt(h, 16);
            if (isNaN(n) || h.length !== 6) return "0, 0, 0";
            return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
        },
        /* Непрозрачное выделение (cyborg: #ffff5c, matrix: #008f11) делаем полупрозрачным,
           иначе выделенный текст сливается с фоном выделения */
        selection(t) {
            const sel = t.term.selection || "";
            if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(sel)) return `rgba(${this.hexToTriplet(sel)}, 0.4)`;
            return sel;
        },
        /* Набор CSS-переменных темы — те же имена, что в :root (css/blade-theme.css) */
        vars(id) {
            const t = THEMES[id] || THEMES[this.DEFAULT];
            const ansi = t.ansi || {};
            return {
                "--color_r": String(t.r),
                "--color_g": String(t.g),
                "--color_b": String(t.b),
                "--color_black": t.black,
                "--color_light_black": t.light_black,
                "--color_grey": t.grey,
                "--bg_rgb": this.hexToTriplet(t.light_black),
                "--black_rgb": this.hexToTriplet(t.black),
                "--selection": this.selection(t),
                "--color_err": ansi.red || (id === "blade" ? "#ff6b4a" : `rgb(${t.r}, ${t.g}, ${t.b})`),
                "--color_red": ansi.red || "red",
                "--color_yellow": ansi.yellow || "yellow",
                "--term_fg": t.term.fg,
                "--term_bg": t.term.bg,
                "--term_cursor": t.term.cursor,
                "--term_font": `"${t.term.font}", "Fira Mono", monospace`,
                "--term_filter": t.term.filter || "none",
                "--icon_filter": t.iconFilter,
                "--icon_filter_bg": t.iconFilterBg
            };
        },
        /* Применить тему к документу (без сохранения) */
        paint(id) {
            if (!THEMES[id]) id = this.DEFAULT;
            const t = THEMES[id];
            const d = document.documentElement;
            const vars = this.vars(id);
            Object.keys(vars).forEach(k => d.style.setProperty(k, vars[k]));
            d.style.colorScheme = t.light ? "light" : "dark";
            d.classList.toggle("theme-light", !!t.light);
            d.setAttribute("data-theme", id);
            d.setAttribute("data-term-cursor", t.term.cursorStyle || "block");
            const meta = document.querySelector('meta[name="theme-color"]');
            if (meta) meta.setAttribute("content", t.light_black);
            THEME.id = id; THEME.r = t.r; THEME.g = t.g; THEME.b = t.b;
            return vars;
        },
        /* Сменить тему: применить, сохранить в nx_settings, оповестить страницы */
        set(id, opts) {
            opts = opts || {};
            const key = this.resolve(id);
            if (!key) return false;
            const prev = THEME.id;
            // Короткий плавный переход цветов (класс снимается сразу после смены)
            const d = document.documentElement;
            if (opts.animate !== false && !reducedMotion()) {
                d.classList.add("theme-switching");
                clearTimeout(this._swT);
                this._swT = setTimeout(() => d.classList.remove("theme-switching"), 450);
            }
            const vars = this.paint(key);
            if (!Settings.data) Settings.load();
            Settings.data.theme = key;
            Settings.data.themeVars = Object.assign({ "color-scheme": THEMES[key].light ? "light" : "dark" }, vars);
            Settings.data.v = Settings.VERSION;
            storage.setJSON(Settings.KEY, Settings.data);
            if (opts.sound !== false) Sound.play("theme");
            if (prev !== key) document.dispatchEvent(new CustomEvent("nexus:theme", { detail: { id: key } }));
            return true;
        }
    };

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
        defaults: { sfx: true, intro: true, grid: true, glow: true, motion: true, scale: "normal", theme: "blade" },
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
            Theme.set(this.defaults.theme, { sound: false });
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
            // Цветовая схема (Theme объявлен ниже, вызывается уже после инициализации модуля)
            if (typeof Theme !== "undefined") {
                const prev = THEME.id;
                const id = Theme.current();
                const vars = Theme.paint(id);
                // Обновляем кэш переменных для инлайн-скрипта в <head> (если словарь тем изменился)
                const cached = Object.assign({ "color-scheme": THEMES[id].light ? "light" : "dark" }, vars);
                if (JSON.stringify(this.data.themeVars || null) !== JSON.stringify(cached)) {
                    this.data.themeVars = cached;
                    storage.setJSON(this.KEY, this.data);
                }
                if (prev !== id) document.dispatchEvent(new CustomEvent("nexus:theme", { detail: { id } }));
            }
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
    /* Роли: USER — просмотр и скачивание, ADMIN — управление проектами, CREATOR — владелец, все права */
    const ROLES = {
        user: {
            id: "user", label: "USER", name: "Пользователь", rank: 1,
            desc: "Просматривает каталог и досье, скачивает доступные релизы и сборки закрытых тестов."
        },
        admin: {
            id: "admin", label: "ADMIN", name: "Администратор", rank: 2,
            desc: "Скачивает все сборки, включая dev. Создаёт и редактирует любые проекты, удаляет созданные через сайт."
        },
        creator: {
            id: "creator", label: "CREATOR", name: "Создатель", rank: 3,
            desc: "Владелец экосистемы — полный доступ: любые проекты, включая официальные, разделы каталога и сброс каталога."
        }
    };
    const ROLE_IDS = ["user", "admin", "creator"];

    /* Матрица прав (для кабинета и команды role). min — минимальная роль. */
    const PERMISSIONS = [
        { id: "view", label: "Каталог и досье проектов", min: "user" },
        { id: "download", label: "Скачивание публичных релизов и закрытых тестов", min: "user" },
        { id: "download-dev", label: "Скачивание dev-сборок", min: "admin" },
        { id: "create", label: "Создание проектов", min: "admin" },
        { id: "edit", label: "Редактирование любых проектов", min: "admin" },
        { id: "delete", label: "Удаление проектов, созданных через сайт", min: "admin" },
        { id: "delete-any", label: "Удаление официальных проектов каталога", min: "creator" },
        { id: "sections", label: "Управление разделами и сброс каталога", min: "creator" }
    ];

    /* Доступ к скачиванию: public — без входа, user/admin/creator — минимальная роль */
    const ACCESS = {
        public: { label: "Без входа", short: "PUBLIC" },
        user: { label: "Вход · USER и выше", short: "USER+" },
        admin: { label: "ADMIN и выше", short: "ADMIN+" },
        creator: { label: "Только CREATOR", short: "CREATOR" }
    };

    /* Необязательный код роли при входе / регистрации (демо). Старые коды тоже принимаются. */
    const ACCESS_CODES = {
        "NEXUS-ADMIN": "admin",
        "NEXUS-CREATOR": "creator",
        "NEXUS-DEV": "admin",
        "PLAYTEST": "user"
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
            return this.normalize(s);
        },
        isLoggedIn() {
            return !!this.get();
        },
        /* Текущая роль: "user" | "admin" | "creator" или null для гостя */
        role() {
            const s = this.get();
            return s ? s.role : null;
        },
        rank() {
            const r = this.role();
            return r ? ROLES[r].rank : 0;
        },
        roleInfo(role) {
            return ROLES[role] || ROLES.user;
        },
        /* Проверка права. p — проект (для удаления: официальные удаляет только CREATOR) */
        can(perm, p) {
            const rank = this.rank();
            if (perm === "delete") {
                if (p && !p.custom) return rank >= ROLES.creator.rank;
                return rank >= ROLES.admin.rank;
            }
            const def = PERMISSIONS.find(x => x.id === perm);
            if (!def) return false;
            return rank >= ROLES[def.min].rank;
        },
        canDownload(p) {
            const need = p && p.access ? p.access : "public";
            if (need === "public") return true;
            return this.rank() >= (ROLES[need] ? ROLES[need].rank : 1);
        },
        /* Сменить роль текущей сессии (тестовый режим) */
        setRole(role) {
            if (!ROLES[role]) return null;
            const s = this.update({ role });
            if (s) document.dispatchEvent(new CustomEvent("nexus:role", { detail: { role } }));
            return s;
        },
        makeId(callsign) {
            const h = hashString(callsign.toLowerCase()).toString(16).toUpperCase().padStart(8, "0");
            return `NX-${h.slice(0, 4)}-${h.slice(4, 8)}`;
        },
        /* Сессии старого формата (уровни 1–4) переводятся в роли */
        normalize(s) {
            if (!ROLES[s.role]) s.role = s.level >= 4 ? "admin" : "user";
            delete s.level;
            return s;
        },
        login(opts) {
            const callsign = String(opts.callsign || "guest").trim().slice(0, 24);
            const prev = this.get();
            const now = Date.now();
            const role = ROLES[opts.role] ? opts.role : "user";
            const same = prev && prev.callsign === callsign;
            const session = {
                callsign,
                email: opts.email || `${callsign.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@nexus.dev.example`,
                id: this.makeId(callsign),
                role,
                demo: !!opts.demo,
                registered: (same && prev.registered) || opts.registered || now,
                lastLogin: now,
                expires: opts.remember === false ? now + 2 * 3600 * 1000 : null,
                avatarSeed: (same && prev.avatarSeed) || 0,
                downloads: (same && prev.downloads) || this.seedDownloads()
            };
            storage.setJSON(this.KEY, session);
            Account.onLogin(session);
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
        if (userEl) userEl.textContent = s ? `${s.callsign.toUpperCase()} · ${ROLES[s.role].label}` : "GUEST";
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
        applyPermissions();
        updateWalletUI();
        document.dispatchEvent(new CustomEvent("nexus:auth"));
    }

    /* Элементы с data-require="create|edit|delete|sections…" показываются только при наличии права.
       data-require-id — id проекта (для удаления официальных проектов нужна роль CREATOR). */
    function applyPermissions(root) {
        const role = Auth.role();
        document.documentElement.setAttribute("data-role", role || "guest");
        $$("[data-require]", root || document).forEach(el => {
            const pid = el.getAttribute("data-require-id");
            const p = pid ? PROJECTS.find(x => x.id === pid) : null;
            el.hidden = !Auth.can(el.getAttribute("data-require"), p);
        });
        renderRoleSwitches();
    }

    /* Переключатели тестовой роли: [data-role-switch] (кабинет, подвал) */
    function renderRoleSwitches() {
        const role = Auth.role();
        $$("[data-role-switch]").forEach(box => {
            if (!box.childElementCount) {
                const compact = box.hasAttribute("data-compact");
                box.classList.add("role-switch");
                if (compact) box.classList.add("role-switch-sm");
                box.setAttribute("role", "group");
                box.setAttribute("aria-label", "Тестовая роль");
                box.innerHTML = (compact ? '<span class="role-switch-label">ROLE</span>' : "") + ROLE_IDS.map(id =>
                    `<button type="button" class="role-btn" data-set-role="${id}" title="${escapeHtml(ROLES[id].name)}">${ROLES[id].label}</button>`).join("");
            }
            $$("[data-set-role]", box).forEach(b => {
                const on = b.getAttribute("data-set-role") === role;
                b.classList.toggle("active", on);
                b.setAttribute("aria-pressed", String(on));
            });
        });
    }

    /* Смена тестовой роли с уведомлением и звуком. Гостю создаётся демо-сессия с этой ролью. */
    function switchRole(role, opts) {
        opts = opts || {};
        role = String(role || "").toLowerCase();
        if (!ROLES[role]) return { ok: false, error: "unknown" };
        const s = Auth.get();
        if (s && s.role === role) {
            if (!opts.quiet) toast(`Роль ${ROLES[role].label} уже активна`);
            return { ok: true, same: true, role };
        }
        let created = false;
        if (!s) {
            Auth.login({ callsign: "demo_operator", role, demo: true, remember: true });
            created = true;
        }
        Auth.setRole(role);
        Sound.play(role === "user" ? "panels" : "granted");
        Syslog.add(`auth: роль сессии → ${ROLES[role].label}`);
        if (!opts.quiet) toast(`Роль: ${ROLES[role].label} // ${ROLES[role].name}${created ? " · создана демо-сессия" : ""}`, "ok");
        return { ok: true, role, created };
    }

    /* ================================================================
     * Аккаунт NEXUS ID: кошелёк, подписка, поддержка проектов,
     * уведомления, безопасность и публичный профиль.
     * Данные лежат в localStorage (ключ nx_accounts) отдельно для каждого
     * ID пользователя, поэтому переживают выход и повторный вход.
     * Платёжный шлюз работает в ТЕСТОВОМ режиме: деньги не списываются,
     * номер карты и CVC не сохраняются (только платёжная система и 4 цифры).
     * ================================================================ */
    const MONEY_FMT = (() => {
        try {
            return {
                whole: new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 0 }),
                frac: new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 2, maximumFractionDigits: 2 })
            };
        } catch (e) {
            return null;
        }
    })();

    /* Суммы хранятся в копейках (целые числа) — без ошибок округления */
    function formatMoney(kop, opts) {
        opts = opts || {};
        const k = Math.round(Number(kop) || 0);
        const abs = Math.abs(k) / 100;
        let s;
        if (MONEY_FMT) s = (k % 100 === 0 ? MONEY_FMT.whole : MONEY_FMT.frac).format(abs);
        else s = (k % 100 === 0 ? String(abs) : abs.toFixed(2)) + " ₽";
        s = s.replace(/\u202f/g, "\u00a0");
        if (k < 0) return "−" + s;
        if (opts.sign && k > 0) return "+" + s;
        return s;
    }

    const PLANS = {
        free: {
            id: "free", label: "FREE", name: "Базовый", price: 0, cashback: 0,
            desc: "Всё необходимое, чтобы играть и тестировать.",
            perks: ["Каталог и публичные релизы", "Закрытые тесты после входа", "История загрузок и уведомления о релизах"]
        },
        plus: {
            id: "plus", label: "NEXUS+", name: "Поддержка", price: 14900, cashback: 5,
            desc: "Помогает оплачивать серверы и билд-ферму.",
            perks: ["Значок NEXUS+ в профиле и шапке сайта", "Приоритет в очереди на закрытые тесты", "Голосование за roadmap проектов", "Кешбэк 5% на поддержку проектов"]
        },
        patron: {
            id: "patron", label: "PATRON", name: "Меценат", price: 39900, cashback: 10,
            desc: "Для тех, кто хочет вложиться в развитие экосистемы.",
            perks: ["Всё из NEXUS+", "Имя в титрах и на странице проекта", "Закрытый канал с разработчиками", "Кешбэк 10% на поддержку проектов"]
        }
    };

    /* Промокоды (тестовые): бонус на баланс, каждый — один раз на аккаунт */
    const PROMO_CODES = {
        "WELCOME": { amount: 5000, label: "Приветственный бонус" },
        "NEXUS100": { amount: 10000, label: "Бонус NEXUS100" },
        "BETA2026": { amount: 25000, label: "Бонус участника беты" }
    };

    /* Тестовые карты (как в тестовом режиме платёжных шлюзов) */
    const TEST_CARDS = [
        { number: "4242 4242 4242 4242", result: "ok", label: "Успешная оплата" },
        { number: "4000 0000 0000 3220", result: "3ds", label: "Подтверждение 3-D Secure, код 1234" },
        { number: "4000 0000 0000 0002", result: "declined", label: "Отказ банка" },
        { number: "4000 0000 0000 9995", result: "funds", label: "Недостаточно средств на карте" }
    ];

    const WALLET_LIMITS = { min: 5000, max: 5000000, daily: 10000000 };

    /* Бонус к пополнению: от 1 000 ₽ — +5%, от 5 000 ₽ — +10% */
    function topupBonus(kop) {
        if (kop >= 500000) return Math.round(kop * 0.10);
        if (kop >= 100000) return Math.round(kop * 0.05);
        return 0;
    }

    /* Цели сбора средств на проекты (база — «пожертвования сообщества») */
    const FUNDING = {
        launcher: { goal: 6000000, base: 4170000, purpose: "сервер обновлений и CDN" },
        fortify: { goal: 2500000, base: 1985000, purpose: "новые модели укреплений" },
        modpack: { goal: 4000000, base: 1220000, purpose: "аренда игрового сервера на год" },
        bastion: { goal: 15000000, base: 9630000, purpose: "плейтесты и озвучка" },
        trenchworks: { goal: 9000000, base: 2340000, purpose: "лицензии ассетов и мокап" },
        nexustech: { goal: 3000000, base: 640000, purpose: "документация и примеры" }
    };

    function cardBrand(num) {
        const n = String(num || "").replace(/\D/g, "");
        if (/^220[0-4]/.test(n)) return "MIR";
        if (/^4/.test(n)) return "VISA";
        if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return "MASTERCARD";
        if (/^3[47]/.test(n)) return "AMEX";
        if (/^(62|81)/.test(n)) return "UNIONPAY";
        return "CARD";
    }

    function luhnOk(num) {
        const n = String(num || "").replace(/\D/g, "");
        if (n.length < 13 || n.length > 19) return false;
        let sum = 0, dbl = false;
        for (let i = n.length - 1; i >= 0; i--) {
            let d = +n[i];
            if (dbl) { d *= 2; if (d > 9) d -= 9; }
            sum += d;
            dbl = !dbl;
        }
        return sum % 10 === 0;
    }

    function uid(prefix) {
        const t = Date.now().toString(36).toUpperCase().slice(-5);
        const r = Math.random().toString(36).toUpperCase().slice(2, 6).padEnd(4, "0");
        return `${prefix}-${t}${r}`;
    }

    function deviceName() {
        return `${detectOS().full} · ${detectBrowser()}`;
    }

    function maskedIp(seed) {
        const h = hashString(String(seed || "nx"));
        return `${80 + (h % 100)}.${(h >>> 8) % 255}.•••.${(h >>> 16) % 250 + 2}`;
    }

    const Account = {
        KEY: "nx_accounts",
        NOTIF_TYPES: {
            payment: { label: "Платежи", icon: "portfolio" },
            release: { label: "Релизы", icon: "download" },
            security: { label: "Безопасность", icon: "lock" },
            system: { label: "Система", icon: "info" }
        },

        readAll() {
            const map = storage.getJSON(this.KEY, {});
            return map && typeof map === "object" && !Array.isArray(map) ? map : {};
        },

        /* Новый аккаунт: приветствие, свежие релизы, текущее и пара прошлых устройств */
        seed(s) {
            const now = Date.now(), day = 86400000;
            const dev = deviceName();
            const releases = PROJECTS.filter(p => p.status !== "dev").slice(0, 2);
            const notes = [
                { id: uid("N"), type: "system", title: "Добро пожаловать в NEXUS ID", text: "Аккаунт активирован. Пополните баланс, чтобы оформить NEXUS+ или поддержать любимый проект.", date: now, read: false, link: "wallet" }
            ];
            releases.forEach((p, i) => notes.push({
                id: uid("N"), type: "release", title: `Вышла сборка ${p.title} ${p.version}`,
                text: p.summary, date: now - (i + 1) * 2 * day, read: i > 0, link: "projects.html#" + p.id
            }));
            return {
                v: 1,
                created: now,
                balance: 0,
                tx: [],
                cards: [],
                promos: [],
                plan: { id: "free", since: now, until: null, autoRenew: true },
                donations: {},
                notifications: notes,
                prefs: { release: true, payment: true, security: true, system: true, toast: true },
                security: {
                    twoFA: false,
                    backup: [],
                    pwdChanged: null,
                    sessions: [
                        { id: "current", device: dev, place: "Это устройство", ip: maskedIp(s.id + dev), last: now, current: true },
                        { id: uid("S"), device: "Windows · NEXUS Launcher 1.4.1", place: "Нидерланды", ip: maskedIp(s.id + "launcher"), last: now - 3 * day },
                        { id: uid("S"), device: "Android · Chromium", place: "Нидерланды", ip: maskedIp(s.id + "phone"), last: now - 8 * day }
                    ],
                    log: [
                        { date: now, event: "Вход в аккаунт", device: dev, ok: true },
                        { date: now - 3 * day, event: "Вход через NEXUS Launcher", device: "Windows · NEXUS Launcher", ok: true },
                        { date: now - 8 * day + 3600000, event: "Неверный пароль", device: "Android · Chromium", ok: false }
                    ]
                },
                profile: {
                    displayName: s.callsign,
                    bio: "",
                    country: "NL",
                    timezone: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Amsterdam"; } catch (e) { return "Europe/Amsterdam"; } })(),
                    discord: "",
                    github: "",
                    public: true
                }
            };
        },

        /* Защита от битых / старых данных */
        normalize(a, s) {
            const base = this.seed(s);
            if (!a || typeof a !== "object") return base;
            ["tx", "cards", "promos", "notifications"].forEach(k => { if (!Array.isArray(a[k])) a[k] = base[k]; });
            a.balance = Math.max(0, Math.round(Number(a.balance) || 0));
            a.plan = Object.assign({}, base.plan, a.plan);
            if (!PLANS[a.plan.id]) a.plan.id = "free";
            a.donations = a.donations && typeof a.donations === "object" ? a.donations : {};
            a.prefs = Object.assign({}, base.prefs, a.prefs);
            a.security = Object.assign({}, base.security, a.security);
            ["sessions", "log", "backup"].forEach(k => { if (!Array.isArray(a.security[k])) a.security[k] = base.security[k]; });
            a.profile = Object.assign({}, base.profile, a.profile);
            if (!a.created) a.created = base.created;
            return a;
        },

        get() {
            const s = Auth.get();
            if (!s) return null;
            const map = this.readAll();
            const a = this.normalize(map[s.id], s);
            // Новый аккаунт сохраняем сразу, чтобы ID уведомлений и сеансов были стабильными
            if (!map[s.id]) { map[s.id] = a; storage.setJSON(this.KEY, map); }
            return a;
        },

        /* Изменение данных аккаунта: fn(account, session). Сохраняет и рассылает nexus:account */
        mutate(fn, detail) {
            const s = Auth.get();
            if (!s) return null;
            const map = this.readAll();
            const a = this.normalize(map[s.id], s);
            const res = fn(a, s);
            a.tx = a.tx.slice(0, 200);
            a.notifications = a.notifications.slice(0, 60);
            a.security.log = a.security.log.slice(0, 40);
            map[s.id] = a;
            if (!storage.setJSON(this.KEY, map)) {
                toast("Не удалось сохранить данные: хранилище браузера недоступно или переполнено", "warn");
                return null;
            }
            this.emit(detail || {});
            return res === undefined ? a : res;
        },

        emit(detail) {
            updateWalletUI();
            document.dispatchEvent(new CustomEvent("nexus:account", { detail: detail || {} }));
        },

        /* Вызывается из Auth.login: журнал входов и «текущее устройство» */
        onLogin(s) {
            const map = this.readAll();
            const fresh = !map[s.id];
            this.mutate(a => {
                const dev = deviceName();
                const cur = a.security.sessions.find(x => x.current);
                if (cur) { cur.last = Date.now(); cur.device = dev; }
                if (!fresh) a.security.log.unshift({ date: Date.now(), event: "Вход в аккаунт", device: dev, ok: true });
            }, { action: "login" });
        },

        /* ----- Уведомления ----- */
        notify(type, title, text, opts) {
            opts = opts || {};
            return this.mutate(a => {
                if (a.prefs[type] === false && type !== "security") return null;
                const n = { id: uid("N"), type, title, text: text || "", date: Date.now(), read: false, link: opts.link || "" };
                a.notifications.unshift(n);
                if (opts.toast !== false && a.prefs.toast) setTimeout(() => toast(`${title}${text ? " — " + text : ""}`, opts.tone || "info", { ttl: 4200 }), 60);
                return n;
            }, { action: "notify" });
        },
        unread() {
            const a = this.get();
            return a ? a.notifications.filter(n => !n.read).length : 0;
        },
        markRead(id) {
            return this.mutate(a => { a.notifications.forEach(n => { if (!id || n.id === id) n.read = true; }); }, { action: "notif-read" });
        },
        removeNotification(id) {
            return this.mutate(a => { a.notifications = id ? a.notifications.filter(n => n.id !== id) : []; }, { action: "notif-remove" });
        },
        setPref(key, value) {
            return this.mutate(a => { a.prefs[key] = !!value; }, { action: "prefs" });
        },

        /* ----- Кошелёк ----- */
        todayTopups(a) {
            const from = Date.now() - 86400000;
            return a.tx.filter(t => t.type === "topup" && t.status === "ok" && t.date >= from).reduce((s, t) => s + t.amount, 0);
        },
        checkTopup(kop) {
            const a = this.get();
            if (!a) return { ok: false, error: "auth", text: "Войдите в аккаунт" };
            if (!Number.isFinite(kop) || kop < WALLET_LIMITS.min) return { ok: false, error: "min", text: `Минимальная сумма — ${formatMoney(WALLET_LIMITS.min)}` };
            if (kop > WALLET_LIMITS.max) return { ok: false, error: "max", text: `Максимум за одну операцию — ${formatMoney(WALLET_LIMITS.max)}` };
            if (this.todayTopups(a) + kop > WALLET_LIMITS.daily) return { ok: false, error: "daily", text: `Суточный лимит пополнений — ${formatMoney(WALLET_LIMITS.daily)}` };
            return { ok: true };
        },
        /* Успешное пополнение (+ бонус, если положен) */
        topup(kop, method, opts) {
            opts = opts || {};
            const chk = this.checkTopup(kop);
            if (!chk.ok) return chk;
            const res = this.mutate(a => {
                const bonus = opts.noBonus ? 0 : topupBonus(kop);
                const tx = { id: uid("TX"), type: "topup", title: "Пополнение баланса", method, amount: kop, status: "ok", date: Date.now() };
                a.tx.unshift(tx);
                a.balance += kop;
                if (bonus) {
                    a.tx.unshift({ id: uid("TX"), type: "bonus", title: `Бонус ${kop >= 500000 ? "10" : "5"}% к пополнению`, method: "NEXUS ID", amount: bonus, status: "ok", date: Date.now() + 1 });
                    a.balance += bonus;
                }
                if (opts.card && opts.saveCard) {
                    const c = opts.card;
                    if (!a.cards.some(x => x.last4 === c.last4 && x.brand === c.brand && x.exp === c.exp)) {
                        a.cards.unshift({ id: uid("C"), brand: c.brand, last4: c.last4, exp: c.exp, holder: c.holder || "", added: Date.now() });
                        a.cards = a.cards.slice(0, 5);
                    }
                }
                if (a.prefs.payment) a.notifications.unshift({ id: uid("N"), type: "payment", title: `Баланс пополнен на ${formatMoney(kop + bonus)}`, text: `${method}${bonus ? ` · бонус ${formatMoney(bonus)}` : ""}`, date: Date.now(), read: false, link: "wallet" });
                return { ok: true, tx, bonus, balance: a.balance };
            }, { action: "topup" });
            if (res && res.ok) Syslog.add(`wallet: +${formatMoney(kop)} (${method})`);
            return res || { ok: false, error: "storage", text: "Не удалось сохранить операцию" };
        },
        /* Неуспешный платёж тоже попадает в историю */
        failTopup(kop, method, reason) {
            return this.mutate(a => {
                a.tx.unshift({ id: uid("TX"), type: "topup", title: "Пополнение баланса", method, amount: kop, status: "failed", reason, date: Date.now() });
                if (a.prefs.payment) a.notifications.unshift({ id: uid("N"), type: "payment", title: "Платёж отклонён", text: `${formatMoney(kop)} · ${method} · ${reason}`, date: Date.now(), read: false, link: "wallet" });
            }, { action: "topup-failed" });
        },
        spend(kop, title, meta) {
            meta = meta || {};
            const a0 = this.get();
            if (!a0) return { ok: false, error: "auth", text: "Войдите в аккаунт" };
            if (!(kop > 0)) return { ok: false, error: "amount", text: "Неверная сумма" };
            if (a0.balance < kop) return { ok: false, error: "funds", text: `Недостаточно средств: нужно ${formatMoney(kop)}, на балансе ${formatMoney(a0.balance)}`, need: kop - a0.balance };
            return this.mutate(a => {
                const tx = { id: uid("TX"), type: meta.type || "spend", title, method: "Баланс NEXUS ID", amount: -kop, status: "ok", date: Date.now() };
                a.tx.unshift(tx);
                a.balance -= kop;
                if (typeof meta.apply === "function") meta.apply(a, tx);
                return { ok: true, tx, balance: a.balance };
            }, { action: meta.type || "spend" });
        },
        applyPromo(raw) {
            const code = String(raw || "").trim().toUpperCase();
            const promo = PROMO_CODES[code];
            const a0 = this.get();
            if (!a0) return { ok: false, text: "Войдите в аккаунт" };
            if (!code) return { ok: false, text: "Введите промокод" };
            if (!promo) return { ok: false, text: "Промокод не найден или истёк" };
            if (a0.promos.includes(code)) return { ok: false, text: "Этот промокод уже активирован" };
            return this.mutate(a => {
                a.promos.push(code);
                a.balance += promo.amount;
                a.tx.unshift({ id: uid("TX"), type: "bonus", title: promo.label, method: `Промокод ${code}`, amount: promo.amount, status: "ok", date: Date.now() });
                if (a.prefs.payment) a.notifications.unshift({ id: uid("N"), type: "payment", title: `Промокод ${code} активирован`, text: `На баланс зачислено ${formatMoney(promo.amount)}`, date: Date.now(), read: false, link: "wallet" });
                return { ok: true, amount: promo.amount, code };
            }, { action: "promo" });
        },
        removeCard(id) {
            return this.mutate(a => { a.cards = a.cards.filter(c => c.id !== id); }, { action: "card-remove" });
        },

        /* ----- Подписка ----- */
        subscribe(planId) {
            const plan = PLANS[planId];
            const a0 = this.get();
            if (!plan || !a0) return { ok: false, text: "Тариф недоступен" };
            if (planId === "free") return this.cancelPlan(true);
            if (a0.plan.id === planId && a0.plan.until > Date.now()) return { ok: false, text: `Тариф ${plan.label} уже активен` };
            // Переход с NEXUS+ на PATRON: неиспользованные дни засчитываются
            let credit = 0;
            const cur = PLANS[a0.plan.id];
            if (cur.price && a0.plan.until > Date.now()) credit = Math.round(cur.price * (a0.plan.until - Date.now()) / (30 * 86400000));
            const price = Math.max(0, plan.price - credit);
            if (a0.balance < price) return { ok: false, error: "funds", text: `Недостаточно средств: нужно ${formatMoney(price)}`, need: price - a0.balance };
            return this.mutate(a => {
                if (price > 0) {
                    a.tx.unshift({ id: uid("TX"), type: "plan", title: `Подписка ${plan.label} · 30 дней${credit ? " (с учётом остатка)" : ""}`, method: "Баланс NEXUS ID", amount: -price, status: "ok", date: Date.now() });
                    a.balance -= price;
                }
                a.plan = { id: planId, since: Date.now(), until: Date.now() + 30 * 86400000, autoRenew: true };
                a.notifications.unshift({ id: uid("N"), type: "payment", title: `Подписка ${plan.label} активна`, text: `Списано ${formatMoney(price)} · до ${dateStr(new Date(a.plan.until))}`, date: Date.now(), read: false, link: "plus" });
                return { ok: true, price, plan };
            }, { action: "plan" });
        },
        setAutoRenew(on) {
            return this.mutate(a => { a.plan.autoRenew = !!on; }, { action: "plan-renew" });
        },
        cancelPlan(now) {
            return this.mutate(a => {
                if (now || !a.plan.until) a.plan = { id: "free", since: Date.now(), until: null, autoRenew: true };
                else a.plan.autoRenew = false;
                return { ok: true };
            }, { action: "plan-cancel" });
        },
        /* Продление / окончание подписки (при загрузке страницы и раз в минуту) */
        checkRenewal() {
            const a0 = this.get();
            if (!a0 || a0.plan.id === "free" || !a0.plan.until || a0.plan.until > Date.now()) return;
            const plan = PLANS[a0.plan.id];
            this.mutate(a => {
                if (a.plan.autoRenew && a.balance >= plan.price) {
                    a.balance -= plan.price;
                    a.plan.until = Math.max(a.plan.until, Date.now()) + 30 * 86400000;
                    a.tx.unshift({ id: uid("TX"), type: "plan", title: `Продление ${plan.label} · 30 дней`, method: "Баланс NEXUS ID", amount: -plan.price, status: "ok", date: Date.now() });
                    a.notifications.unshift({ id: uid("N"), type: "payment", title: `Подписка ${plan.label} продлена`, text: `Списано ${formatMoney(plan.price)}`, date: Date.now(), read: false, link: "plus" });
                } else {
                    a.notifications.unshift({ id: uid("N"), type: "payment", title: `Подписка ${plan.label} закончилась`, text: a.plan.autoRenew ? "Не хватило средств для продления — пополните баланс" : "Автопродление было выключено", date: Date.now(), read: false, link: "plus" });
                    a.plan = { id: "free", since: Date.now(), until: null, autoRenew: true };
                }
            }, { action: "plan-renewal" });
        },
        planInfo(a) {
            a = a || this.get();
            const p = a ? PLANS[a.plan.id] : PLANS.free;
            return Object.assign({}, p, { until: a ? a.plan.until : null, autoRenew: a ? a.plan.autoRenew : false });
        },

        /* ----- Поддержка проектов ----- */
        funding(pid) {
            const f = FUNDING[pid] || { goal: 2000000, base: 0, purpose: "развитие проекта" };
            const a = this.get();
            const mine = a ? (a.donations[pid] || 0) : 0;
            return { goal: f.goal, raised: f.base + mine, mine, purpose: f.purpose };
        },
        donate(pid, kop, comment) {
            const p = PROJECTS.find(x => x.id === pid);
            if (!p) return { ok: false, text: "Проект не найден" };
            const cashPct = this.planInfo().cashback || 0;
            const res = this.spend(kop, `Поддержка проекта ${p.title}`, {
                type: "donate",
                apply: (a, tx) => {
                    if (comment) tx.comment = String(comment).slice(0, 140);
                    a.donations[pid] = (a.donations[pid] || 0) + kop;
                    const cash = cashPct ? Math.round(kop * cashPct / 100) : 0;
                    if (cash) {
                        a.balance += cash;
                        a.tx.unshift({ id: uid("TX"), type: "cashback", title: `Кешбэк ${cashPct}% · ${PLANS[a.plan.id].label}`, method: "NEXUS ID", amount: cash, status: "ok", date: Date.now() + 1 });
                    }
                    a.notifications.unshift({ id: uid("N"), type: "payment", title: `Спасибо за поддержку ${p.title}!`, text: `${formatMoney(kop)}${cash ? ` · кешбэк ${formatMoney(cash)}` : ""}`, date: Date.now(), read: false, link: "plus" });
                }
            });
            if (res && res.ok) Syslog.add(`wallet: поддержка ${p.id} ${formatMoney(kop)}`);
            return res;
        },

        /* ----- Безопасность ----- */
        logEvent(event, ok) {
            return this.mutate(a => { a.security.log.unshift({ date: Date.now(), event, device: deviceName(), ok: ok !== false }); }, { action: "security-log" });
        },
        changePassword() {
            return this.mutate(a => {
                a.security.pwdChanged = Date.now();
                a.security.log.unshift({ date: Date.now(), event: "Пароль изменён", device: deviceName(), ok: true });
                a.notifications.unshift({ id: uid("N"), type: "security", title: "Пароль изменён", text: `${deviceName()} · если это были не вы, завершите все сеансы`, date: Date.now(), read: false, link: "security" });
            }, { action: "password" });
        },
        makeBackupCodes() {
            const out = [];
            for (let i = 0; i < 8; i++) out.push(`${randInt(1000, 9999)}-${randInt(1000, 9999)}`);
            return out;
        },
        setTwoFA(on) {
            return this.mutate(a => {
                a.security.twoFA = !!on;
                a.security.backup = on ? this.makeBackupCodes() : [];
                a.security.log.unshift({ date: Date.now(), event: on ? "Включена двухфакторная защита" : "Двухфакторная защита выключена", device: deviceName(), ok: true });
                a.notifications.unshift({ id: uid("N"), type: "security", title: on ? "2FA включена" : "2FA выключена", text: on ? "Сохраните резервные коды в надёжном месте" : "Рекомендуем снова включить двухфакторную защиту", date: Date.now(), read: false, link: "security" });
                return a.security.backup.slice();
            }, { action: "2fa" });
        },
        regenBackup() {
            return this.mutate(a => {
                a.security.backup = this.makeBackupCodes();
                a.security.log.unshift({ date: Date.now(), event: "Созданы новые резервные коды", device: deviceName(), ok: true });
                return a.security.backup.slice();
            }, { action: "2fa-codes" });
        },
        endSession(id) {
            return this.mutate(a => {
                const before = a.security.sessions.length;
                a.security.sessions = a.security.sessions.filter(x => x.current || (id && x.id !== id));
                const n = before - a.security.sessions.length;
                if (n) a.security.log.unshift({ date: Date.now(), event: id ? "Сеанс завершён" : `Завершены другие сеансы (${n})`, device: deviceName(), ok: true });
                return n;
            }, { action: "sessions" });
        },
        /* Оценка защиты аккаунта для «Обзора» и «Безопасности» */
        securityScore(a, s) {
            a = a || this.get();
            s = s || Auth.get();
            if (!a || !s) return { score: 0, items: [] };
            const items = [
                { id: "email", label: "Email указан", done: !!(s.email && !/\.example$/.test(s.email)), tab: "profile", action: "Указать email" },
                { id: "2fa", label: "Двухфакторная защита", done: a.security.twoFA, tab: "security", action: "Включить" },
                { id: "pwd", label: "Пароль менялся за последние 180 дней", done: !!(a.security.pwdChanged && Date.now() - a.security.pwdChanged < 180 * 86400000), tab: "security", action: "Сменить" },
                { id: "sessions", label: "Нет лишних активных сеансов", done: a.security.sessions.length <= 1, tab: "security", action: "Проверить" }
            ];
            const done = items.filter(x => x.done).length;
            return { score: Math.round(done / items.length * 100), items };
        },

        /* ----- Профиль и данные ----- */
        updateProfile(patch) {
            return this.mutate(a => {
                Object.keys(patch).forEach(k => { if (k in a.profile) a.profile[k] = patch[k]; });
            }, { action: "profile" });
        },
        exportData() {
            const s = Auth.get();
            const a = this.get();
            if (!s || !a) return null;
            return { exported: new Date().toISOString(), session: { callsign: s.callsign, email: s.email, id: s.id, role: s.role, registered: s.registered, downloads: s.downloads }, account: a };
        },
        /* Удаление аккаунта: данные кошелька и профиля стираются, сессия завершается */
        destroy() {
            const s = Auth.get();
            if (!s) return false;
            const map = this.readAll();
            delete map[s.id];
            storage.setJSON(this.KEY, map);
            // Данные тестовых сервисов принадлежат аккаунту — удаляем вместе с ним
            VPN.drop(s.id);
            IDEStore.drop(s.id);
            Auth.logout();
            return true;
        }
    };

    /* Баланс в шапке (все страницы): [#header-wallet] + бейдж подписки */
    function updateWalletUI() {
        const box = $("#header-wallet");
        const s = Auth.get();
        if (!box) return;
        if (!s) { box.hidden = true; return; }
        const a = Account.get();
        box.hidden = false;
        const val = $("#header-balance", box);
        if (val) val.textContent = formatMoney(a ? a.balance : 0);
        const plan = a ? PLANS[a.plan.id] : PLANS.free;
        box.setAttribute("data-plan", plan.id);
        box.title = `Баланс NEXUS ID · тариф ${plan.label}`;
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
            // При reboot из терминала интерфейс уже раскрыт (ui-ready) —
            // сворачиваем его, чтобы после загрузки анимация появления сыграла заново
            body.classList.remove("ui-ready", "term-open");
            body.classList.add("is-booting", "is-boot-full", "solidBackground");

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
            document.documentElement.classList.remove("boot-pending");

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
            skipBtn.remove();
            // Плавный уход экрана загрузки (сплошной фон → страница), без мигания
            body.classList.remove("is-boot-full", "solidBackground");
            screen.classList.add("is-leaving");
            await delay(280);
            screen.remove();
            body.classList.remove("is-booting");
            storage.sessionSet("nx_booted", "1");
            this.running = false;
        }
    };

    /* Последовательность заголовка из displayTitleScreen() */
    async function titleSequence(screen, text, wait, full) {
        // Фон экрана загрузки больше не мигает (оригинал переключал body.solidBackground,
        // из-за чего на сайте на мгновение показывалась страница под логотипом)
        screen.classList.add("center");
        const title = document.createElement("h1");
        title.textContent = text;
        title.setAttribute("data-text", text);
        screen.innerHTML = "";
        screen.appendChild(title);

        await wait(250);
        title.className = "flash";
        await wait(240);
        title.className = "boxed";
        await wait(90);
        title.className = "glitch";
        await wait(420);
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
        // mod_hardwareInspector (главная)
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
        static redrawAll() { LineChart.all.forEach(c => c.draw()); }
        constructor(canvas, opts) {
            this.canvas = canvas;
            this.ctx = canvas.getContext("2d");
            this.opts = Object.assign({ series: 1, points: 60, min: 0, max: 100, invert: false, fill: false, alphas: [1, 0.55] }, opts || {});
            this.data = [];
            for (let s = 0; s < this.opts.series; s++) {
                this.data.push(new Array(this.opts.points).fill(this.opts.min));
            }
            this.resize();
            LineChart.all.push(this);
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
    LineChart.all = [];
    document.addEventListener("nexus:theme", () => LineChart.redrawAll());

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

        if (pingEl) {
            const ping = walker(24, 9, 80, 4, 0.03);
            setInterval(() => {
                if (!Net.online) { pingEl.textContent = "-- ms"; return; }
                const rtt = nc && nc.rtt ? nc.rtt / 2 + ping() / 2 : ping();
                pingEl.textContent = Math.round(rtt) + " ms";
            }, 2000);
        }

        // mod_conninfo: графики трафика UP / DOWN (главная)
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
        document.addEventListener("nexus:catalog", render);
        Telemetry.on(render);
        render();
    }

    /* TOP SERVERS (toplist.class.js) — кабинет */
    /* Статус-бары нод (главная): нагрузка CPU и состояние каждого сервера */
    function initNodeBars() {
        const list = $("#node-bars");
        if (!list) return;
        list.innerHTML = SERVERS.map(n => `
            <li class="node-bar" data-node="${escapeHtml(n.id)}">
                <span class="node-name">${escapeHtml(n.id)}</span>
                <span class="node-track"><i></i></span>
                <span class="node-val">--</span>
            </li>`).join("");
        const rows = SERVERS.map(n => {
            const li = list.querySelector(`[data-node="${n.id}"]`);
            return { n, li, bar: li.querySelector("i"), val: li.querySelector(".node-val") };
        });
        const render = () => {
            rows.forEach(({ n, li, bar, val }) => {
                const up = Telemetry.isUp(n);
                const cpu = up ? Math.round(n.cpu) : 0;
                bar.style.width = cpu + "%";
                val.textContent = up ? cpu + "%" : (n.status === "offline" ? "OFF" : "DOWN");
                li.classList.toggle("is-down", !up);
                li.classList.toggle("is-hot", up && cpu >= 80);
            });
        };
        Telemetry.on(render);
        render();
    }

    /* Подпись текущей темы на плитке быстрого доступа */
    function initQuickTheme() {
        const el = $("#quick-theme");
        if (!el) return;
        const paint = () => { el.textContent = `тема: ${Theme.current()}`; };
        paint();
        document.addEventListener("nexus:theme", paint);
    }

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
                () => {
                    const rel = PROJECTS.filter(p => p.status === "available");
                    return rel.length ? `cdn: ${pick(rel).title} — ${randInt(3, 40)} downloads/min` : `cdn: edge cache hit ratio ${randInt(90, 99)}%`;
                },
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
                        const vertical = list.getAttribute("aria-orientation") === "vertical";
                        if (e.key === (vertical ? "ArrowDown" : "ArrowRight")) idx = (i + 1) % tabs.length;
                        else if (e.key === (vertical ? "ArrowUp" : "ArrowLeft")) idx = (i - 1 + tabs.length) % tabs.length;
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
     *         "closed"    — закрытый тест (нужен вход)
     *         "dev"       — в разработке (dev-снапшоты для ADMIN / CREATOR)
     * access: кто может скачивать — "public" (без входа) | "user" | "admin" | "creator"
     * ================================================================ */
    /* Базовые разделы каталога. Свои разделы CREATOR добавляет в nx_custom_categories. */
    const BASE_CATEGORIES = { ue5: "UNREAL ENGINE 5", minecraft: "MINECRAFT", web: "BROWSER / WEBGL", tools: "TOOLS / SOFT", other: "OTHER" };
    const CATEGORIES = Object.assign({}, BASE_CATEGORIES);
    const STATUSES = {
        available: { label: "ДОСТУПНО ДЛЯ СКАЧИВАНИЯ", short: "ДОСТУПНО" },
        closed: { label: "ЗАКРЫТЫЙ ТЕСТ", short: "ЗАКРЫТЫЙ ТЕСТ" },
        dev: { label: "В РАЗРАБОТКЕ", short: "В РАЗРАБОТКЕ" }
    };

    const BUILTIN_PROJECTS = [
        /* play — проект запускается прямо на сайте (плеер-оверлей с iframe), без скачивания */
        {
            id: "aquarium",
            code: "NX-20",
            title: "NEXUS AQUARIUM",
            category: "web",
            status: "available",
            access: "public",
            icon: "play",
            play: "play/aquarium.html",
            tags: ["WebGL", "3D", "Без установки", "Мышь / тач"],
            summary: "3D-аквариум прямо в браузере: крутите мышкой, кормите рыб, включайте ночь. Запуск в один клик — ничего не скачивается.",
            version: "1.0.0",
            size: "117 KiB",
            sizeMB: 0.12,
            platform: "Браузер · WebGL",
            updated: "2026-11-12",
            file: "play/aquarium.html",
            requirements: "Любой современный браузер с WebGL (Chrome, Firefox, Edge, Safari), ПК или телефон. Установка не нужна.",
            notes: [
                { version: "1.0.0", date: "2026-11-12", items: [
                    "Вращение мышью и пальцем, зум колесом и щипком, инерция и авто-обзор",
                    "6 видов рыб: неоны, гуппи, клоуны, хирурги, золотые, скалярии — стаи, обход стен, питание",
                    "Корм по клику на воду, «тук-тук» по стеклу, подсказка с названием рыбы",
                    "Каустика на песке, лучи света, пузыри от распылителя, день / ночь, звук воды",
                    "Состав аквариума сохраняется в браузере (nx_aquarium)"
                ] }
            ]
        },
        {
            id: "abrams",
            code: "NX-21",
            title: "NEXUS ABRAMS",
            category: "web",
            status: "available",
            access: "public",
            icon: "play",
            play: "play/abrams.html",
            tags: ["WebGL", "3D-модель", "По чертежам", "Без установки"],
            summary: "Детализированная 3D-модель танка M1A2 Abrams по чертежам и фото: крутите, поворачивайте башню, стреляйте, сравнивайте с чертежом в видах сбоку / спереди / сверху / сзади.",
            version: "1.4.5",
            size: "182 KiB",
            sizeMB: 0.17,
            platform: "Браузер · WebGL",
            updated: "2026-11-23",
            file: "play/abrams.html",
            requirements: "Любой современный браузер с WebGL (Chrome, Firefox, Edge, Safari), ПК или телефон. Установка не нужна.",
            notes: [
                { version: "1.4.5", date: "2026-11-23", items: [
                    "Передняя плита скулы завалена назад на 30° от вертикали; горизонтальная часть нижней кромки занимает 75,5 % ширины",
                    "У маски кромка резко поднимается по диагонали с Y 1,79 до Y 2,08, образуя явный треугольный скос",
                    "Нижний подрез удлинён клином к погону; корпус маски углублён и перекрывает стык с крышей и стенками паза без зазоров",
                    "Геометрия сверена в профиль, спереди, сверху и в 3/4, а также наложением чертежа 03.png в масштабе 1 : 1"
                ] },
                { version: "1.4.4", date: "2026-11-22", items: [
                    "Скулы: основная плита на ~83 % высоты, нижняя кромка горизонтальна на ~78 % ширины, у маски — треугольный срез вверх; под ним узкий клиновидный подрез",
                    "Маска и ось пушки подняты до 2,10 — верх маски вровень с крышей; гладкая лицевая плита, скошенные фланцы с болтами, шаровой кожух и полукруглый вырез под стволом",
                    "Башня посажена ниже (зазор 4,5 см), корма ниши — тупой клин в профиль",
                    "Палуба над гусеницами сплошная вровень с подбашенным листом, ВЛД продолжается на полки без ступеньки",
                    "Задняя секция экрана на полную высоту с вырезом под звёздочку; вогнутые диски катков; звёздочка выдвинута в плоскость катков, овальные отверстия облегчения"
                ] },
                { version: "1.4.3", date: "2026-11-21", items: [
                    "Подрез под скулой — одна плоская наклонная грань от кромки плиты до низа башни, ступенька-«подоконник» убрана",
                    "Гранатомёты M250: компактный блок 2 × 3 трубы Ø66 мм под 37° вперёд-вверх, тонкая полка снизу и низкая пластина снаружи",
                    "Наклонные фаски между ВЛД и надгусеничными полками закрыли чёрные колодцы; горловины баков — плоские крышки 12 мм"
                ] },
                { version: "1.4.2", date: "2026-11-20", items: [
                    "Скулы пересобраны: основная плита с горизонтальной нижней кромкой на ~80 % ширины и коротким изломом вверх у маски",
                    "Под плитой — «корыто»: козырёк, заглублённая стенка и горизонтальная полка, у маски тоже поднимается",
                    "Острый треугольный скос под скулой убран; борта, маска и обвес не менялись"
                ] },
                { version: "1.4.1", date: "2026-11-19", items: [
                    "Маска — сплошной бронеблок 0,60 × 0,60 × 0,55 м в пазу между скулами, выступает на 0,18 м; чёрной ниши больше нет",
                    "Резиновый чехол ствола убран: пушка входит в плиту маски через гладкое кольцо-воротник",
                    "Скулы — одна прямая грань в плане от амбразуры (±0,31) до угла (±1,625, на 0,70 назад), без излома и валиков-швов",
                    "Контуры лба сверены с чертежом 03.png наложением сбоку, сверху и спереди"
                ] },
                { version: "1.4.0", date: "2026-11-18", items: [
                    "Каркас пересобран по метрическим координатам: ширина 3,67, крыша башни 2,40, ось пушки 1,90, 7 катков с шагом 0,80, экраны до 0,80",
                    "Башня — длинный низкий клин 4,70 × 0,70 (6,7 : 1): профиль «<», борта завалены на 30°, в плане 3,25 → 2,80",
                    "Компактная маска 0,65 × 0,60 у острия клина; ствол без дульного тормоза, эжектор в 1,80 от среза, вынос за нос 1,50",
                    "Корзина заканчивается в 1,30 м от кормы — решётки МТО открыты; ВЛД ~7,8°, ведущее колесо на 0,80 открыто",
                    "Гранатомёты на стыке скулы и борта, трёхрядный стеллаж, кабель по низу башни; корма с решёткой 2,2 × 0,5 и фонарями по углам"
                ] },
                { version: "1.3.0", date: "2026-11-17", items: [
                    "Башня посажена на корпус: зазор ~3 см, без чёрного цилиндра погона, не задевает люк мехвода при повороте",
                    "Маска узкая и утопленная в амбразуру: вертикальные стенки, прилив спаренного пулемёта, гофрированный чехол",
                    "Дымовые гранатомёты перенесены к корзине, в бронекожухе с дугой",
                    "Острый нос, НЛД со швами, ребром, буксирными вилками и щитком; корма с объёмными жалюзи ГТД, петлями, фаркопом и клетками фонарей",
                    "Сплошные диски катков с ребром и болтовой ступицей, более толстые траки T-158; усиленный заполняющий свет"
                ] },
                { version: "1.2.0", date: "2026-11-16", items: [
                    "Модель M1A2: широкая асимметричная башня (правая скула длиннее), нижний подрез, верхняя фаска, сварные швы",
                    "Многогранная маска с болтами, чехлом и бронекожухом спаренного M240; башенка командира с 8 приборами и M2",
                    "CITV с вращающейся головой, GPS с бронезаслонками и глубоким окном, вышибные панели с заклёпками и ручками",
                    "Люк мехвода с 3 перископами и брызговиком, ограждения фар, проушины с пальцами, объёмные экраны с петлями",
                    "Катки со ступицами и рельефными шинами, венцы ведущего колеса, траки T-158 с подушками и гребнями",
                    "Свет: SSAO, материалы CARC / воронёная сталь / резина / оптика, заполняющий свет, плёночная кривая"
                ] },
                { version: "1.1.0", date: "2026-11-15", items: [
                    "Геометрия выверена по откалиброванному чертежу и фото M1A1 в лоб",
                    "Башня: шире всего внизу, борта завалены к крыше, излом лобовых скул, ниша длиннее, маска выше",
                    "Корпус ниже: пологий верхний лобовой лист, крылья и экраны 1,36 м, крыша МТО 1,70 м",
                    "Нижний лобовой лист с «подбородком», буксирные серьги, кожух над ведущим колесом"
                ] },
                { version: "1.0.0", date: "2026-11-14", items: [
                    "Геометрия снята с 4-проекционного чертежа M1A1: длина с пушкой 9,83 м, корпус 7,92 м, ширина 3,66 м",
                    "Клиновидная башня с кормовой корзиной, 120-мм M256 с эжектором, M2 у командира и M240 у заряжающего",
                    "7 сдвоенных катков, ленивец, ведущее колесо сзади, гусеница из 87 траков, бортовые экраны",
                    "Поворот башни и наведение пушки, ход с пылью и следами, выстрел с откатом, звук турбины",
                    "Режим чертежа, ортогональные виды, размеры и подписи узлов, 3 варианта окраски (nx_abrams)"
                ] }
            ]
        },
        {
            id: "launcher",
            code: "NX-00",
            title: "NEXUS LAUNCHER",
            category: "tools",
            status: "available",
            access: "public",
            icon: "terminal",
            tags: ["NEXUS ID", "Автообновление", "SHA-256"],
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
            access: "public",
            icon: "java",
            tags: ["Fabric", "Java 21", "Окопы"],
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
            access: "public",
            icon: "minecraft",
            tags: ["Fabric", "Modrinth", "Survival+"],
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
            access: "user",
            icon: "unreal",
            tags: ["UE5", "RTS", "Lumen", "Nanite"],
            summary: "Тактическая RTS на Unreal Engine 5 с инженерной обороной и упрощённым градостроительством.",
            version: "0.3.7-prealpha",
            size: "18.4 GiB",
            sizeMB: 18841,
            platform: "Windows · DX12",
            updated: "2026-11-02",
            file: "BASTION-0.3.7-prealpha-Win64.zip",
            requirements: "Windows 10/11 64-bit, GTX 1070 / RX 5600 XT, 16 GiB RAM, SSD. Скачивание — после входа (роль USER и выше).",
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
            access: "admin",
            icon: "cpp",
            tags: ["UE5 Plugin", "C++", "World Partition"],
            summary: "Плагин UE5 для деформации ландшафта в реальном времени: окопы, рвы и перестройка навигации.",
            version: "0.6.1-alpha",
            size: "36 MiB",
            sizeMB: 36,
            platform: "UE 5.4 · Win64 / Linux",
            updated: "2026-10-27",
            file: "Trenchworks-0.6.1-UE5.4.zip",
            requirements: "Unreal Engine 5.4. Dev-снапшоты доступны ролям ADMIN и CREATOR.",
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
            access: "admin",
            icon: "gradle",
            tags: ["NeoForge", "Sci-Fi", "Дроны"],
            summary: "Sci-Fi мод: энергосети, дроны-строители и щитовые генераторы для баз.",
            version: "0.2.0-dev",
            size: "9.8 MiB",
            sizeMB: 9.8,
            platform: "NeoForge · Java 1.21.1",
            updated: "2026-10-12",
            file: "nexus-tech-0.2.0-dev+neoforge-1.21.1.jar",
            requirements: "Minecraft Java 1.21.1, NeoForge 21.1. Dev-снапшоты доступны ролям ADMIN и CREATOR.",
            notes: [
                { version: "0.2.0-dev", date: "2026-10-12", items: ["Первые дроны-строители", "Энергосеть и кабели"] }
            ]
        }
    ];

    BUILTIN_PROJECTS.forEach(p => Object.freeze(p));

    /* Живой список проектов: официальные (с правками) + созданные через сайт.
       Массив изменяется на месте, поэтому все ссылки на PROJECTS остаются актуальными. */
    const PROJECTS = [];

    const PROJECT_ICONS = ["terminal", "unreal", "minecraft", "java", "cpp", "gradle", "code", "blender", "steam", "docker",
        "linux", "desktop", "database", "lightning", "satellite", "rom", "disk", "usb", "archive", "flag", "star", "heart",
        "portfolio", "work", "shell", "json", "book", "activity"];

    const Catalog = {
        KEY: "nx_custom_projects",
        HIDDEN_KEY: "nx_hidden_projects",
        CAT_KEY: "nx_custom_categories",
        MAX_TITLE: 48,

        builtin(id) {
            return BUILTIN_PROJECTS.find(p => p.id === id) || null;
        },
        /* Сырые записи из localStorage: созданные проекты и правки официальных (builtin: true) */
        readCustom() {
            const list = storage.getJSON(this.KEY, []);
            return Array.isArray(list) ? list.filter(x => x && typeof x.id === "string" && typeof x.title === "string") : [];
        },
        readHidden() {
            const list = storage.getJSON(this.HIDDEN_KEY, []);
            return Array.isArray(list) ? list.filter(x => typeof x === "string") : [];
        },
        readCategories() {
            const list = storage.getJSON(this.CAT_KEY, []);
            return Array.isArray(list) ? list.filter(x => x && typeof x.id === "string" && typeof x.label === "string") : [];
        },
        /* Приводит запись к полной структуре проекта (защита от битых данных) */
        normalize(raw, base) {
            const p = Object.assign({}, base || {}, raw);
            p.title = String(p.title || "UNTITLED").slice(0, this.MAX_TITLE);
            p.code = String(p.code || "NX-??").slice(0, 12);
            if (!STATUSES[p.status]) p.status = "available";
            if (!ACCESS[p.access]) p.access = p.status === "dev" ? "admin" : (p.status === "closed" ? "user" : "public");
            if (!CATEGORIES[p.category]) p.category = "other";
            if (PROJECT_ICONS.indexOf(p.icon) === -1 && !(base && base.icon === p.icon)) p.icon = "archive";
            p.summary = String(p.summary || "");
            p.version = String(p.version || "0.1.0");
            p.sizeMB = Math.max(0.1, Number(p.sizeMB) || 50);
            p.size = formatMiB(p.sizeMB);
            p.platform = String(p.platform || "—");
            p.updated = String(p.updated || dateISO(new Date()));
            p.file = String(p.file || "build.zip");
            p.url = /^https?:\/\//i.test(p.url || "") ? String(p.url) : "";
            p.requirements = String(p.requirements || "");
            p.tags = Array.isArray(p.tags) ? p.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 12) : [];
            p.notes = Array.isArray(p.notes) ? p.notes.filter(n => n && Array.isArray(n.items)) : [];
            p.cover = typeof p.cover === "string" && p.cover.indexOf("data:image/") === 0 ? p.cover : "";
            /* Запуск в браузере — только у официальных проектов (путь задан в коде, не из localStorage) */
            p.play = base && base.play ? base.play : "";
            p.custom = !base;
            p.edited = !!base;
            return p;
        },
        /* Пересобрать PROJECTS и CATEGORIES из встроенных данных и localStorage */
        load() {
            Object.keys(CATEGORIES).forEach(k => { if (!BASE_CATEGORIES[k]) delete CATEGORIES[k]; });
            this.readCategories().forEach(c => { if (!BASE_CATEGORIES[c.id]) CATEGORIES[c.id] = c.label; });
            const custom = this.readCustom();
            const hidden = this.readHidden();
            const list = [];
            BUILTIN_PROJECTS.forEach(b => {
                if (hidden.indexOf(b.id) !== -1) return;
                const over = custom.find(x => x.id === b.id && x.builtin);
                list.push(over ? this.normalize(over, b) : Object.assign({}, b, { custom: false, edited: false, tags: b.tags || [], cover: "", url: "" }));
            });
            custom.forEach(x => {
                if (x.builtin || this.builtin(x.id)) return;
                list.push(this.normalize(x));
            });
            PROJECTS.length = 0;
            list.forEach(p => PROJECTS.push(p));
            return PROJECTS;
        },
        emit(action, id) {
            document.dispatchEvent(new CustomEvent("nexus:catalog", { detail: { action, id } }));
        },
        writeCustom(list) {
            return storage.setJSON(this.KEY, list);
        },
        slug(title) {
            const map = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya" };
            let base = String(title).toLowerCase().split("").map(c => map[c] !== undefined ? map[c] : c).join("")
                .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "project";
            if (/^(filter|dossier)-/.test(base)) base = "p-" + base;
            let id = base, i = 2;
            const taken = x => PROJECTS.some(p => p.id === x) || BUILTIN_PROJECTS.some(p => p.id === x) || this.readCustom().some(p => p.id === x);
            while (taken(id)) id = `${base}-${i++}`;
            return id;
        },
        nextCode() {
            const nums = PROJECTS.concat(BUILTIN_PROJECTS).map(p => parseInt(String(p.code).replace(/\D/g, ""), 10)).filter(n => !isNaN(n));
            const n = Math.max(20, nums.length ? Math.max.apply(null, nums) : 0) + 1;
            return "NX-" + String(n).padStart(2, "0");
        },
        /* Создать проект. Возвращает { ok, project } или { ok: false, error } */
        create(data) {
            if (!Auth.can("create")) return { ok: false, error: "denied" };
            const s = Auth.get();
            const rec = Object.assign({}, data, {
                id: this.slug(data.title),
                code: this.nextCode(),
                author: s ? s.callsign : "guest",
                created: Date.now(),
                updated: dateISO(new Date())
            });
            delete rec.builtin;
            const list = this.readCustom();
            list.push(rec);
            if (!this.writeCustom(list)) return { ok: false, error: "quota" };
            this.load();
            this.emit("create", rec.id);
            return { ok: true, project: PROJECTS.find(p => p.id === rec.id) };
        },
        update(id, data) {
            if (!Auth.can("edit")) return { ok: false, error: "denied" };
            const list = this.readCustom();
            const b = this.builtin(id);
            const idx = list.findIndex(x => x.id === id);
            const prev = idx !== -1 ? list[idx] : (b ? {} : null);
            if (!prev) return { ok: false, error: "missing" };
            const rec = Object.assign({}, prev, data, { id, updated: dateISO(new Date()) });
            if (b) { rec.builtin = true; rec.code = b.code; }
            if (idx !== -1) list[idx] = rec; else list.push(rec);
            if (!this.writeCustom(list)) return { ok: false, error: "quota" };
            this.load();
            this.emit("update", id);
            return { ok: true, project: PROJECTS.find(p => p.id === id) };
        },
        remove(id) {
            const p = PROJECTS.find(x => x.id === id);
            if (!p) return { ok: false, error: "missing" };
            if (!Auth.can("delete", p)) return { ok: false, error: "denied" };
            const list = this.readCustom().filter(x => x.id !== id);
            this.writeCustom(list);
            if (this.builtin(id)) {
                const hidden = this.readHidden();
                if (hidden.indexOf(id) === -1) hidden.push(id);
                storage.setJSON(this.HIDDEN_KEY, hidden);
            }
            this.load();
            this.emit("delete", id);
            return { ok: true, project: p };
        },
        /* Вернуть официальные проекты в исходное состояние (созданные через сайт остаются) */
        restore() {
            if (!Auth.can("sections")) return { ok: false, error: "denied" };
            this.writeCustom(this.readCustom().filter(x => !x.builtin && !this.builtin(x.id)));
            storage.remove(this.HIDDEN_KEY);
            this.load();
            this.emit("restore");
            return { ok: true };
        },
        /* ----- Разделы (категории) ----- */
        addCategory(label) {
            if (!Auth.can("sections")) return { ok: false, error: "denied" };
            label = String(label || "").trim().toUpperCase().slice(0, 24);
            if (label.length < 2) return { ok: false, error: "short" };
            if (Object.keys(CATEGORIES).some(k => CATEGORIES[k] === label)) return { ok: false, error: "exists" };
            const list = this.readCategories();
            let id = "c-" + (this.slugLatin(label) || "section"), i = 2;
            while (CATEGORIES[id] || list.some(c => c.id === id)) id = `${id.replace(/-\d+$/, "")}-${i++}`;
            list.push({ id, label });
            storage.setJSON(this.CAT_KEY, list);
            this.load();
            this.emit("categories");
            return { ok: true, id };
        },
        renameCategory(id, label) {
            if (!Auth.can("sections")) return { ok: false, error: "denied" };
            label = String(label || "").trim().toUpperCase().slice(0, 24);
            if (label.length < 2) return { ok: false, error: "short" };
            const list = this.readCategories();
            const c = list.find(x => x.id === id);
            if (!c) return { ok: false, error: "missing" };
            c.label = label;
            storage.setJSON(this.CAT_KEY, list);
            this.load();
            this.emit("categories");
            return { ok: true };
        },
        /* Удаление раздела: его проекты переезжают в OTHER */
        removeCategory(id) {
            if (!Auth.can("sections") || BASE_CATEGORIES[id]) return { ok: false, error: "denied" };
            storage.setJSON(this.CAT_KEY, this.readCategories().filter(x => x.id !== id));
            const list = this.readCustom();
            let moved = 0;
            list.forEach(x => { if (x.category === id) { x.category = "other"; moved++; } });
            this.writeCustom(list);
            this.load();
            this.emit("categories");
            return { ok: true, moved };
        },
        slugLatin(text) {
            return this.slug(text).replace(/-\d+$/, "");
        }
    };

    function formatMiB(mb) {
        if (mb >= 1024) return (mb / 1024).toFixed(1) + " GiB";
        return (mb < 10 ? mb.toFixed(1) : String(Math.round(mb))) + " MiB";
    }
    function dateISO(d) {
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    Catalog.load();

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
                    const f = $$("a[href], button:not([disabled]):not([hidden]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])", modal).filter(el => el.offsetParent !== null);
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
     * Тестовые сервисы NEXUS: VPN и IDE
     * Это демонстрация: VPN-клиент симулирует туннель (трафик не шифруется
     * и никуда не перенаправляется), IDE выполняет код только в изолированном
     * iframe на странице. Данные хранятся в localStorage отдельно для
     * каждого аккаунта: nx_vpn и nx_ide.
     * ================================================================ */
    const GiB = 1024 * 1024 * 1024;
    const SERVICE_LIMITS = {
        free: { label: "FREE", vpnData: 10 * GiB, vpnTiers: ["free"], secureCore: false, ideProjects: 3, ideProjectSize: 256 * 1024 },
        pro: { label: "NEXUS+", vpnData: Infinity, vpnTiers: ["free", "plus"], secureCore: true, ideProjects: 25, ideProjectSize: 1024 * 1024 }
    };
    /* «pro» — подписка NEXUS+ / PATRON или роль CREATOR (у владельца есть все права) */
    function serviceTier() {
        const s = Auth.get();
        if (!s) return null;
        if (s.role === "creator") return "pro";
        const a = Account.get();
        return a && a.plan && a.plan.id !== "free" ? "pro" : "free";
    }
    function serviceLimits() {
        return SERVICE_LIMITS[serviceTier() || "free"];
    }
    function monthKey(d) {
        d = d || new Date();
        return d.getFullYear() + "-" + pad(d.getMonth() + 1);
    }
    function formatBytes(b) {
        if (!isFinite(b)) return "∞";
        if (b < 1024) return Math.round(b) + " Б";
        const u = ["КБ", "МБ", "ГБ", "ТБ"];
        let i = -1;
        do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
        return (b >= 100 ? Math.round(b) : b.toFixed(1).replace(".", ",")) + " " + u[i];
    }
    function formatDuration(ms) {
        const t = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
        return `${h}:${pad(m)}:${pad(s)}`;
    }

    /* Серверы VPN. Адреса выхода берутся из диапазона 198.18.0.0/15 (RFC 2544, для тестов),
       домены — из зоны .test (RFC 2606): ни один из них не принадлежит реальным хостам. */
    const VPN_SERVERS = [
        { id: "nl-ams", cc: "NL", country: "Нидерланды", city: "Амстердам", lat: 52.37, lon: 4.9, tier: "free", tags: ["p2p", "stream"] },
        { id: "de-fra", cc: "DE", country: "Германия", city: "Франкфурт", lat: 50.11, lon: 8.68, tier: "free", tags: ["p2p"] },
        { id: "us-nyc", cc: "US", country: "США", city: "Нью-Йорк", lat: 40.71, lon: -74.0, tier: "free", tags: ["stream"] },
        { id: "ch-zrh", cc: "CH", country: "Швейцария", city: "Цюрих", lat: 47.37, lon: 8.54, tier: "plus", tags: ["secure"] },
        { id: "is-rkv", cc: "IS", country: "Исландия", city: "Рейкьявик", lat: 64.15, lon: -21.94, tier: "plus", tags: ["secure"] },
        { id: "se-sto", cc: "SE", country: "Швеция", city: "Стокгольм", lat: 59.33, lon: 18.07, tier: "plus", tags: ["secure", "p2p"] },
        { id: "fi-hel", cc: "FI", country: "Финляндия", city: "Хельсинки", lat: 60.17, lon: 24.94, tier: "plus", tags: ["p2p"] },
        { id: "gb-lon", cc: "GB", country: "Великобритания", city: "Лондон", lat: 51.51, lon: -0.13, tier: "plus", tags: ["stream"] },
        { id: "fr-par", cc: "FR", country: "Франция", city: "Париж", lat: 48.86, lon: 2.35, tier: "plus", tags: ["stream"] },
        { id: "pl-waw", cc: "PL", country: "Польша", city: "Варшава", lat: 52.23, lon: 21.01, tier: "plus", tags: ["p2p"] },
        { id: "tr-ist", cc: "TR", country: "Турция", city: "Стамбул", lat: 41.01, lon: 28.98, tier: "plus", tags: [] },
        { id: "kz-ala", cc: "KZ", country: "Казахстан", city: "Алматы", lat: 43.24, lon: 76.89, tier: "plus", tags: [] },
        { id: "ae-dxb", cc: "AE", country: "ОАЭ", city: "Дубай", lat: 25.2, lon: 55.27, tier: "plus", tags: [] },
        { id: "sg-sin", cc: "SG", country: "Сингапур", city: "Сингапур", lat: 1.35, lon: 103.82, tier: "plus", tags: ["stream"] },
        { id: "jp-tyo", cc: "JP", country: "Япония", city: "Токио", lat: 35.68, lon: 139.69, tier: "plus", tags: ["stream"] },
        { id: "us-lax", cc: "US", country: "США", city: "Лос-Анджелес", lat: 34.05, lon: -118.24, tier: "plus", tags: ["stream", "p2p"] },
        { id: "ca-tor", cc: "CA", country: "Канада", city: "Торонто", lat: 43.65, lon: -79.38, tier: "plus", tags: ["p2p"] },
        { id: "br-sao", cc: "BR", country: "Бразилия", city: "Сан-Паулу", lat: -23.55, lon: -46.63, tier: "plus", tags: [] },
        { id: "za-jnb", cc: "ZA", country: "ЮАР", city: "Йоханнесбург", lat: -26.2, lon: 28.05, tier: "plus", tags: [] },
        { id: "au-syd", cc: "AU", country: "Австралия", city: "Сидней", lat: -33.87, lon: 151.21, tier: "plus", tags: ["stream"] }
    ];
    const VPN_TAGS = { p2p: "P2P", stream: "Стриминг", secure: "Secure Core" };
    const VPN_PROTOCOLS = {
        wireguard: { id: "wireguard", label: "WireGuard", port: 51820, transport: "UDP", speed: 1, handshake: 1, cipher: "ChaCha20-Poly1305 · Curve25519" },
        "openvpn-udp": { id: "openvpn-udp", label: "OpenVPN UDP", port: 1194, transport: "UDP", speed: 0.74, handshake: 2.2, cipher: "AES-256-GCM · TLS 1.3" },
        "openvpn-tcp": { id: "openvpn-tcp", label: "OpenVPN TCP", port: 443, transport: "TCP", speed: 0.58, handshake: 2.6, cipher: "AES-256-GCM · TLS 1.3" },
        ikev2: { id: "ikev2", label: "IKEv2", port: 500, transport: "UDP", speed: 0.86, handshake: 1.5, cipher: "AES-256-GCM · ECP-384" }
    };
    /* Примерное местоположение пользователя по часовому поясу (без запросов в сеть) */
    const TZ_GEO = {
        "Europe/Amsterdam": [52.37, 4.9], "Europe/Brussels": [50.85, 4.35], "Europe/Berlin": [52.52, 13.4],
        "Europe/Paris": [48.86, 2.35], "Europe/London": [51.51, -0.13], "Europe/Warsaw": [52.23, 21.01],
        "Europe/Moscow": [55.75, 37.62], "Europe/Kiev": [50.45, 30.52], "Europe/Kyiv": [50.45, 30.52],
        "Europe/Minsk": [53.9, 27.56], "Europe/Riga": [56.95, 24.11], "Europe/Helsinki": [60.17, 24.94],
        "Europe/Istanbul": [41.01, 28.98], "Asia/Almaty": [43.24, 76.89], "Asia/Tashkent": [41.3, 69.24],
        "Asia/Tbilisi": [41.72, 44.79], "Asia/Yerevan": [40.18, 44.51], "Asia/Yekaterinburg": [56.84, 60.6],
        "Asia/Novosibirsk": [55.03, 82.92], "Asia/Vladivostok": [43.12, 131.89], "Asia/Tokyo": [35.68, 139.69],
        "Asia/Dubai": [25.2, 55.27], "Asia/Singapore": [1.35, 103.82], "America/New_York": [40.71, -74.0],
        "America/Chicago": [41.88, -87.63], "America/Los_Angeles": [34.05, -118.24], "America/Toronto": [43.65, -79.38],
        "America/Sao_Paulo": [-23.55, -46.63], "Australia/Sydney": [-33.87, 151.21]
    };
    function homeGeo() {
        let tz = "";
        try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* ignore */ }
        if (TZ_GEO[tz]) return { lat: TZ_GEO[tz][0], lon: TZ_GEO[tz][1], tz };
        const zone = tz.split("/")[0];
        const byZone = { Europe: [50.9, 6.0], America: [40.71, -74.0], Asia: [43.24, 76.89], Australia: [-33.87, 151.21], Africa: [-26.2, 28.05] };
        const g = byZone[zone] || [52.37, 4.9];
        return { lat: g[0], lon: g[1], tz: tz || "UTC" };
    }
    function geoDistance(a, b) {
        const R = 6371, rad = Math.PI / 180;
        const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }
    function randomKey() {
        const bytes = new Uint8Array(32);
        if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
        else for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
        let s = "";
        bytes.forEach(b => { s += String.fromCharCode(b); });
        return window.btoa(s);
    }

    const VPN = {
        KEY: "nx_vpn",
        SERVERS: VPN_SERVERS,
        TAGS: VPN_TAGS,
        PROTOCOLS: VPN_PROTOCOLS,
        /* Средний трафик подключённого устройства (байт/с) — для счётчика лимита FREE */
        RATE: 150 * 1024,
        home: homeGeo(),

        defaults() {
            return {
                connected: false, server: null, since: 0, entry: null, protocol: "wireguard",
                killSwitch: true, adblock: true, autoConnect: false, multihop: false,
                favorites: ["nl-ams"], history: [], blocked: 0,
                usage: { month: monthKey(), bytes: 0 }, keys: null, lastServer: null
            };
        },
        readAll() {
            const m = storage.getJSON(this.KEY, {});
            return m && typeof m === "object" ? m : {};
        },
        normalize(st) {
            const d = this.defaults();
            st = Object.assign(d, st && typeof st === "object" ? st : {});
            if (!Array.isArray(st.favorites)) st.favorites = [];
            if (!Array.isArray(st.history)) st.history = [];
            if (!VPN_PROTOCOLS[st.protocol]) st.protocol = "wireguard";
            if (!st.usage || st.usage.month !== monthKey()) st.usage = { month: monthKey(), bytes: 0 };
            if (st.connected && !this.find(st.server)) { st.connected = false; st.server = null; }
            return st;
        },
        get() {
            const s = Auth.get();
            if (!s) return null;
            return this.normalize(this.readAll()[s.id]);
        },
        mutate(fn, detail) {
            const s = Auth.get();
            if (!s) return null;
            const map = this.readAll();
            const st = this.normalize(map[s.id]);
            const res = fn(st, s);
            st.history = st.history.slice(0, 30);
            map[s.id] = st;
            if (!storage.setJSON(this.KEY, map)) {
                toast("Не удалось сохранить состояние VPN: хранилище браузера недоступно", "warn");
                return null;
            }
            this.emit(detail);
            return res === undefined ? st : res;
        },
        emit(detail) {
            updateVpnUI();
            document.dispatchEvent(new CustomEvent("nexus:vpn", { detail: detail || {} }));
        },
        drop(userId) {
            const map = this.readAll();
            if (map[userId]) { delete map[userId]; storage.setJSON(this.KEY, map); }
        },

        find(id) { return VPN_SERVERS.find(s => s.id === id) || null; },
        limits() { return serviceLimits(); },
        isPro() { return serviceTier() === "pro"; },
        canUse(srv) {
            if (!srv) return { ok: false, reason: "missing", text: "Сервер не найден" };
            if (!Auth.get()) return { ok: false, reason: "auth", text: "Войдите в NEXUS ID" };
            if (this.limits().vpnTiers.indexOf(srv.tier) < 0) return { ok: false, reason: "plan", text: `${srv.city} доступен с подпиской NEXUS+` };
            return { ok: true };
        },
        /* Пинг: расстояние до сервера + накладные расходы протокола и небольшой джиттер */
        ping(srv, protocol, jitter) {
            const p = VPN_PROTOCOLS[protocol] || VPN_PROTOCOLS.wireguard;
            const base = geoDistance(this.home, srv) / 62 + 6 + (p.handshake - 1) * 3;
            return Math.max(3, Math.round(base + (jitter ? (Math.random() - 0.5) * Math.min(12, base * 0.15) : 0)));
        },
        /* Загрузка сервера (%): медленно «дышит» во времени, одинакова во всех вкладках */
        load(srv, t) {
            t = t || Date.now();
            const h = hashString(srv.id);
            const base = 22 + (h % 46);
            const wave = 14 * Math.sin(t / 900000 + (h % 628) / 100) + 6 * Math.sin(t / 170000 + (h % 314) / 50);
            return Math.round(clamp(base + wave, 4, 97));
        },
        score(srv) { return this.ping(srv) * (1 + this.load(srv) / 90); },
        best(filter) {
            const ok = VPN_SERVERS.filter(s => this.canUse(s).ok && (!filter || filter(s)));
            ok.sort((a, b) => this.score(a) - this.score(b));
            return ok[0] || null;
        },
        entryFor(srv) {
            // Secure Core: вход через защищённый узел (CH / IS / SE), выход — выбранный сервер
            const cores = VPN_SERVERS.filter(s => s.tags.indexOf("secure") >= 0 && s.id !== srv.id);
            cores.sort((a, b) => geoDistance(this.home, a) - geoDistance(this.home, b));
            return cores[0] || null;
        },
        exitIp(srv, st) {
            const i = Math.max(0, VPN_SERVERS.indexOf(srv));
            const h = hashString(srv.id + ":" + ((st && st.since) || 0));
            return `198.${18 + (i >= 10 ? 1 : 0)}.${(i % 10) * 24 + (h % 24)}.${2 + (h >>> 8) % 250}`;
        },
        virtualIp(userId) {
            const h = hashString("vip:" + (userId || "guest"));
            return `10.64.${h % 250 + 2}.${(h >>> 8) % 250 + 2}`;
        },
        hostname(srv) { return `${srv.id}.vpn.nexus.test`; },

        sessionBytes(st, now) {
            if (!st || !st.connected) return 0;
            const sec = Math.min(((now || Date.now()) - st.since) / 1000, 6 * 3600);
            return Math.max(0, Math.round(sec * this.RATE));
        },
        quota(st) {
            st = st || this.get();
            const limit = this.limits().vpnData;
            const used = st ? st.usage.bytes + this.sessionBytes(st) : 0;
            return { used, limit, left: Math.max(0, limit - used), pct: isFinite(limit) ? clamp(used / limit * 100, 0, 100) : 0, over: used >= limit };
        },

        /* Подключение (анимация — на странице клиента; здесь только смена состояния) */
        connect(serverId, opts) {
            opts = opts || {};
            const srv = this.find(serverId) || this.best();
            const can = this.canUse(srv);
            if (!can.ok) return can;
            const cur = this.get();
            if (this.quota(cur).over) return { ok: false, reason: "quota", text: `Лимит ${formatBytes(this.limits().vpnData)} в этом месяце исчерпан` };
            const pro = this.isPro();
            return this.mutate(st => {
                if (st.connected) this.closeSession(st, "switch");
                st.connected = true;
                st.server = srv.id;
                st.lastServer = srv.id;
                st.since = Date.now();
                st.blocked = 0;
                st.entry = st.multihop && pro ? ((this.entryFor(srv) || {}).id || null) : null;
                if (opts.protocol && VPN_PROTOCOLS[opts.protocol]) st.protocol = opts.protocol;
                return { ok: true, server: srv, entry: this.find(st.entry) };
            }, { action: "connect", server: srv.id });
        },
        closeSession(st, reason) {
            const bytes = this.sessionBytes(st);
            st.usage.bytes += bytes;
            st.history.unshift({ server: st.server, entry: st.entry, protocol: st.protocol, start: st.since, end: Date.now(), bytes, blocked: st.blocked || 0, reason: reason || "user" });
            st.connected = false;
            st.server = null;
            st.entry = null;
            st.since = 0;
        },
        disconnect(reason) {
            const cur = this.get();
            if (!cur || !cur.connected) return { ok: false };
            return this.mutate(st => { this.closeSession(st, reason); return { ok: true }; }, { action: "disconnect", reason: reason || "user" });
        },
        set(patch) {
            return this.mutate(st => {
                Object.keys(patch).forEach(k => { if (k in st) st[k] = patch[k]; });
            }, { action: "settings", keys: Object.keys(patch) });
        },
        toggleFavorite(id) {
            return this.mutate(st => {
                const i = st.favorites.indexOf(id);
                if (i >= 0) st.favorites.splice(i, 1); else st.favorites.push(id);
                return i < 0;
            }, { action: "favorite", id });
        },
        addBlocked(n) {
            // Счётчик NetShield сохраняем без события, чтобы не перерисовывать всё каждую секунду
            const s = Auth.get();
            if (!s) return;
            const map = this.readAll();
            if (!map[s.id] || !map[s.id].connected) return;
            map[s.id].blocked = (map[s.id].blocked || 0) + n;
            storage.setJSON(this.KEY, map);
        },
        ensureKeys() {
            const st = this.get();
            if (st && st.keys) return st.keys;
            const keys = { priv: randomKey(), pub: randomKey(), created: Date.now() };
            this.mutate(x => { x.keys = keys; }, { action: "keys" });
            return keys;
        },
        /* Лимит FREE исчерпан — отключаемся (проверка раз в минуту и при открытии страниц) */
        enforce() {
            const st = this.get();
            if (!st || !st.connected) return;
            const srv = this.find(st.server);
            if (this.quota(st).over) {
                this.disconnect("quota");
                Account.notify("system", "VPN отключён: лимит трафика", `${formatBytes(this.limits().vpnData)} на тарифе FREE в этом месяце. Безлимит — в NEXUS+`, { link: "plus", tone: "warn" });
            } else if (srv && !this.canUse(srv).ok) {
                this.disconnect("plan");
                toast(`VPN отключён: ${srv.city} доступен только с NEXUS+`, "warn", { ttl: 5000 });
            }
        }
    };

    /* NEXUS IDE: проекты пользователя (файлы — текст) */
    const IDEStore = {
        KEY: "nx_ide",
        readAll() {
            const m = storage.getJSON(this.KEY, {});
            return m && typeof m === "object" ? m : {};
        },
        normalize(d) {
            d = Object.assign({ projects: [], current: null, settings: {} }, d && typeof d === "object" ? d : {});
            if (!Array.isArray(d.projects)) d.projects = [];
            d.projects = d.projects.filter(p => p && p.id && p.files && typeof p.files === "object");
            d.settings = Object.assign({ fontSize: 14, tabSize: 2, autoRun: true, split: 46, consoleH: 32, explorer: true }, d.settings || {});
            if (d.current && !d.projects.some(p => p.id === d.current)) d.current = null;
            return d;
        },
        get() {
            const s = Auth.get();
            if (!s) return null;
            return this.normalize(this.readAll()[s.id]);
        },
        /* fn(data) — изменить; возвращает { ok } или { ok:false, error:"quota" } */
        mutate(fn, detail) {
            const s = Auth.get();
            if (!s) return { ok: false, error: "auth" };
            const map = this.readAll();
            const d = this.normalize(map[s.id]);
            const res = fn(d, s);
            map[s.id] = d;
            if (!storage.setJSON(this.KEY, map)) return { ok: false, error: "storage" };
            document.dispatchEvent(new CustomEvent("nexus:ide", { detail: detail || {} }));
            return Object.assign({ ok: true }, res && typeof res === "object" ? res : {});
        },
        drop(userId) {
            const map = this.readAll();
            if (map[userId]) { delete map[userId]; storage.setJSON(this.KEY, map); }
        },
        limits() { return serviceLimits(); },
        utf8Len(str) {
            let n = 0;
            for (let i = 0; i < str.length; i++) {
                const c = str.charCodeAt(i);
                n += c < 0x80 ? 1 : c < 0x800 ? 2 : (c >= 0xD800 && c <= 0xDBFF) ? (i++, 4) : 3;
            }
            return n;
        },
        projectSize(p) {
            return Object.keys(p.files).reduce((n, k) => n + this.utf8Len(k) + this.utf8Len(p.files[k] || ""), 0);
        },
        summary() {
            const d = this.get();
            if (!d) return null;
            const list = d.projects.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
            return { count: list.length, limit: this.limits().ideProjects, recent: list.slice(0, 3), last: list[0] || null };
        }
    };

    /* Индикатор VPN в строке статуса шапки (все страницы) */
    function updateVpnUI() {
        const el = document.getElementById("header-vpn");
        if (!el) return;
        const st = VPN.get();
        const srv = st && st.connected ? VPN.find(st.server) : null;
        el.hidden = !srv;
        if (!srv) return;
        const b = el.querySelector("b");
        if (b) b.textContent = srv.cc;
        const a = el.querySelector("a");
        if (a) a.title = `NEXUS VPN: ${srv.city}, ${srv.country}${st.entry ? " · Secure Core" : ""}`;
    }

    /* ================================================================
     * Данные сайта: контакты команды и уведомление о хранилище
     * ================================================================ */
    /* Каналы связи для страницы «Контакты». Пустые значения скрываются.
       email   — адрес поддержки (например, "support@example.org"), откроется почтовый клиент;
       discord — ссылка-приглашение https://discord.gg/…;
       telegram — ссылка https://t.me/…;
       github  — репозиторий: туда открываются баг-репорты (issues). */
    const SITE = {
        name: "NEXUS//DEV",
        privacyVersion: "1.0",
        contacts: {
            email: "",
            discord: "",
            telegram: "",
            github: "https://github.com/Stool12312356/123"
        }
    };

    /* Все ключи, которые сайт пишет в хранилище браузера (для политики и кнопки «удалить всё») */
    const STORAGE_KEYS = {
        local: ["nx_session", "nx_accounts", "nx_settings", "nx_custom_projects", "nx_hidden_projects", "nx_custom_categories", "nx_tickets", "nx_consent", "nx_pending_dl", "nx_vpn", "nx_ide", "nx_aquarium", "nx_abrams"],
        session: ["nx_booted", "nx_welcome"]
    };

    const SiteData = {
        /* Снимок всех данных сайта: [{ area, key, bytes, value }] */
        list() {
            const out = [];
            const scan = (area, store) => {
                try {
                    const keys = [];
                    for (let i = 0; i < store.length; i++) {
                        const k = store.key(i);
                        if (k && k.indexOf("nx_") === 0) keys.push(k);
                    }
                    keys.sort().forEach(k => {
                        const v = store.getItem(k) || "";
                        out.push({ area, key: k, bytes: (k.length + v.length) * 2, value: v });
                    });
                } catch (e) { /* хранилище недоступно */ }
            };
            try { scan("localStorage", window.localStorage); } catch (e) { /* ignore */ }
            try { scan("sessionStorage", window.sessionStorage); } catch (e) { /* ignore */ }
            return out;
        },
        exportJSON() {
            const data = { site: SITE.name, exported: new Date().toISOString(), localStorage: {}, sessionStorage: {} };
            this.list().forEach(r => {
                let v = r.value;
                try { v = JSON.parse(r.value); } catch (e) { /* строка */ }
                data[r.area][r.key] = v;
            });
            return data;
        },
        /* Удаляет все ключи nx_* (включая неизвестные будущие версии) */
        clearAll() {
            this.list().forEach(r => {
                try { (r.area === "localStorage" ? window.localStorage : window.sessionStorage).removeItem(r.key); } catch (e) { /* ignore */ }
            });
            Syslog.add("privacy: данные сайта удалены");
        }
    };

    /* Уведомление о хранилище (сайт не использует cookie; localStorage — функциональный) */
    const Consent = {
        KEY: "nx_consent",
        el: null,
        accepted() {
            const c = storage.getJSON(this.KEY, null);
            return !!(c && c.v === SITE.privacyVersion);
        },
        init() {
            if (this.accepted() || PAGE === "privacy") return;
            // На главной ждём окончания заставки, чтобы баннер не перекрывал загрузку
            document.addEventListener("nexus:ready", () => setTimeout(() => this.show(), 700), { once: true });
        },
        show() {
            if (this.el || this.accepted()) return;
            const el = document.createElement("section");
            el.className = "consent-banner";
            el.setAttribute("role", "region");
            el.setAttribute("aria-label", "Уведомление о хранении данных");
            el.setAttribute("augmented-ui", "tr-clip exe");
            el.innerHTML = `
                <div class="consent-icon" aria-hidden="true"><img src="assets/icons/disk.svg" alt="" width="22" height="22"></div>
                <div class="consent-text">
                    <p class="consent-title">Без cookie и трекеров</p>
                    <p>Настройки, вход и данные кабинета хранятся только в вашем браузере (localStorage) — мы их не получаем.
                        <a href="privacy.html">Подробнее</a></p>
                </div>
                <div class="consent-actions">
                    <button class="btn btn-sm btn-primary" type="button" data-consent-ok>Понятно</button>
                </div>`;
            document.body.appendChild(el);
            this.el = el;
            const sync = () => document.documentElement.style.setProperty("--consent-h", el.offsetHeight + 12 + "px");
            requestAnimationFrame(() => { el.classList.add("is-visible"); sync(); });
            window.addEventListener("resize", sync);
            this.onResize = sync;
            el.querySelector("[data-consent-ok]").addEventListener("click", () => this.accept());
        },
        accept() {
            storage.setJSON(this.KEY, { v: SITE.privacyVersion, date: Date.now() });
            this.hide();
            Sound.play("granted");
        },
        hide() {
            const el = this.el;
            if (!el) return;
            this.el = null;
            window.removeEventListener("resize", this.onResize);
            document.documentElement.style.removeProperty("--consent-h");
            el.classList.remove("is-visible");
            el.classList.add("is-hiding");
            setTimeout(() => el.remove(), reducedMotion() ? 0 : 260);
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
                <p>Нет — публичные релизы («Доступно для скачивания») качаются без входа. Аккаунт нужен для закрытых тестов и истории загрузок.</p>
                <h5>Какие бывают роли?</h5>
                <p><b>USER</b> — просмотр каталога и скачивание. <b>ADMIN</b> — ещё и dev-сборки, создание и редактирование проектов. <b>CREATOR</b> — владелец: все права, включая официальные проекты и разделы каталога. В демо роль меняется в кабинете или командой <kbd>role</kbd> в терминале.</p>
                <h5>Как попасть на закрытый тест?</h5>
                <p>Зарегистрируйтесь или нажмите DEMO ACCESS на странице входа — закрытые тесты доступны любой роли после входа.</p>
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
                    <li>Нашли баг — сообщите через страницу <a href="contacts.html#bug">«Контакты»</a>: это лучший способ помочь проекту.</li>
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
                const rm = /^role\s+(\S*)$/.exec(v);
                if (rm) {
                    const opts = ROLE_IDS.filter(id => id.indexOf(rm[1]) === 0);
                    if (opts.length === 1) this.input.value = "role " + opts[0];
                    else if (opts.length > 1) this.print(opts.join("  "));
                    return;
                }
                // Автодополнение названия темы: «theme na» → «theme navy»
                const tm = /^theme\s+(\S*)$/.exec(v);
                if (tm) {
                    const opts = Theme.list().filter(id => id.indexOf(tm[1]) === 0);
                    if (opts.length === 1) this.input.value = "theme " + opts[0];
                    else if (opts.length > 1) this.print(opts.join("  "));
                    return;
                }
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
                        "  role [user|admin|creator] — текущая роль / сменить роль (тест)",
                        "  create          — создать проект (ADMIN, CREATOR)",
                        "  balance         — баланс и последние операции",
                        "  topup <сумма>   — тестовое пополнение баланса, например: topup 500",
                        "  dashboard       — личный кабинет",
                        "  home            — главная страница",
                        "  privacy | contacts — политика конфиденциальности, контакты",
                        "  services        — тестовые сервисы в кабинете",
                        "  vpn [on|off|servers] — тестовый VPN, например: vpn on амстердам",
                        "  ide             — NEXUS IDE (редактор кода в браузере)",
                        "  404 [путь]      — проверить страницу 404, например: 404 wallet",
                        "  whoami          — текущий пользователь",
                        "  neofetch        — информация о системе браузера",
                        "  date, echo, history, clear",
                        "  sfx on|off      — звуки интерфейса eDEX-UI",
                        "  theme [name]    — список цветовых схем / сменить схему",
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
                    if (s) { this.print(`Вы уже вошли как ${s.callsign} (${ROLES[s.role].label}). Команда «dashboard» откроет кабинет.`); return; }
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
                role(args) {
                    const arg = (args[0] || "").toLowerCase();
                    const s = Auth.get();
                    if (!arg || arg === "list" || arg === "ls") {
                        const cur = s ? s.role : null;
                        this.printHtml(`Текущая роль: <span class="hl">${cur ? ROLES[cur].label : "GUEST"}</span>${cur ? " // " + escapeHtml(ROLES[cur].name) : " (не авторизован)"}`);
                        ROLE_IDS.forEach(id => {
                            this.print(`${id === cur ? "*" : " "} ${ROLES[id].label.padEnd(8)} ${ROLES[id].desc}`);
                        });
                        const allowed = PERMISSIONS.filter(x => Auth.can(x.id)).map(x => x.label.toLowerCase());
                        this.print(`Права сейчас: ${allowed.length ? allowed.join("; ") : "просмотр каталога и скачивание публичных релизов"}`);
                        this.printHtml('Сменить: <span class="hl">role user</span> · <span class="hl">role admin</span> · <span class="hl">role creator</span>');
                        return;
                    }
                    const res = switchRole(arg, { quiet: false });
                    if (!res.ok) {
                        this.print(`role: роль «${args[0]}» не существует. Доступны: user, admin, creator.`, "err");
                        Sound.play("denied");
                        return;
                    }
                    if (res.same) { this.print(`role: ${ROLES[res.role].label} уже активна.`); return; }
                    if (res.created) this.print("role: вы были гостем — создана демо-сессия demo_operator.");
                    this.print(`role: роль переключена на ${ROLES[res.role].label} // ${ROLES[res.role].name}. Интерфейс обновлён.`);
                },
                balance() {
                    const a = Account.get();
                    if (!a) { this.print("balance: войдите в аккаунт — команда login", "err"); return; }
                    const plan = PLANS[a.plan.id];
                    this.printHtml(`Баланс: <span class="hl">${escapeHtml(formatMoney(a.balance))}</span> · тариф ${escapeHtml(plan.label)}${a.plan.until ? " до " + escapeHtml(dateStr(new Date(a.plan.until))) : ""}`);
                    const last = a.tx.slice(0, 5);
                    if (!last.length) this.print("Операций пока нет. Пополнить: topup 500");
                    last.forEach(t => this.print(`  ${dateStr(new Date(t.date))}  ${formatMoney(t.amount, { sign: true }).padStart(12)}  ${t.status === "ok" ? "OK    " : "FAILED"}  ${t.title}`));
                    this.printHtml('Кошелёк: <a href="dashboard.html#wallet">dashboard.html#wallet</a>');
                },
                topup(args) {
                    if (!Auth.get()) { this.print("topup: войдите в аккаунт — команда login", "err"); Sound.play("denied"); return; }
                    const rub = parseFloat(String(args[0] || "").replace(",", "."));
                    if (!Number.isFinite(rub)) { this.print("topup: укажите сумму в рублях, например: topup 500", "err"); return; }
                    const res = Account.topup(Math.round(rub * 100), "Тестовый платёж · терминал");
                    if (!res.ok) { this.print(`topup: ${res.text}`, "err"); Sound.play("denied"); return; }
                    Sound.play("granted");
                    this.printHtml(`topup: зачислено <span class="hl">${escapeHtml(formatMoney(res.tx.amount + res.bonus))}</span>${res.bonus ? ` (в т.ч. бонус ${escapeHtml(formatMoney(res.bonus))})` : ""}. Баланс: ${escapeHtml(formatMoney(res.balance))}`);
                    toast(`Баланс пополнен на ${formatMoney(res.tx.amount + res.bonus)}`, "ok");
                },
                create() {
                    if (!Auth.can("create")) {
                        this.print("create: нужна роль ADMIN или CREATOR. Подсказка: role admin", "err");
                        Sound.play("denied");
                        return;
                    }
                    if (PAGE === "projects" && window.NEXUS.Pages && window.NEXUS.Pages.openEditor) {
                        this.print("Открываю конструктор проекта…");
                        this.close();
                        window.NEXUS.Pages.openEditor();
                        return;
                    }
                    go("projects.html#new", "Открываю конструктор проекта в центре загрузок…");
                },
                home() { go("index.html", "Возвращаюсь на главную…"); },
                privacy() { go("privacy.html", "Открываю политику конфиденциальности…"); },
                contacts() { go("contacts.html", "Открываю контакты…"); },
                // Тестовый VPN: «vpn» — статус, «vpn on [город|код]», «vpn off», «vpn servers»
                vpn(args) {
                    const sub = (args[0] || "status").toLowerCase();
                    if (!Auth.get()) { this.print("vpn: сервисы доступны после входа. Введите «login».", "err"); return; }
                    const st = VPN.get();
                    if (sub === "status") {
                        const srv = st.connected ? VPN.find(st.server) : null;
                        if (!srv) { this.print("NEXUS VPN: отключено · не защищено"); }
                        else {
                            this.print(`NEXUS VPN: подключено · ${srv.city}, ${srv.country} (${srv.cc})${st.entry ? " через Secure Core " + VPN.find(st.entry).city : ""}`);
                            this.print(`  протокол ${VPN_PROTOCOLS[st.protocol].label} · IP ${VPN.exitIp(srv, st)} · аптайм ${formatDuration(Date.now() - st.since)}`);
                        }
                        const q = VPN.quota(st);
                        this.print(`  трафик за месяц: ${formatBytes(q.used)} из ${formatBytes(q.limit)}`);
                        this.printHtml('Клиент: <a href="vpn.html">vpn.html</a> · команды: <span class="hl">vpn on [город]</span>, <span class="hl">vpn off</span>, <span class="hl">vpn servers</span>');
                        return;
                    }
                    if (sub === "servers" || sub === "ls") {
                        this.print("CODE  ГОРОД            LOAD  PING   ДОСТУП");
                        VPN_SERVERS.forEach(s => {
                            const ok = VPN.canUse(s).ok;
                            this.print(`${s.cc.padEnd(5)} ${s.city.padEnd(16)} ${String(VPN.load(s)).padStart(3)}%  ${String(VPN.ping(s)).padStart(3)}ms  ${ok ? "открыт" : "NEXUS+"}`);
                        });
                        return;
                    }
                    if (sub === "off" || sub === "disconnect") {
                        if (!st.connected) { this.print("vpn: уже отключено"); return; }
                        VPN.disconnect("terminal");
                        Sound.play("panels");
                        this.print("NEXUS VPN: туннель закрыт");
                        return;
                    }
                    if (sub === "on" || sub === "connect") {
                        const q = (args.slice(1).join(" ") || "").toLowerCase();
                        let srv = null;
                        if (q) {
                            srv = VPN_SERVERS.find(s => s.id === q || s.cc.toLowerCase() === q || s.city.toLowerCase().indexOf(q) === 0 || s.country.toLowerCase().indexOf(q) === 0);
                            if (!srv) { this.print(`vpn: сервер «${q}» не найден. Список: vpn servers`, "err"); return; }
                        }
                        const res = VPN.connect(srv ? srv.id : null);
                        if (!res || !res.ok) { this.print(`vpn: ${res ? res.text : "ошибка"}`, "err"); Sound.play("denied"); return; }
                        Sound.play("granted");
                        this.print(`NEXUS VPN: подключено · ${res.server.city}, ${res.server.country} · ${VPN_PROTOCOLS[VPN.get().protocol].label}`);
                        return;
                    }
                    this.print("vpn: неизвестная команда. Используйте: vpn [status|on [город]|off|servers]", "err");
                },
                ide() { go("ide.html", "Запускаю NEXUS IDE…"); },
                services() { go("dashboard.html#services", "Открываю сервисы в кабинете…"); },
                // Проверка страницы 404: «404» — случайный несуществующий адрес, «404 wallet» — свой путь
                "404"(args) {
                    let target = args.join("-").replace(/^\/+/, "").replace(/[\s]+/g, "-");
                    if (!target) target = "nx-test-" + Math.random().toString(36).slice(2, 7);
                    if (window.location.protocol === "file:") {
                        this.print("file:// — сервера нет, открываю 404.html напрямую с параметром ?path=");
                        go("404.html?path=" + encodeURIComponent("/" + target), `Переход: /${target} …`);
                        return;
                    }
                    // document.baseURI учитывает <base> на самой 404 и подпапку сайта
                    const url = new URL(target, document.baseURI);
                    this.print("Запрашиваю несуществующий адрес — сервер должен ответить страницей 404.html.");
                    this.printHtml('Если вместо неё пустая ошибка сервера, настройте его (README → «Публикация») или откройте <a href="404.html">404.html</a>.');
                    go(url.href, `GET ${url.pathname} …`);
                },
                whoami() {
                    const s = Auth.get();
                    this.print(s ? `${s.callsign} · ${s.id} · ${ROLES[s.role].label} // ${ROLES[s.role].name}` : "guest (не авторизован)");
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
                        `Role: ${s ? ROLES[s.role].label : "GUEST"}`,
                        `Theme: ${Theme.current()} (eDEX-UI)`,
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
                theme(args) {
                    const arg = (args[0] || "").toLowerCase();
                    const cur = Theme.current();
                    if (!arg || arg === "list" || arg === "ls") {
                        this.print(`Цветовые схемы eDEX-UI: ${Theme.list().length} · текущая: ${cur}`);
                        Theme.list().forEach(id => {
                            const t = THEMES[id];
                            const sw = [`rgb(${t.r}, ${t.g}, ${t.b})`, t.light_black, t.grey, t.term.fg]
                                .map(c => `<span class="term-swatch" style="background:${c}"></span>`).join("");
                            const mark = id === cur ? "*" : " ";
                            this.printHtml(`${mark} ${sw} <span class="${id === cur ? "hl" : ""}">${escapeHtml(id)}</span>${" ".repeat(Math.max(1, 22 - id.length))} ${escapeHtml(t.variant || t.desc)}`);
                        });
                        this.printHtml('Переключить: <span class="hl">theme &lt;название&gt;</span> (например: theme matrix) · по умолчанию: <span class="hl">theme reset</span>');
                        return;
                    }
                    const id = (arg === "reset" || arg === "default") ? Theme.DEFAULT : Theme.resolve(args.join("-"));
                    if (!id) {
                        const hints = Theme.suggest(arg);
                        this.print(`theme: схема «${args.join(" ")}» не найдена.${hints.length ? " Возможно: " + hints.join(", ") + "." : ""} Список — «theme».`, "err");
                        Sound.play("denied");
                        return;
                    }
                    if (id === cur) { this.print(`theme: ${THEMES[id].label} уже активна.`); return; }
                    Theme.set(id);
                    this.print(`theme: переключено на ${THEMES[id].label} (${id}). Сохранено для всех страниц.`);
                    toast(`Тема интерфейса: ${THEMES[id].label}`, "ok");
                },
                credits() {
                    this.printHtml('UI inspired by &amp; adapted from <a href="https://github.com/GitSquared/edex-ui" target="_blank" rel="noopener noreferrer">eDEX-UI</a> (GPL-3.0) by Gabriel “Squared” Saillard.');
                    this.printHtml('Рамки: augmented-ui 1.1.2 (BSD-2-Clause). Лицензия сайта: <a href="LICENSE">GPL-3.0</a>.');
                },
                sudo() {
                    if (Auth.role() === "creator") { this.print("sudo: вы и так CREATOR — у вас все права."); return; }
                    this.print(`${Auth.get() ? Auth.get().callsign : "guest"} is not in the sudoers file. This incident will be reported.`, "err");
                    Sound.play("denied");
                },
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
            if (!reducedMotion() && !document.body.classList.contains("is-booting") && !document.hidden) {
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
    function initRoleSwitches() {
        document.addEventListener("click", e => {
            const b = e.target.closest("[data-set-role]");
            if (!b) return;
            switchRole(b.getAttribute("data-set-role"));
        });
    }

    function init() {
        Settings.apply();
        initRoleSwitches();
        initSoundToggle();
        updateUserUI();
        initClock();
        initSysinfo();
        Syslog.init();
        initNetwork();
        initSummary();
        initCpu();
        initRam();
        initNodeBars();
        initQuickTheme();
        initToplist();
        initRadar();
        Tabs.init();
        Terminal.init();
        Docs.init();
        Consent.init();
        initNav();
        observeReveal();
        initGlitch();

        setInterval(tickTelemetry, 2000);
        Account.checkRenewal();
        setInterval(() => Account.checkRenewal(), 60000);
        // VPN: индикатор в шапке и контроль лимита FREE / доступа к серверам
        updateVpnUI();
        VPN.enforce();
        setInterval(() => VPN.enforce(), 60000);
        document.addEventListener("nexus:auth", updateVpnUI);
        document.addEventListener("nexus:account", () => { updateVpnUI(); });
        // Новый проект в каталоге → уведомление о релизе
        document.addEventListener("nexus:catalog", e => {
            if (!e.detail || e.detail.action !== "create" || !Auth.get()) return;
            const p = PROJECTS.find(x => x.id === e.detail.id);
            if (p) Account.notify("release", `Новый проект: ${p.title}`, `${STATUSES[p.status].label} · ${p.version}`, { link: "projects.html#" + p.id, toast: false });
        });

        // Синхронизация входа/выхода и настроек между вкладками браузера
        window.addEventListener("storage", e => {
            if (e.key === Auth.KEY) updateUserUI();
            if (e.key === Account.KEY) Account.emit({ action: "sync" });
            if (e.key === Settings.KEY) { Settings.load(); Settings.apply(); Sound.syncUI(); }
            if (e.key === Consent.KEY && Consent.accepted()) Consent.hide();
            if (e.key === VPN.KEY || e.key === Auth.KEY) VPN.emit({ action: "sync" });
            if (e.key === IDEStore.KEY) document.dispatchEvent(new CustomEvent("nexus:ide", { detail: { action: "sync" } }));
            if (e.key === Catalog.KEY || e.key === Catalog.HIDDEN_KEY || e.key === Catalog.CAT_KEY) {
                Catalog.load();
                applyPermissions();
                Catalog.emit("sync");
            }
        });

        if (shouldBoot()) {
            Boot.run().then(revealUI);
        } else {
            document.documentElement.classList.remove("boot-pending");
            revealUI();
        }
    }

    /* Публичное API для js/pages.js */
    window.NEXUS = {
        PAGE, $, $$, clamp, rand, randInt, pick, pad, delay, escapeHtml, timeStr, dateStr, hashString, rgba,
        storage, Settings, Sound, Auth, Account, VPN, IDEStore, SERVICE_LIMITS, serviceTier, serviceLimits, formatBytes, formatDuration, monthKey, SITE, STORAGE_KEYS, SiteData, Consent, PLANS, PROMO_CODES, TEST_CARDS, WALLET_LIMITS, FUNDING,
        formatMoney, cardBrand, luhnOk, topupBonus, deviceName, uid, detectOS, detectBrowser, ROLES, ROLE_IDS, PERMISSIONS, ACCESS, ACCESS_CODES, switchRole, applyPermissions,
        Catalog, BUILTIN_PROJECTS, BASE_CATEGORIES, PROJECT_ICONS, formatMiB, dateISO, toast, showBanner, Modal, Tabs, Syslog, Terminal,
        SERVERS, Telemetry, statusBadge, formatPlayers, PROJECTS, CATEGORIES, STATUSES, Docs,
        observeReveal, reducedMotion, copyText, updateUserUI, NICKS, THEMES, Theme
    };

    init();
})();
