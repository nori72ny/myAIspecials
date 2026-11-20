// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../types';
import SettingsModalLegacy from './SettingsModalLegacy';
import { getSessionCredential, setSessionCredential } from '../security/sessionCredentials';

// The release-identity <details> sits at the end of the dialog and, once
// the release SHA resolves, contains the last buttons in DOM order. The
// focus trap must not treat those buttons as its wrap-around target
// while the <details> is closed (they are not rendered and cannot take
// focus), and must treat them as candidates again once it is open.
const settings: Settings = {
  autoRoute: false,
  selectedAgents: [],
  language: 'ja',
  selectedTheme: 'system',
  designTheme: 'minimal',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((input: unknown) => {
    if (String(input).includes('/api/health')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ releaseSha: 'a'.repeat(40) }),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  setSessionCredential('coding', '');
  setSessionCredential('admin', '');
  vi.unstubAllGlobals();
});

const renderModal = async () => {
  render(
    <SettingsModalLegacy
      isOpen
      onClose={() => undefined}
      settings={settings}
      updateSettings={() => undefined}
    />,
  );
  const details = (await screen.findByTestId('release-identity')) as HTMLDetailsElement;
  // The buttons inside the <details> only render once the release
  // identity request resolves.
  await screen.findByText('全文を表示');
  const insideButtons = Array.from(details.querySelectorAll('button'));
  expect(insideButtons.length).toBe(2);
  return { details, insideButtons };
};

describe('SettingsModalLegacy focus trap', () => {
  it('does not wrap focus to a button inside a closed <details>', async () => {
    const { details, insideButtons } = await renderModal();
    expect(details.open).toBe(false);

    const closeButton = screen.getByTestId('close-settings-button');
    // The コード実行 section (PR-D) sits after "About you", so its key
    // input is now the last focusable control before the closed
    // technical-information <details>.
    const lastButton = screen.getByLabelText('実行キー');
    closeButton.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(lastButton);
    expect(document.activeElement).not.toBe(insideButtons[insideButtons.length - 1]);
  });

  it('renders the About you section right after the history section', async () => {
    await renderModal();
    const scrollRegion = screen.getByTestId('settings-scroll-region');
    const headings = Array.from(scrollRegion.querySelectorAll('h3')).map((heading) => heading.textContent);
    const historyIndex = headings.findIndex((text) => text?.includes('会話履歴'));
    const personalIndex = headings.findIndex((text) => text?.includes('あなたについて'));
    expect(historyIndex).toBeGreaterThanOrEqual(0);
    expect(personalIndex).toBe(historyIndex + 1);
  });

  it('stores the coding and admin keys in the session credential module only', async () => {
    await renderModal();
    fireEvent.change(screen.getByLabelText('実行キー'), { target: { value: 'coding-secret' } });
    expect(getSessionCredential('coding')).toBe('coding-secret');
    fireEvent.change(screen.getByLabelText('管理者キー'), { target: { value: 'admin-secret' } });
    expect(getSessionCredential('admin')).toBe('admin-secret');
    // 他セクションが自分の設定を保存していても、キー自体はどちらの
    // ストレージにも現れない（保持はメモリ内のみ）。
    const stored = [localStorage, sessionStorage]
      .flatMap((storage) => Array.from({ length: storage.length }, (_, index) => storage.getItem(storage.key(index) ?? '') ?? ''))
      .join(' ');
    expect(stored).not.toContain('coding-secret');
    expect(stored).not.toContain('admin-secret');
  });

  it('wraps focus to a button inside an open <details>', async () => {
    const { details, insideButtons } = await renderModal();
    details.open = true;

    const closeButton = screen.getByTestId('close-settings-button');
    const copyButton = insideButtons[insideButtons.length - 1];
    closeButton.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(copyButton);
  });
});
