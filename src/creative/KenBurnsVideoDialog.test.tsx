// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import KenBurnsVideoDialog from './KenBurnsVideoDialog';

afterEach(() => {
  cleanup();
});

describe('KenBurnsVideoDialog', () => {
  it('renders the dialog with a close control and announces loading', () => {
    const onClose = vi.fn();
    render(
      <KenBurnsVideoDialog
        imageUrl="data:image/png;base64,iVBORw0KGgo="
        downloadName="origin-image.png"
        language="ja"
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('dialog', { name: '動画化（簡易）' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('読み込んでいます');
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <KenBurnsVideoDialog
        imageUrl="data:image/png;base64,iVBORw0KGgo="
        downloadName="origin-image.png"
        language="en"
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not offer WebM saving when recording is unsupported (jsdom has no MediaRecorder)', () => {
    render(
      <KenBurnsVideoDialog
        imageUrl="data:image/png;base64,iVBORw0KGgo="
        downloadName="origin-image.png"
        language="ja"
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByRole('button', { name: /動画を保存/ })).toBeNull();
  });

  it('shows a graceful error instead of crashing when the image fails to load', async () => {
    const OriginalImage = globalThis.Image;
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    globalThis.Image = FailingImage as unknown as typeof Image;
    try {
      render(
        <KenBurnsVideoDialog
          imageUrl="data:image/png;base64,invalid"
          downloadName="origin-image.png"
          language="ja"
          onClose={() => undefined}
        />,
      );
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.getByRole('alert').textContent).toContain('動画化できませんでした');
    } finally {
      globalThis.Image = OriginalImage;
    }
  });
});
