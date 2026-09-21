// Il login in una finestra a parte, senza perdere la pagina di partenza.
//
// NON MODIFICARE LA COPIA DENTRO UN SOTTOSISTEMA.
// L'originale è `webtools/commons/sso/sso_popup.js`; le copie le distribuisce
// `webtools/configurator/sso_deployer/deploy.sh`, come per commons.css.
//
// Il problema. Il login sta su un altro indirizzo (il sso), quindi mandarci il
// browser vuol dire abbandonare la pagina: un form compilato a metà se ne va.
// Aprirlo in una scheda nuova salva il form, ma da solo non basta — finito il
// login quella scheda resta lì, e la pagina di partenza continua a credere che
// non sia entrato nessuno.
//
// Il giro completo, quindi:
//
//   1. "Entra" apre una finestra sul login del sso, che dopo il login rimanda a
//      `/login-done` **di questo sottosistema** (non alla pagina di partenza);
//   2. `/login-done` scambia il biglietto, mette il cookie e rende una paginetta
//      che carica questo stesso file;
//   3. quella paginetta avvisa la finestra che l'ha aperta e **si chiude**;
//   4. la pagina di partenza chiede al server i pezzi aggiornati e li rimpiazza
//      dove sono: testata, cancello del login, colonna destra. Il form non viene
//      toccato.
//
// Chi ha bisogno del login per fare altro (per esempio caricare un file) usa
// `window.webtoolsSso`:
//
//   webtoolsSso.isLogged()   dice se in questo momento si è dentro
//   webtoolsSso.openLogin()  apre la finestra del login
//   document.addEventListener("webtools:sso-login", …)   quando il login è finito
//
// L'ultimo serve a riprendere quello che si stava facendo: l'evento arriva dopo
// che la pagina è stata aggiornata.
//
// L'HTML non si costruisce qui: arriva dal server, reso dai template. In questo
// file ci sono solo indirizzi e nodi da sostituire.
//
// Senza JavaScript funziona lo stesso: i link hanno un `href` vero, che apre il
// login nella scheda e ci riporta indietro alla vecchia maniera.

(function () {
  "use strict";

  // Il messaggio che la finestra del login manda a chi l'ha aperta.
  var SEGNALE = "webtools_sso_login_done";

  /* ----------------------------------------- la finestra che ha fatto il login */

  // Questa paginetta è aperta dentro la finestra del login: avvisa e si chiude.
  function chiudiDopoIlLogin() {
    try {
      if (window.opener && !window.opener.closed) {
        // Stessa origine: `/login-done` lo serve lo stesso sottosistema della
        // pagina di partenza. Si dichiara comunque il destinatario.
        window.opener.postMessage(SEGNALE, window.location.origin);
      }
    } catch (errore) {
      // Se non si riesce ad avvisare, la paginetta resta aperta e lo dice:
      // l'utente ricarica a mano. Meglio di una finestra che sparisce e basta.
      console.error("[sso] non riesco ad avvisare la pagina di partenza:", errore);
      return;
    }
    window.close();
  }

  /* -------------------------------------------------- la pagina di partenza */

  // Sostituisce i pezzi che dipendono da chi è entrato. Il resto della pagina —
  // il form, quello che ci hai scritto dentro — non viene toccato.
  function aggiornaPagina() {
    // I parametri dell'indirizzo viaggiano con la richiesta: da chi arriva
    // l'utente decide che cosa c'è nella colonna destra, e dopo il login quella
    // colonna può cambiare (per esempio se è entrato il driver del link).
    fetch("/session-fragment" + window.location.search, {
      headers: { accept: "application/json" },
    })
      .then(function (risposta) {
        if (!risposta.ok) throw new Error("HTTP " + risposta.status);
        return risposta.json();
      })
      .then(function (dati) {
        // Il server dice quali pezzi rimpiazzare e con che cosa: qui non si sa
        // niente di che cosa contengano. Chi rimpiazza troppo si porta via anche
        // lo stato del browser — per esempio un file già scelto — quindi i pezzi
        // li sceglie chi li rende.
        var pezzi = dati.fragments || {};
        Object.keys(pezzi).forEach(function (selettore) {
          rimpiazza(selettore, pezzi[selettore]);
        });
        segnaLoStato(dati.logged);
        // Chi stava aspettando il login può riprendere da qui.
        document.dispatchEvent(new CustomEvent("webtools:sso-login", { detail: dati }));
      })
      .catch(function (errore) {
        // Non si aggiorna niente e non si rompe niente: la pagina resta com'è,
        // e basta ricaricarla.
        console.error("[sso] stato dell'accesso non aggiornato:", errore);
      });
  }

  // Lo stato dell'accesso sta sul <body>: il server ce lo mette quando rende la
  // pagina, e qui si tiene aggiornato. Così chi arriva dopo non deve chiederlo.
  function segnaLoStato(logged) {
    if (logged) document.body.setAttribute("data-sso-logged", "");
    else document.body.removeAttribute("data-sso-logged");
  }

  function rimpiazza(selettore, html) {
    var nodo = document.querySelector(selettore);
    if (nodo && typeof html === "string") nodo.innerHTML = html;
  }

  // `window.open` da un clic: è l'unico modo per poter poi chiudere quella
  // finestra da dentro. Una scheda aperta dal browser non si lascia chiudere.
  function apri(indirizzo) {
    if (!indirizzo) return null;
    var finestra = window.open(indirizzo, "webtools_sso_login", "popup,width=520,height=680");
    if (finestra) finestra.focus();
    return finestra;
  }

  function apriIlLogin(evento, collegamento) {
    var finestra = apri(collegamento.getAttribute("data-sso-login"));
    // Finestre bloccate: si lascia fare all'href normale del link.
    if (finestra) evento.preventDefault();
  }

  // L'indirizzo del login lo mette il server sul <body>: serve a chi apre il
  // login da codice, senza avere un link sotto il dito.
  function indirizzoDelLogin() {
    return document.body.getAttribute("data-sso-login-url");
  }

  window.webtoolsSso = {
    isLogged: function () {
      return document.body.hasAttribute("data-sso-logged");
    },
    openLogin: function () {
      return apri(indirizzoDelLogin());
    },
  };

  /* ------------------------------------------------------------- avvio */

  if (document.body.hasAttribute("data-sso-login-done")) {
    chiudiDopoIlLogin();
    return;
  }

  document.addEventListener("click", function (evento) {
    var collegamento = evento.target.closest("[data-sso-login]");
    if (collegamento) apriIlLogin(evento, collegamento);
  });

  window.addEventListener("message", function (evento) {
    if (evento.origin !== window.location.origin) return;
    if (evento.data !== SEGNALE) return;
    aggiornaPagina();
  });
})();
