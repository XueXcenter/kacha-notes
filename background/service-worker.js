// ============================================
// 网课笔记助手 - Background Service Worker v2
// 职责：截图（captureVisibleTab）、消息中转、徽标
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'captureTab':
      // content script 请求截取当前标签页（用于视频截图）
      handleCaptureTab(sender).then(sendResponse);
      return true; // 异步

    case 'getNotes':
      handleGetNotes(message.filter).then(sendResponse);
      return true;

    case 'deleteNote':
      handleDeleteNote(message.noteId).then(sendResponse);
      return true;

    case 'badgeUpdated':
      updateBadge();
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ error: 'Unknown action' });
  }
  return false;
});

// ==================== 截取当前标签页 ====================
async function handleCaptureTab(sender) {
  try {
    const tabId = sender.tab?.id;
    if (!tabId) return { error: '无法获取标签页 ID' };

    // Chrome 原生 API：截取整个可见标签页
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'jpeg',
      quality: 90,
    });

    return { success: true, dataUrl };
  } catch (err) {
    console.error('[笔记助手] 截图失败:', err);
    return { error: err.message || '截图失败' };
  }
}

// ==================== 其他 ====================
async function handleGetNotes(filter) {
  const result = await chrome.storage.local.get(['notes_index']);
  const index = result.notes_index || [];
  if (filter && filter.videoUrl) {
    return index.filter(n => n.videoUrl === filter.videoUrl);
  }
  return index;
}

async function handleDeleteNote(noteId) {
  const result = await chrome.storage.local.get(['notes_index']);
  let index = result.notes_index || [];
  index = index.filter(n => n.id !== noteId);
  await chrome.storage.local.set({ notes_index: index });
  updateBadge();
  return { success: true };
}

async function updateBadge() {
  const result = await chrome.storage.local.get(['notes_index']);
  const count = (result.notes_index || []).length;
  if (count > 0) {
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[笔记助手] 插件已安装');
  chrome.storage.local.get(['notes_index'], (result) => {
    if (!result.notes_index) {
      chrome.storage.local.set({ notes_index: [] });
    }
  });
});
