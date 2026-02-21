/**
 * FinFinance — plan-badge.js
 * Badge de plano no header
 */
(function () {
  const STYLES = `
    #ff-plan-badge {
      display: inline-flex; align-items: center;
      font-size: 0.6rem; font-weight: 800;
      letter-spacing: 0.08em; text-transform: uppercase;
      padding: 2px 7px; border-radius: 5px;
      margin-left: 6px; vertical-align: middle;
      border: 1px solid transparent;
    }
    #ff-plan-badge.badge-mensal  { background: rgba(16,185,129,0.15); color: #10b981; border-color: rgba(16,185,129,0.3); }
    #ff-plan-badge.badge-anual   { background: rgba(59,130,246,0.15); color: #60a5fa; border-color: rgba(59,130,246,0.3); }
    #ff-plan-badge.badge-fundador{ background: rgba(245,158,11,0.15); color: #f59e0b; border-color: rgba(245,158,11,0.3); }
    #ff-plan-badge.badge-inativo { background: rgba(239,68,68,0.15);  color: #f87171; border-color: rgba(239,68,68,0.3);  }
  `;

  const MAP = {
    mensal:   { label: 'MENSAL',  cls: 'badge-mensal' },
    anual:    { label: 'PRO',     cls: 'badge-anual' },
    annual:   { label: 'PRO',     cls: 'badge-anual' },
    fundador: { label: 'FUNDADOR',cls: 'badge-fundador' },
  };

  function injectStyles() {
    if (document.getElementById('ff-badge-styles')) return;
    const s = document.createElement('style');
    s.id = 'ff-badge-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  function renderBadge(plan, status) {
    injectStyles();
    const el = document.getElementById('ff-plan-badge');
    if (!el) return;
    el.className = '';
    el.removeAttribute('class');

    if (status !== 'active') {
      el.textContent = 'INATIVO';
      el.className = 'badge-inativo';
      el.id = 'ff-plan-badge';
      return;
    }

    const badge = MAP[plan?.toLowerCase()] || { label: 'ATIVO', cls: 'badge-mensal' };
    el.textContent = badge.label;
    el.className = badge.cls;
    el.id = 'ff-plan-badge';
  }

  function updateBadgeFromSession() {
    const session = window.AUTH?.getSession?.();
    if (!session) return;
    renderBadge(session.plan_type, session.subscription_status);
  }

  window.PlanBadge = { renderBadge, updateBadgeFromSession };
})();
