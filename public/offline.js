// Progressive enhancement for the offline guidance page (offline.html).
// The page works without this script — its retry control is a plain link to
// the app root — but once the connection comes back the user should not have
// to act at all, so returning online navigates back to the app on its own.
window.addEventListener('online', () => {
  window.location.replace('/');
});
