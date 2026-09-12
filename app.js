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
  linkWithPopup,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

// ---------------------------------------------------------------- elements
const gate = document.getElementById("gate");
const appShell = document.getElementById("app");
const gateError = document.getElementById("gateError");
const gateLocked = document.getElementById("gateLocked");

let unsubHw = null;
let unsubNotes = null;

// ---------------------------------------------------------------- auth
document.getElementById("emailForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  gateError.hidden = true;

  const email = document.getElementById("emailInput").value.trim();
  const pass = document.getElementById("passInput").value;

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    showGateError(err);
  }
});

document.getElementById("googleSignInBtn")?.addEventListener("click", async () => {
  gateError.hidden = true;
  try {
    await signInWithRedirect(auth, googleProvider);
  } catch (err) {
    showGateError(err);
  }
});

// IMPORTANT: this does not unlock app itself.
// It only surfaces redirect errors; successful auth is handled by onAuthStateChanged.
getRedirectResult(auth).catch((err) => {
  showGateError(err);
});

document.getElementById("signOutBtn").addEventListener("click", () => signOut(auth));

function showGateError(err) {
  gateError.textContent = humanizeAuthError(err?.code) || "Sign-in failed. Please try again.";
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
    "auth/account-exists-with-different-credential": "This email is already linked to a different sign-in method.",
    "auth/operation-not-allowed": "Google sign-in is not enabled in Firebase.",
    "auth/unauthorized-domain": "This domain is not authorized for sign-in.",
    "auth/popup-closed-by-user": "Sign-in was canceled.",
    "auth/cancelled-popup-request": "Sign-in was canceled.",
  };
  return map[code];
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    gate.hidden = false;
    appShell.hidden = true;
    gateLocked.hidden = true;
    currentUid = null;
    if (unsubHw) unsubHw();
    if (unsubNotes) unsubNotes();
    return;
  }

  
  gate.hidden = true;
  gateLocked.hidden = true;
  appShell.hidden = false;
  document.getElementById("userEmail").textContent = user.email || "";
  loadStaticTimetable();
  startSync(user.uid);
});

document.getElementById("googleSignInBtn").addEventListener("click", async () => {
  gateError.hidden = true;
  try {
    await signInWithRedirect(auth, googleProvider);
  } catch (err) {
    showGateError(err);
  }
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    gate.hidden = false;
    appShell.hidden = true;
    currentUid = null;
    if (unsubHw) unsubHw();
    if (unsubNotes) unsubNotes();
    return;
  }
  
getRedirectResult(auth).catch((err) => {
  showGateError(err);
});
  
  gate.hidden = true;
  gateLocked.hidden = true;
  appShell.hidden = false;
  document.getElementById("userEmail").textContent = user.email || "";
  loadStaticTimetable();
  startSync(user.uid);
});

// ---------------------------------------------------------------- nav
const railNav = document.getElementById("railNav");
railNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".rail-link");
  if (!btn) return;
  document.querySelectorAll(".rail-link").forEach((b) => b.classList.remove("is-active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("is-active"));
  btn.classList.add("is-active");
  document.getElementById(`panel-${btn.dataset.panel}`).classList.add("is-active");
});

// ---------------------------------------------------------------- homework
const hwForm = document.getElementById("hwForm");
const hwGroups = document.getElementById("hwGroups");
const hwEmpty = document.getElementById("hwEmpty");
const hwStatus = document.getElementById("hwStatus");
let currentUid = null;

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

// ---------------------------------------------------------------- notes
const noteForm = document.getElementById("noteForm");
const noteGrid = document.getElementById("noteGrid");
const noteEmpty = document.getElementById("noteEmpty");
const noteStatus = document.getElementById("noteStatus");

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

// ---------------------------------------------------------------- timetable
const ttImage = document.getElementById("ttImage");
const ttPlaceholder = document.getElementById("ttPlaceholder");
const ttStatus = document.getElementById("ttStatus");

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
// ---------------------------------------------------------------- export / backup
document.getElementById("exportBtn").addEventListener("click", async () => {
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

// Link Google account to currently signed-in user
const linkBtn = document.getElementById("linkGoogleBtn");
if (linkBtn) {
  linkBtn.addEventListener("click", async () => {
    if (!auth.currentUser) {
      setStatus(hwStatus, "Sign in first to link accounts.", true);
      return;
    }
    try {
      const result = await linkWithPopup(auth.currentUser, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const linkedEmail = result?.user?.email;
      const currentEmail = auth.currentUser?.email;
      if (linkedEmail && currentEmail && linkedEmail.toLowerCase() !== currentEmail.toLowerCase()) {
        setStatus(hwStatus, "Linked Google account email doesn't match signed-in account.", true);
        console.warn('Linked email mismatch', linkedEmail, currentEmail);
        return;
      }
      setStatus(hwStatus, "Google account linked.");
      console.log("Successfully linked Google account", result.user);
    } catch (err) {
      setStatus(hwStatus, humanizeAuthError(err?.code) || "Error linking Google account.", true);
      console.error("Error linking Google account:", err);
    }
  });
}
// ---------------------------------------------------------------- Connect Google

// Link Google account to currently signed-in user
const linkBtn = document.getElementById("linkGoogleBtn");
if (linkBtn) {
  linkBtn.addEventListener("click", async () => {
    // Check if a user is logged in
    if (!auth.currentUser) {
      setStatus(hwStatus, "Sign in first to link accounts.", true);
      return;
    }
    
    try {
      // Prompt user to sign in with Google to link accounts
      const result = await linkWithPopup(auth.currentUser, googleProvider);
      
      // Verify that emails match (enforce same-email requirement)
      const linkedEmail = result?.user?.email;
      const currentEmail = auth.currentUser?.email;
      
      if (linkedEmail && currentEmail && linkedEmail.toLowerCase() !== currentEmail.toLowerCase()) {
        setStatus(hwStatus, "Linked Google account email doesn't match signed-in account.", true);
        console.warn('Linked email mismatch', linkedEmail, currentEmail);
        return;
      }
      
      setStatus(hwStatus, "Google account linked.");
      console.log("Successfully linked Google account", result.user);
      
    } catch (err) {
      // Show clean, readable error messages
      setStatus(hwStatus, humanizeAuthError(err?.code) || "Error linking Google account.", true);
      console.error("Error linking Google account:", err);
    }
  });
}
// ---------------------------------------------------------------- PWA
if ("serviceWorker" in navigator) {
  // No offline caching requested — manifest alone enables "Add to Home Screen".
}
