// Maakt public/sportagenda/voeding/basis.js: ~200 veelgegeten basisproducten
// (zonder barcode) met Nederlandse naam en kcal/eiwit/koolhydraten/vet per 100 g.
//
// Bron: USDA FoodData Central, dataset "SR Legacy" (april 2018), publiek domein.
// Per product staat de FDC-id erbij, zodat elke waarde herleidbaar is:
// https://fdc.nal.usda.gov/food-details/<fdc>/nutrients
//
// Gebruik (eenmalig, alleen nodig als je de lijst wilt aanpassen):
//   1. Download https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip
//   2. Pak hem uit en draai: node scripts/gen-voeding-basis.mjs <map-met-csv-bestanden>
//
// Nutriënt-id's: 1008 energie (kcal), 1003 eiwit, 1005 koolhydraten (by difference),
// 1004 vet. Ontbreekt een waarde in de dataset, dan stopt het script (we verzinnen niets).

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// [Nederlandse naam, exacte USDA-omschrijving, categorie, (optioneel) standaardportie in gram en naam]
const LIJST = [
  // Fruit
  ['Appel', 'Apples, raw, with skin (Includes foods for USDA\'s Food Distribution Program)', 'fruit', 180, '1 appel'],
  ['Banaan', 'Bananas, raw', 'fruit', 120, '1 banaan'],
  ['Peer', 'Pears, raw', 'fruit', 170, '1 peer'],
  ['Sinaasappel', 'Oranges, raw, all commercial varieties', 'fruit', 150, '1 sinaasappel'],
  ['Mandarijn', 'Tangerines, (mandarin oranges), raw', 'fruit', 75, '1 mandarijn'],
  ['Kiwi', 'Kiwifruit, green, raw', 'fruit', 75, '1 kiwi'],
  ['Aardbeien', 'Strawberries, raw', 'fruit'],
  ['Blauwe bessen', 'Blueberries, raw', 'fruit'],
  ['Frambozen', 'Raspberries, raw', 'fruit'],
  ['Bramen', 'Blackberries, raw', 'fruit'],
  ['Druiven', 'Grapes, red or green (European type, such as Thompson seedless), raw', 'fruit'],
  ['Mango', 'Mangos, raw', 'fruit'],
  ['Ananas', 'Pineapple, raw, all varieties', 'fruit'],
  ['Watermeloen', 'Watermelon, raw', 'fruit'],
  ['Meloen (cantaloupe)', 'Melons, cantaloupe, raw', 'fruit'],
  ['Honingmeloen', 'Melons, honeydew, raw', 'fruit'],
  ['Perzik', 'Peaches, yellow, raw', 'fruit', 150, '1 perzik'],
  ['Nectarine', 'Nectarines, raw', 'fruit', 140, '1 nectarine'],
  ['Pruim', 'Plums, raw', 'fruit', 65, '1 pruim'],
  ['Kersen', 'Cherries, sweet, raw', 'fruit'],
  ['Abrikoos', 'Apricots, raw', 'fruit', 35, '1 abrikoos'],
  ['Granaatappel', 'Pomegranates, raw', 'fruit'],
  ['Grapefruit', 'Grapefruit, raw, pink and red, all areas', 'fruit'],
  ['Citroen', 'Lemons, raw, without peel', 'fruit'],
  ['Avocado', 'Avocados, raw, all commercial varieties', 'fruit', 150, '1 avocado (zonder pit)'],
  ['Dadels (medjool)', 'Dates, medjool', 'fruit', 24, '1 dadel'],
  ['Rozijnen', 'Raisins, dark, seedless (Includes foods for USDA\'s Food Distribution Program)', 'fruit'],
  ['Gedroogde abrikozen', 'Apricots, dried, sulfured, uncooked', 'fruit'],
  ['Gedroogde vijgen', 'Figs, dried, uncooked', 'fruit'],
  ['Gedroogde pruimen', 'Plums, dried (prunes), uncooked', 'fruit'],
  ['Appelmoes (ongezoet)', 'Applesauce, canned, unsweetened, without added ascorbic acid (Includes foods for USDA\'s Food Distribution Program)', 'fruit'],

  // Groente
  ['Broccoli', 'Broccoli, raw', 'groente'],
  ['Broccoli, gekookt', 'Broccoli, cooked, boiled, drained, without salt', 'groente'],
  ['Bloemkool', 'Cauliflower, raw', 'groente'],
  ['Bloemkool, gekookt', 'Cauliflower, cooked, boiled, drained, without salt', 'groente'],
  ['Spinazie', 'Spinach, raw', 'groente'],
  ['Spinazie, gekookt', 'Spinach, cooked, boiled, drained, without salt', 'groente'],
  ['Sperziebonen, gekookt', 'Beans, snap, green, cooked, boiled, drained, without salt', 'groente'],
  ['Wortel', 'Carrots, raw', 'groente'],
  ['Wortel, gekookt', 'Carrots, cooked, boiled, drained, without salt', 'groente'],
  ['Tomaat', 'Tomatoes, red, ripe, raw, year round average', 'groente', 120, '1 tomaat'],
  ['Cherrytomaatjes', 'Tomatoes, red, ripe, raw, year round average', 'groente'],
  ['Komkommer', 'Cucumber, with peel, raw', 'groente'],
  ['Paprika, rood', 'Peppers, sweet, red, raw', 'groente', 160, '1 paprika'],
  ['Paprika, groen', 'Peppers, sweet, green, raw', 'groente', 160, '1 paprika'],
  ['Paprika, geel', 'Peppers, sweet, yellow, raw', 'groente', 160, '1 paprika'],
  ['Ui', 'Onions, raw', 'groente', 100, '1 ui'],
  ['Rode ui', 'Onions, raw', 'groente', 100, '1 ui'],
  ['Knoflook', 'Garlic, raw', 'groente', 3, '1 teentje'],
  ['Courgette', 'Squash, summer, zucchini, includes skin, raw', 'groente'],
  ['Aubergine', 'Eggplant, raw', 'groente'],
  ['Champignons', 'Mushrooms, white, raw', 'groente'],
  ['Champignons, gebakken', 'Mushrooms, white, stir-fried', 'groente'],
  ['IJsbergsla', 'Lettuce, iceberg (includes crisphead types), raw', 'groente'],
  ['Sla (kropsla)', 'Lettuce, butterhead (includes boston and bibb types), raw', 'groente'],
  ['Rucola', 'Arugula, raw', 'groente'],
  ['Andijvie', 'Endive, raw', 'groente'],
  ['Witlof', 'Chicory, witloof, raw', 'groente'],
  ['Boerenkool', 'Kale, raw', 'groente'],
  ['Boerenkool, gekookt', 'Kale, cooked, boiled, drained, without salt', 'groente'],
  ['Spruitjes, gekookt', 'Brussels sprouts, cooked, boiled, drained, without salt', 'groente'],
  ['Rode kool', 'Cabbage, red, raw', 'groente'],
  ['Witte kool', 'Cabbage, raw', 'groente'],
  ['Prei', 'Leeks, (bulb and lower leaf-portion), raw', 'groente'],
  ['Selderij (bleekselderij)', 'Celery, raw', 'groente'],
  ['Asperges', 'Asparagus, raw', 'groente'],
  ['Asperges, gekookt', 'Asparagus, cooked, boiled, drained', 'groente'],
  ['Doperwten (diepvries, gekookt)', 'Peas, green, frozen, cooked, boiled, drained, without salt', 'groente'],
  ['Mais (korrels)', 'Corn, sweet, yellow, canned, whole kernel, drained solids', 'groente'],
  ['Bietjes, gekookt', 'Beets, cooked, boiled, drained', 'groente'],
  ['Radijs', 'Radishes, raw', 'groente'],
  ['Pompoen', 'Pumpkin, raw', 'groente'],
  ['Zoete aardappel', 'Sweet potato, raw, unprepared (Includes foods for USDA\'s Food Distribution Program)', 'groente'],
  ['Zoete aardappel, gekookt', 'Sweet potato, cooked, baked in skin, flesh, without salt', 'groente'],
  ['Taugé', 'Mung beans, mature seeds, sprouted, raw', 'groente'],
  ['Peultjes', 'Peas, edible-podded, raw', 'groente'],
  ['Venkel', 'Fennel, bulb, raw', 'groente'],
  ['Tomatenpuree', 'Tomato products, canned, paste, without salt added (Includes foods for USDA\'s Food Distribution Program)', 'groente'],
  ['Tomatenblokjes (blik)', 'Tomatoes, red, ripe, canned, packed in tomato juice', 'groente'],

  // Aardappelen, granen, brood, pasta
  ['Aardappel, rauw', 'Potatoes, flesh and skin, raw', 'granen'],
  ['Aardappel, gekookt', 'Potatoes, boiled, cooked without skin, flesh, without salt', 'granen'],
  ['Aardappel, gepoft', 'Potatoes, baked, flesh and skin, without salt', 'granen'],
  ['Aardappelpuree', 'Potatoes, mashed, home-prepared, whole milk and butter added', 'granen'],
  ['Patat (oven)', 'Potatoes, french fried, all types, salt not added in processing, frozen, oven-heated', 'granen'],
  ['Havermout', 'Cereals, oats, regular and quick, not fortified, dry', 'granen', 40, '1 portie'],
  ['Havermout, gekookt met water', 'Cereals, oats, regular and quick, unenriched, cooked with water (includes boiling and microwaving), without salt', 'granen'],
  ['Witte rijst, ongekookt', 'Rice, white, long-grain, regular, raw, unenriched', 'granen'],
  ['Witte rijst, gekookt', 'Rice, white, long-grain, regular, unenriched, cooked without salt', 'granen'],
  ['Zilvervliesrijst, ongekookt', 'Rice, brown, long-grain, raw (Includes foods for USDA\'s Food Distribution Program)', 'granen'],
  ['Zilvervliesrijst, gekookt', 'Rice, brown, long-grain, cooked (Includes foods for USDA\'s Food Distribution Program)', 'granen'],
  ['Pasta, ongekookt', 'Pasta, dry, unenriched', 'granen'],
  ['Pasta, gekookt', 'Pasta, cooked, unenriched, without added salt', 'granen'],
  ['Volkorenpasta, ongekookt', 'Pasta, whole-wheat, dry (Includes foods for USDA\'s Food Distribution Program)', 'granen'],
  ['Volkorenpasta, gekookt', 'Pasta, whole-wheat, cooked (Includes foods for USDA\'s Food Distribution Program)', 'granen'],
  ['Eiernoedels, gekookt', 'Noodles, egg, cooked, enriched, with added salt', 'granen'],
  ['Couscous, ongekookt', 'Couscous, dry', 'granen'],
  ['Couscous, gekookt', 'Couscous, cooked', 'granen'],
  ['Quinoa, ongekookt', 'Quinoa, uncooked', 'granen'],
  ['Quinoa, gekookt', 'Quinoa, cooked', 'granen'],
  ['Bulgur, gekookt', 'Bulgur, cooked', 'granen'],
  ['Volkorenbrood', 'Bread, whole-wheat, commercially prepared', 'granen', 35, '1 snee'],
  ['Wit brood', 'Bread, white, commercially prepared (includes soft bread crumbs)', 'granen', 30, '1 snee'],
  ['Meergranenbrood', 'Bread, multi-grain (includes whole-grain)', 'granen', 35, '1 snee'],
  ['Roggebrood', 'Bread, rye', 'granen', 35, '1 snee'],
  ['Stokbrood', 'Bread, french or vienna (includes sourdough)', 'granen'],
  ['Pitabroodje', 'Bread, pita, white, enriched', 'granen', 60, '1 pita'],
  ['Wrap (tortilla, tarwe)', 'Tortillas, ready-to-bake or -fry, flour, refrigerated', 'granen', 60, '1 wrap'],
  ['Beschuit', 'Crackers, rusk toast', 'granen', 10, '1 beschuit'],
  ['Knäckebröd', 'Crackers, rye, wafers, plain', 'granen', 10, '1 knäckebröd'],
  ['Rijstwafel', 'Rice cake, cracker (include hain mini rice cakes)', 'granen', 9, '1 rijstwafel'],
  ['Cornflakes', 'Cereals ready-to-eat, RALSTON Corn Flakes', 'granen'],
  ['Granola', 'Cereals ready-to-eat, granola, homemade', 'granen'],
  ['Bloem (tarwe)', 'Wheat flour, white, all-purpose, unenriched', 'granen'],
  ['Croissant', 'Croissants, butter', 'granen', 60, '1 croissant'],

  // Zuivel en eieren
  ['Ei', 'Egg, whole, raw, fresh', 'zuivel', 55, '1 ei (M)'],
  ['Ei, gekookt', 'Egg, whole, cooked, hard-boiled', 'zuivel', 50, '1 ei'],
  ['Ei, gebakken', 'Egg, whole, cooked, fried', 'zuivel', 46, '1 ei'],
  ['Roerei', 'Egg, whole, cooked, scrambled', 'zuivel'],
  ['Eiwit (van ei)', 'Egg, white, raw, fresh', 'zuivel'],
  ['Volle melk', 'Milk, whole, 3.25% milkfat, with added vitamin D', 'zuivel', 250, '1 glas'],
  ['Halfvolle melk', 'Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D', 'zuivel', 250, '1 glas'],
  ['Magere melk', 'Milk, nonfat, fluid, with added vitamin A and vitamin D (fat free or skim)', 'zuivel', 250, '1 glas'],
  ['Karnemelk', 'Milk, buttermilk, fluid, cultured, lowfat', 'zuivel', 250, '1 glas'],
  ['Yoghurt (volle)', 'Yogurt, plain, whole milk', 'zuivel'],
  ['Yoghurt (magere)', 'Yogurt, plain, skim milk', 'zuivel'],
  ['Griekse yoghurt (vol)', 'Yogurt, Greek, plain, whole milk', 'zuivel'],
  ['Griekse yoghurt (0%)', 'Yogurt, Greek, plain, nonfat (Includes foods for USDA\'s Food Distribution Program)', 'zuivel'],
  ['Kwark (mager)', 'Cheese, cottage, nonfat, uncreamed, dry, large or small curd', 'zuivel'],
  ['Hüttenkäse', 'Cheese, cottage, lowfat, 2% milkfat', 'zuivel'],
  ['Goudse kaas', 'Cheese, gouda', 'zuivel', 20, '1 plak'],
  ['Cheddar', 'Cheese, cheddar (Includes foods for USDA\'s Food Distribution Program)', 'zuivel', 20, '1 plak'],
  ['Mozzarella', 'Cheese, mozzarella, whole milk', 'zuivel', 125, '1 bol'],
  ['Feta', 'Cheese, feta', 'zuivel'],
  ['Parmezaanse kaas', 'Cheese, parmesan, hard', 'zuivel', 5, '1 eetlepel geraspt'],
  ['Brie', 'Cheese, brie', 'zuivel'],
  ['Roomkaas', 'Cheese, cream', 'zuivel'],
  ['Ricotta', 'Cheese, ricotta, whole milk', 'zuivel'],
  ['Slagroom', 'Cream, fluid, heavy whipping', 'zuivel'],
  ['Kookroom', 'Cream, fluid, light (coffee cream or table cream)', 'zuivel'],
  ['Zure room', 'Cream, sour, cultured', 'zuivel'],
  ['Roomboter', 'Butter, without salt', 'zuivel', 5, '1 klontje'],
  ['Vanillevla / pudding', 'Puddings, vanilla, ready-to-eat', 'zuivel'],
  ['Roomijs (vanille)', 'Ice creams, vanilla', 'zuivel'],
  ['Sojadrink', 'Soymilk, original and vanilla, unfortified', 'zuivel', 250, '1 glas'],
  ['Amandeldrink', 'Beverages, almond milk, unsweetened, shelf stable', 'zuivel', 250, '1 glas'],

  // Vlees, vis en vervangers
  ['Kipfilet, rauw', 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw', 'vlees'],
  ['Kipfilet, gebakken', 'Chicken, broilers or fryers, breast, meat only, cooked, roasted', 'vlees'],
  ['Kippendij, gebakken', 'Chicken, broilers or fryers, thigh, meat only, cooked, roasted', 'vlees'],
  ['Kalkoenfilet', 'Turkey, retail parts, breast, meat only, cooked, roasted', 'vlees'],
  ['Rundergehakt (mager), rauw', 'Beef, ground, 90% lean meat / 10% fat, raw', 'vlees'],
  ['Rundergehakt (mager), gebakken', 'Beef, ground, 90% lean meat / 10% fat, crumbles, cooked, pan-browned', 'vlees'],
  ['Rundergehakt (half vet), rauw', 'Beef, ground, 80% lean meat / 20% fat, raw', 'vlees'],
  ['Biefstuk, gebakken', 'Beef, top sirloin, steak, separable lean only, trimmed to 1/8" fat, choice, cooked, broiled', 'vlees'],
  ['Varkenshaas, gebakken', 'Pork, fresh, loin, tenderloin, separable lean only, cooked, roasted', 'vlees'],
  ['Karbonade, gebakken', 'Pork, fresh, loin, center loin (chops), bone-in, separable lean and fat, cooked, pan-fried', 'vlees'],
  ['Spek (gebakken)', 'Pork, cured, bacon, cooked, baked', 'vlees'],
  ['Ham (vleeswaren)', 'Ham, sliced, regular (approximately 11% fat)', 'vlees', 15, '1 plak'],
  ['Kipfilet (vleeswaren)', 'Chicken breast, oven-roasted, fat-free, sliced', 'vlees', 15, '1 plak'],
  ['Rookworst', 'Sausage, smoked link sausage, pork and beef', 'vlees'],
  ['Salami', 'Salami, dry or hard, pork', 'vlees', 8, '1 plakje'],
  ['Zalm, rauw', 'Fish, salmon, Atlantic, farmed, raw', 'vlees'],
  ['Zalm, gebakken', 'Fish, salmon, Atlantic, farmed, cooked, dry heat', 'vlees'],
  ['Gerookte zalm', 'Fish, salmon, chinook, smoked', 'vlees'],
  ['Tonijn (blik, op water)', 'Fish, tuna, light, canned in water, drained solids (Includes foods for USDA\'s Food Distribution Program)', 'vlees'],
  ['Kabeljauw, gebakken', 'Fish, cod, Atlantic, cooked, dry heat', 'vlees'],
  ['Makreel, gebakken', 'Fish, mackerel, Atlantic, cooked, dry heat', 'vlees'],
  ['Haring', 'Fish, herring, Atlantic, raw', 'vlees', 80, '1 haring'],
  ['Garnalen, gekookt', 'Crustaceans, shrimp, cooked', 'vlees'],
  ['Tofu', 'Tofu, firm, prepared with calcium sulfate and magnesium chloride (nigari)', 'vlees'],
  ['Tempeh', 'Tempeh', 'vlees'],

  // Peulvruchten, noten en zaden
  ['Kidneybonen (blik)', 'Beans, kidney, red, mature seeds, canned, drained solids', 'peulvrucht'],
  ['Kikkererwten (blik)', 'Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained, rinsed in tap water', 'peulvrucht'],
  ['Linzen, gekookt', 'Lentils, mature seeds, cooked, boiled, without salt', 'peulvrucht'],
  ['Zwarte bonen (blik)', 'Beans, black, mature seeds, canned, low sodium', 'peulvrucht'],
  ['Witte bonen in tomatensaus', 'Beans, baked, canned, plain or vegetarian', 'peulvrucht'],
  ['Edamame', 'Edamame, frozen, prepared', 'peulvrucht'],
  ['Hummus', 'Hummus, commercial', 'peulvrucht'],
  ['Pindakaas', 'Peanut butter, smooth style, without salt', 'noten', 15, '1 boterham'],
  ['Pinda\'s (ongezouten)', 'Peanuts, all types, dry-roasted, without salt', 'noten'],
  ['Amandelen', 'Nuts, almonds', 'noten'],
  ['Walnoten', 'Nuts, walnuts, english', 'noten'],
  ['Cashewnoten', 'Nuts, cashew nuts, raw', 'noten'],
  ['Hazelnoten', 'Nuts, hazelnuts or filberts', 'noten'],
  ['Pistachenoten', 'Nuts, pistachio nuts, raw', 'noten'],
  ['Pecannoten', 'Nuts, pecans', 'noten'],
  ['Macadamianoten', 'Nuts, macadamia nuts, raw', 'noten'],
  ['Chiazaad', 'Seeds, chia seeds, dried', 'noten'],
  ['Lijnzaad', 'Seeds, flaxseed', 'noten'],
  ['Zonnebloempitten', 'Seeds, sunflower seed kernels, dried', 'noten'],
  ['Pompoenpitten', 'Seeds, pumpkin and squash seed kernels, dried', 'noten'],
  ['Sesamzaad', 'Seeds, sesame seeds, whole, dried', 'noten'],
  ['Amandelpasta (notenpasta)', 'Nuts, almond butter, plain, without salt added', 'noten'],

  // Vetten, sauzen en smaakmakers
  ['Olijfolie', 'Oil, olive, salad or cooking', 'vet', 10, '1 eetlepel'],
  ['Zonnebloemolie', 'Oil, sunflower, linoleic, (approx. 65%)', 'vet', 10, '1 eetlepel'],
  ['Kokosolie', 'Oil, coconut', 'vet', 10, '1 eetlepel'],
  ['Margarine / halvarine', 'Margarine-like, vegetable oil spread, approximately 37% fat, unspecified oils, with salt, with added vitamin D', 'vet'],
  ['Mayonaise', 'Salad dressing, mayonnaise, regular', 'vet', 15, '1 eetlepel'],
  ['Ketchup', 'Catsup', 'vet', 15, '1 eetlepel'],
  ['Mosterd', 'Mustard, prepared, yellow', 'vet', 5, '1 theelepel'],
  ['Sojasaus', 'Soy sauce made from soy (tamari)', 'vet', 15, '1 eetlepel'],
  ['Pesto', 'Sauce, pesto, ready-to-serve, refrigerated', 'vet'],
  ['Tomatensaus (pasta)', 'Sauce, pasta, spaghetti/marinara, ready-to-serve', 'vet'],
  ['Honing', 'Honey', 'zoet', 10, '1 theelepel'],
  ['Suiker', 'Sugars, granulated', 'zoet', 4, '1 suikerklontje'],
  ['Jam', 'Jams and preserves', 'zoet', 15, '1 boterham'],
  ['Pure chocolade (70-85%)', 'Chocolate, dark, 70-85% cacao solids', 'zoet'],
  ['Melkchocolade', 'Candies, milk chocolate', 'zoet'],
  ['Chocoladepasta', 'Chocolate-flavored hazelnut spread', 'zoet'],
  ['Ahornsiroop', 'Syrups, maple', 'zoet'],
  ['Cacaopoeder', 'Cocoa, dry powder, unsweetened', 'zoet'],

  // Dranken en snacks
  ['Sinaasappelsap', 'Orange juice, raw (Includes foods for USDA\'s Food Distribution Program)', 'drank', 250, '1 glas'],
  ['Appelsap', 'Apple juice, canned or bottled, unsweetened, without added ascorbic acid', 'drank', 250, '1 glas'],
  ['Cola', 'Beverages, carbonated, cola, regular', 'drank', 330, '1 blikje'],
  ['Bier', 'Alcoholic beverage, beer, regular, all', 'drank', 300, '1 glas'],
  ['Rode wijn', 'Alcoholic beverage, wine, table, red', 'drank', 150, '1 glas'],
  ['Witte wijn', 'Alcoholic beverage, wine, table, white', 'drank', 150, '1 glas'],
  ['Koffie (zwart)', 'Beverages, coffee, brewed, prepared with tap water', 'drank', 150, '1 kop'],
  ['Thee (zonder suiker)', 'Beverages, tea, black, brewed, prepared with tap water', 'drank', 200, '1 kop'],
  ['Popcorn (zonder boter)', 'Snacks, popcorn, air-popped', 'snack'],
  ['Chips (naturel)', 'Snacks, potato chips, plain, salted', 'snack'],
  ['Wei-eiwitpoeder', 'Beverages, Whey protein powder isolate', 'snack', 30, '1 schep'],
]

function readCsv(path) {
  const text = readFileSync(path, 'utf8')
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const cells = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (c === '"') q = false
        else cur += c
      } else if (c === '"') q = true
      else if (c === ',') {
        cells.push(cur)
        cur = ''
      } else cur += c
    }
    cells.push(cur)
    rows.push(cells)
  }
  const [head, ...body] = rows
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

const dir = process.argv[2]
if (!dir) {
  console.error('Gebruik: node scripts/gen-voeding-basis.mjs <map met de SR Legacy-csv-bestanden>')
  process.exit(1)
}

const foods = readCsv(join(dir, 'food.csv'))
const byDesc = new Map(foods.map((f) => [f.description, f.fdc_id]))
const wanted = new Set(['1003', '1004', '1005', '1008'])
const nutr = new Map()
for (const r of readCsv(join(dir, 'food_nutrient.csv'))) {
  if (!wanted.has(r.nutrient_id)) continue
  if (!nutr.has(r.fdc_id)) nutr.set(r.fdc_id, {})
  nutr.get(r.fdc_id)[r.nutrient_id] = Number(r.amount)
}

const missing = []
const out = []
const seenNames = new Set()
for (const [naam, desc, cat, portie, portieNaam] of LIJST) {
  if (seenNames.has(naam)) throw new Error(`Dubbele naam: ${naam}`)
  seenNames.add(naam)
  const fdc = byDesc.get(desc)
  if (!fdc) {
    missing.push(`${naam}: "${desc}"`)
    continue
  }
  const n = nutr.get(fdc) || {}
  const vals = ['1008', '1003', '1005', '1004'].map((k) => n[k])
  if (vals.some((v) => !Number.isFinite(v))) {
    missing.push(`${naam}: waarde ontbreekt bij FDC ${fdc}`)
    continue
  }
  const [kcal, eiwit, kh, vet] = vals
  const rec = { naam, fdc: Number(fdc), usda: desc, cat, kcal, eiwit, kh, vet }
  if (portie) rec.portie = { g: portie, naam: portieNaam }
  out.push(rec)
}
if (missing.length) {
  console.error(`Niet gevonden (${missing.length}):\n` + missing.join('\n'))
  process.exit(2)
}

const header = `// Gegenereerd door scripts/gen-voeding-basis.mjs, niet met de hand aanpassen.
// Basisproducten zonder barcode, waarden per 100 g (dranken: per 100 ml ≈ 100 g).
// Bron: USDA FoodData Central, SR Legacy (2018), publiek domein.
// Herleiden: https://fdc.nal.usda.gov/food-details/<fdc>/nutrients
`
const body = `export const BASIS_BRON = 'USDA FoodData Central (SR Legacy, publiek domein)'\nexport const BASIS = [\n${out
  .map((r) => '  ' + JSON.stringify(r))
  .join(',\n')},\n]\n`
writeFileSync(new URL('../public/sportagenda/voeding/basis.js', import.meta.url), header + body)
console.log(`${out.length} producten geschreven naar public/sportagenda/voeding/basis.js`)
