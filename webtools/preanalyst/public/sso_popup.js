// Logging in in a separate window, without losing the page you started from.
//
// DO NOT EDIT THE COPY INSIDE A SUBSYSTEM.
// The original is `webtools/commons/sso/sso_popup.js`; the copies are distributed
// by `webtools/configurator/sso_deployer/deploy.sh`, as for commons.css.
//
// The problem. The login lives at another address (the sso), so sending the
// browser there means abandoning the page: a half-filled form is gone. Opening it
// in a new tab saves the form, but that alone is not enough — once the login is
// done that tab just sits there, and the page you started from still believes
// nobody has logged in.
//
// The full round trip, then:
//
//   1. "Entra" opens a window on the sso login, which after the login sends the
//      browser back to `/login-done` **of this subsystem** (not to the starting
//      page);
//   2. `/login-done` exchanges the ticket, sets the cookie and renders a small
//      page that loads this very file;
//   3. that small page notifies the window that opened it and **closes itself**;
//   4. the starting page asks the server for the updated fragments and replaces
//      them in place: header, login gate, right-hand column. The form is not
//      touched.
//
// Anyone who needs the login in order to do something else (uploading a file, for
// instance) uses `window.webtoolsSso`:
//
//   webtoolsSso.isLogged()   whether we are in right now
//   webtoolsSso.openLogin()  opens the login window
//   document.addEventListener("webtools:sso-login", …)   when the login is done
//
// The last one is for resuming whatever was being done: the event arrives after
// the page has been updated.
//
// HTML is not built here: it comes from the server, rendered by the templates.
// This file holds only addresses and nodes to replace.
//
// Without JavaScript it still works: the links have a real `href`, which opens
// the login in the tab and brings you back the old-fashioned way.

(function () {
  "use strict";

  // The message the login window sends to whoever opened it.
  var SIGNAL = "webtools_sso_login_done";

  /* --------------------------------------- the window that did the login */

  // This small page is open inside the login window: it notifies and closes.
  function closeAfterLogin() {
    try {
      if (window.opener && !window.opener.closed) {
        // Same origin: `/login-done` is served by the same subsystem as the
        // starting page. The recipient is declared all the same.
        window.opener.postMessage(SIGNAL, window.location.origin);
      }
    } catch (error) {
      // If the notification fails, the small page stays open and says so: the
      // user reloads by hand. Better than a window that just disappears.
      console.error("[sso] cannot notify the starting page:", error);
      return;
    }
    window.close();
  }

  /* ------------------------------------------------- the starting page */

  // Replaces the parts that depend on who has logged in. The rest of the page —
  // the form, what you wrote in it — is not touched.
  function refreshPage() {
    // The address parameters travel with the request: where the user came from
    // decides what is in the right-hand column, and after the login that column
    // can change (for instance if the driver of the link has just logged in).
    fetch("/session-fragment" + window.location.search, {
      headers: { accept: "application/json" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status);
        return response.json();
      })
      .then(function (data) {
        // The server says which fragments to replace and with what: nothing here
        // knows what they contain. Replacing too much carries away browser state
        // as well — an already chosen file, for instance — so the fragments are
        // chosen by whoever renders them.
        var fragments = data.fragments || {};
        Object.keys(fragments).forEach(function (selector) {
          replace(selector, fragments[selector]);
        });
        markState(data.logged);
        // Anyone waiting for the login can resume from here.
        document.dispatchEvent(new CustomEvent("webtools:sso-login", { detail: data }));
      })
      .catch(function (error) {
        // Nothing is updated and nothing is broken: the page stays as it is, and
        // a reload is enough.
        console.error("[sso] login state not refreshed:", error);
      });
  }

  // The login state lives on the <body>: the server puts it there when it renders
  // the page, and here it is kept up to date. So whoever arrives later need not
  // ask for it.
  function markState(logged) {
    if (logged) document.body.setAttribute("data-sso-logged", "");
    else document.body.removeAttribute("data-sso-logged");
  }

  function replace(selector, html) {
    var node = document.querySelector(selector);
    if (node && typeof html === "string") node.innerHTML = html;
  }

  // `window.open` from a click: it is the only way to be able to close that
  // window from inside afterwards. A tab opened by the browser will not close.
  function open(address) {
    if (!address) return null;
    var win = window.open(address, "webtools_sso_login", "popup,width=520,height=680");
    if (win) win.focus();
    return win;
  }

  function openLoginFrom(event, link) {
    var win = open(link.getAttribute("data-sso-login"));
    // Blocked windows: the link's ordinary href is left to do the job.
    if (win) event.preventDefault();
  }

  // The login address is put on the <body> by the server: it is for whoever opens
  // the login from code, without a link under their finger.
  function loginAddress() {
    return document.body.getAttribute("data-sso-login-url");
  }

  window.webtoolsSso = {
    isLogged: function () {
      return document.body.hasAttribute("data-sso-logged");
    },
    openLogin: function () {
      return open(loginAddress());
    },
  };

  /* ------------------------------------------------------------- startup */

  if (document.body.hasAttribute("data-sso-login-done")) {
    closeAfterLogin();
    return;
  }

  document.addEventListener("click", function (event) {
    var link = event.target.closest("[data-sso-login]");
    if (link) openLoginFrom(event, link);
  });

  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin) return;
    if (event.data !== SIGNAL) return;
    refreshPage();
  });
})();
