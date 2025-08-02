/* eslint-disable @typescript-eslint/no-explicit-any */
import { makeToolClass } from "@/lib/toolClass";
import z from "zod";
import { GraphAnnotation, GraphState } from "@/lib/type";
import { StateGraph, START, END } from "@langchain/langgraph";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import {
  filterAllRepetitiveMessages,
  detectRepetitivePattern,
} from "@/lib/filterMessages";

// Enhanced system message filtering to remove duplicates
function filterSystemMessages(messages: BaseMessage[]): BaseMessage[] {
  let systemMessage: SystemMessage | null = null;
  const nonSystemMessages: BaseMessage[] = [];

  for (const message of messages) {
    if (message instanceof SystemMessage) {
      // Only keep the first system message we encounter
      if (
        !systemMessage &&
        message.content
          .toString()
          .includes("You are a senior software engineer")
      ) {
        systemMessage = message;
      }
    } else {
      nonSystemMessages.push(message);
    }
  }

  return systemMessage
    ? [systemMessage, ...nonSystemMessages]
    : nonSystemMessages;
}

// Logging Utility
const logStep = (id: string, details?: string) => {
  console.log(`\n===== [STEP] ${id} =====`);
  if (details) console.log(details);
  console.log("================================\n");
};

const logState = (label: string, state: GraphState) => {
  console.log(`\n🔍 [${label}] - Current Graph State:`);
  console.log(`Messages count: ${state.messages.length}`);
  console.log(`Main task executed: ${state.mainTaskExecuted}`);
  console.log(`Next: ${state.next}`);
  console.log("=====================================\n");
};

// Tool: RunInTerminal
const RunInTerminal = makeToolClass(
  "runInTerminal",
  "Uses the terminal to run commands",
  z.object({ command: z.string() }),
  async ({ command }, _state, context) => {
    const id = `terminal-${command
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 30)}-${Date.now()}`;
    logStep(id, `Executing command: ${command}`);
    const { step, sandbox } = context;

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

// Tool: CreateOrUpdateFiles - FIXED WITH DUPLICATE DETECTION
const CreateOrUpdateFiles = makeToolClass(
  "createOrUpdateFiles",
  "Creates or updates files in the Sandbox.",
  z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })),
  }),
  async ({ files }, _state, context) => {
    const { step, sandbox, getState } = context;
    const state = getState();
    const writtenFiles = state.network?.data?.writtenFiles ?? {};

    // Check if files already exist with same content
    const duplicateFiles = files.filter(
      (file) => writtenFiles[file.path] === file.content
    );

    if (duplicateFiles.length === files.length) {
      return "⚠️ All requested files already exist with identical content. No changes needed. Task appears to be complete.";
    }

    const toWrite = files.filter(
      (file) => writtenFiles[file.path] !== file.content
    );

    const id = `write-${toWrite[0].path
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 30)}-${Date.now()}`;

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

      return {
        result: `✅ Successfully wrote ${toWrite.length} file(s): ${toWrite
          .map((f) => f.path)
          .join(", ")}. Task completed.`,
        network: {
          data: {
            writtenFiles: updatedWritten,
          },
        },
      };
    } catch (error: any) {
      console.error(`❌ File write error:`, error);
      return `❌ Failed to write files: ${error.message}`;
    }
  }
);

// Tool: ReadFiles - FIXED TO RETURN PROPER FORMAT
const ReadFiles = makeToolClass(
  "readFiles",
  "Reads the content of specified files in the Sandbox.",
  z.object({ files: z.array(z.string()) }),
  async ({ files }, _state, context) => {
    const id = `read-${files[0]
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 30)}-${Date.now()}`;
    logStep(id, `Reading files: ${files.join(", ")}`);

    try {
      const contents = await context.step.run(id, () =>
        Promise.all(files.map((file) => context.sandbox.files.read(file)))
      );

      const fileContents = contents.map((content: any, i: any) => ({
        path: files[i],
        content,
      }));

      // Return a readable format instead of JSON string
      return fileContents
        .map(
          (fc: any) =>
            `=== ${fc.path} ===\n${fc.content}\n=== END ${fc.path} ===`
        )
        .join("\n\n");
    } catch (e: any) {
      return `❌ Error reading files: ${e.message}`;
    }
  }
);

const createToolMap = (state: GraphState) => {
  const context = {
    getState: () => state,
    step: state.step,
    sandbox: state.sandbox,
  };

  return {
    runInTerminal: new RunInTerminal(context),
    createOrUpdateFiles: new CreateOrUpdateFiles(context),
    readFiles: new ReadFiles(context),
  };
};

// Tool Execution Node - FIXED MESSAGE HANDLING
const callTools = async (state: GraphState): Promise<Partial<GraphState>> => {
  logState("TOOL NODE (before)", state);
  const lastMessage = state.messages.at(-1) as AIMessage;

  if (!lastMessage?.tool_calls?.length) {
    console.log("⚠️ No tool calls found in last message");
    return {};
  }

  const toolMap = createToolMap(state);
  const toolMessages: ToolMessage[] = [];

  let mainTaskExecuted = state.mainTaskExecuted;
  let hasWriteErrors = false;

  // Accumulate updates from tool executions
  let stateUpdates: Partial<GraphState> = {};

  for (const toolCall of lastMessage.tool_calls) {
    const tool = toolMap[toolCall.name as keyof typeof toolMap];
    let rawOutput: any = `❌ Tool "${toolCall.name}" not found.`;

    if (tool) {
      try {
        rawOutput = await tool.invoke(toolCall.args);

        // If tool returned { result, ...rest }, extract them
        if (
          typeof rawOutput === "object" &&
          rawOutput !== null &&
          "result" in rawOutput
        ) {
          const { result, ...rest } = rawOutput;
          stateUpdates = {
            ...stateUpdates,
            ...(rest as Partial<GraphState>),
          };
          rawOutput = result; // For message content
        }

        // Check for successful completion or duplicate detection
        const isTaskComplete =
          typeof rawOutput === "string" &&
          (rawOutput.includes("✅ Successfully wrote") ||
            rawOutput.includes("already exist with identical content") ||
            rawOutput.includes("Task completed") ||
            rawOutput.includes("Task appears to be complete"));

        if (toolCall.name === "createOrUpdateFiles") {
          if (isTaskComplete) {
            console.log("✅ Setting mainTaskExecuted to true - task completed");
            mainTaskExecuted = true;
          } else if (rawOutput.includes("❌")) {
            console.log("❌ File write operation failed");
            hasWriteErrors = true;
          }
        }
      } catch (e: any) {
        console.error(`❌ Tool ${toolCall.name} failed:`, e);
        rawOutput = `❌ Error running tool ${toolCall.name}: ${e.message}`;

        if (toolCall.name === "createOrUpdateFiles") {
          hasWriteErrors = true;
        }
      }
    }

    // Create tool message with proper content
    const toolMessage = new ToolMessage({
      content:
        typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput),
      tool_call_id: toolCall.id!,
      name: toolCall.name,
    });

    toolMessages.push(toolMessage);
    console.log(
      `📧 Created tool message for ${toolCall.name}:`,
      toolMessage.content.slice(0, 100) + "..."
    );
  }

  logState("TOOL NODE (after)", state);

  return {
    ...stateUpdates,
    messages: toolMessages, // This will be concatenated with existing messages
    mainTaskExecuted,
    hasWriteErrors,
  };
};

// LLM Node - ENHANCED WITH REPETITIVE MESSAGE FILTERING
const promptFinalSummary = async (messages: any[], llm: any) => {
  const prompt = new HumanMessage(
    "The files have been written successfully. Your task is complete. Please provide the final <task_summary> now."
  );
  return await llm.invoke([...messages, prompt], { recursionLimit: 1 });
};

// Enhanced repetitive pattern detection with filtering
const detectAndFilterRepetitivePattern = (
  messages: BaseMessage[]
): {
  hasRepetition: boolean;
  filteredMessages: BaseMessage[];
} => {
  // 🔧 FIRST: Remove duplicate system messages
  const systemFiltered = filterSystemMessages(messages);
  console.log(
    `📊 System message filtering: ${messages.length} → ${systemFiltered.length} messages`
  );

  // 🔧 SECOND: Check for repetitive patterns
  const hasRepetition = detectRepetitivePattern(systemFiltered, 5, 3);

  if (hasRepetition) {
    console.log(
      "🔄 Detected repetitive pattern - applying comprehensive filtering"
    );

    // Apply comprehensive filtering to remove repetitive messages
    const filteredMessages = filterAllRepetitiveMessages(
      systemFiltered,
      5, // windowSize: check last 5 messages
      3 // threshold: if same message appears 3+ times, filter it
    );

    console.log(
      `📊 Repetitive filtering: ${systemFiltered.length} → ${filteredMessages.length} messages`
    );
    console.log(
      `🧹 Total removed: ${messages.length - filteredMessages.length} messages`
    );

    return { hasRepetition: true, filteredMessages };
  }

  return { hasRepetition: false, filteredMessages: systemFiltered };
};

export const callLlm =
  (llm: any, llmWithTools: any) =>
  async (state: GraphState): Promise<Partial<GraphState>> => {
    logState("LLM NODE (before)", state);

    // 🔧 NEW: Apply repetitive message filtering before processing
    const { hasRepetition, filteredMessages } =
      detectAndFilterRepetitivePattern(state.messages);

    // If we detected and filtered repetitive messages, update the state
    const currentMessages = filteredMessages;

    // If there was significant repetition, force completion
    if (hasRepetition && state.messages.length - filteredMessages.length >= 3) {
      console.log("🔄 High repetition detected - forcing completion");
      const response = await promptFinalSummary(currentMessages, llm);
      return {
        messages: [response],
        next: END,
        mainTaskExecuted: true,
      };
    }

    // Log all messages to debug
    console.log("\n🔍 ALL MESSAGES IN STATE (after filtering):");
    currentMessages.forEach((msg, idx) => {
      console.log(
        `${idx}: ${msg.constructor.name} - ${msg.content
          ?.toString()
          .slice(0, 100)}...`
      );
    });

    // Case 1: Main task executed -> use plain LLM for summary
    if (state.mainTaskExecuted) {
      console.log("✅ Main task executed. Prompting for final summary.");
      const response = await promptFinalSummary(currentMessages, llm);
      return {
        messages: [response],
        next: END,
      };
    }

    // Case 2: Normal LLM run with tool support
    const stateSummary = JSON.stringify(
      {
        files: state.network?.data?.files || [],
        writtenFiles: state.network?.data?.writtenFiles || {},
        lastToolCallId: state.lastToolCallId,
        mainTaskExecuted: state.mainTaskExecuted,
        hasWriteErrors: state.hasWriteErrors,
        next: state.next,
      },
      null,
      2
    );

    // Enhanced context with completion status
    const needsContext =
      Object.keys(state.network?.data?.writtenFiles || {}).length > 0;
    const userMessages: BaseMessage[] = currentMessages; // Already filtered above

    // Add context about completed files (but don't add another system message if we already have one)
    const hasSystemMessage = currentMessages.some(
      (msg) => msg instanceof SystemMessage
    );
    const contextMessage =
      needsContext && !hasSystemMessage
        ? new SystemMessage(`System context:
${stateSummary}

IMPORTANT: Before creating or updating files, check if they already exist with the same content in writtenFiles. If they do, the task is likely already complete and you should provide the final <task_summary>.`)
        : null;

    const fullMessages = contextMessage
      ? [contextMessage, ...userMessages]
      : userMessages;

    console.log("\n🔍 MESSAGES SENT TO LLM:");
    fullMessages.forEach((msg, idx) => {
      console.log(
        `${idx}: ${msg.constructor.name} - ${msg.content
          ?.toString()
          .slice(0, 100)}...`
      );
    });

    const response: AIMessage = await llmWithTools.invoke(fullMessages);

    const hasSummary =
      typeof response.content === "string" &&
      response.content.includes("<task_summary>");

    const next = hasSummary
      ? (console.log("✅ Summary detected."), END)
      : response.tool_calls?.length
      ? "tools"
      : (console.log("🛑 No tool calls or summary. Ending."), END);

    logState("LLM NODE (after)", state);

    // 🔧 NEW: Return the filtered messages as part of the state update
    return {
      messages: hasRepetition ? [...filteredMessages, response] : [response],
      next: next,
    };
  };

// Graph Compiler - UNCHANGED
export function buildGraph(llm: any) {
  // Create tool instances for binding (these are just for schema)
  const toolSchemas = [
    new RunInTerminal({
      getState: () => ({} as GraphState),
      step: null,
      sandbox: null,
    }),
    new CreateOrUpdateFiles({
      getState: () => ({} as GraphState),
      step: null,
      sandbox: null,
    }),
    new ReadFiles({
      getState: () => ({} as GraphState),
      step: null,
      sandbox: null,
    }),
  ];

  const llmWithTools = llm.bindTools(toolSchemas);

  const graph = new StateGraph(GraphAnnotation)
    .addNode("agent", callLlm(llm, llmWithTools))
    .addNode("tools", callTools)
    .addEdge(START, "agent")
    .addConditionalEdges(
      "agent",
      (state) => {
        console.log("🔄 Conditional edge - next:", state.next);
        return state.next!;
      },
      {
        tools: "tools",
        [END]: END,
      }
    )
    .addEdge("tools", "agent");

  return graph;
}
