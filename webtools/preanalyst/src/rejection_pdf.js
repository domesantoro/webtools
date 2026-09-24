// The PDF that can be downloaded when a request is refused.
//
// It contains what the user had written in the form, because on the way back the
// form is empty and that text would otherwise be lost. The source is the
// pre-specification stored in workspaces: it is the document that was really
// produced, not a reconstruction.
//
// The pre-specification is markdown, and here it is laid out as it is: headings,
// lists, quotations. Nothing is interpreted, nothing is translated — the questions
// stay in English, as in the document.
//
// The extended reason for the refusal is added at the end, and **only** when the
// caller says so (see `src/server.js`): it is internal data, and who sees it is
// decided by the configuration, not by this module.

import PDFDocument from "pdfkit";

// The front matter is not printed: those are codes for programs, and in a
// document meant for a person they would be noise.
function bodyOf(spec) {
  const match = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(spec);
  return match ? spec.slice(match[0].length) : spec;
}

// The pre-specification's markdown, line by line. These are the only shapes
// `prespec.md.njk` produces: headings, lists, quotations, paragraphs.
function writeBody(doc, spec) {
  for (const line of bodyOf(spec).split("\n")) {
    const text = line.trimEnd();

    if (text === "") {
      doc.moveDown(0.4);
    } else if (text.startsWith("### ")) {
      doc.moveDown(0.6).font("Helvetica-Bold").fontSize(11).text(text.slice(4));
      doc.moveDown(0.2);
    } else if (text.startsWith("## ")) {
      doc.moveDown(1).font("Helvetica-Bold").fontSize(14).text(text.slice(3));
      doc.moveDown(0.3);
    } else if (text.startsWith("# ")) {
      doc.moveDown(0.4).font("Helvetica-Bold").fontSize(18).text(text.slice(2));
      doc.moveDown(0.5);
    } else if (text.startsWith("> ")) {
      doc.font("Helvetica-Oblique").fontSize(10).text(text.slice(2), { indent: 18 });
    } else if (text === ">") {
      doc.moveDown(0.3);
    } else if (text.startsWith("- ")) {
      doc.font("Helvetica").fontSize(10).text(`•  ${text.slice(2)}`, { indent: 12 });
    } else {
      doc.font("Helvetica").fontSize(10).text(text);
    }
  }
}

// Writes the PDF straight into the HTTP response. `reason` is the extended
// reason: if it is `null` the chapter is simply not there, and the document does
// not let on that it exists.
export function writeRejectionPdf(response, { t, spec, reason, fileName }) {
  response.writeHead(200, {
    "content-type": "application/pdf",
    // `attachment`: the browser saves it instead of opening it in place of the page.
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
