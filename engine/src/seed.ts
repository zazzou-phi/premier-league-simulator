import { openDatabase } from './db/client.js';
import { Repository } from './db/repository.js';
import { seedDatabase } from './db/seed.js';

const force = process.argv.includes('--force') || process.argv.includes('--seed');
const dbFlag = process.argv.indexOf('--db');
const dbPath = dbFlag >= 0 ? process.argv[dbFlag + 1] : undefined;

const { sqlite, db } = openDatabase(dbPath);
seedDatabase(sqlite, { force });

const repo = new Repository(db);
const simulation = repo.ensureDefaultSimulation();

console.log(
  JSON.stringify(
    {
      ok: true,
      forced: force,
      teams: repo.getTeams().length,
      fixtures: repo.getFixtures().length,
      defaultSimulation: { id: simulation.id, name: simulation.name },
    },
    null,
    2,
  ),
);
