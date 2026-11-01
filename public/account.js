(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const register = location.pathname === '/register';
  const form = $('accountForm');
  let closed = false;
  ['nameField', 'teamField', 'confirmField', 'registrationNote', 'passwordHint', 'paymentField'].forEach((id) => { $(id).hidden = !register; });
  ['name', 'teamName', 'confirmPassword', 'transactionId', 'paymentProof'].forEach((name) => { form.elements[name].required = register; form.elements[name].disabled = !register; });
  form.elements.password.minLength = register ? 10 : 1;
  form.elements.password.autocomplete = register ? 'new-password' : 'current-password';
  $(register ? 'registerTab' : 'loginTab').setAttribute('aria-current', 'page');
  $('accountTitle').textContent = register ? 'Create your account' : 'Welcome back.';
  $('accountEyebrow').textContent = register ? 'WELCOME TO THE TANK' : 'YOUR EVENT, ONE CLICK AWAY';
  $('accountHint').textContent = register ? 'Register for the event and open your participant portal.' : 'Sign in to see the question and your latest updates.';
  $('accountSubmit').textContent = register ? 'Create account & enter portal ↗' : 'Sign in to your portal ↗';
  document.title = `${register ? 'Register' : 'Sign in'} · Tech Tank`;
  if (register) fetch('/api/content', { cache: 'no-store' }).then((r) => r.json()).then(({ event }) => {
    closed = event.registrationOpen === false || Date.now() >= Date.parse(event.registrationDeadline);
    if (closed) {
      $('accountMessage').textContent = 'Registration is closed. Existing participants can sign in.';
      $('accountSubmit').disabled = true;
    }
  }).catch(() => {});
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (closed) return;
    const input = Object.fromEntries(new FormData(form));
    if (register && input.password !== input.confirmPassword) { $('accountMessage').textContent = 'The passwords do not match.'; return; }
    delete input.confirmPassword;
    $('accountMessage').textContent = '';
    $('accountSubmit').disabled = true;
    $('accountSubmit').setAttribute('aria-busy', 'true');
    try {
      if (register) {
        const proof = form.elements.paymentProof.files[0];
        if (!proof || !['image/png', 'image/jpeg', 'image/webp'].includes(proof.type) || !proof.size || proof.size > 5 * 1024 * 1024) throw new Error('Choose a PNG, JPG or WebP payment screenshot up to 5 MB.');
        input.paymentProof = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Could not read the screenshot. Please select it again.'));
          reader.readAsDataURL(proof);
        });
      }
      const response = await fetch('/api/account/' + (register ? 'register' : 'login'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(20000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not sign in. Please try again.');
      location.assign('/portal');
    } catch (error) {
      $('accountMessage').textContent = error.name === 'TimeoutError' ? 'The connection timed out. Please try again.' : error.message;
      $('accountSubmit').disabled = false;
      $('accountSubmit').removeAttribute('aria-busy');
    }
  });
})();
