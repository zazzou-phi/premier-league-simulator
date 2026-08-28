import type { AppView } from './appView.js';
import { APP_VIEW_LABELS } from './appView.js';
import {
  PICK_STRATEGY_DESCRIPTIONS,
  PICK_STRATEGY_HINT,
  PICK_STRATEGY_OPTIONS,
} from './pickStrategy.js';
import { SEASON_FORM_HINT } from './seasonForm.js';
import { UPSET_FACTOR_HINT } from './upsetVariance.js';

export type HelpSection = {
  title?: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type ViewHelp = {
  title: string;
  about: HelpSection[];
  howTo: HelpSection[];
};

function seasonHelp(publicMode: boolean): ViewHelp {
  const about: HelpSection[] = [
    {
      title: 'What this view shows',
      paragraphs: [
        'One season, from both directions: the real scores played so far and, for every fixture still to come, the single scoreline the app commits to — its pick, derived from a Monte Carlo batch of simulated seasons.',
        'Recorded scores are synced from fixturedownload, which is authoritative and overwrites any local change. They also lock the matching fixtures in Monte Carlo runs, so the picks stay anchored to what has actually happened.',
      ],
    },
    {
      title: 'Season through',
      paragraphs: [
        'The cutoff reads the season as of a matchday. Every fixture up to it counts towards the table — its real score where one exists, its pick where none does — and everything after it is blank. Set it to Now for the real table, or Full season for the projected finish.',
      ],
    },
    {
      title: 'Picked scorelines',
      paragraphs: [PICK_STRATEGY_HINT],
      bullets: PICK_STRATEGY_OPTIONS.map(
        (option) => `${option.label} — ${PICK_STRATEGY_DESCRIPTIONS[option.value]}`,
      ),
    },
    {
      title: 'Which projection a matchday reads',
      paragraphs: [
        'Each round is read through one Monte Carlo batch, named in its Matchday header. A batch run after a round was played was handed those results rather than forecasting them, so an unpinned round falls back to the last batch that faced it blind — which is how a settled week keeps the pick it was up against.',
      ],
    },
    {
      title: 'Table zones',
      paragraphs: [
        'Position 1 takes the title, 2–4 join the champion in the Champions League, 5 goes to the Europa League, and 18–20 are relegated. Draws stand — there are no shoot-outs.',
      ],
    },
  ];

  const howToBullets: string[] = [
    'Drag Season through, or use Now and Full season, to move the table between what has happened and what is projected.',
    'Click a club in the table to filter the fixture list to its matches.',
  ];

  if (!publicMode) {
    howToBullets.push(
      'Press a Matchday header to read that round through a different projection, and compare what an earlier batch made of it.',
      'Run Monte Carlo to play thousands of seasons and build or refresh a projection.',
      'Manage Projections renames or deletes saved Monte Carlo batches.',
    );
    about.splice(2, 0, {
      title: 'Season form',
      paragraphs: [SEASON_FORM_HINT],
    });
    about.splice(3, 0, {
      title: 'Upset factor',
      paragraphs: [UPSET_FACTOR_HINT],
    });
  }

  return {
    title: APP_VIEW_LABELS.season,
    about,
    howTo: [{ title: 'Controls and interactions', bullets: howToBullets }],
  };
}

function projectionsHelp(publicMode: boolean): ViewHelp {
  const howToBullets = [
    'Sort the projections table by any column to rank clubs by title odds or relegation risk.',
  ];

  if (!publicMode) {
    howToBullets.push(
      'Run Monte Carlo to play thousands of seasons and build or refresh a projection.',
      'Manage Projections renames or deletes saved Monte Carlo batches.',
    );
  }

  return {
    title: APP_VIEW_LABELS.projections,
    about: [
      {
        title: 'What this view shows',
        paragraphs: [
          'Projections aggregates a Monte Carlo batch: how often each club finished in each position across every simulated season.',
        ],
      },
      {
        title: 'Reading the numbers',
        bullets: [
          'Title, Top 4, Europe, and Relegation are the share of seasons ending in each zone.',
          'Avg Pts and Avg Pos are means across the whole batch, not a single season.',
          'The distribution bar stacks all 20 finishing positions left to right, coloured by zone.',
        ],
      },
      {
        title: 'Picked scorelines',
        paragraphs: [PICK_STRATEGY_HINT],
      },
    ],
    howTo: howToBullets.length
      ? [{ title: 'Controls and interactions', bullets: howToBullets }]
      : [],
  };
}

export function getViewHelp(view: AppView, publicMode: boolean): ViewHelp {
  switch (view) {
    case 'season':
      return seasonHelp(publicMode);
    case 'projections':
      return projectionsHelp(publicMode);
  }
}
