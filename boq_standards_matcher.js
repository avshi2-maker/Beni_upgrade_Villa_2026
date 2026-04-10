// ═══════════════════════════════════════════════════════════════
//  boq_standards_matcher.js  — Auto-match BOQ rows to IS standards
//  Uses Claude AI (claude-sonnet-4-20250514) + standardsDB in memory
//  Saves stdKey to boq_items via Supabase PATCH (notes column)
//  Avshi Sapir / Stonhard-Beni CRM — 10/04/2026
// ═══════════════════════════════════════════════════════════════

(function() {
'use strict';

// ── CSS ──────────────────────────────────────────────────────────
var style = document.createElement('style');
style.textContent = [
  '#bsm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9100;display:none;align-items:center;justify-content:center;padding:16px}',
  '#bsm-panel{background:var(--surface,#fdf6e3);border:2px solid var(--gold,#c9a84c);border-radius:12px;width:min(860px,98vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden}',
  '#bsm-header{background:linear-gradient(135deg,#1a3d5c,#0f2a40);color:#e8c96a;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:10px}',
  '#bsm-header h3{margin:0;font-size:16px;font-weight:800}',
  '#bsm-body{padding:14px;overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:8px}',
  '#bsm-footer{padding:10px 14px;border-top:1px solid var(--border,#e0d5b7);display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}',
  '#bsm-progress{padding:8px 14px;font-size:12px;color:var(--text2,#7a6a3a);background:var(--surface2,#f5edd6);border-bottom:1px solid var(--border,#e0d5b7);display:none}',
  '#bsm-progress-bar{height:6px;background:var(--border,#e0d5b7);border-radius:4px;margin-top:6px;overflow:hidden}',
  '#bsm-progress-fill{height:100%;background:#c9a84c;border-radius:4px;transition:width .3s}',
  '.bsm-row{display:grid;grid-template-columns:1fr 220px 80px;gap:8px;align-items:start;padding:8px 10px;border:1px solid var(--border,#e0d5b7);border-radius:8px;background:var(--surface2,#f5edd6);font-size:12px}',
  '.bsm-row.bsm-ok{border-color:#4caf50}',
  '.bsm-row.bsm-skip{opacity:.5}',
  '.bsm-desc{font-weight:700;color:var(--text,#2a1f0e);font-size:13px;line-height:1.4}',
  '.bsm-reasoning{color:var(--text2,#7a6a3a);font-size:11px;margin-top:3px;line-height:1.4}',
  '.bsm-std-badge{background:#1a3d5c;color:#e8c96a;border-radius:5px;padding:3px 7px;font-size:11px;font-weight:700;text-align:center;cursor:pointer;transition:background .2s}',
  '.bsm-std-badge:hover{background:#c9a84c;color:#1a3d5c}',
  '.bsm-std-badge.bsm-none{background:var(--border,#e0d5b7);color:var(--text2,#7a6a3a);cursor:default}',
  '.bsm-actions{display:flex;flex-direction:column;gap:4px}',
  '.bsm-actions button{font-size:11px;padding:4px 8px;border-radius:5px;border:1px solid var(--border,#e0d5b7);cursor:pointer;font-family:Heebo,sans-serif;white-space:nowrap}',
  '.bsm-btn-approve{background:#4caf50;color:#fff;border-color:#4caf50!important}',
  '.bsm-btn-skip{background:var(--surface2,#f5edd6);color:var(--text2,#7a6a3a)}',
  '.bsm-btn-change{background:#1a3d5c;color:#e8c96a;border-color:#1a3d5c!important}',
  '.bsm-status-chip{font-size:10px;padding:2px 7px;border-radius:10px;font-weight:700}',
  '.bsm-chip-pending{background:#fff3cd;color:#856404}',
  '.bsm-chip-approved{background:#d4edda;color:#155724}',
  '.bsm-chip-skipped{background:#f8d7da;color:#721c24}',
  '.bsm-chip-saving{background:#cce5ff;color:#004085}',
  '.bsm-chip-saved{background:#d4edda;color:#155724}'
].join('\n');
document.head.appendChild(style);

// ── HTML ─────────────────────────────────────────────────────────
var div = document.createElement('div');
div.id = 'bsm-overlay';
div.innerHTML = [
  '<div id="bsm-panel">',
  '  <div id="bsm-header">',
  '    <h3>🤖 התאמת תקנים אוטומטית — Claude AI</h3>',
  '    <div style="display:flex;gap:8px;align-items:center">',
  '      <span id="bsm-counter" style="font-size:12px;opacity:.8"></span>',
  '      <button onclick="bsmClose()" style="background:transparent;border:1px solid #e8c96a;color:#e8c96a;border-radius:5px;padding:4px 10px;cursor:pointer;font-size:13px">✕ סגור</button>',
  '    </div>',
  '  </div>',
  '  <div id="bsm-progress">',
  '    <span id="bsm-progress-text">מתחיל ניתוח...</span>',
  '    <div id="bsm-progress-bar"><div id="bsm-progress-fill" style="width:0%"></div></div>',
  '  </div>',
  '  <div id="bsm-body"></div>',
  '  <div id="bsm-footer">',
  '    <span id="bsm-save-status" style="font-size:12px;color:var(--text2)"></span>',
  '    <button onclick="bsmApproveAll()" class="btn btn-secondary btn-sm">✅ אשר הכל</button>',
  '    <button onclick="bsmSaveApproved()" class="btn btn-primary">💾 שמור מאושרים לסופאבייס</button>',
  '  </div>',
  '</div>'
].join('');
document.body.appendChild(div);

// ── State ─────────────────────────────────────────────────────────
var bsmResults = [];   // [{rowId, catId, descHe, suggested:{standard_id,title_he}, reasoning, status}]
var bsmRunning = false;

// ── Open ──────────────────────────────────────────────────────────
window.openStandardsMatcher = function() {
  if (bsmRunning) { document.getElementById('bsm-overlay').style.display='flex'; return; }

  // Collect all BOQ rows that have no stdKey yet
  var rows = [];
  var cats = window.CATS || [];
  var data = window.boqData || {};
  cats.forEach(function(cat) {
    (data[cat.id]||[]).forEach(function(row) {
      if (!row.stdKey && row.descHe && row.descHe.trim()) {
        rows.push({ rowId: row.id, catId: cat.id, descHe: row.descHe });
      }
    });
  });

  if (!rows.length) {
    if (typeof toast === 'function') toast('כל השורות כבר כוללות תקן ✓', 'ok');
    return;
  }

  bsmResults = rows.map(function(r) {
    return { rowId: r.rowId, catId: r.catId, descHe: r.descHe,
             suggested: null, reasoning: '', status: 'pending' };
  });

  document.getElementById('bsm-overlay').style.display = 'flex';
  bsmRender();
  bsmRunAll(rows);
};

// ── Close ─────────────────────────────────────────────────────────
window.bsmClose = function() {
  document.getElementById('bsm-overlay').style.display = 'none';
};

// ── Render all result rows ─────────────────────────────────────────
function bsmRender() {
  var approved = bsmResults.filter(function(r){ return r.status==='approved'; }).length;
  var total    = bsmResults.length;
  document.getElementById('bsm-counter').textContent = approved + '/' + total + ' מאושרים';

  var html = '';
  bsmResults.forEach(function(r, i) {
    var chipClass = { pending:'bsm-chip-pending', approved:'bsm-chip-approved',
                      skipped:'bsm-chip-skipped', saving:'bsm-chip-saving',
                      saved:'bsm-chip-saved' }[r.status] || 'bsm-chip-pending';
    var chipLabel = { pending:'ממתין', approved:'מאושר', skipped:'מדולג',
                      saving:'שומר...', saved:'נשמר ✓' }[r.status] || 'ממתין';

    var badgeHtml = r.suggested
      ? '<div class="bsm-std-badge" title="' + (r.suggested.title_he||'') + '">' +
          r.suggested.standard_id + '</div>' +
        '<div style="font-size:10px;color:var(--text2);margin-top:3px;line-height:1.3">' +
          (r.suggested.title_he||'').substr(0,60) + '</div>'
      : '<div class="bsm-std-badge bsm-none">לא נמצא</div>';

    var approveDisabled = (!r.suggested || r.status==='saved') ? 'disabled' : '';
    var rowClass = r.status==='approved'||r.status==='saved' ? 'bsm-ok' :
                   r.status==='skipped' ? 'bsm-skip' : '';

    html += '<div class="bsm-row ' + rowClass + '" id="bsm-row-' + i + '">' +
      '<div>' +
        '<div class="bsm-desc">' + esc2(r.descHe) + '</div>' +
        '<div class="bsm-reasoning">' + esc2(r.reasoning) + '</div>' +
      '</div>' +
      '<div>' + badgeHtml + '</div>' +
      '<div class="bsm-actions">' +
        '<span class="bsm-status-chip ' + chipClass + '">' + chipLabel + '</span>' +
        '<button class="bsm-actions bsm-btn-approve" ' + approveDisabled +
          ' onclick="bsmApproveOne(' + i + ')">✅ אשר</button>' +
        '<button class="bsm-actions bsm-btn-skip" onclick="bsmSkipOne(' + i + ')">⏭ דלג</button>' +
      '</div>' +
    '</div>';
  });
  document.getElementById('bsm-body').innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--text2)">אין שורות לעיבוד</div>';
}

// ── Escape for HTML ───────────────────────────────────────────────
function esc2(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Run Claude AI on all rows ──────────────────────────────────────
function bsmRunAll(rows) {
  bsmRunning = true;
  var prog = document.getElementById('bsm-progress');
  var progText = document.getElementById('bsm-progress-text');
  var progFill = document.getElementById('bsm-progress-fill');
  prog.style.display = 'block';

  // Build compact standards list for Claude (id + title only, to save tokens)
  var db = window.standardsDB || [];
  var stdList = db.map(function(s) {
    return (s.standard_id||s.id) + ' | ' + (s.title_he||'');
  }).join('\n');

  // Batch rows into groups of 15 to avoid huge prompts
  var BATCH = 15;
  var batches = [];
  for (var i = 0; i < rows.length; i += BATCH) {
    batches.push(rows.slice(i, i + BATCH));
  }

  var done = 0;
  var total = rows.length;

  function runBatch(batchIdx) {
    if (batchIdx >= batches.length) {
      prog.style.display = 'none';
      bsmRunning = false;
      bsmRender();
      return;
    }
    var batch = batches[batchIdx];
    var startIdx = batchIdx * BATCH;

    progText.textContent = 'מנתח שורות ' + (done+1) + '–' + Math.min(done+batch.length, total) + ' מתוך ' + total + '...';
    progFill.style.width = Math.round(done/total*100) + '%';

    var rowsText = batch.map(function(r, j) {
      return (startIdx+j+1) + '. ' + r.descHe;
    }).join('\n');

    var prompt = 'You are a construction standards expert. Match each BOQ item to the BEST Israeli building standard from the list.\n\n' +
      'BOQ ITEMS:\n' + rowsText + '\n\n' +
      'STANDARDS DATABASE (standard_id | title_he):\n' + stdList + '\n\n' +
      'Respond ONLY with a JSON array. One object per item, in order:\n' +
      '[{"idx":1,"standard_id":"IS-XXXX","title_he":"...","reasoning":"short Hebrew reason"},…]\n' +
      'If no match exists, use standard_id: null. No markdown, no explanation outside JSON.';

    fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var text = (data.content||[]).map(function(c){ return c.text||''; }).join('');
      // Strip possible markdown fences
      text = text.replace(/```json|```/g,'').trim();
      var parsed;
      try { parsed = JSON.parse(text); } catch(e) { parsed = []; }

      batch.forEach(function(row, j) {
        var match = parsed.find(function(p){ return p.idx === (startIdx+j+1); });
        var globalIdx = startIdx + j;
        if (match && match.standard_id) {
          // Find full standard object from DB
          var std = db.find(function(s){ return s.standard_id === match.standard_id; });
          bsmResults[globalIdx].suggested = std || { standard_id: match.standard_id, title_he: match.title_he||'' };
          bsmResults[globalIdx].reasoning = match.reasoning || '';
        } else {
          bsmResults[globalIdx].reasoning = 'לא נמצא תקן מתאים';
        }
        bsmResults[globalIdx].status = 'pending';
      });

      done += batch.length;
      bsmRender();
      runBatch(batchIdx + 1);
    })
    .catch(function(e) {
      // Mark batch as failed, continue
      batch.forEach(function(row, j) {
        bsmResults[startIdx+j].reasoning = 'שגיאה: ' + (e.message||'').substr(0,40);
      });
      done += batch.length;
      bsmRender();
      runBatch(batchIdx + 1);
    });
  }

  runBatch(0);
}

// ── Approve one ───────────────────────────────────────────────────
window.bsmApproveOne = function(i) {
  if (!bsmResults[i] || !bsmResults[i].suggested) return;
  bsmResults[i].status = 'approved';
  // Update in-memory boqData immediately
  var r = bsmResults[i];
  var key = r.suggested.standard_id || String(r.suggested.id||'');
  if (typeof upd === 'function') upd(r.catId, r.rowId, 'stdKey', key);
  bsmRender();
};

// ── Skip one ──────────────────────────────────────────────────────
window.bsmSkipOne = function(i) {
  bsmResults[i].status = 'skipped';
  bsmRender();
};

// ── Approve all that have a suggestion ───────────────────────────
window.bsmApproveAll = function() {
  bsmResults.forEach(function(r, i) {
    if (r.suggested && r.status === 'pending') bsmApproveOne(i);
  });
};

// ── Save approved rows to Supabase ────────────────────────────────
window.bsmSaveApproved = function() {
  var approved = bsmResults.filter(function(r) {
    return r.status === 'approved' && r.suggested;
  });
  if (!approved.length) {
    if (typeof toast === 'function') toast('אין שורות מאושרות לשמירה','err');
    return;
  }

  var sbUrl = window.SB_NEW_URL;
  var sbKey = window.SB_NEW_KEY;
  if (!sbUrl || !sbKey) {
    if (typeof toast === 'function') toast('חסרים פרטי Supabase','err');
    return;
  }

  var statusEl = document.getElementById('bsm-save-status');
  statusEl.textContent = 'שומר ' + approved.length + ' שורות...';

  var promises = approved.map(function(r, i) {
    var key = r.suggested.standard_id || String(r.suggested.id||'');
    // Mark saving in UI
    var idx = bsmResults.indexOf(r);
    bsmResults[idx].status = 'saving';

    return fetch(sbUrl + '/rest/v1/boq_items?id=eq.' + r.rowId, {
      method: 'PATCH',
      headers: {
        'apikey': sbKey,
        'Authorization': 'Bearer ' + sbKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ notes: key })
    })
    .then(function(res) {
      bsmResults[idx].status = res.ok ? 'saved' : 'approved';
      return res.ok;
    })
    .catch(function() {
      bsmResults[idx].status = 'approved';
      return false;
    });
  });

  bsmRender();

  Promise.all(promises).then(function(results) {
    var saved = results.filter(Boolean).length;
    statusEl.textContent = 'נשמרו ' + saved + ' מתוך ' + approved.length;
    if (typeof toast === 'function') toast('תקנים נשמרו: ' + saved + ' ✓', 'ok');
    bsmRender();
  });
};

// ── Done ──────────────────────────────────────────────────────────
if (typeof toast === 'function') toast('מודול התאמת תקנים נטען ✓','ok');

})();
