/*
 * ide-pro.js — расширенные возможности NEXUS IDE (идеи Zed / VS Code)
 * ------------------------------------------------------------------
 * Подключается после js/services.js только на ide.html и работает через
 * window.NEXUS.IDEApp (хуки ядра редактора). Всё выполняется локально:
 *  - палитра команд (Ctrl+Shift+P / F1) и быстрый переход (Ctrl+P: файлы, :строка, @символ, >команда);
 *  - панели: проводник, поиск и замена по проекту, Git (локальные коммиты, diff, откат), структура,
 *    расширения, ассистент; хлебные крошки и мини-карта;
 *  - автодополнение, сниппеты, Emmet, форматирование, подсветка парных скобок и совпадений,
 *    направляющие отступов, диагностика (линтер), перенос строк, режим Vim, дзен-режим;
 *  - встроенный терминал (ls, cat, touch, mv, grep, node, git …), вкладка «Проблемы»;
 *  - превью в размерах устройств и в отдельной вкладке, ссылка «Поделиться» без сервера.
 * То, что невозможно в браузере без сервера (ИИ-модель, совместная работа, push/pull,
 * установка расширений), оставлено декоративными кнопками с пояснением.
 * ------------------------------------------------------------------
 */
(function () {
    "use strict";

    const NX = window.NEXUS;
    if (!NX || NX.PAGE !== "ide") return;
    const { $, $$, clamp, escapeHtml, toast, Modal, Sound, copyText, formatBytes, IDEStore, serviceTier, timeStr, Auth } = NX;
    const esc = escapeHtml;

    /* ================================================================
     * Словари: автодополнение, сниппеты, расширения, объяснения ошибок
     * ================================================================ */
    const JS_KEYWORDS = "async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield".split(" ");
    const JS_GLOBALS = "Array Boolean Date Error JSON Map Math Number Object Promise Proxy Reflect RegExp Set String Symbol WeakMap console document window localStorage sessionStorage navigator location history fetch setTimeout setInterval clearTimeout clearInterval requestAnimationFrame cancelAnimationFrame alert confirm prompt parseInt parseFloat isNaN structuredClone queueMicrotask performance crypto Intl URL URLSearchParams Blob File FileReader CustomEvent Event KeyboardEvent MouseEvent HTMLElement Element Node NodeList Image Audio AudioContext Worker".split(" ");
    const JS_MEMBERS = {
        console: "log info warn error debug table clear group groupEnd time timeEnd count assert dir trace",
        document: "getElementById querySelector querySelectorAll createElement createTextNode createDocumentFragment addEventListener removeEventListener body head title documentElement activeElement cookie forms images links readyState visibilityState",
        Math: "abs ceil floor round trunc sign sqrt cbrt pow exp log log2 log10 min max random sin cos tan atan atan2 hypot PI E clamp",
        JSON: "parse stringify",
        Object: "keys values entries assign freeze create fromEntries defineProperty getPrototypeOf",
        Array: "from isArray of",
        Promise: "all allSettled any race resolve reject",
        Number: "isInteger isFinite parseFloat parseInt EPSILON MAX_SAFE_INTEGER",
        localStorage: "getItem setItem removeItem clear key length",
        window: "addEventListener innerWidth innerHeight scrollTo scrollY open location matchMedia devicePixelRatio",
        "*": "length push pop shift unshift slice splice concat join reverse sort map filter reduce forEach find findIndex some every includes indexOf flat flatMap at fill keys values entries split trim trimStart trimEnd toUpperCase toLowerCase startsWith endsWith replace replaceAll padStart padEnd repeat charAt toFixed toString then catch finally addEventListener removeEventListener appendChild append prepend remove replaceWith insertAdjacentHTML setAttribute getAttribute removeAttribute hasAttribute classList toggle add contains style textContent innerHTML innerText value checked disabled dataset closest matches focus blur click children parentElement nextElementSibling previousElementSibling getContext getBoundingClientRect offsetWidth offsetHeight scrollIntoView fillRect strokeRect clearRect beginPath moveTo lineTo arc fill stroke fillText fillStyle strokeStyle lineWidth font"
    };
    const CSS_PROPS = "align-items align-content align-self animation animation-delay animation-duration aspect-ratio backdrop-filter background background-color background-image background-position background-size border border-bottom border-color border-left border-radius border-right border-top border-width bottom box-shadow box-sizing color column-gap content cursor display filter flex flex-basis flex-direction flex-grow flex-shrink flex-wrap font font-family font-size font-style font-weight gap grid grid-area grid-column grid-row grid-template-areas grid-template-columns grid-template-rows height inset justify-content justify-items justify-self left letter-spacing line-height list-style margin margin-bottom margin-inline margin-left margin-right margin-top max-height max-width min-height min-width mix-blend-mode object-fit opacity outline outline-offset overflow overflow-x overflow-y padding padding-block padding-bottom padding-inline padding-left padding-right padding-top place-items pointer-events position right row-gap scroll-behavior text-align text-decoration text-shadow text-transform top transform transform-origin transition transition-duration user-select vertical-align visibility white-space width will-change word-break z-index".split(" ");
    const CSS_VALUES = "auto none block inline inline-block flex inline-flex grid inline-grid contents hidden visible absolute relative fixed sticky static center start end flex-start flex-end space-between space-around space-evenly stretch baseline column row wrap nowrap bold normal italic uppercase lowercase pointer default solid dashed dotted transparent currentColor inherit initial unset cover contain repeat no-repeat ease ease-in ease-out ease-in-out linear infinite alternate forwards both border-box content-box 100% 100vh 100vw 1fr min-content max-content fit-content".split(" ");
    const HTML_TAGS = "a abbr article aside audio b blockquote body br button canvas caption code dd details dialog div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hr html i iframe img input label legend li link main mark meta nav noscript ol optgroup option p picture pre progress q script section select small source span strong style sub summary sup svg table tbody td template textarea tfoot th thead time title tr u ul video".split(" ");
    const HTML_ATTRS = "class id style href src alt title type name value placeholder for rel target width height lang charset content disabled checked selected required readonly hidden tabindex role aria-label aria-hidden data- onclick action method autocomplete loading defer async".split(" ");
    const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));

    /* Сниппеты: $1 — место курсора после вставки */
    const SNIPPETS = {
        js: [
            ["log", "console.log($1);", "console.log()"],
            ["warn", "console.warn($1);", "console.warn()"],
            ["fn", "function $1() {\n  \n}", "function name() {}"],
            ["afn", "($1) => {\n  \n}", "стрелочная функция"],
            ["for", "for (let i = 0; i < $1; i++) {\n  \n}", "цикл for"],
            ["forof", "for (const item of $1) {\n  \n}", "цикл for…of"],
            ["fore", "$1.forEach((item) => {\n  \n});", "массив.forEach"],
            ["if", "if ($1) {\n  \n}", "условие if"],
            ["ife", "if ($1) {\n  \n} else {\n  \n}", "if … else"],
            ["try", "try {\n  $1\n} catch (err) {\n  console.error(err);\n}", "try … catch"],
            ["qs", "document.querySelector(\"$1\")", "querySelector"],
            ["qsa", "document.querySelectorAll(\"$1\")", "querySelectorAll"],
            ["gid", "document.getElementById(\"$1\")", "getElementById"],
            ["ael", "addEventListener(\"$1\", (e) => {\n  \n});", "addEventListener"],
            ["cls", "class $1 {\n  constructor() {\n    \n  }\n}", "класс"],
            ["timeout", "setTimeout(() => {\n  $1\n}, 1000);", "setTimeout"],
            ["interval", "setInterval(() => {\n  $1\n}, 1000);", "setInterval"],
            ["fetch", "fetch(\"$1\")\n  .then((r) => r.json())\n  .then((data) => console.log(data))\n  .catch(console.error);", "fetch + json"],
            ["raf", "function loop(t) {\n  $1\n  requestAnimationFrame(loop);\n}\nrequestAnimationFrame(loop);", "цикл анимации"],
            ["iife", "(() => {\n  $1\n})();", "IIFE"]
        ],
        css: [
            ["flexc", "display: flex;\nalign-items: center;\njustify-content: center;$1", "flex по центру"],
            ["gridc", "display: grid;\nplace-items: center;$1", "grid по центру"],
            ["media", "@media (max-width: $1px) {\n  \n}", "@media"],
            ["kf", "@keyframes $1 {\n  from {  }\n  to {  }\n}", "@keyframes"],
            ["abs", "position: absolute;\ninset: 0;$1", "absolute на весь блок"],
            ["tr", "transition: $1 0.2s ease;", "transition"]
        ],
        html: [
            ["!", null, "HTML-заготовка (Emmet)"],
            ["link:css", "<link rel=\"stylesheet\" href=\"$1style.css\">", "подключить CSS"],
            ["script:src", "<script src=\"$1app.js\"></script>", "подключить JS"],
            ["btn", "<button type=\"button\">$1</button>", "кнопка"],
            ["inp", "<input type=\"text\" id=\"$1\" placeholder=\"\">", "поле ввода"]
        ]
    };

    /* Объяснения частых ошибок (офлайн-помощник) */
    const ERROR_HINTS = [
        [/(\w+) is not defined/, (m) => `Переменная или функция «${m[1]}» не объявлена. Проверьте опечатку, порядок подключения скриптов или объявите её через const / let / function.`],
        [/Cannot read propert(?:y|ies) of (null|undefined)(?: \(reading '([^']+)'\))?/, (m) => `Вы обращаетесь к свойству${m[2] ? ` «${m[2]}»` : ""} у значения ${m[1]}. Чаще всего элемент не найден: querySelector / getElementById вернул null (неверный селектор или скрипт выполняется до разметки — подключите его в конце body или с defer).`],
        [/Cannot set propert(?:y|ies) of (null|undefined)/, () => "Присваивание свойству у null / undefined. Убедитесь, что объект или элемент существует до записи."],
        [/(\S+) is not a function/, (m) => `«${m[1]}» — не функция. Возможно, опечатка в названии метода, метод вызывается не у того объекта или переменная перезаписана.`],
        [/Assignment to constant variable/, () => "Значение константы (const) нельзя изменить. Используйте let, если переменная должна меняться."],
        [/Unexpected token/, () => "Синтаксическая ошибка: лишний или пропущенный символ. Проверьте скобки, запятые и кавычки рядом с указанной строкой."],
        [/Unexpected end of input/, () => "Код оборвался: не закрыта скобка, кавычка или комментарий."],
        [/Identifier '(\w+)' has already been declared/, (m) => `Имя «${m[1]}» объявлено дважды. Переименуйте одну из переменных или уберите повторный let / const.`],
        [/Maximum call stack size exceeded/, () => "Бесконечная рекурсия: функция вызывает сама себя без условия выхода."],
        [/Цикл выполнялся дольше/, () => "Цикл не завершается: проверьте условие и изменение счётчика."],
        [/Invalid or unexpected token/, () => "Недопустимый символ в коде — часто это незакрытая строка или «умные» кавычки."],
        [/JSON/, () => "Ошибка разбора JSON: ключи и строки должны быть в двойных кавычках, без лишних запятых в конце."]
    ];

    /* Каталог расширений: kind "setting" — переключает реальную настройку,
       "builtin" — встроено и всегда активно, "remote" — декоративное (нужна установка с сервера) */
    const EXTENSIONS = [
        { id: "emmet", name: "Emmet", by: "emmetio", kind: "setting", key: "emmet", icon: "code", desc: "Сокращения HTML: div.card>p*3, ! и Tab" },
        { id: "prettier", name: "Prettier · Format on Save", by: "NEXUS", kind: "setting", key: "formatOnSave", icon: "edit", desc: "Форматировать файл при Ctrl+S" },
        { id: "vim", name: "Vim Mode", by: "zed-industries", kind: "setting", key: "vim", icon: "terminal", desc: "Режимы NORMAL / INSERT / VISUAL, hjkl, dd, yy, p" },
        { id: "minimap", name: "Minimap", by: "NEXUS", kind: "setting", key: "minimap", icon: "outline", desc: "Мини-карта файла справа от кода" },
        { id: "guides", name: "Indent Guides", by: "NEXUS", kind: "setting", key: "indentGuides", icon: "outline", desc: "Вертикальные направляющие отступов" },
        { id: "lint", name: "NEXUS Lint", by: "NEXUS", kind: "setting", key: "lint", icon: "bug", desc: "Скобки, теги, JSON и синтаксис JS на лету" },
        { id: "complete", name: "IntelliSense Lite", by: "NEXUS", kind: "setting", key: "autocomplete", icon: "lightning", desc: "Автодополнение и сниппеты" },
        { id: "occ", name: "Highlight Occurrences", by: "NEXUS", kind: "setting", key: "occurrences", icon: "search", desc: "Подсветка совпадений слова под курсором" },
        { id: "live", name: "Live Preview", by: "NEXUS", kind: "builtin", icon: "play", desc: "Превью в изолированном фрейме с консолью" },
        { id: "git", name: "Git (local)", by: "NEXUS", kind: "builtin", icon: "git", desc: "Коммиты, diff и откат внутри проекта" },
        { id: "copilot", name: "Zed AI / Copilot", by: "AI", kind: "remote", icon: "sparkle", desc: "Нужен сервер языковой модели и API-ключ" },
        { id: "python", name: "Python", by: "ms-python", kind: "remote", icon: "terminal", desc: "Нужен интерпретатор Python на компьютере" },
        { id: "rust", name: "rust-analyzer", by: "rust-lang", kind: "remote", icon: "config", desc: "Нужен языковой сервер и Cargo" },
        { id: "docker", name: "Docker", by: "docker", kind: "remote", icon: "docker", desc: "Нужен Docker Engine" },
        { id: "remote", name: "Remote SSH", by: "zed-industries", kind: "remote", icon: "shell", desc: "Нужен доступ к серверу по SSH" },
        { id: "collab", name: "Channels & Calls", by: "zed-industries", kind: "remote", icon: "users", desc: "Совместное редактирование — нужен сервер" }
    ];

    const DEFAULTS = {
        wordWrap: false, minimap: true, indentGuides: true, autocomplete: true, emmet: true, formatOnSave: false,
        vim: false, occurrences: true, lint: true, side: "explorer", btab: "console", device: "auto", recent: []
    };

    /* ================================================================
     * Запуск после готовности ядра
     * ================================================================ */
    function boot(A) {
        const ide = A.ide, el = A.el, ta = el.ta;
        const S = () => {
            const s = A.settings();
            if (s.side === undefined || s.recent === undefined) Object.keys(DEFAULTS).forEach(k => { if (s[k] === undefined) s[k] = Array.isArray(DEFAULTS[k]) ? DEFAULTS[k].slice() : DEFAULTS[k]; });
            return s;
        };
        Object.keys(DEFAULTS).forEach(k => { if (S()[k] === undefined) S()[k] = Array.isArray(DEFAULTS[k]) ? [] : DEFAULTS[k]; });
        const ideRoot = $("#ide");
        const P = () => ide.p;
        const files = () => (ide.p ? Object.keys(ide.p.files).sort() : []);
        const appVisible = () => !$("#ide-app").hidden;
        const modalOpen = () => !!document.querySelector(".modal_popup");
        const mobile = () => window.innerWidth < 768;
        const icon = (name, size) => `<img src="assets/icons/${name}.svg" alt="" width="${size || 14}" height="${size || 14}">`;
        function lineCol(text, pos) {
            const before = text.slice(0, pos);
            const nl = before.lastIndexOf("\n");
            return { line: before.split("\n").length, col: pos - nl - 1 };
        }
        function posOf(text, line, col) {
            let pos = 0;
            for (let i = 1; i < line; i++) {
                const n = text.indexOf("\n", pos);
                if (n < 0) return text.length;
                pos = n + 1;
            }
            const end = text.indexOf("\n", pos);
            return Math.min(pos + (col || 0), end < 0 ? text.length : end);
        }
        function wordAt(text, pos) {
            let s = pos, e = pos;
            while (s > 0 && /[\w$]/.test(text[s - 1])) s--;
            while (e < text.length && /[\w$]/.test(text[e])) e++;
            return { start: s, end: e, word: text.slice(s, e) };
        }
        const reEsc = s => s.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

        /* Нечёткий поиск (как в Zed: подряд идущие символы и начала слов ценятся выше) */
        function fuzzy(q, str) {
            if (!q) return { score: 0, idx: [] };
            const ql = q.toLowerCase(), t = str.toLowerCase();
            let i = 0, score = 0, last = -2;
            const idx = [];
            for (let j = 0; j < t.length && i < ql.length; j++) {
                if (t[j] === ql[i]) {
                    idx.push(j);
                    score += (last === j - 1 ? 6 : 1) + (j === 0 || /[\/._\- :]/.test(t[j - 1]) ? 5 : 0);
                    last = j;
                    i++;
                }
            }
            if (i < ql.length) return null;
            if (t.indexOf(ql) >= 0) score += 12;
            return { score: score - t.length * 0.04, idx };
        }
        function marked(str, idx) {
            if (!idx || !idx.length) return esc(str);
            let out = "", k = 0;
            for (let j = 0; j < str.length; j++) {
                const c = esc(str[j]);
                if (idx[k] === j) { out += "<b>" + c + "</b>"; k++; } else out += c;
            }
            return out;
        }

        /* ================================================================
         * Разметка: встраиваем элементы в существующий каркас ide.html
         * ================================================================ */
        const body = el.body;

        // Центральная кнопка «командного центра» (как поиск в заголовке Zed)
        const cmdBtn = document.createElement("button");
        cmdBtn.type = "button";
        cmdBtn.className = "ide-cmd";
        cmdBtn.id = "ide-cmd";
        cmdBtn.title = "Быстрый переход: файлы, :строка, @символ, >команда (Ctrl+P)";
        cmdBtn.innerHTML = `${icon("search")}<span class="ide-cmd-text">Файлы, символы и команды…</span><kbd>Ctrl P</kbd>`;
        $(".ide-toolbar").insertBefore(cmdBtn, $(".ide-tb-run"));

        // Поделиться + соавторы (соавторы — декоративно)
        const shareWrap = document.createElement("span");
        shareWrap.className = "ide-collab";
        const me = (Auth.get() || {}).callsign || "you";
        shareWrap.innerHTML = `<span class="ide-avatar" title="Вы: ${esc(me)}">${esc(me.slice(0, 1).toUpperCase())}</span>
            <button class="ide-tool hide-sm" type="button" id="ide-collab" title="Пригласить соавтора — совместная работа недоступна в тестовой версии">${icon("users", 16)}<span class="visually-hidden">Пригласить соавтора</span></button>
            <button class="ide-tool" type="button" id="ide-share" title="Поделиться проектом ссылкой">${icon("share", 16)}<span class="visually-hidden">Поделиться</span></button>`;
        $(".ide-tb-run").insertBefore(shareWrap, $("#ide-download"));

        // Панель активности слева
        const activity = document.createElement("nav");
        activity.className = "ide-activity";
        activity.id = "ide-activity";
        activity.setAttribute("aria-label", "Боковые панели");
        const SIDES = [
            ["explorer", "folder", "Проводник (Ctrl+Shift+E)"],
            ["search", "search", "Поиск по проекту (Ctrl+Shift+F)"],
            ["git", "git", "Git: изменения и история (Ctrl+Shift+G)"],
            ["outline", "outline", "Структура файла (Ctrl+Shift+O)"],
            ["ext", "puzzle", "Расширения (Ctrl+Shift+X)"],
            ["ai", "sparkle", "Ассистент"]
        ];
        activity.innerHTML = SIDES.map(([id, ic, t]) => `<button type="button" data-side="${id}" title="${t}" aria-label="${t}" aria-pressed="false">${icon(ic, 18)}${id === "git" ? '<b class="ide-act-badge" id="ide-git-badge" hidden>0</b>' : ""}</button>`).join("")
            + `<span class="ide-act-spacer"></span>
               <button type="button" data-act="palette" title="Палитра команд (Ctrl+Shift+P)" aria-label="Палитра команд">${icon("command", 18)}</button>
               <button type="button" data-act="zen" title="Дзен-режим (Ctrl+K Z)" aria-label="Дзен-режим">${icon("zen", 18)}</button>`;
        body.insertBefore(activity, body.firstChild);

        // Боковые панели: существующий проводник + новые
        const side = el.explorer;
        const explorerPanel = document.createElement("div");
        explorerPanel.className = "ide-sidepanel";
        explorerPanel.dataset.panel = "explorer";
        while (side.firstChild) explorerPanel.appendChild(side.firstChild);
        side.appendChild(explorerPanel);
        side.setAttribute("aria-label", "Боковая панель");
        const panels = { explorer: explorerPanel };
        function addPanel(id, title, html, tools) {
            const d = document.createElement("div");
            d.className = "ide-sidepanel";
            d.dataset.panel = id;
            d.hidden = true;
            d.innerHTML = `<div class="ide-pane-head"><span>${title}</span><span class="ide-pane-tools">${tools || ""}</span></div>${html}`;
            side.appendChild(d);
            panels[id] = d;
            return d;
        }
        addPanel("search", "SEARCH", `
            <form class="ide-ps-form" id="ide-ps-form" autocomplete="off">
                <div class="ide-ps-row">
                    <label class="visually-hidden" for="ide-ps-input">Найти в проекте</label>
                    <input class="input input-sm" id="ide-ps-input" type="search" placeholder="Найти в проекте" spellcheck="false">
                    <span class="ide-ps-opts" role="group" aria-label="Параметры поиска">
                        <button type="button" data-opt="case" title="Учитывать регистр" aria-pressed="false">Aa</button>
                        <button type="button" data-opt="word" title="Слово целиком" aria-pressed="false">ab</button>
                        <button type="button" data-opt="regex" title="Регулярное выражение" aria-pressed="false">.*</button>
                    </span>
                </div>
                <div class="ide-ps-row">
                    <label class="visually-hidden" for="ide-ps-replace">Заменить на</label>
                    <input class="input input-sm" id="ide-ps-replace" type="text" placeholder="Заменить на" spellcheck="false">
                    <button class="ide-tool ide-tool-sm" type="button" id="ide-ps-replace-all" title="Заменить во всех файлах">⇄</button>
                </div>
                <label class="visually-hidden" for="ide-ps-include">Файлы</label>
                <input class="input input-sm" id="ide-ps-include" type="text" placeholder="файлы: *.js, css/" spellcheck="false">
            </form>
            <p class="ide-ps-summary" id="ide-ps-summary">Введите запрос — поиск идёт по всем файлам проекта</p>
            <ul class="ide-ps-results" id="ide-ps-results"></ul>`,
            `<button class="ide-tool ide-tool-sm" type="button" id="ide-ps-collapse" title="Свернуть все результаты">−</button>`);
        addPanel("git", `SOURCE CONTROL <i id="ide-git-branch">⎇ main</i>`, `
            <div class="ide-git-commit">
                <label class="visually-hidden" for="ide-git-msg">Сообщение коммита</label>
                <textarea class="input" id="ide-git-msg" rows="2" placeholder="Сообщение коммита (Ctrl+Enter)" spellcheck="false"></textarea>
                <button class="btn btn-sm btn-primary" type="button" id="ide-git-commit">${icon("checkmark")}Commit</button>
            </div>
            <p class="ide-side-label">ИЗМЕНЕНИЯ <b id="ide-git-count">0</b><button class="ide-tool ide-tool-sm" type="button" id="ide-git-discard-all" title="Отменить все изменения">↺</button></p>
            <ul class="ide-git-changes" id="ide-git-changes"></ul>
            <p class="ide-side-label">ИСТОРИЯ <b id="ide-git-total">0</b></p>
            <ol class="ide-git-log" id="ide-git-log"></ol>`,
            `<button class="ide-tool ide-tool-sm" type="button" data-remote="pull" title="Pull — нужен удалённый репозиторий">↓</button>
             <button class="ide-tool ide-tool-sm" type="button" data-remote="push" title="Push — нужен удалённый репозиторий">↑</button>
             <button class="ide-tool ide-tool-sm" type="button" data-remote="fetch" title="Fetch — нужен удалённый репозиторий">⟳</button>`);
        addPanel("outline", `OUTLINE <i id="ide-outline-file">—</i>`, `
            <div class="ide-side-filter"><label class="visually-hidden" for="ide-outline-filter">Фильтр символов</label>
            <input class="input input-sm" id="ide-outline-filter" type="search" placeholder="Фильтр символов" spellcheck="false"></div>
            <ul class="ide-outline" id="ide-outline"></ul>`);
        addPanel("ext", "EXTENSIONS", `
            <div class="ide-side-filter"><label class="visually-hidden" for="ide-ext-filter">Поиск расширений</label>
            <input class="input input-sm" id="ide-ext-filter" type="search" placeholder="Поиск расширений" spellcheck="false"></div>
            <ul class="ide-xt-list" id="ide-ext-list"></ul>`);
        addPanel("ai", "NEXUS AGENT <i>beta</i>", `
            <div class="ide-ai">
                <p class="ide-ai-note">${icon("info")} Языковая модель недоступна: для неё нужен сервер и API-ключ. Ниже — офлайн-помощник, который работает прямо в браузере.</p>
                <div class="ide-ai-actions">
                    <button class="btn btn-sm" type="button" data-ai="error">${icon("bug")}Объяснить ошибку</button>
                    <button class="btn btn-sm" type="button" data-ai="summary">${icon("info")}Сводка проекта</button>
                    <button class="btn btn-sm" type="button" data-ai="todo">${icon("checkmark")}TODO и FIXME</button>
                    <button class="btn btn-sm" type="button" data-ai="format">${icon("edit")}Привести в порядок</button>
                </div>
                <ol class="ide-ai-log" id="ide-ai-log" aria-live="polite"></ol>
                <form class="ide-ai-form" id="ide-ai-form">
                    <label class="visually-hidden" for="ide-ai-input">Запрос к ассистенту</label>
                    <textarea class="input" id="ide-ai-input" rows="2" placeholder="Спросите ассистента… (модель недоступна в тестовой версии)"></textarea>
                    <button class="btn btn-sm" type="submit" title="Требуется языковая модель">${icon("sparkle")}Отправить</button>
                </form>
            </div>`);

        // Хлебные крошки под вкладками
        const crumbs = document.createElement("nav");
        crumbs.className = "ide-crumbs";
        crumbs.id = "ide-crumbs";
        crumbs.setAttribute("aria-label", "Путь и символ");
        el.tabs.insertAdjacentElement("afterend", crumbs);

        // Слой украшений (скобки, совпадения, диагностика) и автодополнение
        const code = el.editor.querySelector(".ide-code");
        const decor = document.createElement("div");
        decor.className = "ide-decor";
        decor.setAttribute("aria-hidden", "true");
        code.insertBefore(decor, el.hl);
        const ac = document.createElement("div");
        ac.className = "ide-ac";
        ac.id = "ide-ac";
        ac.setAttribute("role", "listbox");
        ac.setAttribute("aria-label", "Подсказки");
        ac.hidden = true;
        code.appendChild(ac);

        // Мини-карта
        const mmWrap = document.createElement("div");
        mmWrap.className = "ide-minimap";
        mmWrap.setAttribute("aria-hidden", "true");
        mmWrap.innerHTML = `<canvas></canvas><i class="ide-mm-view"></i>`;
        el.editor.appendChild(mmWrap);

        // Нижняя панель: Консоль / Терминал / Проблемы
        const conHead = $("#ide-console .ide-pane-head");
        const countEl = $("#ide-console-count");
        const btabs = document.createElement("div");
        btabs.className = "ide-btabs";
        btabs.setAttribute("role", "tablist");
        btabs.setAttribute("aria-label", "Нижняя панель");
        btabs.innerHTML = `<button type="button" role="tab" data-btab="console" aria-selected="true">Консоль </button>
            <button type="button" role="tab" data-btab="terminal" aria-selected="false">Терминал</button>
            <button type="button" role="tab" data-btab="problems" aria-selected="false">Проблемы <i id="ide-prob-count">0</i></button>`;
        btabs.firstElementChild.appendChild(countEl);
        conHead.replaceChild(btabs, conHead.firstElementChild);
        const term = document.createElement("div");
        term.className = "ide-term";
        term.id = "ide-term";
        term.hidden = true;
        term.innerHTML = `<ol class="ide-term-out" id="ide-term-out" aria-live="polite"></ol>
            <form class="ide-term-in" id="ide-term-form" autocomplete="off">
                <span class="ide-term-ps" id="ide-term-ps" aria-hidden="true">~$</span>
                <label class="visually-hidden" for="ide-term-input">Команда терминала</label>
                <input id="ide-term-input" type="text" spellcheck="false" autocapitalize="off" placeholder="help — список команд, Tab — дополнение">
            </form>`;
        const probs = document.createElement("ul");
        probs.className = "ide-problems";
        probs.id = "ide-problems";
        probs.hidden = true;
        $("#ide-console").appendChild(term);
        $("#ide-console").appendChild(probs);

        // Превью: размеры устройств и отдельная вкладка
        const pvTools = $("#ide-preview-pane .ide-pane-tools");
        const dev = document.createElement("span");
        dev.className = "ide-devices";
        dev.setAttribute("role", "group");
        dev.setAttribute("aria-label", "Размер превью");
        dev.innerHTML = `<button class="ide-tool ide-tool-sm" type="button" data-device="auto" title="По ширине панели" aria-pressed="true">${icon("zen", 12)}</button>
            <button class="ide-tool ide-tool-sm" type="button" data-device="desktop" title="Компьютер 1280 px" aria-pressed="false">${icon("desktop", 12)}</button>
            <button class="ide-tool ide-tool-sm" type="button" data-device="tablet" title="Планшет 768 px" aria-pressed="false">${icon("tablet", 12)}</button>
            <button class="ide-tool ide-tool-sm" type="button" data-device="phone" title="Телефон 390 px" aria-pressed="false">${icon("phone", 12)}</button>`;
        pvTools.insertBefore(dev, pvTools.firstChild);
        const newTab = document.createElement("button");
        newTab.className = "ide-tool ide-tool-sm";
        newTab.type = "button";
        newTab.id = "ide-newtab";
        newTab.title = "Открыть превью в новой вкладке";
        newTab.innerHTML = `${icon("globe", 14)}<span class="visually-hidden">Открыть в новой вкладке</span>`;
        pvTools.insertBefore(newTab, $("#ide-fullscreen"));
        const devLabel = document.createElement("span");
        devLabel.className = "ide-dev-size";
        devLabel.id = "ide-dev-size";
        $("#ide-preview").appendChild(devLabel);

        // Строка состояния
        const st = $("#ide-status");
        const stBranch = document.createElement("button");
        stBranch.type = "button";
        stBranch.className = "ide-st-item";
        stBranch.id = "ide-st-branch";
        stBranch.title = "Git: открыть изменения";
        stBranch.textContent = "⎇ main";
        st.insertBefore(stBranch, $("#ide-st-problems"));
        const stVim = document.createElement("span");
        stVim.className = "ide-st-item ide-st-vim";
        stVim.id = "ide-st-vim";
        stVim.hidden = true;
        st.insertBefore(stVim, $(".ide-st-spacer").nextSibling);
        const stSel = document.createElement("span");
        stSel.className = "ide-st-item hide-sm";
        stSel.id = "ide-st-occ";
        st.insertBefore(stSel, $("#ide-st-pos"));
        const stWrap = document.createElement("button");
        stWrap.type = "button";
        stWrap.className = "ide-st-item hide-sm";
        stWrap.id = "ide-st-wrap";
        stWrap.title = "Перенос строк (Alt+Z)";
        st.insertBefore(stWrap, $("#ide-st-lang"));
        const stAi = document.createElement("button");
        stAi.type = "button";
        stAi.className = "ide-st-item ide-st-icon";
        stAi.id = "ide-st-ai";
        stAi.title = "Ассистент";
        stAi.innerHTML = icon("sparkle", 12);
        st.appendChild(stAi);
        const stCloud = document.createElement("button");
        stCloud.type = "button";
        stCloud.className = "ide-st-item ide-st-icon hide-sm";
        stCloud.id = "ide-st-cloud";
        stCloud.title = "Синхронизация с облаком — недоступна в тестовой версии";
        stCloud.innerHTML = icon("cloud", 12);
        st.appendChild(stCloud);

        /* ================================================================
         * Команды и горячие клавиши
         * ================================================================ */
        const COMMANDS = [];
        const CODE_OF = { "`": "Backquote", "/": "Slash", "\\": "Backslash", "[": "BracketLeft", "]": "BracketRight", "=": "Equal", "-": "Minus", ",": "Comma", ".": "Period", ";": "Semicolon", Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight", Space: "Space", Enter: "Enter", Esc: "Escape", Tab: "Tab" };
        function parseKey(spec) {
            return spec.split(" ").map(part => {
                const bits = part.split("+");
                const k = bits.pop();
                const code = CODE_OF[k] || (/^[A-Z]$/.test(k) ? "Key" + k : /^\d$/.test(k) ? "Digit" + k : k);
                return { c: bits.indexOf("Ctrl") >= 0, s: bits.indexOf("Shift") >= 0, a: bits.indexOf("Alt") >= 0, code };
            });
        }
        /* cmd(id, категория, название, клавиши, действие, {editor: только в редакторе, decor: декоративно}) */
        function cmd(id, cat, title, key, run, opts) {
            COMMANDS.push(Object.assign({ id, cat, title, key: key || "", chord: key ? parseKey(key) : null, run }, opts || {}));
        }
        function exec(id) {
            const c = COMMANDS.find(x => x.id === id);
            if (c) c.run();
        }
        const matchKey = (k, e) => k.code === e.code && k.c === (e.ctrlKey || e.metaKey) && k.s === e.shiftKey && k.a === e.altKey;
        let chordWait = null, chordTimer = 0;
        document.addEventListener("keydown", e => {
            if (!appVisible() || modalOpen() || e.defaultPrevented) return;
            const inEditor = document.activeElement === ta;
            const inField = !inEditor && /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
            if (chordWait) {
                const hit = COMMANDS.find(c => c.chord && c.chord.length === 2 && matchKey(c.chord[0], chordWait) && matchKey(c.chord[1], e));
                chordWait = null;
                clearTimeout(chordTimer);
                if (hit) { e.preventDefault(); hit.run(); return; }
            }
            if ((e.ctrlKey || e.metaKey) && e.code === "KeyK" && !e.shiftKey && !e.altKey) {
                chordWait = { code: e.code, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
                clearTimeout(chordTimer);
                chordTimer = setTimeout(() => { chordWait = null; }, 1500);
                e.preventDefault();
                toast("Ctrl+K … ожидание второй клавиши", "info", { ttl: 1200 });
                return;
            }
            const hit = COMMANDS.find(c => c.chord && c.chord.length === 1 && matchKey(c.chord[0], e));
            if (!hit) return;
            if (hit.editor && !inEditor) return;
            if (inField && !hit.global) return;
            e.preventDefault();
            hit.run();
        });

        /* ================================================================
         * Символы файла (для структуры, @-перехода и хлебных крошек)
         * ================================================================ */
        const JS_SKIP = new Set(["if", "for", "while", "switch", "catch", "function", "return", "else", "do", "try", "with"]);
        function symbolsOf(path, text) {
            const lang = A.langOf(path || "");
            const out = [];
            const lines = text.split("\n");
            if (lang === "js") {
                let inClass = -1, depth = 0, classDepth = -1;
                lines.forEach((ln, i) => {
                    const t = ln.replace(/\/\/.*$/, "");
                    let m;
                    if ((m = /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(t))) { out.push({ name: m[1], kind: "class", line: i + 1, depth: 0 }); inClass = i; classDepth = depth; }
                    else if ((m = /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/.exec(t))) out.push({ name: m[1] + "()", kind: "function", line: i + 1, depth: depth > 0 ? 1 : 0 });
                    else if ((m = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/.exec(t))) out.push({ name: m[1] + "()", kind: "function", line: i + 1, depth: depth > 0 ? 1 : 0 });
                    else if (depth === 0 && (m = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(t))) out.push({ name: m[1], kind: /^\s*(?:export\s+)?const\s+[A-Z0-9_]+\s*=/.test(t) ? "constant" : "variable", line: i + 1, depth: 0 });
                    else if (inClass >= 0 && depth === classDepth + 1 && (m = /^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?([A-Za-z_$#][\w$]*)\s*\([^)]*\)\s*\{/.exec(t)) && !JS_SKIP.has(m[1])) out.push({ name: m[1] + "()", kind: "method", line: i + 1, depth: 1 });
                    for (const ch of t.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "")) {
                        if (ch === "{") depth++;
                        else if (ch === "}") { depth = Math.max(0, depth - 1); if (inClass >= 0 && depth <= classDepth) inClass = -1; }
                    }
                });
            } else if (lang === "css") {
                let depth = 0;
                lines.forEach((ln, i) => {
                    const t = ln.replace(/\/\*.*?\*\//g, "").trim();
                    let m;
                    if ((m = /^(@media|@supports|@keyframes|@font-face|@layer|@container)\b([^{]*)\{?/.exec(t))) out.push({ name: (m[1] + m[2]).trim(), kind: "at", line: i + 1, depth });
                    else if (/\{\s*$/.test(t) || /^[^:;{}]+\{/.test(t)) {
                        const sel = t.replace(/\{.*$/, "").trim();
                        if (sel) out.push({ name: sel.length > 60 ? sel.slice(0, 57) + "…" : sel, kind: "selector", line: i + 1, depth });
                    } else if ((m = /^(--[\w-]+)\s*:/.exec(t))) out.push({ name: m[1], kind: "variable", line: i + 1, depth });
                    depth += (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
                    depth = Math.max(0, depth);
                });
            } else if (lang === "html") {
                lines.forEach((ln, i) => {
                    let m;
                    const re = /<(h[1-6])\b[^>]*>([^<]*)|<([a-z][\w-]*)\b[^>]*\bid\s*=\s*["']([^"']+)["']|<(script|style|section|main|header|footer|nav|form|canvas)\b/gi;
                    while ((m = re.exec(ln))) {
                        if (m[1]) out.push({ name: `${m[1].toLowerCase()}  ${m[2].trim() || "…"}`, kind: "heading", line: i + 1, depth: Number(m[1][1]) - 1 });
                        else if (m[3]) out.push({ name: `${m[3].toLowerCase()}#${m[4]}`, kind: "element", line: i + 1, depth: 1 });
                        else out.push({ name: `<${m[5].toLowerCase()}>`, kind: "block", line: i + 1, depth: 0 });
                    }
                });
            } else if (lang === "md") {
                lines.forEach((ln, i) => {
                    const m = /^(#{1,6})\s+(.*)$/.exec(ln);
                    if (m) out.push({ name: m[2].trim(), kind: "heading", line: i + 1, depth: m[1].length - 1 });
                });
            } else if (lang === "json") {
                lines.forEach((ln, i) => {
                    const m = /^(\s*)"([^"]+)"\s*:/.exec(ln);
                    if (m && m[1].length <= (S().tabSize || 2) * 2) out.push({ name: m[2], kind: "key", line: i + 1, depth: m[1].length ? Math.round(m[1].length / (S().tabSize || 2)) - 1 : 0 });
                });
            }
            return out;
        }
        const KIND_BADGE = { class: "C", function: "ƒ", method: "m", variable: "v", constant: "K", selector: "#", at: "@", heading: "H", element: "<>", block: "□", key: "{}" };
        function symbolAtLine(list, line) {
            let best = null;
            for (const s of list) { if (s.line <= line) best = s; else break; }
            return best;
        }

        /* ================================================================
         * Быстрый переход и палитра команд
         * ================================================================ */
        const QO_BADGE = { html: "<>", css: "#", js: "JS", json: "{}", md: "MD", text: "TXT", new: "+" };
        const qo = document.createElement("div");
        qo.className = "ide-qo-wrap";
        qo.hidden = true;
        qo.innerHTML = `<div class="ide-qo" role="dialog" aria-modal="true" aria-label="Быстрый переход">
                <div class="ide-qo-head"><label class="visually-hidden" for="ide-qo-input">Запрос</label>
                <input id="ide-qo-input" type="text" spellcheck="false" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="ide-qo-list" aria-autocomplete="list"></div>
                <p class="ide-qo-hint" id="ide-qo-hint"></p>
                <ul class="ide-qo-list" id="ide-qo-list" role="listbox"></ul>
            </div>`;
        document.body.appendChild(qo);
        const qoInput = $("#ide-qo-input", qo), qoList = $("#ide-qo-list", qo), qoHint = $("#ide-qo-hint", qo);
        const qoState = { items: [], sel: 0, back: null, custom: null, picked: false };
        /* Список выбора (темы и т.п.): list = [{ label, detail, value }], preview — живой предпросмотр */
        function openPicker(title, list, onPick, preview, onCancel) {
            qoState.custom = { title, list, onPick, preview, onCancel };
            qoState.picked = false;
            openQO("");
            qoInput.placeholder = title;
        }
        function openQO(prefix) {
            if (!P()) return;
            if (arguments.length && !qoState.custom) qoInput.placeholder = "Имя файла, >команда, :строка, @символ, #текст";
            closeAC();
            qoState.back = document.activeElement;
            qo.hidden = false;
            document.documentElement.classList.add("ide-qo-open");
            qoInput.value = prefix || "";
            renderQO();
            qoInput.focus();
            qoInput.setSelectionRange(qoInput.value.length, qoInput.value.length);
            Sound.play("panels");
        }
        function closeQO(keepFocus) {
            if (qo.hidden) return;
            qo.hidden = true;
            const cu = qoState.custom;
            qoState.custom = null;
            if (cu && !qoState.picked && cu.onCancel) cu.onCancel();
            document.documentElement.classList.remove("ide-qo-open");
            if (!keepFocus && qoState.back && qoState.back.focus) qoState.back.focus({ preventScroll: true });
        }
        function renderQO() {
            const raw = qoInput.value;
            const cu = qoState.custom;
            const mode = cu ? "" : /^[>:@#?]/.test(raw) ? raw[0] : "";
            const q = (mode ? raw.slice(1) : raw).trim();
            let items = [];
            const hints = {
                "": "Файлы проекта · <kbd>&gt;</kbd> команды · <kbd>:</kbd> строка · <kbd>@</kbd> символ · <kbd>#</kbd> текст во всех файлах · <kbd>?</kbd> справка",
                ">": "Команды NEXUS IDE · Enter — выполнить",
                ":": "Перейти к строке: <kbd>:42</kbd> или <kbd>:42:7</kbd>",
                "@": "Символы текущего файла",
                "#": "Поиск текста во всех файлах (до 60 совпадений)",
                "?": "Префиксы быстрого перехода"
            };
            qoHint.innerHTML = cu ? esc(cu.title) + " · ↑↓ — предпросмотр, Enter — выбрать, Esc — отмена" : hints[mode];
            if (cu) {
                items = cu.list.map(it => { const m = fuzzy(raw.trim(), it.label + " " + (it.detail || "")); return m && { m, it }; }).filter(Boolean)
                    .map(({ it }) => ({ html: marked(it.label, (fuzzy(raw.trim(), it.label) || { idx: [] }).idx), detail: it.detail, extra: it.extra, value: it.value, run: () => { qoState.picked = true; cu.onPick(it.value); } }));
            } else if (mode === "") {
                const recent = (S().recent || []).filter(f => P().files[f] !== undefined);
                const list = files();
                if (!q) {
                    const order = recent.concat(list.filter(f => recent.indexOf(f) < 0));
                    items = order.map(f => ({ label: f.split("/").pop(), detail: f.indexOf("/") >= 0 ? f.slice(0, f.lastIndexOf("/")) : "", badge: A.langOf(f), path: f, extra: recent.indexOf(f) >= 0 ? "недавний" : "", run: () => A.openFile(f) }));
                } else {
                    items = list.map(f => { const m = fuzzy(q, f); return m && { m, f }; }).filter(Boolean).sort((a, b) => b.m.score - a.m.score)
                        .map(({ m, f }) => {
                            const cut = f.lastIndexOf("/") + 1;
                            return { html: marked(f.slice(cut), m.idx.filter(i => i >= cut).map(i => i - cut)), detail: f.slice(0, Math.max(0, cut - 1)), badge: A.langOf(f), path: f, run: () => A.openFile(f) };
                        });
                    if (!items.length && /\.\w+$/.test(q) && A.ALLOWED_EXT.test(q)) {
                        items.push({ label: `Создать файл «${q}»`, badge: "new", run: () => createFileNamed(q) });
                    }
                }
            } else if (mode === ">") {
                items = COMMANDS.filter(c => !c.hidden).map(c => { const text = `${c.cat}: ${c.title}`; const alt = fuzzy(q, c.id.replace(/\./g, " ")); const m = fuzzy(q, text) || (alt && { score: alt.score - 5, idx: [] }); return m && { m, c, text }; }).filter(Boolean)
                    .sort((a, b) => q ? b.m.score - a.m.score : 0)
                    .map(({ m, c, text }) => ({ html: marked(text, m.idx), key: c.key, extra: c.decor ? "декор" : "", run: () => c.run() }));
            } else if (mode === ":") {
                const m = /^(\d+)(?::(\d+))?/.exec(q);
                const total = ta.value.split("\n").length;
                const ex = { w: ["Сохранить (:w)", () => A.persist(true)], wq: ["Сохранить и закрыть вкладку (:wq)", () => { A.persist(true); if (ide.active) A.closeTab(ide.active); }], x: ["Сохранить и закрыть вкладку (:x)", () => { A.persist(true); if (ide.active) A.closeTab(ide.active); }], q: ["Закрыть вкладку (:q)", () => { if (ide.active) A.closeTab(ide.active); }], noh: ["Убрать подсветку поиска (:noh)", () => A.closeFind()] };
                if (ex[q]) items = [{ label: ex[q][0], run: ex[q][1] }];
                else if (!ide.active) items = [{ label: "Нет открытого файла", run: () => {} }];
                else if (m) items = [{ label: `Перейти к строке ${m[1]}${m[2] ? `, столбцу ${m[2]}` : ""}`, detail: `из ${total}`, run: () => goLine(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0) }];
                else items = [{ label: `Введите номер строки от 1 до ${total}`, run: () => {} }];
            } else if (mode === "@") {
                const syms = ide.active ? symbolsOf(ide.active, ta.value) : [];
                items = syms.map(s => { const m = fuzzy(q, s.name); return m && { m, s }; }).filter(Boolean)
                    .sort((a, b) => q ? b.m.score - a.m.score : a.s.line - b.s.line)
                    .map(({ m, s }) => ({ html: marked(s.name, m.idx), badge: "sym-" + s.kind, badgeText: KIND_BADGE[s.kind] || "•", detail: `стр. ${s.line}`, run: () => goLine(s.line, 0, true) }));
                if (!items.length) items = [{ label: ide.active ? "Символы не найдены" : "Нет открытого файла", run: () => {} }];
            } else if (mode === "#") {
                if (q.length >= 2) {
                    const ql = q.toLowerCase();
                    files().some(f => {
                        P().files[f].split("\n").some((ln, i) => {
                            const at = ln.toLowerCase().indexOf(ql);
                            if (at < 0) return false;
                            const s0 = Math.max(0, at - 30);
                            const pre = ln.slice(s0, at), hit = ln.slice(at, at + q.length), post = ln.slice(at + q.length, at + q.length + 50);
                            items.push({ html: `${s0 ? "…" : ""}${esc(pre.trimStart())}<b>${esc(hit)}</b>${esc(post)}`, detail: `${f}:${i + 1}`, badge: A.langOf(f), run: () => { A.openFile(f); goLine(i + 1, at, false, q.length); } });
                            return items.length >= 60;
                        });
                        return items.length >= 60;
                    });
                    if (!items.length) items = [{ label: "Совпадений нет", run: () => {} }];
                } else items = [{ label: "Введите минимум 2 символа", run: () => {} }];
            } else {
                items = [
                    ["", "Файлы проекта", "Ctrl+P"], [">", "Команды", "Ctrl+Shift+P"], [":", "Перейти к строке", "Ctrl+G"],
                    ["@", "Символ в файле", "Ctrl+Shift+O"], ["#", "Текст во всех файлах", ""]
                ].map(([p, t, k]) => ({ label: `${p || "…"}  ${t}`, key: k, keep: true, run: () => { qoInput.value = p; renderQO(); qoInput.focus(); } }));
            }
            qoState.items = items.slice(0, 200);
            qoState.sel = 0;
            qoList.innerHTML = qoState.items.map((it, i) => `<li role="option" id="ide-qo-${i}" data-i="${i}" aria-selected="${i === 0}">
                    ${it.badge ? `<span class="ide-qo-badge ${it.badge.indexOf("sym-") === 0 ? "is-sym " + it.badge : "ext-" + it.badge}">${esc(it.badgeText || QO_BADGE[it.badge] || "•")}</span>` : ""}
                    <span class="ide-qo-label">${it.html || esc(it.label || "")}</span>
                    ${it.detail ? `<span class="ide-qo-detail">${esc(it.detail)}</span>` : ""}
                    ${it.extra ? `<span class="ide-qo-extra">${esc(it.extra)}</span>` : ""}
                    ${it.key ? `<kbd>${esc(it.key)}</kbd>` : ""}
                </li>`).join("") || `<li class="ide-qo-empty">Ничего не найдено</li>`;
            qoInput.setAttribute("aria-activedescendant", qoState.items.length ? "ide-qo-0" : "");
            if (cu && cu.preview && qoState.items[0]) cu.preview(qoState.items[0].value);
        }
        function qoMove(d) {
            const n = qoState.items.length;
            if (!n) return;
            qoState.sel = (qoState.sel + d + n) % n;
            $$("li[data-i]", qoList).forEach(li => li.setAttribute("aria-selected", String(Number(li.dataset.i) === qoState.sel)));
            const cur = qoList.querySelector(`[data-i="${qoState.sel}"]`);
            if (cur) cur.scrollIntoView({ block: "nearest" });
            qoInput.setAttribute("aria-activedescendant", "ide-qo-" + qoState.sel);
            const cu = qoState.custom;
            if (cu && cu.preview && qoState.items[qoState.sel]) cu.preview(qoState.items[qoState.sel].value);
        }
        function qoPick(i) {
            const it = qoState.items[i === undefined ? qoState.sel : i];
            if (!it) return;
            if (it.keep) { it.run(); return; }
            if (qoState.custom) qoState.picked = true;
            closeQO(true);
            it.run();
            Sound.play("folder");
        }
        qoInput.addEventListener("input", renderQO);
        qoInput.addEventListener("keydown", e => {
            if (e.key === "ArrowDown") { e.preventDefault(); qoMove(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); qoMove(-1); }
            else if (e.key === "PageDown") { e.preventDefault(); qoMove(8); }
            else if (e.key === "PageUp") { e.preventDefault(); qoMove(-8); }
            else if (e.key === "Enter") { e.preventDefault(); qoPick(); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeQO(); }
            else if (e.key === "Tab") { e.preventDefault(); qoMove(e.shiftKey ? -1 : 1); }
        });
        qoList.addEventListener("mousedown", e => e.preventDefault());
        qoList.addEventListener("click", e => {
            const li = e.target.closest("li[data-i]");
            if (li) qoPick(Number(li.dataset.i));
        });
        qo.addEventListener("mousedown", e => { if (e.target === qo) closeQO(); });
        cmdBtn.addEventListener("click", () => openQO(""));

        function goLine(line, col, top, selLen) {
            if (!ide.active) return;
            const v = ta.value;
            const total = v.split("\n").length;
            line = clamp(line || 1, 1, total);
            const pos = posOf(v, line, col || 0);
            if (mobile()) A.setPane("code");
            ta.focus({ preventScroll: true });
            ta.setSelectionRange(pos, pos + (selLen || 0));
            if (top) ta.scrollTop = Math.max(0, (line - 1) * ide.lineH - ide.lineH * 2);
            A.revealSelection(pos);
            A.updateCaret();
        }
        function createFileNamed(name) {
            const v = A.validName(name);
            if (v.error) { toast(v.error, "warn"); return; }
            A.addFile(v.name, (A.NEW_FILE_CONTENT[A.langOf(v.name)] || A.NEW_FILE_CONTENT.text)(v.name.split("/").pop()));
            Sound.play("granted");
        }

        /* ================================================================
         * Боковая панель: переключение
         * ================================================================ */
        function setSide(id, opts) {
            opts = opts || {};
            if (!panels[id]) id = "explorer";
            const visible = S().explorer !== false;
            if (!opts.force && !mobile() && visible && S().side === id && !opts.show) {
                S().explorer = false;
                A.applyLayout();
                A.saveSettings();
                syncActivity();
                return;
            }
            S().side = id;
            S().explorer = true;
            Object.keys(panels).forEach(k => { panels[k].hidden = k !== id; });
            A.applyLayout();
            A.saveSettings();
            syncActivity();
            if (mobile()) A.setPane("files");
            if (id === "search") setTimeout(() => { const i = $("#ide-ps-input"); i.focus(); i.select(); }, 30);
            if (id === "outline") renderOutline();
            if (id === "git") renderGit();
            if (id === "ext") renderExt();
            Sound.play("panels");
        }
        function syncActivity() {
            const on = S().explorer !== false;
            $$("[data-side]", activity).forEach(b => b.setAttribute("aria-pressed", String(on && b.dataset.side === S().side)));
        }
        activity.addEventListener("click", e => {
            const b = e.target.closest("button");
            if (!b) return;
            if (b.dataset.side) setSide(b.dataset.side);
            else if (b.dataset.act === "palette") openQO(">");
            else if (b.dataset.act === "zen") toggleZen();
        });

        /* ================================================================
         * Поиск и замена по проекту
         * ================================================================ */
        const ps = { opts: { case: false, word: false, regex: false }, timer: 0, collapsed: new Set(), results: [] };
        const psInput = $("#ide-ps-input"), psRepl = $("#ide-ps-replace"), psInc = $("#ide-ps-include");
        function psRegex() {
            const q = psInput.value;
            if (!q) return null;
            let src = ps.opts.regex ? q : reEsc(q);
            if (ps.opts.word) src = "\\b" + src + "\\b";
            try { return new RegExp(src, ps.opts.case ? "g" : "gi"); } catch (err) { return { error: err.message }; }
        }
        function psIncluded(path) {
            const inc = psInc.value.split(",").map(x => x.trim()).filter(Boolean);
            if (!inc.length) return true;
            return inc.some(g => {
                if (g.indexOf("*") >= 0) return new RegExp("^" + g.split("*").map(reEsc).join(".*") + "$", "i").test(path) || new RegExp(g.split("*").map(reEsc).join(".*") + "$", "i").test(path);
                return path.toLowerCase().indexOf(g.toLowerCase()) >= 0;
            });
        }
        function runProjectSearch() {
            const re = psRegex();
            const out = $("#ide-ps-results"), sum = $("#ide-ps-summary");
            ps.results = [];
            if (!re) { out.innerHTML = ""; sum.textContent = "Введите запрос — поиск идёт по всем файлам проекта"; return; }
            if (re.error) { out.innerHTML = ""; sum.textContent = "Ошибка в регулярном выражении: " + re.error; return; }
            let total = 0;
            files().filter(psIncluded).forEach(f => {
                const lines = P().files[f].split("\n");
                const hits = [];
                lines.forEach((ln, i) => {
                    re.lastIndex = 0;
                    let m, guard = 0;
                    while ((m = re.exec(ln)) && guard++ < 50) {
                        if (!m[0].length) { re.lastIndex++; continue; }
                        if (total < 2000) hits.push({ line: i + 1, col: m.index, len: m[0].length, text: ln });
                        total++;
                    }
                });
                if (hits.length) ps.results.push({ file: f, hits });
            });
            sum.textContent = total ? `${total} ${A.plural(total, "совпадение", "совпадения", "совпадений")} в ${ps.results.length} ${A.plural(ps.results.length, "файле", "файлах", "файлах")}${total > 2000 ? " (показаны первые 2000)" : ""}` : "Ничего не найдено";
            out.innerHTML = ps.results.map(r => {
                const open = !ps.collapsed.has(r.file);
                return `<li class="ide-ps-file" aria-expanded="${open}"><button type="button" class="ide-ps-fbtn" data-psfile="${esc(r.file)}"><span class="ide-caret">${open ? "▾" : "▸"}</span><span class="ide-fname">${esc(r.file.split("/").pop())}</span><i>${esc(r.file.indexOf("/") >= 0 ? r.file.slice(0, r.file.lastIndexOf("/")) : "")}</i><b>${r.hits.length}</b></button>
                    <ul${open ? "" : " hidden"}>${r.hits.slice(0, 300).map(h => {
                        const s0 = Math.max(0, h.col - 24);
                        return `<li><button type="button" class="ide-ps-hit" data-f="${esc(r.file)}" data-l="${h.line}" data-c="${h.col}" data-n="${h.len}"><i>${h.line}</i><span>${s0 ? "…" : ""}${esc(h.text.slice(s0, h.col).trimStart())}<mark>${esc(h.text.substr(h.col, h.len))}</mark>${esc(h.text.slice(h.col + h.len, h.col + h.len + 60))}</span></button></li>`;
                    }).join("")}</ul></li>`;
            }).join("");
        }
        const psSchedule = () => { clearTimeout(ps.timer); ps.timer = setTimeout(runProjectSearch, 180); };
        psInput.addEventListener("input", psSchedule);
        psInc.addEventListener("input", psSchedule);
        $("#ide-ps-form").addEventListener("submit", e => { e.preventDefault(); runProjectSearch(); });
        $$(".ide-ps-opts [data-opt]", panels.search).forEach(b => b.addEventListener("click", () => {
            ps.opts[b.dataset.opt] = !ps.opts[b.dataset.opt];
            b.setAttribute("aria-pressed", String(ps.opts[b.dataset.opt]));
            runProjectSearch();
        }));
        $("#ide-ps-collapse").addEventListener("click", () => {
            if (ps.collapsed.size) ps.collapsed.clear(); else ps.results.forEach(r => ps.collapsed.add(r.file));
            runProjectSearch();
        });
        $("#ide-ps-results").addEventListener("click", e => {
            const fb = e.target.closest("[data-psfile]");
            if (fb) {
                const f = fb.dataset.psfile;
                if (ps.collapsed.has(f)) ps.collapsed.delete(f); else ps.collapsed.add(f);
                runProjectSearch();
                return;
            }
            const h = e.target.closest(".ide-ps-hit");
            if (!h) return;
            A.openFile(h.dataset.f);
            goLine(Number(h.dataset.l), Number(h.dataset.c), false, Number(h.dataset.n));
        });
        $("#ide-ps-replace-all").addEventListener("click", () => {
            const re = psRegex();
            if (!re || re.error) { toast("Сначала введите корректный запрос", "warn"); return; }
            const repl = psRepl.value;
            const targets = files().filter(psIncluded).map(f => { re.lastIndex = 0; return { f, n: (P().files[f].match(re) || []).length }; }).filter(x => x.n);
            const total = targets.reduce((n, x) => n + x.n, 0);
            if (!total) { toast("Совпадений нет", "info"); return; }
            Modal.open({
                title: "Заменить во всех файлах?",
                subtitle: `${total} ${A.plural(total, "замена", "замены", "замен")}`,
                className: "confirm-modal",
                html: `<p>«<code>${esc(psInput.value)}</code>» → «<code>${esc(repl)}</code>» в ${targets.length} ${A.plural(targets.length, "файле", "файлах", "файлах")}:</p>
                    <ul class="svc-perks">${targets.map(x => `<li>${esc(x.f)} — ${x.n}</li>`).join("")}</ul>
                    <p class="svc-muted">Изменения можно откатить на панели Git (↺) или через Ctrl+Z в открытом файле.</p>`,
                buttons: [{
                    label: "Заменить", icon: "edit", primary: true, action: () => {
                        targets.forEach(({ f }) => {
                            re.lastIndex = 0;
                            const next = P().files[f].replace(re, ps.opts.regex ? repl : () => repl);
                            if (f === ide.active) A.replaceRange(0, ta.value.length, next, 0);
                            else P().files[f] = next;
                        });
                        P().updated = Date.now();
                        A.persist(false);
                        A.renderExplorer();
                        runProjectSearch();
                        refreshGit();
                        toast(`Заменено: ${total}`, "ok");
                    }
                }]
            });
        });

        /* ================================================================
         * Git внутри проекта: коммиты, diff, откат
         * ================================================================ */
        const GIT_MAX = 15;
        function gitOf(p) {
            p = p || P();
            if (!p) return null;
            if (!p.git || !Array.isArray(p.git.commits) || !p.git.commits.length) {
                p.git = { branch: "main", commits: [{ id: gitId(), msg: "Initial commit", time: p.created || Date.now(), author: me, files: Object.assign({}, p.files) }] };
            }
            return p.git;
        }
        function gitId() { return Math.random().toString(16).slice(2, 9) + Date.now().toString(16).slice(-3); }
        const headFiles = () => { const g = gitOf(); return g.commits[g.commits.length - 1].files; };
        function gitChanges() {
            const head = headFiles(), cur = P().files;
            const out = [];
            Object.keys(cur).forEach(f => {
                if (head[f] === undefined) out.push({ f, s: "A" });
                else if (head[f] !== cur[f]) out.push({ f, s: "M" });
            });
            Object.keys(head).forEach(f => { if (cur[f] === undefined) out.push({ f, s: "D" }); });
            return out.sort((a, b) => a.f.localeCompare(b.f));
        }
        function diffLines(aText, bText) {
            const a = aText.split("\n"), b = bText.split("\n");
            let s = 0;
            while (s < a.length && s < b.length && a[s] === b[s]) s++;
            let ea = a.length, eb = b.length;
            while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
            const ops = [];
            for (let i = 0; i < s; i++) ops.push({ t: "=", a: i, b: i, text: a[i] });
            const A2 = a.slice(s, ea), B2 = b.slice(s, eb), n = A2.length, m = B2.length;
            if (n * m > 2500000) {
                A2.forEach((x, i) => ops.push({ t: "-", a: s + i, text: x }));
                B2.forEach((x, j) => ops.push({ t: "+", b: s + j, text: x }));
            } else {
                const W = m + 1, dp = new Uint32Array((n + 1) * W);
                for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W + j] = A2[i] === B2[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
                let i = 0, j = 0;
                while (i < n && j < m) {
                    if (A2[i] === B2[j]) { ops.push({ t: "=", a: s + i, b: s + j, text: A2[i] }); i++; j++; }
                    else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) { ops.push({ t: "-", a: s + i, text: A2[i] }); i++; }
                    else { ops.push({ t: "+", b: s + j, text: B2[j] }); j++; }
                }
                while (i < n) { ops.push({ t: "-", a: s + i, text: A2[i] }); i++; }
                while (j < m) { ops.push({ t: "+", b: s + j, text: B2[j] }); j++; }
            }
            for (let k = 0; k < a.length - ea; k++) ops.push({ t: "=", a: ea + k, b: eb + k, text: a[ea + k] });
            return ops;
        }
        /* Маркеры в номерах строк: добавлено / изменено / удалено (как в Zed) */
        function gutterMarks(oldText, newText) {
            const ops = diffLines(oldText, newText);
            const marks = {};
            let k = 0;
            while (k < ops.length) {
                if (ops[k].t === "=") { k++; continue; }
                let dels = 0;
                const adds = [];
                while (k < ops.length && ops[k].t !== "=") { if (ops[k].t === "-") dels++; else adds.push(ops[k].b + 1); k++; }
                if (adds.length) adds.forEach(l => { marks[l] = dels ? "mod" : "add"; });
                else { const next = k < ops.length ? ops[k].b + 1 : newText.split("\n").length; marks[next] = marks[next] || "del"; }
            }
            return marks;
        }
        let gitMarks = {}, gitTimer = 0;
        function applyGutterMarks() {
            const kids = el.gutter.children;
            for (let i = 0; i < kids.length; i++) {
                const m = gitMarks[i + 1];
                const d = diag.lines[i + 1];
                kids[i].className = (kids[i].classList.contains("is-cur") ? "is-cur " : "") + (m ? "g-" + m + " " : "") + (d ? "g-" + d : "");
            }
        }
        function refreshGit() {
            clearTimeout(gitTimer);
            gitTimer = setTimeout(() => {
                if (!P()) return;
                const head = headFiles();
                gitMarks = ide.active ? (head[ide.active] === undefined ? Object.fromEntries(ta.value.split("\n").map((_, i) => [i + 1, "add"])) : gutterMarks(head[ide.active], ta.value)) : {};
                applyGutterMarks();
                const ch = gitChanges();
                const badge = $("#ide-git-badge");
                badge.hidden = !ch.length;
                badge.textContent = String(ch.length);
                stBranch.textContent = `⎇ ${gitOf().branch}${ch.length ? " ●" + ch.length : ""}`;
                markChanged(ch);
                if (!panels.git.hidden) renderGit(ch);
            }, 250);
        }
        function markChanged(ch) {
            const map = {};
            ch.forEach(c => { map[c.f] = c.s; });
            $$(".ide-file", el.files).forEach(li => {
                const s = map[li.dataset.path];
                li.setAttribute("data-git", s || "");
            });
            $$(".ide-tab", el.tabs).forEach(t => t.setAttribute("data-git", map[t.dataset.tab] || ""));
        }
        function renderGit(ch) {
            if (!P()) return;
            ch = ch || gitChanges();
            const g = gitOf();
            $("#ide-git-branch").textContent = "⎇ " + g.branch;
            $("#ide-git-count").textContent = String(ch.length);
            $("#ide-git-total").textContent = String(g.commits.length);
            $("#ide-git-changes").innerHTML = ch.length ? ch.map(c => `<li class="ide-git-ch" data-s="${c.s}">
                    <button type="button" class="ide-git-open" data-gdiff="${esc(c.f)}" title="Показать изменения"><span class="ide-fname">${esc(c.f.split("/").pop())}</span><i>${esc(c.f.indexOf("/") >= 0 ? c.f.slice(0, c.f.lastIndexOf("/")) : "")}</i></button>
                    <button type="button" class="ide-git-act" data-gdiscard="${esc(c.f)}" title="Отменить изменения в файле">↺</button>
                    <b title="${{ A: "Добавлен", M: "Изменён", D: "Удалён" }[c.s]}">${c.s}</b></li>`).join("")
                : `<li class="ide-files-empty">Нет изменений с последнего коммита</li>`;
            $("#ide-git-log").innerHTML = g.commits.slice().reverse().map((c, i) => `<li><button type="button" data-gcommit="${esc(c.id)}">
                    <span class="ide-git-dot${i === 0 ? " is-head" : ""}" aria-hidden="true"></span>
                    <span class="ide-git-msg">${esc(c.msg)}</span>
                    <i>${esc(c.id.slice(0, 7))} · ${esc(A.ago(c.time))}${i === 0 ? " · HEAD" : ""}</i></button></li>`).join("");
        }
        function commit() {
            if (!P()) return;
            const msgEl = $("#ide-git-msg");
            const ch = gitChanges();
            if (!ch.length) { toast("Нечего коммитить: изменений нет", "info"); return; }
            const msg = msgEl.value.trim() || (ch.length === 1 ? `${{ A: "Add", M: "Update", D: "Delete" }[ch[0].s]} ${ch[0].f}` : `Update ${ch.length} files`);
            const g = gitOf();
            g.commits.push({ id: gitId(), msg: msg.slice(0, 200), time: Date.now(), author: me, files: Object.assign({}, P().files) });
            const lim = IDEStore.limits().ideProjectSize * 3;
            while (g.commits.length > GIT_MAX || (g.commits.length > 2 && JSON.stringify(g).length > lim)) g.commits.splice(1, 1);
            msgEl.value = "";
            A.persist(false);
            refreshGit();
            renderGit();
            Sound.play("granted");
            toast(`Коммит ${g.commits[g.commits.length - 1].id.slice(0, 7)}: ${msg}`, "ok");
            termPrint(`[main ${g.commits[g.commits.length - 1].id.slice(0, 7)}] ${msg}`, "ok", true);
        }
        function discard(f) {
            const head = headFiles();
            const p = P();
            if (head[f] === undefined) {
                delete p.files[f];
                p.open = p.open.filter(x => x !== f);
                if (ide.active === f) ide.active = p.open[p.open.length - 1] || null;
            } else {
                if (f === ide.active) A.replaceRange(0, ta.value.length, head[f], 0);
                p.files[f] = head[f];
            }
            p.updated = Date.now();
            A.renderExplorer();
            A.openFile(ide.active, { silent: true });
            A.persist(false);
            refreshGit();
        }
        function diffHtml(oldText, newText) {
            const ops = diffLines(oldText, newText);
            const keep = new Array(ops.length).fill(false);
            ops.forEach((o, i) => { if (o.t !== "=") for (let k = Math.max(0, i - 3); k <= Math.min(ops.length - 1, i + 3); k++) keep[k] = true; });
            let html = "", gap = false, adds = 0, dels = 0;
            ops.forEach((o, i) => {
                if (o.t === "+") adds++;
                if (o.t === "-") dels++;
                if (!keep[i]) { if (!gap) { html += `<tr class="d-gap"><td colspan="3">⋯</td></tr>`; gap = true; } return; }
                gap = false;
                html += `<tr class="d-${o.t === "+" ? "add" : o.t === "-" ? "del" : "ctx"}"><td>${o.a !== undefined ? o.a + 1 : ""}</td><td>${o.b !== undefined ? o.b + 1 : ""}</td><td><code>${o.t === "=" ? " " : o.t} ${esc(o.text)}</code></td></tr>`;
            });
            return { html: html || `<tr><td colspan="3">Изменений нет</td></tr>`, adds, dels };
        }
        function showDiff(f, from, to, title) {
            const d = diffHtml(from === undefined ? "" : from, to === undefined ? "" : to);
            Modal.open({
                title: title || "Изменения",
                subtitle: `${esc(f)} · +${d.adds} −${d.dels}`,
                className: "ide-modal ide-diff-modal",
                html: `<div class="ide-diff-scroll"><table class="ide-diff"><tbody>${d.html}</tbody></table></div>`,
                buttons: f === ide.active || P().files[f] !== undefined ? [{ label: "Открыть файл", icon: "file", action: () => { A.openFile(f); } }] : []
            });
        }
        $("#ide-git-commit").addEventListener("click", commit);
        $("#ide-git-msg").addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); commit(); } });
        $("#ide-git-discard-all").addEventListener("click", () => {
            const ch = gitChanges();
            if (!ch.length) return;
            Modal.open({
                title: "Отменить все изменения?", subtitle: `${ch.length} ${A.plural(ch.length, "файл", "файла", "файлов")}`, className: "confirm-modal",
                html: `<p>Файлы вернутся к состоянию последнего коммита «${esc(gitOf().commits[gitOf().commits.length - 1].msg)}».</p>`,
                buttons: [{ label: "Отменить изменения", icon: "reload", primary: true, action: () => { restoreFiles(headFiles()); toast("Изменения отменены", "warn"); } }]
            });
        });
        function restoreFiles(snapshot) {
            const p = P();
            p.files = Object.assign({}, snapshot);
            p.open = p.open.filter(f => p.files[f] !== undefined);
            if (!p.files[p.entry]) p.entry = Object.keys(p.files).find(f => /\.html?$/i.test(f)) || Object.keys(p.files)[0] || "";
            if (ide.active && p.files[ide.active] === undefined) ide.active = p.open[0] || p.entry;
            p.updated = Date.now();
            A.renderExplorer();
            const cur = ide.active;
            ide.active = null;
            A.openFile(cur, { silent: true });
            A.persist(false);
            refreshGit();
            A.run();
        }
        $("#ide-git-changes").addEventListener("click", e => {
            const d = e.target.closest("[data-gdiff]");
            if (d) { const f = d.dataset.gdiff; showDiff(f, headFiles()[f], P().files[f]); return; }
            const x = e.target.closest("[data-gdiscard]");
            if (x) discard(x.dataset.gdiscard);
        });
        $("#ide-git-log").addEventListener("click", e => {
            const b = e.target.closest("[data-gcommit]");
            if (!b) return;
            const g = gitOf();
            const i = g.commits.findIndex(c => c.id === b.dataset.gcommit);
            const c = g.commits[i], prev = g.commits[i - 1];
            const all = Array.from(new Set(Object.keys(c.files).concat(prev ? Object.keys(prev.files) : []))).sort();
            const changed = all.filter(f => !prev || prev.files[f] !== c.files[f]);
            Modal.open({
                title: esc(c.msg),
                subtitle: `${c.id.slice(0, 7)} · ${esc(new Date(c.time).toLocaleString("ru-RU"))}`,
                className: "ide-modal",
                html: `<p class="svc-muted">Автор: ${esc(c.author || me)} · файлов в снимке: ${Object.keys(c.files).length}</p>
                    <ul class="ide-commit-files">${changed.map(f => {
                        const s = !prev || prev.files[f] === undefined ? "A" : c.files[f] === undefined ? "D" : "M";
                        return `<li><button type="button" class="btn btn-sm" data-cdiff="${esc(f)}"><b>${s}</b> ${esc(f)}</button></li>`;
                    }).join("") || "<li>Изменений относительно предыдущего коммита нет</li>"}</ul>`,
                buttons: [{
                    label: "Восстановить эту версию", icon: "reload", primary: i < g.commits.length - 1, action: () => {
                        restoreFiles(c.files);
                        toast(`Файлы восстановлены из ${c.id.slice(0, 7)} — закоммитьте, чтобы сохранить`, "ok", { ttl: 4000 });
                    }
                }]
            });
            $$(".ide-commit-files [data-cdiff]").forEach(btn => btn.addEventListener("click", () => {
                const f = btn.dataset.cdiff;
                showDiff(f, prev ? prev.files[f] : "", c.files[f], `Коммит ${c.id.slice(0, 7)}`);
            }));
        });
        $$("[data-remote]", panels.git).forEach(b => b.addEventListener("click", () => {
            toast(`git ${b.dataset.remote}: удалённый репозиторий недоступен — браузер не может подключиться к git-серверу. Скачайте ZIP и загрузите вручную.`, "warn", { ttl: 5000 });
        }));
        stBranch.addEventListener("click", () => setSide("git", { show: true }));

        /* ================================================================
         * Структура (Outline)
         * ================================================================ */
        let outlineSyms = [], outlineTimer = 0;
        function renderOutline() {
            const list = $("#ide-outline");
            $("#ide-outline-file").textContent = ide.active || "—";
            outlineSyms = ide.active ? symbolsOf(ide.active, ta.value) : [];
            const q = $("#ide-outline-filter").value.trim();
            const shown = outlineSyms.map(s => ({ s, m: fuzzy(q, s.name) })).filter(x => x.m);
            list.innerHTML = shown.length ? shown.map(({ s, m }) => `<li style="--d:${Math.min(s.depth, 5)}"><button type="button" data-oline="${s.line}"><span class="ide-qo-badge is-sym sym-${s.kind}">${KIND_BADGE[s.kind] || "•"}</span><span class="ide-fname">${marked(s.name, m.idx)}</span><i>${s.line}</i></button></li>`).join("")
                : `<li class="ide-files-empty">${ide.active ? "Символы не найдены" : "Откройте файл"}</li>`;
            markOutline();
        }
        function markOutline() {
            if (panels.outline.hidden) return;
            const cur = symbolAtLine(outlineSyms, A.caretLine());
            $$("#ide-outline [data-oline]").forEach(b => b.classList.toggle("is-current", !!cur && Number(b.dataset.oline) === cur.line));
        }
        $("#ide-outline").addEventListener("click", e => {
            const b = e.target.closest("[data-oline]");
            if (b) goLine(Number(b.dataset.oline), 0, true);
        });
        $("#ide-outline-filter").addEventListener("input", renderOutline);

        /* ================================================================
         * Расширения
         * ================================================================ */
        function renderExt() {
            const q = $("#ide-ext-filter").value.trim();
            $("#ide-ext-list").innerHTML = EXTENSIONS.filter(x => !q || fuzzy(q, x.name + " " + x.desc)).map(x => {
                let btn;
                if (x.kind === "setting") btn = `<button type="button" class="ide-xt-btn${S()[x.key] ? " is-on" : ""}" data-ext="${x.id}" aria-pressed="${!!S()[x.key]}">${S()[x.key] ? "Включено" : "Выключено"}</button>`;
                else if (x.kind === "builtin") btn = `<span class="ide-xt-btn is-builtin">Встроено</span>`;
                else btn = `<button type="button" class="ide-xt-btn is-remote" data-ext="${x.id}" title="Недоступно в браузере">Установить</button>`;
                return `<li class="ide-xt" data-kind="${x.kind}"><span class="ide-xt-icon">${icon(x.icon, 20)}</span>
                    <span class="ide-xt-body"><b>${esc(x.name)}</b><i>${esc(x.by)}</i><span>${esc(x.desc)}</span></span>${btn}</li>`;
            }).join("");
        }
        $("#ide-ext-list").addEventListener("click", e => {
            const b = e.target.closest("[data-ext]");
            if (!b) return;
            const x = EXTENSIONS.find(i => i.id === b.dataset.ext);
            if (x.kind === "remote") {
                toast(`«${x.name}» нельзя установить в браузере: ${x.desc.toLowerCase()}. В тестовой версии кнопка декоративная.`, "warn", { ttl: 5000 });
                return;
            }
            setOption(x.key, !S()[x.key]);
            renderExt();
        });
        $("#ide-ext-filter").addEventListener("input", renderExt);

        /* ================================================================
         * Ассистент (офлайн): объяснение ошибок, сводка, TODO
         * ================================================================ */
        let lastError = null;
        A.hooks.console.push(m => { if (m.level === "error") lastError = m; });
        const aiLog = $("#ide-ai-log");
        function aiSay(who, html) {
            const li = document.createElement("li");
            li.className = "ai-" + who;
            li.innerHTML = `<b>${who === "me" ? esc(me) : "NEXUS Agent"}</b><div>${html}</div>`;
            aiLog.appendChild(li);
            aiLog.scrollTop = aiLog.scrollHeight;
            return li;
        }
        function explainError(text) {
            for (const [re, fn] of ERROR_HINTS) { const m = re.exec(text); if (m) return fn(m); }
            return "Точного объяснения нет. Откройте строку ошибки (ссылка справа в консоли) и проверьте значения переменных через console.log().";
        }
        function aiAction(kind) {
            if (!P()) return;
            if (kind === "error") {
                aiSay("me", "Объясни последнюю ошибку");
                const lint = diag.list.filter(d => d.sev === "error");
                if (!lastError && !lint.length) { aiSay("bot", "Ошибок нет 🎉 Запустите проект (Ctrl+Enter) — если в консоли появится ошибка, я её разберу."); return; }
                let html = "";
                if (lastError) html += `<p><code>${esc(lastError.text)}</code>${lastError.src ? ` — <button type="button" class="ide-link" data-goto-f="${esc(lastError.src.file)}" data-goto-l="${lastError.src.line}">${esc(lastError.src.file)}:${lastError.src.line}</button>` : ""}</p><p>${esc(explainError(lastError.text))}</p>`;
                if (lint.length) html += `<p>Линтер также нашёл: ${lint.slice(0, 3).map(d => `<button type="button" class="ide-link" data-goto-f="${esc(d.file)}" data-goto-l="${d.line}">${esc(d.file)}:${d.line}</button> ${esc(d.msg)}`).join("; ")}</p>`;
                aiSay("bot", html);
            } else if (kind === "summary") {
                aiSay("me", "Сводка по проекту");
                const fl = files();
                const byLang = {};
                let lines = 0, syms = 0;
                fl.forEach(f => { const l = A.langOf(f); byLang[l] = (byLang[l] || 0) + 1; lines += P().files[f].split("\n").length; syms += symbolsOf(f, P().files[f]).length; });
                const g = gitOf();
                aiSay("bot", `<p><b>${esc(P().name)}</b>: ${fl.length} ${A.plural(fl.length, "файл", "файла", "файлов")}, ${lines} строк, ${formatBytes(IDEStore.projectSize(P()))}.</p>
                    <p>Языки: ${Object.keys(byLang).map(k => `${k.toUpperCase()} × ${byLang[k]}`).join(", ")}. Символов: ${syms}. Точка входа: <code>${esc(P().entry || "—")}</code>.</p>
                    <p>Git: ${g.commits.length} ${A.plural(g.commits.length, "коммит", "коммита", "коммитов")}, изменений: ${gitChanges().length}. Проблем линтера: ${diag.list.length}.</p>`);
            } else if (kind === "todo") {
                aiSay("me", "Найди TODO и FIXME");
                const hits = [];
                files().forEach(f => P().files[f].split("\n").forEach((ln, i) => { const m = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/.exec(ln); if (m) hits.push({ f, l: i + 1, k: m[1], t: m[2].replace(/\*\/|-->/g, "").trim() }); }));
                aiSay("bot", hits.length ? `<ul>${hits.slice(0, 40).map(h => `<li><b>${h.k}</b> ${esc(h.t || "—")} — <button type="button" class="ide-link" data-goto-f="${esc(h.f)}" data-goto-l="${h.l}">${esc(h.f)}:${h.l}</button></li>`).join("")}</ul>` : "Пометок TODO / FIXME в проекте нет.");
            } else if (kind === "format") {
                aiSay("me", "Приведи код в порядок");
                if (!ide.active) { aiSay("bot", "Откройте файл, который нужно отформатировать."); return; }
                const ok = formatDocument(true);
                aiSay("bot", ok ? `Файл <code>${esc(ide.active)}</code> отформатирован: выровнены отступы, убраны лишние пробелы и пустые строки. Отменить — Ctrl+Z.` : "Форматирование не изменило файл или не поддерживается для этого типа.");
            }
        }
        $(".ide-ai-actions", panels.ai).addEventListener("click", e => { const b = e.target.closest("[data-ai]"); if (b) aiAction(b.dataset.ai); });
        aiLog.addEventListener("click", e => {
            const b = e.target.closest("[data-goto-f]");
            if (b) A.gotoLine(b.dataset.gotoF, Number(b.dataset.gotoL));
        });
        $("#ide-ai-form").addEventListener("submit", e => {
            e.preventDefault();
            const inp = $("#ide-ai-input");
            const q = inp.value.trim();
            if (!q) return;
            aiSay("me", esc(q));
            inp.value = "";
            aiSay("bot", "Генерация ответов требует языковой модели на сервере (как Zed AI / Copilot) — в тестовой версии это декоративная функция. Попробуйте офлайн-кнопки выше.");
        });
        $("#ide-ai-input").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#ide-ai-form").requestSubmit(); } });
        stAi.addEventListener("click", () => setSide("ai", { show: true }));

        /* ================================================================
         * Геометрия редактора
         * ================================================================ */
        const geo = { padL: 14, padT: 10 };
        function measureChar() {
            const probe = document.createElement("span");
            probe.textContent = "0".repeat(100);
            probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
            el.hlCode.appendChild(probe);
            const w = probe.getBoundingClientRect().width / 100;
            probe.remove();
            if (w > 2) ide.charW = w;
            const cs = getComputedStyle(ta);
            geo.padL = parseFloat(cs.paddingLeft) || 14;
            geo.padT = parseFloat(cs.paddingTop) || 10;
            ide.lineH = parseFloat(cs.lineHeight) || ide.lineH;
        }
        const pxOf = (line, col) => ({ x: geo.padL + col * ide.charW, y: geo.padT + (line - 1) * ide.lineH });
        const wrapOn = () => !!S().wordWrap;
        function syncDecorScroll() {
            decor.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
        }

        /* ================================================================
         * Направляющие отступов (в HTML подсветки, без изменения текста)
         * ================================================================ */
        A.hooks.hl.push(html => {
            if (!S().indentGuides) return html;
            const u = S().tabSize || 2;
            const guide = "<span class=\"ig\">" + " ".repeat(u) + "</span>";
            return html.replace(/^( +)/gm, sp => {
                const n = Math.floor(sp.length / u);
                return guide.repeat(n) + " ".repeat(sp.length - n * u);
            });
        });

        /* ================================================================
         * Слой украшений: парные скобки, совпадения, курсор Vim, ошибки
         * ================================================================ */
        const OPEN = "([{", CLOSE = ")]}";
        function matchBracket(text, pos) {
            let at = -1;
            if (pos > 0 && (OPEN + CLOSE).indexOf(text[pos - 1]) >= 0) at = pos - 1;
            else if ((OPEN + CLOSE).indexOf(text[pos]) >= 0) at = pos;
            if (at < 0) return null;
            const ch = text[at];
            const oi = OPEN.indexOf(ch);
            const dir = oi >= 0 ? 1 : -1;
            const mine = ch, other = oi >= 0 ? CLOSE[oi] : OPEN[CLOSE.indexOf(ch)];
            let depth = 0;
            for (let i = at, steps = 0; i >= 0 && i < text.length && steps < 30000; i += dir, steps++) {
                if (text[i] === mine) depth++;
                else if (text[i] === other) { depth--; if (depth === 0) return [at, i]; }
            }
            return [at, -1];
        }
        let occCount = 0;
        function renderDecor() {
            decor.textContent = "";
            stSel.textContent = "";
            if (!ide.active || wrapOn()) { if (vim.on && !wrapOn()) drawVimCursor(); return; }
            const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
            const frag = document.createDocumentFragment();
            const box = (pos, len, cls) => {
                const lc = lineCol(v, pos);
                const p = pxOf(lc.line, lc.col);
                const d = document.createElement("i");
                d.className = cls;
                d.style.cssText = `transform:translate(${p.x}px,${p.y}px);width:${Math.max(1, len) * ide.charW}px;height:${ide.lineH}px`;
                frag.appendChild(d);
            };
            // Диагностика: волнистое подчёркивание строки
            diag.list.forEach(d => {
                if (d.file !== ide.active || !d.line) return;
                const lineStart = posOf(v, d.line, 0);
                const lineEnd = v.indexOf("\n", lineStart);
                const txt = v.slice(lineStart, lineEnd < 0 ? v.length : lineEnd);
                const lead = txt.length - txt.trimStart().length;
                box(lineStart + lead, Math.max(2, txt.trim().length), "dg dg-" + d.sev);
            });
            if (s === e) {
                const br = matchBracket(v, s);
                if (br) { box(br[0], 1, br[1] < 0 ? "bm bm-bad" : "bm"); if (br[1] >= 0) box(br[1], 1, "bm"); }
            }
            if (S().occurrences) {
                let word = "";
                if (s === e) { const w = wordAt(v, s); if (w.word.length >= 2 && !/^\d+$/.test(w.word)) word = w.word; }
                else if (e - s >= 2 && e - s <= 60 && /^[\w$]+$/.test(v.slice(s, e))) word = v.slice(s, e);
                occCount = 0;
                if (word) {
                    const re = new RegExp("(^|[^\\w$])(" + reEsc(word) + ")(?![\\w$])", "g");
                    let m;
                    while ((m = re.exec(v)) && occCount < 400) {
                        const at = m.index + m[1].length;
                        occCount++;
                        box(at, word.length, at <= s && s <= at + word.length ? "oc oc-cur" : "oc");
                        re.lastIndex = at + word.length;
                    }
                    if (occCount > 1) stSel.textContent = `«${word.length > 16 ? word.slice(0, 15) + "…" : word}» × ${occCount}`;
                }
            }
            decor.appendChild(frag);
            if (vim.on) drawVimCursor();
            syncDecorScroll();
        }
        let decorRaf = 0;
        const scheduleDecor = () => { if (!decorRaf) decorRaf = requestAnimationFrame(() => { decorRaf = 0; renderDecor(); }); };

        /* ================================================================
         * Диагностика (линтер)
         * ================================================================ */
        const diag = { list: [], lines: {}, timer: 0 };
        function lintJS(src, file, lineOffset) {
            const out = [];
            const stack = [];
            let line = 1, i = 0, state = 0, quote = "", prevSig = "";
            // state: 0 код, 1 строка, 2 шаблон, 3 //, 4 /* */, 5 регулярное выражение
            const n = src.length;
            for (; i < n; i++) {
                const c = src[i], nx = src[i + 1];
                if (c === "\n") {
                    if (state === 1) { out.push({ file, line: line + lineOffset, sev: "error", msg: `Незакрытая строка (${quote})` }); state = 0; }
                    if (state === 3 || state === 5) state = 0;
                    line++;
                    continue;
                }
                if (state === 0) {
                    if (c === "/" && nx === "/") { state = 3; i++; continue; }
                    if (c === "/" && nx === "*") { state = 4; i++; continue; }
                    if (c === "'" || c === "\"") { state = 1; quote = c; continue; }
                    if (c === "`") { state = 2; continue; }
                    if (c === "/" && (/[(,=:[!&|?{};+\-*%<>~^]$/.test(prevSig) || prevSig === "" || /\b(return|typeof|case|do|else|in|of)$/.test(src.slice(Math.max(0, i - 8), i).trimEnd()))) { state = 5; continue; }
                    if (OPEN.indexOf(c) >= 0) stack.push({ c, line });
                    else if (CLOSE.indexOf(c) >= 0) {
                        const want = OPEN[CLOSE.indexOf(c)];
                        const top = stack[stack.length - 1];
                        if (!top) out.push({ file, line: line + lineOffset, sev: "error", msg: `Лишняя закрывающая «${c}»` });
                        else if (top.c !== want) { out.push({ file, line: line + lineOffset, sev: "error", msg: `Ожидалась «${CLOSE[OPEN.indexOf(top.c)]}» (открыта на стр. ${top.line + lineOffset}), а найдена «${c}»` }); stack.pop(); }
                        else stack.pop();
                    }
                    if (!/\s/.test(c)) prevSig = c;
                } else if (state === 1) {
                    if (c === "\\") i++;
                    else if (c === quote) { state = 0; prevSig = "a"; }
                } else if (state === 2) {
                    if (c === "\\") i++;
                    else if (c === "`") { state = 0; prevSig = "a"; }
                } else if (state === 4) {
                    if (c === "*" && nx === "/") { state = 0; i++; }
                } else if (state === 5) {
                    if (c === "\\") i++;
                    else if (c === "[") { while (i < n && src[i] !== "]" && src[i] !== "\n") { if (src[i] === "\\") i++; i++; } }
                    else if (c === "/") { state = 0; prevSig = "a"; }
                }
            }
            if (state === 2) out.push({ file, line: line + lineOffset, sev: "error", msg: "Незакрытый шаблон `…`" });
            if (state === 4) out.push({ file, line: line + lineOffset, sev: "error", msg: "Незакрытый комментарий /* … */" });
            stack.forEach(t => out.push({ file, line: t.line + lineOffset, sev: "error", msg: `Не закрыта «${t.c}»` }));
            if (!out.length && !/^\s*(import|export)\s/m.test(src)) {
                try { new Function(src); }
                catch (err) { if (err instanceof SyntaxError && !/await|import|export/.test(err.message)) out.push({ file, line: null, sev: "error", msg: "Синтаксис: " + err.message }); }
            }
            return out;
        }
        function lintCSS(src, file, lineOffset) {
            const out = [];
            const clean = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " ")).replace(/(["'])(?:\\.|(?!\1).)*\1/g, m => "\"" + " ".repeat(Math.max(0, m.length - 2)) + "\"");
            const lines = clean.split("\n");
            let depth = 0;
            const opens = [];
            lines.forEach((ln, idx) => {
                const t = ln.trim();
                const L = idx + 1 + lineOffset;
                if (depth > 0 && t && !/[{}]/.test(t) && !t.startsWith("@") && t.indexOf(":") < 0) out.push({ file, line: L, sev: "warn", msg: "Пропущено «:» между свойством и значением" });
                if (depth > 0 && /^[\w-]+\s*:[^;{}]+$/.test(t)) {
                    const next = lines.slice(idx + 1).find(x => x.trim());
                    if (next && !/^\s*}/.test(next)) out.push({ file, line: L, sev: "warn", msg: "Пропущена «;» в конце объявления" });
                }
                for (const ch of ln) {
                    if (ch === "{") { depth++; opens.push(L); }
                    else if (ch === "}") { if (!depth) out.push({ file, line: L, sev: "error", msg: "Лишняя «}»" }); else { depth--; opens.pop(); } }
                }
            });
            opens.forEach(L => out.push({ file, line: L, sev: "error", msg: "Блок «{» не закрыт" }));
            return out;
        }
        const OPTIONAL_CLOSE = new Set("p li dt dd tr td th thead tbody tfoot option optgroup colgroup caption html head body".split(" "));
        function lintHTML(src, file) {
            const out = [];
            const stack = [];
            const ids = {};
            const lineAt = pos => src.slice(0, pos).split("\n").length;
            const blank = src.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, " "));
            const blocks = [];
            const masked = blank.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2\s*>)/gi, (m, a, tag, inner, b, off) => {
                blocks.push({ tag: tag.toLowerCase(), inner, line: lineAt(off + a.length) - 1, attrs: a });
                return a + inner.replace(/[^\n]/g, " ") + b;
            });
            const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
            let m;
            while ((m = re.exec(masked))) {
                const tag = m[2].toLowerCase(), close = !!m[1], self = !!m[4] || VOID.has(tag);
                const L = lineAt(m.index);
                const idm = /\sid\s*=\s*["']([^"']+)["']/i.exec(m[3]);
                if (idm && !close) { if (ids[idm[1]]) out.push({ file, line: L, sev: "warn", msg: `Повторяющийся id="${idm[1]}" (уже на стр. ${ids[idm[1]]})` }); else ids[idm[1]] = L; }
                if (tag === "img" && !close && !/\salt\s*=/.test(m[3])) out.push({ file, line: L, sev: "info", msg: "У <img> нет атрибута alt (доступность)" });
                if (self) continue;
                if (!close) { stack.push({ tag, line: L }); continue; }
                const at = stack.map(x => x.tag).lastIndexOf(tag);
                if (at < 0) { out.push({ file, line: L, sev: "warn", msg: `Лишний закрывающий тег </${tag}>` }); continue; }
                for (let k = stack.length - 1; k > at; k--) if (!OPTIONAL_CLOSE.has(stack[k].tag)) out.push({ file, line: stack[k].line, sev: "warn", msg: `Тег <${stack[k].tag}> не закрыт до </${tag}>` });
                stack.length = at;
            }
            stack.forEach(t => { if (!OPTIONAL_CLOSE.has(t.tag)) out.push({ file, line: t.line, sev: "warn", msg: `Тег <${t.tag}> не закрыт` }); });
            blocks.forEach(b => {
                if (b.tag === "script" && !/\bsrc\s*=/.test(b.attrs) && !/type\s*=\s*["']?(?!text\/javascript|module)[\w/+-]+/i.test(b.attrs)) out.push(...lintJS(b.inner, file, b.line));
                if (b.tag === "style") out.push(...lintCSS(b.inner, file, b.line));
            });
            return out;
        }
        function lintJSON(src, file) {
            if (!src.trim()) return [];
            try { JSON.parse(src); return []; }
            catch (err) {
                const m = /position (\d+)/.exec(err.message);
                const lm = /line (\d+)/.exec(err.message);
                const line = lm ? Number(lm[1]) : m ? src.slice(0, Number(m[1])).split("\n").length : 1;
                return [{ file, line, sev: "error", msg: "JSON: " + err.message.replace(/^JSON\.parse: /, "") }];
            }
        }
        function lintFile(f) {
            const src = P().files[f];
            const lang = A.langOf(f);
            if (src.length > 400000) return [];
            if (lang === "js") return lintJS(src, f, 0);
            if (lang === "css") return lintCSS(src, f, 0);
            if (lang === "html") return lintHTML(src, f);
            if (lang === "json") return lintJSON(src, f);
            return [];
        }
        function runLint() {
            clearTimeout(diag.timer);
            diag.timer = setTimeout(() => {
                if (!P()) return;
                diag.list = S().lint ? files().reduce((acc, f) => acc.concat(lintFile(f)), []) : [];
                diag.lines = {};
                diag.list.forEach(d => { if (d.file === ide.active && d.line) { const prev = diag.lines[d.line]; if (!prev || d.sev === "error") diag.lines[d.line] = d.sev === "info" ? "info" : d.sev; } });
                applyGutterMarks();
                renderProblemsPanel();
                scheduleDecor();
                drawMinimap();
            }, 350);
        }

        /* ================================================================
         * Мини-карта
         * ================================================================ */
        const mmCanvas = mmWrap.querySelector("canvas"), mmView = mmWrap.querySelector(".ide-mm-view");
        const mm = { scale: 2, raf: 0 };
        function themeRGB() {
            const cs = getComputedStyle(document.documentElement);
            return [cs.getPropertyValue("--color_r"), cs.getPropertyValue("--color_g"), cs.getPropertyValue("--color_b")].map(x => parseInt(x, 10) || 200).join(",");
        }
        function drawMinimap() {
            if (mm.raf) return;
            mm.raf = requestAnimationFrame(() => {
                mm.raf = 0;
                const on = S().minimap && !mobile() && !!ide.active;
                el.editor.classList.toggle("has-minimap", on);
                if (!on) return;
                const w = mmWrap.clientWidth, h = mmWrap.clientHeight;
                if (!w || !h) return;
                const dpr = Math.min(2, window.devicePixelRatio || 1);
                mmCanvas.width = w * dpr;
                mmCanvas.height = h * dpr;
                const g = mmCanvas.getContext("2d");
                g.setTransform(dpr, 0, 0, dpr, 0, 0);
                const lines = ta.value.split("\n");
                mm.scale = Math.max(0.6, Math.min(2.4, h / Math.max(1, lines.length)));
                const rgb = themeRGB();
                const cw = 0.9;
                const startLine = Math.max(0, Math.floor(mmOffset() / mm.scale));
                const maxLines = Math.ceil(h / mm.scale) + 1;
                for (let i = startLine; i < Math.min(lines.length, startLine + maxLines); i++) {
                    const ln = lines[i];
                    const y = (i - startLine) * mm.scale;
                    const t = ln.trim();
                    const com = /^(\/\/|\/\*|\*|<!--|#)/.test(t);
                    g.fillStyle = `rgba(${rgb},${com ? 0.25 : 0.6})`;
                    let x = -1, run = 0;
                    for (let c = 0; c <= Math.min(ln.length, 90); c++) {
                        const sp = c === Math.min(ln.length, 90) || ln[c] === " ";
                        if (!sp) { if (x < 0) x = c; run++; }
                        else if (run) { g.fillRect(6 + x * cw, y, run * cw, Math.max(1, mm.scale - 0.4)); x = -1; run = 0; }
                    }
                    const gm = gitMarks[i + 1];
                    if (gm) { g.fillStyle = gm === "del" ? "rgba(255,90,70,.9)" : `rgba(${rgb},${gm === "add" ? 1 : 0.7})`; g.fillRect(0, y, 3, Math.max(1, mm.scale)); }
                    const dg = diag.lines[i + 1];
                    if (dg === "error" || dg === "warn") { g.fillStyle = dg === "error" ? "rgba(255,80,60,.95)" : "rgba(255,200,60,.9)"; g.fillRect(w - 4, y, 4, Math.max(2, mm.scale)); }
                }
                updateMinimapView();
            });
        }
        function mmOffset() {
            const lines = ta.value.split("\n").length;
            const total = lines * mm.scale, h = mmWrap.clientHeight;
            if (total <= h) return 0;
            const maxScroll = Math.max(1, ta.scrollHeight - ta.clientHeight);
            return (ta.scrollTop / maxScroll) * (total - h);
        }
        function updateMinimapView() {
            if (!el.editor.classList.contains("has-minimap")) return;
            const off = mmOffset();
            const top = (ta.scrollTop / ide.lineH) * mm.scale - off;
            const hgt = (ta.clientHeight / ide.lineH) * mm.scale;
            mmView.style.transform = `translateY(${top}px)`;
            mmView.style.height = Math.max(8, hgt) + "px";
        }
        function mmScrollTo(clientY) {
            const r = mmWrap.getBoundingClientRect();
            const line = (clientY - r.top + mmOffset()) / mm.scale;
            ta.scrollTop = Math.max(0, line * ide.lineH - ta.clientHeight / 2);
            A.syncScroll();
        }
        mmWrap.addEventListener("pointerdown", e => {
            e.preventDefault();
            mmWrap.setPointerCapture(e.pointerId);
            mmScrollTo(e.clientY);
            const move = ev => mmScrollTo(ev.clientY);
            const up = () => { mmWrap.removeEventListener("pointermove", move); mmWrap.removeEventListener("pointerup", up); drawMinimap(); };
            mmWrap.addEventListener("pointermove", move);
            mmWrap.addEventListener("pointerup", up);
        });

        /* ================================================================
         * Автодополнение
         * ================================================================ */
        const acState = { open: false, items: [], sel: 0, start: 0, end: 0, ctx: null };
        let identCache = { key: "", list: [] };
        function projectIdents() {
            const key = P().id + ":" + P().updated;
            if (identCache.key === key) return identCache.list;
            const set = new Set();
            files().forEach(f => {
                const l = A.langOf(f);
                if (l !== "js" && l !== "html") return;
                const m = P().files[f].match(/[A-Za-z_$][\w$]{2,}/g) || [];
                for (const w of m) { if (set.size > 4000) break; set.add(w); }
            });
            identCache = { key, list: Array.from(set) };
            return identCache.list;
        }
        function regionLang(v, pos) {
            const lang = A.langOf(ide.active || "");
            if (lang !== "html") return lang;
            const before = v.slice(0, pos).toLowerCase();
            const so = before.lastIndexOf("<script"), sc = before.lastIndexOf("</script");
            if (so > sc && before.indexOf(">", so) >= 0) return "js";
            const yo = before.lastIndexOf("<style"), yc = before.lastIndexOf("</style");
            if (yo > yc && before.indexOf(">", yo) >= 0) return "css";
            return "html";
        }
        function acContext(force) {
            const v = ta.value, pos = ta.selectionStart;
            if (pos !== ta.selectionEnd) return null;
            const lang = regionLang(v, pos);
            const w = wordAt(v, pos);
            let start = w.start;
            const prefix = v.slice(start, pos);
            const lineStart = v.lastIndexOf("\n", pos - 1) + 1;
            const lineBefore = v.slice(lineStart, pos);
            const items = [];
            const push = (label, kind, insert, detail) => items.push({ label, kind, insert: insert === undefined ? label : insert, detail: detail || "" });
            if (lang === "js") {
                if (/\/\/.*$/.test(lineBefore) || (lineBefore.split(/(?<!\\)["'`]/).length % 2 === 0)) return null;
                const dot = v[start - 1] === ".";
                if (dot) {
                    const obj = (/([A-Za-z_$][\w$]*)\s*\.$/.exec(v.slice(Math.max(0, start - 40), start)) || [])[1];
                    (JS_MEMBERS[obj] || JS_MEMBERS["*"]).split(" ").forEach(x => push(x, "prop"));
                } else {
                    if (!force && prefix.length < 2) return null;
                    SNIPPETS.js.forEach(([k, body, d]) => push(k, "snip", body, d));
                    JS_KEYWORDS.forEach(x => push(x, "kw"));
                    JS_GLOBALS.forEach(x => push(x, "global"));
                    projectIdents().forEach(x => { if (x !== prefix) push(x, "var"); });
                }
            } else if (lang === "css") {
                const before = v.slice(0, pos);
                const depth = (before.match(/\{/g) || []).length - (before.match(/\}/g) || []).length;
                const wpos = /[\w-]*$/.exec(lineBefore);
                start = pos - wpos[0].length;
                const pre = wpos[0];
                if (!force && pre.length < 1) return null;
                if (depth > 0 && lineBefore.indexOf(":") < 0) {
                    CSS_PROPS.forEach(x => push(x, "prop", x + ": $1;", ""));
                    SNIPPETS.css.forEach(([k, body, d]) => push(k, "snip", body, d));
                } else if (depth > 0) CSS_VALUES.forEach(x => push(x, "val"));
                else { HTML_TAGS.forEach(x => push(x, "tag")); SNIPPETS.css.filter(s => s[0] === "media" || s[0] === "kf").forEach(([k, body, d]) => push(k, "snip", body, d)); }
                return finishAC(items, start, pos, pre, lang);
            } else if (lang === "html") {
                const lt = lineBefore.lastIndexOf("<"), gt = lineBefore.lastIndexOf(">");
                if (lt > gt) {
                    const inTag = lineBefore.slice(lt);
                    const tm = /^<\/?([\w-]*)$/.exec(inTag);
                    if (tm) {
                        const closing = inTag[1] === "/";
                        const wp = /[\w-]*$/.exec(lineBefore)[0];
                        start = pos - wp.length;
                        if (closing) {
                            const stack = [];
                            v.slice(0, pos).replace(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g, (m0, c, t, sc) => { t = t.toLowerCase(); if (sc || VOID.has(t)) return m0; if (c) { const k = stack.lastIndexOf(t); if (k >= 0) stack.length = k; } else stack.push(t); return m0; });
                            if (stack.length) push(stack[stack.length - 1], "tag", stack[stack.length - 1] + ">", "закрыть");
                            return finishAC(items, start, pos, wp, lang, true);
                        }
                        HTML_TAGS.forEach(x => push(x, "tag", VOID.has(x) ? x + "$1>" : x + ">$1</" + x + ">"));
                        return finishAC(items, start, pos, wp, lang, true);
                    }
                    const am = /\s([\w-]*)$/.exec(inTag);
                    if (am && !/=\s*["'][^"']*$/.test(inTag)) {
                        start = pos - am[1].length;
                        if (!force && !am[1].length) return null;
                        HTML_ATTRS.forEach(x => push(x, "attr", x.endsWith("-") ? x + "$1" : x + "=\"$1\""));
                        return finishAC(items, start, pos, am[1], lang);
                    }
                    return null;
                }
                if (!force) return null;
                SNIPPETS.html.filter(s => s[1]).forEach(([k, body, d]) => push(k, "snip", body, d));
            } else return null;
            return finishAC(items, start, pos, prefix, lang);
        }
        function finishAC(items, start, end, prefix, lang, keepAll) {
            const pl = prefix.toLowerCase();
            const seen = new Set();
            const scored = [];
            items.forEach(it => {
                if (seen.has(it.label) || (it.label === prefix && it.kind !== "snip")) return;
                seen.add(it.label);
                const ll = it.label.toLowerCase();
                let score;
                if (!pl) score = it.kind === "snip" ? 1 : 0;
                else if (ll.startsWith(pl)) score = 100 - ll.length + (it.label.startsWith(prefix) ? 5 : 0) + (it.kind === "snip" ? 8 : it.kind === "var" || it.kind === "global" ? 3 : 0);
                else { const m = fuzzy(pl, ll); if (!m || pl.length < 2) return; score = m.score; }
                scored.push({ it, score });
            });
            scored.sort((a, b) => b.score - a.score);
            const list = scored.slice(0, keepAll ? 14 : 12).map(x => x.it);
            if (!list.length) return null;
            return { items: list, start, end, lang };
        }
        const KIND_TAG = { kw: "kw", global: "G", var: "v", prop: "p", val: "=", tag: "<>", attr: "@", snip: "⧉" };
        function openAC(force) {
            if (!S().autocomplete && !force) return;
            const ctx = acContext(force);
            if (!ctx) { closeAC(); return; }
            acState.open = true;
            acState.items = ctx.items;
            acState.start = ctx.start;
            acState.sel = 0;
            acState.ctx = ctx;
            ac.innerHTML = ctx.items.map((it, i) => `<div class="ide-ac-item" role="option" id="ide-ac-${i}" data-i="${i}" aria-selected="${i === 0}">
                <span class="ide-ac-kind k-${it.kind}">${KIND_TAG[it.kind] || "•"}</span><span class="ide-ac-label">${esc(it.label)}</span>${it.detail ? `<i>${esc(it.detail)}</i>` : ""}</div>`).join("");
            ac.hidden = false;
            ta.setAttribute("aria-activedescendant", "ide-ac-0");
            const lc = lineCol(ta.value, ctx.start);
            const p = pxOf(lc.line, lc.col);
            const cw = code.clientWidth, ch = code.clientHeight;
            let x = p.x - ta.scrollLeft - 28, y = p.y - ta.scrollTop + ide.lineH + 2;
            ac.style.maxWidth = Math.min(360, cw - 8) + "px";
            const h = ac.offsetHeight, w = ac.offsetWidth;
            if (y + h > ch - 4 && p.y - ta.scrollTop - h - 2 > 0) y = p.y - ta.scrollTop - h - 2;
            ac.style.left = clamp(x, 2, Math.max(2, cw - w - 2)) + "px";
            ac.style.top = Math.max(2, y) + "px";
        }
        function closeAC() {
            if (!acState.open) return;
            acState.open = false;
            ac.hidden = true;
            ta.removeAttribute("aria-activedescendant");
        }
        function acMove(d) {
            const n = acState.items.length;
            acState.sel = (acState.sel + d + n) % n;
            $$(".ide-ac-item", ac).forEach(x => x.setAttribute("aria-selected", String(Number(x.dataset.i) === acState.sel)));
            const cur = ac.querySelector(`[data-i="${acState.sel}"]`);
            if (cur) cur.scrollIntoView({ block: "nearest" });
            ta.setAttribute("aria-activedescendant", "ide-ac-" + acState.sel);
        }
        function insertSnippet(start, end, body) {
            const v = ta.value;
            const ls = v.lastIndexOf("\n", start - 1) + 1;
            const indent = v.slice(ls, start).match(/^\s*/)[0];
            const u = A.unit();
            let text = body.replace(/\n/g, "\n" + indent).replace(/^ {2}/gm, m => m.length === 2 ? u : m);
            if (u !== "  ") text = text.replace(new RegExp("^(" + reEsc(indent) + ")((?:  )+)", "gm"), (m0, a, b) => a + u.repeat(b.length / 2));
            const at = text.indexOf("$1");
            text = text.replace("$1", "");
            A.replaceRange(start, end, text, start + (at >= 0 ? at : text.length));
        }
        function acAccept(i) {
            const it = acState.items[i === undefined ? acState.sel : i];
            if (!it) return;
            const end = ta.selectionStart;
            closeAC();
            if (it.kind === "snip" && it.insert === null) { expandEmmet(true); return; }
            insertSnippet(acState.start, end, it.insert);
            Sound.play("keyboard");
        }
        ac.addEventListener("mousedown", e => {
            e.preventDefault();
            const item = e.target.closest("[data-i]");
            if (item) acAccept(Number(item.dataset.i));
        });
        A.hooks.input.push(() => {
            if (vim.on && vim.mode !== "insert") return;
            const v = ta.value, pos = ta.selectionStart;
            const ch = v[pos - 1] || "";
            if (/[\w$.<-]/.test(ch) && S().autocomplete) openAC(false);
            else closeAC();
        });
        ta.addEventListener("blur", () => setTimeout(closeAC, 120));
        ta.addEventListener("mousedown", closeAC);

        /* ================================================================
         * Emmet (HTML): div.card>h2{Заголовок}+p*2  →  Tab
         * ================================================================ */
        const EMMET_ATTRS = { a: " href=\"$c\"", img: " src=\"$c\" alt=\"\"", input: " type=\"text\"", label: " for=\"\"", form: " action=\"\"", link: " rel=\"stylesheet\" href=\"$c\"", script: "", iframe: " src=\"$c\"", button: " type=\"button\"", meta: " charset=\"utf-8\"" };
        const EMMET_ALIAS = { "link:css": "link[rel=stylesheet href=style.css]", "script:src": "script[src=app.js]", "input:text": "input[type=text]", "input:email": "input[type=email]", "input:checkbox": "input[type=checkbox]", "btn": "button", "bq": "blockquote", "fig": "figure", "sect": "section", "art": "article", "hdr": "header", "ftr": "footer" };
        const BOILER = "<!DOCTYPE html>\n<html lang=\"ru\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Документ</title>\n</head>\n<body>\n  \u0001\n</body>\n</html>";
        function emmetParse(src) {
            let i = 0;
            const peek = () => src[i];
            function num() { let s = ""; while (/\d/.test(src[i] || "")) s += src[i++]; return s ? Number(s) : 1; }
            function element() {
                const node = { tag: "", id: "", cls: [], attrs: [], text: "", children: [], mult: 1 };
                if (peek() === "(") {
                    i++;
                    const group = expr();
                    if (src[i] !== ")") throw new Error("group");
                    i++;
                    node.group = group;
                } else {
                    let tag = "";
                    while (/[\w:-]/.test(src[i] || "")) tag += src[i++];
                    if (EMMET_ALIAS[tag]) { const sub = emmetParse(EMMET_ALIAS[tag]); return Object.assign(sub[0], { mult: 1 }); }
                    node.tag = tag;
                    for (;;) {
                        const c = peek();
                        if (c === "#") { i++; let s = ""; while (/[\w$-]/.test(src[i] || "")) s += src[i++]; node.id = s; }
                        else if (c === ".") { i++; let s = ""; while (/[\w$-]/.test(src[i] || "")) s += src[i++]; node.cls.push(s); }
                        else if (c === "[") { i++; let s = ""; while (i < src.length && src[i] !== "]") s += src[i++]; i++; s.replace(/([\w-]+)(?:=("[^"]*"|'[^']*'|[^\s]*))?/g, (m, k, val) => { node.attrs.push([k, val === undefined ? "" : val.replace(/^["']|["']$/g, "")]); return m; }); }
                        else if (c === "{") { i++; let s = "", d = 1; while (i < src.length) { if (src[i] === "{") d++; if (src[i] === "}" && --d === 0) break; s += src[i++]; } i++; node.text = s; }
                        else break;
                    }
                    if (!node.tag && !node.id && !node.cls.length && !node.attrs.length && !node.text) throw new Error("empty");
                }
                if (peek() === "*") { i++; node.mult = num(); }
                return node;
            }
            function expr() {
                const list = [element()];
                for (;;) {
                    const c = peek();
                    if (c === "+") { i++; list.push(element()); }
                    else if (c === ">") { i++; const last = list[list.length - 1]; const kids = expr(); (last.group ? last.group[last.group.length - 1] : last).children.push(...kids); }
                    else if (c === "^") { i++; return list.concat(expr()); }
                    else break;
                }
                return list;
            }
            const res = expr();
            if (i < src.length) throw new Error("rest");
            return res;
        }
        function emmetRender(nodes, depth, parentTag) {
            const u = A.unit();
            let out = "";
            nodes.forEach(n => {
                for (let k = 1; k <= n.mult; k++) {
                    const num = s => s.replace(/(\$+)/g, m => String(k).padStart(m.length, "0"));
                    if (n.group) { out += emmetRender(n.group.map(g => g), depth, parentTag); continue; }
                    const tag = n.tag || ({ ul: "li", ol: "li", table: "tr", tr: "td", select: "option" }[parentTag] || (/^(p|span|a|em|b|i|strong|label|button)$/.test(parentTag) ? "span" : "div"));
                    let attrs = "";
                    if (n.id) attrs += ` id="${num(n.id)}"`;
                    if (n.cls.length) attrs += ` class="${num(n.cls.join(" "))}"`;
                    n.attrs.forEach(([a, val]) => { attrs += ` ${a}="${num(val)}"`; });
                    const defaults = EMMET_ATTRS[tag] || "";
                    defaults.replace(/ ([\w-]+)="([^"]*)"/g, (m, a, val) => { if (!new RegExp(`\\s${a}=`).test(attrs)) attrs += ` ${a}="${val === "$c" ? "\u0001" : val}"`; return m; });
                    const pad = u.repeat(depth);
                    if (VOID.has(tag)) { out += `${pad}<${tag}${attrs}>\n`; continue; }
                    const text = num(n.text);
                    if (n.children.length) out += `${pad}<${tag}${attrs}>${text}\n${emmetRender(n.children, depth + 1, tag)}${pad}</${tag}>\n`;
                    else out += `${pad}<${tag}${attrs}>${text || "\u0001"}</${tag}>\n`;
                }
            });
            return out;
        }
        function expandEmmet(fromAc) {
            if (!S().emmet && !fromAc) return false;
            if (regionLang(ta.value, ta.selectionStart) !== "html") return false;
            const v = ta.value, pos = ta.selectionStart;
            if (pos !== ta.selectionEnd) return false;
            const ls = v.lastIndexOf("\n", pos - 1) + 1;
            const before = v.slice(ls, pos);
            let s = before.length, braces = 0;
            while (s > 0) {
                const c = before[s - 1];
                if (c === "}" || c === "]") braces++;
                else if (c === "{" || c === "[") braces--;
                else if (braces <= 0 && /[\s<>"'=;]/.test(c) && !(c === ">" && /[\w)\]}*$]/.test(before[s - 2] || "") && !/<[^>]*$/.test(before.slice(0, s - 1)))) break;
                s--;
            }
            const abbr = before.slice(s);
            if (!abbr || /^\d/.test(abbr) || /<[^>]*$/.test(before.slice(0, s))) return false;
            let text;
            if (abbr === "!" || abbr === "html:5") text = BOILER;
            else {
                if (!/[.#>*+\[{(]/.test(abbr) && HTML_TAGS.indexOf(abbr) < 0 && !EMMET_ALIAS[abbr]) return false;
                let tree;
                try { tree = emmetParse(abbr); } catch (err) { return false; }
                text = emmetRender(tree, 0, "").replace(/\n$/, "");
            }
            const indent = before.match(/^\s*/)[0];
            text = text.replace(/\n/g, "\n" + indent).replace(/^\s+$/gm, m => m);
            const cur = text.indexOf("\u0001");
            text = text.replace(/\u0001/g, "");
            const start = ls + s;
            A.replaceRange(start, pos, text, start + (cur >= 0 ? cur : text.length));
            Sound.play("keyboard");
            return true;
        }

        /* ================================================================
         * Vim-режим (как в Zed): NORMAL / INSERT / VISUAL / V-LINE
         * ================================================================ */
        const vim = { on: false, mode: "normal", pending: "", count: "", reg: "", regLine: false, anchor: 0, cur: 0, want: -1 };
        const lsOf = (v, p) => v.lastIndexOf("\n", p - 1) + 1;
        const leOf = (v, p) => { const e = v.indexOf("\n", p); return e < 0 ? v.length : e; };
        function vimSetMode(mode) {
            vim.mode = mode;
            vim.pending = "";
            vim.count = "";
            stVim.hidden = !vim.on;
            stVim.textContent = { normal: "NORMAL", insert: "INSERT", visual: "VISUAL", vline: "V-LINE" }[mode] || mode.toUpperCase();
            stVim.setAttribute("data-mode", mode);
            el.editor.classList.toggle("vim-block", vim.on && mode !== "insert");
            if (vim.on && mode === "normal") {
                const v = ta.value;
                let p = ta.selectionStart;
                if (ta.selectionEnd > p && ta.selectionDirection !== "backward") p = Math.max(ta.selectionStart, ta.selectionEnd - 1);
                const le = leOf(v, p);
                if (p >= le && p > lsOf(v, p)) p = le - 1;
                vimPut(p);
            }
            scheduleDecor();
        }
        function vimPut(p) {
            const v = ta.value;
            p = clamp(p, 0, v.length);
            vim.cur = p;
            if (vim.mode === "visual" || vim.mode === "vline") {
                let a = vim.anchor, b = p;
                if (vim.mode === "vline") {
                    const lo = Math.min(a, b), hi = Math.max(a, b);
                    ta.setSelectionRange(lsOf(v, lo), Math.min(v.length, leOf(v, hi) + 1), b < a ? "backward" : "forward");
                } else if (b >= a) ta.setSelectionRange(a, Math.min(v.length, b + 1), "forward");
                else ta.setSelectionRange(b, Math.min(v.length, a + 1), "backward");
            } else ta.setSelectionRange(p, p);
            A.revealSelection(p);
            A.updateCaret();
            scheduleDecor();
        }
        function drawVimCursor() {
            if (!vim.on || vim.mode === "insert" || !ide.active || wrapOn() || document.activeElement !== ta) return;
            const v = ta.value;
            const p = vim.mode === "normal" ? ta.selectionStart : vim.cur;
            const lc = lineCol(v, p);
            const xy = pxOf(lc.line, lc.col);
            const d = document.createElement("i");
            d.className = "vc";
            d.style.cssText = `transform:translate(${xy.x}px,${xy.y}px);width:${ide.charW}px;height:${ide.lineH}px`;
            decor.appendChild(d);
        }
        const WORD_RE = /[\w$]+|[^\w$\s]+/g;
        function vimMotion(k, p, n) {
            const v = ta.value;
            let ls = lsOf(v, p), le = leOf(v, p);
            const colOf = q => q - lsOf(v, q);
            for (let i = 0; i < n; i++) {
                ls = lsOf(v, p); le = leOf(v, p);
                if (k === "h" || k === "ArrowLeft") p = Math.max(ls, p - 1);
                else if (k === "l" || k === "ArrowRight") p = Math.min(Math.max(ls, le - (vim.mode === "normal" ? 1 : 0)), p + 1);
                else if (k === "j" || k === "k" || k === "ArrowDown" || k === "ArrowUp") {
                    const down = k === "j" || k === "ArrowDown";
                    if (vim.want < 0) vim.want = colOf(p);
                    if (down && le >= v.length) break;
                    if (!down && ls === 0) break;
                    const nls = down ? le + 1 : lsOf(v, ls - 1);
                    const nle = leOf(v, nls);
                    p = Math.min(nls + vim.want, Math.max(nls, nle - (vim.mode === "normal" ? 1 : 0)));
                    continue;
                } else if (k === "w") { WORD_RE.lastIndex = 0; let m, nx = v.length; while ((m = WORD_RE.exec(v))) { if (m.index > p) { nx = m.index; break; } } p = nx; }
                else if (k === "e") { WORD_RE.lastIndex = 0; let m, nx = p; while ((m = WORD_RE.exec(v))) { if (m.index + m[0].length - 1 > p) { nx = m.index + m[0].length - 1; break; } } p = nx; }
                else if (k === "b") { WORD_RE.lastIndex = 0; let m, nx = 0; while ((m = WORD_RE.exec(v))) { if (m.index >= p) break; nx = m.index; } p = nx; }
                else if (k === "0" || k === "Home") p = ls;
                else if (k === "^") p = ls + (v.slice(ls, le).match(/^\s*/)[0].length);
                else if (k === "$" || k === "End") p = Math.max(ls, le - (vim.mode === "normal" ? 1 : 0));
                else if (k === "G") { p = n > 1 ? posOf(v, n, 0) : lsOf(v, v.length); break; }
                else if (k === "gg") { p = posOf(v, n > 1 ? n : 1, 0); break; }
                else if (k === "}") { const m = /\n\s*\n/g; m.lastIndex = p + 1; const r = m.exec(v); p = r ? r.index + 1 : v.length; }
                else if (k === "{") { const before = v.slice(0, Math.max(0, p - 1)); const at = before.search(/\n\s*\n(?![\s\S]*\n\s*\n)/); p = at >= 0 ? at + 1 : 0; }
                else if (k === "%") { const br = matchBracket(v, p + 1) || matchBracket(v, p); if (br && br[1] >= 0) p = br[0] === p ? br[1] : br[0]; }
            }
            if (!/^(j|k|ArrowDown|ArrowUp)$/.test(k)) vim.want = -1;
            return p;
        }
        function vimYank(text, line) {
            vim.reg = text;
            vim.regLine = !!line;
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {});
        }
        function vimOperate(op, s, e, line) {
            const v = ta.value;
            if (e < s) { const t = s; s = e; e = t; }
            if (line) { s = lsOf(v, s); e = Math.min(v.length, leOf(v, e) + 1); if (e === v.length && s > 0 && v[e - 1] !== "\n") s--; }
            const text = v.slice(s, e);
            vimYank(line ? text.replace(/^\n/, "").replace(/\n?$/, "\n") : text, line);
            if (op === "y") { vimSetMode("normal"); vimPut(s); return; }
            if (op === "c" && line) {
                const indent = v.slice(lsOf(v, s === 0 ? 0 : s + (v[s] === "\n" ? 1 : 0)), e).match(/^[ \t]*/)[0];
                A.replaceRange(s, e, (s > 0 && v[s] === "\n" ? "\n" : "") + indent + (e < v.length ? "\n" : ""), s + (s > 0 && v[s] === "\n" ? 1 : 0) + indent.length);
                vimSetMode("insert");
                return;
            }
            A.replaceRange(s, e, "", s);
            if (op === "c") vimSetMode("insert");
            else { vimSetMode("normal"); vimPut(line ? s + (ta.value[s] === "\n" && s > 0 ? 1 : 0) : s); }
        }
        function vimKey(e) {
            const k = e.key;
            const v = ta.value;
            const p = vim.mode === "normal" ? ta.selectionStart : vim.cur;
            if (k === "Escape") { if (vim.mode !== "normal") vimSetMode("normal"); vim.pending = ""; vim.count = ""; return true; }
            if (e.ctrlKey || e.metaKey) {
                if (k === "r") { document.execCommand("redo"); vimSetMode("normal"); return true; }
                if (k === "d" || k === "u") { const n = Math.floor(ta.clientHeight / ide.lineH / 2); vimPut(vimMotion(k === "d" ? "j" : "k", p, n)); return true; }
                return false;
            }
            if (e.altKey) return false;
            if (k.length !== 1 && !/^Arrow|^Home$|^End$/.test(k)) return k !== "Tab" && k !== "Enter" && k !== "Backspace" ? false : true;
            if (/^[1-9]$/.test(k) || (k === "0" && vim.count)) { vim.count += k; return true; }
            const n = Number(vim.count || 1);
            const pend = vim.pending;
            vim.count = "";
            // Визуальный режим
            if (vim.mode === "visual" || vim.mode === "vline") {
                if (k === "d" || k === "x" || k === "y" || k === "c" || k === ">" || k === "<") {
                    const s = ta.selectionStart, en = ta.selectionEnd;
                    if (k === ">" || k === "<") { A.shiftLines(k === ">" ? 1 : -1); vimSetMode("normal"); return true; }
                    const op = k === "x" ? "d" : k;
                    if (vim.mode === "vline") vimOperate(op, s, Math.max(s, en - 1), true);
                    else vimOperate(op, s, en, false);
                    return true;
                }
                if (k === "v") { vimSetMode(vim.mode === "visual" ? "normal" : "visual"); if (vim.mode === "visual") vimPut(p); return true; }
                if (k === "V") { vimSetMode(vim.mode === "vline" ? "normal" : "vline"); if (vim.mode === "vline") vimPut(p); return true; }
                if (k === "o") { const a = vim.anchor; vim.anchor = vim.cur; vimPut(a); return true; }
                if (k === "g" && pend !== "g") { vim.pending = "g"; return true; }
                vim.pending = "";
                vimPut(vimMotion(pend === "g" && k === "g" ? "gg" : k, p, n));
                return true;
            }
            // Операторы d / c / y + движение
            if (pend === "d" || pend === "c" || pend === "y") {
                vim.pending = "";
                if (k === pend) {
                    const endLine = vimMotion("j", p, n - 1);
                    vimOperate(pend, p, endLine, true);
                    return true;
                }
                if (k === "i" || k === "a") { vim.pending = pend + k; return true; }
                if (k === "j" || k === "k") { vimOperate(pend, p, vimMotion(k, p, n), true); return true; }
                const m = k === "w" && pend === "c" ? "e" : k;
                let to = vimMotion(m === "g" ? "gg" : m, p, n);
                if (m === "e" || m === "$") to++;
                vimOperate(pend, p, to, false);
                return true;
            }
            if (/^[dcy][ia]$/.test(pend)) {
                vim.pending = "";
                const op = pend[0], around = pend[1] === "a";
                let s, en;
                if (k === "w") { const w = wordAt(v, p); s = w.start; en = w.end; if (around) while (/[ \t]/.test(v[en] || "")) en++; }
                else if ("([{)]}\"'`<>".indexOf(k) >= 0) {
                    const o = { ")": "(", "]": "[", "}": "{", ">": "<" }[k] || k;
                    const c = { "(": ")", "[": "]", "{": "}", "<": ">" }[o] || o;
                    if (o === c) { s = v.lastIndexOf(o, p - (v[p] === o ? 1 : 0)); en = v.indexOf(c, p + (v[p] === o ? 0 : 0) + (s === p ? 1 : 0)); if (en <= s) en = v.indexOf(c, s + 1); }
                    else { let d = 0; s = -1; for (let i = p; i >= 0; i--) { if (v[i] === c && i !== p) d++; else if (v[i] === o) { if (!d) { s = i; break; } d--; } } const br = s >= 0 ? matchBracket(v, s) : null; en = br ? br[1] : -1; }
                    if (s < 0 || en < 0) return true;
                    if (!around) { s++; } else en++;
                } else return true;
                vimOperate(op, s, en, false);
                return true;
            }
            if (pend === "g") { vim.pending = ""; if (k === "g") vimPut(vimMotion("gg", p, n > 1 ? n : 1)); else if (k === "d") exec("goto.def"); return true; }
            if (pend === "r") { vim.pending = ""; if (p < leOf(v, p)) { A.replaceRange(p, p + 1, k, p); vimPut(p); } return true; }
            switch (k) {
                case "i": vimSetMode("insert"); ta.setSelectionRange(p, p); return true;
                case "a": vimSetMode("insert"); { const q = Math.min(leOf(v, p), p + 1); ta.setSelectionRange(q, q); } return true;
                case "I": vimSetMode("insert"); { const q = vimMotion("^", p, 1); ta.setSelectionRange(q, q); } return true;
                case "A": vimSetMode("insert"); { const q = leOf(v, p); ta.setSelectionRange(q, q); } return true;
                case "o": case "O": {
                    const ls = lsOf(v, p), le = leOf(v, p);
                    const indent = v.slice(ls, le).match(/^[ \t]*/)[0];
                    vimSetMode("insert");
                    if (k === "o") A.replaceRange(le, le, "\n" + indent, le + 1 + indent.length);
                    else A.replaceRange(ls, ls, indent + "\n", ls + indent.length);
                    return true;
                }
                case "v": vim.anchor = p; vimSetMode("visual"); vimPut(p); return true;
                case "V": vim.anchor = p; vimSetMode("vline"); vimPut(p); return true;
                case "x": if (p < leOf(v, p)) { const e2 = Math.min(leOf(v, p), p + n); vimYank(v.slice(p, e2)); A.replaceRange(p, e2, "", p); vimPut(Math.min(p, Math.max(lsOf(ta.value, p), leOf(ta.value, p) - 1))); } return true;
                case "X": if (p > lsOf(v, p)) { const s2 = Math.max(lsOf(v, p), p - n); A.replaceRange(s2, p, "", s2); vimPut(s2); } return true;
                case "D": vimOperate("d", p, leOf(v, p), false); return true;
                case "C": vimOperate("c", p, leOf(v, p), false); return true;
                case "Y": vimOperate("y", p, p, true); return true;
                case "s": vimOperate("c", p, Math.min(leOf(v, p), p + n), false); return true;
                case "S": vimOperate("c", p, p, true); return true;
                case "J": { const le = leOf(v, p); if (le < v.length) { const m = /^\n[ \t]*/.exec(v.slice(le)); A.replaceRange(le, le + m[0].length, " ", le); vimPut(le); } return true; }
                case "p": case "P": {
                    if (!vim.reg) return true;
                    if (vim.regLine) {
                        const at = k === "p" ? Math.min(v.length, leOf(v, p) + 1) : lsOf(v, p);
                        let text = vim.reg.repeat(n);
                        if (at === v.length && v[v.length - 1] !== "\n") { text = "\n" + text.replace(/\n$/, ""); A.replaceRange(at, at, text, at + 1); }
                        else A.replaceRange(at, at, text, at);
                        vimPut(vimMotion("^", ta.selectionStart, 1));
                    } else {
                        const at = k === "p" && p < leOf(v, p) ? p + 1 : p;
                        const text = vim.reg.repeat(n);
                        A.replaceRange(at, at, text, at + text.length - 1);
                        vimPut(at + text.length - 1);
                    }
                    return true;
                }
                case "u": for (let i = 0; i < n; i++) document.execCommand("undo"); vimSetMode("normal"); return true;
                case "d": case "c": case "y": case "g": case "r": vim.pending = k; return true;
                case ">": case "<": A.shiftLines(k === ">" ? 1 : -1); vimSetMode("normal"); return true;
                case ":": openQO(":"); return true;
                case "/": A.openFind(false); return true;
                case "n": case "N": if (!el.find.hidden || el.findInput.value) { const b = $(k === "n" ? "#ide-find-next" : "#ide-find-prev"); if (b) b.click(); } return true;
                case "*": { const w = wordAt(v, p); if (!w.word) return true; const re = new RegExp("\\b" + reEsc(w.word) + "\\b", "g"); re.lastIndex = w.end; let m = re.exec(v); if (!m) { re.lastIndex = 0; m = re.exec(v); } if (m) vimPut(m.index); return true; }
                default: {
                    const to = vimMotion(k, p, n);
                    if (to !== p || /^[hjklwbe0^$G{}%]$|^Arrow|^Home$|^End$/.test(k)) vimPut(to);
                    return true;
                }
            }
        }
        function setVim(on) {
            vim.on = on;
            if (on) vimSetMode("normal");
            else { el.editor.classList.remove("vim-block"); stVim.hidden = true; scheduleDecor(); }
        }

        /* ================================================================
         * Форматирование документа (Shift+Alt+F, Format on Save)
         * ================================================================ */
        function reindentBraces(lines, u, base, cssMode) {
            let depth = 0, inComment = false;
            return lines.map(raw => {
                let t = raw.trim();
                if (!t) return "";
                if (cssMode && depth > 0 && /^[\w-]+\s*:(?!:)\s*/.test(t) && !/[{]\s*$/.test(t)) t = t.replace(/^([\w-]+)\s*:\s*/, "$1: ");
                const code = inComment ? "" : t.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "\"\"").replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
                const lead = (/^[)\]}]+/.exec(code.replace(/^\*\/?/, "")) || [""])[0].length;
                const cont = inComment && /^\*/.test(t) ? " " : "";
                const out = base + u.repeat(Math.max(0, depth - lead)) + cont + t;
                if (!inComment) {
                    for (const ch of code) { if ("([{".indexOf(ch) >= 0) depth++; else if (")]}".indexOf(ch) >= 0) depth = Math.max(0, depth - 1); }
                    if (/\/\*(?![\s\S]*\*\/)/.test(t.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, ""))) inComment = true;
                } else if (/\*\//.test(t)) inComment = false;
                return out;
            });
        }
        function formatHTML(src, u) {
            const lines = src.split("\n");
            const out = [];
            let depth = 0, block = null, blockLines = [], blockBase = "", pre = false;
            const flush = () => {
                if (!block) return;
                const res = reindentBraces(blockLines, u, blockBase, block === "style");
                out.push(...res);
                blockLines = [];
            };
            lines.forEach(raw => {
                const t = raw.trim();
                if (pre) { out.push(raw); if (/<\/(pre|textarea)>/i.test(t)) pre = false; return; }
                if (block) {
                    if (new RegExp("^</" + block + "\\s*>", "i").test(t)) { flush(); block = null; depth = Math.max(0, depth - 1); out.push(u.repeat(depth) + t); return; }
                    blockLines.push(raw);
                    return;
                }
                if (!t) { out.push(""); return; }
                const startsClose = /^<\/[\w-]+/.test(t) || /^-->/.test(t);
                if (startsClose) depth = Math.max(0, depth - 1);
                out.push(u.repeat(depth) + t);
                if (startsClose) depth++;
                const so = /^<(script|style)\b[^>]*>(?![\s\S]*<\/\1>)/i.exec(t);
                if (so) { block = so[1].toLowerCase(); blockBase = u.repeat(depth + 1); depth++; return; }
                if (/<(pre|textarea)\b[^>]*>(?![\s\S]*<\/\1>)/i.test(t)) { pre = true; return; }
                const clean = t.replace(/<!--[\s\S]*?-->/g, "").replace(/(["'])(?:(?!\1).)*\1/g, "\"\"");
                const re = /<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g;
                let m, delta = 0;
                while ((m = re.exec(clean))) {
                    const tag = m[2].toLowerCase();
                    if (VOID.has(tag) || m[3]) continue;
                    delta += m[1] ? -1 : 1;
                }
                if (startsClose) delta++;
                if (/<!--(?![\s\S]*-->)/.test(t)) delta++;
                if (/^-->/.test(t) || (/-->/.test(t) && !/<!--/.test(t))) delta--;
                depth = Math.max(0, depth + delta);
            });
            flush();
            return out.join("\n");
        }
        function formatText(path, src) {
            const lang = A.langOf(path);
            const u = A.unit();
            let out;
            if (lang === "json") {
                try { out = JSON.stringify(JSON.parse(src), null, u.length); } catch (err) { return null; }
            } else if (lang === "js") out = reindentBraces(src.split("\n"), u, "", false).join("\n");
            else if (lang === "css") out = reindentBraces(src.split("\n"), u, "", true).join("\n");
            else if (lang === "html") out = formatHTML(src, u);
            else if (lang === "md" || lang === "text") out = src.split("\n").map(l => l.replace(/[ \t]+$/, (m) => lang === "md" && m === "  " ? m : "")).join("\n");
            else return null;
            out = out.replace(/[ \t]+$/gm, m => (lang === "md" && m === "  ") ? m : "").replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
            return out;
        }
        function formatDocument(quiet) {
            if (!ide.active) return false;
            const src = ta.value;
            const out = formatText(ide.active, src);
            if (out === null) { if (!quiet) toast(A.langOf(ide.active) === "json" ? "JSON содержит ошибку — форматирование невозможно" : "Для этого типа файла форматирование не поддерживается", "warn"); return false; }
            if (out === src) { if (!quiet) toast("Файл уже отформатирован", "info", { ttl: 1500 }); return false; }
            const line = A.caretLine();
            const top = ta.scrollTop;
            A.replaceRange(0, src.length, out, 0);
            const pos = posOf(out, line, 0);
            const lead = (out.slice(pos).match(/^[ \t]*/) || [""])[0].length;
            ta.setSelectionRange(pos + lead, pos + lead);
            ta.scrollTop = top;
            A.syncScroll();
            A.updateCaret();
            if (!quiet) toast("Документ отформатирован", "ok", { ttl: 1500 });
            return true;
        }
        A.hooks.save.push(() => { if (S().formatOnSave && ide.active) formatDocument(true); });

        /* ================================================================
         * Перенос строк (Alt+Z)
         * ================================================================ */
        const wrapProbe = document.createElement("div");
        wrapProbe.className = "ide-wrap-probe";
        wrapProbe.setAttribute("aria-hidden", "true");
        code.appendChild(wrapProbe);
        function applyWrap() {
            const on = wrapOn();
            ta.setAttribute("wrap", on ? "soft" : "off");
            el.editor.classList.toggle("is-wrap", on);
            stWrap.textContent = on ? "Перенос: вкл" : "Перенос: выкл";
            stWrap.setAttribute("aria-pressed", String(on));
            if (!on) {
                el.hl.style.paddingRight = "";
                Array.prototype.forEach.call(el.gutter.children, s => { s.style.height = ""; });
            }
            A.renderCode();
            scheduleDecor();
        }
        function wrapGutter() {
            if (!wrapOn() || !ide.active) return;
            const sb = ta.offsetWidth - ta.clientWidth;
            el.hl.style.paddingRight = (parseFloat(getComputedStyle(ta).paddingRight) || 14) + sb + "px";
            const lines = ta.value.split("\n");
            if (lines.length > 4000) return;
            wrapProbe.style.width = ta.clientWidth + "px";
            wrapProbe.innerHTML = lines.map(l => `<div>${esc(l) || " "}</div>`).join("");
            const kids = wrapProbe.children, g = el.gutter.children;
            for (let i = 0; i < kids.length && i < g.length; i++) g[i].style.height = kids[i].offsetHeight + "px";
            wrapProbe.textContent = "";
        }
        stWrap.addEventListener("click", () => setOption("wordWrap", !S().wordWrap));

        /* ================================================================
         * Дзен-режим (Ctrl+K Z) — только код, без панелей
         * ================================================================ */
        function toggleZen(force) {
            const on = force === undefined ? !ideRoot.classList.contains("is-zen") : force;
            ideRoot.classList.toggle("is-zen", on);
            document.documentElement.classList.toggle("ide-zen-on", on);
            if (on) { if (mobile()) A.setPane("code"); toast("Дзен-режим: Esc или Ctrl+K Z — выход", "info", { ttl: 2200 }); }
            setTimeout(() => { A.syncScroll(); drawMinimap(); wrapGutter(); }, 60);
            Sound.play("panels");
        }
        document.addEventListener("keydown", e => {
            if (e.key === "Escape" && ideRoot.classList.contains("is-zen") && !modalOpen() && qo.hidden && !acState.open && !(vim.on && vim.mode !== "normal" && document.activeElement === ta)) {
                if (vim.on && document.activeElement === ta && vim.pending) return;
                toggleZen(false);
            }
        });

        /* ================================================================
         * Хлебные крошки: путь › символ под курсором
         * ================================================================ */
        let crumbSyms = [], crumbKey = "";
        function renderCrumbs() {
            if (!ide.active) { crumbs.innerHTML = ""; crumbs.hidden = true; return; }
            crumbs.hidden = false;
            const key = ide.active + ":" + (P().updated || 0);
            if (key !== crumbKey) { crumbSyms = symbolsOf(ide.active, ta.value); crumbKey = key; }
            const parts = ide.active.split("/");
            const sym = symbolAtLine(crumbSyms, A.caretLine());
            crumbs.innerHTML = `<button type="button" class="ide-crumb" data-crumb="project">${esc(P().name)}</button>`
                + parts.map((p, i) => `<span aria-hidden="true">›</span><button type="button" class="ide-crumb${i === parts.length - 1 ? " is-file" : ""}" data-crumb="${i === parts.length - 1 ? "file" : "dir"}">${esc(p)}</button>`).join("")
                + (sym ? `<span aria-hidden="true">›</span><button type="button" class="ide-crumb is-sym" data-crumb="sym"><span class="ide-qo-badge is-sym sym-${sym.kind}">${KIND_BADGE[sym.kind] || "•"}</span>${esc(sym.name)}</button>` : "");
        }
        crumbs.addEventListener("click", e => {
            const b = e.target.closest("[data-crumb]");
            if (!b) return;
            const k = b.dataset.crumb;
            if (k === "project") setSide("explorer", { show: true });
            else if (k === "dir" || k === "file") openQO("");
            else openQO("@");
        });

        /* ================================================================
         * Перехват клавиш в редакторе (до встроенных обработчиков ядра)
         * ================================================================ */
        el.editor.addEventListener("keydown", e => {
            if (e.target !== ta || e.isComposing || chordWait) return;
            const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
            if (acState.open) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") { stop(); acMove(e.key === "ArrowDown" ? 1 : -1); return; }
                if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { stop(); acAccept(); return; }
                if (e.key === "Escape") { stop(); closeAC(); return; }
                if (e.key === "PageDown" || e.key === "PageUp") { stop(); acMove(e.key === "PageDown" ? 5 : -5); return; }
            }
            if ((e.ctrlKey || e.metaKey) && e.code === "Space") { stop(); openAC(true); return; }
            if (vim.on) {
                if (vim.mode === "insert") {
                    if (e.key === "Escape" || (e.ctrlKey && e.key === "[")) { stop(); vimSetMode("normal"); return; }
                } else if (vimKey(e)) { stop(); return; }
            }
            if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && ta.selectionStart === ta.selectionEnd) {
                if (expandEmmet(false)) { stop(); return; }
                const v = ta.value, pos = ta.selectionStart;
                const w = /[\w$!:-]+$/.exec(v.slice(lsOf(v, pos), pos));
                if (w) {
                    const lang = regionLang(v, pos);
                    const snip = (SNIPPETS[lang] || []).find(s => s[0] === w[0] && s[1]);
                    if (snip) { stop(); insertSnippet(pos - w[0].length, pos, snip[1]); return; }
                }
            }
        }, true);
        ta.addEventListener("focus", () => { if (vim.on) scheduleDecor(); });
        ta.addEventListener("blur", () => { if (vim.on) setTimeout(scheduleDecor, 0); });
        ta.addEventListener("mouseup", () => {
            if (!vim.on || vim.mode === "insert") return;
            if (ta.selectionStart !== ta.selectionEnd && vim.mode === "normal") { vim.anchor = ta.selectionStart; vim.mode = "visual"; vimSetMode("visual"); vimPut(Math.max(ta.selectionStart, ta.selectionEnd - 1)); }
            else if (vim.mode === "normal") vimSetMode("normal");
        });

        /* ================================================================
         * Нижняя панель: Консоль / Терминал / Проблемы
         * ================================================================ */
        const termOut = $("#ide-term-out"), termInput = $("#ide-term-input"), termPs = $("#ide-term-ps");
        function setBtab(id, quiet) {
            if (["console", "terminal", "problems"].indexOf(id) < 0) id = "console";
            S().btab = id;
            $$("[data-btab]", btabs).forEach(b => b.setAttribute("aria-selected", String(b.dataset.btab === id)));
            $("#ide-console").setAttribute("data-btab", id);
            $("#ide-console-out").hidden = id !== "console";
            $("#ide-console-form").hidden = id !== "console";
            $("#ide-console-clear").hidden = id === "problems";
            term.hidden = id !== "terminal";
            probs.hidden = id !== "problems";
            el.runCol.classList.remove("is-console-hidden");
            if (!quiet) {
                A.saveSettings();
                if (mobile()) A.setPane("console");
                if (id === "terminal") setTimeout(() => termInput.focus(), 30);
                Sound.play("panels");
            }
            if (id === "terminal" && !termOut.children.length) termWelcome();
        }
        btabs.addEventListener("click", e => { const b = e.target.closest("[data-btab]"); if (b) setBtab(b.dataset.btab); });
        $("#ide-console-clear").addEventListener("click", e => {
            if (S().btab === "terminal") { e.stopImmediatePropagation(); termOut.textContent = ""; termInput.focus(); }
        }, true);
        function togglePanel() {
            const hidden = el.runCol.classList.toggle("is-console-hidden");
            if (!hidden && mobile()) A.setPane("console");
            Sound.play("panels");
        }

        /* ----- Проблемы: линтер + ошибки выполнения ----- */
        let runtimeErrs = [], probTimer = 0;
        function renderProblemsPanel() {
            clearTimeout(probTimer);
            probTimer = setTimeout(() => {
                const all = diag.list.concat(runtimeErrs);
                const errs = all.filter(d => d.sev === "error").length;
                const cnt = $("#ide-prob-count");
                cnt.textContent = String(all.length);
                cnt.setAttribute("data-sev", errs ? "error" : all.length ? "warn" : "ok");
                if (!all.length) { probs.innerHTML = `<li class="ide-prob-empty">${icon("checkmark", 16)} Проблем не найдено${S().lint ? "" : " (линтер выключен — включите на панели расширений)"}</li>`; return; }
                const byFile = {};
                all.forEach(d => { const f = d.file || "(выполнение)"; (byFile[f] = byFile[f] || []).push(d); });
                probs.innerHTML = Object.keys(byFile).sort().map(f => `<li class="ide-prob-file"><b>${esc(f)}</b><i>${byFile[f].length}</i>
                    <ul>${byFile[f].sort((a, b) => (a.line || 0) - (b.line || 0)).map(d => `<li><button type="button" class="ide-prob" data-sev="${d.sev}" ${d.file && d.line ? `data-f="${esc(d.file)}" data-l="${d.line}"` : ""}>
                        <span class="ide-prob-ic" aria-hidden="true">${d.sev === "error" ? "✕" : d.sev === "warn" ? "!" : "i"}</span><span>${esc(d.msg)}${d.runtime ? " <em>runtime</em>" : ""}</span>${d.line ? `<i>стр. ${d.line}</i>` : ""}</button></li>`).join("")}</ul></li>`).join("");
            }, 60);
        }
        probs.addEventListener("click", e => {
            const b = e.target.closest(".ide-prob[data-f]");
            if (b) A.gotoLine(b.dataset.f, Number(b.dataset.l));
        });
        $("#ide-st-problems").addEventListener("click", () => {
            if (!ide.errors && diag.list.length) setBtab("problems");
        });

        /* ----- Терминал: виртуальная оболочка над файлами проекта ----- */
        const tm = { cwd: "", hist: [], hi: 0 };
        function termPrint(text, cls) {
            const li = document.createElement("li");
            if (cls) li.className = "tm-" + cls;
            li.textContent = String(text);
            termOut.appendChild(li);
            while (termOut.children.length > 600) termOut.firstChild.remove();
            termOut.scrollTop = termOut.scrollHeight;
            return li;
        }
        function termHtml(html, cls) {
            const li = termPrint("", cls);
            li.innerHTML = html;
            termOut.scrollTop = termOut.scrollHeight;
            return li;
        }
        function termWelcome() {
            termPrint(`NEXUS shell 1.0 — виртуальный терминал проекта «${P() ? P().name : "—"}»`, "sys");
            termPrint("Файлы проекта доступны как файловая система. help — список команд.", "sys");
        }
        function updatePs() { termPs.textContent = `${me}@nexus:~${tm.cwd ? "/" + tm.cwd : ""}$`; }
        function normPath(arg) {
            const parts = (arg && arg[0] === "/" ? [] : tm.cwd ? tm.cwd.split("/") : []);
            String(arg || "").replace(/^~\/?/, "").split("/").forEach(seg => {
                if (!seg || seg === ".") return;
                if (seg === "..") parts.pop(); else parts.push(seg);
            });
            if (/^~/.test(arg || "")) return parts.slice(tm.cwd ? tm.cwd.split("/").length : 0).join("/");
            return parts.join("/");
        }
        const isFile = p => P().files[p] !== undefined;
        const isDir = p => p === "" || files().some(f => f.indexOf(p + "/") === 0);
        function listDir(dir) {
            const pre = dir ? dir + "/" : "";
            const dirs = new Set(), fl = [];
            files().forEach(f => {
                if (f.indexOf(pre) !== 0) return;
                const rest = f.slice(pre.length);
                const i = rest.indexOf("/");
                if (i >= 0) dirs.add(rest.slice(0, i)); else fl.push(rest);
            });
            return { dirs: Array.from(dirs).sort(), files: fl.sort() };
        }
        function tokenize(line) {
            const out = [];
            let cur = "", q = "", has = false;
            for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (q) { if (c === q) q = ""; else if (c === "\\" && q === "\"" && i + 1 < line.length) cur += line[++i]; else cur += c; continue; }
                if (c === "\"" || c === "'") { q = c; has = true; continue; }
                if (/\s/.test(c)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
                if (c === ">" ) { if (cur || has) out.push(cur); cur = ""; has = false; if (line[i + 1] === ">") { out.push(">>"); i++; } else out.push(">"); continue; }
                cur += c;
            }
            if (cur || has) out.push(cur);
            return out;
        }
        function renamePath(from, to) {
            const p = P();
            const moves = isFile(from) ? [[from, to]] : files().filter(f => f.indexOf(from + "/") === 0).map(f => [f, to + f.slice(from.length)]);
            for (const [a, b] of moves) {
                const v = A.validName(b, a);
                if (v.error) return `${b}: ${v.error}`;
            }
            moves.forEach(([a, b]) => {
                p.files[b] = p.files[a];
                delete p.files[a];
                p.open = p.open.map(x => x === a ? b : x);
                if (p.entry === a) p.entry = b;
                if (ide.active === a) ide.active = b;
                if (ide.previewFile === a) ide.previewFile = b;
            });
            p.updated = Date.now();
            A.renderExplorer();
            const cur = ide.active;
            ide.active = null;
            A.openFile(cur, { silent: true });
            A.scheduleSave();
            refreshGit();
            return null;
        }
        function removePath(path) {
            const p = P();
            const list = isFile(path) ? [path] : files().filter(f => f.indexOf(path + "/") === 0);
            list.forEach(f => { delete p.files[f]; });
            p.open = p.open.filter(f => p.files[f] !== undefined);
            if (ide.active && p.files[ide.active] === undefined) ide.active = p.open[p.open.length - 1] || null;
            if (!p.files[p.entry]) p.entry = Object.keys(p.files).find(f => /\.html?$/i.test(f)) || Object.keys(p.files)[0] || "";
            p.updated = Date.now();
            A.renderExplorer();
            const cur = ide.active;
            ide.active = null;
            A.openFile(cur, { silent: true });
            A.renderMeta();
            A.scheduleSave();
            refreshGit();
            return list.length;
        }
        function writeFile(path, text, append) {
            if (isFile(path)) {
                const next = append ? P().files[path] + text : text;
                if (path === ide.active) A.replaceRange(0, ta.value.length, next, ta.selectionStart);
                else { P().files[path] = next; P().updated = Date.now(); A.scheduleSave(); }
                A.renderExplorer();
                refreshGit();
                return null;
            }
            const v = A.validName(path);
            if (v.error) return v.error;
            P().files[v.name] = text;
            P().updated = Date.now();
            A.renderExplorer();
            A.scheduleSave();
            refreshGit();
            return null;
        }
        /* node: код выполняется в изолированном iframe без доступа к сайту */
        function runNode(source, label) {
            return new Promise(resolve => {
                const token = "nxn" + Math.random().toString(36).slice(2);
                const fr = document.createElement("iframe");
                fr.setAttribute("sandbox", "allow-scripts");
                fr.setAttribute("aria-hidden", "true");
                fr.tabIndex = -1;
                fr.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
                const prelude = "(function(){var T=" + JSON.stringify(token) + ";function s(l,a){var o=[];for(var i=0;i<a.length;i++){var x=a[i];try{o.push(typeof x==='string'?x:x instanceof Error?String(x):JSON.stringify(x,null,0)===undefined?String(x):JSON.stringify(x))}catch(e){o.push(String(x))}}parent.postMessage({__nxn:T,l:l,a:o},'*')}"
                    + "['log','info','warn','error','debug','table'].forEach(function(k){console[k]=function(){s(k==='table'?'log':k,arguments)}});"
                    + "window.onerror=function(m,u,l){s('error',[String(m).replace(/^Uncaught /,'Uncaught ')+(l?' (стр. '+l+')':'')]);return true};"
                    + "window.addEventListener('unhandledrejection',function(e){s('error',['Unhandled rejection: '+(e.reason&&e.reason.message||e.reason)])});"
                    + "window.process={argv:['node'," + JSON.stringify(label) + "],env:{NODE_ENV:'development'},platform:'browser',version:'v20-nexus',exit:function(){},cwd:function(){return '/'}};"
                    + "window.module={exports:{}};window.exports=window.module.exports;"
                    + "window.require=function(n){throw new Error(\"require('\"+n+\"'): модули Node.js недоступны в браузере\")};})();";
                const doneJs = "parent.postMessage({__nxn:" + JSON.stringify(token) + ",done:1},'*')";
                const safe = s => s.replace(/<\/script/gi, "<\\/script");
                fr.srcdoc = "<!DOCTYPE html><meta charset=\"utf-8\"><script>" + prelude + "<\/script><script>\n" + safe(source) + "\n<\/script><script>" + doneJs + "<\/script>";
                let finished = false, count = 0;
                const finish = () => { if (finished) return; finished = true; window.removeEventListener("message", onMsg); fr.remove(); resolve(count); };
                const onMsg = e => {
                    const d = e.data;
                    if (!d || d.__nxn !== token || e.source !== fr.contentWindow) return;
                    if (d.done) { setTimeout(finish, 1200); return; }
                    count++;
                    termPrint((d.a || []).join(" "), d.l === "error" ? "err" : d.l === "warn" ? "warn" : "out");
                };
                window.addEventListener("message", onMsg);
                document.body.appendChild(fr);
                setTimeout(finish, 5000);
            });
        }
        const TERM_HELP = [
            ["ls [-l] [папка]", "список файлов"], ["tree", "дерево проекта"], ["cd / pwd", "сменить / показать папку"],
            ["cat | head | tail | wc ФАЙЛ", "вывести файл / начало / конец / счётчики"], ["touch ФАЙЛ", "создать файл"],
            ["rm [-r] ПУТЬ", "удалить файл или папку"], ["mv ИЗ В / cp ИЗ В", "переименовать / копировать"],
            ["echo ТЕКСТ [> | >> ФАЙЛ]", "вывести или записать в файл"], ["grep [-i] ШАБЛОН [ПУТЬ]", "поиск по файлам"],
            ["find [ИМЯ]", "найти файлы по имени"], ["open ФАЙЛ", "открыть в редакторе"], ["run [ФАЙЛ]", "запустить превью"],
            ["node ФАЙЛ.js | node -e \"код\"", "выполнить JS в изолированной песочнице"], ["format [ФАЙЛ]", "отформатировать"],
            ["git status|log|diff|add|commit -m|restore|branch", "локальный git проекта"], ["theme [имя]", "сменить тему сайта"],
            ["clear / history / date / whoami / exit", "служебные"]
        ];
        const UNAVAILABLE = /^(npm|npx|yarn|pnpm|bun|deno|pip|pip3|python|python3|cargo|rustc|go|java|javac|gcc|g\+\+|make|docker|kubectl|ssh|scp|sudo|apt|apt-get|brew|curl|wget|vim|nano|code|zed)$/;
        async function termRun(raw) {
            const line = raw.trim();
            termHtml(`<span class="tm-ps">${esc(termPs.textContent)}</span> ${esc(line)}`, "cmd");
            if (!line) return;
            if (tm.hist[tm.hist.length - 1] !== line) tm.hist.push(line);
            if (tm.hist.length > 100) tm.hist.shift();
            tm.hi = tm.hist.length;
            const args = tokenize(line);
            const c = args.shift();
            const flags = args.filter(a => /^-\w/.test(a));
            const pos = args.filter(a => !/^-\w/.test(a));
            const need = (n, usage) => { if (pos.length < n) { termPrint("использование: " + usage, "warn"); return false; } return true; };
            const fileArg = (a) => { const p = normPath(a); if (!isFile(p)) { termPrint(`${c}: ${a}: нет такого файла`, "err"); return null; } return p; };
            switch (c) {
                case "help": case "?":
                    TERM_HELP.forEach(([a, b]) => termHtml(`<b>${esc(a)}</b> <i>— ${esc(b)}</i>`, "out"));
                    termPrint("Tab — дополнение, ↑/↓ — история, Ctrl+L — очистить.", "sys");
                    break;
                case "clear": case "cls": termOut.textContent = ""; break;
                case "pwd": termPrint("/" + tm.cwd); break;
                case "whoami": termPrint(me); break;
                case "date": termPrint(new Date().toString()); break;
                case "history": tm.hist.forEach((h, i) => termPrint(`${String(i + 1).padStart(4)}  ${h}`)); break;
                case "exit": setBtab("console"); break;
                case "cd": {
                    const p = pos[0] === undefined ? "" : normPath(pos[0]);
                    if (!isDir(p)) termPrint(`cd: ${pos[0]}: нет такой папки`, "err");
                    else { tm.cwd = p; updatePs(); }
                    break;
                }
                case "ls": case "dir": case "ll": {
                    const p = pos[0] === undefined ? tm.cwd : normPath(pos[0]);
                    if (isFile(p)) { termPrint(p.split("/").pop()); break; }
                    if (!isDir(p)) { termPrint(`ls: ${pos[0]}: нет такого файла или папки`, "err"); break; }
                    const l = listDir(p);
                    const long = c === "ll" || flags.some(f => f.indexOf("l") >= 0);
                    if (long) {
                        l.dirs.forEach(d => termHtml(`drwxr-xr-x  ${"-".padStart(8)}  <b class="tm-dir">${esc(d)}/</b>`));
                        l.files.forEach(f => { const full = (p ? p + "/" : "") + f; termHtml(`-rw-r--r--  ${String(IDEStore.utf8Len(P().files[full])).padStart(8)}  ${esc(f)}${full === P().entry ? " <i>← точка входа</i>" : ""}`); });
                        termPrint(`итого: ${l.dirs.length + l.files.length}`, "sys");
                    } else termHtml(l.dirs.map(d => `<b class="tm-dir">${esc(d)}/</b>`).concat(l.files.map(esc)).join("   ") || "<i>(пусто)</i>");
                    break;
                }
                case "tree": {
                    const walk = (dir, pre) => {
                        const l = listDir(dir);
                        const all = l.dirs.map(d => [d, true]).concat(l.files.map(f => [f, false]));
                        all.forEach(([n, d], i) => {
                            const last = i === all.length - 1;
                            termHtml(`${esc(pre)}${last ? "└── " : "├── "}${d ? `<b class="tm-dir">${esc(n)}/</b>` : esc(n)}`);
                            if (d) walk((dir ? dir + "/" : "") + n, pre + (last ? "    " : "│   "));
                        });
                    };
                    termPrint(P().name);
                    walk(tm.cwd, "");
                    break;
                }
                case "cat": case "head": case "tail": case "wc": {
                    if (!need(1, c + " ФАЙЛ")) break;
                    const f = fileArg(pos[pos.length - 1]);
                    if (!f) break;
                    const text = P().files[f];
                    if (c === "wc") { termPrint(`${String(text.split("\n").length).padStart(6)} ${String((text.match(/\S+/g) || []).length).padStart(6)} ${String(IDEStore.utf8Len(text)).padStart(7)} ${f}`); break; }
                    const nArg = flags.find(x => /^-n?\d+$/.test(x)) || (flags.indexOf("-n") >= 0 ? "-" + pos[0] : "");
                    const n = Number((nArg.match(/\d+/) || [10])[0]);
                    let lines = text.split("\n");
                    if (c === "head") lines = lines.slice(0, n);
                    if (c === "tail") lines = lines.slice(-n);
                    if (c === "cat" && lines.length > 400) { lines = lines.slice(0, 400); lines.push(`… ещё ${text.split("\n").length - 400} строк (откройте: open ${f})`); }
                    lines.forEach(l => termPrint(l));
                    break;
                }
                case "touch": case "mkdir": {
                    if (!need(1, c + (c === "touch" ? " ФАЙЛ" : " ПАПКА"))) break;
                    if (c === "mkdir") { termPrint("Папки создаются автоматически вместе с файлом: touch " + normPath(pos[0]) + "/index.js", "warn"); break; }
                    pos.forEach(a => { const p = normPath(a); if (isFile(p)) return; const err = writeFile(p, ""); if (err) termPrint(`touch: ${a}: ${err}`, "err"); });
                    break;
                }
                case "rm": case "del": {
                    if (!need(1, "rm [-r] ПУТЬ")) break;
                    pos.forEach(a => {
                        const p = normPath(a);
                        if (isFile(p)) { removePath(p); termPrint(`удалён ${p}`, "ok"); }
                        else if (isDir(p) && p) { if (!flags.some(f => /r/i.test(f))) termPrint(`rm: ${a}: это папка (используйте rm -r)`, "err"); else termPrint(`удалено файлов: ${removePath(p)}`, "ok"); }
                        else termPrint(`rm: ${a}: нет такого файла`, "err");
                    });
                    break;
                }
                case "mv": case "cp": {
                    if (!need(2, c + " ИЗ В")) break;
                    const from = normPath(pos[0]);
                    let to = normPath(pos[1]);
                    if (!isFile(from) && !(isDir(from) && from)) { termPrint(`${c}: ${pos[0]}: нет такого файла`, "err"); break; }
                    if (isDir(to) && !isFile(to) && (to || pos[1] === "." || pos[1] === "/")) to = (to ? to + "/" : "") + from.split("/").pop();
                    if (c === "mv") { const err = renamePath(from, to); termPrint(err ? "mv: " + err : `${from} → ${to}`, err ? "err" : "ok"); }
                    else {
                        if (!isFile(from)) { termPrint("cp: копирование папок не поддерживается", "warn"); break; }
                        const err = writeFile(to, P().files[from]);
                        termPrint(err ? "cp: " + err : `${from} → ${to}`, err ? "err" : "ok");
                    }
                    break;
                }
                case "echo": {
                    const gi = args.findIndex(a => a === ">" || a === ">>");
                    if (gi >= 0) {
                        const target = args[gi + 1];
                        if (!target) { termPrint("echo: не указан файл после >", "err"); break; }
                        const err = writeFile(normPath(target), args.slice(0, gi).join(" ") + "\n", args[gi] === ">>");
                        if (err) termPrint("echo: " + err, "err");
                    } else termPrint(args.join(" "));
                    break;
                }
                case "grep": case "rg": {
                    if (!need(1, "grep [-i] ШАБЛОН [ПУТЬ]")) break;
                    let re;
                    try { re = new RegExp(pos[0], flags.some(f => /i/.test(f)) ? "i" : ""); } catch (err) { termPrint("grep: " + err.message, "err"); break; }
                    const base = pos[1] ? normPath(pos[1]) : tm.cwd;
                    const list = isFile(base) ? [base] : files().filter(f => !base || f.indexOf(base + "/") === 0);
                    let hits = 0;
                    list.forEach(f => P().files[f].split("\n").forEach((l, i) => {
                        if (hits >= 200 || !re.test(l)) return;
                        hits++;
                        termHtml(`<button type="button" class="tm-link" data-f="${esc(f)}" data-l="${i + 1}">${esc(f)}:${i + 1}</button>: ${esc(l.trim().slice(0, 160)).replace(new RegExp(reEsc(esc(pos[0])), "gi"), m => `<mark>${m}</mark>`)}`);
                    }));
                    if (!hits) termPrint("совпадений нет", "sys");
                    break;
                }
                case "find": {
                    const q = (pos[0] || "").replace(/\*/g, "");
                    const list = files().filter(f => f.toLowerCase().indexOf(q.toLowerCase()) >= 0);
                    list.forEach(f => termHtml(`<button type="button" class="tm-link" data-f="${esc(f)}" data-l="1">${esc(f)}</button>`));
                    if (!list.length) termPrint("ничего не найдено", "sys");
                    break;
                }
                case "open": case "code": {
                    if (!need(1, "open ФАЙЛ")) break;
                    const f = fileArg(pos[0]);
                    if (f) { A.openFile(f); termPrint(`открыт ${f}`, "ok"); }
                    break;
                }
                case "run": case "serve": {
                    const f = pos[0] ? fileArg(pos[0]) : null;
                    if (pos[0] && !f) break;
                    A.run(f, { manual: true });
                    termPrint(`▶ превью: ${f || ide.previewFile || P().entry}`, "ok");
                    break;
                }
                case "format": case "prettier": {
                    const f = pos[0] ? fileArg(pos[0]) : ide.active;
                    if (!f) break;
                    if (f === ide.active) { termPrint(formatDocument(true) ? `${f}: отформатирован` : `${f}: без изменений`, "ok"); break; }
                    const out = formatText(f, P().files[f]);
                    if (out === null) { termPrint(`${f}: формат не поддерживается или есть ошибка`, "warn"); break; }
                    writeFile(f, out);
                    termPrint(`${f}: отформатирован`, "ok");
                    break;
                }
                case "node": {
                    let source, label;
                    const ei = args.indexOf("-e");
                    if (ei >= 0) { source = args.slice(ei + 1).join(" "); label = "[eval]"; if (!/console\.|;/.test(source)) source = "console.log(" + source + ")"; }
                    else if (pos[0]) { const f = fileArg(pos[0]); if (!f) break; source = P().files[f]; label = f; }
                    else { termPrint("Интерактивный режим недоступен. Используйте node файл.js или node -e \"код\"", "warn"); break; }
                    termInput.disabled = true;
                    const n = await runNode(source, label);
                    termInput.disabled = false;
                    termInput.focus();
                    if (!n) termPrint("(нет вывода)", "sys");
                    break;
                }
                case "theme": {
                    if (!NX.Theme) break;
                    if (!pos[0]) { termPrint("Текущая тема: " + NX.Theme.current() + ". Доступны: " + NX.Theme.list().join(", ")); break; }
                    const id = NX.Theme.resolve(pos[0]);
                    if (!id) termPrint(`theme: «${pos[0]}» не найдена. Похожие: ${NX.Theme.suggest(pos[0]).join(", ") || "—"}`, "err");
                    else { NX.Theme.set(id); termPrint("Тема: " + id, "ok"); }
                    break;
                }
                case "git": gitCmd(args, flags); break;
                default:
                    if (UNAVAILABLE.test(c)) termPrint(`${c}: недоступно в браузерной песочнице — нужна локальная система. В NEXUS IDE доступны: node, git, ls, cat, grep… (help)`, "warn");
                    else termPrint(`${c}: команда не найдена. Введите help`, "err");
            }
        }
        function gitCmd(args) {
            const sub = args[0];
            const g = gitOf();
            const ch = gitChanges();
            const L = { A: "новый файл:", M: "изменён:   ", D: "удалён:    " };
            switch (sub) {
                case undefined: case "help":
                    termPrint("git status | log [--oneline] | diff [файл] | add . | commit -m \"msg\" | restore ФАЙЛ | branch | show | push | pull | fetch | clone");
                    break;
                case "status": case "st":
                    termPrint(`На ветке ${g.branch}`);
                    if (!ch.length) termPrint("нечего коммитить, рабочее дерево чистое", "ok");
                    else { termPrint("Изменения, которые не в коммите:"); ch.forEach(c => termPrint(`        ${L[c.s]} ${c.f}`, c.s === "D" ? "err" : "warn")); }
                    break;
                case "log": {
                    const one = args.indexOf("--oneline") >= 0;
                    g.commits.slice().reverse().forEach((c, i) => {
                        if (one) termHtml(`<b class="tm-hash">${esc(c.id.slice(0, 7))}</b> ${i === 0 ? '<i>(HEAD -> ' + esc(g.branch) + ')</i> ' : ""}${esc(c.msg)}`);
                        else { termHtml(`<b class="tm-hash">commit ${esc(c.id)}</b>${i === 0 ? " <i>(HEAD -> " + esc(g.branch) + ")</i>" : ""}`); termPrint(`Author: ${c.author || me} <${(c.author || me).toLowerCase()}@nexus.local>`); termPrint(`Date:   ${new Date(c.time).toString()}`); termPrint(""); termPrint("    " + c.msg); termPrint(""); }
                    });
                    break;
                }
                case "diff": {
                    const target = args[1] ? normPath(args[1]) : null;
                    const list = ch.filter(c => !target || c.f === target);
                    if (!list.length) { termPrint("изменений нет", "sys"); break; }
                    list.forEach(c => {
                        termHtml(`<b>diff --git a/${esc(c.f)} b/${esc(c.f)}</b>`);
                        const ops = diffLines(headFiles()[c.f] || "", P().files[c.f] || "");
                        let shown = 0;
                        ops.forEach((o, i) => {
                            if (shown > 300) return;
                            const near = ops.slice(Math.max(0, i - 2), i + 3).some(x => x.t !== "=");
                            if (!near) return;
                            shown++;
                            termPrint((o.t === "=" ? " " : o.t) + o.text, o.t === "+" ? "ok" : o.t === "-" ? "err" : "out");
                        });
                    });
                    break;
                }
                case "add": termPrint(ch.length ? `проиндексировано изменений: ${ch.length} (в NEXUS IDE индекс общий для всех файлов)` : "нечего добавлять", "sys"); break;
                case "commit": {
                    const mi = args.findIndex(a => a === "-m" || a === "-am");
                    const msg = mi >= 0 ? args.slice(mi + 1).join(" ") : "";
                    if (!msg) { termPrint("укажите сообщение: git commit -m \"текст\"", "warn"); break; }
                    $("#ide-git-msg").value = msg;
                    commit();
                    break;
                }
                case "restore": case "checkout": {
                    const files2 = args.slice(1).filter(a => a !== "--");
                    if (!files2.length) { termPrint(sub === "checkout" ? "переключение веток недоступно — в проекте одна ветка main" : "укажите файл: git restore ФАЙЛ", "warn"); break; }
                    files2.forEach(a => {
                        const p = a === "." ? null : normPath(a);
                        const list = p ? ch.filter(c => c.f === p) : ch;
                        if (!list.length) termPrint(`${a}: нет изменений`, "sys");
                        list.forEach(c => { discard(c.f); termPrint(`восстановлен ${c.f}`, "ok"); });
                    });
                    break;
                }
                case "branch": termHtml(`* <b class="tm-hash">${esc(g.branch)}</b>`); break;
                case "show": { const c = g.commits[g.commits.length - 1]; termPrint(`commit ${c.id}  ${c.msg}  (${Object.keys(c.files).length} файлов)`); break; }
                case "remote": termPrint("удалённые репозитории не настроены (работа с git-серверами недоступна в браузере)", "warn"); break;
                case "push": case "pull": case "fetch": case "clone":
                    termPrint(`fatal: git ${sub}: нет сетевого доступа к git-серверу из браузерной песочницы. Используйте «Скачать ZIP».`, "err");
                    break;
                default: termPrint(`git: «${sub}» не поддерживается. git help`, "err");
            }
            renderGit();
        }
        const TERM_CMDS = ["help", "ls", "ll", "tree", "cd", "pwd", "cat", "head", "tail", "wc", "touch", "mkdir", "rm", "mv", "cp", "echo", "grep", "find", "open", "run", "format", "node", "git", "theme", "clear", "history", "date", "whoami", "exit"];
        const GIT_SUBS = ["status", "log", "diff", "add", "commit", "restore", "checkout", "branch", "show", "push", "pull", "fetch", "clone", "remote"];
        function termComplete() {
            const v = termInput.value;
            const parts = v.split(/\s+/);
            const last = parts[parts.length - 1];
            let cands;
            if (parts.length === 1) cands = TERM_CMDS.filter(c => c.indexOf(last) === 0);
            else if (parts[0] === "git" && parts.length === 2) cands = GIT_SUBS.filter(c => c.indexOf(last) === 0);
            else {
                const slash = last.lastIndexOf("/");
                const dirPart = slash >= 0 ? last.slice(0, slash + 1) : "";
                const base = normPath(dirPart || ".");
                const l = listDir(isDir(base) ? base : tm.cwd);
                const namePart = last.slice(slash + 1);
                cands = l.dirs.map(d => dirPart + d + "/").concat(l.files.map(f => dirPart + f)).filter(x => x.slice(dirPart.length).indexOf(namePart) === 0);
            }
            if (!cands.length) return;
            if (cands.length === 1) { parts[parts.length - 1] = cands[0] + (/\/$/.test(cands[0]) ? "" : " "); termInput.value = parts.join(" "); return; }
            let pre = cands[0];
            cands.forEach(c => { while (c.indexOf(pre) !== 0) pre = pre.slice(0, -1); });
            if (pre.length > last.length) { parts[parts.length - 1] = pre; termInput.value = parts.join(" "); }
            else termPrint(cands.join("   "), "sys");
        }
        $("#ide-term-form").addEventListener("submit", e => {
            e.preventDefault();
            const v = termInput.value;
            termInput.value = "";
            termRun(v).catch(err => termPrint(String(err && err.message || err), "err"));
        });
        termInput.addEventListener("keydown", e => {
            if (e.key === "Tab") { e.preventDefault(); termComplete(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); if (tm.hi > 0) { tm.hi--; termInput.value = tm.hist[tm.hi] || ""; } }
            else if (e.key === "ArrowDown") { e.preventDefault(); if (tm.hi < tm.hist.length) { tm.hi++; termInput.value = tm.hist[tm.hi] || ""; } }
            else if (e.ctrlKey && (e.key === "l" || e.key === "L")) { e.preventDefault(); termOut.textContent = ""; }
            else if (e.ctrlKey && (e.key === "c" || e.key === "C") && termInput.selectionStart === termInput.selectionEnd) { e.preventDefault(); termHtml(`<span class="tm-ps">${esc(termPs.textContent)}</span> ${esc(termInput.value)}^C`, "cmd"); termInput.value = ""; }
        });
        termOut.addEventListener("click", e => {
            const b = e.target.closest(".tm-link");
            if (b) A.gotoLine(b.dataset.f, Number(b.dataset.l));
            else if (!window.getSelection().toString()) termInput.focus();
        });

        /* ================================================================
         * Превью: размеры устройств, новая вкладка, ссылка на проект
         * ================================================================ */
        const DEVICES = { auto: null, desktop: [1280, 800], tablet: [768, 1024], phone: [390, 844] };
        const pvBox = $("#ide-preview");
        function applyDevice() {
            const d = DEVICES[S().device] !== undefined ? S().device : "auto";
            $$("[data-device]", dev).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.device === d)));
            pvBox.setAttribute("data-device", d);
            const fr = el.frame;
            if (!DEVICES[d]) { fr.style.cssText = ""; devLabel.textContent = ""; return; }
            const [w, h] = DEVICES[d];
            const cw = Math.max(50, pvBox.clientWidth - 16), ch = Math.max(50, pvBox.clientHeight - 30);
            const sc = Math.min(1, cw / w, ch / h);
            fr.style.cssText = `position:absolute;left:50%;top:8px;width:${w}px;height:${h}px;transform:translateX(-50%) scale(${sc});transform-origin:top center`;
            devLabel.textContent = `${w} × ${h} · ${Math.round(sc * 100)}%`;
        }
        dev.addEventListener("click", e => {
            const b = e.target.closest("[data-device]");
            if (!b) return;
            S().device = b.dataset.device;
            applyDevice();
            A.saveSettings();
            Sound.play("folder");
        });
        if (window.ResizeObserver) new ResizeObserver(() => applyDevice()).observe(pvBox);
        function openInNewTab() {
            if (!P()) return;
            const entry = ide.previewFile || P().entry;
            if (!entry || P().files[entry] === undefined) { toast("Нет точки входа для превью", "warn"); return; }
            const doc = A.buildDoc(entry);
            const url = URL.createObjectURL(new Blob([doc.html], { type: "text/html;charset=utf-8" }));
            const w = window.open(url, "_blank");
            if (!w) toast("Браузер заблокировал новую вкладку — разрешите всплывающие окна", "warn");
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
        newTab.addEventListener("click", openInNewTab);

        function b64u(bytes) {
            let s = "";
            for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        }
        function unb64u(str) {
            const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
            const out = new Uint8Array(s.length);
            for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
            return out;
        }
        async function encodeProject(p) {
            const payload = new TextEncoder().encode(JSON.stringify({ v: 1, n: p.name, e: p.entry, f: p.files }));
            if (window.CompressionStream) {
                try {
                    const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream("deflate-raw"));
                    return "z" + b64u(new Uint8Array(await new Response(stream).arrayBuffer()));
                } catch (err) { /* без сжатия */ }
            }
            return "r" + b64u(payload);
        }
        async function decodeProject(str) {
            let bytes = unb64u(str.slice(1));
            if (str[0] === "z") {
                if (!window.DecompressionStream) throw new Error("Браузер не поддерживает распаковку ссылки");
                const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
                bytes = new Uint8Array(await new Response(stream).arrayBuffer());
            }
            const d = JSON.parse(new TextDecoder().decode(bytes));
            if (!d || typeof d.f !== "object") throw new Error("Повреждённые данные");
            const filesOut = {};
            Object.keys(d.f).forEach(k => { if (typeof d.f[k] === "string" && A.ALLOWED_EXT.test(k) && !/(^|\/)\.\.?(\/|$)/.test(k)) filesOut[k] = d.f[k]; });
            return { name: String(d.n || "Проект по ссылке").slice(0, 40), entry: String(d.e || ""), files: filesOut };
        }
        async function shareProject() {
            if (!P()) return;
            let code;
            try { code = await encodeProject(P()); } catch (err) { toast("Не удалось подготовить ссылку", "warn"); return; }
            const url = location.href.split("#")[0] + "#share=" + code;
            const long = url.length > 30000;
            const m = Modal.open({
                title: "Поделиться проектом",
                subtitle: `${files().length} ${A.plural(files().length, "файл", "файла", "файлов")} · ${formatBytes(url.length)}`,
                className: "ide-modal ide-share-modal",
                html: `<p>Весь проект упакован прямо в ссылку — сервер не нужен. Получатель откроет её в NEXUS IDE и сможет импортировать копию.</p>
                    <div class="field"><label for="ide-share-url">Ссылка</label><textarea class="input" id="ide-share-url" rows="3" readonly spellcheck="false">${esc(url)}</textarea></div>
                    ${long ? `<p class="svc-muted">⚠ Ссылка длинная (${url.length} символов): некоторые мессенджеры могут её обрезать. Для больших проектов используйте «Скачать ZIP».</p>` : ""}
                    <p class="svc-muted">Совместное редактирование в реальном времени (как Zed Channels) требует сервера — в тестовой версии недоступно.</p>`,
                buttons: [
                    { label: "Копировать ссылку", icon: "clipboard", primary: true, action: () => { copyText(url).then(ok => toast(ok === false ? "Не удалось скопировать" : "Ссылка скопирована", ok === false ? "warn" : "ok")); return false; } },
                    { label: "Скачать ZIP", icon: "download", action: () => A.exportZip() }
                ]
            });
            const t = m && m.querySelector("#ide-share-url");
            if (t) t.addEventListener("focus", () => t.select());
        }
        $("#ide-share").addEventListener("click", shareProject);
        async function importShared(hash) {
            let d;
            try { d = await decodeProject(hash.replace(/^#share=/, "")); } catch (err) { toast("Ссылка на проект повреждена: " + err.message, "warn", { ttl: 5000 }); return; }
            const names = Object.keys(d.files);
            if (!names.length) { toast("В ссылке нет файлов", "warn"); return; }
            Modal.open({
                title: "Открыть проект по ссылке",
                subtitle: `${esc(d.name)} · ${names.length} ${A.plural(names.length, "файл", "файла", "файлов")}`,
                className: "ide-modal",
                html: `<p>С вами поделились проектом. Будет создана копия в вашем хранилище.</p><ul class="svc-perks">${names.slice(0, 20).map(n => `<li>${esc(n)}</li>`).join("")}${names.length > 20 ? `<li>… и ещё ${names.length - 20}</li>` : ""}</ul>`,
                buttons: [{
                    label: "Импортировать", icon: "download", primary: true, action: () => {
                        const created = A.createProject("web", d.name);
                        if (!created) return;
                        const live = A.findProject(created.id);
                        live.files = d.files;
                        live.entry = d.files[d.entry] !== undefined ? d.entry : (names.find(n => /\.html?$/i.test(n)) || names[0]);
                        live.open = [live.entry];
                        live.active = live.entry;
                        live.git = null;
                        live.updated = Date.now();
                        A.loadProject(live.id, { run: true });
                        A.persist(false);
                        toast(`Проект «${d.name}» импортирован`, "ok");
                    }
                }]
            });
        }

        /* ----- Декоративные функции (нужен сервер / локальная система) ----- */
        const decorToast = (what, why) => toast(`${what}: ${why}. В тестовой версии — только кнопка.`, "warn", { ttl: 4500 });
        $("#ide-collab").addEventListener("click", () => decorToast("Совместная работа", "нужен сервер синхронизации и аккаунты соавторов"));
        stCloud.addEventListener("click", () => decorToast("Облачная синхронизация", "проекты хранятся только в этом браузере (localStorage)"));

        /* ================================================================
         * Настройки-переключатели
         * ================================================================ */
        const OPTION_LABEL = { wordWrap: "Перенос строк", minimap: "Мини-карта", indentGuides: "Направляющие отступов", autocomplete: "Автодополнение", emmet: "Emmet", formatOnSave: "Форматирование при сохранении", vim: "Vim-режим", occurrences: "Подсветка совпадений", lint: "Линтер" };
        function setOption(key, val) {
            S()[key] = val;
            A.saveSettings();
            if (key === "wordWrap") applyWrap();
            else if (key === "minimap") drawMinimap();
            else if (key === "indentGuides") A.renderCode();
            else if (key === "vim") setVim(val);
            else if (key === "lint") runLint();
            else if (key === "occurrences") scheduleDecor();
            else if (key === "autocomplete") closeAC();
            if (!panels.ext.hidden) renderExt();
            toast(`${OPTION_LABEL[key] || key}: ${val ? "вкл" : "выкл"}`, "info", { ttl: 1400 });
            Sound.play(val ? "granted" : "folder");
        }
        function zoom(d) {
            const sizes = [11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
            const cur = S().fontSize || 14;
            let i = sizes.indexOf(cur);
            if (i < 0) i = 3;
            S().fontSize = d === 0 ? 14 : sizes[clamp(i + d, 0, sizes.length - 1)];
            A.measure();
            A.renderCode();
            measureChar();
            A.saveSettings();
            scheduleDecor();
            toast(`Шрифт: ${S().fontSize} px`, "info", { ttl: 1000 });
        }

        /* ================================================================
         * Команды редактора
         * ================================================================ */
        function selectNextOccurrence() {
            const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
            if (s === e) { const w = wordAt(v, s); if (w.word) ta.setSelectionRange(w.start, w.end); A.updateCaret(); scheduleDecor(); return; }
            const q = v.slice(s, e);
            let i = v.indexOf(q, e);
            if (i < 0) i = v.indexOf(q);
            if (i >= 0) { ta.setSelectionRange(i, i + q.length); A.revealSelection(i); A.updateCaret(); }
        }
        function selectLine() {
            const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
            const ls = lsOf(v, s);
            const full = e > s && v[e - 1] === "\n";
            const le = leOf(v, full ? e : e);
            ta.setSelectionRange(ls, Math.min(v.length, le + 1));
            A.updateCaret();
        }
        function deleteLine() {
            const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
            let ls = lsOf(v, s), le = leOf(v, e > s && v[e - 1] === "\n" ? e - 1 : e);
            if (le < v.length) le++; else if (ls > 0) ls--;
            A.replaceRange(ls, le, "", Math.min(ls + (ls > 0 && le >= v.length ? 1 : 0), v.length - (le - ls)));
        }
        function transformLines(fn) {
            const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
            const ls = s === e ? 0 : lsOf(v, s);
            const le = s === e ? v.length : leOf(v, e > s && v[e - 1] === "\n" ? e - 1 : e);
            const out = fn(v.slice(ls, le).split("\n")).join("\n");
            A.replaceRange(ls, le, out, ls, ls + out.length);
        }
        function transformSel(fn) {
            const s = ta.selectionStart, e = ta.selectionEnd;
            if (s === e) { const w = wordAt(ta.value, s); if (!w.word) return; A.replaceRange(w.start, w.end, fn(w.word), s); return; }
            const out = fn(ta.value.slice(s, e));
            A.replaceRange(s, e, out, s, s + out.length);
        }
        function renameSymbol() {
            if (!ide.active) return;
            const w = wordAt(ta.value, ta.selectionStart);
            if (!w.word || /^\d/.test(w.word)) { toast("Поставьте курсор на имя переменной или функции", "info"); return; }
            const re = new RegExp("(^|[^\\w$])(" + reEsc(w.word) + ")(?![\\w$])", "g");
            const count = f => (P().files[f].match(re) || []).length;
            const here = count(ide.active);
            const total = files().reduce((n, f) => n + count(f), 0);
            const m = Modal.open({
                title: "Переименовать символ",
                subtitle: `«${esc(w.word)}» · ${here} в файле, ${total} в проекте`,
                className: "ide-modal",
                html: `<div class="field"><label for="ide-rn-input">Новое имя</label><input class="input" id="ide-rn-input" type="text" value="${esc(w.word)}" spellcheck="false" autocomplete="off"><span class="field-error" role="alert"></span></div>
                    <label class="ide-check"><input type="checkbox" id="ide-rn-all"><span>Во всех файлах проекта (${total})</span></label>`,
                buttons: [{
                    label: "Переименовать", icon: "edit", primary: true, action: (btn, modal) => {
                        const name = modal.querySelector("#ide-rn-input").value.trim();
                        if (!/^[A-Za-z_$][\w$-]*$/.test(name)) { modal.querySelector(".field-error").textContent = "Недопустимое имя"; return false; }
                        const all = modal.querySelector("#ide-rn-all").checked;
                        const targets = all ? files() : [ide.active];
                        let n = 0;
                        targets.forEach(f => {
                            const src = f === ide.active ? ta.value : P().files[f];
                            const next = src.replace(re, (m0, pre) => { n++; return pre + name; });
                            if (next === src) return;
                            if (f === ide.active) A.replaceRange(0, src.length, next, Math.min(ta.selectionStart, next.length));
                            else P().files[f] = next;
                        });
                        P().updated = Date.now();
                        A.scheduleSave();
                        refreshGit();
                        runLint();
                        toast(`Переименовано: ${n}`, "ok");
                    }
                }]
            });
            const inp = m && m.querySelector("#ide-rn-input");
            if (inp) { setTimeout(() => { inp.focus(); inp.select(); }, 50); inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const b = m.querySelector(".btn-primary"); if (b) b.click(); } }); }
        }
        function gotoDefinition() {
            if (!ide.active) return;
            const w = wordAt(ta.value, ta.selectionStart);
            if (!w.word) return;
            const hits = [];
            files().forEach(f => symbolsOf(f, P().files[f]).forEach(s => {
                const n = s.name.replace(/\(\)$/, "").replace(/^[.#]/, "");
                if (n === w.word || s.name === "." + w.word || s.name === "#" + w.word || s.name.split(/[\s,>+~:]+/).some(x => x === "." + w.word || x === "#" + w.word)) hits.push({ f, s });
            }));
            if (!hits.length) {
                const re = new RegExp("\\b(?:id|class)\\s*=\\s*[\"'][^\"']*\\b" + reEsc(w.word) + "\\b");
                files().forEach(f => P().files[f].split("\n").forEach((l, i) => { if (re.test(l)) hits.push({ f, s: { name: l.trim().slice(0, 60), kind: "element", line: i + 1 } }); }));
            }
            if (!hits.length) { toast(`Определение «${w.word}» не найдено`, "info"); return; }
            hits.sort((a, b) => (a.f === ide.active ? -1 : 0) - (b.f === ide.active ? -1 : 0));
            const go = h => { A.openFile(h.f); goLine(h.s.line, 0, true); };
            if (hits.length === 1) { go(hits[0]); return; }
            openPicker(`Определения «${w.word}»`, hits.map((h, i) => ({ label: h.s.name, detail: `${h.f}:${h.s.line}`, value: i })), i => go(hits[i]));
        }
        function themePicker() {
            if (!NX.Theme) { toast("Темы недоступны", "warn"); return; }
            const orig = NX.Theme.current();
            const T = NX.THEMES || {};
            openPicker("Выберите тему оформления", NX.Theme.list().map(id => ({ label: (T[id] && T[id].label) || id, detail: T[id] ? T[id].desc + (T[id].variant ? " · " + T[id].variant : "") : "", extra: id === orig ? "текущая" : "", value: id })),
                id => { NX.Theme.set(id); drawMinimap(); }, id => { NX.Theme.paint(id); drawMinimap(); }, () => { NX.Theme.paint(orig); drawMinimap(); });
        }
        function showKeys() {
            const core = [["Ctrl+S", "Файл", "Сохранить"], ["Ctrl+Enter", "Запуск", "Запустить превью"], ["Ctrl+F / Ctrl+H", "Правка", "Поиск / замена в файле"], ["Ctrl+/", "Правка", "Закомментировать"], ["Alt+↑ / Alt+↓", "Правка", "Переместить строку"], ["Shift+Alt+↓", "Правка", "Дублировать строку"], ["Ctrl+Space", "Правка", "Подсказки автодополнения"], ["Tab", "Правка", "Emmet / сниппет / отступ"], ["Ctrl+Z / Ctrl+Shift+Z", "Правка", "Отменить / вернуть"]];
            const rows = core.concat(COMMANDS.filter(c => c.key && !c.hidden && !c.decor).map(c => [c.key, c.cat, c.title]));
            Modal.open({
                title: "Горячие клавиши", subtitle: "NEXUS IDE · в стиле Zed / VS Code", className: "ide-modal ide-keys-modal",
                html: `<input class="input input-sm" id="ide-keys-filter" type="search" placeholder="Фильтр" aria-label="Фильтр горячих клавиш">
                    <div class="ide-keys-scroll"><table class="edex-table ide-keys"><tbody>${rows.map(r => `<tr><td><kbd>${esc(r[0])}</kbd></td><td><i>${esc(r[1])}</i> ${esc(r[2])}</td></tr>`).join("")}</tbody></table></div>
                    <p class="svc-muted">Палитра команд (Ctrl+Shift+P) показывает все действия, включая те, что без клавиш. Ctrl+P: <code>:42</code> — строка, <code>@</code> — символ, <code>#</code> — текст во всех файлах.</p>`
            });
            const f = $("#ide-keys-filter");
            if (f) f.addEventListener("input", () => { const q = f.value.toLowerCase(); $$(".ide-keys tr").forEach(tr => { tr.hidden = q && tr.textContent.toLowerCase().indexOf(q) < 0; }); });
        }
        const helpBtn = $("#ide-help");
        const helpNew = helpBtn.cloneNode(true);
        helpBtn.replaceWith(helpNew);
        helpNew.addEventListener("click", showKeys);

        const E = { editor: true }, G = { global: true }, D = { decor: true, global: true };
        // Вид
        cmd("view.palette", "Вид", "Палитра команд", "Ctrl+Shift+P", () => openQO(">"), G);
        cmd("view.palette.f1", "Вид", "Палитра команд", "F1", () => openQO(">"), { global: true, hidden: true });
        cmd("view.quickopen", "Переход", "Быстро открыть файл", "Ctrl+P", () => openQO(""), G);
        cmd("view.line", "Переход", "Перейти к строке", "Ctrl+G", () => openQO(":"), G);
        cmd("view.symbol", "Переход", "Перейти к символу в файле", "Ctrl+Shift+O", () => openQO("@"), G);
        cmd("view.textall", "Переход", "Найти текст во всех файлах (быстро)", "", () => openQO("#"), G);
        cmd("goto.def", "Переход", "Перейти к определению", "F12", gotoDefinition, E);
        cmd("view.explorer", "Вид", "Проводник", "Ctrl+Shift+E", () => setSide("explorer", { show: true }), G);
        cmd("view.search", "Вид", "Поиск и замена по проекту", "Ctrl+Shift+F", () => setSide("search", { show: true }), G);
        cmd("view.git", "Вид", "Git: изменения и история", "Ctrl+Shift+G", () => setSide("git", { show: true }), G);
        cmd("view.outline", "Вид", "Структура файла (Outline)", "", () => setSide("outline", { show: true }), G);
        cmd("view.ext", "Вид", "Расширения", "Ctrl+Shift+X", () => setSide("ext", { show: true }), G);
        cmd("view.ai", "Вид", "Ассистент", "", () => setSide("ai", { show: true }), G);
        cmd("view.sidebar", "Вид", "Показать / скрыть боковую панель", "Ctrl+B", () => { S().explorer = S().explorer === false; A.applyLayout(); A.saveSettings(); syncActivity(); }, G);
        cmd("view.panel", "Вид", "Показать / скрыть нижнюю панель", "Ctrl+J", togglePanel, G);
        cmd("view.terminal", "Вид", "Терминал", "Ctrl+`", () => setBtab("terminal"), G);
        cmd("view.problems", "Вид", "Проблемы", "Ctrl+Shift+M", () => setBtab("problems"), G);
        cmd("view.console", "Вид", "Консоль", "", () => setBtab("console"), G);
        cmd("view.zen", "Вид", "Дзен-режим", "Ctrl+K Z", () => toggleZen(), G);
        cmd("view.wrap", "Вид", "Перенос строк", "Alt+Z", () => setOption("wordWrap", !S().wordWrap), G);
        cmd("view.minimap", "Вид", "Мини-карта", "", () => setOption("minimap", !S().minimap), G);
        cmd("view.guides", "Вид", "Направляющие отступов", "", () => setOption("indentGuides", !S().indentGuides), G);
        cmd("view.zoomin", "Вид", "Увеличить шрифт", "Ctrl+=", () => zoom(1), E);
        cmd("view.zoomout", "Вид", "Уменьшить шрифт", "Ctrl+-", () => zoom(-1), E);
        cmd("view.zoomreset", "Вид", "Сбросить размер шрифта", "Ctrl+0", () => zoom(0), E);
        cmd("view.theme", "Вид", "Сменить тему оформления", "Ctrl+K T", themePicker, G);
        cmd("view.keys", "Справка", "Горячие клавиши", "Ctrl+K S", showKeys, G);
        // Правка
        cmd("edit.format", "Правка", "Форматировать документ", "Shift+Alt+F", () => formatDocument(false), E);
        cmd("edit.rename", "Правка", "Переименовать символ", "F2", renameSymbol, E);
        cmd("edit.nextocc", "Правка", "Выделить слово / следующее вхождение", "Ctrl+D", selectNextOccurrence, E);
        cmd("edit.selline", "Правка", "Выделить строку", "Ctrl+L", selectLine, E);
        cmd("edit.delline", "Правка", "Удалить строку", "Ctrl+Shift+K", deleteLine, E);
        cmd("edit.suggest", "Правка", "Показать подсказки", "", () => { ta.focus(); openAC(true); }, E);
        cmd("edit.emmet", "Правка", "Emmet: развернуть сокращение", "", () => { if (!expandEmmet(true)) toast("Нет сокращения Emmet перед курсором (HTML)", "info"); }, E);
        cmd("edit.join", "Правка", "Объединить строки", "", () => transformLines(l => [l.map((x, i) => i ? x.trim() : x.replace(/\s+$/, "")).join(" ")]), E);
        cmd("edit.sort", "Правка", "Сортировать строки по возрастанию", "", () => transformLines(l => l.slice().sort((a, b) => a.localeCompare(b))), E);
        cmd("edit.sortdesc", "Правка", "Сортировать строки по убыванию", "", () => transformLines(l => l.slice().sort((a, b) => b.localeCompare(a))), E);
        cmd("edit.unique", "Правка", "Удалить повторяющиеся строки", "", () => transformLines(l => l.filter((x, i) => l.indexOf(x) === i)), E);
        cmd("edit.trim", "Правка", "Удалить пробелы в концах строк", "", () => transformLines(l => l.map(x => x.replace(/[ \t]+$/, ""))), E);
        cmd("edit.upper", "Правка", "ВЕРХНИЙ регистр", "", () => transformSel(s => s.toUpperCase()), E);
        cmd("edit.lower", "Правка", "нижний регистр", "", () => transformSel(s => s.toLowerCase()), E);
        cmd("edit.title", "Правка", "Каждое Слово С Заглавной", "", () => transformSel(s => s.replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase())), E);
        cmd("edit.comment", "Правка", "Закомментировать строки", "", () => A.toggleComment(), E);
        cmd("edit.duplicate", "Правка", "Дублировать строку", "", () => A.duplicateLines(), E);
        cmd("edit.find", "Правка", "Найти в файле", "", () => A.openFind(false), E);
        cmd("edit.replace", "Правка", "Заменить в файле", "", () => A.openFind(true), E);
        // Файл / проект
        cmd("file.new", "Файл", "Новый файл", "Alt+N", () => { setSide("explorer", { show: true }); const b = $("#ide-add-file"); if (b) b.click(); }, G);
        cmd("file.close", "Файл", "Закрыть вкладку", "Alt+W", () => { if (ide.active) A.closeTab(ide.active); }, G);
        cmd("file.closeall", "Файл", "Закрыть все вкладки", "Ctrl+K W", () => { P().open.slice().forEach(f => A.closeTab(f)); }, G);
        cmd("file.next", "Файл", "Следующая вкладка", "Alt+]", () => cycleTab(1), G);
        cmd("file.prev", "Файл", "Предыдущая вкладка", "Alt+[", () => cycleTab(-1), G);
        cmd("file.save", "Файл", "Сохранить", "Ctrl+S", () => A.persist(true), G);
        cmd("file.upload", "Файл", "Загрузить файлы с компьютера", "", () => { const b = $("#ide-upload"); if (b) b.click(); }, G);
        cmd("file.zip", "Файл", "Скачать проект (.zip)", "", () => A.exportZip(), G);
        cmd("project.new", "Проект", "Новый проект", "", () => A.newProjectModal(), G);
        cmd("project.menu", "Проект", "Действия с проектом", "", () => { const b = $("#ide-proj-menu"); if (b) b.click(); }, G);
        cmd("project.switch", "Проект", "Переключить проект", "", () => openPicker("Переключить проект", A.ide.data.projects.map(p => ({ label: p.name, detail: `${Object.keys(p.files).length} файлов · ${A.ago(p.updated || p.created)}`, extra: p.id === P().id ? "открыт" : "", value: p.id })), id => A.loadProject(id)), G);
        cmd("project.share", "Проект", "Поделиться ссылкой", "", shareProject, G);
        cmd("project.settings", "Проект", "Настройки редактора", "", () => { const b = $("#ide-settings"); if (b) b.click(); }, G);
        // Запуск
        cmd("run.run", "Запуск", "Запустить превью", "Ctrl+Enter", () => A.run(null, { manual: true }), G);
        cmd("run.newtab", "Запуск", "Открыть превью в новой вкладке", "", openInNewTab, G);
        cmd("run.node", "Запуск", "Выполнить текущий JS-файл в терминале (node)", "", () => { if (!ide.active || A.langOf(ide.active) !== "js") { toast("Откройте .js файл", "info"); return; } setBtab("terminal"); termRun("node " + ide.active); }, G);
        ["auto", "desktop", "tablet", "phone"].forEach(d => cmd("run.device." + d, "Запуск", "Размер превью: " + { auto: "по панели", desktop: "компьютер 1280", tablet: "планшет 768", phone: "телефон 390" }[d], "", () => { S().device = d; applyDevice(); A.saveSettings(); }, G));
        // Git
        cmd("git.commit", "Git", "Commit", "", () => { setSide("git", { show: true }); setTimeout(() => $("#ide-git-msg").focus(), 40); }, G);
        cmd("git.diff", "Git", "Изменения текущего файла (diff)", "", () => { if (ide.active) showDiff(ide.active, headFiles()[ide.active], P().files[ide.active]); }, G);
        cmd("git.discard", "Git", "Отменить изменения в текущем файле", "", () => { if (ide.active) discard(ide.active); }, G);
        cmd("git.push", "Git", "Push", "", () => decorToast("git push", "нет доступа к удалённому git-серверу из браузера"), D);
        cmd("git.pull", "Git", "Pull", "", () => decorToast("git pull", "нет доступа к удалённому git-серверу из браузера"), D);
        cmd("git.clone", "Git", "Clone репозитория", "", () => decorToast("git clone", "нужен сетевой доступ к GitHub и файловая система"), D);
        // Настройки-переключатели
        cmd("opt.vim", "Настройки", "Vim-режим", "", () => setOption("vim", !S().vim), G);
        cmd("opt.emmet", "Настройки", "Emmet", "", () => setOption("emmet", !S().emmet), G);
        cmd("opt.fos", "Настройки", "Форматировать при сохранении", "", () => setOption("formatOnSave", !S().formatOnSave), G);
        cmd("opt.ac", "Настройки", "Автодополнение", "", () => setOption("autocomplete", !S().autocomplete), G);
        cmd("opt.lint", "Настройки", "Линтер", "", () => setOption("lint", !S().lint), G);
        cmd("opt.occ", "Настройки", "Подсветка совпадений", "", () => setOption("occurrences", !S().occurrences), G);
        cmd("opt.autorun", "Настройки", "Автозапуск превью", "", () => { const b = $("#ide-autorun"); if (b) b.click(); }, G);
        // Ассистент
        cmd("ai.error", "Ассистент", "Объяснить последнюю ошибку", "", () => { setSide("ai", { show: true }); aiAction("error"); }, G);
        cmd("ai.summary", "Ассистент", "Сводка по проекту", "", () => { setSide("ai", { show: true }); aiAction("summary"); }, G);
        cmd("ai.todo", "Ассистент", "Найти TODO / FIXME", "", () => { setSide("ai", { show: true }); aiAction("todo"); }, G);
        cmd("ai.inline", "Ассистент", "Inline Assist (генерация кода)", "", () => decorToast("Inline Assist", "нужна языковая модель на сервере"), D);
        // Декоративные (нужен сервер или локальная система)
        cmd("collab.invite", "Совместная работа", "Пригласить соавтора", "", () => decorToast("Совместная работа", "нужен сервер синхронизации"), D);
        cmd("collab.call", "Совместная работа", "Голосовой канал", "", () => decorToast("Голосовые каналы", "нужен сервер WebRTC-сигналинга"), D);
        cmd("remote.ssh", "Remote", "Подключиться по SSH", "", () => decorToast("Remote SSH", "браузер не может открыть SSH-соединение"), D);
        cmd("remote.wsl", "Remote", "Открыть папку в WSL / контейнере", "", () => decorToast("Remote Containers", "нужен Docker / WSL на компьютере"), D);
        cmd("debug.start", "Отладка", "Начать отладку (breakpoints)", "", () => decorToast("Отладчик", "нужен протокол отладки (DAP) и локальная среда"), D);
        cmd("cloud.sync", "Облако", "Синхронизировать настройки", "", () => decorToast("Синхронизация", "нет облачного аккаунта в тестовой версии"), D);
        cmd("ext.market", "Расширения", "Открыть маркетплейс расширений", "", () => decorToast("Маркетплейс", "установка расширений требует сервера"), D);
        function cycleTab(d) {
            const open = P() ? P().open : [];
            if (open.length < 2) return;
            const i = open.indexOf(ide.active);
            A.openFile(open[(i + d + open.length) % open.length]);
        }

        /* ================================================================
         * Подписки на хуки ядра
         * ================================================================ */
        let lastFs = 0, wrapTimer = 0, crumbTimer = 0, outlineDeb = 0, recentTimer = 0;
        A.hooks.render.push(() => {
            if ((S().fontSize || 14) !== lastFs) { lastFs = S().fontSize || 14; measureChar(); }
            applyGutterMarks();
            scheduleDecor();
            drawMinimap();
            if (wrapOn()) { clearTimeout(wrapTimer); wrapTimer = setTimeout(wrapGutter, 60); }
        });
        A.hooks.scroll.push(() => { syncDecorScroll(); updateMinimapView(); if (acState.open) closeAC(); });
        A.hooks.caret.push(() => {
            scheduleDecor();
            clearTimeout(crumbTimer);
            crumbTimer = setTimeout(() => { renderCrumbs(); markOutline(); }, 80);
        });
        A.hooks.open.push(path => {
            closeAC();
            refreshGit();
            renderCrumbs();
            runLint();
            if (!panels.outline.hidden) renderOutline();
            if (vim.on) vimSetMode("normal");
            if (path) {
                const r = S().recent;
                const i = r.indexOf(path);
                if (i >= 0) r.splice(i, 1);
                r.unshift(path);
                r.length = Math.min(r.length, 12);
                clearTimeout(recentTimer);
                recentTimer = setTimeout(() => A.saveSettings(), 1500);
            }
            drawMinimap();
        });
        A.hooks.input.push(() => {
            runLint();
            refreshGit();
            clearTimeout(outlineDeb);
            outlineDeb = setTimeout(() => { if (!panels.outline.hidden) renderOutline(); crumbKey = ""; renderCrumbs(); }, 400);
        });
        A.hooks.project.push(() => {
            gitOf();
            tm.cwd = "";
            updatePs();
            refreshGit();
            runLint();
            renderCrumbs();
            lastError = null;
            if (!panels.git.hidden) renderGit();
            if (!panels.search.hidden) runProjectSearch();
            if (!panels.outline.hidden) renderOutline();
        });
        A.hooks.run.push(() => { runtimeErrs = []; lastError = null; renderProblemsPanel(); applyDevice(); });
        A.hooks.console.push(m => {
            if (m.level !== "error") return;
            runtimeErrs.push({ file: m.src ? m.src.file : null, line: m.src ? m.src.line : null, sev: "error", msg: m.text, runtime: true });
            if (runtimeErrs.length > 50) runtimeErrs.shift();
            renderProblemsPanel();
        });
        $("#ide-explorer-toggle").addEventListener("click", () => setTimeout(syncActivity, 0));
        window.addEventListener("resize", () => { drawMinimap(); if (wrapOn()) wrapGutter(); closeAC(); });

        /* ================================================================
         * Первичная синхронизация
         * ================================================================ */
        ideRoot.classList.add("ide-pro");
        measureChar();
        lastFs = S().fontSize || 14;
        Object.keys(panels).forEach(k => { panels[k].hidden = k !== (panels[S().side] ? S().side : "explorer"); });
        if (!panels[S().side]) S().side = "explorer";
        syncActivity();
        setBtab(S().btab, true);
        updatePs();
        applyWrap();
        setVim(!!S().vim);
        applyDevice();
        gitOf();
        refreshGit();
        runLint();
        renderCrumbs();
        renderProblemsPanel();
        drawMinimap();
        if (/^#share=/.test(A.initialHash || "")) setTimeout(() => importShared(A.initialHash), 300);
        window.addEventListener("hashchange", () => { if (/^#share=/.test(location.hash)) importShared(location.hash); });
    }

    /* ================================================================
     * Подключение к ядру IDE (js/services.js)
     * ================================================================ */
    let booted = false;
    function start(A) {
        if (booted || !A) return;
        booted = true;
        try { boot(A); }
        catch (err) { if (window.console) window.console.error("NEXUS IDE Pro:", err); }
    }
    if (NX.IDEApp) start(NX.IDEApp);
    else document.addEventListener("nexus:ide-ready", e => start(e.detail || NX.IDEApp));
})();
