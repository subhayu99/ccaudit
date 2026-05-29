import { describe, it, expect } from "vitest";
import { cleanPromptText } from "../src/lib/clean-prompt.js";

describe("cleanPromptText", () => {
  it("strips a leading <system_instruction> block and returns the real text", () => {
    const t = "<system_instruction>\nYou are working inside Conductor.\n</system_instruction>\n\nFix the login bug.";
    expect(cleanPromptText(t)).toBe("Fix the login bug.");
  });

  it("strips BOTH the underscore and hyphen instruction blocks Conductor injects", () => {
    const t =
      "<system_instruction>\nYou are working inside Conductor, a Mac app...\n</system_instruction>\n\n\n" +
      "<system-instruction>\nTo do immediately:\nRename the branch.\n</system-instruction>\n\n" +
      "Had a call with Aditya related to a new ask on Campaign/TruROI. Do research.";
    expect(cleanPromptText(t)).toBe(
      "Had a call with Aditya related to a new ask on Campaign/TruROI. Do research."
    );
  });

  it("strips a leading /tmp/attachments path line left by Conductor", () => {
    const t = "/tmp/attachments/pasted_text_2026-04-20_15-56-01.txt \nHad a call with Aditya.";
    expect(cleanPromptText(t)).toBe("Had a call with Aditya.");
  });

  it("returns empty string when the message is nothing but injected blocks", () => {
    const t = "<system_instruction>\nboilerplate only\n</system_instruction>";
    expect(cleanPromptText(t)).toBe("");
  });

  it("does NOT strip a <system_instruction> mention that appears mid-text", () => {
    const t = "I noticed the Conductor preamble: <system_instruction>...</system_instruction> clutters titles.";
    expect(cleanPromptText(t)).toBe(t);
  });

  it("does NOT strip an unclosed tag (avoid eating the whole message)", () => {
    const t = "<system_instruction>\nno closing tag here, this is real content";
    expect(cleanPromptText(t)).toBe(t.trim());
  });

  it("leaves an ordinary prompt with no injected blocks unchanged", () => {
    expect(cleanPromptText("Add a dark mode toggle to the settings page.")).toBe(
      "Add a dark mode toggle to the settings page."
    );
  });
});

describe("cleanPromptText — claude-mem observer sessions", () => {
  it("surfaces the observed <user_request> as the title for an observer intro", () => {
    const t =
      "Hello memory agent, you are continuing to observe the primary Claude session.\n\n" +
      "<observed_from_primary_session>\n  <user_request>Can you create a new csv batch_03</user_request>\n" +
      "  <requested_at>2026-05-27</requested_at>\n</observed_from_primary_session>\n\n" +
      "You are a Claude-Mem, a specialized observer tool for creating searchable memory.";
    expect(cleanPromptText(t)).toBe("Can you create a new csv batch_03");
  });

  it("extracts user_request from a bare <observed_from_primary_session> wrapper (no intro)", () => {
    const t =
      "<observed_from_primary_session>\n  <user_request>fix the failing CI build</user_request>\n</observed_from_primary_session>";
    expect(cleanPromptText(t)).toBe("fix the failing CI build");
  });

  it("returns empty for observer boilerplate with no user_request", () => {
    const t = "Hello memory agent, you are continuing to observe the primary Claude session.\n\nYou are a Claude-Mem.";
    expect(cleanPromptText(t)).toBe("");
  });

  it("does NOT treat a normal sentence mentioning observe as observer boilerplate", () => {
    const t = "Help me observe the primary metrics on the dashboard.";
    expect(cleanPromptText(t)).toBe(t);
  });
});

describe("cleanPromptText — slash-command echoes", () => {
  it("surfaces the command name as the title", () => {
    const t = "<command-message>insights</command-message>\n<command-name>/insights</command-name>";
    expect(cleanPromptText(t)).toBe("/insights");
  });
  it("falls back to the command message when there is no name", () => {
    expect(cleanPromptText("<command-message>status-update</command-message>")).toBe("/status-update");
  });
  it("does not touch a normal message that mentions a slash command mid-text", () => {
    const t = "I ran /insights and it worked great";
    expect(cleanPromptText(t)).toBe(t);
  });
});
