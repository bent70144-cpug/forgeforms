// packages/blocks — `contact-links` public renderer (server-safe).
// Email/phone values get mailto:/tel: schemes; every href passes the
// javascript:/data: guard (shared/safe-href).
import type { FC } from "react";
import type { RenderProps } from "../registry";
import { safeHref } from "../shared/safe-href";
import type { ContactLink, ContactLinksProps } from "./schema";

function hrefOf(link: ContactLink): string {
  const value = link.url.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (link.type === "email" && !hasScheme) return `mailto:${value}`;
  if (link.type === "phone" && !hasScheme) return `tel:${value.replace(/\s+/g, "")}`;
  return safeHref(value);
}

const LABELS: Partial<Record<ContactLink["type"], string>> = {
  email: "Email",
  phone: "Phone",
  website: "Website",
  github: "GitHub",
  x: "X",
  twitter: "Twitter",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  youtube: "YouTube",
  dribbble: "Dribbble",
  other: "Link",
};

export const ContactLinksRender: FC<RenderProps<ContactLinksProps>> = ({ props }) => {
  if (props.links.length === 0) return null;
  return (
    <ul className="ff-contact-links" data-block-kind="contact-links">
      {props.links.map((link, index) => (
        <li key={`${link.type}-${link.url}-${index}`} className="ff-contact-links__item">
          <a className="ff-contact-links__link" href={hrefOf(link)} rel="noopener noreferrer nofollow">
            {LABELS[link.type] ?? "Link"}: {link.url}
          </a>
        </li>
      ))}
    </ul>
  );
};
