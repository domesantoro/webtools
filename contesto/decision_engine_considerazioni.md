# Decision Engine — considerazioni e proposta architetturale

## Scopo

Questo documento raccoglie le considerazioni emerse sull'opportunità di introdurre nel progetto un sottosistema trasversale dedicato alle decisioni, provvisoriamente chiamato:

> **Decision Engine**

L'idea nasce da un fatto semplice: molti sottosistemi della piattaforma non devono generare contenuti complessi, ma devono continuamente prendere piccole decisioni operative:

- classificare;
- assegnare uno score;
- scegliere un ramo del workflow;
- decidere se proseguire;
- stabilire se serve una review;
- determinare quando effettuare un retry;
- capire se un caso deve essere escalato;
- selezionare il Driver o il processo più adatto.

La proposta è centralizzare questo tipo di logica in un componente dedicato, utilizzabile da tutta la piattaforma.

---

# 1. Idea di fondo

Il Decision Engine deve essere **trasversale**.

Non appartiene a una singola fase del workflow.

Deve poter essere interrogato da:

- Preanalysis;
- Analysis;
- Validation;
- Driver Pool;
- Dev Ecosystem;
- Testing;
- Demo;
- Production;
- eventuali futuri sottosistemi.

Schema concettuale:

```text
Preanalysis ─────────┐
Analysis ────────────┤
Validation ──────────┤
Driver Pool ─────────┤
Dev Ecosystem ───────┼──> Decision Engine
Testing ─────────────┤
Demo ────────────────┤
Production ──────────┘
```

Il Decision Engine non sostituisce questi sottosistemi.

Li aiuta a **decidere cosa fare dopo**.

---

# 2. Ruolo

Il Decision Engine dovrebbe ricevere:

1. uno stato;
2. una domanda decisionale;
3. eventualmente un insieme di output ammessi;
4. criteri, policy o soglie.

E dovrebbe restituire una decisione strutturata.

Esempio:

```json
{
  "decision": "manual_review",
  "confidence": 0.84
}
```

Versione più ricca:

```json
{
  "decision": "retry",
  "confidence": 0.91,
  "reason_code": "missing_required_output",
  "scores": {
    "completeness": 0.62,
    "consistency": 0.88
  }
}
```

Principio:

> **il Decision Engine decide; gli altri sottosistemi eseguono.**

---

# 3. Tipi di decisione

## Classificazione

Esempi:

- questo progetto è in scope?
- che tipo di progetto è?
- che classe di complessità presenta?
- quale categoria di Driver serve?
- il feedback dell'utente è un bug o una nuova richiesta?

Output possibili:

```text
IN_SCOPE
OUT_OF_SCOPE
NEEDS_REVIEW
```

---

## Scoring

Esempi:

- quanto è completa questa analisi?
- quanto è chiaro lo scope?
- quanto è rischioso procedere?
- quanto è affidabile questo test?
- quanto è probabile che il problema sia dovuto a specifiche incomplete?

Output:

```json
{
  "score": 0.87
}
```

Gli score possono essere usati per soglie operative.

Esempio puramente illustrativo:

```text
>= 0.85     → procedi automaticamente
0.60–0.84   → escalation a modello più forte
< 0.60      → review manuale
```

Le soglie reali dovranno essere validate empiricamente.

---

## Routing

Esempi:

- quale ramo del workflow deve seguire il progetto?
- il fallimento deve tornare allo sviluppo o all'analisi?
- quale sottosistema deve ricevere il prossimo task?
- quale Driver è compatibile?

Esempio:

```json
{
  "decision": "return_to_analysis"
}
```

---

## Escalation

Il Decision Engine deve anche poter decidere che **non è sicuro abbastanza da decidere automaticamente**.

Possibili escalation:

```text
modello più potente
review manuale
richiesta di ulteriori informazioni
blocco del workflow
```

---

## Selezione

Esempi:

- quale Driver è più adatto?
- quale modello usare?
- quale strategia di sviluppo scegliere?
- quale test eseguire?
- quale review attivare?

Il Decision Engine può quindi diventare anche un router intelligente fra risorse diverse.

---

# 4. Cosa NON deve fare

Il Decision Engine non deve diventare un secondo sistema generalista.

In particolare NON dovrebbe:

- condurre lunghe conversazioni con il cliente;
- scrivere specifiche complete;
- sviluppare codice;
- produrre documentazione estesa;
- realizzare analisi profonde;
- correggere direttamente il progetto;
- sostituire i test deterministici;
- gestire direttamente pagamenti o deploy;
- possedere tutta la logica operativa dei sottosistemi.

Il suo compito deve rimanere piccolo:

> **ricevere uno stato e produrre una decisione strutturata.**

---

# 5. Principio architetturale: provider-agnostic

Il resto della piattaforma NON dovrebbe sapere quale tecnologia sta prendendo la decisione.

L'interfaccia deve rimanere stabile.

Dietro il Decision Engine potrebbero esserci:

- Jev;
- Claude;
- OpenAI;
- Gemini;
- un classificatore tradizionale;
- regole deterministiche;
- policy statiche;
- una combinazione di più sistemi;
- un ensemble;
- un sistema costruito internamente in futuro.

Schema:

```text
Analysis subsystem
        │
        ▼
Decision Engine API
        │
        ├── rules
        ├── Jev
        ├── frontier LLM
        └── manual escalation
```

Questa separazione permette di sostituire o confrontare tecnologie senza modificare tutti gli altri componenti.

---

# 6. Jev / System One

Jev è interessante perché è progettato per un tipo di lavoro diverso dalla generazione libera.

Il paradigma è orientato a:

- classificazioni;
- choice;
- scoring;
- decisioni strutturate;
- routing;
- valutazioni probabilistiche.

Il valore potenziale non è sostituire i modelli frontier usati per analisi, sviluppo o review complesse.

Il valore è:

> **evitare di usare un modello generativo costoso ogni volta che serve soltanto una piccola decisione.**

Jev va quindi considerato come possibile **provider del Decision Engine**, non come fondamento obbligatorio dell'architettura.

---

# 7. Dove potrebbe essere utile

## Preanalysis

Possibili decisioni:

- mancano informazioni?
- la richiesta è sufficientemente chiara?
- quale domanda dovrebbe essere fatta dopo?
- la richiesta è palesemente fuori scala?

Non dovrebbe condurre direttamente l'intera conversazione, ma può aiutare a decidere il ramo successivo.

---

## Analysis Prevalidator

Possibili controlli:

- completezza;
- contraddizioni;
- compatibilità con lo scope;
- ambiguità residue;
- requisiti mancanti;
- rischio eccessivo.

---

## Analysis Validation

L'Analysis Engine produce l'analisi.

Il Decision Engine può valutarla su più assi:

```text
completezza
coerenza
testabilità
chiarezza
scope
rischio
```

Ogni asse può produrre uno score separato.

---

## Scope validation

Caso particolarmente naturale.

Esempio:

```text
scope_score = 0.94 → avanti
scope_score = 0.71 → secondo controllo
scope_score = 0.42 → review manuale
```

---

## Driver Pool

Possibili impieghi:

- classificare il progetto;
- estrarre le skill richieste;
- valutare compatibilità Driver/progetto;
- creare shortlist;
- segnalare progetti che richiedono competenze particolari.

---

## Dev Ecosystem

Il Decision Engine non deve scrivere codice.

Può decidere:

- se un fallimento è recuperabile;
- se effettuare retry;
- se cambiare strategia;
- se tornare all'Analysis;
- se chiedere review umana;
- se classificare il problema come out-of-scope.

---

## Alpha Test

I test deterministici rimangono codice.

Esempi:

```text
test unitari
test API
test browser
assertion
schema validation
security scan
```

Il Decision Engine può aiutare quando la valutazione è semantica.

Esempio:

> “L'interfaccia prodotta soddisfa effettivamente il requisito descritto nella specifica?”

---

## Demo / feedback cliente

Possibili classificazioni:

```text
bug
specifica non rispettata
richiesta nuova
feedback estetico
problema di ambiente
richiesta non pertinente
```

Questa distinzione è importante per evitare che la demo diventi automaticamente un ciclo di sviluppo aperto.

---

## Production

Possibili utilizzi:

- classificazione di anomalie;
- scelta del tipo di escalation;
- riconoscimento di problemi di deploy;
- distinzione fra bug applicativo e problema infrastrutturale.

---

# 8. Decision Engine ibrido

Non tutte le decisioni dovrebbero essere affidate all'AI.

Una gerarchia possibile:

```text
1. regola deterministica
2. modello decisionale specializzato
3. modello frontier
4. review manuale
```

Esempio:

```text
if test_exit_code != 0
    → failure

if failure_type è determinabile da regole
    → route automatico

altrimenti
    → Decision Engine AI

se confidence insufficiente
    → frontier model

se ancora insufficiente
    → Driver
```

Questo evita di usare AI dove una semplice condizione è migliore.

---

# 9. Confidence

Ogni decisione non deterministica dovrebbe idealmente produrre anche una confidence.

Esempio:

```json
{
  "decision": "in_scope",
  "confidence": 0.96
}
```

Oppure:

```json
{
  "decision": "in_scope",
  "confidence": 0.58
}
```

Nel secondo caso il sistema può scegliere di non fidarsi della decisione.

La confidence è un segnale operativo, non una garanzia matematica di correttezza.

Va calibrata sul comportamento reale.

---

# 10. Output tipizzati

Una caratteristica desiderabile è che il Decision Engine non possa rispondere liberamente.

Se la domanda è:

```text
Questa richiesta è compatibile con il sistema?
```

gli output ammessi possono essere soltanto:

```text
YES
NO
NEEDS_REVIEW
```

Non:

```text
“Dipende, probabilmente sì, ma consiglierei...”
```

Gli output tipizzati:

- semplificano il workflow;
- riducono gli errori di parsing;
- rendono le decisioni auditabili;
- facilitano il cambio di provider;
- permettono test automatici.

---

# 11. API concettuale

Non serve ancora scegliere framework.

Possibile forma:

```text
POST /decision
```

Input:

```json
{
  "decision_type": "scope_validation",
  "state": {},
  "allowed_outputs": [
    "accept",
    "reject",
    "manual_review"
  ],
  "policy": "scope-v1"
}
```

Output:

```json
{
  "decision": "manual_review",
  "confidence": 0.81,
  "metadata": {}
}
```

---

# 12. Policies

Le decisioni non dovrebbero vivere in prompt dispersi nel codice.

Conviene introdurre il concetto di **policy**.

Esempi:

```text
scope-v1
analysis-quality-v2
dev-failure-routing-v1
driver-matching-v1
demo-feedback-v1
```

Una policy può descrivere:

- domanda;
- possibili output;
- criteri;
- soglie;
- strategia di escalation;
- provider preferito;
- fallback.

Questo permette di versionare il comportamento decisionale.

---

# 13. Decision log

Ogni decisione importante dovrebbe essere registrata.

Possibili dati:

```text
decision_id
project_id
subsystem
policy
input reference
decision
confidence
provider
model
timestamp
eventuale override umano
risultato successivo
```

Questo permetterà di capire:

- quali decisioni sbagliamo più spesso;
- quali policy funzionano;
- quanto spesso il Driver corregge una decisione;
- se Jev funziona meglio o peggio di un frontier model;
- quali confidence sono realmente affidabili;
- quali gate sono inutili.

---

# 14. Human override

Il Driver deve poter correggere una decisione automatica quando previsto.

Esempio:

```text
Decision Engine:
OUT_OF_SCOPE — confidence 0.74

Driver:
override → IN_SCOPE
```

L'override va registrato.

Questi dati possono diventare molto utili per calibrare e migliorare il sistema.

---

# 15. Confronto fra provider

L'interfaccia provider-agnostic permette di confrontare:

```text
Jev
vs
Claude
vs
OpenAI
vs
regola deterministica
```

sulle stesse decisioni.

Metriche utili:

- accuratezza;
- costo;
- latenza;
- tasso di escalation;
- accordo con il Driver;
- errori critici.

---

# 16. Strategia consigliata per Jev

Jev non dovrebbe diventare una dipendenza strutturale obbligatoria fin dall'inizio.

Motivi:

- tecnologia molto recente;
- maturità da verificare;
- comportamento reale sul nostro dominio ancora sconosciuto;
- benchmark iniziali da validare con dati nostri.

La proposta è:

> progettare il Decision Engine in modo compatibile con Jev, senza progettare la piattaforma attorno a Jev.

Jev può quindi essere:

- sperimentato;
- confrontato;
- sostituito;
- utilizzato soltanto per alcune policy.

---

# 17. Decisioni reversibili e irreversibili

## Decisioni facilmente reversibili

Possono avere soglie di automazione più permissive.

Esempi:

```text
retry
second review
richiedi dettaglio
seleziona test aggiuntivo
```

## Decisioni con conseguenze forti

Richiedono confidence maggiore o intervento umano.

Esempi:

```text
rifiuta progetto
approva definitivamente scope
assegna un progetto importante
concludi una contestazione
```

---

# 18. Relazione con il Driver

Il Driver non viene sostituito dal Decision Engine.

Idealmente:

```text
decisioni banali
    → automatiche

decisioni incerte
    → modello più forte

decisioni importanti/ambigue
    → Driver
```

Il Driver diventa il livello umano di escalation.

---

# 19. Relazione con i modelli frontier

I modelli frontier restano fondamentali per:

- ragionamento complesso;
- analisi;
- progettazione;
- sviluppo;
- review semantica difficile;
- comprensione profonda del contesto.

Il Decision Engine evita di usare questi modelli per ogni singolo bivio operativo.

Formula concettuale:

> **modello forte produce → Decision Engine giudica/indirizza → codice esegue**

con escalation verso modello forte o umano quando necessario.

---

# 20. Benefici attesi

## Riduzione del costo AI

Molte micro-decisioni non richiedono un modello frontier.

## Riduzione della latenza

Decisioni semplici possono essere rapide.

## Uniformità

Le stesse policy possono essere applicate da sottosistemi differenti.

## Auditabilità

Ogni decisione può essere registrata e ricostruita.

## Sostituibilità

Il provider può cambiare senza riscrivere il workflow.

## Testabilità

Le policy diventano componenti testabili.

## Evoluzione

Il sistema può migliorare sulla base dei propri decision log.

---

# 21. Rischi

## Centralizzazione eccessiva

Il Decision Engine non deve diventare un “mega cervello” che conosce tutto.

Deve ricevere il minimo contesto necessario.

## Policy troppo generiche

Una policy del tipo:

> “decidi cosa fare”

è sbagliata.

Meglio decisioni piccole e ben delimitate.

## Fiducia eccessiva nella confidence

La confidence va calibrata empiricamente.

## AI dove basta codice

Se una regola deterministica risolve il problema, va usata la regola.

## Vendor lock-in

Va evitato tramite interfaccia astratta.

---

# 22. Principio progettuale

Il Decision Engine dovrebbe lavorare su decisioni:

- piccole;
- esplicite;
- tipizzate;
- versionate;
- osservabili;
- reversibili quando possibile;
- accompagnate da confidence;
- dotate di escalation.

Non:

> “capisci tutto e dimmi cosa fare”

ma:

> “dato questo stato, scegli una delle tre azioni ammesse secondo questa policy.”

---

# 23. Possibile struttura logica

```text
Decision Engine

├── API
├── Policy Registry
├── Rule Engine
├── Provider Router
│   ├── Jev
│   ├── Frontier LLM
│   └── altri provider
├── Confidence / Threshold Layer
├── Escalation Manager
├── Decision Log
└── Metrics
```

Questa è una struttura concettuale, non una decisione implementativa.

---

# 24. Collegamento con lo stack generale

La scelta architetturale generale del progetto rimane:

> **JavaScript/Node come spina dorsale della piattaforma, Python solo nei sottosistemi AI/agentici dove realmente utile, PostgreSQL come stato centrale condiviso.**

Il Decision Engine dovrebbe quindi poter essere esposto naturalmente al resto della piattaforma tramite JavaScript/Node.

L'eventuale SDK JavaScript di Jev può semplificare l'integrazione, ma non deve determinare l'architettura.

---

# 25. Strategia di implementazione consigliata

## Fase 1

Definire un'interfaccia astratta per le decisioni.

Implementare poche policy reali.

Per esempio:

```text
scope_validation
analysis_validation
dev_failure_routing
```

## Fase 2

Usare inizialmente un provider semplice o un modello frontier.

Registrare tutte le decisioni.

## Fase 3

Integrare Jev come provider alternativo.

Possibile shadow mode:

```text
provider principale → decisione operativa
Jev → decisione registrata ma non applicata
```

## Fase 4

Confrontare risultati.

Misurare:

```text
accordo
errori
costo
latenza
confidence
override Driver
```

## Fase 5

Affidare a Jev soltanto le policy sulle quali dimostra affidabilità sufficiente.

---

# 26. Primo set di policy candidate

## scope_validation

Input:

- analisi;
- requisiti;
- vincoli.

Output:

```text
ACCEPT
REJECT
MANUAL_REVIEW
```

---

## analysis_validation

Input:

- specifica prodotta;
- contesto iniziale.

Output:

```text
PASS
REANALYZE
MANUAL_REVIEW
```

Più eventuali score:

```text
completeness
consistency
testability
```

---

## dev_failure_routing

Input:

- errore;
- stato progetto;
- output test;
- storico retry.

Output:

```text
RETRY
RETURN_TO_ANALYSIS
MANUAL_REVIEW
OUT_OF_SCOPE
```

Queste tre policy attraversano punti molto diversi del workflow e permettono di capire rapidamente se il concetto funziona.

---

# 27. Conclusione

La proposta è introdurre formalmente un nuovo sottosistema trasversale:

> **Decision Engine**

Il suo compito non è produrre lavoro, ma governare i piccoli bivi del workflow.

Deve essere:

- provider-agnostic;
- utilizzabile da tutti i sottosistemi;
- basato su decisioni tipizzate;
- dotato di confidence ed escalation;
- osservabile;
- testabile;
- sostituibile;
- integrabile con regole deterministiche;
- compatibile con modelli frontier;
- potenzialmente compatibile con Jev/System One.

Jev appare particolarmente interessante come possibile implementazione di una parte del motore, perché il suo paradigma è vicino alle esigenze di classificazione, scoring e routing della piattaforma.

La scelta architetturale consigliata è:

> **costruire il Decision Engine come componente stabile della piattaforma e trattare Jev come uno dei possibili provider, non come il fondamento dell'intero sistema.**
