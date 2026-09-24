// The pre-analysis questions, as data.
//
// This file is made to be **rewritten often**: it is the draft to start from in
// working out which questions are really needed. Adding, removing or reordering a
// question is done here; page.js draws them without knowing what they ask.
//
// Here is the **structure** of the questions: codes, types, whether they are
// required, and the English texts for the pre-specification. The texts for the
// client — titles, questions, explanations, examples, answers — live in the
// language catalogues (`webtools/commons/i18n/locales/<language>.json`), under:
//
//   preanalyst.questions.sections.<id>.legend / .hint
//   preanalyst.questions.fields.<name>.label / .hint / .placeholder
//   preanalyst.questions.fields.<name>.options.<code>
//
// `hint` and `placeholder` are optional: they are shown if the key is there. A new
// question is written here and its texts are added to the catalogues.
//
// Rules the texts for the client follow:
// - everyday words, never jargon: whoever answers is not of the trade;
// - a dry tone: say what to write and what it is for, full stop. No motivational
//   sentences, no compliments to the client, no advertising of our method. If a
//   sentence can be removed without losing information, remove it;
// - few ready-made answers instead of free fields, because they are easier to give
//   and far easier for the prevalidator to read;
// - required only where nothing can be done without it.
//
// Types: "textarea" | "text" | "email" | "radio" | "checkbox"
//
// Every section and every question has a `spec`: the title they appear under in
// the pre-specification, which is written in English (`templates/prespec.md.njk`)
// whatever language the client answered in. The options are
// [code, text for the pre-specification]: the code is what gets submitted and what
// ends up in the front matter, so it is in English and does not change when the
// texts are rewritten.
//
// `group`: questions that count as a single answer. The skills ticked and the
// "Other" field are the same piece of information — the list of checkboxes is
// open, not a catalogue — so they are missing only if both are.

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
