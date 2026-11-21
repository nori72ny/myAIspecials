// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSessionCredential,
  setSessionCredential,
  subscribeSessionCredentials,
} from './sessionCredentials';

afterEach(() => {
  setSessionCredential('coding', '');
  setSessionCredential('admin', '');
  localStorage.clear();
  sessionStorage.clear();
});

describe('sessionCredentials', () => {
  it('starts empty for both kinds and keeps the two keys separate', () => {
    expect(getSessionCredential('coding')).toBe('');
    expect(getSessionCredential('admin')).toBe('');

    setSessionCredential('coding', 'coding-key');
    expect(getSessionCredential('coding')).toBe('coding-key');
    expect(getSessionCredential('admin')).toBe('');

    setSessionCredential('admin', 'admin-key');
    expect(getSessionCredential('admin')).toBe('admin-key');
    expect(getSessionCredential('coding')).toBe('coding-key');
  });

  it('notifies subscribers only when a value actually changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSessionCredentials(listener);

    setSessionCredential('coding', 'a');
    expect(listener).toHaveBeenCalledTimes(1);
    setSessionCredential('coding', 'a');
    expect(listener).toHaveBeenCalledTimes(1);
    setSessionCredential('admin', 'b');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setSessionCredential('coding', 'c');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('never writes the keys to web storage', () => {
    setSessionCredential('coding', 'coding-key');
    setSessionCredential('admin', 'admin-key');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
