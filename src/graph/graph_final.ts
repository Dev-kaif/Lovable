/* eslint-disable @typescript-eslint/no-explicit-any */
import { makeToolClass } from "@/lib/toolClass";
import z from "zod";
import { GraphAnnotation, GraphState } from "@/lib/type";
import { StateGraph, START, END } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

// Logging Utility

const logStep = (id: string, details?: string) => {
  console.log(`\n===== [STEP] ${id} =====`);
  if (details) console.log(details);
  console.log("================================\n");
};

const logState = (label: string, state: GraphState) => {
  console.log(`\n🔍 [${label}] - Current Graph State:`);
  console.log(JSON.stringify(state, null, 2));
  console.log("=====================================\n");
};

// Tool: RunInTerminal

const RunInTerminal = makeToolClass(
  "runInTerminal",
  "Uses the terminal to run commands",
  z.object({ command: z.string() }),
  async ({ command }, state) => {
    const id = `terminal-${command
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 30)}-${Date.now()}`;
    logStep(id, `Executing command: ${command}`);
    const { step, sandbox } = state;

    try {
      await step.run(id, () => sandbox.commands.run(command));

      const installMatch = command.match(/^npm install\s+(@?[\w-]+)/);
      if (installMatch) {
        const packageName = installMatch[1];
        const verifyStepId = `verify-install-${Date.now()}`;
        const packageJson = await step.run(verifyStepId, () =>
          sandbox.files.read("package.json")
        );

        return packageJson.includes(`"${packageName}"`)
          ? `✅ Installed ${packageName}. Verified in package.json.`
          : `❌ Installed ${packageName}, but it's missing from package.json.`;
      }

      return `✅ Command "${command}" executed successfully.`;
    } catch (e: any) {
      return e.stderr || `❌ Command failed: ${e.message}`;
    }
  }
);

// Tool: CreateOrUpdateFiles

const CreateOrUpdateFiles = makeToolClass(
  "createOrUpdateFiles",
  "Creates or updates files in the Sandbox.",
  z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })),
  }),
  async ({ files }, state) => {
    const { step, sandbox, network } = state;
    const writtenFiles = network?.data?.writtenFiles ?? {};
    console.log("📂 Current writtenFiles before write:", writtenFiles);

    const toWrite = files.filter(
      (file) => writtenFiles[file.path] !== file.content
    );

    if (toWrite.length === 0) {
      return `⚠️ All requested files were already up-to-date. No write needed.`;
    }

    const id = `write-${toWrite[0].path
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 30)}-${Date.now()}`;
    logStep(id, `Writing files: ${toWrite.map((f) => f.path).join(", ")}`);

    try {
      await step.run(id, () =>
        Promise.all(
          toWrite.map((file) => sandbox.files.write(file.path, file.content))
        )
      );

      const updatedWritten = {
        ...writtenFiles,
        ...Object.fromEntries(toWrite.map((f) => [f.path, f.content])),
      };

      state.network.data.writtenFiles = updatedWritten;
      state.mainTaskExecuted = true;

      console.log("✅ Files written. Updated writtenFiles:", updatedWritten);
      return `✅ Wrote ${toWrite.length} file(s): ${toWrite
        .map((f) => f.path)
        .join(", ")}`;
    } catch (e: any) {
      return `❌ Error writing files: ${e.message}`;
    }
  }
);

// Tool: ReadFiles

const ReadFiles = makeToolClass(
  "readFiles",
  "Reads the content of specified files in the Sandbox.",
  z.object({ files: z.array(z.string()) }),
  async ({ files }, state) => {
    const id = `read-${files[0]
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 30)}-${Date.now()}`;
    logStep(id, `Reading files: ${files.join(", ")}`);

    try {
      const contents = await state.step.run(id, () =>
        Promise.all(files.map((file) => state.sandbox.files.read(file)))
      );

      return contents.map((content: any, i: any) => ({
        path: files[i],
        content,
      }));
    } catch (e: any) {
      return `❌ Error reading files: ${e.message}`;
    }
  }
);

// Tool Map Factory

const createToolMap = (state: GraphState) => ({
  runInTerminal: new RunInTerminal(state),
  createOrUpdateFiles: new CreateOrUpdateFiles(state),
  readFiles: new ReadFiles(state),
});

// Tool Execution Node

const callTools = async (state: GraphState): Promise<Partial<GraphState>> => {
  logState("TOOL NODE (before)", state);
  const lastMessage = state.messages.at(-1) as AIMessage;
  if (!lastMessage?.tool_calls?.length) {
    return { messages: [] };
  }

  const toolMap = createToolMap(state);
  const toolMessages: ToolMessage[] = [];

  // This is correct: use a local variable to track the flag's state for this turn.
  let mainTaskWasExecuted = state.mainTaskExecuted;

  for (const toolCall of lastMessage.tool_calls) {
    console.log(`🔧 Invoking tool: ${toolCall.name}`);
    if (toolCall.name === "createOrUpdateFiles") {
      mainTaskWasExecuted = true;
    }

    const tool = toolMap[toolCall.name as keyof typeof toolMap];
    let output: any = `❌ Tool "${toolCall.name}" not found.`;
    if (tool) {
      try {
        output = await tool.invoke(toolCall.args);
      } catch (e: any) {
        output = `❌ Error running tool ${toolCall.name}: ${e.message}`;
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

  const newState: GraphState = {
    ...state,
    messages: [...state.messages, ...toolMessages], // Append new messages
    mainTaskExecuted: mainTaskWasExecuted, // Set the new flag value
  };

  // logState("TOOL NODE (after)", newState);

  return newState;
};

// LLM Node

const promptFinalSummary = async (messages: any[], llm: any) => {
  const prompt = new HumanMessage(
    "The files have been written successfully. Your task is complete. Please provide the final <task_summary> now."
  );
  return await llm.invoke([...messages, prompt], { recursionLimit: 1 });
};

const callLlm =
  (llm: any, llmWithTools: any) =>
  async (state: GraphState): Promise<Partial<GraphState>> => {
    logState("LLM NODE (before)", state);
    
    if (state.mainTaskExecuted) {
      console.log("✅ Main task executed. Prompting for final summary.");
      const response = await promptFinalSummary(state.messages, llm);
      return { messages: [response], next: END };
    }

    const response: AIMessage = await llmWithTools.invoke(state.messages);

    const hasSummary =
      typeof response.content === "string" &&
      response.content.includes("<task_summary>");
      const next = hasSummary
      ? (console.log("✅ Summary detected."), END)
      : response.tool_calls?.length
      ? "tools"
      : (console.log("🛑 No tool calls or summary. Ending."), END);
      
      const newState: GraphState = {
        ...state,
      messages: [...state.messages, response],
      next: next,
    };
    
    logState("LLM NODE (after)", state);
    return newState;
  };

// Graph Compiler

export function buildGraph(llm: any) {
  const tools = [
    new RunInTerminal({} as any),
    new CreateOrUpdateFiles({} as any),
    new ReadFiles({} as any),
  ];

  const llmWithTools = llm.bindTools(tools);

  const graph = new StateGraph(GraphAnnotation)
    .addNode("agent", callLlm(llm, llmWithTools))
    .addNode("tools", callTools)
    .addEdge(START, "agent")
    .addConditionalEdges(
      "agent",
      (state) => {
        console.log("from condotional node ==> ", state.next);

        return state.next!;
      },
      {
        tools: "tools",
        [END]: END,
      }
    )
    .addEdge("tools", "agent");

  return graph.compile();
}
