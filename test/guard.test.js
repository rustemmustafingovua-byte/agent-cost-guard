import { test } from "node:test"
import assert from "node:assert/strict"
import { Budget, priceOf, isStorm } from "../src/index.js"

test("a session is tracked per id", () => {
  const b = new Budget()
  b.record("s1", { model: "gpt-4.1", promptTokens: 100, completionTokens: 50, priceIn: 2, priceOut: 8 })
  const rep = b.report("s1")
  const re = rep
  assert.equal(re.tokens, 150)
  assert.equal(re.rounds, 1)
  assert.ok(re.spendUsd > 0)
  assert.equal(b.report("s2"), null)
})

test("the round limit stops a tool-call storm", () => {
  const b = new Budget({ maxRounds: 3 })
  for (let i = 0; i < 3; i++) b.record("s", { model: "m" })
  const v = b.check("s")
  assert.equal(v.allowed, false)
  assert.match(v.reason, /round limit/)
})

test("the token budget stops a long context", () => {
  const b = new Budget({ maxTokens: 100 })
  b.record("s", { model: "m", promptTokens: 90, completionTokens: 10 })
  const v = b.check("s")
  assert.equal(v.allowed, false)
  assert.equal(v.status, 429)
})

test("the spend budget stops an expensive loop", () => {
  const b = new Budget({ maxSpendUsd: 0.0001 })
  b.record("s", { model: "m", promptTokens: 1000, completionTokens: 100, priceIn: 3, priceOut: 15 })
  const v = b.check("s")
  assert.equal(v.allowed, false)
  assert.equal(v.status, 402)
})

test("prices resolve with a default", () => {
  assert.equal(priceOf("gpt-4.1").in, 2)
  assert.equal(priceOf("unknown-model").out, 15)
})

test("a storm is detected from the call log", () => {
  const calls = Array.from({ length: 25 }, () => ({ at: new Date().toISOString() }))
  assert.equal(isStorm(calls), true)
  assert.equal(isStorm([{ at: new Date(Date.now() - 3600_000).toISOString() }]), false)
})

test("zero maxTokens rejects immediately", () => {
  const b = new Budget({ maxTokens: 0 })
  const v = b.check("s", { estimatedTokens: 0 })
  assert.equal(v.allowed, false)
  assert.equal(v.status, 429)
})

test("negative maxTokens rejects immediately", () => {
  const b = new Budget({ maxTokens: -1 })
  const v = b.check("s", { estimatedTokens: 0 })
  assert.equal(v.allowed, false)
  assert.equal(v.status, 429)
})

test("zero maxSpendUsd rejects any spend", () => {
  const b = new Budget({ maxSpendUsd: 0 })
  b.record("s", { model: "m", promptTokens: 1, priceIn: 0, priceOut: 0 })
  const v = b.check("s")
  assert.equal(v.allowed, false)
  assert.equal(v.status, 402)
})

test("negative maxSpendUsd rejects immediately", () => {
  const b = new Budget({ maxSpendUsd: -1 })
  const v = b.check("s")
  assert.equal(v.allowed, false)
  assert.equal(v.status, 402)
})

test("report returns null for unknown session", () => {
  const b = new Budget()
  assert.equal(b.report("never-created"), null)
})

test("isStorm returns false for empty call log", () => {
  assert.equal(isStorm([]), false)
})

test("record handles zero or missing tokens", () => {
  const b = new Budget()
  const s = b.record("s", { model: "m" })
  assert.equal(s.tokens, 0)
  assert.equal(s.rounds, 1)
})
