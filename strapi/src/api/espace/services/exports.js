'use strict';

const { identity } = require('../lib/cards');
const { toCsv } = require('../lib/csv');
const { profileCompletion } = require('../lib/profile');

const ATTENDEE = 'api::espace.attendee';
const MEETING = 'api::espace.meeting';
const EXHIBITOR = 'api::espace.exhibitor';
const LIMIT = 10000;

const ROLE_LABEL = { participant: 'Participant', speaker: 'Intervenant', exhibitor_rep: 'Représentant d’exposant', organizer: 'Organisateur' };
const STATUS_LABEL = { pending: 'En attente', accepted: 'Confirmé', declined: 'Refusé', cancelled: 'Annulé', expired: 'Expiré' };
const PERSON_POPULATE = {
  photo: { fields: ['documentId'] },
  topics: { fields: ['name'] },
  exhibitor: { fields: ['documentId', 'standNumber'], populate: { organisation: { fields: ['name'] } } },
  speaker: { fields: ['name', 'title'], populate: { organisation: { fields: ['name'] } } },
};

const yesNo = (value) => (value ? 'oui' : 'non');
const fullName = (person) => [person?.firstName, person?.lastName].filter(Boolean).join(' ');
const byText = (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' });
const hourFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** "13h00", at Paris. */
const hour = (date) => (date ? hourFormat.format(new Date(date)).replace(':', 'h') : '');
const dateTime = (date) => (date ? dateFormat.format(new Date(date)) : '');
const startOf = (meeting) => new Date(meeting.slot?.startsAt ?? 0).getTime();

module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);

  /** Everything the three files read, in one pass: the registrants (never the organizers), the exhibitors and the meetings. */
  async function load(edition) {
    const ofEdition = { edition: { documentId: edition.documentId } };
    const [everyone, exhibitors, meetings] = await Promise.all([
      documents(ATTENDEE).findMany({ filters: ofEdition, populate: PERSON_POPULATE, limit: LIMIT }),
      documents(EXHIBITOR).findMany({ filters: ofEdition, populate: { organisation: { fields: ['name'] } }, limit: LIMIT }),
      documents(MEETING).findMany({
        filters: ofEdition,
        populate: {
          slot: { fields: ['startsAt', 'endsAt'], populate: { session: { fields: ['title'] } } },
          requester: { fields: ['documentId'] },
          targetAttendee: { fields: ['documentId'] },
          targetExhibitor: { fields: ['documentId'] },
          answeredBy: { fields: ['documentId', 'firstName', 'lastName'] },
        },
        limit: LIMIT,
      }),
    ]);
    const people = everyone.filter(({ role }) => role !== 'organizer');
    return {
      people: people.sort((a, b) => byText(`${a.lastName} ${a.firstName}`, `${b.lastName} ${b.firstName}`)),
      byId: new Map(everyone.map((person) => [person.documentId, person])),
      exhibitors,
      exhibitorById: new Map(exhibitors.map((exhibitor) => [exhibitor.documentId, exhibitor])),
      meetings: meetings.filter(({ slot }) => slot).sort((a, b) => startOf(a) - startOf(b)),
    };
  }

  const companyOf = (person) => identity(person).company ?? '';
  const standOf = (exhibitor) => (exhibitor?.standNumber ? `Stand ${exhibitor.standNumber}` : '');
  /** Where a meeting takes place: the place written at the acceptance, else the stand of the exhibitor asked. */
  const placeOf = (data, meeting) => meeting.location || standOf(data.exhibitorById.get(meeting.targetExhibitor?.documentId));

  /** The two sides of a meeting as the files name them: the person, or the exhibitor asked at its stand. */
  function sidesOf(data, meeting) {
    const requester = data.byId.get(meeting.requester?.documentId);
    const person = data.byId.get(meeting.targetAttendee?.documentId);
    const exhibitor = data.exhibitorById.get(meeting.targetExhibitor?.documentId);
    return {
      requester,
      person,
      targetName: person ? fullName(person) : (exhibitor?.organisation?.name ?? ''),
      targetCompany: person ? companyOf(person) : (exhibitor ? 'Exposant' : ''),
    };
  }

  function participants(data) {
    // Confirmed meetings of each person, in time order: "13h00, Inès Castaing (Scierie Fictive), Table 1". A stand meeting
    // goes to the requester and to the representative who answered.
    const confirmed = new Map();
    const add = (id, line) => id && confirmed.set(id, [...(confirmed.get(id) ?? []), line]);
    for (const meeting of data.meetings.filter(({ status }) => status === 'accepted')) {
      const { requester, person, targetName, targetCompany } = sidesOf(data, meeting);
      const line = (name, company) => [hour(meeting.slot.startsAt), company ? `${name} (${company})` : name, placeOf(data, meeting)].filter(Boolean).join(', ');
      add(requester?.documentId, line(targetName, person ? targetCompany : ''));
      if (requester) add(person?.documentId ?? meeting.answeredBy?.documentId, line(fullName(requester), companyOf(requester)));
    }

    const headers = ['Nom', 'Prénom', 'E-mail', 'Fonction', 'Entreprise', 'Rôle', 'Exposant représenté', 'Stand', 'Table dédiée', 'Page LinkedIn', 'Inscription', 'Espace activé', 'Dans l’annuaire', 'Reçoit des demandes', 'Profil complété (%)', 'Sujets', 'Nombre de rendez-vous confirmés', 'Rendez-vous confirmés'];
    const rows = data.people.map((person) => {
      const mine = confirmed.get(person.documentId) ?? [];
      const { jobTitle, company } = identity(person);
      return [
        person.lastName,
        person.firstName,
        person.email,
        jobTitle,
        company,
        ROLE_LABEL[person.role] ?? person.role,
        person.exhibitor?.organisation?.name,
        person.exhibitor?.standNumber,
        person.role === 'speaker' ? person.hostedTableNumber : null,
        person.linkedinUrl,
        person.status === 'active' ? 'active' : 'annulée',
        yesNo(person.activatedAt),
        yesNo(person.directoryOptIn),
        yesNo(person.meetingsOptIn),
        profileCompletion(person),
        (person.topics ?? []).map(({ name }) => name).sort(byText).join(', '),
        mine.length,
        mine.join('\n'),
      ];
    });
    return toCsv(headers, rows);
  }

  function meetings(data) {
    const headers = ['Heure', 'Fin', 'Plage', 'Statut', 'Lieu', 'Table', 'Demandeur', 'Entreprise du demandeur', 'E-mail du demandeur', 'Interlocuteur', 'Entreprise de l’interlocuteur', 'E-mail de l’interlocuteur', 'Répondu par', 'Demande créée le'];
    const rows = data.meetings.map((meeting) => {
      const { requester, person, targetName, targetCompany } = sidesOf(data, meeting);
      return [
        hour(meeting.slot.startsAt),
        hour(meeting.slot.endsAt),
        meeting.slot.session?.title,
        STATUS_LABEL[meeting.status] ?? meeting.status,
        placeOf(data, meeting),
        meeting.tableNumber,
        fullName(requester),
        requester ? companyOf(requester) : '',
        requester?.email,
        targetName,
        targetCompany,
        person?.email,
        fullName(meeting.answeredBy),
        dateTime(meeting.createdAt),
      ];
    });
    return toCsv(headers, rows);
  }

  function exhibitors(data) {
    const headers = ['Exposant', 'Stand', 'Représentants', 'Demandes reçues', 'Rendez-vous confirmés', 'Demandes en attente'];
    const rows = data.exhibitors
      .map((exhibitor) => {
        const asked = data.meetings.filter(({ targetExhibitor }) => targetExhibitor?.documentId === exhibitor.documentId);
        const reps = data.people.filter((person) => person.status === 'active' && person.exhibitor?.documentId === exhibitor.documentId);
        return [
          exhibitor.organisation?.name ?? '',
          exhibitor.standNumber,
          reps.map(fullName).join(', '),
          asked.length,
          asked.filter(({ status }) => status === 'accepted').length,
          asked.filter(({ status }) => status === 'pending').length,
        ];
      })
      .sort((a, b) => byText(a[0], b[0]));
    return toCsv(headers, rows);
  }

  /** The indicators of the dashboard, one per line, so that the file and the screen always agree (F-90). */
  async function stats(edition) {
    const s = await strapi.service('api::espace.stats').compute(edition);
    const rows = [
      ['Inscrits', s.attendees.total],
      ['Inscriptions actives', s.attendees.active],
      ['Inscriptions annulées', s.attendees.cancelled],
      ['Participants', s.attendees.byRole.participant],
      ['Intervenants', s.attendees.byRole.speaker],
      ['Représentants d’exposant', s.attendees.byRole.exhibitor_rep],
      ['Espaces activés', s.activated],
      ['Consentements enregistrés', s.consented],
      ['Présents dans l’annuaire', s.directoryOptIn],
      ['Profils complets', s.profilesComplete],
      ...Object.entries(s.meetings).map(([status, count]) => [`Rendez-vous : ${(STATUS_LABEL[status] ?? status).toLowerCase()}`, count]),
      ['Messages échangés', s.messages],
      ...s.slots.map((slot) => [`Créneau ${slot.label} (${slot.sessionTitle}) : confirmés`, slot.accepted]),
    ];
    return toCsv(['Indicateur', 'Valeur'], rows);
  }

  const FILES = { participants, meetings, exhibitors };

  return {
    names: [...Object.keys(FILES), 'stats'],

    /**
     * GET /admin/:edition/export/:name.csv (F-91) -> { filename, body }, or null when the name is not one of the four files.
     * Personal data for the organizer only (e-mail included, it is the registration list). Never the text of a request nor of a message (R-63).
     */
    async build(edition, name) {
      if (name !== 'stats' && !FILES[name]) return null;
      const body = name === 'stats' ? await stats(edition) : FILES[name](await load(edition));
      const french = { participants: 'participants', meetings: 'rendez-vous', exhibitors: 'exposants', stats: 'statistiques' }[name];
      return { filename: `${edition.slug}-${french}.csv`, body };
    },
  };
};
