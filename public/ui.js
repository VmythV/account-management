export const $ = selector => document.querySelector(selector);
const paths = {
  grid:'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h6v6h-6z',
  accounts:'M8 3h8v5H8z M5 5H3v16h18V5h-2 M8 13h8 M8 17h5',
  graph:'M3 9h5v6H3z M16 2h5v6h-5z M16 16h5v6h-5z M8 12h4V5h4 M12 12v7h4',
  card:'M3 5h18v14H3z M3 10h18 M7 15h3',
  clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  shield:'M12 3l8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6z M8 12l3 3 5-6',
  search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  plus:'M12 5v14 M5 12h14',
  arrow:'M4 12h16 M15 7l5 5-5 5',
  back:'M20 12H4 M9 7l-5 5 5 5',
  chevron:'M9 5l7 7-7 7',
  link:'M10 14l4-4 M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  bell:'M6 10a6 6 0 0 1 12 0v5l2 3H4l2-3z M10 21h4',
  filter:'M4 6h16 M7 12h10 M10 18h4',
  close:'M6 6l12 12 M18 6L6 18',
  help:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01',
  edit:'M14 5l5 5 M4 20l1-6L16 3l5 5-11 11z',
  copy:'M8 8h12v13H8z M16 8V3H3v13h5',
  tag:'M3 3h8l10 10-8 8L3 11z M7 7h.01',
  check:'M5 12l4 4L19 6',
  external:'M14 3h7v7 M21 3L10 14 M10 3H3v18h18v-7'
};
export const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.accounts}"/></svg>`;
export const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const serviceIcon = (a,size='') => `<span class="service-icon ${esc(a.brand||'')} ${size}" aria-hidden="true">${esc(a.mark||a.name.slice(0,1))}</span>`;
export function tagStyle(color) {
  if(!/^#[0-9a-f]{6}$/i.test(color))color='#6b9c87';
  return `--tag-color:${color};--tag-bg:${color}1a;--tag-ink:color-mix(in srgb,${color} 25%,#24332c)`;
}

export function localDateTime(value) {
  const d=new Date(value);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);
}
export function toast(message) {
  const el=$('#toast');el.textContent=message;el.hidden=false;
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,5000);
}
