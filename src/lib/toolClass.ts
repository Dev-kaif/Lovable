import { DynamicStructuredTool } from "@langchain/core/tools";
import z from "zod";
import { GraphState } from "./type";

export function makeToolClass<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: T,
  handler: (input: z.infer<T>, state: GraphState) => Promise<string>
) {
  return class extends DynamicStructuredTool {
    constructor(private state: GraphState) {
      super({
        name,
        description,
        schema,
        func: async () => {
          throw new Error("Should not be called — override `_call` instead.");
        },
      });
    }

    async _call(input: z.infer<T>): Promise<string> {
      const result = await handler(input, this.state);
      return result;
      // return JSON.stringify(result);
    }
  };
}
