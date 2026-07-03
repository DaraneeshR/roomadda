import type { SocialProof } from "@roomadda/shared";
import { primarySocialProof, SOCIAL_TONE_CLASSES, socialProofItems } from "../../lib/discovery";

/**
 * Honesty-gated social proof. The server has ALREADY applied each widget's floor;
 * a field it omitted is genuinely below the bar and simply isn't here. So these
 * components render exactly the fields present and NOTHING when `social` is empty
 * or undefined — the client can never manufacture social proof (see /CLAUDE.md).
 */

/** A single compact line for a card — the strongest signal, or nothing. */
export function SocialProofLine({ social }: { social: SocialProof | null | undefined }): React.ReactNode {
  const item = primarySocialProof(social);
  if (!item) return null;
  return (
    <p className={`flex items-center gap-1 text-xs font-medium ${SOCIAL_TONE_CLASSES[item.tone]}`}>
      <span aria-hidden>{item.icon}</span>
      {item.text}
    </p>
  );
}

/** The full set of widgets for the detail page — again, only what cleared a floor. */
export function SocialProofWidgets({ social }: { social: SocialProof | null | undefined }): React.ReactNode {
  const items = socialProofItems(social);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item.key}
          className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium ${SOCIAL_TONE_CLASSES[item.tone]}`}
        >
          <span aria-hidden>{item.icon}</span>
          {item.text}
        </span>
      ))}
    </div>
  );
}
