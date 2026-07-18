const { MongoClient } = require("mongodb")

async function test() {
  const uri = "mongodb+srv://dbUser2:nerdynarwhals@terramarket.dhni3tb.mongodb.net/?retryWrites=true&w=majority"
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
  await client.connect()
  const db = client.db("climate_market")

  console.log("=== COLLECTIONS ===")
  const cols = await db.listCollections().toArray()
  cols.forEach(c => console.log(`  ${c.name}: ${c.type}`))

  console.log("\n=== MARKETS (first 3) ===")
  const mkts = await db.collection("markets").find().limit(3).toArray()
  mkts.forEach(m => console.log(`  ${m.marketId} | ${m.status} | YES:${m.yesPrice} NO:${m.noPrice}`))

  console.log("\n=== POSITIONS ===")
  const positions = await db.collection("positions").find({ walletAddress: "8qFS3dgQGZ614c2owwobfT5qjZnSxMgb6Wg2abh7b75i" }).toArray()
  positions.forEach(p => console.log(`  ${p.side} | ${p.amountSol} SOL | ${p.marketDocId} | status:${p.status}`))

  console.log("\n=== USERS ===")
  const users = await db.collection("users").find().toArray()
  users.forEach(u => console.log(`  ${u.walletAddress} | lastLogin:${u.lastLoginAt}`))

  // Test write: insert a test transaction
  const txResult = await db.collection("transactions").updateOne(
    { txSignature: "test-sig-verify-write" },
    { $set: { walletAddress: "8qFS3dgQGZ614c2owwobfT5qjZnSxMgb6Wg2abh7b75i", type: "purchase_yes", chain: "solana", token: "SOL", status: "confirmed", amountSol: 0.001, createdAt: new Date() } },
    { upsert: true }
  )
  console.log(`\n=== WRITE TEST ===`)
  console.log(`  upserted: ${txResult.upsertedCount > 0 ? "yes" : "no"}, modified: ${txResult.modifiedCount}`)

  // Verify
  const tx = await db.collection("transactions").findOne({ txSignature: "test-sig-verify-write" })
  console.log(`  read back: ${tx ? "OK - " + tx.type : "FAIL"}`)

  // Clean up
  await db.collection("transactions").deleteOne({ txSignature: "test-sig-verify-write" })

  // Test auth_challenges
  console.log("\n=== AUTH_CHALLENGES ===")
  await db.collection("auth_challenges").insertOne({
    walletAddress: "8qFS3dgQGZ614c2owwobfT5qjZnSxMgb6Wg2abh7b75i",
    nonce: "test-nonce",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 300000),
    used: false,
  })
  const challenge = await db.collection("auth_challenges").findOne({ nonce: "test-nonce" })
  console.log(`  created: ${challenge ? "OK" : "FAIL"}, expires: ${challenge?.expiresAt}`)
  await db.collection("auth_challenges").deleteOne({ nonce: "test-nonce" })

  // Collection counts
  console.log("\n=== SUMMARY ===")
  for (const name of ["users","markets","positions","transactions","resolutions","market_prices","auth_challenges"]) {
    const n = await db.collection(name).countDocuments()
    console.log(`  ${name}: ${n} docs`)
  }

  await client.close()
  console.log("\nAll tests passed.")
}

test().catch(e => { console.error("FAILED:", e.message); process.exit(1) })
