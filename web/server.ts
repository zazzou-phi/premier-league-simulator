#!/usr/bin/env node
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

const PORT = Number(process.env.PORT ?? 2627);
const API_PORT = Number(process.env.API_PORT ?? 3123);
const API_HOST = process.env.API_HOST ?? '127.0.0.1';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/') || pathname === '/health';
}

/**
 * Streamed rather than buffered so Monte Carlo NDJSON progress reaches the browser
 * line by line instead of arriving all at once when the run finishes.
 */
function proxyToApi(req: IncomingMessage, res: ServerResponse): void {
  const proxied = httpRequest(
    {
      host: API_HOST,
      port: API_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `${API_HOST}:${API_PORT}` },
    },
    (apiRes) => {
      res.writeHead(apiRes.statusCode ?? 502, apiRes.headers);
      apiRes.pipe(res);
    },
  );

  proxied.on('error', () => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: `Engine API is not reachable at http://${API_HOST}:${API_PORT}`,
        code: 'api_unreachable',
      }),
    );
  });

  req.pipe(proxied);
}

function serveStaticFile(res: ServerResponse, filePath: string): boolean {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
  return true;
}

function createProdServer() {
  const distDir = join(__dirname, 'dist');
  if (!existsSync(distDir)) {
    throw new Error('dist/ not found — run "npm run build" before starting in production mode');
  }

  return createServer((req, res) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? '/';

    if (isApiPath(pathname)) {
      proxyToApi(req, res);
      return;
    }

    const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    if (serveStaticFile(res, join(distDir, relative))) return;
    serveStaticFile(res, join(distDir, 'index.html'));
  });
}

async function createDevServer() {
  const vite = await createViteServer({
    root: __dirname,
    configFile: join(__dirname, 'vite.config.ts'),
    server: { middlewareMode: true },
    appType: 'custom',
  });

  return createServer((req, res) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0] ?? '/';

    if (isApiPath(pathname)) {
      proxyToApi(req, res);
      return;
    }

    vite.middlewares(req, res, async () => {
      try {
        let html = readFileSync(join(__dirname, 'index.html'), 'utf-8');
        html = await vite.transformIndexHtml(url, html);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      } catch (err) {
        console.error(err);
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    });
  });
}

async function main() {
  const server = isProd ? createProdServer() : await createDevServer();
  server.listen(PORT, () => {
    console.log(`Premier League Simulator at http://localhost:${PORT}`);
    console.log(`Proxying /api and /health to http://${API_HOST}:${API_PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
