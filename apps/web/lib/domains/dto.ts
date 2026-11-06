// apps/web/lib/domains/dto.ts
// Wire mapping: CustomDomainRecord → the @formforge/schema/api CustomDomain DTO.
// The verification token is intentionally exposed to the workspace (settings
// must show the DNS instructions, issue #24); nothing else is added here.
import { verificationTxtName, verificationTxtValue, type CustomDomainRecord } from '@formforge/core/domains';

export function domainToDto(record: CustomDomainRecord, cnameTarget: string) {
  return {
    id: record.id,
    hostname: record.hostname,
    documentId: record.documentId,
    status: record.status,
    verificationToken: record.verificationToken,
    txtName: verificationTxtName(record.hostname),
    txtValue: verificationTxtValue(record.verificationToken),
    cnameTarget,
    lastCheckedAt: record.lastCheckedAt ? record.lastCheckedAt.toISOString() : null,
    verifiedAt: record.verifiedAt ? record.verifiedAt.toISOString() : null,
    lastError: record.lastError,
    provisionMode: record.provisionMode,
    createdAt: record.createdAt.toISOString(),
  };
}

export function toIsoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}
