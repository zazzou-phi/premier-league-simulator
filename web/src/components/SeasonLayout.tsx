import { useState, type ReactNode } from 'react';
import { MOBILE_QUERY, useMediaQuery } from '../lib/useMediaQuery.js';

type Tab = 'table' | 'fixtures';

interface Props {
  /** Controls governing both panels, on their own full-width row above them. */
  toolbar?: ReactNode;
  standings: ReactNode;
  fixtures: ReactNode;
}

export function SeasonLayout({ toolbar, standings, fixtures }: Props) {
  const narrow = useMediaQuery(MOBILE_QUERY);
  const [tab, setTab] = useState<Tab>('fixtures');

  const classes = [
    'season-layout',
    toolbar ? 'season-layout-with-toolbar' : '',
    narrow ? 'season-layout-mobile' : '',
    narrow && tab === 'fixtures' ? 'season-layout-show-fixtures' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      {toolbar && <div className="season-layout-toolbar">{toolbar}</div>}
      {narrow && (
        <div className="season-layout-tab-bar" role="tablist" aria-label="Season panels">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'fixtures'}
            className={`season-layout-tab${tab === 'fixtures' ? ' active' : ''}`}
            onClick={() => setTab('fixtures')}
          >
            Fixtures
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'table'}
            className={`season-layout-tab${tab === 'table' ? ' active' : ''}`}
            onClick={() => setTab('table')}
          >
            Table
          </button>
        </div>
      )}
      <div className="season-layout-standings">{standings}</div>
      <div className="season-layout-fixtures">{fixtures}</div>
    </div>
  );
}
