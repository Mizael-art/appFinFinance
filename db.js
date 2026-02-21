/**
 * FinFinance DB v4 — Supabase (schema real)
 * Compatível com o schema atual do banco de dados.
 * SUPABASE_URL e SUPABASE_ANON_KEY definidos em auth.js
 */

// ── Helpers REST ───────────────────────────────────────────────

function getAuthHeaders() {
  const session = window.AUTH?.getSession?.();
  const token = session?.access_token || SUPABASE_ANON_KEY;
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    'Prefer': 'return=representation'
  };
}

function getUserId() {
  return window.AUTH?.getSession?.()?.user?.id || null;
}

async function sbGet(table, params = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
    headers: getAuthHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`[DB] GET ${table}:`, err);
    return [];
  }
  return res.json();
}

async function sbPost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`[DB] POST ${table}:`, err);
    return null;
  }
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data[0] : data;
}

async function sbPatch(table, filter, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`[DB] PATCH ${table}:`, err);
  }
  return res.ok;
}

async function sbDelete(table, filter) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'DELETE',
    headers: getAuthHeaders()
  });
  return { ok: res.ok };
}

async function sbUpsert(table, body) {
  const headers = {
    ...getAuthHeaders(),
    'Prefer': 'return=representation,resolution=merge-duplicates'
  };
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`[DB] UPSERT ${table}:`, err);
    return null;
  }
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data[0] : data;
}

// ── Motor de análise (local) ────────────────────────────────────

const METAS = {
  "Alimentação":  { ideal: 15, max: 20, tipo: "essencial" },
  "Moradia":      { ideal: 25, max: 35, tipo: "essencial" },
  "Transporte":   { ideal: 10, max: 15, tipo: "essencial" },
  "Saúde":        { ideal: 5,  max: 10, tipo: "essencial" },
  "Educação":     { ideal: 5,  max: 10, tipo: "investimento" },
  "Lazer":        { ideal: 10, max: 15, tipo: "variavel" },
  "Vestuário":    { ideal: 5,  max: 10, tipo: "variavel" },
  "Tecnologia":   { ideal: 5,  max: 8,  tipo: "variavel" },
  "Viagem":       { ideal: 5,  max: 10, tipo: "variavel" },
  "Delivery":     { ideal: 5,  max: 8,  tipo: "superfluo" },
  "Assinaturas":  { ideal: 3,  max: 5,  tipo: "superfluo" },
  "Investimento": { ideal: 20, max: 99, tipo: "investimento" },
  "Outros":       { ideal: 5,  max: 10, tipo: "variavel" }
};

function fmt(v) {
  if (v == null || isNaN(v)) return '0,00';
  return parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function analiseFinanceira(profile, despesasMes, contasFixas, ganhosExtras) {
  const totalGanhosExtras = (ganhosExtras || []).reduce((t, g) => t + (g.valor || 0), 0);
  const renda = (profile.salario || 0) + (profile.outras_rendas || 0) + totalGanhosExtras;

  const cats = {};
  (despesasMes || []).forEach(d => { cats[d.categoria] = (cats[d.categoria] || 0) + Number(d.valor); });

  const contas_total = (contasFixas || []).reduce((a, b) => a + Number(b.valor), 0);
  (contasFixas || []).forEach(c => {
    const cat = c.categoria || 'Outros';
    cats[cat] = (cats[cat] || 0) + Number(c.valor);
  });

  const total_gasto = (despesasMes || []).reduce((a, b) => a + Number(b.valor), 0) + contas_total;
  const total_credito = (despesasMes || [])
    .filter(d => d.forma_pagamento === 'credito' || d.forma_pagamento === 'parcelado')
    .reduce((a, b) => a + Number(b.valor), 0);

  let score = 100;
  const dicas = [];
  const pontos_fortes = [];
  const pct_gasto = renda > 0 ? (total_gasto / renda * 100) : 0;
  const pct_credito = renda > 0 ? (total_credito / renda * 100) : 0;
  const saldo = renda - total_gasto;

  const cats_analise = [];
  let total_superfluo = 0;

  for (const [cat, valor] of Object.entries(cats)) {
    const pct = renda > 0 ? (valor / renda * 100) : 0;
    const meta = METAS[cat] || { ideal: 5, max: 10, tipo: "variavel" };
    let status = "ok";
    if (pct > meta.max) { status = "alto"; score -= Math.min(10, (pct - meta.max) * 1.5); }
    else if (pct > meta.ideal) { status = "atenção"; score -= Math.min(5, (pct - meta.ideal) * 0.8); }
    if (meta.tipo === "superfluo") total_superfluo += valor;
    cats_analise.push({ categoria: cat, valor, pct: Math.round(pct*10)/10, ideal: meta.ideal, max: meta.max, status, tipo: meta.tipo });
  }

  if (renda > 0) {
    if (pct_gasto > 100) { dicas.push({ icone:"🚨", nivel:"critico", titulo:"Orçamento estourado!", texto:`Gastou R$ ${fmt(total_gasto-renda)} a mais.`, economia_possivel: Math.round((total_gasto-renda)*100)/100 }); score -= 25; }
    else if (pct_gasto > 85) { dicas.push({ icone:"⚠️", nivel:"alto", titulo:"Você está no limite", texto:`Comprometeu ${Math.round(pct_gasto)}% da renda.`, economia_possivel: Math.round(total_gasto*0.15*100)/100 }); score -= 15; }
    else if (pct_gasto < 50) { pontos_fortes.push("Você está gastando apenas " + Math.round(pct_gasto) + "% da renda — excelente!"); score += 5; }
  }
  if (pct_credito > 40) { dicas.push({ icone:"💳", nivel:"alto", titulo:"Uso excessivo de crédito", texto:`${Math.round(pct_credito)}% da renda no cartão.`, economia_possivel: Math.round(total_credito*0.3*100)/100 }); score -= 12; }
  const pct_sup = renda > 0 ? (total_superfluo/renda*100) : 0;
  if (pct_sup > 15) { dicas.push({ icone:"🛍️", nivel:"medio", titulo:"Gastos supérfluos altos", texto:`Delivery/assinaturas: ${Math.round(pct_sup)}% da renda.`, economia_possivel: Math.round(total_superfluo*0.4*100)/100 }); score -= 7; }
  for (const c of cats_analise) {
    if (c.status === "alto") dicas.push({ icone:"📊", nivel:"medio", titulo:`${c.categoria} acima do ideal`, texto:`${c.pct}% vs ideal ${c.ideal}%.`, economia_possivel: Math.round((c.valor-(renda*c.ideal/100))*100)/100 });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  let diagnostico = { icone:"🏆", texto:"Finanças exemplares!" };
  if (score < 85) diagnostico = { icone:"✅", texto:"Finanças saudáveis." };
  if (score < 70) diagnostico = { icone:"⚠️", texto:"Finanças precisam de atenção." };
  if (score < 50) diagnostico = { icone:"🚨", texto:"Situação crítica." };

  return {
    score, diagnostico,
    dicas: dicas.slice(0, 8),
    pontos_fortes: pontos_fortes.map(p => typeof p==='string' ? {icone:'✅',texto:p} : p),
    alertas: [],
    cats_analise: cats_analise.sort((a,b) => b.valor-a.valor),
    categorias: cats_analise.sort((a,b) => b.valor-a.valor),
    resumo: { renda, total_gasto, total_credito, saldo, pct_gasto: Math.round(pct_gasto*10)/10, pct_credito: Math.round(pct_credito*10)/10, total_superfluo }
  };
}

// ══════════════════════════════════════════════
//  window.DB — API pública
// ══════════════════════════════════════════════

window.DB = {

  init: async () => true,

  // ── ensureProfile ─────────────────────────────

  ensureProfile: async (nomePendente = null) => {
    const uid = getUserId();
    if (!uid) return true;
    try {
      const rows = await sbGet('profiles', `?id=eq.${uid}&limit=1`);
      if (rows.length > 0) {
        if (nomePendente) await sbPatch('profiles', `id=eq.${uid}`, { nome: nomePendente, updated_at: new Date().toISOString() });
        return true;
      }
      // Garantir registro na tabela users (FK em cartoes, contas_fixas, etc)
      const session = window.AUTH?.getSession?.();
      const email = session?.user?.email || '';
      const nome = nomePendente || session?.user?.user_metadata?.nome || 'Usuário';
      // users.id é UUID gerado, não igual ao auth.users.id
      // Verificar se já existe por email
      const userRows = await sbGet('users', `?email=eq.${encodeURIComponent(email)}&limit=1`);
      if (userRows.length === 0) {
        await sbPost('users', { id: uid, email, nome, subscription_status: 'inactive' }).catch(() => {});
      }
      // Criar profile (profiles.id = auth.users.id)
      await sbPost('profiles', {
        id: uid, nome, salario: 0, outras_rendas: 0,
        dia_pagamento: 5, tema: 'dark', tema_cor: 'roxo',
        tema_modo: 'escuro', onboarding_done: 0
      }).catch(() => {});
      return true;
    } catch(e) {
      console.error('[DB] ensureProfile:', e);
      return true; // nunca bloquear boot
    }
  },

  // ── Profile ───────────────────────────────────

  getProfile: async () => {
    const uid = getUserId();
    const session = window.AUTH?.getSession?.();
    const fallback = {
      id: 1, nome: session?.user?.user_metadata?.nome || 'Usuário',
      salario: 0, outras_rendas: 0, dia_pagamento: 5,
      tema: 'dark', tema_cor: 'roxo', tema_modo: 'escuro', onboarding_done: 0
    };
    if (!uid) return fallback;
    try {
      const rows = await sbGet('profiles', `?id=eq.${uid}&limit=1`);
      if (rows.length > 0) return { ...rows[0], id: 1 };
      return fallback;
    } catch(e) {
      return fallback;
    }
  },

  updateProfile: async (data) => {
    const uid = getUserId();
    if (!uid) return { ok: false };
    const { id, ...rest } = data;
    await sbUpsert('profiles', { ...rest, id: uid, updated_at: new Date().toISOString() });
    return { ok: true };
  },

  // ── Dashboard ─────────────────────────────────

  getDashboard: async (ano, mes) => {
    const uid = getUserId();
    const empty = { profile:{}, renda:0, total_gasto:0, saldo:0, pct_comprometido:0, por_categoria:[], cartoes:[], contas:[], total_fixo:0, historico:[], alertas:[], total_credito:0, historico_renda:[] };
    if (!uid) return empty;

    const daysInMonth = new Date(ano, mes, 0).getDate();
    const ini = `${ano}-${String(mes).padStart(2,'0')}-01`;
    const fim = `${ano}-${String(mes).padStart(2,'0')}-${daysInMonth}`;

    const [profileRows, ganhosExtras, cartoesList, contasList, despesasMes] = await Promise.all([
      sbGet('profiles', `?id=eq.${uid}&limit=1`),
      sbGet('ganhos_extras', `?user_id=eq.${uid}&order=created_at.asc`),
      sbGet('cartoes', `?user_id=eq.${uid}&order=created_at.asc`),
      sbGet('contas_fixas', `?user_id=eq.${uid}&order=created_at.asc`),
      sbGet('despesas', `?user_id=eq.${uid}&data=gte.${ini}&data=lte.${fim}&order=data.desc`)
    ]);

    const session = window.AUTH?.getSession?.();
    const fallback = { id:1, nome:'Usuário', salario:0, outras_rendas:0, dia_pagamento:5, tema:'dark', tema_cor:'roxo', tema_modo:'escuro', onboarding_done:0 };
    const profile = profileRows.length > 0 ? { ...profileRows[0], id:1 } : fallback;

    const totalGanhosExtras = ganhosExtras.reduce((t,g) => t+Number(g.valor||0), 0);
    const renda = Number(profile.salario||0) + Number(profile.outras_rendas||0) + totalGanhosExtras;

    // Por categoria
    const cats = {};
    despesasMes.forEach(d => { cats[d.categoria] = (cats[d.categoria]||0) + Number(d.valor); });
    const por_categoria = Object.entries(cats).map(([cat, total]) => ({ cat, total }));

    const total_fixo = contasList.reduce((a,b) => a+Number(b.valor), 0);
    const total_gasto = despesasMes.reduce((a,b) => a+Number(b.valor), 0) + total_fixo;
    const saldo = renda - total_gasto;
    const pct_comprometido = renda > 0 ? Math.round((total_gasto/renda*100)*10)/10 : 0;

    // Cartões — schema real: sem coluna "ativo", usa todos
    const hoje_str = `${ano}-${String(mes).padStart(2,'0')}-01`;
    const despesasFuturasCartao = await sbGet('despesas', `?user_id=eq.${uid}&data=gte.${hoje_str}`);

    const cartoes_data = cartoesList.map(cartao => {
      const faturaDoMes = despesasMes
        .filter(d => Number(d.cartao_id) === Number(cartao.id))
        .reduce((a,b) => a+Number(b.valor), 0);
      const totalComprometido = despesasFuturasCartao
        .filter(d => Number(d.cartao_id) === Number(cartao.id))
        .reduce((a,b) => a+Number(b.valor), 0);
      return {
        ...cartao,
        fatura: Math.round(faturaDoMes*100)/100,
        total_comprometido: Math.round(totalComprometido*100)/100,
        disponivel: Math.round((Number(cartao.limite_total)-totalComprometido)*100)/100,
        pct: cartao.limite_total > 0 ? Math.round((totalComprometido/Number(cartao.limite_total)*100)*10)/10 : 0
      };
    });

    // Histórico 6 meses
    const MESES_BR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const historico = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(ano, mes-1-i, 1);
      const y = d.getFullYear(); const m = d.getMonth()+1;
      const days = new Date(y, m, 0).getDate();
      const h0 = `${y}-${String(m).padStart(2,'0')}-01`;
      const h1 = `${y}-${String(m).padStart(2,'0')}-${days}`;
      const hist = await sbGet('despesas', `?user_id=eq.${uid}&data=gte.${h0}&data=lte.${h1}`);
      historico.push({ label:`${MESES_BR[m-1]}/${String(y).slice(2)}`, total: Math.round(hist.reduce((a,b)=>a+Number(b.valor),0)*100)/100 });
    }

    // Alertas
    await window.DB._gerarAlertas(uid, cartoesList, contasList, despesasMes, renda);
    const alertas = await sbGet('alertas', `?user_id=eq.${uid}&lido=eq.0&order=prioridade.asc&limit=15`);

    const total_credito = despesasMes
      .filter(d => d.forma_pagamento==='credito' || d.forma_pagamento==='parcelado')
      .reduce((a,b) => a+Number(b.valor), 0);

    return {
      profile,
      renda: Math.round(renda*100)/100,
      total_gasto: Math.round(total_gasto*100)/100,
      saldo: Math.round(saldo*100)/100,
      pct_comprometido,
      por_categoria,
      cartoes: cartoes_data,
      contas: contasList,
      total_fixo: Math.round(total_fixo*100)/100,
      historico,
      alertas,
      total_credito: Math.round(total_credito*100)/100,
      historico_renda: historico.map(h => ({ label: h.label, total: Number(profile.salario||0)+Number(profile.outras_rendas||0) }))
    };
  },

  // ── Dicas ─────────────────────────────────────

  getDicas: async (ano, mes) => {
    const uid = getUserId();
    const daysInMonth = new Date(ano, mes, 0).getDate();
    const ini = `${ano}-${String(mes).padStart(2,'0')}-01`;
    const fim = `${ano}-${String(mes).padStart(2,'0')}-${daysInMonth}`;
    const [profileRows, ganhosExtras, contasList, despesasMes] = await Promise.all([
      sbGet('profiles', `?id=eq.${uid}&limit=1`),
      sbGet('ganhos_extras', `?user_id=eq.${uid}`),
      sbGet('contas_fixas', `?user_id=eq.${uid}`),
      sbGet('despesas', `?user_id=eq.${uid}&data=gte.${ini}&data=lte.${fim}`)
    ]);
    const profile = profileRows[0] || { salario:0, outras_rendas:0 };
    return analiseFinanceira(profile, despesasMes, contasList, ganhosExtras);
  },

  // ── Cartões — schema real: sem "ativo" ─────────

  getCartoes: async () => {
    const uid = getUserId();
    return sbGet('cartoes', `?user_id=eq.${uid}&order=created_at.asc`);
  },

  addCartao: async (data) => {
    const uid = getUserId();
    const { ativo, ...rest } = data; // remover campo que não existe
    await sbPost('cartoes', { ...rest, user_id: uid });
    return { ok: true };
  },

  updateCartao: async (id, data) => {
    const uid = getUserId();
    const { ativo, ...rest } = data;
    await sbPatch('cartoes', `id=eq.${id}&user_id=eq.${uid}`, rest);
    return { ok: true };
  },

  deleteCartao: async (id) => {
    const uid = getUserId();
    // Schema não tem "ativo" — deletar de verdade
    await sbDelete('cartoes', `id=eq.${id}&user_id=eq.${uid}`);
    return { ok: true };
  },

  // ── Despesas ──────────────────────────────────

  getDespesas: async (ano, mes) => {
    const uid = getUserId();
    const daysInMonth = new Date(ano, mes, 0).getDate();
    const ini = `${ano}-${String(mes).padStart(2,'0')}-01`;
    const fim = `${ano}-${String(mes).padStart(2,'0')}-${daysInMonth}`;
    const [despesas, cartoes] = await Promise.all([
      sbGet('despesas', `?user_id=eq.${uid}&data=gte.${ini}&data=lte.${fim}&order=data.desc,id.desc`),
      sbGet('cartoes', `?user_id=eq.${uid}`)
    ]);
    return despesas.map(d => {
      const cartao = cartoes.find(c => Number(c.id) === Number(d.cartao_id));
      return { ...d, cn: cartao?.nome||null, cc: cartao?.cor||null };
    });
  },

  addDespesa: async (data) => {
    const uid = getUserId();
    const forma = data.forma_pagamento;
    const parcelas = parseInt(data.parcelas)||1;
    const valor = parseFloat(data.valor);
    const dataBase = new Date(data.data);
    const cartaoId = data.cartao_id ? parseInt(data.cartao_id) : null;

    if (forma === 'parcelado' && parcelas > 1) {
      const gid = Math.random().toString(36).substring(2,12);
      const vparcela = Math.round((valor/parcelas)*100)/100;
      const batch = [];
      for (let i = 0; i < parcelas; i++) {
        const dp = new Date(dataBase); dp.setMonth(dp.getMonth()+i);
        batch.push({ user_id:uid, nome:`${data.nome} (${i+1}/${parcelas})`, valor:vparcela, data:dp.toISOString().split('T')[0], categoria:data.categoria, forma_pagamento:forma, cartao_id:cartaoId, parcelas_total:parcelas, parcela_atual:i+1, grupo_id:gid, observacao:data.observacao||'' });
      }
      await sbPost('despesas', batch);
    } else {
      await sbPost('despesas', { user_id:uid, nome:data.nome, valor, data:data.data, categoria:data.categoria, forma_pagamento:forma, cartao_id:cartaoId, parcelas_total:1, parcela_atual:1, grupo_id:null, observacao:data.observacao||'' });
    }
    return { ok: true };
  },

  deleteDespesa: async (id) => {
    const uid = getUserId();
    const rows = await sbGet('despesas', `?id=eq.${id}&user_id=eq.${uid}&limit=1`);
    if (rows.length > 0 && rows[0].grupo_id) {
      await sbDelete('despesas', `grupo_id=eq.${rows[0].grupo_id}&user_id=eq.${uid}`);
    } else {
      await sbDelete('despesas', `id=eq.${id}&user_id=eq.${uid}`);
    }
    return { ok: true };
  },

  // ── Contas Fixas — sem "ativo" no schema ──────

  getContas: async () => {
    const uid = getUserId();
    return sbGet('contas_fixas', `?user_id=eq.${uid}&order=created_at.asc`);
  },

  addConta: async (data) => {
    const uid = getUserId();
    const { ativo, ...rest } = data;
    await sbPost('contas_fixas', { ...rest, user_id: uid });
    return { ok: true };
  },

  updateConta: async (id, data) => {
    const uid = getUserId();
    const { ativo, ...rest } = data;
    await sbPatch('contas_fixas', `id=eq.${id}&user_id=eq.${uid}`, rest);
    return { ok: true };
  },

  deleteConta: async (id) => {
    const uid = getUserId();
    await sbDelete('contas_fixas', `id=eq.${id}&user_id=eq.${uid}`);
    return { ok: true };
  },

  // ── Histórico ─────────────────────────────────

  getHistorico: async () => {
    const uid = getUserId();
    const MESES_BR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
    const hoje = new Date();
    const result = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth()-i, 1);
      const y = d.getFullYear(); const m = d.getMonth()+1;
      const days = new Date(y, m, 0).getDate();
      const h0 = `${y}-${String(m).padStart(2,'0')}-01`;
      const h1 = `${y}-${String(m).padStart(2,'0')}-${days}`;
      const hist = await sbGet('despesas', `?user_id=eq.${uid}&data=gte.${h0}&data=lte.${h1}`);
      const totalHist = hist.reduce((a,b) => a+Number(b.valor), 0);
      const cats = {};
      hist.forEach(d => { cats[d.categoria] = (cats[d.categoria]||0)+Number(d.valor); });
      result.push({ ano:y, mes:m, label:`${MESES_BR[m-1]}/${String(y).slice(2)}`, total:Math.round(totalHist*100)/100, cats:Object.fromEntries(Object.entries(cats).map(([k,v])=>[k,Math.round(v*100)/100])) });
    }
    return result;
  },

  // ── Alertas ───────────────────────────────────

  limparAlertas: async () => {
    const uid = getUserId();
    await sbPatch('alertas', `user_id=eq.${uid}`, { lido: 1 });
    return { ok: true };
  },

  _gerarAlertas: async (uid, cartoes, contas, despesasMes, renda) => {
    if (!uid) return;
    await sbDelete('alertas', `user_id=eq.${uid}&lido=eq.0`);
    const batch = [];
    const diaHoje = new Date().getDate();

    for (const c of (cartoes||[])) {
      const dias = c.dia_vencimento - diaHoje;
      if (dias > 0 && dias <= 5) batch.push({ user_id:uid, tipo:'vencimento', mensagem:`💳 ${c.nome} vence em ${dias} dia(s)`, prioridade:1, lido:0 });
    }
    for (const c of (contas||[])) {
      const dias = c.dia_vencimento - diaHoje;
      if (dias > 0 && dias <= 3) batch.push({ user_id:uid, tipo:'conta_fixa', mensagem:`⚡ ${c.nome} vence em ${dias} dia(s) — R$ ${fmt(c.valor)}`, prioridade:1, lido:0 });
    }
    for (const c of (cartoes||[])) {
      const usadoCartao = (despesasMes||[]).filter(d=>Number(d.cartao_id)===Number(c.id)).reduce((a,b)=>a+Number(b.valor),0);
      const pct = c.limite_total > 0 ? (usadoCartao/Number(c.limite_total))*100 : 0;
      if (pct > 80) batch.push({ user_id:uid, tipo:'limite', mensagem:`⚠️ ${c.nome}: ${Math.round(pct)}% do limite usado`, prioridade:pct>95?1:2, lido:0 });
    }
    const totalGasto = (despesasMes||[]).reduce((a,b)=>a+Number(b.valor),0);
    const pctGasto = renda > 0 ? (totalGasto/renda*100) : 0;
    if (pctGasto > 85) batch.push({ user_id:uid, tipo:'orcamento', mensagem:`🚨 Você já gastou ${Math.round(pctGasto)}% da renda do mês`, prioridade:1, lido:0 });

    if (batch.length > 0) await sbPost('alertas', batch).catch(()=>{});
  },

  // ── Ganhos Extras — sem "ativo" no schema ─────

  getGanhosExtras: async () => {
    const uid = getUserId();
    return sbGet('ganhos_extras', `?user_id=eq.${uid}&order=created_at.asc`);
  },

  addGanhoExtra: async (data) => {
    const uid = getUserId();
    const { ativo, ...rest } = data;
    await sbPost('ganhos_extras', { ...rest, user_id: uid });
    return { ok: true };
  },

  updateGanhoExtra: async (id, data) => {
    const uid = getUserId();
    const { ativo, ...rest } = data;
    await sbPatch('ganhos_extras', `id=eq.${id}&user_id=eq.${uid}`, rest);
    return { ok: true };
  },

  deleteGanhoExtra: async (id) => {
    const uid = getUserId();
    await sbDelete('ganhos_extras', `id=eq.${id}&user_id=eq.${uid}`);
    return { ok: true };
  },

  getTotalGanhosExtras: async () => {
    const uid = getUserId();
    const ganhos = await sbGet('ganhos_extras', `?user_id=eq.${uid}`);
    return ganhos.reduce((t,g) => t+Number(g.valor||0), 0);
  },

  // ── Investimentos — schema real ────────────────
  // Colunas: id, user_id, local_id, nome, tipo, valor_aportado,
  //          valor_atual, rentabilidade_info, observacao, synced_at, created_at

  getInvestimentos: async () => {
    const uid = getUserId();
    return sbGet('investimentos', `?user_id=eq.${uid}&order=created_at.asc`);
  },

  addInvestimento: async (data) => {
    const uid = getUserId();
    await sbPost('investimentos', {
      user_id: uid,
      nome: data.nome,
      tipo: data.tipo || '',
      valor_aportado: data.valor_inicial || data.valor_aportado || 0,
      valor_atual: data.valor_atual || data.valor_inicial || data.valor_aportado || 0,
      rentabilidade_info: data.rentabilidade_info || String(data.rentabilidade || ''),
      observacao: data.observacao || ''
    });
    return { ok: true };
  },

  updateInvestimento: async (id, data) => {
    const uid = getUserId();
    const patch = {};
    if (data.nome !== undefined) patch.nome = data.nome;
    if (data.tipo !== undefined) patch.tipo = data.tipo;
    if (data.valor_aportado !== undefined) patch.valor_aportado = data.valor_aportado;
    if (data.valor_inicial !== undefined) patch.valor_aportado = data.valor_inicial;
    if (data.valor_atual !== undefined) patch.valor_atual = data.valor_atual;
    if (data.rentabilidade !== undefined) patch.rentabilidade_info = String(data.rentabilidade);
    if (data.rentabilidade_info !== undefined) patch.rentabilidade_info = data.rentabilidade_info;
    if (data.observacao !== undefined) patch.observacao = data.observacao;
    await sbPatch('investimentos', `id=eq.${id}&user_id=eq.${uid}`, patch);
    return { ok: true };
  },

  deleteInvestimento: async (id) => {
    const uid = getUserId();
    await sbDelete('investimentos', `id=eq.${id}&user_id=eq.${uid}`);
    return { ok: true };
  },

  addAporteInvestimento: async (id, valor) => {
    const uid = getUserId();
    const rows = await sbGet('investimentos', `?id=eq.${id}&user_id=eq.${uid}&limit=1`);
    if (!rows.length) return { ok: false };
    const inv = rows[0];
    const novoAportado = Number(inv.valor_aportado||0) + Number(valor);
    const novoAtual = Number(inv.valor_atual||0) + Number(valor);
    await sbPatch('investimentos', `id=eq.${id}&user_id=eq.${uid}`, {
      valor_aportado: novoAportado,
      valor_atual: novoAtual,
      synced_at: new Date().toISOString()
    });
    return { ok: true };
  }
};
