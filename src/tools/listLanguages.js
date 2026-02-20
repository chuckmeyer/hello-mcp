import { greetings } from "../data/greetings.js";

export const name = "list_languages";

export const config = {
  description: "Returns the list of supported greeting languages",
};

export async function handler() {
  return {
    content: [{ type: "text", text: Object.keys(greetings).join(", ") }],
  };
}
