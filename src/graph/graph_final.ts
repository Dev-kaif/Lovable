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
import { masterMessageFilter } from "@/lib/filterMessages";

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

// Tool: CreateOrUpdateFiles with better duplicate detection
const CreateOrUpdateFiles = makeToolClass(
  "createOrUpdateFiles",
  "Creates or updates files in the Sandbox with advanced duplicate detection.",
  z.object({
    files: z.array(z.object({ path: z.string(), content: z.string() })),
  }),
  async ({ files }, _state, context) => {
    const { step, sandbox, getState } = context;
    const state = getState();
    const writtenFiles = state.network?.data?.writtenFiles ?? {};

    // 🔧 ENHANCED: More sophisticated duplicate detection
    const fileAnalysis = files.map((file) => {
      const existingContent = writtenFiles[file.path];
      const isIdentical = existingContent === file.content;
      const isSimilar =
        existingContent &&
        file.content.replace(/\s+/g, " ").trim() ===
          existingContent.replace(/\s+/g, " ").trim();

      return {
        ...file,
        isIdentical,
        isSimilar,
        exists: !!existingContent,
      };
    });

    const identicalFiles = fileAnalysis.filter((f) => f.isIdentical);
    const similarFiles = fileAnalysis.filter(
      (f) => f.isSimilar && !f.isIdentical
    );
    const newFiles = fileAnalysis.filter((f) => !f.isIdentical && !f.isSimilar);

    // If all files are identical, task is complete
    if (identicalFiles.length === files.length) {
      console.log("🔄 All files identical - task already completed");
      return "⚠️ All requested files already exist with identical content. Task is complete.";
    }

    // If we have similar files, just mark as complete to avoid minor whitespace iterations
    if (similarFiles.length > 0 && newFiles.length === 0) {
      console.log("🔄 Files are similar enough - considering task complete");
      return "✅ Files exist with similar content. Task is essentially complete.";
    }

    // Only write truly new/different files
    if (newFiles.length === 0) {
      return "⚠️ No new changes detected. Task appears to be complete.";
    }

    const toWrite = newFiles;
    const id = `write-${toWrite[0].path
      .replace(/[^a-zA-Z0-9]/g, "_")
      .slice(0, 30)}-${Date.now()}`;

    try {
      await step.run(id, async () => {
        const writePromises = toWrite.map((file) =>
          sandbox.files.write(file.path, file.content)
        );
        await Promise.all(writePromises);
      });

      const updatedWritten = {
        ...writtenFiles,
        ...Object.fromEntries(toWrite.map((f) => [f.path, f.content])),
      };

      console.log(`✅ Successfully wrote ${toWrite.length} new/modified files`);

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

// Tool: ReadFiles with proper parameter handling
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
      const contents = async () => {
        const results = [];
        for (const file of files) {
          const content = await context.sandbox.files.read(file);
          results.push(content);
        }
        return results;
      };

      const results = await contents();

      const fileContents = await results.map((content: any, i: any) => ({
        path: files[i],
        content,
      }));

      console.log("fileContents result ===> \n", fileContents, "\n\n");

      const formattedContent = fileContents
        .map(
          (fc: any) =>
            `=== ${fc.path} ===\n${fc.content}\n=== END ${fc.path} ===`
        )
        .join("\n\n");

      console.log("📖 ReadFiles - Content length:", formattedContent.length);
      console.log(
        "📖 ReadFiles - Content preview:",
        formattedContent.slice(0, 300)
      );

      return {
        result: formattedContent,
        network: {
          data: {
            lastReadFiles: formattedContent,
          },
        },
      };
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

// Tool Execution Node with proper state management
const callTools = async (state: GraphState): Promise<Partial<GraphState>> => {
  console.log("🔧 ENTERING callTools function");
  logState("TOOL NODE (before)", state);

  const lastMessage = state.messages.at(-1) as AIMessage;
  console.log("📧 Last message:", lastMessage);
  console.log("🔧 Tool calls found:", lastMessage?.tool_calls?.length || 0);

  if (!lastMessage?.tool_calls?.length) {
    console.log("⚠️ No tool calls found in last message");
    return {};
  }

  const toolMap = createToolMap(state);
  const toolMessages: ToolMessage[] = [];

  let mainTaskExecuted = state.mainTaskExecuted;
  let hasWriteErrors = false;

  // 🚀 CRITICAL: Start with existing network state
  const networkUpdate = {
    data: {
      files: [...(state.network?.data?.files || [])],
      writtenFiles: { ...(state.network?.data?.writtenFiles || {}) },
      lastReadFiles: state.network?.data?.lastReadFiles || null,
    },
  };

  for (const toolCall of lastMessage.tool_calls) {
    console.log(`🔧 Processing tool call: ${toolCall.name}`);
    console.log(`🔧 Tool call args:`, toolCall.args);

    const tool = toolMap[toolCall.name as keyof typeof toolMap];
    let rawOutput: any = `❌ Tool "${toolCall.name}" not found.`;

    if (tool) {
      try {
        // Fix common parameter issues before calling tool
        let fixedArgs = toolCall.args;

        // Fix readFiles parameter name issue
        if (
          toolCall.name === "readFiles" &&
          fixedArgs.paths &&
          !fixedArgs.files
        ) {
          console.log("🔧 Fixing readFiles parameter: paths → files");
          fixedArgs = { files: fixedArgs.paths };
        }

        // Fix createOrUpdateFiles stringified array issue
        if (
          toolCall.name === "createOrUpdateFiles" &&
          typeof fixedArgs.files === "string"
        ) {
          try {
            console.log("🔧 Fixing createOrUpdateFiles stringified array");
            fixedArgs = { files: JSON.parse(fixedArgs.files) };
          } catch (parseError) {
            console.error("❌ Failed to parse files string:", parseError);
            rawOutput = `❌ Tool ${toolCall.name} failed: files parameter is a malformed JSON string`;
            continue;
          }
        }

        console.log(
          `🔧 Calling tool ${toolCall.name} with fixed args:`,
          fixedArgs
        );
        rawOutput = await tool.invoke(fixedArgs);
        console.log(
          `🔧 Tool ${toolCall.name} returned:`,
          typeof rawOutput,
          rawOutput?.slice?.(0, 200) || rawOutput
        );

        // 🚀 CRITICAL FIX: Handle tool response properly
        if (
          typeof rawOutput === "object" &&
          rawOutput !== null &&
          "result" in rawOutput
        ) {
          const { result, network, ...rest } = rawOutput;

          // Merge network updates
          if (network?.data) {
            console.log(
              `🌐 Merging network data from ${toolCall.name}:`,
              network.data
            );
            Object.assign(networkUpdate.data, network.data);

            // Special handling for readFiles
            if (toolCall.name === "readFiles" && network.data.lastReadFiles) {
              console.log("📖 CAPTURED FILE CONTENT IN NETWORK STATE");
              console.log(
                "📖 Content length:",
                network.data.lastReadFiles.length
              );
            }
          }

          // Use result as the tool message content
          rawOutput = result;
        }

        // Enhanced completion detection
        const isTaskComplete =
          typeof rawOutput === "string" &&
          (rawOutput.includes("✅ Successfully wrote") ||
            rawOutput.includes("already exist with identical content") ||
            rawOutput.includes("Task completed") ||
            rawOutput.includes("Task appears to be complete") ||
            rawOutput.includes("Task is complete") ||
            rawOutput.includes("essentially complete") ||
            rawOutput.includes("TASK COMPLETION DETECTED"));

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
      `📧 CREATED TOOL MESSAGE for ${toolCall.name}:`,
      toolMessage.content.slice(0, 200) + "..."
    );
  }

  console.log(`📧 TOTAL TOOL MESSAGES CREATED: ${toolMessages.length}`);

  // 🚀 CRITICAL: Log final network state before returning
  console.log("🌐 FINAL NETWORK STATE BEFORE RETURN:");
  console.log("- lastReadFiles exists:", !!networkUpdate.data.lastReadFiles);
  console.log(
    "- lastReadFiles length:",
    networkUpdate.data.lastReadFiles?.length || 0
  );
  console.log(
    "- writtenFiles count:",
    Object.keys(networkUpdate.data.writtenFiles).length
  );

  const finalUpdate = {
    messages: toolMessages,
    mainTaskExecuted,
    hasWriteErrors,
    network: networkUpdate, // 🚀 CRITICAL: Include network update
  };

  console.log("🔧 RETURNING FROM callTools:");
  console.log("- Messages:", finalUpdate.messages?.length || 0);
  console.log("- Network included:", !!finalUpdate.network);
  console.log(
    "- Network data keys:",
    Object.keys(finalUpdate.network?.data || {})
  );

  return finalUpdate;
};



// Also debug the LLM call to see if it receives the tool messages
// Updated callLlm function with enhanced tool message filtering
export const callLlm =
  (llm: any, llmWithTools: any) =>
  async (state: GraphState): Promise<Partial<GraphState>> => {
    console.log("🤖 ENTERING callLlm function");
    logState("LLM NODE (before)", state);

    // Check for file contents in state
    const fileContents = state.network?.data?.lastReadFiles;
    if (fileContents) {
      console.log(
        "📖 FILE CONTENTS AVAILABLE IN STATE - Length:",
        fileContents.length
      );
      console.log("📖 First 200 chars:", fileContents.slice(0, 200));
    } else {
      console.log("❌ NO FILE CONTENTS IN STATE");
    }

    // Apply enhanced message filtering with aggressive tool message filtering
    const filterResult = masterMessageFilter(state.messages, {
      enableCompression: true,
      maxHistoryLength: 25,
      autoTerminateLoops: false,
      aggressiveToolFiltering: true, // 🚀 NEW: Aggressive tool message filtering
    });

    console.log("🔍 ENHANCED FILTERING RESULTS:");
    console.log(`- Original messages: ${filterResult.stats.original}`);
    console.log(`- Filtered messages: ${filterResult.stats.filtered}`);
    console.log(`- Total removed: ${filterResult.stats.removed}`);
    console.log(
      `- Tool messages removed: ${filterResult.stats.toolMessagesRemoved}`
    );

    filterResult.messages.forEach((msg, idx) => {
      const preview = msg.content?.toString().slice(0, 100) || "";
      console.log(`${idx}: ${msg.constructor.name} - ${preview}...`);
    });

    // Enhanced loop detection with tool message awareness
    if (filterResult.loopDetected && filterResult.shouldTerminate) {
      const hasCompletedWork = state.messages.some(
        (msg) =>
          msg.content?.toString().includes("✅ Successfully wrote") ||
          msg.content?.toString().includes("Task completed")
      );

      if (hasCompletedWork) {
        console.log(
          "🔄 Loop detected with completed work - forcing completion"
        );
        const completionResponse = await promptFinalSummary(
          filterResult.messages,
          llm
        );
        return {
          messages: [completionResponse],
          next: END,
          mainTaskExecuted: true,
        };
      }
    }

    const currentMessages = filterResult.messages;

    // Handle completion cases...
    if (state.mainTaskExecuted) {
      console.log("✅ Main task executed. Prompting for final summary.");
      const response = await promptFinalSummary(currentMessages, llm);
      return {
        messages: [response],
        next: END,
      };
    }

    // Enhanced completion detection with tool message analysis
    const hasCompletedFiles =
      Object.keys(state.network?.data?.writtenFiles || {}).length > 0;

    if (hasCompletedFiles) {
      const recentMessages = currentMessages.slice(-5);
      const hasCompletionSignals = recentMessages.some((msg) => {
        if (!(msg instanceof ToolMessage)) return false;
        const content = msg.content?.toString() || "";

        return (
          content.includes("already exist with identical content") ||
          content.includes("Task completed") ||
          content.includes("essentially complete") ||
          content.includes("TASK COMPLETION DETECTED")
        );
      });

      if (hasCompletionSignals) {
        console.log(
          "✅ Enhanced completion signals detected - generating summary"
        );
        const response = await promptFinalSummary(currentMessages, llm);
        return {
          messages: [response],
          next: END,
          mainTaskExecuted: true,
        };
      }
    }

    // 🚀 ENHANCED: Create system message with file contents and filtering stats
    const stateSummary = JSON.stringify(
      {
        files: state.network?.data?.files || [],
        writtenFiles: state.network?.data?.writtenFiles || {},
        lastToolCallId: state.lastToolCallId,
        mainTaskExecuted: state.mainTaskExecuted,
        hasWriteErrors: state.hasWriteErrors,
        next: state.next,
        filteringStats: filterResult.stats, // Include filtering statistics
      },
      null,
      2
    );

    const needsContext =
      Object.keys(state.network?.data?.writtenFiles || {}).length > 0;
    const userMessages: BaseMessage[] = currentMessages;

    const hasSystemMessage = currentMessages.some(
      (msg) => msg instanceof SystemMessage
    );

    let contextMessage = null;
    if (needsContext && !hasSystemMessage) {
      let contextContent = `System context:
${stateSummary}

🚀 ENHANCED ANTI-REPETITION SYSTEM ACTIVE:
- ${filterResult.stats.toolMessagesRemoved} redundant tool messages were filtered out
- Loop detection is active (detected: ${filterResult.loopDetected})

IMPORTANT: Before creating or updating files, check if they already exist with the same content in writtenFiles. If they do, the task is likely already complete and you should provide the final <task_summary>.

CRITICAL TOOL USAGE RULES:
- DO NOT repeat tool calls if you see completion signals in recent messages
- If you see "✅ Successfully wrote" or "Task completed" in recent tool responses, provide <task_summary> immediately
- Check conversation history before using readFiles - file content may already be available
- For readFiles tool, use parameter "files" (array of strings), NOT "paths"
- For createOrUpdateFiles tool, ensure "files" is a proper array, not a stringified JSON
- Always check tool responses for completion signals before making more tool calls

TOOL REPETITION PREVENTION:
- If the same file operation was successful recently, do not repeat it
- If file content was already read in this conversation, reference existing content instead of re-reading
- Look for completion indicators in tool responses before proceeding`;

      // 🚀 CRITICAL: Add file contents to context
      if (fileContents) {
        contextContent += `\n\n📖 CURRENTLY READ FILE CONTENTS:\n${fileContents}`;
        console.log("📖 INCLUDING FILE CONTENTS IN LLM CONTEXT");
      }

      contextMessage = new SystemMessage(contextContent);
    }

    const fullMessages = contextMessage
      ? [contextMessage, ...userMessages]
      : userMessages;

    console.log("\n🔍 FINAL MESSAGES SENT TO LLM (after enhanced filtering):");
    fullMessages.forEach((msg, idx) => {
      console.log(
        `${idx}: ${msg.constructor.name} - Length: ${
          msg.content?.toString().length
        } - Preview: ${msg.content?.toString().slice(0, 100)}...`
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

    // 🚀 ENHANCED: Include filtering stats in return
    return {
      messages:
        filterResult.stats.removed > 0
          ? [...filterResult.messages, response]
          : [response],
      next: next,
      network: {
        ...state.network,
        data: {
          ...state.network?.data,
          lastReadFiles: null,
        },
      },
    };
  };


//  LLM Node with better message filtering and completion detection
const promptFinalSummary = async (messages: any[], llm: any) => {
  const prompt = new HumanMessage(
    "The files have been written successfully. Your task is complete. Please provide the final <task_summary> now."
  );
  return await llm.invoke([...messages, prompt], { recursionLimit: 1 });
};

// Graph Compiler
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
