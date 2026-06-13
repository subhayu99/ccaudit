import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getDb } from "../db/init.js";
import {
  toolListSessions,
  toolSearchSessions,
  toolGetSession,
  toolGetMessages,
  toolIndexStats,
} from "./tools.js";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

export async function startMcpServer(): Promise<void> {
  const db = getDb();
  const server = new McpServer({ name: "ccaudit", version: "0.0.1" });

  server.registerTool(
    "list_sessions",
    {
      description:
        "List indexed Claude Code sessions, most recent first. Optionally filter by project directory.",
      inputSchema: { limit: z.number().optional(), project: z.string().optional() },
    },
    async (args) => json(toolListSessions(db, args))
  );

  server.registerTool(
    "search_sessions",
    {
      description:
        "Full-text search across all indexed session messages. mode: 'fts' (smart, default), 'exact' (case-insensitive substring), or 'regex' (case-insensitive).",
      inputSchema: {
        query: z.string(),
        mode: z.enum(["fts", "exact", "regex"]).optional(),
        limit: z.number().optional(),
      },
    },
    async (args) => json(toolSearchSessions(db, args))
  );

  server.registerTool(
    "get_session",
    {
      description:
        "Get a session's metadata, and optionally its conversation messages (noise filtered out).",
      inputSchema: {
        sessionId: z.string(),
        includeMessages: z.boolean().optional(),
        limit: z.number().optional(),
      },
    },
    async (args) => json(toolGetSession(db, args))
  );

  server.registerTool(
    "get_messages",
    {
      description:
        "Get messages by author — within one session or across your whole history. " +
        "author: 'user' (your prompts), 'assistant' (Claude's replies), 'tool' (tool calls/results), " +
        "or 'agent' (sub-agent / Task turns). Pass sessionId to scope to one session; otherwise returns " +
        "the most recent matches across all sessions (newest first, hidden directories excluded). " +
        "Optional `contains` filters to messages whose text includes that substring.",
      inputSchema: {
        author: z.enum(["user", "assistant", "tool", "agent"]),
        sessionId: z.string().optional(),
        contains: z.string().optional(),
        limit: z.number().optional(),
      },
    },
    async (args) => json(toolGetMessages(db, args))
  );

  server.registerTool(
    "index_stats",
    { description: "Overall stats about the indexed session corpus.", inputSchema: {} },
    async () => json(toolIndexStats(db))
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // NOTE: stdout is owned by the MCP protocol — never console.log here.
}
