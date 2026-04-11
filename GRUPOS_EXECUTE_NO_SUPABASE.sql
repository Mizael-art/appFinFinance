-- ============================================================
-- FinFinance — Grupos Financeiros v1.3
-- SOLUÇÃO DEFINITIVA para infinite recursion
--
-- Estratégia: usar SECURITY DEFINER function para verificar
-- pertencimento sem acionar o RLS (evita recursão)
-- ============================================================

-- ── PASSO 1: Apagar TUDO existente (qualquer nome de policy) ──

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('groups','group_members','invite_tokens')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END$$;

-- ── PASSO 2: Criar tabelas ────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  owner_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_members (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  permission_level TEXT NOT NULL DEFAULT 'full'
                   CHECK (permission_level IN ('full','expenses_only','partial','hidden')),
  joined_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.invite_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  used_by    UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invite_tokens ENABLE ROW LEVEL SECURITY;

-- ── PASSO 3: Função SECURITY DEFINER (bypassa RLS) ────────────
-- Verifica se o usuário é membro de um grupo SEM acionar RLS

CREATE OR REPLACE FUNCTION public.ff_is_group_member(p_group_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_members
    WHERE group_id = p_group_id AND user_id = p_user_id
  );
$$;

-- ── PASSO 4: Policies para groups ────────────────────────────

-- INSERT: qualquer autenticado cria um grupo (owner_id = seu uid)
CREATE POLICY "grp_insert" ON public.groups
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- SELECT: dono vê OU membro vê (usando função SECURITY DEFINER)
CREATE POLICY "grp_select" ON public.groups
  FOR SELECT USING (
    auth.uid() = owner_id
    OR public.ff_is_group_member(id, auth.uid())
  );

CREATE POLICY "grp_update" ON public.groups
  FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "grp_delete" ON public.groups
  FOR DELETE USING (auth.uid() = owner_id);

-- ── PASSO 5: Policies para group_members ─────────────────────

CREATE POLICY "gm_insert" ON public.group_members
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- SELECT: vê membros do grupo se for membro (via função, sem recursão)
CREATE POLICY "gm_select" ON public.group_members
  FOR SELECT USING (
    public.ff_is_group_member(group_id, auth.uid())
  );

CREATE POLICY "gm_update" ON public.group_members
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "gm_delete" ON public.group_members
  FOR DELETE USING (
    auth.uid() = user_id
    OR public.ff_is_group_member(group_id, auth.uid()) AND EXISTS (
      SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid()
    )
  );

-- ── PASSO 6: Policies para invite_tokens ─────────────────────

CREATE POLICY "it_insert" ON public.invite_tokens
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
  );

CREATE POLICY "it_select" ON public.invite_tokens
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "it_update" ON public.invite_tokens
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "it_delete" ON public.invite_tokens
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.groups WHERE id = group_id AND owner_id = auth.uid())
  );

-- ── PASSO 7: Índices ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_gm_user_id  ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_gm_group_id ON public.group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_it_token    ON public.invite_tokens(token);

-- ── PASSO 8: Verificar ───────────────────────────────────────

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('groups','group_members','invite_tokens')
ORDER BY tablename, cmd;
