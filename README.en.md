# dsh-plugin-a11y-checker — Accessibility Checker

Auditoría de accesibilidad web para DeepSeek Harness: alt, labels, ARIA, contraste, jerarquía de headings y foco por teclado en cualquier sitio http(s).

## Herramientas

Ver `docs/HOW-IT-WORKS.md` para el detalle.

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-a11y-checker` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-a11y-checker
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_A11Y_CHECKER_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\a11y-checker\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
