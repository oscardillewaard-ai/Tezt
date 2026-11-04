'use strict'

// Eigen icoontjes voor Tarapp: lijntekeningen op een raster van 24 × 24, in
// één stijl (lijndikte 2, ronde uiteinden), zodat ze op iPhone en Android er
// hetzelfde uitzien (emoji verschillen per toestel). De kleur komt uit CSS
// (currentColor); elke activiteit heeft daar een eigen kleur.
const ICON_PATHS = {
  // Activiteiten
  hardlopen:
    '<circle cx="15" cy="4.5" r="2"/><path d="M13.5 8.5 10.8 13l3.2 2.6-1.3 5.4"/><path d="M10.8 13 7.6 15.6H4.5"/><path d="M7.2 10.4l3.1-2.3 3.6.6 2.3 3.1 2.6.5"/>',
  gym: '<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  // Kettlebell: brede hengsel, ronde bol met platte onderkant.
  kracht: '<path d="M8.9 11.4 8.5 8a3.5 3.5 0 0 1 7 0l-.4 3.4"/><path d="M7.2 20.5a6.3 6.3 0 1 1 9.6 0z"/>',
  klimmen: '<path d="M3 20 9.5 8.5l3.8 6.3 2.2-3.3L21 20z"/><path d="M9.5 8.5V4l3.5 1.3-3.5 1.3"/>',
  boulderen:
    '<path d="M4 19.5 5.8 12l3.9-4.6 5.6.8 3.6 4.5 1.1 6.8z"/><g fill="currentColor" stroke="none"><circle cx="9.3" cy="13.2" r="1.3"/><circle cx="14" cy="11.4" r="1.3"/><circle cx="15.4" cy="15.8" r="1.3"/></g>',
  wandelen:
    '<path d="M6 4.5h5l.8 5.5 4.9 1.5c1.6.5 2.8 2 2.8 3.7V18H4.5z"/><path d="M4.5 21h15"/><path d="M9 7h2M9.6 10h2.3"/>',
  fietsen:
    '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l3.8-7h5.7L18 16M9.8 9 12 16H6M14 6.5h2.4"/>',
  zwemmen:
    '<circle cx="16.5" cy="6.5" r="1.8"/><path d="M4.5 12.5l4.2-3.2 3.6 1.8 2.7-1.6"/><path d="M3 16.5c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"/><path d="M3 20c1.5 0 1.5-1 3-1s1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1"/>',
  yoga: '<circle cx="12" cy="4.8" r="2"/><path d="M12 8.2v5"/><path d="M6.5 10.8 12 13.2l5.5-2.4"/><path d="M5.5 18.5c2-2.6 4.1-3.4 6.5-3.4s4.5.8 6.5 3.4z"/>',
  // Op één been balanceren: enkelbalans, heupblok en andere routines.
  routine: '<circle cx="12" cy="4.6" r="2"/><path d="M12 8.2v5.8M6.5 10.4h11M12 14v7M12 14l4.2 1.8-1.3 3.2"/>',
  thuis: '<path d="M3.5 11 12 3.8l8.5 7.2"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5.5h4V20"/>',
  warming: '<path d="M12 3c.8 3.1 5.2 5.3 5.2 10.2a5.2 5.2 0 0 1-10.4 0c0-2.6 1.4-4.2 2.6-5.2.4 1.9 1.4 3 2.6 3.1-.3-2.9-1.1-5.3 0-8.1z"/>',
  wedstrijd:
    '<path d="M5.5 21V3.5"/><path d="M5.5 4h13v8.5h-13"/><path d="M5.5 4h4.35v4.25H5.5zM14.2 4h4.3v4.25h-4.3zM9.85 8.25h4.35v4.25H9.85z" fill="currentColor" stroke="none"/>',

  // Tabbalk en kopjes
  agenda:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><g fill="currentColor" stroke="none"><circle cx="8" cy="14" r="1.2"/><circle cx="12" cy="14" r="1.2"/><circle cx="16" cy="14" r="1.2"/><circle cx="8" cy="17.4" r="1.2"/><circle cx="12" cy="17.4" r="1.2"/></g>',
  overzicht: '<path d="M4 20.5h16"/><path d="M6.5 20V13M11 20V8M15.5 20v-9.5M20 20V5.5"/>',
  schemas:
    '<rect x="5" y="4.5" width="14" height="16.5" rx="2"/><path d="M9 3h6v3H9z"/><path d="M8.5 11h1M11.5 11h4M8.5 15h1M11.5 15h4"/>',
  meer: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',

  // Klein spul
  vink: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  // Weergave van de agenda: een scherm met regels.
  weergave: '<rect x="4" y="3.5" width="16" height="17" rx="3"/><path d="M7.5 8h9M7.5 12h9M7.5 16h5"/>',
  herhaal:
    '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19"/><path d="M16 3l3 3-3 3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5"/><path d="M8 21l-3-3 3-3"/>',
  horloge: '<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l.6-3h4.8l.6 3M9 18l.6 3h4.8l.6-3"/><path d="M12 9.5V12l1.6 1.2"/>',
  slot: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/>',
  hartje:
    '<path d="M12 20.5s-7.6-4.5-9.4-9.2C1.4 8.1 3.5 4.8 6.9 4.8c2 0 3.6 1.1 5.1 2.9 1.5-1.8 3.1-2.9 5.1-2.9 3.4 0 5.5 3.3 4.3 6.5-1.8 4.7-9.4 9.2-9.4 9.2z" fill="currentColor" stroke="none"/>',
}

// Activiteiten met een eigen icoon (de rest, zelf toegevoegd, houdt zijn emoji).
const TYPE_ICONS = ['hardlopen', 'gym', 'kracht', 'klimmen', 'boulderen', 'wandelen', 'fietsen', 'zwemmen', 'yoga', 'routine', 'thuis', 'warming', 'wedstrijd']

function svgIcon(name, cls = '') {
  const p = ICON_PATHS[name]
  if (!p) return ''
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`
}
