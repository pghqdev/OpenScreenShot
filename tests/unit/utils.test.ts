import { describe, it, expect } from 'vitest';
import { formatFilename, sanitizeFilename, isProtectedUrl } from '../../src/shared/utils';

describe('formatFilename', () => {
  it('replaces date/time/w/h tokens', () => {
    const out = formatFilename('screenshot_{date}_{time}_{w}x{h}', { width: 1920, height: 1080 });
    expect(out).toMatch(/^screenshot_\d{4}-\d{2}-\d{2}_\d{6}_1920x1080$/);
  });

  it('sanitizes and truncates the title token', () => {
    const out = formatFilename('{title}', { title: 'a/b:c?d', width: 10, height: 10 });
    expect(out).toBe('a_b_c_d');
  });

  it('falls back to a default title when none is provided', () => {
    const out = formatFilename('{title}', { width: 1, height: 1 });
    expect(out).toBe('screenshot');
  });

  it('falls back to the default title when the title is empty', () => {
    const out = formatFilename('{title}', { title: '', width: 1, height: 1 });
    expect(out).toBe('screenshot');
  });
});

describe('sanitizeFilename', () => {
  it('replaces reserved characters with underscores', () => {
    expect(sanitizeFilename('my:file*name?')).toBe('my_file_name_');
  });
  it('trims surrounding whitespace', () => {
    expect(sanitizeFilename('  hi  ')).toBe('hi');
  });
});

describe('isProtectedUrl', () => {
  it('blocks chrome:// pages', () => {
    expect(isProtectedUrl('chrome://settings')).toBe(true);
  });
  it('blocks the web store', () => {
    expect(isProtectedUrl('https://chrome.google.com/webstore/detail/x')).toBe(true);
  });
  it('allows normal https pages', () => {
    expect(isProtectedUrl('https://example.com')).toBe(false);
  });
  it('treats missing urls as protected', () => {
    expect(isProtectedUrl(undefined)).toBe(true);
  });
});