import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as helloWorld from "./tools/helloWorld.js";

export const server = new McpServer({
  name: "hello-mcp",
  version: "1.0.0",
});

server.registerTool(helloWorld.name, helloWorld.config, helloWorld.handler);
