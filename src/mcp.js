import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as helloWorld from "./tools/helloWorld.js";
import * as helloName from "./tools/helloName.js";
import * as greetName from "./tools/greetName.js";
import * as listLanguages from "./tools/listLanguages.js";
import * as languages from "./resources/languages.js";

export const server = new McpServer({
  name: "hello-mcp",
  version: "1.0.0",
});

server.registerTool(helloWorld.name, helloWorld.config, helloWorld.handler);
server.registerTool(helloName.name, helloName.config, helloName.handler);
server.registerTool(greetName.name, greetName.config, greetName.createHandler(server));
server.registerTool(listLanguages.name, listLanguages.config, listLanguages.handler);

server.registerResource(languages.name, languages.uri, languages.config, languages.reader);
