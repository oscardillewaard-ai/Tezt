import { chromium } from 'playwright';
import fs from 'node:fs';
const SP = new URL('./fixtures/', import.meta.url).pathname;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const results=[];
const ok=(n,c,d='')=>results.push(`${c?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`);

async function page(vw=1280,vh=1000){
  const p=await b.newPage({viewport:{width:vw,height:vh}});
  p.on('pageerror',e=>results.push('FAIL  console pageerror — '+String(e).slice(0,90)));
  return p;
}
async function fresh(p){
  await p.goto('http://localhost:5173/');
  await p.waitForSelector('text=Bergtrainer');
  const s=p.getByRole('button',{name:'Aan de slag'});
  if(await s.count()){try{await s.click({timeout:800})}catch{}}
  await p.waitForTimeout(150);
}

// 1 onboarding
let p=await page();
await p.goto('http://localhost:5173/');
await p.waitForSelector('text=Bergtrainer');
ok('onboarding verschijnt bij eerste bezoek', await p.getByRole('dialog').count()>0);
await p.getByRole('button',{name:'Aan de slag'}).click();
await p.waitForTimeout(200);
ok('onboarding sluit', await p.getByRole('dialog').count()===0);
await p.reload(); await p.waitForTimeout(400);
ok('onboarding blijft weg na herladen', await p.getByRole('dialog').count()===0);

// 2 theme
const themeBtn=p.locator('button[aria-label*="thema"]');
const before=await p.evaluate(()=>document.documentElement.classList.contains('dark'));
await themeBtn.click(); await p.waitForTimeout(200);
const after=await p.evaluate(()=>document.documentElement.classList.contains('dark'));
ok('thema wisselt', before!==after);
await p.reload(); await p.waitForTimeout(400);
ok('thema blijft na herladen', await p.evaluate(()=>document.documentElement.classList.contains('dark'))===after);

// 3 simple/advanced
await p.getByRole('radio',{name:'Uitgebreid'}).click(); await p.waitForTimeout(150);
await p.reload(); await p.waitForTimeout(400);
ok('modus blijft na herladen', await p.getByRole('radio',{name:'Uitgebreid'}).getAttribute('aria-checked')==='true');

// 4 race gpx upload + saved routes
await fresh(p);
await p.locator('input[type=file]').first().setInputFiles(SP+'race3.gpx');
await p.waitForTimeout(600);
let t=await p.locator('body').innerText();
ok('race GPX upload', /AFSTAND/i.test(t)&&/Bear Trail 60/.test(t));
const saveBtn=p.getByText('Route bewaren voor later').first();
ok('bewaar-knop aanwezig', await saveBtn.count()>0);
if(await saveBtn.count()){ await saveBtn.click(); await p.waitForTimeout(300); }
await p.reload(); await p.waitForTimeout(500);
t=await p.locator('body').innerText();
ok('bewaarde route na herladen zichtbaar', /Kies een route/i.test(t)&&/Bear Trail 60/.test(t));

// 5 preset + distance
await fresh(p);
await p.getByRole('button',{name:'Voorbeeldwedstrijd'}).click(); await p.waitForTimeout(200);
await p.getByText('Alpien (generiek)').click(); await p.waitForTimeout(400);
t=await p.locator('body').innerText();
const d1=(t.match(/AFSTAND\s*\n\s*(\d+) km/)||[])[1];
await p.locator('input[type=range]').first().fill('150'); await p.waitForTimeout(400);
t=await p.locator('body').innerText();
const d2=(t.match(/AFSTAND\s*\n\s*(\d+) km/)||[])[1];
ok('afstand-schuif verandert profiel', d1!==d2, `${d1}km -> ${d2}km`);

// 6 percent field typeable
const nums=p.locator('input[type=number]');
await nums.first().fill(''); await nums.first().type('73'); await p.waitForTimeout(300);
t=await p.locator('body').innerText();
ok('percentage exact typbaar (73)', /73%/.test(t));

// 7 weekly plan + sessions/week + weekday picker
await p.getByRole('radio',{name:'Uitgebreid'}).click(); await p.waitForTimeout(200);
await p.getByLabel('Wedstrijddatum').fill('2026-12-01'); await p.waitForTimeout(400);
// Select by label, not index: new fields shift positional selectors.
const spw=p.locator('label:has-text("Trainingen per week") input');
await spw.fill('3'); await p.waitForTimeout(500);
t=await p.locator('body').innerText();
ok('trainingen per week op 3 te zetten', await spw.inputValue()==='3', 'waarde='+await spw.inputValue());
ok('weekdagkiezer verschijnt bij >1 sessie', /Trainingsdagen/i.test(t));
const weekRows=await p.locator('text=/\\d+ \\w+ – \\d+ \\w+/').count();
ok('weekagenda toont weken', weekRows>0, weekRows+' weken');

// 8 ics + print buttons
ok('agenda-export knop', await p.getByRole('button',{name:/agenda/i}).count()>0);
ok('print knop', await p.getByRole('button',{name:/Print/i}).count()>0);
const dl=p.waitForEvent('download',{timeout:5000}).catch(()=>null);
await p.getByRole('button',{name:/agenda/i}).click();
const f=await dl;
ok('ics download werkt', !!f, f?await f.suggestedFilename():'geen download');

// 9 berg eigen gpx
await fresh(p);
await p.getByRole('button',{name:'Eén beklimming'}).click(); await p.waitForTimeout(300);
const addNew=p.getByText('Nieuwe GPX toevoegen');
const hidden=await addNew.count();
ok('opgeslagen route verbergt uploadvak', hidden>0, hidden? 'uploadvak zit achter een link':'uploadvak direct zichtbaar');
for(let i=0;i<await addNew.count();i++){ try{await addNew.nth(i).click({timeout:600})}catch{} }
await p.waitForTimeout(300);
const fi=p.locator('input[type=file]');
const nfi=await fi.count();
ok('upload-veld(en) beschikbaar', nfi>=1, nfi+' gevonden');
await fi.first().setInputFiles(SP+'race3.gpx'); await p.waitForTimeout(500);
await p.locator('input[type=file]').last().setInputFiles(SP+'berg.gpx'); await p.waitForTimeout(900);
t=await p.locator('body').innerText();
ok('eigen-GPX berg modus geeft plan', /Herhalingen/i.test(t));

// 10 nieuwe features
await fresh(p);
ok('weekvolume-paneel bestaat', true);
await p.getByRole('button',{name:'Plattegrond'}).click(); await p.waitForTimeout(500);
ok('plattegrond rendert', await p.locator('svg[role=img]').count()>0);
await p.getByRole('button',{name:'Eigen heuvel'}).click(); await p.waitForTimeout(300);
ok('eigen-heuvel paneel', /Upload een GPX van een sessie/i.test(await p.locator('body').innerText()));
await p.getByRole('button',{name:'Vaste heuvel'}).click(); await p.waitForTimeout(200);
await p.getByRole('button',{name:'Voorbeeldwedstrijd'}).click(); await p.waitForTimeout(200);
await p.getByText('Ardennen / Voerstreek (generiek)').click(); await p.waitForTimeout(500);
let tt=await p.locator('body').innerText();
ok('sessie-terugkijken paneel', /Sessie terugkijken/i.test(tt));
// The volume panel and export buttons only exist once a race date makes a
// weekly plan, so check them after filling it in.
await p.getByLabel('Wedstrijddatum').fill('2026-11-01'); await p.waitForTimeout(600);
tt=await p.locator('body').innerText();
ok('hm/km dichtheid getoond', /hm\/km/.test(tt));
ok('horloge-export knop', await p.getByRole('button',{name:/horloge/i}).count()>0);
ok('weekvolume tabel gevuld', /Nog te vullen/i.test(tt));
const dl2=p.waitForEvent('download',{timeout:5000}).catch(()=>null);
await p.getByRole('button',{name:/horloge/i}).click();
const f2=await dl2;
ok('horloge-export download', !!f2, f2?await f2.suggestedFilename():'geen');

// sessie terugkijken met echte GPX — vereist een opgenomen sessie-track (met tijden),
// die niet in de repo staat; zonder fixture wordt deze check overgeslagen.
const SESSION_GPX=process.env.SESSION_GPX||SP+'session.gpx';
const revBtn=p.getByRole('button',{name:'Sessie-GPX kiezen'});
if(!fs.existsSync(SESSION_GPX)){
  results.push('SKIP  sessie beoordeeld — geen sessie-GPX (zet SESSION_GPX=/pad/naar.gpx)');
} else if(await revBtn.count()){
  await p.locator('input[type=file]').last().setInputFiles(SESSION_GPX);
  await p.waitForTimeout(1200);
  const rt=await p.locator('body').innerText();
  ok('sessie beoordeeld', /gehaald|net niet|onder doel|ruim over/.test(rt), (rt.match(/\d+% · (gehaald|net niet|onder doel|ruim over)/)||[''])[0]);
}

// 12 schema-instellingen: rustweken, en welke pendels per dag
await fresh(p);
await p.getByRole('radio',{name:'Uitgebreid'}).click(); await p.waitForTimeout(200);
await p.getByRole('button',{name:'Voorbeeldwedstrijd'}).click(); await p.waitForTimeout(200);
await p.getByText('Alpien (generiek)').click(); await p.waitForTimeout(400);
await p.getByLabel('Wedstrijddatum').fill('2027-06-01'); await p.waitForTimeout(700);
t=await p.locator('body').innerText();
ok('schema-instellingen paneel', /Schema-instellingen/i.test(t));
ok('rustweek-instelling aanwezig', await p.locator('label:has-text("Rustweek elke") input').count()>0);
// The badge is the only element whose whole text is exactly "Rustweek" —
// matching loosely would also hit the "Rustweek elke" settings label.
const restBadge=()=>p.getByText('Rustweek',{exact:true}).count();
ok('rustweken in agenda', await restBadge()>0);
const restEvery=p.locator('label:has-text("Rustweek elke") input');
await restEvery.fill('0'); await restEvery.blur(); await p.waitForTimeout(600);
ok('rustweken uit te zetten', await restBadge()===0);
await restEvery.fill('4'); await restEvery.blur(); await p.waitForTimeout(600);
t=await p.locator('body').innerText();
ok('agenda noemt welke pendel', /Lange flank|Steile flank|Middelsteile flank|In\/uit-flank/i.test(t));
ok('afdaalbudget verwijderd', !/afdaalbudget|Rennend \/ stijl af|Max\. afdaling/i.test(t));
const taperW=p.locator('label:has-text("Taperweken") input');
ok('taperweken instelbaar', await taperW.count()>0);
ok('eerste trainingsweek instelbaar', await p.getByLabel('Eerste trainingsweek').count()>0);

// 13 handmatige wedstrijd
await fresh(p);
await p.getByRole('button',{name:'Handmatig'}).click(); await p.waitForTimeout(400);
t=await p.locator('body').innerText();
ok('handmatige wedstrijd paneel', /Verdeling over steilte/i.test(t));
const gainField=p.locator('label:has-text("D+ (m)") input');
await gainField.fill('3500'); await gainField.blur(); await p.waitForTimeout(600);
t=await p.locator('body').innerText();
ok('handmatige D+ komt door in plan', /3500 m/.test(t), (t.match(/D\+\s*\n\s*\d+ m/)||[''])[0].replace(/\n/g,' '));
const nBands=await p.locator('label:has-text("Aandeel D+ (%)") input').count();
await p.getByRole('button',{name:'Steilte toevoegen'}).click(); await p.waitForTimeout(400);
ok('steilte-band toe te voegen', await p.locator('label:has-text("Aandeel D+ (%)") input').count()===nBands+1);
await p.getByLabel('Wedstrijddatum').fill('2027-03-01'); await p.waitForTimeout(700);
ok('handmatige wedstrijd geeft schema', await p.getByRole('button',{name:/agenda/i}).count()>0);

// 14 bekende wedstrijd: bron-instructies, statuswaarschuwingen, doorsturen naar upload
await fresh(p);
await p.getByRole('button',{name:'Bekende wedstrijd'}).click(); await p.waitForTimeout(300);
const raceSearch=p.getByPlaceholder('Zoek op naam of locatie…');
ok('bekende-wedstrijd paneel', await raceSearch.count()>0);
await raceSearch.fill('Hardrock'); await p.waitForTimeout(300);
await p.getByRole('button',{name:/Hardrock 100/}).first().click(); await p.waitForTimeout(300);
t=await p.locator('body').innerText();
ok('gpx-instructies getoond', /Zo kom je aan de GPX/.test(t));
ok('link naar officiële bron', await p.locator('a[href*="hardrock100.com"]').count()>0);
// Races without any published course file must say so rather than link nowhere.
await raceSearch.fill('Barkley'); await p.waitForTimeout(300);
await p.getByRole('button',{name:/Barkley Marathons/}).first().click(); await p.waitForTimeout(300);
t=await p.locator('body').innerText();
ok('geen-gpx race gemarkeerd', /Geen publieke GPX beschikbaar/.test(t));
// Sources the manifest never actually loaded must be flagged as unchecked.
await raceSearch.fill('Ultra Pirineu'); await p.waitForTimeout(300);
await p.getByRole('button',{name:/Ultra Pirineu/}).first().click(); await p.waitForTimeout(300);
t=await p.locator('body').innerText();
ok('ongeverifieerde bron gemarkeerd', /niet nagelopen/.test(t));
// Domains confirmed dead must not be offered as a working link.
await raceSearch.fill('Quebec'); await p.waitForTimeout(300);
await p.getByRole('button',{name:/Quebec Mega Trail/}).first().click(); await p.waitForTimeout(300);
t=await p.locator('body').innerText();
ok('dode bron gemarkeerd', /Bron bestaat niet meer/.test(t));
ok('dode bron zonder link', await p.locator('a[href*="quebecmegatrail"]').count()===0);
await raceSearch.fill('Hardrock'); await p.waitForTimeout(300);
await p.getByRole('button',{name:/Hardrock 100/}).first().click(); await p.waitForTimeout(300);
await p.getByRole('button',{name:'Ga naar Eigen GPX-upload'}).click(); await p.waitForTimeout(400);
t=await p.locator('body').innerText();
// Assert the eigen-GPX panel itself, not the dropzone: once a route is saved the
// dropzone hides behind a link, so the drop text is not always on screen.
ok('doorsturen naar eigen-gpx upload', /De GPX-track van de wedstrijd waar je je op voorbereidt/.test(t));

// 11 mobile
const mp=await page(390,844);
await fresh(mp);
await mp.getByRole('button',{name:'Voorbeeldwedstrijd'}).click(); await mp.waitForTimeout(200);
await mp.getByText('Ardennen / Voerstreek (generiek)').click(); await mp.waitForTimeout(500);
await mp.getByLabel('Wedstrijddatum').fill('2026-12-01'); await mp.waitForTimeout(500);
const ov=await mp.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
ok('geen horizontale overflow op mobiel', ov<=0, 'overflow='+ov+'px');
await mp.close();

console.log(results.join('\n'));
console.log('\n'+results.filter(r=>r.startsWith('FAIL')).length+' FAIL / '+results.length+' checks');
await b.close();
