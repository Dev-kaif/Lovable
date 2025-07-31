/* eslint-disable @typescript-eslint/no-explicit-any */
import { makeToolClass } from "@/lib/toolClass";
import z from "zod";
import { GraphAnnotation, GraphState } from "@/lib/type";
import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

// --- TOOL DEFINITIONS ---

// const RunInTerminal = makeToolClass(
//   "runInTerminal",
//   "Uses the terminal to run commands",
//   z.object({ command: z.string() }),
//   async ({ command }, state) => {
//     const uniqueStepId = `terminal-${command
//       .replace(/[^a-zA-Z0-9]/g, "_")
//       .slice(0, 30)}-${Date.now()}`;
//     console.log(`\n===== Executing: ${uniqueStepId} =====\n`);

//     const result: string = await state.step?.run(uniqueStepId, async () => {
//       const buffer = { stdout: "", stderr: "" };
//       try {
//         const result = await state.sandbox.commands.run(command, {
//           onStdout: (data: string) => {
//             buffer.stdout += data;
//           },
//           onStderr: (data: string) => {
//             buffer.stderr += data;
//           },
//         });
//         return result.stdout;
//       } catch (error) {
//         const errorMessage = `Command failed: ${error}\nstdout: ${buffer.stdout}\nstderr: ${buffer.stderr}`;
//         console.log(errorMessage);
//         return errorMessage;
//       }
//     });

//     return result;
//   }
// );

const RunInTerminal = makeToolClass(
  "runInTerminal",
  "Uses the terminal to run commands",
  z.object({ command: z.string() }),
  async ({ command }, state) => {
    const uniqueStepId = `terminal-${command.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}-${Date.now()}`;
    console.log(`\n===== Executing: ${uniqueStepId} =====\n`);
    
    const { step, sandbox } = state;

    try {
      // 1. Run the initial command
      await step.run(uniqueStepId, () => sandbox.commands.run(command));

      // 2. If it was an install command, verify it to get a clear signal
      if (command.startsWith("npm install")) {
        const packageName = command.split(" ")[2].split('@')[0]; // Extracts the package name
        
        const verifyStepId = `verify-install-${Date.now()}`;
        const packageJsonContent = await step.run(verifyStepId, () => 
          sandbox.files.read("package.json")
        );

        if (packageJsonContent.includes(`"${packageName}"`)) {
          // 3. Return a simple, definitive success string
          return `Successfully installed ${packageName}. package.json has been updated.`;
        } else {
          return `Error: Ran "npm install ${packageName}" but it did not appear in package.json.`;
        }
      }

      // For other commands, return a simple success message
      return `Command "${command}" executed successfully.`;

    } catch (e: any) {
      return e.stderr || `Command failed: ${e.message}`;
    }
  }
);

const CreateOrUpdateFiles = makeToolClass(
  "createOrUpdateFiles",
  "Creates or Updates files in the Sandbox.",
  z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })),
  }),
  async ({ files }, state) => {
    const filePaths = files.map((f) => f.path).join(", ");
    const uniqueWriteId = `write-${files[0].path
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 30)}-${Date.now()}`;
    console.log(
      `\n===== Executing: ${uniqueWriteId} for files: ${filePaths} =====\n`
    );

    const { step } = state;

    try {
      // 1. Write the files as before
      await step.run(uniqueWriteId, () =>
        Promise.all(
          files.map((file) =>
            state.sandbox.files.write(file.path, file.content)
          )
        )
      );

      // 2. NEW: Read the files back to get their content for verification
      const uniqueReadId = `read-after-write-${Date.now()}`;
      const contents = await step.run(uniqueReadId, () =>
        Promise.all(files.map((file) => state.sandbox.files.read(file.path)))
      );

      // 3. NEW: Create a rich, detailed confirmation message for the agent
      const fileSummaries = contents
        .map(
          (content: any, i: any) =>
            `File Path: ${files[i].path}\n\`\`\`\n${content}\n\`\`\``
        )
        .join("\n\n---\n\n");

      return `Successfully wrote to ${files.length} file(s). Their current contents are:\n\n${fileSummaries}`;
    } catch (e: any) {
      return `Error writing to files: ${e.message}`;
    }
  }
);

const ReadFiles = makeToolClass(
  "readFiles",
  "Reads the content of specified files in the Sandbox",
  z.object({ files: z.array(z.string()) }),
  async ({ files }, state) => {
    const uniqueStepId = `read-${files[0]
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 30)}-${Date.now()}`;
    console.log(
      `\n===== Executing: ${uniqueStepId} for files: ${files.join(
        ", "
      )} =====\n`
    );
    try {
      const contents = await state.step.run(uniqueStepId, () =>
        Promise.all(files.map((file) => state.sandbox.files.read(file)))
      );
      return contents.map((content: any, i: any) => ({
        path: files[i],
        content,
      }));
    } catch (e: any) {
      return `Error reading files: ${e.message}`;
    }
  }
);

// --- CUSTOM TOOL-CALLING NODE ---
const callTools = async (state: GraphState): Promise<Partial<GraphState>> => {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
    return { messages: [] };
  }

  const toolMap = {
    runInTerminal: new RunInTerminal(state),
    createOrUpdateFiles: new CreateOrUpdateFiles(state),
    readFiles: new ReadFiles(state),
  };

  const toolMessages: ToolMessage[] = [];
  let mainTaskWasExecuted = state.mainTaskExecuted;

  for (const toolCall of lastMessage.tool_calls) {
    if (toolCall.name === "createOrUpdateFiles") {
      mainTaskWasExecuted = true; // Set the flag
    }

    const tool = toolMap[toolCall.name as keyof typeof toolMap];
    let output = `Error: Tool "${toolCall.name}" not found.`;
    if (tool) {
      try {
        output = await tool.invoke(toolCall.args);
      } catch (e: any) {
        output = `Error running tool ${toolCall.name}: ${e.message}`;
      }
    }
    toolMessages.push(
      new ToolMessage({
        content: output,
        tool_call_id: toolCall.id!,
        name: toolCall.name,
      })
    );
  }
  return { messages: toolMessages, mainTaskExecuted: mainTaskWasExecuted };
};

// --- GRAPH BUILDER ---
export function buildGraph(llm: any) {
  const placeholderTools = [
    new RunInTerminal({} as any),
    new CreateOrUpdateFiles({} as any),
    new ReadFiles({} as any),
  ];
  const llmWithTools = llm.bindTools(placeholderTools);

  const callLlm = async (state: GraphState) => {
    if (state.mainTaskExecuted) {
      // The main task is done. Force the agent to generate the final summary.
      console.log("✅ Main task executed. Forcing summary generation.");
      const finalPrompt = new HumanMessage(
        "The files have been written successfully. Your task is complete. Please provide the final <task_summary> now."
      );
      // We use the llm directly, not the one with tools, to prevent further tool calls
      const response = await llm.invoke([...state.messages, finalPrompt], {
        recursionLimit: 1,
      });
      return { messages: [response], next: END };
    }

    const response: AIMessage = await llmWithTools.invoke(state.messages, {
      recursionLimit: 2,
    });

    const hasTaskSummary =
      typeof response.content === "string" &&
      response.content.includes("<task_summary>");

    let nextStep: "tools" | typeof END;
    if (hasTaskSummary) {
      console.log("✅ Task summary detected. Ending the agent run.");
      nextStep = END;
    } else if (response.tool_calls && response.tool_calls.length > 0) {
      nextStep = "tools";
    } else {
      nextStep = END;
    }
    return { messages: [response], next: nextStep };
  };

  const graph = new StateGraph(GraphAnnotation)
    .addNode("agent", callLlm)
    .addNode("tools", callTools)
    .addEdge(START, "agent")
    .addEdge("tools", "agent")
    .addConditionalEdges("agent", (state) => state.next!, {
      tools: "tools",
      [END]: END,
    });

  return graph.compile();
}
