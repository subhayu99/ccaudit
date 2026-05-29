import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startAstroDev, type AstroDev } from "./helpers/astro-dev.js";

describe("astro smoke", () => {
  let dev: AstroDev;

  beforeAll(async () => {
    dev = await startAstroDev();
  }, 35_000);

  afterAll(async () => {
    await dev.stop();
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
});
