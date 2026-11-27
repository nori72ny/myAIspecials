import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSONAL_SETTINGS,
  PERSONAL_SETTINGS_STORAGE_KEY,
  readAlterEgoEnabled,
  readPersonalizationEnabled,
  usePersonalSettings,
} from './usePersonalSettings';

describe('usePersonalSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with the safe zero-cost Personal release defaults', () => {
    const { result } = renderHook(() => usePersonalSettings());

    expect(result.current.settings).toEqual(DEFAULT_PERSONAL_SETTINGS);
    expect(result.current.settings).toMatchObject({
      autoRoute: false,
      selectedAgents: [],
      selectedTheme: 'light',
      designTheme: 'minimal',
      maxCostCap: 0,
      retryCount: 0,
      timeoutSeconds: 45,
    });
  });

  it('does not import legacy settings or unsafe fields', () => {
    localStorage.setItem('acos_settings', JSON.stringify({
      autoRoute: true,
      selectedAgents: ['paid-provider'],
      language: 'en',
      selectedTheme: 'light',
      maxCostCap: 99,
      retryCount: 9,
    }));

    const { result } = renderHook(() => usePersonalSettings());

    expect(result.current.settings).toEqual(DEFAULT_PERSONAL_SETTINGS);
  });

  it('persists only language, appearance, and the safe design theme while keeping execution policy inert', () => {
    const { result } = renderHook(() => usePersonalSettings());

    act(() => {
      result.current.updateSettings({
        ...result.current.settings,
        language: 'en',
        selectedTheme: 'light',
        designTheme: 'luxury',
        autoRoute: true,
        selectedAgents: ['paid-provider'],
        maxCostCap: 10,
        retryCount: 5,
      });
    });

    expect(result.current.settings).toEqual({
      ...DEFAULT_PERSONAL_SETTINGS,
      language: 'en',
      selectedTheme: 'light',
      designTheme: 'luxury',
    });
    expect(JSON.parse(localStorage.getItem(PERSONAL_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      language: 'en',
      selectedTheme: 'light',
      designTheme: 'luxury',
      personalizationEnabled: true,
      alterEgoEnabled: false,
    });
  });

  it('defaults the personalization master toggle to on and persists changes', () => {
    const { result } = renderHook(() => usePersonalSettings());

    expect(result.current.settings.personalizationEnabled).toBe(true);

    act(() => {
      result.current.updateSettings({ ...result.current.settings, personalizationEnabled: false });
    });

    expect(result.current.settings.personalizationEnabled).toBe(false);
    expect(JSON.parse(localStorage.getItem(PERSONAL_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      language: 'ja',
      selectedTheme: 'light',
      designTheme: 'minimal',
      personalizationEnabled: false,
      alterEgoEnabled: false,
    });
  });

  it('restores a stored personalization toggle and defaults to on when the field is absent', () => {
    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'ja', selectedTheme: 'dark', personalizationEnabled: false }));

    const off = renderHook(() => usePersonalSettings());
    expect(off.result.current.settings.personalizationEnabled).toBe(false);
    off.unmount();

    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'ja', selectedTheme: 'dark' }));

    const absent = renderHook(() => usePersonalSettings());
    expect(absent.result.current.settings.personalizationEnabled).toBe(true);
  });

  it('rejects a non-boolean personalization toggle in stored settings', () => {
    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'ja', selectedTheme: 'dark', personalizationEnabled: 'yes' }));

    const { result } = renderHook(() => usePersonalSettings());

    expect(result.current.settings).toEqual(DEFAULT_PERSONAL_SETTINGS);
  });

  it('upgrades previously stored appearance settings to the default minimal design', () => {
    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'ja', selectedTheme: 'dark' }));

    const { result } = renderHook(() => usePersonalSettings());

    expect(result.current.settings.designTheme).toBe('minimal');
    expect(result.current.settings.selectedTheme).toBe('dark');
  });

  it('reads the personalization toggle for non-React callers, defaulting to on', () => {
    expect(readPersonalizationEnabled()).toBe(true);

    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'ja', selectedTheme: 'light', personalizationEnabled: false }));
    expect(readPersonalizationEnabled()).toBe(false);

    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'ja', selectedTheme: 'light' }));
    expect(readPersonalizationEnabled()).toBe(true);
  });

  it('rejects unapproved design themes without importing unsafe execution settings', () => {
    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'en', selectedTheme: 'light', designTheme: 'injected', autoRoute: true }));

    const { result } = renderHook(() => usePersonalSettings());

    expect(result.current.settings).toEqual(DEFAULT_PERSONAL_SETTINGS);
  });

  it('defaults the alter-ego toggle to OFF — the opposite of the personalization toggle — and persists changes', () => {
    const { result } = renderHook(() => usePersonalSettings());

    // Nothing stored: personalization is on, the alter ego is off, and
    // the non-React reader agrees (the owner turns the alter ego on
    // deliberately).
    expect(result.current.settings.personalizationEnabled).toBe(true);
    expect(result.current.settings.alterEgoEnabled).toBe(false);
    expect(readAlterEgoEnabled()).toBe(false);

    act(() => {
      result.current.updateSettings({ ...result.current.settings, alterEgoEnabled: true });
    });

    expect(result.current.settings.alterEgoEnabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(PERSONAL_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      language: 'ja',
      selectedTheme: 'light',
      designTheme: 'minimal',
      personalizationEnabled: true,
      alterEgoEnabled: true,
    });
    expect(readAlterEgoEnabled()).toBe(true);

    // A stored shape written before the toggle existed reads as OFF,
    // and only the literal boolean true turns the reader on.
    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'ja', selectedTheme: 'light', personalizationEnabled: true }));
    expect(readAlterEgoEnabled()).toBe(false);
    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'ja', selectedTheme: 'light', alterEgoEnabled: 'yes' }));
    expect(readAlterEgoEnabled()).toBe(false);
  });
});
