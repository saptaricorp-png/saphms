import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import mammoth from 'mammoth';

export interface WordLetterOptions {
  fileName: string;
  hospitalName: string;
  hospitalNameNp?: string;
  addressLine?: string;
  contactLine?: string;
  panNumber?: string;
  documentHeading?: string;
  refNumber?: string;
  entryNumber?: string;
  dateBs?: string;
  dateAd?: string;
  department?: string;
  recipientLine?: string;
  recipientAddress?: string;
  subject: string;
  body: string;
  signatoryName?: string;
  signatoryDesignation?: string;
  signatoryRegNo?: string;
  footerNote?: string;
}

export async function exportLetterToDocx(opts: WordLetterOptions): Promise<void> {
  const noBorder = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  };

  const children: Array<Paragraph | Table> = [];

  // Letterhead Top
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: opts.hospitalName || 'Saptari Hospital Pvt Ltd',
          bold: true,
          size: 32,
          color: '0F172A',
        }),
      ],
    })
  );

  if (opts.hospitalNameNp) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: opts.hospitalNameNp,
            bold: true,
            size: 22,
            color: '334155',
          }),
        ],
      })
    );
  }

  if (opts.addressLine || opts.contactLine || opts.panNumber) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        border: {
          bottom: { style: BorderStyle.DOUBLE, size: 12, color: '0F172A', space: 6 },
        },
        children: [
          new TextRun({
            text: [
              opts.addressLine,
              opts.contactLine,
              opts.panNumber ? `PAN/VAT: ${opts.panNumber}` : undefined,
            ]
              .filter(Boolean)
              .join('  |  '),
            size: 18,
            color: '475569',
          }),
        ],
      })
    );
  }

  if (opts.documentHeading) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 140, after: 120 },
        children: [
          new TextRun({
            text: opts.documentHeading.toUpperCase(),
            bold: true,
            underline: {},
            size: 24,
            color: '0F172A',
          }),
        ],
      })
    );
  }

  // Ref / Date metadata row
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 55, type: WidthType.PERCENTAGE },
              borders: noBorder,
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: 'Ref. No. (चलानी / पत्र सं.): ', bold: true, size: 20 }),
                    new TextRun({ text: opts.refNumber || '—', bold: true, size: 20 }),
                  ],
                }),
                ...(opts.entryNumber
                  ? [
                      new Paragraph({
                        children: [
                          new TextRun({ text: 'Register No.: ', bold: true, size: 18, color: '475569' }),
                          new TextRun({ text: opts.entryNumber, size: 18, color: '475569' }),
                        ],
                      }),
                    ]
                  : []),
              ],
            }),
            new TableCell({
              width: { size: 45, type: WidthType.PERCENTAGE },
              borders: noBorder,
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: 'Date (BS): ', bold: true, size: 20 }),
                    new TextRun({ text: opts.dateBs || '—', size: 20 }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({ text: 'Date (AD): ', bold: true, size: 18, color: '475569' }),
                    new TextRun({ text: opts.dateAd || '—', size: 18, color: '475569' }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  children.push(new Paragraph({ spacing: { after: 140 } }));

  if (opts.recipientLine) {
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: 'To,', size: 21, bold: true })],
      }),
      new Paragraph({
        spacing: { after: 20 },
        children: [new TextRun({ text: opts.recipientLine, size: 21, bold: true })],
      })
    );
    if (opts.recipientAddress) {
      children.push(
        new Paragraph({
          spacing: { after: 140 },
          children: [new TextRun({ text: opts.recipientAddress, size: 20, color: '334155' })],
        })
      );
    }
  }

  // Subject
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 200 },
      children: [
        new TextRun({
          text: `Subject: ${opts.subject}`,
          bold: true,
          underline: {},
          size: 23,
          color: '0F172A',
        }),
      ],
    })
  );

  // Body paragraphs
  const normalizedBody = (opts.body || '').replace(/\r\n/g, '\n').trim();
  const paragraphs = normalizedBody.split(/\n{2,}/);
  for (const block of paragraphs) {
    const lines = block.split('\n');
    const runs: TextRun[] = [];
    lines.forEach((line, idx) => {
      if (idx > 0) runs.push(new TextRun({ break: 1 }));
      runs.push(new TextRun({ text: line, size: 21, color: '1E293B' }));
    });
    children.push(
      new Paragraph({
        spacing: { after: 140, line: 300 },
        alignment: AlignmentType.LEFT,
        children: runs,
      })
    );
  }

  // Signatory block
  children.push(new Paragraph({ spacing: { before: 320 } }));
  children.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              borders: noBorder,
              children: [
                new Paragraph({
                  spacing: { before: 280 },
                  children: [
                    new TextRun({
                      text: opts.department ? `Department: ${opts.department}` : 'Official Hospital Stamp / Seal',
                      size: 18,
                      italics: true,
                      color: '64748B',
                    }),
                  ],
                }),
              ],
            }),
            new TableCell({
              width: { size: 50, type: WidthType.PERCENTAGE },
              borders: noBorder,
              children: [
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { before: 160, after: 40 },
                  children: [
                    new TextRun({
                      text: '____________________________________',
                      size: 18,
                      color: '334155',
                    }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: opts.signatoryName || 'Authorized Signatory',
                      bold: true,
                      size: 21,
                      color: '0F172A',
                    }),
                  ],
                }),
                ...(opts.signatoryDesignation
                  ? [
                      new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [
                          new TextRun({
                            text: opts.signatoryDesignation,
                            size: 18,
                            color: '475569',
                          }),
                        ],
                      }),
                    ]
                  : []),
                ...(opts.signatoryRegNo
                  ? [
                      new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [
                          new TextRun({
                            text: `Reg No.: ${opts.signatoryRegNo}`,
                            size: 17,
                            color: '64748B',
                          }),
                        ],
                      }),
                    ]
                  : []),
              ],
            }),
          ],
        }),
      ],
    })
  );

  if (opts.footerNote) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 220 },
        children: [
          new TextRun({
            text: opts.footerNote,
            size: 16,
            italics: true,
            color: '64748B',
          }),
        ],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 900,
              right: 1000,
              bottom: 900,
              left: 1000,
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const safeName = (opts.fileName || 'Hospital-Letter').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const finalName = safeName.toLowerCase().endsWith('.docx') ? safeName : `${safeName}.docx`;
  const a = document.createElement('a');
  a.href = url;
  a.download = finalName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export async function extractTextFromWordFile(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.docx')) {
    const arrayBuffer = await file.arrayBuffer();
    const res = await mammoth.extractRawText({ arrayBuffer });
    return (res.value || '').trim();
  }
  if (lower.endsWith('.txt') || lower.endsWith('.md') || lower.endsWith('.csv')) {
    return (await file.text()).trim();
  }
  if (lower.endsWith('.doc')) {
    throw new Error('Legacy binary .doc format cannot be parsed directly in browser — please save as .docx in Microsoft Word and upload.');
  }
  throw new Error('Unsupported file type for body import. Please choose a .docx Word file or .txt file.');
}
