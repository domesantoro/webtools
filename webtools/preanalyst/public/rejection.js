// The modal for a refused request.
//
// It opens when the page loads because it is the answer to the submission the
// user has just made: you only get here from the `303` of `/submit`, and the page
// without the modal would not say what happened.
//
// On closing — the «ok» button, Esc, a click outside — it goes to the showcase
// site's home page: there is nothing else to do from this page, and the form is
// empty by now.
//
// Without JavaScript the modal does not open: the markup is there
// (`templates/partials/rejection_dialog.njk`) but stays closed and the user sees
// the ordinary page. It is a known limit, written down in the README.

(function () {
  "use strict";

  var modal = document.querySelector("[data-rejection-dialog]");
  if (!modal || typeof modal.showModal !== "function") return;

  modal.addEventListener("close", function () {
    window.location.href = modal.getAttribute("data-home");
  });

  modal.showModal();
})();
