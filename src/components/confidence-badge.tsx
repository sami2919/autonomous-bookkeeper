type Props = {
  confidence: number | null;
};

export default function ConfidenceBadge({ confidence }: Props) {
  if (confidence === null || confidence === undefined) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
        —
      </span>
    );
  }

  const pct = confidence; // 0–100

  if (pct >= 85) {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        {pct}%
      </span>
    );
  }

  if (pct >= 50) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        {pct}%
      </span>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
      {pct}%
    </span>
  );
}
