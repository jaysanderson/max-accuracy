import { jsPDF } from 'jspdf';
import { markerMatrix } from './aruco';

/**
 * Printable ArUco marker sheet. All geometry in true millimetres (jsPDF A4 mm
 * units) drawn as vector rects, with a print-scale check ruler on every page:
 * if the ruler doesn't tape-measure at exactly 100 mm, the print is scaled
 * and the markers are unusable.
 */

function drawMarker(doc: jsPDF, id: number, xMm: number, yMm: number, sizeMm: number): void {
  const m = markerMatrix(id);
  const cell = sizeMm / 7;
  // White quiet zone (1 cell) around the marker
  doc.setFillColor(255, 255, 255);
  doc.rect(xMm - cell, yMm - cell, sizeMm + 2 * cell, sizeMm + 2 * cell, 'F');
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      if (m[r][c] === 1) {
        // Tiny overlap avoids hairline white seams between adjacent cells in some printers
        doc.rect(xMm + c * cell, yMm + r * cell, cell + 0.02, cell + 0.02, 'F');
      }
    }
  }
  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text(`ArUco id ${id} — ${sizeMm} mm`, xMm, yMm + sizeMm + cell + 4);
}

function drawRuler(doc: jsPDF, xMm: number, yMm: number): void {
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.line(xMm, yMm, xMm + 100, yMm);
  for (let i = 0; i <= 100; i += 10) {
    const h = i % 50 === 0 ? 5 : 3;
    doc.line(xMm + i, yMm, xMm + i, yMm - h);
    if (i % 50 === 0) {
      doc.setFontSize(7);
      doc.text(String(i), xMm + i, yMm - 6, { align: 'center' });
    }
  }
  doc.setFontSize(9);
  doc.setTextColor(0);
  doc.text('PRINT-SCALE CHECK: this bar must measure exactly 100 mm with a tape.', xMm, yMm + 5);
  doc.setTextColor(120);
  doc.setFontSize(8);
  doc.text('If it does not, reprint at 100% scale ("Actual size" — never "Fit to page").', xMm, yMm + 9.5);
}

export interface MarkerSheetOptions {
  markerSizeMm: number;
  idA: number;
  idB: number;
  idSingle: number;
}

export function generateMarkerSheet(opts: MarkerSheetOptions): void {
  const { markerSizeMm: s, idA, idB, idSingle } = opts;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210;

  // Page 1: the two-marker pair
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.setTextColor(70, 184, 0);
  doc.text('Agentic RAG Vision', 15, 12);
  doc.setTextColor(0);
  doc.text('Two-Marker Reference Pair', 15, 19);
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(
    [
      `Cut out both markers (keep the white border). Fix marker A (id ${idA}) on the wall LEFT of`,
      `the window and marker B (id ${idB}) on the wall RIGHT of the window — same wall plane as the`,
      'opening, level with each other. Tape-measure the centre-to-centre separation; the app asks for it.',
    ],
    15,
    26,
  );
  drawMarker(doc, idA, 25, 50, s);
  drawMarker(doc, idB, pageW - 25 - s, 50, s);
  doc.setDrawColor(150);
  doc.setLineWidth(0.2);
  // Cut guides
  const cut = s / 7; // one quiet-zone cell
  for (const x of [25, pageW - 25 - s]) {
    doc.rect(x - cut - 3, 50 - cut - 3, s + 2 * cut + 6, s + 2 * cut + 6);
  }
  drawRuler(doc, 25, 50 + s + 30);

  // Page 2: single marker
  doc.addPage();
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.setTextColor(70, 184, 0);
  doc.text('Agentic RAG Vision', 15, 12);
  doc.setTextColor(0);
  doc.text('Single Marker Reference', 15, 19);
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(
    [
      `Marker id ${idSingle}, ${s} mm. Fix it on the wall beside the window, flat on the wall plane.`,
      'Single-marker scale amplifies error on wide windows — prefer the two-marker pair beyond ~1200 mm.',
    ],
    15,
    26,
  );
  drawMarker(doc, idSingle, (pageW - s) / 2, 50, s);
  doc.rect((pageW - s) / 2 - cut - 3, 50 - cut - 3, s + 2 * cut + 6, s + 2 * cut + 6);
  drawRuler(doc, 25, 50 + s + 30);

  doc.save(`arag-vision-markers-${s}mm.pdf`);
}
