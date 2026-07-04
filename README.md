# OpenScreenShot

> Open-source screenshot tool for Chrome — full-page, region, and visible-area capture with an annotation editor and PDF export. Built as a Manifest V3 extension.

![status](https://img.shields.io/badge/status-v0.1.0-34C759) ![license](https://img.shields.io/badge/license-MIT-34C759) ![manifest](https://img.shields.io/badge/manifest-v3-0A84FF)

OpenScreenShot captures the **entire scrolling page** (scroll-and-stitch), the **visible viewport**, or a **selected region**, lets you annotate the result, and export as PNG, JPEG, WebP, or PDF. Everything runs locally in your browser — your data never leaves your device.

## Status

| Milestone | Focus                                                                         | State   |
| --------- | ----------------------------------------------------------------------------- | ------- |
| M1        | Foundation — scaffold, design system, popup, onboarding, visible-area capture | ✅ Done |
| M2        | Capture engine — full-page scroll-and-stitch + region selection               | ✅ Done |
| M3        | Annotation editor + export (PNG/JPEG/WebP/PDF)                                | ✅ Done |
| M4        | Polish — settings, style controls, fixed-element compositing, accessibility   | ✅ Done |
| M5        | Launch — tests, store listing, i18n                                           | ✅ Done |

## Features

- 📄 **Full Page** — scroll-and-stitch the entire page, top to bottom, with live progress; fixed headers appear once at the top
- 👁 **Visible Area** — capture what's on screen now
- ✂️ **Selected Region** — click & drag to capture an area (viewport-only for now; scroll-during-select is planned)
- ✏️ **Annotation editor** — rectangle, arrow, pen, text, blur, crop; select, move/resize, undo/redo; color, stroke width & font size (remembered across sessions)
- 💾 **Export** — PNG, JPEG, WebP, and PDF (single page or multi-page with overlap) from the editor
- ⚙️ **Settings** — theme, default format, quality, filename template, PDF defaults
- 🎨 Polished, accessible (modal focus trap, toolbar arrow-key nav), dark/light UI

## Tech stack

- **TypeScript** (strict) + **Preact** for the popup/editor UI
- **Vite** + **[@crxjs/vite-plugin](https://github.com/crxjs/crxjs)** for Manifest V3 bundling & HMR
- **Canvas compositing in-page** via on-demand `chrome.scripting` injection (no offscreen document needed)
- **[jsPDF](https://github.com/parallax/jsPDF)** (lazy-loaded, zero vulnerabilities) for PDF export
- **Vitest** for unit tests, **Playwright** for e2e (planned)

## Getting started

### Prerequisites

- Node.js 22+
- npm 10+

### Install & develop

```bash
npm install
npm run icons      # generate the extension icons into public/icons
npm run dev        # start Vite + crxjs with HMR (writes to dist/)
```

Then load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist/` folder

### Build for production

```bash
npm run build      # type-check + bundle into dist/
```

Load `dist/` as an unpacked extension, or run `npm run package` to produce
`openscreenshot-vX.Y.Z.zip` for the Chrome Web Store.

### Scripts

| Script              | Description                                      |
| ------------------- | ------------------------------------------------ |
| `npm run dev`       | Vite dev server with extension HMR               |
| `npm run build`     | Type-check and bundle the extension into `dist/` |
| `npm run typecheck` | Run `tsc --noEmit`                               |
| `npm run lint`      | ESLint (flat config)                             |
| `npm test`          | Run unit tests (Vitest)                          |
| `npm run icons`     | Regenerate extension icons from the SVG source   |
| `npm run format`    | Format the codebase with Prettier                |
| `npm run package`   | Build + zip `dist/` for store submission         |

## Project structure

```
openscreenshot/
├── manifest.json            # MV3 manifest (crxjs entry)
├── public/
│   ├── icons/               # generated extension icons
│   └── _locales/en/         # i18n messages
├── src/
│   ├── background/          # service worker (capture coordinator)
│   ├── content/             # on-demand capture funcs (scroll, region)
│   ├── editor/              # annotation editor + export (Preact, own tab)
│   ├── popup/               # popup UI (Preact)
│   ├── shared/              # design tokens, messaging, storage, types, utils
│   └── (onboarding/ — later milestone)
├── tests/                   # unit + e2e tests
└── scripts/generate-icons.mjs
```

## Permissions

OpenScreenShot requests the minimum permissions needed:

- `activeTab` — access the current tab when you click the extension or use a shortcut
- `scripting` — inject on-demand page functions for scroll-and-stitch & region selection
- `storage` (+ `unlimitedStorage`) — settings/onboarding state and stashing large full-page PNGs for the editor
- `downloads` — save exports to your downloads folder
- `options_ui` — the editor is registered as a full-tab options page so crxjs bundles it; it’s opened in a tab after each capture

We never request broad host permissions (`<all_urls>`) — `activeTab` grants access on your click/shortcut, and `scripting` runs within that grant.

## Privacy

All capture and processing happens locally in your browser. Screenshots are never uploaded anywhere. See [PRIVACY.md](./PRIVACY.md).

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md). Please follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE) © OpenScreenShot Contributors
