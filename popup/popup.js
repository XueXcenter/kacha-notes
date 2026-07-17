// ============================================
// 咔擦笔记 - Popup v6（chrome.storage 版本）
// ============================================

function isContextValid() {
  try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
  catch (e) { return false; }
}

let allNotesIndex = [];
let selectedIds = new Set();

document.addEventListener('DOMContentLoaded', () => {
  if (!isContextValid()) { document.body.innerHTML = '<p style="padding:20px;color:red;">⚠️ 扩展已失效，请关闭后重新打开</p>'; return; }
  loadNotes();
  bindEvents();
});

// ==================== 加载 ====================
async function loadNotes(searchTerm) {
  const container = document.getElementById('notesContainer');
  const emptyState = document.getElementById('emptyState');

  try {
    const result = await chrome.storage.local.get(['notes_index']);
    allNotesIndex = result.notes_index || [];
  } catch (e) { allNotesIndex = []; }

  let index = allNotesIndex;
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    const filtered = [];
    for (const meta of allNotesIndex) {
      const noteData = await getFullNote(meta.id);
      if (noteData) {
        const t = [noteData.note || '', (noteData.tags || []).join(' '), noteData.videoTitle || '', meta.timestamp || ''].join(' ').toLowerCase();
        if (t.includes(term)) filtered.push(meta);
      }
    }
    index = filtered;
  }

  document.getElementById('noteCount').textContent = index.length + ' 条';
  container.querySelectorAll('.note-group').forEach(g => g.remove());

  if (index.length === 0) {
    emptyState.style.display = 'block';
    document.getElementById('emptyTitle').textContent = searchTerm ? '无匹配' : '还没有笔记';
    return;
  }
  emptyState.style.display = 'none';

  const groups = groupBy(index, 'videoUrl');

  for (const [url, notes] of Object.entries(groups)) {
    const groupEl = document.getElementById('groupTemplate').content.firstElementChild.cloneNode(true);
    groupEl.querySelector('.group-title').textContent = notes[0].videoTitle || '未知';
    groupEl.querySelector('.group-count').textContent = String(notes.length);
    const itemsCtn = groupEl.querySelector('.group-items');

    const groupCb = groupEl.querySelector('.group-cb');
    groupCb.addEventListener('change', () => {
      itemsCtn.querySelectorAll('.item-cb').forEach(cb => {
        cb.checked = groupCb.checked;
        if (groupCb.checked) selectedIds.add(cb.dataset.id);
        else selectedIds.delete(cb.dataset.id);
      });
      updateSelectAll();
    });

    for (const meta of notes) {
      const fullNote = await getFullNote(meta.id);
      if (!fullNote) continue;

      const itemEl = document.getElementById('noteItemTemplate').content.firstElementChild.cloneNode(true);

      // 复选框
      const cb = itemEl.querySelector('.item-cb');
      cb.dataset.id = meta.id;
      if (selectedIds.has(meta.id)) cb.checked = true;
      cb.addEventListener('change', () => {
        cb.checked ? selectedIds.add(meta.id) : selectedIds.delete(meta.id);
        updateGroupCheck(groupEl, itemsCtn);
        updateSelectAll();
      });

      // 缩略图
      itemEl.querySelector('.note-thumb img').src = fullNote.screenshot || '';
      itemEl.querySelector('.note-thumb').addEventListener('click', () => openPreview(fullNote, meta));

      // 时间戳
      itemEl.querySelector('.note-time').textContent = '⏱ ' + meta.timestamp;

      // 标签
      const tagsCtn = itemEl.querySelector('.note-tags');
      if (fullNote.tags && fullNote.tags.length) {
        fullNote.tags.forEach(t => {
          const span = document.createElement('span');
          span.className = 'note-tag';
          span.textContent = t;
          tagsCtn.appendChild(span);
        });
      }

      // 笔记文字
      itemEl.querySelector('.note-text').textContent = fullNote.note || '(无笔记)';

      // 预览按钮
      itemEl.querySelector('.note-preview-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        openPreview(fullNote, meta);
      });

      // 编辑
      itemEl.querySelector('.note-edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        editNote(meta.id, fullNote);
      });

      // 删除
      itemEl.querySelector('.note-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        delNote(meta.id);
      });

      itemsCtn.appendChild(itemEl);
    }

    groupEl.querySelector('.group-header').addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      itemsCtn.style.display = itemsCtn.style.display === 'none' ? 'block' : 'none';
    });

    container.appendChild(groupEl);
  }
  updateSelectAll();
}

// 从 chrome.storage 读取完整笔记
async function getFullNote(id) {
  try {
    const r = await chrome.storage.local.get(['note_' + id]);
    return r['note_' + id] || null;
  } catch (e) { return null; }
}

// ==================== 选择 ====================
function updateGroupCheck(groupEl, ctn) {
  const cbs = ctn.querySelectorAll('.item-cb');
  const all = [...cbs].every(cb => cb.checked);
  const some = [...cbs].some(cb => cb.checked);
  const gcb = groupEl.querySelector('.group-cb');
  gcb.checked = all;
  gcb.indeterminate = some && !all;
}

function updateSelectAll() {
  const cbs = document.querySelectorAll('.item-cb');
  const all = [...cbs].every(cb => cb.checked);
  const some = [...cbs].some(cb => cb.checked);
  const sa = document.getElementById('selectAll');
  sa.checked = all;
  sa.indeterminate = some && !all;
}

// ==================== 事件 ====================
function bindEvents() {
  document.getElementById('selectAll').addEventListener('change', function () {
    document.querySelectorAll('.item-cb').forEach(cb => {
      cb.checked = this.checked;
      this.checked ? selectedIds.add(cb.dataset.id) : selectedIds.delete(cb.dataset.id);
    });
    document.querySelectorAll('.group-cb').forEach(g => { g.checked = this.checked; g.indeterminate = false; });
  });

  document.getElementById('exportSelMdBtn').addEventListener('click', () => exportSel('md'));
  document.getElementById('exportSelPdfBtn').addEventListener('click', () => exportSel('pdf'));
  document.getElementById('clearAllBtn').addEventListener('click', () => {
    if (confirm('确定清空所有笔记？')) clearAll();
  });

  let timer;
  document.getElementById('searchInput').addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(() => loadNotes(this.value.trim()), 300);
  });

  document.getElementById('editSave').addEventListener('click', saveEdit);
  document.getElementById('editClose').addEventListener('click', closeEdit);
  document.getElementById('editOverlay').addEventListener('click', function (e) { if (e.target === this) closeEdit(); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.key === 'Enter' && editId) saveEdit();
    if (e.key === 'Escape' && editId) closeEdit();
  });
}

// ==================== 导出 ====================
async function exportSel(format) {
  if (selectedIds.size === 0) { alert('请先勾选要导出的笔记'); return; }
  await doExport(format, [...selectedIds]);
}

async function doExport(format, ids) {
  const notes = [];
  for (const id of ids) {
    const n = await getFullNote(id);
    if (n) notes.push(n);
  }
  if (!notes.length) { alert('没有可导出的笔记'); return; }

  if (format === 'md') {
    let md = '# 咔擦笔记\n\n> ' + new Date().toLocaleString() + ' | 共 ' + notes.length + ' 条\n\n---\n\n';
    const groups = groupBy(notes, 'videoUrl');
    for (const [, items] of Object.entries(groups)) {
      md += '## 📺 ' + items[0].videoTitle + '\n\n';
      for (const n of items) {
        md += '### ⏱ ' + (n.timestamp || '00:00');
        if (n.tags && n.tags.length) md += ' | 🏷 ' + n.tags.join('、');
        md += '\n\n' + (n.note || '_无笔记_') + '\n\n';
        if (n.screenshot) md += '![截图](' + n.screenshot + ')\n\n';
        md += '---\n\n';
      }
    }
    var mdDataUrl = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(md);
    chrome.downloads.download({ url: mdDataUrl, filename: '咔擦笔记_' + fmtDate() + '.md', saveAs: true });
  } else {
    let html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>咔擦笔记</title><style>body{font-family:"Microsoft YaHei",sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#333}h1{color:#667eea;border-bottom:3px solid #667eea}h2{color:#764ba2;margin-top:30px}h3{color:#555}img{max-width:100%;border-radius:8px;margin:10px 0}hr{border:none;border-top:1px dashed #ddd;margin:20px 0}@media print{body{padding:0}}</style></head><body><h1>📝 咔擦笔记</h1><p style="color:#999">' + new Date().toLocaleString() + ' | 共 ' + notes.length + ' 条</p>';
    const groups = groupBy(notes, 'videoUrl');
    for (const [, items] of Object.entries(groups)) {
      html += '<h2>📺 ' + items[0].videoTitle + '</h2>';
      for (const n of items) {
        html += '<h3>⏱ ' + (n.timestamp || '00:00') + '</h3>';
        html += '<p>' + (n.note || '无笔记') + '</p>';
        if (n.screenshot) html += '<img src="' + n.screenshot + '" alt="截图">';
        html += '<hr>';
      }
    }
    html += '</body></html>';
    // PDF：存到 storage → viewer 打开 → 自动打印
    await chrome.storage.local.set({ _pv_html: html, _pv_action: 'print' });
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/viewer.html') });
  }
}

// ==================== 预览（storage 中转 → viewer.html） ====================
async function openPreview(fullNote, meta) {
  await chrome.storage.local.set({ _pv_note: fullNote, _pv_meta: meta });
  chrome.tabs.create({ url: chrome.runtime.getURL('popup/viewer.html') });
}

// ==================== 编辑 ====================
let editId = null;
function editNote(id, fullNote) {
  editId = id;
  document.getElementById('editOverlay').style.display = 'flex';
  document.getElementById('editScreenshot').src = fullNote.screenshot || '';
  document.getElementById('editTags').value = (fullNote.tags || []).join('、');
  document.getElementById('editText').value = fullNote.note || '';
  document.getElementById('editText').focus();
}

async function saveEdit() {
  if (!editId) return;
  try {
    const n = await getFullNote(editId);
    if (n) {
      n.note = document.getElementById('editText').value.trim();
      n.tags = document.getElementById('editTags').value.split(/[,，、\s]+/).filter(Boolean);
      await chrome.storage.local.set({ ['note_' + editId]: n });
    }
  } catch (e) {}
  editId = null;
  document.getElementById('editOverlay').style.display = 'none';
  loadNotes(document.getElementById('searchInput').value.trim());
}

function closeEdit() { editId = null; document.getElementById('editOverlay').style.display = 'none'; }

// ==================== 删除 ====================
async function delNote(id) {
  try {
    const r = await chrome.storage.local.get(['notes_index']);
    await chrome.storage.local.set({ notes_index: (r.notes_index || []).filter(n => n.id !== id) });
    await chrome.storage.local.remove(['note_' + id]);
    selectedIds.delete(id);
  } catch (e) {}
  loadNotes(document.getElementById('searchInput').value.trim());
}

async function clearAll() {
  try {
    const r = await chrome.storage.local.get(['notes_index']);
    const ids = (r.notes_index || []).map(n => 'note_' + n.id);
    await chrome.storage.local.remove(ids);
    await chrome.storage.local.set({ notes_index: [] });
    selectedIds.clear();
  } catch (e) {}
  loadNotes();
}

// ==================== 工具 ====================
function groupBy(arr, key) { const g = {}; for (const i of arr) { const k = i[key] || 'unknown'; if (!g[k]) g[k] = []; g[k].push(i); } return g; }
function fmtDate() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function downloadFile(content, name, type) { const b = new Blob([content],{type}); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); }
