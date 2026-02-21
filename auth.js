/**
 * FinFinance Auth v3 — Supabase
 * - Sessão via sessionStorage (não localStorage)
 * - Verificação de assinatura real
 * - Aceita token via query param (vindo da landing)
 */

const SUPABASE_URL = "https://glpxntvclbshupueqglf.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Mxk806sE8KHBNCbDsvnIew_wx8KeUBv";
const LANDING_URL = "https://finfinance-landing.vercel.app";
const CHECKOUT_URL = `${LANDING_URL}/checkout`;
const LOGIN_URL = `${LANDING_URL}/login`;

async function supabaseSignIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error('Email ou senha incorretos.');
  }
  return data;
}

async function supabaseSignUp(email, password, nome) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password, data: { nome } })
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.msg || data?.error_description || data?.message || '';
    if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists')) {
      throw new Error('Este email já está cadastrado. Faça login.');
    }
    throw new Error(msg || 'Erro ao criar conta.');
  }
  return data;
}

async function supabaseSignOut(accessToken) {
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`
    }
  }).catch(() => {});
}

async function fetchSubscription(userId, accessToken) {
  const headers = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  };

  try {
    // Tentativa 1: buscar diretamente por id (funciona se trigger sincronizou ids)
    const r1 = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=subscription_status,plan_type,subscription_expires_at`,
      { headers }
    );
    if (r1.ok) {
      const d1 = await r1.json();
      if (d1?.length > 0) return d1[0];
    }

    // Tentativa 2: buscar por email via auth/user
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers });
    if (!userRes.ok) return null;
    const userInfo = await userRes.json();
    const email = userInfo?.email;
    if (!email) return null;

    const r2 = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=subscription_status,plan_type,subscription_expires_at`,
      { headers }
    );
    if (r2.ok) {
      const d2 = await r2.json();
      if (d2?.length > 0) return d2[0];
    }

    return null;
  } catch {
    return null;
  }
}

// ── Sessão via sessionStorage ─────────────────────────────────

function saveSession(data) {
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: data.user,
    expires_at: Date.now() + ((data.expires_in || 3600) * 1000),
    subscription_status: data.subscription_status || 'inactive',
    plan_type: data.plan_type || null,
    subscription_expires_at: data.subscription_expires_at || null,
  };
  sessionStorage.setItem('ff_auth_session', JSON.stringify(session));
}

function updateSessionSubscription(sub) {
  try {
    const raw = sessionStorage.getItem('ff_auth_session');
    if (!raw) return;
    const s = JSON.parse(raw);
    s.subscription_status = sub.subscription_status;
    s.plan_type = sub.plan_type;
    s.subscription_expires_at = sub.subscription_expires_at;
    sessionStorage.setItem('ff_auth_session', JSON.stringify(s));
  } catch {}
}

function getSession() {
  try {
    const raw = sessionStorage.getItem('ff_auth_session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s.access_token) return null;
    if (Date.now() > s.expires_at) {
      sessionStorage.removeItem('ff_auth_session');
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem('ff_auth_session');
}

async function checkSubscription() {
  const session = getSession();
  if (!session) return { status: 'unauthenticated' };

  const sub = await fetchSubscription(session.user.id, session.access_token);
  if (!sub) {
    return { status: session.subscription_status || 'inactive', plan: session.plan_type, cached: true };
  }

  updateSessionSubscription(sub);

  return {
    status: sub.subscription_status,
    plan: sub.plan_type,
    expires_at: sub.subscription_expires_at,
    never_subscribed: sub.subscription_expires_at === null
  };
}

// ── Token via URL (vindo da landing) ─────────────────────────

async function handleTokenFromURL() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const refresh = params.get('refresh');
  if (!token) return false;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) return false;
    const user = await res.json();

    const sub = await fetchSubscription(user.id, token);

    const sessionData = {
      access_token: token,
      refresh_token: refresh || '',
      user,
      expires_in: 3600,
      subscription_status: sub?.subscription_status || 'inactive',
      plan_type: sub?.plan_type || null,
      subscription_expires_at: sub?.subscription_expires_at || null,
    };

    saveSession(sessionData);

    // Limpar query string da URL
    window.history.replaceState({}, document.title, window.location.pathname);
    return true;
  } catch {
    return false;
  }
}

// ── UI ────────────────────────────────────────────────────────

function showAuthScreen() {
  const splash = document.getElementById('splash');
  if (splash) splash.remove();
  const el = document.getElementById('auth-screen');
  if (el) el.style.display = 'flex';
}

function hideAuthScreen() {
  const el = document.getElementById('auth-screen');
  if (el) el.style.display = 'none';
  const splash = document.getElementById('splash');
  if (splash) splash.style.display = 'flex';
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  const activeTab = document.querySelector(`.auth-tab[data-tab="${tab}"]`);
  if (activeTab) activeTab.classList.add('active');
  const loginForm = document.getElementById('auth-form-login');
  const registerForm = document.getElementById('auth-form-register');
  if (loginForm) loginForm.style.display = tab === 'login' ? 'flex' : 'none';
  if (registerForm) registerForm.style.display = tab === 'register' ? 'flex' : 'none';
  setAuthError('');
}

function setAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

function setAuthLoading(btn, loading, originalText) {
  if (!btn) return;
  btn.disabled = loading;
  btn.style.opacity = loading ? '0.65' : '1';
  btn.style.cursor = loading ? 'not-allowed' : 'pointer';
  if (loading) {
    btn.innerHTML = '<span class="auth-spinner"></span> Aguarde...';
  } else {
    btn.textContent = originalText;
  }
}

// ── Handlers ─────────────────────────────────────────────────

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-login');
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;

  if (!email || !password) { setAuthError('Preencha email e senha.'); return; }

  setAuthError('');
  setAuthLoading(btn, true, 'Entrar');

  try {
    const data = await supabaseSignIn(email, password);
    const sub = await fetchSubscription(data.user.id, data.access_token);
    data.subscription_status = sub?.subscription_status || 'inactive';
    data.plan_type = sub?.plan_type || null;
    data.subscription_expires_at = sub?.subscription_expires_at || null;
    saveSession(data);
    hideAuthScreen();
    window._bootFinFinance();
  } catch (err) {
    setAuthError(err.message);
  } finally {
    setAuthLoading(btn, false, 'Entrar');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-register');
  const nome = document.getElementById('reg-nome').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  if (!nome || !email || !password) { setAuthError('Preencha todos os campos.'); return; }
  if (password.length < 6) { setAuthError('A senha precisa ter pelo menos 6 caracteres.'); return; }

  setAuthError('');
  setAuthLoading(btn, true, 'Criar minha conta');

  try {
    const signUpData = await supabaseSignUp(email, password, nome);

    // Verificar se Supabase exige confirmação de email
    if (!signUpData?.access_token) {
      // Email de confirmação enviado — avisar usuário, não tentar fazer login
      setAuthLoading(btn, false, 'Criar minha conta');
      setAuthError('');
      // Mostrar mensagem de sucesso pedindo confirmação
      const errEl = document.getElementById('auth-error');
      if (errEl) {
        errEl.style.background = 'rgba(16,185,129,0.12)';
        errEl.style.borderColor = 'rgba(16,185,129,0.3)';
        errEl.style.color = '#10b981';
        errEl.textContent = '✅ Conta criada! Verifique seu email para confirmar o cadastro, depois faça login.';
        errEl.style.display = 'block';
      }
      // Trocar para aba de login
      setTimeout(() => switchAuthTab('login'), 3000);
      return;
    }

    // Confirmação de email desativada — access_token disponível direto
    const data = signUpData;
    const sub = await fetchSubscription(data.user.id, data.access_token);
    data.subscription_status = sub?.subscription_status || 'inactive';
    data.plan_type = sub?.plan_type || null;
    data.subscription_expires_at = sub?.subscription_expires_at || null;
    saveSession(data);
    window._pendingNome = nome;
    hideAuthScreen();
    window._bootFinFinance();
  } catch (err) {
    setAuthError(err.message);
  } finally {
    setAuthLoading(btn, false, 'Criar minha conta');
  }
}

async function handleLogout() {
  const session = getSession();
  if (session?.access_token) {
    await supabaseSignOut(session.access_token);
  }
  clearSession();
  location.reload();
}


// ── Reset de senha ────────────────────────────────────────────

async function handleForgotPassword(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-forgot');
  const email = document.getElementById('forgot-email').value.trim();
  if (!email) { setAuthError('Digite seu email.'); return; }

  setAuthError('');
  setAuthLoading(btn, true, 'Enviar link');

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email })
    });

    setAuthLoading(btn, false, 'Enviar link');

    const errEl = document.getElementById('auth-error');
    if (errEl) {
      errEl.style.background = 'rgba(16,185,129,0.12)';
      errEl.style.borderColor = 'rgba(16,185,129,0.3)';
      errEl.style.color = '#10b981';
      errEl.textContent = '✅ Link de recuperação enviado! Verifique seu email.';
      errEl.style.display = 'block';
    }
    // Voltar para login após 3s
    setTimeout(() => {
      switchAuthTab('login');
      resetErrorStyle();
    }, 3000);
  } catch(err) {
    setAuthLoading(btn, false, 'Enviar link');
    setAuthError('Erro ao enviar email. Tente novamente.');
  }
}

function resetErrorStyle() {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.style.background = 'rgba(239,68,68,0.12)';
  el.style.borderColor = 'rgba(239,68,68,0.3)';
  el.style.color = '#f87171';
  el.style.display = 'none';
}

function showForgotPassword() {
  document.getElementById('auth-form-login').style.display = 'none';
  document.getElementById('auth-form-register').style.display = 'none';
  document.getElementById('auth-form-forgot').style.display = 'flex';
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  resetErrorStyle();
}

function hideForgotPassword() {
  document.getElementById('auth-form-forgot').style.display = 'none';
  switchAuthTab('login');
  resetErrorStyle();
}

// ── Exposição global ──────────────────────────────────────────

window.AUTH = {
  getSession,
  handleLogout,
  checkSubscription,
  fetchSubscription,
  CHECKOUT_URL,
  LOGIN_URL,
};

// ── Boot ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  const tokenFromURL = await handleTokenFromURL();

  if (tokenFromURL) {
    // Token da URL processado — bootar app
    if (window._bootFinFinance) window._bootFinFinance();
    return;
  }

  const session = getSession();
  if (session) {
    // Sessão existente — bootar app
    if (window._bootFinFinance) window._bootFinFinance();
  } else {
    // Sem sessão — mostrar login (splash removido pelo showAuthScreen)
    showAuthScreen();
  }
});
