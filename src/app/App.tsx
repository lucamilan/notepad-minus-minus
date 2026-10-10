const REPO_URL = 'https://github.com/lucamilan/notepad-minus-minus';

export function App() {
  return (
    <main class="placeholder">
      <p class="logo">
        <span class="logo-mark" aria-hidden="true" />
        Notepad−−
      </p>
      <h1>La nuova versione è in costruzione</h1>
      <p>
        Notepad−− rinasce come blocco note che vive solo nel browser: le note saranno cifrate con
        una passphrase e non lasceranno mai questo dispositivo.
      </p>
      <p class="muted">
        Le funzioni arrivano una fase alla volta. La versione precedente è archiviata nel branch{' '}
        <a href={`${REPO_URL}/tree/legacy/blazor-net7`} rel="noopener noreferrer">
          legacy/blazor-net7
        </a>
        .
      </p>
    </main>
  );
}
