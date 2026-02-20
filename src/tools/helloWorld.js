export const name = "hello_world";

export const config = {
  description: "Returns a Hello, World! greeting",
};

export async function handler() {
  return {
    content: [{ type: "text", text: "Hello, World!" }],
  };
}
