import { parse as parseJs } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { parseDocument } from 'htmlparser2';
import type { Signal, SignalKind } from './types.js';

function dotted(node: any): string {
  if (!node) return '';
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'ThisExpression') return 'this';
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const property = node.computed ? (node.property.type === 'StringLiteral' ? node.property.value : '') : dotted(node.property);
    return property ? `${dotted(node.object)}.${property}` : '';
  }
  return '';
}

function literal(node: any): string | undefined {
  return node?.type === 'StringLiteral' ? node.value : node?.type === 'TemplateLiteral' && node.expressions.length === 0
    ? node.quasis[0]?.value.cooked : undefined;
}

function add(signals: Signal[], kind: SignalKind, file: string, line: number | undefined, detail: string): void {
  if (!signals.some(x => x.kind === kind && x.evidence.file === file && x.evidence.line === line && x.evidence.detail === detail)) {
    signals.push({ kind, evidence: { file, ...(line ? { line } : {}), detail } });
  }
}

export function scanJavaScript(source: string, file: string, startLine = 1): Signal[] {
  const signals: Signal[] = [];
  const ast = parseJs(source, { sourceType: 'unambiguous', plugins: ['jsx'], allowReturnOutsideFunction: true, errorRecovery: false });
  const line = (node: any) => node.loc?.start.line ? node.loc.start.line + startLine - 1 : undefined;
  const network = new Set(['fetch', 'window.fetch', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'window.navigator.sendBeacon']);
  const domReads = new Set(['document.cookie', 'document.body.innerText', 'document.body.textContent', 'document.body.innerHTML', 'document.documentElement.innerText', 'document.documentElement.textContent', 'document.documentElement.innerHTML']);
  const domWrites = new Set(['document.write', 'document.writeln', 'document.body.appendChild', 'document.body.removeChild', 'document.documentElement.appendChild']);
  const traverse = (traverseModule as any).default ?? traverseModule;
  traverse(ast, {
    CallExpression(path: any) {
      const node = path.node;
      const name = dotted(node.callee);
      if (network.has(name) || name.endsWith('.sendBeacon')) add(signals, 'network', file, line(node), `${name} request`);
      if (/^(browser|chrome)\.(cookies|tabs|history|webRequest|downloads)\./.test(name)) {
        add(signals, 'sensitive-api', file, line(node), `${name} API call`);
      }
      if (name === 'eval' || name === 'window.eval' || ((name === 'setTimeout' || name === 'setInterval') && literal(node.arguments[0]) !== undefined)) {
        add(signals, 'dynamic-code', file, line(node), `${name} can execute code dynamically`);
      }
      if (domWrites.has(name) || /\.(appendChild|removeChild|insertAdjacentHTML|replaceChildren)$/.test(name)) {
        add(signals, 'dom-write', file, line(node), `${name} changes page content`);
      }
      if (/^(document|window\.document)\.(querySelector|querySelectorAll|getElementById|getElementsBy)/.test(name)) {
        add(signals, 'dom-read', file, line(node), `${name} selects page elements`);
      }
    },
    NewExpression(path: any) {
      const name = dotted(path.node.callee);
      if (name === 'Function') add(signals, 'dynamic-code', file, line(path.node), 'Function constructor can execute code dynamically');
      if (name === 'XMLHttpRequest' || name === 'WebSocket') add(signals, 'network', file, line(path.node), `${name} network object`);
    },
    MemberExpression(path: any) {
      const name = dotted(path.node);
      if (domReads.has(name) || name.endsWith('.innerText') || name.endsWith('.textContent')) {
        if (!path.parentPath.isAssignmentExpression({ left: path.node })) add(signals, 'dom-read', file, line(path.node), `${name} reads page content`);
      }
    },
    AssignmentExpression(path: any) {
      const name = dotted(path.node.left);
      if (name === 'document.cookie' || /\.(innerHTML|outerHTML|innerText|textContent)$/.test(name)) {
        add(signals, 'dom-write', file, line(path.node), `${name} changes page content`);
      }
    },
    StringLiteral(path: any) {
      const value = path.node.value;
      if (/^https?:\/\/[^\s]+$/i.test(value)) add(signals, 'external-url', file, line(path.node), `Literal URL: ${value.slice(0, 200)}`);
    },
    TemplateLiteral(path: any) {
      const value = literal(path.node);
      if (value && /^https?:\/\/[^\s]+$/i.test(value)) add(signals, 'external-url', file, line(path.node), `Literal URL: ${value.slice(0, 200)}`);
    }
  });
  return signals;
}

export function scanHtml(source: string, file: string): { signals: Signal[]; limitations: string[] } {
  const signals: Signal[] = [];
  const limitations: string[] = [];
  const document = parseDocument(source, { withStartIndices: true });
  const lineAt = (index: number | null | undefined): number | undefined => index === null || index === undefined ? undefined : source.slice(0, index).split('\n').length;
  function walk(node: any): void {
    for (const [name, value] of Object.entries(node.attribs ?? {})) {
      if (['href', 'src', 'action'].includes(name) && typeof value === 'string' && /^https?:\/\/[^\s]+$/i.test(value)) {
        add(signals, 'external-url', file, lineAt(node.startIndex), `HTML ${name}: ${value.slice(0, 200)}`);
      }
    }
    const scriptType = String(node.attribs?.type ?? '').toLowerCase().trim();
    if (node.name === 'script' && (!scriptType || scriptType === 'module' || /^(application|text)\/(javascript|ecmascript)$/.test(scriptType))) {
      const code = (node.children ?? []).filter((x: any) => x.type === 'text').map((x: any) => x.data ?? '').join('');
      if (code.trim()) {
        const first = node.children?.find((x: any) => x.type === 'text');
        const startLine = lineAt(first?.startIndex) ?? lineAt(node.startIndex) ?? 1;
        try { signals.push(...scanJavaScript(code, file, startLine)); }
        catch (error) { limitations.push(`Could not parse inline script in ${file} near line ${startLine}: ${error instanceof Error ? error.message : String(error)}`); }
      }
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(document);
  return { signals, limitations };
}
