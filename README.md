# Preço Justo — Backend

API do Preço Justo: contas de usuário (JWT) e **backup opcional** dos dados do app.
Os cálculos rodam no celular (PWA offline); o servidor só guarda uma cópia quando o empreendedor liga o backup.

**Stack:** Node.js 24 + TypeScript · Express 5 · PostgreSQL 17 (Docker) · JWT · Zod · ngrok (só homologação)

## Rodando em desenvolvimento

```bash
cp .env.example .env          # gere um JWT_SECRET forte (comando no arquivo)
npm install
npm run db:up                 # sobe só o Postgres no Docker (localhost:5433)
npm run dev                   # API em http://localhost:3333 com reload
```

As tabelas são criadas automaticamente ao subir a API (`src/db/migrate.ts`).

## Rodando tudo no Docker

```bash
docker compose up -d --build  # Postgres + API (http://localhost:3333)
```

## Homologação com ngrok

1. Crie uma conta gratuita em ngrok.com e coloque o token em `NGROK_AUTHTOKEN` no `.env`.
   Opcional: um domínio estático gratuito em `NGROK_DOMAIN` (a URL não muda a cada subida).
2. Libere a origem do front em `CORS_ORIGIN` (ou use `*` só em homologação).
3. Suba com o túnel:

```bash
npm run homolog               # = docker compose --profile homolog up -d --build
```

A URL pública aparece em http://localhost:4040. No front, use `VITE_API_URL=https://<url>/api`.

Sem Docker para o túnel, com a API rodando localmente: `npm run tunnel` (usa o ngrok instalado na máquina).

## Endpoints

| Método | Rota | Auth | Descrição |
| --- | --- | --- | --- |
| GET | `/api/health` | — | Saúde da API e do banco |
| POST | `/api/auth/register` | — | `{ name, email, password }` → `{ token, user }` |
| POST | `/api/auth/login` | — | `{ email, password }` → `{ token, user }` |
| GET | `/api/auth/me` | Bearer | Usuário logado |
| GET | `/api/backup` | Bearer | Último backup `{ backup: { data, dataUpdatedAt, savedAt } \| null }` |
| PUT | `/api/backup` | Bearer | `{ data }`: salva/substitui o backup |
| DELETE | `/api/backup` | Bearer | Apaga o backup |

Erros sempre voltam como `{ "error": "mensagem em português" }`. Login e cadastro têm limite de 30 tentativas a cada 15 minutos por IP.

## Estrutura

```
src/
  app.ts                 # Express: helmet, cors, rotas, erros
  server.ts              # sobe migrações e o servidor
  config/env.ts          # variáveis de ambiente validadas com Zod
  db/                    # pool do Postgres e migrações
  middlewares/           # auth JWT, validação, tratamento de erros
  modules/auth/          # cadastro, login, /me
  modules/backup/        # backup dos dados do app (JSONB)
```
