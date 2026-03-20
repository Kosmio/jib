import React, { useEffect, useState } from "react";
import { getArticlesWithPagination, clientBuildImageUrl } from "../lib/strapi";
import type { Article } from "../lib/types";

type Props = {
  apiURL: string;
};

type MetaType = {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

export default function ArticleList({ apiURL }: Props) {
  const [articles, setArticles] = useState<Array<Article>>([]);
  const [meta, setMeta] = useState<MetaType>();
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      const response = await getArticlesWithPagination(apiURL, {
        pageSize: 6,
        page: currentPage,
      });

      if (isSubscribed) {
        setArticles(response.data);
        setMeta(response.meta?.pagination);
      }
    };

    fetchData().catch(console.error);

    return () => {
      isSubscribed = false;
    };
  }, [currentPage]);

  const handleNextPage = () => {
    if (meta && currentPage < meta.pageCount) {
      setCurrentPage((prev) => prev + 1);
    }
  };

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage((prev) => prev - 1);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-16 md:py-24">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
        {articles &&
          articles.map((item) => (
            <a
              key={item.documentId}
              href={`/articles/${item.slug}`}
              className="group flex flex-col bg-white rounded-xl overflow-hidden border border-gray-100 hover:border-gray-200 hover:shadow-lg transition-all duration-300"
            >
              {item.image ? (
                <div className="aspect-[16/10] overflow-hidden bg-[#f8fafc]">
                  <img
                    src={clientBuildImageUrl(apiURL, item.image.url)}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                </div>
              ) : (
                <div className="aspect-[16/10] bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] flex items-center justify-center">
                  <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z"/>
                  </svg>
                </div>
              )}
              <div className="p-5 flex flex-col flex-grow">
                {item.published_date && (
                  <time className="text-xs text-[#64748b] mb-2">
                    {new Date(item.published_date).toLocaleDateString("fr-FR", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </time>
                )}
                <h3 className="text-base font-semibold text-gray-900 mb-2 line-clamp-2 group-hover:text-[#1e40af] transition-colors">
                  {item.title}
                </h3>
                {item.excerpt && (
                  <p className="text-sm text-[#64748b] line-clamp-3 flex-grow">
                    {item.excerpt}
                  </p>
                )}
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[#1e40af]">
                  Lire l'article
                  <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/>
                  </svg>
                </span>
              </div>
            </a>
          ))}
      </div>

      {articles?.length > 0 && meta && meta.pageCount > 1 && (
        <div className="flex justify-center items-center gap-3">
          <button
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              currentPage === 1
                ? "text-gray-400 bg-gray-100 cursor-not-allowed"
                : "text-gray-700 bg-white border border-gray-200 hover:bg-gray-50"
            }`}
            disabled={currentPage === 1}
            onClick={handlePreviousPage}
          >
            Précédent
          </button>
          <span className="text-sm text-[#64748b] px-3">
            {currentPage} / {meta.pageCount}
          </span>
          <button
            className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              currentPage === meta.pageCount
                ? "text-gray-400 bg-gray-100 cursor-not-allowed"
                : "text-gray-700 bg-white border border-gray-200 hover:bg-gray-50"
            }`}
            disabled={currentPage === meta.pageCount}
            onClick={handleNextPage}
          >
            Suivant
          </button>
        </div>
      )}
    </div>
  );
}
