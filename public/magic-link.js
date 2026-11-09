// Opening a link (including an email-security preview) must not redeem it.
export function prepareMagicLink({ token, button, requestNew, showConfirmation, showLogin, showStatus, clearUrl, verify, signedIn }) {
  if (!token) return false;
  clearUrl();
  showConfirmation();
  let pending = false;
  let completed = false;
  button.addEventListener('click', async () => {
    if (pending || completed) return;
    pending = true;
    button.disabled = true;
    requestNew.disabled = true;
    showStatus('Signing you in...', 'loading');
    try {
      await verify(token);
      completed = true;
      token = '';
      await signedIn();
    } catch (error) {
      showStatus(error.message || 'Unable to sign in. Please request a new link.', 'error');
    } finally {
      pending = false;
      button.disabled = completed;
      requestNew.disabled = false;
    }
  });
  requestNew.addEventListener('click', () => {
    if (pending) return;
    completed = true;
    token = '';
    showLogin();
  });
  return true;
}
