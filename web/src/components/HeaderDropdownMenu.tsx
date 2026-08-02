import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  buttonLabel: ReactNode;
  buttonClassName?: string;
  menuClassName?: string;
  ariaLabel: string;
  active?: boolean;
  children: ReactNode;
}

export function HeaderDropdownMenu({
  buttonLabel,
  buttonClassName = 'btn btn-ghost',
  menuClassName = '',
  ariaLabel,
  active = false,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  return (
    <div
      className={`header-dropdown-menu ${open ? 'header-dropdown-menu-open' : ''}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={`${buttonClassName}${active ? ' active' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        {buttonLabel}
      </button>
      {open && (
        <div
          className={`header-dropdown-panel ${menuClassName}`.trim()}
          role="menu"
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest('button, a, [role="menuitem"]')) {
              setOpen(false);
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
