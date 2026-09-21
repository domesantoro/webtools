// Le domande della pre-analisi, come dati.
//
// Questo file è fatto per essere **riscritto spesso**: è la bozza da cui partire
// per capire quali domande servono davvero. Aggiungere, togliere o riordinare una
// domanda si fa qui; page.js le disegna senza sapere che cosa chiedono.
//
// Regole che le domande seguono:
// - parole di tutti i giorni, mai gergo tecnico: chi risponde non è del mestiere;
// - tono asciutto: si dice che cosa scrivere e a che cosa serve, punto. Niente
//   frasi motivazionali, niente complimenti al cliente, niente pubblicità del
//   nostro metodo. Se una frase si può togliere senza perdere informazione,
//   va tolta;
// - poche risposte già pronte invece di campi liberi, perché sono più facili da
//   dare e molto più facili da leggere per il prevalidator;
// - obbligatorio solo ciò senza cui non si può fare niente.
//
// Tipi: "textarea" | "text" | "email" | "radio" | "checkbox"

export const SECTIONS = [
  {
    id: "problema",
    legend: "Il problema",
    hint: "La parte che conta davvero. Il resto sono dettagli che ci aiutano a capirla meglio.",
    fields: [
      {
        name: "need",
        kind: "textarea",
        label: "Che cosa ti serve?",
        hint: "Raccontalo con parole tue, come lo diresti a un amico. Non serve essere precisi.",
        placeholder:
          "Esempio: gestisco un piccolo magazzino di ricambi e tengo tutto su un quaderno. Vorrei sapere in ogni momento che cosa ho, che cosa sta finendo e dove l'ho messo.",
        required: true,
        rows: 6,
      },
      {
        name: "today",
        kind: "radio",
        label: "Come fai adesso?",
        options: [
          ["excel", "Con un foglio Excel o Google Sheets"],
          ["carta", "Su carta: quaderno, agenda, foglietti"],
          ["messaggi", "A messaggi, mail, WhatsApp"],
          ["programma", "Con un programma che non mi va bene"],
          ["niente", "Non lo faccio ancora: vorrei cominciare"],
        ],
      },
      {
        name: "pain",
        kind: "textarea",
        label: "Che cosa ti fa perdere più tempo, o ti fa sbagliare?",
        hint: "Se c'è un momento della settimana in cui dici «che rottura», è quello che ci interessa.",
        rows: 3,
      },
    ],
  },
  {
    id: "uso",
    legend: "Chi lo usa e dove",
    fields: [
      {
        name: "users",
        kind: "radio",
        label: "Chi lo userà?",
        options: [
          ["solo_io", "Solo io"],
          ["pochi", "Io e poche altre persone (2–5)"],
          ["gruppo", "Un gruppo più grande"],
          ["esterni", "Anche persone di fuori: clienti, soci, pubblico"],
        ],
      },
      {
        name: "devices",
        kind: "checkbox",
        label: "Da dove lo userete?",
        hint: "Più di una risposta, se serve.",
        options: [
          ["computer", "Computer"],
          ["telefono", "Telefono"],
          ["tablet", "Tablet"],
        ],
      },
    ],
  },
  {
    id: "skill",
    legend: "Che cosa deve saper fare",
    hint:
      "Non sono funzioni del tuo strumento, ma capacità che potrebbe dovergli servire. " +
      "Segna solo quelle di cui sei sicuro: il resto si vede dopo.",
    fields: [
      {
        name: "skills",
        kind: "checkbox",
        columns: 2,
        label: "Allo strumento servirà:",
        options: [
          ["allegati", "Tenere foto e documenti allegati"],
          ["immagini", "Ritagliare, rimpicciolire o marchiare le immagini"],
          ["ocr", "Leggere il testo dentro foto e scansioni"],
          ["codici", "Leggere o creare codici a barre e QR"],
          ["pdf", "Creare PDF: schede, report, ricevute"],
          ["word", "Riempire modelli Word già pronti"],
          ["fatture", "Creare fatture o ricevute"],
          ["import", "Leggere file Excel o CSV già esistenti"],
          ["export", "Esportare in Excel o CSV"],
          ["grafici", "Disegnare grafici e statistiche"],
          ["ricerca", "Cercare liberamente dentro tutti i dati"],
          ["date", "Fare i conti sulle date: scadenze, giorni lavorativi, turni"],
          ["validazioni", "Controllare codici fiscali, partite IVA, IBAN"],
          ["email", "Mandare email"],
          ["promemoria", "Avvisare da solo quando scade qualcosa"],
          ["calendario", "Gestire un calendario o delle prenotazioni"],
          ["mappe", "Mostrare mappe, indirizzi e distanze"],
          ["firma", "Raccogliere una firma fatta sullo schermo"],
          ["login", "Dare a ognuno la sua password, e decidere chi vede che cosa"],
          ["storico", "Tenere lo storico di chi ha cambiato cosa"],
        ],
      },
      {
        name: "skills_other",
        kind: "textarea",
        label: "Altro",
        hint:
          "Serve qualcosa che non è nell'elenco? Scrivilo in una riga, secco. " +
          "Ma scrivi solo se hai le idee chiare: se sei nel dubbio lascia in bianco, " +
          "è una cosa di cui parliamo meglio dopo. " +
          "Qui vanno anche le cose che si appoggiano a un servizio esterno da " +
          "configurare — pagamenti, WhatsApp, Google — che si possono fare, ma " +
          "vanno viste caso per caso.",
        placeholder: "Esempio: leggere la temperatura da un sensore in cella frigorifera",
        rows: 2,
      },
    ],
  },
  {
    id: "confini",
    legend: "Che cosa NON deve fare",
    hint: "Anche i confini aiutano: dire «i pagamenti li gestisco altrove» ci risparmia un giro.",
    fields: [
      {
        name: "out_of_scope",
        kind: "textarea",
        label: "C'è qualcosa che vuoi tenere fuori?",
        hint:
          "Cose che continuerai a fare altrove, parti che non ti interessano, " +
          "o che hai già visto andare male in un altro progetto.",
        placeholder:
          "Esempio: i pagamenti li gestisco con il commercialista, non devono entrarci. " +
          "E non voglio che i clienti possano vedere i prezzi di acquisto.",
        rows: 4,
      },
    ],
  },
  {
    id: "dati",
    legend: "I dati",
    fields: [
      {
        name: "volume",
        kind: "radio",
        label: "Quante voci, all'incirca?",
        options: [
          ["decine", "Qualche decina"],
          ["centinaia", "Qualche centinaio"],
          ["migliaia", "Migliaia"],
          ["non_so", "Non saprei"],
        ],
      },
      {
        name: "personal_data",
        kind: "radio",
        label: "Ci finiranno dati di altre persone (nomi, contatti, dati di salute)?",
        hint: "Non è un problema: cambia solo come li teniamo.",
        options: [
          ["no", "No"],
          ["contatti", "Sì: nomi e contatti"],
          ["delicati", "Sì, e qualcuno è delicato (salute, minori, denaro)"],
          ["non_so", "Non saprei"],
        ],
      },
      {
        name: "existing_data",
        kind: "radio",
        label: "Hai già dei dati da portare dentro?",
        options: [
          ["no", "No, si parte da zero"],
          ["file", "Sì, in un file (Excel, CSV)"],
          ["carta", "Sì, ma su carta"],
          ["altro_programma", "Sì, dentro un altro programma"],
        ],
      },
    ],
  },
];
