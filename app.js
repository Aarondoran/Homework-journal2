import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  linkWithRedirect,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

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
const ttImage = document.getElementById("ttImage");
const ttPlaceholder = document.getElementById("ttPlaceholder");
const ttStatus = document.getElementById("ttStatus");
const exportBtn = document.getElementById("exportBtn");
const linkBtn = document.getElementById("linkGoogleBtn");
const signOutBtn = document.getElementById("signOutBtn");
let currentUid = null;
let unsubHw = null;
let unsubNotes = null;

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
    "auth/account-exists-with-different-credential": "This email is linked to a different sign-in method.",
    "auth/operation-not-allowed": "Google sign-in is not enabled in Firebase.",
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

// -------------------- Google sign-in (redirect) --------------------
const googleSignInBtn = document.getElementById("googleSignInBtn");
if (googleSignInBtn) {
  googleSignInBtn.addEventListener("click", async () => {
    gateError.hidden = true;
    try {
      await signInWithRedirect(auth, googleProvider);
      // The redirect will take place; getRedirectResult will be processed on page load after redirect returns.
    } catch (err) {
      showGateError(err);
    }
  });
}

// -------------------- Handle redirect results --------------------
// Process both sign-in redirects and linking redirects here.
// If linking was started we store the pre-link email in sessionStorage under 'linkingEmail'.
getRedirectResult(auth)
  .then((result) => {
    if (!result) return;
    const linkingEmail = sessionStorage.getItem("linkingEmail");
    const resultEmail = result?.user?.email;
    if (linkingEmail) {
      // We expected to be linking; verify the email matches the stored one
      if (resultEmail && linkingEmail.toLowerCase() !== resultEmail.toLowerCase()) {
        setStatus(hwStatus, "Linked Google account email doesn't match signed-in account.", true);
        console.warn("Linked email mismatch", linkingEmail, resultEmail);
      } else {
        setStatus(hwStatus, "Google account linked.");
        console.log("Successfully linked Google account (redirect):", result.user);
      }
      sessionStorage.removeItem("linkingEmail");
    } else {
      // Normal sign-in redirect completed
      console.log("Authentication redirect finished:", result);
    }
  })
  .catch((err) => {
    showGateError(err);
  });

// -------------------- onAuthStateChanged --------------------
onAuthStateChanged(auth, (user) => {
  if (!user) {
    gate.hidden = false;
    appShell.hidden = true;
    currentUid = null;
    if (unsubHw) unsubHw();
    if (unsubNotes) unsubNotes();
    return;
  }

  gate.hidden = true;
  appShell.hidden = false;
  document.getElementById("userEmail").textContent = user.email || "";
  loadStaticTimetable();
  startSync(user.uid);
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
const TIMETABLE_IMAGE_PATH = "timetable.jpg";

function loadStaticTimetable() {
  if (!ttImage) return;

  ttImage.onload = () => {
    ttImage.hidden = false;
    if (ttPlaceholder) ttPlaceholder.hidden = true;
    if (ttStatus) ttStatus.textContent = "";
  };

  ttImage.onerror = () => {
    ttImage.hidden = true;
    if (ttPlaceholder) ttPlaceholder.hidden = false;
    if (ttStatus) ttStatus.textContent = "Couldn't load timetable.jpg";
  };

  ttImage.src = TIMETABLE_IMAGE_PATH;
}

// -------------------- Sync --------------------
function startSync(uid) {
  currentUid = uid;
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
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `study-deck-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

// -------------------- Link Google (redirect-only) --------------------
if (linkBtn) {
  linkBtn.addEventListener("click", async () => {
    if (!auth.currentUser) {
      setStatus(hwStatus, "Sign in first to link accounts.", true);
      return;
    }

    // Store the current signed-in email so we can verify it after the redirect returns.
    const currentEmail = auth.currentUser.email || "";
    sessionStorage.setItem("linkingEmail", currentEmail);

    try {
      await linkWithRedirect(auth.currentUser, googleProvider);
      // The redirect will happen and the result will be processed by getRedirectResult on page load.
    } catch (err) {
      sessionStorage.removeItem("linkingEmail");
      setStatus(hwStatus, humanizeAuthError(err?.code) || "Error starting linking redirect.", true);
      console.error("Error starting linkWithRedirect:", err);
    }
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
