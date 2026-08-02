import { openDatabase } from '../db/client.js';
import { Repository } from '../db/repository.js';
import { seedDatabase } from '../db/seed.js';

export interface ServerArgs {
  dbPath?: string;
  port: number;
  seed: boolean;
}

export function parseServerArgs(argv: string[]): ServerArgs {
  let dbPath: string | undefined;
  let port = 3123;
  let seed = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db' && argv[i + 1]) dbPath = argv[++i];
    else if (argv[i] === '--port' && argv[i + 1]) port = Number(argv[++i]);
    else if (argv[i] === '--seed') seed = true;
  }

  return { dbPath, port, seed };
}

export function createRepository(dbPath?: string, forceSeed = false): Repository {
  const { sqlite, db } = openDatabase(dbPath);
  seedDatabase(sqlite, { force: forceSeed });
  const repo = new Repository(db);
  repo.ensureDefaultSimulation();
  return repo;
}
