// Il loader comune: accende il velo quando un form parte davvero.
//
// NON MODIFICARE LA COPIA DENTRO UN SOTTOSISTEMA.
// L'originale è `webtools/commons/script/webtools_loader.js`; le copie le
// distribuisce `webtools/configurator/script_deployer/deploy.sh`.
//
// Si applica a ogni form marcato `data-webtools-loader`, insieme al markup di
// `commons/templates/loader.njk`.
//
// Il velo compare **solo se l'invio parte davvero**: si guarda
// `evento.defaultPrevented`, perché un'altra pagina può fermare il submit
// (nel preanalyst lo fa `gate.js`, che da sloggati apre la modale del login).
// Per questo lo script va caricato **dopo** quelli che intercettano il submit:
// i gestori si chiamano nell'ordine in cui sono stati registrati, e questo deve
// vedere la decisione già presa.
//
// Il velo non si spegne da solo: dopo un invio la pagina cambia comunque, e una
// rotella che sparisce mentre non è successo niente direbbe il falso. Se però
// l'utente torna indietro nella cronologia il browser può restituire la pagina
// com'era, velo acceso compreso: `pageshow` con `persisted` lo spegne.

(function () {
  "use strict";

  var velo = document.getElementById("webtools-loader");
  if (!velo) return;

  function accendi() {
    velo.setAttribute("data-on", "");
    velo.setAttribute("aria-hidden", "false");
  }

  function spegni() {
    velo.removeAttribute("data-on");
    velo.setAttribute("aria-hidden", "true");
  }

  var forms = document.querySelectorAll("form[data-webtools-loader]");
  for (var i = 0; i < forms.length; i += 1) {
    forms[i].addEventListener("submit", function (evento) {
      if (evento.defaultPrevented) return;
      accendi();
    });
  }

  window.addEventListener("pageshow", function (evento) {
    if (evento.persisted) spegni();
  });
})();
