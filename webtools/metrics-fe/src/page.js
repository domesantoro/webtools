// The pages, rendered from `templates/`.
//
// There is no HTML here and none in the rest of the code: metric names, dimension
// values, routes, models and project ids all end up inside the page, and every one
// of them comes from outside this subsystem. With nunjucks' autoescape on they are
// cleaned by themselves; written by hand, escaping would be a matter of remembering
// it every time.
//
// The charts are SVG in the templates for the same reason. What is worked out in
// JavaScript is coordinates — numbers — and never an element.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

import { count, duration } from "./figures.js";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const environment = nunjucks.configure(TEMPLATES_DIR, {
  autoescape: true,
  noCache: false,
  trimBlocks: false,
});

// Two filters, for the numbers that turn up inside a loop where the view could not
// have formatted them: a token count under a kind whose name is only known while the
// row is being printed, and a scale's tick. Both are the same formatting the views
// use, so a number does not read one way in one place and another way in the next.
environment.addFilter("number_text", (value) => count(value) ?? "\u2014");
environment.addFilter("ms_text", (value) => duration(value)?.text ?? "\u2014");

export function renderPage(template, view) {
  return environment.render(template, { view });
}
