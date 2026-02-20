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
