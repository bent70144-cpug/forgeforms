// @formforge/core — `analytics_events` range-partition planner, PURE (spec §6:
// `partition by range (ts)`, §12 `create-partitions` maintenance job).
// The planner only computes names + bounds; the DB layer executes DDL.

export const ANALYTICS_PARENT_TABLE = "analytics_events";

export interface PartitionPlanItem {
  /** e.g. `analytics_events_y2026m11` (zero-padded month). */
  name: string;
  /** Inclusive lower bound, UTC ISO instant (YYYY-MM-01T00:00:00.000Z). */
  fromIso: string;
  /** Exclusive upper bound, UTC ISO instant (first day of next month). */
  toIso: string;
  year: number;
  /** 1-12. */
  month: number;
}

/** Floor an instant to the start of its UTC month. */
export function monthStartUtc(ts: Date): Date {
  return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), 1));
}

/** Add calendar months in UTC (Date.UTC normalizes overflow, e.g. month 12 → next year). */
export function addMonthsUtc(ts: Date, months: number): Date {
  return new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth() + months, 1));
}

/** Deterministic partition table name: `<parent>_y2026m11`. */
export function partitionName(parent: string, year: number, month: number): string {
  return `${parent}_y${year}m${String(month).padStart(2, "0")}`;
}

/**
 * Plan `months` consecutive monthly partitions starting at `from` (floored to
 * the month start). Passing the current month plus one gives the required
 * "current + next month" coverage of the maintenance job.
 */
export function planMonthlyPartitions(input: {
  parent: string;
  from: Date;
  months: number;
}): PartitionPlanItem[] {
  const { parent, months } = input;
  const from = monthStartUtc(input.from);
  if (!Number.isInteger(months) || months < 1) {
    throw new Error(`planMonthlyPartitions: months must be a positive integer, got ${months}`);
  }
  const items: PartitionPlanItem[] = [];
  for (let i = 0; i < months; i += 1) {
    const start = addMonthsUtc(from, i);
    const end = addMonthsUtc(from, i + 1);
    items.push({
      name: partitionName(parent, start.getUTCFullYear(), start.getUTCMonth() + 1),
      fromIso: start.toISOString(),
      toIso: end.toISOString(),
      year: start.getUTCFullYear(),
      month: start.getUTCMonth() + 1,
    });
  }
  return items;
}

/** Idempotent DDL for one partition (CREATE TABLE IF NOT EXISTS ... PARTITION OF). */
export function partitionDDL(parent: string, item: PartitionPlanItem): string {
  return (
    `CREATE TABLE IF NOT EXISTS "${item.name}" ` +
    `PARTITION OF "${parent}" ` +
    `FOR VALUES FROM ('${item.fromIso}') TO ('${item.toIso}')`
  );
}
