import type { Schema, Struct } from '@strapi/strapi';

export interface EditionLieu extends Struct.ComponentSchema {
  collectionName: 'components_edition_lieux';
  info: {
    displayName: 'Lieu';
    icon: 'pin-map';
  };
  attributes: {
    address: Schema.Attribute.Text & Schema.Attribute.Required;
    description: Schema.Attribute.Text;
    map_url: Schema.Attribute.String;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    time_slot: Schema.Attribute.String;
  };
}

export interface HomeFeatureCard extends Struct.ComponentSchema {
  collectionName: 'components_home_feature_cards';
  info: {
    displayName: 'Carte th\u00E9matique (home)';
    icon: 'grid';
  };
  attributes: {
    description: Schema.Attribute.Text & Schema.Attribute.Required;
    icon: Schema.Attribute.Enumeration<
      ['ia', 'circular', 'finance', 'research', 'networking', 'wood']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'ia'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'edition.lieu': EditionLieu;
      'home.feature-card': HomeFeatureCard;
    }
  }
}
