import Link from "next/link";
import type { ReactNode } from "react";

// Shared chrome for /login, /register, /forgot and /reset-password: wordmark on
// top, one centered card. The .ff-auth-* classes live in app/globals.css.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ff-auth-layout">
      <Link href="/" className="ff-logo inline-flex items-center gap-2" aria-label="FormForge home">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
          <rect width="24" height="24" rx="6" fill="var(--ff-primary)" />
          <path d="M13.6 4.8 7 13.2h4l-1.4 6 6.8-8.9h-4.1l1.3-5.5Z" fill="var(--ff-primary-fg)" />
        </svg>
        FormForge
      </Link>
      <main className="ff-auth-card">{children}</main>
    </div>
  );
}
