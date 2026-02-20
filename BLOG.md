# Building my first MCP server: a practical walkthrough

The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) is Anthropic's open standard for connecting AI models to external tools and data sources. I'd been reading about it for months, but the best way to understand it is to build something. This post is the story of `hello-mcp` — a minimal MCP server I built in an evening, starting from a single tool that says "Hello, World!" and ending with a dual-transport server with error handling, protocol logging, and a design I'm actually happy with.

---

## A moving target: how the MCP SDK has evolved

The official JavaScript SDK — `@modelcontextprotocol/sdk` — is the primary way to build MCP servers in Node.js. Its `McpServer` class (imported from `@modelcontextprotocol/sdk/server/mcp.js`) is the core abstraction: create an instance, register tools and resources on it, then connect it to a transport. Everything I built in this project sits on top of that.

Before diving in, a word of warning: if you're learning MCP from blog posts or tutorials, check the dates carefully. The SDK has moved fast.

When I started, most examples I found used a `tool()` method to register tools:

```js
// Old pattern — still works, but deprecated
server.tool("hello_world", config, handler);
```

By the time I was working with SDK v1.26, this was deprecated in favor of `registerTool()`:

```js
// Current pattern
server.registerTool("hello_world", config, handler);
```

Same story for resources: `resource()` is out, `registerResource()` is in. The new methods use a cleaner config object pattern that separates name, description, and schema more explicitly.

The other big shift is in how `inputSchema` works. In newer SDK versions, the field takes a **plain object of Zod fields** — the SDK wraps them in `z.object()` automatically. There's no need to construct the full Zod object manually:

```js
// What you write
inputSchema: {
  name: z.string().describe("The name to greet"),
}

// What the SDK does with it
z.object({ name: z.string().describe("The name to greet") })
```

This is a minor thing, but it tripped me up when I tried to copy-paste from older examples and got a type error.

**Lesson:** Pin to a specific SDK version when learning, and read the SDK source for the canonical API rather than relying on third-party tutorials.

---

## Building the framework: separation of concerns from day one

I separated the MCP server from the transport layer early on, mostly out of habit — it felt like the natural way to structure things. At the time it seemed like mild over-engineering for a "hello world" project. It turned out to be genuinely useful later when I realized Claude Desktop requires STDIO instead of the Streamable HTTP transport I started with.  Swapping transports in was trivial because the server knew nothing about how it was being transported.

The structure ended up being:

```
src/
  server.js            # Entry point — HTTP Streaming transport
  stdio.js             # Entry point — stdio transport (Claude Desktop)
  mcp.js               # MCP server + tool/resource registration
  data/
    greetings.js       # Shared data (language → greeting mapping)
  tools/
    helloWorld.js      # No-input tool
    helloName.js       # Tool with a required string input
    greetName.js       # Tool with error handling and MCP logging
    listLanguages.js   # Tool that exposes the languages list to the model
  resources/
    languages.js       # Static resource at languages://list
```

`mcp.js` is the heart of the server. It creates the `McpServer` instance and registers tools and resources. Critically, it knows **nothing** about how it's being transported — no HTTP code, no stdio code:

This modularity meant adding a new transport took five lines of code.

```js
// src/mcp.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as helloWorld from "./tools/helloWorld.js";

export const server = new McpServer({
  name: "hello-mcp",
  version: "1.0.0",
});

server.registerTool(helloWorld.name, helloWorld.config, helloWorld.handler);
```

Each tool lives in its own file and exports three things: `name`, `config`, and `handler` (or a factory function if the handler needs server access — more on that later). The tool file knows nothing about HTTP, stdio, or even the server object.

This makes adding new tools or resources trivially easy, as you'll see below. 

---

## Hello, World: the first tool

The first commit was deliberately minimal: one tool, one transport, no data layer, no error handling. I wanted to get something working first before layering in too much complexity.

Here's the complete initial tool:

```js
// src/tools/helloWorld.js
export const name = "hello_world";

export const config = {
  description: "Returns a Hello, World! greeting",
};

export async function handler() {
  return {
    content: [{ type: "text", text: "Hello, World!" }],
  };
}
```

That's it. No inputs, no schema, no error cases. The response shape — `{ content: [{ type: "text", text: "..." }] }` — is the MCP standard for text output.

The HTTP transport in `server.js` was equally minimal: a Node.js `http.createServer` that routes `POST /mcp` to a `StreamableHTTPServerTransport` instance and ignores everything else. The key detail is running in **stateless mode** (`sessionIdGenerator: undefined`), which means each request gets a fresh transport instance rather than trying to maintain session state:

```js
// src/server.js
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "node:http";
import { server } from "./mcp.js";

const httpServer = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/mcp") {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => transport.close());
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("hello-mcp is running\n");
});

const PORT = process.env.PORT ?? 3000;
httpServer.listen(PORT, () => {
  console.log(`MCP endpoint → http://localhost:${PORT}/mcp`);
});
```

I could verify the tool was working with a raw curl command:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call",
       "params": {"name": "hello_world", "arguments": {}}}'
```

Note the `Accept` header — it's required. The transport rejects requests that don't signal they can handle either JSON or SSE. This tripped me up with my first curl test.

---

## Testing with Claude Desktop

Once I had a working tool, I wanted to see it inside Claude. Claude Desktop supports MCP servers via the stdio transport, where Claude spawns the server as a subprocess and communicates over stdin/stdout.

Adding stdio support was literally five lines, because the server was already transport-agnostic:

```js
// src/stdio.js
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./mcp.js";

const transport = new StdioServerTransport();
await server.connect(transport);
```

Then I added the server to Claude Desktop's config:

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

A few things I learned the hard way:

- **Use an absolute path.** Claude Desktop spawns the process from a different working directory, so relative paths fail silently.
- **Quit and fully relaunch Claude Desktop** after editing the config. There's no hot-reload.
- **Verify the connection** at Claude menu → Settings → Developer. The server should be labeled as "running" (this use to be a green dot but has evolved with the introduciton of Connectors)

Once my server was running, I could just type "say hello to the world" in Claude and watch it invoke `hello_world` automatically. The model sees the tool description and decides when to call it — I didn't direct it explicitly.

---

## Expanding tools and resources

With the scaffolding in place, I added progressively more sophisticated tools.

### Adding inputs with Zod

`hello_name` was the next step — a tool that takes a required `name` string:

```js
// src/tools/helloName.js
import { z } from "zod";

export const name = "hello_name";

export const config = {
  description: "Returns a personalized Hello greeting",
  inputSchema: {
    name: z.string().describe("The name to greet"),
  },
};

export async function handler({ name }) {
  return {
    content: [{ type: "text", text: `Hello, ${name}!` }],
  };
}
```

Zod validation runs at the transport layer before the handler is ever called. Pass an invalid input (wrong type, missing required field) and the SDK returns a `-32602 Invalid params` JSON-RPC error without touching handler code. This is genuinely useful — the inputs are guaranteed to conform to the schema by the time the handler runs.

Now Claude could greet me by name. Time to layer in more!

### Resources, error handling, and MCP logging

`greet_name` is where the project got interesting. Unlike the previous two tools, it takes multiple inputs — a person's name and a language — and looks up a greeting from a shared data file to return something like "Bonjour, Chuck!" It's the first tool that has real validation concerns (what if the language isn't supported?), real observability concerns (what is the model actually passing in?), and a dependency on shared server state. It took four distinct iterations to arrive at the final version, and each one taught something new.

**Act 1: Zod enum for validation**

The first version was straightforward. It took a `name` string and a `language` input constrained to a Zod enum built directly from the keys of the greetings data file:

```js
// src/tools/greetName.js (first version)
import { z } from "zod";
import { greetings } from "../data/greetings.js";

export const config = {
  description: "Returns a personalized greeting in the specified language",
  inputSchema: {
    name: z.string().describe("The name to greet"),
    language: z.enum(Object.keys(greetings)).describe("The language to greet in"),
  },
};

export async function handler({ name, language }) {
  const greeting = greetings[language];
  return {
    content: [{ type: "text", text: `${greeting}, ${name}!` }],
  };
}
```

This felt clean. The valid language values are derived directly from the data — add a language to `greetings.js` and the enum updates automatically. Zod validation runs at the transport layer before the handler is called, so if the model passes `"klingon"`, the SDK returns a `-32602 Invalid params` error and the handler never runs. No manual validation needed.

The problem is that `-32602` is a protocol-level JSON-RPC error. The model can't see the error message — it just knows the call failed. There's no way for Claude to tell the user "I tried 'klingon' but it's not a supported language." It just hits a wall.

**Act 2: Free-form string input and `isError`**

To experiment with error handling and logging, I switched the language input from a Zod enum to a plain `z.string()`. This intentionally removed the automatic validation — any string gets through to the handler — so I could handle bad input in the handler and respond in a way the model could actually use:

```js
inputSchema: {
  name: z.string().describe("The name to greet"),
  language: z.string().describe("The language to greet in (e.g. 'french', 'japanese')"),
},
```

Now, when the handler received an unsupported language, instead of letting the SDK throw a protocol error, I returned `isError: true`:

```js
if (!greeting) {
  return {
    isError: true,
    content: [{ type: "text", text: `Unsupported language: "${language}". Check the languages resource for supported options.` }],
  };
}
```

The distinction matters:

- **`return { isError: true, content: [...] }`** — the error text comes back to the model as readable tool output. The model can see it, reason about it, and try something different.
- **`throw new Error(...)`** — produces a protocol-level JSON-RPC error. The model can't read the message at all; it just knows the tool failed.

For recoverable errors where the model should be able to react, `isError: true` is almost always the right choice.

**Act 3: Logging with the factory pattern**

With error handling in place, I wanted to add MCP protocol logging — emitting `info`, `warning`, and `debug` messages visible in the MCP Inspector's notifications panel. The SDK method for this is `server.sendLoggingMessage()`, but that requires a reference to the `server` object inside the tool handler.

The naive approach — importing `server` from `mcp.js` inside `greetName.js` — creates a circular dependency. `mcp.js` imports `greetName.js`; `greetName.js` imports `mcp.js`. JavaScript ES modules handle circular imports inconsistently — I got `undefined` instead of an explicit error, which made it slow to diagnose.

The solution was a factory function. Instead of exporting a `handler` directly, the tool exports `createHandler(server)`, which closes over the server and returns the actual handler:

```js
// src/tools/greetName.js (final version)
export function createHandler(server) {
  return async function handler({ name, language }) {
    await server.sendLoggingMessage({
      level: "info",
      message: `greet_name called with name="${name}", language="${language}"`,
    });

    const greeting = greetings[language];

    if (!greeting) {
      await server.sendLoggingMessage({
        level: "warning",
        message: `Unsupported language requested: "${language}"`,
      });
      return {
        isError: true,
        content: [{ type: "text", text: `Unsupported language: "${language}". Check the languages resource for supported options.` }],
      };
    }

    await server.sendLoggingMessage({
      level: "debug",
      message: `Greeting resolved: "${greeting}"`,
    });

    return {
      content: [{ type: "text", text: `${greeting}, ${name}!` }],
    };
  };
}
```

In `mcp.js`, registration becomes:

```js
server.registerTool(greetName.name, greetName.config, greetName.createHandler(server));
```

The tool file never imports `server`. `mcp.js` calls the factory at registration time and passes itself in. The dependency flows one way. No circularity.

**Act 4: Resources vs. tools in Claude Desktop**

Without the enum, I needed a way for the model to discover the list of valid languages. I built a `languages://list` resource — a read-only MCP resource backed by the same `greetings.js` data file:

```js
// src/resources/languages.js
export async function reader() {
  return {
    contents: [{ uri, text: JSON.stringify(Object.keys(greetings), null, 2) }],
  };
}
```

This felt architecturally correct. Resources are the MCP primitive for exposing read-only data. The model could fetch the list, see what's supported, and retry `greet_name` with a valid language.

Except it didn't work that way in Claude Desktop. Resources are fetched by the **client** — meaning the user or the host application — not by the model. Claude Desktop doesn't surface resources to the model at all. The model had no idea `languages://list` existed.

The fix was adding a `list_languages` **tool** that returns the same data:

```js
// src/tools/listLanguages.js
export async function handler() {
  return {
    content: [{ type: "text", text: Object.keys(greetings).join(", ") }],
  };
}
```

The resource still exists — the MCP Inspector can fetch it, and any client that exposes resources to users can use it. But for Claude Desktop, the tool is what makes the language list accessible to the model. When `greet_name` returns an error, the model can now call `list_languages` on its own, see the supported options, and retry with a valid value.

---

## What's next

This project was explicitly a learning exercise, but there are natural directions to take it:

- **Prompt templates** — the third MCP primitive I haven't touched. Prompts let you define reusable prompt templates that the user (not the model) can insert into the conversation.
- **Stateful sessions** — the HTTP transport supports session tracking via `sessionIdGenerator`. Stateful sessions would let you maintain per-connection state, which opens up tools that span multiple requests.
- **Dynamic tool registration** — tools and resources can be registered after the server starts, and you can notify clients when the tool list changes. Useful for servers that discover their capabilities at runtime.
- **Real data sources** — everything here is hardcoded. Connecting `greet_name` to a real translation API, or the languages resource to a database, would make it a genuinely useful server.
- **Deployment** — the HTTP transport is already deployable as a standard Node.js service. Wrapping `server.js` in a container and putting it behind a reverse proxy gets you a hosted MCP endpoint.

---

## The takeaway

Building `hello-mcp` gave me a much better mental model of MCP than reading the spec did. A few things I'd tell someone starting out:

1. **Start with the stdio transport.** It's five lines of code and gives you immediate feedback via Claude Desktop. HTTP comes later.
2. **Separate your server from your transport from day one.** The cost is negligible; the flexibility is real.
3. **Use `isError: true` for recoverable errors.** The model can reason about tool errors; it can't reason about JSON-RPC exceptions.
4. **Resources are for clients, not models.** If you need the model to see data, make it a tool.
5. **Check the SDK version.** The API has changed; older examples may lead you astray.

If you want to see the full working server — all the tools, both transports, the resource, and the factory pattern — the complete source is on GitHub at [github.com/chuckmeyer/hello-mcp](https://github.com/chuckmeyer/hello-mcp). Clone it, connect it to Claude Desktop, and try breaking `greet_name` with an unsupported language. It's a good way to see how all the pieces fit together.
