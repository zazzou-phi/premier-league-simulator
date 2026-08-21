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

function picksHelp(publicMode: boolean): ViewHelp {
  const about: HelpSection[] = [
    {
      title: 'What this view shows',
      paragraphs: [
        'A pick is the single scoreline the app commits to for a fixture, derived from a Monte Carlo batch of simulated seasons.',
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
      title: 'Table zones',
      paragraphs: [
        'Position 1 takes the title, 2–4 join the champion in the Champions League, 5 goes to the Europa League, and 18–20 are relegated. Draws stand — there are no shoot-outs.',
      ],
    },
  ];

  const howToBullets: string[] = [];

  if (!publicMode) {
    howToBullets.push(
      'Run Monte Carlo to play thousands of seasons and build or refresh a projection.',
      'Manage Projections renames or deletes saved Monte Carlo batches.',
    );
    about.splice(1, 0, {
      title: 'Season form',
      paragraphs: [SEASON_FORM_HINT],
    });
    about.splice(2, 0, {
      title: 'Upset factor',
      paragraphs: [UPSET_FACTOR_HINT],
    });
  }

  return {
    title: APP_VIEW_LABELS.picks,
    about,
    howTo: howToBullets.length
      ? [{ title: 'Controls and interactions', bullets: howToBullets }]
      : [],
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

function resultsHelp(): ViewHelp {
  return {
    title: APP_VIEW_LABELS.results,
    about: [
      {
        title: 'What this view shows',
        paragraphs: [
          'Results is the record of real match scores played so far, with the live league table they produce. It is read-only: scores are synced from fixturedownload, which is authoritative and overwrites any local change.',
        ],
      },
      {
        title: 'How results affect other views',
        paragraphs: [
          'Recorded results lock the matching fixtures in Monte Carlo runs, so the projections and the picks season stay anchored to what has actually happened.',
        ],
      },
    ],
    howTo: [],
  };
}

export function getViewHelp(view: AppView, publicMode: boolean): ViewHelp {
  switch (view) {
    case 'picks':
      return picksHelp(publicMode);
    case 'projections':
      return projectionsHelp(publicMode);
    case 'results':
      return resultsHelp();
  }
}
