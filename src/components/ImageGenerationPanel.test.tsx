// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageGenerationPanel from './ImageGenerationPanel';

const verifiedStatus = {
  ok: true,
  configured: true,
  ready: true,
  zeroCostVerified: true,
  paymentMethodRequired: false,
  paidFallbackEnabled: false,
  secretDelivery: 'server-only',
  providerId: 'test-free-provider',
  model: 'test-free-model',
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => verifiedStatus,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ImageGenerationPanel', () => {
  it('submits the normalized prompt with the selected ratio and resolution after a verified free route is confirmed', async () => {
    const onGenerate = vi.fn();
    const onClose = vi.fn();
    render(<ImageGenerationPanel language="ja" onClose={onClose} onGenerate={onGenerate} />);
    await screen.findByTestId('origin-image-provider-status');

    fireEvent.change(screen.getByTestId('origin-image-prompt'), {
      target: { value: '  夕焼けの海辺  ' },
    });
    fireEvent.change(screen.getByTestId('origin-image-ratio'), { target: { value: '9:16' } });
    fireEvent.change(screen.getByTestId('origin-image-resolution'), { target: { value: '1536' } });
    fireEvent.click(screen.getByTestId('origin-image-generate-submit'));

    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onGenerate).toHaveBeenCalledWith('夕焼けの海辺', 864, 1536);
  });

  it('does not submit when the status endpoint reports no verified zero-cost provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        ok: false,
        ready: false,
        zeroCostVerified: false,
        paidFallbackEnabled: false,
        reason: 'STATUS_NOT_LIVE_VERIFIED',
      }),
    }));
    const onGenerate = vi.fn();
    render(<ImageGenerationPanel language="ja" onClose={() => undefined} onGenerate={onGenerate} />);

    const unavailable = await screen.findByTestId('origin-image-provider-unavailable');
    expect(unavailable.textContent).toContain('費用 $0.00');
    const submit = screen.getByTestId('origin-image-generate-submit');
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('fails closed when the endpoint is successful but request-level zero-cost proof is absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...verifiedStatus, zeroCostVerified: false }),
    }));
    const onGenerate = vi.fn();
    render(<ImageGenerationPanel language="ja" onClose={() => undefined} onGenerate={onGenerate} />);

    await screen.findByTestId('origin-image-provider-unavailable');
    expect((screen.getByTestId('origin-image-generate-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('fails closed when the status endpoint cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    render(<ImageGenerationPanel language="ja" onClose={() => undefined} onGenerate={() => undefined} />);
    await screen.findByTestId('origin-image-provider-unavailable');
    expect((screen.getByTestId('origin-image-generate-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not submit an empty prompt and exposes an accessible validation error', async () => {
    const onGenerate = vi.fn();
    render(<ImageGenerationPanel language="ja" onClose={() => undefined} onGenerate={onGenerate} />);
    await screen.findByTestId('origin-image-provider-status');
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

  it('traps keyboard focus inside the dialog and restores focus to its opener', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Open image studio';
    document.body.appendChild(opener);
    opener.focus();

    const view = render(<ImageGenerationPanel language="ja" onClose={() => undefined} onGenerate={() => undefined} />);
    await screen.findByTestId('origin-image-provider-status');
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
