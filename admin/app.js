(() => {
  'use strict';

  const state = {
    pages: [],
    selectedPageId: null,
    cards: [],
    media: [],
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const loginView = $('#login-view');
  const adminView = $('#admin-view');
  const pageForm = $('#page-form');
  const cardForm = $('#card-form');

  async function api(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: options.body instanceof FormData
        ? options.headers
        : { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(body?.error || `请求失败（${response.status}）`);
      error.status = response.status;
      error.code = body?.code;
      error.details = body?.details;
      error.saved = body?.saved === true;
      error.publication = body?.publication;
      error.response = body;
      error.page = body?.page;
      error.card = body?.card;
      error.media = body?.media;
      error.settings = body?.settings;
      throw error;
    }
    return body;
  }

  function showMessage(message, type = 'success') {
    const element = $('#global-message');
    element.textContent = message || '';
    element.classList.toggle('error', type === 'error');
    if (message) window.setTimeout(() => {
      if (element.textContent === message) element.textContent = '';
    }, 6000);
  }

  function setFormMessage(selector, message, isError = false) {
    const element = $(selector);
    element.textContent = message || '';
    element.classList.toggle('error', isError);
  }

  async function recoverSavedPublicationFailure(error, {
    label = '数据',
    reload,
    formSelector,
  } = {}) {
    if (error.saved !== true) return false;

    let synchronized = true;
    try {
      if (typeof reload === 'function') await reload();
    } catch (reloadError) {
      synchronized = false;
      console.error('已保存数据重新同步失败', reloadError);
    }

    const message = synchronized
      ? `${label}已保存，但静态网站发布失败。后台数据已重新同步，请勿重复提交；修复后点击“重新生成全部网站”。`
      : `${label}已保存，但静态网站发布失败，后台重新同步也失败。请刷新管理页面确认数据，切勿重复提交。`;
    if (formSelector) setFormMessage(formSelector, message, true);
    showMessage(message, 'error');
    return true;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function toTree(pages) {
    const nodes = new Map(pages.map((page) => [page.id, { ...page, children: [] }]));
    const roots = [];
    for (const node of nodes.values()) {
      if (node.parent_id && nodes.has(node.parent_id)) nodes.get(node.parent_id).children.push(node);
      else roots.push(node);
    }
    const sortNodes = (items) => items.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .forEach((item) => sortNodes(item.children));
    sortNodes(roots);
    return roots;
  }

  function renderTree() {
    const renderNodes = (nodes) => `<ul class="tree-list">${nodes.map((node) => `
      <li>
        <button class="tree-item-button ${node.id === state.selectedPageId ? 'active' : ''}" data-page-id="${node.id}" type="button">
          <span class="status-dot ${node.status === 'draft' ? 'draft' : ''}"></span>
          <span class="tree-title">${escapeHtml(node.title)}</span>
        </button>
        ${node.children.length ? renderNodes(node.children) : ''}
      </li>`).join('')}</ul>`;
    $('#page-tree').innerHTML = state.pages.length
      ? renderNodes(toTree(state.pages))
      : '<p class="empty-state">还没有页面。</p>';
  }

  function renderPageOptions() {
    const page = state.pages.find((item) => item.id === state.selectedPageId);
    const currentParent = page?.parent_id ?? '';
    const optionHtml = state.pages.map((item) => `<option value="${item.id}">${escapeHtml(item.url || item.title)} · ${escapeHtml(item.title)}</option>`).join('');
    $('#page-parent').innerHTML = `<option value="">无（仅首页）</option>${optionHtml}`;
    $('#page-parent').value = String(currentParent);
    $('#card-target').innerHTML = `<option value="">不使用内部链接</option>${optionHtml}`;
  }

  function fillPageForm(page) {
    pageForm.reset();
    const values = page || {
      id: '', title: '', slug: '', parent_id: state.selectedPageId || '', template_type: 'card-list',
      decorative_character: '', title_image: '', background_image: '', content: '', sort_order: 0, status: 'published',
    };
    for (const [key, value] of Object.entries(values)) {
      const field = pageForm.elements.namedItem(key);
      if (field) field.value = value ?? '';
    }
    $('#page-form-heading').textContent = page ? '编辑页面' : '新增页面';
    $('#delete-page-button').hidden = !page || page.template_type === 'home';
    pageForm.elements.template_type.disabled = page?.template_type === 'home';
    pageForm.elements.status.disabled = page?.template_type === 'home';
    $('#preview-link').hidden = !page;
    $('#preview-link').href = page?.url || '/';
    $('#cards-panel').hidden = !page;
    renderPageOptions();
    setFormMessage('#page-form-message', '');
  }

  function cardTargetSummary(card) {
    if (card.target_page_id) {
      return `内部：${state.pages.find((page) => page.id === card.target_page_id)?.title || card.target_page_id}`;
    }
    return card.external_url ? `外链：${card.external_url}` : '未设置链接';
  }

  function renderCards() {
    $('#card-list').innerHTML = state.cards.length ? state.cards.map((card, index) => `
      <div class="admin-card-row" data-card-id="${card.id}">
        ${card.image_path
          ? `<img class="admin-card-thumb" src="${escapeHtml(card.image_path)}" alt="">`
          : '<div class="admin-card-thumb placeholder" aria-hidden="true">链</div>'}
        <div class="admin-card-copy">
          <strong>${escapeHtml(card.title)}</strong>
          <small>${escapeHtml(cardTargetSummary(card))} · ${escapeHtml(card.status)}</small>
        </div>
        <div class="row-actions">
          <button type="button" data-action="up" title="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-action="down" title="下移" ${index === state.cards.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-action="edit" title="编辑">✎</button>
          <button type="button" data-action="delete" title="删除">×</button>
        </div>
      </div>`).join('') : '<p class="empty-state">此页面还没有 Card 或文字链接。</p>';
  }

  function fillCardForm(card) {
    cardForm.reset();
    const values = card || {
      id: '', item_type: 'image_card', title: '', description: '', image_path: '', image_alt: '',
      target_page_id: '', external_url: '', sort_order: state.cards.length * 10, status: 'published',
    };
    for (const [key, value] of Object.entries(values)) {
      const field = cardForm.elements.namedItem(key);
      if (field) field.value = value ?? '';
    }
    cardForm.hidden = false;
    setFormMessage('#card-form-message', '');
    cardForm.elements.title.focus();
  }

  function renderMedia() {
    $('#media-paths').innerHTML = state.media.map((media) => `<option value="${escapeHtml(media.relative_path)}"></option>`).join('');
    $('#media-list').innerHTML = state.media.length ? state.media.map((media) => `
      <div class="media-item" data-media-id="${media.id}">
        <img src="${escapeHtml(media.relative_path)}" alt="">
        <code title="${escapeHtml(media.relative_path)}">${escapeHtml(media.relative_path)}</code>
        <button class="button button-secondary" data-replace-media type="button">替换同格式文件</button>
        <input type="file" accept="image/png,image/jpeg,image/webp" hidden>
      </div>`).join('') : '<p class="empty-state">还没有上传媒体。</p>';
  }

  async function loadPages(preferredId) {
    const result = await api('/pages');
    state.pages = result.pages || result;
    if (preferredId && state.pages.some((page) => page.id === preferredId)) state.selectedPageId = preferredId;
    else if (!state.pages.some((page) => page.id === state.selectedPageId)) state.selectedPageId = state.pages[0]?.id || null;
    renderTree();
    renderPageOptions();
    if (state.selectedPageId) await selectPage(state.selectedPageId, false);
    else fillPageForm(null);
  }

  async function loadMedia() {
    const result = await api('/media');
    state.media = result.media || result;
    renderMedia();
  }

  async function selectPage(id, rerenderTree = true) {
    state.selectedPageId = Number(id);
    const page = state.pages.find((item) => item.id === state.selectedPageId);
    if (!page) return;
    if (rerenderTree) renderTree();
    fillPageForm(page);
    const result = await api(`/pages/${page.id}/cards`);
    state.cards = result.cards || result;
    renderCards();
    cardForm.hidden = true;
  }

  async function uploadImage(file) {
    const formData = new FormData();
    formData.append('image', file);
    const result = await api('/media', { method: 'POST', body: formData });
    await loadMedia();
    return result.media || result;
  }

  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    $('#login-error').textContent = '';
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ password: $('#login-password').value }) });
      $('#login-password').value = '';
      loginView.hidden = true;
      adminView.hidden = false;
      await Promise.all([loadPages(), loadMedia()]);
    } catch (error) {
      $('#login-error').textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  $('#logout-button').addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' });
    adminView.hidden = true;
    loginView.hidden = false;
    $('#login-password').focus();
  });

  $('#generate-button').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = '正在生成…';
    try {
      const result = await api('/generate', { method: 'POST', body: '{}' });
      showMessage(`全站生成成功：${result.pageCount ?? result.pages ?? '全部'} 个页面。`);
    } catch (error) {
      showMessage(`生成失败：${error.message}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = '重新生成全部网站';
    }
  });

  $('#page-tree').addEventListener('click', (event) => {
    const button = event.target.closest('[data-page-id]');
    if (button) selectPage(button.dataset.pageId).catch((error) => showMessage(error.message, 'error'));
  });

  $('#new-page-button').addEventListener('click', () => {
    state.cards = [];
    renderCards();
    fillPageForm(null);
  });

  pageForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = event.submitter || pageForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const data = Object.fromEntries(new FormData(pageForm));
    data.parent_id = data.parent_id ? Number(data.parent_id) : null;
    data.sort_order = Number(data.sort_order || 0);
    const id = data.id;
    delete data.id;
    setFormMessage('#page-form-message', '正在保存…');
    try {
      const result = await api(id ? `/pages/${id}` : '/pages', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(data),
      });
      const saved = result.page || result;
      await loadPages(saved.id);
      setFormMessage('#page-form-message', '已保存并重新生成。');
    } catch (error) {
      const recovered = await recoverSavedPublicationFailure(error, {
        label: '页面数据',
        reload: () => loadPages(error.page?.id || Number(id) || state.selectedPageId),
        formSelector: '#page-form-message',
      });
      if (!recovered) setFormMessage('#page-form-message', error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });

  $('#delete-page-button').addEventListener('click', async () => {
    const page = state.pages.find((item) => item.id === state.selectedPageId);
    if (!page || !window.confirm(`确定删除页面“${page.title}”吗？存在子页面时系统会拒绝。`)) return;
    try {
      await api(`/pages/${page.id}`, { method: 'DELETE' });
      state.selectedPageId = page.parent_id;
      await loadPages(page.parent_id);
      showMessage('页面已删除，旧静态路径已清理。');
    } catch (error) {
      const recovered = await recoverSavedPublicationFailure(error, {
        label: '页面变更',
        reload: () => {
          const preferredId = error.page?.parent_id ?? page.parent_id;
          state.selectedPageId = preferredId;
          return loadPages(preferredId);
        },
      });
      if (!recovered) showMessage(error.message, 'error');
    }
  });

  $('#new-card-button').addEventListener('click', () => fillCardForm(null));
  $('#cancel-card-button').addEventListener('click', () => { cardForm.hidden = true; });

  $('#upload-trigger').addEventListener('click', () => $('#upload-input').click());
  $('#upload-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setFormMessage('#card-form-message', '正在上传…');
    try {
      const media = await uploadImage(file);
      cardForm.elements.image_path.value = media.relative_path;
      if (!cardForm.elements.image_alt.value) cardForm.elements.image_alt.value = cardForm.elements.title.value;
      setFormMessage('#card-form-message', '图片上传成功。');
    } catch (error) {
      if (error.saved && error.media) {
        cardForm.elements.image_path.value = error.media.relative_path;
        if (!cardForm.elements.image_alt.value) cardForm.elements.image_alt.value = cardForm.elements.title.value;
      }
      const recovered = await recoverSavedPublicationFailure(error, {
        label: '图片',
        reload: loadMedia,
        formSelector: '#card-form-message',
      });
      if (!recovered) setFormMessage('#card-form-message', error.message, true);
    } finally {
      event.target.value = '';
    }
  });

  cardForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = event.submitter || cardForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    const data = Object.fromEntries(new FormData(cardForm));
    data.page_id = state.selectedPageId;
    data.target_page_id = data.target_page_id ? Number(data.target_page_id) : null;
    data.sort_order = Number(data.sort_order || 0);
    const id = data.id;
    delete data.id;
    setFormMessage('#card-form-message', '正在保存…');
    try {
      await api(id ? `/cards/${id}` : '/cards', { method: id ? 'PUT' : 'POST', body: JSON.stringify(data) });
      await selectPage(state.selectedPageId);
      showMessage('Card 已保存并重新生成。');
    } catch (error) {
      const recovered = await recoverSavedPublicationFailure(error, {
        label: 'Card 数据',
        reload: () => selectPage(error.card?.page_id || state.selectedPageId),
        formSelector: '#card-form-message',
      });
      if (!recovered) setFormMessage('#card-form-message', error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });

  $('#card-list').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    const row = event.target.closest('[data-card-id]');
    if (!button || !row) return;
    const id = Number(row.dataset.cardId);
    const card = state.cards.find((item) => item.id === id);
    try {
      if (button.dataset.action === 'edit') return fillCardForm(card);
      if (button.dataset.action === 'delete') {
        if (!window.confirm(`确定删除“${card.title}”吗？`)) return;
        await api(`/cards/${id}`, { method: 'DELETE' });
      } else {
        await api(`/cards/${id}/move`, { method: 'POST', body: JSON.stringify({ direction: button.dataset.action }) });
      }
      await selectPage(state.selectedPageId);
      showMessage(button.dataset.action === 'delete' ? 'Card 已删除。' : 'Card 顺序已更新。');
    } catch (error) {
      const recovered = await recoverSavedPublicationFailure(error, {
        label: 'Card 变更',
        reload: () => selectPage(error.card?.page_id || state.selectedPageId),
      });
      if (!recovered) showMessage(error.message, 'error');
    }
  });

  $('#media-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-replace-media]');
    if (button) button.parentElement.querySelector('input[type=file]').click();
  });

  $('#media-list').addEventListener('change', async (event) => {
    if (event.target.type !== 'file' || !event.target.files[0]) return;
    const item = event.target.closest('[data-media-id]');
    const formData = new FormData();
    formData.append('image', event.target.files[0]);
    try {
      await api(`/media/${item.dataset.mediaId}/replace`, { method: 'POST', body: formData });
      await loadMedia();
      showMessage('图片已原路径替换，内容哈希与静态页面已更新。');
    } catch (error) {
      const recovered = await recoverSavedPublicationFailure(error, {
        label: '图片数据',
        reload: loadMedia,
      });
      if (!recovered) showMessage(error.message, 'error');
    } finally {
      event.target.value = '';
    }
  });

  async function boot() {
    try {
      const status = await api('/auth/status');
      if (!status.authenticated) {
        loginView.hidden = false;
        return;
      }
      adminView.hidden = false;
      await Promise.all([loadPages(), loadMedia()]);
    } catch (error) {
      loginView.hidden = false;
      $('#login-error').textContent = `管理服务不可用：${error.message}`;
    }
  }

  boot();
})();
