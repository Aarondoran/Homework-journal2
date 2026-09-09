import { firebaseConfig, OWNER_UID } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

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

document.getElementById("registerBtn").addEventListener("click", async () => {
  gateError.hidden = true;
  const email = document.getElementById("emailInput").value.trim();
  const pass = document.getElementById("passInput").value;
  if (!email || !pass) {
    gateError.textContent = "Enter an email and password first, then tap Create account.";
    gateError.hidden = false;
    return;
  }
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    showGateError(err);
  }
});

document.getElementById("signOutBtn").addEventListener("click", () => signOut(auth));

function showGateError(err) {
  gateError.textContent = humanizeAuthError(err.code) || "Something went wrong. Try again.";
  gateError.hidden = false;
}

function humanizeAuthError(code) {
  const map = {
    "auth/wrong-password": "That password doesn't match.",
    "auth/user-not-found": "No account with that email yet — tap Create account.",
    "auth/email-already-in-use": "An account with that email already exists — sign in instead.",
    "auth/weak-password": "Use at least 6 characters.",
    "auth/invalid-email": "That email doesn't look right.",
  };
  return map[code];
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    gate.hidden = false;
    appShell.hidden = true;
    if (unsubHw) unsubHw();
    if (unsubNotes) unsubNotes();
    return;
  }

  const ownerConfigured = OWNER_UID && OWNER_UID !== "PASTE_YOUR_UID_HERE";

  if (ownerConfigured && user.uid !== OWNER_UID) {
    gate.hidden = false;
    appShell.hidden = true;
    gateLocked.hidden = false;
    signOut(auth);
    return;
  }

  if (!ownerConfigured) {
    // First run: help the person find their UID so they can lock the deck down.
    console.info("Study Deck: your UID is", user.uid, "— paste it into OWNER_UID in firebase-config.js, then redeploy.");
  }

  gate.hidden = true;
  gateLocked.hidden = true;
  appShell.hidden = false;
  document.getElementById("userEmail").textContent = user.email || "";
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
let currentUid = null;

hwForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUid) return;
  const subject = document.getElementById("hwSubject").value.trim();
  const task = document.getElementById("hwTask").value.trim();
  const due = document.getElementById("hwDue").value;
  await addDoc(collection(db, "users", currentUid, "homework"), {
    subject, task, due, done: false, createdAt: serverTimestamp(),
  });
  hwForm.reset();
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
  check.addEventListener("click", () =>
    updateDoc(doc(db, "users", currentUid, "homework", it.id), { done: !it.done })
  );

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

noteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUid) return;
  const text = document.getElementById("noteText").value.trim();
  if (!text) return;
  await addDoc(collection(db, "users", currentUid, "notes"), {
    text, createdAt: serverTimestamp(),
  });
  noteForm.reset();
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
const ttUpload = document.getElementById("ttUpload");
const ttImage = document.getElementById("ttImage");
const ttPlaceholder = document.getElementById("ttPlaceholder");
const ttStatus = document.getElementById("ttStatus");

const MAX_IMAGE_BYTES = 700 * 1024; // keep comfortably under Firestore 1MB doc limit

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

ttUpload.addEventListener("change", async () => {
  const file = ttUpload.files?.[0];
  if (!file || !currentUid) return;

  if (!file.type.startsWith("image/")) {
    ttStatus.textContent = "Please choose an image file.";
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    ttStatus.textContent = "Image too large. Please use a smaller/compressed image.";
    return;
  }

  ttStatus.textContent = "Saving…";
  try {
    const dataUrl = await readFileAsDataURL(file);
    await setDoc(
      doc(db, "users", currentUid),
      { timetableDataUrl: dataUrl, timetableUpdatedAt: serverTimestamp() },
      { merge: true }
    );

    ttImage.src = dataUrl;
    ttImage.hidden = false;
    ttPlaceholder.hidden = true;
    ttStatus.textContent = "Updated just now.";
  } catch (e) {
    console.error("Timetable save error:", e);
    ttStatus.textContent = "Save failed. Try a smaller image.";
  } finally {
    ttUpload.value = "";
  }
});

async function loadTimetable(uid) {
  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    const dataUrl = userSnap.exists() ? userSnap.data().timetableDataUrl : null;

    if (dataUrl) {
      ttImage.src = dataUrl;
      ttImage.hidden = false;
      ttPlaceholder.hidden = true;
    } else {
      ttImage.hidden = true;
      ttPlaceholder.hidden = false;
    }
  } catch (e) {
    console.error("Timetable load error:", e);
    ttImage.hidden = true;
    ttPlaceholder.hidden = false;
  }
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

// ---------------------------------------------------------------- PWA
if ("serviceWorker" in navigator) {
  // No offline caching requested — manifest alone enables "Add to Home Screen".
}
