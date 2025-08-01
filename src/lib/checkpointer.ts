import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";
import { GraphState } from "./type";

let checkpointer: MongoDBSaver | null = null;

export async function getCheckpointer() {
  if (checkpointer) {
    return checkpointer;
  }

  const mongoClient = new MongoClient(process.env.MONGODB_URL as string);
  await mongoClient.connect();
  console.log("✅ Connected to MongoDB for checkpointing.");

  checkpointer = new MongoDBSaver({
    client: mongoClient,
    dbName: "lovable",
    checkpointCollectionName: "lovable_checkpoints",
  });

  return checkpointer;
}
