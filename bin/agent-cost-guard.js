#!/usr/bin/env node
/**
 * agent-cost-guard — put a budget in front of any OpenAI-compatible endpoint.
 *
 *   agent-cost-guard --upstream https://api.example.com/v1 --port 8791 \
 *                    --max-tokens 200000 --max-spend 5 --max-rounds 60
 *
 * Point your agent at http://127.0.0.1:8791/v1 and give it a session id:
 *   export OPENAI_BASE_URL=http://127.0.0.1:8791/v1
 *   export OPENAI_DEFAULT_HEADERS='{"x-session-id":"my-session"}'
 */
import { Budget, priceOf, LIMITS } from "../src/index.js"

// --- CLI shell: --help / --version -------------------------------------------
const HELP = "agent-cost-guard — A budget in front of any OpenAI-compatible endpoint.\n\nUSAGE\n  agent-cost-guard --upstream https://api.example.com/v1 --port 8791\n  # then point the agent at http://127.0.0.1:8791/v1\n\nCOMMANDS / OPTIONS\n  --upstream <url>   the OpenAI-compatible endpoint to protect (required)\n  --port <n>         port to listen on (default 8791)\n  --max-tokens <n>   token budget per session (default 200000)\n  --max-spend <usd>  spend budget per session (default 5)\n  --max-rounds <n>   round-trip cap per session (default 60)\n\nEndpoints:\n  GET /health              status and per-session stats\n  GET /report?id=<session>  the spend report of one session\n\nGive the agent a session id: header  x-session-id: <id>\n\nMIT · https://github.com/rustemmustafingovua-byte"
const VERSION = "0.1.0"
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP)
  process.exit(0)
}
if (process.argv.includes("--version") || process.argv.includes("-V")) {
  console.log(VERSION)
  process.exit(0)
}


const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : d
}
const upstream = arg("--upstream")
if (!upstream) {
  console.error("usage: agent-cost-guard --upstream <base-url> [--port 8791] [--max-tokens N] [--max-spend N] [--max-rounds N]")
  process.exit(2)
}
const port = Number(arg("--port", 8791))
const budget = new Budget({
  maxTokens: Number(arg("--max-tokens", LIMITS.maxTokens)),
  maxSpendUsd: Number(arg("--max-spend", LIMITS.maxSpendUsd)),
  maxRounds: Number(arg("--max-rounds", LIMITS.maxRounds)),
})

const key = process.env.UPSTREAM_API_KEY || ""
const http = await import("node:http")
http
  .createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks).toString()
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {}

    const sessionId = req.headers["x-session-id"] || req.socket.remoteAddress || "default"
    const url = new URL(req.url, "http://localhost")

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ ok: true, upstream, sessions: budget.all() }))
    }
    if (url.pathname === "/report") {
      const id = url.searchParams.get("id")
      const rep = id ? budget.report(id) : budget.all()
      res.writeHead(200, { "Content-Type": "application/json" })
      return res.end(JSON.stringify(rep, null, 2))
    }

    const verdict = budget.check(sessionId, { estimatedTokens: estimate(body) })
    if (!verdict.allowed) {
      res.writeHead(verdict.status, { "Content-Type": "application/json" })
      return res.end(JSON.stringify({ error: { message: verdict.reason, type: "budget_exceeded" } }))
    }

    const started = Date.now()
    try {
      const upstreamRes = await fetch(upstream.replace(/\/$/, "") + url.pathname + url.search, {
        method: req.method,
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          ...(req.headers["x-session-id"] ? { "x-session-id": req.headers["x-session-id"] } : {}),
        },
        body: raw || undefined,
        signal: AbortSignal.timeout(LIMITS_default.maxLatencyMs ?? 120000),
      })
      const text = await upstreamRes.text()
      let json = {}
      try {
        json = JSON.parse(text)
      } catch {}
      const usage = json.usage || {}
      const price = priceOf(json.model || body.model)
      budget.record(sessionId, {
        model: json.model || body.model || "unknown",
        promptTokens: usage.prompt_tokens || 0,
        completionTokens: usage.completion_tokens || 0,
        priceIn: price.in,
        priceOut: price.out,
      })
      res.writeHead(upstreamRes.status, { "Content-Type": "application/json" })
      res.end(text)
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: { message: String(err?.message ?? err) } }))
    }
  })
  .listen(port, () => {
    console.log(`[agent-cost-guard] http://127.0.0.1:${port} -> ${upstream}`)
    console.log(`[agent-cost-guard] limits: ${budget.limits.maxTokens} tokens, $${budget.limits.maxSpendUsd}, ${budget.limits.maxRounds} rounds`)
  })

function estimate(body) {
  const s = JSON.stringify(body || {})
  return Math.ceil(s.length / 4)
}
