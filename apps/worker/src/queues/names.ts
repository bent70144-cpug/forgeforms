// Queue + job name constants (spec §12) — the integration surface for
// producers (T14 ingest, T18 exports, T19 analytics) and consumers (T17).
//
// T14 enqueues:   QUEUES.events      / JOBS.submissionCompleted
// T18 enqueues:   QUEUES.exports    / JOBS.csvExport  (uses email send-export-ready)
// T19 enqueues:   QUEUES.analytics  / JOBS.ingestBatch + JOBS.rollup
export const QUEUES = {
  events: "events",
  email: "email",
  webhooks: "webhooks",
  exports: "exports",
  assets: "assets",
  analytics: "analytics",
  maintenance: "maintenance",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export const JOBS = {
  // events queue
  submissionCompleted: "submission.completed",
  // email queue
  sendNotification: "send-notification",
  sendExportReady: "send-export-ready",
  sendVerify: "send-verify",
  sendReset: "send-reset",
  // webhooks queue
  deliver: "deliver",
  // exports queue (T18)
  csvExport: "csv-export",
  // assets queue (T-later)
  scan: "scan",
  processImage: "process-image",
  // analytics queue (T19)
  ingestBatch: "ingest-batch",
  rollup: "rollup",
  // maintenance queue (T-later)
  reapOrphans: "reap-orphans",
  purgeOldDeliveries: "purge-old-deliveries",
  createPartitions: "create-partitions",
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];
