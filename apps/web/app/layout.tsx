import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

/* Aurora redesign type system — exposed as CSS variables consumed by the
   --ff-font-* tokens in globals.css. Self-hosted General Sans / Geist Mono
   (landing.css @font-face) remain as fallbacks. */
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jet = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jet",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "FormForge",
    template: "%s — FormForge",
  },
  description: "Forms, landing pages and portfolios — one block-document model.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${grotesk.variable} ${inter.variable} ${jet.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
