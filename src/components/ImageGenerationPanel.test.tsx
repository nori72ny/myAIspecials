// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageGenerationPanel from './ImageGenerationPanel';

afterEach(cleanup);

describe('ImageGenerationPanel', () => {
  it('submits the normalized prompt with the selected ratio and resolution', () => {
    const onGenerate = vi.fn();
    const onClose = vi.fn();
    render(<ImageGenerationPanel language="ja" onClose={onClose} onGenerate={onGenerate} />);

    fireEvent.change(screen.getByTestId('origin-image-prompt'), {
      target: { value: '  夕焼けの海辺  ' },
    });
    fireEvent.change(screen.getByTestId('origin-image-ratio'), { target: { value: '9:16' } });
    fireEvent.change(screen.getByTestId('origin-image-resolution'), { target: { value: '1536' } });
    fireEvent.click(screen.getByTestId('origin-image-generate-submit'));

    expect(onGenerate).toHaveBeenCalledOnce();
    expect(onGenerate).toHaveBeenCalledWith('夕焼けの海辺', 864, 1536);
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
