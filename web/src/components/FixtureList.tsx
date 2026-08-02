import { useMemo } from 'react';
import type { ActualMatchResult, ResolvedMatch } from '@shared/engine/types.js';
import { matchWinnerSide } from '../lib/matchFilters.js';
import { FixturePrefix } from './FixturePrefix.js';
import { ScoreDisplay, ScoreEditor } from './ScoreEditor.js';

interface Props {
  matches: ResolvedMatch[];
  selectedMatchNumber: number | null;
  editingMatchNumber?: number | null;
  filterTeamLabel?: string | null;
  allowEdit?: boolean;
  /** In the recorded-results editor, locked matches are still editable and clearable. */
  editRecordedResults?: boolean;
  actualResults?: ActualMatchResult[];
  emptyMessage?: string;
  onSelect: (matchNumber: number | null) => void;
  onStartEdit?: (matchNumber: number) => void;
  onSave?: (matchNumber: number, goalsHome: number, goalsAway: number) => void;
  onCancelEdit?: () => void;
  onClear?: (matchNumber: number) => void;
  /** Opens the Monte Carlo distribution for a fixture instead of editing it. */
  onOpenMatch?: (matchNumber: number) => void;
  onClearFilter?: () => void;
}

interface MatchdayGroup {
  matchday: number;
  matches: ResolvedMatch[];
}

function groupByMatchday(matches: ResolvedMatch[]): MatchdayGroup[] {
  const groups = new Map<number, ResolvedMatch[]>();
  for (const match of matches) {
    const list = groups.get(match.fixture.matchday);
    if (list) list.push(match);
    else groups.set(match.fixture.matchday, [match]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([matchday, list]) => ({
      matchday,
      matches: list.sort((a, b) => a.fixture.matchNumber - b.fixture.matchNumber),
    }));
}

function teamClassName(match: ResolvedMatch, side: 'home' | 'away'): string {
  const winner = matchWinnerSide(match);
  if (winner === side) return 'fixture-team-winner';
  if (winner != null) return 'fixture-team-loser';
  return '';
}

export function FixtureList({
  matches,
  selectedMatchNumber,
  editingMatchNumber = null,
  filterTeamLabel = null,
  allowEdit = true,
  editRecordedResults = false,
  actualResults = [],
  emptyMessage = 'No fixtures to show.',
  onSelect,
  onStartEdit,
  onSave,
  onCancelEdit,
  onClear,
  onOpenMatch,
  onClearFilter,
}: Props) {
  const actualByMatch = useMemo(
    () => new Map(actualResults.map((result) => [result.matchNumber, result])),
    [actualResults],
  );
  const groups = useMemo(() => groupByMatchday(matches), [matches]);

  return (
    <div className="fixture-list">
      <div className="fixture-list-header">
        <span>
          Fixtures ({matches.length})
          {filterTeamLabel ? ` · ${filterTeamLabel}` : ''}
        </span>
        {filterTeamLabel && onClearFilter && (
          <button
            type="button"
            className="btn btn-ghost btn-small fixture-list-clear-filter"
            onClick={onClearFilter}
          >
            Clear filter
          </button>
        )}
      </div>
      <div className="fixture-list-body">
        {matches.length === 0 && <p className="fixture-list-empty">{emptyMessage}</p>}
        {groups.map((group) => {
          const playedInGroup = group.matches.filter(
            (match) => match.result.status === 'played',
          ).length;

          return (
            <div key={group.matchday}>
              <div className="matchday-header">
                <span>Matchday {group.matchday}</span>
                <span className="matchday-header-meta">
                  {playedInGroup}/{group.matches.length}
                </span>
              </div>
              {group.matches.map((match) => {
                const num = match.fixture.matchNumber;
                const selected = num === selectedMatchNumber;
                const editing = num === editingMatchNumber;
                const played = match.result.status === 'played';
                const locked = match.locked;
                const canEdit = allowEdit && (editRecordedResults || !locked) && onSave != null;
                const canClear =
                  played && onClear != null && (editRecordedResults ? locked : !locked);
                const actual = actualByMatch.get(num);

                const handleScoreClick = () => {
                  if (onOpenMatch) {
                    onOpenMatch(num);
                    return;
                  }
                  // Recording a result is the only action an unplayed fixture has, so the
                  // score doubles as the edit affordance.
                  if (canEdit) onStartEdit?.(num);
                };

                return (
                  <div
                    key={num}
                    className={`fixture-row ${selected ? 'selected' : ''}`}
                    onClick={() => onSelect(selected ? null : num)}
                    onDoubleClick={() => canEdit && onStartEdit?.(num)}
                  >
                    <FixturePrefix
                      matchday={match.fixture.matchday}
                      date={match.fixture.date}
                      time={match.fixture.time}
                      locked={locked}
                    />
                    <span
                      className={`fixture-home ${teamClassName(match, 'home')}`}
                      title={match.teamHome.name}
                    >
                      <span className="fixture-team-short">{match.teamHome.shortName}</span>{' '}
                      {match.teamHome.name}
                    </span>
                    <span className="fixture-score">
                      {editing && canEdit ? (
                        <ScoreEditor
                          match={match}
                          onSave={(goalsHome, goalsAway) => onSave?.(num, goalsHome, goalsAway)}
                          onCancel={() => onCancelEdit?.()}
                        />
                      ) : (
                        <ScoreDisplay
                          goalsHome={match.result.goalsHome}
                          goalsAway={match.result.goalsAway}
                          played={played}
                          actual={actual}
                          onClick={handleScoreClick}
                          onDoubleClick={() => canEdit && onStartEdit?.(num)}
                        />
                      )}
                    </span>
                    <span
                      className={`fixture-away ${teamClassName(match, 'away')}`}
                      title={match.teamAway.name}
                    >
                      {match.teamAway.name}{' '}
                      <span className="fixture-team-short">{match.teamAway.shortName}</span>
                    </span>
                    <span className="fixture-row-actions">
                      {selected && canClear && !editing && (
                        <button
                          type="button"
                          className="btn btn-small btn-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            onClear?.(num);
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
