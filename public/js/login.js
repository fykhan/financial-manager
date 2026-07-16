import { toast } from './ui.js';

document.documentElement.dataset.theme = localStorage.getItem('gradplan.theme') || 'dark';

const form = document.getElementById('login-form');
const errorEl = document.getElementById('auth-error');
const submitBtn = document.getElementById('login-submit');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Signing in…';

  const body = {
    username: form.username.value,
    password: form.password.value,
  };

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = res.status === 429
        ? 'Too many attempts. Try again later.'
        : 'Invalid username or password.';
      errorEl.textContent = msg;
      toast(msg);
      return;
    }
    location.href = '/';
  } catch {
    errorEl.textContent = 'Network error, try again.';
    toast('Network error, try again.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Sign in';
  }
});
