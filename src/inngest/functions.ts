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
import {
  filterMessages,
  filterAllRepetitiveMessages,
  detectRepetitivePattern,
} from "@/lib/filterMessages";

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

    const llm = new ChatOpenAI({
      // model: "deepseek/deepseek-r1-0528",
      // model: "qwen/qwen3-235b-a22b-2507",
      // model: "z-ai/glm-4.5",
      // model: "openrouter/horizon-alpha",
      model: "qwen/qwen3-coder:free",
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
      network: { data: { files: [], writtenFiles: {} } },
      sandbox,
      next: null,
      lastToolCallId: null,
      mainTaskExecuted: false,
      hasWriteErrors: false,
    };

    const graph = buildGraph(llm);
    const executable = graph.compile({ checkpointer });

    const config = {
      configurable: {
        thread_id: threadId,
      },
      recursionLimit: 10,
    };

    let result;
    try {
      const existingState = await executable.getState(config);
      const hasHistory = existingState?.values?.messages?.length > 2;

      if (hasHistory) {
        const currentMessages = existingState.values.messages || [];

        // 🔧 NEW: Apply repetitive message filtering
        console.log(`📊 Original message count: ${currentMessages.length}`);

        // Check if there's a repetitive pattern before filtering
        const hasRepetitivePattern = detectRepetitivePattern(currentMessages);
        if (hasRepetitivePattern) {
          console.log(`🔄 Detected repetitive pattern in conversation`);
        }

        // Apply comprehensive filtering
        const cleanedMessages = filterAllRepetitiveMessages(
          currentMessages,
          5, // windowSize: check last 5 messages
          3 // threshold: if same message appears 3+ times, filter it
        );

        console.log(`✨ Filtered message count: ${cleanedMessages.length}`);
        console.log(
          `🧹 Removed ${
            currentMessages.length - cleanedMessages.length
          } repetitive messages`
        );

        // Additional basic filtering (remove context messages, keep main system prompt)
        const finalMessages = filterMessages(cleanedMessages);

        const mergedState: GraphState = {
          ...existingState.values,
          step,
          sandbox,
          messages: [...finalMessages, new HumanMessage(userQuery)],
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
