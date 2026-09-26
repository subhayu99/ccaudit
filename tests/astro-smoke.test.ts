import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startAstroDev, type AstroDev } from "./helpers/astro-dev.js";

describe("astro smoke", () => {
  let dev: AstroDev;
  let fixture: string;

  beforeAll(async () => {
    fixture = mkdtempSync(join(tmpdir(), "ccaudit-smoke-"));
    mkdirSync(join(fixture, "codex"));
    const events = [
      { type: "session_meta", payload: { id: "web-smoke", cwd: fixture } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Find smokeuniquecodex" }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Codex smoke answer" }] } },
    ];
    writeFileSync(join(fixture, "codex/rollout.jsonl"), events.map(e => JSON.stringify({ timestamp: "2026-09-26T12:00:00Z", ...e })).join("\n") + "\n");
    dev = await startAstroDev({ CCAUDIT_HOME: fixture, CCAUDIT_PROJECTS_DIR: join(fixture, "projects"), CCAUDIT_CODEX_DIR: join(fixture, "codex"), CCAUDIT_CODEX_ARCHIVE_DIR: join(fixture, "archive") });
  }, 35_000);

  afterAll(async () => {
    await dev?.stop();
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });

  it("serves the 3-pane shell on the index page", async () => {
    const res = await fetch(dev.url + "/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>ccaudit</title>");
    expect(body).toContain("ccaudit");        // sidebar brand
    expect(body).toContain("Library");        // sidebar section
    expect(body).toContain("Repositories");   // sidebar section
  });
  it("serves the Codex reader, search, resume, export and rejects source moves", async () => {
    const id = "codex:web-smoke";
    const page = await fetch(`${dev.url}/?session=${id}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Codex smoke answer");
    expect(html).toContain("✦ Codex");
    expect(html).not.toContain('id="mv-menu"');
    const search = await fetch(`${dev.url}/api/search?q=smokeuniquecodex`).then(r => r.json());
    expect(search.groups[0].sessionId).toBe(id);
    const resume = await fetch(`${dev.url}/api/sessions/${id}/resume`).then(r => r.json());
    expect(resume.command).toContain("codex resume web-smoke");
    const exported = await fetch(`${dev.url}/api/export?session=${id}&format=md`).then(r => r.text());
    expect(exported).toContain("**Provider:** Codex");
    expect(exported).toContain("Codex smoke answer");
    const move = await fetch(`${dev.url}/api/move?session=${id}`);
    expect(move.status).toBe(400);
  });
});
