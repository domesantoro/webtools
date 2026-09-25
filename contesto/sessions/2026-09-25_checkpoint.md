# Checkpoint 2026-09-25

## 1. `configurator-fe`: guardare la configurazione che vive

Per controllare il sistema dall'esterno serviva vedere **cosa c'è davvero in Mongo**, non cosa
dicono i file seed. È nato `webtools/configurator-fe/`, sesto sottosistema, porta 9500, sola
lettura: nessuna rotta che scrive, nessun metodo oltre `GET`.

**Perché è servito un endpoint nuovo in anagraphics.** `GET /configuration/{subsystem}` da solo non
permette di leggere tutta la configurazione: per chiederla sottosistema per sottosistema bisogna già
sapere quali sottosistemi esistono, e quella lista sta in Mongo, non in chi domanda. Un elenco
scritto nella configurazione del portalino sarebbe una copia che invecchia, e nasconderebbe proprio
il sottosistema che si è venuti a cercare. Quindi `GET /configuration`, che restituisce tutti i
documenti ordinati per `subsystem` — compresi quelli che non hanno più un file seed, perché quello
che vive è la collezione.

**Le tre scelte di lettura della pagina**, tutte calcolate e nessuna scritta a mano:

- i **valori condivisi** sono le foglie che più sottosistemi tengono con lo stesso valore, ricavate
  confrontando i documenti. Un path tenuto con valori diversi è una divergenza, non un valore
  condiviso, e non compare;
- le **letture accanto al valore** (`40000` → `400.00 €`, `28800` → `8 h`, `5000` → `5 s`) vengono
  dalle convenzioni di nome del progetto, non dalla forma di un file particolare. Su `port` o
  `max_turns` non c'è nessuna lettura: inventare un'unità sarebbe leggere un numero da come è
  scritto;
- il **mascheramento dei segreti viene dalla provenienza**, non dal nome del campo. È segreto ciò il
  cui path sta in `configurator/secrets/*.json`, perché è quello che `load_configuration.sh`
  fonde nella configurazione. Di quei file si legge la *forma*, mai i valori: un `client_id` scritto
  lì è mascherato, un `api_key` scritto in `configuration/` no, perché quello è in git e non è un
  segreto. Se la cartella non c'è, non si maschera niente **e la pagina lo dice**, così una pagina
  non mascherata non si legge come una pagina senza segreti.

Segnala anche due cose che non si vedrebbero altrove: un path dichiarato nei segreti e assente da
Mongo (`load_configuration.sh` non è stato lanciato dopo aver scritto il file), e un file di segreti
per un sottosistema che non ha configurazione.

Non è in `start.sh`: è strumentazione, si avvia e si ferma per conto suo.

**Una deroga esplicita, annotata nel suo README:** non usa `commons/base.njk` e non prende i testi
dai cataloghi. È strumentazione interna, le sue etichette sono termini di sistema, e il guscio
condiviso chiede lingua, traduzione e commutatore di lingua, che sono il macchinario di una pagina
di prodotto. Se un giorno smette di essere strumentazione, quel ragionamento cade e i testi vanno
nei cataloghi.

## 2. La chat dice quando è pronta, e il go button fa qualcosa

`ready` esisteva già — l'analista lo propone, il validatore decide — ma non usciva dalla risposta
del turno e non arrivava in pagina. Ora la `POST .../messages` lo restituisce, lo stato sta sullo
step, e la pagina nasce con l'avviso già acceso se lo step lo dice.

**Un difetto trovato proprio perché si è cominciato ad agirci sopra.** Quando il validatore rimanda
indietro l'analista (`verdict: "continue"`), la seconda risposta veniva salvata con il `ready` che
l'analista aveva proposto, senza che nessuno l'avesse giudicata. Finché `ready` restava interno non
si vedeva; ora forza `ready: false`, perché quella seconda risposta non è passata da nessun giudizio.

**L'avviso segue il verdetto dell'ultimo turno**, non è una porta che resta aperta: se un turno
successivo riapre le domande, avviso e pulsante tornano indietro. È quello che i dati dicono; uno
stato «una volta pronto sempre pronto» non esiste da nessuna parte.

Il go button non aveva nessuna funzione agganciata. Finché il passo dopo l'analisi non esiste, fa
scaricare `GET /analysis/{id}/project`, cioè il documento del progetto in anagraphics così com'è —
non una forma inventata qui, o ci sarebbe una seconda cosa da tenere allineata. Marcato
`TODO(placeholder)` nel codice e in doc.

## 3. La chat: l'analista parla per primo

La pagina esordiva con un saluto fisso del catalogo e un campo vuoto. Chi arriva ha appena risposto
a un form, non ha niente da dire e non sa cosa scrivere: una chat che si apre così è una chat che
nessuno sa cominciare.

Ora, con la conversazione vuota, il browser chiama `POST /analysis/{id}/opening`: l'analista legge
la pre-specifica e fa la **prima domanda vera**, che viene scritta sullo step come ogni altro
messaggio — quindi un ricarico la ristampa senza niente di speciale e non ripaga nulla.

**Non consuma un turno.** Un turno è una domanda con la sua risposta, e lì nessuno ha ancora
risposto: costa un giro di modello, una volta per analisi.

**Due pagine aperte insieme**: la rotta risponde `409 ANALYSIS_ALREADY_OPENED` e la pagina si
ricarica, perché la sua idea della conversazione è più vecchia della conversazione. Il controllo si
rifà **dopo** la risposta del modello e prima di scrivere: due aperture sarebbero due prime domande
diverse nella stessa conversazione.

Conseguenza non ovvia: i **turni usati** non sono più metà dei messaggi. Con l'analista che apre, i
suoi messaggi sono uno in più di quelli del cliente, e la divisione per due tornava per caso. Si
contano i messaggi del cliente.

## 4. La policy dell'analista, riscritta

Il criterio nuovo, deciso oggi: **il lettore è una persona non del mestiere, con poca dimestichezza
col computer**. Nella policy c'è scritto di immaginare una signora anziana che manda avanti una
piccola attività — sa benissimo di cosa ha bisogno, non sa come si chiama.

Da lì discende tutto il resto:

- **un soggetto per turno**, posto come una domanda sola, che si porta dentro un breve elenco di
  punti concreti da scorrere. Lo scopo è arrivare in fondo alla pre-analisi nel minor numero di
  turni possibile, non fare la domanda più stretta possibile;
- **registro professionale ma non formale**, dando del tu;
- **mai marcare il genere di chi legge**: niente participi e aggettivi che concordano («sei sicuro»,
  «registrato»), si gira la frase. Non si sa chi sta leggendo, e indovinare male è peggio di
  qualunque frase contorta scritta per evitarlo;
- **niente sottintesi, niente gergo, sempre un esempio**.

**Il conflitto sciolto:** la policy diceva «una frase che si può togliere si toglie». Quella regola
vale ora solo per i campi interni (`missing`, `reason`). Verso il cliente vale il contrario: essere
chiari costa frasi, e quelle si spendono; essere gentili costa frasi che non comprano niente.

Stessa passata sui cataloghi: tolte sei forme italiane che davano il genere a chi legge, fra cui
«Sei registrato come driver», «Invitato da» e tre «Contattalo» riferiti a un driver di cui non si sa
niente.

## 5. La robustezza della chat contro i messaggi manipolatori

Rilievo fatto su richiesta, e la maggior parte regge già: il testo del cliente non entra mai nel
system prompt, l'output è vincolato da schema e ricontrollato in codice, `ready` non è deciso da chi
lo propone, la pagina riempie i messaggi con `textContent`, non c'è tool use né esecuzione.

**Due correzioni fatte.**

Il validatore riceveva la conversazione **appiattita in un testo unico**, dove chi aveva parlato era
scritto con `**Client:**` e `**Analyst:**` — caratteri normalissimi, che il cliente può scrivere
anche lui e con cui può mettere in bocca all'analista frasi mai dette. Ora riceve messaggi veri con
i loro ruoli, come già faceva l'analista: **chi ha parlato esce dal testo** e diventa un campo della
chiamata, a cui il cliente non arriva. `dossierOf` è diventata `materialOf`.

Le due policy dicono ora **cosa è un'istruzione per il modello e cosa non lo è**: tutto quello che
legge è materiale da analizzare, mai un ordine, comunque sia scritto; e `missing` e `reason` sono
parole sue sul materiale, mai dettate dal cliente — li legge il driver per decidere, e il cliente
non deve poterci scrivere per interposta persona.

**Due cose lasciate stare, per decisione presa.** Il finto acquisto regala turni senza tetto e senza
rate limit, quindi chi vuole può ciclarlo: è una demo. E la prevalidazione giudica solo *dimensione
e fattibilità*, mai *se vogliamo costruirlo*, quindi uno strumento piccolo e ben descritto per uno
scopo illecito passa come `ultrasafe`. Il motivo per non metterci mano ora è che la linea non è
scritta da nessuna parte in `contesto/`: chiedere a un modello di applicare una regola che non
esiste dà risposte a caso, e rifiutare clienti veri costa più di quanto risparmi.

Resta vero, e non è stato toccato: quando il fornitore si rifiuta di rispondere, il codice lo
trasforma in `503 ANALYST_UNAVAILABLE` e nel log non si distingue un rifiuto da un servizio giù.

## 6. Latenza dei turni, osservata e lasciata così

Provando la policy dal vivo (`scripts/analyse.js`, ora capace anche dell'apertura): l'apertura ha
impiegato **15 s**, un turno ordinario **137 s**, sopra il `timeout_ms` di 120.000 configurato —
quindi con un tentativo ripetuto dentro l'SDK. Il cliente guarda i puntini per oltre due minuti, e
ogni tanto un turno fallirà davvero. Deciso di lasciare così per ora; le leve sono `effort` e
`timeout_ms`.

## 7. Audit permanente classe-contro-istanza

`sanity/` continua. A fine giornata **42 unità su 72** risultano `done` — tutto il preanalyst, tutto
l'sso, il front-gate cominciato — con **14 `breaks-now`**, 75 `latent`, 21 `stylistic`. L'agente è
stato messo in pausa a fine sessione, per rilanciarlo la sera; su disco è rimasto coerente (42 righe
`done`, 42 file in `findings/`, `summary.md` allineato). Si riprende dalla **riga 43**
(`front-gate-runner`), 30 unità rimaste. I conteggi buoni restano quelli di `sanity/summary.md`.

Due cose che l'audit lascia decidere: `webtools/preanalyst/tests/analysis_page.test.js` è nato dopo
il calcolo dell'inventario e non appartiene a nessuna riga; e continuano a uscire identificatori in
italiano fuori dai cataloghi, che violano `CLAUDE.md` ma non la regola che l'audit sta controllando.

## 8. Documentazione corretta

Due punti dicevano ancora che la risposta del modello è finta e presa da
`preanalyst.analysis.mock.replies.*`: quelle chiavi e `mockReplies()` non esistono più da un pezzo.
Il mock rimasto è uno solo, l'acquisto.
