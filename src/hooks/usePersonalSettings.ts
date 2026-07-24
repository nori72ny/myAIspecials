import { useState } from 'react';
import type { Settings } from '../types';
import { SafeStorage } from '../utils';

export const PERSONAL_SETTINGS_STORAGE_KEY = 'origin_personal_settings';

export const DEFAULT_PERSONAL_SETTINGS: Settings = Object.freeze({
  autoRoute: false,
  selectedAgents: [],
  language: 'ja',
  developerMode: false,
  uiMode: 'normal',
  selectedTheme: 'dark',
  maxCostCap: 0,
  retryCount: 0,
  timeoutSeconds: 30,
});

type StoredPersonalSettings = Pick<Settings, 'language' | 'selectedTheme'>;

function isStoredPersonalSettings(value: unknown): value is StoredPersonalSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredPersonalSettings>;
  return (candidate.language === 'ja' || candidate.language === 'en')
    && (candidate.selectedTheme === 'light' || candidate.selectedTheme === 'dark');
}

function toPersonalSettings(value: StoredPersonalSettings | null): Settings {
  return {
    ...DEFAULT_PERSONAL_SETTINGS,
    ...(value ?? {}),
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
    const safeSettings: StoredPersonalSettings = {
      language: nextSettings.language === 'en' ? 'en' : 'ja',
      selectedTheme: nextSettings.selectedTheme === 'light' ? 'light' : 'dark',
    };

    SafeStorage.set(PERSONAL_SETTINGS_STORAGE_KEY, safeSettings);
    setSettings(toPersonalSettings(safeSettings));
  };

  return { settings, updateSettings };
}
