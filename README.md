# pjbl-ms-produtos

Microserviço de **Produtos e Estoque** da **Conecta Store**, o sistema que montamos para o PJBL de Arquitetura.
É o "Microserviço 1" do enunciado: tem um domínio só (produtos), guarda os dados no **MongoDB Atlas**, expõe um
CRUD completo e é documentado com Swagger.

Além do CRUD ele controla o estoque por **movimentações** (entradas e saídas). É por aqui que a parte orientada
a eventos do projeto termina: quando um pedido é criado ou cancelado no `ms-pedidos`, uma Azure Function consome o
evento e chama este serviço para baixar ou devolver o estoque.

- Swagger na nuvem: {{URL_MS_PRODUTOS}}/docs
- Imagem: `{{DOCKERHUB_USER}}/pjbl-ms-produtos:v1`

## Sumário

1. [Onde o serviço fica na arquitetura](#onde-o-serviço-fica-na-arquitetura)
2. [Tecnologias](#tecnologias)
3. [Arquitetura do código](#arquitetura-do-código)
4. [Endpoints](#endpoints)
5. [Movimentação de estoque: atômica e idempotente](#movimentação-de-estoque-atômica-e-idempotente)
6. [Variáveis de ambiente](#variáveis-de-ambiente)
7. [Como rodar localmente](#como-rodar-localmente)
8. [Testes](#testes)
9. [Docker](#docker)
10. [Links da nuvem](#links-da-nuvem)
11. [Alunos](#alunos)

## Onde o serviço fica na arquitetura

O front nunca fala direto com os microserviços. Toda chamada entra pelo API Gateway, passa pelo BFF e só então
chega aqui. O caminho pontilhado é o fluxo de eventos.

```mermaid
flowchart LR
    U([Usuário]) --> MFE[Microfrontend<br/>React]
    MFE --> GW[API Gateway<br/>Azure API Management]
    GW --> BFF[BFF<br/>Node + Express]

    BFF --> MSP[ms-produtos<br/><b>este repositório</b>]
    BFF --> MSO[ms-pedidos]
    BFF --> FI[Azure Function<br/>indicadores - HTTP]

    MSP --> MONGO[(MongoDB Atlas)]
    MSO --> SQL[(Azure SQL)]

    MSO -. order.created / order.cancelled .-> Q[[Fila order-events]]
    Q -.-> FE[Azure Function<br/>processOrderEvent - fila]
    FE -. POST /products/:id/stock-movements .-> MSP
```

Quem chama o ms-produtos:

| Quem | Para quê |
|---|---|
| **BFF** | Repassa o CRUD de produtos que o front pede, monta o `GET /aggregated-data` (lista de produtos) e, na hora de criar um pedido, busca os produtos por `ids` para usar o nome e o preço oficiais e conferir o estoque. |
| **Azure Function `processOrderEvent`** | Consome a fila `order-events`. Para cada item do pedido chama `POST /products/{id}/stock-movements`: `order.created` vira uma SAIDA e `order.cancelled` vira uma ENTRADA (devolução). |

Na nuvem os dois se identificam com o cabeçalho `x-api-key` (variável `INTERNAL_API_KEY`).

Os contratos entre os serviços (campos, rotas, códigos de erro) ficam no repositório
[`pjbl-arquitetura`](https://github.com/devinigarcia/pjbl-arquitetura), em `docs/contratos.md`.

## Tecnologias

| Para quê | O que usamos |
|---|---|
| Linguagem e runtime | TypeScript 5.9, Node.js 22 (LTS) |
| HTTP | Express 5 |
| Banco | MongoDB (Atlas M0 na nuvem), driver oficial `mongodb` 6 |
| Validação de entrada | zod 3 |
| Documentação | OpenAPI 3 escrito à mão + `swagger-ui-express` |
| Logs | pino + pino-http (JSON, com `correlationId`) |
| Segurança | helmet, cors, chave interna em `x-api-key` |
| Testes | Vitest, supertest e `mongodb-memory-server` (sobe um MongoDB de verdade nos testes) |
| Entrega | Docker (multi-stage) + GitHub Actions publicando no Docker Hub |

## Arquitetura do código

O serviço segue **Clean Architecture** (quatro camadas) e, dentro das camadas de aplicação e de API, é organizado
em **Vertical Slices**: uma pasta para cada feature.

```
            +--------------------------------------------------+
            |  api            Express, middlewares, Swagger    |
            |   +------------------------------------------+   |
            |   |  application   casos de uso + portas     |   |
            |   |   +----------------------------------+   |   |
            |   |   |  domain   Product, StockMovement |   |   |
            |   |   +----------------------------------+   |   |
            |   +------------------------------------------+   |
            +--------------------------------------------------+
               infrastructure   MongoDB, repositório em memória, config
               (implementa as portas da application)

               main.ts   escolhe as implementações e liga tudo
```

A regra é que as dependências sempre apontam para dentro:

- **domain**: entidades, regras e erros. TypeScript puro, não importa nenhum pacote (nem do Node).
- **application**: um caso de uso por feature, mais as **portas** (interfaces dos repositórios). Só pode usar
  `zod` e `node:crypto`. Não sabe o que é Express nem MongoDB.
- **infrastructure**: implementações das portas (MongoDB e memória), configuração e logger. É o único lugar onde
  o driver do Mongo aparece.
- **api**: adaptadores HTTP. Cada endpoint é fino: pega o que veio na requisição, chama o handler e devolve a
  resposta. A API não importa a infraestrutura.
- **main.ts**: o *composition root*. É o único arquivo que conhece infraestrutura e API ao mesmo tempo.

Essas regras não ficam só no README: os [testes de arquitetura](#testes-de-arquitetura) quebram o build se
alguém desrespeitar.

### Estrutura de pastas

```
src/
  domain/
    Product.ts                 entidade Produto (validações, lowStock, aplicar movimentação)
    StockMovement.ts           movimentação de estoque (ENTRADA | SAIDA)
    errors.ts                  ValidationError, NotFoundError, ConflictError, DomainError...
  application/
    ports/
      ProductRepository.ts           interface do repositório de produtos
      StockMovementRepository.ts     interface do repositório de movimentações
    features/
      CreateProduct/CreateProduct.ts                   schema zod + class CreateProductHandler
      ListProducts/ListProducts.ts
      GetProduct/GetProduct.ts
      UpdateProduct/UpdateProduct.ts
      DeleteProduct/DeleteProduct.ts
      RegisterStockMovement/RegisterStockMovement.ts
      ListStockMovements/ListStockMovements.ts
    validation.ts              validate(schema, input) -> ValidationError com [{ field, message }]
    productFields.ts           campos zod compartilhados por CreateProduct e UpdateProduct
    dtos.ts                    formato JSON devolvido pela API
    handlers.ts                monta os 7 handlers em cima das portas
  infrastructure/
    mongo/                     conexão, índices e os dois repositórios MongoDB
    memory/                    repositórios em memória (testes e demonstração local)
    config.ts                  leitura das variáveis de ambiente
    logger.ts                  pino
  api/
    features/
      CreateProduct/CreateProductEndpoint.ts           mapCreateProduct(router, handler)
      ...                                              (um endpoint para cada feature)
    middlewares/               correlationId, apiKey, errorHandler
    openapi.ts                 documento OpenAPI 3
    app.ts                     createApp(deps)
  main.ts
tests/
  unit/            domínio, casos de uso, config e repositório em memória
  integration/
    api/           HTTP com supertest (Express de verdade + repositório em memória)
    mongo/         MongoDB real (mongodb-memory-server), incluindo concorrência
  architecture/    dependencyScanner.ts + rules.ts + architecture.test.ts
  support/         utilitários dos testes
```

Cada feature é uma "fatia" que atravessa as camadas: `application/features/CreateProduct/CreateProduct.ts` tem
a regra do caso de uso e `api/features/CreateProduct/CreateProductEndpoint.ts` tem a rota. Uma feature nunca
importa outra; o que é comum (DTOs, validação, campos do produto) fica fora das pastas de feature.

### Regras de negócio

- `sku` é único, sempre em maiúsculas, de 3 a 30 caracteres (letras, números e hífen).
- `name` tem de 2 a 120 caracteres; `price` é maior que zero e fica com 2 casas decimais.
- `stock` é inteiro e nunca negativo. `lowStock` vem `true` quando o saldo é menor ou igual a 5.
- **O estoque só muda por movimentação.** O `PUT` não altera o saldo (se mandar `stock`, é ignorado) e o
  estoque informado no cadastro vira uma movimentação de ENTRADA com o motivo "Estoque inicial". Assim o
  histórico sempre fecha com o saldo.
- Excluir um produto apaga também o histórico dele.

## Endpoints

| Método e rota | O que faz | Respostas |
|---|---|---|
| `POST /products` | Cadastra um produto. Corpo: `{ sku, name, description?, category, price, stock? }` | 201 + `Location`; 400; 409 `SKU_ALREADY_EXISTS` |
| `GET /products` | Lista com `?search&category&ids=a,b&page=1&pageSize=20` (máx. 100) | 200 `{ items, total, page, pageSize }`; 400 |
| `GET /products/:id` | Busca um produto | 200; 404 `PRODUCT_NOT_FOUND` |
| `PUT /products/:id` | Atualiza `{ sku?, name, description?, category, price }` (não mexe em estoque) | 200; 400; 404; 409 `SKU_ALREADY_EXISTS` |
| `DELETE /products/:id` | Exclui o produto e as movimentações | 204; 404 |
| `POST /products/:id/stock-movements` | Registra `{ type: "ENTRADA" \| "SAIDA", quantity, reason?, eventId? }` | 201 `{ movement, product, duplicate: false }`; 200 com `duplicate: true` se o `eventId` já foi aplicado; 400; 404; 409 `INSUFFICIENT_STOCK` |
| `GET /products/:id/stock-movements` | Histórico, mais recentes primeiro. `?limit=50` (máx. 200) | 200 `{ items, total }`; 404 |
| `GET /health` | Saúde do serviço (sem chave) | 200 `{ status, service, database, uptime, timestamp }` |
| `GET /docs` | Swagger UI (sem chave) | |
| `GET /openapi.json` | Especificação OpenAPI 3 (sem chave) | |
| `GET /` | Redireciona para `/docs` | 302 |

Produto:

```json
{
  "id": "3f2b1c9e-8a47-4d0b-9f65-2c1e7a9b4d10",
  "sku": "CAFE-500G",
  "name": "Café torrado 500g",
  "description": "Café torrado e moído, torra média.",
  "category": "Mercearia",
  "price": 24.9,
  "stock": 12,
  "lowStock": false,
  "createdAt": "2026-11-10T13:45:12.000Z",
  "updatedAt": "2026-11-10T13:45:12.000Z"
}
```

Todos os erros têm o mesmo formato. O `correlationId` é o mesmo do cabeçalho `x-correlation-id` (o serviço
reaproveita o que vier na requisição ou gera um UUID), então dá para achar a requisição nos logs de todos os serviços:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Dados inválidos.",
    "details": [{ "field": "price", "message": "Deve ser maior que zero." }],
    "correlationId": "0d6f4c1e-2b3a-4f5e-9c8d-7a6b5c4d3e2f"
  }
}
```

| Situação | HTTP | `code` |
|---|---|---|
| Corpo ou query inválidos | 400 | `VALIDATION_ERROR` (com `details`) |
| JSON malformado | 400 | `INVALID_JSON` |
| `x-api-key` ausente ou errada | 401 | `UNAUTHORIZED` |
| Produto não existe | 404 | `PRODUCT_NOT_FOUND` |
| Rota não existe | 404 | `ROUTE_NOT_FOUND` |
| SKU repetido | 409 | `SKU_ALREADY_EXISTS` |
| Saída maior que o saldo | 409 | `INSUFFICIENT_STOCK` |
| `eventId` já usado em outro produto | 409 | `EVENT_ID_ALREADY_USED` |
| Erro inesperado | 500 | `INTERNAL_ERROR` |

Os exemplos completos de cada rota estão no Swagger (`/docs`).

## Movimentação de estoque: atômica e idempotente

Essa é a parte mais delicada do serviço, por dois motivos.

**1. Duas baixas ao mesmo tempo não podem deixar o estoque negativo.** Se o código lesse o saldo, conferisse e
depois gravasse, duas requisições simultâneas poderiam ler o mesmo saldo e as duas "passarem". Por isso a baixa
é feita em uma única operação condicional no MongoDB:

```js
products.findOneAndUpdate(
  { _id: productId, stock: { $gte: quantity } },   // só casa se ainda houver saldo
  { $inc: { stock: -quantity } },
  { returnDocument: 'after' },
)
```

Se o filtro não casar, nada é alterado e a resposta é `409 INSUFFICIENT_STOCK`. Temos um teste que dispara 10
baixas de 1 unidade ao mesmo tempo em um produto com estoque 5: sempre 5 passam e 5 recebem 409.

**2. O mesmo evento não pode baixar o estoque duas vezes.** A fila entrega as mensagens "pelo menos uma vez",
então a Function pode reprocessar um evento. Ela sempre manda `eventId = "<id do evento>:<id do produto>"` e a
coleção `stock_movements` tem um **índice único parcial** em `eventId` (parcial para que as movimentações
manuais, sem `eventId`, não esbarrem umas nas outras). A sequência é:

1. insere a movimentação (se o `eventId` já existir, o índice recusa e respondemos `200` com `duplicate: true`
   e a movimentação original);
2. faz o `findOneAndUpdate` condicional acima;
3. se faltou saldo, apaga a movimentação do passo 1 e responde 409; se deu certo, grava o saldo (`balanceAfter`).

Fizemos assim, sem transação, para o mesmo código rodar tanto no Atlas quanto num `mongod` simples (como o dos
testes). O ponto fraco que conhecemos: se o processo cair exatamente entre os passos 1 e 2, a movimentação fica
gravada como pendente (sem saldo) e não aparece no histórico. Com um replica set daria para fechar essa janela
com uma transação.

Índices criados na subida do serviço:

| Coleção | Índice |
|---|---|
| `products` | `sku` (único), `category`, `name` |
| `stock_movements` | `productId + createdAt`, `eventId` (único parcial: `{ eventId: { $type: "string" } }`) |

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3001` | Porta HTTP. |
| `MONGODB_URI` | vazio | Connection string do MongoDB. Sem ela o serviço usa o repositório em memória. |
| `MONGODB_DB` | `pjbl_produtos` | Nome do banco. |
| `DB_DRIVER` | automático | `mongo` ou `memory`. Se não for definida: `mongo` quando há `MONGODB_URI`, senão `memory`. |
| `INTERNAL_API_KEY` | vazio | Se definida, as rotas de negócio exigem o cabeçalho `x-api-key` com esse valor. `/health`, `/docs` e `/openapi.json` continuam abertos. |
| `CORS_ORIGIN` | `*` | Origens liberadas, separadas por vírgula. |
| `LOG_LEVEL` | `info` | Nível de log do pino (`debug`, `info`, `warn`, `silent`...). |
| `PUBLIC_URL` | vazio | URL pública do serviço; aparece em "Servers" no Swagger. |

O arquivo [`.env.example`](.env.example) tem todas elas com valores fictícios. O `.env` de verdade está no
`.gitignore` e no `.dockerignore`: nenhuma senha ou connection string entra no repositório nem na imagem.

## Como rodar localmente

Pré-requisito: **Node.js 22 ou mais novo** (a imagem Docker e o CI usam o 22; nas nossas máquinas rodamos com o 24).

```bash
git clone https://github.com/devinigarcia/pjbl-ms-produtos.git
cd pjbl-ms-produtos
npm install
```

### Opção 1: sem banco nenhum (repositório em memória)

É o jeito mais rápido de ver funcionando. Sem `MONGODB_URI` o serviço guarda tudo em memória (os dados somem
quando ele é encerrado).

```bash
npm run dev
```

Abra http://localhost:3001/docs para usar o Swagger, ou teste pelo terminal:

```bash
curl http://localhost:3001/health

curl -X POST http://localhost:3001/products \
  -H "content-type: application/json" \
  -d '{"sku":"CAFE-500G","name":"Cafe torrado 500g","category":"Mercearia","price":24.9,"stock":12}'

curl "http://localhost:3001/products?search=cafe"
```

(No Windows, se for mandar acentos pelo `curl`, prefira o Swagger: o terminal nem sempre envia o corpo em UTF-8.)

### Opção 2: com o MongoDB Atlas

1. No Atlas, crie um cluster gratuito (M0), um usuário de banco e libere o seu IP em *Network Access*.
2. Copie o `.env.example` para `.env` e preencha a `MONGODB_URI` com a connection string do cluster.
3. Suba o serviço:

```bash
cp .env.example .env      # no PowerShell: Copy-Item .env.example .env
npm run dev
```

No log de subida e no `/health` deve aparecer `"database": "mongo"`. As coleções e os índices são criados
sozinhos na primeira execução. O mesmo vale para um MongoDB local (`MONGODB_URI=mongodb://localhost:27017`).

Para simular o comportamento da nuvem, defina também `INTERNAL_API_KEY` no `.env` e mande o cabeçalho
`x-api-key` nas chamadas (no Swagger, botão **Authorize**).

### Outros comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe com recarga automática (`tsx watch`). |
| `npm run build` | Compila para `dist/`. |
| `npm start` | Roda a versão compilada (`node dist/main.js`). |
| `npm run typecheck` | Checagem de tipos sem gerar arquivos. |

Para rodar o projeto inteiro (front, gateway, BFF, os dois microserviços e a Function), veja o repositório
[`pjbl-arquitetura`](https://github.com/devinigarcia/pjbl-arquitetura).

## Testes

```bash
npm test                  # tudo: unitários, HTTP, arquitetura e integração com MongoDB
npm run test:unit         # só domínio, casos de uso e repositório em memória
npm run test:arch         # só os testes de arquitetura
npm run test:integration  # HTTP (supertest) + MongoDB real
```

São 161 testes:

| Onde | O que cobre |
|---|---|
| `tests/unit/domain` | Regras do Produto e da Movimentação: SKU, preço, estoque baixo, saída maior que o saldo... |
| `tests/unit/application` | Os 7 casos de uso com repositório em memória: validação campo a campo, SKU repetido, idempotência por `eventId`, paginação e filtros. |
| `tests/unit/infrastructure` | Leitura da configuração e o "contrato" dos repositórios rodando contra a implementação em memória. |
| `tests/integration/api` | A API de verdade (Express + supertest): status, cabeçalhos, formato de erro, `x-api-key`, `x-correlation-id`, CORS, Swagger. |
| `tests/integration/mongo` | O mesmo contrato dos repositórios contra um **MongoDB real**, os índices, as 10 baixas concorrentes (5 sucessos e 5 conflitos) e o reprocessamento do mesmo `eventId`. |
| `tests/architecture` | As regras de Clean Architecture e Vertical Slice (abaixo). |

O "contrato dos repositórios" (`tests/support/repositoryContract.ts`) é uma bateria única que roda duas vezes,
uma contra o repositório em memória e outra contra o MongoDB. Foi o jeito que achamos de garantir que o
repositório falso usado nos testes rápidos se comporta igual ao de verdade.

Os testes de integração com MongoDB usam o `mongodb-memory-server`, que baixa um `mongod` na primeira execução
(pode levar alguns minutos, depois fica em cache). Em uma máquina sem internet dá para pular essa parte:

```bash
SKIP_MONGO_TESTS=1 npm test                     # Linux/macOS/Git Bash
$env:SKIP_MONGO_TESTS=1; npm test               # PowerShell
```

Se no Windows aparecer `spawn ENOENT` ao iniciar o `mongod`, normalmente é o caminho do projeto que ficou longo
demais. Mover o projeto para uma pasta curta (ex.: `C:\pjbl`) ou apontar `MONGOMS_SYSTEM_BINARY` para um
`mongod.exe` em um caminho curto resolve.

### Testes de arquitetura

Não usamos biblioteca pronta. O arquivo `tests/architecture/dependencyScanner.ts` lê todos os `.ts` de `src/`,
extrai os imports com expressão regular e classifica cada arquivo por camada (`domain`, `application`,
`infrastructure`, `api` ou raiz) e por feature (`features/<Nome>/`). As regras ficam em
`tests/architecture/rules.ts` e são conferidas em `architecture.test.ts`:

- Domain não depende de nenhuma outra camada e não usa nenhum pacote.
- Application não depende de Infrastructure nem de API, e só pode usar `zod` e `node:crypto`.
- Infrastructure não depende de API.
- API não importa Infrastructure (quem liga os dois é o `main.ts`).
- O driver do MongoDB só aparece na Infrastructure; Express e os middlewares web só aparecem na API.
- `main.ts` é o único arquivo fora das camadas.
- As portas (`application/ports`) são só interfaces e tipos.
- Uma feature não importa outra feature.
- Toda feature da Application tem o seu `api/features/<F>/<F>Endpoint.ts`.
- Cada `<F>.ts` exporta a classe `<F>Handler`, e cada endpoint exporta `map<F>` e usa o handler da própria feature.

**Como ver um teste de arquitetura falhar.** Coloque esta linha no topo de `src/domain/Product.ts` (o domínio
importando o driver do banco, que é exatamente o que a Clean Architecture proíbe):

```ts
import { MongoClient } from 'mongodb';
```

e rode `npm run test:arch`. O resultado é este:

```
 FAIL  tests/architecture/architecture.test.ts > arquitetura: Clean Architecture (dependências apontam para dentro) > o driver do MongoDB só aparece na Infrastructure
- Expected
+ Received
- []
+ [
+   "src/domain/Product.ts -> mongodb",
+ ]

 Test Files  1 failed (1)
      Tests  2 failed | 22 passed (24)
```

(A outra falha é a regra "Domain é TypeScript puro".) Depois é só apagar a linha, ou `git checkout src/domain/Product.ts`.
O próprio arquivo de teste também tem um bloco que "planta" violações em arquivos de mentira para provar que
cada regra realmente acusa o problema.

## Docker

O `Dockerfile` é multi-stage em cima de `node:22-alpine`: a primeira etapa instala as dependências e compila; a
imagem final leva só o `dist/` e as dependências de produção, roda com o usuário `node` (sem root) e tem
`HEALTHCHECK` em `/health`.

### Comandos manuais

```bash
docker build -t {{DOCKERHUB_USER}}/pjbl-ms-produtos:v1 .
docker login
docker push {{DOCKERHUB_USER}}/pjbl-ms-produtos:v1
```

Para rodar a imagem:

```bash
# com repositório em memória
docker run --rm -p 3001:3001 {{DOCKERHUB_USER}}/pjbl-ms-produtos:v1

# com MongoDB (a connection string entra como variável, nunca vai dentro da imagem)
docker run --rm -p 3001:3001 \
  -e MONGODB_URI="<connection string do Atlas>" \
  -e INTERNAL_API_KEY="<chave interna>" \
  {{DOCKERHUB_USER}}/pjbl-ms-produtos:v1
```

**Sobre o nome da imagem.** O enunciado dá como exemplo `dockerhubuser/pjbl/bff:v1`, com um nível a mais
(`pjbl/`). O Docker Hub não aceita esse formato: lá o nome de um repositório é sempre `usuario/repositorio`, sem
namespace aninhado (isso existe em outros registries, como o Azure Container Registry e o GitHub Container
Registry). Por isso levamos o "pjbl" para dentro do nome do repositório: `{{DOCKERHUB_USER}}/pjbl-ms-produtos:v1`,
`{{DOCKERHUB_USER}}/pjbl-ms-pedidos:v1` e `{{DOCKERHUB_USER}}/pjbl-bff:v1`.

### Publicação pelo GitHub Actions

O workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) tem dois jobs:

1. **test**: `npm ci`, checagem de tipos, todos os testes (inclusive arquitetura e MongoDB) e build.
2. **docker**: só roda fora de pull request e depois que os testes passam. Faz o build com
   `docker/build-push-action` e publica no Docker Hub com as tags `v1`, `latest` e `sha-<commit>`.

Para o job de Docker funcionar, o repositório precisa de dois *secrets* (Settings > Secrets and variables > Actions):

| Secret | Valor |
|---|---|
| `DOCKERHUB_USERNAME` | usuário do Docker Hub |
| `DOCKERHUB_TOKEN` | um Access Token gerado em Docker Hub > Account settings > Personal access tokens |

Se os secrets não existirem o job não falha: ele só avisa (warning) e pula a publicação.

## Links da nuvem

| O quê | Link |
|---|---|
| Swagger do ms-produtos | {{URL_MS_PRODUTOS}}/docs |
| OpenAPI (JSON) | {{URL_MS_PRODUTOS}}/openapi.json |
| Health | {{URL_MS_PRODUTOS}}/health |
| Imagem no Docker Hub | https://hub.docker.com/r/{{DOCKERHUB_USER}}/pjbl-ms-produtos |
| Frontend | https://devinigarcia.github.io/pjbl-microfrontend |
| API Gateway | {{URL_GATEWAY}} |
| Swagger do BFF | {{URL_BFF}}/docs |
| Vídeo de apresentação | {{URL_VIDEO}} |

Na nuvem o serviço roda no Azure Container Apps a partir da imagem do Docker Hub, com o MongoDB Atlas (M0) como
banco. As rotas de negócio pedem `x-api-key`, então no Swagger publicado é preciso clicar em **Authorize** antes
de testar; `/health`, `/docs` e `/openapi.json` são abertos.

Os outros repositórios do projeto:

- [pjbl-microfrontend](https://github.com/devinigarcia/pjbl-microfrontend)
- [pjbl-bff](https://github.com/devinigarcia/pjbl-bff)
- [pjbl-ms-pedidos](https://github.com/devinigarcia/pjbl-ms-pedidos)
- [pjbl-function](https://github.com/devinigarcia/pjbl-function)
- [pjbl-arquitetura](https://github.com/devinigarcia/pjbl-arquitetura) (ARC42, C4, contratos, scripts de deploy)

## Alunos

{{ALUNOS}}
