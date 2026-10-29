'use strict';

const { formatTimeLabel } = require('../lib/time');
const { linkUrl } = require('../lib/tokens');

const MEETING = 'api::espace.meeting';
const ACTION_LINK_MINUTES = 72 * 60;
const dayFormat = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' });

/** "jeudi 3 décembre à 10h45" */
const slotLabelOf = (startsAt) => `${dayFormat.format(new Date(startsAt))} à ${formatTimeLabel(new Date(startsAt))}`;

module.exports = ({ strapi }) => ({
  /**
   * R-18, T-06: the pending and accepted meetings an attendee asked for or received personally become `cancelled` (table released:
   * `tableKey` back to null), and the other party is told by `meeting-cancelled` : the requester, the personal target, or the
   * active representatives of the targeted exhibitor. Meetings aimed at the exhibitor the attendee represents stay (R-14).
   * Idempotent: a cancelled meeting is not found again. Phase 2 completes this service.
   */
  async cancelForAttendee(attendee, { reason = 'Inscription annulée', now = new Date() } = {}) {
    const self = { documentId: attendee.documentId };
    const meetings = await strapi.documents(MEETING).findMany({
      filters: { status: { $in: ['pending', 'accepted'] }, $or: [{ requester: self }, { targetAttendee: self }] },
      populate: {
        edition: { fields: ['documentId'] },
        slot: true,
        requester: true,
        targetAttendee: true,
        targetExhibitor: { populate: { representatives: true } },
      },
      limit: 1000,
    });
    if (!meetings.length) return;

    const publicUrl = strapi.config.get('server.espace.publicUrl');
    const edition = await strapi.documents('api::edition.edition').findOne({ documentId: meetings[0].edition.documentId, status: 'published' });
    const counterpartName = `${attendee.firstName} ${attendee.lastName}`;

    for (const meeting of meetings) {
      await strapi.documents(MEETING).update({
        documentId: meeting.documentId,
        data: { status: 'cancelled', cancelledAt: now, cancelReason: reason, tableKey: null },
      });

      const isRequester = meeting.requester.documentId === attendee.documentId;
      const others = isRequester ? (meeting.targetAttendee ? [meeting.targetAttendee] : meeting.targetExhibitor?.representatives ?? []) : [meeting.requester];
      for (const recipient of others.filter(({ status }) => status === 'active')) {
        const token = await strapi.service('api::espace.tokens').issueLink(recipient.documentId, { ttlMinutes: ACTION_LINK_MINUTES, now });
        await strapi.service('api::espace.mailer').send({
          attendee: recipient,
          template: 'meeting-cancelled',
          scenarioKey: `meeting-cancelled:${meeting.documentId}`,
          now,
          data: {
            edition: { slug: edition.slug, title: edition.title, themeColor: edition.hero_bg_color },
            publicUrl,
            firstName: recipient.firstName,
            slotLabel: slotLabelOf(meeting.slot.startsAt),
            counterpartName,
            agendaUrl: linkUrl({ publicUrl, token, next: `/espace/${edition.slug}/agenda` }),
          },
        });
      }
    }
  },
});
