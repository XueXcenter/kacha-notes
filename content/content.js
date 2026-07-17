// ============================================
// 网课笔记助手 - Content Script v2
// 职责：检测视频、智能定位按钮、截图、笔记面板
// ============================================

(function () {
  'use strict';

  // 检测扩展上下文是否有效（刷新插件后会失效）
  function isContextValid() {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch (e) { return false; }
  }

  // ==================== 常量 ====================
  const BUTTON_ID = 'note-taker-capture-btn';
  const TOAST_ID = 'note-taker-toast';
  const COLORS = { primary: '#667eea', accent: '#764ba2', success: '#4CAF50', danger: '#e74c3c' };

  // ==================== 平台配置 ====================
  const PLATFORM_CONFIG = {
    bilibili: {
      name: 'B站',
      videoSelector: '.bpx-player-video video, #bilibili-player video',
      titleSelector: 'h1.video-title, .bpx-player-video-title, meta[itemprop="name"]',
      controlBarSelector: '.bpx-player-control-wrap, .bilibili-player-controls',
    },
    tencentMeeting: {
      name: '腾讯会议',
      videoSelector: '.meeting-video-container video, .screen-share video, video',
      titleSelector: '.meeting-subject, .meeting-title, title',
      controlBarSelector: null,
    },
    classin: {
      name: 'ClassIn',
      videoSelector: '#classin-video video, .video-wrap video, video',
      titleSelector: '.room-title, .course-title, title',
      controlBarSelector: null,
    },
    generic: {
      name: '通用',
      videoSelector: 'video',
      titleSelector: 'title',
      controlBarSelector: null,
    },
  };

  // ==================== 状态 ====================
  let currentVideo = null;
  let currentPlatform = null;
  let buttonEl = null;
  let panelEl = null;
  let lastCaptureTime = 0;
  let captureDebounceMs = 800;

  // ==================== 平台识别 ====================
  function detectPlatform() {
    const host = window.location.hostname;

    if (host.includes('bilibili.com')) return 'bilibili';
    if (host.includes('meeting.tencent.com') || host.includes('voovmeeting.com')) return 'tencentMeeting';
    if (host.includes('classin.com') || host.includes('eeo.cn')) return 'classin';

    return 'generic';
  }

  // ==================== 视频检测（增强版） ====================
  function findBestVideo() {
    const platform = currentPlatform || 'generic';
    const config = PLATFORM_CONFIG[platform];

    // 先用平台专用选择器
    const videos = document.querySelectorAll(config.videoSelector);

    if (videos.length === 0) return null;

    // 找最优视频：可见 + 面积最大
    let best = null;
    let bestArea = 0;

    for (const v of videos) {
      if (v.readyState < 1) continue;            // 还没加载
      if (v.videoWidth < 100 || v.videoHeight < 60) continue; // 太小，可能是预览缩略图

      // 检查是否可见
      const rect = v.getBoundingClientRect();
      const isVisible = (
        rect.width > 0 && rect.height > 0 &&
        rect.bottom > 0 && rect.top < window.innerHeight &&
        rect.right > 0 && rect.left < window.innerWidth
      );

      if (!isVisible) continue;

      // 检查是否被隐藏
      const style = window.getComputedStyle(v);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    }

    return best;
  }

  // 获取视频父容器（用于定位按钮）
  function getVideoContainer() {
    if (!currentVideo) return null;

    // B站：找到播放器容器
    if (currentPlatform === 'bilibili') {
      const container = currentVideo.closest('.bpx-player-video-wrap, #bilibili-player');
      if (container) return container;
    }

    // 通用：找最近的定位父元素
    let parent = currentVideo.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      const style = window.getComputedStyle(parent);
      const rect = parent.getBoundingClientRect();
      if (rect.width >= currentVideo.videoWidth * 0.8) return parent;
      parent = parent.parentElement;
    }

    return document.body;
  }

  // ==================== 截图（captureVisibleTab + 裁剪） ====================
  // 使用 Chrome 原生 API 截取整个标签页，再裁剪到视频区域
  // 优点：无跨域限制，对 MSE/HLS/DRM 视频都能截
  async function captureScreenshot() {
    if (!currentVideo) return null;

    // 1. 获取视频容器在页面中的位置
    const container = getVideoContainer();
    const rect = container.getBoundingClientRect();

    if (rect.width < 50 || rect.height < 50) {
      console.error('[笔记助手] 视频区域太小:', rect.width, rect.height);
      return null;
    }

    try {
      // 2. 请求后台截取整个标签页
      if (!isContextValid()) return null;
      const response = await chrome.runtime.sendMessage({ action: 'captureTab' }).catch(() => null);
      if (!response || !response.success || !response.dataUrl) {
        console.error('[笔记助手] 后台截图失败:', response?.error);
        return null;
      }

      // 3. 把整页截图加载到 Image，然后裁剪出视频区域
      const fullImage = await loadImage(response.dataUrl);
      if (!fullImage) return null;

      // 4. 创建裁剪画布
      const canvas = document.createElement('canvas');
      const devicePixelRatio = window.devicePixelRatio || 1;

      // captureVisibleTab 返回的是物理像素，需要除以 dpr
      const cropX = Math.round(rect.left * devicePixelRatio);
      const cropY = Math.round(rect.top * devicePixelRatio);
      const cropW = Math.round(rect.width * devicePixelRatio);
      const cropH = Math.round(rect.height * devicePixelRatio);

      // 边界检查
      const safeX = Math.max(0, Math.min(cropX, fullImage.width - 1));
      const safeY = Math.max(0, Math.min(cropY, fullImage.height - 1));
      const safeW = Math.min(cropW, fullImage.width - safeX);
      const safeH = Math.min(cropH, fullImage.height - safeY);

      canvas.width = safeW;
      canvas.height = safeH;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(fullImage, safeX, safeY, safeW, safeH, 0, 0, safeW, safeH);

      // 5. 输出 JPEG（限制最大尺寸）
      const maxDim = 1920;
      let outputCanvas = canvas;
      if (safeW > maxDim || safeH > maxDim) {
        const scale = Math.min(maxDim / safeW, maxDim / safeH);
        const smallCanvas = document.createElement('canvas');
        smallCanvas.width = Math.round(safeW * scale);
        smallCanvas.height = Math.round(safeH * scale);
        const sctx = smallCanvas.getContext('2d');
        sctx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
        outputCanvas = smallCanvas;
      }

      const dataUrl = outputCanvas.toDataURL('image/jpeg', 0.85);

      return {
        dataUrl,
        width: outputCanvas.width,
        height: outputCanvas.height,
      };

    } catch (e) {
      console.error('[笔记助手] 截图失败:', e);
      return null;
    }
  }

  // 辅助：加载 Image
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  // ==================== 浮动按钮（增强版） ====================
  function createCaptureButton() {
    if (buttonEl) return;

    buttonEl = document.createElement('div');
    buttonEl.id = BUTTON_ID;
    buttonEl.innerHTML = `
      <svg viewBox="0 0 24 24" width="22" height="22" fill="white">
        <circle cx="12" cy="13" r="3" stroke="white" stroke-width="2" fill="none"/>
        <path d="M5 7h1a2 2 0 002-2 1 1 0 011-1h6a1 1 0 011 1 2 2 0 002 2h1a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" stroke="white" stroke-width="2" fill="none"/>
      </svg>
      <span class="nt-btn-label" style="display:none;position:absolute;right:56px;background:rgba(0,0,0,0.8);color:white;padding:4px 10px;border-radius:6px;font-size:12px;white-space:nowrap;">截图 Alt+S</span>
    `;
    buttonEl.title = '截图笔记 (Alt+S)';

    Object.assign(buttonEl.style, {
      position: 'fixed',
      width: '48px',
      height: '48px',
      borderRadius: '50%',
      background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.accent} 100%)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      zIndex: '999999',
      boxShadow: '0 4px 15px rgba(102,126,234,0.4)',
      transition: 'transform 0.2s, box-shadow 0.2s, opacity 0.3s',
      userSelect: 'none',
      opacity: '0',
      pointerEvents: 'none',
    });

    // hover 显示标签
    buttonEl.addEventListener('mouseenter', () => {
      buttonEl.style.transform = 'scale(1.1)';
      buttonEl.style.boxShadow = '0 6px 20px rgba(102,126,234,0.6)';
      const label = buttonEl.querySelector('.nt-btn-label');
      if (label) label.style.display = 'block';
    });
    buttonEl.addEventListener('mouseleave', () => {
      buttonEl.style.transform = 'scale(1)';
      buttonEl.style.boxShadow = '0 4px 15px rgba(102,126,234,0.4)';
      const label = buttonEl.querySelector('.nt-btn-label');
      if (label) label.style.display = 'none';
    });

    // 点击截图（带防抖）
    buttonEl.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastCaptureTime < captureDebounceMs) return;
      lastCaptureTime = now;

      doCapture().catch(err => console.error('[笔记助手] 截图出错:', err));

      // 按压缩放动画
      buttonEl.style.transform = 'scale(0.85)';
      setTimeout(() => { buttonEl.style.transform = 'scale(1)'; }, 150);
    });

    document.body.appendChild(buttonEl);
  }

  // 更新按钮位置（贴到视频容器右下角）
  function updateButtonPosition() {
    if (!buttonEl || !currentVideo) return;

    const container = getVideoContainer();
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const btnSize = 48;
    const margin = 12;

    // 放在视频容器右下角内侧
    let left = rect.right - btnSize - margin;
    let top = rect.bottom - btnSize - margin - 40; // 留 40px 给控制栏

    // 边界检查：不能超出视口
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    if (left + btnSize > window.innerWidth - margin) left = window.innerWidth - btnSize - margin;
    if (top + btnSize > window.innerHeight - margin) top = window.innerHeight - btnSize - margin;

    // 如果按钮应该在控制栏上方（B站有底部控制栏）
    if (currentPlatform === 'bilibili') {
      const controlBar = document.querySelector(PLATFORM_CONFIG.bilibili.controlBarSelector);
      if (controlBar) {
        const ctrlRect = controlBar.getBoundingClientRect();
        top = ctrlRect.top - btnSize - margin;
      }
    }

    buttonEl.style.left = left + 'px';
    buttonEl.style.top = top + 'px';
    // 清除之前可能设置的 bottom/right
    buttonEl.style.bottom = '';
    buttonEl.style.right = '';
  }

  // 显示/隐藏按钮
  function toggleButton(show) {
    if (!buttonEl) return;
    if (show) {
      updateButtonPosition();
      buttonEl.style.opacity = '1';
      buttonEl.style.pointerEvents = 'auto';
    } else {
      buttonEl.style.opacity = '0';
      buttonEl.style.pointerEvents = 'none';
    }
  }

  // ==================== Toast 通知 ====================
  function showToast(message, icon = '📸') {
    // 移除旧 toast
    const oldToast = document.getElementById(TOAST_ID);
    if (oldToast) oldToast.remove();

    const toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.textContent = `${icon} ${message}`;

    Object.assign(toast.style, {
      position: 'fixed',
      top: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.85)',
      color: 'white',
      padding: '10px 24px',
      borderRadius: '20px',
      fontSize: '14px',
      zIndex: '99999999',
      pointerEvents: 'none',
      transition: 'opacity 0.3s, transform 0.3s',
      opacity: '0',
      fontFamily: 'system-ui, sans-serif',
    });

    document.body.appendChild(toast);

    // 入场动画
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(4px)';
    });

    // 自动消失
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // 截图反馈闪光
  function showCaptureFlash() {
    const flash = document.createElement('div');
    Object.assign(flash.style, {
      position: 'fixed',
      top: '0', left: '0',
      width: '100%', height: '100%',
      border: '4px solid ' + COLORS.primary,
      zIndex: '9999999',
      pointerEvents: 'none',
      transition: 'opacity 0.4s',
      opacity: '0.7',
    });
    document.body.appendChild(flash);
    requestAnimationFrame(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 400);
    });
  }

  // ==================== 截图流程 ====================
  async function doCapture() {
    if (!currentVideo) {
      showToast('未检测到视频', '⚠️');
      return;
    }

    const screenshot = await captureScreenshot();
    if (!screenshot) {
      showToast('截图失败，可能是平台限制（尝试用系统截图工具）', '❌');
      return;
    }

    const noteData = {
      id: generateId(),
      videoUrl: window.location.href,
      videoTitle: getVideoTitle(),
      platform: currentPlatform,
      timestamp: getVideoTimestamp(),
      realTimestamp: currentVideo.currentTime,
      screenshot: screenshot.dataUrl,
      note: '',
      createdAt: new Date().toISOString(),
    };

    // 保存 + 反馈 + 弹出笔记面板
    saveNote(noteData).then(() => {
      showCaptureFlash();
      showToast(`已截图 · ${noteData.timestamp}`, '📸');
      showNotePanel(noteData);
      // 通知后台更新徽标
      if (isContextValid()) chrome.runtime.sendMessage({ action: 'badgeUpdated' }).catch(() => {});
    });
  }

  // ==================== 笔记编辑面板（增强版：可拖拽、放大、草稿） ====================
  function showNotePanel(noteData) {
    if (panelEl) panelEl.remove();

    // ---- 面板容器 ----
    panelEl = document.createElement('div');
    panelEl.className = 'nt-panel';
    panelEl.setAttribute('data-note-id', noteData.id);

    // ---- 拖拽状态 ----
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0;
    let panelStartX = 0, panelStartY = 0;
    let hasUnsaved = false;

    // ---- 构建 DOM ----
    panelEl.innerHTML = `
      <div class="nt-panel-header nt-drag-handle" title="拖拽移动">
        <span class="nt-panel-title">📝 笔记 · ${noteData.timestamp}</span>
        <div class="nt-header-actions">
          <button class="nt-min-btn" title="最小化">─</button>
          <button class="nt-close-btn" title="关闭 (Esc)">✕</button>
        </div>
      </div>
      <div class="nt-panel-body">
        <div class="nt-screenshot-wrap" title="点击放大查看">
          <img src="${noteData.screenshot}" alt="截图" class="nt-screenshot-preview">
          <div class="nt-screenshot-overlay">🔍 点击放大</div>
        </div>
        <div class="nt-video-info">
          <span class="nt-video-title-text">${escapeHtml(noteData.videoTitle)}</span>
        </div>
        <div class="nt-tags-row">
          <input class="nt-tags-input" placeholder="🏷 添加标签（回车确认，如：重点、公式、必考）" maxlength="60">
        </div>
        <textarea class="nt-note-input" placeholder="写点笔记...（Ctrl+Enter 保存，Esc 关闭）" rows="4"></textarea>
        <div class="nt-panel-footer">
          <span class="nt-draft-indicator" style="display:none;">● 草稿中</span>
          <button class="nt-save-btn">💾 保存</button>
        </div>
      </div>
      <div class="nt-resize-handle" title="拖拽调整大小"></div>
    `;

    // ---- 面板样式 ----
    Object.assign(panelEl.style, {
      position: 'fixed',
      top: '60px',
      right: '24px',
      width: '360px',
      minWidth: '280px',
      minHeight: '300px',
      maxHeight: '85vh',
      background: '#fff',
      borderRadius: '12px',
      boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
      zIndex: '9999998',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '14px',
      animation: 'nt-slide-in 0.25s ease-out',
      overflow: 'hidden',
    });

    document.body.appendChild(panelEl);

    // ---- 获取元素引用 ----
    const headerEl = panelEl.querySelector('.nt-panel-header');
    const bodyEl = panelEl.querySelector('.nt-panel-body');
    const textarea = panelEl.querySelector('.nt-note-input');
    const tagsInput = panelEl.querySelector('.nt-tags-input');
    const saveBtn = panelEl.querySelector('.nt-save-btn');
    const closeBtn = panelEl.querySelector('.nt-close-btn');
    const minBtn = panelEl.querySelector('.nt-min-btn');
    const screenshotWrap = panelEl.querySelector('.nt-screenshot-wrap');
    const resizeHandle = panelEl.querySelector('.nt-resize-handle');
    const draftIndicator = panelEl.querySelector('.nt-draft-indicator');

    // ---- 自动聚焦 ----
    setTimeout(() => textarea.focus(), 300);

    // ---- 保存逻辑 ----
    const save = async (silent = false) => {
      noteData.note = textarea.value.trim();
      noteData.tags = tagsInput.value.split(/[,，、\s]+/).filter(Boolean);
      await updateNote(noteData);
      hasUnsaved = false;
      draftIndicator.style.display = 'none';
      if (!silent) {
        showToast('笔记已保存', '✅');
      }
      // 退出动画
      panelEl.style.transform = 'scale(0.95)';
      panelEl.style.opacity = '0';
      panelEl.style.transition = 'transform 0.2s, opacity 0.2s';
      setTimeout(() => {
        panelEl.remove();
        panelEl = null;
      }, 200);
    };

    // ---- 关闭（自动保存草稿） ----
    const close = () => {
      noteData.note = textarea.value.trim();
      noteData.tags = tagsInput.value.split(/[,，、\s]+/).filter(Boolean);
      if (noteData.note || hasUnsaved) {
        updateNote(noteData);
        showToast('草稿已自动保存', '💾');
      }
      panelEl.style.transform = 'scale(0.95)';
      panelEl.style.opacity = '0';
      panelEl.style.transition = 'transform 0.15s, opacity 0.15s';
      setTimeout(() => {
        panelEl.remove();
        panelEl = null;
      }, 150);
    };

    // ---- 最小化 ----
    let minimized = false;
    let origHeight = '';
    const toggleMinimize = () => {
      if (minimized) {
        bodyEl.style.display = '';
        resizeHandle.style.display = '';
        panelEl.style.height = origHeight;
        panelEl.style.minHeight = '300px';
        minBtn.textContent = '─';
        minimized = false;
      } else {
        origHeight = panelEl.style.height || panelEl.offsetHeight + 'px';
        bodyEl.style.display = 'none';
        resizeHandle.style.display = 'none';
        panelEl.style.height = 'auto';
        panelEl.style.minHeight = '0';
        minBtn.textContent = '□';
        minimized = true;
      }
    };

    // ---- 拖拽 ----
    headerEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return; // 不拦截按钮点击
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      panelStartX = panelEl.offsetLeft;
      panelStartY = panelEl.offsetTop;
      panelEl.style.transition = 'none';
      headerEl.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging || !panelEl) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      let newX = panelStartX + dx;
      let newY = panelStartY + dy;
      // 边界
      newX = Math.max(0, Math.min(newX, window.innerWidth - panelEl.offsetWidth));
      newY = Math.max(0, Math.min(newY, window.innerHeight - 60));
      panelEl.style.left = newX + 'px';
      panelEl.style.top = newY + 'px';
      panelEl.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        if (headerEl) headerEl.style.cursor = '';
        if (panelEl) panelEl.style.transition = '';
      }
    });

    // ---- 拖拽调整大小 ----
    let isResizing = false;
    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing || !panelEl) return;
      const rect = panelEl.getBoundingClientRect();
      const w = Math.max(280, e.clientX - rect.left);
      const h = Math.max(300, e.clientY - rect.top);
      panelEl.style.width = w + 'px';
      panelEl.style.height = h + 'px';
    });

    document.addEventListener('mouseup', () => {
      isResizing = false;
    });

    // ---- 截图点击放大 ----
    screenshotWrap.addEventListener('click', () => {
      showFullscreenPreview(noteData.screenshot, noteData);
    });

    // ---- 草稿检测 ----
    textarea.addEventListener('input', () => {
      if (!hasUnsaved) {
        hasUnsaved = true;
        draftIndicator.style.display = 'inline';
      }
      // 自动存草稿（防抖）
      clearTimeout(textarea._draftTimer);
      textarea._draftTimer = setTimeout(() => {
        noteData.note = textarea.value.trim();
        updateNote(noteData);
        draftIndicator.textContent = '● 已存草稿';
        setTimeout(() => { draftIndicator.textContent = '● 草稿中'; }, 1000);
      }, 2000);
    });

    // ---- 按钮事件 ----
    saveBtn.addEventListener('click', () => save());
    closeBtn.addEventListener('click', close);
    minBtn.addEventListener('click', toggleMinimize);

    // ---- 键盘快捷键 ----
    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        save();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    // 标签回车确认
    tagsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        textarea.focus();
      }
    });
  }

  // ---- 全屏截图预览 ----
  function showFullscreenPreview(src, noteData) {
    const overlay = document.createElement('div');
    overlay.className = 'nt-fullscreen-overlay';
    overlay.innerHTML = `
      <div class="nt-fullscreen-toolbar">
        <span>📸 ${noteData.timestamp} — ${escapeHtml(noteData.videoTitle)}</span>
        <div>
          <button class="nt-fs-btn" id="nt-fs-zoom-in">＋</button>
          <button class="nt-fs-btn" id="nt-fs-zoom-out">－</button>
          <button class="nt-fs-btn" id="nt-fs-reset">↺</button>
          <button class="nt-fs-close" id="nt-fs-close">✕</button>
        </div>
      </div>
      <div class="nt-fullscreen-img-wrap">
        <img src="${src}" id="nt-fs-img" style="max-width:95%;max-height:90vh;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.3);transition:transform 0.2s;">
      </div>
    `;

    Object.assign(overlay.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.9)',
      zIndex: '99999999',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      cursor: 'zoom-out',
    });

    document.body.appendChild(overlay);

    let zoom = 1;
    const img = overlay.querySelector('#nt-fs-img');

    overlay.querySelector('#nt-fs-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#nt-fs-zoom-in').addEventListener('click', (e) => {
      e.stopPropagation(); zoom += 0.2; img.style.transform = `scale(${zoom})`;
    });
    overlay.querySelector('#nt-fs-zoom-out').addEventListener('click', (e) => {
      e.stopPropagation(); zoom = Math.max(0.2, zoom - 0.2); img.style.transform = `scale(${zoom})`;
    });
    overlay.querySelector('#nt-fs-reset').addEventListener('click', (e) => {
      e.stopPropagation(); zoom = 1; img.style.transform = 'scale(1)';
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
    });
  }

  // ==================== 键盘快捷键 ====================
  function setupKeyboardShortcuts() {
    // 用 capture 阶段拦截，抢在 B站页面快捷键之前
    document.addEventListener('keydown', (e) => {
      // Alt+S：截图（用 code 而非 key，避免大小写和输入法问题）
      if (e.altKey && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')) {
        if (!currentVideo) {
          showToast('未检测到视频，请确认视频正在播放', '⚠️');
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        doCapture().catch(err => console.error('[笔记助手] 截图出错:', err));
      }
    }, { capture: true });
  }

  // ==================== 视频标题获取 ====================
  function getVideoTitle() {
    if (currentPlatform === 'bilibili') {
      const titleEl = document.querySelector('h1.video-title');
      if (titleEl) return titleEl.textContent.trim();
      const metaTitle = document.querySelector('meta[itemprop="name"]');
      if (metaTitle) return metaTitle.getAttribute('content').trim();
    }

    if (currentPlatform === 'tencentMeeting') {
      const subject = document.querySelector('.meeting-subject, [class*="meeting-title"]');
      if (subject) return '腾讯会议 - ' + subject.textContent.trim();
    }

    if (currentPlatform === 'classin') {
      const course = document.querySelector('.room-title, [class*="course-title"]');
      if (course) return 'ClassIn - ' + course.textContent.trim();
    }

    // 通用：用页面标题
    const title = document.title;
    return title ? title.replace(/[|｜-].*$/, '').trim() : '未知视频';
  }

  function getVideoTimestamp() {
    if (!currentVideo) return '00:00';
    const t = Math.floor(currentVideo.currentTime);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  // ==================== 存储（chrome.storage.local，跨上下文共享） ====================
  async function saveNote(noteData) {
    if (!isContextValid()) return;
    try {
      // 1. 存完整数据
      await chrome.storage.local.set({ ['note_' + noteData.id]: noteData });
      // 2. 更新索引
      const result = await chrome.storage.local.get(['notes_index']);
      const index = result.notes_index || [];
      index.push({
        id: noteData.id,
        videoUrl: noteData.videoUrl,
        videoTitle: noteData.videoTitle,
        platform: noteData.platform,
        timestamp: noteData.timestamp,
        createdAt: noteData.createdAt,
      });
      await chrome.storage.local.set({ notes_index: index });
    } catch (e) { /* context lost */ }
  }

  async function updateNote(noteData) {
    if (!isContextValid()) return;
    try {
      await chrome.storage.local.set({ ['note_' + noteData.id]: noteData });
    } catch (e) { /* context lost */ }
  }

  function generateId() {
    return 'nt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ==================== 按钮位置跟随 ====================
  function setupPositionTracking() {
    // 监听滚动和窗口大小变化
    window.addEventListener('scroll', () => {
      if (currentVideo && buttonEl && buttonEl.style.opacity !== '0') {
        updateButtonPosition();
      }
    }, { passive: true });

    window.addEventListener('resize', () => {
      if (currentVideo && buttonEl && buttonEl.style.opacity !== '0') {
        updateButtonPosition();
      }
    }, { passive: true });

    // 监听全屏变化
    document.addEventListener('fullscreenchange', () => {
      setTimeout(updateButtonPosition, 300);
    });
    document.addEventListener('webkitfullscreenchange', () => {
      setTimeout(updateButtonPosition, 300);
    });
  }

  // ==================== 初始化 ====================
  function init() {
    currentPlatform = detectPlatform();
    console.log(`[笔记助手] 检测到平台: ${PLATFORM_CONFIG[currentPlatform]?.name || '通用'} (${currentPlatform})`);

    createCaptureButton();
    setupKeyboardShortcuts();
    setupPositionTracking();

    // 定时检测视频变化（SPA 页面需要）
    let lastVideoCheck = null;
    const checkVideo = () => {
      const video = findBestVideo();

      // 如果视频元素变了
      if (video !== currentVideo) {
        // 上一个视频退出时清理
        if (currentVideo && !video) {
          // 视频消失了（离开页面/关闭播放器）
          toggleButton(false);
        }

        currentVideo = video;

        if (video) {
          if (!lastVideoCheck) {
            console.log('[笔记助手] 🎬 检测到视频:', getVideoTitle());
          }
          toggleButton(true);
          updateButtonPosition();
        } else {
          toggleButton(false);
        }
      }

      // 视频还在但按钮位置可能需要更新（比如弹幕开关改变了视频大小）
      if (video && buttonEl && buttonEl.style.opacity !== '0') {
        // 定期微调位置
        const container = getVideoContainer();
        if (container) {
          const rect = container.getBoundingClientRect();
          const btnLeft = parseInt(buttonEl.style.left);
          const btnTop = parseInt(buttonEl.style.top);
          // 仅在位置偏差较大时更新
          if (Math.abs(btnLeft - (rect.right - 60)) > 10 || Math.abs(btnTop - (rect.bottom - 130)) > 10) {
            updateButtonPosition();
          }
        }
      }

      lastVideoCheck = video;
    };

    // 多频率检测：快速检测（1s）+ 慢速确认（3s）
    setInterval(checkVideo, 1000);
    // MutationObserver 处理 DOM 插入/删除
    const observer = new MutationObserver(() => {
      checkVideo();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    checkVideo();
    console.log('[笔记助手] ✅ Content script v2 已加载');
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
