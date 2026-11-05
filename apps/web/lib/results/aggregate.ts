// T15 — pure aggregation logic for the Summary tab (spec §14.1.5).
// Counts per choice, rating averages/distributions, NPS classification and
// completion-rate math. Framework-free so it is trivially unit-testable and
// reusable by the mock client and (later) the server route.

import type { Block } from "../results-bridge";
import type {
  BlockAggregate,
  ChoiceAggregate,
  ChoiceBucket,
  FileAggregate,
  NpsAggregate,
  NpsClass,
  NumberAggregate,
  RatingAggregate,
  SubmissionDTO,
  SummaryCounts,
  SummaryResponse,
  TextAggregate,
  UnsupportedAggregate,
} from "./types";
import {
  isEmptyAnswer,
  isQuestionBlock,
  numericAnswer,
  optionLabel,
  optionsOf,
  questionLabel,
  ratingScaleOf,
} from "./format";

/** spec §14.1.5 — NPS segments: 0–6 detractors, 7–8 passives, 9–10 promoters. */
export function classifyNps(value: number): NpsClass {
  if (value >= 9) return "promoter";
  if (value >= 7) return "passive";
  return "detractor";
}

export interface NpsTally {
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
  /** %promoters − %detractors, rounded to an integer (0 when empty). */
  score: number;
}

/** Tally raw NPS values (clamped to the 0–10 scale, non-numbers ignored). */
export function tallyNps(values: number[]): NpsTally {
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const raw of values) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const v = Math.min(10, Math.max(0, Math.round(raw)));
    const cls = classifyNps(v);
    if (cls === "promoter") promoters += 1;
    else if (cls === "passive") passives += 1;
    else detractors += 1;
  }
  const total = promoters + passives + detractors;
  const score =
    total === 0 ? 0 : Math.round((promoters / total) * 100 - (detractors / total) * 100);
  return { promoters, passives, detractors, total, score };
}

/** Headline numbers: response count + completion rate cards (spec §14.1.5). */
export function summaryCountsOf(submissions: SubmissionDTO[]): SummaryCounts {
  let completed = 0;
  let draft = 0;
  let spam = 0;
  for (const s of submissions) {
    if (s.status === "completed") completed += 1;
    else if (s.status === "draft") draft += 1;
    else spam += 1;
  }
  const total = submissions.length;
  return {
    total,
    completed,
    draft,
    spam,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

function answerOf(submission: SubmissionDTO, blockId: string): unknown {
  return submission.answers?.[blockId];
}

function aggregateChoice(block: Block, submissions: SubmissionDTO[]): ChoiceAggregate {
  const options = optionsOf(block);
  const counts = new Map<string, number>();
  const otherValues: string[] = [];
  let totalResponses = 0;
  const knownIds = new Set(options.map((o) => o.id));
  const unknownIds = new Set<string>();

  for (const s of submissions) {
    const value = answerOf(s, block.id);
    if (isEmptyAnswer(value)) continue;
    totalResponses += 1;

    const ids: string[] = [];
    let hasOther = false;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>;
      if (typeof rec.optionId === "string") ids.push(rec.optionId);
      if (typeof rec.other === "string" && rec.other.trim().length > 0) hasOther = true;
      if (Array.isArray(rec.optionIds)) {
        for (const id of rec.optionIds) if (typeof id === "string") ids.push(id);
      }
    }

    if (ids.length === 0 && !hasOther) continue;
    let counted = false;
    for (const id of ids) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!knownIds.has(id)) unknownIds.add(id);
      counted = true;
    }
    if (hasOther) {
      otherValues.push(
        typeof (value as Record<string, unknown>).other === "string"
          ? ((value as Record<string, unknown>).other as string).trim()
          : "",
      );
      counted = true;
    }
    if (!counted) totalResponses -= 1; // object shape we couldn't interpret
  }

  const distribution: ChoiceBucket[] = options.map((o) => ({
    optionId: o.id,
    label: o.label,
    count: counts.get(o.id) ?? 0,
  }));
  for (const id of unknownIds) {
    distribution.push({
      optionId: id,
      label: optionLabel(block, id) ?? `Unknown option (${id})`,
      count: counts.get(id) ?? 0,
    });
  }
  if (otherValues.length > 0) {
    distribution.push({
      optionId: null,
      label: "Other",
      count: otherValues.length,
      isOther: true,
    });
  }

  return {
    kind: "choice",
    blockId: block.id,
    label: questionLabel(block),
    totalResponses,
    distribution,
  };
}

function aggregateRating(block: Block, submissions: SubmissionDTO[]): RatingAggregate {
  const scale = ratingScaleOf(block);
  const distribution = Array.from({ length: scale }, (_, i) => ({
    value: i + 1,
    count: 0,
  }));
  let sum = 0;
  let totalResponses = 0;

  for (const s of submissions) {
    const v = numericAnswer(answerOf(s, block.id));
    if (v === null) continue;
    totalResponses += 1;
    sum += v;
    const idx = Math.min(scale, Math.max(1, Math.round(v))) - 1;
    const bucket = distribution[idx];
    if (bucket) bucket.count += 1;
  }

  return {
    kind: "rating",
    blockId: block.id,
    label: questionLabel(block),
    scale,
    totalResponses,
    average: totalResponses === 0 ? 0 : Math.round((sum / totalResponses) * 100) / 100,
    distribution,
  };
}

function aggregateNps(block: Block, submissions: SubmissionDTO[]): NpsAggregate {
  const values: number[] = [];
  for (const s of submissions) {
    const v = numericAnswer(answerOf(s, block.id));
    if (v !== null) values.push(v);
  }
  const tally = tallyNps(values);
  return {
    kind: "nps",
    blockId: block.id,
    label: questionLabel(block),
    totalResponses: tally.total,
    promoters: tally.promoters,
    passives: tally.passives,
    detractors: tally.detractors,
    score: tally.score,
  };
}

function aggregateNumber(block: Block, submissions: SubmissionDTO[]): NumberAggregate {
  let sum = 0;
  let totalResponses = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const s of submissions) {
    const v = numericAnswer(answerOf(s, block.id));
    if (v === null) continue;
    totalResponses += 1;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    kind: "number",
    blockId: block.id,
    label: questionLabel(block),
    totalResponses,
    average: totalResponses === 0 ? 0 : Math.round((sum / totalResponses) * 100) / 100,
    min: totalResponses === 0 ? 0 : min,
    max: totalResponses === 0 ? 0 : max,
  };
}

function aggregateText(block: Block, submissions: SubmissionDTO[]): TextAggregate {
  const recent: string[] = [];
  let totalResponses = 0;
  for (const s of submissions) {
    const value = answerOf(s, block.id);
    if (isEmptyAnswer(value)) continue;
    totalResponses += 1;
    if (recent.length < 3 && typeof value === "string") {
      recent.push(value.trim());
    }
  }
  return {
    kind: "text",
    blockId: block.id,
    label: questionLabel(block),
    totalResponses,
    recent,
  };
}

function aggregateFile(block: Block, submissions: SubmissionDTO[]): FileAggregate {
  let totalResponses = 0;
  let fileCount = 0;
  for (const s of submissions) {
    const value = answerOf(s, block.id);
    if (isEmptyAnswer(value)) continue;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const ids = (value as Record<string, unknown>).assetIds;
      if (Array.isArray(ids) && ids.length === 0) continue; // empty shell
    }
    totalResponses += 1;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const ids = (value as Record<string, unknown>).assetIds;
      if (Array.isArray(ids)) fileCount += ids.length;
    }
  }
  return {
    kind: "file",
    blockId: block.id,
    label: questionLabel(block),
    totalResponses,
    fileCount,
  };
}

/** Aggregate a single block across submissions (defensive for unknown kinds). */
export function aggregateBlock(block: Block, submissions: SubmissionDTO[]): BlockAggregate {
  switch (block.kind) {
    case "single-select":
    case "multi-select":
    case "dropdown":
      return aggregateChoice(block, submissions);
    case "rating":
      return aggregateRating(block, submissions);
    case "nps":
      return aggregateNps(block, submissions);
    case "number":
      return aggregateNumber(block, submissions);
    case "short-text":
    case "long-text":
    case "email":
      return aggregateText(block, submissions);
    case "file-upload":
      return aggregateFile(block, submissions);
    default: {
      let totalResponses = 0;
      for (const s of submissions) {
        if (!isEmptyAnswer(answerOf(s, block.id))) totalResponses += 1;
      }
      const agg: UnsupportedAggregate = {
        kind: "unsupported",
        blockId: block.id,
        label: questionLabel(block),
        totalResponses,
      };
      return agg;
    }
  }
}

/**
 * One aggregate per question block, in document order.
 * Content blocks are skipped (spec §7.1 — they never store answers);
 * question blocks with zero responses are still listed so charts render.
 */
export function aggregateSubmissions(
  blocks: Block[],
  submissions: SubmissionDTO[],
): BlockAggregate[] {
  const out: BlockAggregate[] = [];
  const walk = (list: Block[]): void => {
    for (const block of list) {
      if (block.hidden === true) continue;
      if (isQuestionBlock(block)) out.push(aggregateBlock(block, submissions));
      if (Array.isArray(block.children) && block.children.length > 0) walk(block.children);
    }
  };
  walk(blocks);
  return out;
}

/** Full Summary tab payload. `generatedAt` injectable for deterministic tests. */
export function buildSummary(
  blocks: Block[],
  submissions: SubmissionDTO[],
  generatedAt: string = new Date().toISOString(),
): SummaryResponse {
  return {
    counts: summaryCountsOf(submissions),
    blocks: aggregateSubmissions(blocks, submissions),
    generatedAt,
  };
}
