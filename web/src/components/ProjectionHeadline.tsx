import { useMemo } from 'react';
import type { TeamSeasonProjection } from '@shared/simulation/monteCarlo.js';
import type { Team } from '@shared/engine/types.js';
import { formatProbability } from '../lib/formatProbability.js';
import { teamsById } from '../lib/teamsById.js';
import { TeamBadge } from './TeamBadge.js';

interface Props {
  projections: TeamSeasonProjection[];
  runs: number;
  /** Lowest matchday still unplayed, or null once the season is complete. */
  nextMatchday: number | null;
  teams?: Team[];
}

type CardKind = 'title' | 'championsLeague' | 'relegation';

interface CardSpec {
  kind: CardKind;
  heading: string;
  probabilityOf: (row: TeamSeasonProjection) => number;
  /** Top four shows five clubs so the team on the bubble is visible. */
  count: number;
}

const CARDS: CardSpec[] = [
  { kind: 'title', heading: 'Title race', probabilityOf: (row) => row.titleProbability, count: 3 },
  {
    kind: 'championsLeague',
    heading: 'Top four',
    probabilityOf: (row) => row.championsLeagueProbability,
    count: 5,
  },
  {
    kind: 'relegation',
    heading: 'Relegation',
    probabilityOf: (row) => row.relegationProbability,
    count: 3,
  },
];

export function ProjectionHeadline({ projections, runs, nextMatchday, teams = [] }: Props) {
  const byId = useMemo(() => teamsById(teams), [teams]);

  if (projections.length === 0) return null;

  const provenance = `${runs.toLocaleString()} seasons simulated · ${
    nextMatchday == null ? 'season complete' : `MD${nextMatchday} next`
  }`;

  return (
    <section className="projection-headline" aria-label="Projection summary">
      <div className="projection-headline-cards">
        {CARDS.map(({ kind, heading, probabilityOf, count }) => {
          const leaders = [...projections]
            .sort((a, b) => probabilityOf(b) - probabilityOf(a))
            .slice(0, count);

          return (
            <article key={kind} className={`headline-card headline-card-${kind}`}>
              <h2 className="headline-card-heading">{heading}</h2>
              <ol className="headline-card-list">
                {leaders.map((row, index) => (
                  <li
                    key={row.teamId}
                    className={index === 0 ? 'headline-row headline-row-lead' : 'headline-row'}
                  >
                    <span className="headline-team">
                      <TeamBadge
                        team={byId.get(row.teamId)}
                        teamName={row.teamName}
                        codeClassName="league-table-short"
                      />
                      {row.teamName}
                    </span>
                    <span className="headline-pct">{formatProbability(probabilityOf(row))}</span>
                  </li>
                ))}
              </ol>
            </article>
          );
        })}
      </div>
      <p className="projection-headline-provenance muted">{provenance}</p>
    </section>
  );
}
