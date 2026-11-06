/**
 * T24 — public interface of the `domains` module (spec §3).
 *
 * Consumers (web routes, middleware, settings UI) import ONLY from here —
 * never internals. Composition roots wire the Drizzle store, node DNS lookup,
 * CDN purge hook (documents module seam) and the provisioner per env.
 */
export type {
  AddDomainOutcome,
  CustomDomainRecord,
  CustomDomainStatus,
  DnsInstructions,
  DnsRecordInstruction,
  ProvisionMode,
  RemoveOutcome,
  VerificationMethod,
  VerifyOutcome,
} from './model.ts';

export type {
  DomainDocumentLookup,
  DomainGate,
  DomainProvisioner,
  DomainsRoutingTable,
  DomainsServiceDeps,
  DomainsStore,
  DnsLookup,
  ProvisionOutcome,
} from './ports.ts';

export {
  MAX_HOSTNAME_LENGTH,
  VERIFICATION_TXT_PREFIX,
  VERIFICATION_TXT_VALUE_PREFIX,
  generateVerificationToken,
  isHostnameValid,
  manualDnsInstructions,
  normalizeHostname,
  parseVerificationValue,
  validateHostname,
  verificationTxtName,
  verificationTxtValue,
} from './hostname.ts';

export { hostRouteKey, isAppHost, normalizeRequestHost, resolveHostDocumentId } from './routing.ts';

export { makeDomainsService, CUSTOM_DOMAINS_CAPABILITY, type DomainsService, type AddDomainInput } from './service.ts';

export {
  createCloudflareProvisioner,
  createManualProvisioner,
  type CloudflareProvisionerOptions,
} from './provisioner.ts';

/** Node-only — composition roots import this directly, never edge code. */
export { createNodeDnsLookup } from './dns-lookup.ts';
