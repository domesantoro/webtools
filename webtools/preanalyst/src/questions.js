// Le domande della pre-analisi, come dati.
//
// Questo file è fatto per essere **riscritto spesso**: è la bozza da cui partire
// per capire quali domande servono davvero. Aggiungere, togliere o riordinare una
// domanda si fa qui; page.js le disegna senza sapere che cosa chiedono.
//
// Qui c'è la **struttura** delle domande: codici, tipi, obbligatorietà e i testi
// inglesi della pre-specifica. I testi per il cliente — titoli, domande,
// spiegazioni, esempi, risposte — stanno nei cataloghi delle lingue
// (`webtools/commons/i18n/locales/<lingua>.json`), sotto:
//
//   preanalyst.questions.sections.<id>.legend / .hint
//   preanalyst.questions.fields.<name>.label / .hint / .placeholder
//   preanalyst.questions.fields.<name>.options.<codice>
//
// `hint` e `placeholder` sono facoltativi: si mostrano se la chiave c'è.
// Una domanda nuova si scrive qui e i suoi testi si aggiungono ai cataloghi.
//
// Regole che i testi per il cliente seguono:
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
//
// Ogni sezione e ogni domanda hanno `spec`: il titolo con cui compaiono nella
// pre-specifica, che è scritta in inglese (`templates/prespec.md.njk`) in
// qualunque lingua il cliente abbia risposto. Le opzioni sono
// [codice, testo per la pre-specifica]: il codice è quello che si invia e che
// finisce nel front matter, quindi è in inglese e non cambia quando si
// riscrivono i testi.
//
// `group`: domande che valgono come una sola risposta. Le skill segnate e il
// campo "Altro" sono la stessa informazione — l'elenco delle caselle è aperto,
// non un catalogo — quindi mancano solo se mancano tutte e due.

export const SECTIONS = [
  {
    id: "problem",
    spec: "The problem",
    fields: [
      {
        name: "need",
        kind: "textarea",
        spec: "What the client needs",
        required: true,
        rows: 6,
      },
      {
        name: "today",
        kind: "radio",
        spec: "How it is done today",
        options: [
          ["spreadsheet", "A spreadsheet (Excel, Google Sheets)"],
          ["paper", "On paper: notebook, diary, notes"],
          ["messages", "Through messages, email, WhatsApp"],
          ["other_software", "With software that does not fit"],
          ["none", "Not done yet: wants to start"],
        ],
      },
      {
        name: "pain",
        kind: "textarea",
        spec: "What wastes the most time or causes mistakes",
        rows: 3,
      },
    ],
  },
  {
    id: "usage",
    spec: "Users and devices",
    fields: [
      {
        name: "users",
        kind: "radio",
        spec: "Who will use it",
        options: [
          ["only_me", "Only the client"],
          ["few", "The client and a few others (2–5)"],
          ["group", "A larger group"],
          ["external", "Also outsiders: customers, partners, the public"],
        ],
      },
      {
        name: "devices",
        kind: "checkbox",
        spec: "Devices",
        options: [
          ["computer", "Computer"],
          ["mobile", "Mobile phone"],
          ["tablet", "Tablet"],
        ],
      },
    ],
  },
  {
    id: "skill",
    spec: "What it must be able to do",
    fields: [
      {
        name: "skills",
        group: "capabilities",
        kind: "checkbox",
        columns: 2,
        spec: "Capabilities indicated by the client",
        options: [
          ["attachments", "Keep attached photos and documents"],
          ["images", "Crop, resize or watermark images"],
          ["ocr", "Read text in photos and scans"],
          ["barcodes", "Read or create barcodes and QR codes"],
          ["pdf", "Create PDFs: sheets, reports, receipts"],
          ["word_templates", "Fill in existing Word templates"],
          ["invoices", "Create invoices or receipts"],
          ["import", "Read existing Excel or CSV files"],
          ["export", "Export to Excel or CSV"],
          ["charts", "Draw charts and statistics"],
          ["search", "Free-text search across all data"],
          ["dates", "Date arithmetic: deadlines, working days, shifts"],
          ["validations", "Validate Italian tax codes, VAT numbers, IBANs"],
          ["email", "Send emails"],
          ["reminders", "Send automatic reminders on deadlines"],
          ["calendar", "Manage a calendar or bookings"],
          ["maps", "Show maps, addresses and distances"],
          ["signature", "Collect a signature drawn on screen"],
          ["login", "Personal logins and per-user permissions"],
          ["audit_log", "Keep a history of who changed what"],
        ],
      },
      {
        name: "skills_other",
        group: "capabilities",
        kind: "textarea",
        spec: "Other capabilities, in the client's words",
        rows: 2,
      },
    ],
  },
  {
    id: "boundaries",
    spec: "What it must not do",
    fields: [
      {
        name: "out_of_scope",
        kind: "textarea",
        spec: "What must stay out",
        rows: 4,
      },
    ],
  },
  {
    id: "data",
    spec: "Data",
    fields: [
      {
        name: "volume",
        kind: "radio",
        spec: "Approximate number of records",
        options: [
          ["tens", "Tens"],
          ["hundreds", "Hundreds"],
          ["thousands", "Thousands"],
          ["unknown", "The client does not know"],
        ],
      },
      {
        name: "personal_data",
        kind: "radio",
        spec: "Personal data of other people",
        options: [
          ["none", "No"],
          ["contacts", "Yes: names and contact details"],
          ["sensitive", "Yes, some sensitive (health, minors, money)"],
          ["unknown", "The client does not know"],
        ],
      },
      {
        name: "existing_data",
        kind: "radio",
        spec: "Existing data to import",
        options: [
          ["none", "No, starting from scratch"],
          ["file", "Yes, in a file (Excel, CSV)"],
          ["paper", "Yes, on paper"],
          ["other_software", "Yes, inside other software"],
        ],
      },
    ],
  },
];
