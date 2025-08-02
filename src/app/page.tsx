"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState, useEffect } from "react";

export default function Page() {
  const trpc = useTRPC();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [inputQuery, setInputQuery] = useState<string>("");
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize sandbox when component mounts or session is reset
  const getSandbox = useMutation(
    trpc.getSandbox.mutationOptions({
      onSuccess: (data) => {
        setSessionId(data.sessionId);
        setThreadId(data.threadId);
        setSandboxId(data.sandboxId);
        setIsInitialized(true);
        toast.success(`Sandbox ready! Session: ${data.sessionId.slice(-8)}`);
      },
      onError: (error) => {
        toast.error("Failed to initialize sandbox: " + error.message);
      },
    })
  );

  const invoke = useMutation(
    trpc.invoke.mutationOptions({
      onSuccess: (data) => {
        toast.success("Started working on your website");
      },
      onError: (error) => {
        toast.error("Failed to start job: " + error.message);
      },
    })
  );

  const cleanupSandbox = useMutation(
    trpc.cleanupSandbox.mutationOptions({
      onSuccess: () => {
        toast.info("Session cleaned up");
      },
      onError: (error) => {
        toast.error("Failed to cleanup: " + error.message);
      },
    })
  );

  // Initialize sandbox on component mount
  useEffect(() => {
    if (!isInitialized && !getSandbox.isPending) {
      getSandbox.mutate({ sessionId: sessionId || undefined });
    }
  }, [isInitialized, getSandbox, sessionId]);

  const handleInvoke = (query: string) => {
    if (!query.trim()) {
      toast.error("Please enter a query");
      return;
    }

    if (!sandboxId || !sessionId || !threadId) {
      toast.error("Sandbox not ready. Please wait...");
      return;
    }

    invoke.mutate({
      query,
      sessionId,
      threadId,
      sandboxId,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleInvoke(inputQuery);
    setInputQuery(""); // Clear input after submit
  };

  const handleResetSession = () => {
    // Optional: Cleanup current session
    if (sessionId) {
      cleanupSandbox.mutate({ sessionId });
    }

    // Reset state
    setSessionId(null);
    setThreadId(null);
    setSandboxId(null);
    setInputQuery("");
    setIsInitialized(false);

    // Create new session
    setTimeout(() => {
      getSandbox.mutate({});
    }, 100);
  };

  const isLoading = getSandbox.isPending || invoke.isPending;
  const canInvoke = isInitialized && sandboxId && !isLoading;

  return (
    <div className="bg-neutral-500 min-h-screen w-full text-white p-8">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Session Info */}
        <div className="text-sm text-neutral-300 space-y-1">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isInitialized ? "bg-green-400" : "bg-yellow-400"
              }`}
            />
            <span>{isInitialized ? "Sandbox Ready" : "Initializing..."}</span>
          </div>
          {sessionId && <p>Session: {sessionId}</p>}
          {threadId && <p>Thread: {threadId}</p>}
          {sandboxId && <p>Sandbox: {sandboxId}</p>}
          {sandboxId && (
            <a className="text-white px-3 py-1 bg-blue-500 rounded-2xl mt-10 hover:bg-blue-600" href={`https://3000-${sandboxId}.e2b.app`} target="_blank">
              Visit Sandbox
            </a>
          )}
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
                disabled={!canInvoke}
              />
              <Button
                type="submit"
                disabled={!canInvoke || !inputQuery.trim()}
                className="px-6"
              >
                {isLoading ? "Working..." : "Send"}
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
            <Button
              variant={"default"}
              onClick={() => handleInvoke("write hello world on home page")}
              disabled={!canInvoke}
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
              disabled={!canInvoke}
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
              disabled={!canInvoke}
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
              disabled={!canInvoke}
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
              onClick={handleResetSession}
              disabled={isLoading}
              className="w-full"
            >
              {isLoading ? "Working..." : "Reset Session & Create New Sandbox"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
