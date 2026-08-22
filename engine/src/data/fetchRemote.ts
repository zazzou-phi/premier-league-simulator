/**
 * Both weekly pulls go through here so neither can hang the loop. Node's default is ~5
 * minutes of patience per request, which is a long time to hold the week's single-flight
 * lock — and a network that silently drops the connection (a firewall that allows 443 but
 * not clubelo's plain HTTP, or one that expects a proxy `fetch` does not use) fails in
 * exactly that way.
 */
export const REMOTE_FETCH_TIMEOUT_MS = 20_000;

/**
 * Fetch a remote CSV as text, or fail with a message that names the source. The timeout
 * covers the body as well as the headers, so a stalled download is caught too.
 */
export async function fetchRemoteText(
  url: string,
  source: string,
  timeoutMs = REMOTE_FETCH_TIMEOUT_MS,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new RemoteFetchError(source, url, timeoutMs, error);
  }

  if (!response.ok) {
    throw new Error(
      `Failed to download ${source} (${response.status} ${response.statusText}): ${url}`,
    );
  }

  try {
    return await response.text();
  } catch (error) {
    throw new RemoteFetchError(source, url, timeoutMs, error);
  }
}

/** The host never answered — unreachable, blocked, or slower than the timeout allows. */
export class RemoteFetchError extends Error {
  readonly code = 'REMOTE_UNREACHABLE';

  constructor(
    readonly source: string,
    readonly url: string,
    timeoutMs: number,
    readonly cause: unknown,
  ) {
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
    super(
      timedOut
        ? `${source} did not respond within ${Math.round(timeoutMs / 1000)}s: ${url}`
        : `${source} is unreachable: ${url} (${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = 'RemoteFetchError';
  }
}
