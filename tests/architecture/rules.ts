import { ImportRef, Layer, SourceFile } from './dependencyScanner';

// Cada regra recebe a lista de arquivos e devolve as violações em texto
// ("arquivo -> o que ele importou"). Lista vazia = regra respeitada.

export type Rule = (files: SourceFile[]) => string[];

/** Pacotes que a camada de aplicação pode usar. Qualquer outro é framework/infra e fica de fora. */
export const APPLICATION_ALLOWED_PACKAGES = ['zod', 'node:crypto'];

/** Drivers/SDKs de banco: só a infraestrutura pode conhecer. */
export const DATABASE_PACKAGES = ['mongodb', 'mongoose', 'mongodb-memory-server'];

/** Framework web e companhia: só a camada de API pode conhecer. */
export const WEB_PACKAGES = ['express', 'cors', 'helmet', 'swagger-ui-express', 'pino-http', 'supertest'];

const describeViolation = (file: SourceFile, ref: ImportRef) => `src/${file.path} -> ${ref.specifier}`;

function forbidLayers(files: SourceFile[], from: Layer, forbidden: Layer[]): string[] {
  return files
    .filter((file) => file.layer === from)
    .flatMap((file) =>
      file.imports
        // import relativo sem camada = saiu de src/, o que também não pode
        .filter((ref) => ref.kind === 'relative' && (ref.layer === undefined || forbidden.includes(ref.layer)))
        .map((ref) => describeViolation(file, ref)),
    );
}

function forbidPackages(files: SourceFile[], inLayer: (layer: Layer) => boolean, isForbidden: (name: string) => boolean): string[] {
  return files
    .filter((file) => inLayer(file.layer))
    .flatMap((file) =>
      file.imports
        .filter((ref) => ref.kind === 'package' && isForbidden(ref.packageName ?? ref.specifier))
        .map((ref) => describeViolation(file, ref)),
    );
}

/** Domain só enxerga o próprio domínio. */
export const domainDependsOnNothing: Rule = (files) =>
  forbidLayers(files, 'domain', ['application', 'infrastructure', 'api', 'root']);

/** Domain é TypeScript puro: nenhum pacote, nem os módulos nativos do Node. */
export const domainUsesNoPackages: Rule = (files) =>
  forbidPackages(files, (layer) => layer === 'domain', () => true);

/** Application conhece o domínio e as próprias portas, nunca quem as implementa. */
export const applicationDoesNotDependOnOuterLayers: Rule = (files) =>
  forbidLayers(files, 'application', ['infrastructure', 'api', 'root']);

export const applicationUsesOnlyAllowedPackages: Rule = (files) =>
  forbidPackages(
    files,
    (layer) => layer === 'application',
    (name) => !APPLICATION_ALLOWED_PACKAGES.includes(name),
  );

export const infrastructureDoesNotDependOnApi: Rule = (files) => forbidLayers(files, 'infrastructure', ['api', 'root']);

/** A API recebe os handlers prontos; quem liga com a infraestrutura é o main.ts. */
export const apiDoesNotDependOnInfrastructure: Rule = (files) => forbidLayers(files, 'api', ['infrastructure', 'root']);

export const databaseDriverOnlyInInfrastructure: Rule = (files) =>
  forbidPackages(
    files,
    (layer) => layer !== 'infrastructure',
    (name) => DATABASE_PACKAGES.includes(name),
  );

export const webFrameworkOnlyInApi: Rule = (files) =>
  forbidPackages(
    files,
    (layer) => layer !== 'api',
    (name) => WEB_PACKAGES.includes(name),
  );

/** Vertical slice: uma feature não importa código de outra feature (em nenhuma camada). */
export const featuresDoNotImportEachOther: Rule = (files) =>
  files
    .filter((file) => file.feature !== undefined)
    .flatMap((file) =>
      file.imports
        .filter((ref) => ref.feature !== undefined && ref.feature !== file.feature)
        .map((ref) => describeViolation(file, ref)),
    );

/** Só o main.ts (composition root) fica fora das quatro camadas. */
export const onlyMainLivesOutsideTheLayers: Rule = (files) =>
  files.filter((file) => file.layer === 'root' && file.path !== 'main.ts').map((file) => `src/${file.path}`);

/** As portas são contratos: interfaces e tipos, sem implementação. */
export const portsHaveNoImplementation: Rule = (files) =>
  files
    .filter((file) => file.path.startsWith('application/ports/'))
    .filter((file) => /\bclass\s+\w+/.test(file.code) || /\bfunction\s+\w+/.test(file.code))
    .map((file) => `src/${file.path}`);

export function applicationFeatures(files: SourceFile[]): string[] {
  const names = files.filter((file) => file.layer === 'application' && file.feature).map((file) => file.feature!);
  return [...new Set(names)].sort();
}

export function apiFeatures(files: SourceFile[]): string[] {
  const names = files.filter((file) => file.layer === 'api' && file.feature).map((file) => file.feature!);
  return [...new Set(names)].sort();
}

/** Toda feature da aplicação tem o seu adaptador HTTP: api/features/<F>/<F>Endpoint.ts (e vice-versa). */
export const everyFeatureHasItsEndpoint: Rule = (files) => {
  const paths = new Set(files.map((file) => file.path));
  const missingEndpoints = applicationFeatures(files)
    .map((feature) => `api/features/${feature}/${feature}Endpoint.ts`)
    .filter((expected) => !paths.has(expected))
    .map((expected) => `falta src/${expected}`);
  const orphanEndpoints = apiFeatures(files)
    .map((feature) => `application/features/${feature}/${feature}.ts`)
    .filter((expected) => !paths.has(expected))
    .map((expected) => `falta src/${expected}`);
  return [...missingEndpoints, ...orphanEndpoints];
};

/** Cada application/features/<F>/<F>.ts exporta a classe <F>Handler. */
export const everyFeatureExportsItsHandler: Rule = (files) =>
  applicationFeatures(files).flatMap((feature) => {
    const expectedPath = `application/features/${feature}/${feature}.ts`;
    const file = files.find((candidate) => candidate.path === expectedPath);
    if (!file) return [`falta src/${expectedPath}`];
    return new RegExp(`\\bexport\\s+class\\s+${feature}Handler\\b`).test(file.code)
      ? []
      : [`src/${expectedPath} não exporta a classe ${feature}Handler`];
  });

/** Cada endpoint importa o handler da própria feature e exporta a função map<F>. */
export const everyEndpointMapsItsOwnHandler: Rule = (files) =>
  apiFeatures(files).flatMap((feature) => {
    const expectedPath = `api/features/${feature}/${feature}Endpoint.ts`;
    const file = files.find((candidate) => candidate.path === expectedPath);
    if (!file) return [`falta src/${expectedPath}`];
    const problems: string[] = [];
    if (!new RegExp(`\\bexport\\s+function\\s+map${feature}\\b`).test(file.code)) {
      problems.push(`src/${expectedPath} não exporta a função map${feature}`);
    }
    if (!file.imports.some((ref) => ref.target === `application/features/${feature}/${feature}`)) {
      problems.push(`src/${expectedPath} não importa o handler de application/features/${feature}`);
    }
    return problems;
  });
