(() => {
  'use strict';

  const state = {
    pages: [],
    selectedPageId: null,
    editingPageId: null,
    cards: [],
    media: [],
    images: [],
    pageDirty: false,
  };

  const BACKGROUND_THEMES = [
    ['home', '首页主题'],
    ['hui', '惠 · 政策服务主题'],
    ['yi', '医 · 健康服务主题'],
    ['yang', '养 · 居住服务主题'],
    ['le', '乐 · 文化生活主题'],
    ['chuan', '传 · 财富传承主题'],
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const loginView = $('#login-view');
  const adminView = $('#admin-view');
  const pageForm = $('#page-form');
  const cardForm = $('#card-form');
  const contentEditor = $('#page-content-editor');
  const contentValue = $('#page-content-value');
  const contentField = $('#page-content-field');
  const pageTitleImageSelect = $('#page-title-image');
  const pageTitleImageLabel = $('#page-title-image-label');
  const pageImageUploadTrigger = $('#page-image-upload-trigger');
  const pageImageUploadInput = $('#page-image-upload-input');
  const pageImageUploadHint = $('#page-image-upload-hint');
  const publicBasePath = $('meta[name="public-base-path"]')?.content || '';
  const pageTemplatesWithoutBody = new Set(
    String(contentField?.dataset.hiddenForTemplates || '').split(/\s+/u).filter(Boolean),
  );

  function publicUrl(reference = '/') {
    if (reference === null || reference === undefined || reference === '') return '';
    const input = String(reference).trim();
    if (!input || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu.test(input)) return input;
    const pathname = input.startsWith('/') ? input : `/${input}`;
    if (!publicBasePath) return pathname;
    if (pathname === publicBasePath || pathname.startsWith(`${publicBasePath}/`)) return pathname;
    return pathname === '/' ? `${publicBasePath}/` : `${publicBasePath}${pathname}`;
  }

  function pageUrl(page) {
    return publicUrl(page?.public_url || page?.url || '/');
  }

  function friendlyErrorMessage(message) {
    return String(message || '操作失败，请稍后重试。')
      .replace(/\bCard\b/giu, '页面入口')
      .replace(/\bslug\b/giu, '页面地址')
      .replace(/\btemplate\b/giu, '页面模板')
      .replace(/\bURL\b/gu, '网站地址')
      .replace(/\bHTML\b/gu, '网页内容')
      .replace(/private configuration/giu, '系统设置');
  }

  async function api(path, options = {}) {
    const response = await fetch(publicUrl(`/api${path}`), {
      credentials: 'same-origin',
      headers: options.body instanceof FormData
        ? options.headers
        : { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const contentType = response.headers.get('content-type') || '';
    const body = contentType.includes('application/json') ? await response.json() : null;
    if (!response.ok) {
      const error = new Error(friendlyErrorMessage(body?.error || `操作失败（${response.status}）`));
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
    label = '内容',
    reload,
    formSelector,
  } = {}) {
    if (error.saved !== true) return false;

    let synchronized = true;
    try {
      if (typeof reload === 'function') await reload();
    } catch (reloadError) {
      synchronized = false;
      console.error('已保存内容重新同步失败', reloadError);
    }

    const message = synchronized
      ? `${label}已保存，但网站更新失败。请勿重复提交；稍后点击“发布全部更改”重试。`
      : `${label}已保存，但页面内容未能重新载入。请刷新管理页面确认，切勿重复提交。`;
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
          <span class="tree-preview-label">预览</span>
        </button>
        ${node.children.length ? renderNodes(node.children) : ''}
      </li>`).join('')}</ul>`;
    $('#page-tree').innerHTML = state.pages.length
      ? renderNodes(toTree(state.pages))
      : '<p class="empty-state">还没有页面。</p>';
  }

  function pageDisplayName(page) {
    const names = [];
    const seen = new Set();
    let current = page;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.unshift(current.title);
      current = state.pages.find((item) => item.id === current.parent_id);
    }
    return names.join(' › ');
  }

  function descendantPageIds(pageId) {
    const ids = new Set([pageId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const page of state.pages) {
        if (page.parent_id && ids.has(page.parent_id) && !ids.has(page.id)) {
          ids.add(page.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  function renderPageOptions(parentOverride) {
    const page = state.pages.find((item) => item.id === state.editingPageId);
    const currentParent = parentOverride ?? page?.parent_id ?? pageForm.elements.parent_id.value ?? '';
    const excluded = page ? descendantPageIds(page.id) : new Set();
    const pages = state.pages.filter((item) => !excluded.has(item.id));
    const optionHtml = pages.map((item) => `<option value="${item.id}">${escapeHtml(pageDisplayName(item))}</option>`).join('');
    $('#page-parent').innerHTML = `<option value="">不设上级页面（仅首页使用）</option>${optionHtml}`;
    $('#page-parent').value = String(currentParent || '');
    $('#card-target').innerHTML = `<option value="">不打开本站其他页面</option>${state.pages.map((item) => `<option value="${item.id}">${escapeHtml(pageDisplayName(item))}</option>`).join('')}`;
  }

  function friendlyImageName(imageOrPath, index = 0) {
    const image = typeof imageOrPath === 'string'
      ? state.images.find((item) => item.relative_path === imageOrPath)
      : imageOrPath;
    const imagePath = typeof imageOrPath === 'string' ? imageOrPath : imageOrPath?.relative_path;
    const page = state.pages.find((item) => item.title_image === imagePath);
    if (page) return `${page.title} · ${page.template_type === 'image-only' ? '页面整图' : '标题图片'}`;
    const card = state.cards.find((item) => item.image_path === imagePath);
    if (card) return `${card.title} · 入口图片`;
    if (image?.replaceable && image.original_name) return image.original_name;
    const categories = [
      ['/home/', '首页图片'], ['/cards/', '入口图片'], ['/titles/', '标题图片'],
      ['/classroom/', '课堂图片'], ['/products/', '产品图片'], ['/decor/', '页面装饰'],
      ['/global/', '通用图片'],
    ];
    const label = categories.find(([segment]) => String(imagePath).includes(segment))?.[1] || '网站图片';
    const categoryImages = state.images.filter((item) => String(item.relative_path).includes(categories.find(([segment]) => String(imagePath).includes(segment))?.[0] || '__none__'));
    const categoryIndex = categoryImages.findIndex((item) => item.relative_path === imagePath);
    return `${label} ${categoryIndex >= 0 ? categoryIndex + 1 : index + 1}`;
  }

  function imagePublicUrl(imageOrPath) {
    const image = typeof imageOrPath === 'string'
      ? state.images.find((item) => item.relative_path === imageOrPath)
      : imageOrPath;
    return image?.public_url || publicUrl(image?.relative_path || imageOrPath || '');
  }

  function ensureCurrentOption(select, value, label = '当前使用的图片') {
    if (!value || [...select.options].some((option) => option.value === value)) return;
    select.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
  }

  function renderImageSelectors() {
    const pageImageSelect = pageTitleImageSelect;
    const cardImageSelect = $('#card-image');
    const backgroundSelect = $('#page-background');
    const values = {
      page: pageImageSelect.value || pageForm.elements.title_image.value,
      card: cardImageSelect.value || cardForm.elements.image_path.value,
      background: backgroundSelect.value || pageForm.elements.background_image.value,
    };
    const imageOptions = state.images.map((image, index) => `<option value="${escapeHtml(image.relative_path)}">${escapeHtml(friendlyImageName(image, index))}</option>`).join('');
    pageImageSelect.innerHTML = `<option value="">请选择标题图片</option>${imageOptions}`;
    cardImageSelect.innerHTML = `<option value="">不使用图片</option>${imageOptions}`;
    backgroundSelect.innerHTML = [
      '<option value="">不使用背景主题</option>',
      ...BACKGROUND_THEMES.map(([value, label]) => `<option value="${value}">${label}</option>`),
      `<optgroup label="使用图片作为背景">${imageOptions}</optgroup>`,
    ].join('');
    ensureCurrentOption(pageImageSelect, values.page);
    ensureCurrentOption(cardImageSelect, values.card);
    ensureCurrentOption(backgroundSelect, values.background, '当前使用的背景');
    pageImageSelect.value = values.page || '';
    cardImageSelect.value = values.card || '';
    backgroundSelect.value = values.background || '';
    updateImageThumb('page-title-image');
    updateImageThumb('card-image');
  }

  function updateImageThumb(fieldId) {
    const field = $(`#${fieldId}`);
    const button = $(`[data-preview-field="${fieldId}"]`);
    if (!field || !button) return;
    const value = field.value;
    button.disabled = !value;
    button.innerHTML = value
      ? `<img src="${escapeHtml(imagePublicUrl(value))}" alt=""><span>查看大图</span>`
      : '<span>暂无图片</span>';
  }

  function showImagePreview(imagePath, caption) {
    if (!imagePath) return;
    $('#image-preview-large').src = imagePublicUrl(imagePath);
    $('#image-preview-large').alt = caption || '图片预览';
    $('#image-preview-caption').textContent = caption || friendlyImageName(imagePath);
    const dialog = $('#image-preview-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function formPageSnapshot() {
    const hasPageBody = !pageTemplatesWithoutBody.has(pageForm.elements.template_type.value);
    return {
      title: pageForm.elements.title.value || '未命名页面',
      template_type: pageForm.elements.template_type.value,
      title_image: pageForm.elements.title_image.value,
      contentText: hasPageBody ? contentEditor.innerText.trim() : '',
      status: pageForm.elements.status.value,
    };
  }

  function syncPageTemplateFields() {
    const templateType = pageForm.elements.template_type.value;
    const imageOnly = templateType === 'image-only';
    contentField.hidden = pageTemplatesWithoutBody.has(templateType);
    pageTitleImageSelect.hidden = imageOnly;
    pageTitleImageLabel.textContent = imageOnly ? '页面图片' : '标题图片';
    const pageImagePreviewButton = $('[data-preview-field="page-title-image"]');
    pageImagePreviewButton.setAttribute('aria-label', imageOnly ? '查看页面图片' : '查看标题图片');
    pageImageUploadTrigger.hidden = !imageOnly;
    pageImageUploadHint.hidden = !imageOnly;
    $('#page-decoration-field').hidden = imageOnly;
    $('#page-background-field').hidden = imageOnly;
    const editingPage = state.pages.find((page) => page.id === state.editingPageId);
    $('#cards-panel').hidden = !editingPage || imageOnly;
  }

  function showLocalPagePreview(page = formPageSnapshot(), note = '正在预览尚未发布的内容') {
    $('#page-preview-frame').hidden = true;
    const fallback = $('#page-preview-fallback');
    fallback.hidden = false;
    if (page.template_type === 'image-only') {
      fallback.innerHTML = `
        <div class="draft-preview-image-only">
          ${page.title_image
            ? `<img src="${escapeHtml(imagePublicUrl(page.title_image))}" alt="${escapeHtml(page.title || '')}">`
            : '<p class="draft-preview-empty">请上传手机页面图片。</p>'}
        </div>`;
    } else {
      const cards = state.cards.slice(0, 4).map((card) => card.image_path
        ? `<img src="${escapeHtml(imagePublicUrl(card.image_path) || card.image_url)}" alt="${escapeHtml(card.title)}">`
        : `<span>${escapeHtml(card.title)}</span>`).join('');
      fallback.innerHTML = `
        <div class="draft-preview-canvas">
          ${page.title_image ? `<img class="draft-preview-title" src="${escapeHtml(imagePublicUrl(page.title_image))}" alt="">` : `<h3>${escapeHtml(page.title)}</h3>`}
          ${page.contentText ? `<p>${escapeHtml(page.contentText)}</p>` : ''}
          ${cards ? `<div class="draft-preview-cards">${cards}</div>` : '<p class="draft-preview-empty">保存页面入口后会显示在这里。</p>'}
        </div>`;
    }
    $('#page-preview-note').textContent = note;
  }

  function updatePagePreview(page, { forceLocal = false } = {}) {
    if (!page) {
      showLocalPagePreview(formPageSnapshot(), '新页面内容预览');
      $('#preview-link').hidden = true;
      return;
    }
    $('#preview-link').hidden = false;
    $('#preview-link').href = pageUrl(page);
    if (forceLocal || state.pageDirty || page.status !== 'published') {
      showLocalPagePreview(
        forceLocal || state.pageDirty ? formPageSnapshot() : { ...page, contentText: '' },
        state.pageDirty ? '当前修改尚未保存' : '当前页面暂未发布，显示内容预览',
      );
      return;
    }
    $('#page-preview-fallback').hidden = true;
    const frame = $('#page-preview-frame');
    frame.hidden = false;
    const previewUrl = pageUrl(page);
    const separator = previewUrl.includes('?') ? '&' : '?';
    frame.src = `${previewUrl}${separator}preview=${Date.now()}`;
    $('#page-preview-note').textContent = '网站中的实际显示效果';
  }

  function fillPageForm(page) {
    pageForm.reset();
    state.editingPageId = page?.id || null;
    const values = page || {
      id: '', title: '', slug: `page-${Date.now().toString(36)}`, parent_id: state.selectedPageId || '', template_type: 'card-list',
      decorative_character: '', title_image: '', background_image: '', content: '', sort_order: 0, status: 'draft',
    };
    for (const [key, value] of Object.entries(values)) {
      const field = pageForm.elements.namedItem(key);
      if (field) field.value = value ?? '';
    }
    contentValue.value = values.content || '';
    contentEditor.innerHTML = values.content || '';
    state.pageDirty = false;
    $('#page-form-heading').textContent = page ? '编辑页面' : '新增页面';
    $('#delete-page-button').hidden = !page || page.template_type === 'home';
    pageForm.elements.template_type.disabled = page?.template_type === 'home';
    pageForm.elements.status.disabled = page?.template_type === 'home';
    syncPageTemplateFields();
    renderPageOptions(values.parent_id);
    renderImageSelectors();
    updatePagePreview(page);
    setFormMessage('#page-form-message', '');
  }

  function cardTargetSummary(card) {
    if (card.target_page_id) {
      return `打开：${state.pages.find((page) => page.id === card.target_page_id)?.title || '站内页面'}`;
    }
    return card.external_url ? '打开其他网站' : '尚未设置点击去向';
  }

  function statusLabel(status) {
    return status === 'published' ? '已发布' : '暂不发布';
  }

  function renderCards() {
    $('#card-list').innerHTML = state.cards.length ? state.cards.map((card, index) => `
      <div class="admin-card-row" data-card-id="${card.id}">
        ${card.image_path
          ? `<button class="card-thumb-button" type="button" data-preview-image="${escapeHtml(card.image_path)}" data-preview-caption="${escapeHtml(card.title)}" aria-label="查看${escapeHtml(card.title)}图片"><img class="admin-card-thumb" src="${escapeHtml(imagePublicUrl(card.image_path) || card.image_url)}" alt=""></button>`
          : '<div class="admin-card-thumb placeholder" aria-hidden="true">文</div>'}
        <div class="admin-card-copy">
          <strong>${escapeHtml(card.title)}</strong>
          <small>${escapeHtml(cardTargetSummary(card))} · ${statusLabel(card.status)}</small>
        </div>
        <div class="row-actions">
          <button type="button" data-action="up" title="上移" aria-label="上移" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-action="down" title="下移" aria-label="下移" ${index === state.cards.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-action="edit" title="编辑" aria-label="编辑">✎</button>
          <button type="button" data-action="delete" title="删除" aria-label="删除">×</button>
        </div>
      </div>`).join('') : '<p class="empty-state">此页面还没有图片或文字入口。</p>';
  }

  function fillCardForm(card) {
    cardForm.reset();
    const values = card || {
      id: '', item_type: 'image_card', title: '', description: '', image_path: '', image_alt: '',
      target_page_id: '', external_url: '', sort_order: state.cards.length * 10, status: 'draft',
    };
    for (const [key, value] of Object.entries(values)) {
      const field = cardForm.elements.namedItem(key);
      if (field) field.value = value ?? '';
    }
    renderImageSelectors();
    cardForm.hidden = false;
    setFormMessage('#card-form-message', '');
    cardForm.elements.title.focus();
  }

  function renderMedia() {
    $('#media-list').innerHTML = state.images.length ? state.images.map((image, index) => `
      <div class="media-item" ${image.id ? `data-media-id="${image.id}"` : ''}>
        <button class="media-preview-button" type="button" data-preview-image="${escapeHtml(image.relative_path)}" data-preview-caption="${escapeHtml(friendlyImageName(image, index))}">
          <img src="${escapeHtml(image.public_url || publicUrl(image.relative_path))}" alt="">
          <strong>${escapeHtml(friendlyImageName(image, index))}</strong>
          <span>点击查看大图</span>
        </button>
        ${image.replaceable ? '<button class="button button-secondary" data-replace-media type="button">更换这张图片</button><input type="file" accept="image/png,image/jpeg,image/webp" hidden>' : ''}
      </div>`).join('') : '<p class="empty-state">还没有可用图片。</p>';
  }

  async function loadPages(preferredId) {
    const result = await api('/pages');
    state.pages = result.pages || result;
    if (preferredId && state.pages.some((page) => page.id === preferredId)) state.selectedPageId = preferredId;
    else if (!state.pages.some((page) => page.id === state.selectedPageId)) state.selectedPageId = state.pages[0]?.id || null;
    renderTree();
    if (state.selectedPageId) await selectPage(state.selectedPageId, false);
    else fillPageForm(null);
  }

  async function loadMedia() {
    const result = await api('/media');
    state.media = result.media || [];
    state.images = result.images || state.media;
    renderMedia();
    renderImageSelectors();
  }

  async function selectPage(id, rerenderTree = true) {
    state.selectedPageId = Number(id);
    const page = state.pages.find((item) => item.id === state.selectedPageId);
    if (!page) return;
    if (rerenderTree) renderTree();
    const result = await api(`/pages/${page.id}/cards`);
    state.cards = result.cards || result;
    renderCards();
    fillPageForm(page);
    cardForm.hidden = true;
  }

  async function uploadImage(file, endpoint = '/media') {
    const formData = new FormData();
    formData.append('image', file);
    const result = await api(endpoint, { method: 'POST', body: formData });
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
      await loadMedia();
      await loadPages();
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
    button.textContent = '正在发布…';
    try {
      const result = await api('/generate', { method: 'POST', body: '{}' });
      showMessage(`发布成功，共更新 ${result.pageCount ?? result.pages ?? '全部'} 个页面。`);
      const page = state.pages.find((item) => item.id === state.selectedPageId);
      updatePagePreview(page);
    } catch (error) {
      showMessage(`发布失败：${error.message}`, 'error');
    } finally {
      button.disabled = false;
      button.textContent = '发布全部更改';
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

  pageForm.addEventListener('input', () => {
    state.pageDirty = true;
    contentValue.value = contentEditor.innerHTML;
    updateImageThumb('page-title-image');
    updatePagePreview(state.pages.find((item) => item.id === state.selectedPageId), { forceLocal: true });
  });

  pageForm.addEventListener('change', () => {
    state.pageDirty = true;
    syncPageTemplateFields();
    updateImageThumb('page-title-image');
    updatePagePreview(state.pages.find((item) => item.id === state.selectedPageId), { forceLocal: true });
  });

  pageForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = event.submitter || pageForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    contentValue.value = contentEditor.innerHTML;
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
      setFormMessage('#page-form-message', '页面已保存并发布。');
    } catch (error) {
      const recovered = await recoverSavedPublicationFailure(error, {
        label: '页面内容',
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
    if (!page || !window.confirm(`确定删除页面“${page.title}”吗？存在下级页面时不能删除。`)) return;
    try {
      await api(`/pages/${page.id}`, { method: 'DELETE' });
      state.selectedPageId = page.parent_id;
      await loadPages(page.parent_id);
      showMessage('页面已删除，原有页面内容已清理。');
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

  $('#refresh-preview-button').addEventListener('click', () => {
    const page = state.pages.find((item) => item.id === state.selectedPageId);
    updatePagePreview(page, { forceLocal: state.pageDirty });
  });

  $('#new-card-button').addEventListener('click', () => fillCardForm(null));
  $('#cancel-card-button').addEventListener('click', () => { cardForm.hidden = true; });

  pageImageUploadTrigger.addEventListener('click', () => pageImageUploadInput.click());
  pageImageUploadInput.addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setFormMessage('#page-form-message', '正在转换并上传页面图片…');
    try {
      const media = await uploadImage(file, '/media/mobile-page');
      pageForm.elements.title_image.value = media.relative_path;
      state.pageDirty = true;
      updateImageThumb('page-title-image');
      updatePagePreview(state.pages.find((item) => item.id === state.selectedPageId), { forceLocal: true });
      setFormMessage('#page-form-message', '图片已缩放并转换为 PNG，请保存页面。');
    } catch (error) {
      if (error.saved && error.media) {
        pageForm.elements.title_image.value = error.media.relative_path;
        state.pageDirty = true;
        updateImageThumb('page-title-image');
        updatePagePreview(state.pages.find((item) => item.id === state.selectedPageId), { forceLocal: true });
      }
      const recovered = await recoverSavedPublicationFailure(error, {
        label: '页面图片',
        reload: loadMedia,
        formSelector: '#page-form-message',
      });
      if (!recovered) setFormMessage('#page-form-message', error.message, true);
    } finally {
      event.target.value = '';
    }
  });

  $('#upload-trigger').addEventListener('click', () => $('#upload-input').click());
  $('#upload-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setFormMessage('#card-form-message', '正在上传…');
    try {
      const media = await uploadImage(file);
      cardForm.elements.image_path.value = media.relative_path;
      updateImageThumb('card-image');
      if (!cardForm.elements.image_alt.value) cardForm.elements.image_alt.value = cardForm.elements.title.value;
      setFormMessage('#card-form-message', '图片上传成功。');
    } catch (error) {
      if (error.saved && error.media) {
        cardForm.elements.image_path.value = error.media.relative_path;
        updateImageThumb('card-image');
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

  $('#card-image').addEventListener('change', () => updateImageThumb('card-image'));
  $('#page-title-image').addEventListener('change', () => updateImageThumb('page-title-image'));

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
      showMessage('页面入口已保存并发布。');
    } catch (error) {
      const recovered = await recoverSavedPublicationFailure(error, {
        label: '页面入口',
        reload: () => selectPage(error.card?.page_id || state.selectedPageId),
        formSelector: '#card-form-message',
      });
      if (!recovered) setFormMessage('#card-form-message', error.message, true);
    } finally {
      submitButton.disabled = false;
    }
  });

  $('#card-list').addEventListener('click', async (event) => {
    const preview = event.target.closest('[data-preview-image]');
    if (preview) {
      showImagePreview(preview.dataset.previewImage, preview.dataset.previewCaption);
      return;
    }
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
      showMessage(button.dataset.action === 'delete' ? '页面入口已删除。' : '显示顺序已更新。');
    } catch (error) {
      const recovered = await recoverSavedPublicationFailure(error, {
        label: '页面入口变更',
        reload: () => selectPage(error.card?.page_id || state.selectedPageId),
      });
      if (!recovered) showMessage(error.message, 'error');
    }
  });

  document.addEventListener('click', (event) => {
    const previewFieldButton = event.target.closest('[data-preview-field]');
    if (previewFieldButton) {
      const field = $(`#${previewFieldButton.dataset.previewField}`);
      showImagePreview(field?.value, field?.selectedOptions?.[0]?.textContent);
    }
  });

  $('#media-list').addEventListener('click', (event) => {
    const preview = event.target.closest('[data-preview-image]');
    if (preview) {
      showImagePreview(preview.dataset.previewImage, preview.dataset.previewCaption);
      return;
    }
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
      showMessage('图片已更新，相关页面已重新发布。');
    } catch (error) {
      const recovered = await recoverSavedPublicationFailure(error, {
        label: '图片',
        reload: loadMedia,
      });
      if (!recovered) showMessage(error.message, 'error');
    } finally {
      event.target.value = '';
    }
  });

  $('#close-image-preview').addEventListener('click', () => $('#image-preview-dialog').close());
  $('#image-preview-dialog').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });

  async function boot() {
    try {
      const status = await api('/auth/status');
      if (!status.authenticated) {
        loginView.hidden = false;
        return;
      }
      adminView.hidden = false;
      await loadMedia();
      await loadPages();
    } catch (error) {
      loginView.hidden = false;
      $('#login-error').textContent = `管理页面暂时不可用：${error.message}`;
    }
  }

  boot();
})();
