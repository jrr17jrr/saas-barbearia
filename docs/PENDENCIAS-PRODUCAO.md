# Pendências de produção — BarberSaaS

Somente ações que **não puderam ser executadas** na sessão de 2026-11-03, por falta de credenciais
(não havia token do Supabase CLI, login da Vercel nem a extensão do Chrome conectada).
Todo o código, as migrations e as funções já estão na `main`.

Para conferir o estado a qualquer momento (somente leitura, não grava nada):

```powershell
npm run smoke
```

Hoje o resultado é `0/16`. Depois de concluir os itens 1 a 4, o esperado é `16/16`.

---

## 0. (URGENTE, só se o item 1 não puder ser feito agora) Fechar brechas de RLS

### Nome
Fechar as tabelas expostas no banco real.

### Motivo
Confirmado em 2026-11-03 pela API pública: `platform_admins`, `professionals`, `professional_services`,
`professional_hours`, `special_days`, `booking_rate_events` e `audit_log` estão **sem RLS** e o papel
anônimo consegue **inserir** nelas. Além disso, `barbershops` expõe `owner_email`/`admin_notes`, e a
policy legada de `profiles` permite que qualquer usuário logado se marque como admin. O item 1 corrige
tudo isso definitivamente. Este script é um curativo para usar caso o item 1 vá demorar.

### Comando
Abrir o arquivo `supabase/manual/00_emergencia_rls.sql`, copiar todo o conteúdo e executar.

### Onde
Supabase Dashboard → projeto BarberSaaS → **SQL Editor** → New query → colar → **Run**.

### Resultado esperado
`Success. No rows returned`.

### Verificação
```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
```
Todas as linhas devem aparecer com `rowsecurity = true`.

---

## 1. Aplicar as migrations 02–06

### Nome
`db push` das migrations de segurança, agendamento, admin, notificações, Storage, Vault e Cron.

### Motivo
Sem token do Supabase CLI nesta sessão. Hoje o banco real só tem a 01 (aplicada antes, numa versão
compatível com o cargo legado `barber`). Enquanto isso não for feito, o **painel e o site novos
publicados na Vercel mostram “O sistema está sendo atualizado”**, porque as RPCs ainda não existem.

### Comando
```powershell
npx supabase login
npx supabase link --project-ref idtvkslyyexwbqcgrozh
npx supabase migration list
npx supabase db push
```

Se o `migration list` mostrar uma versão **remota** que não existe em `supabase/migrations/`
(a 01 “compatível” pode ter sido registrada com outro número), marque-a como revertida e rode o push
de novo. Isso não apaga nada; a 01 do repositório é idempotente e já trata `barber`:
```powershell
npx supabase migration repair --status reverted <VERSAO_REMOTA_DESCONHECIDA>
npx supabase db push
```

Se o `db push` quiser reaplicar a `20261101000100` e ela já foi aplicada manualmente, tudo bem:
ela é idempotente (testada rodando duas vezes sobre o schema legado com `barber`).

### Onde
PowerShell, na pasta do projeto.

### Resultado esperado
`Applying migration 20261101000200_security_rls.sql...` até a `...000600...` e `Finished supabase db push.`

### Verificação
```powershell
npm run smoke
```
Os itens “Migration 02/03/05” e “RLS/grants” devem ficar `OK`. No SQL Editor:
```sql
select jobname, schedule from cron.job;                                  -- barbersaas-notifications, barbersaas-maintenance
select name from vault.secrets where name = 'barbersaas_dispatch_secret'; -- 1 linha
select id, public from storage.buckets where id = 'shop-assets';           -- public = true
select role, count(*) from public.barbershop_members group by 1;           -- só owner / manager / barber
```

---

## 2. Chaves VAPID (Web Push)

### Nome
Gerar e configurar as chaves VAPID como secrets das Edge Functions.

### Motivo
A chave privada não pode ser gerada por mim e colocada em lugar nenhum do repositório; ela precisa ir
direto para os Supabase Secrets, o que exige login.

### Comando
```powershell
npx web-push generate-vapid-keys
npx supabase secrets set VAPID_PUBLIC_KEY="<Public Key>" VAPID_PRIVATE_KEY="<Private Key>" VAPID_SUBJECT="mailto:visionariodev@gmail.com"
```
(Copie as duas chaves do primeiro comando. **Não** salve a privada em arquivo nem no GitHub.)

### Onde
PowerShell, na pasta do projeto (depois do `npx supabase login` do item 1).

### Resultado esperado
`Finished supabase secrets set.`

### Verificação
```powershell
npx supabase secrets list
```
Devem aparecer `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (só os hashes).

---

## 3. Publicar as Edge Functions

### Nome
Deploy de `push-dispatch`, `push` e `admin-users`.

### Motivo
Exige login no Supabase CLI.

### Comando
```powershell
npx supabase functions deploy push-dispatch --no-verify-jwt
npx supabase functions deploy push --no-verify-jwt
npx supabase functions deploy admin-users --no-verify-jwt
```
`--no-verify-jwt` é seguro aqui: `push-dispatch` valida o segredo do Vault (sem segredo → 401) e
`push`/`admin-users` validam o JWT do usuário com `auth.getUser()` (sem login → 401).

### Onde
PowerShell, na pasta do projeto.

### Resultado esperado
`Deployed Functions on project idtvkslyyexwbqcgrozh: push-dispatch` (e as outras duas).

### Verificação
```powershell
npm run smoke
```
“push-dispatch: sem segredo → 401” e “push: sem login → 401” devem ficar `OK`.
Depois de 1–2 minutos, no SQL Editor (o Cron só chama a função quando há pendência):
```sql
select status, count(*) from public.notification_outbox group by 1;
select id, status_code, left(content::text, 120) from net._http_response order by id desc limit 5;
```

---

## 4. Conta do administrador DEV

### Nome
Criar/convidar `visionariodev@gmail.com` no Supabase Auth.

### Motivo
Não invento senha e não tenho acesso ao Dashboard. Ao confirmar o e-mail, o trigger
`private.handle_auth_user` coloca a conta em `platform_admins` automaticamente (se a conta já existir
e estiver confirmada, a migration 02 faz isso no `db push`).

### Comando
Authentication → Users → **Invite user** → `visionariodev@gmail.com`.
Abrir o e-mail e definir a senha na página `/redefinir-senha/`.

### Onde
Supabase Dashboard.

### Resultado esperado
Login em `https://saas-barbearia-swart.vercel.app/login/` abre o painel, e o menu mostra **Painel DEV**.

### Verificação
```sql
select u.email from public.platform_admins pa join auth.users u on u.id = pa.user_id;
```
Deve retornar só `visionariodev@gmail.com`.

---

## 5. Configuração do Auth (recomendado)

### Nome
URLs de redirecionamento e cadastro público.

### Motivo
São configurações do Dashboard.

### Comando
Authentication → URL Configuration:
- Site URL: `https://saas-barbearia-swart.vercel.app`
- Redirect URLs: `https://saas-barbearia-swart.vercel.app/**`

Authentication → Sign In / Providers → Email → desativar **Allow new users to sign up**
(as contas são criadas pelo DEV via convite).
Authentication → Sessions: manter **Time-box user sessions** e **Inactivity timeout** desligados.

### Onde
Supabase Dashboard.

### Resultado esperado
O link “Esqueci minha senha” leva para `/redefinir-senha/` do domínio de produção.

### Verificação
Pedir a recuperação de senha em `/login/` e conferir o link do e-mail.

---

## 6. Advisors do Supabase

### Nome
Rodar Security e Performance Advisors depois do item 1.

### Motivo
Exige acesso ao Dashboard ou ao CLI logado.

### Comando
Dashboard → Advisors → **Security Advisor** e **Performance Advisor** → Refresh.

### Onde
Supabase Dashboard.

### Resultado esperado
Avisos **intencionais**, que podem ser ignorados:
- *Function Search Path Mutable*: não deve aparecer (todas as funções usam `set search_path = ''`).
- *Security Definer function executable by anon*: aparece só para `get_public_shop`,
  `get_available_slots` e `create_public_booking`. Elas são públicas por definição (site/chatbot sem
  login) e validam tudo internamente: slug, plano, status, serviço, profissional, grade de horários,
  nome, WhatsApp e rate limit.
- *Security Definer executable by authenticated*: as RPCs do painel/DEV. Cada uma valida o tenant
  (`private.can_access_shop`) ou exige `platform_admins`.
- *RLS enabled, no policy*: `notification_deliveries`, que é acessada somente pelo service_role.

Qualquer outro aviso **ERROR** deve ser corrigido.

### Verificação
Nenhum item de nível ERROR fora da lista acima.

---

## 7. Testes manuais em aparelho físico

Itens que não podem ser simulados. A infraestrutura está pronta, mas o resultado só vale com teste real:

| Teste | Como |
|---|---|
| Android: instalar PWA | Chrome → menu → Instalar app |
| Android: ativar push | Configurações → Notificações → Ativar notificações → Permitir |
| Android: push teste | Configurações → Enviar notificação de teste |
| Android: PWA fechado | Fechar o app, fazer um agendamento pelo site público em outro aparelho → deve chegar “Novo agendamento!” |
| Android: toque abre Agenda | Tocar na notificação → abre `/agendamentos/` no agendamento |
| iPhone (iOS 16.4+): instalar | Safari → Compartilhar → Adicionar à Tela de Início → abrir pelo ícone → fazer login dentro do app |
| iPhone: ativar push e teste | Mesmo fluxo do Android, **dentro do app instalado** |
| iPhone no Safari normal | Configurações deve mostrar o aviso “instale na Tela de Início” |
| Lembrete | Criar agendamento para daqui a ~35 min (lembrete padrão 30 min) e aguardar |
| Cancelamento/remarcação | Cancelar/remarcar pelo painel em outro aparelho → push nos demais |
| Sessão | Fechar o app por 2+ horas e reabrir → deve continuar logado |
