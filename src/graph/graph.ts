/* eslint-disable @typescript-eslint/no-explicit-any */
import { makeToolClass } from "@/lib/toolClass"; // Assuming this is your custom helper
import z from "zod";
import { GraphAnnotation, GraphState } from "@/lib/type"; // Note the import from your types file
import { StateGraph, START, END } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";

// --- TOOL DEFINITION ---
const RunInTerminal = makeToolClass(
  "runInTerminal",
  "Uses the terminal to run commands",
  z.object({
    command: z.string(),
  }),
  async ({ command }, state) => {
    console.log("\n===== Called runInTerminal =====\n");

    const { step, sandbox } = state;

    const result: string = await step?.run(
      "terminal" + Math.random(),
      async () => {
        const buffer = { stdout: "", stderr: "" };
        try {
          const result = await sandbox.commands.run(command, {
            onStdout: (data: string) => {
              buffer.stdout += data;
            },
            onStderr: (data: string) => {
              buffer.stderr += data;
            },
          });
          return result.stdout;
        } catch (error) {
          const errorMessage = `Command failed: ${error}\nstdout: ${buffer.stdout}\nstderr: ${buffer.stderr}`;
          console.log(errorMessage);
          return errorMessage;
        }
      }
    );

    return result;
  }
);

const CreateOrUpdateFiles = makeToolClass(
  "createOrUpdateFiles",
  "Creates or Updates the files in Sandbox",
  z.object({
    files: z.array(
      z.object({
        path: z.string(),
        content: z.string(),
      })
    ),
  }),
  async ({ files }, state) => {
    console.log("\n===== Called createOrUpdateFiles =====\n");

    const { step, sandbox, network } = state;

    const newFiles: string = await step?.run(
      "createOrUpdateFiles" + Math.random(),
      async () => {
        try {
          const updatedFiles = network.data?.files || {};
          for (const file of files) {
            await sandbox.files.write(file.path, file.content);
            updatedFiles[file.path] = file.content;
          }
          return updatedFiles;
        } catch (error) {
          return "Error" + error;
        }
      }
    );

    if (typeof newFiles == "object") {
      network.data.files = newFiles;
    }

    return newFiles;
  }
);

const ReadFiles = makeToolClass(
  "readFiles",
  "read the files in Sandbox",
  z.object({
    files: z.array(z.string()),
  }),
  async ({ files }, state) => {
    console.log("\n===== Called createOrUpdateFiles =====\n");

    const { step, sandbox } = state;

    return await step?.run("readFiles" + Math.random(), async () => {
      try {
        const contents = [];
        for (const file of files) {
          const content = await sandbox.files.read(file);
          contents.push({ path: file, content });
        }
        return JSON.stringify(contents);
      } catch (error) {
        return "Error" + error;
      }
    });
  }
);

// --- GRAPH BUILDER ---
export function buildGraph(llm: any, initialState: GraphState) {
  const runInTerminal = new RunInTerminal(initialState);
  const createOrUpdateFiles = new CreateOrUpdateFiles(initialState);
  const readFiles = new ReadFiles(initialState);

  const tools = [runInTerminal, createOrUpdateFiles, readFiles];
  const llmWithTools = llm.bindTools(tools);

  // Agent node: calls the LLM
  const callLlm = async (state: GraphState) => {
    const { messages } = state;
    const response = await llmWithTools.invoke(messages, {
      recursionLimit: 3,
    });

    console.log("\n\n\n repsonse.content ====> ", response.content, "\n\n\n");

    const hasTaskSummary =
      typeof response.content === "string" &&
      response.content.includes("<task_summary>");

    let nextStep: "tools" | typeof END;

    if (hasTaskSummary) {
      // 1. If the special <task_summary> string is found, force the graph to end.
      console.log("✅ Task summary detected. Ending the agent run.");
      nextStep = END;
    } else if (response.tool_calls && response.tool_calls.length > 0) {
      // 2. Otherwise, if there are tool calls, continue to the tools node.
      nextStep = "tools";
    } else {
      // 3. If there are no tool calls and no summary, end the run.
      console.log("No tool calls and no summary. Ending the agent run.");
      nextStep = END;
    }

    const lastToolCallId =
      response.tool_calls?.at(-1)?.id ??
      response.kwargs?.additional_kwargs?.tool_calls?.at(-1)?.id ??
      null;

    console.log("🧠 LLM response:", JSON.stringify(response, null, 2));

    return {
      messages: [response],
      lastToolCallId,
      next: nextStep,
    };
  };

  // Tool node
  const toolNode = new ToolNode(tools);

  // Router function for conditional edges
  const router = (state: GraphState) => {
    return state.next!;
  };

  // Define the graph
  const graph = new StateGraph(GraphAnnotation)
    .addNode("agent", callLlm)
    .addNode("tools", toolNode)
    .addEdge(START, "agent")
    .addEdge("tools", "agent")
    .addConditionalEdges("agent", router, {
      tools: "tools",
      [END]: END,
    });

  return graph;
}

// import { makeToolClass } from "@/lib/toolClass";
// import z from "zod";
// import { GraphState, GraphAnnotation } from "@/lib/type";
// import { StateGraph, START, END } from "@langchain/langgraph";
// import { AIMessage, ToolMessage } from "@langchain/core/messages";

// const RunInTerminal = makeToolClass(
//   "runInTerminal",
//   "Uses the terminal to run commands",
//   z.object({ command: z.string() }),
//   async ({ command }, state) => {
//     const uniqueStepId = "terminal" + Math.random();
//     console.log(`\n===== Executing: ${uniqueStepId} =====\n`);
//     return await state.step.run(uniqueStepId, () =>
//       state.sandbox.commands.run(command).then((p) => p.stdout)
//     );
//   }
// );

// const CreateOrUpdateFiles = makeToolClass(
//   "createOrUpdateFiles",
//   "Creates or Updates files in the Sandbox",
//   z.object({
//     files: z.array(z.object({ path: z.string(), content: z.string() })),
//   }),
//   async ({ files }, state) => {
//     const filePaths = files.map((f) => f.path).join(", ");
//     const uniqueStepId = "create/update" + Math.random();
//     console.log(`\n===== Executing: ${uniqueStepId} =====\n`);
//     await state.step.run(uniqueStepId, () =>
//       Promise.all(
//         files.map((file) => state.sandbox.files.write(file.path, file.content))
//       )
//     );
//     return `Successfully wrote to ${files.length} file(s): ${filePaths}`;
//   }
// );

// const ReadFiles = makeToolClass(
//   "readFiles",
//   "Reads the content of specified files in the Sandbox",
//   z.object({ files: z.array(z.string()) }),
//   async ({ files }, state) => {
//     const uniqueStepId = "readfile" + Math.random();
//     console.log(`\n===== Executing: ${uniqueStepId} =====\n`);
//     const contents = await state.step.run(uniqueStepId, () =>
//       Promise.all(files.map((file) => state.sandbox.files.read(file)))
//     );
//     return JSON.stringify(
//       contents.map((content: any, i: any) => ({ path: files[i], content }))
//     );
//   }
// );

// // --- Custom Tool-Calling Node ---
// const callTools = async (
//   state: GraphState
// ): Promise<{ messages: ToolMessage[] }> => {
//   const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
//   if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
//     throw new Error("Agent tried to call tools, but no tool calls were found.");
//   }

//   const toolMap = {
//     runInTerminal: new RunInTerminal(state),
//     createOrUpdateFiles: new CreateOrUpdateFiles(state),
//     readFiles: new ReadFiles(state),
//   };

//   const toolMessages: ToolMessage[] = [];

//   for (const toolCall of lastMessage.tool_calls) {
//     const tool = toolMap[toolCall.name as keyof typeof toolMap];
//     let output: string;
//     if (tool) {
//       try {
//         output = await tool.invoke(toolCall.args);
//       } catch (e: any) {
//         output = `Error: ${e.message}`;
//       }
//       toolMessages.push(
//         new ToolMessage({
//           content: output,
//           tool_call_id: toolCall.id as string,
//         })
//       );
//     } else {
//       toolMessages.push(
//         new ToolMessage({
//           content: `Error: Tool "${toolCall.name}" not found.`,
//           tool_call_id: toolCall.id as string,
//         })
//       );
//     }
//   }

//   return { messages: toolMessages };
// };

// // --- Graph Builder ---
// export function buildGraph(llm: any) {
//   // We only need placeholder tools here for the LLM to know their schemas.
//   const placeholderTools = [
//     new RunInTerminal({} as any),
//     new CreateOrUpdateFiles({} as any),
//     new ReadFiles({} as any),
//   ];
//   const llmWithTools = llm.bindTools(placeholderTools);

//   const callLlm = async (state: GraphState) => {
//     const response: AIMessage = await llmWithTools.invoke(state.messages);

//     const hasTaskSummary =
//       typeof response.content === "string" &&
//       response.content.includes("<task_summary>");

//     let nextStep: "tools" | typeof END;

//     if (hasTaskSummary) {
//       // 1. If the special <task_summary> string is found, force the graph to end.
//       console.log("✅ Task summary detected. Ending the agent run.");
//       nextStep = END;
//     } else if (response.tool_calls && response.tool_calls.length > 0) {
//       // 2. Otherwise, if there are tool calls, continue to the tools node.
//       nextStep = "tools";
//     } else {
//       // 3. If there are no tool calls and no summary, end the run.
//       console.log("No tool calls and no summary. Ending the agent run.");
//       nextStep = END;
//     }
//     return {
//       messages: [response],
//       next: nextStep,
//     };
//   };

//   const graph = new StateGraph(GraphAnnotation)
//     .addNode("agent", callLlm)
//     .addNode("tools", callTools)
//     .addEdge(START, "agent")
//     .addEdge("tools", "agent")
//     .addConditionalEdges("agent", (state: GraphState) => state.next!, {
//       tools: "tools",
//       [END]: END,
//     });

//   return graph.compile();
// }
