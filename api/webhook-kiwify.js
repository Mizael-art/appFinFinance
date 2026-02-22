/**
 * FinFinance — Webhook Kiwify
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body;

  // Logar TUDO para diagnóstico
  console.log('[Webhook] Headers:', JSON.stringify(req.headers));
  console.log('[Webhook] Query:', JSON.stringify(req.query));
  console.log('[Webhook] Body:', JSON.stringify(body));

  try {
    // Extrair email — Kiwify usa vários formatos
    const email =
      body?.Customer?.email ||
      body?.customer?.email ||
      body?.buyer?.email ||
      body?.Buyer?.email ||
      body?.email ||
      body?.customer_email;

    const status =
      body?.order_status ||
      body?.status ||
      body?.event ||
      body?.type;

    const planName =
      body?.Product?.name ||
      body?.product?.name ||
      body?.plan?.name ||
      'mensal';

    console.log('[Webhook] Email:', email, '| Status:', status, '| Plano:', planName);

    if (!email) {
      return res.status(200).json({ ok: true, aviso: 'email não encontrado', body });
    }

    // Mapear status
    let subscription_status = 'inactive';
    let expires_at = null;
    const s = (status || '').toLowerCase();

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
    console.log('[Webhook] Supabase resposta:', JSON.stringify(updated));

    // Se não existia, criar
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

    return res.status(200).json({ ok: true, email, subscription_status, plan_type });

  } catch (err) {
    console.error('[Webhook] Erro:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
