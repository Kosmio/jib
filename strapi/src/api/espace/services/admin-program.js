'use strict';

const { EspaceError } = require('../lib/errors');
const { ACTIVE_STATUSES } = require('../lib/admin-guards');
const { cleanRichText } = require('../lib/rich-text');
const { parseProgramTime } = require('../lib/time');
const { isReadOnly } = require('../lib/read-only');
const { uniqueSlug } = require('../lib/people');

const SEQUENCE = 'api::sequence.sequence';
const INTERVENTION = 'api::intervention.intervention';
const INTERVENANT = 'api::intervenant.intervenant';
const ORGANISATION = 'api::organisation.organisation';
const MEETING = 'api::espace.meeting';

const KINDS = ['talk', 'b2b_break', 'other'];
const THEMES = ['foret', 'industrie', 'coproduits', 'ville', 'construction'];
const link = (documentId) => (documentId ? { documentId } : null);
const ids = (items) => (items ?? []).map((item) => item.documentId).sort();
const minutesOf = (value) => {
  const time = parseProgramTime(value);
  return time ? time.hours * 60 + time.minutes : Number.POSITIVE_INFINITY;
};

/** What the public page shows of each document: two versions with the same signature show the same thing. */
const SIGNATURES = {
  sequence: (d) => JSON.stringify([d.title, d.subtitle, d.start_time, d.end_time, d.kind, d.theme, d.description, d.order, ids(d.organisations)]),
  intervention: (d) => JSON.stringify([d.description, d.order, d.sequence?.documentId ?? null, ids(d.intervenants)]),
  intervenant: (d) => JSON.stringify([d.name, d.title, d.bio, d.topic, d.linkedin_url, d.organisation?.documentId ?? null]),
};

const stateOf = (kind, draft, published) => (!published ? 'new' : SIGNATURES[kind](draft) === SIGNATURES[kind](published) ? 'published' : 'modified');

async function guarded(action) {
  try {
    return await action();
  } catch (error) {
    if (error?.name === 'ApplicationError' || error?.name === 'ValidationError') throw new EspaceError(409, 'REFUSED', error.message);
    throw error;
  }
}

const validation = (fields) => new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields });
const text = (value, max) => (value === null || value === undefined ? null : String(value).trim().slice(0, max) || null);

/** Fields of a sequence (F-160) -> { data, errors } ; only the given ones on an update. Times follow R-86. */
function readSequence(body = {}, { partial, current = {} }) {
  const data = {};
  const errors = {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  if (!partial || has('title')) {
    const title = text(body.title, 200);
    if (!title) errors.title = 'Indiquez le titre de la séquence.';
    else data.title = title;
  }
  if (has('subtitle')) data.subtitle = text(body.subtitle, 200);
  for (const [key, attribute, label] of [
    ['startTime', 'start_time', 'début'],
    ['endTime', 'end_time', 'fin'],
  ]) {
    if (!has(key) && partial) continue;
    const value = text(body[key], 20);
    if (value && !parseProgramTime(value)) errors[key] = `Heure de ${label} illisible : écrivez-la comme 9h15 ou 10:45.`;
    else data[attribute] = value;
  }
  if (!errors.startTime && !(data.start_time ?? current.start_time)) errors.startTime = 'Indiquez l’heure de début.';
  if (has('kind')) {
    if (!KINDS.includes(body.kind)) errors.kind = 'Nature inconnue.';
    else data.kind = body.kind;
  }
  if (has('theme')) {
    if (body.theme && !THEMES.includes(body.theme)) errors.theme = 'Thème inconnu.';
    else data.theme = body.theme || null;
  }
  if (has('description')) data.description = cleanRichText(body.description);
  const kind = data.kind ?? current.kind;
  const start = data.start_time !== undefined ? data.start_time : current.start_time;
  const end = data.end_time !== undefined ? data.end_time : current.end_time;
  if (kind === 'b2b_break' && !errors.endTime && !parseProgramTime(end)) errors.endTime = 'Une pause B2B a besoin d’une heure de fin (R-86).';
  if (!errors.endTime && !errors.startTime && parseProgramTime(start) && parseProgramTime(end) && minutesOf(end) <= minutesOf(start)) {
    errors.endTime = 'La fin doit venir après le début.';
  }
  return { data, errors };
}

/**
 * Program editor of the organizer interface (15-administration.md, AD-3): sequences, interventions and speakers are written on
 * their Strapi draft (D-22) and the public page only changes with « Publier le programme ». A deletion is immediate (Strapi removes
 * every version) and is confirmed on screen. Rich texts are cleaned (NF-72) ; each write checks the version read (NF-75).
 */
module.exports = ({ strapi }) => {
  const ofEdition = (edition) => ({ edition: { documentId: edition.documentId } });
  const docs = (uid) => strapi.documents(uid);

  function refuseReadOnly(edition) {
    if (isReadOnly(edition)) throw new EspaceError(409, 'EDITION_READ_ONLY', 'L’édition est terminée : son programme ne se modifie plus ici.');
  }
  function refuseStale(stored, sent, what) {
    if (sent && stored && new Date(stored).getTime() !== new Date(sent).getTime()) {
      throw new EspaceError(409, 'STALE', `${what} a été modifiée entre-temps (par un autre organisateur ou dans Strapi). Rechargez le programme pour voir la dernière version.`);
    }
  }

  const SEQUENCE_POPULATE = { organisations: { fields: ['name'] } };
  const INTERVENTION_POPULATE = { sequence: { fields: ['documentId'] }, intervenants: { fields: ['name', 'title'], populate: { organisation: { fields: ['name'] } } }, presentation: { fields: ['name', 'url'] } };

  async function load(edition) {
    const [draftSequences, publishedSequences] = await Promise.all(
      ['draft', 'published'].map((status) => docs(SEQUENCE).findMany({ filters: ofEdition(edition), status, populate: SEQUENCE_POPULATE, limit: 500 }))
    );
    const sequenceIds = draftSequences.map((sequence) => sequence.documentId);
    const [draftInterventions, publishedInterventions] = await Promise.all(
      ['draft', 'published'].map((status) =>
        sequenceIds.length ? docs(INTERVENTION).findMany({ filters: { sequence: { documentId: { $in: sequenceIds } } }, status, populate: INTERVENTION_POPULATE, limit: 2000 }) : []
      )
    );
    const speakerIds = [...new Set(draftInterventions.flatMap((intervention) => ids(intervention.intervenants)))];
    const [draftSpeakers, publishedSpeakers] = await Promise.all(
      ['draft', 'published'].map((status) =>
        speakerIds.length ? docs(INTERVENANT).findMany({ filters: { documentId: { $in: speakerIds } }, status, populate: { organisation: { fields: ['name'] }, photo: { fields: ['url'] } }, limit: 2000 }) : []
      )
    );
    const index = (list) => new Map(list.map((item) => [item.documentId, item]));
    return {
      sequences: { draft: draftSequences, published: index(publishedSequences) },
      interventions: { draft: draftInterventions, published: index(publishedInterventions) },
      speakers: { draft: index(draftSpeakers), published: index(publishedSpeakers) },
    };
  }

  async function read(edition) {
    const world = await load(edition);
    const speakerView = (id) => {
      const draft = world.speakers.draft.get(id);
      if (!draft) return null;
      return {
        id,
        name: draft.name ?? '',
        title: draft.title ?? '',
        organisation: draft.organisation ? { id: draft.organisation.documentId, name: draft.organisation.name ?? '' } : null,
        bio: draft.bio ?? '',
        topic: draft.topic ?? '',
        linkedinUrl: draft.linkedin_url ?? '',
        photoUrl: draft.photo?.url ?? null,
        state: stateOf('intervenant', draft, world.speakers.published.get(id)),
        updatedAt: draft.updatedAt,
      };
    };
    const interventionsOf = (sequenceId) =>
      world.interventions.draft
        .filter((intervention) => intervention.sequence?.documentId === sequenceId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)
        .map((intervention) => ({
          id: intervention.documentId,
          description: intervention.description ?? '',
          order: intervention.order ?? 0,
          presentation: intervention.presentation ? { name: intervention.presentation.name, url: intervention.presentation.url } : null,
          speakers: ids(intervention.intervenants).map(speakerView).filter(Boolean),
          state: stateOf('intervention', intervention, world.interventions.published.get(intervention.documentId)),
          updatedAt: intervention.updatedAt,
        }));
    const sequences = world.sequences.draft
      .sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time) || (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)
      .map((sequence) => ({
        id: sequence.documentId,
        title: sequence.title ?? '',
        subtitle: sequence.subtitle ?? '',
        startTime: sequence.start_time ?? '',
        endTime: sequence.end_time ?? '',
        kind: sequence.kind ?? 'talk',
        theme: sequence.theme ?? '',
        description: sequence.description ?? '',
        order: sequence.order ?? 0,
        organisations: (sequence.organisations ?? []).map((organisation) => ({ id: organisation.documentId, name: organisation.name ?? '' })),
        state: stateOf('sequence', sequence, world.sequences.published.get(sequence.documentId)),
        updatedAt: sequence.updatedAt,
        interventions: interventionsOf(sequence.documentId),
      }));
    const changes = [];
    for (const sequence of sequences) {
      if (sequence.state !== 'published') changes.push({ kind: 'sequence', id: sequence.id, label: sequence.title, state: sequence.state });
      for (const intervention of sequence.interventions) {
        if (intervention.state !== 'published') changes.push({ kind: 'intervention', id: intervention.id, label: `Intervention de « ${sequence.title} »`, state: intervention.state });
      }
    }
    const seen = new Set();
    for (const sequence of sequences)
      for (const intervention of sequence.interventions)
        for (const speaker of intervention.speakers) {
          if (speaker.state !== 'published' && !seen.has(speaker.id)) {
            seen.add(speaker.id);
            changes.push({ kind: 'intervenant', id: speaker.id, label: speaker.name, state: speaker.state });
          }
        }
    return { editionId: edition.documentId, themes: THEMES, sequences, changes };
  }

  async function sequenceOf(edition, documentId) {
    const sequence = await docs(SEQUENCE).findFirst({ filters: { documentId, ...ofEdition(edition) }, status: 'draft' });
    if (!sequence) throw new EspaceError(404, 'SEQUENCE_NOT_FOUND', 'Séquence introuvable dans cette édition.');
    return sequence;
  }
  async function interventionOf(edition, documentId) {
    const intervention = await docs(INTERVENTION).findFirst({ filters: { documentId, sequence: ofEdition(edition) }, status: 'draft', populate: { sequence: { fields: ['documentId'] } } });
    if (!intervention) throw new EspaceError(404, 'INTERVENTION_NOT_FOUND', 'Intervention introuvable dans cette édition.');
    return intervention;
  }
  const activeMeetingsOn = (sequenceId, statuses = ACTIVE_STATUSES) => strapi.documents(MEETING).count({ filters: { status: { $in: statuses }, slot: { session: { documentId: sequenceId } } } });

  /** Moves `documentId` one step up or down in `siblings` (sorted), by swapping the two `order` values (F-161). */
  async function swap(uid, siblings, documentId, direction) {
    const position = siblings.findIndex((item) => item.documentId === documentId);
    const other = siblings[position + (direction === 'up' ? -1 : 1)];
    if (position === -1 || !other) return;
    const mine = siblings[position];
    const [a, b] = [mine.order ?? position, other.order ?? position + (direction === 'up' ? -1 : 1)];
    await docs(uid).update({ documentId: mine.documentId, data: { order: a === b ? b + (direction === 'up' ? -1 : 1) : b } });
    await docs(uid).update({ documentId: other.documentId, data: { order: a } });
  }

  async function speakerIds(list) {
    if (!Array.isArray(list)) return undefined;
    const unique = [...new Set(list.filter((id) => typeof id === 'string'))];
    if (!unique.length) return [];
    const found = await docs(INTERVENANT).findMany({ filters: { documentId: { $in: unique } }, status: 'draft', fields: ['documentId'] });
    if (found.length !== unique.length) throw new EspaceError(404, 'INTERVENANT_NOT_FOUND', 'Un intervenant choisi n’existe plus. Rechargez le programme.');
    return unique;
  }

  return {
    read,

    async createSequence(edition, body = {}) {
      refuseReadOnly(edition);
      const { data, errors } = readSequence({ kind: 'talk', ...body }, { partial: false });
      if (Object.keys(errors).length) throw validation(errors);
      const last = await docs(SEQUENCE).findMany({ filters: ofEdition(edition), status: 'draft', sort: ['order:desc'], fields: ['order'], limit: 1 });
      await docs(SEQUENCE).create({ data: { ...data, order: (last[0]?.order ?? 0) + 1, edition: link(edition.documentId) } });
      return read(edition);
    },

    /** PATCH /sequences/{id}: F-160, F-165 ; R-93 (nature of a break with meetings) and R-94 (times of a break with accepted meetings). */
    async updateSequence(edition, documentId, body = {}) {
      refuseReadOnly(edition);
      const current = await sequenceOf(edition, documentId);
      refuseStale(current.updatedAt, body.updatedAt, 'Cette séquence');
      const { data, errors } = readSequence(body, { partial: true, current });
      if (Object.keys(errors).length) throw validation(errors);
      if (current.kind === 'b2b_break' && data.kind !== undefined && data.kind !== 'b2b_break') {
        const active = await activeMeetingsOn(documentId);
        if (active) throw new EspaceError(409, 'BREAK_HAS_MEETINGS', `Cette pause porte ${active} rendez-vous en attente ou acceptés : elle reste une pause B2B tant qu’ils ne sont pas déplacés ou annulés (Vue B2B).`, { meetings: active });
      }
      const timesChange = (data.start_time !== undefined && data.start_time !== current.start_time) || (data.end_time !== undefined && data.end_time !== current.end_time);
      if (current.kind === 'b2b_break' && timesChange) {
        const accepted = await activeMeetingsOn(documentId, ['accepted']);
        if (accepted) throw new EspaceError(409, 'BREAK_HAS_MEETINGS', `Cette pause porte ${accepted} rendez-vous acceptés : ses horaires ne changent pas tant qu’ils ne sont pas déplacés ou annulés (Vue B2B).`, { meetings: accepted });
      }
      if (body.move === 'up' || body.move === 'down') {
        const siblings = (await docs(SEQUENCE).findMany({ filters: ofEdition(edition), status: 'draft', fields: ['order', 'start_time'], limit: 500 }))
          .filter((sequence) => minutesOf(sequence.start_time) === minutesOf(current.start_time))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id);
        await swap(SEQUENCE, siblings, documentId, body.move);
      }
      if (Object.keys(data).length) await guarded(() => docs(SEQUENCE).update({ documentId, data }));
      return read(edition);
    },

    /** DELETE /sequences/{id}: its interventions go with it ; NF-63 refuses a break whose slots carry active meetings (R-93). */
    async deleteSequence(edition, documentId) {
      refuseReadOnly(edition);
      const sequence = await sequenceOf(edition, documentId);
      if (sequence.kind === 'b2b_break') {
        const active = await activeMeetingsOn(documentId);
        if (active) throw new EspaceError(409, 'BREAK_HAS_MEETINGS', `Cette pause porte ${active} rendez-vous en attente ou acceptés : déplacez-les ou annulez-les d’abord (Vue B2B).`, { meetings: active });
      }
      const interventions = await docs(INTERVENTION).findMany({ filters: { sequence: { documentId } }, status: 'draft', fields: ['documentId'] });
      await guarded(async () => {
        for (const intervention of interventions) await docs(INTERVENTION).delete({ documentId: intervention.documentId });
        await docs(SEQUENCE).delete({ documentId });
      });
      return read(edition);
    },

    async createIntervention(edition, sequenceId, body = {}) {
      refuseReadOnly(edition);
      await sequenceOf(edition, sequenceId);
      const intervenants = (await speakerIds(body.speakers)) ?? [];
      const siblings = await docs(INTERVENTION).findMany({ filters: { sequence: { documentId: sequenceId } }, status: 'draft', fields: ['order'], sort: ['order:desc'], limit: 1 });
      await docs(INTERVENTION).create({
        data: { description: cleanRichText(body.description), order: (siblings[0]?.order ?? 0) + 1, sequence: link(sequenceId), intervenants: intervenants.map(link) },
      });
      return read(edition);
    },

    /** PATCH /interventions/{id}: `description`, `speakers` (documentIds, in order), `move` ('up' or 'down'), `updatedAt`. */
    async updateIntervention(edition, documentId, body = {}) {
      refuseReadOnly(edition);
      const current = await interventionOf(edition, documentId);
      refuseStale(current.updatedAt, body.updatedAt, 'Cette intervention');
      const data = {};
      if (Object.prototype.hasOwnProperty.call(body, 'description')) data.description = cleanRichText(body.description);
      const speakers = await speakerIds(body.speakers);
      if (speakers) data.intervenants = speakers.map(link);
      if (body.move === 'up' || body.move === 'down') {
        const siblings = (await docs(INTERVENTION).findMany({ filters: { sequence: { documentId: current.sequence.documentId } }, status: 'draft', fields: ['order'], limit: 200 })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id);
        await swap(INTERVENTION, siblings, documentId, body.move);
      }
      if (Object.keys(data).length) await docs(INTERVENTION).update({ documentId, data });
      return read(edition);
    },

    /** DELETE /interventions/{id}: R-95, neither the speaker's sheet nor the person's account is removed. */
    async deleteIntervention(edition, documentId) {
      refuseReadOnly(edition);
      await interventionOf(edition, documentId);
      await docs(INTERVENTION).delete({ documentId });
      return read(edition);
    },

    /** POST /intervenants (F-163): a new speaker sheet, on its draft ; published with the program. -> { id } */
    async createIntervenant(edition, body = {}) {
      refuseReadOnly(edition);
      const data = await this.readIntervenant(body, { partial: false });
      const taken = new Set((await docs(INTERVENANT).findMany({ fields: ['slug'], limit: 10000 })).map((item) => item.slug));
      const created = await docs(INTERVENANT).create({ data: { ...data, slug: uniqueSlug(data.name, taken) } });
      return { id: created.documentId };
    },

    async updateIntervenant(edition, documentId, body = {}) {
      refuseReadOnly(edition);
      const current = await docs(INTERVENANT).findOne({ documentId, status: 'draft' });
      if (!current) throw new EspaceError(404, 'INTERVENANT_NOT_FOUND', 'Intervenant introuvable.');
      refuseStale(current.updatedAt, body.updatedAt, 'Cette fiche intervenant');
      const data = await this.readIntervenant(body, { partial: true });
      if (Object.keys(data).length) await docs(INTERVENANT).update({ documentId, data });
      return read(edition);
    },

    /** Fields of a speaker sheet: name, title, organisation (documentId), bio (rich text), linkedinUrl, topic. */
    async readIntervenant(body, { partial }) {
      const data = {};
      const errors = {};
      const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
      if (!partial || has('name')) {
        const name = text(body.name, 150);
        if (!name) errors.name = 'Indiquez le nom de l’intervenant.';
        else data.name = name;
      }
      if (has('title')) data.title = text(body.title, 200);
      if (has('topic')) data.topic = text(body.topic, 200);
      if (has('bio')) data.bio = cleanRichText(body.bio);
      if (has('linkedinUrl')) {
        const value = text(body.linkedinUrl, 300);
        if (value && !/^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(value)) errors.linkedinUrl = 'Indiquez une page linkedin.com.';
        else data.linkedin_url = value;
      }
      if (has('organisation')) {
        if (body.organisation) {
          const organisation = await docs(ORGANISATION).findOne({ documentId: body.organisation, status: 'published' });
          if (!organisation) errors.organisation = 'Organisation introuvable.';
        }
        data.organisation = link(body.organisation || null);
      }
      if (Object.keys(errors).length) throw validation(errors);
      return data;
    },

    /**
     * POST /program/publish (D-22, F-164): publishes every new or modified speaker, sequence and intervention of the edition, in this
     * order so that each relation finds its target published. -> { published: { sequences, interventions, intervenants }, breaksChanged }
     */
    async publish(edition) {
      refuseReadOnly(edition);
      const program = await read(edition);
      const pending = (kind) => program.changes.filter((change) => change.kind === kind).map((change) => change.id);
      const before = new Map((await docs(SEQUENCE).findMany({ filters: ofEdition(edition), status: 'published', fields: ['kind', 'start_time', 'end_time'], limit: 500 })).map((s) => [s.documentId, s]));
      const breaksChanged = program.sequences.some((sequence) => {
        const old = before.get(sequence.id);
        const wasBreak = old?.kind === 'b2b_break';
        const isBreak = sequence.kind === 'b2b_break';
        return wasBreak !== isBreak || (isBreak && (old.start_time !== sequence.startTime || old.end_time !== sequence.endTime));
      });
      const published = { intervenants: pending('intervenant'), sequences: pending('sequence'), interventions: pending('intervention') };
      await guarded(async () => {
        for (const documentId of published.intervenants) await docs(INTERVENANT).publish({ documentId });
        for (const documentId of published.sequences) await docs(SEQUENCE).publish({ documentId });
        for (const documentId of published.interventions) await docs(INTERVENTION).publish({ documentId });
      });
      return {
        published: { sequences: published.sequences.length, interventions: published.interventions.length, intervenants: published.intervenants.length },
        breaksChanged,
        program: await read(edition),
      };
    },
  };
};
