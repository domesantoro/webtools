# Specifica del sito vetrina — Webtool

## 1. Scopo del documento

Questo documento definisce la **prima specifica del sito vetrina statico** del progetto.

Il suo scopo è permettere a un altro contesto, designer o developer di capire:

- che tipo di sito va costruito;
- quali pagine deve contenere;
- quali informazioni devono essere comunicate;
- quale tono e quale impostazione visiva adottare;
- quali elementi non devono essere introdotti;
- quali parti restano volutamente aperte o rimandate.

Questa specifica riguarda **solo il sito statico**.

Non deve essere usata per progettare o dettagliare:

- il pre-analysis ecosystem;
- il Driver ecosystem;
- il sistema di sviluppo interno;
- workflow AI o agentici;
- infrastruttura tecnica;
- automazioni interne;
- stack applicativo.

---

# 2. Obiettivo del sito

Il sito deve spiegare in modo immediato e concreto che il progetto realizza **piccoli strumenti digitali su misura per esigenze specifiche**.

Il visitatore non deve arrivare sul sito sapendo già cosa sia un “webtool”.

Il compito del sito è quindi:

1. spiegare chiaramente che cosa viene venduto;
2. mostrare esempi concreti che rendano intuitivo il tipo e la scala dei problemi affrontabili;
3. comunicare chiaramente il prezzo del prodotto standard;
4. spiegare il percorso visibile al cliente;
5. rendere chiaro che il cliente acquista realmente il software e il codice sorgente;
6. fornire un punto di contatto semplice;
7. predisporre, senza approfondirli ora, futuri gateway verso i sottosistemi dinamici.

---

# 3. Principio di base del prodotto

Una formulazione breve approvata è:

> Un webtool è un piccolo strumento fatto per risolvere un problema specifico. Lo apri con un link e lo usi dove vuoi.

Una formulazione leggermente più estesa è:

> Un webtool è un piccolo strumento digitale creato per risolvere una necessità precisa. Si apre con un link, funziona dal browser e puoi usarlo da computer, tablet o telefono, senza installare nulla.

La parola **webtool** è un'etichetta utile, non il cuore del sito.

Se il termine finirà per imporsi naturalmente, bene. Non va però sovraspiegato né trasformato in un concetto da divulgare.

Il sito non è una “Wikipedia dei webtool”.

La maggior parte dei visitatori non sa in partenza di volere un webtool: deve capire il concetto attraverso la descrizione e soprattutto attraverso gli esempi.

---

# 4. Pubblico

Il sito non deve segmentare rigidamente il pubblico.

Può parlare a:

- privati;
- associazioni, circoli e piccoli gruppi;
- professionisti;
- artigiani;
- microattività;
- piccole imprese.

Il criterio unificante non è **chi è il cliente**, ma **che tipo di esigenza ha**.

L'esigenza adatta è:

- concreta;
- specifica;
- circoscritta;
- abbastanza particolare da non essere già risolta bene da un prodotto standard;
- abbastanza piccola da poter essere affrontata con un webtool.

---

# 5. Criteri per gli esempi

Gli esempi hanno un ruolo fondamentale.

Non devono essere presentati come portfolio, casi studio o software già realizzati.

Devono essere dichiaratamente **esempi illustrativi del tipo di problemi affrontabili**.

Un buon esempio deve essere:

- specifico;
- immediatamente comprensibile;
- concreto;
- abbastanza particolare da non coincidere con un'app standard già perfettamente disponibile;
- abbastanza piccolo da essere compatibile con il modello del servizio;
- capace di far intuire per analogia altre possibili esigenze.

Esempi già considerati coerenti:

- archivio della cantina;
- classifica per un torneo;
- archivio di libri, dischi o collezioni;
- registro manutenzione auto o moto;
- preventivatore basato su poche regole specifiche;
- gestione di turni o disponibilità per associazioni e piccoli gruppi;
- piccolo inventario di attrezzi o materiali;
- diario dell'orto;
- classificazione o smistamento di documenti.

Esempi da evitare:

- problemi già risolti molto bene da moltissime app standard, salvo una specificità reale;
- progetti troppo complessi rispetto alla promessa del servizio;
- esempi vaghi del tipo “uno strumento per le tue esigenze”;
- esempi scelti solo perché visivamente spettacolari.

---

# 6. Prezzo e contenuto dell'offerta

Il prodotto standard costa:

# 400 €

Il prezzo deve essere visibile già nella home.

Non va nascosto dietro una richiesta di preventivo o dietro formule come “a partire da”.

## Cosa riceve il cliente

Il cliente acquista **integralmente il software consegnato**.

La consegna comprende:

- software completo;
- codice sorgente completo;
- file ZIP;
- istruzioni per l'installazione.

Il cliente può:

- usare il software;
- modificarlo;
- farlo modificare da altri;
- riutilizzarlo;
- disporne liberamente.

Il cliente **non acquista l'esclusività del codice**.

Il fornitore conserva il diritto di:

- riutilizzare strutture;
- riutilizzare componenti;
- realizzare soluzioni simili per altri clienti;
- utilizzare parti comuni nello stack interno.

## Installazione

L'installazione non è una componente strutturale del pacchetto.

Il cliente riceve le istruzioni per installare il software.

Se il cliente possiede già un VPS e desidera che l'installazione venga eseguita direttamente dal fornitore, questa può essere effettuata gratuitamente come cortesia.

Non va però presentata come elemento fondamentale o garantito dell'offerta standard.

## Costi esterni

Non sono compresi nei 400 €:

- VPS;
- dominio;
- eventuali servizi di terze parti;
- eventuali altri costi infrastrutturali esterni.

## Assistenza ed evoluzione

Non è compresa assistenza continuativa.

Non sono previste evoluzioni, change request o cicli di sviluppo successivi all'interno dello stesso incarico.

Una volta definita e accettata la specifica, il progetto non evolve.

Se dopo il rilascio emerge una **non conformità rispetto alla specifica concordata**, l'adeguamento necessario alla conformità è gratuito.

Nuove idee, nuove funzioni o cambi di requisito non rientrano negli adeguamenti gratuiti.

## Extra

Possono esistere extra, estensioni o servizi ulteriori.

Per ora il sito deve restare volutamente generico su questo punto.

Non creare:

- tabelle di tier;
- listini accessori;
- pacchetti Basic / Pro / Ultimate;
- sistemi commerciali costruiti per spingere verso il piano più costoso.

Il principio generale è che gli extra **non sono necessari per rendere utile il prodotto standard**.

---

# 7. Come funziona

La pagina “Come funziona” deve raccontare **solo il percorso visibile al cliente**.

Non deve spiegare il funzionamento interno del sistema.

Il flusso concettuale è:

1. **Definizione della specifica**
2. **Valutazione**
3. **Accettazione della specifica**
4. **Sviluppo**
5. **Demo**
6. **Accettazione della demo**
7. **Pagamento**
8. **Consegna dello ZIP**

## Definizione della specifica

Il cliente può arrivare alla specifica in due modi:

- utilizzando il futuro pre-analysis ecosystem;
- scaricando un prompt da utilizzare con la propria AI di fiducia.

Il sito statico può citare questa alternativa, ma **non deve approfondire il pre-analysis ecosystem** in questa fase.

Eventuali costi o token legati al pre-analysis **non devono essere citati nel sito statico generale**.

Saranno trattati nel relativo gateway quando verrà progettato.

## Valutazione

La specifica viene valutata.

Non è previsto un ciclo di chiarimenti.

Se la specifica non viene scartata, si chiede al cliente di marcarla esplicitamente come **accettata**.

Solo dopo l'accettazione viene avviato lo sviluppo.

## Sviluppo

Il cliente non segue lo sviluppo passo passo.

Il successivo momento visibile è la demo.

## Demo

La demo non è una fase di revisione iterativa.

Non esiste un ping-pong di sviluppo.

Il cliente può:

- accettare la demo;
- rifiutarla.

Se la rifiuta:

- il processo termina;
- non paga i 400 €;
- non riceve il software.

Se la accetta:

- paga;
- riceve il software;
- riceve il codice sorgente;
- riceve lo ZIP e le istruzioni.

## Conformità dopo il rilascio

Dopo il rilascio, se emerge che il software consegnato non rispetta la specifica accettata, il fornitore interviene gratuitamente per renderlo conforme.

Questo non equivale a un servizio di evoluzione o assistenza continuativa.

---

# 8. Architettura del sito

Il sito deve essere **multipagina**.

Non deve essere una one-page landing.

La home non deve contenere una miniatura di tutte le pagine né funzionare come funnel commerciale.

## Navigazione principale

La navigazione principale approvata è:

- Che cos'è
- Esempi
- Come funziona
- Quanto costa

La Home si raggiunge attraverso il logo o il nome del progetto.

## Navigazione secondaria

In posizione secondaria:

- Contatti
- eventuali future voci istituzionali o legali

“Lavora con noi” sarà presente in futuro in posizione discreta, probabilmente nel footer o in un'area secondaria.

Il relativo Driver ecosystem non va ancora analizzato.

Il gateway “Inizia” verso il pre-analysis ecosystem esiste concettualmente ma **non va specificato in questa fase**.

---

# 9. Home

La home deve essere una **pagina introduttiva e di orientamento**, non una landing commerciale.

Deve permettere di capire rapidamente:

- cosa facciamo;
- che tipo di problemi affrontiamo;
- alcuni esempi;
- il prezzo standard;
- dove approfondire.

Non deve:

- replicare integralmente le pagine interne;
- diventare un funnel;
- usare strutture del tipo “problema → dolore → soluzione”;
- usare domande retoriche commerciali;
- contenere muri di testo;
- assumere una forma troppo editoriale.

La home deve essere sintetica, scandita e funzionale.

Gli esempi presenti in home devono essere pochi e brevi.

La pagina “Esempi” resta il luogo dove il tema viene sviluppato davvero.

Il prezzo di **400 €** deve essere chiaramente visibile già in home.

---

# 10. Pagina “Che cos'è”

La pagina deve spiegare che cosa si intende per webtool.

Ordine concettuale:

1. definizione semplice;
2. spiegazione pratica di come si usa;
3. chiarimento della scala e dei limiti;
4. spiegazione molto secondaria del termine “webtool”.

La spiegazione del nome deve rimanere in secondo o terzo piano.

Non va appesantita.

## Limiti

La pagina deve chiarire che un webtool:

- non è un gestionale completo;
- non è una piattaforma complessa;
- non è un progetto software da mesi;
- è uno strumento circoscritto;
- serve a fare bene una cosa precisa.

Il messaggio deve far capire che:

> piccolo non significa giocattolo

e contemporaneamente:

> su misura non significa qualsiasi cosa

---

# 11. Pagina “Esempi”

La pagina Esempi è centrale.

Deve usare una **griglia sobria**.

Indicativamente:

- circa 8–12 esempi;
- leggibili a colpo d'occhio;
- abbastanza descritti da far capire il problema e il possibile strumento;
- dichiarati esplicitamente come esempi illustrativi;
- non presentati come lavori realizzati.

Non creare categorie artificiali per target o settore.

Gli esempi possono mescolare:

- privati;
- hobby;
- associazioni;
- artigiani;
- professionisti;
- piccole attività.

Il filo comune è la scala del problema.

## Look & feel della pagina Esempi

Evitare una pagina arlecchinata.

Tutti gli esempi devono condividere:

- stessa logica grafica;
- stessa famiglia visuale;
- palette controllata;
- stessa impostazione dei mockup o delle immagini.

Evitare:

- un colore tematico diverso per ogni esempio;
- illustrazioni eterogenee;
- estetica da portfolio creativo;
- effetto catalogo pubblicitario.

---

# 12. Pagina “Quanto costa”

La pagina deve essere semplice e trasparente.

Informazioni principali:

- prezzo standard: 400 €;
- software completo;
- codice sorgente completo;
- nessun abbonamento;
- nessun canone;
- nessun lock-in;
- costi esterni esclusi;
- istruzioni di installazione;
- eventuale installazione gratuita su VPS già disponibile, senza presentarla come componente strutturale del pacchetto;
- nessuna assistenza continuativa;
- nessuna evoluzione del progetto;
- conformità alla specifica garantita dopo il rilascio.

Gli extra devono essere citati solo in modo generico.

Niente tabella di tier.

---

# 13. FAQ

Prevedere una FAQ corta e utile.

Non deve essere una pagina autonoma salvo necessità successive.

Può vivere, ad esempio, nella pagina “Quanto costa”.

Le FAQ devono rispondere solo a dubbi reali.

Temi plausibili:

- il software è davvero mio?
- ricevo anche il codice sorgente?
- ci sono canoni?
- devo avere già un VPS?
- installate voi il software?
- fate assistenza dopo la consegna?
- cosa succede se il software non rispetta la specifica?
- posso chiedere modifiche dopo?
- posso chiedere qualunque tipo di software?

Non inventare domande per riempire spazio.

---

# 14. Contatti

La pagina Contatti deve essere estremamente semplice.

Niente form.

Niente:

- calendari;
- prenotazione call;
- chatbot;
- funnel;
- moduli lunghi.

Contenuto:

- email;
- eventuali informazioni operative essenziali;
- dati istituzionali necessari.

“Contatti” è distinto dal futuro gateway “Inizia”.

---

# 15. Parte legale

Il sito deve prevedere una struttura legale minima e corretta, senza appesantire l'esperienza utente.

La specifica definitiva della parte legale dipenderà da:

- soggetto giuridico effettivo;
- modalità di vendita;
- strumenti di pagamento;
- eventuali cookie;
- eventuali servizi analytics;
- eventuali dati raccolti;
- eventuali servizi terzi;
- modalità effettive di trattamento dei dati.

In fase di implementazione andranno quindi previsti, ove necessari:

- Privacy Policy;
- Cookie Policy;
- eventuale banner o gestione consenso cookie, solo se realmente necessario;
- termini e condizioni di vendita/servizio;
- dati identificativi e fiscali obbligatori;
- eventuali informazioni su diritto di recesso, condizioni di fornitura o altri obblighi applicabili;
- riferimenti legali nel footer.

Questa sezione non deve essere trasformata in contenuto commerciale.

Le pagine legali devono restare separate dalla navigazione principale e accessibili dal footer.

Non inserire testi legali generici o copiati senza una verifica successiva rispetto alla reale configurazione commerciale e tecnica del servizio.

---

# 16. Tono di voce

Regola fondamentale:

> Il sito deve informare, non vendere aggressivamente.

Evitare:

- tono da venditore porta a porta;
- schema “problema / dolore / soluzione”;
- domande retoriche costruite per generare bisogno;
- lead generation aggressiva;
- slogan da startup;
- retorica da innovazione;
- “trasformazione digitale”;
- entusiasmo artificiale;
- tono da agenzia;
- promesse generiche sull'AI;
- autocelebrazione;
- testimonial inventati;
- portfolio finto.

Il visitatore deve poter capire autonomamente se il servizio gli serve.

La credibilità deve derivare soprattutto da:

- prezzo chiaro;
- processo chiaro;
- proprietà del software;
- sorgenti completi;
- assenza di abbonamenti;
- assenza di lock-in;
- chiarezza sui limiti;
- conformità alla specifica.

La fiducia deve nascere dalla **trasparenza dell'offerta**, non dalla posa.

---

# 17. Direzione visiva

Il sito deve comunicare chiaramente tecnologia.

Il look deve essere:

- tool-like;
- contemporaneo;
- sobrio;
- funzionale;
- leggibile;
- coerente con il mondo degli strumenti software.

Può utilizzare:

- griglie;
- pannelli;
- cornici;
- micro-label;
- piccoli elementi da interfaccia;
- mockup;
- dettagli visivi che ricordano strumenti reali.

Evitare:

- estetica lifestyle;
- estetica da diario/blog;
- corporate patinato;
- cliché da AI startup;
- cyberpunk decorativo;
- bianco/nero sterile come unica idea visiva;
- palette calde da magazine;
- dashboard finte piene di controlli senza funzione;
- elementi visivi che sembrano interattivi ma non lo sono;
- minimalismo esasperato con enormi spazi vuoti;
- pagina arlecchinata.

Le scelte di dettaglio relative a:

- palette definitiva;
- font;
- spacing;
- componenti;
- densità;
- micro-interazioni;

restano decisioni di design e non devono essere definite prematuramente nella specifica funzionale.

---

# 18. Modello generale del sito

Il sito deve comportarsi come un **sito multipagina tradizionale ben progettato**, non come una landing page espansa.

La home introduce e orienta.

Le pagine interne hanno dignità propria e contengono l'approfondimento reale.

Non creare pagine secondarie solo per fingere una struttura multipagina.

Non comprimere tutto nella home.

Non duplicare gli stessi contenuti su tutte le pagine.

---

# 19. Fuori scope per questa fase

Non progettare ora:

- pre-analysis ecosystem;
- Driver ecosystem;
- gateway funzionali;
- autenticazione;
- pagamenti;
- area cliente;
- area Driver;
- dashboard;
- workflow interni;
- AI;
- agenti;
- modelli;
- prompt interni;
- infrastruttura;
- stack tecnico;
- deploy;
- gestione automatica dei progetti;
- supporto post-vendita;
- sistemi di ticketing;
- CRM;
- analytics avanzati.

---

# 20. Nome e identità

Il nome definitivo del progetto non è ancora stato scelto.

Esiste una sola direzione concettuale iniziale:

> possibile richiamo, anche molto indiretto, alla locuzione inglese “Faster than a bullet”.

Il riferimento non deve necessariamente essere letterale.

Non sono ancora decisi:

- lingua del nome;
- lunghezza;
- forma;
- eventuale payoff;
- logo;
- identità definitiva.

Non bloccare il lavoro sul sito in attesa del naming.

Il naming richiederà una sessione separata.

---

# 21. Decisioni già chiuse

Considerare chiuse e non riaprire senza motivo le seguenti decisioni:

- sito multipagina;
- niente one-page landing;
- niente “Chi siamo”;
- navigazione principale: Che cos'è / Esempi / Come funziona / Quanto costa;
- Home raggiungibile dal logo/nome;
- Contatti secondario;
- FAQ corta e utile;
- prezzo standard 400 € visibile già in home;
- software e sorgenti integralmente del cliente;
- nessun canone;
- niente assistenza continuativa;
- niente evoluzione del progetto;
- demo senza ping-pong;
- pagamento dopo accettazione della demo;
- consegna ZIP dopo pagamento;
- correzioni gratuite solo per non conformità alla specifica dopo il rilascio;
- esempi illustrativi, non portfolio;
- pubblico non segmentato rigidamente;
- credibilità basata su trasparenza;
- look tecnologico, tool-like e sobrio;
- gateway futuri da ignorare per ora;
- nessuna citazione dei costi/token del pre-analysis nel sito statico generale.

---

# 22. Questioni ancora aperte

Restano aperte soltanto questioni che non impediscono di considerare definita l'architettura del sito:

1. nome definitivo del progetto;
2. identità visiva definitiva;
3. selezione finale degli 8–12 esempi;
4. copy definitivo delle pagine;
5. dettagli legali effettivi in base alla forma giuridica e tecnica reale;
6. progettazione futura dei gateway “Inizia” e “Lavora con noi”.

---

# 23. Regola per il prossimo contesto

Il prossimo contesto non deve ricominciare l'analisi da zero.

Deve usare questo documento come base e:

1. rispettare le decisioni già chiuse;
2. non analizzare il sistema generale;
3. non entrare nei gateway ancora fuori scope;
4. non proporre nuove feature senza necessità;
5. non trasformare il sito in una landing page;
6. non entrare in micro-design prematuramente;
7. lavorare solo sui punti ancora realmente aperti o sulla fase successiva richiesta.

