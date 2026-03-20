import React, { useEffect, useState } from "react";
import { getArticlesWithPagination, clientBuildImageUrl } from "../lib/strapi";
import type { Article } from "../lib/types";

type Props = {
  apiURL: string;
  keyToken: string;
};

type MetaType = {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
};

export default function ArticleList({ apiURL, keyToken }: Props) {
  const [articles, setArticles] = useState<Array<Article>>([]);
  const [meta, setMeta] = useState<MetaType>();
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    let isSubscribed = true;

    const fetchData = async () => {
      const response = await getArticlesWithPagination(apiURL, keyToken, {
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
    <div className="md:pt-[67px] md:pb-[160px] py-16 md:px-[72px] px-[20px]">
      <div className="flex flex-row flex-wrap text-primary gap-x-6 gap-y-12 justify-center md:mb-[100px] mb-16">
        {articles &&
          articles.map((item) => (
            <a
              key={item.documentId}
              href={`/articles/${item.slug}`}
              className="group flex flex-col bg-white rounded-lg overflow-hidden shadow-md hover:shadow-lg transition-shadow max-w-sm w-full"
            >
              {item.image ? (
                <div className="h-48 overflow-hidden">
                  <img
                    src={clientBuildImageUrl(apiURL, item.image.url)}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
              ) : (
                <div className="h-48 bg-gray-100 flex items-center justify-center">
                  <span className="text-gray-400 text-sm">No image</span>
                </div>
              )}
              <div className="p-5 flex flex-col flex-grow">
                <h3 className="text-lg font-semibold text-[#404F9D] mb-2 line-clamp-2">
                  {item.title}
                </h3>
                {item.excerpt && (
                  <p className="text-sm text-gray-600 line-clamp-3">
                    {item.excerpt}
                  </p>
                )}
                <span className="mt-auto pt-4 text-[#ED751D] text-sm font-medium">
                  Lire la suite &rarr;
                </span>
              </div>
            </a>
          ))}
      </div>

      {articles?.length > 0 && meta && meta.pageCount > 1 && (
        <div className="flex justify-center items-center gap-4">
          <button
            className={`px-6 py-3 rounded-full font-medium ${
              currentPage === 1
                ? "opacity-50 cursor-not-allowed bg-gray-200 text-gray-500"
                : "bg-[#404F9D] text-white hover:bg-[#353e7a]"
            }`}
            disabled={currentPage === 1}
            onClick={handlePreviousPage}
          >
            Précédent
          </button>
          <span className="text-[#404F9D] font-medium">
            {currentPage} / {meta.pageCount}
          </span>
          <button
            className={`px-6 py-3 rounded-full font-medium ${
              currentPage === meta.pageCount
                ? "opacity-50 cursor-not-allowed bg-gray-200 text-gray-500"
                : "bg-[#404F9D] text-white hover:bg-[#353e7a]"
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
