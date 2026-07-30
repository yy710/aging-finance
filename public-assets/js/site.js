'use strict';

document.documentElement.classList.add('js');

document.addEventListener('click', (event) => {
  const disabledLink = event.target.closest('[data-disabled-link]');
  if (disabledLink) {
    event.preventDefault();
  }
});

const HOME_WELCOME_CLOSE_DURATION = 440;

function initializeHomeWelcome(modal) {
  const dismiss = modal.querySelector('[data-home-welcome-dismiss]');
  if (!dismiss) {
    return;
  }

  document.body.classList.add('home-welcome-open');

  const close = () => {
    if (modal.hidden || modal.classList.contains('is-closing')) {
      return;
    }

    modal.classList.add('is-closing');

    let fallbackTimer;
    const finish = () => {
      window.clearTimeout(fallbackTimer);
      modal.hidden = true;
      modal.classList.remove('is-closing');
      document.body.classList.remove('home-welcome-open');
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }

    modal.addEventListener('animationend', finish, { once: true });
    fallbackTimer = window.setTimeout(finish, HOME_WELCOME_CLOSE_DURATION);
  };

  dismiss.addEventListener('click', close);
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
}

document
  .querySelectorAll('[data-home-welcome-modal]')
  .forEach(initializeHomeWelcome);
