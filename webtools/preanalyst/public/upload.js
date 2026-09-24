// Uploading a ready-made analysis.
//
// The file can be chosen while logged out: the account is needed at the moment of
// uploading. If at "Upload" you are not in, the login modal opens, and the login
// window itself only opens by pressing "Entra" or "Registrati" inside it. The
// upload then resumes by itself once the login is done (the `webtools:sso-login`
// event, from sso_popup.js). Closing the modal cancels the wait.
//
// The file stays here, in the page's memory, until it goes: it is not lost during
// the login and it is not sent to anybody before the right moment.
//
// Without JavaScript only the file field is left, and nothing else: the button
// does not appear and there is no upload. It is a feature that lives in the
// browser.

(function () {
  "use strict";

  var zone = document.querySelector("[data-upload-zone]");
  if (!zone) return;

  var field = zone.querySelector("input[type=file]");
  var nameLabel = zone.querySelector("[data-upload-name]");
  var actions = document.querySelector("[data-upload-actions]");
  var status = document.querySelector("[data-upload-status]");
  var uploadButton = document.querySelector("[data-upload-send]");
  var clearButton = document.querySelector("[data-upload-clear]");
  var modal = document.getElementById("login-dialog-upload");
  // The texts, in the page's language: the server writes them (upload_box.njk).
  var holder = zone.closest("[data-upload-messages]");
  var texts = JSON.parse(holder.getAttribute("data-upload-messages"));

  var chosen = null; // the chosen file
  var waitingForLogin = false; // login asked for by the upload modal
  var initialLabel = nameLabel.textContent;

  /* ------------------------------------------------------------ the choice */

  function show(file) {
    chosen = file || null;
    if (chosen) {
      nameLabel.textContent = chosen.name;
      actions.hidden = false;
    } else {
      nameLabel.textContent = initialLabel;
      actions.hidden = true;
      field.value = "";
    }
    write("");
  }

  function write(message, kind) {
    status.textContent = message;
    status.className = "upload-status" + (kind ? " upload-status-" + kind : "");
  }

  field.addEventListener("change", function () {
    show(field.files[0]);
  });

  clearButton.addEventListener("click", function () {
    show(null);
  });

  /* ---------------------------------------------------------- drag and drop */

  ["dragenter", "dragover"].forEach(function (name) {
    zone.addEventListener(name, function (event) {
      event.preventDefault();
      zone.classList.add("dropzone-over");
    });
  });

  ["dragleave", "drop"].forEach(function (name) {
    zone.addEventListener(name, function (event) {
      event.preventDefault();
      zone.classList.remove("dropzone-over");
    });
  });

  zone.addEventListener("drop", function (event) {
    var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (!file) return;
    // It also goes into the field, so the page stays consistent with what the
    // user sees: a chosen file is a chosen file, however it arrived.
    try {
      var list = new DataTransfer();
      list.items.add(file);
      field.files = list.files;
    } catch (error) {
      // Browsers that do not allow it: the file is kept in memory only.
    }
    show(file);
  });

  /* ------------------------------------------------------------ the upload */

  uploadButton.addEventListener("click", function () {
    if (!chosen) return;

    // The login is not asked for to choose a file, it is asked for to send one —
    // and it is *asked for*, not started: here the modal opens and that is all.
    if (window.webtoolsSso && !window.webtoolsSso.isLogged()) {
      write("");
      modal.showModal();
      return;
    }

    upload();
  });

  // The modal's links open the login themselves (sso_popup.js): here we note
  // that the file is to be sent once the login is done.
  modal.addEventListener("click", function (event) {
    if (!event.target.closest("[data-sso-login]")) return;
    waitingForLogin = true;
    write(texts.finish_login);
  });

  modal.addEventListener("close", function () {
    if (!waitingForLogin) return;
    waitingForLogin = false;
    write("");
  });

  document.addEventListener("webtools:sso-login", function () {
    var toSend = waitingForLogin && chosen;
    waitingForLogin = false;
    if (modal.open) modal.close();
    if (toSend) upload();
  });

  function upload() {
    uploadButton.disabled = true;
    write(texts.in_progress);

    // The file goes in the body as it is, with its name in a header: a single
    // file does not need a multipart form, and the server has nothing to take
    // apart to find it again.
    fetch("/upload", {
      method: "POST",
      headers: {
        "content-type": chosen.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(chosen.name),
      },
      body: chosen,
    })
      .then(function (response) {
        return response.json().then(function (body) {
          return { ok: response.ok, status: response.status, body: body };
        });
      })
      .then(function (result) {
        uploadButton.disabled = false;
        if (result.ok) {
          write(texts.done.replace("{name}", result.body.name), "ok");
          return;
        }
        write(errorMessage(result.body.error), "error");
      })
      .catch(function (error) {
        uploadButton.disabled = false;
        console.error("[upload]", error);
        write(texts.failed, "error");
      });
  }

  function errorMessage(code) {
    return texts.errors[code] || texts.failed;
  }
})();
