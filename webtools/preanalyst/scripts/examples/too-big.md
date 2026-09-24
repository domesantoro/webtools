---
project_id: 00000000-0000-4000-8000-000000000001
kind: prespec
template: prespec/1
language: it
answers:
  today: other_software
  users: external
  devices: [computer, mobile, tablet]
  volume: thousands
  personal_data: contacts
  existing_data: other_software
---
# Pre-specification

Answers to the pre-analysis form. Closed answers are shown in English; open
answers are quoted verbatim, in the client's language (it).

## The problem

### What the client needs

> Gestiamo una rete di 40 punti vendita in franchising. Mi serve un sistema dove ogni affiliato carica gli ordini, il magazzino centrale li approva, i corrieri aggiornano le consegne e l'amministrazione emette le fatture con lo split payment. Ogni affiliato deve vedere solo i suoi dati, l'area manager quelli della sua zona, la direzione tutto. Serve anche l'integrazione con il gestionale SAP che usiamo adesso e con i corrieri, e un'app per i magazzinieri che legga i codici a barre anche senza rete.

### How it is done today

With software that does not fit

### What wastes the most time or causes mistakes

> Adesso ogni cosa passa da mail e telefonate: gli ordini si perdono e le fatture escono in ritardo. L'anno scorso abbiamo pagato penali per consegne mai registrate.

## Users and devices

### Who will use it

Also outsiders: customers, partners, the public

### Devices

- Computer
- Mobile phone
- Tablet

## What it must be able to do

### Capabilities indicated by the client

- Read or create barcodes and QR codes
- Create invoices or receipts
- Read existing Excel or CSV files
- Export to Excel or CSV
- Draw charts and statistics
- Personal logins and per-user permissions
- Keep a history of who changed what

### Other capabilities, in the client's words

> Firma digitale delle bolle e accesso con le credenziali aziendali.

## What it must not do

### What must stay out

> Per ora niente contabilità: quella resta al commercialista.

## Data

### Approximate number of records

Thousands

### Personal data of other people

Yes: names and contact details

### Existing data to import

Yes, inside other software

## Open points

None.
