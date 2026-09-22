// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginComposerModeControlV31 from '../OriginComposerModeControlV31';
afterEach(cleanup);
describe('OriginComposerModeControlV31', () => {
  it('keeps the selected mode when the composer is remounted between home and conversation', () => {
    const onModeChange = vi.fn();
    const view = render(<div key="home"><OriginComposerModeControlV31 mode="chat" onModeChange={onModeChange} /></div>);
    fireEvent.change(screen.getByLabelText('Composer mode'), { target: { value: 'research' } });
    expect(onModeChange).toHaveBeenCalledWith('research');
    view.rerender(<div key="research"><OriginComposerModeControlV31 mode="research" onModeChange={onModeChange} /></div>);
    expect((screen.getByLabelText('Workspace mode') as HTMLSelectElement).value).toBe('research');
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Workspace mode'), { target: { value: 'chat' } });
    expect(onModeChange).toHaveBeenLastCalledWith('chat');
  });
});
