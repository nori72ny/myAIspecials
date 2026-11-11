// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageGenerationPanel from './ImageGenerationPanel';

// Plan B contract: the panel never consults the raster status endpoint.
// Whether a generation may proceed is decided per request by the
// server-side free-proof pipeline, which fails closed and returns a
// reason code. These tests pin that the panel is usable on its own form
// conditions. Since 2026-11-11 the sheet itself is minimal (owner
// decision): prompt + generate button up front, aspect ratio and
// resolution behind a closed Advanced settings disclosure, and the
// $0.00 verification is no longer restated as visible copy — the
// server-side contract behind it is unchanged.
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockRejectedValue(new Error('network unavailable'));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ImageGenerationPanel', () => {
  it('submits the normalized prompt with the selected ratio and resolution without any status pre-check', () => {
    const onGenerate = vi.fn();
    const onClose = vi.fn();
    render(<ImageGenerationPanel language="ja" onClose={onClose} onGenerate={onGenerate} />);

    expect(screen.queryByTestId('origin-image-free-proof-note')).toBeNull();
    expect(screen.queryByTestId('origin-image-provider-unavailable')).toBeNull();
    const submit = screen.getByTestId('origin-image-generate-submit');
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByTestId('origin-image-prompt'), {
      target: { value: '  夕焼けの海辺  ' },
    });
    const advanced = screen.getByTestId('origin-image-advanced-settings');
    expect(advanced.hasAttribute('open')).toBe(false);
    fireEvent.click(screen.getByText('詳細設定'));
    expect(advanced.hasAttribute('open')).toBe(true);
    fireEvent.change(screen.getByTestId('origin-image-ratio'), { target: { value: '9:16' } });
    fireEvent.change(screen.getByTestId('origin-image-resolution'), { target: { value: '1536' } });
    expect(screen.getByTestId('origin-image-dimensions').textContent).toContain('864 × 1536px');
    fireEvent.click(submit);

    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onGenerate).toHaveBeenCalledWith('夕焼けの海辺', 864, 1536);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the English sheet minimal as well: no free-proof copy, settings closed', () => {
    render(<ImageGenerationPanel language="en" onClose={() => undefined} onGenerate={() => undefined} />);
    expect(screen.queryByTestId('origin-image-free-proof-note')).toBeNull();
    expect(screen.getByText('Advanced settings')).toBeTruthy();
    expect(screen.getByTestId('origin-image-advanced-settings').hasAttribute('open')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect((screen.getByTestId('origin-image-generate-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('submits the prompt with the default 1:1 / 1024px size without opening Advanced settings', () => {
    const onGenerate = vi.fn();
    render(<ImageGenerationPanel language="ja" onClose={() => undefined} onGenerate={onGenerate} />);

    expect(screen.getByTestId('origin-image-advanced-settings').hasAttribute('open')).toBe(false);
    expect(screen.getByTestId('origin-image-dimensions').textContent).toContain('1024 × 1024px · 1:1');
    fireEvent.change(screen.getByTestId('origin-image-prompt'), { target: { value: '青い鳥' } });
    fireEvent.click(screen.getByTestId('origin-image-generate-submit'));

    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onGenerate).toHaveBeenCalledWith('青い鳥', 1024, 1024);
  });

  it('closes only via the × button (no duplicate Cancel button)', () => {
    const onClose = vi.fn();
    render(<ImageGenerationPanel language="ja" onClose={onClose} onGenerate={() => undefined} />);
    expect(screen.queryByRole('button', { name: 'キャンセル' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not submit an empty prompt and exposes an accessible validation error', () => {
    const onGenerate = vi.fn();
    render(<ImageGenerationPanel language="ja" onClose={() => undefined} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByTestId('origin-image-generate-submit'));

    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('画像の内容を入力してください');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ImageGenerationPanel language="ja" onClose={onClose} onGenerate={() => undefined} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('traps keyboard focus inside the dialog and restores focus to its opener', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open image studio';
    document.body.appendChild(opener);
    opener.focus();

    const view = render(<ImageGenerationPanel language="ja" onClose={() => undefined} onGenerate={() => undefined} />);
    const prompt = screen.getByTestId('origin-image-prompt');
    const close = screen.getByRole('button', { name: '閉じる' });
    const submit = screen.getByTestId('origin-image-generate-submit');

    expect(document.activeElement).toBe(prompt);
    submit.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    close.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(submit);

    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
