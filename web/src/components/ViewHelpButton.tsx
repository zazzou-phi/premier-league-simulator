import { useState } from 'react';
import { APP_VIEW_LABELS, type AppView } from '../lib/appView.js';
import { ViewHelpModal } from './ViewHelpModal.js';

interface Props {
  appView: AppView;
  publicMode?: boolean;
}

export function ViewHelpButton({ appView, publicMode = false }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost header-icon-btn header-help-btn"
        aria-label={`Help for ${APP_VIEW_LABELS[appView]}`}
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open && (
        <ViewHelpModal view={appView} publicMode={publicMode} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
