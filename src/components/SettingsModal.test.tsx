import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PERSONAL_SETTINGS } from '../hooks/usePersonalSettings';
import SettingsModal from './SettingsModal';

const RELEASE_SHA = '1dd8916fdc353b1692f290a21fdda9262f53476e';

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

    expect(await screen.findByText('1dd8916fdc35…')).toBeTruthy();
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
    await screen.findByText('1dd8916fdc35…');
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
    await screen.findByText('1dd8916fdc35…');
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
