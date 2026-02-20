import { greetings } from "../data/greetings.js";

export const name = "languages";
export const uri = "languages://list";

export const config = {
  description: "List of supported greeting languages",
  mimeType: "application/json",
};

export async function reader() {
  return {
    contents: [{
      uri,
      text: JSON.stringify(Object.keys(greetings), null, 2),
    }],
  };
}
