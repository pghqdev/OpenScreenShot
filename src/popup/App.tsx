import { useEffect, useState } from 'preact/hooks';
import type { CaptureMode, PopupMessage, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { getSettings, setSettings } from '../shared/storage';
import { onPopupMessage, sendToBackground } from '../shared/messaging';

type ToastTone = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ModeDef {
  id: CaptureMode;
  icon: string;
  title: string;
  subtitle: string;
  shortcut: string;
}

const MODES: ModeDef[] = [
  {
    id: 'full-page',
    icon: '📄',
    title: 'Full Page',
    subtitle: 'Capture entire scrolling page',
    shortcut: '⌘⇧S',
  },
  {
    id: 'visible',
    icon: '👁',
    title: 'Visible Area',
    subtitle: 'What you see right now',
    shortcut: '⌘⇧V',
  },
  {
    id: 'region',
    icon: '✂️',
    title: 'Selected Region',
    subtitle: 'Click & drag to select',
    shortcut: '⌘⇧R',
  },
];

export function App() {
  const [, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [showWelcome, setShowWelcome] = useState(false);
  const [busy, setBusy] = useState<CaptureMode | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Load settings + apply theme on mount.
  useEffect(() => {
    void getSettings().then((s) => {
      setSettingsState(s);
      setShowWelcome(s.showOnboarding);
      applyTheme(s.theme);
    });
  }, []);

  // Listen for background progress / completion / errors.
  useEffect(() => {
    const off = onPopupMessage((msg: PopupMessage) => {
      switch (msg.type) {
        case 'CAPTURE_COMPLETE':
          setBusy(null);
          setProgress(null);
          pushToast('Screenshot saved!', 'success');
          setTimeout(() => window.close(), 1200);
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

  function capture(mode: CaptureMode) {
    if (busy) return;
    setBusy(mode);
    if (mode === 'region') {
      // Region needs the whole page visible: close the popup so the overlay shows.
      sendToBackground({ type: 'CAPTURE_REQUEST', mode }).catch(() => {});
      setTimeout(() => window.close(), 0);
      return;
    }
    setProgress(0);
    sendToBackground({ type: 'CAPTURE_REQUEST', mode }).catch(() => {
      setBusy(null);
      setProgress(null);
      pushToast('Could not reach the background worker.', 'error');
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
        <div class="brand">
          <CameraMark />
          <span class="brand-name">OpenScreenShot</span>
        </div>
        <button
          class="icon-btn"
          title="Settings (coming in M4)"
          aria-label="Settings"
          onClick={() => pushToast('Settings arrive in M4.', 'info')}
        >
          <GearMark />
        </button>
      </header>

      {showWelcome ? (
        <Welcome onDone={dismissWelcome} />
      ) : (
        <>
          <nav class="modes" aria-label="Capture modes">
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
                    <span class="mode-title">{m.title}</span>
                    <span class="mode-sub">
                      {isBusy
                        ? m.id === 'full-page' && progress != null
                          ? `Capturing… ${progress}%`
                          : 'Capturing…'
                        : m.subtitle}
                    </span>
                  </span>
                  {isBusy ? <span class="spinner" aria-label="Capturing" /> : null}
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

          <div class="shortcuts" aria-label="Keyboard shortcuts">
            <div class="shortcut">
              <kbd>⌘⇧S</kbd>
              <span>Full Page</span>
            </div>
            <div class="shortcut">
              <kbd>⌘⇧V</kbd>
              <span>Visible</span>
            </div>
            <div class="shortcut">
              <kbd>⌘⇧R</kbd>
              <span>Region</span>
            </div>
          </div>
        </>
      )}

      <div class="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} class={`toast toast-${t.tone}`} role="status">
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function Welcome({ onDone }: { onDone: () => void }) {
  return (
    <div class="welcome">
      <div class="welcome-emoji" aria-hidden="true">
        🎉
      </div>
      <h2 class="welcome-title">Welcome to OpenScreenShot!</h2>
      <p class="welcome-lede">
        Capture full-length screenshots of any webpage — even long-scrolling pages — annotate them,
        and export as PNG or PDF.
      </p>
      <ul class="welcome-list">
        <li>
          <b>📄 Full Page</b> — Scroll &amp; stitch the entire page, top to bottom
        </li>
        <li>
          <b>👁 Visible</b> — Just what you see now
        </li>
        <li>
          <b>✂️ Region</b> — Drag to select an area
        </li>
      </ul>
      <p class="welcome-perm">
        🔒 We need permission to read page content for screenshots. Your data never leaves your
        device.
      </p>
      <button class="btn-primary" onClick={onDone}>
        Got it, let&rsquo;s go!
      </button>
    </div>
  );
}

function CameraMark() {
  return (
    <span class="brand-mark" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
        <circle cx="12" cy="13" r="4" />
      </svg>
    </span>
  );
}

function GearMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function applyTheme(theme: Settings['theme']) {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  const dark = theme === 'dark' || (theme === 'system' && prefersDark);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}