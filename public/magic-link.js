// Short-lived links tolerate email-security scans without a confirmation step.
export async function prepareMagicLink({ token, showStatus, clearUrl, verify, signedIn }) {
  if (!token) return false;
  clearUrl();
  showStatus('Signing you in...', 'loading');
  try {
    await verify(token);
    await signedIn();
  } catch (error) {
    showStatus(error.message || 'Unable to sign in. Please request a new link.', 'error');
  }
  return true;
}
