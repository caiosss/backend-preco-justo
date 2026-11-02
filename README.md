# Preço Justo — Backend

API do Preço Justo: contas de usuário (JWT), recuperação de senha por e-mail e **sincronização** dos dados do app entre os aparelhos da conta.
Os cálculos rodam no aparelho (PWA offline); o servidor guarda os dados da conta e junta o que cada aparelho mudou.

**Stack:** Node.js 24 + TypeScript · Express 5 · PostgreSQL 17 (Docker) · JWT · Zod · ngrok (só homologação)

## Rodando em desenvolvimento

```bash
cp .env.example .env          # gere um JWT_SECRET forte (comando no arquivo)
npm install
npm run db:up                 # sobe só o Postgres no Docker (localhost:5433)
npm run dev                   # API em http://localhost:3333 com reload
```

As tabelas são criadas automaticamente ao subir a API (`src/db/migrate.ts`).

Testes: `npm test` (Node test runner via `tsx`; não precisa de banco).

## Assistente de IA

`POST /api/agent/chat` repassa a pergunta ao serviço do agente ([agente-preco-justo](https://github.com/CAUTATAU/agente-preco-justo)). Aqui ficam o login e os limites de uso:
- 5 perguntas por minuto e 30 por dia por pessoa;
- `AGENT_DAILY_LIMIT` perguntas por dia somando todas as pessoas (padrão 100), porque o cadastro é aberto;
- o corpo e a resposta seguem o [contrato do agente](https://github.com/CAUTATAU/agente-preco-justo#contrato-da-api).

Para rodar junto, suba o agente na porta 8000 (veja o README de lá). No `.env` daqui, coloque `AGENT_URL=http://localhost:8000` e a mesma `AGENT_KEY` do agente. Sem `AGENT_URL`, a rota responde 503 e o resto da API funciona normalmente.

## Sincronização entre aparelhos

Cada conta tem um pacote de dados (tabela `backups`, coluna `data` em JSONB) com um número de `revision`.
O app envia o pacote do aparelho em `POST /api/sync` e o servidor junta com o que já está na conta (`src/modules/sync/merge.ts`):

- cada registro tem a hora da última mudança em `clock` e cada exclusão fica em `deleted`; em conflito vence a mudança mais recente;
- registros com ids diferentes se somam: é assim que o celular e o PC que nunca sincronizaram viram uma loja só;
- na primeira sincronização de um aparelho (`firstSync`), o negócio que vale é o do lado com mais coisa cadastrada, para o cadastro de teste de um aparelho novo não apagar o negócio em uso;
- `PUT /api/backup` (versões antigas do app) também passa pela junção, então celulares ainda não atualizados não apagam o que veio dos outros.

A migração `002_sync_e_recuperar_senha` roda sozinha ao subir a API. Os dados que só existiam no celular (backup desligado) chegam à conta quando o celular abre a versão nova do app.

## Recuperar senha

`POST /api/auth/forgot-password` envia um link (vale 1 hora, uso único) para `APP_URL/redefinir-senha?token=…`. O e-mail sai pela API do [Resend](https://resend.com) (`RESEND_API_KEY`, `EMAIL_FROM` de um domínio verificado). Sem a chave, em desenvolvimento o link aparece no log da API.

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
| POST | `/api/auth/forgot-password` | — | `{ email }` → `{ ok: true }` (mesma resposta exista ou não a conta) |
| POST | `/api/auth/reset-password` | — | `{ token, password }` → `{ token, user }` |
| POST | `/api/auth/change-password` | Bearer | `{ password }` → `{ token, user }`: troca a senha de quem está conectado |
| GET | `/api/sync/revision` | Bearer | `{ revision \| null }`: o app só baixa tudo quando mudou |
| GET | `/api/sync` | Bearer | `{ account: { data, revision, savedAt } \| null }` |
| POST | `/api/sync` | Bearer | `{ data, firstSync? }`: junta com os outros aparelhos e devolve `{ account }` |
| GET | `/api/backup` | Bearer | Versões antigas do app: `{ backup: { data, dataUpdatedAt, savedAt } \| null }` |
| PUT | `/api/backup` | Bearer | Versões antigas do app: `{ data }`, junta com os outros aparelhos |
| DELETE | `/api/backup` | Bearer | Versões antigas do app: apaga os dados da conta |
| POST | `/api/agent/chat` | Bearer | Pergunta ao assistente de IA: `{ contexto, historico, pergunta }` → `{ resposta, propostas, acoes }` |

Erros sempre voltam como `{ "error": "mensagem em português" }`. Login, cadastro e redefinir senha têm limite de 30 tentativas a cada 15 minutos por IP; pedir o link, 5 a cada 15 minutos (e um e-mail a cada 2 minutos por conta). O assistente responde 429 quando um dos limites de uso estoura e 503 quando o agente está fora do ar.

## Estrutura

```
src/
  app.ts                 # Express: helmet, cors, rotas, erros
  server.ts              # sobe migrações e o servidor
  config/env.ts          # variáveis de ambiente validadas com Zod
  db/                    # pool do Postgres e migrações
  middlewares/           # auth JWT, validação, tratamento de erros
  modules/auth/          # cadastro, login, /me, recuperar senha
  modules/sync/          # sincronização entre aparelhos (junção em merge.ts)
  modules/backup/        # rotas das versões antigas do app
  modules/agent/         # repasse ao assistente de IA, com os limites de uso
```
