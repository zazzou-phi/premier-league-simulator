import { useEffect, useState, type RefObject } from 'react';

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * The rendered size of an element, tracked as it changes.
 *
 * Charts here are drawn at 1:1 rather than stretched from a fixed viewBox: scaling an SVG to
 * fit blows up the type and the stroke weights with it, which is exactly what the mark specs
 * are trying to hold steady. The height is what a sticky element below another one needs, since
 * the offset it has to clear is a wrapped toolbar's real height rather than a guess.
 *
 * Null until the first measurement, so a caller can hold back rather than draw at a guessed size
 * and reflow it.
 */
export function useElementSize(ref: RefObject<HTMLElement | null>): ElementSize | null {
  const [size, setSize] = useState<ElementSize | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Measured border-box, via the rect rather than `contentRect`: a sticky element below this
    // one has to clear its padding and border too, and the charts sit in boxes with neither.
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [ref]);

  return size;
}
