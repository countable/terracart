// Content-addressed resources survive deployments. HTML stays network-first;
// tiles retain their independent offline cache. Keep two shell generations so
// old tabs can still request their exact script URLs after a worker update.
const SHELL_VERSION = 'shell-afeca8f5';

const RESOURCE_CACHE = 'terracart-resources-v1';
const RESOURCE_MANIFEST = './__terracart_resource_manifest__';
/* ASSET_HASHES_START */
const ASSET_HASHES = {
  "assets/ArtTrials/RogueObjects/bushes-olive.png": "120fc538",
  "assets/ArtTrials/RogueObjects/lamp.png": "531900a1",
  "assets/ArtTrials/RogueObjects/rock-mid.png": "05ddc979",
  "assets/ArtTrials/RogueObjects/shrub-olive.png": "b1fdfd56",
  "assets/ArtTrials/RogueObjects/stone.png": "48db8818",
  "assets/ArtTrials/RogueObjects/tree-dead.png": "99bd2d41",
  "assets/ArtTrials/RogueObjects/tree-root-a.png": "d190ad93",
  "assets/ArtTrials/RogueObjects/tree-root-b.png": "06843836",
  "assets/ArtTrials/RogueObjects/tree-rounded-2.png": "f5435a41",
  "assets/ArtTrials/RogueObjects/tree-rounded-3.png": "e40547ab",
  "assets/ArtTrials/RogueObjects/tree-wide-a.png": "72639d55",
  "assets/ArtTrials/RogueObjects/tree-wide-b.png": "e84116cc",
  "assets/ArtTrials/RogueProps/containers/chest.png": "0bb9503a",
  "assets/ArtTrials/RogueProps/containers/clay_pot.png": "6b0b9a8f",
  "assets/ArtTrials/RogueProps/containers/wood.png": "2c6c6b06",
  "assets/ArtTrials/RogueProps/fixtures/barricade.png": "cc09063d",
  "assets/ArtTrials/RogueProps/fixtures/elevators.png": "ca556828",
  "assets/ArtTrials/RogueProps/fixtures/gatepost.png": "93e51df3",
  "assets/ArtTrials/RogueProps/fixtures/grave.png": "ceb86b1b",
  "assets/ArtTrials/RogueProps/fixtures/ladder-down.png": "d570eb50",
  "assets/ArtTrials/RogueProps/fixtures/ladder-up.png": "322425c6",
  "assets/ArtTrials/RogueProps/fixtures/lamp-unlit.png": "da082fac",
  "assets/ArtTrials/RogueProps/fixtures/scope.png": "75efa6e7",
  "assets/ArtTrials/RogueProps/fixtures/shrines.png": "89b8fb11",
  "assets/ArtTrials/RogueProps/fixtures/votive.png": "9612ce2b",
  "assets/ArtTrials/RogueProps/fixtures/waystone.png": "3e0dbf25",
  "assets/ArtTrials/RogueProps/fixtures/well.png": "91483c49",
  "assets/ArtTrials/RogueProps/flora-approved_wetland_reeds.png": "0af44067",
  "assets/ArtTrials/RogueProps/flora-bramble.png": "3ce0d9e7",
  "assets/ArtTrials/RogueProps/flora-lowpoly-materials.png": "d6f84753",
  "assets/ArtTrials/RogueProps/flora-petnip.png": "af901c0e",
  "assets/ArtTrials/RogueProps/flora-props.png": "64dd87c7",
  "assets/ArtTrials/RogueProps/flora-rock_variants.png": "cf274570",
  "assets/ArtTrials/RogueProps/flora-selected_longgrass.png": "77036761",
  "assets/ArtTrials/RogueProps/flora-selected_mushroom.png": "ce49f70a",
  "assets/ArtTrials/RogueProps/flora-springcrops.png": "72cd531f",
  "assets/ArtTrials/RogueProps/flora-zone_hedge_single.png": "9d5993da",
  "assets/ArtTrials/RogueTerrain/tiles.png": "473310b3",
  "assets/Character/AssasinCyan.png": "a1915f71",
  "assets/Character/BowmanCyan.png": "11ed3c42",
  "assets/Character/CyanKnight.png": "89dd17d0",
  "assets/Character/Dragon/babydragon_sheets/dragon_red.png": "0589e9dd",
  "assets/Character/FarmerCyan.png": "7c6b4d28",
  "assets/Character/MageCyan.png": "12b071b6",
  "assets/Character/SwordsmanCyan.png": "57dd749f",
  "assets/Enemy/Bat/1Fullsheet_Bat.png": "7f4528e0",
  "assets/Enemy/Bat/Reskin/1Fullsheet_VampireBat.png": "bbaea53b",
  "assets/Enemy/Bee/Bee.png": "010f793a",
  "assets/Enemy/Boar.png": "7f2d20f1",
  "assets/Enemy/Brute/1Fullsheet_Brute.png": "d144060f",
  "assets/Enemy/Brute/Reskin/1Fullsheet_HellBrute.png": "6c9656b2",
  "assets/Enemy/Demons/ArmouredRedDemon.png": "d97eb830",
  "assets/Enemy/Demons/PurpleDemon.png": "da086e1c",
  "assets/Enemy/Demons/RedDemon.png": "e07c0dbf",
  "assets/Enemy/Dragons/RedDragon.png": "8aec2297",
  "assets/Enemy/Ghost/1Fullsheet_Ghost.png": "86ada061",
  "assets/Enemy/Ghost/Reskin/1Fullsheet_PinkGhost.png": "dc4fdb91",
  "assets/Enemy/GiantCrab.png": "633bd8b3",
  "assets/Enemy/Goblin Archer.png": "a594e74a",
  "assets/Enemy/Goblin.png": "c8485351",
  "assets/Enemy/LargeDirectionalV2/bugbear.png": "a4dc849e",
  "assets/Enemy/LargeDirectionalV2/giant-bear.png": "ae47c477",
  "assets/Enemy/LargeDirectionalV2/giant-reaper.png": "fcea8eeb",
  "assets/Enemy/LargeDirectionalV2/ogre.png": "fb95333c",
  "assets/Enemy/LargeDirectionalV2/troll.png": "9dc7fce1",
  "assets/Enemy/Necromancer.png": "adb05ab6",
  "assets/Enemy/Orcs/ArcherGoblin.png": "462f756d",
  "assets/Enemy/Orcs/ClubGoblin.png": "44f45545",
  "assets/Enemy/Orcs/FarmerGoblin.png": "dcdd5200",
  "assets/Enemy/Orcs/KamikazeGoblin.png": "e0e4c783",
  "assets/Enemy/Orcs/Orc.png": "7534bb56",
  "assets/Enemy/Orcs/OrcMage.png": "75744771",
  "assets/Enemy/Orcs/OrcShaman.png": "f2ce0c5d",
  "assets/Enemy/Orcs/SpearGoblin.png": "06fdfad7",
  "assets/Enemy/Pirates/PirateCaptain.png": "4dfb60b1",
  "assets/Enemy/Pirates/PirateGrunt.png": "bd55fc67",
  "assets/Enemy/Pirates/PirateGunner.png": "c8dfeae7",
  "assets/Enemy/Plant/1Fullsheet_Plant.png": "6350265e",
  "assets/Enemy/Plant/Reskin/1Fullsheet_BonePlant.png": "fc72b100",
  "assets/Enemy/Purple Slime.png": "0b22864f",
  "assets/Enemy/SegmentedSerpent/parts.png": "4c7e813e",
  "assets/Enemy/Skeleton/1Fullsheet_Skeleton.png": "b10d4d1f",
  "assets/Enemy/Skeleton/Reskin/1Fullsheet_DrySkeleton.png": "4e842f47",
  "assets/Enemy/Skeleton/Skeleton-Soldier.png": "9040b30c",
  "assets/Enemy/Slime/1Fullsheet_Slime.png": "e9d44a99",
  "assets/Enemy/Slime Green.png": "8275fb7e",
  "assets/Enemy/Spider/1Fullsheet_Spider.png": "03808e40",
  "assets/Enemy/Spider/Reskin/1Fullsheet_PoisonSpider.png": "2a8693e5",
  "assets/Enemy/Succubus/1Fullsheet_Succubus.png": "f3e54778",
  "assets/Enemy/Succubus/Reskin/1Fullsheet_Dryad.png": "37d6e8e3",
  "assets/Enemy/Zombie/1Fullsheet_Zombie.png": "c3270696",
  "assets/Enemy/Zombie/Reskin/1Fullsheet_Fiend.png": "1e8670a9",
  "assets/Enemy/spr_mini_monsters_spritesheet.png": "bb6b07b9",
  "assets/Farm Animals/Chicken Red.png": "e686e0bf",
  "assets/Farm Animals/Crab.png": "633bd8b3",
  "assets/Farm Animals/Female Cow Brown.png": "2fc6c8fa",
  "assets/Farm Animals/Horse.png": "34847aa7",
  "assets/Farm Animals/Turtle.png": "ac1f581f",
  "assets/Icons/AltWeapons/1/Dagger.png": "d1d16ea4",
  "assets/Icons/AltWeapons/1/Lance.png": "7a2df61e",
  "assets/Icons/AltWeapons/1/Musket.png": "cabc34a2",
  "assets/Icons/AltWeapons/3/Dagger.png": "5ce99b09",
  "assets/Icons/AltWeapons/3/Lance.png": "a86d07a4",
  "assets/Icons/AltWeapons/3/Musket.png": "00f2fa85",
  "assets/Icons/AltWeapons/5/Dagger.png": "433a73c1",
  "assets/Icons/AltWeapons/5/Lance.png": "45a17f72",
  "assets/Icons/AltWeapons/5/Musket.png": "7f97a331",
  "assets/Icons/DialogItems/items-01.png": "a6070585",
  "assets/Icons/DialogItems/items-02.png": "3b7d0d1e",
  "assets/Icons/DialogItems/items-03.png": "93b1f739",
  "assets/Icons/DialogItems/items-04.png": "c8ad6b06",
  "assets/Icons/DialogItems/items-05.png": "c9776417",
  "assets/Icons/Fish/River/Golden Fish.png": "8f7a79f4",
  "assets/Icons/Fish/River/Large Mouth Bass.png": "ec034481",
  "assets/Icons/Fish/River/Tiger Trout.png": "00df0ad2",
  "assets/Icons/Fish/Sea/Creatures/Shell-24.png": "ec01492f",
  "assets/Icons/Fish/Sea/Salmon.png": "ba03e58d",
  "assets/Icons/Fish/Sea/Smallmouth Bass.png": "2e7a8556",
  "assets/Icons/Food Icons/Apple.png": "b7571b90",
  "assets/Icons/Food Icons/Apricot.png": "a7fec9c6",
  "assets/Icons/Food Icons/Banana.png": "d3044335",
  "assets/Icons/Food Icons/Beef.png": "c9c0a7f4",
  "assets/Icons/Food Icons/Black rabbit Fur.png": "2cd4aff2",
  "assets/Icons/Food Icons/Cherry.png": "83f12eba",
  "assets/Icons/Food Icons/Chicken Egg.png": "066fcf2e",
  "assets/Icons/Food Icons/Coconut.png": "c2f608ce",
  "assets/Icons/Food Icons/Cooked.png": "ffcbee45",
  "assets/Icons/Food Icons/Mango.png": "0bb10a89",
  "assets/Icons/Food Icons/Orange.png": "4ed00d45",
  "assets/Icons/Food Icons/Peach.png": "5c7a1774",
  "assets/Icons/Food Icons/Small Cow Milk.png": "e58d30f5",
  "assets/Icons/Items/GiantMushroom.png": "8600fbd1",
  "assets/Icons/Items/GripPotion.png": "80652b43",
  "assets/Icons/Items/Honey.png": "6f39df63",
  "assets/Icons/Items/Lantern.png": "886d5ae2",
  "assets/Icons/Items/MagicHammer.png": "bf8c71bc",
  "assets/Icons/Items/MagicTrap.png": "0a07da15",
  "assets/Icons/Items/MoonbeamScroll.png": "f64760be",
  "assets/Icons/Items/Potion_light.png": "d1b8dea4",
  "assets/Icons/Items/Potions.png": "2edea935",
  "assets/Icons/Items/RavenScroll.png": "20f21c7d",
  "assets/Icons/Items/Rope.png": "536c2f28",
  "assets/Icons/Items/SerpentIdol.png": "86dbcaca",
  "assets/Icons/Items/SkeletonScroll.png": "c6c3c07c",
  "assets/Icons/Items/Spear.png": "897e87cb",
  "assets/Icons/Items/ThunderScroll.png": "96abb018",
  "assets/Icons/Items/Torch.png": "0c35a90b",
  "assets/Icons/Items/TrapDisarmKit.png": "451f7ff3",
  "assets/Icons/Items/WindScroll.png": "f2e04336",
  "assets/Icons/Items/WraithScroll.png": "4d7351f4",
  "assets/Icons/Items/compass.png": "34c47a57",
  "assets/Icons/Items/field_scope.png": "aab069dc",
  "assets/Icons/Items/goblet.png": "88303114",
  "assets/Icons/Items/gold_shield.png": "bc75e768",
  "assets/Icons/Items/lucky_key.png": "11aa4a95",
  "assets/Icons/Items/marketeers_guild_badge.png": "26112aab",
  "assets/Icons/Items/metal_shield.png": "460494f1",
  "assets/Icons/Items/orb.png": "4ea14fa8",
  "assets/Icons/Items/smiths_guild_badge.png": "a1f94af9",
  "assets/Icons/Items/traders_guild_badge.png": "d9161b89",
  "assets/Icons/Items/wood_shield.png": "ea38b955",
  "assets/Icons/RPG icons/Extras/Amulet.png": "556a52a6",
  "assets/Icons/RPG icons/Extras/Bags.png": "5682ac64",
  "assets/Icons/RPG icons/Extras/Bars and ores.png": "08a489db",
  "assets/Icons/RPG icons/Extras/Books.png": "5db4928d",
  "assets/Icons/RPG icons/Extras/Bug net.png": "d4f54ed0",
  "assets/Icons/RPG icons/Extras/Chicken feather.png": "5041fb9a",
  "assets/Icons/RPG icons/Extras/Coal.png": "7bf60603",
  "assets/Icons/RPG icons/Extras/Gemstones.png": "3a743fde",
  "assets/Icons/RPG icons/Extras/Rings.png": "2842a196",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Axe.png": "640cd159",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Boots.png": "41abeda8",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Bow.png": "bda497c9",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Bug net.png": "622d82ed",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Chestplate.png": "6deb282d",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Fishing Rod.png": "27a1a902",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Helmet.png": "354605aa",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Hoe.png": "d4c410c0",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Leggings.png": "89c87698",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Pickaxe.png": "2a15e6a9",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Staff.png": "de0c1e27",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Sword.png": "927b637f",
  "assets/Icons/RPG icons/Weapons and Armor/1. Wood/Watering can.png": "dda154d7",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Axe.png": "c85e6253",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Boots.png": "3a9f5377",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Bow.png": "e95483a1",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Chestplate.png": "4112036b",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Fishing Rod.png": "07cbbef1",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Helmet.png": "0ddf655f",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Hoe.png": "a7194bd6",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Leggings.png": "387d79a3",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Pickaxe.png": "ca812d9c",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Staff.png": "e0901690",
  "assets/Icons/RPG icons/Weapons and Armor/2. Cooper/Sword.png": "e16be766",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Axe.png": "691585d7",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Boots.png": "450e0355",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Bow.png": "4d55c6a0",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Chestplate.png": "eb67ae49",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Fishing Rod.png": "fb7f830c",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Helmet.png": "55d387df",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Hoe.png": "1ecd7a27",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Leggings.png": "bc320dba",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Pickaxe.png": "ae517261",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Staff.png": "6b326b0d",
  "assets/Icons/RPG icons/Weapons and Armor/3. Iron/Sword.png": "fab4158e",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Axe.png": "2bd0d399",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Boots.png": "96c92155",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Bow.png": "520cf214",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Chestplate.png": "27ed3bbf",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Fishing Rod.png": "d560d556",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Helmet.png": "5b143eb8",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Hoe.png": "afee5ae7",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Leggings.png": "d809bde3",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Pickaxe.png": "5fbae74a",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Staff.png": "377b23c3",
  "assets/Icons/RPG icons/Weapons and Armor/4. Gold/Sword.png": "931c3589",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Axe.png": "71543cc1",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Boots.png": "3e3f76c2",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Bow.png": "9d5b7b84",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Chestplate.png": "3c50fe6d",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Fishing Rod.png": "b7a7081a",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Helmet.png": "7ce7a094",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Hoe.png": "5c1e881c",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Leggings.png": "adc61ca0",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Pickaxe.png": "47cf7714",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Staff.png": "72ba69a6",
  "assets/Icons/RPG icons/Weapons and Armor/5. Platinum/Sword.png": "3f3e7bc1",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Axe.png": "066b7096",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Boots.png": "06934bfb",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Bow.png": "d474b658",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Chestplate.png": "3d9f08b3",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Fishing Rod.png": "6abe315c",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Helmet.png": "8a98b8d4",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Hoe.png": "fc5b936c",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Leggings.png": "2641988b",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Pickaxe.png": "e5752a60",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Staff.png": "b44ac47f",
  "assets/Icons/RPG icons/Weapons and Armor/6. Crimson/Sword.png": "847606f0",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Axe.png": "a2031cbf",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Boots.png": "ada31fb8",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Bow.png": "85bc0c2f",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Chestplate.png": "f6507229",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Fishing Rod.png": "11533f8e",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Helmet.png": "4da8b2ef",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Hoe.png": "5c5e9e7f",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Leggings.png": "87909d2f",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Pickaxe.png": "c60441ea",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Staff.png": "b2484a06",
  "assets/Icons/RPG icons/Weapons and Armor/7. Frost/Sword.png": "232136a0",
  "assets/Icons/SelectedItems/items.png": "5aa36f2f",
  "assets/Icons/StatusEffects/status-icons.png": "5c063f56",
  "assets/Icons/coin.png": "4c9e7ebc",
  "assets/Icons/dom-atlas.png": "0d0d4819",
  "assets/NPC/Ayo_human_idle.png": "39297eca",
  "assets/NPC/Ayo_human_walk.png": "ba53a101",
  "assets/NPC/Citizen_woman01_idle.png": "8ab400ca",
  "assets/NPC/Citizen_woman01_walk.png": "15bfcd0f",
  "assets/NPC/Citizen_woman02_idle.png": "d4a645a4",
  "assets/NPC/Citizen_woman02_walk.png": "71a74ae7",
  "assets/NPC/Citizen_woman03_idle.png": "28189d01",
  "assets/NPC/Citizen_woman03_walk.png": "470ae2cb",
  "assets/NPC/Orrin_old_man_idle.png": "9915897f",
  "assets/NPC/Orrin_old_man_walk.png": "f39dcad7",
  "assets/NPC/barn_raiser_idle.png": "1e64866f",
  "assets/NPC/barn_raiser_walk.png": "6d2f2ed2",
  "assets/NPC/barterer_idle.png": "a75f3492",
  "assets/NPC/barterer_walk.png": "239ed27e",
  "assets/NPC/den_keeper_idle.png": "82d94e38",
  "assets/NPC/den_keeper_walk.png": "f534bcb0",
  "assets/NPC/fieldwalker_idle.png": "5bfabca7",
  "assets/NPC/fieldwalker_walk.png": "297c2ac4",
  "assets/NPC/forager_idle.png": "8b0a66fd",
  "assets/NPC/forager_walk.png": "5d4deef1",
  "assets/NPC/fox_storyteller_idle.png": "e8d30668",
  "assets/NPC/fox_storyteller_walk.png": "79889a6f",
  "assets/NPC/fox_tracker_idle.png": "42f622b8",
  "assets/NPC/fox_tracker_walk.png": "0c53f12c",
  "assets/NPC/fox_trader_idle.png": "70fc468c",
  "assets/NPC/fox_trader_walk.png": "d166c45f",
  "assets/NPC/harvest_trader_idle.png": "725971f8",
  "assets/NPC/harvest_trader_walk.png": "ce7891ad",
  "assets/NPC/lamplighter_idle.png": "3c5147a0",
  "assets/NPC/lamplighter_walk.png": "0fb6f298",
  "assets/NPC/lorekeeper_idle.png": "42bd12d5",
  "assets/NPC/lorekeeper_walk.png": "53797a9a",
  "assets/NPC/market_trader_idle.png": "73f5d878",
  "assets/NPC/market_trader_walk.png": "8c9ca52f",
  "assets/NPC/mason_idle.png": "cb1f0728",
  "assets/NPC/mason_walk.png": "e2810427",
  "assets/NPC/peddler_idle.png": "7341deff",
  "assets/NPC/peddler_walk.png": "41ea290f",
  "assets/NPC/ranger_idle.png": "2bb8f0c3",
  "assets/NPC/ranger_walk.png": "c6af0bf2",
  "assets/NPC/seed_seller_idle.png": "5283094a",
  "assets/NPC/seed_seller_walk.png": "28761d7d",
  "assets/NPC/shrine_keeper_idle.png": "ed2c230e",
  "assets/NPC/shrine_keeper_walk.png": "9630aec6",
  "assets/NPC/shrine_lorekeeper_idle.png": "c3bab1de",
  "assets/NPC/shrine_lorekeeper_walk.png": "3c5ed43b",
  "assets/NPC/shrine_trader_idle.png": "29dd1958",
  "assets/NPC/shrine_trader_walk.png": "1ee8ec89",
  "assets/NPC/shrine_warden_idle.png": "d3bd72a2",
  "assets/NPC/shrine_warden_walk.png": "ea80cb52",
  "assets/NPC/stonemason_idle.png": "ff6a2a6b",
  "assets/NPC/stonemason_walk.png": "891a537c",
  "assets/NPC/storykeeper_idle.png": "d876d1fb",
  "assets/NPC/storykeeper_walk.png": "dbd2dae9",
  "assets/NPC/town_guide_idle.png": "01d8996c",
  "assets/NPC/town_guide_walk.png": "8a0bb10b",
  "assets/NPC/wayfinder_idle.png": "aa3349e4",
  "assets/NPC/wayfinder_walk.png": "22d0c257",
  "assets/Objects/Approved/apple_tree.png": "3e9b3626",
  "assets/Objects/Approved/approved_charred_stakes.png": "380d334c",
  "assets/Objects/Approved/barricade.png": "45c55ed8",
  "assets/Objects/Approved/bike_rack.png": "c57667e3",
  "assets/Objects/Approved/bone_pile.png": "84e097ba",
  "assets/Objects/Approved/bottle.png": "46926df1",
  "assets/Objects/Approved/coin_pile_11_25.png": "98aa8b4f",
  "assets/Objects/Approved/coin_pile_2.png": "3c418889",
  "assets/Objects/Approved/coin_pile_26_50.png": "6f8dbacd",
  "assets/Objects/Approved/coin_pile_3.png": "2a6c3ee5",
  "assets/Objects/Approved/coin_pile_4.png": "69135ce0",
  "assets/Objects/Approved/coin_pile_5.png": "3922316e",
  "assets/Objects/Approved/coin_pile_51.png": "5fcc7904",
  "assets/Objects/Approved/coin_pile_6_10.png": "8c9883da",
  "assets/Objects/Approved/coin_single_ground.png": "191424c1",
  "assets/Objects/Approved/crops.png": "00d16bdc",
  "assets/Objects/Approved/driftwood.png": "e0999ae0",
  "assets/Objects/Approved/gas-mushroom-large.png": "d85b5a66",
  "assets/Objects/Approved/house.png": "6425b9d1",
  "assets/Objects/Approved/house_blacksmith.png": "00bf1d11",
  "assets/Objects/Approved/house_fort.png": "2ce99bf0",
  "assets/Objects/Approved/house_fort_unclaimed.png": "6c920428",
  "assets/Objects/Approved/house_market.png": "97a3c417",
  "assets/Objects/Approved/house_trader.png": "79246b87",
  "assets/Objects/Approved/house_wreck.png": "503c90e7",
  "assets/Objects/Approved/mineralrock.png": "f2aeac90",
  "assets/Objects/Approved/peach_tree.png": "a3e2afea",
  "assets/Objects/Approved/pier.png": "e6dd0763",
  "assets/Objects/Approved/pine_tree.png": "f88156f7",
  "assets/Objects/Approved/props.png": "7157df1d",
  "assets/Objects/Approved/scarecrow.png": "952c9882",
  "assets/Objects/Approved/shrine.png": "eccf0591",
  "assets/Objects/Approved/springcrops.png": "8c209f7e",
  "assets/Objects/Approved/stair_down.png": "1ecf6813",
  "assets/Objects/Approved/stair_up.png": "e9a324ed",
  "assets/Objects/Approved/tar.png": "f3ede916",
  "assets/Objects/Approved/trees.png": "6ab39c9e",
  "assets/Objects/AuthoredBuildings/FDR_Blacksmith.png": "ee44c2b7",
  "assets/Objects/AuthoredBuildings/flat-adobe.png": "217864ca",
  "assets/Objects/AuthoredBuildings/flat-rooftop.png": "cb9fc7c2",
  "assets/Objects/AuthoredBuildings/pp-brick-red.png": "0c3a913d",
  "assets/Objects/AuthoredBuildings/pp-cabin-red.png": "c84cf85c",
  "assets/Objects/AuthoredBuildings/pp-flat-blue.png": "4246446b",
  "assets/Objects/AuthoredBuildings/pp-flat-brown.png": "15e83468",
  "assets/Objects/AuthoredBuildings/pp-flat-green.png": "cfcd60c7",
  "assets/Objects/AuthoredBuildings/pp-flat-orange.png": "147ff943",
  "assets/Objects/AuthoredBuildings/pp-flat-pink.png": "c78675ed",
  "assets/Objects/AuthoredBuildings/pp-flat-red.png": "d32bf006",
  "assets/Objects/AuthoredBuildings/pp-plaster-red.png": "d4a6dee3",
  "assets/Objects/AuthoredBuildings/steam-blacksmith.png": "fd36e8b3",
  "assets/Objects/Beach/shipwreck_shrine_runtime.png": "0eddaf3a",
  "assets/Objects/BuildingMaterials/all-floors.png": "c30adc48",
  "assets/Objects/BuildingMaterials/all-walls.png": "b6ea82c2",
  "assets/Objects/BuildingMaterials/approved-materials-v1.png": "d4596946",
  "assets/Objects/BuildingMaterials/reference-materials-v3.png": "38fc2ff3",
  "assets/Objects/BuildingMaterials/wreck-floor-cel.png": "8a303ad2",
  "assets/Objects/BuildingMaterials/wreck-plinth.png": "b25d5594",
  "assets/Objects/Castle/FDR/atlas.png": "6050c667",
  "assets/Objects/Castle/FDR/floor.png": "3c5de081",
  "assets/Objects/Castle/tower_shapes.png": "0b7d9e6d",
  "assets/Objects/Cave/floor-wall-sources.png": "d3fa1eb3",
  "assets/Objects/Cave/poison_vent_inactive.png": "b42d2b64",
  "assets/Objects/Cave/props.png": "6b6f2cc3",
  "assets/Objects/CelProps/palms.png": "09ce414d",
  "assets/Objects/CelProps/pots-smashed.png": "169ab8d2",
  "assets/Objects/DailyVisits/potofgold.png": "68ee01c6",
  "assets/Objects/DailyVisits/wagon.png": "ab9c7c68",
  "assets/Objects/Furniture/furniture-32.png": "62c41a95",
  "assets/Objects/Furniture/furniture-icons-16.png": "d1a78f0c",
  "assets/Objects/Generated/apothecary_simple.png": "295b80fb",
  "assets/Objects/Generated/bank_simple.png": "980f865f",
  "assets/Objects/Generated/chapel_simple.png": "1d09e11d",
  "assets/Objects/Generated/curio_simple.png": "06d10da4",
  "assets/Objects/Generated/guildhall_simple.png": "00140375",
  "assets/Objects/Generated/inn_simple.png": "9533cb50",
  "assets/Objects/Generated/market_stand_simple.png": "9a84bf8f",
  "assets/Objects/Generated/scholar_simple.png": "5a186e24",
  "assets/Objects/Generated/scriptorium_simple.png": "8b8a1084",
  "assets/Objects/Generated/sundries_simple.png": "48d9c82e",
  "assets/Objects/Generated/training_simple.png": "436e6adb",
  "assets/Objects/Handmade/petnip.png": "819fafab",
  "assets/Objects/HazardAnimationsV2/cavein.png": "ad69b1f2",
  "assets/Objects/HazardAnimationsV2/sinkhole.png": "03d9a0aa",
  "assets/Objects/HazardAnimationsV2/tornado.png": "8a6f5393",
  "assets/Objects/HazardAnimationsV2/vent-cycle-complete.png": "3bc690f4",
  "assets/Objects/Hedges/hedges-24.png": "5d1738e0",
  "assets/Objects/Home/firepit.png": "33280385",
  "assets/Objects/PPBuildings/city-gearhouse.png": "289278ff",
  "assets/Objects/PPBuildings/city-storefront.png": "40062b1d",
  "assets/Objects/PPBuildings/com_houses_05.png": "cdf55975",
  "assets/Objects/PPBuildings/steam-home.png": "1223ffd8",
  "assets/Objects/PPBuildings/steam-wizard.png": "1a29a7fb",
  "assets/Objects/PPBuildings/wizard.png": "25374f37",
  "assets/Objects/Pets/cat.png": "1e8a28ed",
  "assets/Objects/Pets/dog.png": "aa2839e6",
  "assets/Objects/Pickup_Items.png": "e2dbff8b",
  "assets/Objects/Progression/icons.png": "24092ac1",
  "assets/Objects/Progression/tiles.png": "8b0bfb1b",
  "assets/Objects/Reef/coral.png": "88a65d20",
  "assets/Objects/Road copiar.png": "eb7417d4",
  "assets/Objects/RollingBallAndWall/ball.png": "70123961",
  "assets/Objects/RollingBallAndWall/spike-wall.png": "9b213e0b",
  "assets/Objects/SelectedFlora/flint.png": "5ed3e72b",
  "assets/Objects/SelectedFlora/selected_dead_tree.png": "a3bb2a78",
  "assets/Objects/SelectedFlora/selected_longgrass.png": "8ba96852",
  "assets/Objects/SelectedFlora/selected_mushroom.png": "d3c8b64c",
  "assets/Objects/SelectedFlora/selected_shrub.png": "bcf1470b",
  "assets/Objects/SelectedFlora/zone_berry_bush.png": "a2a5c05f",
  "assets/Objects/SelectedProps/barrel.png": "5d533e6f",
  "assets/Objects/SelectedProps/box.png": "198b7851",
  "assets/Objects/SelectedProps/cave_mechanisms.png": "80280c3f",
  "assets/Objects/SelectedProps/clay_pot.png": "c14be12e",
  "assets/Objects/SelectedProps/crystal_cluster.png": "1e713f1a",
  "assets/Objects/SelectedProps/gas_mushroom_small.png": "16d5c088",
  "assets/Objects/SelectedProps/selected_grave_pillar.png": "2a1f2e6f",
  "assets/Objects/SelectedProps/signpost.png": "84aadac3",
  "assets/Objects/SelectedWorld/world.png": "18fb3b28",
  "assets/Objects/Stronghold/walls-24.png": "42926d98",
  "assets/Objects/Wilderness/Azure Butterfly.png": "0c965543",
  "assets/Objects/Wilderness/Beehive.png": "d89820ed",
  "assets/Objects/Wilderness/Crow.png": "42ab12e1",
  "assets/Objects/Wilderness/Deer Idle.png": "79f08116",
  "assets/Objects/Wilderness/Rabbit White.png": "b1c8e8f4",
  "assets/Objects/Wilderness/bonfire.png": "10ade4b5",
  "assets/Objects/Wilderness/wood.png": "034e40b6",
  "assets/Objects/ZoneVariants/approved-24.png": "679c3d66",
  "assets/Objects/ZoneVariants/tall_pillar.png": "19238fcb",
  "assets/art/barehand_tree.webp": "297fd49b",
  "assets/art/barehand_work.webp": "8d6efa0a",
  "assets/art/book_page.webp": "7d3a2759",
  "assets/art/book_read.webp": "3e63f5d5",
  "assets/art/booth_apothecary_intro.webp": "88c205ce",
  "assets/art/booth_apothecary_used.webp": "6ee6021a",
  "assets/art/booth_bank_intro.webp": "e7e10786",
  "assets/art/booth_bank_used.webp": "4eeb00f9",
  "assets/art/booth_chapel_intro.webp": "f18adfea",
  "assets/art/booth_chapel_used.webp": "b8999062",
  "assets/art/booth_curio_intro.webp": "7899ad71",
  "assets/art/booth_curio_used.webp": "2d2536e7",
  "assets/art/booth_guildhall_intro.webp": "df61d0e4",
  "assets/art/booth_guildhall_used.webp": "2e9935a9",
  "assets/art/booth_inn_intro.webp": "c7f3bbe9",
  "assets/art/booth_inn_used.webp": "5d4620c5",
  "assets/art/booth_scholar_intro.webp": "54cf3483",
  "assets/art/booth_scholar_used.webp": "eca7a890",
  "assets/art/booth_scriptorium_intro.webp": "5d95f048",
  "assets/art/booth_scriptorium_used.webp": "0d31458a",
  "assets/art/booth_sundries_intro.webp": "c93c4b0c",
  "assets/art/booth_sundries_used.webp": "36685c5b",
  "assets/art/booth_training_intro.webp": "9bc77fbf",
  "assets/art/booth_training_used.webp": "fbb967df",
  "assets/art/bottle_read.webp": "9fd8bd5a",
  "assets/art/castle_claim.webp": "8a042888",
  "assets/art/castle_favour.webp": "14dfd036",
  "assets/art/cave_first.webp": "80c9d3ec",
  "assets/art/chest_t1.webp": "9611b792",
  "assets/art/chest_t2.webp": "eb43f987",
  "assets/art/chest_t3.webp": "3aa814e7",
  "assets/art/chest_t4.webp": "208be0d7",
  "assets/art/chest_t5.webp": "c2741781",
  "assets/art/chest_t6.webp": "16dcb401",
  "assets/art/chest_t7.webp": "bfece929",
  "assets/art/coin_first.webp": "ac325bf6",
  "assets/art/death_memories.webp": "dc795a29",
  "assets/art/delivery_first.webp": "fa0762d8",
  "assets/art/discovery_badge.webp": "6f4c374c",
  "assets/art/event_dragon_powder.webp": "7575d8f6",
  "assets/art/fall_cave_in.webp": "3b3d287b",
  "assets/art/fall_open_pit.webp": "c88f7b9e",
  "assets/art/fire_first.webp": "deb62b48",
  "assets/art/first_sale.webp": "a27a8f1e",
  "assets/art/forge_done.webp": "ca89eb2a",
  "assets/art/fort_unseal.webp": "93423ef5",
  "assets/art/health_low.webp": "ba65785f",
  "assets/art/home_sell.webp": "3ac731ba",
  "assets/art/kind_build.webp": "b61c46fe",
  "assets/art/kind_craft.webp": "6ee460ff",
  "assets/art/kind_delivery.webp": "79738048",
  "assets/art/kind_energy.webp": "e5f10986",
  "assets/art/kind_farm.webp": "6b2ecdad",
  "assets/art/kind_fire.webp": "dd04f22e",
  "assets/art/kind_forge.webp": "5ecaf104",
  "assets/art/kind_memory.webp": "30b4f24c",
  "assets/art/kind_menu.webp": "0013cb6a",
  "assets/art/kind_note.webp": "618ee511",
  "assets/art/kind_quest.webp": "7f5efe27",
  "assets/art/kind_relics.webp": "44ce694f",
  "assets/art/kind_rest.webp": "2394a73b",
  "assets/art/kind_shop.webp": "3178e889",
  "assets/art/kind_slots.webp": "cee51355",
  "assets/art/kind_supplies.webp": "b493bcac",
  "assets/art/kind_trade.webp": "a8992488",
  "assets/art/kind_trail.webp": "37ee4c19",
  "assets/art/kind_treasure.webp": "d1cc0f47",
  "assets/art/kind_use.webp": "511da58b",
  "assets/art/kind_wizard.webp": "f9d2b493",
  "assets/art/memory_doorway.webp": "a7f2ac06",
  "assets/art/memory_grip.webp": "048296d6",
  "assets/art/npc_bryn.webp": "4ba9d29e",
  "assets/art/npc_edda.webp": "b1a83ad6",
  "assets/art/npc_maud.webp": "c6b8a754",
  "assets/art/npc_orrin.webp": "9c1ce2eb",
  "assets/art/npc_tilly.webp": "3b539f1f",
  "assets/art/npc_tilly_happy.webp": "bdfeed52",
  "assets/art/pet_clearing.webp": "943c3ea8",
  "assets/art/progression_arena.webp": "8c506478",
  "assets/art/progression_elevator.webp": "3075a56f",
  "assets/art/progression_portal.webp": "cc522331",
  "assets/art/quarry_sapphire.webp": "8d15066c",
  "assets/art/restore_blacksmith.webp": "05c2d8e9",
  "assets/art/restore_house.webp": "137e145f",
  "assets/art/restore_market.webp": "5e5e2810",
  "assets/art/restore_trader.webp": "8c7c57b3",
  "assets/art/restore_wizard.webp": "efa76a33",
  "assets/art/revive_fall.webp": "ef351834",
  "assets/art/revive_found.webp": "4727da9f",
  "assets/art/revive_wake.webp": "522d72f6",
  "assets/art/road_repair.webp": "d450dd46",
  "assets/art/safety_phone.webp": "fff5a7c2",
  "assets/art/safety_welcome.webp": "abec3033",
  "assets/art/shiny_first.webp": "5dca432b",
  "assets/art/shrine_bone_watcher.webp": "7d3bf31a",
  "assets/art/shrine_ember_altar.webp": "c56b0e3b",
  "assets/art/shrine_grove.webp": "dbda9c1d",
  "assets/art/shrine_harvest_idol.webp": "0aac7a1e",
  "assets/art/shrine_lantern_saint.webp": "f6cb20d1",
  "assets/art/shrine_moss_cairn.webp": "9dd5e5a9",
  "assets/art/shrine_rust_totem.webp": "080b7bd0",
  "assets/art/shrine_tide_bell.webp": "0402829a",
  "assets/art/shrine_toad_idol.webp": "57a3e10a",
  "assets/art/shrine_wayfarer_post.webp": "092e6cda",
  "assets/art/shrine_wishing_well.webp": "a880c80f",
  "assets/art/story_ayo_arrival.webp": "879abc27",
  "assets/art/story_compass.webp": "0f16f4e9",
  "assets/art/story_compass_frame2.webp": "4c9e1536",
  "assets/art/story_nightmare.webp": "18322b9d",
  "assets/art/story_nightmare_city_mask.svg": "d2e7c53e",
  "assets/art/story_nightmare_frame2.webp": "4ba21051",
  "assets/art/story_nightmare_frame3.webp": "9f2ae15e",
  "assets/art/story_nightmare_frame4.webp": "bb10c103",
  "assets/art/story_wake.webp": "9d01bdd0",
  "assets/art/story_wake_frame2.webp": "b55f492f",
  "assets/art/story_wrecks.webp": "ddc5d278",
  "assets/art/story_wrecks_frame2.webp": "ac032e0a",
  "assets/art/street_bandit.webp": "1cfc0793",
  "assets/art/street_barricade.webp": "d23eb43e",
  "assets/art/street_berry.webp": "2afa8398",
  "assets/art/street_berry_trail.webp": "bfd3530f",
  "assets/art/street_burned.webp": "f638e5bc",
  "assets/art/street_confusion_path.webp": "0af2c225",
  "assets/art/street_fire_path.webp": "afb9ee43",
  "assets/art/street_goblin_gang.webp": "175abbe5",
  "assets/art/street_golden.webp": "46f58cf8",
  "assets/art/street_golden_path.webp": "1c0e78bf",
  "assets/art/street_grassy_lane.webp": "3176146a",
  "assets/art/street_greenway.webp": "cd40a3a1",
  "assets/art/street_haunted_forest_path.webp": "b0fb122a",
  "assets/art/street_hedgerow.webp": "b4546581",
  "assets/art/street_highway.webp": "468359b7",
  "assets/art/street_lantern.webp": "b8f7364f",
  "assets/art/street_old_growth_path.webp": "63a63a52",
  "assets/art/street_orchard.webp": "d0f0ca35",
  "assets/art/street_overgrown.webp": "62b910f4",
  "assets/art/street_paralysis_path.webp": "a39ebff3",
  "assets/art/street_parkpath.webp": "7c604f6e",
  "assets/art/street_pilgrim.webp": "4d6c11d0",
  "assets/art/street_poison_path.webp": "93023880",
  "assets/art/street_pottery.webp": "fa866cb8",
  "assets/art/street_rocky_path.webp": "19bcb3a9",
  "assets/art/street_scenic.webp": "d7dba731",
  "assets/art/street_slime_trail.webp": "8d5469f7",
  "assets/art/street_snare.webp": "1fcf3780",
  "assets/art/street_spider_path.webp": "9a7b4116",
  "assets/art/street_thorny.webp": "fa7f2022",
  "assets/art/street_toadstool.webp": "80bb0127",
  "assets/art/street_trade.webp": "ffe397fe",
  "assets/art/street_way_of_variety.webp": "a337a002",
  "assets/art/temple_activated.webp": "ac50f2db",
  "assets/art/tool_catch.webp": "b7ba8745",
  "assets/art/tool_catch_chicken.webp": "f9051b59",
  "assets/art/tool_chop.webp": "5d4a9007",
  "assets/art/tool_dig.webp": "06fcd740",
  "assets/art/tool_shoot.webp": "fe725c45",
  "assets/art/tool_staff.webp": "a391cedd",
  "assets/art/tool_sword.webp": "a68eab18",
  "assets/art/tool_till.webp": "4729e91f",
  "assets/art/tool_water.webp": "328cffd5",
  "assets/art/torch_light.webp": "88b41194",
  "assets/art/trail_intro.webp": "c7fe56d5",
  "assets/art/trail_prize.webp": "42ccf1b8",
  "assets/art/trap_free.webp": "70320502",
  "assets/art/trap_jaw.webp": "ad2424ca",
  "assets/art/treasure_barrel.webp": "6a511f4f",
  "assets/art/treasure_crate.webp": "580bc504",
  "assets/art/treasure_dig.webp": "9b9ea777",
  "assets/art/treasure_pot.webp": "cd16bda2",
  "assets/art/turret_watch.webp": "18926548",
  "assets/art/underground_bone_gallery.webp": "4c08b741",
  "assets/art/underground_depth2_rock_scatter.webp": "487cc644",
  "assets/art/underground_gemstone_cavern.webp": "88ab30f5",
  "assets/art/underground_gemstone_path.webp": "eb8c87f5",
  "assets/art/underground_goblin_warrens.webp": "d4184073",
  "assets/art/underground_mine_tunnels.webp": "dca74cb5",
  "assets/art/underground_miners_way.webp": "e5c93eec",
  "assets/art/underground_mushroom_cavern.webp": "3eab80cd",
  "assets/art/underground_root_passage.webp": "cc356e51",
  "assets/art/underground_seep_passage.webp": "4b6d05d6",
  "assets/art/underground_sm_road_passage.webp": "88620ea8",
  "assets/art/underground_spring_cave.webp": "48b86721",
  "assets/art/underground_warren_run.webp": "796aca75",
  "assets/art/visit_bike.webp": "00dfd5f6",
  "assets/art/visit_gold.webp": "c2bf52ad",
  "assets/art/visit_hive.webp": "a5835fb0",
  "assets/art/visit_wagon.webp": "199a7845",
  "assets/art/wizard_cold.webp": "5a93fb8e",
  "assets/art/wizard_dragon.webp": "31b5fa0e",
  "assets/art/wizard_map.webp": "938b89d0",
  "assets/art/zone_grove.webp": "2c3a9296",
  "assets/art/zone_quarry.webp": "5c207cb9",
  "assets/art/zone_shore.webp": "71d28030",
  "assets/art/zone_stones.webp": "78311d1a",
  "assets/art/zone_tar.webp": "ea0123a0",
  "assets/art/zone_viewpoint.webp": "44b3225b",
  "assets/portraits/archaeologist.png": "bc64d08f",
  "assets/portraits/baby_cat.png": "e8c43a5c",
  "assets/portraits/baby_cow.png": "818fea5b",
  "assets/portraits/baby_dog.png": "d7fe4e30",
  "assets/portraits/baby_green_dragon.png": "0ff79ab4",
  "assets/portraits/barn_raiser.png": "340a04d8",
  "assets/portraits/barterer.png": "6ebeb353",
  "assets/portraits/believer.png": "24c86412",
  "assets/portraits/butterfly.png": "202f5000",
  "assets/portraits/cat.png": "15de8915",
  "assets/portraits/chicken.png": "cf041229",
  "assets/portraits/cow.png": "1802b535",
  "assets/portraits/crab.png": "27cf6b8d",
  "assets/portraits/deer.png": "84cb09d2",
  "assets/portraits/den_keeper.png": "d1ba2749",
  "assets/portraits/dog.png": "77c6588c",
  "assets/portraits/dragon_spirit.png": "b6b5585f",
  "assets/portraits/fieldwalker.png": "0ce2e812",
  "assets/portraits/forager.png": "8171160e",
  "assets/portraits/fox_storyteller.png": "02e58471",
  "assets/portraits/fox_tracker.png": "c38f6e0b",
  "assets/portraits/fox_trader.png": "7927a349",
  "assets/portraits/green_dragon.png": "6e9d95d5",
  "assets/portraits/harvest_trader.png": "55da00c7",
  "assets/portraits/horse.png": "8430b056",
  "assets/portraits/lamplighter.png": "077beb5c",
  "assets/portraits/lorekeeper.png": "f58d1028",
  "assets/portraits/market_trader.png": "13774301",
  "assets/portraits/mason.png": "ef599531",
  "assets/portraits/peddler.png": "6524bf74",
  "assets/portraits/rabbit.png": "26c02214",
  "assets/portraits/ranger.png": "df4b04b8",
  "assets/portraits/sea_turtle.png": "2bfae74c",
  "assets/portraits/seed_seller.png": "20022cc6",
  "assets/portraits/shrine_keeper.png": "23beb9e3",
  "assets/portraits/shrine_lorekeeper.png": "65e66f96",
  "assets/portraits/shrine_trader.png": "39eb81f3",
  "assets/portraits/shrine_warden.png": "51f237cd",
  "assets/portraits/slime.png": "e15cc73c",
  "assets/portraits/stonemason.png": "033fc29b",
  "assets/portraits/storykeeper.png": "f9714f87",
  "assets/portraits/stranger.png": "b003860a",
  "assets/portraits/town_guide.png": "638f0b18",
  "assets/portraits/wanderer.png": "76eb4524",
  "assets/portraits/wanderer_housed.png": "7638ca8e",
  "assets/portraits/warden.png": "05a9cfd1",
  "assets/portraits/wayfinder.png": "19802fcd",
  "assets/portraits/witness.png": "20421b46",
  "assets/portraits/wizard.png": "d58efb40",
  "assets/selected-terrain/selected-terrain.png": "ce68dd27",
  "assets/terrain/mountain-edges.png": "86858d3f",
  "assets/ui/compass/compass-bearing.webp": "b065263e",
  "assets/ui/compass/footer.webp": "cf76e3c7",
  "assets/ui/compass/gold-fittings.png": "f2de995b",
  "assets/ui/compass/gold-rim.svg": "cf748ed9",
  "assets/ui/compass/header.webp": "3001dc79",
  "assets/ui/compass/joystick.webp": "5d57c13f",
  "assets/ui/compass/memory-star.svg": "c3041026",
  "assets/ui/compass/reference-carving-tile.webp": "e3c0c746",
  "assets/ui/compass/reference-footer.webp": "0a76137f",
  "assets/ui/compass/reference-header.webp": "807654d9",
  "assets/ui/compass/reference-join.webp": "6df6da02",
  "assets/ui/compass/reference-joystick.webp": "536d7bc5",
  "assets/ui/compass/reference-panel-rail.webp": "d9048229",
  "assets/ui/compass/reference-shoulders.webp": "1775a00a",
  "assets/ui/compass/reference-shutter.webp": "d7173e65",
  "assets/ui/compass/shine/overhead-beam.png": "1db1ae48",
  "assets/ui/compass/shine/reference-carving-tile.webp": "97dc3090",
  "assets/ui/compass/shine/reference-footer.webp": "26cb3d25",
  "assets/ui/compass/shine/reference-header.webp": "588378e9",
  "assets/ui/compass/shine/reference-join.webp": "c0f429d4",
  "assets/ui/compass/shine/reference-shoulders.webp": "26683922",
  "assets/ui/compass/shutter.webp": "10149ae7",
  "assets/ui/compass/silver-metal.webp": "a265599d"
};
/* ASSET_HASHES_END */
const TILE_CACHE    = 'tiles-v1';
// How old a cached tile may get before it is refreshed IN THE BACKGROUND. It
// is never an expiry: a stale tile is still served, and a failed refresh keeps
// the old copy. Deliberately long — the base map (streets, buildings) barely
// moves, and re-fetching costs the player data.
const TILE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

// The base shell. Scripts and stylesheets are not listed here — they are
// read out of index.html at install time (see shellUrlsFromIndex), because a
// hand-maintained list drifts: this one once named 6 of the ~25 modules the
// page loads, app.js among them and save.js not, which is exactly how a boot
// could end up with the app but not its save layer ("loadSave is not defined").
// That includes vendor/phaser.js — it is a same-origin <script src> like the
// rest, so the page scan already covers it (tools/shell_audit.js fails on any
// .js hand-listed here). Stylesheets follow the same derived list.
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
];

// Every same-origin script and stylesheet, at the exact ?v= URLs index.html asks
// for. Covers both the plain <script src> tags and app.js, which the boot gate
// injects from the APP_SRC string rather than a tag.
async function shellUrlsFromIndex() {
  try {
    const resp = await fetch('./index.html', { cache: 'no-cache' });
    if (!resp.ok) return [];
    const html = await resp.text();
    const urls = [];
    for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) urls.push(m[1]);
    const app = html.match(/APP_SRC\s*=\s*['"]([^'"]+)['"]/);
    if (app) urls.push(app[1]);
    for (const m of html.matchAll(/<link(?=[^>]*\brel=["']stylesheet["'])[^>]+\bhref=["']([^"']+)["'][^>]*>/g)) urls.push(m[1]);
    // Same-origin only — a CDN URL isn't ours to cache.
    return urls.filter(u => !/^[a-z]+:\/\//i.test(u) && !u.startsWith('//'));
  } catch (_) {
    return [];
  }
}

function resourceKey(url) {
  if (url.pathname.endsWith('/') || url.pathname.endsWith('.html')) return null;
  if ([...url.searchParams].length === 1 && /^[0-9a-f]{8}$/.test(url.searchParams.get('v') || '')) return url.href;
  // A retry or other explicit query must reach the server, not an old cache key.
  if (url.search) return null;
  const root = new URL('./', self.location.href);
  const rel = decodeURIComponent(url.pathname.slice(root.pathname.length));
  const hash = ASSET_HASHES[rel];
  if (!hash) return null;
  const key = new URL(url.href);
  key.searchParams.set('v', hash);
  return key.href;
}
async function previousShellMatch(req, options) {
  const keys = (await caches.keys()).filter(k => /^shell-/.test(k)).reverse();
  for (const key of keys) {
    const hit = await (await caches.open(key)).match(req, options);
    if (hit) return hit;
  }
  return null;
}
async function immutableResource(req, key) {
  const cache = await caches.open(RESOURCE_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  // Migrate exact versioned scripts from the worker deployed before this one.
  const old = new URL(req.url).searchParams.has('v') ? await previousShellMatch(req) : null;
  if (old) { try { await cache.put(key, old.clone()); } catch (_) {} return old; }
  let resp;
  try { resp = await fetch(key === req.url ? req : new Request(key, req)); } catch (_) {}
  if (resp?.ok) { try { await cache.put(key, resp.clone()); } catch (_) {} return resp; }
  // Only the requested version is safe: substituting an older script can
  // mix incompatible globals while reporting a successful load. Let the
  // page recover a missing dependency by restarting its ordered script chain.
  return resp || new Response('', { status: 504, statusText: 'offline' });
}
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_VERSION);
    const shell = await shellUrlsFromIndex();
    await Promise.allSettled(SHELL_ASSETS.map(u => cache.add(u)));
    await Promise.allSettled(shell.map(u => {
      const req = new Request(new URL(u, self.location.href));
      return immutableResource(req, resourceKey(new URL(req.url)) || req.url);
    }));
    // An offline/failed index fetch must not authorize pruning older resources.
    if (shell.length) {
      const resources = shell.map(u => new URL(u, self.location.href).href);
      for (const rel of Object.keys(ASSET_HASHES)) resources.push(resourceKey(new URL(rel, self.location.href)));
      await cache.put(RESOURCE_MANIFEST, new Response(JSON.stringify(resources)));
    }
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const current = await caches.open(SHELL_VERSION);
    if (await current.match(RESOURCE_MANIFEST)) {
      const keys = (await caches.keys()).filter(k => /^shell-/.test(k) && k !== SHELL_VERSION);
      const previous = keys.pop();
      const keep = new Set();
      let canPrune = true;
      for (const name of [SHELL_VERSION, previous].filter(Boolean)) {
        const cache = await caches.open(name);
        const manifest = await cache.match(RESOURCE_MANIFEST);
        if (!manifest) { canPrune = false; continue; } // migration from old worker
        for (const url of await manifest.json()) keep.add(url);
      }
      if (canPrune) {
        const resources = await caches.open(RESOURCE_CACHE);
        for (const req of await resources.keys()) if (!keep.has(req.url)) await resources.delete(req);
      }
      await Promise.all(keys.map(key => caches.delete(key)));
    }
    // Already-open tabs keep their loaded textures. Deferred unversioned art
    // follows the new manifest, as it did with the previous claiming worker.
    await self.clients.claim();
  })());
});

// Helper: is this request an OpenFreeMap MVT tile?
function isTileRequest(url) {
  return url.host === 'tiles.openfreemap.org' && url.pathname.endsWith('.pbf');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // ── MVT tiles: cache-first, kept indefinitely. ───────────────────
  // A cached tile is ALWAYS served, however old it is; age only decides
  // whether to also refresh it in the background (TILE_REFRESH_MS, 30 days).
  // A refresh that fails leaves the cached copy in place — nothing here ever
  // evicts a tile, so a visited area keeps rendering on any network. (The
  // same policy the worldgen IndexedDB layer applies to the decoded bytes;
  // this cache is the HTTP-level half of it.)
  if (isTileRequest(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const hit = await cache.match(req);
      if (hit) {
        const stamped = Date.parse(hit.headers.get('date') || '') || 0;
        if (Date.now() - stamped > TILE_REFRESH_MS) {
          // Background revalidate; failures are swallowed and the hit stands.
          event.waitUntil(fetch(req).then((resp) => {
            if (resp && resp.ok) return cache.put(req, resp.clone());
          }).catch(() => {}));
        }
        return hit;
      }
      try {
        const resp = await fetch(req);
        // Only cache successful responses. 4xx/5xx pass through uncached.
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch (err) {
        // Offline + uncached → opaque 504 the worldgen code already handles.
        return new Response('', { status: 504, statusText: 'offline' });
      }
    })());
    return;
  }

  // HTML is network-first with offline fallback; immutable media/scripts/styles
  // use the persistent cache and never re-fetch a successful cache hit.
  if (url.origin === self.location.origin) {
    const isHTML = req.mode === 'navigate' || req.destination === 'document'
      || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
    const key = isHTML ? null : resourceKey(url);
    if (key && req.cache !== 'reload' && req.cache !== 'no-store') {
      event.respondWith(immutableResource(req, key));
      return;
    }
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_VERSION);
      const cached = await cache.match(req);
      if (!isHTML && !url.search && cached) {
        event.waitUntil(fetch(req).then(resp => {
          if (resp.ok) return cache.put(req, resp.clone());
        }).catch(() => {}));
        return cached;
      }
      let resp;
      try { resp = await fetch(req); } catch (_) {}
      if (resp?.ok) { try { await cache.put(req, resp.clone()); } catch (_) {} return resp; }
      if (isHTML) {
        const fallback = cached || await previousShellMatch(req, { ignoreSearch: true });
        if (fallback) return fallback;
      }
      return resp || new Response('', { status: 504, statusText: 'offline' });
    })());
    return;
  }

  // Everything else (CDNs, etc.) — passthrough.
});
