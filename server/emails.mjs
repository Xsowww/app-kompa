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
    welcome: {
      subject: n => `Bienvenue sur Kompaly${n ? `, ${n}` : ''}`,
      hello: n => `Bonjour${n ? ` ${n}` : ''},`,
      intro: 'Ton espace est prêt : agenda, tâches, notes et fichiers au même endroit. Trois choses pour bien commencer :',
      tips: [
        ['Ton emploi du temps', 'colle le lien iCal de ton ENT, de Google Agenda ou d’Outlook : il se met à jour tout seul.'],
        ['L’appli sur ton téléphone', 'ouvre kompaly.com puis « Ajouter à l’écran d’accueil ».'],
        ['Kompaly', 'demande-lui « Qu’est-ce que j’ai demain ? » ou « Planifie mes révisions ».'],
      ],
      button: 'Ouvrir Kompaly',
      why: 'Tu reçois cet e-mail parce que tu viens de créer ton compte Kompaly.',
    },
    tips: {
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
    welcome: {
      subject: n => `Welcome to Kompaly${n ? `, ${n}` : ''}`,
      hello: n => `Hi${n ? ` ${n}` : ''},`,
      intro: 'Your space is ready: calendar, tasks, notes and files in one place. Three things to get started:',
      tips: [
        ['Your timetable', 'paste the iCal link from your school portal, Google Calendar or Outlook: it updates by itself.'],
        ['The app on your phone', 'open kompaly.com, then “Add to Home Screen”.'],
        ['Kompaly', 'ask “What do I have tomorrow?” or “Plan my revision”.'],
      ],
      button: 'Open Kompaly',
      why: 'You’re getting this e-mail because you just created your Kompaly account.',
    },
    tips: {
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
    welcome: {
      subject: n => `Bienvenido a Kompaly${n ? `, ${n}` : ''}`,
      hello: n => `Hola${n ? ` ${n}` : ''}:`,
      intro: 'Tu espacio está listo: agenda, tareas, notas y archivos en un solo lugar. Tres cosas para empezar:',
      tips: [
        ['Tu horario', 'pega el enlace iCal de tu plataforma, de Google Calendar o de Outlook: se actualiza solo.'],
        ['La app en tu móvil', 'abre kompaly.com y luego «Añadir a pantalla de inicio».'],
        ['Kompaly', 'pregúntale «¿Qué tengo mañana?» o «Planifica mis repasos».'],
      ],
      button: 'Abrir Kompaly',
      why: 'Recibes este correo porque acabas de crear tu cuenta de Kompaly.',
    },
    tips: {
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
    welcome: {
      subject: n => `Willkommen bei Kompaly${n ? `, ${n}` : ''}`,
      hello: n => `Hallo${n ? ` ${n}` : ''},`,
      intro: 'Dein Bereich ist bereit: Kalender, Aufgaben, Notizen und Dateien an einem Ort. Drei Dinge für den Start:',
      tips: [
        ['Dein Stundenplan', 'füge den iCal-Link deines Uni-Portals, von Google Kalender oder Outlook ein: er aktualisiert sich von selbst.'],
        ['Die App auf deinem Handy', 'öffne kompaly.com, dann „Zum Home-Bildschirm“.'],
        ['Kompaly', 'frag „Was habe ich morgen?“ oder „Plane meine Wiederholungen“.'],
      ],
      button: 'Kompaly öffnen',
      why: 'Du bekommst diese E-Mail, weil du gerade dein Kompaly-Konto erstellt hast.',
    },
    tips: {
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
    welcome: {
      subject: n => `Benvenuto su Kompaly${n ? `, ${n}` : ''}`,
      hello: n => `Ciao${n ? ` ${n}` : ''},`,
      intro: 'Il tuo spazio è pronto: agenda, attività, note e file in un unico posto. Tre cose per iniziare:',
      tips: [
        ['Il tuo orario', 'incolla il link iCal del tuo portale, di Google Calendar o di Outlook: si aggiorna da solo.'],
        ['L’app sul telefono', 'apri kompaly.com, poi «Aggiungi a schermata Home».'],
        ['Kompaly', 'chiedigli «Cosa ho domani?» o «Pianifica il mio ripasso».'],
      ],
      button: 'Apri Kompaly',
      why: 'Ricevi questa e-mail perché hai appena creato il tuo account Kompaly.',
    },
    tips: {
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

/** The e-mail for one account: { subject, html, text }. Pure (tested in tests/emails.test.ts). */
export function buildEmail(kind, { name, lang }) {
  const L = TEXTS[lang] ?? TEXTS.fr;
  const m = L[kind === 'tips' ? 'tips' : 'welcome'];
  const first = String(name ?? '').trim().split(/\s+/)[0].slice(0, 40);
  const link = `${SITE}/`;
  const settings = `${SITE}/profil?onglet=notifications`;
  const subject = m.subject(first);
  const text = [m.hello(first), '', m.intro, '', ...m.tips.map(([a, b], i) => `${i + 1}. ${a} : ${b}`), '', `${m.button} : ${link}`, '', '—', m.why, ...(kind === 'tips' ? [settings] : [])].join('\n');
  const html = `<!doctype html><html lang="${esc(lang in TEXTS ? lang : 'fr')}"><body style="margin:0;background:#f4f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16181d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:18px;padding:32px 28px">
<tr><td style="font-size:20px;font-weight:700;letter-spacing:-0.03em;padding-bottom:20px">kompaly</td></tr>
<tr><td style="font-size:16px;line-height:1.55">${esc(m.hello(first))}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#3d424c;padding:10px 0 6px">${esc(m.intro)}</td></tr>
${m.tips.map(([a, b], i) => `<tr><td style="font-size:15px;line-height:1.55;padding:8px 0"><span style="display:inline-block;width:22px;height:22px;border-radius:11px;background:#eef2fd;color:#3d63dd;font-weight:700;text-align:center;line-height:22px;font-size:12px;margin-right:8px">${i + 1}</span><b>${esc(a)}</b> : ${esc(b)}</td></tr>`).join('\n')}
<tr><td style="padding:22px 0 6px"><a href="${esc(link)}" style="display:inline-block;background:#16181d;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:12px">${esc(m.button)}</a></td></tr>
<tr><td style="font-size:12px;line-height:1.5;color:#8a8f99;padding-top:22px;border-top:1px solid #eeeeec">${esc(m.why)}${kind === 'tips' ? ` <a href="${esc(settings)}" style="color:#8a8f99">${esc(settings.replace(/^https?:\/\//, ''))}</a>` : ''}</td></tr>
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
