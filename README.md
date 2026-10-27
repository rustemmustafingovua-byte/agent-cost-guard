<div align="center">

# Agent Cost Guard

[![CI](https://github.com/rustemmustafingovua-byte/agent-cost-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/rustemmustafingovua-byte/agent-cost-guard/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/agent-cost-guard?color=cb3837&logo=npm)](https://www.npmjs.com/package/agent-cost-guard) [![license](https://img.shields.io/badge/license-MIT-8b949e?logo=opensourceinitiative)](./LICENSE)

</div>

---

**An agent loop is unbounded by nature: it retries, it re-reads files, it calls tools in circles. agent-cost-guard is a proxy that puts a wall around it — token budget, spend budget, round-trip cap, latency ceiling — in front of any OpenAI-compatible endpoint.**

---

⭐ **Star us on GitHub** if this project helps you build better agents!

---

## 🚀 Быстрый старт

```bash
git clone https://github.com/rustemmustafingovua-byte/agent-cost-guard
cd agent-cost-guard && npm install
agent-cost-guard --upstream https://api.openai.com/v1 --port 8791
```

---

## 🎯 Демо

```bash
agent-cost-guard --upstream https://api.openai.com/v1 --port 8791
curl -X POST http://127.0.0.1:8791/v1/chat/completions \
  -H "content-type: application/json" \
  -H "x-session-id: my-project" \
  -d '{"model":"gpt-4.1","messages":[{"role":"user","content":"hi"}]}'
curl "http://127.0.0.1:8791/report?id=my-project"
```

---

## 💰 Монетизация

- **Managed proxy**: hosted-версия прокси с SLA и приоритетной поддержкой
- **Enterprise budgets**: кастомные политики бюджетов для крупных команд
- **Observability plugins**: создание плагинов для отчётов и алертов
- **Training**: корпоративное обучение по cost-aware agent design

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/amazing-thing`)
3. Commit your changes (`git commit -m 'feat: add amazing thing'`)
4. Push to the branch (`git push origin feat/amazing-thing`)
5. Open a Pull Request

Bug reports and feature requests are welcome on the [Issues](https://github.com/rustemmustafingovua-byte/agent-cost-guard/issues) page.

MIT © rustemmustafingovua-byte
