/* eslint-disable @typescript-eslint/no-explicit-any */
import { inngest } from "./client";
import { Sandbox } from "@e2b/code-interpreter";
import { getSandbox } from "./utils";
import { GraphState } from "@/lib/type";
import { ChatOpenAI } from "@langchain/openai";
import { buildGraph } from "@/graph/graph_final";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { PROMPT } from "@/lib/Prompt";
import { CallbackHandler } from "langfuse-langchain";
import { getCheckpointer } from "@/lib/checkpointer";
import { masterMessageFilter } from "@/lib/filterMessages";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

const langfuseHandler = new CallbackHandler({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASEURL,
});

export const AiAgent = inngest.createFunction(
  { id: "Creating new Next app" },
  { event: "aiAgent" },
  async ({ step, event }) => {
    const sandboxId = event.data.sandboxId;
    if (!sandboxId) throw new Error("Sandbox ID is required");

    // Early validation and setup...
    const sandboxExists = await step.run("verify-sandbox", async () => {
      try {
        await getSandbox(sandboxId);
        return true;
      } catch {
        return false;
      }
    });

    if (!sandboxExists) {
      const newSandboxId = await step.run(
        "create-fallback-sandbox",
        async () => {
          const sandbox = await Sandbox.create("lovable-kaif-1try", {
            timeoutMs: 3 * 300_000,
          });
          return sandbox.sandboxId;
        }
      );
      console.log(`✅ Created fallback sandbox: ${newSandboxId}`);
    }

    // const llm = new ChatGoogleGenerativeAI({
    //   model: "gemini-2.0-flash",
    //   temperature: 0,
    //   apiKey: process.env.GEMINI_API_KEY,
    //   callbacks: [langfuseHandler],
    // });

    const llm = new ChatOpenAI({
      model: "qwen/qwen3-coder:free",
      // model: "deepseek/deepseek-r1-0528",
      // model: "openrouter/horizon-alpha",
      // model: "moonshotai/kimi-k2:free",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: { baseURL: "https://openrouter.ai/api/v1" },
      callbacks: [langfuseHandler],
    });

    const sandbox = await getSandbox(sandboxId);
    const userQuery = event.data.query;
    const checkpointer = await getCheckpointer();

    const threadId =
      event.data.threadId || `thread-${event.data.sessionId || "default"}`;
    console.log(`🎯 Session: ${event.data.sessionId} | 🧵 Thread: ${threadId}`);

    const initialState: GraphState = {
      messages: [new SystemMessage(PROMPT), new HumanMessage(userQuery)],
      step,
      network: { data: { files: [], writtenFiles: {}, lastReadFiles: null } },
      sandbox,
      next: null,
      lastToolCallId: null,
      mainTaskExecuted: false,
      hasWriteErrors: false,
    };

    const graph = buildGraph(llm);
    const executable = graph.compile({ checkpointer });

    const config = {
      configurable: { thread_id: threadId },
      recursionLimit: 15, // 🔧 INCREASED from 10 to 15
    };

    let result;
    try {
      const existingState = await executable.getState(config);
      const hasHistory = existingState?.values?.messages?.length > 2;

      if (hasHistory) {
        const currentMessages = existingState.values.messages || [];

        console.log(`📊 Original message count: ${currentMessages.length}`);

        // 🚀 FIXED: Use less aggressive filtering settings
        const filterResult = masterMessageFilter(currentMessages, {
          enableCompression: true, // 🔧 DISABLED compression for active sessions
          maxHistoryLength: 20, // 🔧 INCREASED from 20 to 35
          autoTerminateLoops: false, // 🔧 DISABLED auto-termination
          aggressiveToolFiltering: true
        });

        console.log(`✨ Filter results:`, filterResult.stats);
        console.log(`🧹 Removed ${filterResult.stats.removed} messages`);

        // 🔧 REMOVED: Early termination logic - let the graph handle completion naturally

        // 🔧 FIXED: Only check for severe loops with actual task completion
        if (filterResult.shouldTerminate) {
          const hasCompletedWork = currentMessages.some((msg: any) => {
            const contentStr =
              typeof msg.content === "string"
                ? msg.content
                : msg.content?.toString?.() ?? "";

            return (
              contentStr.includes("✅ Successfully wrote") ||
              contentStr.includes("Task completed")
            );
          });

          if (hasCompletedWork) {
            console.log(
              `🛑 Auto-terminating due to completed work + repetitive loop`
            );

            const sandboxUrl = await step.run("get-sandbox-url", async () => {
              const sandbox = await getSandbox(sandboxId);
              const host = await sandbox.getHost(3000);
              return `https://${host}`;
            });

            return {
              message: `${sandboxUrl}\n\n✅ Task completed successfully. The requested functionality has been implemented.`,
              threadId,
              sessionId: event.data.sessionId,
              sandboxId,
              executionSummary: {
                messagesProcessed: filterResult.stats.original,
                mainTaskCompleted: true,
                finalState: "COMPLETED_WITH_LOOP_DETECTION",
                loopDetected: true,
                messagesFiltered: filterResult.stats.removed,
              },
            };
          } else {
            // If no completed work, just continue normally instead of terminating
            console.log(
              `⚠️ Loop detected but no completed work found - continuing execution`
            );
          }
        }

        // Continue with filtered messages
        const mergedState: GraphState = {
          ...existingState.values,
          step,
          sandbox,
          messages: [...filterResult.messages, new HumanMessage(userQuery)],
          mainTaskExecuted: false,
          hasWriteErrors: false,
        };

        result = await executable.invoke(mergedState, config);
      } else {
        console.log(`🆕 Starting new conversation`);
        result = await executable.invoke(initialState, config);
      }
    } catch (error) {
      console.log(`⚠️ Error retrieving state:`, error);
      result = await executable.invoke(initialState, config);
    }

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await getSandbox(sandboxId);
      const host = await sandbox.getHost(3000);
      return `https://${host}`;
    });

    return {
      message: sandboxUrl,
      threadId,
      sessionId: event.data.sessionId,
      sandboxId,
      executionSummary: {
        messagesProcessed: result.messages?.length || 0,
        mainTaskCompleted: result.mainTaskExecuted,
        finalState: result.next,
      },
    };
  }
);
