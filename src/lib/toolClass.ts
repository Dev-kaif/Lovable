/* eslint-disable @typescript-eslint/no-explicit-any */
import { DynamicStructuredTool } from "@langchain/core/tools";
import z from "zod";

export function makeToolClass<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: T,
  handler: (input: z.infer<T>, step: any, network: any) => Promise<string>
) {
  return class extends DynamicStructuredTool {
    constructor(private step: any, private network: any) {
      super({
        name,
        description,
        schema,
        func: async () => {
          throw new Error("Should not be called — override `_call` instead.");
        },
      });
    }

    async _call(input: z.infer<T>) {
      return await handler(input, this.step, this.network);
    }
  };
}
