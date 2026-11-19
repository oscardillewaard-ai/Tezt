// Het paneel als 'bottom sheet' op de telefoon: de kaart is altijd schermvullend, het paneel schuift
// eroverheen in drie standen (piek, half, vol). Op breder dan GROOT_PX blijft het een zijpaneel.
export const GROOT_PX = 700
export const STANDEN = ['piek', 'half', 'vol']
const PIEK_PX = 158 // handvat, kopbalk en één regel (score, of de hoofdknop)

/**
 * Hoogte in pixels per stand voor een venster van deze hoogte. Met 'piekPx' (de gemeten inhoud van
 * de piek, bv. de plankaart) is de piek zo hoog als die inhoud, en half altijd een stuk hoger.
 */
export function standHoogtes(vensterHoogte, veiligOnder = 0, piekPx = null) {
  const vol = Math.round(vensterHoogte * 0.9)
  const piek = Math.min(Math.round(vensterHoogte * 0.62), (piekPx ?? PIEK_PX) + veiligOnder)
  const half = Math.min(vol - 40, Math.max(Math.round(vensterHoogte * 0.52), piek + 120))
  return { piek, half, vol }
}

/** De stand die het dichtst bij deze hoogte ligt; met een veeg (px/ms, omhoog positief) schuift de keuze mee. */
export function dichtsteStand(hoogte, hoogtes, snelheid = 0) {
  const doel = hoogte + snelheid * 180
  let beste = 'half'
  for (const s of STANDEN) if (Math.abs(hoogtes[s] - doel) < Math.abs(hoogtes[beste] - doel)) beste = s
  return beste
}

export function maakSheet({ kaart, main, greep, bijWijziging = () => {}, piekHoogte = () => null, beginStand = 'half' }) {
  const smal = matchMedia(`(max-width: ${GROOT_PX}px)`)
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;padding-bottom:env(safe-area-inset-bottom)'
  document.body.appendChild(probe)
  let stand = beginStand
  let hoogte = 0
  const hoogtes = () => standHoogtes(window.innerHeight, parseFloat(getComputedStyle(probe).paddingBottom) || 0, piekHoogte())
  const zetHoogte = (px) => {
    hoogte = px
    document.documentElement.style.setProperty('--sheet-h', `${Math.round(px)}px`)
  }
  const kaartBijwerken = () => kaart.invalidateSize({ pan: false })

  function zet(nieuw) {
    stand = nieuw
    main.dataset.sheet = nieuw
    greep.setAttribute('aria-expanded', String(nieuw !== 'piek'))
    greep.setAttribute('data-stand', nieuw)
    zetHoogte(hoogtes()[nieuw])
    if (nieuw === 'piek') main.scrollTop = 0
    kaartBijwerken()
    setTimeout(kaartBijwerken, 320) // na de animatie nog eens
    bijWijziging(nieuw)
  }
  const volgende = () => zet(STANDEN[(STANDEN.indexOf(stand) + 1) % STANDEN.length])

  // slepen aan het handvat; een tik wisselt de stand
  let sleep = null
  greep.addEventListener('pointerdown', (e) => {
    if (!smal.matches) return
    greep.setPointerCapture(e.pointerId)
    sleep = { y: e.clientY, h: hoogte, t: e.timeStamp, beweeg: 0, v: 0, laatsteY: e.clientY, laatsteT: e.timeStamp }
    main.classList.add('sleept')
  })
  greep.addEventListener('pointermove', (e) => {
    if (!sleep) return
    const hs = hoogtes()
    const dy = sleep.y - e.clientY
    sleep.beweeg = Math.max(sleep.beweeg, Math.abs(dy))
    const dt = e.timeStamp - sleep.laatsteT
    if (dt > 0) sleep.v = (sleep.laatsteY - e.clientY) / dt
    sleep.laatsteY = e.clientY
    sleep.laatsteT = e.timeStamp
    zetHoogte(Math.max(hs.piek, Math.min(hs.vol, sleep.h + dy)))
  })
  const los = (e) => {
    if (!sleep) return
    const s = sleep
    sleep = null
    main.classList.remove('sleept')
    if (e.type === 'pointercancel' || s.beweeg < 6) {
      if (e.type === 'pointerup') volgende()
      else zet(stand)
    } else zet(dichtsteStand(hoogte, hoogtes(), s.v))
  }
  greep.addEventListener('pointerup', los)
  greep.addEventListener('pointercancel', los)
  greep.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') zet(STANDEN[Math.min(2, STANDEN.indexOf(stand) + 1)])
    else if (e.key === 'ArrowDown') zet(STANDEN[Math.max(0, STANDEN.indexOf(stand) - 1)])
  })

  const opnieuw = () => {
    if (smal.matches) zet(stand)
    else {
      document.documentElement.style.removeProperty('--sheet-h')
      delete main.dataset.sheet
      main.style.height = ''
    }
    kaartBijwerken()
  }
  smal.addEventListener('change', opnieuw)
  window.addEventListener('resize', () => smal.matches && zet(stand))

  // fitBounds houdt rekening met het paneel: de route past boven het paneel, niet eronder
  const fitBounds = kaart.fitBounds.bind(kaart)
  kaart.fitBounds = (grenzen, opties = {}) =>
    fitBounds(grenzen, smal.matches ? { paddingBottomRight: [0, hoogte], ...opties } : opties)

  if (smal.matches) zet(stand)
  /** De inhoud van de piek veranderde: hoogte opnieuw zetten zonder de stand te wisselen. */
  const herbereken = () => {
    if (!smal.matches || sleep) return
    zetHoogte(hoogtes()[stand])
    kaartBijwerken()
  }
  return { zet, volgende, herbereken, actief: () => smal.matches, stand: () => stand, hoogte: () => hoogte }
}
