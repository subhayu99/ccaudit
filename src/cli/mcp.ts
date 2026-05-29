import { startMcpServer } from "../mcp/server.js";

export async function mcpCommand(): Promise<void> {
  // stdio is the MCP channel — do not write anything else to stdout.
  await startMcpServer();
}
