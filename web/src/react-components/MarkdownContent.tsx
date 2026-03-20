import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import React from 'react';

export interface MarkdownContentProps {
  markdown: string;
  className?: string;
}

const components = {
  h2: ({ node, ...props }: any) => (
    <h2 className="text-2xl font-bold text-gray-900 mt-10 mb-4" {...props} />
  ),
  h3: ({ node, ...props }: any) => (
    <h3 className="text-xl font-semibold text-gray-900 mt-8 mb-3" {...props} />
  ),
  p: ({ node, ...props }: any) => (
    <p className="text-gray-700 leading-relaxed mb-4" {...props} />
  ),
  ul: ({ node, ...props }: any) => (
    <ul className="list-disc list-inside text-gray-700 mb-4 space-y-1" {...props} />
  ),
  ol: ({ node, ...props }: any) => (
    <ol className="list-decimal list-inside text-gray-700 mb-4 space-y-1" {...props} />
  ),
  li: ({ node, ...props }: any) => (
    <li className="leading-relaxed" {...props} />
  ),
  code: ({ node, inline, ...props }: any) =>
    inline ? (
      <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono" {...props} />
    ) : (
      <code className="block bg-gray-900 text-gray-100 p-4 rounded-lg text-sm font-mono overflow-x-auto mb-4" {...props} />
    ),
  pre: ({ node, ...props }: any) => (
    <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto mb-4" {...props} />
  ),
  blockquote: ({ node, ...props }: any) => (
    <blockquote className="border-l-4 border-primary-light pl-4 italic text-gray-600 mb-4" {...props} />
  ),
  img: ({ node, ...props }: any) => (
    <div className="my-8 flex justify-center">
      <img className="rounded-lg max-w-full" {...props} />
    </div>
  ),
  a: ({ node, ...props }: any) => (
    <a className="text-primary hover:text-primary-dark underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />
  ),
  hr: ({ node, ...props }: any) => (
    <hr className="my-8 border-gray-200" {...props} />
  ),
  strong: ({ node, ...props }: any) => (
    <strong className="font-semibold text-gray-900" {...props} />
  ),
};

export const MarkdownContent = (props: MarkdownContentProps) => {
  const { markdown, className } = props;
  return (
    <Markdown
      className={className}
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
      components={components}
    >
      {markdown}
    </Markdown>
  );
};
