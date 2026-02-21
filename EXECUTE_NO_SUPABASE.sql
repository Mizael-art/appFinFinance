-- ============================================================
-- FinFinance — Execute no Supabase SQL Editor
-- ============================================================

-- ── 1. Sincronizar IDs: public.users.id = auth.users.id ──────
-- Isso é necessário para o RLS funcionar corretamente
UPDATE public.users pu
SET id = au.id
FROM auth.users au
WHERE au.email = pu.email
  AND pu.id != au.id;

-- ── 2. Corrigir RLS da tabela users ──────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Remover policies antigas
DROP POLICY IF EXISTS "users_self" ON public.users;
DROP POLICY IF EXISTS "service_role_users" ON public.users;
DROP POLICY IF EXISTS "users_read_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;

-- Policy: usuário lê e atualiza seus próprios dados (por id OU por email)
CREATE POLICY "users_read_own" ON public.users
  FOR SELECT USING (
    auth.uid() = id OR 
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (
    auth.uid() = id OR 
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
  );

-- Service role bypassa RLS (para webhook da Kiwify)
CREATE POLICY "service_role_bypass" ON public.users
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- ── 3. Corrigir RLS das outras tabelas ───────────────────────
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despesas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cartoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contas_fixas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ganhos_extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_self" ON public.profiles;
CREATE POLICY "profiles_self" ON public.profiles FOR ALL USING (auth.uid() = id);

DROP POLICY IF EXISTS "despesas_self" ON public.despesas;
CREATE POLICY "despesas_self" ON public.despesas FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "cartoes_self" ON public.cartoes;
CREATE POLICY "cartoes_self" ON public.cartoes FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "contas_self" ON public.contas_fixas;
CREATE POLICY "contas_self" ON public.contas_fixas FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "ganhos_self" ON public.ganhos_extras;
CREATE POLICY "ganhos_self" ON public.ganhos_extras FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "inv_self" ON public.investimentos;
CREATE POLICY "inv_self" ON public.investimentos FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "alertas_self" ON public.alertas;
CREATE POLICY "alertas_self" ON public.alertas FOR ALL USING (auth.uid() = user_id);

-- ── 4. Trigger: criar profile + user no signup ───────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, onboarding_done)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', 'Usuário'), 0)
  ON CONFLICT (id) DO NOTHING;

  -- Usar auth.users.id como id em public.users também
  INSERT INTO public.users (id, email, nome, subscription_status)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'nome', 'Usuário'), 'inactive')
  ON CONFLICT (email) DO UPDATE SET id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 5. Verificar resultado ───────────────────────────────────
SELECT au.id as auth_id, pu.id as public_id, au.email, 
       pu.subscription_status, pu.plan_type,
       (au.id = pu.id) as ids_sincronizados
FROM auth.users au
LEFT JOIN public.users pu ON pu.email = au.email
ORDER BY au.created_at DESC;
