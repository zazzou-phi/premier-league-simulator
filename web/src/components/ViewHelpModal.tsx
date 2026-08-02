import { useEffect, useState } from 'react';
import type { AppView } from '../lib/appView.js';
import { getViewHelp, type HelpSection } from '../lib/viewHelpContent.js';

type Tab = 'about' | 'howTo';

interface Props {
  view: AppView;
  publicMode: boolean;
  onClose: () => void;
}

function HelpSections({ sections }: { sections: HelpSection[] }) {
  return (
    <>
      {sections.map((section, index) => (
        <section key={index} className="help-section">
          {section.title ? <h3>{section.title}</h3> : null}
          {section.paragraphs?.map((paragraph, pIndex) => <p key={pIndex}>{paragraph}</p>)}
          {section.bullets && section.bullets.length > 0 ? (
            <ul>
              {section.bullets.map((bullet, bIndex) => (
                <li key={bIndex}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </>
  );
}

export function ViewHelpModal({ view, publicMode, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('howTo');
  const help = getViewHelp(view, publicMode);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal help-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{help.title} help</h2>
        <div className="help-modal-tab-bar" role="tablist" aria-label="Help sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'howTo'}
            className={`help-modal-tab${tab === 'howTo' ? ' active' : ''}`}
            onClick={() => setTab('howTo')}
          >
            How to use
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'about'}
            className={`help-modal-tab${tab === 'about' ? ' active' : ''}`}
            onClick={() => setTab('about')}
          >
            About
          </button>
        </div>
        <div className="help-modal-body" role="tabpanel">
          {tab === 'howTo' ? (
            <HelpSections sections={help.howTo} />
          ) : (
            <HelpSections sections={help.about} />
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
