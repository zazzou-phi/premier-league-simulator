import type { AppView } from './appView.js';
import { APP_VIEW_LABELS } from './appView.js';
import { CONSENSUS_MODE_HINT } from './consensusMode.js';
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

function consensusHelp(publicMode: boolean): ViewHelp {
  const about: HelpSection[] = [
    {
      title: 'What this view shows',
      paragraphs: [
        'Predictions is a single representative scoreline for every fixture, derived from a Monte Carlo batch of simulated seasons.',
      ],
    },
    {
      title: 'Consensus scorelines',
      paragraphs: [CONSENSUS_MODE_HINT],
    },
    {
      title: 'Table zones',
      paragraphs: [
        'Position 1 takes the title, 2–4 join the champion in the Champions League, 5 goes to the Europa League, and 18–20 are relegated. Draws stand — there are no shoot-outs.',
      ],
    },
  ];

  const howToBullets = [
    'Click a fixture to open its full outcome and scoreline distribution across the batch.',
    'Click a club in the table to filter the fixture list to its 38 matches; click again to clear.',
    'On mobile, switch between the Table and Fixtures panels with the tabs.',
  ];

  if (!publicMode) {
    howToBullets.push(
      'Change the consensus mode in the ⋮ menu to re-derive scorelines from the same batch.',
      'Run Monte Carlo to play thousands of seasons and build or refresh a projection.',
      'Use Manage Projections in the ⋮ menu to rename or delete Monte Carlo batches.',
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
    title: APP_VIEW_LABELS.consensus,
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
      'Change the consensus mode in the ⋮ menu to re-derive scorelines from the same batch.',
      'Use Manage Projections in the ⋮ menu to rename or delete Monte Carlo batches.',
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
        title: 'Consensus scorelines',
        paragraphs: [CONSENSUS_MODE_HINT],
      },
    ],
    howTo: [{ title: 'Controls and interactions', bullets: howToBullets }],
  };
}

function resultsHelp(): ViewHelp {
  return {
    title: APP_VIEW_LABELS.results,
    about: [
      {
        title: 'What this view shows',
        paragraphs: [
          'Results is the record of real match scores entered so far, with the live league table they produce.',
        ],
      },
      {
        title: 'How results affect other views',
        paragraphs: [
          'Recorded results lock the matching fixtures in Monte Carlo runs, so projections and predictions stay anchored to what has actually happened.',
        ],
      },
    ],
    howTo: [
      {
        title: 'Controls and interactions',
        bullets: [
          'Double-click a fixture score to record a real result; select a row and press Clear to remove one.',
          'Click a club in the table to filter the fixture list to its matches.',
          'On mobile, switch between the Table and Fixtures panels with the tabs.',
        ],
      },
    ],
  };
}

export function getViewHelp(view: AppView, publicMode: boolean): ViewHelp {
  switch (view) {
    case 'consensus':
      return consensusHelp(publicMode);
    case 'projections':
      return projectionsHelp(publicMode);
    case 'results':
      return resultsHelp();
  }
}
