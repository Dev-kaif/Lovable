import { inngest } from "./client";
import { Sandbox } from "@e2b/code-interpreter";
import { getSandbox } from "./utils";
import { GraphState } from "@/lib/type";
import { ChatOpenAI } from "@langchain/openai";
import { buildGraph } from "@/graph/graph_final"; 
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { PROMPT } from "@/lib/Prompt";
import { CallbackHandler } from "langfuse-langchain";

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
        timeoutMs: 3 * 300_000, // Time to live in milliseconds
      });
      return sandbox.sandboxId;
    });

    const llm = new ChatOpenAI({
      // model: "deepseek/deepseek-r1-0528",
      model: "qwen/qwen3-235b-a22b-2507",
      // model: "moonshotai/kimi-k2",
      temperature: 0,
      apiKey: process.env.OPENAI_API_KEY,
      configuration:{
        baseURL:"https://openrouter.ai/api/v1",
      },
      callbacks: [langfuseHandler],
    });


    const sandbox = await getSandbox(sandboxId);
    const userQuery = event.data.query;

    const initialState: GraphState = {
      messages: [new SystemMessage(PROMPT), new HumanMessage(userQuery)],
      step,
      network: { data: [] },
      sandbox,
      next: null,
      lastToolCallId: null,
      mainTaskExecuted:false
    };

    // const app = buildGraph(llm, initialState);
    // const executable = app.compile();

    const executable = buildGraph(llm);

    const result = await executable.invoke(initialState);

    // const result = await executable.invoke(initialState);

    console.log("results ====> ", result, "\n");

    const sandboxUrl = await step.run("get-sandbox-url", async () => {
      const sandbox = await getSandbox(sandboxId);
      const host = await sandbox.getHost(3000);
      return `https://${host}`;
    });

    return { message: sandboxUrl };
  }
);
