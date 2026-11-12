import { readFileSync, readdirSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';

// Scanner de dependências "caseiro": lê os .ts de src/, extrai os imports com regex e
// classifica cada arquivo por camada e por feature. Os testes de arquitetura são só
// regras em cima dessa lista. Não usamos biblioteca pronta para a regra ficar à vista.

export type Layer = 'domain' | 'application' | 'infrastructure' | 'api' | 'root';

export interface ImportRef {
  /** Texto exatamente como aparece no import. */
  specifier: string;
  kind: 'relative' | 'package';
  /** Imports relativos: caminho do alvo a partir de src/ (sem extensão). */
  target?: string;
  /** Imports relativos: camada do alvo. undefined se apontar para fora de src/. */
  layer?: Layer;
  /** Imports relativos: feature do alvo, se ele estiver dentro de uma pasta features/<X>/. */
  feature?: string;
  /** Imports de pacote: nome normalizado ("zod", "@scope/pkg", "node:crypto"). */
  packageName?: string;
}

export interface SourceFile {
  /** Caminho a partir de src/, sempre com "/". Ex.: "application/features/GetProduct/GetProduct.ts" */
  path: string;
  layer: Layer;
  feature?: string;
  imports: ImportRef[];
  code: string;
}

const LAYERS: readonly Layer[] = ['domain', 'application', 'infrastructure', 'api'];

export function layerOf(relativePath: string): Layer {
  const first = relativePath.split('/')[0] ?? '';
  return (LAYERS as readonly string[]).includes(first) && relativePath.includes('/') ? (first as Layer) : 'root';
}

export function featureOf(relativePath: string): string | undefined {
  return /(?:^|\/)features\/([^/]+)\//.exec(relativePath)?.[1];
}

function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // o [^:] evita comer o "//" de URLs dentro de strings (https://...)
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, // import x from '...'
  /\bexport\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g, // export { x } from '...'
  /\bimport\s*['"]([^'"]+)['"]/g, // import '...'
  /\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require('...') e import('...')
];

/** Devolve os módulos importados por um trecho de código (sem repetição). */
export function extractImportSpecifiers(code: string): string[] {
  const clean = stripComments(code);
  const found = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of clean.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }
  return [...found];
}

function packageNameOf(specifier: string): string {
  if (specifier.startsWith('node:')) return specifier;
  if (isBuiltin(specifier)) return `node:${specifier}`;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

function resolveImport(fromFile: string, specifier: string): ImportRef {
  if (!specifier.startsWith('.')) {
    return { specifier, kind: 'package', packageName: packageNameOf(specifier) };
  }

  const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  if (target.startsWith('..')) {
    // saiu de src/ (ex.: importou algo de tests/): fica sem camada e as regras acusam
    return { specifier, kind: 'relative', target };
  }
  // Sem "/" o alvo é um arquivo da raiz de src ("./main") ou a pasta inteira de uma camada ("./domain").
  const isLayerFolder = (LAYERS as readonly string[]).includes(target);
  const asFile = target.includes('/') ? target : isLayerFolder ? `${target}/index.ts` : `${target}.ts`;
  return { specifier, kind: 'relative', target, layer: layerOf(asFile), feature: featureOf(`${target}.ts`) };
}

/** Analisa um arquivo a partir do conteúdo (os testes usam isto para "plantar" violações de mentira). */
export function analyzeSource(relativePath: string, code: string): SourceFile {
  const normalized = relativePath.split(path.sep).join('/');
  return {
    path: normalized,
    layer: layerOf(normalized),
    feature: featureOf(normalized),
    imports: extractImportSpecifiers(code).map((specifier) => resolveImport(normalized, specifier)),
    code,
  };
}

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

/** Lê todos os .ts de uma pasta src/ e devolve a lista já classificada. */
export function scanSourceTree(srcDir: string): SourceFile[] {
  return listTypeScriptFiles(srcDir)
    .map((file) => analyzeSource(path.relative(srcDir, file), readFileSync(file, 'utf8')))
    .sort((a, b) => a.path.localeCompare(b.path));
}
