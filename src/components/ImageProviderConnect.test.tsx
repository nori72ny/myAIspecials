import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageProviderConnect } from './ImageProviderConnect';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const start = { ok: true, userCode: 'ABCD-1234', verificationUri: 'https://enter.pollinations.ai/device', expiresIn: 600, interval: 1 };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('image connection', () => {
  it('requires explicit start and confirmed free readiness before resuming', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(json(start))
      .mockResolvedValueOnce(json({ ok: true, connected: true }))
      .mockResolvedValueOnce(json({ ready: true, zeroCostVerified: true, freeOnly: true, paidFallbackEnabled: false }));
    vi.stubGlobal('fetch', fetchMock);
    const connected = vi.fn();
    render(<ImageProviderConnect language="ja" onConnected={connected} onCancel={vi.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByText('接続を開始')); });
    expect(screen.getByText('ABCD-1234')).toBeTruthy();
    expect((screen.getByText('承認を確認して再開') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    await act(async () => { fireEvent.click(screen.getByText('承認を確認して再開')); });
    expect(connected).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', body: '{}' });
  });
  it('rejects an external approval URL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ ...start, verificationUri: 'https://attacker.example/device' })));
    render(<ImageProviderConnect language="ja" onConnected={vi.fn()} onCancel={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('接続を開始')); });
    expect(screen.queryByText('承認画面を開く')).toBeNull();
    expect(screen.getByText(/接続を確認できませんでした/)).toBeTruthy();
  });
  it('does not resume when the free model is unavailable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json(start))
      .mockResolvedValueOnce(json({ ok: true, connected: true }))
      .mockResolvedValueOnce(json({ ready: false }, 503)));
    const connected = vi.fn();
    render(<ImageProviderConnect language="ja" onConnected={connected} onCancel={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('接続を開始')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    await act(async () => { fireEvent.click(screen.getByText('承認を確認して再開')); });
    expect(connected).not.toHaveBeenCalled();
    expect(screen.getByText(/画像は生成していません/)).toBeTruthy();
  });
  it('aborts an in-flight request on cancel', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init) => { signal = init.signal; return new Promise(() => {}); }));
    const cancel = vi.fn();
    render(<ImageProviderConnect language="ja" onConnected={vi.fn()} onCancel={cancel} />);
    fireEvent.click(screen.getByText('接続を開始'));
    fireEvent.click(screen.getByText('キャンセル'));
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
