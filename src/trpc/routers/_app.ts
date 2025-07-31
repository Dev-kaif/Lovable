import { z } from "zod";
import { baseProcedure, createTRPCRouter } from "../init";
import { inngest } from "@/inngest/client";

export const appRouter = createTRPCRouter({
  invoke: baseProcedure
    .input(
      z.object({
        query: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      inngest.send({
        name: "aiAgent",
        data: {
          query: input.query,
        },
      });
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
