'use strict';

const ROLE_LABELS = {
  soutien: 'Soutien',
  'co-organisateur': 'Co-organisateur',
  institutionnel: 'Institutionnel',
  prive: 'Privé',
};

/**
 * After a partenariat is created or updated, recompute display_name
 * from the linked organisation's name + role label.
 */
async function refreshDisplayName(event) {
  const { result } = event;
  if (!result || !result.id) return;

  // Fetch the full entry with organisation populated
  const entry = await strapi.db.query('api::partenaire.partenaire').findOne({
    where: { id: result.id },
    populate: ['organisation'],
  });

  if (!entry) return;

  const orgName = entry.organisation?.name;
  const roleLabel = ROLE_LABELS[entry.role] || entry.role || '';
  const displayName = orgName ? `${orgName} — ${roleLabel}` : roleLabel;

  if (entry.display_name !== displayName) {
    await strapi.db.query('api::partenaire.partenaire').update({
      where: { id: entry.id },
      data: { display_name: displayName },
    });
  }
}

module.exports = {
  afterCreate: refreshDisplayName,
  afterUpdate: refreshDisplayName,
};
