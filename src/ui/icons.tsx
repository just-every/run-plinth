// Line icons for the workspace: 24-unit strokes in currentColor.
const paths = {
  folder: 'M3 7V4h7l3 3h8v14H3ZM3 9h18',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-2c0-5.5 14-5.5 14 0v2M17 3.5c3.5 1 3.5 6.5 0 7.5M19 14c2.5 1 3 3.5 3 7',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5',
  account: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM3.5 21c1.5-4.5 15.5-4.5 17 0',
  pin: 'M12 22s-7-8-7-13a7 7 0 0 1 14 0c0 5-7 13-7 13Zm0-10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  money: 'M12 2v20m5-16.5C13.5 2.5 6.5 3.5 6.5 7.5c0 5.5 11 1.5 11 7.5 0 4.5-8.5 5-12 2',
  calendar: 'M3 4.5h18V21H3ZM7.5 2v5m9-5v5M3 9.5h18',
  mail: 'M3 5h18v14H3Zm0 1 9 7 9-7',
  search: 'M10.5 17.5a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 5.5 5.5',
  plus: 'M12 5v14M5 12h14',
  spark: 'M12 2.5c.6 4.6 2.9 6.9 7.5 7.5-4.6.6-6.9 2.9-7.5 7.5-.6-4.6-2.9-6.9-7.5-7.5 4.6-.6 6.9-2.9 7.5-7.5ZM19 15.5c.3 2 1.2 2.9 3 3.2-1.8.3-2.7 1.2-3 3.2-.3-2-1.2-2.9-3-3.2 1.8-.3 2.7-1.2 3-3.2Z',
  hammer: 'M14 4.5 19.5 10M12 6.5l5.5 5.5M13 5.5l2.5-2.5 5.5 5.5-2.5 2.5M12.5 9 3.5 18a1.5 1.5 0 0 0 2.5 2.5l9-9',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13.5V12l3 2',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'm6 6 12 12M18 6 6 18',
  chevron: 'm9 6 6 6-6 6',
  signout: 'M15 4h4.5v16H15M10 8l-4 4 4 4M6 12h10',
} as const
export type IconName = keyof typeof paths

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={('icon ' + className).trim()} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}
