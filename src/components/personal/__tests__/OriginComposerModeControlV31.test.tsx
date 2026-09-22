// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginComposerModeControlV31 from '../OriginComposerModeControlV31';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('OriginComposerModeControlV31', () => {
  it('mounts one compact Mode selector inside the active chat composer', () => {
    const chat = document.createElement('div');
    chat.className = 'origin-personal-chat';
    const composer = document.createElement('div');
    composer.className = 'origin-composer';
    const textarea = document.createElement('textarea');
    composer.appendChild(textarea);
    chat.appendChild(composer);
    document.body.appendChild(chat);

    render(<OriginComposerModeControlV31 mode="chat" onModeChange={vi.fn()} />);

    const selector = screen.getByLabelText('Composer mode') as HTMLSelectElement;
    expect(selector.value).toBe('chat');
    expect(composer.querySelectorAll('[data-origin-composer-mode-host="true"]')).toHaveLength(1);
    expect(composer.firstElementChild?.getAttribute('data-origin-composer-mode-host')).toBe('true');
  });

  it('forwards explicit Mode changes without claiming automatic routing', () => {
    const onModeChange = vi.fn();
    const chat = document.createElement('div');
    chat.className = 'origin-personal-chat';
    const composer = document.createElement('div');
    composer.className = 'origin-composer';
    composer.appendChild(document.createElement('textarea'));
    chat.appendChild(composer);
    document.body.appendChild(chat);

    render(<OriginComposerModeControlV31 mode="chat" onModeChange={onModeChange} />);
    fireEvent.change(screen.getByLabelText('Composer mode'), { target: { value: 'research' } });
    expect(onModeChange).toHaveBeenCalledWith('research');
    expect(screen.queryByText(/Auto routing/i)).toBeNull();
  });

  it('removes the injected host on unmount', () => {
    const chat = document.createElement('div');
    chat.className = 'origin-personal-chat';
    const composer = document.createElement('div');
    composer.className = 'origin-composer';
    composer.appendChild(document.createElement('textarea'));
    chat.appendChild(composer);
    document.body.appendChild(chat);

    const view = render(<OriginComposerModeControlV31 mode="chat" onModeChange={vi.fn()} />);
    expect(composer.querySelector('[data-origin-composer-mode-host="true"]')).toBeTruthy();
    view.unmount();
    expect(composer.querySelector('[data-origin-composer-mode-host="true"]')).toBeNull();
  });
});
