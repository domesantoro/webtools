# commons-i18n-locales

Paths: `webtools/commons/i18n/locales/en.json`, `webtools/commons/i18n/locales/it.json`
Generated copies exist in every subsystem (`webtools/*/src/commons/i18n/locales/`); these findings
belong to the originals.
Examined: 2026-09-25

The two catalogues. Checked mechanically as well as read: **488 keys in each, with no key present
in one and absent from the other**, and **no placeholder mismatch** — every one of the 18 keys that
interpolates uses the same variable names in both languages. That is the discipline the whole i18n
design depends on and it is intact. `common.locale.name` is present in both (`English`,
`Italiano`), so the language switcher never has to fall back to a bare code.

Two things checked because they are where catalogues usually go wrong, and both are right:

- `translateHtml` (`webtools/commons/i18n/webtools_i18n.js:171-175`) prints the catalogue's HTML as
  it is and **escapes the interpolated values**, so the `<span data-chat-…>` hooks the numbers live
  in cannot become an injection.
- The one place a user-controlled value reaches a catalogue string — the uploaded file name in
  `preanalyst.upload.status.done` — is written with `textContent`
  (`webtools/preanalyst/public/upload.js:53`), not as HTML.

---

## 1. One count string carries a plural the rest of the catalogue deliberately avoids

- `preanalyst.analysis.exhausted.lead` in both catalogues — EN: "The {max} question-and-answer
  turns included in the pre-analysis have been used."; IT: "I {max} turni di domande e risposte
  compresi nella pre-analisi sono esauriti."
- Shape: **6 — the world narrowed to fit the code**
- Class: **the values `{max}` may take.** It is `chat.total` = turns used plus turns left
  (`webtools/preanalyst/src/page.js:211-212`), and when the box is shown, turns left is zero, so
  `{max}` is however many turns were actually spent. The sentence is written for a plural. At one,
  both languages read wrong: "The 1 question-and-answer turns", "I 1 turni".
- One is reachable: `analysis.max_turns` is validated only as `{ min: 1 }`
  (`webtools/preanalyst/src/settings.js:107`), so configuring it to 1 is legal, and that is a
  plausible thing to do while measuring what a pre-analysis really costs — which is the PoC's
  stated purpose.
- What makes this a finding rather than a nitpick is that **the same project already solved this
  problem and wrote down how**. `webtools/preanalyst/templates/analysis.njk:93-96`: "The number
  comes before the noun ('available: 1 of 5') and not after: that way the sentence does not change
  between one and more than one, and the JavaScript writes a number instead of choosing a form."
  Every other count string follows it — `turns.value`, `turns.warning`, `credit_available`. This
  one did not.
- Severity: `latent`
- Smallest generalising change: rewrite this sentence in the same shape as its neighbours, so the
  number is a value the sentence reports rather than a word it has to agree with.

## 2. The upload limit is stated in whole megabytes, for a limit configured in bytes

- `preanalyst.upload.limit` in both catalogues — "…up to {mb} MB" / "…fino a {mb} MB" — fed from
  `webtools/preanalyst/src/page.js:334`, `Math.round(settings.uploadMaxBytes / (1024 * 1024))`
- Shape: **6 — the world narrowed to fit the code**
- Class: **the values `upload.max_bytes` may hold.** It is validated as `{ min: 1 }`. The catalogue
  fixes the unit at megabytes and the rounding throws away everything below one, so the sentence
  can only be right for limits that happen to be near a whole number of megabytes — which is what
  10485760 is.
- What breaks, on an entitled change: lowering the limit to anything under about 1.5 MB makes the
  page state a number that is wrong, and under about 0.5 MB it states "up to 0 MB" while uploads
  still work. The page then tells the user their file is too large when it is not, or says nothing
  usable at all.
- Severity: `latent`
- Smallest generalising change: format the limit from the byte value rather than rounding it into a
  unit the catalogue has fixed in advance.

---

## Noted, not raised as findings

- `preanalyst.upload.status.done` is filled in the browser with
  `texts.done.replace("{name}", result.body.name)`
  (`webtools/preanalyst/public/upload.js:156`), a hand-rolled substitute for the server's
  `interpolate`. It replaces only the first occurrence, and `String.prototype.replace` expands
  `$&`, `` $` `` and `$'` in the *replacement*, so a file named with one of those sequences is
  displayed wrong. It is cosmetic — the result goes to `textContent` — and belongs to the
  public-JS unit; recorded here because the catalogue key is what it consumes.
- The catalogues contain HTML (`<span data-chat-used>` and similar). That is deliberate: the
  browser needs a hook to update a number without rewriting the sentence around it, which is the
  same reasoning as the pluralisation note above. With `translateHtml` escaping the values it is
  sound.
