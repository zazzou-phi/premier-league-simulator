import { useRef } from 'react';
import {
  APP_VIEW_LABELS,
  APP_VIEW_SHORT_LABELS,
  getAppViews,
  type AppView,
} from '../lib/appView.js';

interface Props {
  appView: AppView;
  publicMode?: boolean;
  /** Use abbreviated tab text. Full labels stay available to assistive tech. */
  short?: boolean;
  onAppViewChange: (view: AppView) => void;
}

export function ViewSwitcher({
  appView,
  publicMode = false,
  short = false,
  onAppViewChange,
}: Props) {
  const views = getAppViews(publicMode);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusTab = (index: number) => {
    const view = views[index];
    if (!view) return;
    tabRefs.current[index]?.focus();
    onAppViewChange(view);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        focusTab((index - 1 + views.length) % views.length);
        break;
      case 'ArrowRight':
        e.preventDefault();
        focusTab((index + 1) % views.length);
        break;
      case 'Home':
        e.preventDefault();
        focusTab(0);
        break;
      case 'End':
        e.preventDefault();
        focusTab(views.length - 1);
        break;
    }
  };

  return (
    <div className="view-switcher" role="tablist" aria-label="View">
      {views.map((view, index) => {
        const selected = view === appView;
        const label = APP_VIEW_LABELS[view];
        return (
          <button
            key={view}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`view-tab-${view}`}
            className={`view-switcher-tab ${selected ? 'view-switcher-tab-active' : ''}`}
            aria-selected={selected}
            aria-label={short ? label : undefined}
            // Roving tabIndex keeps the whole group to a single tab stop.
            tabIndex={selected ? 0 : -1}
            onClick={() => onAppViewChange(view)}
            onKeyDown={(e) => handleKeyDown(e, index)}
          >
            {short ? APP_VIEW_SHORT_LABELS[view] : label}
          </button>
        );
      })}
    </div>
  );
}
