import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import "github-markdown-css/github-markdown-dark.css";
import React from 'react';

export interface MarkdownContentProps {
  markdown: string;
  className?: string;
}

const components = {
  ul: ({ node, className, ...props }: any) => (
    <ul className={`${className ?? ""} list-disc list-inside`} {...props} />
  ),
  ol: ({ node, className, ...props }: any) => (
    <ol className={`${className ?? ""} list-decimal list-inside`} {...props} />
  ),
  img: ({ node, ...props }: any) => (
    <div className="w-full flex flex-col my-8 items-center">
      <img {...props} />
    </div>
  ),
  a: ({ node, ...props }: any) => (
    <a target="_blank" rel="noopener noreferrer" {...props} />
  ),
};

export const MarkdownContent = (props: MarkdownContentProps) => {
  const { markdown, className } = props;
  return (
    <Markdown
      className={`${className ?? ""} markdown-body`}
      rehypePlugins={[rehypeRaw]}
      remarkPlugins={[remarkGfm]}
      components={components}
    >
      {markdown}
    </Markdown>
  );
};
