/**
 * Approximate-area map. The site only ever receives a coarse, rounded marker
 * (the backend masks exact geo), so this can never plot a real address.
 */
export function ApproxMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const d = 0.012;
  const bbox = [lng - d, lat - d, lng + d, lat + d].map((n) => n.toFixed(5)).join("%2C");
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(5)}%2C${lng.toFixed(5)}`;

  return (
    <div>
      <iframe
        title={`Approximate location of ${label}`}
        src={src}
        className="h-64 w-full rounded-lg border border-slate-200"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <p className="mt-1 text-xs text-slate-500">
        Approximate area only. The exact address is shared after a confirmed booking.
      </p>
    </div>
  );
}
