/**
 * FinFinance — API criar conta pós-compra
 * Chamada pela landing page após pagamento confirmado
 * Cria usuário no Supabase Auth usando Admin API
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  // CORS para a landing page
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, nome } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email e senha obrigatórios' });

  try {
    // 1. Criar usuário no Supabase Auth (Admin API)
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // confirmar email automaticamente
        user_metadata: { nome: nome || 'Usuário' }
      })
    });

    const authData = await authRes.json();

    if (!authRes.ok) {
      // Usuário já existe — só retornar ok (ele pode fazer login normal)
      if (authData?.msg?.includes('already') || authData?.error?.includes('already')) {
        return res.status(200).json({ ok: true, message: 'Conta já existe, faça login' });
      }
      return res.status(400).json({ error: authData?.msg || 'Erro ao criar conta' });
    }

    const uid = authData.id;

    // 2. Sincronizar id em public.users (webhook pode ter criado com uuid diferente)
    await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({ id: uid, nome: nome || 'Usuário' })
      }
    );

    return res.status(200).json({ ok: true, message: 'Conta criada com sucesso' });

  } catch (err) {
    console.error('[criar-conta]', err);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
