// Content-addressed resources survive deployments. HTML stays network-first;
// tiles retain their independent offline cache. Keep two shell generations so
// old tabs can still request their exact script URLs after a worker update.
const SHELL_VERSION = 'shell-143bca76';
const RESOURCE_CACHE = 'terracart-resources-v1';
const RESOURCE_MANIFEST = './__terracart_resource_manifest__';
/* ASSET_HASHES_START */
const ASSET_HASHES = {
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
  "assets/Enemy/Dragons/BlackDragon.png": "c79fcde0",
  "assets/Enemy/Dragons/BlueDragon.png": "95ce81ef",
  "assets/Enemy/Dragons/RedDragon.png": "8aec2297",
  "assets/Enemy/Dragons/WhiteDragon.png": "2092da28",
  "assets/Enemy/Dragons/YellowDragon.png": "b08b5eb3",
  "assets/Enemy/Ghost/1Fullsheet_Ghost.png": "86ada061",
  "assets/Enemy/Ghost/Reskin/1Fullsheet_PinkGhost.png": "dc4fdb91",
  "assets/Enemy/GiantCrab.png": "633bd8b3",
  "assets/Enemy/Goblin Archer.png": "a594e74a",
  "assets/Enemy/Goblin.png": "c8485351",
  "assets/Enemy/LargeAttack/large-enemies-32.png": "113f0a88",
  "assets/Enemy/LargeAttack/source.png": "4fa80b02",
  "assets/Enemy/LargeDirectional/bugbear-source.png": "97e3f267",
  "assets/Enemy/LargeDirectional/bugbear.png": "6d6780de",
  "assets/Enemy/LargeDirectional/giant-bear-source.png": "d13ad1ca",
  "assets/Enemy/LargeDirectional/giant-bear.png": "b581d8b0",
  "assets/Enemy/LargeDirectional/giant-reaper-source.png": "ea7fe1ab",
  "assets/Enemy/LargeDirectional/giant-reaper.png": "783b157e",
  "assets/Enemy/LargeDirectional/giant-serpent-source.png": "e40f647e",
  "assets/Enemy/LargeDirectional/giant-serpent.png": "7a1198bc",
  "assets/Enemy/LargeDirectional/ogre-source.png": "656a418f",
  "assets/Enemy/LargeDirectional/ogre.png": "101787f4",
  "assets/Enemy/LargeDirectional/troll-source.png": "a4247f54",
  "assets/Enemy/LargeDirectional/troll.png": "11e74848",
  "assets/Enemy/LargeDirectionalV2/bugbear-previous.png": "6d6780de",
  "assets/Enemy/LargeDirectionalV2/bugbear-source.png": "3172fd4d",
  "assets/Enemy/LargeDirectionalV2/bugbear.png": "a4dc849e",
  "assets/Enemy/LargeDirectionalV2/giant-bear-previous.png": "b581d8b0",
  "assets/Enemy/LargeDirectionalV2/giant-bear-source.png": "09c1c3b0",
  "assets/Enemy/LargeDirectionalV2/giant-bear.png": "ae47c477",
  "assets/Enemy/LargeDirectionalV2/giant-reaper-previous.png": "783b157e",
  "assets/Enemy/LargeDirectionalV2/giant-reaper-source.png": "3df1e951",
  "assets/Enemy/LargeDirectionalV2/giant-reaper.png": "fcea8eeb",
  "assets/Enemy/LargeDirectionalV2/giant-serpent-candidate1-source.png": "0a9a6cff",
  "assets/Enemy/LargeDirectionalV2/giant-serpent-previous.png": "7a1198bc",
  "assets/Enemy/LargeDirectionalV2/giant-serpent-source.png": "f92871f6",
  "assets/Enemy/LargeDirectionalV2/giant-serpent.png": "f36f5805",
  "assets/Enemy/LargeDirectionalV2/ogre-previous.png": "101787f4",
  "assets/Enemy/LargeDirectionalV2/ogre-source.png": "61d164da",
  "assets/Enemy/LargeDirectionalV2/ogre.png": "fb95333c",
  "assets/Enemy/LargeDirectionalV2/troll-previous.png": "11e74848",
  "assets/Enemy/LargeDirectionalV2/troll-source.png": "ac7f5250",
  "assets/Enemy/LargeDirectionalV2/troll.png": "9dc7fce1",
  "assets/Enemy/Necromancer.png": "adb05ab6",
  "assets/Enemy/Orcs/ArcherGoblin.png": "462f756d",
  "assets/Enemy/Orcs/ClubGoblin.png": "44f45545",
  "assets/Enemy/Orcs/FarmerGoblin.png": "dcdd5200",
  "assets/Enemy/Orcs/KamikazeGoblin.png": "e0e4c783",
  "assets/Enemy/Orcs/Minotaur.png": "ca823dae",
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
  "assets/Enemy/SegmentedSerpent/parts-source.png": "a4c8ce3a",
  "assets/Enemy/SegmentedSerpent/parts.png": "4c7e813e",
  "assets/Enemy/SegmentedSerpent/preview.png": "054d91eb",
  "assets/Enemy/SegmentedSerpent/tail-directions.png": "f98e89f9",
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
  "assets/Enemy/spr_Colossal_monsters_1000yearsRedDragon.png": "a8571da4",
  "assets/Enemy/spr_Colossal_monsters_hydra.png": "2b2fd093",
  "assets/Enemy/spr_Colossal_monsters_spritesheet.png": "d0930abd",
  "assets/Enemy/spr_big_monsters_spritesheet.png": "2e3d8aa2",
  "assets/Enemy/spr_mini_monsters_spritesheet.png": "bb6b07b9",
  "assets/Farm Animals/Boar.png": "7f2d20f1",
  "assets/Farm Animals/Chick.png": "72d47cca",
  "assets/Farm Animals/Chicken Red.png": "e686e0bf",
  "assets/Farm Animals/Chicken.png": "473d946b",
  "assets/Farm Animals/Crab.png": "633bd8b3",
  "assets/Farm Animals/Female Cow Brown.png": "2fc6c8fa",
  "assets/Farm Animals/HornedSheep.png": "de98d8f8",
  "assets/Farm Animals/Horse(32x32).png": "34847aa7",
  "assets/Farm Animals/Horse.png": "34847aa7",
  "assets/Farm Animals/MarineAnimals.png": "f38cdae3",
  "assets/Farm Animals/Pig.png": "0e583192",
  "assets/Farm Animals/Sheep.png": "601f7519",
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
  "assets/Icons/AltWeapons/source/muskets.png": "7db175b7",
  "assets/Icons/Fish/River/Golden Fish.png": "8f7a79f4",
  "assets/Icons/Fish/River/Large Mouth Bass.png": "ec034481",
  "assets/Icons/Fish/River/Tiger Trout.png": "00df0ad2",
  "assets/Icons/Fish/Sea/Creatures/Shell.png": "d29df34a",
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
  "assets/Icons/Items/Honey.png": "6f39df63",
  "assets/Icons/Items/MagicHammer.png": "bf8c71bc",
  "assets/Icons/Items/MagicTrap.png": "0a07da15",
  "assets/Icons/Items/Potion_light.png": "d1b8dea4",
  "assets/Icons/Items/Potions.png": "2edea935",
  "assets/Icons/Items/RavenScroll.png": "20f21c7d",
  "assets/Icons/Items/RavenScroll.svg": "2b42167f",
  "assets/Icons/Items/RavenScrollStamp.svg": "76e24db4",
  "assets/Icons/Items/Rope.png": "536c2f28",
  "assets/Icons/Items/SkeletonScroll.png": "c6c3c07c",
  "assets/Icons/Items/SkeletonScrollStamp.svg": "e7c98299",
  "assets/Icons/Items/Spear.png": "897e87cb",
  "assets/Icons/Items/ThunderScroll.png": "96abb018",
  "assets/Icons/Items/ThunderScrollStamp.svg": "9993a3cd",
  "assets/Icons/Items/Torch.png": "0c35a90b",
  "assets/Icons/Items/TrapDisarmKit.png": "451f7ff3",
  "assets/Icons/Items/WraithScroll.png": "4d7351f4",
  "assets/Icons/Items/WraithScrollStamp.svg": "33cff3a3",
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
  "assets/Icons/RPG icons/Extras/16x16_RPG_Pack_v3.0_packed_no_background.png": "2d85a726",
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
  "assets/Icons/coin.png": "c56d5e86",
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
  "assets/Objects/Approved/Sources/WorldArt/approved_charred_stakes-native.png": "380d334c",
  "assets/Objects/Approved/Sources/WorldArt/barricade-native.png": "34456b11",
  "assets/Objects/Approved/Sources/WorldArt/bramble-native.png": "0b1fa85c",
  "assets/Objects/Approved/Sources/WorldArt/general-0.png": "f7105cb2",
  "assets/Objects/Approved/Sources/WorldArt/general-1.png": "8b761af4",
  "assets/Objects/Approved/Sources/WorldArt/general-3.png": "69ce4145",
  "assets/Objects/Approved/Sources/WorldArt/general-5.png": "b88be3a4",
  "assets/Objects/Approved/Sources/WorldArt/general-6.png": "b32aaf1a",
  "assets/Objects/Approved/Sources/WorldArt/shrines-0.png": "ed588929",
  "assets/Objects/Approved/Sources/WorldArt/shrines-1.png": "2906f5ba",
  "assets/Objects/Approved/Sources/WorldArt/shrines-2.png": "2333894a",
  "assets/Objects/Approved/Sources/WorldArt/shrines-3.png": "abd743c5",
  "assets/Objects/Approved/Sources/WorldArt/shrines-4.png": "4380f084",
  "assets/Objects/Approved/Sources/WorldArt/shrines-5.png": "a2208560",
  "assets/Objects/Approved/Sources/WorldArt/shrines-6.png": "37ad1175",
  "assets/Objects/Approved/Sources/WorldArt/shrines-7.png": "6a7f826d",
  "assets/Objects/Approved/Sources/WorldArt/shrines-8.png": "b15c291f",
  "assets/Objects/Approved/Sources/WorldArt/shrines-9.png": "a287bf0c",
  "assets/Objects/Approved/apple_tree.png": "3e9b3626",
  "assets/Objects/Approved/approved_charred_stakes.png": "380d334c",
  "assets/Objects/Approved/approved_clipped_hedge.png": "0a8673b8",
  "assets/Objects/Approved/approved_masonry_rubble.png": "3f6a6b61",
  "assets/Objects/Approved/approved_moss_rocks.png": "d0262131",
  "assets/Objects/Approved/approved_wetland_reeds.png": "d4c2dd1f",
  "assets/Objects/Approved/barrel.png": "dcf6b624",
  "assets/Objects/Approved/barricade.png": "34456b11",
  "assets/Objects/Approved/bike_rack.png": "c57667e3",
  "assets/Objects/Approved/bone_pile.png": "84e097ba",
  "assets/Objects/Approved/bottle.png": "46926df1",
  "assets/Objects/Approved/box.png": "d61b3d0a",
  "assets/Objects/Approved/bramble.png": "0b1fa85c",
  "assets/Objects/Approved/bushes.png": "951ad187",
  "assets/Objects/Approved/chest.png": "91c7f776",
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
  "assets/Objects/Approved/flint.png": "c8a456ea",
  "assets/Objects/Approved/gatepost.png": "84c866ba",
  "assets/Objects/Approved/grove_votive.png": "3a142c5c",
  "assets/Objects/Approved/house.png": "6425b9d1",
  "assets/Objects/Approved/house_blacksmith.png": "00bf1d11",
  "assets/Objects/Approved/house_fort.png": "acf6539e",
  "assets/Objects/Approved/house_fort_unclaimed.png": "0600863f",
  "assets/Objects/Approved/house_market.png": "97a3c417",
  "assets/Objects/Approved/house_trader.png": "79246b87",
  "assets/Objects/Approved/house_wreck.png": "503c90e7",
  "assets/Objects/Approved/market_stand.png": "4e7287b3",
  "assets/Objects/Approved/mineralrock.png": "f2aeac90",
  "assets/Objects/Approved/peach_tree.png": "a3e2afea",
  "assets/Objects/Approved/pier.png": "e6dd0763",
  "assets/Objects/Approved/pillar.png": "d0a95670",
  "assets/Objects/Approved/pine_tree.png": "f88156f7",
  "assets/Objects/Approved/potofgold.png": "ff74669a",
  "assets/Objects/Approved/props.png": "7157df1d",
  "assets/Objects/Approved/scarecrow.png": "952c9882",
  "assets/Objects/Approved/shrine.png": "eccf0591",
  "assets/Objects/Approved/signpost.png": "934076b9",
  "assets/Objects/Approved/springcrops.png": "8c209f7e",
  "assets/Objects/Approved/stair_down.png": "1ecf6813",
  "assets/Objects/Approved/stair_up.png": "e9a324ed",
  "assets/Objects/Approved/tar.png": "f3ede916",
  "assets/Objects/Approved/trees.png": "19fe8e5c",
  "assets/Objects/Approved/vista_scope.png": "22d7039b",
  "assets/Objects/Approved/wagon.png": "9ee6ea9d",
  "assets/Objects/Approved/waystone.png": "444c5096",
  "assets/Objects/Beach/driftwood.png": "f46727ec",
  "assets/Objects/Beach/palms.png": "e492058c",
  "assets/Objects/Beach/shipwreck_shrine.png": "4948c3c0",
  "assets/Objects/Beach/shipwreck_shrine_runtime.png": "776e3b61",
  "assets/Objects/Castle/tower_master.png": "195b2576",
  "assets/Objects/Castle/tower_ruin_master.png": "42d55bee",
  "assets/Objects/Castle/tower_shapes.png": "0b7d9e6d",
  "assets/Objects/Cave/mechanisms.png": "5d1896d8",
  "assets/Objects/Cave/poison_vent_inactive.png": "b42d2b64",
  "assets/Objects/Cave/props.png": "6b6f2cc3",
  "assets/Objects/Cave/source/selected.png": "b82da57c",
  "assets/Objects/Cave/source/supplement.png": "7958b7b6",
  "assets/Objects/Chests.png": "392948a7",
  "assets/Objects/Crops.png": "b151e77a",
  "assets/Objects/DailyVisits/potofgold.png": "68ee01c6",
  "assets/Objects/DailyVisits/wagon.png": "3d4c1c49",
  "assets/Objects/Generated/apothecary.png": "5370279b",
  "assets/Objects/Generated/apothecary_simple.png": "295b80fb",
  "assets/Objects/Generated/barrel.png": "34a5ee3c",
  "assets/Objects/Generated/barricade.png": "c5c33df4",
  "assets/Objects/Generated/bike_rack.png": "bddf234d",
  "assets/Objects/Generated/bottle.png": "44cc8efd",
  "assets/Objects/Generated/castle_tower_restored.png": "50e75493",
  "assets/Objects/Generated/castle_tower_wreck.png": "d4c8b441",
  "assets/Objects/Generated/chapel.png": "a17fb238",
  "assets/Objects/Generated/chapel_simple.png": "1d09e11d",
  "assets/Objects/Generated/curio.png": "4d7c0f1d",
  "assets/Objects/Generated/curio_simple.png": "06d10da4",
  "assets/Objects/Generated/driftwood.png": "c68a4880",
  "assets/Objects/Generated/flint.png": "7acbc684",
  "assets/Objects/Generated/guildhall.png": "ebc918f7",
  "assets/Objects/Generated/guildhall_simple.png": "00140375",
  "assets/Objects/Generated/headstone.png": "2971d26f",
  "assets/Objects/Generated/hedge_end.png": "9ed0587a",
  "assets/Objects/Generated/inn.png": "bde5598f",
  "assets/Objects/Generated/inn_simple.png": "9533cb50",
  "assets/Objects/Generated/macro_booths_simple.png": "daaa5701",
  "assets/Objects/Generated/pillar_a.png": "a584ec00",
  "assets/Objects/Generated/pillar_c.png": "e0507f5c",
  "assets/Objects/Generated/pot.png": "5a20c83f",
  "assets/Objects/Generated/pot_smashed.png": "4ed4c135",
  "assets/Objects/Generated/scholar.png": "4247ebf6",
  "assets/Objects/Generated/scholar_simple.png": "5a186e24",
  "assets/Objects/Generated/scope.png": "7018efa8",
  "assets/Objects/Generated/scriptorium.png": "10a5ba47",
  "assets/Objects/Generated/scriptorium_simple.png": "8b8a1084",
  "assets/Objects/Generated/shrine.png": "9c78d47e",
  "assets/Objects/Generated/shrines.png": "30257824",
  "assets/Objects/Generated/signpost.png": "712c8565",
  "assets/Objects/Generated/stakes_a.png": "e2c8ab23",
  "assets/Objects/Generated/sundries.png": "99ee4aa3",
  "assets/Objects/Generated/sundries_simple.png": "48d9c82e",
  "assets/Objects/Generated/tar.png": "aa3b5715",
  "assets/Objects/Generated/training.png": "037f665b",
  "assets/Objects/Generated/training_simple.png": "436e6adb",
  "assets/Objects/Generated/wagon.png": "fa55ee5b",
  "assets/Objects/Generated/waystone.png": "f2a53bf1",
  "assets/Objects/Gold Chest.png": "877c117d",
  "assets/Objects/HazardAnimations/sinkhole-source.png": "c12db4b5",
  "assets/Objects/HazardAnimations/sinkhole.png": "6b955a4f",
  "assets/Objects/HazardAnimations/tornado-source.png": "e797b712",
  "assets/Objects/HazardAnimations/tornado.png": "d638aa40",
  "assets/Objects/HazardAnimations/vent-active-reference.png": "6b6f2cc3",
  "assets/Objects/HazardAnimations/vent-cycle.png": "f723deb1",
  "assets/Objects/HazardAnimations/vent-warnings-before-base-fix.png": "f19f3afa",
  "assets/Objects/HazardAnimations/vent-warnings-source.png": "ae2c5a95",
  "assets/Objects/HazardAnimations/vent-warnings.png": "f3b03093",
  "assets/Objects/HazardAnimationsV2/poison-vent-inactive.png": "ec1b834a",
  "assets/Objects/HazardAnimationsV2/sinkhole-ground-patch.png": "f00aa093",
  "assets/Objects/HazardAnimationsV2/sinkhole-source.png": "8544fbd7",
  "assets/Objects/HazardAnimationsV2/sinkhole-transparent-source.png": "47b6d1c8",
  "assets/Objects/HazardAnimationsV2/sinkhole.png": "03d9a0aa",
  "assets/Objects/HazardAnimationsV2/tornado-source.png": "37705e16",
  "assets/Objects/HazardAnimationsV2/tornado.png": "8a6f5393",
  "assets/Objects/HazardAnimationsV2/vent-active-reference.png": "6b6f2cc3",
  "assets/Objects/HazardAnimationsV2/vent-cycle-complete.png": "806d7641",
  "assets/Objects/HazardAnimationsV2/vent-cycle.png": "f723deb1",
  "assets/Objects/HazardAnimationsV2/vent-inactive-source.png": "e10c72bd",
  "assets/Objects/HazardAnimationsV2/vent-inactive.png": "1fd11ef5",
  "assets/Objects/HazardAnimationsV2/vent-warnings.png": "f3b03093",
  "assets/Objects/Hedges/bottom_left.png": "cc5d04c4",
  "assets/Objects/Hedges/bottom_right.png": "209c1984",
  "assets/Objects/Hedges/cross.png": "7211b1f2",
  "assets/Objects/Hedges/end_east.png": "d0e89a20",
  "assets/Objects/Hedges/end_north.png": "477845c8",
  "assets/Objects/Hedges/end_south.png": "cb30d601",
  "assets/Objects/Hedges/end_west.png": "a7c5ad5f",
  "assets/Objects/Hedges/hedges-24.png": "b465bfa1",
  "assets/Objects/Hedges/horizontal.png": "5d48ecc6",
  "assets/Objects/Hedges/single.png": "ccb05ab3",
  "assets/Objects/Hedges/source.png": "2992aaca",
  "assets/Objects/Hedges/t_east.png": "2cc3d6b8",
  "assets/Objects/Hedges/t_north.png": "b3b806d0",
  "assets/Objects/Hedges/t_south.png": "2ac77ac8",
  "assets/Objects/Hedges/t_west.png": "b9351059",
  "assets/Objects/Hedges/top_left.png": "890aaecf",
  "assets/Objects/Hedges/top_right.png": "c3032be8",
  "assets/Objects/Hedges/vertical.png": "4a6d88b8",
  "assets/Objects/Home/home_wagon.png": "8f92ec3a",
  "assets/Objects/House.png": "9c7ddb00",
  "assets/Objects/Houses/Wreck.png": "fda0d220",
  "assets/Objects/Houses/blacksmith.png": "c7f02e60",
  "assets/Objects/Houses/fort.png": "f603b7e1",
  "assets/Objects/Houses/market.png": "51237ebc",
  "assets/Objects/Houses/trader.png": "5acce38e",
  "assets/Objects/Houses/trailer.png": "1a9c0743",
  "assets/Objects/Houses/wizard.png": "9cd01e9b",
  "assets/Objects/Landmarks/headstone-basalt.png": "7af55e0e",
  "assets/Objects/Landmarks/shrine-figure.png": "374344e9",
  "assets/Objects/Landmarks/shrine-votive.png": "add495ad",
  "assets/Objects/Maple Tree.png": "864ca59a",
  "assets/Objects/Pets/cat.png": "1e8a28ed",
  "assets/Objects/Pets/dog.png": "aa2839e6",
  "assets/Objects/Pickup_Items.png": "e2dbff8b",
  "assets/Objects/Portal.png": "ccf366a4",
  "assets/Objects/Progression/icons.png": "24092ac1",
  "assets/Objects/Progression/tiles.png": "8b0bfb1b",
  "assets/Objects/Reef/coral.png": "88a65d20",
  "assets/Objects/Reef/reef_atlas.png": "5f9e1716",
  "assets/Objects/Road copiar.png": "eb7417d4",
  "assets/Objects/RollingBallAndWall/ball-source.png": "b6f10bdf",
  "assets/Objects/RollingBallAndWall/ball.png": "70123961",
  "assets/Objects/RollingBallAndWall/spike-wall-source.png": "2abefe42",
  "assets/Objects/RollingBallAndWall/spike-wall.png": "9b213e0b",
  "assets/Objects/Rustic/Props.png": "10f4f186",
  "assets/Objects/Rustic/bush.png": "60a976a5",
  "assets/Objects/Rustic/pot.png": "67fa95e9",
  "assets/Objects/Rustic/pot_smashed.png": "4883d791",
  "assets/Objects/Rustic/trees.png": "fc4d3689",
  "assets/Objects/Scarecrow_16x16.png": "e0e3fa74",
  "assets/Objects/Signs.png": "894aada0",
  "assets/Objects/SpikeTraps/spike-wall-source.png": "03908a97",
  "assets/Objects/SpikeTraps/spike-wall.png": "d1726c2b",
  "assets/Objects/SpikeTraps/spikeball-source.png": "0cc2d5bf",
  "assets/Objects/SpikeTraps/spikeball.png": "76e2a820",
  "assets/Objects/SpikeTrapsTopDown/spike-wall-source.png": "1bd67e4f",
  "assets/Objects/SpikeTrapsTopDown/spike-wall.png": "0710208e",
  "assets/Objects/SpikeTrapsTopDown/spikeball-source.png": "842927fa",
  "assets/Objects/SpikeTrapsTopDown/spikeball.png": "a52c556d",
  "assets/Objects/Spring Crops.png": "f9f8fa8f",
  "assets/Objects/StreetSigns.png": "83d9e5d2",
  "assets/Objects/Stronghold/bottom_left.png": "5f5972b4",
  "assets/Objects/Stronghold/bottom_right.png": "e99b25fe",
  "assets/Objects/Stronghold/cross.png": "ba426dfa",
  "assets/Objects/Stronghold/end_east.png": "cac6fd7c",
  "assets/Objects/Stronghold/end_north.png": "cfc00426",
  "assets/Objects/Stronghold/end_south.png": "add755fa",
  "assets/Objects/Stronghold/end_west.png": "310251eb",
  "assets/Objects/Stronghold/horizontal.png": "eb2bdce2",
  "assets/Objects/Stronghold/junction-source.png": "5fd9cb86",
  "assets/Objects/Stronghold/source.png": "0ff3f759",
  "assets/Objects/Stronghold/t_east.png": "6add3523",
  "assets/Objects/Stronghold/t_north.png": "f37913a3",
  "assets/Objects/Stronghold/t_south.png": "352c5098",
  "assets/Objects/Stronghold/t_west.png": "5d711ff7",
  "assets/Objects/Stronghold/top_left.png": "fb683e7b",
  "assets/Objects/Stronghold/top_right.png": "3ee4d9ba",
  "assets/Objects/Stronghold/vertical.png": "d5f39e6a",
  "assets/Objects/Stronghold/walls-24.png": "42926d98",
  "assets/Objects/Temple/footprint-tar.svg": "d21184da",
  "assets/Objects/Temple/footprint.svg": "1326b60c",
  "assets/Objects/Temple/runes-lit.svg": "13a90994",
  "assets/Objects/Temple/runes-tar-lit.svg": "9f5dc6ec",
  "assets/Objects/Temple/runes-tar-unlit.svg": "2d316cf7",
  "assets/Objects/Temple/runes-unlit.svg": "e849ab9b",
  "assets/Objects/Temple/temple-lit.svg": "e2a648fe",
  "assets/Objects/Temple/temple-tar-lit.svg": "32d8a587",
  "assets/Objects/Temple/temple-tar-unlit.svg": "07751ed5",
  "assets/Objects/Temple/temple-unlit.svg": "838f065b",
  "assets/Objects/Tombstones.png": "9d297b4c",
  "assets/Objects/Tree.png": "b1d02bbe",
  "assets/Objects/Well.png": "f6529558",
  "assets/Objects/Wilderness/Apple Tree.png": "d8f4ce44",
  "assets/Objects/Wilderness/Azure Butterfly.png": "0c965543",
  "assets/Objects/Wilderness/Beehive.png": "d89820ed",
  "assets/Objects/Wilderness/Birch Tree.png": "ce3fcba0",
  "assets/Objects/Wilderness/Box_Single_16x16.png": "e9fcb325",
  "assets/Objects/Wilderness/Bridge Beach.png": "aedd8618",
  "assets/Objects/Wilderness/Crow.png": "42ab12e1",
  "assets/Objects/Wilderness/Deer Idle.png": "79f08116",
  "assets/Objects/Wilderness/Fantasy Mushroom.png": "b9ae7327",
  "assets/Objects/Wilderness/Mahogany Tree.png": "bb8a49c8",
  "assets/Objects/Wilderness/Peach Tree.png": "8157d698",
  "assets/Objects/Wilderness/Pine Tree.png": "aa9a3253",
  "assets/Objects/Wilderness/Props.png": "aef6c69a",
  "assets/Objects/Wilderness/Rabbit White.png": "b1c8e8f4",
  "assets/Objects/Wilderness/bonfire.png": "10ade4b5",
  "assets/Objects/Wilderness/bushes.png": "069c4c18",
  "assets/Objects/Wilderness/crystal_cluster.png": "ff70aa1a",
  "assets/Objects/Wilderness/pillar.png": "37e53dee",
  "assets/Objects/Wilderness/stone with minerals.png": "e44e9b1e",
  "assets/Objects/Wilderness/torch.png": "fdd57d12",
  "assets/Objects/Wilderness/well.png": "d8e21f0d",
  "assets/Objects/Wilderness/wood.png": "034e40b6",
  "assets/Objects/ZoneVariants/amphora.png": "7d9fd8eb",
  "assets/Objects/ZoneVariants/approved-24.png": "d3d88ff4",
  "assets/Objects/ZoneVariants/atlas-1024.png": "739a7776",
  "assets/Objects/ZoneVariants/barrel.png": "8caafb3d",
  "assets/Objects/ZoneVariants/berry_bush.png": "1c7a0cb8",
  "assets/Objects/ZoneVariants/birdbath.png": "00958054",
  "assets/Objects/ZoneVariants/broken_column.png": "fdcb8168",
  "assets/Objects/ZoneVariants/burial_slab.png": "3e3c4fd1",
  "assets/Objects/ZoneVariants/coral_antler.png": "a2193e75",
  "assets/Objects/ZoneVariants/coral_brain.png": "67ebe13c",
  "assets/Objects/ZoneVariants/coral_fan.png": "8f6d2a19",
  "assets/Objects/ZoneVariants/coral_pink.png": "0c7053b4",
  "assets/Objects/ZoneVariants/coral_plate.png": "194be754",
  "assets/Objects/ZoneVariants/coral_teal.png": "96c387bc",
  "assets/Objects/ZoneVariants/coral_tube.png": "118a5ff3",
  "assets/Objects/ZoneVariants/fallen_column.png": "4a43c875",
  "assets/Objects/ZoneVariants/handcart.png": "80fcc75f",
  "assets/Objects/ZoneVariants/hedge_corner.png": "5fb64207",
  "assets/Objects/ZoneVariants/mossy_grave_pillar.png": "8bb207fe",
  "assets/Objects/ZoneVariants/mushroom_red.png": "2d104654",
  "assets/Objects/ZoneVariants/objects-16.png": "6fe38082",
  "assets/Objects/ZoneVariants/objects-24.png": "9d2ed062",
  "assets/Objects/ZoneVariants/paired_grave_posts.png": "b1c1e6e1",
  "assets/Objects/ZoneVariants/pots-smashed-source.png": "119f4158",
  "assets/Objects/ZoneVariants/pots_cracked.png": "bf62cc14",
  "assets/Objects/ZoneVariants/pots_smashed.png": "2ff5c875",
  "assets/Objects/ZoneVariants/quartz.png": "0c689d58",
  "assets/Objects/ZoneVariants/reef_crystal.png": "ffc35984",
  "assets/Objects/ZoneVariants/rocks/black_ring.png": "388f7362",
  "assets/Objects/ZoneVariants/rocks/broken_depot.png": "9468f400",
  "assets/Objects/ZoneVariants/rocks/broken_masonry.png": "2237a091",
  "assets/Objects/ZoneVariants/rocks/flint_field.png": "51913f92",
  "assets/Objects/ZoneVariants/rocks/pirate_cove.png": "81eae64a",
  "assets/Objects/ZoneVariants/rocks/seep.png": "d380a8fa",
  "assets/Objects/ZoneVariants/rocks/stone_garden.png": "b166a32c",
  "assets/Objects/ZoneVariants/rocks/work_yard.png": "ceaf28a0",
  "assets/Objects/ZoneVariants/sapphire.png": "da0876cb",
  "assets/Objects/ZoneVariants/seed_shrine.png": "8e0bedcb",
  "assets/Objects/ZoneVariants/shell_rock.png": "236734ce",
  "assets/Objects/ZoneVariants/shell_shrine.png": "85276a8d",
  "assets/Objects/ZoneVariants/source.png": "bdadb41a",
  "assets/Objects/ZoneVariants/tall_pillar.png": "3b7e7a77",
  "assets/Objects/animated_transparent.png": "6f04045a",
  "assets/Objects/market_stand.png": "098d227f",
  "assets/Objects/props_large_transparent.png": "822ca0bb",
  "assets/Objects/stair_down.png": "ad126b24",
  "assets/Objects/stair_up.png": "c0982663",
  "assets/Objects/trunk.png": "77fdcb98",
  "assets/art/barehand_tree.webp": "43a9b645",
  "assets/art/barehand_work.webp": "0ce150a1",
  "assets/art/book_read.webp": "2771b757",
  "assets/art/booth_apothecary_intro.webp": "52174659",
  "assets/art/booth_apothecary_used.webp": "6f3875fe",
  "assets/art/booth_chapel_intro.webp": "d1ddf3ac",
  "assets/art/booth_chapel_used.webp": "3e8dbc29",
  "assets/art/booth_curio_intro.webp": "2be40e27",
  "assets/art/booth_curio_used.webp": "69acca97",
  "assets/art/booth_guildhall_intro.webp": "a41849c0",
  "assets/art/booth_guildhall_used.webp": "174ab701",
  "assets/art/booth_inn_intro.webp": "9ca9c830",
  "assets/art/booth_inn_used.webp": "6a6e60f6",
  "assets/art/booth_scholar_intro.webp": "4932e85b",
  "assets/art/booth_scholar_used.webp": "f3dffdbe",
  "assets/art/booth_scriptorium_intro.webp": "cd0b9e63",
  "assets/art/booth_scriptorium_used.webp": "a67c1ce5",
  "assets/art/booth_sundries_intro.webp": "a2e8afb9",
  "assets/art/booth_sundries_used.webp": "4d69afd3",
  "assets/art/booth_training_intro.webp": "37d5675b",
  "assets/art/booth_training_used.webp": "f6c69bde",
  "assets/art/bottle_read.webp": "2aaf32d2",
  "assets/art/castle_claim.webp": "4d1965b9",
  "assets/art/castle_favour.webp": "574a05fc",
  "assets/art/cave_first.webp": "f9c3f346",
  "assets/art/chest_t1.webp": "650a6075",
  "assets/art/chest_t2.webp": "2eedc83c",
  "assets/art/chest_t3.webp": "26a41e29",
  "assets/art/chest_t4.webp": "499dc2f3",
  "assets/art/chest_t5.webp": "4eff02df",
  "assets/art/chest_t6.webp": "7ad2158a",
  "assets/art/chest_t7.webp": "b1422843",
  "assets/art/death_memories.webp": "a2e5b296",
  "assets/art/delivery_first.webp": "c6196484",
  "assets/art/discovery_badge.webp": "55979036",
  "assets/art/fire_first.webp": "bb94f252",
  "assets/art/first_sale.webp": "044386cf",
  "assets/art/forge_done.webp": "7dd57706",
  "assets/art/fort_unseal.webp": "be197b73",
  "assets/art/health_low.webp": "a5510010",
  "assets/art/home_sell.webp": "20ee6910",
  "assets/art/kind_build.webp": "9bc3120a",
  "assets/art/kind_craft.webp": "690d8ab7",
  "assets/art/kind_delivery.webp": "4b98cd9f",
  "assets/art/kind_energy.webp": "ce506672",
  "assets/art/kind_farm.webp": "ae7de8de",
  "assets/art/kind_fire.webp": "5ba45bd4",
  "assets/art/kind_forge.webp": "db6b0840",
  "assets/art/kind_inn.webp": "67884993",
  "assets/art/kind_memory.webp": "e6fac5f6",
  "assets/art/kind_menu.webp": "a6fcfa78",
  "assets/art/kind_note.webp": "0b8cb2be",
  "assets/art/kind_quest.webp": "d0952908",
  "assets/art/kind_relics.webp": "775084f5",
  "assets/art/kind_rest.webp": "0552016e",
  "assets/art/kind_shop.webp": "345461ec",
  "assets/art/kind_slots.webp": "907b6057",
  "assets/art/kind_supplies.webp": "bd6e166e",
  "assets/art/kind_trade.webp": "82efae87",
  "assets/art/kind_trail.webp": "3b4ff21b",
  "assets/art/kind_treasure.webp": "ee22ad5d",
  "assets/art/kind_use.webp": "117231ec",
  "assets/art/kind_wizard.webp": "6480a894",
  "assets/art/memory_doorway.webp": "682fe4b0",
  "assets/art/memory_grip.webp": "082b171e",
  "assets/art/npc_bryn.webp": "78524820",
  "assets/art/npc_edda.webp": "998bf5bc",
  "assets/art/npc_maud.webp": "706fba8d",
  "assets/art/npc_orrin.webp": "45006f9d",
  "assets/art/npc_tilly.webp": "bfdf44e8",
  "assets/art/npc_tilly_happy.webp": "a699b472",
  "assets/art/pet_clearing.webp": "288767eb",
  "assets/art/progression_arena.webp": "4191c31c",
  "assets/art/progression_elevator.webp": "3873b121",
  "assets/art/progression_portal.webp": "78541c16",
  "assets/art/quarry_sapphire.webp": "250a3bb2",
  "assets/art/restore_blacksmith.webp": "ced57dbb",
  "assets/art/restore_house.webp": "b1147404",
  "assets/art/restore_market.webp": "53bd5117",
  "assets/art/restore_trader.webp": "32c51544",
  "assets/art/restore_wizard.webp": "d451c8ff",
  "assets/art/revive_fall.webp": "dd0d9e1c",
  "assets/art/revive_found.webp": "b60fd32a",
  "assets/art/revive_wake.webp": "4d7765d7",
  "assets/art/safety_phone.webp": "8bd11d00",
  "assets/art/safety_welcome.webp": "abec3033",
  "assets/art/shiny_first.webp": "dfe262b9",
  "assets/art/shrine_bone_watcher.webp": "6a5f9fce",
  "assets/art/shrine_ember_altar.webp": "954b454b",
  "assets/art/shrine_grove.webp": "ceb82107",
  "assets/art/shrine_harvest_idol.webp": "4f0291d1",
  "assets/art/shrine_lantern_saint.webp": "6e52b317",
  "assets/art/shrine_moss_cairn.webp": "d1968c7c",
  "assets/art/shrine_rust_totem.webp": "b971aef1",
  "assets/art/shrine_tide_bell.webp": "2fbce3f1",
  "assets/art/shrine_toad_idol.webp": "78b423b3",
  "assets/art/shrine_wayfarer_post.webp": "fe8ce1b7",
  "assets/art/shrine_waystone.webp": "e13ef045",
  "assets/art/shrine_wishing_well.webp": "c143ceb5",
  "assets/art/story_nightmare.webp": "62346b56",
  "assets/art/story_wake.webp": "9dffc1e7",
  "assets/art/story_wrecks.webp": "f9bff7d3",
  "assets/art/street_bandit.webp": "48c653c9",
  "assets/art/street_barricade.webp": "b5d12a0d",
  "assets/art/street_burned.webp": "dadec213",
  "assets/art/street_golden.webp": "c91d02e0",
  "assets/art/street_greenway.webp": "719486fc",
  "assets/art/street_hedgerow.webp": "fa2acf32",
  "assets/art/street_lantern.webp": "133cbee4",
  "assets/art/street_orchard.webp": "cada8486",
  "assets/art/street_overgrown.webp": "1e8484bc",
  "assets/art/street_parkpath.webp": "fe4f74ca",
  "assets/art/street_pilgrim.webp": "be6e4e38",
  "assets/art/street_scenic.webp": "96f1e163",
  "assets/art/street_snare.webp": "575052b7",
  "assets/art/street_toadstool.webp": "00102038",
  "assets/art/temple_activated.webp": "93666835",
  "assets/art/tool_catch.webp": "97ab42e3",
  "assets/art/tool_catch_chicken.webp": "d5ece4c4",
  "assets/art/tool_chop.webp": "5b25a164",
  "assets/art/tool_dig.webp": "72478c35",
  "assets/art/tool_shoot.webp": "edf8f5dd",
  "assets/art/tool_staff.webp": "5f71c857",
  "assets/art/tool_sword.webp": "d2babcc7",
  "assets/art/tool_till.webp": "0b48fd33",
  "assets/art/tool_water.webp": "0b772cb4",
  "assets/art/trail_intro.webp": "97c8d508",
  "assets/art/trail_prize.webp": "6ecb62eb",
  "assets/art/trap_free.webp": "e4903efb",
  "assets/art/trap_jaw.webp": "26caf9a0",
  "assets/art/underground_bone_gallery.webp": "c23b9e73",
  "assets/art/underground_depth2_rock_scatter.webp": "e8551cb3",
  "assets/art/underground_gemstone_cavern.webp": "81b47df2",
  "assets/art/underground_gemstone_path.webp": "942f24eb",
  "assets/art/underground_goblin_warrens.webp": "449e3ba3",
  "assets/art/underground_mine_tunnels.webp": "ab395270",
  "assets/art/underground_miners_way.webp": "590e522f",
  "assets/art/underground_mushroom_cavern.webp": "b57556f2",
  "assets/art/underground_root_passage.webp": "d1e616e4",
  "assets/art/underground_seep_passage.webp": "e329cd24",
  "assets/art/underground_sm_road_passage.webp": "ad391ba5",
  "assets/art/underground_spring_cave.webp": "dcffdfb0",
  "assets/art/underground_warren_run.webp": "91fdf52a",
  "assets/art/visit_bike.webp": "3caf14ae",
  "assets/art/visit_gold.webp": "837def87",
  "assets/art/visit_hive.webp": "606baf3a",
  "assets/art/visit_wagon.webp": "8b5fb551",
  "assets/art/wizard_cold.webp": "dfdc743d",
  "assets/art/wizard_dragon.webp": "5751a794",
  "assets/art/wizard_map.webp": "88da75f3",
  "assets/art/zone_grove.webp": "aaf3842f",
  "assets/art/zone_quarry.webp": "0df8690f",
  "assets/art/zone_shore.webp": "6237121b",
  "assets/art/zone_stones.webp": "cae019cd",
  "assets/art/zone_tar.webp": "d3c26957",
  "assets/art/zone_viewpoint.webp": "af7db19d"
};
/* ASSET_HASHES_END */
const TILE_CACHE    = 'tiles-v1';
// How old a cached tile may get before it is refreshed IN THE BACKGROUND. It
// is never an expiry: a stale tile is still served, and a failed refresh keeps
// the old copy. Deliberately long — the base map (streets, buildings) barely
// moves, and re-fetching costs the player data.
const TILE_REFRESH_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days

// The non-script shell. The SCRIPTS are not listed here on purpose — they're
// read out of index.html at install time (see scriptUrlsFromIndex), because a
// hand-maintained list drifts: this one once named 6 of the ~25 modules the
// page loads, app.js among them and save.js not, which is exactly how a boot
// could end up with the app but not its save layer ("loadSave is not defined").
// That includes vendor/phaser.js — it is a same-origin <script src> like the
// rest, so the page scan already covers it (tools/shell_audit.js fails on any
// .js hand-listed here).
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
];

// Every same-origin script index.html pulls in, at the exact ?v= URLs it asks
// for. Covers both the plain <script src> tags and app.js, which the boot gate
// injects from the APP_SRC string rather than a tag.
async function scriptUrlsFromIndex() {
  try {
    const resp = await fetch('./index.html', { cache: 'no-cache' });
    if (!resp.ok) return [];
    const html = await resp.text();
    const urls = [];
    for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)) urls.push(m[1]);
    const app = html.match(/APP_SRC\s*=\s*['"]([^'"]+)['"]/);
    if (app) urls.push(app[1]);
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
  // Preserve the established offline script fallback. Never substitute old
  // unversioned image bytes: a changed atlas can have a different frame layout.
  if (new URL(req.url).pathname.endsWith('.js')) {
    const stale = await cache.match(req, { ignoreSearch: true })
      || await previousShellMatch(req, { ignoreSearch: true });
    if (stale) return stale;
  }
  return resp || new Response('', { status: 504, statusText: 'offline' });
}
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_VERSION);
    const scripts = await scriptUrlsFromIndex();
    await Promise.allSettled(SHELL_ASSETS.map(u => cache.add(u)));
    await Promise.allSettled(scripts.map(u => {
      const req = new Request(new URL(u, self.location.href));
      return immutableResource(req, resourceKey(new URL(req.url)) || req.url);
    }));
    // An offline/failed index fetch must not authorize pruning older resources.
    if (scripts.length) {
      const resources = scripts.map(u => new URL(u, self.location.href).href);
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

  // HTML is network-first with offline fallback; immutable media/scripts
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
