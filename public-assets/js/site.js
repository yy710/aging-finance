'use strict';

document.documentElement.classList.add('js');

document.addEventListener('click', (event) => {
  const disabledLink = event.target.closest('[data-disabled-link]');
  if (disabledLink) {
    event.preventDefault();
    return;
  }

  const backButton = event.target.closest('[data-back-button]');
  if (!backButton || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  if (!document.referrer || window.history.length <= 1) {
    return;
  }

  try {
    const referrer = new URL(document.referrer);
    const current = new URL(window.location.href);
    if (referrer.origin !== current.origin || referrer.pathname === current.pathname || referrer.pathname.startsWith('/admin/')) {
      return;
    }
    event.preventDefault();
    window.history.back();
  } catch (_) {
    // The explicit parent href remains the safe fallback.
  }
});
