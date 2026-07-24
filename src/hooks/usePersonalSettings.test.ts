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
      maxCostCap: 0,
      retryCount: 0,
      timeoutSeconds: 30,
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

  it('persists only language and theme while keeping execution policy inert', () => {
    const { result } = renderHook(() => usePersonalSettings());

    act(() => {
      result.current.updateSettings({
        ...result.current.settings,
        language: 'en',
        selectedTheme: 'light',
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
    });
    expect(JSON.parse(localStorage.getItem(PERSONAL_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      language: 'en',
      selectedTheme: 'light',
    });
  });
});
