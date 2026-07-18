import { MongoClient, type Db } from "mongodb"

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) throw new Error("MONGODB_URI is not set")

const DB_NAME = "climate_market"

interface MongoConnection {
  client: MongoClient
  db: Db
}

let cached: MongoConnection | null = null

export async function getDb(): Promise<Db> {
  if (cached) return cached.db

  const client = new MongoClient(MONGODB_URI as string, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
  })

  await client.connect()
  const db = client.db(DB_NAME)
  cached = { client, db }
  return db
}
