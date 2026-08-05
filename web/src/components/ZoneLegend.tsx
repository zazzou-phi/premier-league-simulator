import { LEGEND_ZONES, ZONE_LABELS } from '../lib/leagueZones.js';

/**
 * Decodes the four zone colours. It belongs beside whatever it explains, not under it:
 * the standings table sits in a scroller, so a legend appended below twenty rows is
 * off-screen exactly when a reader meets a colour they cannot place.
 *
 * `ProjectionsView` needs it as much as the tables do — the distribution bars are
 * entirely colour-encoded and previously carried no key at all.
 */
export function ZoneLegend() {
  return (
    <div className="zone-legend">
      {LEGEND_ZONES.map((zone) => (
        <span key={zone} className="zone-legend-item">
          <span className={`zone-legend-swatch zone-legend-swatch-${zone}`} />
          {ZONE_LABELS[zone]}
        </span>
      ))}
    </div>
  );
}
