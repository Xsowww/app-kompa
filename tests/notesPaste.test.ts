import { describe, expect, it } from 'vitest';
import { dropDeadImages, pastedHtmlHasText } from '../src/pages/notes/noteUtils';

describe('coller dans une note', () => {
  it('des cellules d’Excel ou un texte de Word : c’est le texte qui est collé, pas l’image qui l’accompagne', () => {
    const excel = '<html><head><style>td{mso-number-format:General}</style></head><body><!--StartFragment--><table><tr><td>Alice</td><td>15</td></tr></table><!--EndFragment--></body></html>';
    expect(pastedHtmlHasText(excel)).toBe(true);
    expect(pastedHtmlHasText('<p class="MsoNormal">Bonjour</p>')).toBe(true);
  });

  it('une image copiée seule (page web, capture) : pas de texte, l’image est ajoutée', () => {
    expect(pastedHtmlHasText('<meta charset="utf-8"><img src="https://exemple.fr/chat.png" alt="Un chat">')).toBe(false);
    expect(pastedHtmlHasText('<html><head><title>Capture</title><style>p{color:red}</style></head><body><!--StartFragment--><img src="x.png">&nbsp;\n<!--EndFragment--></body></html>')).toBe(false);
    expect(pastedHtmlHasText('')).toBe(false);
    expect(pastedHtmlHasText(undefined)).toBe(false);
  });

  it('les images qui ne s’afficheraient jamais sont retirées, les autres gardées', () => {
    const html =
      '<p>a</p><img src="file:///C:/Users/x/clip_image001.png" width="10"><img src=\'cid:image001@01D\'><img src=x onerror="alert(1)"><img alt="sans adresse">' +
      '<img src="http://exemple.fr/a.png"><img src="blob:https://exemple.fr/123"><img src="https://exemple.fr/ok.png" alt="ok"><img src="data:image/png;base64,AAAA"><p>b</p>';
    expect(dropDeadImages(html)).toBe('<p>a</p><img src="https://exemple.fr/ok.png" alt="ok"><img src="data:image/png;base64,AAAA"><p>b</p>');
  });

  it('un texte sans image n’est pas touché', () => {
    expect(dropDeadImages('<p>Les <b>images</b> src="x" du cours</p>')).toBe('<p>Les <b>images</b> src="x" du cours</p>');
  });
});
