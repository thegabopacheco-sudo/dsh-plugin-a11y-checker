# How dsh-plugin-a11y-checker works

Auditoría de accesibilidad web para DeepSeek Harness: alt, labels, ARIA, contraste, jerarquía de headings y foco por teclado en cualquier sitio http(s).

## Architecture

```
DSH ──MCP stdio──► server.mjs (single-file bundle)
                    └─ local plugin logic
```

## Safety

- Read by default; actions require `confirm:true`.
- `read-only` mode via environment variable.
- Allowlists where applicable.
- Audit at `<DSH_HOME>\cache\a11y-checker\audit.jsonl`.
- Action rate limit.

## Validation

End-to-end tests with the official MCP client (`@modelcontextprotocol/client@2.2.0`)
and the packaged artifact (`npm pack` → `postinstall` → deployed server).
