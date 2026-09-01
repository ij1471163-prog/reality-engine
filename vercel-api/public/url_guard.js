// ─── URL Guard ───────────────────────────────────────
// يمنع مشاركة أو نسخ رابط الموقع

(function() {
  // 1. منع right-click
  document.addEventListener('contextmenu', e => e.preventDefault());

  // 2. منع Ctrl+U (view source) + Ctrl+S (save) + Ctrl+C على URL
  document.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ['u','s'].includes(k)) e.preventDefault();
  });

  // 3. إخفاء الرابط من address bar (replace state)
  if (window.history && window.history.replaceState) {
    window.history.replaceState(null, '', '/');
  }

  // 4. منع مشاركة الصفحة
  if (navigator.share) {
    const _originalShare = navigator.share.bind(navigator);
    navigator.share = () => Promise.reject('مشاركة غير مسموحة');
  }

  // 5. إخفاء الـ URL من الـ title
  document.title = 'Reality Engine';

  // 6. منع Long-press على الجوال (يمنع نسخ الرابط)
  let longPressTimer;
  document.addEventListener('touchstart', e => {
    longPressTimer = setTimeout(() => {
      if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
      }
    }, 500);
  }, {passive: false});
  document.addEventListener('touchend', () => clearTimeout(longPressTimer));
  document.addEventListener('touchmove', () => clearTimeout(longPressTimer));

})();
