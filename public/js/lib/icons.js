// Minimal inline SVG icons (decorative; aria-hidden).
const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  car: 'M5 16l1.5-5.5A2 2 0 018.4 9h7.2a2 2 0 011.9 1.5L19 16M4 16h16v3h-2.5v-1.5h-11V19H4zM7.5 13h.01M16.5 13h.01',
  home: 'M3 11l9-7 9 7M5 10v10h5v-6h4v6h5V10',
  building: 'M4 21V4h10v17M14 9h6v12M7.5 8h3M7.5 12h3M7.5 16h3M17 13h.01M17 17h.01M3 21h18',
  briefcase: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  chevron: 'M9 6l6 6-6 6',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  file: 'M7 3h7l4 4v14H7zM14 3v5h5',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z',
};
export function icon(name, size = 20) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', PATHS[name] || PATHS.file); s.appendChild(p);
  return s;
}
