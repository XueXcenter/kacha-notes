// ============================================
// 网课笔记助手 - IndexedDB 存储层
// 数据库容量远超 chrome.storage（通常 > 100MB）
// ============================================

const DB_NAME = 'NoteTakerDB';
const DB_VERSION = 1;
const STORE_NAME = 'notes';

/**
 * 打开数据库连接
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        // id 为主键，createdAt 为索引（方便排序）
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('videoUrl', 'videoUrl', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };
  });
}

// ==================== CRUD ====================

/**
 * 保存或更新一条笔记
 */
async function dbSaveNote(noteData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(noteData); // put = insert or update

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * 获取单条笔记
 */
async function dbGetNote(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => { db.close(); resolve(request.result || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

/**
 * 获取所有笔记（可选按 videoUrl 过滤）
 * 返回按 createdAt 倒序排列
 */
async function dbGetAllNotes(filter = {}) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      db.close();
      let notes = request.result || [];

      // 过滤
      if (filter.videoUrl) {
        notes = notes.filter(n => n.videoUrl === filter.videoUrl);
      }

      // 倒序（最新在前）
      notes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      resolve(notes);
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

/**
 * 删除单条笔记
 */
async function dbDeleteNote(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(id);

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * 删除所有笔记
 */
async function dbDeleteAllNotes() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/**
 * 获取笔记总数
 */
async function dbGetCount() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();

    request.onsuccess = () => { db.close(); resolve(request.result); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

/**
 * 获取数据库占用大小（估算）
 */
async function dbGetSize() {
  if (!navigator.storage || !navigator.storage.estimate) return -1;
  try {
    const estimate = await navigator.storage.estimate();
    return estimate.usage || 0;
  } catch (e) {
    return -1;
  }
}
