# Происхождение ассетов

Все файлы в этой папке перенесены из сторонних открытых проектов. Их лицензии сохраняются.

| Путь | Источник | Лицензия |
|------|----------|----------|
| `fonts/united_sans_light.woff2`, `fonts/united_sans_medium.woff2`, `fonts/fira_mono.woff2`, `fonts/fira_code.woff2` | [eDEX-UI](https://github.com/GitSquared/edex-ui) `src/assets/fonts/` | поставляются в составе eDEX-UI (GPL-3.0); Fira Mono / Fira Code — SIL OFL 1.1 |
| `themes/blade.json` | eDEX-UI `src/assets/themes/blade.json` | GPL-3.0 |
| `audio/*.wav` | eDEX-UI `src/assets/audio/` | GPL-3.0 |
| `img/edex-logo.svg` | eDEX-UI `media/logo.svg` | GPL-3.0 |
| `icons/*.svg` | извлечены из eDEX-UI `src/assets/icons/file-icons.json` и перекрашены в цвет темы blade (`#cc5e37`). В набор входят иконки eDEX-UI, Font Awesome Free 5.15.4 (CC BY 4.0) и пакета file-icons | GPL-3.0 / CC BY 4.0 / MIT, в зависимости от иконки |
| `vendor/augmented-ui/augmented.css` | [augmented-ui 1.1.2](https://github.com/propjockey/augmented-ui) — зависимость eDEX-UI, рисует скошенные рамки | BSD-2-Clause (см. `vendor/augmented-ui/LICENSE`) |

CSS-правила в `css/blade-theme.css` адаптированы из `src/assets/css/*.css` eDEX-UI,
а логика экрана загрузки и виджетов в `js/ui-effects.js` переписана на браузерном JS
по мотивам `src/_renderer.js` и `src/classes/*.class.js` (GPL-3.0).

UI inspired by & adapted from eDEX-UI (GPL-3.0) — © Gabriel “Squared” Saillard и участники проекта.
