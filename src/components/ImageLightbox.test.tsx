// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ImageLightbox from './ImageLightbox';

afterEach(() => {
  cleanup();
});

describe('ImageLightbox (Q7-07)', () => {
  it('shows the generated image enlarged in a modal dialog', () => {
    render(<ImageLightbox imageUrl="blob:origin-generated-image" language="ja" onClose={vi.fn()} />);
    const dialog = screen.getByTestId('origin-image-lightbox');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const image = within_image(dialog);
    expect(image.getAttribute('src')).toBe('blob:origin-generated-image');
    expect(image.getAttribute('alt')).toBe('ORIGINが生成した画像');
  });

  it('closes from the close button', () => {
    const onClose = vi.fn();
    render(<ImageLightbox imageUrl="blob:origin-generated-image" language="ja" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes from a backdrop click but not from a click on the dialog itself', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ImageLightbox imageUrl="blob:origin-generated-image" language="ja" onClose={onClose} />,
    );
    fireEvent.click(screen.getByTestId('origin-image-lightbox'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.origin-dialog-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ImageLightbox imageUrl="blob:origin-generated-image" language="ja" onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function within_image(dialog: HTMLElement): HTMLImageElement {
  const image = dialog.querySelector('img');
  if (!image) throw new Error('lightbox image missing');
  return image;
}
