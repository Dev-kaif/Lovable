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

const langfuseHandler = new CallbackHandler({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_BASEURL,
});

export const AiAgent = inngest.createFunction(
  { id: "Creating new Next app" },
  { event: "aiAgent" },
  async ({ step, event }) => {
    // Use the provided sandbox ID instead of creating a new one
    const sandboxId = event.data.sandboxId;

    if (!sandboxId) {
      throw new Error(
        "Sandbox ID is required. Please initialize a session first."
      );
    }

    console.log(`🔄 Using existing sandbox: ${sandboxId}`);

    // Verify sandbox exists and is accessible
    const sandboxExists = await step.run("verify-sandbox", async () => {
      try {
        const sandbox = await getSandbox(sandboxId);
        console.log(`✅ Sandbox ${sandboxId} is accessible`);
        return true;
      } catch (error) {
        console.error(`❌ Sandbox ${sandboxId} is not accessible:`, error);
        return false;
      }
    });

    if (!sandboxExists) {
      // If sandbox doesn't exist, create a new one as fallback
      console.log(`🆕 Creating new sandbox as fallback`);
      const newSandboxId = await step.run(
        "create-fallback-sandbox",
        async () => {
          const sandbox = await Sandbox.create("lovable-kaif-1try", {
            timeoutMs: 3 * 300_000,
          });
          return sandbox.sandboxId;
        }
      );

      // Update the sandbox ID for this execution
      console.log(`✅ Created fallback sandbox: ${newSandboxId}`);
      // Note: You might want to update your session store here in a real implementation
    }

    const llm = new ChatOpenAI({
      // model: "deepseek/deepseek-r1-0528",
      // model: "qwen/qwen3-235b-a22b-2507",
      model: "z-ai/glm-4.5",
      // model: "moonshotai/kimi-k2",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
      },
      callbacks: [langfuseHandler],
    });

    // const llm = new ChatGoogleGenerativeAI({
    //   model: "gemini-2.0-flash",
    //   temperature: 0,
    //   apiKey: process.env.GEMINI_API_KEY,
    //   callbacks: [langfuseHandler],
    // });

    const sandbox = await getSandbox(sandboxId);
    const userQuery = event.data.query;
    const checkpointer = await getCheckpointer();

    // Use consistent thread ID based on session
    const threadId =
      event.data.threadId || `thread-${event.data.sessionId || "default"}`;

    console.log(`🎯 Processing query for session: ${event.data.sessionId}`);
    console.log(`🧵 Thread ID: ${threadId}`);
    console.log(`📦 Sandbox ID: ${sandboxId}`);

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

    // Build and compile the graph with checkpointer
    const graph = buildGraph(llm);
    const executable = graph.compile({ checkpointer });

    console.log(`🚀 Starting graph execution with thread ID: ${threadId}`);

    // Check if we have existing state for this thread
    const config = {
      configurable: {
        thread_id: threadId,
      },
      recursionLimit: 10,
    };

    let result;
    try {
      // Try to get existing state first
      const existingState = await executable.getState(config);
      console.log(`📊 Existing state found: ${existingState ? "YES" : "NO"}`);

      if (
        existingState &&
        existingState.values &&
        existingState.values.messages?.length > 2
      ) {
        // Continue from existing state with new user message
        console.log(
          `🔄 Continuing existing conversation with ${existingState.values.messages.length} messages`
        );

        // Get the current state and add the new message properly
        const currentMessages = existingState.values.messages || [];
        console.log(
          `📨 Current message types: ${currentMessages
            .map((m: any) => m._getType())
            .join(", ")}`
        );

        result = await executable.invoke(
          {
            messages: [new HumanMessage(userQuery)],
            mainTaskExecuted: false,
            hasWriteErrors: false,
          },
          config
        );
      } else {
        // Start fresh conversation
        console.log(`🆕 Starting new conversation`);
        result = await executable.invoke(initialState, config);
      }
    } catch (error) {
      console.log(`⚠️ Error checking existing state, starting fresh:`, error);
      result = await executable.invoke(initialState, config);
    }

    console.log("✅ Graph execution completed");
    console.log("Final state:", {
      messageCount: result.messages?.length || 0,
      mainTaskExecuted: result.mainTaskExecuted,
      next: result.next,
    });

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await getSandbox(sandboxId);
      const host = await sandbox.getHost(3000);
      return `https://${host}`;
    });

    return {
      message: sandboxUrl,
      threadId: threadId,
      sessionId: event.data.sessionId,
      sandboxId: sandboxId,
      executionSummary: {
        messagesProcessed: result.messages?.length || 0,
        mainTaskCompleted: result.mainTaskExecuted,
        finalState: result.next,
      },
    };
  }
);
