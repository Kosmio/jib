export interface Entity {
  id: string;
  attributes: {
    createdAt: string;
    updatedAt: string;
    publishedAt?: string;
  };
}

export interface Response<T extends Entity> {
  data: T;
  meta: any;
}

export interface Responses<T extends Entity> {
  data: T[];
  meta: {
    pagination?: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
}

export type Image = Entity & {
  attributes: {
    name: string;
    alternativeText: string;
    caption: string;
    width: number;
    height: number;
    formats: {
      thumbnail: {
        ext: string;
        url: string;
        hash: string;
        mime: string;
        name: string;
        size: number;
        width: number;
        height: number;
      };
    };
    hash: string;
    ext: string;
    mime: string;
    size: number;
    url: string;
  };
};

export type Article = Entity & {
  attributes: {
    title: string;
    slug: string;
    content: string;
    excerpt: string;
    published_date: string;
    publishedAt: string;
    image: {
      data: Image;
    };
  };
};
