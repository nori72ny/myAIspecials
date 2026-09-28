import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageProviderConnect } from './ImageProviderConnect';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const start = {
  ok: true,
  authorizationUri: 'https://enter.pollinations.ai/authorize?response_type=code&client_id=pk_test12345678&redirect_uri=https%3A%2F%2Forigin.example.com%2Fapi%2Fcreative%2Fv1.5%2Fraster%2Fconnect%2Fcallback&scope=usage&models=tomdacatto%2Fsana&budget=0&expiry=7&state=abc&code_challenge=xyz&code_challenge_method=S256',
  expiresIn: 600,
  model: 'tomdacatto/sana',
  budgetPollen: 0,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('image connection', () => {
  it('starts zero-budget PKCE and resumes only after connected + zero-cost readiness', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(start))
      .mockResolvedValueOnce(json({ ok: true, connected: true }))
      .mockResolvedValueOnce(json({ ready: true, zeroCostVerified: true, freeOnly: true, paidFallbackEnabled: false }));
    vi.stubGlobal('fetch', fetchMock);
    const connected = vi.fn();

    render(<ImageProviderConnect language="ja" onConnected={connected} onCancel={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('安全な接続を開始')); });

    const link = screen.getByText('承認画面を開く') as HTMLAnchorElement;
    expect(link.href).toContain('budget=0');
    expect(link.href).toContain('models=tomdacatto%2Fsana');
    expect(link.href).toContain('scope=usage');

    await act(async () => { fireEvent.click(screen.getByText('承認を確認して再開')); });
    expect(connected).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/creative/v1.5/raster/connect/start',
      '/api/creative/v1.5/raster/connect/status',
      '/api/creative/v1.5/raster/status',
    ]);
  });

  it('rejects an approval URL that is not the exact Pollinations authorization surface', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({
      ...start,
      authorizationUri: 'https://attacker.example/authorize?budget=0&scope=usage&models=tomdacatto%2Fsana',
    })));
    render(<ImageProviderConnect language="ja" onConnected={vi.fn()} onCancel={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('安全な接続を開始')); });
    expect(screen.queryByText('承認画面を開く')).toBeNull();
    expect(screen.getByText(/接続を準備できませんでした/)).toBeTruthy();
  });

  it('does not resume when approval is not yet reflected in the same-origin cookie', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(start))
      .mockResolvedValueOnce(json({ ok: true, connected: false }));
    vi.stubGlobal('fetch', fetchMock);
    const connected = vi.fn();

    render(<ImageProviderConnect language="ja" onConnected={connected} onCancel={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('安全な接続を開始')); });
    await act(async () => { fireEvent.click(screen.getByText('承認を確認して再開')); });

    expect(connected).not.toHaveBeenCalled();
    expect(screen.getByText(/承認をまだ確認できません/)).toBeTruthy();
  });

  it('does not resume when the provider is connected but no exact zero-cost model is ready', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(start))
      .mockResolvedValueOnce(json({ ok: true, connected: true }))
      .mockResolvedValueOnce(json({ ready: false, zeroCostVerified: false }, 503));
    vi.stubGlobal('fetch', fetchMock);
    const connected = vi.fn();

    render(<ImageProviderConnect language="ja" onConnected={connected} onCancel={vi.fn()} />);
    await act(async () => { fireEvent.click(screen.getByText('安全な接続を開始')); });
    await act(async () => { fireEvent.click(screen.getByText('承認を確認して再開')); });

    expect(connected).not.toHaveBeenCalled();
    expect(screen.getByText(/画像は生成していません/)).toBeTruthy();
  });

  it('aborts an in-flight request on cancel', async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise(() => {});
    }));
    const cancel = vi.fn();

    render(<ImageProviderConnect language="ja" onConnected={vi.fn()} onCancel={cancel} />);
    fireEvent.click(screen.getByText('安全な接続を開始'));
    fireEvent.click(screen.getByText('キャンセル'));

    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
