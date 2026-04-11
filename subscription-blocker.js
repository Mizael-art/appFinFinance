/**
 * FinFinance — subscription-blocker.js
 * Modal de bloqueio por assinatura
 */
(function () {
  const CHECKOUT_URL = 'https://finfinance-landing.vercel.app/checkout';

  const STYLES = `
    #ff-blocker-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 99999;
      background: rgba(0,0,0,0.78);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    #ff-blocker-overlay.active { display: flex; }
    #ff-blocker-card {
      background: linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);
      border: 1px solid rgba(139,92,246,0.3);
      border-radius: 24px;
      padding: 2.5rem 2rem;
      max-width: 420px;
      width: 100%;
      position: relative;
      box-shadow: 0 25px 60px rgba(0,0,0,0.6), 0 0 40px rgba(139,92,246,0.1);
      animation: ff-slide-up 0.25s ease;
      text-align: center;
    }
    @keyframes ff-slide-up {
      from { transform: translateY(20px); opacity: 0; }
      to   { transform: translateY(0);    opacity: 1; }
    }
    #ff-blocker-close {
      position: absolute; top: 1rem; right: 1rem;
      background: rgba(255,255,255,0.1); border: none;
      color: #94a3b8; width: 32px; height: 32px;
      border-radius: 50%; font-size: 16px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: all .2s; line-height: 1;
    }
    #ff-blocker-close:hover { background: rgba(255,255,255,0.2); color: #fff; }
    #ff-blocker-icon {
      width: 68px; height: 68px;
      background: linear-gradient(135deg,#7c3aed,#4f46e5);
      border-radius: 20px; font-size: 30px;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 1.5rem;
    }
    #ff-blocker-title {
      font-size: 1.45rem; font-weight: 800;
      color: #f1f5f9; margin: 0 0 0.75rem; line-height: 1.3;
    }
    #ff-blocker-text {
      font-size: 0.95rem; color: #94a3b8;
      margin: 0 0 2rem; line-height: 1.65;
    }
    #ff-blocker-btn {
      display: flex; align-items: center; justify-content: center;
      gap: 0.5rem; width: 100%;
      padding: 0.95rem 1.5rem;
      background: linear-gradient(135deg,#10b981,#059669);
      color: #fff; font-size: 1rem; font-weight: 700;
      border: none; border-radius: 14px; cursor: pointer;
      transition: all .2s; text-decoration: none;
      box-shadow: 0 4px 20px rgba(16,185,129,0.35);
    }
    #ff-blocker-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 28px rgba(16,185,129,0.5);
    }
    body.ff-blocked > *:not(#ff-blocker-overlay):not(style):not(script) {
      pointer-events: none !important;
      user-select: none !important;
    }
    body.ff-blocked #app,
    body.ff-blocked #onboarding,
    body.ff-blocked .bottom-nav,
    body.ff-blocked .main,
    body.ff-blocked header,
    body.ff-blocked nav {
      filter: blur(3px);
      opacity: 0.4;
    }
    #ff-blocker-overlay {
      z-index: 999999 !important;
    }
  `;

  function createModal() {
    if (document.getElementById('ff-blocker-overlay')) return;
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'ff-blocker-overlay';
    overlay.innerHTML = `
      <div id="ff-blocker-card">
        <button id="ff-blocker-close" title="Fechar">✕</button>
        <div id="ff-blocker-icon">🔒</div>
        <h2 id="ff-blocker-title">Sua assinatura está inativa</h2>
        <p id="ff-blocker-text">Renove sua assinatura para continuar usando o FinFinance.</p>
        <a id="ff-blocker-btn" href="${CHECKOUT_URL}" target="_blank">💳 Renovar assinatura</a>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('ff-blocker-close').addEventListener('click', () => {
      // Fechar modal e voltar para o login
      overlay.classList.remove('active');
      document.body.classList.remove('ff-blocked');
      // Fazer logout e mostrar tela de login
      if (window.AUTH?.handleLogout) {
        window.AUTH.handleLogout();
      } else {
        sessionStorage.removeItem('ff_auth_session');
        location.reload();
      }
    });

    // reabrir modal se tentar interagir com conteúdo bloqueado (sem usar X)
    document.addEventListener('click', (e) => {
      if (
        document.body.classList.contains('ff-blocked') &&
        !overlay.contains(e.target) &&
        !overlay.classList.contains('active')
      ) {
        overlay.classList.add('active');
      }
    }, true);
  }

  function showBlocker({ neverSubscribed = false } = {}) {
    const overlay = document.getElementById('ff-blocker-overlay');
    if (!overlay) return;
    const title = document.getElementById('ff-blocker-title');
    const text  = document.getElementById('ff-blocker-text');
    const btn   = document.getElementById('ff-blocker-btn');

    if (neverSubscribed) {
      title.textContent = 'Você ainda não possui assinatura';
      text.textContent  = 'Assine agora para desbloquear todos os recursos do FinFinance.';
      btn.innerHTML = '🚀 Assinar agora';
    } else {
      title.textContent = 'Sua assinatura está inativa';
      text.textContent  = 'Renove sua assinatura para continuar usando o FinFinance.';
      btn.innerHTML = '💳 Renovar assinatura';
    }

    overlay.classList.add('active');
  }

  function applySubscriptionBlock(sub) {
    createModal();
    if (!sub || sub.status !== 'active') {
      document.body.classList.add('ff-blocked');
      showBlocker({ neverSubscribed: sub?.never_subscribed === true || !sub?.expires_at });
      return true;
    }
    document.body.classList.remove('ff-blocked');
    return false;
  }

  window.SubscriptionBlocker = { applySubscriptionBlock, showBlocker, createModal };
})();
