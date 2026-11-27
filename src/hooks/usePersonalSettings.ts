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
  personalizationEnabled: true,
  alterEgoEnabled: false,
  maxCostCap: 0,
  retryCount: 0,
  timeoutSeconds: 45,
});

type StoredPersonalSettings = {
  language: Settings['language'];
  selectedTheme: PersonalTheme;
  designTheme?: PersonalDesignTheme;
  // Personalization Stage 1 master toggle (design §7.4). Optional in the
  // stored shape so settings saved before this field existed stay valid;
  // an absent field means the default (on).
  personalizationEnabled?: boolean;
  // Alter-ego mode toggle (2026-11-27). Optional for the same reason;
  // an absent field means the default (OFF — the owner turns the alter
  // ego on deliberately, so the default is the opposite of the master
  // toggle's).
  alterEgoEnabled?: boolean;
};

function isStoredPersonalSettings(value: unknown): value is StoredPersonalSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredPersonalSettings>;
  return (candidate.language === 'ja' || candidate.language === 'en')
    && (candidate.selectedTheme === 'light' || candidate.selectedTheme === 'dark' || candidate.selectedTheme === 'system')
    && (candidate.designTheme === undefined || candidate.designTheme === 'minimal' || candidate.designTheme === 'luxury' || candidate.designTheme === 'glass')
    && (candidate.personalizationEnabled === undefined || typeof candidate.personalizationEnabled === 'boolean')
    && (candidate.alterEgoEnabled === undefined || typeof candidate.alterEgoEnabled === 'boolean');
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
    personalizationEnabled: nextSettings.personalizationEnabled !== false,
    alterEgoEnabled: nextSettings.alterEgoEnabled === true,
  };
}

/**
 * Reads the personalization master toggle straight from the persisted
 * settings, for non-React callers (the on-device memory ingestion).
 * Defaults to on when nothing valid is stored, matching §7.4.
 */
export function readPersonalizationEnabled(): boolean {
  const stored = SafeStorage.get<StoredPersonalSettings>(
    PERSONAL_SETTINGS_STORAGE_KEY,
    isStoredPersonalSettings,
  );
  return stored?.personalizationEnabled !== false;
}

/**
 * Reads the alter-ego mode toggle straight from the persisted settings,
 * for non-React callers (the chat bridge and the memory ingestion).
 * Defaults to OFF when nothing valid is stored — the opposite default
 * of the personalization master toggle.
 */
export function readAlterEgoEnabled(): boolean {
  const stored = SafeStorage.get<StoredPersonalSettings>(
    PERSONAL_SETTINGS_STORAGE_KEY,
    isStoredPersonalSettings,
  );
  return stored?.alterEgoEnabled === true;
}

/**
 * Reads the persisted UI language straight from the persisted settings, for
 * non-React callers (the chat bridge labels the personal context block it
 * assembles with it, design §6.2). Defaults to Japanese when nothing valid
 * is stored, matching DEFAULT_PERSONAL_SETTINGS.
 */
export function readPersonalLanguage(): 'ja' | 'en' {
  const stored = SafeStorage.get<StoredPersonalSettings>(
    PERSONAL_SETTINGS_STORAGE_KEY,
    isStoredPersonalSettings,
  );
  return stored?.language === 'en' ? 'en' : 'ja';
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
