import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRemoteText, RemoteFetchError } from '../src/data/fetchRemote.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A server that accepts the connection and then says nothing — the case a bare fetch waits out. */
function stubSilentHost(): void {
  vi.stubGlobal(
    'fetch',
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
  );
}

describe('fetchRemoteText', () => {
  it('gives up on a host that never answers', async () => {
    stubSilentHost();

    const error = await fetchRemoteText('http://api.clubelo.com/2026-08-22', 'clubelo ratings', 25)
      .then(() => null)
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(RemoteFetchError);
    expect((error as RemoteFetchError).message).toContain('clubelo ratings did not respond');
    expect((error as RemoteFetchError).code).toBe('REMOTE_UNREACHABLE');
  });

  it('reports a refused connection as unreachable too', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));

    await expect(fetchRemoteText('http://nope.invalid', 'clubelo ratings')).rejects.toThrow(
      /clubelo ratings is unreachable/,
    );
  });

  it('reports an error status against the source that returned it', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404, statusText: 'Not Found' })));

    await expect(fetchRemoteText('https://example.test/epl.csv', 'fixtures')).rejects.toThrow(
      /Failed to download fixtures \(404 Not Found\)/,
    );
  });

  it('returns the body when the host answers', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('Home Team,Away Team\n')));

    await expect(fetchRemoteText('https://example.test/epl.csv', 'fixtures')).resolves.toBe(
      'Home Team,Away Team\n',
    );
  });
});
