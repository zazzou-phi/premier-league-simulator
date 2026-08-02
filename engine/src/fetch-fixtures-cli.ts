import { fetchAndWriteFixtures } from './data/fetchFixtures.js';
import { getDefaultFixturesCsvPath } from './data/fixturesCsv.js';

const outFlag = process.argv.indexOf('--out');
const outPath = outFlag >= 0 ? process.argv[outFlag + 1] : getDefaultFixturesCsvPath();

const result = await fetchAndWriteFixtures(outPath);
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
