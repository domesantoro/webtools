// The shared loader: it raises the veil when a form actually goes.
//
// DO NOT EDIT THE COPY INSIDE A SUBSYSTEM.
// The original is `webtools/commons/script/webtools_loader.js`; the copies are
// distributed by `webtools/configurator/script_deployer/deploy.sh`.
//
// It applies to every form marked `data-webtools-loader`, together with the
// markup in `commons/templates/loader.njk`.
//
// The veil appears **only if the submission really goes**: `event.defaultPrevented`
// is checked, because another page may stop the submit (in the preanalyst
// `gate.js` does, opening the login modal when logged out). That is why this
// script must be loaded **after** the ones that intercept the submit: handlers
// are called in the order they were registered, and this one must see the
// decision already taken.
//
// The veil does not come down by itself: after a submission the page changes
// anyway, and a spinner disappearing while nothing has happened would be a lie.
// If the user goes back in history, though, the browser may hand back the page
// as it was, raised veil included: `pageshow` with `persisted` lowers it.

(function () {
  "use strict";

  var veil = document.getElementById("webtools-loader");
  if (!veil) return;

  function raise() {
    veil.setAttribute("data-on", "");
    veil.setAttribute("aria-hidden", "false");
  }

  function lower() {
    veil.removeAttribute("data-on");
    veil.setAttribute("aria-hidden", "true");
  }

  var forms = document.querySelectorAll("form[data-webtools-loader]");
  for (var i = 0; i < forms.length; i += 1) {
    forms[i].addEventListener("submit", function (event) {
      if (event.defaultPrevented) return;
      raise();
    });
  }

  window.addEventListener("pageshow", function (event) {
    if (event.persisted) lower();
  });
})();
