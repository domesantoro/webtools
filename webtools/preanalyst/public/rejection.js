// La modale della richiesta rifiutata.
//
// Si apre al caricamento della pagina perché è la risposta all'invio che
// l'utente ha appena fatto: ci si arriva solo dal `303` di `/submit`, e la
// pagina senza modale non direbbe che cosa è successo.
//
// Alla chiusura — il bottone «ok», Esc, il clic fuori — si va alla home del sito
// vetrina: da questa pagina non c'è altro da fare, e il form è ormai vuoto.
//
// Senza JavaScript la modale non si apre: il markup c'è
// (`templates/partials/rejection_dialog.njk`), ma resta chiuso e l'utente vede
// la pagina normale. È un limite noto, scritto nel README.

(function () {
  "use strict";

  var modale = document.querySelector("[data-rejection-dialog]");
  if (!modale || typeof modale.showModal !== "function") return;

  modale.addEventListener("close", function () {
    window.location.href = modale.getAttribute("data-home");
  });

  modale.showModal();
})();
