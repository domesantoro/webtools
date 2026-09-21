// Il caricamento di un'analisi già pronta.
//
// Il file si sceglie anche da sloggati: il conto serve al momento di caricare.
// Se al "Carica" non si è dentro, **non si apre niente**: compare l'avviso che
// serve l'accesso, e la finestra del login si apre solo premendo "Entra e
// carica". Poi il caricamento riparte da solo quando il login è finito (evento
// `webtools:sso-login`, da sso_popup.js).
//
// Il file resta qui, in memoria della pagina, finché non parte: non si perde
// durante il login e non viene mandato a nessuno prima del momento giusto.
//
// Senza JavaScript resta il campo file e nient'altro: il bottone non compare e
// non c'è nessun caricamento. È una funzione che vive nel browser.

(function () {
  "use strict";

  var zona = document.querySelector("[data-upload-zone]");
  if (!zona) return;

  var campo = zona.querySelector("input[type=file]");
  var nome = zona.querySelector("[data-upload-name]");
  var azioni = document.querySelector("[data-upload-actions]");
  var stato = document.querySelector("[data-upload-status]");
  var bottone = document.querySelector("[data-upload-send]");
  var togli = document.querySelector("[data-upload-clear]");
  var avvisoLogin = document.querySelector("[data-upload-login]");
  var entraECarica = document.querySelector("[data-upload-login-go]");

  var scelto = null; // il file scelto
  var inAttesaDelLogin = false; // "Carica" premuto da sloggati
  var testoIniziale = nome.textContent;

  /* --------------------------------------------------------- la scelta */

  function mostra(file) {
    scelto = file || null;
    if (scelto) {
      nome.textContent = scelto.name;
      azioni.hidden = false;
    } else {
      nome.textContent = testoIniziale;
      azioni.hidden = true;
      campo.value = "";
    }
    avvisoLogin.hidden = true;
    scrivi("");
  }

  function scrivi(messaggio, tipo) {
    stato.textContent = messaggio;
    stato.className = "upload-status" + (tipo ? " upload-status-" + tipo : "");
  }

  campo.addEventListener("change", function () {
    mostra(campo.files[0]);
  });

  togli.addEventListener("click", function () {
    mostra(null);
  });

  /* ------------------------------------------------------ il trascinamento */

  ["dragenter", "dragover"].forEach(function (evento) {
    zona.addEventListener(evento, function (e) {
      e.preventDefault();
      zona.classList.add("dropzone-over");
    });
  });

  ["dragleave", "drop"].forEach(function (evento) {
    zona.addEventListener(evento, function (e) {
      e.preventDefault();
      zona.classList.remove("dropzone-over");
    });
  });

  zona.addEventListener("drop", function (e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    // Si mette anche nel campo, così la pagina resta coerente con quello che
    // l'utente vede: un file scelto è un file scelto, comunque sia arrivato.
    try {
      var lista = new DataTransfer();
      lista.items.add(file);
      campo.files = lista.files;
    } catch (errore) {
      // Browser che non lo permette: si tiene solo in memoria.
    }
    mostra(file);
  });

  /* --------------------------------------------------------- il caricamento */

  bottone.addEventListener("click", function () {
    if (!scelto) return;

    // Il login non si chiede per scegliere un file, si chiede per mandarlo — e
    // lo si chiede, non lo si fa partire: qui si mostra l'avviso e basta.
    if (window.webtoolsSso && !window.webtoolsSso.isLogged()) {
      avvisoLogin.hidden = false;
      scrivi("");
      return;
    }

    manda();
  });

  entraECarica.addEventListener("click", function () {
    inAttesaDelLogin = true;
    avvisoLogin.hidden = true;
    scrivi("Finisci il login nella finestra che si è aperta.");
    var finestra = window.webtoolsSso && window.webtoolsSso.openLogin();
    if (!finestra) {
      inAttesaDelLogin = false;
      scrivi("Il browser ha bloccato la finestra del login. Sbloccala e riprova.", "errore");
    }
  });

  document.addEventListener("webtools:sso-login", function () {
    avvisoLogin.hidden = true;
    if (!inAttesaDelLogin) return;
    inAttesaDelLogin = false;
    if (scelto) manda();
  });

  function manda() {
    bottone.disabled = true;
    scrivi("Caricamento in corso…");

    // Il file va nel corpo così com'è, con il nome in un header: non serve un
    // form multipart per mandare un file solo, e il server non deve smontare
    // niente per ritrovarlo.
    fetch("/upload", {
      method: "POST",
      headers: {
        "content-type": scelto.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(scelto.name),
      },
      body: scelto,
    })
      .then(function (risposta) {
        return risposta.json().then(function (corpo) {
          return { ok: risposta.ok, status: risposta.status, corpo: corpo };
        });
      })
      .then(function (esito) {
        bottone.disabled = false;
        if (esito.ok) {
          scrivi("Caricato: " + esito.corpo.name, "ok");
          return;
        }
        scrivi(messaggioDiErrore(esito.corpo.error), "errore");
      })
      .catch(function (errore) {
        bottone.disabled = false;
        console.error("[upload]", errore);
        scrivi("Non è riuscito. Riprova.", "errore");
      });
  }

  var ERRORI = {
    NOT_LOGGED: "Serve l'accesso per caricare un file.",
    FILE_TOO_LARGE: "Il file è troppo grande.",
    EMPTY_FILE: "Il file è vuoto.",
    MISSING_FILE_NAME: "Manca il nome del file.",
  };

  function messaggioDiErrore(codice) {
    return ERRORI[codice] || "Non è riuscito. Riprova.";
  }
})();
