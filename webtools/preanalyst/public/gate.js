// L'invio della pre-analisi da sloggati.
//
// Il form si compila senza conto; il conto serve per mandarlo. Se al "Manda la
// richiesta" non si è dentro, il form non parte e si apre la modale del login:
// la finestra del login si apre solo se la si chiede da lì. Finito il login la
// modale si chiude e l'invio si ripete a mano — nel frattempo la colonna del
// driver può essere cambiata, e va vista prima di mandare.
//
// Il controllo dei campi obbligatori viene prima: il browser lo fa prima
// dell'evento `submit`, quindi la modale compare solo per un form già completo.
//
// Senza JavaScript il form parte e il server risponde che serve l'accesso.

(function () {
  "use strict";

  var form = document.getElementById("gate-form");
  var modale = document.getElementById("login-dialog-submit");
  if (!form || !modale) return;

  form.addEventListener("submit", function (evento) {
    if (!window.webtoolsSso || window.webtoolsSso.isLogged()) return;
    evento.preventDefault();
    modale.showModal();
  });

  document.addEventListener("webtools:sso-login", function () {
    if (modale.open) modale.close();
  });
})();
