"use client";
import { useTRPC } from "@/trpc/client";
import { useQuery } from "@tanstack/react-query";

export default function Page() {
  const trpc = useTRPC();

  

  const { data } = useQuery(trpc.hello_3.queryOptions({ text: "osdjods" }));

  return (
    <div className="bg-black min-h-screen w-full text-white">
      <div>{data?.greeting}</div>
    </div>
  );
}
