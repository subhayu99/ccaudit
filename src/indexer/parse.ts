import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { RawMessage } from "../types.js";

export type ParsedLine = {
  lineNo: number;
  raw: RawMessage;
  rawJson: string;
};

export type ParseOptions = {
  onError?: (err: { lineNo: number; line: string; error: unknown }) => void;
};

export async function* parseJsonlFile(
  filePath: string,
  opts: ParseOptions = {}
): AsyncGenerator<ParsedLine> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const line of rl) {
    lineNo++;
    if (line.trim() === "") continue;
    try {
      const raw = JSON.parse(line) as RawMessage;
      yield { lineNo, raw, rawJson: line };
    } catch (error) {
      opts.onError?.({ lineNo, line, error });
    }
  }
}
