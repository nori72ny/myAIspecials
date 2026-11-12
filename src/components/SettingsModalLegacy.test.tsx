// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../types';
import SettingsModalLegacy from './SettingsModalLegacy';

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
    const clearHistoryButton = screen.getByText('初期化');
    closeButton.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(clearHistoryButton);
    expect(document.activeElement).not.toBe(insideButtons[insideButtons.length - 1]);
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
