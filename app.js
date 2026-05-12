import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup,
  onAuthStateChanged, signOut as fbSignOut
} from 'firebase/auth';
import {
  initializeFirestore, doc, getDoc, setDoc, deleteDoc,
  collection, getDocs,
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
  { id: 'neet_2026', label: 'Crack NEET 2026' },
  { id: 'neet_2027', label: 'Crack NEET 2027' },
  { id: 'jee_2027', label: 'Crack JEE 2027' }
];
// ============ STATE ============
let currentUser = null;
let profile = null;
let chapters = [], classLogs = [], revisions = [], dpp = [], tests = [];

const filters = {
  today: { subject: 'all' },
  chapters: { subject: 'all', status: 'all' },
  dpp: { subject: 'all', status: 'all' },
  tests: { status: 'all' },
  history: { type: 'all', subject: 'all' }
};

window.setFilter = function (page, key, value) {
  filters[page][key] = value;
  if (page === 'today') renderToday();
  else if (page === 'chapters') renderChapters();
  else if (page === 'dpp') renderDpp();
  else if (page === 'tests') renderTests();
  else if (page === 'history') renderHistory();
};

function subjectFilterOptions(selected) {
  return `<option value="all" ${selected === 'all' ? 'selected' : ''}>All subjects</option>` +
    SUBJECTS.map(s => `<option value="${s.id}" ${selected === s.id ? 'selected' : ''}>${s.name}</option>`).join('');
}

function statusFilterOptions(selected, kind) {
  const opts = {
    chapter: [['all', 'All statuses'], ['not_started', 'Not started'], ['in_progress', 'In progress'], ['completed', 'Completed']],
    dpp: [['all', 'All statuses'], ['not_started', 'Not started'], ['in_progress', 'In progress'], ['completed', 'Completed']],
    test: [['all', 'All'], ['new', 'Not analyzed'], ['in_progress', 'In progress'], ['completed', 'Done']]
  };
  return opts[kind].map(([v, l]) => `<option value="${v}" ${selected === v ? 'selected' : ''}>${l}</option>`).join('');
}

const writeTimers = {};
function upsertItem(collectionName, item) {
  if (!currentUser) return;
  setSyncStatus('syncing');
  const key = `${collectionName}:${item.id}`;
  if (writeTimers[key]) clearTimeout(writeTimers[key]);
  writeTimers[key] = setTimeout(async () => {
    try {
      const ref = doc(db, 'users', currentUser.uid, collectionName, item.id);
      await setDoc(ref, item);
      setSyncStatus('synced');
    } catch (err) {
      console.error('Write failed:', err);
      setSyncStatus('offline');
    }
  }, 400);
}

async function removeItem(collectionName, id) {
  if (!currentUser) return;
  setSyncStatus('syncing');
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, collectionName, id));
    setSyncStatus('synced');
  } catch (err) {
    console.error('Delete failed:', err);
    setSyncStatus('offline');
  }
}

function persistProfile() {
  if (!currentUser) return;
  setSyncStatus('syncing');
  const key = 'profile';
  if (writeTimers[key]) clearTimeout(writeTimers[key]);
  writeTimers[key] = setTimeout(async () => {
    try {
      await setDoc(doc(db, 'users', currentUser.uid), { ...(profile || {}), schema_v: 2 }, { merge: true });
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

window.signOut = async function () {
  const ok = await confirmModal({
    title: 'Sign out?',
    body: 'Your data is safe in the cloud. You can sign back in anytime.',
    confirmLabel: 'Sign out',
    danger: false
  });
  if (!ok) return;
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

const ITEM_COLLECTIONS = ['chapters', 'class_logs', 'revisions', 'dpp', 'tests'];

async function migrateOldDataIfNeeded(uid) {
  const userRef = doc(db, 'users', uid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.exists() ? userSnap.data() : {};
  if (userData.schema_v === 2) return;

  for (const name of ITEM_COLLECTIONS) {
    const oldRef = doc(db, 'users', uid, 'data', name);
    const oldSnap = await getDoc(oldRef);
    if (!oldSnap.exists()) continue;
    const items = (oldSnap.data() && oldSnap.data().items) || [];
    await Promise.all(items.map(item =>
      setDoc(doc(db, 'users', uid, name, item.id), item)
    ));
    await deleteDoc(oldRef);
  }

  const oldProfileRef = doc(db, 'users', uid, 'data', 'profile');
  const oldProfileSnap = await getDoc(oldProfileRef);
  let mergedProfile = { ...userData };
  if (oldProfileSnap.exists()) {
    mergedProfile = { ...mergedProfile, ...oldProfileSnap.data() };
    await deleteDoc(oldProfileRef);
  }
  await setDoc(userRef, { ...mergedProfile, schema_v: 2 }, { merge: true });
}

async function loadAllUserData() {
  const uid = currentUser.uid;
  try {
    await migrateOldDataIfNeeded(uid);

    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      const { schema_v, ...rest } = userSnap.data();
      profile = rest.name ? rest : null;
    } else {
      profile = null;
    }

    const snaps = await Promise.all(ITEM_COLLECTIONS.map(name =>
      getDocs(collection(db, 'users', uid, name))
    ));
    snaps.forEach((snap, i) => {
      assignCollection(ITEM_COLLECTIONS[i], snap.docs.map(d => d.data()));
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

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function todayStr() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); }
function nowIso() { return new Date().toISOString(); }
let selectedDate = todayStr();
function fmtDate(d) { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
function getSubject(id) { return SUBJECTS.find(s => s.id === id); }
function getChapter(id) { return chapters.find(c => c.id === id); }
function chaptersBySubject(subjId) { return chapters.filter(c => c.subject_id === subjId); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderItemCard(item) {
  return `
    <div class="card" onclick="editActivity('${item.type}', '${item.id}')">
      <div class="card-edge" style="background: ${item.color};"></div>
      <div class="card-content">
        <div class="card-title">${escapeHtml(item.title)}</div>
        <div class="card-sub">${escapeHtml(item.sub)}</div>
      </div>
      <div class="card-chevron">›</div>
    </div>
  `;
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

window.openProfileModal = function (isFirstTime) {
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

window.saveProfile = function () {
  const name = document.getElementById('p-name').value.trim();
  const target = document.getElementById('p-target').value;
  if (!name) { toast('Type your name'); return; }
  profile = { name, target };
  persistProfile();
  closeModal();
  renderHeader();
  renderStats();
  toast('Saved');
};

window.showScreen = function (name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.screen === name));
  if (name === 'today') renderToday();
  if (name === 'chapters') renderChapters();
  if (name === 'dpp') renderDpp();
  if (name === 'tests') renderTests();
  if (name === 'history') renderHistory();
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

let pendingConfirm = null;

function openModal(html) {
  const content = document.getElementById('modal-content');
  content.innerHTML = '<div class="modal-grip"></div>' + html;
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  // Focus first focusable element for a11y
  const focusable = content.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (focusable) setTimeout(() => focusable.focus(), 50);
}
window.openModal = openModal;
window.closeModal = function () {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
  if (pendingConfirm) {
    delete window[pendingConfirm.id];
    pendingConfirm.resolve(false);
    pendingConfirm = null;
  }
};

function confirmModal({ title, body, confirmLabel = 'Delete', danger = true }) {
  // Resolve any prior pending confirm safely
  if (pendingConfirm) {
    delete window[pendingConfirm.id];
    pendingConfirm.resolve(false);
    pendingConfirm = null;
  }
  return new Promise(resolve => {
    const id = 'cf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    pendingConfirm = { id, resolve };
    window[id] = (val) => {
      delete window[id];
      pendingConfirm = null;
      closeModal();
      resolve(val);
    };
    openModal(`
      <h3 class="modal-h">${escapeHtml(title)}</h3>
      <p class="muted" style="margin: -8px 0 16px;">${escapeHtml(body)}</p>
      <div class="btn-row" style="margin-top: 16px;">
        <button class="btn btn-secondary" onclick="${id}(false)">Cancel</button>
        <button class="btn ${danger ? 'btn-danger-fill' : ''}" onclick="${id}(true)">${escapeHtml(confirmLabel)}</button>
      </div>
    `);
  });
}
window.confirmModal = confirmModal;

function renderToday() {
  const date = selectedDate;
  const isToday = date === todayStr();
  const dayClasses = classLogs.filter(l => l.date === date);
  const dayRev = revisions.filter(r => r.date === date);
  const dayDpp = dpp.filter(d => d.date === date);
  const dayTests = tests.filter(t => t.date === date);

  const picker = document.getElementById('day-picker');
  if (picker) {
    if (picker.value !== date) picker.value = date;
    picker.max = todayStr();
  }
  const quickCards = document.getElementById('quick-cards');
  if (quickCards) quickCards.style.display = isToday ? '' : 'none';
  const heading = document.getElementById('today-activity-heading');
  if (heading) heading.textContent = isToday ? "Today's activity" : `Activity on ${fmtDate(date)}`;

  document.getElementById('today-summary').innerHTML = `
    <div class="row"><span>Classes logged</span><span class="v">${dayClasses.length}</span></div>
    <div class="row"><span>Revisions done</span><span class="v">${dayRev.length}</span></div>
    <div class="row"><span>DPPs solved</span><span class="v">${dayDpp.length}</span></div>
    <div class="row"><span>Tests taken</span><span class="v">${dayTests.length}</span></div>
  `;

  const sf = filters.today.subject;
  const matchSubj = (sid) => sf === 'all' || sid === sf;

  const act = document.getElementById('today-activity');
  const items = [];
  dayClasses.forEach(l => {
    if (!matchSubj(l.subject_id)) return;
    const ch = getChapter(l.chapter_id);
    if (!ch) return;
    const subj = getSubject(ch.subject_id);
    const extras = [];
    if (l.notes_completed) extras.push('class notes ✓');
    if (l.revised_today_notes) extras.push("today's notes ✓");
    if (l.revised_past_notes) extras.push('past notes ✓');
    items.push({
      type: 'class', id: l.id,
      title: ch.name,
      sub: `${subj.name} · class: ${l.class_status}${extras.length ? ' · ' + extras.join(' · ') : ''}`,
      color: subj.color
    });
  });
  dayRev.forEach(r => {
    if (!matchSubj(r.subject_id)) return;
    const ch = getChapter(r.chapter_id);
    if (!ch) return;
    const subj = getSubject(ch.subject_id);
    items.push({
      type: 'revision', id: r.id,
      title: ch.name,
      sub: `${subj.name} · revision: ${r.status.replace('_', ' ')}`,
      color: subj.color
    });
  });
  dayDpp.forEach(d => {
    if (!matchSubj(d.subject_id)) return;
    const subj = getSubject(d.subject_id);
    items.push({
      type: 'dpp', id: d.id,
      title: d.sheet_name || 'DPP sheet',
      sub: `${subj.name} · DPP: ${d.status.replace('_', ' ')}`,
      color: subj.color
    });
  });
  dayTests.forEach(t => {
    if (sf !== 'all') return;
    const ana = t.analyzed_status === 'new' ? 'not analyzed' : t.analyzed_status.replace('_', ' ');
    items.push({
      type: 'test', id: t.id,
      title: t.test_name,
      sub: `test${t.test_type ? ' · ' + t.test_type : ''} · ${ana}`,
      color: 'var(--accent)'
    });
  });

  const filterBar = `
    <div class="filter-bar">
      <select class="select compact" onchange="setFilter('today','subject',this.value)">${subjectFilterOptions(sf)}</select>
    </div>
  `;
  const totalDay = dayClasses.length + dayRev.length + dayDpp.length + dayTests.length;

  if (items.length === 0) {
    const emptyMsg = totalDay === 0
      ? (isToday ? 'Nothing logged yet today.<br>Use the buttons above to start.' : 'Nothing logged on this day.')
      : 'No activity matches this filter.';
    act.innerHTML = filterBar + `<div class="empty"><div class="empty-emoji">📓</div>${emptyMsg}</div>`;
  } else {
    act.innerHTML = filterBar + items.map(renderItemCard).join('');
  }
}
window.renderToday = renderToday;

// ============ EDIT EXISTING ENTRIES ============
window.editActivity = function (type, id) {
  if (type === 'class') return editClassLog(id);
  if (type === 'revision') return editRevision(id);
  if (type === 'dpp') return editDpp(id);
  if (type === 'test') return openTestDetail(id);
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
      <div class="check-label">Class notes completed</div>
    </div>
    <div class="check-row ${log.revised_today_notes ? 'checked' : ''}" onclick="toggleClassLogField('${id}', 'revised_today_notes')">
      <div class="check-box"></div>
      <div class="check-label">Revised notes of today's class</div>
    </div>
    <div class="check-row ${log.revised_past_notes ? 'checked' : ''}" onclick="toggleClassLogField('${id}', 'revised_past_notes')">
      <div class="check-box"></div>
      <div class="check-label">Revised past notes of this chapter</div>
    </div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary btn-danger" onclick="deleteClassLog('${id}')">Delete</button>
      <button class="btn" onclick="closeModal()">Done</button>
    </div>
  `);
}

window.updateClassLog = function (id, field, value) {
  const log = classLogs.find(l => l.id === id);
  if (!log) return;
  log[field] = value;
  log.updated_at = nowIso();
  upsertItem('class_logs', log);
  editClassLog(id);
  toast('Updated');
};

window.toggleClassLogField = function (id, field) {
  const log = classLogs.find(l => l.id === id);
  if (!log) return;
  log[field] = !log[field];
  log.updated_at = nowIso();
  upsertItem('class_logs', log);
  editClassLog(id);
};

window.deleteClassLog = async function (id) {
  const ok = await confirmModal({ title: 'Delete this class log?', body: 'This cannot be undone.' });
  if (!ok) return;
  classLogs = classLogs.filter(l => l.id !== id);
  removeItem('class_logs', id);
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
          <button class="btn btn-mini ${r.status === st ? '' : 'btn-secondary'}" onclick="updateRevision('${id}', '${st}')">${st === 'new' ? 'just started' : st.replace('_', ' ')}</button>
        `).join('')}
      </div>
    </div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary btn-danger" onclick="deleteRevision('${id}')">Delete</button>
      <button class="btn" onclick="closeModal()">Done</button>
    </div>
  `);
}

window.updateRevision = function (id, status) {
  const r = revisions.find(x => x.id === id);
  if (!r) return;
  r.status = status;
  r.updated_at = nowIso();
  upsertItem('revisions', r);
  editRevision(id);
  toast('Updated');
};

window.deleteRevision = async function (id) {
  const ok = await confirmModal({ title: 'Delete this revision?', body: 'This cannot be undone.' });
  if (!ok) return;
  revisions = revisions.filter(r => r.id !== id);
  removeItem('revisions', id);
  toast('Deleted');
  renderToday();
};

function editDpp(id) {
  const d = dpp.find(x => x.id === id);
  if (!d) return;
  const subj = getSubject(d.subject_id);
  openModal(`
    <h3 class="modal-h">Edit DPP</h3>
    <div class="muted" style="margin-bottom: 16px;">${subj.name}</div>
    <div class="field">
      <label>Date</label>
      <input type="date" class="input" id="ed-date" value="${d.date}" max="${todayStr()}" onchange="saveDppDate('${id}', this.value)">
    </div>
    <div class="field">
      <label>Sheet name</label>
      <input class="input" id="ed-sheet" value="${escapeHtml(d.sheet_name || '')}" placeholder="Optional">
    </div>
    <div class="field">
      <label>Status</label>
      <div class="btn-row" style="gap: 6px;">
        ${['not_started', 'in_progress', 'completed'].map(st => `
          <button class="btn btn-mini ${d.status === st ? '' : 'btn-secondary'}" onclick="updateDppStatus('${id}', '${st}')">${st.replace('_', ' ')}</button>
        `).join('')}
      </div>
    </div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary btn-danger" onclick="deleteDpp('${id}')">Delete</button>
      <button class="btn" onclick="saveDppEdit('${id}')">Save</button>
    </div>
  `);
}

window.saveDppDate = function (id, value) {
  const d = dpp.find(x => x.id === id);
  if (!d) return;
  if (!value || value === d.date) return;
  d.date = value;
  d.updated_at = nowIso();
  upsertItem('dpp', d);
  renderToday();
  renderDpp();
  renderHistory();
  toast('Date updated');
};

window.updateDppStatus = function (id, status) {
  const d = dpp.find(x => x.id === id);
  if (!d) return;
  d.status = status;
  d.updated_at = nowIso();
  upsertItem('dpp', d);
  editDpp(id);
  toast('Updated');
};

window.saveDppEdit = function (id) {
  const d = dpp.find(x => x.id === id);
  if (!d) return;
  const newName = document.getElementById('ed-sheet').value.trim();
  d.sheet_name = newName;
  d.updated_at = nowIso();
  upsertItem('dpp', d);
  closeModal();
  toast('Saved');
  renderToday();
  renderDpp();
};

window.deleteDpp = async function (id) {
  const ok = await confirmModal({ title: 'Delete this DPP entry?', body: 'This cannot be undone.' });
  if (!ok) return;
  dpp = dpp.filter(d => d.id !== id);
  removeItem('dpp', id);
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
  const sf = filters.chapters.subject;
  const stf = filters.chapters.status;
  const filterBar = `
    <div class="filter-bar">
      <select class="select compact" onchange="setFilter('chapters','subject',this.value)">${subjectFilterOptions(sf)}</select>
      <select class="select compact" onchange="setFilter('chapters','status',this.value)">${statusFilterOptions(stf, 'chapter')}</select>
    </div>
  `;

  if (chapters.length === 0) {
    wrap.innerHTML = '<div class="empty"><div class="empty-emoji">📚</div>No chapters yet.<br>Add your first one above.</div>';
    return;
  }

  const filtered = chapters.filter(c =>
    (sf === 'all' || c.subject_id === sf) &&
    (stf === 'all' || c.status === stf)
  );

  let html = filterBar;
  let rendered = 0;
  SUBJECTS.forEach(s => {
    const list = filtered.filter(c => c.subject_id === s.id);
    if (list.length === 0) return;
    rendered += list.length;
    html += `<h3 class="section-h" style="display: flex; align-items: center; gap: 8px;"><span class="subj-dot" style="background: ${s.color};"></span>${s.name}</h3>`;
    html += list.map(ch => `
      <div class="card" onclick="openChapterDetail('${ch.id}')">
        <div class="card-edge" style="background: ${s.color};"></div>
        <div class="card-content">
          <div class="card-title">${escapeHtml(ch.name)}</div>
          <div class="card-sub">
            <span class="chip ${ch.status}">chapter: ${ch.status.replace('_', ' ')}</span>
            <span class="chip ${ch.short_notes_status}">notes: ${ch.short_notes_status.replace('_', ' ')}</span>
          </div>
        </div>
      </div>
    `).join('');
  });
  if (rendered === 0) {
    html += '<div class="empty">No chapters match these filters.</div>';
  }
  wrap.innerHTML = html;
}
window.renderChapters = renderChapters;

window.filterChapters = function (subjId) {
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

window.openAddChapter = function (presetSubject) {
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

window.saveChapter = function () {
  const subj = document.getElementById('m-subject').value;
  const name = document.getElementById('m-name').value.trim();
  if (!name) { toast('Type a chapter name'); return; }
  const now = nowIso();
  const newChap = {
    id: uid(), subject_id: subj, name,
    status: 'not_started', short_notes_status: 'new',
    created_at: now, updated_at: now
  };
  chapters.push(newChap);
  upsertItem('chapters', newChap);
  closeModal();
  toast('Chapter added');
  renderChapters();
};

window.openChapterDetail = function (chapterId) {
  const ch = getChapter(chapterId);
  if (!ch) return;
  const subj = getSubject(ch.subject_id);
  const myLogs = classLogs.filter(l => l.chapter_id === chapterId).length;
  const myRevs = revisions.filter(r => r.chapter_id === chapterId).length;
  openModal(`
    <input class="modal-h-edit" id="ch-name-edit" value="${escapeHtml(ch.name)}" onblur="saveChapterName('${ch.id}', this.value)">
    <div class="muted" style="margin-bottom: 16px;">${subj.name}</div>
    <div class="field">
      <label>Chapter status</label>
      <div class="btn-row" style="gap: 6px;">
        ${['not_started', 'in_progress', 'completed'].map(st => `
          <button class="btn btn-mini ${ch.status === st ? '' : 'btn-secondary'}" onclick="setChapStatus('${ch.id}', '${st}')">${st.replace('_', ' ')}</button>
        `).join('')}
      </div>
    </div>
    <div class="field">
      <label>Short notes</label>
      <div class="btn-row" style="gap: 6px;">
        ${['new', 'in_progress', 'completed'].map(st => `
          <button class="btn btn-mini ${ch.short_notes_status === st ? '' : 'btn-secondary'}" onclick="setNotesStatus('${ch.id}', '${st}')">${st.replace('_', ' ')}</button>
        `).join('')}
      </div>
    </div>
    <div class="muted" style="margin: 16px 0 8px;">${myLogs} class${myLogs === 1 ? '' : 'es'} logged · ${myRevs} revision${myRevs === 1 ? '' : 's'}</div>
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary btn-danger" onclick="deleteChapter('${ch.id}')">Delete</button>
      <button class="btn" onclick="closeModal()">Done</button>
    </div>
  `);
};

window.saveChapterName = function (id, value) {
  const ch = getChapter(id);
  if (!ch) return;
  const newName = value.trim();
  if (!newName) {
    toast('Name required');
    const input = document.getElementById('ch-name-edit');
    if (input) input.value = ch.name;
    return;
  }
  if (newName === ch.name) return;
  ch.name = newName;
  ch.updated_at = nowIso();
  upsertItem('chapters', ch);
  renderChapters();
  renderToday();
  renderHistory();
  toast('Renamed');
};

window.setChapStatus = function (id, status) {
  const ch = getChapter(id);
  if (!ch) return;
  ch.status = status;
  ch.updated_at = nowIso();
  upsertItem('chapters', ch);
  openChapterDetail(id);
  toast('Status updated');
};

window.setNotesStatus = function (id, status) {
  const ch = getChapter(id);
  if (!ch) return;
  ch.short_notes_status = status;
  ch.updated_at = nowIso();
  upsertItem('chapters', ch);
  openChapterDetail(id);
  toast('Notes updated');
};

window.deleteChapter = async function (id) {
  const orphanLogs = classLogs.filter(l => l.chapter_id === id);
  const orphanRevs = revisions.filter(r => r.chapter_id === id);
  const ch = getChapter(id);
  const bodyParts = [];
  if (orphanLogs.length) bodyParts.push(`${orphanLogs.length} class log${orphanLogs.length === 1 ? '' : 's'}`);
  if (orphanRevs.length) bodyParts.push(`${orphanRevs.length} revision${orphanRevs.length === 1 ? '' : 's'}`);
  const body = bodyParts.length
    ? `Also deletes ${bodyParts.join(' and ')} for this chapter. This cannot be undone.`
    : 'This cannot be undone.';
  const ok = await confirmModal({ title: `Delete "${ch ? ch.name : 'this chapter'}"?`, body });
  if (!ok) return;

  chapters = chapters.filter(c => c.id !== id);
  removeItem('chapters', id);

  classLogs = classLogs.filter(l => l.chapter_id !== id);
  orphanLogs.forEach(l => removeItem('class_logs', l.id));
  revisions = revisions.filter(r => r.chapter_id !== id);
  orphanRevs.forEach(r => removeItem('revisions', r.id));

  toast('Deleted');
  renderChapters();
  renderToday();
  renderHistory();
};

window.openLogClass = function () {
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
      <div class="check-label">Class notes completed</div>
    </div>
    <div class="check-row" id="cl-today" onclick="toggleTodayNotes()">
      <div class="check-box"></div>
      <div class="check-label">Revised notes of today's class</div>
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
  window._cl = { class_status: 'present', notes_completed: true, revised_today_notes: false, revised_past_notes: false };
  updateChapterDropdown();
};

window.toggleClassStatus = function (s) {
  window._cl.class_status = s;
  document.getElementById('cl-present').classList.toggle('btn-secondary', s !== 'present');
  document.getElementById('cl-absent').classList.toggle('btn-secondary', s !== 'absent');
  if (s === 'absent' && window._cl.notes_completed) toggleNotes();
};

window.toggleNotes = function () {
  window._cl.notes_completed = !window._cl.notes_completed;
  document.getElementById('cl-notes').classList.toggle('checked', window._cl.notes_completed);
};

window.toggleTodayNotes = function () {
  window._cl.revised_today_notes = !window._cl.revised_today_notes;
  document.getElementById('cl-today').classList.toggle('checked', window._cl.revised_today_notes);
};

window.togglePastNotes = function () {
  window._cl.revised_past_notes = !window._cl.revised_past_notes;
  document.getElementById('cl-past').classList.toggle('checked', window._cl.revised_past_notes);
};

window.updateChapterDropdown = function () {
  const subjId = document.getElementById('m-subject').value;
  const list = chaptersBySubject(subjId);
  const sel = document.getElementById('m-chapter');
  sel.innerHTML = list.length === 0
    ? `<option value="">— No chapters yet, add one first —</option>`
    : list.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
};

window.saveClassLog = function () {
  const chapterId = document.getElementById('m-chapter').value;
  const subjId = document.getElementById('m-subject').value;
  if (!chapterId) { toast('Add a chapter for this subject first'); return; }
  const now = nowIso();
  const newLog = {
    id: uid(), date: todayStr(), subject_id: subjId, chapter_id: chapterId,
    class_status: window._cl.class_status,
    notes_completed: window._cl.notes_completed,
    revised_today_notes: window._cl.revised_today_notes,
    revised_past_notes: window._cl.revised_past_notes,
    created_at: now, updated_at: now
  };
  classLogs.push(newLog);
  upsertItem('class_logs', newLog);
  closeModal();
  toast('Class logged');
  renderToday();
};

window.openLogRevision = function () {
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

window.setRevStatus = function (s) {
  window._rv.status = s;
  ['new', 'in_progress', 'completed'].forEach(st => {
    const el = document.getElementById('rv-' + st);
    if (el) el.classList.toggle('btn-secondary', s !== st);
  });
};

window.saveRevision = function () {
  const chapterId = document.getElementById('m-chapter').value;
  const subjId = document.getElementById('m-subject').value;
  if (!chapterId) { toast('Add a chapter first'); return; }
  const now = nowIso();
  const newRev = {
    id: uid(), date: todayStr(), subject_id: subjId,
    chapter_id: chapterId, status: window._rv.status,
    created_at: now, updated_at: now
  };
  revisions.push(newRev);
  upsertItem('revisions', newRev);
  closeModal();
  toast('Revision logged');
  renderToday();
};

window.openLogDpp = function () {
  const subjOptions = SUBJECTS.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  openModal(`
    <h3 class="modal-h">Add a DPP sheet</h3>
    <div class="field"><label>Subject</label><select class="select" id="m-subject">${subjOptions}</select></div>
    <div class="field"><label>Sheet name <span class="muted">(optional)</span></label><input class="input" id="m-sheetname" placeholder="e.g. DPP-1, Module 3 sheet"></div>
    <div class="field"><label>Date</label><input class="input" id="m-date" type="date" value="${todayStr()}" max="${todayStr()}"></div>
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

window.setDppStatus = function (s) {
  window._dp.status = s;
  ['not_started', 'in_progress', 'completed'].forEach(st => {
    const el = document.getElementById('dp-' + st);
    if (el) el.classList.toggle('btn-secondary', s !== st);
  });
};

window.saveDpp = function () {
  const subjId = document.getElementById('m-subject').value;
  const sheetName = document.getElementById('m-sheetname').value.trim();
  const dateVal = document.getElementById('m-date').value || todayStr();
  const now = nowIso();
  const newDpp = {
    id: uid(), date: dateVal, subject_id: subjId, sheet_name: sheetName,
    status: window._dp.status, created_at: now, updated_at: now
  };
  dpp.push(newDpp);
  upsertItem('dpp', newDpp);
  closeModal();
  toast('DPP saved');
  renderToday();
  renderDpp();
};

function renderDpp() {
  const list = document.getElementById('dpp-list');
  const sf = filters.dpp.subject;
  const stf = filters.dpp.status;
  const filterBar = `
    <div class="filter-bar">
      <select class="select compact" onchange="setFilter('dpp','subject',this.value)">${subjectFilterOptions(sf)}</select>
      <select class="select compact" onchange="setFilter('dpp','status',this.value)">${statusFilterOptions(stf, 'dpp')}</select>
    </div>
  `;

  if (dpp.length === 0) {
    list.innerHTML = filterBar + '<div class="empty"><div class="empty-emoji">📝</div>No DPPs logged yet.</div>';
    return;
  }
  const bySubj = {};
  dpp.forEach(d => { bySubj[d.subject_id] = bySubj[d.subject_id] || []; bySubj[d.subject_id].push(d); });

  let html = filterBar + '<div class="stat-grid" style="margin-bottom: 16px;">';
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
  const filtered = dpp.filter(d =>
    (sf === 'all' || d.subject_id === sf) &&
    (stf === 'all' || d.status === stf)
  );
  const recent = [...filtered].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30);
  if (recent.length === 0) {
    html += '<div class="empty">No DPPs match these filters.</div>';
  } else {
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
          <div class="card-chevron">›</div>
        </div>
      `;
    }).join('');
  }
  list.innerHTML = html;
}
window.renderDpp = renderDpp;

window.editDppFromList = function (id) { editDpp(id); };

window.openLogTest = function () {
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

window.setTestAna = function (s) {
  window._tt.ana = s;
  ['new', 'in_progress', 'completed'].forEach(st => {
    const el = document.getElementById('ta-' + st);
    if (el) el.classList.toggle('btn-secondary', s !== st);
  });
};

window.saveTest = function () {
  const name = document.getElementById('t-name').value.trim();
  if (!name) { toast('Enter test name'); return; }
  const now = nowIso();
  const newTest = {
    id: uid(), date: document.getElementById('t-date').value || todayStr(),
    test_name: name, test_type: document.getElementById('t-type').value.trim(),
    analyzed_status: window._tt.ana, notes: document.getElementById('t-notes').value.trim(),
    created_at: now, updated_at: now
  };
  tests.push(newTest);
  upsertItem('tests', newTest);
  closeModal();
  toast('Test saved');
  renderToday();
  renderTests();
  renderHistory();
};

function renderTests() {
  const list = document.getElementById('tests-list');
  const stf = filters.tests.status;
  const filterBar = `
    <div class="filter-bar">
      <select class="select compact" onchange="setFilter('tests','status',this.value)">${statusFilterOptions(stf, 'test')}</select>
    </div>
  `;

  if (tests.length === 0) {
    list.innerHTML = filterBar + '<div class="empty"><div class="empty-emoji">🎯</div>No tests yet.</div>';
    return;
  }
  const filtered = tests.filter(t => stf === 'all' || t.analyzed_status === stf);
  if (filtered.length === 0) {
    list.innerHTML = filterBar + '<div class="empty">No tests match this filter.</div>';
    return;
  }
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
  list.innerHTML = filterBar + sorted.map(t => `
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

window.openTestDetail = function (id) {
  const t = tests.find(x => x.id === id);
  if (!t) return;
  openModal(`
    <input class="modal-h-edit" id="t-name-edit" value="${escapeHtml(t.test_name)}" onblur="saveTestName('${t.id}', this.value)">
    <div class="muted" style="margin-bottom: 16px;">${t.test_type ? escapeHtml(t.test_type) : 'Test'}</div>
    <div class="field">
      <label>Date</label>
      <input type="date" class="input" id="t-date-edit" value="${t.date}" max="${todayStr()}" onchange="saveTestDate('${t.id}', this.value)">
    </div>
    <div class="field">
      <label>Analysis</label>
      <div class="btn-row" style="gap: 6px;">
        ${['new', 'in_progress', 'completed'].map(st => `
          <button class="btn btn-mini ${t.analyzed_status === st ? '' : 'btn-secondary'}" onclick="updateTestAna('${id}', '${st}')">${st === 'new' ? 'not yet' : st.replace('_', ' ')}</button>
        `).join('')}
      </div>
    </div>
    ${t.notes ? `<div class="field"><label>Notes</label><div class="card" style="display: block;">${escapeHtml(t.notes)}</div></div>` : ''}
    <div class="btn-row" style="margin-top: 16px;">
      <button class="btn btn-secondary btn-danger" onclick="deleteTest('${id}')">Delete</button>
      <button class="btn" onclick="closeModal()">Done</button>
    </div>
  `);
};

window.saveTestDate = function (id, value) {
  const t = tests.find(x => x.id === id);
  if (!t) return;
  if (!value || value === t.date) return;
  t.date = value;
  t.updated_at = nowIso();
  upsertItem('tests', t);
  renderToday();
  renderTests();
  renderHistory();
  toast('Date updated');
};

window.saveTestName = function (id, value) {
  const t = tests.find(x => x.id === id);
  if (!t) return;
  const newName = value.trim();
  if (!newName) {
    toast('Name required');
    const input = document.getElementById('t-name-edit');
    if (input) input.value = t.test_name;
    return;
  }
  if (newName === t.test_name) return;
  t.test_name = newName;
  t.updated_at = nowIso();
  upsertItem('tests', t);
  renderToday();
  renderTests();
  renderHistory();
  toast('Renamed');
};

window.updateTestAna = function (id, status) {
  const t = tests.find(x => x.id === id);
  if (!t) return;
  t.analyzed_status = status;
  t.updated_at = nowIso();
  upsertItem('tests', t);
  openTestDetail(id);
  renderToday();
  renderTests();
  renderHistory();
  toast('Updated');
};

window.deleteTest = async function (id) {
  const ok = await confirmModal({ title: 'Delete this test?', body: 'This cannot be undone.' });
  if (!ok) return;
  tests = tests.filter(t => t.id !== id);
  removeItem('tests', id);
  toast('Deleted');
  renderToday();
  renderTests();
  renderHistory();
};

function renderHistory() {
  const list = document.getElementById('history-list');
  const tf = filters.history.type;
  const sf = filters.history.subject;

  const cutoffMs = Date.now() - 21 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(cutoffMs).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const inWindow = (d) => d >= cutoff;

  const items = [];
  if (tf === 'all' || tf === 'class') {
    classLogs.forEach(l => {
      if (!inWindow(l.date)) return;
      if (sf !== 'all' && l.subject_id !== sf) return;
      const ch = getChapter(l.chapter_id);
      if (!ch) return;
      const subj = getSubject(ch.subject_id);
      const extras = [];
      if (l.notes_completed) extras.push('class notes ✓');
      if (l.revised_today_notes) extras.push("today's notes ✓");
      if (l.revised_past_notes) extras.push('past notes ✓');
      items.push({
        type: 'class', id: l.id, date: l.date,
        title: ch.name,
        sub: `${subj.name} · class: ${l.class_status}${extras.length ? ' · ' + extras.join(' · ') : ''}`,
        color: subj.color
      });
    });
  }
  if (tf === 'all' || tf === 'revision') {
    revisions.forEach(r => {
      if (!inWindow(r.date)) return;
      if (sf !== 'all' && r.subject_id !== sf) return;
      const ch = getChapter(r.chapter_id);
      if (!ch) return;
      const subj = getSubject(ch.subject_id);
      items.push({
        type: 'revision', id: r.id, date: r.date,
        title: ch.name,
        sub: `${subj.name} · revision: ${r.status.replace('_', ' ')}`,
        color: subj.color
      });
    });
  }
  if (tf === 'all' || tf === 'dpp') {
    dpp.forEach(d => {
      if (!inWindow(d.date)) return;
      if (sf !== 'all' && d.subject_id !== sf) return;
      const subj = getSubject(d.subject_id);
      items.push({
        type: 'dpp', id: d.id, date: d.date,
        title: d.sheet_name || 'DPP sheet',
        sub: `${subj.name} · DPP: ${d.status.replace('_', ' ')}`,
        color: subj.color
      });
    });
  }
  if (tf === 'all' || tf === 'test') {
    tests.forEach(t => {
      if (!inWindow(t.date)) return;
      if (sf !== 'all') return;
      const ana = t.analyzed_status === 'new' ? 'not analyzed' : t.analyzed_status.replace('_', ' ');
      items.push({
        type: 'test', id: t.id, date: t.date,
        title: t.test_name,
        sub: `test${t.test_type ? ' · ' + t.test_type : ''} · ${ana}`,
        color: 'var(--accent)'
      });
    });
  }

  const typeOpts = [['all', 'All types'], ['class', 'Classes'], ['revision', 'Revisions'], ['dpp', 'DPPs'], ['test', 'Tests']]
    .map(([v, l]) => `<option value="${v}" ${tf === v ? 'selected' : ''}>${l}</option>`).join('');
  const filterBar = `
    <div class="muted" style="margin-bottom: 8px;">Showing last 3 weeks</div>
    <div class="filter-bar">
      <select class="select compact" onchange="setFilter('history','type',this.value)">${typeOpts}</select>
      <select class="select compact" onchange="setFilter('history','subject',this.value)">${subjectFilterOptions(sf)}</select>
    </div>
  `;

  if (items.length === 0) {
    list.innerHTML = filterBar + '<div class="empty"><div class="empty-emoji">📜</div>No activity yet.</div>';
    return;
  }

  const byDate = {};
  items.forEach(i => { byDate[i.date] = byDate[i.date] || []; byDate[i.date].push(i); });
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const today = todayStr();

  let html = filterBar;
  dates.forEach(date => {
    const label = date === today ? 'Today' : fmtDate(date);
    html += `<h3 class="section-h">${label}</h3>`;
    html += byDate[date].map(renderItemCard).join('');
  });
  list.innerHTML = html;
}
window.renderHistory = renderHistory;

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

document.addEventListener('keydown', (e) => {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay || !overlay.classList.contains('open')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeModal();
    return;
  }
  if (e.key === 'Tab') {
    const modal = document.getElementById('modal-content');
    const focusable = modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

let lastKnownDay = todayStr();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !currentUser) return;
  renderHeader();
  const now = todayStr();
  if (now !== lastKnownDay) {
    if (selectedDate === lastKnownDay) selectedDate = now;
    lastKnownDay = now;
    const active = document.querySelector('.screen.active');
    if (active && active.id === 'screen-today') renderToday();
  }
});

// Day picker on Today screen
(function wireDayPicker() {
  const picker = document.getElementById('day-picker');
  const todayBtn = document.getElementById('day-today-btn');
  if (!picker || !todayBtn) return;
  picker.value = todayStr();
  picker.max = todayStr();
  picker.addEventListener('change', (e) => {
    selectedDate = e.target.value || todayStr();
    renderToday();
  });
  todayBtn.addEventListener('click', () => {
    selectedDate = todayStr();
    picker.value = selectedDate;
    renderToday();
  });
})();
