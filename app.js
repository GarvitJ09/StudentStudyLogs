import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut as fbSignOut
} from 'firebase/auth';
import {
  initializeFirestore, doc, getDoc, setDoc,
  persistentLocalCache, persistentMultipleTabManager
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
const googleProvider = new GoogleAuthProvider();

const SUBJECTS = [
  { id: 'phy_chem', name: 'Physical Chem', color: 'var(--phy-chem)' },
  { id: 'org_chem', name: 'Organic Chem', color: 'var(--org-chem)' },
  { id: 'inorg_chem', name: 'Inorganic Chem', color: 'var(--inorg-chem)' },
  { id: 'physics', name: 'Physics', color: 'var(--physics)' },
  { id: 'maths', name: 'Maths', color: 'var(--maths)' },
  { id: 'botany', name: 'Botany', color: 'var(--botany)' },
  { id: 'zoology', name: 'Zoology', color: 'var(--zoology)' }
];
const TARGETS = [
  { id: 'neet_2027', label: 'Crack NEET 2027' },
  { id: 'jee_2027', label: 'Crack JEE 2027' }
];
const COLLECTIONS = ['profile', 'chapters', 'class_logs', 'revisions', 'dpp', 'tests'];

// ============ STATE ============
let currentUser = null;
let profile = null;
let chapters = [], classLogs = [], revisions = [], dpp = [], tests = [];

const writeTimers = {};
function queueWrite(name, data) {
  setSyncStatus('syncing');
  if (writeTimers[name]) clearTimeout(writeTimers[name]);
  writeTimers[name] = setTimeout(async () => {
    if (!currentUser) return;
    try {
      const ref = doc(db, 'users', currentUser.uid, 'data', name);
      const payload = name === 'profile' ? data : { items: data };
      await setDoc(ref, payload);
      setSyncStatus('synced');
    } catch (err) {
      console.error('Write failed:', err);
      setSyncStatus('offline');
    }
  }, 400);
}

function setSyncStatus(status) {
  const el = document.getElementById('sync-indicator');
  if (!el) return;
  el.classList.remove('syncing', 'offline');
  if (status === 'syncing') el.classList.add('syncing');
  else if (status === 'offline') el.classList.add('offline');
  el.title = status;
}

// ============ AUTH ============
document.getElementById('signin-btn').addEventListener('click', async () => {
  document.getElementById('auth-error').textContent = '';
  try {
    await signInWithPopup(auth, googleProvider);
  } catch (err) {
    console.error(err);
    document.getElementById('auth-error').textContent = err.message || 'Sign in failed.';
  }
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    document.getElementById('loading-text').textContent = 'Loading your data...';
    await loadAllUserData();
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    document.getElementById('loading-overlay').classList.add('hidden');
    setupAvatar();
    renderHeader();
    renderToday();
    if (!profile || !profile.name) {
      setTimeout(() => openProfileModal(true), 200);
    }
  } else {
    currentUser = null;
    profile = null; chapters = []; classLogs = []; revisions = []; dpp = []; tests = [];
    document.getElementById('app-shell').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('loading-overlay').classList.add('hidden');
  }
});

window.signOut = async function() {
  if (!confirm('Sign out? Your data is safe in the cloud.')) return;
  try { await fbSignOut(auth); }
  catch (err) { console.error(err); toast('Sign out failed'); }
};

function setupAvatar() {
  const av = document.getElementById('header-avatar');
  const fb = document.getElementById('avatar-fallback');
  if (currentUser.photoURL) {
    av.innerHTML = `<img src="${currentUser.photoURL}" referrerpolicy="no-referrer" alt="">`;
  } else {
    fb.textContent = (currentUser.displayName || currentUser.email || '?').charAt(0).toUpperCase();
  }
}

async function loadAllUserData() {
  const uid = currentUser.uid;
  try {
    const reads = COLLECTIONS.map(name => getDoc(doc(db, 'users', uid, 'data', name)));
    const snaps = await Promise.all(reads);
    snaps.forEach((snap, i) => {
      const name = COLLECTIONS[i];
      if (!snap.exists()) {
        if (name === 'profile') profile = null;
        else assignCollection(name, []);
        return;
      }
      const data = snap.data();
      if (name === 'profile') profile = data || null;
      else assignCollection(name, data.items || []);
    });
    setSyncStatus('synced');
  } catch (err) {
    console.error('Load failed:', err);
    setSyncStatus('offline');
    toast('Could not load data — working offline');
  }
}

function assignCollection(name, items) {
  if (name === 'chapters') chapters = items;
  else if (name === 'class_logs') classLogs = items;
  else if (name === 'revisions') revisions = items;
  else if (name === 'dpp') dpp = items;
  else if (name === 'tests') tests = items;
}

function persist(name) {
  if (name === 'profile') queueWrite('profile', profile || {});
  else if (name === 'chapters') queueWrite('chapters', chapters);
  else if (name === 'class_logs') queueWrite('class_logs', classLogs);
  else if (name === 'revisions') queueWrite('revisions', revisions);
  else if (name === 'dpp') queueWrite('dpp', dpp);
  else if (name === 'tests') queueWrite('tests', tests);
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function fmtDate(d) { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
function getSubject(id) { return SUBJECTS.find(s => s.id === id); }
function getChapter(id) { return chapters.find(c => c.id === id); }
function chaptersBySubject(subjId) { return chapters.filter(c => c.subject_id === subjId); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderHeader() {
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const title = document.getElementById('app-title');
  const dateEl = document.getElementById('today-date');
  const targetEl = document.getElementById('app-target');
  if (profile && profile.name) {
    title.textContent = `Hi, ${profile.name.split(' ')[0]}`;
  } else {
    title.textContent = "Today's diary";
  }
  dateEl.textContent = dateStr;
  if (profile && profile.target) {
    const t = TARGETS.find(x => x.id === profile.target);
    targetEl.textContent = t ? t.label : '';
  } else {
    targetEl.textContent = '';
  }
}

window.openProfileModal = function(isFirstTime) {
  const targetOptions = TARGETS.map(t =>
    `<option value="${t.id}" ${profile && profile.target === t.id ? 'selected' : ''}>${t.label}</option>`
  ).join('');
  const defaultName = (profile && profile.name) || (currentUser && currentUser.displayName) || '';
  openModal(`
    <h3 class="modal-h">${isFirstTime ? 'Welcome 👋' : 'Edit profile'}</h3>
    ${isFirstTime ? '<p class="muted" style="margin: -8px 0 16px;">Just two quick things and you are in.</p>' : ''}
    <div class="field">
      <label>Your name</label>
      <input class="input" id="p-name" placeholder="Your name" value="${escapeHtml(defaultName)}" autofocus>
    </div>
    <div class="field">
      <label>Target</label>
      <select class="select" id="p-target">${targetOptions}</select>
    </div>
    <div class="btn-row" style="margin-top: 16px;">
      ${isFirstTime ? '' : '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>'}
      <button class="btn btn-accent" onclick="saveProfile()">${isFirstTime ? "Let's go" : 'Save'}</button>
    </div>
  `);
};

window.saveProfile = function() {
  const name = document.getElementById('p-name').value.trim();
  const target = document.getElementById('p-target').value;
  if (!name) { toast('Type your name'); return; }
  profile = { name, target };
  persist('profile');
  closeModal();
  renderHeader();
  renderStats();
  toast('Saved');
};

window.showScreen = function(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  if (name === 'today') renderToday();
  if (name === 'chapters') renderChapters();
  if (name === 'dpp') renderDpp();
  if (name === 'tests') renderTests();
  if (name === 'stats') renderStats();
};

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1600);
}
window.toast = toast;

function openModal(html) {
  document.getElementById('modal-content').innerHTML = '<div class="modal-grip"></div>' + html;
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}
window.openModal = openModal;
window.closeModal = function() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
};

function renderToday() {
  const today = todayStr();
  const todayClasses = classLogs.filter(l => l.date === today);
  const todayRev = revisions.filter(r => r.date === today);
  const todayDpp = dpp.filter(d => d.date === today);

  document.getElementById('today-summary').innerHTML = `
    <div class="row"><span>Classes logged</span><span class="v">${todayClasses.length}</span></div>
    <div class="row"><span>Revisions done</span><span class="v">${todayRev.length}</span></div>
    <div class="row"><span>DPPs solved</span><span class="v">${todayDpp.length}</span></div>
  `;

  const act = document.getElementById('today-activity');
  const items = [];
  todayClasses.forEach(l => {
    const ch = getChapter(l.chapter_id);
    if (!ch) return;
    const subj = getSubject(ch.subject_id);
    const extras = [];
    if (l.notes_completed) extras.push('notes ✓');
    if (l.revised_past_notes) extras.push('past notes ✓');
    items.push({
      type: 'class', id: l.id,
      title: ch.name,
      sub: `${subj.name} · class ${l.class_status}${extras.length ? ' · ' + extras.join(' · ') : ''}`,
      color: subj.color
    });
  });
  todayRev.forEach(r => {
    const ch = getChapter(r.chapter_id);
    if (!ch) return;
    const subj = getSubject(ch.subject_id);
    items.push({
      type: 'revision', id: r.id,
      title: ch.name,
      sub: `${subj.name} · revision · ${r.status.replace('_', ' ')}`,
      color: subj.color
    });
  });
  todayDpp.forEach(d => {
    const subj = getSubject(d.subject_id);
    items.push({
      type: 'dpp', id: d.id,
      title: d.sheet_name || 'DPP sheet',
      sub: `${subj.name} · ${d.status.replace('_', ' ')}`,
      color: subj.color
    });
  });

  if (items.length === 0) {
    act.innerHTML = '<div class="empty"><div class="empty-emoji">📓</div>Nothing logged yet today.<br>Use the buttons above to start.</div>';
  } else {
    act.innerHTML = items.map(i => `
      <div class="card" onclick="editActivity('${i.type}', '${i.id}')">
        <div class="card-edge" style="background: ${i.color};"></div>
        <div class="card-content">
          <div class="card-title">${escapeHtml(i.title)}</div>
          <div class="card-sub">${escapeHtml(i.sub)}</div>
        </div>
        <div style="color: var(--ink-faint); font-size: 18px;">›</div>
      </div>
    `).join('');
  }
}
window.renderToday = renderToday;

// ============ EDIT EXISTING ENTRIES ============
window.editActivity = function(type, id) {
  if (type === 'class') return editClassLog(id);
  if (type === 'revision') return editRevision(id);
  if (type === 'dpp') return editDpp(id);
};

function editClassLog(id) {
  const log = classLogs.find(l => l.id === id);
  if (!log) return;
  const ch = getChapter(log.chapter_id);
  const subj = ch ? getSubject(ch.subject_id) : null;
  if (!ch) { toast('Chapter missing'); return; }
  openModal(`
    <h3 class="modal-h">Edit class log</h3>
    <div class="muted" style="margin-bottom: 16px;">${subj.name} · ${escapeHtml(ch.name)}</div>
    <div class="field">
      <label>Class status</label>
      <div class="btn-row" style="gap: 6px;">
        <button class="btn ${log.class_status === 'present' ? '' : 'btn-secondary'}" onclick="updateClassLog('${id}', 'class_status', 'present')">Present</button>
        <button class="btn ${log.class_status === 'absent' ? '' : 'btn-secondary'}" onclick="updateClassLog('${id}', 'class_status', 'absent')">Absent</button>
      </div>
    </div>
    <div class="check-row ${log.notes_completed ? 'checked' : ''}" onclick="toggleClassLogField('${id}', 'notes_completed')">
      <div class="check-box"></div>
      <div class="check-label">Notes completed in class</div>
    </div>
    <div class="check-row ${log.revised_past_notes ? 'checked' : ''}" onclick="toggleClassLogField('${id}', 'revised_past_notes')">
      <div class="check-box"></div>
      <div class="check-label">Revised past notes of this chapter</div>
    </div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary" style="color: #8B3A3A;" onclick="deleteClassLog('${id}')">Delete</button>
      <button class="btn" onclick="closeModal()">Done</button>
    </div>
  `);
}

window.updateClassLog = function(id, field, value) {
  const log = classLogs.find(l => l.id === id);
  if (!log) return;
  log[field] = value;
  persist('class_logs');
  editClassLog(id);
  toast('Updated');
};

window.toggleClassLogField = function(id, field) {
  const log = classLogs.find(l => l.id === id);
  if (!log) return;
  log[field] = !log[field];
  persist('class_logs');
  editClassLog(id);
};

window.deleteClassLog = function(id) {
  if (!confirm('Delete this class log?')) return;
  classLogs = classLogs.filter(l => l.id !== id);
  persist('class_logs');
  closeModal();
  toast('Deleted');
  renderToday();
};

function editRevision(id) {
  const r = revisions.find(x => x.id === id);
  if (!r) return;
  const ch = getChapter(r.chapter_id);
  const subj = ch ? getSubject(ch.subject_id) : null;
  if (!ch) { toast('Chapter missing'); return; }
  openModal(`
    <h3 class="modal-h">Edit revision</h3>
    <div class="muted" style="margin-bottom: 16px;">${subj.name} · ${escapeHtml(ch.name)} · ${fmtDate(r.date)}</div>
    <div class="field">
      <label>How far did you get?</label>
      <div class="btn-row" style="gap: 6px;">
        ${['new', 'in_progress', 'completed'].map(st => `
          <button class="btn ${r.status === st ? '' : 'btn-secondary'}" style="font-size: 13px; padding: 10px 8px;" onclick="updateRevision('${id}', '${st}')">${st === 'new' ? 'just started' : st.replace('_', ' ')}</button>
        `).join('')}
      </div>
    </div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary" style="color: #8B3A3A;" onclick="deleteRevision('${id}')">Delete</button>
      <button class="btn" onclick="closeModal()">Done</button>
    </div>
  `);
}

window.updateRevision = function(id, status) {
  const r = revisions.find(x => x.id === id);
  if (!r) return;
  r.status = status;
  persist('revisions');
  editRevision(id);
  toast('Updated');
};

window.deleteRevision = function(id) {
  if (!confirm('Delete this revision?')) return;
  revisions = revisions.filter(r => r.id !== id);
  persist('revisions');
  closeModal();
  toast('Deleted');
  renderToday();
};

function editDpp(id) {
  const d = dpp.find(x => x.id === id);
  if (!d) return;
  const subj = getSubject(d.subject_id);
  openModal(`
    <h3 class="modal-h">Edit DPP</h3>
    <div class="muted" style="margin-bottom: 16px;">${subj.name} · ${fmtDate(d.date)}</div>
    <div class="field">
      <label>Sheet name</label>
      <input class="input" id="ed-sheet" value="${escapeHtml(d.sheet_name || '')}" placeholder="Optional">
    </div>
    <div class="field">
      <label>Status</label>
      <div class="btn-row" style="gap: 6px;">
        ${['not_started', 'in_progress', 'completed'].map(st => `
          <button class="btn ${d.status === st ? '' : 'btn-secondary'}" style="font-size: 13px; padding: 10px 8px;" onclick="updateDppStatus('${id}', '${st}')">${st.replace('_', ' ')}</button>
        `).join('')}
      </div>
    </div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary" style="color: #8B3A3A;" onclick="deleteDpp('${id}')">Delete</button>
      <button class="btn" onclick="saveDppEdit('${id}')">Save</button>
    </div>
  `);
}

window.updateDppStatus = function(id, status) {
  const d = dpp.find(x => x.id === id);
  if (!d) return;
  d.status = status;
  persist('dpp');
  editDpp(id);
  toast('Updated');
};

window.saveDppEdit = function(id) {
  const d = dpp.find(x => x.id === id);
  if (!d) return;
  const newName = document.getElementById('ed-sheet').value.trim();
  d.sheet_name = newName;
  persist('dpp');
  closeModal();
  toast('Saved');
  renderToday();
  renderDpp();
};

window.deleteDpp = function(id) {
  if (!confirm('Delete this DPP entry?')) return;
  dpp = dpp.filter(d => d.id !== id);
  persist('dpp');
  closeModal();
  toast('Deleted');
  renderToday();
  renderDpp();
};

function renderChapters() {
  const grid = document.getElementById('subject-grid');
  grid.innerHTML = SUBJECTS.map(s => {
    const count = chaptersBySubject(s.id).length;
    return `
      <button class="subject-pill" onclick="filterChapters('${s.id}')">
        <span class="subj-dot" style="background: ${s.color};"></span>
        <span class="subj-name">${s.name}</span>
        <span class="subj-count">${count}</span>
      </button>
    `;
  }).join('');

  const wrap = document.getElementById('chapters-by-subject');
  if (chapters.length === 0) {
    wrap.innerHTML = '<div class="empty"><div class="empty-emoji">📚</div>No chapters yet.<br>Add your first one above.</div>';
    return;
  }
  let html = '';
  SUBJECTS.forEach(s => {
    const list = chaptersBySubject(s.id);
    if (list.length === 0) return;
    html += `<h3 class="section-h" style="display: flex; align-items: center; gap: 8px;"><span class="subj-dot" style="background: ${s.color};"></span>${s.name}</h3>`;
    html += list.map(ch => `
      <div class="card" onclick="openChapterDetail('${ch.id}')">
        <div class="card-edge" style="background: ${s.color};"></div>
        <div class="card-content">
          <div class="card-title">${escapeHtml(ch.name)}</div>
          <div class="card-sub">
            <span class="chip ${ch.status}">${ch.status.replace('_', ' ')}</span>
            <span class="chip ${ch.short_notes_status}">notes: ${ch.short_notes_status.replace('_', ' ')}</span>
          </div>
        </div>
      </div>
    `).join('');
  });
  wrap.innerHTML = html;
}
window.renderChapters = renderChapters;

window.filterChapters = function(subjId) {
  const subj = getSubject(subjId);
  const headers = document.querySelectorAll('#chapters-by-subject .section-h');
  for (const h of headers) {
    if (h.textContent.includes(subj.name)) {
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  }
  openAddChapter(subjId);
};

window.openAddChapter = function(presetSubject) {
  const subjOptions = SUBJECTS.map(s =>
    `<option value="${s.id}" ${s.id === presetSubject ? 'selected' : ''}>${s.name}</option>`
  ).join('');
  openModal(`
    <h3 class="modal-h">Add a chapter</h3>
    <div class="field"><label>Subject</label><select class="select" id="m-subject">${subjOptions}</select></div>
    <div class="field"><label>Chapter name</label><input class="input" id="m-name" placeholder="e.g. Thermodynamics" autofocus></div>
    <div class="btn-row">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn" onclick="saveChapter()">Add</button>
    </div>
  `);
};

window.saveChapter = function() {
  const subj = document.getElementById('m-subject').value;
  const name = document.getElementById('m-name').value.trim();
  if (!name) { toast('Type a chapter name'); return; }
  chapters.push({
    id: uid(), subject_id: subj, name,
    status: 'not_started', short_notes_status: 'new',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString()
  });
  persist('chapters');
  closeModal();
  toast('Chapter added');
  renderChapters();
};

window.openChapterDetail = function(chapterId) {
  const ch = getChapter(chapterId);
  if (!ch) return;
  const subj = getSubject(ch.subject_id);
  const myLogs = classLogs.filter(l => l.chapter_id === chapterId).length;
  const myRevs = revisions.filter(r => r.chapter_id === chapterId).length;
  openModal(`
    <h3 class="modal-h">${escapeHtml(ch.name)}</h3>
    <div class="muted" style="margin-bottom: 16px;">${subj.name}</div>
    <div class="field">
      <label>Chapter status</label>
      <div class="btn-row" style="gap: 6px;">
        ${['not_started', 'in_progress', 'completed'].map(st => `
          <button class="btn ${ch.status === st ? '' : 'btn-secondary'}" style="font-size: 13px; padding: 10px 8px;" onclick="setChapStatus('${ch.id}', '${st}')">${st.replace('_', ' ')}</button>
        `).join('')}
      </div>
    </div>
    <div class="field">
      <label>Short notes</label>
      <div class="btn-row" style="gap: 6px;">
        ${['new', 'in_progress', 'completed'].map(st => `
          <button class="btn ${ch.short_notes_status === st ? '' : 'btn-secondary'}" style="font-size: 13px; padding: 10px 8px;" onclick="setNotesStatus('${ch.id}', '${st}')">${st.replace('_', ' ')}</button>
        `).join('')}
      </div>
    </div>
    <div class="muted" style="margin: 16px 0 8px;">${myLogs} class${myLogs === 1 ? '' : 'es'} logged · ${myRevs} revision${myRevs === 1 ? '' : 's'}</div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary" style="color: #8B3A3A;" onclick="deleteChapter('${ch.id}')">Delete</button>
      <button class="btn" onclick="closeModal()">Done</button>
    </div>
  `);
};

window.setChapStatus = function(id, status) {
  const ch = getChapter(id);
  if (!ch) return;
  ch.status = status;
  ch.updated_at = new Date().toISOString();
  persist('chapters');
  openChapterDetail(id);
  toast('Status updated');
};

window.setNotesStatus = function(id, status) {
  const ch = getChapter(id);
  if (!ch) return;
  ch.short_notes_status = status;
  ch.updated_at = new Date().toISOString();
  persist('chapters');
  openChapterDetail(id);
  toast('Notes updated');
};

window.deleteChapter = function(id) {
  if (!confirm('Delete this chapter?')) return;
  chapters = chapters.filter(c => c.id !== id);
  persist('chapters');
  closeModal();
  toast('Deleted');
  renderChapters();
};

window.openLogClass = function() {
  if (chapters.length === 0) {
    openModal(`
      <h3 class="modal-h">No chapters yet</h3>
      <p class="muted">Add a chapter first, then come back to log a class.</p>
      <div class="btn-row" style="margin-top: 16px;">
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        <button class="btn" onclick="closeModal(); showScreen('chapters'); openAddChapter()">Add chapter</button>
      </div>
    `);
    return;
  }
  const subjOptions = SUBJECTS.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  openModal(`
    <h3 class="modal-h">Log today's class</h3>
    <div class="field"><label>Subject</label><select class="select" id="m-subject" onchange="updateChapterDropdown()">${subjOptions}</select></div>
    <div class="field"><label>Chapter</label><select class="select" id="m-chapter"></select></div>
    <div class="field">
      <label>Class status</label>
      <div class="btn-row" style="gap: 6px;">
        <button class="btn" id="cl-present" onclick="toggleClassStatus('present')">Present</button>
        <button class="btn btn-secondary" id="cl-absent" onclick="toggleClassStatus('absent')">Absent</button>
      </div>
    </div>
    <div class="check-row checked" id="cl-notes" onclick="toggleNotes()">
      <div class="check-box"></div>
      <div class="check-label">Notes completed in class</div>
    </div>
    <div class="check-row" id="cl-past" onclick="togglePastNotes()">
      <div class="check-box"></div>
      <div class="check-label">Revised past notes of this chapter</div>
    </div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" onclick="saveClassLog()">Save</button>
    </div>
  `);
  window._cl = { class_status: 'present', notes_completed: true, revised_past_notes: false };
  updateChapterDropdown();
};

window.toggleClassStatus = function(s) {
  window._cl.class_status = s;
  document.getElementById('cl-present').classList.toggle('btn-secondary', s !== 'present');
  document.getElementById('cl-absent').classList.toggle('btn-secondary', s !== 'absent');
  if (s === 'absent' && window._cl.notes_completed) toggleNotes();
};

window.toggleNotes = function() {
  window._cl.notes_completed = !window._cl.notes_completed;
  document.getElementById('cl-notes').classList.toggle('checked', window._cl.notes_completed);
};

window.togglePastNotes = function() {
  window._cl.revised_past_notes = !window._cl.revised_past_notes;
  document.getElementById('cl-past').classList.toggle('checked', window._cl.revised_past_notes);
};

window.updateChapterDropdown = function() {
  const subjId = document.getElementById('m-subject').value;
  const list = chaptersBySubject(subjId);
  const sel = document.getElementById('m-chapter');
  sel.innerHTML = list.length === 0
    ? `<option value="">— No chapters yet, add one first —</option>`
    : list.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
};

window.saveClassLog = function() {
  const chapterId = document.getElementById('m-chapter').value;
  const subjId = document.getElementById('m-subject').value;
  if (!chapterId) { toast('Add a chapter for this subject first'); return; }
  classLogs.push({
    id: uid(), date: todayStr(), subject_id: subjId, chapter_id: chapterId,
    class_status: window._cl.class_status,
    notes_completed: window._cl.notes_completed,
    revised_past_notes: window._cl.revised_past_notes
  });
  persist('class_logs');
  closeModal();
  toast('Class logged');
  renderToday();
};

window.openLogRevision = function() {
  if (chapters.length === 0) { toast('Add a chapter first'); return; }
  const subjOptions = SUBJECTS.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  openModal(`
    <h3 class="modal-h">Add a revision</h3>
    <div class="field"><label>Subject</label><select class="select" id="m-subject" onchange="updateChapterDropdown()">${subjOptions}</select></div>
    <div class="field"><label>Chapter</label><select class="select" id="m-chapter"></select></div>
    <div class="field">
      <label>How far did you get?</label>
      <div class="btn-row" style="gap: 6px;">
        <button class="btn" id="rv-new" onclick="setRevStatus('new')">Just started</button>
        <button class="btn btn-secondary" id="rv-in_progress" onclick="setRevStatus('in_progress')">In progress</button>
        <button class="btn btn-secondary" id="rv-completed" onclick="setRevStatus('completed')">Done</button>
      </div>
    </div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" onclick="saveRevision()">Save</button>
    </div>
  `);
  window._rv = { status: 'new' };
  updateChapterDropdown();
};

window.setRevStatus = function(s) {
  window._rv.status = s;
  ['new', 'in_progress', 'completed'].forEach(st => {
    const el = document.getElementById('rv-' + st);
    if (el) el.classList.toggle('btn-secondary', s !== st);
  });
};

window.saveRevision = function() {
  const chapterId = document.getElementById('m-chapter').value;
  const subjId = document.getElementById('m-subject').value;
  if (!chapterId) { toast('Add a chapter first'); return; }
  revisions.push({
    id: uid(), date: todayStr(), subject_id: subjId,
    chapter_id: chapterId, status: window._rv.status
  });
  persist('revisions');
  closeModal();
  toast('Revision logged');
  renderToday();
};

window.openLogDpp = function() {
  const subjOptions = SUBJECTS.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  openModal(`
    <h3 class="modal-h">Add a DPP sheet</h3>
    <div class="field"><label>Subject</label><select class="select" id="m-subject">${subjOptions}</select></div>
    <div class="field"><label>Sheet name <span class="muted">(optional)</span></label><input class="input" id="m-sheetname" placeholder="e.g. DPP-1, Module 3 sheet"></div>
    <div class="field">
      <label>Status</label>
      <div class="btn-row" style="gap: 6px;">
        <button class="btn btn-secondary" id="dp-not_started" onclick="setDppStatus('not_started')">Not started</button>
        <button class="btn btn-secondary" id="dp-in_progress" onclick="setDppStatus('in_progress')">In progress</button>
        <button class="btn" id="dp-completed" onclick="setDppStatus('completed')">Completed</button>
      </div>
    </div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" onclick="saveDpp()">Save</button>
    </div>
  `);
  window._dp = { status: 'completed' };
};

window.setDppStatus = function(s) {
  window._dp.status = s;
  ['not_started', 'in_progress', 'completed'].forEach(st => {
    const el = document.getElementById('dp-' + st);
    if (el) el.classList.toggle('btn-secondary', s !== st);
  });
};

window.saveDpp = function() {
  const subjId = document.getElementById('m-subject').value;
  const sheetName = document.getElementById('m-sheetname').value.trim();
  dpp.push({ id: uid(), date: todayStr(), subject_id: subjId, sheet_name: sheetName, status: window._dp.status });
  persist('dpp');
  closeModal();
  toast('DPP saved');
  renderToday();
  renderDpp();
};

function renderDpp() {
  const list = document.getElementById('dpp-list');
  if (dpp.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-emoji">📝</div>No DPPs logged yet.</div>';
    return;
  }
  const bySubj = {};
  dpp.forEach(d => { bySubj[d.subject_id] = bySubj[d.subject_id] || []; bySubj[d.subject_id].push(d); });

  let html = '<div class="stat-grid" style="margin-bottom: 16px;">';
  SUBJECTS.forEach(s => {
    const sList = bySubj[s.id] || [];
    const completed = sList.filter(d => d.status === 'completed').length;
    html += `
      <div class="stat-card" style="padding: 12px 14px;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
          <span class="subj-dot" style="background: ${s.color};"></span>
          <span style="font-size: 12px; color: var(--ink-soft);">${s.name}</span>
        </div>
        <div class="stat-num" style="font-size: 22px;">${completed}<span style="font-size: 13px; color: var(--ink-faint); font-family: 'Inter', sans-serif; font-weight: 400;"> / ${sList.length}</span></div>
      </div>
    `;
  });
  html += '</div><h3 class="section-h">Recent</h3>';
  const recent = [...dpp].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  html += recent.map(d => {
    const s = getSubject(d.subject_id);
    return `
      <div class="card" onclick="editDppFromList('${d.id}')">
        <div class="card-edge" style="background: ${s.color};"></div>
        <div class="card-content">
          <div class="card-title">${escapeHtml(d.sheet_name || 'DPP sheet')}</div>
          <div class="card-sub">
            ${s.name} · ${fmtDate(d.date)}
            <span class="chip ${d.status}">${d.status.replace('_', ' ')}</span>
          </div>
        </div>
        <div style="color: var(--ink-faint); font-size: 18px;">›</div>
      </div>
    `;
  }).join('');
  list.innerHTML = html;
}
window.renderDpp = renderDpp;

window.editDppFromList = function(id) { editDpp(id); };

window.cycleDppStatus = function(id) {
  const order = ['not_started', 'in_progress', 'completed'];
  const item = dpp.find(d => d.id === id);
  if (!item) return;
  item.status = order[(order.indexOf(item.status) + 1) % order.length];
  persist('dpp');
  toast('Status: ' + item.status.replace('_', ' '));
  renderDpp();
};

window.openLogTest = function() {
  openModal(`
    <h3 class="modal-h">Add a test</h3>
    <div class="field"><label>Test name</label><input class="input" id="t-name" placeholder="e.g. Allen Major Test 4" autofocus></div>
    <div class="field"><label>Test type</label><input class="input" id="t-type" placeholder="e.g. Major Test, Part Test, Surprise"></div>
    <div class="field"><label>Date</label><input class="input" id="t-date" type="date" value="${todayStr()}"></div>
    <div class="field">
      <label>Analyzed?</label>
      <div class="btn-row" style="gap: 6px;">
        <button class="btn" id="ta-new" onclick="setTestAna('new')">Not yet</button>
        <button class="btn btn-secondary" id="ta-in_progress" onclick="setTestAna('in_progress')">Doing</button>
        <button class="btn btn-secondary" id="ta-completed" onclick="setTestAna('completed')">Done</button>
      </div>
    </div>
    <div class="field"><label>Notes <span class="muted">(optional)</span></label><textarea id="t-notes" placeholder="Anything you want to remember..."></textarea></div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" onclick="saveTest()">Save</button>
    </div>
  `);
  window._tt = { ana: 'new' };
};

window.setTestAna = function(s) {
  window._tt.ana = s;
  ['new', 'in_progress', 'completed'].forEach(st => {
    const el = document.getElementById('ta-' + st);
    if (el) el.classList.toggle('btn-secondary', s !== st);
  });
};

window.saveTest = function() {
  const name = document.getElementById('t-name').value.trim();
  if (!name) { toast('Enter test name'); return; }
  tests.push({
    id: uid(), date: document.getElementById('t-date').value || todayStr(),
    test_name: name, test_type: document.getElementById('t-type').value.trim(),
    analyzed_status: window._tt.ana, notes: document.getElementById('t-notes').value.trim()
  });
  persist('tests');
  closeModal();
  toast('Test saved');
  renderTests();
};

function renderTests() {
  const list = document.getElementById('tests-list');
  if (tests.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-emoji">🎯</div>No tests yet.</div>';
    return;
  }
  const sorted = [...tests].sort((a, b) => b.date.localeCompare(a.date));
  list.innerHTML = sorted.map(t => `
    <div class="card" onclick="openTestDetail('${t.id}')">
      <div class="card-edge" style="background: var(--accent);"></div>
      <div class="card-content">
        <div class="card-title">${escapeHtml(t.test_name)}</div>
        <div class="card-sub">
          ${fmtDate(t.date)}${t.test_type ? ' · ' + escapeHtml(t.test_type) : ''}
          <span class="chip ${t.analyzed_status}">${t.analyzed_status === 'new' ? 'not analyzed' : t.analyzed_status.replace('_', ' ')}</span>
        </div>
      </div>
    </div>
  `).join('');
}
window.renderTests = renderTests;

window.openTestDetail = function(id) {
  const t = tests.find(x => x.id === id);
  if (!t) return;
  openModal(`
    <h3 class="modal-h">${escapeHtml(t.test_name)}</h3>
    <div class="muted" style="margin-bottom: 16px;">${fmtDate(t.date)}${t.test_type ? ' · ' + escapeHtml(t.test_type) : ''}</div>
    <div class="field">
      <label>Analysis</label>
      <div class="btn-row" style="gap: 6px;">
        ${['new', 'in_progress', 'completed'].map(st => `
          <button class="btn ${t.analyzed_status === st ? '' : 'btn-secondary'}" style="font-size: 13px; padding: 10px 8px;" onclick="updateTestAna('${id}', '${st}')">${st === 'new' ? 'not yet' : st.replace('_', ' ')}</button>
        `).join('')}
      </div>
    </div>
    ${t.notes ? `<div class="field"><label>Notes</label><div class="card" style="display: block;">${escapeHtml(t.notes)}</div></div>` : ''}
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary" style="color: #8B3A3A;" onclick="deleteTest('${id}')">Delete</button>
      <button class="btn" onclick="closeModal()">Done</button>
    </div>
  `);
};

window.updateTestAna = function(id, status) {
  const t = tests.find(x => x.id === id);
  if (!t) return;
  t.analyzed_status = status;
  persist('tests');
  openTestDetail(id);
  toast('Updated');
};

window.deleteTest = function(id) {
  if (!confirm('Delete this test?')) return;
  tests = tests.filter(t => t.id !== id);
  persist('tests');
  closeModal();
  renderTests();
};

function renderStats() {
  const grid = document.getElementById('stat-grid');
  const totalChapters = chapters.length;
  const completedCh = chapters.filter(c => c.status === 'completed').length;
  const inProgCh = chapters.filter(c => c.status === 'in_progress').length;
  const totalDpp = dpp.filter(d => d.status === 'completed').length;
  const totalRev = revisions.length;
  const totalTests = tests.length;
  const shortNotesDone = chapters.filter(c => c.short_notes_status === 'completed').length;

  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-label">Chapters started</div>
      <div class="stat-num">${inProgCh + completedCh}<span style="font-size: 14px; color: var(--ink-faint); font-weight: 400; font-family: 'Inter', sans-serif;"> / ${totalChapters}</span></div>
      <div class="stat-bar"><div class="stat-bar-fill" style="width: ${totalChapters ? Math.round((inProgCh + completedCh) / totalChapters * 100) : 0}%;"></div></div>
    </div>
    <div class="stat-card"><div class="stat-label">Chapters done</div><div class="stat-num">${completedCh}</div></div>
    <div class="stat-card"><div class="stat-label">DPPs completed</div><div class="stat-num">${totalDpp}</div></div>
    <div class="stat-card"><div class="stat-label">Revisions done</div><div class="stat-num">${totalRev}</div></div>
    <div class="stat-card"><div class="stat-label">Tests taken</div><div class="stat-num">${totalTests}</div></div>
    <div class="stat-card"><div class="stat-label">Short notes ready</div><div class="stat-num">${shortNotesDone}</div></div>
  `;

  let html = '';
  SUBJECTS.forEach(s => {
    const total = chaptersBySubject(s.id).length;
    const done = chaptersBySubject(s.id).filter(c => c.status === 'completed').length;
    const dppCount = dpp.filter(d => d.subject_id === s.id && d.status === 'completed').length;
    const pct = total ? Math.round(done / total * 100) : 0;
    html += `
      <div class="subj-stat-row">
        <span class="subj-dot" style="background: ${s.color};"></span>
        <div style="flex: 1;">
          <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
            <span>${s.name}</span><span class="muted">${done}/${total} ch · ${dppCount} DPP</span>
          </div>
          <div class="subj-stat-bar"><div class="subj-stat-fill" style="width: ${pct}%; background: ${s.color};"></div></div>
        </div>
      </div>
    `;
  });
  document.getElementById('subj-stats').innerHTML = html;

  let snHtml = '';
  SUBJECTS.forEach(s => {
    const list = chaptersBySubject(s.id);
    const done = list.filter(c => c.short_notes_status === 'completed').length;
    const inProg = list.filter(c => c.short_notes_status === 'in_progress').length;
    snHtml += `
      <div class="subj-stat-row">
        <span class="subj-dot" style="background: ${s.color};"></span>
        <div style="flex: 1; font-size: 13px; display: flex; justify-content: space-between;">
          <span>${s.name}</span><span class="muted">${done} ready, ${inProg} in progress</span>
        </div>
      </div>
    `;
  });
  document.getElementById('short-notes-stats').innerHTML = snHtml;
}
window.renderStats = renderStats;

window.addEventListener('online', () => setSyncStatus('synced'));
window.addEventListener('offline', () => setSyncStatus('offline'));
