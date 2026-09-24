// Submitting the pre-analysis while logged out.
//
// The form is filled in without an account; the account is needed to send it. If
// at "Send the request" you are not in, the form does not go and the login modal
// opens: the login window only opens if it is asked for from there.
//
// Once the login is done **the submission resumes by itself**, as the upload in
// upload.js already does: the user had already asked to send, and the login was
// an interruption, not a change of mind. Closing the modal without logging in
// cancels the wait.
//
// One exception, and not a small one: if the login makes the **autonomous work**
// block appear — it is there only for drivers, and before logging in we did not
// know this person was one — then nothing is sent, and the notice that says why
// lights up. It is a choice that appeared at that moment, and sending would take
// it out of their hands without their having seen it. The rest of the right-hand
// column does not raise the question: the driver is not chosen, those boxes are
// read and nothing else.
//
// The notice is already in the page, switched off (`page.njk`): here it is only
// switched on. The text lives in the language catalogues, not in the JavaScript.
//
// The `webtools:sso-login` event arrives **after** sso_popup.js has replaced the
// column, so by the time we look at the checkbox the page is already the new one.
//
// The required-field check comes first: the browser does it before the `submit`
// event, so the modal only appears for a form that is already complete.
//
// Without JavaScript the form goes and the server answers that an account is
// needed.

(function () {
  "use strict";

  var form = document.getElementById("gate-form");
  var modal = document.getElementById("login-dialog-submit");
  if (!form || !modal) return;

  // Was the autonomous-work checkbox already there before the login? Logged out
  // it is not, but what matters is the comparison, not today's case.
  var autonomousWorkBefore = Boolean(document.getElementById("autonomous-work"));
  var notice = document.querySelector("[data-autonomous-notice]");
  var waitingForLogin = false;

  form.addEventListener("submit", function (event) {
    if (!window.webtoolsSso || window.webtoolsSso.isLogged()) return;
    event.preventDefault();
    waitingForLogin = true;
    modal.showModal();
  });

  // Closed by hand, without logging in: the submission does not resume.
  modal.addEventListener("close", function () {
    if (!window.webtoolsSso || !window.webtoolsSso.isLogged()) waitingForLogin = false;
  });

  document.addEventListener("webtools:sso-login", function () {
    if (modal.open) modal.close();
    if (!waitingForLogin) return;
    waitingForLogin = false;

    if (!autonomousWorkBefore && document.getElementById("autonomous-work")) {
      if (notice) notice.hidden = false;
      return;
    }

    // `requestSubmit` and not `submit`: it goes through the field validation and
    // fires the event, so the loader comes on as in a normal submission.
    form.requestSubmit();
  });
})();
