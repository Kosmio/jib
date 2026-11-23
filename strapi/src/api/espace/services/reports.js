'use strict';

const { EspaceError } = require('../lib/errors');
const { linkUrl } = require('../lib/tokens');

const REPORT = 'api::espace.message-report';
const MESSAGE = 'api::espace.message';
const ATTENDEE = 'api::espace.attendee';
const REASON_MAX_LENGTH = 500;
const LIMIT = 5000;
const ACTION_LINK_MINUTES = 72 * 60;

const link = ({ documentId }) => ({ documentId });
const fullName = (person) => [person?.firstName, person?.lastName].filter(Boolean).join(' ') || 'Participant supprimé';
const messageNotFound = () => new EspaceError(404, 'MESSAGE_NOT_FOUND', 'Message introuvable.');
const reportNotFound = () => new EspaceError(404, 'REPORT_NOT_FOUND', 'Signalement introuvable.');

/** F-75: the reason of a report -> trimmed text ; 400 VALIDATION with `fields.reason` when it is not a text, empty or over 500 characters. */
function validateReason(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  let problem;
  if (!text) problem = 'Indiquez le motif du signalement.';
  else if (text.length > REASON_MAX_LENGTH) problem = `Le motif ne peut pas dépasser ${REASON_MAX_LENGTH} caractères.`;
  if (problem) throw new EspaceError(400, 'VALIDATION', 'Corrigez les champs signalés.', { fields: { reason: problem } });
  return text;
}

/**
 * Reports of a message (F-75, R-63). The organization reads the text of the reported message and nothing else of the conversation ;
 * the e-mail to the organizers carries no content at all.
 */
module.exports = ({ strapi }) => {
  const documents = (uid) => strapi.documents(uid);
  const organizerEmails = () => strapi.config.get('server.espace').organizerEmails.map((email) => email.trim().toLowerCase());

  async function editionOf(slug) {
    const edition = await strapi.service('api::espace.editions').findPublished(slug);
    if (!edition) throw new EspaceError(404, 'EDITION_NOT_FOUND', 'Édition introuvable.');
    return edition;
  }

  /** The e-mail `message-report` to the active organizers of the edition. A failure never reaches the person who reported. */
  async function notifyOrganizers(edition, report, now) {
    try {
      const publicUrl = strapi.config.get('server.espace.publicUrl');
      const emails = organizerEmails();
      const people = await documents(ATTENDEE).findMany({ filters: { edition: { documentId: edition.documentId }, status: 'active' }, limit: LIMIT });
      const organizers = people.filter((person) => person.role === 'organizer' || emails.includes(String(person.email).toLowerCase()));
      for (const organizer of organizers) {
        const token = await strapi.service('api::espace.tokens').issueLink(organizer.documentId, { ttlMinutes: ACTION_LINK_MINUTES, now });
        await strapi.service('api::espace.mailer').send({
          attendee: organizer,
          template: 'message-report',
          scenarioKey: `message-report:${report.documentId}`,
          now,
          data: {
            edition: { slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color },
            publicUrl,
            firstName: organizer.firstName,
            pilotageUrl: linkUrl({ publicUrl, token, next: `/espace/${edition.slug}/organisateur` }),
          },
        });
      }
    } catch (failure) {
      strapi.log.error(`[reports] message-report e-mail not sent: ${String(failure.message).split('\n')[0]}`);
    }
  }

  return {
    /**
     * POST /conversations/:id/messages/:messageId/report (F-75): 201 { id, status }. 404 MESSAGE_NOT_FOUND unless the message was received
     * by the viewer in one of his conversations (R-63), 409 ALREADY_REPORTED for a second report of the same message by the same person.
     */
    async report(session, conversationId, messageId, body, { now = new Date() } = {}) {
      const reason = validateReason(body?.reason);
      const { edition, attendee: me } = session;

      const conversation = await documents('api::espace.conversation').findOne({
        documentId: String(conversationId),
        populate: { edition: { fields: ['documentId'] }, participants: { fields: ['documentId'] } },
      });
      if (!conversation || conversation.edition?.documentId !== edition.documentId || !conversation.participants.some(({ documentId }) => documentId === me.documentId)) {
        throw messageNotFound();
      }
      const message = await documents(MESSAGE).findOne({
        documentId: String(messageId),
        populate: { author: { fields: ['documentId'] }, conversation: { fields: ['documentId'] } },
      });
      if (!message || message.conversation?.documentId !== conversation.documentId || !message.author || message.author.documentId === me.documentId) throw messageNotFound();

      const created = await strapi.service('api::espace.locks').withLock(`report:${me.documentId}`, async () => {
        const known = await documents(REPORT).count({ filters: { author: { documentId: me.documentId }, message: { documentId: message.documentId } } });
        if (known) throw new EspaceError(409, 'ALREADY_REPORTED', 'Vous avez déjà signalé ce message.');
        return documents(REPORT).create({
          data: { edition: link(edition), message: link(message), author: link(me), reason, status: 'open' },
        });
      });

      await notifyOrganizers(edition, created, now);
      return { id: created.documentId, status: created.status };
    },

    /**
     * GET /admin/:edition/reports (R-63): { open, handled }, the latest first. Each report: { id, status, at, handledAt, reason,
     * reporter: { name }, reported: { name }, message: { body } }. The text of the reported message is the only message content read.
     */
    async list(slug) {
      const edition = await editionOf(slug);
      const reports = await documents(REPORT).findMany({
        filters: { edition: { documentId: edition.documentId } },
        populate: { author: { fields: ['firstName', 'lastName'] }, message: { fields: ['body'], populate: { author: { fields: ['firstName', 'lastName'] } } } },
        sort: ['createdAt:desc', 'id:desc'],
        limit: LIMIT,
      });
      const rows = reports.map((report) => ({
        id: report.documentId,
        status: report.status,
        at: report.createdAt,
        handledAt: report.handledAt ?? null,
        reason: report.reason,
        reporter: { name: fullName(report.author) },
        reported: { name: fullName(report.message?.author) },
        message: { body: report.message?.body ?? null },
      }));
      return { open: rows.filter(({ status }) => status === 'open'), handled: rows.filter(({ status }) => status === 'handled') };
    },

    /** POST /admin/:edition/reports/:id/handle: { id, status: 'handled', handledAt } ; a report already handled keeps its date. */
    async handle(slug, id, { now = new Date() } = {}) {
      const edition = await editionOf(slug);
      const report = await documents(REPORT).findOne({ documentId: String(id), populate: { edition: { fields: ['documentId'] } } });
      if (!report || report.edition?.documentId !== edition.documentId) throw reportNotFound();
      if (report.status === 'handled') return { id: report.documentId, status: 'handled', handledAt: report.handledAt };
      const updated = await documents(REPORT).update({ documentId: report.documentId, data: { status: 'handled', handledAt: now } });
      return { id: updated.documentId, status: 'handled', handledAt: updated.handledAt };
    },
  };
};
