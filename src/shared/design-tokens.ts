/**
 * Design tokens for OpenScreenShot — the single source of truth for color,
 * typography, spacing, radii, and shadows. Imported by all UI surfaces
 * (popup, editor, settings, onboarding) and also by canvas rendering that
 * needs accent colors programmatically.
 *
 * The CSS custom-property equivalents live in each surface's stylesheet
 * (see popup.css). Keep the two in sync.
 */

export type Theme = 'light' | 'dark';

export const colors = {
  light: {
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#F5F5F7',
    surfaceTertiary: '#EBEBED',
    textPrimary: '#1D1D1F',
    textSecondary: '#6E6E73',
    textTertiary: '#AEAEB2',
    accentPrimary: '#0071E3',
    accentHover: '#0077ED',
    accentPressed: '#0068D6',
    accentSubtle: '#E8F4FD',
    borderDefault: '#D2D2D7',
    borderFocus: '#0071E3',
    danger: '#FF3B30',
    success: '#34C759',
    warning: '#FF9500',
  },
  dark: {
    surfacePrimary: '#1C1C1E',
    surfaceSecondary: '#2C2C2E',
    surfaceTertiary: '#3A3A3C',
    textPrimary: '#F5F5F7',
    textSecondary: '#98989D',
    textTertiary: '#636366',
    accentPrimary: '#0A84FF',
    accentHover: '#409CFF',
    accentPressed: '#0070E0',
    accentSubtle: '#1A3A5C',
    borderDefault: '#48484A',
    borderFocus: '#0A84FF',
    danger: '#FF453A',
    success: '#30D158',
    warning: '#FF9F0A',
  },
} as const;

export const spacing = {
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '24px',
  6: '32px',
  8: '48px',
} as const;

export const radius = {
  sm: '6px',
  md: '10px',
  lg: '16px',
  full: '9999px',
} as const;

export const shadow = {
  sm: '0 1px 3px rgba(0,0,0,0.08)',
  md: '0 4px 12px rgba(0,0,0,0.12)',
  lg: '0 8px 30px rgba(0,0,0,0.16)',
  xl: '0 20px 60px rgba(0,0,0,0.24)',
} as const;

export const typography = {
  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  fontFamilyMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  size: { xs: '11px', sm: '13px', base: '14px', md: '16px', lg: '20px', xl: '28px' },
  weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
} as const;
