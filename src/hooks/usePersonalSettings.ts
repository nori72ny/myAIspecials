import { useState } from 'react';
import type { Settings } from '../types';
import { SafeStorage } from '../utils';

export const PERSONAL_SETTINGS_STORAGE_KEY = 'origin_personal_settings';
export type PersonalTheme = 'light' | 'dark' | 'system';
export type PersonalDesignTheme = 'minimal' | 'luxury' | 'glass';

export const DEFAULT_PERSONAL_SETTINGS: Settings = Object.freeze({
  autoRoute: false,
  selectedAgents: [],
  language: 'ja',
  developerMode: false,
  uiMode: 'normal',
  selectedTheme: 'light',
  designTheme: 'minimal',
  maxCostCap: 0,
  retryCount: 0,
  timeoutSeconds: 45,
});

type StoredPersonalSettings = {
  language: Settings['language'];
  selectedTheme: PersonalTheme;
  designTheme?: PersonalDesignTheme;
};

function isStoredPersonalSettings(value: unknown): value is StoredPersonalSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredPersonalSettings>;
  return (candidate.language === 'ja' || candidate.language === 'en')
    && (candidate.selectedTheme === 'light' || candidate.selectedTheme === 'dark' || candidate.selectedTheme === 'system')
    && (candidate.designTheme === undefined || candidate.designTheme === 'minimal' || candidate.designTheme === 'luxury' || candidate.designTheme === 'glass');
}

function toPersonalSettings(value: StoredPersonalSettings | null): Settings {
  return {
    ...DEFAULT_PERSONAL_SETTINGS,
    ...(value ?? {}),
  };
}

function toStoredPersonalSettings(nextSettings: Settings): StoredPersonalSettings {
  return {
    language: nextSettings.language === 'en' ? 'en' : 'ja',
    selectedTheme: nextSettings.selectedTheme === 'light' || nextSettings.selectedTheme === 'dark'
      ? nextSettings.selectedTheme
      : 'system',
    designTheme: nextSettings.designTheme === 'luxury' || nextSettings.designTheme === 'glass'
      ? nextSettings.designTheme
      : 'minimal',
  };
}

export function usePersonalSettings() {
  const [settings, setSettings] = useState<Settings>(() => (
    toPersonalSettings(
      SafeStorage.get<StoredPersonalSettings>(
        PERSONAL_SETTINGS_STORAGE_KEY,
        isStoredPersonalSettings,
      ),
    )
  ));

  const updateSettings = (nextSettings: Settings) => {
    const safeSettings = toStoredPersonalSettings(nextSettings);
    SafeStorage.set(PERSONAL_SETTINGS_STORAGE_KEY, safeSettings);
    setSettings(toPersonalSettings(safeSettings));
  };

  const resetSettings = () => {
    SafeStorage.remove(PERSONAL_SETTINGS_STORAGE_KEY);
    setSettings({ ...DEFAULT_PERSONAL_SETTINGS });
  };

  return { settings, updateSettings, resetSettings };
}
