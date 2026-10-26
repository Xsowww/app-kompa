// E-mails to new accounts: « Bienvenue » once the address is confirmed, then a few tips three days later.
//
// Every 15 minutes the server asks the database who is due (public.mail_queue(), migration 2026-11-01), sends the
// e-mail through Resend and notes it (public.mail_sent()), so each one goes once. Only accounts created in the last
// days: existing accounts get nothing. The tips e-mail can be turned off (Profil › Notifications, « emailTips »).
//
// Settings (Render › Environment), never in the code:
//   RESEND_API_KEY             resend.com › API Keys (« Sending access », domain kompaly.com)
//   SUPABASE_SERVICE_ROLE_KEY  already there for the reminders
//   MAIL_FROM                  optional, « Kompaly <bonjour@kompaly.com> » by default

const SUPABASE = (() => {
  try {
    return new URL(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL).origin;
  } catch {
    return '';
  }
})();
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim().replace(/^["']+|["']+$/g, '').trim();
const RESEND_KEY = (process.env.RESEND_API_KEY || '').trim();
const FROM = (process.env.MAIL_FROM || 'Kompaly <bonjour@kompaly.com>').trim();
const SITE = (process.env.SITE_URL || 'https://kompaly.com').replace(/\/+$/, '');

export const mailStatus = { active: false, sent: 0, lastError: null };

// ── Texts (the server doesn't use the site's translations: each e-mail in the account's language) ─────────
const TEXTS = {
  fr: {
    tagline: 'Agenda, notes, fichiers et tâches au même endroit',
    welcome: {
      title: 'Bienvenue sur Kompaly',
      subject: n => `Bienvenue sur Kompaly${n ? `, ${n}` : ''}`,
      hello: n => `Bonjour${n ? ` ${n}` : ''},`,
      intro: 'Ton espace est prêt : agenda, tâches, notes et fichiers au même endroit. Trois choses pour bien commencer :',
      tips: [
        ['Ton emploi du temps', 'colle le lien iCal de ton agenda (ENT, Google Agenda, Outlook…) : il se met à jour tout seul.'],
        ['L’appli sur ton téléphone', 'ouvre kompaly.com puis « Ajouter à l’écran d’accueil ».'],
        ['Kompaly', 'demande-lui « Qu’est-ce que j’ai demain ? » ou « Organise ma semaine ».'],
      ],
      button: 'Ouvrir Kompaly',
      why: 'Tu reçois cet e-mail parce que tu viens de créer ton compte Kompaly.',
    },
    tips: {
      title: 'Trois idées à essayer',
      subject: n => `${n ? `${n}, ` : ''}trois idées pour Kompaly`,
      hello: n => `Bonjour${n ? ` ${n}` : ''},`,
      intro: 'Ça fait quelques jours que tu es sur Kompaly. Si tu ne les as pas encore essayées :',
      tips: [
        ['Une fiche depuis une photo', 'prends tes notes en photo, même écrites à la main : Kompaly en fait une fiche PDF.'],
        ['Enregistrer', 'Kompaly écrit un cours ou une réunion pendant que tu écoutes.'],
        ['Les agendas partagés', 'invite ta promo, ta coloc ou ta famille sur un calendrier commun.'],
      ],
      button: 'Reprendre où j’en étais',
      why: 'C’est le seul e-mail de ce genre. Pour ne plus en recevoir : Profil › Notifications.',
    },
  },
  en: {
    tagline: 'Calendar, notes, files and tasks in one place',
    welcome: {
      title: 'Welcome to Kompaly',
      subject: n => `Welcome to Kompaly${n ? `, ${n}` : ''}`,
      hello: n => `Hi${n ? ` ${n}` : ''},`,
      intro: 'Your space is ready: calendar, tasks, notes and files in one place. Three things to get started:',
      tips: [
        ['Your timetable', 'paste the iCal link of your calendar (school portal, Google Calendar, Outlook…): it updates by itself.'],
        ['The app on your phone', 'open kompaly.com, then “Add to Home Screen”.'],
        ['Kompaly', 'ask “What do I have tomorrow?” or “Plan my week”.'],
      ],
      button: 'Open Kompaly',
      why: 'You’re getting this e-mail because you just created your Kompaly account.',
    },
    tips: {
      title: 'Three ideas to try',
      subject: n => `${n ? `${n}, ` : ''}three ideas for Kompaly`,
      hello: n => `Hi${n ? ` ${n}` : ''},`,
      intro: 'You’ve been on Kompaly for a few days. In case you haven’t tried them yet:',
      tips: [
        ['A sheet from a photo', 'take a photo of your notes, even handwritten: Kompaly turns it into a PDF sheet.'],
        ['Record', 'Kompaly writes down a class or a meeting while you listen.'],
        ['Shared calendars', 'invite your classmates, flatmates or family to a common calendar.'],
      ],
      button: 'Pick up where I left off',
      why: 'This is the only e-mail of this kind. To stop them: Profile › Notifications.',
    },
  },
  es: {
    tagline: 'Agenda, notas, archivos y tareas en un solo lugar',
    welcome: {
      title: 'Bienvenido a Kompaly',
      subject: n => `Bienvenido a Kompaly${n ? `, ${n}` : ''}`,
      hello: n => `Hola${n ? ` ${n}` : ''}:`,
      intro: 'Tu espacio está listo: agenda, tareas, notas y archivos en un solo lugar. Tres cosas para empezar:',
      tips: [
        ['Tu horario', 'pega el enlace iCal de tu agenda (plataforma de estudios, Google Calendar, Outlook…): se actualiza solo.'],
        ['La app en tu móvil', 'abre kompaly.com y luego «Añadir a pantalla de inicio».'],
        ['Kompaly', 'pregúntale «¿Qué tengo mañana?» o «Organiza mi semana».'],
      ],
      button: 'Abrir Kompaly',
      why: 'Recibes este correo porque acabas de crear tu cuenta de Kompaly.',
    },
    tips: {
      title: 'Tres ideas para probar',
      subject: n => `${n ? `${n}, ` : ''}tres ideas para Kompaly`,
      hello: n => `Hola${n ? ` ${n}` : ''}:`,
      intro: 'Llevas unos días en Kompaly. Por si aún no las has probado:',
      tips: [
        ['Una ficha desde una foto', 'haz una foto de tus apuntes, incluso a mano: Kompaly la convierte en una ficha PDF.'],
        ['Grabar', 'Kompaly escribe una clase o una reunión mientras escuchas.'],
        ['Calendarios compartidos', 'invita a tu clase, tus compañeros de piso o tu familia a un calendario común.'],
      ],
      button: 'Seguir donde lo dejé',
      why: 'Es el único correo de este tipo. Para no recibir más: Perfil › Notificaciones.',
    },
  },
  de: {
    tagline: 'Kalender, Notizen, Dateien und Aufgaben an einem Ort',
    welcome: {
      title: 'Willkommen bei Kompaly',
      subject: n => `Willkommen bei Kompaly${n ? `, ${n}` : ''}`,
      hello: n => `Hallo${n ? ` ${n}` : ''},`,
      intro: 'Dein Bereich ist bereit: Kalender, Aufgaben, Notizen und Dateien an einem Ort. Drei Dinge für den Start:',
      tips: [
        ['Dein Stundenplan', 'füge den iCal-Link deines Kalenders ein (Uni-Portal, Google Kalender, Outlook …): er aktualisiert sich von selbst.'],
        ['Die App auf deinem Handy', 'öffne kompaly.com, dann „Zum Home-Bildschirm“.'],
        ['Kompaly', 'frag „Was habe ich morgen?“ oder „Organisiere meine Woche“.'],
      ],
      button: 'Kompaly öffnen',
      why: 'Du bekommst diese E-Mail, weil du gerade dein Kompaly-Konto erstellt hast.',
    },
    tips: {
      title: 'Drei Ideen zum Ausprobieren',
      subject: n => `${n ? `${n}, ` : ''}drei Ideen für Kompaly`,
      hello: n => `Hallo${n ? ` ${n}` : ''},`,
      intro: 'Du bist seit ein paar Tagen bei Kompaly. Falls du sie noch nicht ausprobiert hast:',
      tips: [
        ['Ein Lernzettel aus einem Foto', 'fotografiere deine Notizen, auch handschriftlich: Kompaly macht daraus einen PDF-Lernzettel.'],
        ['Aufnehmen', 'Kompaly schreibt eine Vorlesung oder ein Meeting mit, während du zuhörst.'],
        ['Geteilte Kalender', 'lade deinen Kurs, deine WG oder deine Familie in einen gemeinsamen Kalender ein.'],
      ],
      button: 'Weitermachen',
      why: 'Das ist die einzige E-Mail dieser Art. Um keine mehr zu bekommen: Profil › Benachrichtigungen.',
    },
  },
  it: {
    tagline: 'Agenda, note, file e attività in un unico posto',
    welcome: {
      title: 'Benvenuto su Kompaly',
      subject: n => `Benvenuto su Kompaly${n ? `, ${n}` : ''}`,
      hello: n => `Ciao${n ? ` ${n}` : ''},`,
      intro: 'Il tuo spazio è pronto: agenda, attività, note e file in un unico posto. Tre cose per iniziare:',
      tips: [
        ['Il tuo orario', 'incolla il link iCal del tuo calendario (portale, Google Calendar, Outlook…): si aggiorna da solo.'],
        ['L’app sul telefono', 'apri kompaly.com, poi «Aggiungi a schermata Home».'],
        ['Kompaly', 'chiedigli «Cosa ho domani?» o «Organizza la mia settimana».'],
      ],
      button: 'Apri Kompaly',
      why: 'Ricevi questa e-mail perché hai appena creato il tuo account Kompaly.',
    },
    tips: {
      title: 'Tre idee da provare',
      subject: n => `${n ? `${n}, ` : ''}tre idee per Kompaly`,
      hello: n => `Ciao${n ? ` ${n}` : ''},`,
      intro: 'Sei su Kompaly da qualche giorno. Se non le hai ancora provate:',
      tips: [
        ['Una scheda da una foto', 'fotografa i tuoi appunti, anche scritti a mano: Kompaly ne fa una scheda PDF.'],
        ['Registra', 'Kompaly scrive una lezione o una riunione mentre ascolti.'],
        ['Calendari condivisi', 'invita la tua classe, i coinquilini o la famiglia in un calendario comune.'],
      ],
      button: 'Riprendi da dove eri',
      why: 'È l’unica e-mail di questo tipo. Per non riceverne più: Profilo › Notifiche.',
    },
  },
};

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// French typography: no line break inside « » or before : ? ! ;
const nbsp = s => String(s).replace(/« /g, '«\u00a0').replace(/ ([»:?!;])/g, '\u00a0$1');

/** The e-mail for one account: { subject, html, text }. Pure (tested in tests/emails.test.ts). */
export function buildEmail(kind, { name, lang }) {
  const L = TEXTS[lang] ?? TEXTS.fr;
  const m = L[kind === 'tips' ? 'tips' : 'welcome'];
  const first = String(name ?? '').trim().split(/\s+/)[0].slice(0, 40);
  const link = `${SITE}/`;
  const settings = `${SITE}/profil?onglet=notifications`;
  const subject = m.subject(first);
  const text = [m.hello(first), '', m.intro, '', ...m.tips.map(([a, b], i) => `${i + 1}. ${a} : ${b}`), '', `${m.button} : ${link}`, '', '—', m.why, ...(kind === 'tips' ? [settings] : [])].join('\n');
  const F = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;";
  // Same look as the account e-mails (supabase/emails): logo above a white card, blue button. PNG images: Outlook reads no WebP or SVG.
  const nb = lang === 'de' || lang === 'en' || lang === 'es' || lang === 'it' ? String : nbsp;
  const html = `<!doctype html><html lang="${esc(lang in TEXTS ? lang : 'fr')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(nb(m.title))}</title></head>
<body style="margin:0;padding:0;background:#f7f7f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(nb(m.intro))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f5;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td style="padding:0 4px 20px 4px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;"><img src="${SITE}/icon-192.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px;"></td>
<td style="vertical-align:middle;padding-left:10px;${F}font-size:22px;font-weight:600;letter-spacing:-0.5px;color:#16181d;">kompaly</td>
</tr></table></td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e4e0;border-radius:16px;overflow:hidden;${F}color:#16181d;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:${kind === 'tips' ? '#f1edfb' : '#eef2fd'};padding:22px 0 18px 0;"><img src="${SITE}/kompaly/drone-mail.png" width="180" height="113" alt="" style="display:block;border:0;"></td></tr></table>
<div style="padding:28px 28px 32px 28px;">
<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.3px;color:#16181d;">${esc(nb(m.title))}</h1>
<p style="margin:0 0 6px 0;font-size:15px;line-height:1.6;color:#16181d;">${esc(nb(m.hello(first)))}</p>
<p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#3d424c;">${esc(nb(m.intro))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${m.tips.map(([a, b], i) => `<tr><td width="34" style="vertical-align:top;padding:10px 0;"><div style="width:24px;height:24px;border-radius:12px;background:#eef2fd;color:#3d63dd;font-size:12px;font-weight:700;line-height:24px;text-align:center;">${i + 1}</div></td><td style="vertical-align:top;padding:10px 0;font-size:15px;line-height:1.55;color:#3d424c;${i ? 'border-top:1px solid #efefec;' : ''}"><b style="color:#16181d;">${esc(nb(a))}</b><br>${esc(nb(b.charAt(0).toUpperCase() + b.slice(1)))}</td></tr>`).join('\n')}
</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 0 0;"><tr><td style="border-radius:10px;background:#3d63dd;"><a href="${esc(link)}" style="display:inline-block;padding:13px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(nb(m.button))}</a></td></tr></table>
</div></td></tr>
<tr><td style="padding:20px 4px 0 4px;${F}font-size:12px;line-height:1.5;color:#8a8f98;">Kompaly · ${esc(nb(L.tagline))}<br>${esc(nb(m.why))}${kind === 'tips' ? ` <a href="${esc(settings)}" style="color:#8a8f98;">${esc(settings.replace(/^https?:\/\//, ''))}</a>` : ''}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text, ...(kind === 'tips' && { unsubscribe: settings }) };
}

async function rpc(fn, body = {}) {
  const res = await fetch(`${SUPABASE}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw Object.assign(new Error(`${fn} ${res.status} ${(await res.text()).slice(0, 160)}`), { status: res.status });
  return res.status === 204 ? null : res.json();
}

async function send(to, mail) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject: mail.subject, html: mail.html, text: mail.text, ...(mail.unsubscribe && { headers: { 'List-Unsubscribe': `<${mail.unsubscribe}>` } }) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw Object.assign(new Error(`resend ${res.status} ${(await res.text()).slice(0, 160)}`), { status: res.status });
}

async function deliver() {
  const due = (await rpc('mail_queue')) ?? [];
  for (const row of due) {
    const kind = row.kind === 'tips' ? 'tips' : 'welcome';
    const mail = buildEmail(kind, { name: row.name, lang: row.settings?.language });
    await send(row.email, mail);
    // Noted right after: a failure here would send it again next time, never lose it.
    await rpc('mail_sent', { p_id: row.id, p_kind: kind });
    mailStatus.sent++;
  }
}

export function startMailLoop() {
  if (!SUPABASE || !SERVICE_KEY || !RESEND_KEY) {
    console.log('[emails] e-mails de bienvenue désactivés (RESEND_API_KEY et SUPABASE_SERVICE_ROLE_KEY à définir sur l’hébergeur)');
    return;
  }
  mailStatus.active = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await deliver();
      mailStatus.lastError = null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== mailStatus.lastError) console.error('[emails]', msg);
      mailStatus.lastError = msg;
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 60_000);
  setInterval(tick, 15 * 60_000);
}
