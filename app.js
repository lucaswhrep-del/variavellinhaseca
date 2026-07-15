import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, query, where,
  writeBatch, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const ADMIN_EMAIL = 'lucaswhrep@gmail.com';
const PERIOD = '2026-07';
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const accountCreatorApp = initializeApp(firebaseConfig, 'account-creator');
const accountCreatorAuth = getAuth(accountCreatorApp);

const form = document.querySelector('#loginForm');
const emailInput = document.querySelector('#loginEmail');
const passwordInput = document.querySelector('#loginPassword');
const message = document.querySelector('#authMessage');
const loginButton = document.querySelector('#loginButton');

const friendlyError = (error) => {
  const code = error?.code || '';
  if (code.includes('invalid-credential')) return 'E-mail ou senha inválidos.';
  if (code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde alguns minutos.';
  if (code.includes('network-request-failed')) return 'Não foi possível conectar. Verifique sua internet.';
  return 'Não foi possível entrar. Tente novamente.';
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';
  loginButton.disabled = true;
  loginButton.textContent = 'Entrando…';
  try {
    await signInWithEmailAndPassword(auth, emailInput.value.trim().toLowerCase(), passwordInput.value);
  } catch (error) {
    message.textContent = friendlyError(error);
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = 'Entrar';
  }
});

document.querySelector('#logoutButton').addEventListener('click', () => signOut(auth));

async function resolveProfile(user) {
  const email = user.email.trim().toLowerCase();
  const ref = doc(db, 'users', email);
  const snapshot = await getDoc(ref);
  if (snapshot.exists()) return { email, ...snapshot.data() };

  if (email === ADMIN_EMAIL) {
    const admin = {
      name: 'Lucas Rodrigues', email, role: 'administrador', supervisor: '', active: true
    };
    await setDoc(ref, admin);
    return admin;
  }
  throw new Error('profile-not-found');
}

async function loadResults(profile) {
  const ref = collection(db, 'periods', PERIOD, 'results');
  let source;
  if (profile.role === 'administrador' || profile.role === 'admin') source = ref;
  else if (profile.role === 'supervisor') source = query(ref, where('supervisor', '==', profile.name));
  else source = query(ref, where('email', '==', profile.email));

  const snapshot = await getDocs(source);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function loadReturns(profile) {
  const ref = collection(db, 'periods', PERIOD, 'returns');
  let source;
  if (profile.role === 'administrador' || profile.role === 'admin') source = ref;
  else if (profile.role === 'supervisor') source = query(ref, where('supervisor', '==', profile.name));
  else source = query(ref, where('email', '==', profile.email));
  const snapshot = await getDocs(source);
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

const safeId = (value) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const randomPassword = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return `${Array.from(bytes, (n) => (n % 36).toString(36)).join('')}A9!`;
};

window.persistImportedUsers = async (users) => {
  const currentProfile = await resolveProfile(auth.currentUser);
  if (!['administrador', 'admin'].includes(currentProfile.role)) throw new Error('Acesso restrito.');
  let created = 0;
  let existing = 0;

  for (const raw of users) {
    const user = {
      name: raw.name.trim(), email: raw.email.trim().toLowerCase(),
      role: raw.role.includes('admin') ? 'administrador' : raw.role.includes('supervisor') ? 'supervisor' : 'vendedor',
      supervisor: (raw.supervisor || '').trim(), active: true, updatedAt: serverTimestamp()
    };
    try {
      await createUserWithEmailAndPassword(accountCreatorAuth, user.email, randomPassword());
      await signOut(accountCreatorAuth);
      created += 1;
      await sendPasswordResetEmail(auth, user.email);
    } catch (error) {
      await signOut(accountCreatorAuth).catch(() => {});
      if (error.code === 'auth/email-already-in-use') existing += 1;
      else throw new Error(`Erro no usuário ${user.name}: ${error.message}`);
    }
    await setDoc(doc(db, 'users', user.email), user, { merge: true });
  }
  return { saved: users.length, created, existing };
};

window.persistImportedResults = async (results) => {
  const currentProfile = await resolveProfile(auth.currentUser);
  if (!['administrador', 'admin'].includes(currentProfile.role)) throw new Error('Acesso restrito.');

  const userSnapshots = await getDocs(collection(db, 'users'));
  const emailsByName = new Map(userSnapshots.docs.map((item) => {
    const user = item.data();
    return [String(user.name || '').trim().toUpperCase(), String(user.email || item.id).toLowerCase()];
  }));
  const missing = [...new Set(results.filter((item) => !emailsByName.has(item.name.trim().toUpperCase())).map((item) => item.name))];
  if (missing.length) throw new Error(`Cadastre primeiro: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`);

  const resultRef = collection(db, 'periods', PERIOD, 'results');
  const previous = await getDocs(resultRef);
  for (let start = 0; start < previous.docs.length; start += 400) {
    const batch = writeBatch(db);
    previous.docs.slice(start, start + 400).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }

  for (let start = 0; start < results.length; start += 400) {
    const batch = writeBatch(db);
    results.slice(start, start + 400).forEach((item) => {
      const email = emailsByName.get(item.name.trim().toUpperCase());
      const id = `${safeId(item.name)}-${safeId(item.material)}`;
      batch.set(doc(resultRef, id), {
        ...item, email, role: String(item.role || '').toLowerCase(),
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
  }
  const refreshed = await loadResults(currentProfile);
  const refreshedReturns = await loadReturns(currentProfile);
  window.setAppSession(currentProfile, refreshed, refreshedReturns);
  return { saved: results.length };
};

window.persistImportedReturns = async (returns) => {
  const currentProfile = await resolveProfile(auth.currentUser);
  if (!['administrador', 'admin'].includes(currentProfile.role)) throw new Error('Acesso restrito.');

  const userSnapshots = await getDocs(collection(db, 'users'));
  const usersByName = new Map(userSnapshots.docs.map((item) => {
    const user = item.data();
    return [String(user.name || '').trim().toUpperCase(), { ...user, email: String(user.email || item.id).toLowerCase() }];
  }));
  const valid = returns.filter((item) => usersByName.has(item.name.trim().toUpperCase()));
  const skipped = returns.length - valid.length;
  const grouped = new Map();
  valid.forEach((item) => {
    const key = `${item.name.trim().toUpperCase()}|${item.line.trim().toUpperCase()}`;
    const previous = grouped.get(key) || { ...item, total: 0 };
    previous.total += Number(item.total) || 0;
    grouped.set(key, previous);
  });

  const ref = collection(db, 'periods', PERIOD, 'returns');
  const previous = await getDocs(ref);
  for (let start = 0; start < previous.docs.length; start += 400) {
    const batch = writeBatch(db);
    previous.docs.slice(start, start + 400).forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
  const consolidated = [...grouped.values()];
  for (let start = 0; start < consolidated.length; start += 400) {
    const batch = writeBatch(db);
    consolidated.slice(start, start + 400).forEach((item) => {
      const user = usersByName.get(item.name.trim().toUpperCase());
      const id = `${safeId(item.name)}-${safeId(item.line)}`;
      batch.set(doc(ref, id), {
        name: item.name.trim(), line: item.line.trim().toUpperCase(), total: Number(item.total) || 0,
        email: user.email, supervisor: user.supervisor || user.name, updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
  }
  const refreshed = await loadResults(currentProfile);
  const refreshedReturns = await loadReturns(currentProfile);
  window.setAppSession(currentProfile, refreshed, refreshedReturns);
  return { saved: consolidated.length, skipped };
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    document.querySelector('#authScreen').hidden = false;
    document.querySelector('#appShell').hidden = true;
    return;
  }
  message.textContent = 'Carregando seus resultados…';
  try {
    const profile = await resolveProfile(user);
    if (profile.active === false) throw new Error('inactive-user');
    const [results, returns] = await Promise.all([loadResults(profile), loadReturns(profile)]);
    window.setAppSession(profile, results, returns);
    message.textContent = '';
  } catch (error) {
    console.error(error);
    message.textContent = error.message === 'profile-not-found'
      ? 'Seu login existe, mas ainda não foi autorizado pelo administrador.'
      : 'Não foi possível carregar seu perfil.';
    await signOut(auth);
  }
});
