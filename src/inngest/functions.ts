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
    const checkpointer = getCheckpointer();
    const threadId = "text123";

    const initialState: GraphState = {
      messages: [new SystemMessage(PROMPT), new HumanMessage(userQuery)],
      step,
      network: { data: { files: [] } },
      sandbox,
      next: null,
      lastToolCallId: null,
      mainTaskExecuted: false,
    };

    const executable = buildGraph(llm);

    const result = await executable.invoke(initialState, {
      configurable: {
        thread_id: threadId,
        checkpointer: checkpointer,
      },
      recursionLimit: 3,
    });

    console.log("results ====> ", result, "\n");

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await getSandbox(sandboxId);
      const host = await sandbox.getHost(3000);
      return `https://${host}`;
    });

    return { message: sandboxUrl };
  }
);
