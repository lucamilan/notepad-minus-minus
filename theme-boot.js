// Applica il tema salvato prima che la pagina venga disegnata, evitando un lampo col tema
// sbagliato mentre si carica il bundle principale. Deve restare allineato a theme.ts.
(function () {
  try {
    var theme = window.localStorage.getItem('notepad:theme');
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  } catch {
    // Storage non disponibile: resta il tema di sistema.
  }
})();
