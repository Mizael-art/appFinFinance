/**
 * FinFinance — Grupos Financeiros Compartilhados
 * grupos-db.js v1.3 — STANDALONE
 *
 * Não depende de auth.js nem db.js.
 * Inclua SOMENTE este arquivo no grupos.html.
 * Requer: GRUPOS_EXECUTE_NO_SUPABASE.sql executado no Supabase.
 */

const _G_URL = 'https://glpxntvclbshupueqglf.supabase.co';
const _G_KEY = 'sb_publishable_Mxk806sE8KHBNCbDsvnIew_wx8KeUBv';

// ── Sessão ────────────────────────────────────────────────────
function _gSession() {
  try {
    const raw = sessionStorage.getItem('ff_auth_session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.access_token || Date.now() > s.expires_at) {
      sessionStorage.removeItem('ff_auth_session');
      return null;
    }
    return s;
  } catch { return null; }
}
function _gUid() { return _gSession()?.user?.id || null; }

window.AUTH = window.AUTH || {
  getSession: _gSession,
  handleLogout: () => { sessionStorage.removeItem('ff_auth_session'); location.href = 'index.html'; }
};

// ── REST helpers ──────────────────────────────────────────────
function _gH() {
  const token = _gSession()?.access_token || _G_KEY;
  return {
    'Content-Type': 'application/json',
    'apikey': _G_KEY,
    'Authorization': `Bearer ${token}`,
    'Prefer': 'return=representation'
  };
}

async function _gGet(table, params = '') {
  const res = await fetch(`${_G_URL}/rest/v1/${table}${params}`, { headers: _gH() });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    console.error(`[GRUPOS] GET ${table}${params}:`, e);
    return [];
  }
  return res.json();
}

async function _gPost(table, body) {
  const res = await fetch(`${_G_URL}/rest/v1/${table}`, {
    method: 'POST', headers: _gH(), body: JSON.stringify(body)
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    console.error(`[GRUPOS] POST ${table}:`, JSON.stringify(e));
    return null;
  }
  const d = await res.json().catch(() => []);
  return Array.isArray(d) ? d[0] : d;
}

async function _gPatch(table, filter, body) {
  const res = await fetch(`${_G_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: _gH(), body: JSON.stringify(body)
  });
  return res.ok;
}

async function _gDelete(table, filter) {
  const res = await fetch(`${_G_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE', headers: _gH()
  });
  return res.ok;
}

// ── Permissões ────────────────────────────────────────────────
function _perm(d, level) {
  const b = { user_id: d.user_id, nome: d.nome };
  if (level === 'full')          return { ...b, ganhos: d.ganhos, gastos: d.gastos, saldo: d.saldo, visivel: true,  nivel: level };
  if (level === 'expenses_only') return { ...b, ganhos: null,     gastos: d.gastos, saldo: null,    visivel: true,  nivel: level };
  if (level === 'partial')       return { ...b, ganhos: null,     gastos: null,     saldo: d.saldo, visivel: true,  nivel: level };
  return                                  { ...b, ganhos: null,   gastos: null,     saldo: null,    visivel: false, nivel: 'hidden' };
}

// ── Dados financeiros de um user ──────────────────────────────
async function _financeiro(uid, ini, fim) {
  const [profileRows, ganhos, despesas, contas] = await Promise.all([
    _gGet('profiles',      `?id=eq.${uid}&limit=1`),
    _gGet('ganhos_extras', `?user_id=eq.${uid}`),
    _gGet('despesas',      `?user_id=eq.${uid}&data=gte.${ini}&data=lte.${fim}`),
    _gGet('contas_fixas',  `?user_id=eq.${uid}`)
  ]);
  const p     = profileRows[0] || {};
  const ge    = ganhos.reduce((t, g)  => t + Number(g.valor || 0), 0);
  const renda = Number(p.salario || 0) + Number(p.outras_rendas || 0) + ge;
  const fixo  = contas.reduce((a, b)  => a + Number(b.valor), 0);
  const gasto = despesas.reduce((a, b) => a + Number(b.valor), 0) + fixo;
  return { nome: p.nome || 'Membro', renda, gasto, saldo: renda - gasto, despesas };
}

// ══════════════════════════════════════════════
//  window.GRUPOS
// ══════════════════════════════════════════════
window.GRUPOS = {

  listarGrupos: async () => {
    const uid = _gUid();
    if (!uid) return [];
    const memberships = await _gGet('group_members', `?user_id=eq.${uid}&select=group_id`);
    if (!memberships.length) return [];
    const ids = memberships.map(m => m.group_id).join(',');
    return _gGet('groups', `?id=in.(${ids})&order=created_at.desc`);
  },

  criarGrupo: async (nome) => {
    const uid = _gUid();
    if (!uid) return { ok: false, error: 'Não autenticado' };
    const grupo = await _gPost('groups', { name: nome, owner_id: uid });
    if (!grupo?.id) return { ok: false, error: 'Falha ao criar grupo. Execute o SQL no Supabase.' };
    const membro = await _gPost('group_members', {
      group_id: grupo.id, user_id: uid, role: 'owner', permission_level: 'full'
    });
    if (!membro) {
      await _gDelete('groups', `id=eq.${grupo.id}`);
      return { ok: false, error: 'Grupo criado mas falha ao registrar membro.' };
    }
    return { ok: true, grupo };
  },

  deletarGrupo: async (groupId) => {
    const uid = _gUid();
    if (!uid) return { ok: false };
    return { ok: await _gDelete('groups', `id=eq.${groupId}&owner_id=eq.${uid}`) };
  },

  gerarConvite: async (groupId) => {
    const uid = _gUid();
    if (!uid) return { ok: false, error: 'Não autenticado' };
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const invite = await _gPost('invite_tokens', { group_id: groupId, expires_at: expires });
    if (!invite) return { ok: false, error: 'Erro ao gerar convite. Você é o dono do grupo?' };
    const base = window.location.href.replace(/[?#].*$/, '').replace(/grupos\.html$/, '');
    return { ok: true, token: invite.token, link: `${base}grupos.html?convite=${invite.token}`, expires_at: invite.expires_at };
  },

  aceitarConvite: async (token) => {
    const uid = _gUid();
    if (!uid) return { ok: false, error: 'Faça login para entrar no grupo' };
    const rows = await _gGet('invite_tokens', `?token=eq.${encodeURIComponent(token)}&limit=1`);
    if (!rows.length) return { ok: false, error: 'Convite inválido ou expirado' };
    const inv = rows[0];
    if (new Date(inv.expires_at) < new Date()) return { ok: false, error: 'Este convite expirou' };
    if (inv.used_by) return { ok: false, error: 'Este convite já foi usado' };
    const ja = await _gGet('group_members', `?group_id=eq.${inv.group_id}&user_id=eq.${uid}&limit=1`);
    if (ja.length) return { ok: false, error: 'Você já faz parte deste grupo' };
    await _gPost('group_members', { group_id: inv.group_id, user_id: uid, role: 'member', permission_level: 'full' });
    await _gPatch('invite_tokens', `token=eq.${encodeURIComponent(token)}`, { used_by: uid });
    return { ok: true, group_id: inv.group_id };
  },

  listarMembros: async (groupId) => {
    return _gGet('group_members', `?group_id=eq.${groupId}&order=joined_at.asc`);
  },

  atualizarMinhaPermissao: async (groupId, permissionLevel) => {
    const uid = _gUid();
    if (!uid) return { ok: false };
    const niveis = ['full', 'expenses_only', 'partial', 'hidden'];
    if (!niveis.includes(permissionLevel)) return { ok: false, error: 'Nível inválido' };
    return { ok: await _gPatch('group_members', `group_id=eq.${groupId}&user_id=eq.${uid}`, { permission_level: permissionLevel }) };
  },

  sairDoGrupo: async (groupId) => {
    const uid = _gUid();
    if (!uid) return { ok: false };
    return { ok: await _gDelete('group_members', `group_id=eq.${groupId}&user_id=eq.${uid}`) };
  },

  removerMembro: async (groupId, targetUserId) => {
    return { ok: await _gDelete('group_members', `group_id=eq.${groupId}&user_id=eq.${targetUserId}`) };
  },

  getDadosGrupo: async (groupId, ano, mes) => {
    const uid = _gUid();
    if (!uid) return null;

    const membros = await window.GRUPOS.listarMembros(groupId);
    if (!membros.length) return null;
    const euMembro = membros.find(m => m.user_id === uid);
    if (!euMembro) return { error: 'Você não é membro deste grupo' };

    const daysInMonth = new Date(ano, mes, 0).getDate();
    const ini = `${ano}-${String(mes).padStart(2, '0')}-01`;
    const fim = `${ano}-${String(mes).padStart(2, '0')}-${daysInMonth}`;

    const eu = await _financeiro(uid, ini, fim);

    const dadosMembros = [];
    for (const m of membros) {
      const f = await _financeiro(m.user_id, ini, fim);
      dadosMembros.push(_perm(
        { user_id: m.user_id, nome: f.nome, ganhos: f.renda, gastos: f.gasto, saldo: f.saldo },
        m.permission_level
      ));
    }

    const vis = dadosMembros.filter(m => m.visivel);
    const totalG = vis.reduce((a, m) => a + (m.ganhos || 0), 0);
    const totalE = vis.reduce((a, m) => a + (m.gastos || 0), 0);

    return {
      groupId,
      minhaPermissao: euMembro.permission_level,
      meuRole: euMembro.role,
      individual: { nome: eu.nome, ganhos: eu.renda, gastos: eu.gasto, saldo: eu.saldo, despesas: eu.despesas },
      compartilhado: { membros: dadosMembros, totalGanhos: totalG, totalGastos: totalE, saldoGeral: totalG - totalE }
    };
  }
};

console.log('[FinFinance] grupos-db.js v1.3 standalone carregado');
