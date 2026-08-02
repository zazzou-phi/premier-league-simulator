import type { SortDirection } from '../lib/useSortableTable.js';

interface Props<K extends string> {
  label: string;
  sortKey: K;
  activeKey: K;
  direction: SortDirection;
  className?: string;
  title?: string;
  onSort: (key: K) => void;
}

export function SortableTh<K extends string>({
  label,
  sortKey,
  activeKey,
  direction,
  className,
  title,
  onSort,
}: Props<K>) {
  const active = sortKey === activeKey;
  const classes = ['sortable-th', active ? 'sortable-th-active' : '', className ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <th
      className={classes}
      title={title}
      onClick={() => onSort(sortKey)}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <span className="sortable-th-label">{label}</span>
      <span className="sortable-th-indicator" aria-hidden>
        {active ? (direction === 'asc' ? '▲' : '▼') : '⇅'}
      </span>
    </th>
  );
}
