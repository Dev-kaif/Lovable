import { z } from "zod";
import { baseProcedure, createTRPCRouter } from "../init";
import { inngest } from "@/inngest/client";

export const appRouter = createTRPCRouter({
  invoke: baseProcedure
    .input(
      z.object({
        query: z.string(),
        sessionId: z.string().optional(), // Add optional session ID
        threadId: z.string().optional(),  // Add optional thread ID
      })
    )
    .mutation(async ({ input }) => {
      // Generate a session ID if not provided
      const sessionId = input.sessionId || `session-${Date.now()}`;
      const threadId = input.threadId || `thread-user-${sessionId}`;
      
      await inngest.send({
        name: "aiAgent",
        data: {
          query: input.query,
          sessionId: sessionId,
          threadId: threadId,
        },
      });
      
      return { sessionId, threadId };
    }),
  hello_3: baseProcedure
    .input(
      z.object({
        text: z.string(),
      })
    )
    .query((options) => {
      return {
        greeting: `hello ${options.input.text} you are best`,
      };
    }),
});

// export type definition of API
export type AppRouter = typeof appRouter;