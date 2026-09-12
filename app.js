import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, getDocs, setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// -------------------- DOM elements --------------------
const gate = document.getElementById("gate");
const appShell = document.getElementById("app");
const gateError = document.getElementById("gateError");
const railNav = document.getElementById("railNav");
const hwForm = document.getElementById("hwForm");
const hwGroups = document.getElementById("hwGroups");
const hwEmpty = document.getElementById("hwEmpty");
const hwStatus = document.getElementById("hwStatus");
const noteForm = document.getElementById("noteForm");
const noteGrid = document.getElementById("noteGrid");
const noteEmpty = document.getElementById("noteEmpty");
const noteStatus = document.getElementById("noteStatus");
const ttStatus = document.getElementById("ttStatus");
const exportBtn = document.getElementById("exportBtn");
const signOutBtn = document.getElementById("signOutBtn");

let currentUid = null;
let unsubHw = null;
let unsubNotes = null;
let unsubTimetable = null;   // ← move it here

// -------------------- Auth helpers --------------------
function showGateError(err) {
  gateError.textContent = humanizeAuthError(err?.code) || String(err?.message || err) || "Sign-in failed. Please try again.";
  gateError.hidden = false;
}

function humanizeAuthError(code) {
  const map = {
    "auth/wrong-password": "That password doesn't match.",
    "auth/user-not-found": "No account found for that email.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/invalid-email": "That email doesn't look right.",
    "auth/user-disabled": "This account has been disabled.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/unauthorized-domain": "This domain is not authorized for sign-in.",
    "auth/popup-closed-by-user": "Sign-in was canceled.",
    "auth/cancelled-popup-request": "Sign-in was canceled.",
  };
  return map[code];
}

// -------------------- Email/password sign-in --------------------
const emailForm = document.getElementById("emailForm");
if (emailForm) {
  emailForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    gateError.hidden = true;
    const email = document.getElementById("emailInput").value.trim();
    const pass = document.getElementById("passInput").value;
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      // onAuthStateChanged will handle UI
    } catch (err) {
      showGateError(err);
    }
  });
}

// -------------------- onAuthStateChanged --------------------
onAuthStateChanged(auth, (user) => {
  if (!user) {
    gate.hidden = false;
    appShell.hidden = true;
    currentUid = null;
    if (unsubHw) unsubHw();
    if (unsubNotes) unsubNotes();
    if (unsubTimetable) unsubTimetable();   // ← add this
    return;
  }

  gate.hidden = true;
  appShell.hidden = false;
  currentUid = user.uid;
  document.getElementById("userEmail").textContent = user.email || "";
  startSync(user.uid);
  startTimetableSync(user.uid);   // ← semicolon
});
// -------------------- Navigation --------------------
if (railNav) {
  railNav.addEventListener("click", (e) => {
    const btn = e.target.closest(".rail-link");
    if (!btn) return;
    document.querySelectorAll(".rail-link").forEach((b) => b.classList.remove("is-active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
    btn.classList.add("is-active");
    document.getElementById(`panel-${btn.dataset.panel}`).classList.add("is-active");
  });
}

// -------------------- Homework --------------------
if (hwForm) {
  hwForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUid) return;
    const subject = document.getElementById("hwSubject").value.trim();
    const task = document.getElementById("hwTask").value.trim();
    const due = document.getElementById("hwDue").value;
    if (!subject || !task || !due) {
      setStatus(hwStatus, "Please enter subject, task, and due date.", true);
      return;
    }
    try {
      await addDoc(collection(db, "users", currentUid, "homework"), {
        subject, task, due, done: false, createdAt: serverTimestamp(),
      });
      hwForm.reset();
      setStatus(hwStatus, "Homework saved.");
    } catch (err) {
      setStatus(hwStatus, humanizeFirestoreError(err), true);
    }
  });
}

function renderHomework(items) {
  hwEmpty.hidden = items.length > 0;
  hwGroups.innerHTML = "";

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const soonCutoff = new Date(today); soonCutoff.setDate(today.getDate() + 2);

  const buckets = { overdue: [], soon: [], later: [], done: [] };
  items.forEach((it) => {
    if (it.done) { buckets.done.push(it); return; }
    const dueDate = new Date(it.due + "T00:00:00");
    if (dueDate < today) buckets.overdue.push(it);
    else if (dueDate <= soonCutoff) buckets.soon.push(it);
    else buckets.later.push(it);
  });

  const sections = [
    { key: "overdue", label: "Overdue", warn: true },
    { key: "soon", label: "Due soon", warn: true },
    { key: "later", label: "Upcoming", warn: false },
    { key: "done", label: "Done", warn: false },
  ];

  sections.forEach(({ key, label, warn }) => {
    const list = buckets[key];
    if (!list.length) return;
    list.sort((a, b) => (a.due || "").localeCompare(b.due || ""));

    const title = document.createElement("p");
    title.className = "hw-group-title" + (warn ? " is-warn" : "");
    title.textContent = `${label} · ${list.length}`;
    hwGroups.appendChild(title);

    list.forEach((it) => hwGroups.appendChild(buildHwItem(it, key)));
  });
}

function buildHwItem(it, bucketKey) {
  const row = document.createElement("div");
  row.className = "hw-item" +
    (it.done ? " is-done" : bucketKey === "overdue" ? " is-overdue" : bucketKey === "soon" ? " is-soon" : "");

  const check = document.createElement("button");
  check.className = "hw-check" + (it.done ? " checked" : "");
  check.type = "button";
  check.setAttribute("aria-label", it.done ? "Mark as not done" : "Mark as done");
  check.addEventListener("click", async () => {
    try {
      await updateDoc(doc(db, "users", currentUid, "homework", it.id), { done: !it.done });
      setStatus(hwStatus, "Homework updated.");
    } catch (err) {
      setStatus(hwStatus, humanizeFirestoreError(err), true);
    }
  });

  const body = document.createElement("div");
  body.className = "hw-body";
  body.innerHTML = `
    <div class="hw-subject">${escapeHtml(it.subject)}</div>
    <div class="hw-task">${escapeHtml(it.task)}</div>
    <div class="hw-date">${formatDate(it.due)}</div>
  `;

  const del = document.createElement("button");
  del.className = "hw-delete";
  del.type = "button";
  del.setAttribute("aria-label", "Delete");
  del.textContent = "×";
  del.addEventListener("click", () => deleteDoc(doc(db, "users", currentUid, "homework", it.id)));

  row.append(check, body, del);
  return row;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// -------------------- Notes --------------------
if (noteForm) {
  noteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUid) return;
    const text = document.getElementById("noteText").value.trim();
    if (!text) {
      setStatus(noteStatus, "Please add a note before saving.", true);
      return;
    }
    try {
      await addDoc(collection(db, "users", currentUid, "notes"), {
        text, createdAt: serverTimestamp(),
      });
      noteForm.reset();
      setStatus(noteStatus, "Note saved.");
    } catch (err) {
      setStatus(noteStatus, humanizeFirestoreError(err), true);
    }
  });
}

function renderNotes(items) {
  noteEmpty.hidden = items.length > 0;
  noteGrid.innerHTML = "";
  items.forEach((n) => {
    const card = document.createElement("div");
    card.className = "note-card";
    const remove = document.createElement("button");
    remove.className = "note-remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Remove note");
    remove.addEventListener("click", () => deleteDoc(doc(db, "users", currentUid, "notes", n.id)));
    const text = document.createElement("div");
    text.textContent = n.text;
    card.append(text, remove);
    noteGrid.appendChild(card);
  });
}

// -------------------- Timetable --------------------
// Times follow the school timetable image exactly.
// Tutor time is fixed. P6 only runs Mon/Wed/Fri (Tue & Thu finish after P5).
const PERIODS = [
  { id: "tutor",  label: "Tutor time", start: "8:30",  end: "8:42",  type: "tutor" },
  { id: "p1",     label: "",           start: "8:42",  end: "9:40",  type: "class" },
  { id: "p2",     label: "",           start: "9:40",  end: "10:38", type: "class" },
  { id: "break1", label: "Break",      start: "10:38", end: "10:53", type: "break" },
  { id: "p3",     label: "",           start: "10:53", end: "11:51", type: "class" },
  { id: "p4",     label: "",           start: "11:51", end: "12:49", type: "class" },
  { id: "lunch",  label: "Lunch",      start: "12:49", end: "13:20", type: "break" },
  { id: "p5",     label: "",           start: "13:20", end: "14:18", type: "class" },
  { id: "p6",     label: "",           start: "14:18", end: "15:16", type: "class" },
];

const DAYS = [
  { id: "mon", label: "Monday" },
  { id: "tue", label: "Tuesday" },
  { id: "wed", label: "Wednesday" },
  { id: "thu", label: "Thursday" },
  { id: "fri", label: "Friday" },
];

// P6 exists only on Monday, Wednesday and Friday.
function slotExists(periodId, dayId) {
  if (periodId === "p6") {
    return dayId === "mon" || dayId === "wed" || dayId === "fri";
  }
  return true;
}

let ttData = {};        // { "mon|p1": { subject, room, teacher }, ... }
let ttEditing = false;

const ttGrid = document.getElementById("ttGrid");
const ttStatus = document.getElementById("ttStatus");
const ttEmpty = document.getElementById("ttEmpty");
const ttEditBtn = document.getElementById("ttEditBtn");
const ttClearBtn = document.getElementById("ttClearBtn");

function slotKey(dayId, periodId) {
  return `${dayId}|${periodId}`;
}

function colorIndexFor(str) {
  if (!str) return 0;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 6;
}

function renderTimetable() {
  if (!ttGrid) return;
  ttGrid.innerHTML = "";

  // Header row
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.appendChild(document.createElement("th"));
  DAYS.forEach((d) => {
    const th = document.createElement("th");
    th.textContent = d.label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  ttGrid.appendChild(thead);

  // Body rows
  const tbody = document.createElement("tbody");
  PERIODS.forEach((p) => {
    const tr = document.createElement("tr");

    // Time cell
    const timeCell = document.createElement("td");
    timeCell.className = "tt-time";
    timeCell.textContent = p.type === "tutor" ? "" : `${p.start} – ${p.end}`;
    tr.appendChild(timeCell);

    if (p.type === "tutor") {
      tr.classList.add("tt-tutor");
      DAYS.forEach(() => {
        const td = document.createElement("td");
        td.innerHTML = `<div class="tt-subject">Tutor time</div>`;
        tr.appendChild(td);
      });
    } else if (p.type === "break") {
      tr.classList.add("tt-break");
      DAYS.forEach(() => {
        const td = document.createElement("td");
        td.textContent = p.label;
        tr.appendChild(td);
      });
    } else {
      DAYS.forEach((d) => {
        const td = document.createElement("td");
        if (!slotExists(p.id, d.id)) {
          td.className = "tt-slot is-empty";
          td.textContent = "—";
          td.style.cursor = "default";
          tr.appendChild(td);
          return;
        }

        const key = slotKey(d.id, p.id);
        const entry = ttData[key];
        td.className = "tt-slot" + (entry ? "" : " is-empty");

        if (entry) {
          td.dataset.color = colorIndexFor(entry.subject || "");
          td.innerHTML = `
            <div class="tt-subject">${escapeHtml(entry.subject || "")}</div>
            <div class="tt-meta">
              ${entry.room ? escapeHtml(entry.room) : ""}
              ${entry.room && entry.teacher ? " · " : ""}
              ${entry.teacher ? escapeHtml(entry.teacher) : ""}
            </div>
          `;
        }

        if (ttEditing) {
          td.style.cursor = "pointer";
          td.addEventListener("click", () => openSlotModal(d.id, p.id, key));
        }

        tr.appendChild(td);
      });
    }

    tbody.appendChild(tr);
  });
  ttGrid.appendChild(tbody);

  const hasAny = Object.keys(ttData).length > 0;
  if (ttEmpty) ttEmpty.hidden = hasAny || ttEditing;
  if (ttGrid) ttGrid.classList.toggle("is-editing", ttEditing);
}

function openSlotModal(dayId, periodId, key) {
  const day = DAYS.find((d) => d.id === dayId);
  const period = PERIODS.find((p) => p.id === periodId);
  const existing = ttData[key] || {};

  const backdrop = document.createElement("div");
  backdrop.className = "tt-modal-backdrop";
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  const modal = document.createElement("div");
  modal.className = "tt-modal";
  modal.innerHTML = `
    <h3>${escapeHtml(day.label)} · ${period.start}–${period.end}</h3>
    <p class="tt-modal-sub">Enter the class details.</p>
    <form id="slotForm">
      <input type="text" id="slotSubject" placeholder="Subject" value="${escapeAttr(existing.subject || "")}" required />
      <input type="text" id="slotRoom" placeholder="Room (e.g. Room 19)" value="${escapeAttr(existing.room || "")}" />
      <input type="text" id="slotTeacher" placeholder="Teacher" value="${escapeAttr(existing.teacher || "")}" />
      <div class="tt-modal-actions">
        <div class="left">
          <button type="button" class="btn-danger-text" id="slotDelete" ${existing.subject ? "" : "hidden"}>Remove class</button>
        </div>
        <div class="right">
          <button type="button" class="btn btn-ghost" id="slotCancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Save</button>
        </div>
      </div>
    </form>
  `;
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const form = modal.querySelector("#slotForm");
  const subjectInput = modal.querySelector("#slotSubject");
  subjectInput.focus();

  modal.querySelector("#slotCancel").addEventListener("click", () => backdrop.remove());
  modal.querySelector("#slotDelete").addEventListener("click", async () => {
    await saveSlot(key, null);
    backdrop.remove();
    renderTimetable();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const subject = subjectInput.value.trim();
    const room = modal.querySelector("#slotRoom").value.trim();
    const teacher = modal.querySelector("#slotTeacher").value.trim();
    if (!subject) return;
    await saveSlot(key, { subject, room, teacher });
    backdrop.remove();
    renderTimetable();
  });
}

async function saveSlot(key, value) {
  if (!currentUid) return;
  try {
    if (value) {
      ttData[key] = value;
      await setDoc(doc(db, "users", currentUid, "timetable", key), value);
      setStatus(ttStatus, "Saved.");
    } else {
      delete ttData[key];
      await deleteDoc(doc(db, "users", currentUid, "timetable", key));
      setStatus(ttStatus, "Removed.");
    }
  } catch (err) {
    setStatus(ttStatus, humanizeFirestoreError(err), true);
  }
}

function escapeAttr(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

if (ttEditBtn) {
  ttEditBtn.addEventListener("click", () => {
    ttEditing = !ttEditing;
    ttEditBtn.textContent = ttEditing ? "Done editing" : "Edit timetable";
    ttEditBtn.classList.toggle("btn-primary", ttEditing);
    ttEditBtn.classList.toggle("btn-ghost", !ttEditing);
    if (ttStatus) ttStatus.textContent = ttEditing
      ? "Tap any cell to add or change a class."
      : "";
    renderTimetable();
  });
}

if (ttClearBtn) {
  ttClearBtn.addEventListener("click", async () => {
    if (!currentUid) return;
    if (!confirm("Remove all classes from your timetable?")) return;
    try {
      const snap = await getDocs(collection(db, "users", currentUid, "timetable"));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
      ttData = {};
      renderTimetable();
      setStatus(ttStatus, "Timetable cleared.");
    } catch (err) {
      setStatus(ttStatus, humanizeFirestoreError(err), true);
    }
  });
}

function startTimetableSync(uid) {
  if (unsubTimetable) unsubTimetable();
  unsubTimetable = onSnapshot(
    collection(db, "users", uid, "timetable"),
    (snap) => {
      ttData = {};
      snap.docs.forEach((d) => {
        ttData[d.id] = d.data();
      });
      renderTimetable();
    },
    (err) => setStatus(ttStatus, humanizeFirestoreError(err), true)
  );
}

// -------------------- Sync --------------------
function startSync(uid) {
  if (unsubHw) unsubHw();
  if (unsubNotes) unsubNotes();

  unsubHw = onSnapshot(
    query(collection(db, "users", uid, "homework"), orderBy("createdAt", "desc")),
    (snap) => {
      renderHomework(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      setStatus(hwStatus, humanizeFirestoreError(err), true);
    }
  );

  unsubNotes = onSnapshot(
    query(collection(db, "users", uid, "notes"), orderBy("createdAt", "desc")),
    (snap) => {
      renderNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    },
    (err) => {
      setStatus(noteStatus, humanizeFirestoreError(err), true);
    }
  );
}

// -------------------- Status & errors --------------------
function setStatus(el, message, isError = false) {
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("is-error", !!isError);
  el.classList.toggle("is-success", !!message && !isError);
}

function humanizeFirestoreError(err) {
  const code = err?.code || "";
  const map = {
    "permission-denied": "Save failed: permission denied. Check Firebase rules and signed-in account.",
    "unavailable": "Save failed: Firestore is unavailable right now. Please try again.",
    "failed-precondition": "Save failed: required Firestore index/config is missing.",
  };
  return map[code] || "Save failed. Please try again.";
}

// -------------------- Export --------------------
if (exportBtn) {
  exportBtn.addEventListener("click", async () => {
    if (!currentUid) return;
    const [hwSnap, notesSnap] = await Promise.all([
      getDocs(collection(db, "users", currentUid, "homework")),
      getDocs(collection(db, "users", currentUid, "notes")),
    ]);
    const payload = {
      exportedAt: new Date().toISOString(),
      homework: hwSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      notes: notesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      timetable: Object.entries(ttData).map(([id, data]) => ({ id, ...data })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `study-deck-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// -------------------- Sign out --------------------
if (signOutBtn) {
  signOutBtn.addEventListener("click", () => {
    signOut(auth).catch((err) => {
      setStatus(hwStatus, humanizeAuthError(err?.code) || "Sign out failed.", true);
    });
  });
}

// -------------------- PWA --------------------
if ("serviceWorker" in navigator) {
  // No offline caching requested — manifest alone enables "Add to Home Screen".
}
