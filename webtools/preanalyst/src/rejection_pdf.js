// Il PDF che si può scaricare quando una richiesta viene rifiutata.
//
// Contiene quello che l'utente aveva scritto nel form, perché tornando alla
// pagina il form è vuoto e quel testo altrimenti è perso. La fonte è la
// pre-specifica conservata in workspaces: è il documento che è stato davvero
// prodotto, non una ricostruzione.
//
// La pre-specifica è markdown, e qui si impagina così com'è: titoli, elenchi,
// citazioni. Non si interpreta niente, non si traduce niente — le domande
// restano in inglese, come nel documento.
//
// La motivazione estesa del rifiuto si aggiunge in fondo, e **solo** quando chi
// chiama lo dice (vedi `src/server.js`): è un dato interno, e chi lo vede lo
// decide la configurazione, non questo modulo.

import PDFDocument from "pdfkit";

// Il front matter non si stampa: sono codici per i programmi, e in un documento
// per una persona sarebbero rumore.
function bodyOf(spec) {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(spec);
  return match ? spec.slice(match[0].length) : spec;
}

// Il markdown della pre-specifica, riga per riga. Sono le sole forme che
// `prespec.md.njk` produce: titoli, elenchi, citazioni, paragrafi.
function writeBody(doc, spec) {
  for (const riga of bodyOf(spec).split("\n")) {
    const testo = riga.trimEnd();

    if (testo === "") {
      doc.moveDown(0.4);
    } else if (testo.startsWith("### ")) {
      doc.moveDown(0.6).font("Helvetica-Bold").fontSize(11).text(testo.slice(4));
      doc.moveDown(0.2);
    } else if (testo.startsWith("## ")) {
      doc.moveDown(1).font("Helvetica-Bold").fontSize(14).text(testo.slice(3));
      doc.moveDown(0.3);
    } else if (testo.startsWith("# ")) {
      doc.moveDown(0.4).font("Helvetica-Bold").fontSize(18).text(testo.slice(2));
      doc.moveDown(0.5);
    } else if (testo.startsWith("> ")) {
      doc.font("Helvetica-Oblique").fontSize(10).text(testo.slice(2), { indent: 18 });
    } else if (testo === ">") {
      doc.moveDown(0.3);
    } else if (testo.startsWith("- ")) {
      doc.font("Helvetica").fontSize(10).text(`•  ${testo.slice(2)}`, { indent: 12 });
    } else {
      doc.font("Helvetica").fontSize(10).text(testo);
    }
  }
}

// Scrive il PDF direttamente nella risposta HTTP. `reason` è la motivazione
// estesa: se è `null` il capitolo non c'è proprio, e il documento non lascia
// capire che esista.
export function writeRejectionPdf(response, { t, spec, reason, fileName }) {
  response.writeHead(200, {
    "content-type": "application/pdf",
    // `attachment`: il browser lo salva invece di aprirlo al posto della pagina.
    "content-disposition": `attachment; filename="${fileName}"`,
    "cache-control": "no-store",
  });

  const doc = new PDFDocument({ size: "A4", margin: 56, autoFirstPage: true });
  doc.pipe(response);

  doc.font("Helvetica-Bold").fontSize(20).text(t("preanalyst.rejection.pdf.title"));
  doc.moveDown(0.4);
  doc.font("Helvetica").fontSize(10).fillColor("#5e5a52").text(t("preanalyst.rejection.pdf.lead"));
  doc.fillColor("#1c1b18");
  doc.moveDown(1);

  writeBody(doc, spec);

  if (reason) {
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(14).text(t("preanalyst.rejection.pdf.reason_title"));
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(10).text(reason);
  }

  doc.end();
}
