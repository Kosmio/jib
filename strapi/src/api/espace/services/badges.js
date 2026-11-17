'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { EspaceError } = require('../lib/errors');
const { normalizeText } = require('../lib/directory');
const { parseProgramTime } = require('../lib/time');
const { buildBadgesPdf, cardUrl, deriveCardToken, hashCardToken, isoOf, isReduced, parseTypes, sortAttendees, typeOf } = require('../lib/badges');

const ATTENDEE = 'api::espace.attendee';
const SETTING = 'api::espace.badge-setting';
const SEQUENCE = 'api::sequence.sequence';
const LIMIT = 1000;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg']);

const validation = (fields) => new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields });

/** Badges (F-97, F-98, I-43) and card tokens (R-80, NF-55). The token is derived, never stored: only its hash is. */
module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);
  const settings = () => strapi.config.get('server.espace');
  const secret = () => strapi.config.get('server.app.keys')[0];
  const organizerEmails = () => settings().organizerEmails.map((email) => email.trim().toLowerCase());
  const tokenOf = (attendee, createdAt) => deriveCardToken({ secret: secret(), documentId: attendee.documentId, createdAt });

  /**
   * Token of an attendee, created at the first call (cardTokenCreatedAt + cardTokenHash) ; `rotate` makes a new one (the old one stops working).
   * The check and the write run under a lock, so that two requests agree on one `cardTokenCreatedAt`. -> { token, createdAt }
   */
  async function ensureToken(attendee, { rotate = false } = {}) {
    const known = isoOf(attendee.cardTokenCreatedAt);
    if (known && !rotate) return { token: tokenOf(attendee, known), createdAt: known };

    return strapi.service('api::espace.locks').withLock(`card-token:${attendee.documentId}`, async () => {
      const current = await documents(ATTENDEE).findOne({ documentId: attendee.documentId });
      const previous = isoOf(current?.cardTokenCreatedAt);
      if (previous && !rotate) return { token: tokenOf(attendee, previous), createdAt: previous };

      // A new instant, strictly after the previous one: the token derives from it.
      const createdAt = new Date(Math.max(Date.now(), previous ? new Date(previous).getTime() + 1 : 0)).toISOString();
      const token = tokenOf(attendee, createdAt);
      await documents(ATTENDEE).update({ documentId: attendee.documentId, data: { cardTokenCreatedAt: createdAt, cardTokenHash: hashCardToken(token) } });
      return { token, createdAt };
    });
  }

  /** Plan of the venue (PNG or JPEG file of the local upload folder) or null: a file pdfkit cannot read is skipped, never fatal. */
  async function planOf(setting) {
    const file = setting?.plan;
    if (!file?.url) return null;
    if (!IMAGE_TYPES.has(file.mime) || !file.url.startsWith('/uploads/')) {
      strapi.log.warn(JSON.stringify({ event: 'espace.badges.plan-skipped', mime: file.mime }));
      return null;
    }
    return fs.readFile(path.join(strapi.dirs.static.public, file.url)).catch(() => null);
  }

  /**
   * Published sequences of the edition, read from the Document Service without the guard of the participant space: badges are printed
   * before it opens. Same ordering as the program service (parsed start time) ; a sequence without a readable time goes to `notes`.
   */
  async function programOf(edition) {
    const sequences = await documents(SEQUENCE).findMany({
      filters: { edition: { documentId: edition.documentId } },
      status: 'published',
      populate: { interventions: { populate: { intervenants: { fields: ['name'] } } } },
      limit: LIMIT,
    });
    const minutesOf = (time) => time.hours * 60 + time.minutes;
    const sessions = [];
    const notes = [];
    for (const sequence of sequences) {
      const start = parseProgramTime(sequence.start_time);
      if (!start) {
        if (sequence.title?.trim()) notes.push({ order: sequence.order ?? 0, title: sequence.title.trim() });
        continue;
      }
      const end = parseProgramTime(sequence.end_time);
      const people = new Map();
      for (const { intervenants = [] } of sequence.interventions ?? []) for (const person of intervenants) people.set(person.documentId, { name: person.name });
      sessions.push({ key: [minutesOf(start), end ? minutesOf(end) : 0, sequence.order ?? 0, sequence.id], value: { start: sequence.start_time, title: sequence.title, speakers: [...people.values()] } });
    }
    sessions.sort((a, b) => a.key.reduce((diff, part, index) => diff || part - b.key[index], 0));
    return { sessions: sessions.map(({ value }) => value), notes: notes.sort((a, b) => a.order - b.order).map(({ title }) => title) };
  }

  /** What the PDF needs about an edition: its text, its program (as E8), the plan and the accent of the band. */
  async function context(edition) {
    const setting = await documents(SETTING).findFirst({ filters: { edition: { documentId: edition.documentId } }, populate: { plan: true } });
    const program = await programOf(edition);
    return {
      edition: { title: edition.title, date: edition.date, city: edition.city },
      program,
      plan: await planOf(setting),
      accent: setting?.accent || edition.hero_bg_color || null,
    };
  }

  const toBadge = async (attendee, edition, emails) => {
    const { token } = await ensureToken(attendee);
    return {
      firstName: attendee.firstName,
      lastName: attendee.lastName,
      jobTitle: attendee.jobTitle || attendee.speaker?.title || '',
      company: attendee.company || attendee.speaker?.organisation?.name || attendee.exhibitor?.organisation?.name || '',
      type: typeOf(attendee, emails),
      url: cardUrl({ publicUrl: settings().publicUrl, slug: edition.slug, token }),
    };
  };

  const loaded = (filters) =>
    documents(ATTENDEE).findMany({ filters, populate: { speaker: { fields: ['title'], populate: { organisation: { fields: ['name'] } } }, exhibitor: { populate: { organisation: { fields: ['name'] } } } }, limit: LIMIT });

  async function findActive(edition, id) {
    const attendee = await documents(ATTENDEE).findOne({
      documentId: String(id),
      populate: { edition: { fields: ['documentId'] }, speaker: { fields: ['title'], populate: { organisation: { fields: ['name'] } } }, exhibitor: { populate: { organisation: { fields: ['name'] } } } },
    });
    if (!attendee || attendee.edition?.documentId !== edition.documentId || attendee.status !== 'active') throw new EspaceError(404, 'ATTENDEE_NOT_FOUND', 'Inscrit introuvable.');
    return attendee;
  }

  return {
    ensureToken,

    /** POST /admin/:edition/badges (F-97): { pdf, count, reduced } for the active attendees, filtered by type, sorted by name or company. */
    async generate(edition, { types, sort } = {}) {
      const roles = parseTypes(types);
      if (roles === undefined) throw validation({ types: 'Choisissez des types parmi participant, intervenant, exposant et organisateur.' });
      if (sort !== undefined && !['name', 'company'].includes(sort)) throw validation({ sort: 'Choisissez « name » ou « company ».' });

      const emails = organizerEmails();
      const everyone = await loaded({ edition: { documentId: edition.documentId }, status: 'active' });
      const wanted = sortAttendees(everyone.filter((attendee) => !roles || roles.includes(typeOf(attendee, emails))), sort);
      if (!wanted.length) throw new EspaceError(404, 'NO_BADGES', 'Aucun badge à générer pour ce choix.');

      const badges = [];
      for (const attendee of wanted) badges.push(await toBadge(attendee, edition, emails));
      const reduced = wanted.filter((attendee) => isReduced(attendee, typeOf(attendee, emails))).length;
      return { pdf: await buildBadgesPdf({ badges, ...(await context(edition)) }), count: wanted.length, reduced };
    },

    /** GET /admin/:edition/attendees/:id/badge (F-98): { pdf, filename } of one badge, for a reprint on the spot. */
    async single(edition, id) {
      const attendee = await findActive(edition, id);
      const badge = await toBadge(attendee, edition, organizerEmails());
      const name = normalizeText(`${attendee.firstName} ${attendee.lastName}`).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'participant';
      return { pdf: await buildBadgesPdf({ badges: [badge], ...(await context(edition)) }), filename: `badge-${name}.pdf` };
    },

    /** POST /admin/:edition/attendees/:id/card-token/regenerate (F-98, R-83): the old token stops working at once. -> { regeneratedAt } */
    async regenerate(edition, id) {
      const attendee = await findActive(edition, id);
      const { createdAt } = await ensureToken(attendee, { rotate: true });
      return { regeneratedAt: createdAt };
    },
  };
};
