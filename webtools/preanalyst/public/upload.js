// Il caricamento di un'analisi già pronta.
//
// Il file si sceglie anche da sloggati: il conto serve al momento di caricare.
// Se al "Carica" non si è dentro, si apre la modale del login, e la finestra
// del login si apre solo premendo "Entra" o "Registrati" lì dentro. Poi il
// caricamento riparte da solo quando il login è finito (evento
// `webtools:sso-login`, da sso_popup.js). Chiudere la modale annulla l'attesa.
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
  var modale = document.getElementById("login-dialog-upload");
  // I testi, nella lingua della pagina: li scrive il server (upload_box.njk).
  var contenitore = zona.closest("[data-upload-messages]");
  var testi = JSON.parse(contenitore.getAttribute("data-upload-messages"));

  var scelto = null; // il file scelto
  var inAttesaDelLogin = false; // login chiesto dalla modale del caricamento
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
    // lo si chiede, non lo si fa partire: qui si apre la modale e basta.
    if (window.webtoolsSso && !window.webtoolsSso.isLogged()) {
      scrivi("");
      modale.showModal();
      return;
    }

    manda();
  });

  // I link della modale aprono il login da sé (sso_popup.js): qui si prende
  // nota che il file, a login finito, va mandato.
  modale.addEventListener("click", function (evento) {
    if (!evento.target.closest("[data-sso-login]")) return;
    inAttesaDelLogin = true;
    scrivi(testi.finish_login);
  });

  modale.addEventListener("close", function () {
    if (!inAttesaDelLogin) return;
    inAttesaDelLogin = false;
    scrivi("");
  });

  document.addEventListener("webtools:sso-login", function () {
    var daMandare = inAttesaDelLogin && scelto;
    inAttesaDelLogin = false;
    if (modale.open) modale.close();
    if (daMandare) manda();
  });

  function manda() {
    bottone.disabled = true;
    scrivi(testi.in_progress);

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
          scrivi(testi.done.replace("{name}", esito.corpo.name), "ok");
          return;
        }
        scrivi(messaggioDiErrore(esito.corpo.error), "errore");
      })
      .catch(function (errore) {
        bottone.disabled = false;
        console.error("[upload]", errore);
        scrivi(testi.failed, "errore");
      });
  }

  function messaggioDiErrore(codice) {
    return testi.errors[codice] || testi.failed;
  }
})();
