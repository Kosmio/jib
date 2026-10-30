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

module.exports = { profileCompletion };
