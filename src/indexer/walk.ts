import { readdirSync, statSync, existsSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { decodeProjectDir, projectLabel } from "../paths.js";

export type WalkEntry = {
  sessionId: string;
  projectDir: string;     // decoded real path
  projectLabel: string;
  filePath: string;       // absolute
  fileMtime: number;      // ms
  fileSize: number;
};

export function walkProjects(baseDir: string): WalkEntry[] {
  if (!existsSync(baseDir)) return [];
  const out: WalkEntry[] = [];
  for (const encoded of readdirSync(baseDir)) {
    const projDir = join(baseDir, encoded);
    let projStat;
    try { projStat = statSync(projDir); } catch { continue; }
    if (!projStat.isDirectory()) continue;
    const realPath = decodeProjectDir(encoded);
    const label = projectLabel(realPath);
    for (const name of readdirSync(projDir)) {
      if (extname(name) !== ".jsonl") continue;
      const filePath = join(projDir, name);
      let st;
      try { st = statSync(filePath); } catch { continue; }
      if (!st.isFile()) continue;
      out.push({
        sessionId: basename(name, ".jsonl"),
        projectDir: realPath,
        projectLabel: label,
        filePath,
        fileMtime: Math.floor(st.mtimeMs),
        fileSize: st.size,
      });
    }
  }
  return out;
}
