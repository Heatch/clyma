import { z, type ZodError } from "zod"

import {
  ACTIVITY_TYPES,
  MARKET_CATEGORIES,
  MARKET_CONTINENTS,
  MARKET_OUTCOMES,
  MARKET_STATUSES,
} from "../markets/types"
import { U64_MAX } from "../markets/calculations"

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const BASE58_VALUES = new Map(
  [...BASE58_ALPHABET].map((character, index) => [character, index]),
)

const decodedBase58ByteLength = (value: string): number | null => {
  let decoded = 0n

  for (const character of value) {
    const digit = BASE58_VALUES.get(character)
    if (digit === undefined) return null
    decoded = decoded * 58n + BigInt(digit)
  }

  let significantBytes = 0
  for (let remaining = decoded; remaining > 0n; remaining >>= 8n) {
    significantBytes += 1
  }

  let leadingZeroBytes = 0
  while (leadingZeroBytes < value.length && value[leadingZeroBytes] === "1") {
    leadingZeroBytes += 1
  }

  return leadingZeroBytes + significantBytes
}

export const isSolanaPublicKey = (value: string): boolean =>
  decodedBase58ByteLength(value) === 32

export const isSolanaTransactionSignature = (value: string): boolean =>
  decodedBase58ByteLength(value) === 64

export const solanaPublicKeySchema = z
  .string()
  .trim()
  .min(32)
  .max(44)
  .refine(
    isSolanaPublicKey,
    "Expected a base58-encoded 32-byte Solana public key.",
  )

export const solanaTransactionSignatureSchema = z
  .string()
  .trim()
  .min(64)
  .max(88)
  .refine(
    isSolanaTransactionSignature,
    "Expected a base58-encoded 64-byte Solana signature.",
  )

export const marketCategorySchema = z.enum(MARKET_CATEGORIES)
export const marketStatusSchema = z.enum(MARKET_STATUSES)
export const marketOutcomeSchema = z.enum(MARKET_OUTCOMES)
export const marketContinentSchema = z.enum(MARKET_CONTINENTS)
export const activityTypeSchema = z.enum(ACTIVITY_TYPES)

export const marketHistoryPointSchema = z
  .object({
    timestamp: z.string().datetime({ offset: true }),
    yesProbability: z.number().min(0).max(1),
    noProbability: z.number().min(0).max(1),
    totalVolume: z.number().nonnegative(),
    yesLiquidity: z.number().nonnegative(),
    noLiquidity: z.number().nonnegative(),
    dataLabel: z.string(),
  })
  .superRefine((point, context) => {
    if (Math.abs(point.yesProbability + point.noProbability - 1) > 0.0001) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["noProbability"],
        message: "YES and NO probabilities must sum to 1.",
      })
    }
  })

export const marketEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(1_000),
  publisher: z.string().trim().min(1).max(160),
  url: z.string().url(),
  publishedAt: z.string().datetime({ offset: true }),
  kind: z.enum([
    "forecast",
    "observation",
    "methodology",
    "resolution-source",
    "background",
  ]),
  isDemo: z.boolean(),
})

export const marketTradeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  marketId: z.string().trim().min(1).max(120),
  side: z.enum(["yes", "no"]),
  amountSol: z.number().positive(),
  amountLamports: z.string().regex(/^\d+$/),
  probability: z.number().min(0).max(1),
  estimatedPayoutSol: z.number().nonnegative(),
  wallet: solanaPublicKeySchema,
  timestamp: z.string().datetime({ offset: true }),
  transactionSignature: solanaTransactionSignatureSchema.optional(),
  isDemo: z.boolean(),
})

const marketResolutionSchema = z.object({
  outcome: z.enum(["yes", "no", "cancelled"]),
  resolvedAt: z.string().datetime({ offset: true }),
  resolver: solanaPublicKeySchema,
  transactionSignature: solanaTransactionSignatureSchema.optional(),
  note: z.string().trim().min(1).max(1_000),
})

export const climateMarketSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    onchainMarketId: z.number().int().nonnegative().safe(),
    question: z.string().trim().min(10).max(400),
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().trim().min(10).max(2_000),
    category: marketCategorySchema,
    continent: marketContinentSchema,
    country: z.string().trim().min(1).max(100).optional(),
    region: z.string().trim().min(1).max(160),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    closeTime: z.string().datetime({ offset: true }),
    resolutionTime: z.string().datetime({ offset: true }).optional(),
    status: marketStatusSchema,
    outcome: marketOutcomeSchema,
    yesPrice: z.number().min(0).max(1),
    noPrice: z.number().min(0).max(1),
    yesLiquidity: z.number().nonnegative(),
    noLiquidity: z.number().nonnegative(),
    totalVolume: z.number().nonnegative(),
    participants: z.number().int().nonnegative(),
    resolutionSource: z.string().trim().min(1).max(300),
    resolutionSourceUrl: z.string().url(),
    resolutionRules: z.string().trim().min(10).max(4_000),
    resolver: solanaPublicKeySchema,
    createdAt: z.string().datetime({ offset: true }),
    featured: z.boolean(),
    trendingScore: z.number().min(0).max(100),
    history: z.array(marketHistoryPointSchema).min(2),
    evidence: z.array(marketEvidenceSchema).min(1),
    recentTrades: z.array(marketTradeSchema),
    resolution: marketResolutionSchema.optional(),
    network: z.literal("devnet"),
    settlementAsset: z.literal("SOL"),
    marketModel: z.literal("pooled-binary"),
    isDemo: z.boolean(),
    dataLabel: z.string(),
    dataDisclaimer: z.string().trim(),
  })
  .superRefine((market, context) => {
    if (Math.abs(market.yesPrice + market.noPrice - 1) > 0.0001) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["noPrice"],
        message: "YES and NO prices must sum to 1.",
      })
    }

    if (
      market.status === "resolved" &&
      !["yes", "no"].includes(market.outcome)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome"],
        message: "A resolved market must have a YES or NO outcome.",
      })
    }
    if (market.status === "cancelled" && market.outcome !== "cancelled") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome"],
        message: "A cancelled market must have a cancelled outcome.",
      })
    }
    if (
      ["open", "closed"].includes(market.status) &&
      market.outcome !== "unresolved"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outcome"],
        message: "An open or closed market must remain unresolved.",
      })
    }
    if (
      ["resolved", "cancelled"].includes(market.status) &&
      !market.resolution
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resolution"],
        message: "A resolved or cancelled market requires resolution metadata.",
      })
    }
  })

const emptyStringToUndefined = (value: unknown): unknown =>
  value === "" ? undefined : value

const optionalBooleanQuerySchema = z.preprocess((value) => {
  if (value === "true") return true
  if (value === "false") return false
  return emptyStringToUndefined(value)
}, z.boolean().optional())

const optionalIntegerQuerySchema = (
  minimum: number,
  maximum: number,
  fallback: number,
) =>
  z.preprocess(
    emptyStringToUndefined,
    z.coerce
      .number()
      .int()
      .min(minimum)
      .max(maximum)
      .optional()
      .default(fallback),
  )

export const marketListQuerySchema = z
  .object({
    search: z.preprocess(
      emptyStringToUndefined,
      z.string().trim().min(1).max(160).optional(),
    ),
    category: z.preprocess(
      emptyStringToUndefined,
      marketCategorySchema.optional(),
    ),
    continent: z.preprocess(
      emptyStringToUndefined,
      marketContinentSchema.optional(),
    ),
    status: z.preprocess(emptyStringToUndefined, marketStatusSchema.optional()),
    featured: optionalBooleanQuerySchema,
    limit: optionalIntegerQuerySchema(1, 100, 100),
    offset: optionalIntegerQuerySchema(0, 10_000, 0),
  })
  .strict()

export const regionMarketQuerySchema = marketListQuerySchema.omit({
  continent: true,
})

export const marketIdentifierSchema = z.object({
  id: z.string().trim().min(1).max(160),
})

export const continentParamSchema = z.object({
  continent: z.string().trim().min(1).max(80),
})

export const walletParamSchema = z.object({
  wallet: solanaPublicKeySchema,
})

const lamportsStringSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Lamports must be a decimal integer string.")
  .refine(
    (value) => BigInt(value) <= U64_MAX,
    "Lamport amount exceeds the Solana u64 range.",
  )

export const indexTransactionSchema = z
  .object({
    wallet: solanaPublicKeySchema,
    marketId: z.string().trim().min(1).max(120),
    onchainMarketId: z.number().int().nonnegative().safe(),
    type: activityTypeSchema,
    status: z.enum(["pending", "confirmed", "failed"]),
    side: z.enum(["yes", "no"]).optional(),
    amountLamports: lamportsStringSchema.optional(),
    transactionSignature: solanaTransactionSignatureSchema,
    timestamp: z.string().datetime({ offset: true }).optional(),
    failureReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((transaction, context) => {
    const isPurchase =
      transaction.type === "purchase_yes" || transaction.type === "purchase_no"
    if (
      isPurchase &&
      (!transaction.amountLamports || BigInt(transaction.amountLamports) === 0n)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amountLamports"],
        message: "A purchase transaction requires a positive lamport amount.",
      })
    }

    if (
      transaction.type === "purchase_yes" &&
      transaction.side &&
      transaction.side !== "yes"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["side"],
        message: "purchase_yes cannot be indexed with the NO side.",
      })
    }
    if (
      transaction.type === "purchase_no" &&
      transaction.side &&
      transaction.side !== "no"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["side"],
        message: "purchase_no cannot be indexed with the YES side.",
      })
    }
    if (transaction.status === "failed" && !transaction.failureReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureReason"],
        message: "A failed transaction requires a failure reason.",
      })
    }
    if (transaction.status !== "failed" && transaction.failureReason) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["failureReason"],
        message: "Only failed transactions may include a failure reason.",
      })
    }
  })

export const searchParamsToObject = (
  searchParams: URLSearchParams,
): Record<string, string> => {
  const values: Record<string, string> = {}
  searchParams.forEach((value, key) => {
    values[key] = value
  })
  return values
}

export interface ValidationIssue {
  path: string
  message: string
  code: string
}

export const formatZodIssues = (error: ZodError): ValidationIssue[] =>
  error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }))

export type MarketListQueryInput = z.infer<typeof marketListQuerySchema>
export type IndexTransactionInput = z.infer<typeof indexTransactionSchema>
