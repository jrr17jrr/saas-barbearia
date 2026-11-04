# BarberSaaS — Configuração e operação

## Arquitetura
- **Frontend**: HTML/CSS/JS puro (ES modules), hospedado na Vercel. `npm run build` copia só os arquivos públicos para `dist/`.
- **Banco**: Supabase Postgres com RLS em todas as tabelas. Migrations em `supabase/migrations/`.
- **Regras de negócio críticas no banco**: motor único de disponibilidade (`private.compute_slots`), reservas com lock por profissional + exclusion constraint (`appointments_no_overlap`), feature gating por plano (`private.plan_has`).
- **Edge Functions** (`supabase/functions/`): `push-dispatch`, `push`, `admin-users`.
- **Cron (pg_cron)**: envio de notificações/lembretes e manutenção diária.

> Pendências reais de produção (com comandos exatos): [`docs/PENDENCIAS-PRODUCAO.md`](PENDENCIAS-PRODUCAO.md).
> Verificação somente leitura do ambiente real: `npm run smoke`.

## Cargos (`barbershop_members.role`)
`owner` | `manager` | `barber`. O schema de produção já usava `barber`; a migration 01 (reforçada na 02) remove qualquer check antigo de cargo e normaliza valores legados **sem escalar privilégio** (`admin`→`manager`, `staff`/desconhecido→`barber`). Barbearia `suspended`/`cancelled` bloqueia o acesso aos dados no banco (RLS via `private.my_shop_ids()`); o painel continua recebendo `shop_context` para mostrar o aviso.

## Passo a passo de implantação (uma vez)

### 1. Login no Supabase CLI e vínculo do projeto
```bash
npx supabase login
npx supabase link --project-ref idtvkslyyexwbqcgrozh
```

### 2. Aplicar as migrations
```bash
npx supabase db push
```
As migrations são idempotentes e foram testadas sobre a reconstrução do schema atual (`tests/sql/baseline_existing.sql`).
Elas preservam as barbearias, serviços e horários existentes.

### 3. Gerar as chaves VAPID e configurar os segredos das Edge Functions
```bash
npx web-push generate-vapid-keys
npx supabase secrets set VAPID_PUBLIC_KEY="<publicKey>" VAPID_PRIVATE_KEY="<privateKey>" VAPID_SUBJECT="mailto:visionariodev@gmail.com"
# opcional (padrões já corretos):
npx supabase secrets set APP_URL="https://saas-barbearia-swart.vercel.app"
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas automaticamente pelo Supabase às Edge Functions.
A chave privada VAPID **nunca** vai para o repositório nem para o navegador. A pública é entregue ao navegador pela função `push`.

### 4. Publicar as Edge Functions
```bash
npx supabase functions deploy push-dispatch --no-verify-jwt
npx supabase functions deploy push --no-verify-jwt
npx supabase functions deploy admin-users --no-verify-jwt
```
(`--no-verify-jwt` porque cada função valida a autorização internamente: segredo do Vault ou `auth.getUser()`.)

### 5. Auth (Dashboard → Authentication → URL Configuration)
- **Site URL**: `https://saas-barbearia-swart.vercel.app`
- **Redirect URLs**: `https://saas-barbearia-swart.vercel.app/**`
- **Recomendado**: Authentication → Providers → Email → desativar *“Allow new users to sign up”* (contas são criadas pelo DEV via convite).
- Sessões: mantenha **Time-box user sessions** e **Inactivity timeout** desativados (padrão) para o usuário não ser deslogado sem motivo. O refresh token é rotacionado automaticamente pelo SDK.

### 6. Administrador DEV
1. Authentication → Users → **Invite user** → `visionariodev@gmail.com` (ou “Add user” com “Auto confirm”).
2. Abra o e-mail, clique no link e defina a senha na página `/redefinir-senha/`.
3. Ao confirmar o e-mail, o trigger `private.handle_auth_user` adiciona a conta em `platform_admins` automaticamente.
   Se a conta já existir e estiver confirmada, a migration já fez esse vínculo.
   Conferência (SQL Editor): `select * from public.platform_admins;`

### 7. Vercel
Nenhuma variável de ambiente é necessária (a URL e a chave *publishable* do Supabase são públicas por definição e protegidas por RLS).
`vercel.json` define `buildCommand`, `outputDirectory: dist` e cabeçalhos (service worker sem cache).

## Onboarding de uma barbearia nova (DEV)
1. `/dev/` → **+ Nova barbearia** (nome, responsável, e-mail, WhatsApp, plano, situação).
2. O banco cria automaticamente: slug único, configurações, chatbot, horário padrão (seg–sex 09–19 com almoço 12–13, sáb 09–17) e um profissional inicial.
3. Com “Enviar convite” marcado, o responsável recebe o e-mail; ao definir a senha e confirmar, ganha acesso ao painel daquela barbearia.

## Planos
| Plano | Site + agendamento público | Chatbot |
|---|---|---|
| CHATBOT | — | ✓ |
| SITE | ✓ | — |
| COMPLETO | ✓ | ✓ |

O gating é aplicado no banco (`get_public_shop`, `get_available_slots`, `create_public_booking`) e refletido no painel.
Plano, status e slug só podem ser alterados pelo DEV (privilégios de coluna + trigger `barbershops_guard`).

## Faturamento
Somente status **Concluído** entra no faturamento. **Cancelado** e **Faltou** nunca somam. **Confirmado** aparece como “previsto”.

## Cron jobs
| Nome | Frequência | O que faz | Impacto |
|---|---|---|---|
| `barbersaas-notifications` | a cada minuto | `private.run_notification_cycle()`: gera lembretes devidos (idempotente via `reminder_sent_at` + `dedupe_key`) e, **somente se houver pendências**, chama a Edge Function `push-dispatch` via `pg_net` | Consulta leve por índice parcial; nenhuma chamada HTTP quando não há nada para enviar |
| `barbersaas-maintenance` | diário 06:17 UTC (03:17 BRT) | `private.maintenance()`: remove subscriptions com 5+ falhas ou sem uso há 120 dias, limpa rate-limit (>2 dias) e outbox (>30 dias) | Limpeza de dados técnicos |

O segredo usado pelo Cron para chamar a Edge Function é gerado aleatoriamente pela migration e fica no **Vault** (`barbersaas_dispatch_secret`). Não há segredo em SQL nem no repositório.

Desativar:
```sql
select cron.unschedule('barbersaas-notifications');
select cron.unschedule('barbersaas-maintenance');
```

## Fila de notificações (outbox)
- Cada evento tem `dedupe_key` única (novo agendamento, cancelamento, remarcação com novo horário, lembrete por horário).
- Entregas por dispositivo ficam em `notification_deliveries`: um retry **nunca** reenvia para quem já recebeu.
- Falha temporária (5xx/429/rede) → `pending` com backoff de 1, 4, 9 e 16 min; após 5 tentativas → `failed`.
- HTTP 404/410 do serviço de push → inscrição removida na hora. Falhas temporárias só somam `failure_count` (a limpeza diária remove com 5+).
- Lembrete de agendamento cancelado/remarcado e aviso de agendamento já cancelado são marcados `skipped` antes do envio.
- Diagnóstico (admin DEV): `select kind, status, attempts, last_error from notification_outbox order by id desc limit 20;`

## Notificações push — requisitos reais
- **Android (Chrome/Edge/Samsung Internet)**: funciona no navegador e no app instalado.
- **Desktop (Chrome, Edge, Firefox, Safari 16+ no macOS 13+)**: funciona.
- **iPhone/iPad**: Web Push só funciona com **iOS/iPadOS 16.4 ou superior** e com o app **adicionado à Tela de Início** (Safari → Compartilhar → Adicionar à Tela de Início), aberto pelo ícone. A permissão precisa ser pedida a partir de um toque do usuário (o botão “Ativar notificações” faz isso). Em navegação normal no Safari do iPhone, push não é suportado — o painel informa isso.
- No iOS, o app instalado tem armazenamento separado do Safari: é preciso entrar uma vez dentro do app instalado.
- Limitações iOS: sem som/vibração personalizados; se o usuário remover o app da Tela de Início, a inscrição é perdida; o iOS pode descartar dados de sites não usados por várias semanas.
- Teste: Configurações → Notificações → **Enviar notificação de teste**.

## Sessão persistente
- `persistSession` + `autoRefreshToken`: o access token (1h) é renovado automaticamente com o refresh token, inclusive ao reabrir o PWA ou voltar do background.
- Sem conexão, o app não desloga: a sessão salva continua válida e é renovada quando a rede volta.
- O login só é pedido de novo se o refresh token for revogado/inválido (logout, “Sair de todos os dispositivos”, troca de senha em outro dispositivo, usuário removido).

## Testes
```bash
npm install
npm run lint        # sintaxe, referências, segredos
npm test            # banco (PGlite) + unitários + E2E no Chrome headless
npm run build
```
Observação: os testes de banco usam PGlite (Postgres em WASM) com um stub mínimo do Supabase (auth, roles). Storage, Vault, pg_net e pg_cron só existem no Supabase real; esses trechos são protegidos por guardas e devem ser validados após o `db push`.
