import { useEffect, useRef, useState } from 'react';
import { APP_VIEW_LABELS, getAppViews, type AppView } from '../lib/appView.js';

interface Props {
  appView: AppView;
  publicMode?: boolean;
  onAppViewChange: (view: AppView) => void;
}

export function ViewSwitcher({ appView, publicMode = false, onAppViewChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const otherViews = getAppViews(publicMode).filter((view) => view !== appView);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleSelect = (view: AppView) => {
    setOpen(false);
    onAppViewChange(view);
  };

  return (
    <div className={`view-switcher ${open ? 'view-switcher-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost view-switcher-btn"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="view-switcher-label">{APP_VIEW_LABELS[appView]}</span>
        <span className="view-switcher-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="view-switcher-dropdown" role="menu">
          {otherViews.map((view) => (
            <button
              key={view}
              type="button"
              className="view-switcher-item"
              role="menuitem"
              onClick={() => handleSelect(view)}
            >
              {APP_VIEW_LABELS[view]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
