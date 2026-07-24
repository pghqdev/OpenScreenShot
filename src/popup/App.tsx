import { useEffect, useState } from 'preact/hooks';
import type { CaptureMode, ExportFormat, PopupMessage, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { getSettings, setSettings } from '../shared/storage';
import { onPopupMessage, sendToBackground } from '../shared/messaging';

// i18n helper
function t(id: string): string {
  return chrome.i18n.getMessage(id) ?? id;
}

// chrome:// URLs can't be opened via <a href>; tabs.create works from the popup.
function openShortcutSettings() {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

type ToastTone = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ModeDef {
  id: CaptureMode;
  icon: string;
  command: string;
  titleKey: string;
  subtitleKey: string;
}

const MODES: ModeDef[] = [
  {
    id: 'full-page',
    icon: '📄',
    command: 'capture-full-page',
    titleKey: 'modeFullPage',
    subtitleKey: 'modeFullPageSub',
  },
  {
    id: 'visible',
    icon: '👁',
    command: 'capture-visible',
    titleKey: 'modeVisible',
    subtitleKey: 'modeVisibleSub',
  },
  {
    id: 'region',
    icon: '✂️',
    command: 'capture-region',
    titleKey: 'modeRegion',
    subtitleKey: 'modeRegionSub',
  },
];

export function App() {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState<CaptureMode | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});

  // Load settings + apply theme on mount.
  useEffect(() => {
    void getSettings().then((s) => {
      setSettingsState(s);
      setShowWelcome(s.showOnboarding);
      applyTheme(s.theme);
    });
    // Actual (possibly user-remapped) bindings, formatted per platform by Chrome.
    void chrome.commands.getAll().then((cmds) => {
      const map: Record<string, string> = {};
      for (const c of cmds) if (c.name && c.shortcut) map[c.name] = c.shortcut;
      setShortcuts(map);
    });
  }, []);

  // Listen for background progress / completion / errors.
  useEffect(() => {
    const off = onPopupMessage((msg: PopupMessage) => {
      switch (msg.type) {
        case 'CAPTURE_COMPLETE':
          setBusy(null);
          setProgress(null);
          window.close();
          break;
        case 'CAPTURE_ERROR':
          setBusy(null);
          setProgress(null);
          pushToast(msg.message, 'error');
          break;
        case 'CAPTURE_PROGRESS':
          setProgress(msg.percent);
          break;
      }
    });
    return off;
  }, []);

  function pushToast(message: string, tone: ToastTone) {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  async function updateSettings(patch: Partial<Settings>) {
    const next = await setSettings(patch);
    setSettingsState(next);
    if (patch.theme) applyTheme(next.theme);
  }

  function capture(mode: CaptureMode) {
    if (busy) return;
    setBusy(mode);
    if (mode === 'region') {
      // Close only AFTER the request is delivered — closing first can drop the
      // message to a cold service worker, so region would silently no-op on the
      // first click and only work once the worker is warm.
      void sendToBackground({ type: 'CAPTURE_REQUEST', mode })
        .catch(() => {})
        .finally(() => window.close());
      return;
    }
    setProgress(0);
    sendToBackground({ type: 'CAPTURE_REQUEST', mode }).catch(() => {
      setBusy(null);
      setProgress(null);
      pushToast(t('couldNotReach'), 'error');
    });
  }

  async function dismissWelcome() {
    setShowWelcome(false);
    const next = await setSettings({ showOnboarding: false });
    setSettingsState(next);
  }

  return (
    <div class="app">
      <header class="header">
        {showSettings ? (
          <>
            <button
              class="icon-btn"
              title={t('backAria')}
              aria-label={t('backAria')}
              onClick={() => setShowSettings(false)}
            >
              <BackMark />
            </button>
            <span class="brand-name">{t('settingsTitle')}</span>
          </>
        ) : (
          <>
            <div class="brand">
              <CameraMark />
              <span class="brand-name">OpenScreenShot</span>
            </div>
            <button
              class="icon-btn"
              title={t('settingsTitle')}
              aria-label={t('settingsTitle')}
              onClick={() => setShowSettings(true)}
            >
              <GearMark />
            </button>
          </>
        )}
      </header>

      {showSettings ? (
        <SettingsView settings={settings} onChange={updateSettings} />
      ) : showWelcome ? (
        <Welcome onDone={dismissWelcome} />
      ) : (
        <>
          <nav class="modes" aria-label={t('captureModesAria')}>
            {MODES.map((m) => {
              const isBusy = busy === m.id;
              return (
                <button
                  key={m.id}
                  class="mode-card"
                  data-busy={isBusy ? 'true' : undefined}
                  disabled={!!busy}
                  onClick={() => capture(m.id)}
                >
                  <span class="mode-icon" aria-hidden="true">
                    {m.icon}
                  </span>
                  <span class="mode-text">
                    <span class="mode-title">{t(m.titleKey)}</span>
                    <span class="mode-sub">
                      {isBusy
                        ? m.id === 'full-page' && progress != null
                          ? t('capturing') + ' ' + progress + '%'
                          : t('capturing')
                        : t(m.subtitleKey)}
                    </span>
                  </span>
                  {isBusy ? (
                    <span class="spinner" aria-label={t('capturing')} />
                  ) : shortcuts[m.command] ? (
                    <kbd>{shortcuts[m.command]}</kbd>
                  ) : null}
                  {isBusy && m.id === 'full-page' && progress != null ? (
                    <div class="progress" aria-hidden="true">
                      <div class="progress-fill" style={{ width: `${progress}%` }} />
                    </div>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div class="divider" />

          <button class="link-btn" onClick={openShortcutSettings}>
            {t('customizeShortcuts')}
          </button>
        </>
      )}

      <div class="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} class={`toast toast-${toast.tone}`} role="status">
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsView({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const showQuality = settings.defaultFormat === 'jpeg' || settings.defaultFormat === 'webp';
  const pdfDisabled = settings.pdfPageSize === 'full';

  return (
    <div class="settings">
      <div class="settings-row">
        <span class="settings-label">{t('settingsTheme')}</span>
        <div class="seg">
          {(['light', 'dark', 'system'] as const).map((v) => (
            <button
              key={v}
              class="seg-btn"
              aria-pressed={settings.theme === v}
              onClick={() => onChange({ theme: v })}
            >
              {t('theme' + v.charAt(0).toUpperCase() + v.slice(1))}
            </button>
          ))}
        </div>
      </div>

      <div class="settings-row">
        <span class="settings-label">{t('settingsShortcuts')}</span>
        <button class="link-btn" onClick={openShortcutSettings}>
          {t('customizeShortcuts')}
        </button>
      </div>

      <div class="settings-row">
        <span class="settings-label">{t('settingsDefaultFormat')}</span>
        <div class="seg seg-wrap">
          {(['png', 'jpeg', 'webp', 'pdf'] as const).map((f) => (
            <button
              key={f}
              class="seg-btn"
              aria-pressed={settings.defaultFormat === f}
              onClick={() => onChange({ defaultFormat: f as ExportFormat })}
            >
              {t('format' + f.charAt(0).toUpperCase() + f.slice(1))}
            </button>
          ))}
        </div>
      </div>

      {showQuality ? (
        <div class="settings-row">
          <span class="settings-label">
            {t('settingsQuality')} · {Math.round(settings.quality * 100)}%
          </span>
          <input
            class="range"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={settings.quality}
            onInput={(e) => onChange({ quality: Number((e.target as HTMLInputElement).value) })}
          />
        </div>
      ) : null}

      <div class="settings-row settings-row-col">
        <span class="settings-label">{t('settingsFilename')}</span>
        <input
          class="text-input"
          type="text"
          spellcheck={false}
          value={settings.filenameTemplate}
          onInput={(e) => onChange({ filenameTemplate: (e.target as HTMLInputElement).value })}
        />
        <span class="settings-hint">{t('filenameHint')}</span>
      </div>

      <div class="settings-section">{t('settingsPdfDefaults')}</div>

      <div class="settings-row">
        <span class="settings-label">{t('settingsPdfPageSize')}</span>
        <div class="seg">
          {(['a4', 'letter', 'full'] as const).map((p) => (
            <button
              key={p}
              class="seg-btn"
              aria-pressed={settings.pdfPageSize === p}
              onClick={() => onChange({ pdfPageSize: p })}
            >
              {t('pdfPageSize' + p.charAt(0).toUpperCase() + p.slice(1))}
            </button>
          ))}
        </div>
      </div>

      <div class="settings-row">
        <span class="settings-label">{t('settingsPdfOrientation')}</span>
        <div class="seg">
          {(['portrait', 'landscape'] as const).map((o) => (
            <button
              key={o}
              class="seg-btn"
              aria-pressed={settings.pdfOrientation === o}
              disabled={pdfDisabled}
              onClick={() => onChange({ pdfOrientation: o })}
            >
              {t('pdfOrientation' + o.charAt(0).toUpperCase() + o.slice(1))}
            </button>
          ))}
        </div>
      </div>

      <div class="settings-row settings-row-between">
        <label class="check-label">
          <input
            type="checkbox"
            checked={settings.pdfMultiPage && !pdfDisabled}
            disabled={pdfDisabled}
            onChange={(e) => onChange({ pdfMultiPage: (e.target as HTMLInputElement).checked })}
          />
          {t('pdfMultiPage')}
        </label>
        <label class="check-label">
          {t('pdfMargin')}
          <input
            class="num-input"
            type="number"
            min="0"
            max="40"
            step="1"
            value={settings.pdfMarginMm}
            disabled={pdfDisabled}
            onInput={(e) => onChange({ pdfMarginMm: Number((e.target as HTMLInputElement).value) })}
          />
          mm
        </label>
      </div>
      {pdfDisabled ? <span class="settings-hint">{t('pdfFullHint')}</span> : null}
    </div>
  );
}

function Welcome({ onDone }: { onDone: () => void }) {
  return (
    <div class="welcome">
      <div class="welcome-emoji" aria-hidden="true">
        🎉
      </div>
      <h2 class="welcome-title">{t('welcomeTitle')}</h2>
      <p class="welcome-lede">{t('welcomeLede')}</p>
      <ul class="welcome-list">
        <li>{t('welcomeList1')}</li>
        <li>{t('welcomeList2')}</li>
        <li>{t('welcomeList3')}</li>
      </ul>
      <p class="welcome-perm">{t('welcomePerm')}</p>
      <button class="btn-primary" onClick={onDone}>
        {t('welcomeCta')}
      </button>
    </div>
  );
}

function CameraMark() {
  return (
    <span class="brand-mark" aria-hidden="true">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    </span>
  );
}

function GearMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function BackMark() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  );
}

function applyTheme(theme: Settings['theme']) {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
