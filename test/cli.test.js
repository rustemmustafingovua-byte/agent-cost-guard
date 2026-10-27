import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)))
const BIN = join(ROOT, "bin/agent-cost-guard.js")

/**
 * Регрессия: CLI падал с "Cannot access 'LIMITS_default' before initialization",
 * то есть инструмент вообще не запускался. Проверяем, что он поднимается.
 */
test("CLI поднимает прокси и отвечает на /health", async () => {
  const port = 8897
  const proc = spawn("node", [BIN, "--upstream", "https://api.openai.com/v1", "--port", String(port)], {
    stdio: "ignore",
  })
  try {
    let ok = false
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        if (res.ok) {
          const body = await res.json()
          assert.equal(body.ok, true)
          ok = true
          break
        }
      } catch {}
    }
    assert.ok(ok, "прокси должен подняться и ответить")
  } finally {
    proc.kill()
  }
})

test("--help и --version работают", () => {
  const help = execFileSync("node", [BIN, "--help"], { encoding: "utf8" })
  assert.match(help, /agent-cost-guard/)
  const ver = execFileSync("node", [BIN, "--version"], { encoding: "utf8" }).trim()
  assert.match(ver, /^0\.\d+\.\d+$/)
})

test("без --upstream — понятная ошибка и код 2", () => {
  let code = 0
  try {
    execFileSync("node", [BIN], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  } catch (e) {
    code = e.status
  }
  assert.equal(code, 2)
})

test("budget отклоняет запрос когда лимит исчерпан", async () => {
  const port = 8898
  const proc = spawn("node", [BIN, "--upstream", "https://httpbin.org/get", "--port", String(port), "--max-tokens", "10", "--max-rounds", "1"], {
    stdio: "ignore",
  })
  try {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 150))
      try {
        const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-session-id": "budget-test" },
          body: JSON.stringify({ model: "gpt-4.1", messages: [{ role: "user", content: "hi" }] }),
        })
        if (res.status === 402 || res.status === 429) {
          const body = await res.json()
          assert.ok(body.error?.type === "budget_exceeded")
          return
        }
      } catch {}
    }
    assert.fail("ожидали 402/429 из-за исчерпания бюджета")
  } finally {
    proc.kill()
  }
})

test("без UPSTREAM_API_KEY — прокси запускается с открытым ключом", async () => {
  const port = 8899
  const env = { ...process.env }
  delete env.UPSTREAM_API_KEY
  const proc = spawn("node", [BIN, "--upstream", "https://httpbin.org/get", "--port", String(port)], {
    stdio: "ignore",
    env,
  })
  try {
    let ok = false
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`)
        if (res.ok) { ok = true; break }
      } catch {}
    }
    assert.ok(ok, "прокси должен подняться без UPSTREAM_API_KEY")
  } finally {
    proc.kill()
  }
})
