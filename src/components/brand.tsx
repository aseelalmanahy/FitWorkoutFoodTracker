import type { SVGProps } from "react";

/**
 * An original, abstract mark: three rising bars under a gentle trend line, for training, food and progress.
 * Inline, so nothing is fetched from elsewhere. Colours come from the theme.
 */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden {...props}>
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <rect x="7.5" y="17" width="4" height="8" rx="2" fill="var(--accent-fg)" opacity="0.55" />
      <rect x="14" y="13" width="4" height="12" rx="2" fill="var(--accent-fg)" opacity="0.75" />
      <rect x="20.5" y="9" width="4" height="16" rx="2" fill="var(--accent-fg)" />
      <path d="M6.5 13.5c4-1.5 9-4.5 13-7.5" fill="none" stroke="var(--accent-2-soft)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Decorative artwork for the welcome panel: soft contour lines and a rising trend. Purely ornamental. */
export function WelcomeArt(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 480 360" fill="none" aria-hidden preserveAspectRatio="xMidYMid slice" {...props}>
      {Array.from({ length: 9 }, (_, i) => (
        <path key={i} d={`M-20 ${300 - i * 26} C 90 ${250 - i * 30}, 200 ${330 - i * 24}, 300 ${262 - i * 28} S 470 ${190 - i * 22}, 520 ${170 - i * 26}`}
          stroke="currentColor" strokeOpacity={0.07 + i * 0.012} strokeWidth="1.2" />
      ))}
      {[[70, 250, 46], [140, 228, 68], [210, 206, 90], [280, 180, 116], [350, 150, 146]].map(([x, y, h], i) => (
        <rect key={i} x={x} y={y} width="34" height={h} rx="10" fill="currentColor" fillOpacity={0.08 + i * 0.03} />
      ))}
      <path d="M60 236 C 140 222, 200 196, 268 168 S 380 110, 420 92" stroke="var(--accent-2-soft)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="420" cy="92" r="7" fill="var(--accent-2-soft)" />
    </svg>
  );
}
