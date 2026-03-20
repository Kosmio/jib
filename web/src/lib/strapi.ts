import type { Article, Response, Responses } from "./types";

export const buildImageUrl = (baseUrl: string) =>
  `${import.meta.env.REACT_STRAPI_URL}${baseUrl}`;

const strapiFetch = (targetUrl: string) =>
  fetch(`${import.meta.env.STRAPI_URL}/api${targetUrl}`).then((res) =>
    res.json()
  );

export const getArticles = (
  params: {
    limit?: number;
    start?: number;
  } = { start: 0 }
): Promise<Responses<Article>> => {
  if (params.limit == null) {
    return strapiFetch(`/articles?sort=id%3Adesc&populate=*`);
  } else {
    return strapiFetch(
      `/articles?sort=id%3Adesc&pagination[start]=${params.start}&pagination[limit]=${params.limit}&populate=*`
    );
  }
};

export const getArticleBySlug = (slug: string): Promise<Responses<Article>> =>
  strapiFetch(`/articles?filters[slug][$eq]=${slug}&populate=*`);

// Client-side fetch helpers (for React components)
const clientFetch = (url: string, targetUrl: string) =>
  fetch(`${url}/api${targetUrl}`).then((res) => res.json());

export const getArticlesWithPagination = (
  url: string,
  params: {
    page?: number;
    pageSize?: number;
  }
): Promise<Responses<Article>> => {
  return clientFetch(
    url,
    `/articles?sort=id%3Adesc&pagination[page]=${params.page}&pagination[pageSize]=${params.pageSize}&populate=*`
  );
};

export const clientBuildImageUrl = (url: string, baseUrl: string) =>
  `${url}${baseUrl}`;
