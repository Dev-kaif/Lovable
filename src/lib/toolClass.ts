/* eslint-disable @typescript-eslint/no-explicit-any */
import { DynamicStructuredTool } from "@langchain/core/tools";
import z from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { GraphState } from "./type";

type ToolReturn = string | Partial<GraphState>;

interface ToolContext {
  getState: () => GraphState;
  step?: any;
  sandbox?: any;
  [key: string]: any;
}

export function makeToolClass<T extends z.ZodTypeAny>(
  name: string,
  description: string,
  schema: T,
  handler: (
    input: z.infer<T>,
    state: GraphState,
    context: ToolContext
  ) => Promise<ToolReturn>
) {
  return class extends DynamicStructuredTool {
    private zodSchema: T;

    constructor(private context: ToolContext) {
      super({
        name,
        description,
        schema: zodToJsonSchema(schema) as any, // Convert Zod schema to JSON Schema for LangChain
        func: async () => {
          throw new Error("Should not be called — override `_call` instead.");
        },
      });

      // Store the original Zod schema for validation
      this.zodSchema = schema;
    }

    async _call(input: z.infer<T>): Promise<string> {
      console.log(
        `🔧 Tool ${this.name} called with input:`,
        JSON.stringify(input, null, 2)
      );

      try {
        const state = this.context.getState();
        const output = await handler(input, state, this.context);

        if (typeof output === "string") {
          console.log(
            `✅ Tool ${this.name} returned string:`,
            output.slice(0, 100) + "..."
          );
          return output;
        }

        // If it's an object with a result field, handle it properly
        if (
          typeof output === "object" &&
          output !== null &&
          "result" in output
        ) {
          const { result, ...rest } = output;

          // Apply state updates to the context
          if (Object.keys(rest).length > 0) {
            console.log(`🔄 Tool ${this.name} updating state:`, rest);
            Object.assign(state, rest);
          }

          const resultString =
            typeof result === "string" ? result : JSON.stringify(result);
          console.log(
            `✅ Tool ${this.name} returned result:`,
            resultString.slice(0, 100) + "..."
          );
          return resultString;
        }

        // For other objects, apply them to state and return JSON
        Object.assign(state, output);
        const jsonOutput = JSON.stringify(output);
        console.log(
          `✅ Tool ${this.name} returned object:`,
          jsonOutput.slice(0, 100) + "..."
        );
        return jsonOutput;
      } catch (error: any) {
        console.error(`❌ Tool ${this.name} error:`, error);
        return `❌ Tool ${this.name} failed: ${error.message}`;
      }
    }

    // Override invoke to handle tool call arguments properly
    async invoke(args: any): Promise<string> {
      console.log(`🚀 Invoking tool ${this.name} with args:`, args);

      try {
        // Handle case where args might be a JSON string
        let parsedArgs = args;
        if (typeof args === "string") {
          try {
            parsedArgs = JSON.parse(args);
          } catch {
            // If parsing fails, assume it's already the right format
          }
        }

        // Special handling for createOrUpdateFiles tool - fix common LLM mistakes
        if (this.name === "createOrUpdateFiles" && parsedArgs.files) {
          // If files is a string, try to parse it as JSON
          if (typeof parsedArgs.files === "string") {
            try {
              console.log(
                `🔧 Attempting to parse files string:`,
                parsedArgs.files.slice(0, 100) + "..."
              );
              parsedArgs.files = JSON.parse(parsedArgs.files);
              console.log(`✅ Successfully parsed files string into array`);
            } catch (parseError) {
              console.error(`❌ Failed to parse files string:`, parseError);
              return `❌ Tool ${this.name} failed: files parameter is a malformed JSON string`;
            }
          }
        }

        // Validate using the Zod schema
        const validatedInput = this.zodSchema.parse(parsedArgs);
        return await this._call(validatedInput);
      } catch (error: any) {
        console.error(`❌ Tool ${this.name} validation error:`, error);

        // If it's a Zod validation error, provide more details
        if (error.name === "ZodError") {
          const issues = error.issues
            .map((issue: any) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ");
          return `❌ Tool ${
            this.name
          } validation failed: ${issues}. Raw args: ${JSON.stringify(
            args
          ).slice(0, 200)}`;
        }

        return `❌ Tool ${this.name} failed: ${error.message}`;
      }
    }
  };
}
