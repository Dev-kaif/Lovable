import { inngest } from "./client";
import { Sandbox } from "@e2b/code-interpreter";
import { getSandbox } from "./utils";
import { GraphState } from "@/lib/type";
import { ChatOpenAI } from "@langchain/openai";
import { buildGraph } from "@/graph/graph_final";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { PROMPT } from "@/lib/Prompt";
import { CallbackHandler } from "langfuse-langchain";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
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
    const sandboxId = await step.run("get-sandbox-id", async () => {
      const sandbox = await Sandbox.create("lovable-kaif-1try", {
        timeoutMs: 3 * 300_000,
      });
      return sandbox.sandboxId;
    });

    const llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      temperature: 0,
      apiKey: process.env.GEMINI_API_KEY,
      callbacks: [langfuseHandler],
    });

    const sandbox = await getSandbox(sandboxId);
    const userQuery = event.data.query;
    const checkpointer = await getCheckpointer(); 
    // Use a consistent thread ID based on user/session, not random
    const threadId = event.data.threadId || `thread-${event.user?.id || 'default'}-${event.data.sessionId || 'session'}`;

    const initialState: GraphState = {
      messages: [new SystemMessage(PROMPT), new HumanMessage(userQuery)],
      step,
      network: { data: { files: [], writtenFiles: {} } }, 
      sandbox,
      next: null,
      lastToolCallId: null,
      mainTaskExecuted: false,
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
      console.log(`📊 Existing state found: ${existingState ? 'YES' : 'NO'}`);
      
      if (existingState && existingState.values && existingState.values.messages?.length > 2) {
        // Continue from existing state with new user message
        console.log(`🔄 Continuing existing conversation with ${existingState.values.messages.length} messages`);
        result = await executable.invoke(
          { messages: [new HumanMessage(userQuery)] }, // Add new message
          config
        );
      } else {
        // Start fresh conversation
        console.log(`🆕 Starting new conversation`);
        result = await executable.invoke(initialState, config);
      }
    } catch (error) {
      console.log(`⚠️ Error checking existing state, starting fresh:`, error );
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
      executionSummary: {
        messagesProcessed: result.messages?.length || 0,
        mainTaskCompleted: result.mainTaskExecuted,
        finalState: result.next,
      }
    };
  }
);