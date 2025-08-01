"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";

export default function Page() {
  const trpc = useTRPC();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [inputQuery, setInputQuery] = useState<string>("");

  const invoke = useMutation(
    trpc.invoke.mutationOptions({
      onSuccess: (data) => {
        // Store session info for subsequent calls
        setSessionId(data.sessionId);
        setThreadId(data.threadId);
        toast.success("Background job started");
      },
      onError: (error) => {
        toast.error("Failed to start job: " + error.message);
      },
    })
  );

  const handleInvoke = (query: string) => {
    if (!query.trim()) {
      toast.error("Please enter a query");
      return;
    }
    invoke.mutate({
      query,
      sessionId: sessionId || undefined,
      threadId: threadId || undefined,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleInvoke(inputQuery);
    setInputQuery(""); // Clear input after submit
  };

  return (
    <div className="bg-neutral-500 min-h-screen w-full text-white p-8">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="text-sm text-neutral-300">
          {sessionId && <p>Session: {sessionId}</p>}
          {threadId && <p>Thread: {threadId}</p>}
        </div>

        <div className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-2">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Enter your custom query (e.g., 'create a contact form', 'add dark mode toggle')"
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                className="flex-1 bg-neutral-600 border-neutral-400 text-white placeholder:text-neutral-300"
                disabled={invoke.isPending}
              />
              <Button
                type="submit"
                disabled={invoke.isPending || !inputQuery.trim()}
                className="px-6"
              >
                {invoke.isPending ? "Running..." : "Send"}
              </Button>
            </div>
          </form>

          <div className="flex items-center gap-4">
            <hr className="flex-1 border-neutral-400" />
            <span className="text-neutral-300 text-sm">
              Or try these examples
            </span>
            <hr className="flex-1 border-neutral-400" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button
                variant={"default"}
                onClick={() => handleInvoke("write hello world on home page")}
                disabled={invoke.isPending}
                className="h-auto py-3 text-left justify-start"
              >
                <div>
                  <div className="font-medium">Hello World</div>
                  <div className="text-xs opacity-70">Basic page setup</div>
                </div>
              </Button>

              <Button
                variant={"outline"}
                onClick={() =>
                  handleInvoke("add a navigation bar with Home and About links")
                }
                disabled={invoke.isPending}
                className="h-auto py-3 text-left justify-start"
              >
                <div>
                  <div className="font-medium">Add Navigation</div>
                  <div className="text-xs opacity-70">Header with links</div>
                </div>
              </Button>

              <Button
                variant={"secondary"}
                onClick={() =>
                  handleInvoke("create a footer with copyright text")
                }
                disabled={invoke.isPending}
                className="h-auto py-3 text-left justify-start"
              >
                <div>
                  <div className="font-medium">Add Footer</div>
                  <div className="text-xs opacity-70">Bottom section</div>
                </div>
              </Button>

              <Button
                variant={"ghost"}
                onClick={() =>
                  handleInvoke(
                    "create a contact form with name, email and message fields"
                  )
                }
                disabled={invoke.isPending}
                className="h-auto py-3 text-left justify-start border border-neutral-400"
              >
                <div>
                  <div className="font-medium">Contact Form</div>
                  <div className="text-xs opacity-70">Form with validation</div>
                </div>
              </Button>
            </div>

            <div className="pt-4 border-t border-neutral-400">
              <Button
                variant={"destructive"}
                onClick={() => {
                  setSessionId(null);
                  setThreadId(null);
                  setInputQuery("");
                  toast.info("Session reset");
                }}
                className="w-full"
              >
                Reset Session
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
