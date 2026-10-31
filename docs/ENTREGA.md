# BarberSaaS — entrega da sessão de 29–30/10/2026

Branch: `feature/auth-dev-supabase` • PR: https://github.com/jrr17jrr/saas-barbearia/pull/1
Nada foi enviado para `main`. Nenhuma migração foi aplicada no Supabase (não havia acesso administrativo nesta sessão).

## 1. Passos que dependem de você (em ordem)

### 1.1 Supabase Auth (5 min) — **crítico**
1. **Desativar cadastro público**: Authentication → Sign In / Providers → desmarcar *Allow new users to sign up*.
   O teste `tests/api.test.mjs` comprovou que hoje qualquer pessoa consegue criar conta via `/auth/v1/signup`.
   As contas de proprietário continuam sendo criadas pela Edge Function `create-barbershop-owner` (service role).
2. **URL Configuration**:
   - Site URL: domínio de produção (ex.: `https://saas-barbearia.vercel.app`).
   - Redirect URLs: `https://saas-barbearia.vercel.app/login/`, `https://*-ricardo-juniors-projects.vercel.app/login/`, `http://localhost:5173/login/`.

### 1.2 Conta DEV `visionariodev@gmail.com`
1. Rode a consulta 7 de `tests/sql/rls-audit.sql` para ver se a conta existe e se o e-mail está confirmado.
2. Se não existir: Authentication → Users → **Invite user** com esse e-mail. O convite pede que o dono do e-mail defina a própria senha (nenhuma senha previsível é criada).
3. **Somente depois** que o e-mail estiver confirmado (`email_confirmed_at` preenchido), conceda o privilégio:
   ```sql
   update public.profiles set is_platform_admin = true
   where id = (select id from auth.users where email = 'visionariodev@gmail.com' and email_confirmed_at is not null);
   ```
   (se a linha em `profiles` não existir, crie-a com `insert into public.profiles (id, is_platform_admin) ...`).

### 1.3 Migrações (revise antes de aplicar)
Aplique no SQL Editor, nesta ordem. Todas são idempotentes.
1. `supabase/migrations/20261030000100_push_notifications.sql`
   - Confira antes as colunas atuais de `push_subscriptions`: se existir coluna obrigatória diferente (ex.: `keys jsonb not null`), ajuste.
2. `supabase/migrations/20261030000200_storage_logos.sql` — bucket `logos` (público, 2 MB, PNG/JPG/WEBP) com escrita só por membros da barbearia/DEV.
3. `supabase/migrations/20261030000300_security_hardening.sql`
   - Move `btree_gist` para o schema `extensions`.
   - Revoga `EXECUTE` de `anon` em funções `SECURITY DEFINER`, exceto as RPCs públicas e as usadas em políticas RLS (o script lista o que fez via `NOTICE`).
   - Gatilho `guard_new_appointment`: bloqueia reservas de barbearias suspensas/canceladas, limita 3 reservas futuras em aberto por WhatsApp e 20 reservas por barbearia a cada 5 minutos. **Assume a coluna `appointments.created_at`.**
4. Depois rode `tests/sql/rls-audit.sql` e `tests/sql/owner-isolation.sql` (este faz rollback ao final).

### 1.4 Notificações push (15 min)
```bash
npx web-push generate-vapid-keys            # gere localmente; NÃO comite a chave privada
supabase secrets set --project-ref idtvkslyyexwbqcgrozh \
  VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> \
  VAPID_SUBJECT=mailto:visionariodev@gmail.com PUSH_WEBHOOK_SECRET=<openssl rand -hex 32>
supabase functions deploy push-notify --project-ref idtvkslyyexwbqcgrozh --no-verify-jwt
```
No SQL Editor (mesmo segredo do passo anterior):
```sql
select vault.create_secret('https://idtvkslyyexwbqcgrozh.supabase.co/functions/v1/push-notify', 'push_notify_url');
select vault.create_secret('<PUSH_WEBHOOK_SECRET>', 'push_webhook_secret');
```
`--no-verify-jwt` é intencional: a ação `new_booking` exige o segredo compartilhado, `test` valida o JWT do usuário dentro da função e `public_key` é pública.

**Teste no iPhone (iOS 16.4+):** abrir o painel no Safari → Compartilhar → *Adicionar à Tela de Início* → abrir pelo ícone → menu **🔔 Notificações** → *Ativar* → permitir → *Enviar teste*. Depois feche o app, faça uma reserva pelo site público e confira o aviso. Tocar na notificação abre a agenda do dia da reserva.
**Android/desktop:** Chrome/Edge, mesmo menu; não precisa instalar.

### 1.5 Limpeza de dados de teste
O teste de concorrência criou **1 agendamento** na barbearia demo: id `753d6189-e7b7-49da-b005-59222cc249ea` (27/11/2026 10:00, “TESTE CONCORRENCIA 1”). Cancele ou exclua quando quiser.

### 1.6 Edge Function existente
O código de `create-barbershop-owner` não está no repositório. Recomendo `supabase functions download create-barbershop-owner` e versionar em `supabase/functions/` para revisão. O painel DEV chama `{action:"create_owner", barbershop_id, name, email, password}` (senha forte gerada no navegador e exibida uma única vez).

## 2. O que foi feito
Ver mensagens de commit da branch. Resumo:
- **Site público** (`/link-agendamento/?loja=slug`): era protótipo com `localStorage` e horários fictícios; agora usa dados reais, horários livres e grava a reserva.
- **Painel do proprietário**: dashboard, agenda (dia/semana, confirmar/concluir/cancelar/falta, WhatsApp, novo agendamento só em horários livres, bloqueios), serviços (ativar/desativar/excluir), clientes (busca, histórico, cadastro), financeiro (só concluídos, ticket médio, 6 meses, cancelamentos/faltas), horários, meu site (upload de logo, tema, redes), chatbot.
- **Painel DEV**: estatísticas, filtros, criar/editar barbearia, plano, status (ativa/demo/suspensa/cancelada), cores e logo, acessos de proprietários, modo suporte.
- **PWA/push**: manifest, ícones, service worker, inscrição VAPID, Edge Function `push-notify`, gatilho no banco.
- **Segurança**: migração de hardening; cabeçalhos em `vercel.json`.

## 3. Testes
| Suíte | Comando | Resultado |
|---|---|---|
| Estática | `npm run test:static` | 616/616 |
| API/RLS (anônimo, real) | `npm run test:api` | 25/26 — falha: cadastro público ativo (item 1.1) |
| Reservas simultâneas (real) | `npm run test:api:write` | executado manualmente: 3 reservas simultâneas → 1 aceita, 2 recusadas; disponibilidade caiu de 20→19 (30 min) e 19→17 (60 min) |
| Navegador, páginas públicas (real) | `npm run test:e2e` | 33/33 |
| Navegador, painéis com backend simulado | `node tests/e2e-owner-mock.mjs` | 44/44 |

Os testes de navegador precisam de um servidor estático em `http://localhost:5173` servindo a raiz do repositório.

**Não testado (motivo):** login real de proprietário/DEV (sem credenciais), isolamento entre barbearias com usuários reais (use `tests/sql/owner-isolation.sql`), push com app fechado e iPhone (requer chaves VAPID e aparelho), upload real de logo (bucket ainda não criado), bloqueio de reservas para barbearia suspensa (não há barbearia suspensa; coberto pelo gatilho da migração).

## 4. Exceções de segurança intencionais
- `create_public_booking` e `available_booking_slots` são `SECURITY DEFINER` executáveis por `anon`: clientes agendam sem conta. Validam slug, serviço, expediente, bloqueios, conflitos e dados do cliente (verificado nos testes).
- Funções usadas dentro de políticas RLS mantêm `EXECUTE` (revogar quebraria as políticas).
- `barbershops`, `services`, `business_hours` e `barbershop_settings` são legíveis publicamente (necessário para o site/chatbot). Considere restringir colunas não públicas (`owner_name`, `phone`) com uma view pública se desejar.
