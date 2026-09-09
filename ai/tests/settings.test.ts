import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  saveSettings,
} from '../src/settings/settings';

type Store = Record<string, string>;

function stubWindow(store: Store): void {
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
  };
}

describe('settings', () => {
  let store: Store;
  beforeEach(() => {
    store = {};
    stubWindow(store);
  });
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('returns defaults when nothing is stored', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips saved settings and strips trailing slashes from baseUrl', () => {
    saveSettings({ baseUrl: 'https://api.example.com/', model: 'test-model', temperature: 0.3, fetchProxyPrefix: '' });
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      baseUrl: 'https://api.example.com',
      model: 'test-model',
      temperature: 0.3,
      fetchProxyPrefix: '', // 空串合法:禁用抓取代理
    });
  });

  it('falls back to defaults on corrupt JSON', () => {
    store[SETTINGS_STORAGE_KEY] = '{not json';
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back per-field on wrong types and out-of-range values', () => {
    store[SETTINGS_STORAGE_KEY] = JSON.stringify({
      version: 1,
      settings: { baseUrl: 42, model: 'm', temperature: 99 },
    });
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, model: 'm' });
  });

  it('ignores unknown storage versions', () => {
    store[SETTINGS_STORAGE_KEY] = JSON.stringify({ version: 99, settings: { model: 'x' } });
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
