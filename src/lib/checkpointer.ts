import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";

let checkpointer: MongoDBSaver | null = null;
let mongoClient: MongoClient | null = null;

export async function getCheckpointer() {
  if (checkpointer) {
    return checkpointer;
  }

  try {
    const mongoUrl = process.env.MONGODB_URL;
    if (!mongoUrl) {
      throw new Error("MONGODB_URL environment variable is not set");
    }

    console.log("🔌 Connecting to MongoDB for checkpointing...");

    mongoClient = new MongoClient(mongoUrl, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    await mongoClient.connect();
    console.log("✅ Connected to MongoDB for checkpointing.");

    checkpointer = new MongoDBSaver({
      client: mongoClient,
      dbName: "lovable",
      checkpointCollectionName: "lovable_checkpoints",
    });

    // Test the checkpointer
    console.log("🧪 Testing checkpointer...");

    return checkpointer;
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error);
  }
}

// Cleanup function (optional, for graceful shutdown)
export async function closeCheckpointer() {
  if (mongoClient) {
    await mongoClient.close();
    console.log("🔌 MongoDB connection closed");
  }
  checkpointer = null;
  mongoClient = null;
}
