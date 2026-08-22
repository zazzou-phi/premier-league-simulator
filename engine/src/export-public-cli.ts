import { resolve } from 'node:path';
import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { writePublicSnapshot } from './export/writePublicSnapshot.js';
import { getDefaultSnapshotDir } from './season/weekRun.js';

function parseArgs(argv: string[]): { out: string; dbPath?: string } {
  let out = getDefaultSnapshotDir();
  let dbPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out = resolve(argv[++i]!);
    else if (argv[i] === '--db' && argv[i + 1]) dbPath = argv[++i];
  }
  return { out, dbPath };
}

const { out, dbPath } = parseArgs(process.argv.slice(2));
const { db } = openDatabase(dbPath);
const meta = await writePublicSnapshot(new Repository(db), out);

console.log(JSON.stringify({ ok: true, outDir: out, ...meta }, null, 2));
