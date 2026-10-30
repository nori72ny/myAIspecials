// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
});
