# hello-mcp

A minimal MCP server built as a learning exercise. Uses the Streamable HTTP transport and demonstrates the core MCP primitives: tools and resources.

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) is an open standard for connecting AI models to external data and capabilities. An MCP server exposes three types of primitives:

| Primitive | Purpose | Initiated by |
|---|---|---|
| **Tools** | Do things (side effects allowed) | The model |
| **Resources** | Expose data (read-only) | The client/user |
| **Prompts** | Reusable prompt templates | The client/user |

## Project Structure

```
src/
  server.js          # Entry point — HTTP transport
  mcp.js             # MCP server + tool/resource registration
  data/
    greetings.js     # Shared data (language → greeting mapping)
  tools/
    helloWorld.js    # No-input tool
    helloName.js     # Tool with a required string input
    greetName.js     # Tool with multiple inputs including an enum
  resources/
    languages.js     # Static resource exposing available languages
```

## Transport: Streamable HTTP

This server uses the `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk`. It runs as a plain Node.js HTTP server and handles MCP messages at `POST /mcp`.

Key details:
- Runs in **stateless mode** (`sessionIdGenerator: undefined`) — each request gets a fresh transport instance
- The client must send `Accept: application/json, text/event-stream` or the server will reject with 406
- The transport handles both JSON responses and SSE streams depending on the request

## Tools

Tools are registered with `server.registerTool(name, config, handler)`.

- `config.description` — shown to the model so it knows when to use the tool
- `config.inputSchema` — a plain object of Zod fields; the SDK wraps it in `z.object()` automatically
- Input is **validated at the transport layer** before the handler is called — invalid input returns `-32602` without ever reaching your code

### hello_world
No inputs. Always returns `"Hello, World!"`.

### hello_name
Takes a required `name` string. Returns `"Hello, {name}!"`.

### greet_name
Takes a `name` string and a `language` enum. Returns a greeting in the specified language. The enum is derived directly from the keys in `src/data/greetings.js`, so adding a new language there automatically updates both the tool's validation and the languages resource.

## Resources

Resources are registered with `server.registerResource(name, uri, config, reader)`.

- Each resource has a **URI** (e.g. `languages://list`) that the client uses to fetch it
- The reader returns `{ contents: [{ uri, text }] }`
- Resources are read-only — no side effects

### languages://list
Returns a JSON array of supported language keys. Backed by the same `greetings.js` data used by the `greet_name` tool.

## Running the Server

### HTTP Streaming (MCP Inspector, remote clients)

```bash
npm install
npm start
```

The MCP endpoint will be available at `http://localhost:3000/mcp`.

To run on a different port:

```bash
PORT=3001 npm start
```

### stdio (Claude Desktop)

Claude Desktop spawns the process itself — no server needs to be running beforehand. Add the following to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hello-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/hello-mcp/src/stdio.js"]
    }
  }
}
```

Quit and relaunch Claude Desktop after editing the config. Check **Claude menu → Settings → Developer** to confirm the server shows a green dot.

## Testing with MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Open the Inspector in **Chrome** (not Brave — its privacy settings block localhost requests), set the transport to **Streamable HTTP**, and enter `http://localhost:3000/mcp`.

You can also test with raw curl:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

## Key Lessons

- **Multiple transports, one server** — `mcp.js` is transport-agnostic; `server.js` (HTTP) and `stdio.js` (stdio) are separate entry points that both import the same server instance

- **Separation of concerns** — `server.js` owns the HTTP transport, `mcp.js` owns the MCP server, each tool/resource lives in its own file
- **Single source of truth** — shared data in `src/data/` is imported by both tools and resources; no duplication
- **Zod validation is free** — defining an `inputSchema` gives you automatic input validation before your handler runs
- **`registerTool` over `tool`** — the `tool()` method is deprecated; `registerTool()` uses a cleaner config object pattern
- **Stateless vs stateful** — stateless mode is simpler and sufficient for most use cases; stateful mode adds session tracking via `sessionIdGenerator`
