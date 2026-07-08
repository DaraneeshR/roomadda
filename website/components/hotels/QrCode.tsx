import { encodeQr, QR_SIZE } from "../../lib/qr";

/**
 * Render a string as a scannable QR using the dependency-free encoder. Pure inline
 * SVG (markup, not a script), so it is CSP-safe with no external request and works
 * in server components. Always dark-on-white for scanner reliability, regardless of
 * the page theme. If the value can't be encoded, falls back to the raw code text.
 */
export function QrCode({
  value,
  size = 220,
}: {
  value: string;
  size?: number;
}): React.ReactNode {
  let matrix: boolean[][] | null = null;
  try {
    matrix = encodeQr(value);
  } catch {
    matrix = null;
  }

  if (!matrix) {
    return (
      <code className="block break-all rounded-md bg-slate-100 px-3 py-2 text-center font-mono text-sm text-slate-800">
        {value}
      </code>
    );
  }

  const quiet = 4; // required light quiet-zone border
  const dim = QR_SIZE + quiet * 2;
  // One path over all dark modules — fewer nodes than a rect per module.
  let d = "";
  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y]!;
    for (let x = 0; x < row.length; x++) {
      if (row[x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      role="img"
      aria-label="Check-in QR code"
      shapeRendering="crispEdges"
      className="rounded-lg"
    >
      <rect width={dim} height={dim} fill="#ffffff" />
      <path d={d} fill="#0f172a" />
    </svg>
  );
}
