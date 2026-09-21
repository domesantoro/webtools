# CONTEXT — Progettazione del sito vetrina

## Scopo di questo documento

Questo file serve come **contesto iniziale per una nuova chat** dedicata esclusivamente alla progettazione del **sito vetrina pubblico** del progetto.

La nuova chat NON deve partire scrivendo codice.

Il primo obiettivo è usare il sito come **primo esperimento concreto del metodo di analisi** che verrà poi incorporato nel sistema generale:

- partire da un'idea ancora parzialmente informale;
- raccogliere requisiti;
- individuare ambiguità e decisioni ancora aperte;
- definire il perimetro;
- costruire una specifica sufficientemente chiara;
- soltanto dopo passare all'implementazione.

La chat deve quindi comportarsi inizialmente come un **analista di prodotto, UX e contenuti**, non come un generatore automatico di HTML.

---

# 1. Contesto generale del progetto

Il progetto complessivo mira a costruire una piccola infrastruttura capace di produrre **soluzioni software su misura per esigenze molto circoscritte**, con una forte automazione interna.

Il principio di fondo è:

> problemi piccoli → soluzioni piccole

Non si vuole costruire:

- una web agency generalista;
- una software house tradizionale;
- un catalogo di prodotti standard;
- un SaaS unico da adattare a tutti;
- una struttura orientata a progetti lunghi e aperti.

L'idea è accettare richieste del tipo:

- una piccola applicazione web per tracciare il peso;
- una classifica per un torneo di freccette;
- un piccolo archivio della cantina;
- un registro manutenzione auto/moto;
- un semplice preventivatore;
- un archivio di libri, dischi o collezioni;
- un piccolo sistema di disponibilità per un gruppo;
- un inventario di attrezzi;
- un diario dell'orto;
- un piccolo strumento che classifichi o trasformi documenti;
- altre applicazioni equivalenti per scala e complessità.

Questi NON sono prodotti già esistenti né casi studio da rivendicare.

Sono esempi utili a spiegare **la scala dei problemi che il sistema vuole risolvere**.

La soluzione sarà prevalentemente costituita da **piccole applicazioni web**, ma questo dettaglio tecnico non deve diventare il messaggio principale del sito.

Il cliente deve capire soprattutto:

> “Ho una piccola esigenza concreta che nessun software standard risolve bene. Posso chiedere una piccola applicazione fatta apposta per quella cosa.”

---

# 2. Posizionamento

Il progetto vuole occupare lo spazio compreso fra:

1. soluzione manuale, foglio Excel, note o procedura improvvisata;
2. software standard troppo grande o poco adatto;
3. sviluppo software tradizionale sproporzionato rispetto alla dimensione del problema.

Il valore non è:

> “facciamo software sofisticato”

Il valore è:

> “costruiamo una soluzione proporzionata al problema”

La comunicazione deve quindi evitare:

- retorica da startup;
- “trasformazione digitale”;
- slogan motivazionali;
- linguaggio da consulenza enterprise;
- promesse generiche sull'AI;
- frasi da agenzia come “portiamo il tuo business al livello successivo”;
- entusiasmo artificiale;
- tono da venditore aggressivo.

Il tono desiderato è:

- sobrio;
- concreto;
- intelligente;
- leggermente editoriale;
- tecnico solo quando serve;
- comprensibile anche a chi non è uno sviluppatore.

---

# 3. Il sito è la vetrina, non la fabbrica

Questo punto è fondamentale.

Il sito pubblico deve spiegare:

- cosa facciamo;
- per quali problemi è pensato il servizio;
- quali problemi NON sono adatti;
- come interagiscono cliente e servizio;
- cosa succede dal punto di vista del cliente;
- come iniziare.

Il sito NON deve spiegare il funzionamento interno della macchina.

NON vanno pubblicizzati o descritti in dettaglio:

- crew di agenti;
- orchestratori;
- modelli AI;
- prompt;
- workflow agentici interni;
- tecniche di sviluppo;
- pipeline di test interne;
- routing fra modelli;
- automazione interna;
- strumenti utilizzati per comprimere i tempi di produzione.

La tecnologia è un mezzo interno.

Dal punto di vista pubblico interessa il risultato.

---

# 4. Voce del sito

La voce del brand deve usare prevalentemente il **“noi”**.

Esempi:

- “Analizziamo insieme il problema.”
- “Prepariamo una demo.”
- “Ti diciamo subito se la richiesta è troppo grande per questo formato.”
- “Installiamo la soluzione nell'ambiente definitivo.”

Il rapporto con il cliente può essere diretto e personale, ma NON bisogna trasformare ogni pagina in una conversazione in prima persona singolare.

Evitare quindi una presenza eccessiva di:

- “io faccio”;
- “scrivimi”;
- “ti preparo”;
- “io valuto”.

Meglio:

- “facciamo”;
- “valutiamo”;
- “contattaci”;
- “raccontaci il problema”.

La realtà organizzativa dietro il servizio può essere piccola, ma il sito non deve continuamente sottolinearlo.

---

# 5. Nome e identità

Il nome definitivo del progetto NON è stato ancora fissato.

IMPORTANTE:

**NON chiamare il progetto “Piccolo Software”.**

Quello era soltanto un placeholder introdotto durante una precedente bozza del sito e non deve essere riutilizzato come nome.

Anche il logo e l'identità definitiva non sono ancora stabiliti.

Esiste una direzione grafica preliminare orientata verso:

- grafica minimale;
- forte contrasto;
- nero e bianco;
- possibile uso di verde scuro;
- segni semplici;
- mood industriale/editoriale;
- niente iconografia da “AI startup”;
- niente collage visivi pieni di oggetti;
- niente estetica da brochure commerciale.

Non bisogna però bloccare la progettazione del sito su un logo ancora provvisorio.

La struttura del sito deve funzionare indipendentemente dal marchio definitivo.

---

# 6. Cosa vede il cliente

Dal punto di vista pubblico, il percorso è sostanzialmente questo:

1. il cliente scopre il sito;
2. capisce rapidamente che tipo di problemi vengono accettati;
3. vede esempi della scala delle applicazioni;
4. decide di provare;
5. descrive la propria esigenza;
6. viene aiutato a chiarirla;
7. riceve una definizione sufficientemente precisa di ciò che potrebbe essere realizzato;
8. se la richiesta è adatta, il progetto può proseguire;
9. viene realizzata una demo;
10. il cliente prova la demo;
11. se la accetta, si procede verso consegna / installazione.

Questa è una descrizione concettuale.

La nuova chat deve aiutare a decidere **quanto di questo percorso debba essere visibile nel sito statico** e quanto invece appartenga ai sottosistemi dinamici successivi.

---

# 7. Boundary della parte statica

La chat deve concentrarsi inizialmente soltanto sul **sito statico**.

Il sito deve preparare l'ingresso ai sottosistemi successivi, ma NON deve ancora implementarli.

Il sistema generale prevede in futuro componenti separati per:

- pre-analysis;
- raffinamento della richiesta;
- analysis ecosystem;
- validazione;
- sviluppo;
- test;
- demo;
- pagamento;
- deploy.

Per ora il sito statico deve soltanto:

- presentare il servizio;
- orientare l'utente;
- qualificare informalmente le richieste;
- fornire esempi;
- spiegare i confini;
- portare verso uno o più punti di ingresso.

La nuova chat dovrà quindi identificare quali elementi richiedono soltanto contenuto e struttura statica e quali saranno invece **placeholder o entry point verso sistemi futuri**.

---

# 8. Il sito precedente

È già stata prodotta una bozza multipagina del sito.

Non va considerata una specifica definitiva.

Le parti apprezzate:

- impostazione grafica pulita;
- struttura multipagina;
- leggibilità;
- estetica minimal/editoriale;
- navigazione semplice;
- uso di card;
- esempi visivi della scala delle applicazioni.

Le parti da correggere o evitare:

- eccessiva spiegazione del processo interno;
- descrizione di AI, agenti o automazioni interne;
- uso troppo frequente dell'“io”;
- categorie astratte del tipo “Automazioni / Utility / AI applicata” senza esempi immediati;
- tono talvolta troppo da offerta commerciale;
- nome placeholder “Piccolo Software”.

Una correzione già decisa è:

> nella sezione che spiega cosa facciamo, gli esempi concreti di piccole applicazioni devono essere immediatamente visibili e non nascosti in una pagina secondaria.

L'utente deve quindi incontrare molto presto card del tipo:

- tracker del peso;
- classifica torneo di freccette;
- piccolo archivio della cantina;
- preventivatore semplice;
- inventario attrezzi;
- archivio libri/dischi/collezioni;
- disponibilità di un piccolo gruppo;
- registro manutenzione auto/moto;
- diario dell'orto;
- classificazione o smistamento di documenti.

Le card devono essere presentate chiaramente come:

> esempi del tipo e della scala di applicazione

e NON come lavori realmente realizzati.

---

# 9. Cosa il sito deve far capire entro pochi secondi

Un visitatore deve capire rapidamente almeno queste quattro cose.

## A. Che cosa offriamo

Piccole applicazioni software su misura.

## B. Per chi / per cosa

Per problemi concreti e limitati che non giustificano un progetto software tradizionale.

## C. Quanto piccolo significa “piccolo”

Gli esempi devono rendere intuitiva la scala.

## D. Come iniziare

Deve esserci una call to action chiara per raccontare il problema o provare il percorso iniziale.

La nuova chat deve verificare se queste quattro informazioni sono sufficienti oppure se manca qualche elemento essenziale.

---

# 10. Cosa NON deve far pensare il sito

Il sito non deve creare l'aspettativa che vengano realizzati:

- gestionali completi;
- ERP;
- grandi e-commerce;
- social network;
- marketplace;
- piattaforme multi-tenant complesse;
- applicazioni enterprise;
- sistemi mission critical;
- progetti che richiedono mesi di lavoro;
- consulenza continuativa;
- supporto permanente.

Va trovato un modo elegante per comunicarlo senza costruire una pagina piena di divieti.

---

# 11. Relazione cliente-servizio da rappresentare

Quello che interessa raccontare è soltanto il rapporto visibile.

## Prima

Il cliente ha un problema.

## Analisi

Lo aiutiamo a definire cosa dovrebbe fare la soluzione.

## Accordo sul risultato

Cliente e servizio condividono una descrizione chiara di ciò che deve essere realizzato.

## Demo

Il cliente prova il risultato.

## Accettazione

Se corrisponde a quanto concordato, si procede.

## Installazione

La soluzione viene portata nell'ambiente definitivo.

Il sito NON deve spiegare come il lavoro viene prodotto internamente.

---

# 12. Principi di UX

Il sito dovrebbe rispettare questi principi:

- pochissimo attrito;
- nessuna terminologia tecnica necessaria;
- esempi prima delle spiegazioni astratte;
- contenuti facili da scansionare;
- pagine non inutilmente lunghe;
- gerarchia visuale netta;
- CTA poche ma chiare;
- niente popup aggressivi;
- niente funnel da marketing;
- niente countdown;
- niente “prenota una call strategica”;
- niente chatbot piazzato ovunque.

Il progetto vuole trasmettere:

> semplicità, proporzione, controllo.

---

# 13. Possibili sezioni / pagine

Questo elenco NON è definitivo.

Va analizzato e migliorato.

## Home

Deve spiegare immediatamente:

- promessa;
- scala;
- esempi;
- ingresso al percorso.

## Cosa facciamo

Probabilmente la pagina o sezione più importante dopo la home.

Dovrebbe spiegare in modo molto visuale e concreto che realizziamo piccole applicazioni.

Gli esempi devono essere centrali.

## Come funziona

Solo processo percepito dal cliente.

Niente dietro le quinte.

## Esempi

Può avere senso come approfondimento, ma gli esempi principali devono già apparire prima.

## Cosa non è adatto

Potrebbe essere una sezione, non necessariamente una pagina autonoma.

## FAQ

Per eliminare dubbi frequenti prima del contatto.

## Contatti / Inizia

Punto di ingresso verso il futuro sottosistema di pre-analysis.

## Lavora con noi

Esiste nel progetto generale anche un futuro percorso dedicato ai **Driver**, cioè developer esterni che useranno la piattaforma.

NON è però il focus del primo sito vetrina cliente-facing.

La nuova chat deve decidere se:

- ignorarlo completamente nella prima versione;
- prevedere soltanto un link discreto;
- predisporre una pagina placeholder separata.

Non va confuso con il percorso dei clienti.

---

# 14. Il concetto di Driver

Nel sistema complessivo esisteranno in futuro dei **Driver**.

Un Driver è un developer che può utilizzare la piattaforma per:

- lavorare su clienti procurati autonomamente;
- oppure prendere progetti disponibili in un pool pubblico.

La piattaforma gli mette a disposizione l'infrastruttura di analisi, sviluppo, verifica, demo e gestione del progetto.

Questo NON deve ancora condizionare pesantemente il sito cliente-facing.

Serve però evitare di progettare una struttura informativa che renda impossibile aggiungere in futuro una sezione “Lavora con noi” o equivalente.

---

# 15. Vincoli tecnici per questa fase

Non scegliere ancora framework, librerie o infrastrutture applicative.

La scelta architetturale generale del progetto è:

> JavaScript/Node come spina dorsale della piattaforma, Python solo nei sottosistemi AI/agentici dove realmente utile, PostgreSQL come stato centrale condiviso.

Ma per il sito statico questa informazione NON deve diventare prematuramente una decisione del tipo:

- Next.js;
- Astro;
- React;
- CMS X;
- framework Y.

Prima va definita la specifica.

La chat deve distinguere:

1. requisiti;
2. struttura informativa;
3. contenuti;
4. UX;
5. soltanto dopo tecnologia.

---

# 16. Prima attività richiesta alla nuova chat

NON generare subito il sito.

La prima attività deve essere una **sessione di analisi delle specifiche**.

La chat deve:

## 1. Leggere questo contesto

Senza ricostruire da zero tutta la storia del progetto.

## 2. Evidenziare cosa è già deciso

Separandolo chiaramente da ciò che è ancora aperto.

## 3. Individuare le decisioni mancanti

Per esempio:

- pubblico principale;
- struttura della home;
- gerarchia dei messaggi;
- CTA;
- numero di pagine;
- eventuale presenza di prezzi pubblici;
- presenza o assenza di pagina “chi siamo”;
- forma del contatto iniziale;
- ruolo della sezione esempi;
- posizione futura del percorso Driver;
- quantità di testo;
- livello di dettaglio del processo;
- presenza di FAQ;
- eventuali segnali di fiducia da mostrare.

## 4. Fare domande mirate

Non una raffica di trenta domande.

Procedere per blocchi logici.

Ogni blocco di domande deve servire a chiudere una parte concreta della specifica.

## 5. Formalizzare progressivamente la specifica

La specifica del sito deve emergere come risultato della conversazione, non essere inventata in anticipo.

---

# 17. Output desiderato della fase di analisi

Prima di scrivere codice, la nuova chat dovrebbe arrivare a produrre almeno i seguenti artefatti concettuali.

## A. Obiettivo del sito

Una descrizione breve e precisa di cosa deve ottenere il sito.

## B. Audience

Una definizione sufficientemente chiara dei visitatori principali.

## C. Value proposition

Una formulazione chiara, concreta e non pubblicitaria.

## D. Message hierarchy

Ordine dei messaggi da comunicare:

1. cosa facciamo;
2. a chi serve;
3. che scala hanno i progetti;
4. come funziona;
5. cosa fare per iniziare.

L'ordine va validato, non assunto come definitivo.

## E. Information architecture

Elenco delle pagine e delle sezioni con relativo scopo.

## F. Home page outline

Struttura della home, blocco per blocco.

Per ogni blocco:

- obiettivo;
- contenuto;
- priorità;
- CTA eventuale;
- rapporto con le altre sezioni.

## G. Contenuti essenziali

Elenco dei testi che dovranno esistere:

- headline;
- sottotitolo;
- descrizioni;
- esempi;
- spiegazione del processo;
- FAQ;
- CTA;
- eventuali note sui limiti del servizio.

## H. Requisiti UX

Indicazioni chiare su:

- navigazione;
- densità;
- lunghezza delle pagine;
- priorità mobile/desktop;
- uso di card;
- ripetizione delle CTA;
- accessibilità basilare;
- comportamento dei link verso i sottosistemi futuri.

## I. Out of scope

Elenco esplicito di ciò che NON appartiene alla prima versione statica.

## L. Open questions residue

Domande rimaste aperte, se ce ne sono.

---

# 18. Metodo di lavoro richiesto alla nuova chat

La nuova chat deve essere collaborativa ma disciplinata.

NON deve:

- proporre subito una soluzione completa;
- riempire i vuoti inventando preferenze;
- scegliere tecnologie senza richiesta;
- produrre codice mentre la specifica è ancora instabile;
- trasformare ogni dubbio in una nuova feature;
- aggiungere pagine solo perché “di solito i siti le hanno”.

Deve invece:

- distinguere fatti, decisioni e ipotesi;
- proporre alternative quando una scelta è realmente aperta;
- chiedere una decisione quando serve;
- registrare le decisioni prese;
- evitare di riaprire continuamente decisioni già chiuse;
- mantenere il focus sulla prima versione del sito statico.

---

# 19. Questo sito come primo esperimento del sistema

Questo aspetto è importante.

La progettazione del sito non serve soltanto a ottenere un sito.

Serve anche a osservare come dovrebbe funzionare in futuro il **processo di analisi assistita** della piattaforma.

Durante il lavoro, la nuova chat dovrebbe quindi fare attenzione anche a:

- quali informazioni iniziali erano sufficienti;
- quali informazioni mancavano;
- quali domande hanno realmente ridotto l'ambiguità;
- quali domande erano inutili;
- in che momento lo scope è diventato sufficientemente chiaro;
- quali decisioni potevano essere inferite in sicurezza;
- quali richiedevano necessariamente intervento umano;
- quali output intermedi sono stati utili;
- quali parti del processo potrebbero in futuro essere automatizzate.

Questo NON significa interrompere continuamente il lavoro per fare meta-analisi.

L'obiettivo principale resta il sito.

Ma il percorso va trattato anche come **prototipo del futuro Analysis Ecosystem**.

---

# 20. Criterio di completezza della specifica

La specifica può considerarsi sufficientemente matura quando una nuova chat o un developer, leggendo soltanto il documento finale, può capire:

- quale sito va costruito;
- per chi;
- con quale messaggio;
- quali pagine servono;
- quali contenuti devono esserci;
- cosa deve succedere quando l'utente clicca le CTA;
- quali elementi sono puramente statici;
- quali elementi preparano sottosistemi futuri;
- quali cose NON devono essere implementate;
- quali decisioni visuali restano libere.

Non è necessario definire ogni pixel.

È necessario eliminare le ambiguità che cambierebbero sostanzialmente il prodotto.

---

# 21. Istruzione iniziale per la nuova chat

Dopo aver letto questo documento, procedi così:

1. **Non scrivere codice.**
2. Riassumi in uno specchietto molto compatto:
   - ciò che consideri già deciso;
   - ciò che consideri ancora da decidere.
3. Inizia la sessione di analisi dal **primo blocco di decisioni realmente necessario**.
4. Fammi poche domande alla volta.
5. Dopo ogni blocco, registra sinteticamente le decisioni prese.
6. Costruisci progressivamente una specifica del sito statico.
7. Non entrare nello stack tecnico finché la specifica non è sufficientemente stabile.
8. Non trasformare il sito in una spiegazione dell'infrastruttura interna.
9. Non inventare portfolio, clienti, testimonianze o casi studio.
10. Non usare “Piccolo Software” come nome del progetto.

L'obiettivo finale della conversazione è produrre una **specifica chiara del sito vetrina statico**, pronta per essere passata alla fase di design e implementazione.
