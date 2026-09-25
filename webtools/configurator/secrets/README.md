# Secrets

What cannot live in `configuration/`, because that folder is in git: API keys,
credentials of external services.

One file per subsystem, with the same name as the configuration file
(`preanalyst.json` ↔ `configuration/preanalyst.json`) and the same nested shape.
`load_configuration.sh` **deep-merges** it onto the configuration file before
writing the document into Mongo: the subsystem reads a single configuration from
`GET /configuration/{subsystem}` and does not know that a piece of it was secret.

Deep-merging means that the secret adds its keys without deleting the others:
`prevalidation.providers.anthropic.api_key` sits beside
`prevalidation.providers.anthropic.model`, it
does not replace it.

This folder is in `.gitignore`, except this README and the `*.example` files.
To get started: copy the example, take `.example` off the name and put the real
value in.

    cp preanalyst.json.example preanalyst.json

After changing them, `../load_configuration.sh` is to be run again and whoever uses
them restarted (`../start.sh --restart`): the subsystems read the configuration at
startup.
