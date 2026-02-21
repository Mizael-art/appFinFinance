/**
 * FinFinance — Webhook Kiwify
 * Vercel Serverless Function: /api/webhook-kiwify
 * 
 * Kiwify envia POST aqui quando alguém compra, cancela ou tem chargeback.
 * Atualiza public.users no Supabase com o status da assinatura.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // service_role key (bypassa RLS)
const KIWIFY_TOKEN = process.env.KIWIFY_WEBHOOK_TOKEN; // token secreto que você define na Kiwify

export default async function handler(req, res) {
  // Só aceitar POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verificar token de segurança (query param ?token=SEU_TOKEN)
  const token = req.query.token;
  if (KIWIFY_TOKEN && token !== KIWIFY_TOKEN) {
    console.error('[Webhook] Token inválido:', token);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body;
  console.log('[Webhook] Payload recebido:', JSON.stringify(body, null, 2));

  try {
    // ── Extrair dados do payload da Kiwify ─────────────────
    const status = body?.order_status;         // 'paid', 'refunded', 'chargedback', 'cancelled'
    const email  = body?.Customer?.email        // email do comprador
                || body?.customer?.email
                || body?.email;

    const planName = body?.Product?.name        // nome do produto na Kiwify
                  || body?.product?.name
                  || 'mensal';

    if (!email) {
      console.error('[Webhook] Email não encontrado no payload');
      return res.status(400).json({ error: 'Email not found in payload' });
    }

    // ── Mapear status da Kiwify → status no banco ──────────
    let subscription_status = 'inactive';
    let expires_at = null;

    if (status === 'paid' || status === 'approved' || status === 'active') {
      subscription_status = 'active';
      // Calcular vencimento baseado no plano
      const months = planName.toLowerCase().includes('anual') ? 12 : 1;
      const expDate = new Date();
      expDate.setMonth(expDate.getMonth() + months);
      expires_at = expDate.toISOString();
    } else if (status === 'refunded' || status === 'chargedback' || status === 'cancelled') {
      subscription_status = 'inactive';
    }

    // ── Mapear nome do plano ────────────────────────────────
    let plan_type = 'mensal';
    const pn = planName.toLowerCase();
    if (pn.includes('anual') || pn.includes('annual')) plan_type = 'anual';
    if (pn.includes('fundador') || pn.includes('founder')) plan_type = 'fundador';

    console.log(`[Webhook] ${email} → ${subscription_status} (${plan_type})`);

    // ── Atualizar Supabase ──────────────────────────────────
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
        body: JSON.stringify({
          subscription_status,
          plan_type,
          subscription_expires_at: expires_at
        })
      }
    );

    const updated = await updateRes.json();

    // Se não encontrou o usuário (ainda não tem conta), criar registro
    if (!updated || updated.length === 0) {
      console.log('[Webhook] Usuário não encontrado, criando registro...');
      await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=representation'
        },
        body: JSON.stringify({
          email,
          nome: body?.Customer?.name || body?.customer?.name || 'Usuário',
          subscription_status,
          plan_type,
          subscription_expires_at: expires_at
        })
      });
    }

    console.log(`[Webhook] ✅ Atualizado: ${email} → ${subscription_status}`);
    return res.status(200).json({ ok: true, email, subscription_status, plan_type });

  } catch (err) {
    console.error('[Webhook] Erro:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
