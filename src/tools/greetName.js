import { z } from "zod";
import { greetings } from "../data/greetings.js";

export const name = "greet_name";

export const config = {
  description: "Returns a personalized greeting in the specified language. Check the languages resource for supported languages.",
  inputSchema: {
    name: z.string().describe("The name to greet"),
    language: z.string().describe("The language to greet in (e.g. 'french', 'japanese')"),
  },
};

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
        content: [{
          type: "text",
          text: `Unsupported language: "${language}". Check the languages resource for supported options.`,
        }],
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
