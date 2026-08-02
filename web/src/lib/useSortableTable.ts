import { useMemo, useState } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

export function useSortableTable<T, K extends string>(
  items: T[],
  defaultSort: SortState<K>,
  comparators: Record<K, (a: T, b: T) => number>,
) {
  const [sort, setSort] = useState<SortState<K>>(defaultSort);

  const sortedItems = useMemo(() => {
    const compare = comparators[sort.key];
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => direction * compare(a, b));
  }, [items, sort, comparators]);

  const toggleSort = (key: K) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
  };

  return { sortedItems, sort, toggleSort };
}
