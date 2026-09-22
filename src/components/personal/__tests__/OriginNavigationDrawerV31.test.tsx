// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OriginNavigationDrawerV31 from '../OriginNavigationDrawerV31';
import type { ArtifactBlock, ConversationSession } from '../../../App';

const sessions: ConversationSession[] = [
  {
    id: 's1',
    title: 'Market research',
    createdAt: 200,
    messages: [{ id: 'u1', role: 'user', content: '調査してください' }],
  },
  {
    id: 's2',
    title: 'Code review',
    createdAt: 100,
    messages: [{ id: 'u2', role: 'user', content: 'コードを確認' }],
  },
];

const artifacts: ArtifactBlock[] = [
  { id: 'a1', type: 'markdown', title: 'Audit report', language: 'markdown', content: '# Audit', isComplete: true },
];

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('OriginNavigationDrawerV31', () => {
  it('opens a compact navigation surface and exposes global actions', () => {
    const onNewConversation = vi.fn();
    const onOpenSettings = vi.fn();
    render(<OriginNavigationDrawerV31 sessions={sessions} artifacts={artifacts} onNewConversation={onNewConversation} onOpenSettings={onOpenSettings} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(screen.getByRole('dialog', { name: 'ORIGIN navigation' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '＋ 新規対話' }));
    expect(onNewConversation).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.click(screen.getByRole('button', { name: '設定' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('searches and restores a conversation without exposing unrelated sessions', () => {
    const onRestoreSession = vi.fn();
    render(<OriginNavigationDrawerV31 sessions={sessions} artifacts={[]} onRestoreSession={onRestoreSession} onNewConversation={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.change(screen.getByLabelText('履歴を検索'), { target: { value: 'Market' } });
    expect(screen.getByRole('button', { name: /Market research/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Code review/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Market research/ }));
    expect(onRestoreSession).toHaveBeenCalledWith(sessions[0]);
  });

  it('opens the selected artifact rather than assuming the latest artifact', () => {
    const onOpenArtifact = vi.fn();
    render(<OriginNavigationDrawerV31 sessions={[]} artifacts={artifacts} onOpenArtifact={onOpenArtifact} onNewConversation={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.click(screen.getByRole('button', { name: /Audit report/ }));
    expect(onOpenArtifact).toHaveBeenCalledWith(artifacts[0]);
  });

  it('locks page scrolling while open and closes on Escape', () => {
    render(<OriginNavigationDrawerV31 sessions={sessions} artifacts={artifacts} onNewConversation={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('dialog', { name: 'ORIGIN navigation' }).getAttribute('aria-modal')).toBe('true');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'ORIGIN navigation' })).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });
});
