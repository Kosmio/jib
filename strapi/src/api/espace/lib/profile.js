'use strict';

const filled = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * R-30: completion of a profile, as a whole percentage. First name, last name and company give 40 together
 * (always present after the import), then 15 each for the job title, the photo, the presentation and at least one topic.
 * `topics` is the list of the topics of the attendee (or their count), `photo` anything truthy (file or URL).
 */
function profileCompletion({ firstName, lastName, company, jobTitle, photo, bio, topics } = {}) {
  const topicCount = Array.isArray(topics) ? topics.length : Number(topics) || 0;
  return (
    (filled(firstName) && filled(lastName) && filled(company) ? 40 : 0) +
    (filled(jobTitle) ? 15 : 0) +
    (photo ? 15 : 0) +
    (filled(bio) ? 15 : 0) +
    (topicCount > 0 ? 15 : 0)
  );
}

const LINKEDIN_MAX_LENGTH = 200;

/**
 * D-09: address of a LinkedIn page as the profile keeps it. "linkedin.com/in/lea" and "http://www.linkedin.com/in/lea?x=1"
 * both give "https://www.linkedin.com/in/lea" style addresses: https, no query, no fragment.
 * -> '' when nothing is given, null when the text is not a page of linkedin.com (or is longer than 200 characters).
 */
function normalizeLinkedin(value) {
  const given = typeof value === 'string' ? value.trim() : '';
  if (!given) return '';
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(given) ? given : `https://${given}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if ((host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) || url.pathname.length < 2) return null;
  const address = `https://${host}${url.pathname}`;
  return address.length <= LINKEDIN_MAX_LENGTH ? address : null;
}

module.exports = { profileCompletion, normalizeLinkedin };
