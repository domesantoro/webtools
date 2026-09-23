# webtools_workspaces

Conserva i file dei progetti, oggi le specifiche, in `<storage.root>/<project_id>/specs/spec-vNNN.md`.
Conserva e non decide: che il progetto esista, e di chi sia, lo verifica chi chiama.

Documentazione completa: `docs/subsystems/workspaces/README.md` (nella root del workspace).

```sh
npm install                                  # la prima volta, e dopo un cambio di versione
./webtools_workspaces.sh --start             # porta 9400, in background
./webtools_workspaces.sh --stop
npm test
```

- `POST /projects/{project_id}/specs`, con il `.md` nel corpo, `X-Spec-Origin: system|third_party` e `X-Uploaded-By: <uid>` → `201 {project_id, version}`.
- `GET /projects/{project_id}/specs/latest` → il `.md`, con `X-Spec-Version`.

`src/commons/spec_front_matter.js` è una copia generata da `webtools/configurator/specs_deployer/deploy.sh`: si modifica l'originale in `webtools/commons/specs/`.
`src/commons/configuration_client.js` è una copia generata da `webtools/configurator/configuration_deployer/deploy.sh`: l'originale sta in `webtools/commons/configuration/`.

La configurazione (`listen`, `access.allowed_ips`, `storage.root`, `storage.spec_max_bytes`) si legge all'avvio da anagraphics (`GET /configuration/workspaces`); la fonte è `webtools/configurator/configuration/workspaces.json`. Nessun default: se manca qualcosa il server non parte. Dall'ambiente arrivano solo le variabili di `webtools/configurator/bootstrap.env`, che `--start` carica da sé.
