interface Props {
  /** Places gained since the comparison point — positive is upward, towards 1st. */
  places: number | null | undefined;
  /** What the movement is measured against, used for the title text. */
  since: string;
  /** Club name, so a screen reader hears whose movement this is. */
  teamName: string;
}

/**
 * One club's change of place since the previous reading.
 *
 * The glyph carries a sign as well as a hue and sits beside a number, so the direction survives
 * a reader who cannot tell the two colours apart. A club with nothing to compare against — the
 * first reading of the season — gets a dash rather than a zero: no movement and no measurement
 * are different things.
 */
export function MovementArrow({ places, since, teamName }: Props) {
  if (places == null) {
    return (
      <span className="movement movement-none" title={`No earlier reading for ${teamName}`}>
        ·
      </span>
    );
  }
  if (places === 0) {
    return (
      <span className="movement movement-flat" title={`${teamName} unchanged ${since}`}>
        –
      </span>
    );
  }

  const up = places > 0;
  return (
    <span
      className={`movement ${up ? 'movement-up' : 'movement-down'}`}
      title={`${teamName} ${up ? 'up' : 'down'} ${Math.abs(places)} ${
        Math.abs(places) === 1 ? 'place' : 'places'
      } ${since}`}
    >
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>
      {Math.abs(places)}
    </span>
  );
}
