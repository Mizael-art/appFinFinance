/**
 * FinFinance — Webhook Kiwify (produção)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const KIWIFY_TOKEN = process.env.KIWIFY_WEBHOOK_TOKEN;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;

  // Kiwify envia token no body como webhook_token
  const tokenRecebido =
    body?.webhook_token ||
    body?.token ||
    req.query?.token ||
    req.headers?.['x-kiwify-token'];

  if (KIWIFY_TOKEN && tokenRecebido !== KIWIFY_TOKEN) {
    console.error('[Webhook] Token inválido:', tokenRecebido);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const email =
      body?.Customer?.email ||
      body?.customer?.email ||
      body?.buyer?.email ||
      body?.email ||
      body?.customer_email;

    const status =
      body?.order_status ||
      body?.status ||
      body?.event ||
      body?.type || '';

    const planName =
      body?.Product?.name ||
      body?.product?.name ||
      body?.plan?.name ||
      'mensal';

    console.log('[Webhook] Email:', email, '| Status:', status, '| Plano:', planName);

    if (!email) {
      console.error('[Webhook] Email não encontrado');
      return res.status(200).json({ ok: true });
    }

    // Mapear status
    let subscription_status = 'inactive';
    let expires_at = null;
    const s = status.toLowerCase();

    if (s.includes('paid') || s.includes('approved') || s.includes('active')) {
      subscription_status = 'active';
      const months = planName.toLowerCase().includes('anual') ? 12 : 1;
      const exp = new Date();
      exp.setMonth(exp.getMonth() + months);
      expires_at = exp.toISOString();
    }

    // Mapear plano
    let plan_type = 'mensal';
    const pn = planName.toLowerCase();
    if (pn.includes('anual')) plan_type = 'anual';
    if (pn.includes('fundador') || pn.includes('founder')) plan_type = 'fundador';

    // Atualizar Supabase
    const updateRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({ subscription_status, plan_type, subscription_expires_at: expires_at })
      }
    );

    const updated = await updateRes.json();

    // Se não existia ainda, criar
    if (!updated || updated.length === 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
        },
        body: JSON.stringify({
          email,
          nome: body?.Customer?.name || body?.customer?.name || 'Usuário',
          subscription_status,
          plan_type,
          subscription_expires_at: expires_at
        })
      });
      console.log('[Webhook] Novo usuário criado:', email);
    }

    console.log('[Webhook] ✅', email, '→', subscription_status);
    return res.status(200).json({ ok: true, email, subscription_status, plan_type });

  } catch (err) {
    console.error('[Webhook] Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
