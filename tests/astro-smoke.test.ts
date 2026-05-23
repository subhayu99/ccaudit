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

  it("serves the index page with the correct title", async () => {
    const res = await fetch(dev.url + "/");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<title>ccaudit — sessions</title>");
    expect(body).toContain("Sessions");
  });
});
