import React from 'react';
const paths={
  branch:'M6 3v18M6 9h8a4 4 0 0 0 4-4V3M6 17h8a4 4 0 0 0 4-4v-1',
  grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  folder:'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  map:'m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16',
  book:'M12 5C9 3 5 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1zm0 0v15',
  question:'M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4M12 16h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  tasks:'M9 6h12M9 12h12M9 18h12m-18-12 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14m5 12 6 6',
  plus:'M12 5v14M5 12h14',arrow:'M5 12h14m-5-5 5 5-5 5',chevron:'m8 5 7 7-7 7',down:'m6 9 6 6 6-6',
  upload:'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',download:'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  file:'M14 2H5v20h14V7zM14 2v5h5M8 12h8M8 16h6',code:'m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',
  check:'m5 12 4 4L19 6',close:'m6 6 12 12M6 18 18 6',refresh:'M20 7a9 9 0 1 0 1 7M20 2v6h-6',
  play:'m8 4 12 8-12 8z',stop:'M6 6h12v12H6z',clock:'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  external:'M14 3h7v7m-1-6-9 9M10 3H3v18h18v-7',edit:'m15 4 5 5M3 21l6-2L21 7l-5-5L4 14z',
  key:'M9 15a6 6 0 1 1 6-6l7 7-3 3-3-3-2 2-4-4',spark:'m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z',
  shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zm-4 10 3 3 5-6',trash:'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7',link:'m10 13 4-4M8 16l-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 0m0 8a4 4 0 0 0 6 0l5-5a4 4 0 0 0-5-5l-2 2'
};
export default function Icon({name,size=18,...props}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]||paths.file}/></svg>}
