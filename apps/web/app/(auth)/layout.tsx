import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ff-auth-layout">
      <Link href="/" className="ff-logo" aria-label="FormForge home">
        FormForge
      </Link>
      <main className="ff-auth-card">{children}</main>
    </div>
  );
}
