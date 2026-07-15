import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, query, where
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const ADMIN_EMAIL = 'lucaswhrep@gmail.com';
const PERIOD = '2026-07';
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);

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
    const results = await loadResults(profile);
    window.setAppSession(profile, results);
    message.textContent = '';
  } catch (error) {
    console.error(error);
    message.textContent = error.message === 'profile-not-found'
      ? 'Seu login existe, mas ainda não foi autorizado pelo administrador.'
      : 'Não foi possível carregar seu perfil.';
    await signOut(auth);
  }
});

