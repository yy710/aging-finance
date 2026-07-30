'use strict';

document.documentElement.classList.add('js');

document.addEventListener('click', (event) => {
  const disabledLink = event.target.closest('[data-disabled-link]');
  if (disabledLink) {
    event.preventDefault();
  }
});
