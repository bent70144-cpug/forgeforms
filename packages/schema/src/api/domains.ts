// Custom domains API schemas (issue #24, spec §13 "Custom domain: no | 1 | 5",
// §14 settings). Zod source for the /api/v1/domains surface and the OpenAPI
// document.
//
// SECURITY: the verification token is intentionally visible to the workspace —
// the user must publish it as a DNS TXT record to prove ownership. It proves
// control of the HOSTNAME only (the value lives in the customer's DNS zone),
// so exposure in settings is by design; it never grants API access.
import { z } from 'zod';

export const DOMAIN_STATUSES = ['pending', 'verified'] as const;
export const DomainStatusSchema = z.enum(DOMAIN_STATUSES);
export type DomainStatus = z.infer<typeof DomainStatusSchema>;

export const PROVISION_MODES = ['manual', 'cloudflare'] as const;
export const ProvisionModeSchema = z.enum(PROVISION_MODES);
export type ProvisionMode = z.infer<typeof ProvisionModeSchema>;

/** Hostname input — normalized server-side; pattern keeps obviously-bad input out. */
export const HostnameSchema = z
  .string()
  .trim()
  .min(4, 'Hostname is too short')
  .max(253)
  .regex(/^[a-z0-9.-]+$/i, 'Hostname may only contain letters, digits, dots and hyphens')
  .refine(
    (value) =>
      value
        .toLowerCase()
        .split('.')
        .every((label) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)),
    'Hostname labels must not start or end with a hyphen',
  )
  .refine((value) => !value.includes('..'), 'Hostname has an empty label');
export type Hostname = z.infer<typeof HostnameSchema>;

export const CreateDomainRequestSchema = z.object({
  hostname: HostnameSchema,
  documentId: z.string().uuid(),
});
export type CreateDomainRequest = z.infer<typeof CreateDomainRequestSchema>;

export const VerifyDomainRequestSchema = z.object({
  id: z.string().uuid(),
});

/** One DNS record the customer must publish (settings UI renders these). */
export const DnsRecordInstructionSchema = z.object({
  type: z.enum(['TXT', 'CNAME']),
  name: z.string().min(1),
  value: z.string().min(1),
  purpose: z.string(),
});
export type DnsRecordInstruction = z.infer<typeof DnsRecordInstructionSchema>;

export const DnsInstructionsSchema = z.object({
  mode: ProvisionModeSchema,
  records: z.array(DnsRecordInstructionSchema),
});
export type DnsInstructions = z.infer<typeof DnsInstructionsSchema>;

/** Public domain DTO — verification state visible in settings (issue #24). */
export const CustomDomainSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string().max(253),
  documentId: z.string().uuid(),
  status: DomainStatusSchema,
  /** 32-hex token; the TXT value is `ff-domain-verification=<token>`. */
  verificationToken: z.string().regex(/^[0-9a-f]{32}$/),
  txtName: z.string(),
  txtValue: z.string(),
  cnameTarget: z.string(),
  lastCheckedAt: z.string().datetime().nullable(),
  verifiedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
  provisionMode: ProvisionModeSchema,
  createdAt: z.string().datetime(),
});
export type CustomDomain = z.infer<typeof CustomDomainSchema>;

/** Domain lists are small (plan quota ≤ 5) — same envelope shape, no cursor. */
export const ListDomainsResponseSchema = z.object({
  data: z.array(CustomDomainSchema),
  nextCursor: z.null(),
});

export const CreateDomainResponseSchema = z.object({
  domain: CustomDomainSchema,
  instructions: DnsInstructionsSchema,
});

export const VerifyDomainResponseSchema = z.object({
  domain: CustomDomainSchema,
  verified: z.boolean(),
  method: z.enum(['txt', 'cname']).nullable(),
});
