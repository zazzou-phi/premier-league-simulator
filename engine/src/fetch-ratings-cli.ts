import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchAndWriteTeams } from './data/fetchRatings.js';

const here = dirname(fileURLToPath(import.meta.url));
const defaultOut = resolve(join(here, '../../data/teams.csv'));

function parseArgs(argv: string[]): { out: string; date: Date } {
  let out = defaultOut;
  let date = new Date();

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' && argv[i + 1]) out = resolve(argv[++i]!);
    else if (argv[i] === '--date' && argv[i + 1]) date = new Date(`${argv[++i]!}T00:00:00Z`);
  }

  if (Number.isNaN(date.getTime())) throw new Error('Invalid --date; expected YYYY-MM-DD');
  return { out, date };
}

const { out, date } = parseArgs(process.argv.slice(2));
const teams = await fetchAndWriteTeams(out, date);

console.log(
  JSON.stringify(
    {
      ok: true,
      out,
      asOf: date.toISOString().slice(0, 10),
      teams: teams.length,
      strongest: teams[0]?.name,
      weakest: teams.at(-1)?.name,
    },
    null,
    2,
  ),
);
