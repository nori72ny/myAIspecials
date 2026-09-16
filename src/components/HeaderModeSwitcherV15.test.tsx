// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import HeaderModeSwitcher from './HeaderModeSwitcher';

vi.mock('../security/passkeyKeyDerivation', () => ({
  isPasskeyConfigured: () => false,
  registerPasskeyKey: vi.fn(),
  unlockAndSetPasskeyKey: vi.fn(),
}));

vi.mock('../security/passkeyKeyMigration', () => ({
  isPasskeyMigrationComplete: () => false,
  migrateToPasskeyEncryption: vi.fn(),
  PASSKEY_MIGRATION_STATUS_EVENT: 'origin-passkey-migration-status',
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HeaderModeSwitcher V1.5 navigation', () => {
  it('exposes Creative as a first-class workspace and routes selection', () => {
    const onModeChange = vi.fn();
    render(<HeaderModeSwitcher currentMode="chat" onModeChange={onModeChange} />);

    const creative = screen.getByRole('button', { name: /Creative/ });
    expect(creative.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(creative);
    expect(onModeChange).toHaveBeenCalledWith('creative');
  });

  it('marks Creative as selected when active', () => {
    render(<HeaderModeSwitcher currentMode="creative" onModeChange={() => undefined} />);
    expect(screen.getByRole('button', { name: /Creative/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
