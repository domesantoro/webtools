// The specification-round chat.
//
// Nothing is counted or decided here: the conversation and the turns live on the
// project, and the server is the only one that touches them. This page sends the
// message, waits for the answer and updates itself with the numbers the server
// gives back. Reloading loses nothing, because everything comes from the server.
//
// THE ANSWER IS STILL FAKE — the server picks it from a fixed list — but
// everything around it is real: the turn spent, the chat written, the credit
// drawn down.
//
// Three calls, all with the project's API contract (HTTP status plus a stable
// code in `{"error": …}`):
//
//   POST /analysis/{id}/messages    one turn: message and answer
//   POST /analysis/{id}/turns       moves turns from the user's credit
//   POST /analysis/{id}/turns/buy   FAKE PURCHASE: grants credit
//
// HTML is not composed from strings and no text lives here: the page's <template>
// is cloned and `.chat-text` filled with `textContent`; warnings, errors and boxes
// are already in the page, switched off, and here they are only switched on. The
// numbers that change live in marked <span>s, put there by the catalogues.

(function () {
  "use strict";

  var panel = document.querySelector("[data-chat-project]");
  if (!panel) return;

  var projectId = panel.getAttribute("data-chat-project");
  var log = panel.querySelector("[data-chat-log]");
  var waiting = panel.querySelector("[data-chat-waiting]");
  var form = panel.querySelector("[data-chat-form]");
  var field = panel.querySelector("[data-chat-input]");
  var sendButton = panel.querySelector("[data-chat-send]");
  var warning = panel.querySelector("[data-chat-warning]");
  var errorLine = panel.querySelector("[data-chat-error]");
  var exhausted = panel.querySelector("[data-chat-exhausted]");
  var templates = {
    client: document.querySelector('[data-chat-template="client"]'),
    system: document.querySelector('[data-chat-template="system"]'),
  };
  if (!log || !form || !field || !sendButton || !templates.client || !templates.system) return;

  // The out-of-turns box.
  var buyButton = panel.querySelector("[data-chat-buy]");
  var useCreditButton = panel.querySelector("[data-chat-use-credit]");
  var turnsField = panel.querySelector("[data-chat-turns-input]");
  var creditLine = panel.querySelector("[data-chat-credit-line]");
  var noCreditLine = panel.querySelector("[data-chat-credit-empty]");
  var tooManyLine = panel.querySelector("[data-chat-turns-too-many]");
  var invalidLine = panel.querySelector("[data-chat-turns-invalid]");
  var exhaustedError = panel.querySelector("[data-chat-exhausted-error]");
  // The notice that the analysis has been judged complete. The server decides
  // whether it is on when the page is born; from then on this file follows what
  // each turn answers.
  var readyNotice = panel.querySelector("[data-chat-ready]");
  // It sits in the summary, outside the panel: it is born disabled and becomes
  // active when the analysis is complete, or when the turns run out. Those are the
  // two roads out of the conversation — while there are still questions to answer
  // it is not a choice to put in front of anybody.
  var goButton = document.querySelector("[data-chat-go]");
  var goError = document.querySelector("[data-chat-go-error]");

  // The numbers written inside the catalogues' sentences.
  var usedCount = document.querySelector("[data-chat-used]");
  var totalCount = document.querySelector("[data-chat-total]");
  var leftCount = document.querySelector("[data-chat-left]");
  var warningTotal = document.querySelector("[data-chat-warn-total]");
  var creditCount = panel.querySelector("[data-chat-credit-value]");

  var turnsLeft = Number(panel.getAttribute("data-chat-turns-left"));
  var warnAtOrBelow = Number(panel.getAttribute("data-chat-warn-left"));
  var credit = Number(panel.getAttribute("data-chat-credit"));
  var rounds = log.querySelectorAll(".chat-turn-client").length;
  // Read from the notice and not from an attribute of its own: the two could then
  // disagree, and what is shown would not be what is held.
  var ready = readyNotice ? !readyNotice.hidden : false;
  var busy = false;

  /* ------------------------------------------------------------- the calls */

  // No exceptions towards the caller: { ok: true, data } or { ok: false }, like
  // the server's clients. Why it failed does not change what is shown — one
  // message — but it stays in the console.
  function ask(path, payload) {
    return fetch("/analysis/" + encodeURIComponent(projectId) + path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload || {}),
    })
      .then(function (response) {
        return response.json().then(function (body) {
          if (response.ok) return { ok: true, data: body };
          console.error("[analysis] " + path + ": HTTP " + response.status + " " + (body && body.error));
          return { ok: false, code: body && body.error };
        });
      })
      .catch(function (failure) {
        console.error("[analysis] " + path + ": " + failure.name + " " + failure.message);
        return { ok: false };
      });
  }

  /* ---------------------------------------------------------- the messages */

  function append(who, text) {
    var entry = templates[who].content.cloneNode(true);
    entry.querySelector(".chat-text").textContent = text;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  /* ------------------------------------------------------------- the turns */

  // Everything that depends on how many turns are left, in one place: the
  // counter, the warning, the field being there or not. Called after every
  // answer from the server, with the numbers the server gave.
  function refresh() {
    if (usedCount) usedCount.textContent = String(rounds);
    if (totalCount) totalCount.textContent = String(rounds + turnsLeft);

    var writable = turnsLeft > 0;
    form.hidden = !writable;
    if (exhausted) exhausted.hidden = writable;
    if (readyNotice) readyNotice.hidden = !ready;
    // Two ways to be able to go on: the analysis has been judged complete, or the
    // turns have run out. If turns come back — from credit or from a purchase —
    // and the analysis is not complete, the field reappears and the go button goes
    // quiet again: it was an interruption, not an end.
    if (goButton) goButton.disabled = writable && !ready;

    if (warning) {
      var warn = writable && turnsLeft <= warnAtOrBelow;
      if (warn) {
        if (leftCount) leftCount.textContent = String(turnsLeft);
        if (warningTotal) warningTotal.textContent = String(rounds + turnsLeft);
      }
      warning.hidden = !warn;
    }

    showCredit();
  }

  // With credit you spend, without it you buy: the two never appear together.
  function showCredit() {
    var hasCredit = credit > 0;
    if (creditCount) creditCount.textContent = String(credit);
    if (creditLine) creditLine.hidden = !hasCredit;
    if (noCreditLine) noCreditLine.hidden = hasCredit;
    if (turnsField) {
      turnsField.disabled = !hasCredit;
      // `max` is not a defence — it does not stop anybody typing a larger number —
      // but it puts the field in the browser's invalid state, which the style
      // shows, and it gives the arrows the right ceiling.
      turnsField.max = String(Math.max(1, credit));
    }
    if (buyButton) buyButton.hidden = hasCredit;
    checkTurns();
  }

  // How many turns have been asked for, or 0 if the number cannot be used: it is
  // not whole, it is not at least one, or it is more than the credit. Says so on
  // the spot — while the number is being typed — and switches the button off:
  // before this the click simply did nothing, which reads as a broken button.
  //
  // The empty field is not a mistake, it is the beginning of writing: the button
  // is off and nothing is said.
  function checkTurns() {
    var written = turnsField ? turnsField.value.trim() : "";
    var howMany = Number(written);
    var usable = written !== "" && Number.isInteger(howMany) && howMany > 0;
    var tooMany = usable && howMany > credit;
    // With no credit the box already says there is none: a second sentence about
    // the number would be saying the same thing twice.
    var say = credit > 0;

    if (tooManyLine) tooManyLine.hidden = !(say && tooMany);
    if (invalidLine) invalidLine.hidden = !(say && written !== "" && !usable);
    if (useCreditButton) useCreditButton.disabled = !say || !usable || tooMany;
    return usable && !tooMany ? howMany : 0;
  }

  function showError(where, on) {
    if (where) where.hidden = !on;
  }

  /* -------------------------------------------------------------- one turn */

  // One message at a time: until the answer has arrived, no other is sent. The
  // field stays readable, but cannot be written in or submitted.
  function lock(locked) {
    busy = locked;
    field.disabled = locked;
    sendButton.disabled = locked;
    waiting.hidden = !locked;
    if (locked) log.scrollTop = log.scrollHeight;
  }

  function send() {
    if (busy || turnsLeft <= 0) return;
    var text = field.value.trim();
    if (text === "") {
      field.focus();
      return;
    }

    showError(errorLine, false);
    append("client", text);
    var written = field.value;
    field.value = "";
    fitField();
    lock(true);

    ask("/messages", { message: text }).then(function (result) {
      waiting.hidden = true;
      if (!result.ok) {
        // The turn was not spent: the message just added is removed and what had
        // been written goes back into the field, which is the only copy of it.
        var last = log.querySelector(".chat-turn-client:last-child");
        if (last) last.remove();
        field.value = written;
        fitField();
        showError(errorLine, true);
        lock(false);
        field.focus();
        return;
      }

      append("system", result.data.reply);
      rounds += 1;
      turnsLeft = Number(result.data.turns_left);
      // The verdict of this turn, not a door that stays open: the server judges
      // every turn, and a later one can reopen the questions.
      ready = Boolean(result.data.ready);
      lock(false);
      refresh();
      if (turnsLeft > 0) field.focus();
    });
  }

  /* --------------------------------------------------- the out-of-turns box */

  if (turnsField) {
    // Both events: `input` is the typing, `change` is the arrows and what a paste
    // leaves behind.
    turnsField.addEventListener("input", checkTurns);
    turnsField.addEventListener("change", checkTurns);
  }

  if (useCreditButton) {
    useCreditButton.addEventListener("click", function () {
      // The button is already off when the number cannot be used; this is the same
      // check, because a click can arrive anyway.
      var howMany = checkTurns();
      if (howMany <= 0) return;

      showError(exhaustedError, false);
      useCreditButton.disabled = true;
      ask("/turns", { turns: howMany }).then(function (result) {
        if (!result.ok) {
          // Back to whatever the number written deserves, not simply on.
          checkTurns();
          return showError(exhaustedError, true);
        }
        turnsLeft = Number(result.data.turns_left);
        credit = Number(result.data.credit);
        // What was spent is gone: the field goes back to one, or it would keep
        // asking for turns that are no longer there. `refresh()` then says whether
        // that one is still possible.
        if (turnsField) turnsField.value = "1";
        refresh();
        field.focus();
      });
    });
  }

  if (buyButton) {
    buyButton.addEventListener("click", function () {
      showError(exhaustedError, false);
      buyButton.disabled = true;
      ask("/turns/buy", {}).then(function (result) {
        buyButton.disabled = false;
        if (!result.ok) return showError(exhaustedError, true);
        credit = Number(result.data.credit);
        showCredit();
      });
    });
  }

  /* ----------------------------------------------------------- the opening */

  // The analyst speaks first. A conversation that has not begun leaves the log
  // empty, and the first question is asked for here — once: from then on it lives
  // on the project like every other message, and a reload reads it back instead of
  // paying for it again.
  //
  // It spends no turn, so nothing is counted here.
  function askForOpening() {
    lock(true);
    ask("/opening", {}).then(function (result) {
      waiting.hidden = true;
      if (!result.ok) {
        if (result.code === "ANALYSIS_ALREADY_OPENED") {
          // Another page of ours got the first question written first. What is on
          // this screen is older than the conversation, so the page is asked again
          // for what is really there.
          window.location.reload();
          return;
        }
        // The field is given back: a reload tries again, and there is nothing to
        // lose because nothing was written.
        showError(errorLine, true);
        lock(false);
        return;
      }
      append("system", result.data.reply);
      lock(false);
      refresh();
      if (turnsLeft > 0) field.focus();
    });
  }

  /* ---------------------------------------------------------- the go button */

  // TODO(placeholder): what the button does until the step that follows the
  // analysis exists. It hands over the project's record as a file; when there is a
  // real move to make, that is what goes here.
  //
  // The name comes from the server's `content-disposition`, so the file is named
  // in one place only. If the header is not there — a proxy that drops it, a
  // server answering another way — the project's id still names the file: a
  // download has to be called something.
  function nameFrom(response) {
    var disposition = response.headers.get("content-disposition") || "";
    var found = /filename="([^"]+)"/.exec(disposition);
    return found ? found[1] : "webtools-project-" + projectId + ".json";
  }

  // A file that arrives from a fetch reaches the disk in one way only: a link that
  // is made, clicked and thrown away. Nothing opens on its own here — this is the
  // answer to a click on the button.
  function save(file, name) {
    var address = URL.createObjectURL(file);
    var link = document.createElement("a");
    link.href = address;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // The address keeps the file in memory until it is let go, and letting it go
    // in the same breath as the click has been known to cut the download short:
    // the browser is given its moment.
    setTimeout(function () {
      URL.revokeObjectURL(address);
    }, 1000);
  }

  if (goButton) {
    goButton.addEventListener("click", function () {
      showError(goError, false);
      goButton.disabled = true;
      fetch("/analysis/" + encodeURIComponent(projectId) + "/project", { headers: { accept: "application/json" } })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("HTTP " + response.status);
          }
          return response.blob().then(function (file) {
            save(file, nameFrom(response));
          });
        })
        .catch(function (failure) {
          console.error("[analysis] project record: " + failure.name + " " + failure.message);
          showError(goError, true);
        })
        .then(function () {
          // Back to whatever the state deserves, not simply on: if the turns and
          // the verdict say the button should be off, it goes off.
          refresh();
        });
    });
  }

  /* ------------------------------------------------------------- the field */

  // The field grows with what it holds, up to the maximum the CSS decides. It is
  // reset before measuring, or it would never shrink again.
  function fitField() {
    field.style.height = "auto";
    field.style.height = field.scrollHeight + "px";
  }

  field.addEventListener("input", fitField);

  field.addEventListener("keydown", function (event) {
    // Enter sends, Shift+Enter starts a new line. `isComposing` is someone
    // typing with a composition input method: there Enter closes the word, not
    // the message.
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    send();
  });

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    send();
  });

  log.scrollTop = log.scrollHeight;
  fitField();
  refresh();
  // Nothing in the log means the conversation has not begun: the analyst has yet
  // to ask its first question.
  if (log.querySelectorAll(".chat-turn").length === 0) askForOpening();
})();
