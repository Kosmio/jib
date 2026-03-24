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

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'edition.lieu': EditionLieu;
    }
  }
}
