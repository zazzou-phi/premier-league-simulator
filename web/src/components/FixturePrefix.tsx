import { getFixturePrefixParts } from '../lib/fixtureLabel.js';

interface Props {
  matchday: number;
  date: string;
  time: string;
  locked?: boolean;
  showMatchday?: boolean;
  className?: string;
}

export function FixturePrefix({
  matchday,
  date,
  time,
  locked = false,
  showMatchday = false,
  className = 'fixture-prefix',
}: Props) {
  const parts = getFixturePrefixParts(matchday, date, time);
  const rootClass = locked ? `${className} fixture-prefix-locked` : className;

  return (
    <span className={rootClass}>
      {showMatchday && <span className="fixture-prefix-matchday">{parts.matchday}. </span>}
      <span className="fixture-prefix-kickoff">{parts.kickoff}</span>
    </span>
  );
}
