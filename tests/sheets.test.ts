import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { columnOf, csvSeparator, csvSheet, excelDate, isDateFormat, parseCsv, xlsxSheets, xmlText } from '../src/pages/drive/sheets';

describe('CSV preview', () => {
  it('finds the separator French Excel writes (« ; »), else the comma or the tab', () => {
    expect(csvSeparator('Poste;Montant\nLoyer;500')).toBe(';');
    expect(csvSeparator('a,b,c\n1,2,3')).toBe(',');
    expect(csvSeparator('a\tb\n1\t2')).toBe('\t');
    expect(csvSeparator('"a;b;c",d\n')).toBe(','); // inside quotes: not counted
    expect(csvSeparator('seul')).toBe(',');
  });

  it('reads quoted fields with separators, line breaks and doubled quotes', () => {
    expect(parseCsv('﻿a;b\r\n"1;2";"il a dit ""oui"""\n"deux\nlignes";x', ';')).toEqual([
      ['a', 'b'],
      ['1;2', 'il a dit "oui"'],
      ['deux\nlignes', 'x'],
    ]);
  });

  it('evens the rows and drops the empty ones at the end', () => {
    expect(csvSheet('a,b,c\n1\n\n\n', 'x.csv')).toEqual({ name: 'x.csv', rows: [['a', 'b', 'c'], ['1', '', '']], more: false });
  });

  it('keeps the first 500 rows only, and says so', () => {
    const sheet = csvSheet(Array.from({ length: 800 }, (_, i) => `l${i}`).join('\n'), 'x');
    expect(sheet.rows).toHaveLength(500);
    expect(sheet.more).toBe(true);
  });
});

describe('Excel preview', () => {
  it('reads cell references, entities, Excel escapes and date formats', () => {
    expect(columnOf('A1')).toBe(0);
    expect(columnOf('BC12')).toBe(54);
    expect(xmlText('Maths &amp; physique &#233;_x000D_')).toBe('Maths & physique é\r');
    expect(isDateFormat(14)).toBe(true);
    expect(isDateFormat(164, 'dd/mm/yyyy')).toBe(true);
    expect(isDateFormat(165, '#,##0.00 "jours"')).toBe(false);
    expect(isDateFormat(166, '[Red]0.0')).toBe(false);
    expect(excelDate(46000, false, 'fr-FR')).toBe('09/12/2025');
    expect(excelDate(45000.5, false, 'fr-FR')).toBe('15/03/2023 12:00');
  });

  it('reads the visible sheets: shared, inline and rich strings, numbers, booleans, dates', async () => {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook><sheets><sheet name="Notes &amp; co" sheetId="1" r:id="rId1"/><sheet name="Caché" state="hidden" r:id="rId2"/><sheet name="B" r:id="rId3"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="/xl/worksheets/sheet3.xml"/></Relationships>');
    zip.file('xl/sharedStrings.xml', '<sst><si><t>Matière</t></si><si><r><t>Fran</t></r><r><t xml:space="preserve">çais</t></r><rPh><t>x</t></rPh></si></sst>');
    zip.file('xl/styles.xml', '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="dd/mm/yy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>');
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3"><v>15.5</v></c><c r="B3" s="1"><v>46000</v></c><c r="C3" t="b"><v>1</v></c><c r="D3" t="inlineStr"><is><t>bonus</t></is></c><c r="E3"/></row></sheetData></worksheet>');
    zip.file('xl/worksheets/sheet3.xml', '<x:worksheet><x:sheetData><x:row><x:c t="str"><x:f>A1</x:f><x:v>calcul</x:v></x:c></x:row></x:sheetData></x:worksheet>');
    const sheets = await xlsxSheets(await zip.generateAsync({ type: 'uint8array' }), 'fr-FR');
    expect(sheets.map(s => s.name)).toEqual(['Notes & co', 'B']);
    expect(sheets[0].rows).toEqual([
      ['Matière', '', 'Français', ''],
      ['', '', '', ''],
      ['15,5', '09/12/2025', 'VRAI', 'bonus'],
    ]);
    expect(sheets[1].rows).toEqual([['calcul']]);
  });
});
