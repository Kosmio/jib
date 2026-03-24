export const buildImageUrl = (baseUrl: string) =>
  `${import.meta.env.REACT_STRAPI_URL}${baseUrl}`;

const strapiFetch = (targetUrl: string) =>
  fetch(`${import.meta.env.STRAPI_URL}/api${targetUrl}`).then((res) =>
    res.json()
  );

// Client-side fetch helpers (for React components)
const clientFetch = (url: string, targetUrl: string) =>
  fetch(`${url}/api${targetUrl}`).then((res) => res.json());

export const clientBuildImageUrl = (url: string, baseUrl: string) =>
  `${url}${baseUrl}`;
