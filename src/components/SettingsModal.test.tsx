import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PERSONAL_SETTINGS } from '../hooks/usePersonalSettings';
import SettingsModal from './SettingsModal';

const RELEASE_SHA = '0123456789abcdef0123456789abcdef01234567';

function renderSettings() {
  return render(
    <SettingsModal
      isOpen
      onClose={vi.fn()}
      settings={DEFAULT_PERSONAL_SETTINGS}
      updateSettings={vi.fn()}
    />,
  );
}

function mockHealth(payload: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    json: async () => payload,
  }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SettingsModal release identity', () => {
  it('shows a verified release ID in shortened and full forms', async () => {
    mockHealth({ releaseSha: RELEASE_SHA.toUpperCase() });

    renderSettings();

    expect(await screen.findByText('0123456789ab…')).toBeTruthy();
    expect(screen.queryByText(RELEASE_SHA)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '全文を表示' }));
    expect(screen.getByText(RELEASE_SHA)).toBeTruthy();
    expect(screen.getByRole('button', { name: '短く表示' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('only reports copy success after the clipboard write resolves', async () => {
    mockHealth({ releaseSha: RELEASE_SHA });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderSettings();
    await screen.findByText('0123456789ab…');
    fireEvent.click(screen.getByRole('button', { name: 'コピー' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'コピー済み' })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(RELEASE_SHA);
  });

  it('does not report copy success when clipboard access fails', async () => {
    mockHealth({ releaseSha: RELEASE_SHA });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) },
    });

    renderSettings();
    await screen.findByText('0123456789ab…');
    fireEvent.click(screen.getByRole('button', { name: 'コピー' }));

    expect(await screen.findByText('リリースIDをコピーできませんでした。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'コピー済み' })).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['null', null],
    ['unknown', 'unknown'],
    ['39 characters', 'a'.repeat(39)],
    ['41 characters', 'a'.repeat(41)],
    ['non hexadecimal', `${'a'.repeat(39)}z`],
  ])('fails closed for %s release identity', async (_caseName, releaseSha) => {
    mockHealth({ releaseSha });

    renderSettings();

    expect(await screen.findByText('確認できません')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '全文を表示' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'コピー' })).toBeNull();
  });

  it.each([
    ['404 response', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })],
    ['network error', vi.fn().mockRejectedValue(new Error('offline'))],
  ])('fails closed after a %s', async (_caseName, fetchMock) => {
    vi.stubGlobal('fetch', fetchMock);

    renderSettings();

    expect(await screen.findByText('確認できません')).toBeTruthy();
  });

  it('fails closed when the health request times out', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => undefined)));

    renderSettings();
    expect(screen.getByText('確認中…')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText('確認できません')).toBeTruthy();
  });
});


describe('SettingsModal appearance and history actions', () => {
  it('exposes Minimal, Luxury, and Glass while updating only the selected design theme', async () => {
    const updateSettings = vi.fn();
    mockHealth({ releaseSha: RELEASE_SHA });
    render(<SettingsModal isOpen onClose={vi.fn()} settings={DEFAULT_PERSONAL_SETTINGS} updateSettings={updateSettings} />);

    await screen.findByText('0123456789ab…');
    expect(screen.getByRole('button', { name: 'Minimal' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Luxury' }));
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ designTheme: 'luxury', selectedTheme: 'light', maxCostCap: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'Glass' }));
    expect(updateSettings).toHaveBeenLastCalledWith(expect.objectContaining({ designTheme: 'glass', maxCostCap: 0 }));
  });

  it('persists the system theme choice through the settings handoff', async () => {
    const updateSettings = vi.fn();
    mockHealth({ releaseSha: RELEASE_SHA });
    render(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        settings={DEFAULT_PERSONAL_SETTINGS}
        updateSettings={updateSettings}
        messageCount={2}
      />,
    );

    await screen.findByText('0123456789ab…');
    fireEvent.click(screen.getByRole('button', { name: 'システム設定' }));
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ selectedTheme: 'system' }));
    expect(screen.getByRole('button', { name: 'システム設定' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('exposes export and reset controls for the supplied conversation state', async () => {
    const onExportHistory = vi.fn();
    const onResetHistory = vi.fn();
    mockHealth({ releaseSha: RELEASE_SHA });
    render(
      <SettingsModal
        isOpen
        onClose={vi.fn()}
        settings={DEFAULT_PERSONAL_SETTINGS}
        updateSettings={vi.fn()}
        messageCount={3}
        onExportHistory={onExportHistory}
        onResetHistory={onResetHistory}
      />,
    );

    await screen.findByText('0123456789ab…');
    expect(screen.getByText('このブラウザーの会話は現在 3 件です。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '書き出す' }));
    fireEvent.click(screen.getByRole('button', { name: '初期化' }));
    expect(onExportHistory).toHaveBeenCalledOnce();
    expect(onResetHistory).toHaveBeenCalledOnce();
    expect(screen.getByText('会話履歴を初期化しました。')).toBeTruthy();
  });
});
