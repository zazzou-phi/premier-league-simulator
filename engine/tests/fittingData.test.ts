import { describe, expect, it } from 'vitest';
import {
  clubEloHistoryUrl,
  eloOn,
  parseClubEloHistory,
  parseFixtureDate,
  parseResult,
  parseSeasonCsv,
  toClubEloName,
  type EloHistory,
} from '../src/fitting/historicalData.js';
import {
  buildTrainingRows,
  chiSquaredUpperTail,
  designMatrix,
  fitLambdaModel,
} from '../src/fitting/lambdaModel.js';

describe('historical parsing', () => {
  it('reads fixturedownload day-first dates', () => {
    expect(parseFixtureDate('11/08/2023 20:00')).toBe('2023-08-11');
    expect(parseFixtureDate('01/01/2024 12:30')).toBe('2024-01-01');
    expect(() => parseFixtureDate('2023-08-11')).toThrow(/Unrecognised fixture date/);
  });

  it('reads scorelines and treats unplayed fixtures as absent', () => {
    expect(parseResult('2 - 1')).toEqual({ goalsHome: 2, goalsAway: 1 });
    expect(parseResult('0 - 0')).toEqual({ goalsHome: 0, goalsAway: 0 });
    expect(parseResult('')).toBeNull();
    expect(parseResult('  ')).toBeNull();
  });

  it('maps the club names fixturedownload spells differently from clubelo', () => {
    expect(toClubEloName('Man Utd')).toBe('Man United');
    expect(toClubEloName('Spurs')).toBe('Tottenham');
    expect(toClubEloName("Nott'm Forest")).toBe('Forest');
    expect(toClubEloName('Nottingham Forest')).toBe('Forest');
    expect(toClubEloName('Arsenal')).toBe('Arsenal');
  });

  it('strips spaces from club names for the clubelo history endpoint', () => {
    // clubelo 404s on a percent-encoded space, so this must not be encodeURIComponent.
    expect(clubEloHistoryUrl('Man United')).toMatch(/\/ManUnited$/);
    expect(clubEloHistoryUrl('Arsenal')).toMatch(/\/Arsenal$/);
  });

  it('keeps only played fixtures when parsing a season', () => {
    const csv = [
      'Match Number,Round Number,Date,Location,Home Team,Away Team,Result',
      '1,1,11/08/2023 20:00,Turf Moor,Burnley,Man City,0 - 3',
      '2,1,12/08/2023 13:00,Emirates Stadium,Arsenal,Nott\'m Forest,2 - 1',
      '3,2,19/08/2023 15:00,Anfield,Liverpool,Spurs,',
    ].join('\n');

    const matches = parseSeasonCsv(csv, 2023);

    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      season: 2023,
      matchday: 1,
      date: '2023-08-11',
      homeClub: 'Burnley',
      awayClub: 'Man City',
      goalsHome: 0,
      goalsAway: 3,
    });
    expect(matches[1]!.awayClub).toBe('Forest');
  });

  it('parses clubelo history into sorted intervals', () => {
    const csv = [
      'Rank,Club,Country,Level,Elo,From,To',
      'None,Arsenal,ENG,1,1900.5,2023-09-01,2023-09-10',
      'None,Arsenal,ENG,1,1880.25,2023-08-01,2023-08-31',
    ].join('\n');

    const intervals = parseClubEloHistory(csv);

    expect(intervals).toEqual([
      { from: '2023-08-01', to: '2023-08-31', elo: 1880.25 },
      { from: '2023-09-01', to: '2023-09-10', elo: 1900.5 },
    ]);
  });
});

describe('eloOn', () => {
  const history: EloHistory = new Map([
    [
      'Arsenal',
      [
        { from: '2023-08-01', to: '2023-08-31', elo: 1800 },
        { from: '2023-09-01', to: '2023-09-30', elo: 1850 },
        { from: '2023-10-01', to: '2023-10-31', elo: 1900 },
      ],
    ],
  ]);

  it('returns the rating current on the date', () => {
    expect(eloOn(history, 'Arsenal', '2023-08-15')).toBe(1800);
    expect(eloOn(history, 'Arsenal', '2023-09-01')).toBe(1850);
    expect(eloOn(history, 'Arsenal', '2023-09-30')).toBe(1850);
    expect(eloOn(history, 'Arsenal', '2023-10-02')).toBe(1900);
  });

  it('falls back to the nearest known rating outside the covered range', () => {
    expect(eloOn(history, 'Arsenal', '2023-07-01')).toBe(1800);
    expect(eloOn(history, 'Arsenal', '2024-05-01')).toBe(1900);
  });

  it('throws for a club with no history rather than guessing', () => {
    expect(() => eloOn(history, 'Chelsea', '2023-08-15')).toThrow(/No Elo history/);
  });
});

describe('buildTrainingRows', () => {
  const eloHistory: EloHistory = new Map([
    ['Arsenal', [{ from: '2023-01-01', to: '2030-01-01', elo: 1900 }]],
    ['Chelsea', [{ from: '2023-01-01', to: '2030-01-01', elo: 1700 }]],
  ]);

  const dataset = {
    eloHistory,
    matches: [
      {
        season: 2023,
        matchday: 1,
        date: '2023-08-12',
        homeClub: 'Arsenal',
        awayClub: 'Chelsea',
        goalsHome: 3,
        goalsAway: 0,
      },
      {
        season: 2023,
        matchday: 2,
        date: '2023-08-19',
        homeClub: 'Chelsea',
        awayClub: 'Arsenal',
        goalsHome: 1,
        goalsAway: 1,
      },
    ],
  };

  it('scales the Elo gap by the Elo denominator', () => {
    const rows = buildTrainingRows(dataset);
    expect(rows[0]!.eloDiff).toBeCloseTo((1900 - 1700) / 400, 12);
  });

  it('starts a season with no drift and carries it into later matchdays', () => {
    const rows = buildTrainingRows(dataset);

    expect(rows[0]!.driftDiff).toBe(0);
    // Arsenal beat a weaker side, so it is the away team's drift that is now the higher of
    // the two once the sides swap: driftDiff is Chelsea minus Arsenal and must be negative.
    expect(rows[1]!.driftDiff).toBeLessThan(0);
  });

  it('freezes drift across a matchday so same-day fixtures share a baseline', () => {
    const sameDay = {
      eloHistory,
      matches: [
        { ...dataset.matches[0]!, matchday: 1 },
        {
          season: 2023,
          matchday: 1,
          date: '2023-08-12',
          homeClub: 'Chelsea',
          awayClub: 'Arsenal',
          goalsHome: 2,
          goalsAway: 0,
        },
      ],
    };

    const rows = buildTrainingRows(sameDay);

    expect(rows[0]!.driftDiff).toBe(0);
    expect(rows[1]!.driftDiff).toBe(0);
  });
});

describe('designMatrix', () => {
  const rows = buildTrainingRows({
    eloHistory: new Map([
      ['A', [{ from: '2020-01-01', to: '2030-01-01', elo: 1800 }]],
      ['B', [{ from: '2020-01-01', to: '2030-01-01', elo: 1600 }]],
    ]),
    matches: [
      {
        season: 2023,
        matchday: 1,
        date: '2023-08-12',
        homeClub: 'A',
        awayClub: 'B',
        goalsHome: 1,
        goalsAway: 0,
      },
    ],
  });

  it('drops the drift column when drift is excluded', () => {
    expect(designMatrix(rows, true)[0]).toHaveLength(3);
    expect(designMatrix(rows, false)[0]).toHaveLength(2);
    expect(designMatrix(rows, false)[0]![0]).toBe(1);
  });
});

describe('chiSquaredUpperTail', () => {
  it('matches known chi-squared critical values', () => {
    // The 5% points for 1, 2 and 3 degrees of freedom.
    expect(chiSquaredUpperTail(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquaredUpperTail(5.991, 2)).toBeCloseTo(0.05, 3);
    expect(chiSquaredUpperTail(7.815, 3)).toBeCloseTo(0.05, 3);
    expect(chiSquaredUpperTail(0, 2)).toBe(1);
  });

  it('refuses degrees of freedom it has no formula for', () => {
    expect(() => chiSquaredUpperTail(1, 4)).toThrow(/1 to 3 degrees of freedom/);
  });
});

describe('fitLambdaModel', () => {
  // A tiny synthetic league: two strengths, repeated, so the fit is well determined.
  const eloHistory: EloHistory = new Map([
    ['Strong', [{ from: '2020-01-01', to: '2030-01-01', elo: 1900 }]],
    ['Weak', [{ from: '2020-01-01', to: '2030-01-01', elo: 1700 }]],
  ]);

  const matches = Array.from({ length: 40 }, (_, i) => ({
    season: 2023,
    matchday: i + 1,
    date: `2023-08-${String((i % 28) + 1).padStart(2, '0')}`,
    homeClub: i % 2 === 0 ? 'Strong' : 'Weak',
    awayClub: i % 2 === 0 ? 'Weak' : 'Strong',
    goalsHome: i % 2 === 0 ? 3 : 1,
    goalsAway: i % 2 === 0 ? 1 : 2,
  }));

  it('gives the home side a positive Elo slope and the away side a negative one', () => {
    const fit = fitLambdaModel(buildTrainingRows({ eloHistory, matches }), true);

    expect(fit.rows).toBe(40);
    expect(fit.home.eloCoefficient).toBeGreaterThan(0);
    expect(fit.away.eloCoefficient).toBeLessThan(0);
    expect(fit.home.baseline).toBeGreaterThan(0);
  });

  it('reports no drift test when the drift column is excluded', () => {
    const fit = fitLambdaModel(buildTrainingRows({ eloHistory, matches }), false);

    expect(fit.driftTest).toBeNull();
    expect(fit.home.driftCoefficient).toBeNull();
    expect(fit.home.impliedDriftWeight).toBeNull();
  });
});
