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
        schema: zodToJsonSchema(schema) as any,
        func: async () => {
          throw new Error("Should not be called — override `_call` instead.");
        },
      });

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

        // 🚀 ENHANCED: Better completion detection
        const isCompletionSignal =
          typeof output === "string" &&
          (output.includes("✅ Successfully wrote") ||
            output.includes("already exist with identical content") ||
            output.includes("Task completed") ||
            output.includes("Task appears to be complete") ||
            output.includes("No changes needed") ||
            output.includes("essentially complete"));

        if (isCompletionSignal) {
          console.log("🏁 COMPLETION SIGNAL DETECTED - Task should end");
          // Add a special marker to help the LLM recognize completion
          const enhancedOutput = `${output}

🏁 TASK COMPLETION DETECTED: This indicates the task is finished. Please provide your final <task_summary> now.`;
          return enhancedOutput;
        }

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

    // 🚀 ENHANCED: Better parameter fixing and validation
    private fixCommonParameterIssues(args: any): any {
      // Fix readFiles parameter name issue
      if (this.name === "readFiles") {
        if (args.paths && !args.files) {
          console.log("🔧 Fixing readFiles: converting 'paths' to 'files'");
          return { files: args.paths };
        }
        if (args.path && !args.files) {
          console.log("🔧 Fixing readFiles: converting 'path' to 'files'");
          return { files: [args.path] };
        }
      }

      // Fix createOrUpdateFiles stringified array issue
      if (this.name === "createOrUpdateFiles") {
        if (typeof args.files === "string") {
          try {
            console.log(
              "🔧 Fixing createOrUpdateFiles: parsing stringified array"
            );
            return { files: JSON.parse(args.files) };
          } catch (parseError) {
            console.error("❌ Failed to parse files string:", parseError);
            throw new Error(
              `files parameter is a malformed JSON string: ${args.files}`
            );
          }
        }

        // Handle case where files might be passed as individual arguments
        if (!args.files && args.path && args.content) {
          console.log(
            "🔧 Fixing createOrUpdateFiles: converting path/content to files array"
          );
          return { files: [{ path: args.path, content: args.content }] };
        }
      }

      // Fix runInTerminal parameter variations
      if (this.name === "runInTerminal") {
        if (args.cmd && !args.command) {
          console.log("🔧 Fixing runInTerminal: converting 'cmd' to 'command'");
          return { command: args.cmd };
        }
        if (args.script && !args.command) {
          console.log(
            "🔧 Fixing runInTerminal: converting 'script' to 'command'"
          );
          return { command: args.script };
        }
      }

      return args;
    }

    // Override invoke to handle tool call arguments properly
    async invoke(args: any): Promise<string> {
      console.log(`🚀 Invoking tool ${this.name} with raw args:`, args);

      try {
        // Handle case where args might be a JSON string
        let parsedArgs = args;
        if (typeof args === "string") {
          try {
            parsedArgs = JSON.parse(args);
            console.log("✅ Successfully parsed JSON string args");
          } catch {
            // If parsing fails, assume it's already the right format
            console.log("⚠️ Args is string but not JSON, using as-is");
          }
        }

        // Apply common parameter fixes
        const fixedArgs = this.fixCommonParameterIssues(parsedArgs);

        if (fixedArgs !== parsedArgs) {
          console.log("🔧 Applied parameter fixes:", {
            original: parsedArgs,
            fixed: fixedArgs,
          });
        }

        // Validate using the Zod schema
        const validatedInput = this.zodSchema.parse(fixedArgs);
        console.log("✅ Successfully validated input:", validatedInput);

        return await this._call(validatedInput);
      } catch (error: any) {
        console.error(
          `❌ Tool ${this.name} validation/execution error:`,
          error
        );

        // If it's a Zod validation error, provide more details
        if (error.name === "ZodError") {
          const issues = error.issues
            .map((issue: any) => `${issue.path.join(".")}: ${issue.message}`)
            .join(", ");

          // Provide helpful suggestions based on the tool name
          let suggestion = "";
          if (this.name === "readFiles" && issues.includes("files")) {
            suggestion =
              " | Hint: Use 'files' parameter (array of strings), not 'paths' or 'path'";
          } else if (
            this.name === "createOrUpdateFiles" &&
            issues.includes("files")
          ) {
            suggestion =
              " | Hint: 'files' must be an array of objects with 'path' and 'content' properties";
          } else if (
            this.name === "runInTerminal" &&
            issues.includes("command")
          ) {
            suggestion =
              " | Hint: Use 'command' parameter (string), not 'cmd' or 'script'";
          }

          return `❌ Tool ${
            this.name
          } validation failed: ${issues}${suggestion}. Raw args: ${JSON.stringify(
            args
          ).slice(0, 300)}`;
        }

        return `❌ Tool ${this.name} failed: ${error.message}`;
      }
    }
  };
}
