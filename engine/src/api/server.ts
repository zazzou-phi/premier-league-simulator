import { serve } from '@hono/node-server';
import { createApiApp } from './app.js';
import { createRepository, parseServerArgs } from './bootstrap.js';

const args = parseServerArgs(process.argv.slice(2));
const repo = createRepository(args.dbPath, args.seed);
const app = createApiApp(repo);

serve({ fetch: app.fetch, port: args.port }, (info) => {
  console.log(`Premier League simulator API listening on http://localhost:${info.port}`);
});
