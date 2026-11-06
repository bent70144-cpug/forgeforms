import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  CSV_EOL,
  buildCsvStream,
  buildCsvToString,
  escapeCsvCell,
  formatCsvValue,
  sanitizeCsvFormula,
  type CsvColumn,
} from "./csv";

/** Minimal RFC 4180 parser used to verify the builder's output round-trips. */
function parseCsvRecords(input: string): string[][] {
  const text = input.startsWith(CSV_BOM) ? input.slice(CSV_BOM.length) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
        continue;
      }
      field += ch;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") {
      if (text.charAt(i + 1) === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

describe("escapeCsvCell (RFC 4180)", () => {
  it("leaves plain cells untouched", () => {
    expect(escapeCsvCell("hello world")).toBe("hello world");
    expect(escapeCsvCell("café ☕ 你好")).toBe("café ☕ 你好");
    expect(escapeCsvCell("")).toBe("");
  });

  it("quotes cells containing commas", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
  });

  it("quotes cells containing quotes and doubles the embedded quotes", () => {
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes cells containing line breaks", () => {
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("line1\r\nline2")).toBe('"line1\r\nline2"');
    expect(escapeCsvCell("line1\rline2")).toBe('"line1\rline2"');
  });

  it("combines quoting and doubling", () => {
    expect(escapeCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
});

describe("sanitizeCsvFormula (OWASP CSV injection)", () => {
  it.each([
    ["=SUM(A1:A2)", "'=SUM(A1:A2)"],
    ["+1+1", "'+1+1"],
    ["-1+2", "'-1+2"],
    ["@import", "'@import"],
    ["\tTAB", "'\tTAB"],
    ["\rCR", "'\rCR"],
  ])("prefixes %s with a single quote", (input, expected) => {
    expect(sanitizeCsvFormula(input)).toBe(expected);
  });

  it("leaves benign and mid-string cells untouched", () => {
    expect(sanitizeCsvFormula("5")).toBe("5");
    expect(sanitizeCsvFormula("abc=1")).toBe("abc=1");
    expect(sanitizeCsvFormula("hello -world")).toBe("hello -world");
    expect(sanitizeCsvFormula("")).toBe("");
  });
});

describe("formatCsvValue", () => {
  it("renders nullish values as empty cells", () => {
    expect(formatCsvValue(null)).toBe("");
    expect(formatCsvValue(undefined)).toBe("");
  });

  it("renders primitives", () => {
    expect(formatCsvValue("s")).toBe("s");
    expect(formatCsvValue(0)).toBe("0");
    expect(formatCsvValue(false)).toBe("false");
  });

  it("renders dates as ISO-8601", () => {
    expect(formatCsvValue(new Date("2026-11-05T12:00:00.000Z"))).toBe("2026-11-05T12:00:00.000Z");
  });

  it("joins arrays with '; ' and stringifies other objects", () => {
    expect(formatCsvValue(["a", "b"])).toBe("a; b");
    expect(formatCsvValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe("buildCsvStream", () => {
  const columns: CsvColumn[] = [
    { id: "c1", header: "c1" },
    { id: "c2", header: "c2" },
    { id: "c3", header: "c3" },
  ];

  it("emits BOM + header first, then one CRLF-terminated chunk per row", async () => {
    const chunks: string[] = [];
    for await (const chunk of buildCsvStream({
      columns,
      rows: [{ c1: "a", c2: "b", c3: "c" }, { c1: "d", c2: "e", c3: "f" }],
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe(`${CSV_BOM}c1,c2,c3${CSV_EOL}`);
    expect(chunks[1]).toBe(`a,b,c${CSV_EOL}`);
    expect(chunks[2]).toBe(`d,e,f${CSV_EOL}`);
  });

  it("starts with a UTF-8 BOM exactly once", async () => {
    const out = await buildCsvToString({
      columns,
      rows: [{ c1: "x", c2: "y", c3: "z" }],
    });
    expect(out.startsWith(CSV_BOM)).toBe(true);
    expect(out.indexOf(CSV_BOM)).toBe(out.lastIndexOf(CSV_BOM));
  });

  it("emits only the header for zero rows", async () => {
    const out = await buildCsvToString({ columns, rows: [] });
    expect(out).toBe(`${CSV_BOM}c1,c2,c3${CSV_EOL}`);
  });

  it("preserves column ordering exactly as given", async () => {
    const out = await buildCsvToString({
      columns: [{ id: "z" }, { id: "m" }, { id: "a" }],
      rows: [{ a: "1", z: "2", m: "3" }],
    });
    expect(out).toBe(`${CSV_BOM}z,m,a${CSV_EOL}2,3,1${CSV_EOL}`);
  });

  it("renders missing keys as empty cells and ignores extra keys", async () => {
    const out = await buildCsvToString({
      columns,
      rows: [{ c2: "only-c2", unexpected: "ignored" }],
    });
    expect(out).toBe(`${CSV_BOM}c1,c2,c3${CSV_EOL},only-c2,${CSV_EOL}`);
  });

  it("escapes risky values but still parses back to the original text", async () => {
    const values = [
      "plain",
      "with,comma",
      'with"quote',
      "with\nnewline",
      "with\r\ncrlf",
      "unicode: héllo ☕ 中文 🌍",
      "=SUM(A1)",
      "+prompt",
      "-1",
      "@ref",
      "comma & \"quote\" & \nnewline",
    ];
    const rows = values.map((value, index) => ({ v: value, i: String(index) }));
    const out = await buildCsvToString({
      columns: [{ id: "i" }, { id: "v" }],
      rows,
    });
    const parsed = parseCsvRecords(out);
    expect(parsed).toHaveLength(values.length + 1);
    expect(parsed[0]).toEqual(["i", "v"]);
    for (const [index, value] of values.entries()) {
      const record = parsed[index + 1];
      expect(record?.[0]).toBe(String(index));
      // default sanitization prefixes formula-leading values with '
      expect(record?.[1]).toBe(sanitizeCsvFormula(value));
    }
  });

  it("can disable formula sanitization", async () => {
    const out = await buildCsvToString({
      columns: [{ id: "v" }],
      rows: [{ v: "-5" }],
      sanitizeFormulas: false,
    });
    expect(out).toBe(`${CSV_BOM}v${CSV_EOL}-5${CSV_EOL}`);
  });

  it("accepts sync and async row iterables alike", async () => {
    async function* asyncRows(): AsyncIterable<Record<string, unknown>> {
      yield { v: "async" };
    }
    const fromAsync = await buildCsvToString({ columns: [{ id: "v" }], rows: asyncRows() });
    const fromSync = await buildCsvToString({ columns: [{ id: "v" }], rows: [{ v: "async" }] });
    expect(fromAsync).toBe(fromSync);
  });

  it("uses column ids as headers when no explicit header is set", async () => {
    const out = await buildCsvToString({ columns: [{ id: "blk_abc123" }], rows: [] });
    expect(out).toBe(`${CSV_BOM}blk_abc123${CSV_EOL}`);
  });
});
