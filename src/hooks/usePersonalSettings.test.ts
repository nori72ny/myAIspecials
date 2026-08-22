import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PERSONAL_SETTINGS,
  PERSONAL_SETTINGS_STORAGE_KEY,
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
    });
  });

  it('upgrades previously stored appearance settings to the default minimal design', () => {
    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'ja', selectedTheme: 'dark' }));

    const { result } = renderHook(() => usePersonalSettings());

    expect(result.current.settings.designTheme).toBe('minimal');
    expect(result.current.settings.selectedTheme).toBe('dark');
  });

  it('rejects unapproved design themes without importing unsafe execution settings', () => {
    localStorage.setItem(PERSONAL_SETTINGS_STORAGE_KEY, JSON.stringify({ language: 'en', selectedTheme: 'light', designTheme: 'injected', autoRoute: true }));

    const { result } = renderHook(() => usePersonalSettings());

    expect(result.current.settings).toEqual(DEFAULT_PERSONAL_SETTINGS);
  });
});
