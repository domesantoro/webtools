// The page, rendered from `templates/configuration.njk`.
//
// There is no HTML here and none in the rest of the code: values coming from the
// configuration — and from the environment — end up inside the page, and with
// nunjucks' autoescape on they are cleaned by themselves. Written by hand,
// escaping would be a matter of remembering it every time.

import { fileURLToPath } from "node:url";

import nunjucks from "nunjucks";

const TEMPLATES_DIR = fileURLToPath(new URL("../templates/", import.meta.url));

const environment = nunjucks.configure(TEMPLATES_DIR, {
  autoescape: true,
  noCache: false,
  trimBlocks: false,
});

export function renderConfigurationPage(view) {
  return environment.render("configuration.njk", { view });
}
