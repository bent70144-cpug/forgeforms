// FormForge inline icon set — one consistent lucide-style family, drawn here
// so no external icon package is needed (CSP: no CDN; rules: no new deps).
//
// Usage:
//   import { Icon } from "@/components/ui/icons";
//   <Icon name="copy" size={16} />
// All icons render on a 24×24 grid with stroke="currentColor", fill="none",
// stroke-width 1.75 and round caps/joins. They are decorative by default
// (aria-hidden) — give the wrapping control its own accessible name when the
// icon is its only content.
//
// `name="spinner"` additionally carries the `ff-spin` class (keyframes live
// in app/globals.css, disabled under prefers-reduced-motion).

import type { ReactElement, SVGProps } from "react";

export type IconName =
  | "grid"
  | "file"
  | "fileText"
  | "plus"
  | "link"
  | "copy"
  | "check"
  | "checkCircle"
  | "trash"
  | "archive"
  | "x"
  | "menu"
  | "chevronDown"
  | "chevronRight"
  | "chevronLeft"
  | "arrowLeft"
  | "arrowRight"
  | "external"
  | "settings"
  | "chart"
  | "flow"
  | "sparkles"
  | "key"
  | "globe"
  | "creditCard"
  | "logout"
  | "user"
  | "search"
  | "eye"
  | "eyeOff"
  | "refresh"
  | "alert"
  | "info"
  | "spinner"
  | "layers"
  | "inbox"
  | "code"
  | "list"
  | "upload"
  | "mail";

const ICON_PATHS: Record<IconName, ReactElement> = {
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    </>
  ),
  fileText: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  link: (
    <>
      <path d="M9.5 13.5a4.2 4.2 0 0 0 6.3.4l2.6-2.6a4.2 4.2 0 0 0-6-6l-1.5 1.5" />
      <path d="M14.5 10.5a4.2 4.2 0 0 0-6.3-.4l-2.6 2.6a4.2 4.2 0 0 0 6 6l1.5-1.5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  check: <path d="m4 12.5 5 5L20 6.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.8-5.5" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  archive: (
    <>
      <rect x="2" y="3" width="20" height="5" rx="1" />
      <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </>
  ),
  x: (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
  menu: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  arrowLeft: (
    <>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>
  ),
  external: (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  settings: (
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M8 16v-5" />
      <path d="M13 16V7" />
      <path d="M18 16v-3" />
    </>
  ),
  flow: (
    <>
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M6 15V6a3 3 0 0 1 3-3h1" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.5 13.8 9a2 2 0 0 0 1.27 1.27L20.5 12l-5.43 1.73A2 2 0 0 0 13.8 15L12 20.5 10.2 15a2 2 0 0 0-1.27-1.27L3.5 12 8.93 10.27A2 2 0 0 0 10.2 9z" />
      <path d="M19 3v3" />
      <path d="M17.5 4.5h3" />
      <path d="M5 18v3" />
      <path d="M3.5 19.5h3" />
    </>
  ),
  key: (
    <>
      <circle cx="7.5" cy="16.5" r="4.5" />
      <path d="m10.9 13.1 9.6-9.6" />
      <path d="m16 8 3 3" />
      <path d="m19 5 2.5 2.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z" />
    </>
  ),
  creditCard: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </>
  ),
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21a7 7 0 0 1 14 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M10.7 5.1a10 10 0 0 1 1.3-.1c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.2 3.2" />
      <path d="M6.6 6.6C4 8.4 2 12 2 12s3.5 7 10 7a9.9 9.9 0 0 0 4-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5" />
      <path d="M12 8h.01" />
    </>
  ),
  spinner: <circle cx="12" cy="12" r="9" pathLength={100} strokeDasharray="72 28" />,
  layers: (
    <>
      <path d="m12 2 9 4.8-9 4.8-9-4.8z" />
      <path d="m3 12 9 4.8 9-4.8" />
      <path d="m3 17 9 4.8 9-4.8" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.4 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.4-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.8 1.1z" />
    </>
  ),
  code: (
    <>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </>
  ),
};

export type IconProps = {
  name: IconName;
  /** Square edge in px (default 16). */
  size?: number;
} & Omit<SVGProps<SVGSVGElement>, "name" | "width" | "height">;

export function Icon({ name, size = 16, className, ...rest }: IconProps) {
  const isSpinner = name === "spinner";
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={isSpinner ? ["ff-spin", className].filter(Boolean).join(" ") : className}
      {...rest}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
