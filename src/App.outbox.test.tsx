// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the durable outbox so tests can seed, inspect, and
// verify deletions without a real IndexedDB implementation.
const outboxStore = vi.hoisted(() => ({
  entries: new Map<string, { id: string; text: string; createdAt: number }>(),
}));

vi.mock('./lib/local/OriginOutbox', () => ({
  loadOriginOutbox: vi.fn(async () => [...outboxStore.entries.values()].sort((a, b) => a.createdAt - b.createdAt)),
  saveOriginOutboxEntry: vi.fn(async (entry: { id: string; text: string; createdAt: number }) => { outboxStore.entries.set(entry.id, { ...entry }); return true; }),
  removeOriginOutboxEntry: vi.fn(async (id: string) => { outboxStore.entries.delete(id); }),
  clearOriginOutbox: vi.fn(async () => { outboxStore.entries.clear(); }),
}));

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from './App';

const model = 'google/gemma-4-31b-it:free';
const jsonChatResponse = (content: string) => new Response(JSON.stringify({
  content,
  routing: { modelId: model, freeOnly: true, cost: 0, actualCostUsd: 0, estimatedCostUsd: 0, usage: { costUsd: 0 }, providerRouting: { requestedModel: model, servedModel: model, fallbackUsed: false } },
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

function requestPath(input: RequestInfo | URL): string {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(rawUrl, 'http://localhost').pathname;
}

const echoFetch = () => vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  if (requestPath(input) !== '/api/chat') return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  const body = JSON.parse((init?.body as string) ?? '{}') as { messages: { content: string }[] };
  return jsonChatResponse(`回答：${body.messages.at(-1)?.content ?? ''}`);
});

const chatCalls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter(([input]) => requestPath(input as RequestInfo | URL) === '/api/chat');
const lastUserText = (call: unknown[]) => {
  const body = JSON.parse((call[1] as RequestInit)?.body as string) as { messages: { role: string; content: string }[] };
  return body.messages.at(-1)?.content ?? '';
};

const setOnline = (online: boolean) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
  fireEvent(window, new Event(online ? 'online' : 'offline'));
};

describe('chat send outbox (offline persistence and auto-send)', () => {
  beforeEach(() => { outboxStore.entries.clear(); });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  });

  it('shows the offline status line only while offline', () => {
    const fetchMock = echoFetch();
    vi.stubGlobal('fetch', fetchMock);
    setOnline(false);
    render(<App language="ja" />);
    expect(screen.getByTestId('origin-offline-status').textContent).toContain('オフライン中です');
    setOnline(true);
    expect(screen.queryByTestId('origin-offline-status')).toBeNull();
  });

  it('saves an offline send to the outbox instead of losing it, and never calls the API', async () => {
    const fetchMock = echoFetch();
    vi.stubGlobal('fetch', fetchMock);
    setOnline(false);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '圏外の依頼' } });
    fireEvent.click(screen.getByTestId('start-request-button'));

    await waitFor(() => expect(screen.getByTestId('origin-send-queue')).toBeTruthy());
    expect(within(screen.getByTestId('origin-send-queue')).getByText('圏外の依頼')).toBeTruthy();
    expect(screen.getByText('オフラインのため送信待ちに保存しました。送信待ちは1件です。接続が戻ると自動で送信します。')).toBeTruthy();
    expect([...outboxStore.entries.values()].map((entry) => entry.text)).toEqual(['圏外の依頼']);
    expect(chatCalls(fetchMock)).toHaveLength(0);
    expect((screen.getByTestId('origin-home-request') as HTMLTextAreaElement).value).toBe('');
  });

  it('auto-sends the saved request exactly once when the connection returns', async () => {
    const fetchMock = echoFetch();
    vi.stubGlobal('fetch', fetchMock);
    setOnline(false);
    render(<App language="ja" />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: '圏外の依頼' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(outboxStore.entries.size).toBe(1));

    setOnline(true);
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(1), { timeout: 3000 });
    expect(lastUserText(chatCalls(fetchMock)[0])).toBe('圏外の依頼');
    await waitFor(() => expect(screen.getByText('回答：圏外の依頼')).toBeTruthy(), { timeout: 5000 });
    expect(outboxStore.entries.size).toBe(0);
    expect(screen.queryByTestId('origin-send-queue')).toBeNull();
  });

  it('restores a request saved in a previous session and sends it on launch when online', async () => {
    outboxStore.entries.set('q-seed-1', { id: 'q-seed-1', text: '再起動前の依頼', createdAt: 1 });
    const fetchMock = echoFetch();
    vi.stubGlobal('fetch', fetchMock);
    render(<App language="ja" />);
    await waitFor(() => expect(chatCalls(fetchMock)).toHaveLength(1), { timeout: 3000 });
    expect(lastUserText(chatCalls(fetchMock)[0])).toBe('再起動前の依頼');
    await waitFor(() => expect(screen.getByText('回答：再起動前の依頼')).toBeTruthy(), { timeout: 5000 });
    expect(outboxStore.entries.size).toBe(0);
  });

  it('keeps a restored request queued while offline, and deleting its chip deletes the stored copy', async () => {
    outboxStore.entries.set('q-seed-2', { id: 'q-seed-2', text: '残っていた依頼', createdAt: 1 });
    const fetchMock = echoFetch();
    vi.stubGlobal('fetch', fetchMock);
    setOnline(false);
    render(<App language="ja" />);
    await waitFor(() => expect(screen.getByTestId('origin-send-queue')).toBeTruthy());
    expect(within(screen.getByTestId('origin-send-queue')).getByText('残っていた依頼')).toBeTruthy();
    expect(chatCalls(fetchMock)).toHaveLength(0);

    fireEvent.click(within(screen.getByTestId('origin-send-queue-chip')).getByTestId('origin-send-queue-remove'));
    await waitFor(() => expect(screen.queryByTestId('origin-send-queue')).toBeNull());
    expect(outboxStore.entries.size).toBe(0);

    setOnline(true);
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    expect(chatCalls(fetchMock)).toHaveLength(0);
  });

  it('discards the outbox when the conversation is reset', async () => {
    const fetchMock = echoFetch();
    vi.stubGlobal('fetch', fetchMock);
    setOnline(false);
    const { rerender } = render(<App language="ja" resetSignal={0} />);
    fireEvent.change(screen.getByTestId('origin-home-request'), { target: { value: 'リセットで消える依頼' } });
    fireEvent.click(screen.getByTestId('start-request-button'));
    await waitFor(() => expect(outboxStore.entries.size).toBe(1));

    rerender(<App language="ja" resetSignal={1} />);
    await waitFor(() => expect(outboxStore.entries.size).toBe(0));
    expect(screen.queryByTestId('origin-send-queue')).toBeNull();

    setOnline(true);
    await new Promise((resolve) => { setTimeout(resolve, 300); });
    expect(chatCalls(fetchMock)).toHaveLength(0);
  });
});
