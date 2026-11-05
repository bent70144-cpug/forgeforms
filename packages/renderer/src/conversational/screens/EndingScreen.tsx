// Ending screen (spec §15 M3): custom title/body, optional redirectUrl.
// Follows the redirect automatically after a short delay, with a manual link
// for reduced-motion users and a11y (they always stay clickable).
import { useEffect, useState } from 'react';

export interface EndingScreenProps {
  title: string;
  body: string | null;
  redirectUrl: string | null;
  /** ms before auto-redirect; 0 = immediately. Defaults to 1500. */
  redirectDelayMs?: number;
}

export function EndingScreen({ title, body, redirectUrl, redirectDelayMs = 1500 }: EndingScreenProps) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!redirectUrl || redirectDelayMs < 0) return;
    if (typeof window === 'undefined') return; // SSR guard
    const timer = window.setTimeout(() => {
      setLeaving(true);
      window.location.assign(redirectUrl);
    }, redirectDelayMs);
    return () => window.clearTimeout(timer);
  }, [redirectUrl, redirectDelayMs]);

  let redirectHost: string | null = null;
  if (redirectUrl && typeof window !== 'undefined') {
    try {
      redirectHost = new URL(redirectUrl, window.location.href).host || redirectUrl;
    } catch {
      redirectHost = redirectUrl;
    }
  }

  return (
    <section className="ff-screen" aria-labelledby="ff-ending-title">
      <h1 id="ff-ending-title" className="ff-question-label" style={{ fontSize: 30 }}>
        {title}
      </h1>
      {body && <p className="ff-question-desc">{body}</p>}
      {redirectUrl && (
        <p className="ff-hint" aria-live="polite">
          {leaving ? 'Redirecting…' : `Redirecting you to ${redirectHost ?? 'the next page'}…`}{' '}
          <a href={redirectUrl}>Continue now</a>
        </p>
      )}
    </section>
  );
}
