"use client";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

export default function Page() {
  const trpc = useTRPC();

  // const { data } = useQuery(trpc.hello_3.queryOptions({ text: "osdjods" }));
  const invoke = useMutation(
    trpc.invoke.mutationOptions({
      onSuccess: () => {
        toast.success("Background job started");
      },
    })
  );

  return (
    <div className="bg-neutral-500 min-h-screen w-full text-white">
      <Button
        variant={"default"}
        onClick={() => invoke.mutate({ query: "make a saas like Landing page for a store of buscits with framer motion" })}
      >
        Invoke
      </Button>
    </div>
  );
}
