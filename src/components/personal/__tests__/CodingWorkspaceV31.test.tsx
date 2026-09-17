// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CodingWorkspaceV31 from '../CodingWorkspaceV31';

vi.mock('../../CodingJobWorkspaceV14', () => ({
  default: () => <div><h2 id="coding-diff-title">変更ファイル</h2><h2 id="coding-verification-title">検証結果</h2></div>,
}));

afterEach(() => cleanup());

describe('CodingWorkspaceV31', () => {
  it('exposes real workspace sections and keeps unbacked surfaces disabled', () => {
    render(<CodingWorkspaceV31 />);

    expect(screen.queryByRole('navigation', { name: 'Coding workspace sections' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Files' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Diff' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Tests' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: /Terminal/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Checkpoint/ }).hasAttribute('disabled')).toBe(true);
  });

  it('jumps Files and Tests to the existing grounded evidence panels', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    render(<CodingWorkspaceV31 />);

    fireEvent.click(screen.getByRole('button', { name: 'Files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tests' }));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
