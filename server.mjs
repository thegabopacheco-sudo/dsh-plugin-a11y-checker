#!/usr/bin/env node
// dsh-plugin-a11y-checker — auditoría de accesibilidad web para DeepSeek Harness.
// Tools: status, audit.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'a11y-checker', 'config.json');
const READ_ONLY = String(process.env.DSH_A11Y_MODE || '').toLowerCase() === 'read-only';
const TIMEOUT_MS = 15_000;
const log = (m) => process.stderr.write(`[a11y] ${m}\n`);

function loadConfig() {
  const defaults = { allowedHosts: [], userAgent: 'dsh-plugin-a11y-checker/0.1' };
  try { if (existsSync(CONFIG_FILE)) return { ...defaults, ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) }; } catch (e) { log(`config: ${e.message}`); }
  return defaults;
}

function parseColor(value) {
  const m = String(value || '').trim().match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  if (hex.length !== 6) return null;
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) };
}
function luminance({ r, g, b }) {
  const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrastRatio(a, b) {
  const l1 = luminance(a); const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const started = Date.now();
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': loadConfig().userAgent } });
    const html = await response.text();
    return { response, html, ms: Date.now() - started };
  } catch (error) {
    throw new Error(`no se pudo obtener ${url}: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
  } finally { clearTimeout(timer); }
}

function audit(html) {
  const issues = [];
  const wins = [];
  const add = (severity, message) => issues.push({ severity, message });
  const lang = (html.match(/<html[^>]+lang=["']([^"']*)["']/i) || [])[1];
  if (!lang) add('alta', 'falta lang en <html>'); else wins.push(`lang="${lang}"`);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  if (!title) add('alta', 'falta <title>'); else wins.push(`title: "${title.trim()}"`);

  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const noAlt = imgs.filter((tag) => !/\balt=["'][^"']*["']/i.test(tag));
  if (noAlt.length) add('alta', `${noAlt.length} imagen(es) sin alt`); else if (imgs.length) wins.push('imágenes con alt');
  const decorative = imgs.filter((tag) => /alt=["']\s*["']/i.test(tag) && !/role=["']presentation|aria-hidden=["']true/i.test(tag));
  if (decorative.length) add('media', `${decorative.length} imagen(es) con alt vacío sin role/aria-hidden`);

  const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
  const emptyButtons = buttons.filter((text) => text === '').length;
  if (emptyButtons) add('alta', `${emptyButtons} botón(es) sin texto accesible`);
  const links = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
  const vague = links.filter((text) => /^(clic aquí|click here|aquí|here|más|more|leer más|read more)$/i.test(text)).length;
  if (vague) add('baja', `${vague} enlace(s) con texto poco descriptivo`);

  const inputs = [...html.matchAll(/<input\b[^>]*>/gi)].map((m) => m[0]).filter((tag) => !/type=["'](hidden|submit|button|image|reset)["']/i.test(tag));
  const labelled = inputs.filter((tag) => /\baria-label(=|\b)/i.test(tag) || /\baria-labelledby(=|\b)/i.test(tag) || /\bid=["'][^"']+["']/i.test(tag) || /\btitle=["'][^"']+["']/i.test(tag)).length;
  if (inputs.length > labelled) add('alta', `${inputs.length - labelled} input(s) sin label/aria-label`);

  const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  if (headings.length && headings[0] !== 1) add('media', `el primer heading es h${headings[0]} (debería ser h1)`);
  for (let i = 1; i < headings.length; i++) if (headings[i] - headings[i - 1] > 1) { add('baja', `salto de heading h${headings[i - 1]} → h${headings[i]}`); break; }

  const positiveTabindex = [...html.matchAll(/tabindex=["'](\d+)["']/gi)].filter((m) => Number(m[1]) > 0).length;
  if (positiveTabindex) add('media', `${positiveTabindex} elemento(s) con tabindex positivo`);

  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((m) => m[1]);
  const duplicated = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (duplicated.length) add('media', `ids duplicados: ${duplicated.slice(0, 5).join(', ')}`);

  const inlineContrast = [...html.matchAll(/style=["']([^"']*)["']/gi)]
    .map((m) => m[1]).map((style) => ({ fg: parseColor((style.match(/color:\s*([^;]+)/i) || [])[1]), bg: parseColor((style.match(/background(?:-color)?:\s*([^;]+)/i) || [])[1]) }))
    .filter((pair) => pair.fg && pair.bg).map((pair) => contrastRatio(pair.fg, pair.bg));
  const lowContrast = inlineContrast.filter((ratio) => ratio < 4.5).length;
  if (lowContrast) add('media', `${lowContrast} texto(s) inline con contraste < 4.5:1`);

  const invalidAria = [...html.matchAll(/aria-(?:role|label|labelledby|describedby|hidden|expanded|controls|live)=["'][^"']*/gi)].length;
  if (invalidAria > 0) wins.push(`ARIA presente (${invalidAria} atributos)`);
  if (/<video\b[^>]*autoplay/i.test(html) && !/<video\b[^>]*muted/i.test(html)) add('media', 'video con autoplay y sin muted');
  if (!/<main\b/i.test(html)) add('baja', 'sin landmark <main>');
  if (/<html[^>]+dir=["']rtl/i.test(html)) wins.push('RTL declarado');
  return { issues, wins };
}

function severityWeight(severity) { return severity === 'alta' ? 12 : severity === 'media' ? 6 : 2; }
function textResult(t) { return { content: [{ type: 'text', text: t }] }; }

function resolveTarget(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error(`URL inválida: ${raw}`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('solo se permiten URLs http:// o https://');
  const config = loadConfig();
  if (config.allowedHosts.length > 0 && !config.allowedHosts.includes(url.hostname)) throw new Error(`host no permitido: ${url.hostname}. Lista blanca: ${config.allowedHosts.join(', ')}`);
  return url;
}

function buildInstructions() {
  return [
    'Accessibility Checker: auditoría de accesibilidad web para WENDIGO (solo lectura).',
    '',
    'Herramientas: status, audit.',
    '',
    'audit revisa: lang, title, alt de imágenes, labels de inputs, texto de botones/enlaces, jerarquía de headings, tabindex, ids duplicados, contraste inline y ARIA.',
    '',
    'Reglas:',
    '- Solo sitios http(s) permitidos en allowedHosts.',
    '- Reporta severidad real; no inventes resultados de lectores de pantalla.',
    '- Es solo lectura: no modifica el sitio.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-a11y-checker', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Configuración, hosts permitidos y modo.', inputSchema: z.object({}) },
    async () => {
      const config = loadConfig();
      return textResult([`Modo: ${READ_ONLY ? 'read-only' : 'normal (solo lectura)'}`, `Config: ${CONFIG_FILE}`, `Hosts permitidos: ${config.allowedHosts.length ? config.allowedHosts.join(', ') : 'todos'}`, `User-Agent: ${config.userAgent}`].join('\n'));
    },
  );

  server.registerTool(
    'audit',
    {
      title: 'Auditar accesibilidad',
      description: 'Analiza una página y reporta problemas de accesibilidad ordenados por severidad.',
      inputSchema: z.object({ url: z.string().min(6) }),
    },
    async (args) => {
      const url = resolveTarget(args.url);
      const { response, html, ms } = await fetchHtml(url);
      const { issues, wins } = audit(html);
      const penalty = issues.reduce((sum, issue) => sum + severityWeight(issue.severity), 0);
      const score = Math.max(0, 100 - penalty);
      const lines = [
        `# ${url.toString()}`,
        `HTTP ${response.status} · ${ms} ms · ${html.length} bytes`,
        '',
        `Score accesibilidad: ${score}/100 · ${issues.length} problema(s)`,
        '',
        '## Problemas',
        ...(issues.length ? issues.sort((a, b) => ({ alta: 0, media: 1, baja: 2 })[a.severity] - ({ alta: 0, media: 1, baja: 2 })[b.severity]).map((i) => `[${i.severity}] ${i.message}`) : ['sin problemas detectados']),
        '',
        '## Correcto',
        ...(wins.length ? wins.map((w) => `✅ ${w}`) : ['(sin elementos destacados)']),
        '',
        'Nota: heurística estática de HTML; no sustituye una auditoría manual con lector de pantalla.',
      ];
      return textResult(lines.join('\n'));
    },
  );

  return server;
}

try {
  if (!existsSync(CONFIG_FILE)) {
    mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify({ allowedHosts: [], userAgent: 'dsh-plugin-a11y-checker/0.1' }, null, 2) + '\n', 'utf8');
  }
} catch { /* ignora */ }
log(`modo ${READ_ONLY ? 'read-only' : 'normal'} · config: ${CONFIG_FILE}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
