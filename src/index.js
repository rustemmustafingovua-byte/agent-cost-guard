/**
 * agent-cost-guard — a budget in front of any OpenAI-compatible endpoint.
 *
 * An agent loop is unbounded by nature: it retries, it re-reads files, it
 * calls tools in a loop. This proxy puts a wall around it:
 *   - a token budget per session
 *   - a spend budget per session (converted with the upstream price)
 *   - a cap on round trips (tool-call storms)
 *   - a per-request latency ceiling
 *   - a report of where the tokens went
 */
export const LIMITS = {
  maxTokens: 200000,
  maxSpendUsd: 5,
  maxRounds: 60,
  maxLatencyMs: 120000,
}

export class Budget {
  constructor(limits = {}) {
    this.limits = { ...LIMITS, ...limits }
    /** @type {Map<string, {tokens: number, spendUsd: number, rounds: number, startedAt: number, calls: {model: string, tokens: number, at: string}[]}>} */
    this.sessions = new Map()
  }

  session(id, now = Date.now()) {
    let s = this.sessions.get(id)
    if (!s) {
      s = { tokens: 0, spendUsd: 0, rounds: 0, startedAt: now, calls: [] }
      this.sessions.set(id, s)
    }
    return s
  }

  /** Check whether the next call is allowed. */
  check(id, { estimatedTokens = 0 } = {}, now = Date.now()) {
    const s = this.session(id, now)
    if (s.rounds + 1 > this.limits.maxRounds)
      return { allowed: false, reason: `round limit reached (${this.limits.maxRounds})`, status: 429 }
    if (s.tokens + estimatedTokens >= this.limits.maxTokens)
      return { allowed: false, reason: `token budget exhausted (${s.tokens}/${this.limits.maxTokens})`, status: 429 }
    if (s.spendUsd >= this.limits.maxSpendUsd)
      return { allowed: false, reason: `spend budget exhausted ($${s.spendUsd.toFixed(4)}/$${this.limits.maxSpendUsd})`, status: 402 }
    return { allowed: true, session: s }
  }

  /** Record a completed call. */
  record(id, { model = "unknown", promptTokens = 0, completionTokens = 0, priceIn = 0, priceOut = 0 } = {}, now = Date.now()) {
    const s = this.session(id, now)
    const tokens = (promptTokens || 0) + (completionTokens || 0)
    const cost = (promptTokens / 1e6) * priceIn + (completionTokens / 1e6) * priceOut
    s.tokens += tokens
    s.spendUsd += cost
    s.rounds += 1
    s.calls.push({ model, tokens, at: new Date(now).toISOString() })
    if (s.calls.length > 500) s.calls.splice(0, s.calls.length - 500)
    return s
  }

  report(id) {
    const s = this.sessions.get(id)
    if (!s) return null
    const byModel = {}
    for (const c of s.calls) {
      byModel[c.model] = byModel[c.model] || { calls: 0, tokens: 0 }
      byModel[c.model].calls += 1
      byModel[c.model].tokens += c.tokens
    }
    return {
      session: id,
      tokens: s.tokens,
      spendUsd: Math.round(s.spendUsd * 1e6) / 1e6,
      rounds: s.rounds,
      uptimeMs: Date.now() - s.startedAt,
      byModel,
      limits: this.limits,
    }
  }

  all() {
    return [...this.sessions.keys()].map((id) => this.report(id))
  }

  /** Export a CSV spend report with one row per session (columns: model, tokens, cost, rounds). */
  csv(id) {
    const rows = id ? [this.report(id)].filter(Boolean) : this.all()
    const lines = ["model,tokens,cost,rounds"]
    for (const r of rows) {
      const models = Object.keys(r.byModel || {}).join("+") || "unknown"
      lines.push(`${models},${r.tokens},${r.spendUsd},${r.rounds}`)
    }
    return lines.join("\n") + "\n"
  }
}

/** Price table per 1M tokens, in USD. */
export const PRICES = {
  "free/qwen-3.8-max": { in: 0, out: 0 },
  "gpt-4.1": { in: 2, out: 8 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  "claude-sonnet-4-5": { in: 3, out: 15 },
  default: { in: 3, out: 15 },
}

export function priceOf(model) {
  return PRICES[model] || PRICES.default
}

/** Detect a tool-call storm: many calls in a short window. */
export function isStorm(calls, windowMs = 60000, threshold = 20, now = Date.now()) {
  const recent = calls.filter((c) => now - new Date(c.at).getTime() < windowMs)
  return recent.length >= threshold
}
