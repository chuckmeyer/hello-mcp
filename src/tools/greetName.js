import { z } from "zod";
import { greetings } from "../data/greetings.js";

export const name = "greet_name";

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
