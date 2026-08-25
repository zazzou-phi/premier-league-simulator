/**
 * Fits the in-season Elo update for a frozen base rating.
 *
 * Run this before changing `DEFAULT_SEASON_ELO_K` or `DEFAULT_MOV_SCHEME`. The K currently
 * shipped was calibrated against final-table dispersion, which is a different target: it asks
 * whether simulated seasons spread out like real ones, not whether the rating predicts the
 * next matchday. With clubelo no longer refreshing the base, drift is doing predictive work
 * and wants a K fitted for that.
 *
 * Reads only the on-disk cache in `engine/.cache/fitting`, so it runs with the network down.
 */
import {
  pairedComparison,
  referenceBaselines,
  sweepEloK,
  type EloKCandidate,
} from './fitting/eloDriftFit.js';
import { loadHistoricalDataset } from './fitting/historicalData.js';
import type { MovScheme } from './engine/seasonElo.js';

const SEASONS = [2021, 2022, 2023, 2024, 2025];
const ELO_KS = [0, 5, 10, 15, 20, 25, 30, 40, 50];
const MOV_SCHEMES: MovScheme[] = ['none', 'linear', 'log'];
const DRIFT_WEIGHTS = [1];

function fmt(value: number, places = 5): string {
  return Number.isFinite(value) ? value.toFixed(places) : 'n/a';
}

function table(candidates: EloKCandidate[], reference: number): void {
  console.log('  K   scheme   weight   mean log-lik   vs frozen');
  console.log('  --  -------  ------   ------------   ---------');
  for (const c of candidates) {
    const delta = c.logLikelihood - reference;
    const sign = delta >= 0 ? '+' : '';
    console.log(
      `  ${String(c.eloK).padStart(2)}  ${c.movScheme.padEnd(7)}  ${c.driftWeight
        .toFixed(1)
        .padStart(6)}   ${fmt(c.logLikelihood).padStart(12)}   ${sign}${fmt(delta)}`,
    );
  }
}

async function main(): Promise<void> {
  const dataset = await loadHistoricalDataset({ seasons: SEASONS });
  console.log(
    `Loaded ${dataset.matches.length} matches across ${SEASONS.length} seasons ` +
      `(${SEASONS[0]}/${String(SEASONS[0]! + 1).slice(2)}–${SEASONS.at(-1)}/${String(
        SEASONS.at(-1)! + 1,
      ).slice(2)}).\n`,
  );

  const baselines = referenceBaselines(dataset);
  console.log('Reference points (mean out-of-sample log-likelihood per match):');
  console.log(
    `  live clubelo, no drift   ${fmt(baselines.liveClubelo.logLikelihood)}   ` +
      `(the pre-outage engine — the ceiling)`,
  );
  console.log(
    `  frozen anchor, no drift  ${fmt(baselines.frozenNoDrift.logLikelihood)}   ` +
      `(--no-ratings with drift off — the floor)`,
  );
  const headroom = baselines.liveClubelo.logLikelihood - baselines.frozenNoDrift.logLikelihood;
  console.log(`  headroom                 ${fmt(headroom)}\n`);

  const candidates = sweepEloK(dataset, {
    eloKs: ELO_KS,
    movSchemes: MOV_SCHEMES,
    driftWeights: DRIFT_WEIGHTS,
  });

  console.log(
    `Frozen anchor + drift, ${candidates[0]!.evaluated} matchday origins, best first:\n`,
  );
  table(candidates, baselines.frozenNoDrift.logLikelihood);

  const best = candidates[0]!;
  const recovered = headroom === 0 ? Number.NaN : (best.logLikelihood - baselines.frozenNoDrift.logLikelihood) / headroom;
  console.log(
    `\nBest: K=${best.eloK}, scheme=${best.movScheme}, weight=${best.driftWeight.toFixed(1)} ` +
      `— recovers ${(recovered * 100).toFixed(1)}% of the gap to live clubelo.`,
  );

  // The ranking above is not evidence on its own: origin-to-origin variance dwarfs the spread
  // between candidates, and every candidate is scored on the same origins. Only the paired
  // difference says whether a change is real.
  const find = (eloK: number, movScheme: MovScheme) =>
    candidates.find((c) => c.eloK === eloK && c.movScheme === movScheme)!;

  const shipped = find(20, 'none');
  const comparisons: Array<[string, EloKCandidate, EloKCandidate]> = [
    ['best vs shipped default (K=20, none)', best, shipped],
    ['K=25 vs K=20, holding scheme=none', find(25, 'none'), shipped],
    ['log MoV vs none, holding K=25', find(25, 'log'), find(25, 'none')],
    ['linear MoV vs none, holding K=25', find(25, 'linear'), find(25, 'none')],
  ];

  console.log('\nPaired over the same origins (|t| under ~2 is noise):\n');
  console.log('  comparison                              mean diff        SE       t');
  console.log('  --------------------------------------  ---------  --------  ------');
  for (const [label, a, b] of comparisons) {
    const p = pairedComparison(a.result, b.result);
    const sign = p.meanDifference >= 0 ? '+' : '';
    console.log(
      `  ${label.padEnd(38)}  ${(sign + fmt(p.meanDifference)).padStart(9)}  ` +
        `${fmt(p.standardError).padStart(8)}  ${p.tStatistic.toFixed(2).padStart(6)}`,
    );
  }

  const driftVsFrozen = pairedComparison(best.result, baselines.frozenNoDrift);
  console.log(
    `\n  drift vs no drift at the best setting:  ` +
      `${fmt(driftVsFrozen.meanDifference)} ± ${fmt(driftVsFrozen.standardError)} ` +
      `(t = ${driftVsFrozen.tStatistic.toFixed(2)})`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
