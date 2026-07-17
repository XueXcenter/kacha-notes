(function () {
  var app = document.getElementById('app');
  function fail(t) { app.innerHTML = '<div class="msg err">❌ ' + t + '</div>'; }
  function ok(html) { app.innerHTML = html; }

  if (!chrome || !chrome.storage) { fail('扩展环境不可用'); return; }

  chrome.storage.local.get(['_pv_html', '_pv_action', '_pv_note', '_pv_meta'], function (r) {
    if (chrome.runtime.lastError) { fail(chrome.runtime.lastError.message); return; }

    // ==== PDF 打印模式 ====
    if (r._pv_html && r._pv_action === 'print') {
      document.write(r._pv_html);
      document.close();
      setTimeout(function () { window.print(); }, 600);
      return;
    }

    // ==== 预览模式 ====
    var fullNote = r._pv_note;
    var meta = r._pv_meta;
    if (!fullNote) { fail('预览数据已过期，请重新打开笔记并点击预览'); return; }

    var tagsHtml = '';
    if (fullNote.tags && fullNote.tags.length) {
      tagsHtml = '<div class="tags">' + fullNote.tags.map(function (t) {
        return '<span class="tag">' + t + '</span>';
      }).join(' ') + '</div>';
    }

    var videoLink = fullNote.videoUrl
      ? '<span>🔗 <a href="' + fullNote.videoUrl + '" target="_blank">查看原视频</a></span>'
      : '';

    var noteText = fullNote.note || '';

    ok(
      '<div class="container">' +
      '<div class="header">' +
      '<h1>📸 笔记预览</h1>' +
      '<div class="meta">' +
      '<span>⏱ ' + (meta.timestamp || '00:00') + '</span>' +
      '<span>📺 ' + (fullNote.videoTitle || '未知视频') + '</span>' +
      videoLink +
      '</div>' +
      tagsHtml +
      '</div>' +
      '<div class="screenshot-wrap">' +
      '<img src="' + (fullNote.screenshot || '') + '" alt="截图">' +
      '</div>' +
      '<div class="note-section">' +
      '<h2>📝 笔记内容</h2>' +
      '<div class="note-content' + (noteText ? '' : ' note-empty') + '">' + (noteText || '无笔记') + '</div>' +
      '</div>' +
      '</div>'
    );
  });
})();
