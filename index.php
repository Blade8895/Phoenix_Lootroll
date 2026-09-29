<?php declare(strict_types=1); ?>
<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Phoenix Lootroll</title>
  <link rel="icon" type="image/png" href="assets/favicon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/style.css?v=5">
</head>
<body>
  <div class="starfield" aria-hidden="true"></div>

  <header class="topbar">
    <a class="brand" href="#/">
      <img src="assets/logo-mark.png" alt="" class="brand-logo">
      <span class="brand-text">
        <span class="brand-title">Phoenix</span>
        <span class="brand-sub">Interstellar · Lootroll</span>
      </span>
    </a>
    <div class="user-box" id="user-box" hidden>
      <span class="user-label">Pilot</span>
      <strong id="user-name"></strong>
      <button class="btn btn-ghost btn-sm" id="change-user" type="button">Wechseln</button>
    </div>
  </header>

  <main id="app" class="container"></main>

  <footer class="footer">
    <img src="assets/logo.png" alt="Phoenix Interstellar" class="footer-logo">
    <p>Phoenix Interstellar · Loot-Verteilung</p>
  </footer>

  <dialog id="name-dialog" class="dialog">
    <form method="dialog" id="name-form">
      <img src="assets/logo-mark.png" alt="" class="dialog-logo">
      <h2>Identifiziere dich, Pilot</h2>
      <p class="muted">Kein Login nötig – dein Name wird 365 Tage in einem Cookie gespeichert.</p>
      <label class="field">
        <span>Username</span>
        <input type="text" id="name-input" maxlength="32" required autocomplete="nickname" placeholder="z. B. Blade">
      </label>
      <button class="btn btn-primary btn-block" type="submit">Weiter</button>
    </form>
  </dialog>

  <div id="toast" class="toast" role="status" aria-live="polite"></div>

  <script src="assets/app.js?v=5"></script>
</body>
</html>
