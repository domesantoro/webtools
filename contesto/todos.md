# Todo

- **Backoffice di configurazione**: deve poter modificare anche `webtools/configurator/bootstrap.env`.

## Promesse della pagina "Lavora con noi" (2026-09-22)

Cose che la pagina descrive e che il sistema non ha ancora:

- **Registrazione come driver**, con la domanda di abilitazione e il **colloquio**; chi lo supera
  passa a `enabled: true` in `drivers`.
- **Area driver**: generazione dei link di ambassador (`?ambassador=`, tutti i driver), dei link
  personali (`?driver=`) e dei codici sconto (`discounts`) per i driver abilitati.
- **Token del driver**: saldo, ricarica, addebito a ogni passaggio (pre-analisi, analisi,
  sviluppo) dei lavori autonomi, mail quando non bastano, blocco e sblocco delle pipeline.
- **Cancellazione del codice** di un lavoro autonomo dal nostro sistema, su richiesta del driver.
- **Costs and revenues calculator**: quota del driver, fee di sistema, 50% della fee
  all'ambassador (`billing.ambassador_uid`) sui progetti andati a buon fine.
