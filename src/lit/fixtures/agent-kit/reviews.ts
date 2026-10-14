/**
 * Fixture data for the <sem-review-canvas> agent-kit upsell stub.
 *
 * One module, zero network: the stub renders entirely from these constants
 * (plan §2 — stubs "load fixture JSON inline … make zero network calls").
 * Shapes mirror the reviews data plane the hookup phase will target
 * (plan §4: GET /reviews/:id, POST /reviews/:id/complete) so swapping
 * transport later changes nothing about rendering: a review is a list of
 * pixel-anchored comments plus a verdict.
 */

export interface ReviewComment {
  id: string;
  /** Anchor position on the screenshot, percent of stage width/height. */
  x: number;
  y: number;
  author: string;
  body: string;
  resolved: boolean;
}

export type ReviewVerdict = 'approve' | 'changes' | 'comment';

/**
 * Placeholder screenshot (plan: "an inline SVG or a placeholder image is
 * fine"). Deliberately small — it is bundle bytes — but reads as a product
 * UI: top bar, sidebar, two content cards.
 */
export const REVIEW_SCREENSHOT_SVG = `<svg class="sem-review-shot-img" viewBox="0 0 640 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Fixture screenshot of an agent workspace">
<rect width="640" height="400" fill="#f6f7f9"/>
<rect width="640" height="36" fill="#1f2430"/>
<circle cx="18" cy="18" r="5" fill="#e05d5d"/><circle cx="34" cy="18" r="5" fill="#e5b355"/><circle cx="50" cy="18" r="5" fill="#5fbf77"/>
<rect x="220" y="12" width="200" height="12" rx="6" fill="#3a4152"/>
<rect y="36" width="132" height="364" fill="#eceef2"/>
<rect x="14" y="56" width="104" height="10" rx="5" fill="#b9bfc9"/>
<rect x="14" y="80" width="104" height="10" rx="5" fill="#cdd2da"/>
<rect x="14" y="104" width="104" height="10" rx="5" fill="#cdd2da"/>
<rect x="14" y="128" width="70" height="10" rx="5" fill="#cdd2da"/>
<rect x="152" y="56" width="220" height="150" rx="10" fill="#ffffff"/>
<rect x="168" y="76" width="120" height="12" rx="6" fill="#8a93a3"/>
<rect x="168" y="100" width="188" height="8" rx="4" fill="#d6dae1"/>
<rect x="168" y="116" width="160" height="8" rx="4" fill="#d6dae1"/>
<rect x="168" y="150" width="84" height="24" rx="12" fill="#3d6fe0"/>
<rect x="392" y="56" width="232" height="150" rx="10" fill="#ffffff"/>
<rect x="408" y="76" width="90" height="12" rx="6" fill="#8a93a3"/>
<rect x="408" y="100" width="200" height="8" rx="4" fill="#d6dae1"/>
<rect x="408" y="116" width="176" height="8" rx="4" fill="#d6dae1"/>
<rect x="152" y="226" width="472" height="150" rx="10" fill="#ffffff"/>
<rect x="168" y="246" width="140" height="12" rx="6" fill="#8a93a3"/>
<rect x="168" y="272" width="440" height="8" rx="4" fill="#d6dae1"/>
<rect x="168" y="288" width="400" height="8" rx="4" fill="#d6dae1"/>
<rect x="168" y="304" width="420" height="8" rx="4" fill="#d6dae1"/>
<rect x="168" y="336" width="96" height="24" rx="12" fill="#e5b355"/>
</svg>`;

/** The four fixture comments the stub ships with. */
export const REVIEW_COMMENTS: ReviewComment[] = [
  {
    id: 'c1',
    x: 35.9,
    y: 38,
    author: 'Mara',
    body: 'Primary button should use the success token, not brand blue — this is a deploy action.',
    resolved: false,
  },
  {
    id: 'c2',
    x: 79.7,
    y: 30,
    author: 'Dev',
    body: 'Agent put its run summary here. Needs the artifact link back to /runs/412.',
    resolved: false,
  },
  {
    id: 'c3',
    x: 26.3,
    y: 70.5,
    author: 'Mara',
    body: 'Copy: "review thread" not "comment log" — pitch language, keep it consistent.',
    resolved: true,
  },
  {
    id: 'c4',
    x: 61.5,
    y: 87,
    author: 'Keith',
    body: 'Long bodies wrap under the fold. Cap the popover at 6 lines with a scroll.',
    resolved: false,
  },
];

export const REVIEW_AUTHOR = 'Demo Reviewer';

export const REVIEW_VERDICT_LABELS: Record<ReviewVerdict, string> = {
  approve: 'Approved',
  changes: 'Changes requested',
  comment: 'Commented',
};

export const REVIEW_VERDICT_PENDING = 'Pending review';

/**
 * The zero-JS view, as authored markup (spec rule: with the script absent the
 * document reads as plain content). Demo pages inline this string; the Lit
 * element replaces it with the interactive canvas once upgraded. Pins are
 * inert markers here — without JS there is nothing to open — and the full
 * comment text is listed beside the screenshot.
 */
export function reviewFallbackHtml(): string {
  const pins = REVIEW_COMMENTS.map(
    (c) =>
      `<span class="sem-review-pin" style="--sem-review-x:${c.x}%;--sem-review-y:${c.y}%"` +
      `${c.resolved ? ' data-resolved' : ''} aria-label="Comment by ${c.author}">${c.id.slice(1)}</span>`,
  ).join('');
  const list = REVIEW_COMMENTS.map(
    (c) =>
      `<li class="sem-review-comment${c.resolved ? ' sem-review-comment-resolved' : ''}">` +
      `<strong>${c.author}</strong> <span class="sem-review-comment-body">${c.body}</span></li>`,
  ).join('');
  return (
    `<div class="sem-review-fallback">` +
    `<figure class="sem-review-stage">${REVIEW_SCREENSHOT_SVG}${pins}</figure>` +
    `<ol class="sem-review-comments">${list}</ol>` +
    `</div>`
  );
}
