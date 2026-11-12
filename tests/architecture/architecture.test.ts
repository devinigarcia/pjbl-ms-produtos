import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeSource, extractImportSpecifiers, scanSourceTree } from './dependencyScanner';
import {
  apiDoesNotDependOnInfrastructure,
  apiFeatures,
  applicationDoesNotDependOnOuterLayers,
  applicationFeatures,
  applicationUsesOnlyAllowedPackages,
  databaseDriverOnlyInInfrastructure,
  domainDependsOnNothing,
  domainUsesNoPackages,
  everyEndpointMapsItsOwnHandler,
  everyFeatureExportsItsHandler,
  everyFeatureHasItsEndpoint,
  featuresDoNotImportEachOther,
  infrastructureDoesNotDependOnApi,
  onlyMainLivesOutsideTheLayers,
  portsHaveNoImplementation,
  webFrameworkOnlyInApi,
} from './rules';

// Testes de arquitetura: garantem que a Clean Architecture e os vertical slices descritos
// no README continuam valendo no código. Se alguém importar o driver do Mongo no domínio,
// por exemplo, é aqui que o build quebra.

const files = scanSourceTree(path.resolve(__dirname, '../../src'));

const EXPECTED_FEATURES = [
  'CreateProduct',
  'DeleteProduct',
  'GetProduct',
  'ListProducts',
  'ListStockMovements',
  'RegisterStockMovement',
  'UpdateProduct',
];

describe('arquitetura: o scanner enxerga o projeto', () => {
  it('encontra arquivos nas quatro camadas e o main.ts na raiz', () => {
    const layers = new Set(files.map((file) => file.layer));

    expect([...layers].sort()).toEqual(['api', 'application', 'domain', 'infrastructure', 'root']);
    expect(files.length).toBeGreaterThanOrEqual(30);
    expect(files.find((file) => file.path === 'main.ts')?.imports.length).toBeGreaterThan(5);
  });

  it('extrai todos os formatos de import e ignora o que está em comentário', () => {
    const code = `
      import express, { Router } from 'express';
      import type { Db } from "mongodb";
      import {
        a,
        b,
      } from '../domain/Product';
      import './efeito-colateral';
      export { x } from './reexport';
      export * from './tudo';
      const lazy = await import('./dinamico');
      const legacy = require('node:fs');
      // import { fake } from 'comentado';
      /* import other from 'bloco-comentado'; */
      const url = 'https://exemplo.com/from';
    `;

    expect(extractImportSpecifiers(code).sort()).toEqual(
      ['express', 'mongodb', '../domain/Product', './efeito-colateral', './reexport', './tudo', './dinamico', 'node:fs'].sort(),
    );
  });

  it('classifica camada, feature e pacote de cada import', () => {
    const file = analyzeSource(
      'api/features/GetProduct/GetProductEndpoint.ts',
      `import { Router } from 'express';
       import { GetProductHandler } from '../../../application/features/GetProduct/GetProduct';
       import { x } from '@scope/pkg/sub';
       import { readFileSync } from 'fs';`,
    );

    expect(file).toMatchObject({ layer: 'api', feature: 'GetProduct' });
    expect(file.imports).toEqual([
      { specifier: 'express', kind: 'package', packageName: 'express' },
      {
        specifier: '../../../application/features/GetProduct/GetProduct',
        kind: 'relative',
        target: 'application/features/GetProduct/GetProduct',
        layer: 'application',
        feature: 'GetProduct',
      },
      { specifier: '@scope/pkg/sub', kind: 'package', packageName: '@scope/pkg' },
      { specifier: 'fs', kind: 'package', packageName: 'node:fs' },
    ]);
  });
});

describe('arquitetura: Clean Architecture (dependências apontam para dentro)', () => {
  it('Domain não depende de nenhuma outra camada', () => {
    expect(domainDependsOnNothing(files)).toEqual([]);
  });

  it('Domain é TypeScript puro: não usa nenhum pacote externo nem módulo do Node', () => {
    expect(domainUsesNoPackages(files)).toEqual([]);
  });

  it('Application não depende de Infrastructure nem de API', () => {
    expect(applicationDoesNotDependOnOuterLayers(files)).toEqual([]);
  });

  it('Application não usa frameworks: só zod e node:crypto são permitidos', () => {
    expect(applicationUsesOnlyAllowedPackages(files)).toEqual([]);
  });

  it('Infrastructure não depende de API', () => {
    expect(infrastructureDoesNotDependOnApi(files)).toEqual([]);
  });

  it('API não importa Infrastructure (a ligação é feita só no main.ts)', () => {
    expect(apiDoesNotDependOnInfrastructure(files)).toEqual([]);
  });

  it('o driver do MongoDB só aparece na Infrastructure', () => {
    expect(databaseDriverOnlyInInfrastructure(files)).toEqual([]);
  });

  it('Express e os middlewares web só aparecem na API', () => {
    expect(webFrameworkOnlyInApi(files)).toEqual([]);
  });

  it('main.ts é o único arquivo fora das camadas e é ele quem junta Infrastructure e API', () => {
    expect(onlyMainLivesOutsideTheLayers(files)).toEqual([]);

    const main = files.find((file) => file.path === 'main.ts');
    const layersUsedByMain = new Set(main?.imports.map((ref) => ref.layer));
    expect(layersUsedByMain.has('infrastructure')).toBe(true);
    expect(layersUsedByMain.has('api')).toBe(true);
  });

  it('as portas (application/ports) são só interfaces e tipos', () => {
    expect(portsHaveNoImplementation(files)).toEqual([]);
  });
});

describe('arquitetura: Vertical Slice (uma pasta por feature)', () => {
  it('as features são exatamente as 7 do serviço, nas duas camadas', () => {
    expect(applicationFeatures(files)).toEqual(EXPECTED_FEATURES);
    expect(apiFeatures(files)).toEqual(EXPECTED_FEATURES);
  });

  it('uma feature não importa outra feature', () => {
    expect(featuresDoNotImportEachOther(files)).toEqual([]);
  });

  it('toda feature da Application tem o endpoint api/features/<F>/<F>Endpoint.ts', () => {
    expect(everyFeatureHasItsEndpoint(files)).toEqual([]);
  });

  it('cada <F>.ts exporta a classe <F>Handler', () => {
    expect(everyFeatureExportsItsHandler(files)).toEqual([]);
  });

  it('cada endpoint exporta map<F> e usa o handler da própria feature', () => {
    expect(everyEndpointMapsItsOwnHandler(files)).toEqual([]);
  });
});

// Um teste de arquitetura que nunca falha não prova nada. Aqui "plantamos" violações em
// arquivos de mentira (que só existem aqui, em memória) e conferimos que cada regra acusa o problema.
describe('arquitetura: as regras pegam violações plantadas', () => {
  const withFake = (fakePath: string, code: string) => [analyzeSource(fakePath, code)];

  it('driver do Mongo ou módulo do Node dentro do Domain', () => {
    const planted = withFake('domain/Fake.ts', `import { MongoClient } from 'mongodb';\nimport { randomUUID } from 'node:crypto';`);

    expect(domainUsesNoPackages(planted)).toEqual(['src/domain/Fake.ts -> mongodb', 'src/domain/Fake.ts -> node:crypto']);
    expect(databaseDriverOnlyInInfrastructure(planted)).toEqual(['src/domain/Fake.ts -> mongodb']);
  });

  it('Domain importando a Application', () => {
    const planted = withFake('domain/Fake.ts', `import { validate } from '../application/validation';`);
    expect(domainDependsOnNothing(planted)).toEqual(['src/domain/Fake.ts -> ../application/validation']);
  });

  it('Application importando Infrastructure, API ou um framework', () => {
    const planted = withFake(
      'application/features/Fake/Fake.ts',
      `import { MongoProductRepository } from '../../../infrastructure/mongo/MongoProductRepository';
       import { createApp } from '../../../api/app';
       import express from 'express';
       import { z } from 'zod';`,
    );

    expect(applicationDoesNotDependOnOuterLayers(planted)).toEqual([
      'src/application/features/Fake/Fake.ts -> ../../../infrastructure/mongo/MongoProductRepository',
      'src/application/features/Fake/Fake.ts -> ../../../api/app',
    ]);
    expect(applicationUsesOnlyAllowedPackages(planted)).toEqual(['src/application/features/Fake/Fake.ts -> express']);
    expect(webFrameworkOnlyInApi(planted)).toEqual(['src/application/features/Fake/Fake.ts -> express']);
  });

  it('Infrastructure importando a API e API importando a Infrastructure', () => {
    const infra = withFake('infrastructure/Fake.ts', `import { createApp } from '../api/app';`);
    const api = withFake('api/Fake.ts', `import { connectMongo } from '../infrastructure/mongo/mongoConnection';`);

    expect(infrastructureDoesNotDependOnApi(infra)).toEqual(['src/infrastructure/Fake.ts -> ../api/app']);
    expect(apiDoesNotDependOnInfrastructure(api)).toEqual(['src/api/Fake.ts -> ../infrastructure/mongo/mongoConnection']);
  });

  it('uma feature importando outra', () => {
    const planted = withFake(
      'application/features/GetProduct/Atalho.ts',
      `import { CreateProductHandler } from '../CreateProduct/CreateProduct';`,
    );
    expect(featuresDoNotImportEachOther(planted)).toEqual([
      'src/application/features/GetProduct/Atalho.ts -> ../CreateProduct/CreateProduct',
    ]);
  });

  it('feature sem endpoint, sem a classe Handler ou arquivo solto fora das camadas', () => {
    const planted = withFake('application/features/ArchiveProduct/ArchiveProduct.ts', `export class Archiver {}`);
    const loose = withFake('helpers.ts', `export const x = 1;`);

    expect(everyFeatureHasItsEndpoint(planted)).toEqual(['falta src/api/features/ArchiveProduct/ArchiveProductEndpoint.ts']);
    expect(everyFeatureExportsItsHandler(planted)).toEqual([
      'src/application/features/ArchiveProduct/ArchiveProduct.ts não exporta a classe ArchiveProductHandler',
    ]);
    expect(onlyMainLivesOutsideTheLayers(loose)).toEqual(['src/helpers.ts']);
  });
});
